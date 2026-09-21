/*
 * Chrome for the Website module — mirrors app/AppShell.jsx so the two admin
 * areas feel like one product. Tabs are one per website page; the ones with no
 * editor yet are rendered disabled rather than hidden, so it is obvious the
 * section exists and is coming rather than looking like it was forgotten.
 */
import { NavLink } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { WEBSITE_PAGES } from '../../lib/websiteContent';
import '../app/app.css';
import './website.css';

// One source of truth for the page list — WEBSITE_PAGES in lib/websiteContent.js.
// `ready:false` entries render disabled rather than hidden, so it is clear the
// section exists and is coming rather than looking forgotten.
const ICONS = { home: P.grid, about: P.doc, newhere: P.users, team: P.users, give: P.announce, daycare: P.folder };
const TABS = WEBSITE_PAGES.map(pg => ({
  to: pg.key === 'home' ? '/website' : `/website/${pg.key}`,
  label: pg.name,
  icon: ICONS[pg.key] || P.doc,
  end: pg.key === 'home',
  ready: pg.ready,
}));

export default function WebsiteShell({ title, subtitle, actions, children }) {
  return (
    <div className="ap-wrap">
      <TopNav />
      <main className="ap-scroll">
        <div className="ap-container wb-mod">
          <header className="ap-head">
            <div>
              <span className="ap-pill">Website</span>
              <h1 className="ap-title">{title}</h1>
              {subtitle && <p className="ap-subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="ap-head-actions">{actions}</div>}
          </header>

          <nav className="ap-tabs">
            {TABS.map(t => t.ready ? (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `ap-tab ${isActive ? 'active' : ''}`}>
                <Icon d={t.icon} size={16} />{t.label}
              </NavLink>
            ) : (
              <span key={t.to} className="ap-tab wb-tab-soon" title="Editor not built yet">
                <Icon d={t.icon} size={16} />{t.label}
              </span>
            ))}
          </nav>

          {children}
        </div>
      </main>
    </div>
  );
}
