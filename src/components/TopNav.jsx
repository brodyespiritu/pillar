import { alertDialog } from "../lib/dialog";
import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { P, Icon } from '../lib/icons';
import { fetchMembers } from '../lib/care';
import { fetchGuests, isProspect } from '../lib/guests';
import { fetchEvents } from '../lib/calendar';
import { fetchStaff, normalizeRole } from '../lib/admin';
import './TopNav.css';

/* ── Global search index ── */
const PAGE_LABELS = {
  '/': 'Home', '/cares': 'Care List', '/guests': 'Guest List',
  '/calendar': 'Calendar', '/email': 'Email', '/admin': 'Admin',
};

const PAGE_ENTRIES = [
  { icon: P.heart,    name: 'Care List',      sub: 'Pastoral care & visits',   to: '/cares',    kw: 'cares pastoral members' },
  { icon: P.users,    name: 'Guest List',     sub: 'Visitors & prospects',     to: '/guests',   kw: 'guests prospects visitors' },
  { icon: P.calendar, name: 'Calendar',       sub: 'Events & schedule',        to: '/calendar', kw: 'events schedule' },
  { icon: P.mail,     name: 'Email',          sub: 'Gmail / Yahoo inbox',      to: '/email',    kw: 'inbox mail compose' },
  { icon: P.shield,   name: 'Admin Dashboard', sub: 'Staff, settings & tools', to: '/admin',    kw: 'admin staff settings' },
  { icon: P.person,   name: 'Users',          sub: 'Admin · staff management', to: '/admin', state: { tab: 'users' },   kw: 'staff roles pins' },
  { icon: P.clock,    name: 'Time Off',       sub: 'Admin · PTO & requests',   to: '/admin', state: { tab: 'timeoff' }, kw: 'pto vacation requests' },
  { icon: P.layers,   name: 'Merge Tool',     sub: 'Admin · deduplicate care', to: '/admin', state: { tab: 'data' },    kw: 'duplicate merge change log audit' },
  { icon: P.announce, name: 'Reminders',      sub: 'Admin · follow-up emails', to: '/admin', state: { tab: 'email' },   kw: 'reminders automated scanner' },
  { icon: P.link,     name: 'Integrations',   sub: 'Admin · API tokens',       to: '/admin', state: { tab: 'tools' },   kw: 'canva token forms' },
];

