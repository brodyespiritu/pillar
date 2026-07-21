import { NavLink } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import './app.css';

const TABS = [
  { to: '/app',              label: 'Overview',    icon: P.grid,     end: true },
  { to: '/app/sermons',      label: 'Sermons',     icon: P.book },
  { to: '/app/media',        label: 'Media Page',  icon: P.folder },
  { to: '/app/announcements', label: 'News & Events', icon: P.announce },
  { to: '/app/live',         label: 'Live',        icon: P.radio },
  { to: '/app/notifications', label: 'Notifications', icon: P.chat },
  { to: '/app/settings',     label: 'App Settings', icon: P.settings },
];

export default function AppShell({ title, subtitle, actions, children }) {
  return (
    <div className="ap-wrap">
      <TopNav />
      <main className="ap-scroll">
        <div className="ap-container">
          <header className="ap-head">
            <div>
              <span className="ap-pill">Bethesda App</span>
              <h1 className="ap-title">{title}</h1>
              {subtitle && <p className="ap-subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="ap-head-actions">{actions}</div>}
          </header>

          <nav className="ap-tabs">
            {TABS.map(t => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `ap-tab ${isActive ? 'active' : ''}`}>
                <Icon d={t.icon} size={16} />{t.label}
              </NavLink>
            ))}
          </nav>

          {children}
        </div>
      </main>
    </div>
  );
}
