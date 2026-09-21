import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import TopNav from '../../components/TopNav';
import AttendanceFullScreen from './AttendanceFullScreen';
import { P, Icon } from '../../lib/icons';
import { fetchMembers, computeStats } from '../../lib/care';
import { fetchGuests, computeGuestStats } from '../../lib/guests';
import { fetchChurchMembers } from '../../lib/members';
import { fetchRecentReads, sampleHistory } from '../../lib/attendance';
import { fetchEvents, eventCoversDay } from '../../lib/calendar';
import { useGlobalSearch } from '../../lib/globalSearch';
import { useIsMobile } from '../../lib/useIsMobile';
import HomeMobile from './HomeMobile';
// TESTING — delete this line and AppReports.jsx/.css when the app's test kit goes
import AppReports from './AppReports';
import './HomePage.css';

export default function HomePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [members, setMembers] = useState([]);
  const [guests, setGuests]   = useState([]);
  const [events, setEvents]   = useState([]);
  const [memberCount, setMemberCount] = useState(0);
  const [history, setHistory] = useState(() => sampleHistory(6));
  const [mapOpen, setMapOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const [m, g, e] = await Promise.all([fetchMembers(), fetchGuests(), fetchEvents('church')]);
      setMembers(m); setGuests(g); setEvents(e);
      try { const cm = await fetchChurchMembers(); if (!cm.missing) setMemberCount(cm.rows.length); } catch { /* ignore */ }
      try { const real = await fetchRecentReads(6); if (real) setHistory(real); } catch { /* keep sample */ }
    })();
  }, []);

  const care   = useMemo(() => computeStats(members), [members]);
  const gstats = useMemo(() => computeGuestStats(guests), [guests]);
  const latest = history[history.length - 1] || { total: 0, capacity: 1 };
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const weekEvents = useMemo(() => events.filter(e => weekDays.some(d => eventCoversDay(e, d))).length, [events, weekDays]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.name?.split(' ')[0] ?? 'there';

  const MODULES = useMemo(() => [
    { key: 'cares',      title: 'Care List',  sub: 'Pastoral care & visits',   pill: care.active ? `${care.active} in care` : 'Care',          kw: 'care pastoral visits members', onClick: () => navigate('/cares') },
    { key: 'guests',     title: 'Guest List', sub: 'Visitors & prospects',     pill: gstats.prospects ? `${gstats.prospects} to follow up` : 'Guests', kw: 'guests visitors prospects front door', onClick: () => navigate('/guests') },
    { key: 'calendar',   title: 'Calendar',   sub: 'Events & schedule',        pill: weekEvents ? `${weekEvents} this week` : 'Schedule',      kw: 'calendar events schedule', onClick: () => navigate('/calendar') },
    { key: 'services',   title: 'Services',   sub: 'Plan your Sunday service', pill: 'Plan',                                                   kw: 'services sunday service plan flow', onClick: () => navigate('/services') },
    { key: 'email',      title: 'Email',      sub: 'Inbox & compose',          pill: 'Inbox',                                                  kw: 'email inbox compose mail', onClick: () => navigate('/email') },
    { key: 'sms',        title: 'SMS',        sub: 'Text the congregation',    pill: 'Broadcast',                                              kw: 'sms text broadcast message', onClick: () => navigate('/sms') },
    { key: 'members',    title: 'Members',    sub: 'Congregation directory',   pill: memberCount ? `${memberCount} members` : 'Directory',     kw: 'members directory congregation', onClick: () => navigate('/members') },
    { key: 'attendance', title: 'Attendance', sub: 'Worship-center map',       pill: latest.total ? `≈ ${latest.total} last time` : 'Map',     kw: 'attendance worship map heat', onClick: () => setMapOpen(true) },
    { key: 'admin',      title: 'Admin',      sub: 'Staff, settings & tools',  pill: 'Manage',                                                 kw: 'admin staff settings tools', onClick: () => navigate('/admin') },
  ], [care.active, gstats.prospects, weekEvents, memberCount, latest.total, navigate]);

  // Featured boxes honor the user's onboarding choice (preferences.home_featured); else default.
  const featured = useMemo(() => {
    const pick = profile?.preferences?.home_featured;
    const byKey = Object.fromEntries(MODULES.map(m => [m.key, m]));
    const chosen = Array.isArray(pick) ? pick.map(k => byKey[k]).filter(Boolean) : [];
    return chosen.length ? chosen.slice(0, 3) : MODULES.slice(0, 3);
  }, [MODULES, profile]);
  // Same global search as the top-nav bar: pages + live members/guests/events/staff.
  const search = useGlobalSearch(q);
  const hits = search ? [...search.current, ...search.across] : [];

  const goSearch = item => {
    setQ('');
    navigate(item.to, item.state ? { state: item.state } : undefined);
  };

  const onSubmit = e => {
    e.preventDefault();
    if (hits.length) goSearch(hits[0]);
  };

  if (isMobile) {
    return (
      <>
        <HomeMobile
          greeting={greeting} firstName={firstName} profile={profile}
          care={care}
          memberCount={memberCount} events={events}
        />
        {mapOpen && <AttendanceFullScreen onClose={() => setMapOpen(false)} />}
      </>
    );
  }

  return (
    <div className="hp2-wrap">
      <TopNav />
      <main className="hp2-scroll">

        {/* ── Hero ── */}
        <section className="hero">
          {/* TESTING — delete this line and AppReports.jsx/.css when the app's test kit goes */}
          <AppReports />
          <div className="hero-inner">
            <span className="hero-pill">Bethesda Baptist Church</span>
            <h1 className="hero-title">{greeting}, {firstName}</h1>
            <p className="hero-sub">
              Track pastoral care, welcome every guest, and keep your congregation
              connected — all from one place.
            </p>

            <form className="hero-search" onSubmit={onSubmit}>
              <Icon d={P.search} size={19} />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setQ('')}
                placeholder="Search people, guests, events, pages…"
                autoComplete="off"
              />
              {q && <button type="button" className="hero-search-x" onClick={() => setQ('')} aria-label="Clear"><Icon d={P.close} size={16} /></button>}

              {search && (
                <>
                  <div className="hero-search-backdrop" onClick={() => setQ('')} />
                  <div className="hero-search-menu">
                    {search.loading && <p className="hero-search-empty">Searching…</p>}
                    {hits.map((r, i) => (
                      <button type="button" key={i} className="hero-search-item" onClick={() => goSearch(r)}>
                        <span className="hero-search-ic"><Icon d={r.icon} size={18} /></span>
                        <span className="hero-search-txt">
                          <span className="hero-search-name">{r.name}</span>
                          <span className="hero-search-sub">{r.sub}</span>
                        </span>
                      </button>
                    ))}
                    {!search.loading && hits.length === 0 && (
                      <p className="hero-search-empty">No results for “{q.trim()}”.</p>
                    )}
                  </div>
                </>
              )}
            </form>

            <div className="hero-cards">
              {featured.map(m => <RoleCard key={m.key} module={m} pillLabel="Featured" />)}
            </div>
          </div>
        </section>

        {/* ── Open roles ── */}
        <section className="roles">
          <div className="roles-inner">
            <span className="roles-pill">Your church</span>
            <h2 className="roles-title">Everything in one place</h2>
            <p className="roles-sub">
              Jump into any part of Pillar — care, guests, services, messaging, and more.
            </p>

            <div className="roles-grid">
              {MODULES.map(m => <RoleCard key={m.key} module={m} light />)}
            </div>
          </div>
        </section>
      </main>

      {mapOpen && <AttendanceFullScreen onClose={() => setMapOpen(false)} />}
    </div>
  );
}

function RoleCard({ module: m, pillLabel, light }) {
  return (
    <button className={`rcard ${light ? 'light' : ''}`} onClick={m.onClick}>
      <span className="rcard-pill">{pillLabel || m.pill}</span>
      <span className="rcard-title">{m.title}</span>
      <span className="rcard-sub">{m.sub}</span>
      <span className="rcard-action">Open<Icon d={P.arrowRight} size={16} /></span>
    </button>
  );
}
