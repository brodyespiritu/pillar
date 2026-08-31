import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { confirmDialog, alertDialog } from '../../lib/dialog';
import { MINISTRIES } from '../../lib/ministries';
import { fetchEventsResult } from '../../lib/calendar';
import {
  fetchPlaybooks, createPlaybook, deletePlaybook,
  arcProgress, liveStatus, daysUntil, promoLaunch, isTemplate, eventPicker, parseISO,
} from '../../lib/playbooks';
import './playbooks.css';

/* parseISO, not new Date: a bare 'YYYY-MM-DD' parses as UTC midnight and
   renders as the day before once it is shown in Eastern time. */
const fmtShort = d => parseISO(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/* "in 12 days" / "21 days ago" reads faster than a date when you are scanning. */
function whenLabel(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d > 0) return `in ${d} ${d === 1 ? 'day' : 'days'}`;
  return `${-d} ${-d === 1 ? 'day' : 'days'} ago`;
}

export default function PlaybooksPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [data, setData] = useState({ rows: [], missing: false });
  const [events, setEvents] = useState({ rows: [], error: null });
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(null);   // 'event' | 'ministry'
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setLoading(true);
    const [pbs, evs] = await Promise.all([fetchPlaybooks(), fetchEventsResult('church')]);
    setData(pbs);
    setEvents(evs);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const eventArcs    = useMemo(() => data.rows.filter(p => p.kind !== 'ministry'), [data.rows]);
  const ministryArcs = useMemo(() => data.rows.filter(p => p.kind === 'ministry'), [data.rows]);

  const picker = useMemo(
    () => eventPicker({ events: events.rows, error: events.error, arcs: data.rows, query }),
    [events, data.rows, query]);

  const openMinistries = useMemo(() => {
    const taken = new Set(ministryArcs.map(p => p.ministry));
    return MINISTRIES.filter(m => !taken.has(m.name));
  }, [ministryArcs]);

  const openPicker  = kind => { setQuery(''); setPicking(kind); };
  const closePicker = ()   => { setQuery(''); setPicking(null); };

  async function build(kind, source) {
    setBusy(source.id || source.name);
    try {
      const base = kind === 'event'
        ? { kind: 'event', title: source.title, description: source.description || '',
            event_id: source.id, event_date: source.start_date, arc_weeks: 4,
            audience: 'Churchwide' }
        : { kind: 'ministry', title: source.name, description: source.desc || '',
            ministry: source.name, event_date: null, arc_weeks: 4, audience: 'Ministry' };

      const { data: pb, error } = await createPlaybook({ ...base, created_by: profile?.id || null, status: 'Draft' });
      if (error) throw error;
      // A new arc starts empty — the plan is the point, so it gets built by hand.
      closePicker();
      navigate(`/playbooks/${pb.id}`);
    } catch (e) {
      alertDialog(`Could not create that playbook: ${e.message}`);
    } finally { setBusy(''); }
  }

  async function remove(pb) {
    if (!(await confirmDialog({
      title: `Delete the ${pb.title} playbook?`,
      message: 'The promotion plan is removed. The event itself is untouched.',
      danger: true, confirmLabel: 'Delete',
    }))) return;
    await deletePlaybook(pb.id);
    load();
  }

  if (data.missing) {
    return (
      <div className="pb-wrap"><TopNav /><main className="pb-scroll"><div className="pb-container">
        <div className="adm-placeholder">
          <div className="adm-placeholder-icon"><Icon d={P.announce} size={28} /></div>
          <h2>Set up Playbooks</h2>
          <p>Run <strong>supabase/playbooks-schema.sql</strong> to enable promotion arcs.</p>
        </div>
      </div></main></div>
    );
  }

  return (
    <div className="pb-wrap">
      <TopNav />
      <main className="pb-scroll">
        <div className="pb-container">
          <header className="pb-hero">
            <span className="pb-pill">Communications</span>
            <h1 className="pb-title">Playbooks / Arcs</h1>
            <p className="pb-sub">
              A step-by-step promotion arc for everything that matters — what to post, and when.
            </p>
          </header>

          <Section
            title="Events"
            sub="Arcs counting down to a date on the calendar."
            arcs={eventArcs}
            onOpen={pb => navigate(`/playbooks/${pb.id}`)}
            onDelete={remove}
            onNew={() => openPicker('event')}
            newLabel="New event arc"
            loading={loading}
            empty="No event arcs yet. Pick an event from the calendar to build one."
          />

          <Section
            title="Ministries"
            sub="Reference layouts — how an event under each ministry gets promoted."
            arcs={ministryArcs}
            onOpen={pb => navigate(`/playbooks/${pb.id}`)}
            onDelete={remove}
            onNew={() => openPicker('ministry')}
            newLabel="New ministry arc"
            loading={loading}
            empty="No ministry arcs yet."
          />
        </div>
      </main>

      {picking && (
        <div className="modal-overlay" onClick={closePicker}>
          <div className="modal sheet pb-pick" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{picking === 'event' ? 'Build an arc for an event' : 'Build an arc for a ministry'}</h2>
              <button className="modal-x" onClick={closePicker}><Icon d={P.close} size={20} /></button>
            </div>
            <div className="modal-body">
              {picking === 'event' ? (
                <>
                  {events.rows.length > 0 && (
                    <input
                      className="pb-pick-search"
                      placeholder="Search the calendar"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      autoFocus
                    />
                  )}
                  {picker.usingPast && (
                    <p className="pb-pick-note">Nothing upcoming on the calendar — showing recent events.</p>
                  )}
                  {picker.empty
                    ? <p className="pb-empty">{picker.empty}</p>
                    : picker.rows.map(e => (
                      <button key={e.id} className="pb-pick-row" disabled={!!busy} onClick={() => build('event', e)}>
                        <span className="pb-pick-main">
                          <span className="pb-pick-name">{e.title}</span>
                          <span className="pb-pick-sub">{fmtShort(e.start_date)} · {whenLabel(e.start_date)}</span>
                        </span>
                        <Icon d={P.arrowRight} size={16} />
                      </button>
                    ))}
                </>
              ) : (
                openMinistries.length === 0
                  ? <p className="pb-empty">Every ministry already has an arc.</p>
                  : openMinistries.map(m => (
                    <button key={m.name} className="pb-pick-row" disabled={!!busy} onClick={() => build('ministry', m)}>
                      <span className="pb-pick-ic" style={{ background: `${m.color}1a`, color: m.color }}>
                        <Icon d={m.icon} size={17} />
                      </span>
                      <span className="pb-pick-main">
                        <span className="pb-pick-name">{m.name}</span>
                        <span className="pb-pick-sub">{m.desc}</span>
                      </span>
                      <Icon d={P.arrowRight} size={16} />
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, sub, arcs, onOpen, onDelete, onNew, newLabel, loading, empty }) {
  return (
    <section className="pb-section">
      <div className="pb-section-head">
        <div>
          <h2>{title}<span className="pb-section-count">{arcs.length}</span></h2>
          <p>{sub}</p>
        </div>
        <button className="btn-primary sm" onClick={onNew}><Icon d={P.plus} size={15} />{newLabel}</button>
      </div>

      {loading ? <p className="pb-empty">Loading…</p>
        : arcs.length === 0 ? <p className="pb-empty">{empty}</p>
        : (
          <div className="pb-grid">
            {arcs.map(pb => <ArcCard key={pb.id} pb={pb} onOpen={() => onOpen(pb)} onDelete={() => onDelete(pb)} />)}
          </div>
        )}
    </section>
  );
}

function ArcCard({ pb, onOpen, onDelete }) {
  const template = isTemplate(pb);
  const status = liveStatus(pb);
  const pct = template ? 100 : Math.round(arcProgress(pb) * 100);
  const launch = template ? null : promoLaunch(pb);
  const items = pb.playbook_items || [];
  const done = items.filter(i => i.done).length;

  return (
    <div className={`pb-card ${template ? 'reference' : ''}`}>
      <button className="pb-card-open" onClick={onOpen}>
        <div className="pb-card-top">
          <span className={`pb-status ${status.toLowerCase()}`}>{status}</span>
          <span className="pb-card-when">
            {template
              ? `${pb.arc_weeks}-week layout`
              : <>{fmtShort(pb.event_date)} · {whenLabel(pb.event_date)}</>}
          </span>
        </div>

        <h3 className="pb-card-title">{pb.title}</h3>
        {pb.description && <p className="pb-card-desc">{pb.description}</p>}

        {/* How far through the run-up we are. */}
        <div className="pb-bar" role="img" aria-label={`${pct}% through the arc`}>
          <span style={{ width: `${pct}%` }} />
        </div>

        <div className="pb-card-foot">
          <span>{pb.audience} · {pb.arc_weeks}-week arc</span>
          <span>{template
            ? `${items.length} ${items.length === 1 ? 'step' : 'steps'}`
            : items.length ? `${done}/${items.length} done` : 'No items yet'}</span>
        </div>
        {launch && <span className="pb-card-launch">Promo starts {fmtShort(launch)}</span>}
      </button>
      <button className="pb-card-x" onClick={onDelete} title={`Delete ${pb.title}`} aria-label={`Delete ${pb.title}`}>
        <Icon d={P.trash} size={14} />
      </button>
    </div>
  );
}
