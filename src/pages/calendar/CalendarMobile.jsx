import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  iso, parseISO, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek,
  isToday, catColor, fmtTime,
} from '../../lib/calendar';
import { tapOpen, tapClose, tapSelect } from '../../lib/haptics';
import './CalendarMobile.css';

/*
 * The calendar on a phone, in the shape iOS users already know: one continuous
 * scroll of months rather than a pager, each month opening with its name in
 * large type, hairlines between the weeks, and today as a filled disc.
 *
 * The desktop page is a fixed month with a toolbar above it. That works with a
 * mouse and a wide window; on a phone it means a control strip eating the top
 * of a screen that is mostly grid. Here the controls collapse to two floating
 * pills and everything else is calendar.
 */

const WEEK_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* How far the scroll runs. Far enough that nobody hits the end in normal use,
 * short enough that the whole thing is one cheap render. */
const MONTHS_BACK = 6;
const MONTHS_AHEAD = 18;

/* Weeks that actually contain a day of this month. Days either side render as
 * blanks, the way iOS leaves them, so a month reads as its own block. */
function monthWeeks(month) {
  const last = endOfMonth(month);
  const weeks = [];
  for (let cur = startOfWeek(startOfMonth(month)); cur <= last; cur = addDays(cur, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
  }
  return weeks;
}

export default function CalendarMobile({ events, onOpenEvent, onAddEvent }) {
  const scroller = useRef(null);
  const todayRef = useRef(null);
  const [heading, setHeading] = useState(() => new Date());
  const [day, setDay] = useState(null);       // ISO string of the open day sheet
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState('');

  const months = useMemo(() => {
    const first = addMonths(startOfMonth(new Date()), -MONTHS_BACK);
    return Array.from({ length: MONTHS_BACK + MONTHS_AHEAD + 1 }, (_, i) => addMonths(first, i));
  }, []);

  /* One pass over the events rather than a lookup per cell. A run-away end_date
   * would otherwise spin here, so the span is capped at a year. */
  const byDay = useMemo(() => {
    const m = new Map();
    for (const ev of events || []) {
      if (!ev.start_date) continue;
      const start = parseISO(ev.start_date);
      const end = ev.end_date ? parseISO(ev.end_date) : start;
      let cur = start;
      for (let n = 0; cur <= end && n < 366; n += 1, cur = addDays(cur, 1)) {
        const k = iso(cur);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(ev);
      }
    }
    for (const list of m.values()) {
      list.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    }
    return m;
  }, [events]);

  /* Open on today rather than at the top of the range. */
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  /* The pill names whichever month is under the top edge. */
  useEffect(() => {
    const root = scroller.current;
    if (!root) return undefined;
    const io = new IntersectionObserver(
      entries => {
        const top = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.dataset.month) setHeading(parseISO(top.target.dataset.month));
      },
      { root, rootMargin: '-64px 0px -75% 0px', threshold: 0 },
    );
    root.querySelectorAll('[data-month]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [months]);

  const goToday = useCallback(() => {
    tapSelect();
    todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return (events || [])
      .filter(e => [e.title, e.location, e.category].filter(Boolean)
        .some(v => String(v).toLowerCase().includes(needle)))
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      .slice(0, 40);
  }, [events, q]);

  return (
    <div className="mcal-wrap">

      {/* ── Floating controls ── */}
      <div className="mcal-bar">
        <button className="mcal-pill mcal-year" onClick={goToday}>
          <Icon d={P.chevL} size={19} />
          <span>{heading.getFullYear()}</span>
        </button>
        <div className="mcal-pill mcal-tools">
          <button onClick={() => { setFinding(f => !f); setQ(''); }} aria-label="Search events">
            <Icon d={finding ? P.close : P.search} size={20} />
          </button>
          <span className="mcal-tools-rule" />
          <button onClick={() => onAddEvent(iso(new Date()))} aria-label="Add an event">
            <Icon d={P.plus} size={21} />
          </button>
        </div>
      </div>

      {finding && (
        <div className="mcal-find">
          <div className="mcal-find-field">
            <Icon d={P.search} size={18} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search events"
              /* eslint-disable-next-line jsx-a11y/no-autofocus */
              autoFocus
              aria-label="Search events"
            />
          </div>
          {q.trim() && (
            <div className="mcal-find-list">
              {hits.length === 0 && <p className="mcal-find-empty">Nothing matches “{q.trim()}”.</p>}
              {hits.map(ev => (
                <button key={ev.id} className="mcal-find-row" onClick={() => { setFinding(false); onOpenEvent(ev); }}>
                  <span className="mcal-find-dot" style={{ background: catColor(ev.category) }} />
                  <span className="mcal-find-txt">
                    <span className="mcal-find-name">{ev.title}</span>
                    <span className="mcal-find-sub">
                      {parseISO(ev.start_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {ev.start_time ? ` · ${fmtTime(ev.start_time)}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Weekday header, fixed above the scroll ── */}
      <div className="mcal-dow">
        {WEEK_INITIALS.map((d, i) => <span key={i}>{d}</span>)}
      </div>

      {/* ── The months ── */}
      <div className="mcal-scroll" ref={scroller}>
        {months.map(month => (
          <section key={iso(month)} className="mcal-month" data-month={iso(month)}>
            <h2 className="mcal-month-h">
              {month.toLocaleDateString('en-US', { month: 'long' })}
              {month.getFullYear() !== new Date().getFullYear() && (
                <span className="mcal-month-y"> {month.getFullYear()}</span>
              )}
            </h2>

            {monthWeeks(month).map((week, wi) => (
              <div key={wi} className="mcal-week">
                {week.map(d => {
                  const inMonth = d.getMonth() === month.getMonth();
                  if (!inMonth) return <div key={iso(d)} className="mcal-cell blank" />;

                  const key = iso(d);
                  const list = byDay.get(key) || [];
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  const today = isToday(d);

                  return (
                    <button
                      key={key}
                      className={`mcal-cell ${weekend ? 'wknd' : ''}`}
                      ref={today ? undefined : undefined}
                      onClick={() => { tapOpen(); setDay(key); }}
                    >
                      <span className={`mcal-num ${today ? 'today' : ''}`}>{d.getDate()}</span>
                      <span className="mcal-chips">
                        {list.slice(0, 2).map(ev => (
                          <span
                            key={ev.id}
                            className="mcal-chip"
                            style={{ background: `${catColor(ev.category)}4D` }}
                          >
                            <span className="mcal-chip-t">{ev.title}</span>
                          </span>
                        ))}
                        {list.length > 2 && <span className="mcal-more">+{list.length - 2}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Anchor for "scroll to today", placed on the month rather than the
                cell so the month name stays in view above it. */}
            {month.getMonth() === new Date().getMonth()
              && month.getFullYear() === new Date().getFullYear()
              && <span ref={todayRef} className="mcal-anchor" />}
          </section>
        ))}
      </div>

      {/* ── Today, bottom left. The menu button owns bottom right. ── */}
      <button className="mcal-today-btn" onClick={goToday}>Today</button>

      {day && (
        <DaySheet
          dayIso={day}
          events={byDay.get(day) || []}
          onClose={() => setDay(null)}
          onOpenEvent={ev => { setDay(null); onOpenEvent(ev); }}
          onAdd={() => { const d = day; setDay(null); onAddEvent(d); }}
        />
      )}
    </div>
  );
}

/* ── One day's events, up from the bottom ── */
function DaySheet({ dayIso, events, onClose, onOpenEvent, onAdd }) {
  const d = parseISO(dayIso);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') { tapClose(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div className="mcal-scrim" onClick={onClose}>
      <div className="mcal-sheet" onClick={e => e.stopPropagation()} role="dialog">
        <span className="mcal-grab" />
        <div className="mcal-sheet-head">
          <h2 className="mcal-sheet-h">
            {d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
          <button className="mcal-sheet-add" onClick={() => { tapSelect(); onAdd(); }} aria-label="Add an event">
            <Icon d={P.plus} size={21} />
          </button>
        </div>

        {events.length === 0 ? (
          <p className="mcal-sheet-empty">Nothing scheduled.</p>
        ) : (
          <div className="mcal-sheet-list">
            {events.map(ev => (
              <button key={ev.id} className="mcal-ev" onClick={() => onOpenEvent(ev)}>
                <span className="mcal-ev-bar" style={{ background: catColor(ev.category) }} />
                <span className="mcal-ev-txt">
                  <span className="mcal-ev-name">{ev.title}</span>
                  <span className="mcal-ev-sub">
                    {ev.start_time ? fmtTime(ev.start_time) : 'All day'}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </span>
                </span>
                <Icon d={P.chevR} size={18} className="mcal-ev-go" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