const NAV_MENUS = {
  'My Church': {
    left: {
      heading: 'Ministry',
      items: [
        { icon: P.heart,  name: 'Care List',  sub: 'Track pastoral care & visits', to: '/cares', actions: ['Add Care Visit', 'Update Member', 'Edit Member', 'View All'] },
        { icon: P.users,  name: 'Guest List', sub: 'Manage visitors and guests', to: '/guests', actions: ['Add Guest', 'Send Welcome Email', 'Export List', 'View All'] },
        { icon: P.person, name: 'Members',    sub: 'Congregation directory', to: '/members', actions: ['Add Member', 'Edit Member', 'View All'] },
        { icon: P.shield, name: 'Admin',      sub: 'Dashboard & controls', to: '/admin', actions: ['View Dashboard', 'App Settings', 'Audit Log', 'View All'] },
      ],
    },
    right: { heading: 'Quick Actions', items: [
      { icon: P.form, name: 'Forms' }, { icon: P.folder, name: 'File Sharing' }, { icon: P.doc, name: 'Docs' },
    ] },
  },
  'Communications': {
    left: { heading: 'Messaging', items: [
      { icon: P.mail,     name: 'Email',        sub: 'Gmail / Yahoo inbox', to: '/email', actions: ['Compose Email', 'View Inbox', 'Connect Account', 'View All'] },
      { icon: P.chat,     name: 'SMS',          sub: 'Text the congregation', to: '/sms', actions: ['New Broadcast', 'Manage Contacts', 'Manage Groups', 'View All'] },
      { icon: P.announce, name: 'Announcements', sub: 'Media & scripts',       actions: ['New Announcement', 'Schedule Post', 'View Archive', 'View All'] },
      { icon: P.radio,    name: 'Director Hub', sub: 'Communications hub',     actions: ['Open Hub', 'Team Broadcast', 'Meeting Notes', 'View All'] },
    ] },
    right: { heading: 'Quick Actions', items: [{ icon: P.grid, name: 'Catalog' }, { icon: P.doc, name: 'Pillar' }] },
  },
  'Events': {
    left: { heading: 'Scheduling', items: [
      { icon: P.calendar, name: 'Calendar',     sub: 'Church schedule & events', to: '/calendar', actions: ['New Event', 'View This Week', 'Manage Recurring', 'View All'] },
      { icon: P.planner,  name: 'Services',     sub: 'Plan your Sunday service order', to: '/services', actions: ['Create flow', 'Edit flow', 'Send flow'] },
      { icon: P.form,     name: 'Registration', sub: 'Event sign-ups and forms', actions: ['New Form', 'View Submissions', 'Export Data', 'View All'] },
    ] },
    right: { heading: 'Quick Actions', items: [{ icon: P.users, name: 'Attendees' }, { icon: P.grid, name: 'Reports' }] },
  },
  'Content': {
    left: { heading: 'Media', items: [
      { icon: P.book,   name: 'Sermon Pro',   sub: 'Build and publish sermons', actions: ['New Sermon', 'Upload Video', 'Manage Series', 'View All'] },
      { icon: P.folder, name: 'File Sharing', sub: 'Staff files and resources', actions: ['Upload File', 'Create Folder', 'Share Link', 'View All'] },
      { icon: P.doc,    name: 'Docs',         sub: 'Document editor',           actions: ['New Document', 'Recent Files', 'Shared With Me', 'View All'] },
    ] },
    right: { heading: 'Quick Actions', items: [{ icon: P.grid, name: 'Catalog' }, { icon: P.form, name: 'Forms' }] },
  },
  'App': {
    left: { heading: 'Bethesda Mobile App', items: [
      { icon: P.grid,     name: 'Overview',      sub: 'Live status & content counts', to: '/app' },
      { icon: P.book,     name: 'Sermons',       sub: 'Sermon library',               to: '/app/sermons' },
      { icon: P.folder,   name: 'Media Page',    sub: 'Curate the app’s Media tab',   to: '/app/media' },
      { icon: P.announce, name: 'News & Events', sub: 'Announcements and events',     to: '/app/announcements' },
      { icon: P.radio,    name: 'Live',          sub: 'Livestream & live cards',      to: '/app/live' },
      { icon: P.chat,     name: 'Notifications', sub: 'Push to every device',         to: '/app/notifications' },
      { icon: P.settings, name: 'App Settings',  sub: 'Church info & hero media',     to: '/app/settings' },
    ] },
    right: { heading: 'Quick Actions', items: [{ icon: P.radio, name: 'Go Live' }, { icon: P.chat, name: 'Send Notification' }] },
  },
};

