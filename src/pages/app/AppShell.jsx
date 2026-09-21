import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { getLivestream } from '../../lib/appApi';
import { liveUpdatesReady } from '../../lib/appRefresh';
import './appx.css';

// Pillar → App: Pillar's top bar, then the app's pages down the side in the order members meet
// them, then the page. Every page edits in place and saves as you go, so there is nothing to
// "publish" (kit.jsx). Pillar's own blue theme, with room to breathe (appx.css).
export const PAGES = [
  { to: '/app/home',          label: 'Home',          icon: P.home },
  { to: '/app/bulletin',      label: 'Bulletin',      icon: P.announce },
  { to: '/app/groups',        label: 'Groups',        icon: P.users },
  { to: '/app/watch',         label: 'Watch',         icon: P.play },
  { to: '/app/live',          label: 'Live',          icon: P.radio, live: true },
  { to: '/app/notifications', label: 'Notifications', icon: P.chat },
  { to: '/app/settings',      label: 'Settings',      icon: P.settings },
];

// shared across pages, so moving between them doesn't ask the server again
let liveNow = null;
let instant = null;

export default function AppShell({ title, subtitle, actions, children }) {
  const [live, setLive] = useState(liveNow);
  const [ready, setReady] = useState(instant);

  useEffect(() => {
    let alive = true;
    const check = () => getLivestream()
      .then((l) => { liveNow = !!l?.isLive; if (alive) setLive(liveNow); })
      .catch(() => {});
    check();
    const t = setInterval(check, 60000);
    if (instant === null) liveUpdatesReady().then((ok) => { instant = ok; if (alive) setReady(ok); });
    // the Live page says so the moment it changes
    const onLive = (e) => { liveNow = !!e.detail; setLive(liveNow); };
    window.addEventListener('pillar-app-live', onLive);
    return () => { alive = false; clearInterval(t); window.removeEventListener('pillar-app-live', onLive); };
  }, []);

  return (
    <div className="ax ax-wrap">
      <div className="ax-top"><TopNav /></div>
      <aside className="ax-side">
        <div className="ax-side-title">Bethesda App</div>
        <nav className="ax-nav" aria-label="App pages">
          {PAGES.map((p) => (
            <NavLink key={p.to} to={p.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon d={p.icon} size={19} />{p.label}
              {p.live && live ? <span className="ax-nav-live">LIVE</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="ax-side-foot">
          <span className={`ax-dot ${ready ? 'on' : ''}`} />
          <span>
            {ready === null ? 'Checking the connection to phones…'
              : ready ? 'Changes reach open phones within a second or two.'
              : 'Changes reach phones the next time the page is opened. (Run app-live-updates.sql for instant updates.)'}
          </span>
        </div>
      </aside>
      <main className="ax-main">
        <div className="ax-page">
          <header className="ax-head">
            <div>
              <h1 className="ax-title">{title}</h1>
              {subtitle ? <p className="ax-sub">{subtitle}</p> : null}
            </div>
            {actions ? <div className="ax-head-actions">{actions}</div> : null}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
