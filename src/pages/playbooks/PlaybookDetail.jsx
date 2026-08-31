import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { confirmDialog, alertDialog } from '../../lib/dialog';
import {
  fetchPlaybook, updatePlaybook, addItem, updateItem, deleteItem,
  CHANNELS, CHANNEL_COLOR, AUDIENCES, arcWeeks, promoLaunch, daysUntil,
  liveStatus, iso, addDays, isTemplate, slotOf, parseISO,
} from '../../lib/playbooks';
import './playbooks.css';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/* parseISO, not new Date: a bare 'YYYY-MM-DD' parses as UTC midnight and
   renders as the day before once it is shown in Eastern time. */
const fmtShort = d => parseISO(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtLong  = d => parseISO(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function PlaybookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pb, setPb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('calendar');     // calendar | list
  const [adding, setAdding] = useState(null);       // the day being added to
  const [editing, setEditing] = useState(null);     // an existing item
  const [settings, setSettings] = useState(false);

  async function load() {
    const { data, error } = await fetchPlaybook(id);
    if (error) { alertDialog(`Could not open that playbook: ${error.message}`); navigate('/playbooks'); return; }
    setPb(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);   // eslint-disable-line

  const weeks = useMemo(() => (pb ? arcWeeks(pb) : []), [pb]);
  const bySlot = useMemo(() => {
    const m = new Map();
    for (const it of pb?.playbook_items || []) {
      const s = slotOf(pb, it);
      if (!s) continue;
      const k = `${s.week}:${s.dow}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }, [pb]);

  if (loading) return <div className="pb-wrap"><TopNav /><main className="pb-scroll"><div className="pb-container"><p className="pb-empty">Loading…</p></div></main></div>;
  if (!pb) return null;

  const template = isTemplate(pb);
  const status = liveStatus(pb);
  const launch = promoLaunch(pb);
  const d = daysUntil(pb.event_date);
  const items = pb.playbook_items || [];
  const done = items.filter(i => i.done).length;

  async function saveItem(form) {
    /* A template arc stores where it sits in the arc; a dated one stores the day. */
    const where = template
      ? { week_index: form.week_index, dow: form.dow, due_date: null }
      : { due_date: form.due_date };
    const body = { channel: form.channel, title: form.title, notes: form.notes, ...where };
    if (form.id) await updateItem(form.id, body);
    else await addItem({ playbook_id: pb.id, ...body });
    setAdding(null); setEditing(null);
    load();
  }
  async function toggle(it) { await updateItem(it.id, { done: !it.done }); load(); }
  async function removeItem(it) {
    if (!(await confirmDialog({ title: 'Remove this item?', message: `${it.channel}${it.title ? ` — ${it.title}` : ''}`, danger: true, confirmLabel: 'Remove' }))) return;
    await deleteItem(it.id); setEditing(null); load();
  }
  async function saveSettings(patch) { await updatePlaybook(pb.id, patch); setSettings(false); load(); }

  return (
    <div className="pb-wrap">
      <TopNav />
      <main className="pb-scroll">
        <div className="pb-container">
          <button className="pb-back" onClick={() => navigate('/playbooks')}>
            <Icon d={P.chevL} size={17} />All playbooks
          </button>

          <header className="pb-detail-head">
            <div className="pb-detail-main">
              <span className="pb-arc-pill">{pb.arc_weeks}-week promotion arc</span>
              <h1 className="pb-detail-title">{pb.title}</h1>
              {pb.description && <p className="pb-detail-desc">{pb.description}</p>}
              <p className="pb-detail-when">
                {template
                  ? <>Reference layout · how an event under this ministry gets promoted</>
                  : <>
                      {launch && <>Promo starts {fmtLong(launch)}</>}
                      {pb.event_date && <> · Event {fmtLong(pb.event_date)}</>}
                      {d !== null && <> · <strong>{d === 0 ? 'today' : d > 0 ? `in ${d} days` : `${-d} days ago`}</strong></>}
                    </>}
              </p>
            </div>
            <div className="pb-detail-side">
              <span className={`pb-status ${status.toLowerCase()}`}>{status}</span>
              <p className="pb-detail-audience">{pb.audience}</p>
              <p className="pb-detail-count">{items.length ? `${done} of ${items.length} done` : 'Nothing scheduled yet'}</p>
              <button className="btn-ghost sm" onClick={() => setSettings(true)}>
                <Icon d={P.settings} size={14} />Arc settings
              </button>
            </div>
          </header>

          <div className="pb-toolbar">
            <span className="pb-toolbar-label">The arc</span>
            <div className="pb-viewtoggle">
              <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Calendar</button>
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
            </div>
          </div>

          {view === 'calendar' ? (
            weeks.map((w, wi) => (
              <section key={wi} className="pb-week">
                <p className="pb-week-label">{w.label}{w.start && <> · {fmtShort(w.start)}</>}</p>
                <div className="pb-week-grid">
                  {DOW.map((dow, di) => {
                    const day = w.start ? addDays(w.start, di) : null;
                    const dayItems = bySlot.get(`${wi}:${di}`) || [];
                    const isEvent = !template && day && iso(day) === pb.event_date;
                    return (
                      <div key={di} className={`pb-day ${isEvent ? 'event' : ''}`}>
                        <div className="pb-day-head">
                          <span className="pb-dow">{dow}</span>
                          {day && <span className="pb-daynum">{day.getDate()}</span>}
                        </div>
                        {dayItems.map(it => (
                          <button key={it.id} className={`pb-chip ${it.done ? 'done' : ''}`}
                            style={{ '--ch': CHANNEL_COLOR[it.channel] || '#6B7280' }}
                            onClick={() => setEditing(it)}
                            title={it.title || it.channel}>
                            <span className="pb-chip-dot" />
                            <span className="pb-chip-text">{it.title || it.channel}</span>
                          </button>
                        ))}
                        <button className="pb-day-add"
                          onClick={() => setAdding(template ? { week_index: wi, dow: di } : iso(day))}
                          aria-label={`Add to ${w.label} ${dow}`}>
                          <Icon d={P.plus} size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="pb-list">
              {items.length === 0 && <p className="pb-empty">Nothing scheduled yet.</p>}
              {[...items].sort((a, b) => (template
                ? (a.week_index - b.week_index) || (a.dow - b.dow)
                : String(a.due_date).localeCompare(String(b.due_date)))).map(it => (
                <div key={it.id} className="pb-listrow">
                  <button className="pb-check" onClick={() => toggle(it)} aria-label={it.done ? 'Mark not done' : 'Mark done'}>
                    {it.done ? <Icon d={P.check} size={14} /> : <span className="pb-check-empty" />}
                  </button>
                  <span className="pb-listrow-ch" style={{ '--ch': CHANNEL_COLOR[it.channel] }}>{it.channel}</span>
                  <span className="pb-listrow-title">{it.title || <em>Untitled</em>}</span>
                  <span className="pb-listrow-date">
                    {template
                      ? `${weeks[it.week_index ?? 0]?.label || 'Week 1'} · ${DOW[it.dow ?? 0]}`
                      : fmtLong(it.due_date)}
                  </span>
                  <button className="pb-listrow-x" onClick={() => setEditing(it)} aria-label="Edit"><Icon d={P.edit} size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {(adding || editing) && (
        <ItemModal
          template={template}
          weeks={weeks}
          item={editing}
          slot={typeof adding === 'object' ? adding : (editing ? slotOf(pb, editing) : null)}
          date={typeof adding === 'string' ? adding : editing?.due_date}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSave={saveItem}
          onDelete={editing ? () => removeItem(editing) : null}
          onToggle={editing ? () => { toggle(editing); setEditing(null); } : null}
        />
      )}
      {settings && <SettingsModal pb={pb} onClose={() => setSettings(false)} onSave={saveSettings} />}
    </div>
  );
}

function ItemModal({ template, weeks = [], item, slot, date, onClose, onSave, onDelete, onToggle }) {
  const [form, setForm] = useState({
    id: item?.id,
    due_date: item?.due_date || date || '',
    week_index: slot?.week ?? item?.week_index ?? 0,
    dow: slot?.dow ?? item?.dow ?? 0,
    channel: item?.channel || 'Stage', title: item?.title || '', notes: item?.notes || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{item ? 'Edit item' : 'Schedule an item'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <p className="pb-modal-date">
            {template
              ? `${weeks[form.week_index]?.label || 'Week 1'} · ${DOW[form.dow]}`
              : fmtLong(form.due_date)}
          </p>

          <div className="field-group"><span>Where it goes</span>
            <div className="pb-channels">
              {CHANNELS.map(c => (
                <button key={c.key} type="button" title={c.hint}
                  className={`pb-channel ${form.channel === c.key ? 'on' : ''}`}
                  style={{ '--ch': c.color }}
                  onClick={() => set('channel', c.key)}>
                  <span className="pb-chip-dot" />{c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field-group"><span>What to say</span>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. First announcement" autoFocus />
          </label>
          <label className="field-group"><span>Notes</span>
            <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Script, link, or anything the person needs…" />
          </label>
          {template ? (
            <div className="field-row">
              <label className="field-group"><span>Week of the arc</span>
                <select value={form.week_index} onChange={e => set('week_index', Number(e.target.value))}>
                  {weeks.map((w, i) => <option key={i} value={i}>{w.label}</option>)}
                </select>
              </label>
              <label className="field-group"><span>Day</span>
                <select value={form.dow} onChange={e => set('dow', Number(e.target.value))}>
                  {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <label className="field-group"><span>Date</span>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </label>
          )}
        </div>
        <div className="modal-foot">
          {onDelete && <button className="btn-danger" onClick={onDelete}><Icon d={P.trash} size={14} />Remove</button>}
          {onToggle && <button className="btn-ghost" onClick={onToggle}><Icon d={P.check} size={14} />{item.done ? 'Mark not done' : 'Mark done'}</button>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSave(form)}>{item ? 'Save' : 'Add to the arc'}</button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ pb, onClose, onSave }) {
  const [f, setF] = useState({
    title: pb.title, description: pb.description || '', event_date: pb.event_date || '',
    arc_weeks: pb.arc_weeks || 4, audience: pb.audience || 'Churchwide', status: pb.status,
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Arc settings</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <label className="field-group"><span>Title</span>
            <input value={f.title} onChange={e => set('title', e.target.value)} />
          </label>
          <label className="field-group"><span>Description</span>
            <textarea rows={2} value={f.description} onChange={e => set('description', e.target.value)} />
          </label>
          <div className="field-row">
            {pb.kind !== 'ministry' && (
              <label className="field-group"><span>Event date</span>
                <input type="date" value={f.event_date} onChange={e => set('event_date', e.target.value)} />
              </label>
            )}
            <label className="field-group"><span>Weeks of promo</span>
              <select value={f.arc_weeks} onChange={e => set('arc_weeks', Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 8].map(n => <option key={n} value={n}>{n} weeks</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field-group"><span>Audience</span>
              <select value={f.audience} onChange={e => set('audience', e.target.value)}>
                {AUDIENCES.map(a => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="field-group"><span>Status</span>
              <select value={f.status} onChange={e => set('status', e.target.value)}>
                {['Draft', 'Scheduled', 'Active', 'Complete'].map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <p className="pb-hint">
            {pb.kind === 'ministry'
              ? 'A ministry arc is a reference layout — no dates, just the shape a promotion takes.'
              : 'Changing the event date or the number of weeks moves the grid, not the items already on it.'}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSave({ ...f, event_date: f.event_date || null })}>Save</button>
        </div>
      </div>
    </div>
  );
}