export default function TopNav({ onNewClick }) {
  const { profile, signOut } = useAuth();
  const { openSettings } = useSettings();
  const isAdmin = normalizeRole(profile?.role) === 'Admin';
  const navigate = useNavigate();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);   // { members, guests, events, staff }
  const leaveTimer = useRef(null);

  // Lazy-load searchable data the first time the user types
  useEffect(() => {
    if (!query.trim() || index) return;
    Promise.all([fetchMembers(), fetchGuests(), fetchEvents(), fetchStaff()])
      .then(([members, guests, events, staffList]) => setIndex({ members, guests, events, staff: staffList }))
      .catch(() => setIndex({ members: [], guests: [], events: [], staff: [] }));
  }, [query, index]);

  const search = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const has = (...vals) => vals.filter(Boolean).some(v => String(v).toLowerCase().includes(q));

    const items = [];
    PAGE_ENTRIES.forEach(p => {
      if (has(p.name, p.sub, p.kw)) items.push({ ...p, module: p.to, kind: 'page' });
    });
    (index?.members || []).forEach(m => {
      if (has(m.full_name, m.category, m.care_notes)) items.push({
        icon: P.heart, name: m.full_name, sub: `Care member · ${m.category}`, to: '/cares', state: { openMember: m.id }, module: '/cares',
      });
    });
    (index?.guests || []).forEach(g => {
      if (has(g.full_name, g.type, g.email, g.phone)) items.push({
        icon: P.users, name: g.full_name, sub: `Guest · ${g.type}`, to: '/guests', state: { q: g.full_name, prospect: isProspect(g) }, module: '/guests',
      });
    });
    (index?.events || []).forEach(e => {
      if (has(e.title, e.category, e.location)) items.push({
        icon: P.calendar, name: e.title, sub: `Event · ${e.start_date}`, to: '/calendar', state: { openEvent: e.id, date: e.start_date }, module: '/calendar',
      });
    });
    (index?.staff || []).forEach(s => {
      if (has(s.name, s.email, s.role)) items.push({
        icon: P.person, name: s.name, sub: `Staff · ${s.role || 'Staff'}`, to: '/admin', state: { tab: 'users', q: s.name }, module: '/admin',
      });
    });

    const here = location.pathname;
    // A page-link pointing at the page you're already on is useless — drop it
    const useful = items.filter(i => !(i.kind === 'page' && i.to === here && !i.state));
    const current = useful.filter(i => i.module === here).slice(0, 5);
    const across  = useful.filter(i => !current.includes(i)).slice(0, 7);
    return { current, across, loading: !index };
  }, [query, index, location.pathname]);

  function goSearch(item) {
    setQuery('');
    navigate(item.to, item.state ? { state: item.state } : undefined);
  }

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const openNav  = label => { clearTimeout(leaveTimer.current); if (NAV_MENUS[label]) { setOpenMenu(label); setHoveredItem(null); } };
  const closeNav = ()    => { leaveTimer.current = setTimeout(() => { setOpenMenu(null); setHoveredItem(null); }, 120); };
  const keepNav  = ()    => clearTimeout(leaveTimer.current);

  const go = item => {
    setOpenMenu(null);
    if (item.to) navigate(item.to);
  };

  return (
    <>
      {openMenu && <div className="tn-backdrop" />}
      <header className="tn-nav" onClick={e => e.stopPropagation()}>
        <div className="tn-logo" onClick={() => navigate('/')}>
          <svg className="tn-logo-bars" viewBox="0 0 62 48" aria-hidden="true">
            <rect x="8"  y="5" width="15" height="38" rx="7.5" transform="rotate(18 15.5 24)" fill="currentColor" />
            <rect x="29" y="5" width="15" height="38" rx="7.5" transform="rotate(18 36.5 24)" fill="currentColor" />
          </svg>
          <span className="tn-logo-word">pillar</span>
        </div>

        <nav className="tn-links">
          {['My Church', 'Communications', 'Events', 'Content', ...(isAdmin ? ['App'] : []), 'Settings'].map(label => (
            <div key={label} className="tn-item"
              onMouseEnter={() => openNav(label)}
              onMouseLeave={closeNav}
            >
              <button
                className={`tn-link ${openMenu === label ? 'active' : ''}`}
                onClick={() => setOpenMenu(openMenu === label ? null : label)}
              >
                {label}
                {NAV_MENUS[label] && <Icon d={P.chevron} size={16} />}
              </button>

              {openMenu === label && NAV_MENUS[label] && (
                <div className="tn-dropdown" onMouseEnter={keepNav} onMouseLeave={closeNav}>
                  <div className="tn-col">
                    <p className="tn-heading">{NAV_MENUS[label].left.heading}</p>
                    {NAV_MENUS[label].left.items.map(item => (
                      <button key={item.name}
                        className={`tn-dd-item ${hoveredItem === item.name ? 'hovered' : ''}`}
                        onMouseEnter={() => setHoveredItem(item.name)}
                        onClick={() => go(item)}
                      >
                        <div className="tn-dd-icon"><Icon d={item.icon} size={24} /></div>
                        <div className="tn-dd-text">
                          <p className="tn-dd-name">{item.name}</p>
                          {item.sub && <p className="tn-dd-sub">{item.sub}</p>}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="tn-divider" />

                  <div className="tn-col right">
                    {(() => {
                      const active = NAV_MENUS[label].left.items.find(i => i.name === hoveredItem);
                      if (active?.actions) {
                        return (<>
                          <p className="tn-heading">{active.name}</p>
                          {active.actions.map(a => (
                            <button key={a} className="tn-action" onClick={() => {
                              setOpenMenu(null);
                              setHoveredItem(null);
                              if (!active.to) { alertDialog(`${active.name} — coming soon.`); return; }
                              const state = /\b(add|new|compose|create)\b/i.test(a) ? { add: true }
                                : /\bsend\b/i.test(a) ? { send: true } : undefined;
                              navigate(active.to, state ? { state } : undefined);
                            }}>
                              <Icon d={P.chevron} size={14} />{a}
                            </button>
                          ))}
                        </>);
                      }
                      return (<>
                        <p className="tn-heading">{NAV_MENUS[label].right.heading}</p>
                        {NAV_MENUS[label].right.items.map(item => (
                          <button key={item.name} className="tn-dd-item compact">
                            <div className="tn-dd-icon sm"><Icon d={item.icon} size={18} /></div>
                            <p className="tn-dd-name">{item.name}</p>
                          </button>
                        ))}
                      </>);
                    })()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="tn-search">
          <Icon d={P.search} size={16} />
          <input
            placeholder="Search…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setQuery('')}
          />

          {search && (
            <>
              <div className="tn-backdrop click" onClick={() => setQuery('')} />
              <div className="tn-search-menu">
                {search.loading && <p className="tn-search-empty">Searching…</p>}

                {search.current.length > 0 && (<>
                  <p className="tn-heading">In {PAGE_LABELS[location.pathname] || 'this page'}</p>
                  {search.current.map((r, i) => (
                    <button key={`c${i}`} className="tn-dd-item compact" onClick={() => goSearch(r)}>
                      <div className="tn-dd-icon sm"><Icon d={r.icon} size={18} /></div>
                      <div className="tn-dd-text">
                        <p className="tn-dd-name">{r.name}</p>
                        <p className="tn-dd-sub">{r.sub}</p>
                      </div>
                    </button>
                  ))}
                </>)}

                {search.across.length > 0 && (<>
                  <p className="tn-heading">Across Pillar</p>
                  {search.across.map((r, i) => (
                    <button key={`a${i}`} className="tn-dd-item compact" onClick={() => goSearch(r)}>
                      <div className="tn-dd-icon sm"><Icon d={r.icon} size={18} /></div>
                      <div className="tn-dd-text">
                        <p className="tn-dd-name">{r.name}</p>
                        <p className="tn-dd-sub">{r.sub}</p>
                      </div>
                    </button>
                  ))}
                </>)}

                {!search.loading && !search.current.length && !search.across.length && (
                  <p className="tn-search-empty">No results for "{query}".</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="tn-right">
          <div className="tn-profile">
            <button className={`tn-avatar ${profileOpen ? 'active' : ''}`} onClick={() => setProfileOpen(o => !o)}>{initials}</button>
            {profileOpen && (
              <>
                <div className="tn-backdrop click" onClick={() => setProfileOpen(false)} />
                <div className="tn-profile-menu">
                  <div className="tn-profile-head">
                    <span className="tn-profile-ava">{initials}</span>
                    <div className="tn-profile-id">
                      <span className="tn-profile-name">{profile?.name || 'Signed in'}</span>
                      {profile?.email && <span className="tn-profile-email">{profile.email}</span>}
                    </div>
                  </div>
                  <button className="tn-profile-item" onClick={() => { setProfileOpen(false); openSettings('general'); }}>
                    <Icon d={P.settings} size={17} />Settings
                  </button>
                  <div className="tn-profile-div" />
                  <button className="tn-profile-item danger" onClick={() => { setProfileOpen(false); signOut(); }}>
                    <Icon d={P.lock} size={17} />Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
