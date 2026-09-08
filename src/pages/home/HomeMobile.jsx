import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import { useGlobalSearch } from '../../lib/globalSearch';
import { parseISO } from '../../lib/calendar';
import { tapSelect } from '../../lib/haptics';
import './HomeMobile.css';

/*
 * The home screen on a phone.
 *
 * Built around one question — what needs doing today — rather than the desktop
 * page's grid of every module. The order is deliberate: who is waiting on you,
 * then the places you go most, then the week ahead.
 *
 * Everything is sized for a congregation that skews older: 17px body copy,
 * 72px list rows, nothing smaller than a 48px tap target.
 */

/* Tinted icon wells, in the order they appear. Colours are set in the
 * stylesheet by index so a re-order here does not need a CSS edit. */
const ACTIONS = [
  { key: 'cares',    to: '/cares',    icon: P.heart,    label: 'Cares' },
  { key: 'sms',      to: '/sms',      icon: P.chat,     label: 'SMS' },
  { key: 'calendar', to: '/calendar', icon: P.calendar, label: 'Calendar' },
  { key: 'members',  to: '/members',  icon: P.person,   label: 'Members' },
];


const initialsOf = name => (name || '')
  .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'P';

/* "2:30 PM" from a "14:30:00" column, without dragging in a date library. */
function clockOf(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

export default function HomeMobile({
  greeting, firstName, profile, care, memberCount, events,
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const search = useGlobalSearch(q);
  const hits = search ? [...search.current, ...search.across] : [];

  /* One prompt, not a wall of them. The guest prompt came out with Guests
   * itself — a prompt is only useful if it leads somewhere on the menu. */
  const prompt = useMemo(() => {
    if (care?.active) {
      return {
        to: '/cares', icon: P.heart,
        text: `${care.active} ${care.active === 1 ? 'person' : 'people'} in your care`,
      };
    }
    return { to: '/cares', icon: P.check, text: 'Nothing is waiting on you', calm: true };
  }, [care]);

  /* The next seven days, soonest first. */
  const upcoming = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setDate(end.getDate() + 7);
    return (events || [])
      .filter(e => { const d = parseISO(e.start_date); return d >= today && d < end; })
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))
        || String(a.start_time || '').localeCompare(String(b.start_time || '')))
      .slice(0, 4);
  }, [events]);


  const goSearch = item => { setQ(''); navigate(item.to, item.state ? { state: item.state } : undefined); };
  const onSubmit = e => { e.preventDefault(); if (hits.length) goSearch(hits[0]); };

  return (
    <div className="hm-wrap">
      <main className="hm-scroll">

        {/* ── Hero. Full-bleed so it meets the phone's status bar; in the native
            shell that band is the same grey-blue this gradient starts on. ── */}
        <header className="hm-hero">
          <div className="hm-hero-row">
            {/* Whose phone this is, not a control. Settings is not on the phone
                app, so a button that opened it would lead nowhere. */}
            <span className="hm-avatar" aria-hidden="true">{initialsOf(profile?.name)}</span>
          </div>

          <h1 className="hm-greet">{greeting},<br />{firstName}</h1>

          <form className="hm-search" onSubmit={onSubmit}>
            <Icon d={P.search} size={20} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setQ('')}
              placeholder="Search people, events, pages"
              autoComplete="off"
              aria-label="Search Pillar"
            />
            {q && (
              <button type="button" className="hm-search-x" onClick={() => setQ('')} aria-label="Clear search">
                <Icon d={P.close} size={17} />
              </button>
            )}
          </form>

          {search && (
            <>
              <div className="hm-search-backdrop" onClick={() => setQ('')} />
              <div className="hm-search-menu">
                {search.loading && <p className="hm-search-empty">Searching…</p>}
                {hits.slice(0, 8).map((r, i) => (
                  <button type="button" key={i} className="hm-search-item" onClick={() => goSearch(r)}>
                    <span className="hm-search-ic"><Icon d={r.icon} size={19} /></span>
                    <span className="hm-search-txt">
                      <span className="hm-search-name">{r.name}</span>
                      <span className="hm-search-sub">{r.sub}</span>
                    </span>
                  </button>
                ))}
                {!search.loading && hits.length === 0 && (
                  <p className="hm-search-empty">No results for “{q.trim()}”.</p>
                )}
              </div>
            </>
          )}
        </header>

        <div className="hm-body">

          {/* ── What is waiting on you ── */}
          <button
            className={`hm-prompt ${prompt.calm ? 'calm' : ''}`}
            onClick={() => { tapSelect(); navigate(prompt.to); }}
          >
            <span className="hm-prompt-ic"><Icon d={prompt.icon} size={21} /></span>
            <span className="hm-prompt-txt">{prompt.text}</span>
            <Icon d={P.arrowRight} size={20} className="hm-prompt-go" />
          </button>


          {/* ── Quick actions ── */}
          <h2 className="hm-h">Quick actions</h2>
          <div className="hm-chips">
            {ACTIONS.map((a, i) => (
              <button
                key={a.key}
                className={`hm-chip t${i % 6}`}
                onClick={() => { tapSelect(); navigate(a.to); }}
              >
                <span className="hm-chip-ic"><Icon d={a.icon} size={28} /></span>
                <span className="hm-chip-label">{a.label}</span>
              </button>
            ))}
          </div>

          {/* ── The week ahead ── */}
          <h2 className="hm-h">This week</h2>
          {upcoming.length ? (
            <div className="hm-card-list">
              {upcoming.map(ev => {
                const d = parseISO(ev.start_date);
                const time = clockOf(ev.start_time);
                return (
                  <button key={ev.id} className="hm-row" onClick={() => navigate('/calendar')}>
                    <span className="hm-date">
                      <span className="hm-date-d">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span className="hm-date-n">{d.getDate()}</span>
                    </span>
                    <span className="hm-row-txt">
                      <span className="hm-row-name">{ev.title}</span>
                      <span className="hm-row-sub">
                        {[time, ev.location].filter(Boolean).join(' · ') || 'All day'}
                      </span>
                    </span>
                    <Icon d={P.chevR} size={18} className="hm-row-go" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="hm-empty">Nothing on the calendar for the next seven days.</p>
          )}

          <p className="hm-foot">
            Bethesda Baptist Church{memberCount ? ` · ${memberCount} members` : ''}
          </p>
        </div>
      </main>
    </div>
  );
}
