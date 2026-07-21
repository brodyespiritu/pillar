import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useCallback } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getAnnouncements, saveAnnouncement, deleteAnnouncement,
  getEvents, saveEvent, deleteEvent, genId,
} from '../../lib/appApi';

const DESTINATIONS = ['', 'Sermons', 'Give', 'Bible', 'Connect', 'Link'];

export default function NewsEventsPage() {
  const [tab, setTab] = useState('announcements');
  return (
    <AppShell title="News & Events" subtitle="Manage the announcements and events shown in the app.">
      <div className="ap-subtabs">
        <button className={tab === 'announcements' ? 'on' : ''} onClick={() => setTab('announcements')}>Announcements</button>
        <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>Events</button>
      </div>
      {tab === 'announcements' ? <Announcements /> : <Events />}
    </AppShell>
  );
}

/* ── Announcements ── */
function Announcements() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await getAnnouncements(); setRows(Array.isArray(r) ? r : []); } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function togglePublish(a) {
    const next = { ...a, published: !a.published };
    setRows(l => l.map(x => (x.id === a.id ? next : x)));
    try { await saveAnnouncement(next); } catch (e) { setError(e.message); load(); }
  }
  async function remove(a) {
    if (!(await confirmDialog({ message: `Delete “${a.title}”? This removes it from the live app.` }))) return;
    try { await deleteAnnouncement(a.id); setRows(l => l.filter(x => x.id !== a.id)); } catch (e) { setError(e.message); }
  }

  return (
    <>
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}
      <div className="ap-panel">
        <div className="ap-toolbar">
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{rows.length} announcement{rows.length === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="ap-btn" onClick={load} disabled={loading}><Icon d={P.repeat} size={15} />Refresh</button>
            <button className="ap-btn primary" onClick={() => setEditing({})}><Icon d={P.plus} size={15} />Add</button>
          </div>
        </div>
        {loading ? <div className="ap-loading"><span className="ap-spinner" />Loading…</div>
          : rows.length === 0 ? <div className="ap-empty">No announcements yet.</div>
          : <div className="ap-table-wrap"><table className="ap-table">
              <thead><tr><th>Title</th><th>Tag</th><th>Date</th><th>Status</th><th></th></tr></thead>
              <tbody>{rows.map(a => (
                <tr key={a.id}>
                  <td><div className="ap-cell-title">{a.title || 'Untitled'}</div><div className="ap-cell-sub">{a.body}</div></td>
                  <td>{a.tag ? <span className="ap-badge tag">{a.tag}</span> : '—'}</td>
                  <td>{a.date || '—'}</td>
                  <td><button className={`ap-badge ${a.published ? 'on' : 'off'}`} onClick={() => togglePublish(a)}><span className={`ap-dot ${a.published ? 'ok' : 'off'}`} />{a.published ? 'Published' : 'Draft'}</button></td>
                  <td><div className="ap-row-actions">
                    <button className="ap-icon-btn" onClick={() => setEditing(a)}><Icon d={P.edit} size={16} /></button>
                    <button className="ap-icon-btn danger" onClick={() => remove(a)}><Icon d={P.trash} size={16} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>
      {editing && <AnnouncementForm item={editing} onClose={() => setEditing(null)} onSaved={s => { setRows(l => l.some(x => x.id === s.id) ? l.map(x => x.id === s.id ? s : x) : [s, ...l]); setEditing(null); }} />}
    </>
  );
}

function AnnouncementForm({ item, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState({
    id: item.id || genId(), title: item.title || '', body: item.body || '', tag: item.tag || '',
    date: item.date || '', destination: item.destination || '', link: item.link || '', published: item.published !== false,
  });
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  async function save() {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try { await saveAnnouncement(f); onSaved(f); } catch (e) { setError(e.message); setSaving(false); }
  }
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isNew ? 'Add announcement' : 'Edit announcement'}</h2><button className="ap-modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button></div>
        <div className="ap-modal-body">
          <div className="ap-field"><label className="ap-label">Title</label><input className="ap-input" value={f.title} onChange={e => set('title', e.target.value)} autoFocus /></div>
          <div className="ap-field"><label className="ap-label">Body</label><textarea className="ap-textarea" rows={3} value={f.body} onChange={e => set('body', e.target.value)} /></div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Tag</label><input className="ap-input" value={f.tag} onChange={e => set('tag', e.target.value)} placeholder="NEW, EVENT…" /></div>
            <div className="ap-field"><label className="ap-label">Date label</label><input className="ap-input" value={f.date} onChange={e => set('date', e.target.value)} placeholder="Every Wed." /></div>
          </div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Tap destination</label>
              <select className="ap-select" value={f.destination} onChange={e => set('destination', e.target.value)}>
                {DESTINATIONS.map(d => <option key={d} value={d}>{d || 'None'}</option>)}
              </select>
            </div>
            <div className="ap-field"><label className="ap-label">Link (if destination = Link)</label><input className="ap-input" value={f.link} onChange={e => set('link', e.target.value)} placeholder="https://" /></div>
          </div>
          <label className="ap-switch"><input type="checkbox" checked={f.published} onChange={e => set('published', e.target.checked)} /><span className="ap-switch-track" />{f.published ? 'Published' : 'Draft'}</label>
          {error && <div className="ap-banner error" style={{ margin: 0 }}><Icon d={P.close} size={16} />{error}</div>}
        </div>
        <div className="ap-modal-foot">
          <button className="ap-btn" onClick={onClose}>Cancel</button>
          <button className="ap-btn primary" onClick={save} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />{isNew ? 'Add to app' : 'Save'}</>}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Events ── */
function Events() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await getEvents(); setRows(Array.isArray(r) ? r : []); } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function togglePublish(ev) {
    const next = { ...ev, published: !ev.published };
    setRows(l => l.map(x => (x.id === ev.id ? next : x)));
    try { await saveEvent(next); } catch (e) { setError(e.message); load(); }
  }
  async function remove(ev) {
    if (!(await confirmDialog({ message: `Delete “${ev.title}”? This removes it from the live app.` }))) return;
    try { await deleteEvent(ev.id); setRows(l => l.filter(x => x.id !== ev.id)); } catch (e) { setError(e.message); }
  }

  return (
    <>
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}
      <div className="ap-panel">
        <div className="ap-toolbar">
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{rows.length} event{rows.length === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="ap-btn" onClick={load} disabled={loading}><Icon d={P.repeat} size={15} />Refresh</button>
            <button className="ap-btn primary" onClick={() => setEditing({})}><Icon d={P.plus} size={15} />Add</button>
          </div>
        </div>
        {loading ? <div className="ap-loading"><span className="ap-spinner" />Loading…</div>
          : rows.length === 0 ? <div className="ap-empty">No events yet.</div>
          : <div className="ap-table-wrap"><table className="ap-table">
              <thead><tr><th>Event</th><th>When</th><th>Location</th><th>Category</th><th>Status</th><th></th></tr></thead>
              <tbody>{rows.map(ev => (
                <tr key={ev.id}>
                  <td><div className="ap-cell-title">{ev.title || 'Untitled'}</div></td>
                  <td>{[ev.day, ev.date, ev.time].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{ev.location || '—'}</td>
                  <td>{ev.category ? <span className="ap-badge tag">{ev.category}</span> : '—'}</td>
                  <td><button className={`ap-badge ${ev.published ? 'on' : 'off'}`} onClick={() => togglePublish(ev)}><span className={`ap-dot ${ev.published ? 'ok' : 'off'}`} />{ev.published ? 'Published' : 'Draft'}</button></td>
                  <td><div className="ap-row-actions">
                    <button className="ap-icon-btn" onClick={() => setEditing(ev)}><Icon d={P.edit} size={16} /></button>
                    <button className="ap-icon-btn danger" onClick={() => remove(ev)}><Icon d={P.trash} size={16} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>
      {editing && <EventForm item={editing} onClose={() => setEditing(null)} onSaved={s => { setRows(l => l.some(x => x.id === s.id) ? l.map(x => x.id === s.id ? s : x) : [s, ...l]); setEditing(null); }} />}
    </>
  );
}

function EventForm({ item, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState({
    id: item.id || genId(), title: item.title || '', date: item.date || '', day: item.day || '',
    time: item.time || '', location: item.location || '', category: item.category || '', published: item.published !== false,
  });
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  async function save() {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try { await saveEvent(f); onSaved(f); } catch (e) { setError(e.message); setSaving(false); }
  }
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isNew ? 'Add event' : 'Edit event'}</h2><button className="ap-modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button></div>
        <div className="ap-modal-body">
          <div className="ap-field"><label className="ap-label">Title</label><input className="ap-input" value={f.title} onChange={e => set('title', e.target.value)} autoFocus /></div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Day</label><input className="ap-input" value={f.day} onChange={e => set('day', e.target.value)} placeholder="SUN" /></div>
            <div className="ap-field"><label className="ap-label">Date</label><input className="ap-input" value={f.date} onChange={e => set('date', e.target.value)} placeholder="Jun 29" /></div>
          </div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Time</label><input className="ap-input" value={f.time} onChange={e => set('time', e.target.value)} placeholder="9:00 AM" /></div>
            <div className="ap-field"><label className="ap-label">Category</label><input className="ap-input" value={f.category} onChange={e => set('category', e.target.value)} placeholder="Worship" /></div>
          </div>
          <div className="ap-field"><label className="ap-label">Location</label><input className="ap-input" value={f.location} onChange={e => set('location', e.target.value)} placeholder="Main Sanctuary" /></div>
          <label className="ap-switch"><input type="checkbox" checked={f.published} onChange={e => set('published', e.target.checked)} /><span className="ap-switch-track" />{f.published ? 'Published' : 'Draft'}</label>
          {error && <div className="ap-banner error" style={{ margin: 0 }}><Icon d={P.close} size={16} />{error}</div>}
        </div>
        <div className="ap-modal-foot">
          <button className="ap-btn" onClick={onClose}>Cancel</button>
          <button className="ap-btn primary" onClick={save} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />{isNew ? 'Add to app' : 'Save'}</>}</button>
        </div>
      </div>
    </div>
  );
}
