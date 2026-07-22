import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { P } from './icons';
import { fetchMembers } from './care';
import { fetchGuests, isProspect } from './guests';
import { fetchEvents } from './calendar';
import { fetchStaff } from './admin';

/* ── Global search index ──
   Shared by the top-nav search box and the home hero search so both
   behave identically: pages + live members/guests/events/staff records. */
export const PAGE_ENTRIES = [
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

/**
 * Global search hook. Lazily loads the searchable data the first time the
 * user types, then returns { current, across, loading } — or null when the
 * query is empty. `current` are results that live on the page you're already
 * on; `across` are everything else.
 */
export function useGlobalSearch(query) {
  const location = useLocation();
  const [index, setIndex] = useState(null);   // { members, guests, events, staff }

  useEffect(() => {
    if (!query.trim() || index) return;
    Promise.all([fetchMembers(), fetchGuests(), fetchEvents(), fetchStaff()])
      .then(([members, guests, events, staff]) => setIndex({ members, guests, events, staff }))
      .catch(() => setIndex({ members: [], guests: [], events: [], staff: [] }));
  }, [query, index]);

  return useMemo(() => {
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
}
