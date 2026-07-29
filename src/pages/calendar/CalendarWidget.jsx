import { useState, useEffect, useCallback, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { alertDialog, confirmDialog } from '../../lib/dialog';
import {
  fetchEvents, CATEGORIES, catColor, iso, parseISO, isToday, addDays,
  fmtTime, saveEvent, deleteEvent, eventCoversDay,
} from '../../lib/calendar';
import ContextMenu from './ContextMenu';
import './CalendarWidget.css';

const DAYS_AHEAD = 21;
const REFRESH_MS = 5 * 60 * 1000;

const dayHeading = d => isToday(d) ? 'Today'
  : iso(d) === iso(addDays(new Date(), 1)) ? 'Tomorrow'
  : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

/*
 * Compact calendar for the desktop widget window (see open_calendar_widget in
 * src-tauri). Runs the same routes and Supabase session as the main window, so
 * anything changed here shows up there on the next load.
 */
export default function CalendarWidget() {
  const [calendar, setCalendar] = useState('church');
  const [events, setEvents] = useState([]);
  const [menu, setMenu]     = useState(null);   // { x, y, event }
  const [form, setForm]     = useState(null);   // { event } | { date }
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setEvents(await fetchEvents(calendar));
    setLoading(false);
  }, [calendar]);

  useEffect(() => { load(); }, [load]);
  // The widget sits open for days — keep it current without a manual refresh.
  useEffect(() => {
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i))
      .map(d => ({
        date: d,
        items: events.filter(ev => eventCoversDay(ev, d))
          .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
      }))
      .filter(g => g.items.length);
  }, [events]);

  async function removeEvent(ev, mode) {
    const what = mode === 'single' ? `"${ev.title}"` : `the entire "${ev.title}" series`;
    if (!(await confirmDialog({ message: `Delete ${what}?` }))) return;
    const { error } = await deleteEvent(ev, mode);
    if (error) return alertDialog(`Could not delete: ${error.message}`);
    load();
  }

  return (
    <div className="cw">
      <header className="cw-head">
        <div className="cw-switch">
          <button className={calendar === 'church' ? 'on' : ''} onClick={() => setCalendar('church')}>Church</button>
          <button className={calendar === 'personal' ? 'on' : ''} onClick={() => setCalendar('personal')}>Mine</button>
        </div>
        <button className="cw-add" onClick={() => setForm({ date: iso(new Date()) })}>
          <Icon d={P.plus} size={14} />New
        </button>
      </header>

      <div className="cw-scroll">
        {loading && <p className="cw-empty">Loading…</p>}
        {!loading && !days.length && <p className="cw-empty">Nothing scheduled in the next three weeks.</p>}

        {days.map(({ date, items }) => (
          <section key={iso(date)} className="cw-day">
            <p className={`cw-dayhead ${isToday(date) ? 'today' : ''}`}>{dayHeading(date)}</p>
            {items.map(ev => (
              <button key={ev.id} className="cw-ev" style={{ '--cc': catColor(ev.category) }}
                onClick={() => setForm({ event: ev })}
                onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, event: ev }); }}>
                <span className="cw-ev-time">{ev.start_time ? fmtTime(ev.start_time) : 'All day'}</span>
                <span className="cw-ev-title">{ev.title}</span>
                {ev.location && <span className="cw-ev-loc">{ev.location}</span>}
              </button>
            ))}
          </section>
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { icon: P.edit,  label: 'Edit event', act: () => setForm({ event: menu.event }) },
          { icon: P.trash, label: menu.event.series_id ? 'Delete this event' : 'Delete', danger: true,
            act: () => removeEvent(menu.event, 'single') },
          menu.event.series_id && { icon: P.trash, label: 'Delete entire series', danger: true,
            act: () => removeEvent(menu.event, 'series') },
        ]} />
      )}

      {form && (
        <QuickEvent calendar={calendar} event={form.event} date={form.date}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}
    </div>
  );
}

const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const toHHMM = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

/*
 * Keep the event's length when its start time moves. The widget has no end-time
 * field, so without this a quick edit here would silently wipe an end time set
 * in the full calendar.
 */
export function shiftedEnd(event, allDay, start) {
  if (allDay) return null;
  if (!event?.end_time || !event?.start_time) return event?.end_time ?? null;
  if (event.start_time === start) return event.end_time;
  const dur = toMin(event.end_time) - toMin(event.start_time);
  return toHHMM(Math.min(toMin(start) + dur, 23 * 60 + 59));
}

/* Compact create/edit form sized for the widget window. */
function QuickEvent({ calendar, event, date, onClose, onSaved }) {
  const editing = !!event;
  const [title, setTitle]   = useState(event?.title || '');
  const [day, setDay]       = useState(event?.start_date || date || iso(new Date()));
  const [allDay, setAllDay] = useState(editing ? !event.start_time : false);
  const [start, setStart]   = useState(event?.start_time || '18:00');
  const [category, setCategory] = useState(event?.category || 'Other');
  const [location, setLocation] = useState(event?.location || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function save() {
    if (!title.trim()) return setErr('Give the event a name.');
    setSaving(true);
    setErr('');
    const { error } = await saveEvent({
      ...(editing ? { id: event.id } : {}),
      calendar: editing ? event.calendar : calendar,
      title: title.trim(),
      category,
      start_date: day,
      start_time: allDay ? null : start,
      end_time: editing ? shiftedEnd(event, allDay, start) : null,
      location: location.trim(),
    });
    setSaving(false);
    if (error) return setErr(error.message || 'Could not save.');
    onSaved();
  }

  return (
    <div className="cw-sheet">
      <header className="cw-sheet-head">
        <h2>{editing ? 'Edit Event' : 'New Event'}</h2>
        <button onClick={onClose}><Icon d={P.close} size={18} /></button>
      </header>
      <div className="cw-sheet-body">
        <label className="cw-f"><span>Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Choir Rehearsal" autoFocus />
        </label>
        <label className="cw-f"><span>Date</span>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
        </label>
        <label className="cw-check">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
          All day
        </label>
        {!allDay && (
          <label className="cw-f"><span>Starts</span>
            <input type="time" value={start} onChange={e => setStart(e.target.value)} />
          </label>
        )}
        <label className="cw-f"><span>Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
          </select>
        </label>
        <label className="cw-f"><span>Location</span>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
        </label>
        {err && <p className="cw-err">{err}</p>}
      </div>
      <footer className="cw-sheet-foot">
        <button className="cw-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="cw-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    </div>
  );
}
