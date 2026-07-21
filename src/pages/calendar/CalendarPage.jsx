import { alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  fetchEvents, CATEGORIES, catColor, monthGrid, monthLabel, dayLabel,
  WEEKDAYS, addMonths, addDays, startOfWeek, iso, parseISO, sameDay, isToday,
  eventCoversDay, fmtTime, upcomingEvents,
} from '../../lib/calendar';
import EventWizard from './EventWizard';
import EventProfile from './EventProfile';
import './Calendar.css';

const VIEWS = ['Month', 'Week', 'Day'];

export default function CalendarPage() {
  const location = useLocation();
  const [calendar, setCalendar] = useState('church'); // church | personal
  const [events, setEvents]     = useState([]);
  const [view, setView]         = useState('Month');
  const [cursor, setCursor]     = useState(() => location.state?.date ? parseISO(location.state.date) : new Date());
  const [wizard, setWizard]     = useState(null);      // { date } | { event }
  const [profile, setProfile]   = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  const load = useCallback(async () => {
    setEvents(await fetchEvents(calendar));
  }, [calendar]);
  useEffect(() => { load(); }, [load]);

  // Deep link from global search → open the exact event's profile
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    if (location.state?.add) {
      setWizard({ date: iso(cursor) });
      deepLinked.current = true;
      return;
    }
    if (!events.length) return;
    const id = location.state?.openEvent;
    if (id) {
      const ev = events.find(e => e.id === id);
      if (ev) setProfile(ev);
      deepLinked.current = true;
    }
  }, [events, location.state]);

  // N-key shortcut
  useEffect(() => {
    const h = e => {
      if (e.key.toLowerCase() === 'n' && !wizard && !profile &&
          !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        setWizard({ date: iso(cursor) });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [wizard, profile, cursor]);

  const upcoming = useMemo(() => upcomingEvents(events), [events]);
  const next = upcoming[0];

  function shift(dir) {
    if (view === 'Month') setCursor(c => addMonths(c, dir));
    else if (view === 'Week') setCursor(c => addDays(c, dir * 7));
    else setCursor(c => addDays(c, dir));
  }
  const heading = view === 'Month' ? monthLabel(cursor)
    : view === 'Week' ? `Week of ${startOfWeek(cursor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : dayLabel(cursor);

  const TOOLS = [
    { icon: P.layers,  label: 'Templates',       act: () => alertDialog('Drag & Drop templates — coming soon.') },
    { icon: P.planner, label: 'Service Planner',  act: () => alertDialog('Service Planner — coming soon.') },
    { icon: P.clock,   label: 'Time Off Request', act: () => alertDialog('Time Off Request — coming soon.') },
    { icon: P.print,   label: 'Print / Export',   act: () => alertDialog('Gantt PDF export — coming soon.') },
    { icon: P.settings, label: 'Calendar Settings', act: () => alertDialog('Calendar settings — coming soon.') },
  ];

  return (
    <div className="cal-wrap">
      <TopNav onNewClick={() => setWizard({ date: iso(cursor) })} />

      {/* Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-switch">
          <button className={calendar === 'church' ? 'on' : ''} onClick={() => setCalendar('church')}>Church Calendar</button>
          <button className={calendar === 'personal' ? 'on' : ''} onClick={() => setCalendar('personal')}>My Calendar</button>
        </div>

        <div className="cal-nav">
          <button onClick={() => shift(-1)}><Icon d={P.chevL} size={20} /></button>
          <button className="cal-today" onClick={() => setCursor(new Date())}>Today</button>
          <button onClick={() => shift(1)}><Icon d={P.chevR} size={20} /></button>
          <span className="cal-heading">{heading}</span>
        </div>

        <div className="cal-toolbar-right">
          <div className="cal-seg">
            {VIEWS.map(v => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <button className="cal-new" onClick={() => setWizard({ date: iso(cursor) })}>
            <Icon d={P.plus} size={15} />New Event
          </button>

          <div className="cal-tools">
            <button className={`cal-gear ${toolsOpen ? 'on' : ''}`} title="Tools & settings" onClick={() => setToolsOpen(o => !o)}>
              <Icon d={P.settings} size={19} />
            </button>
            {toolsOpen && (
              <>
                <div className="cal-tools-backdrop" onClick={() => setToolsOpen(false)} />
                <div className="cal-tools-menu">
                  {TOOLS.map(t => (
                    <button key={t.label} onClick={() => { setToolsOpen(false); t.act(); }}>
                      <Icon d={t.icon} size={16} />{t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="cal-body">
        {/* Main calendar */}
        <main className="cal-main">
          {view === 'Month' && <MonthView cursor={cursor} events={events} onDay={d => setWizard({ date: iso(d) })} onEvent={setProfile} />}
          {view === 'Week'  && <WeekView cursor={cursor} events={events} onSlot={(d) => setWizard({ date: iso(d) })} onEvent={setProfile} />}
          {view === 'Day'   && <DayView cursor={cursor} events={events} onSlot={() => setWizard({ date: iso(cursor) })} onEvent={setProfile} />}
        </main>

        {/* Upcoming sidebar */}
        <aside className="cal-upcoming">
          <p className="cal-up-label">Up Next</p>
          {next ? (
            <button className="cal-next" style={{ '--cc': catColor(next.category) }} onClick={() => setProfile(next)}>
              <span className="cal-next-time">{next.start_time ? fmtTime(next.start_time) : 'All day'}</span>
              <span className="cal-next-title">{next.title}</span>
              <span className="cal-next-date">{parseISO(next.start_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              {next.location && <span className="cal-next-loc"><Icon d={P.location} size={13} />{next.location}</span>}
            </button>
          ) : (
            <div className="cal-next-empty">No upcoming events</div>
          )}

          <p className="cal-up-label">Upcoming</p>
          <div className="cal-up-list">
            {upcoming.slice(1).map(e => (
              <button key={e.id} className="cal-up-item" onClick={() => setProfile(e)}>
                <span className="cal-up-dot" style={{ background: catColor(e.category) }} />
                <div className="cal-up-info">
                  <span className="cal-up-title">{e.title}</span>
                  <span className="cal-up-meta">
                    {parseISO(e.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {e.start_time ? ` · ${fmtTime(e.start_time)}` : ''}
                  </span>
                </div>
              </button>
            ))}
            {upcoming.length <= 1 && <p className="cal-up-none">Nothing else scheduled.</p>}
          </div>
        </aside>
      </div>

      {wizard && (
        <EventWizard calendar={calendar} initialDate={wizard.date} event={wizard.event}
          onClose={() => setWizard(null)} onSaved={() => { setWizard(null); load(); }} />
      )}
      {profile && (
        <EventProfile event={profile}
          onClose={() => setProfile(null)}
          onEdit={ev => { setProfile(null); setWizard({ event: ev, date: ev.start_date }); }}
          onChanged={load} />
      )}
    </div>
  );
}

/* ── Month view (week-row spanning bars) ── */
function MonthView({ cursor, events, onDay, onEvent }) {
  const grid = monthGrid(cursor);
  const weeks = Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7));
  const curMonth = cursor.getMonth();

  return (
    <div className="mv">
      <div className="mv-weekdays">
        {WEEKDAYS.map(d => <div key={d} className="mv-weekday">{d}</div>)}
      </div>
      <div className="mv-weeks">
        {weeks.map((week, wi) => <MonthWeek key={wi} week={week} events={events} curMonth={curMonth} onDay={onDay} onEvent={onEvent} />)}
      </div>
    </div>
  );
}

function MonthWeek({ week, events, curMonth, onDay, onEvent }) {
  const weekStart = week[0], weekEnd = week[6];
  const wsISO = iso(weekStart), weISO = iso(weekEnd);

  // events intersecting this week → segments with lane assignment
  const segs = [];
  events.forEach(ev => {
    const s = ev.start_date, e = ev.end_date || ev.start_date;
    if (e < wsISO || s > weISO) return;
    const segStart = s < wsISO ? weekStart : parseISO(s);
    const segEnd   = e > weISO ? weekEnd : parseISO(e);
    const col = Math.round((segStart - weekStart) / 864e5);
    const span = Math.round((segEnd - segStart) / 864e5) + 1;
    segs.push({ ev, col, span, key: ev.id });
  });
  // greedy lane packing
  const lanes = [];
  segs.sort((a, b) => a.col - b.col || b.span - a.span);
  segs.forEach(seg => {
    let lane = lanes.findIndex(l => l.every(x => seg.col >= x.col + x.span || seg.col + seg.span <= x.col));
    if (lane === -1) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(seg); seg.lane = lane;
  });
  const MAX_LANES = 3;

  return (
    <div className="mw">
      <div className="mw-days">
        {week.map(d => (
          <div key={iso(d)} className={`mw-day ${d.getMonth() === curMonth ? '' : 'out'}`} onClick={() => onDay(d)}>
            <span className={`mw-num ${isToday(d) ? 'today' : ''}`}>{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="mw-bars">
        {segs.filter(s => s.lane < MAX_LANES).map(seg => (
          <button key={seg.key} className="mw-bar"
            style={{
              gridColumn: `${seg.col + 1} / span ${seg.span}`,
              gridRow: seg.lane + 1,
              '--cc': catColor(seg.ev.category),
            }}
            onClick={e => { e.stopPropagation(); onEvent(seg.ev); }}>
            {seg.ev.start_time && <span className="mw-bar-dot" />}
            <span className="mw-bar-title">{seg.ev.title}</span>
          </button>
        ))}
        {lanes.length > MAX_LANES && (
          <div className="mw-more" style={{ gridColumn: '1 / span 7', gridRow: MAX_LANES + 1 }}>
            +{lanes.slice(MAX_LANES).flat().length} more
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Week view ── */
function WeekView({ cursor, events, onSlot, onEvent }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="wv">
      {days.map(d => {
        const dayEvents = events.filter(ev => eventCoversDay(ev, d))
          .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        return (
          <div key={iso(d)} className="wv-col" onClick={() => onSlot(d)}>
            <div className={`wv-head ${isToday(d) ? 'today' : ''}`}>
              <span className="wv-dow">{WEEKDAYS[d.getDay()]}</span>
              <span className="wv-num">{d.getDate()}</span>
            </div>
            <div className="wv-events">
              {dayEvents.map(ev => (
                <button key={ev.id} className="wv-event" style={{ '--cc': catColor(ev.category) }}
                  onClick={e => { e.stopPropagation(); onEvent(ev); }}>
                  {ev.start_time && <span className="wv-event-time">{fmtTime(ev.start_time)}</span>}
                  <span className="wv-event-title">{ev.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Day view (vertical hours) ── */
function DayView({ cursor, events, onSlot, onEvent }) {
  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm
  const dayEvents = events.filter(ev => eventCoversDay(ev, cursor));
  const timed = dayEvents.filter(e => e.start_time);
  const allDay = dayEvents.filter(e => !e.start_time);

  return (
    <div className="dv">
      {allDay.length > 0 && (
        <div className="dv-allday">
          <span className="dv-allday-label">All day</span>
          <div className="dv-allday-events">
            {allDay.map(ev => (
              <button key={ev.id} className="dv-allday-ev" style={{ '--cc': catColor(ev.category) }} onClick={() => onEvent(ev)}>{ev.title}</button>
            ))}
          </div>
        </div>
      )}
      <div className="dv-grid">
        {hours.map(h => {
          const hourEvents = timed.filter(e => Number(e.start_time.split(':')[0]) === h);
          return (
            <div key={h} className="dv-hour" onClick={onSlot}>
              <span className="dv-time">{h % 12 || 12}{h < 12 ? 'am' : 'pm'}</span>
              <div className="dv-slot">
                {hourEvents.map(ev => (
                  <button key={ev.id} className="dv-event" style={{ '--cc': catColor(ev.category) }}
                    onClick={e => { e.stopPropagation(); onEvent(ev); }}>
                    <span className="dv-event-time">{fmtTime(ev.start_time)}{ev.end_time ? ` – ${fmtTime(ev.end_time)}` : ''}</span>
                    <span className="dv-event-title">{ev.title}</span>
                    {ev.location && <span className="dv-event-loc">{ev.location}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
