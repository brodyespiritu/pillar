import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { getLivestream } from '../../lib/appApi';
import { liveUpdatesReady } from '../../lib/appRefresh';
import { Seg } from './kit';
import { WIDE, useAppFonts, useHotkeys } from './layout';
import './appx.css';

// Pillar → App: Pillar's top bar, then the app's pages down the side in the order members meet
// them, then the page. Every page edits in place and saves as you go, so there is nothing to
// "publish" (kit.jsx). Pillar's own blue theme (appx.css).
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §2) — room goes to the work, not the frame:
//   · the sidebar folds to a 72px rail of icons (its foot button, or the [ key), remembered in
//     localStorage['pillar.app.rail']; with no choice made it starts folded on any window too
//     narrow for the full sidebar AND the three panes (≤ 1415px — which takes in DESIGN's 1366)
//   · the page head is ONE compact row — title and one line on the left, the page's tabs on the
//     right — instead of a centred 38px title over big tabs (~230px of height back on every page)
//   · `fill`: the page is the window's height and only its panes scroll (layout.jsx Workspace)
//   · on a phone (≤ 767px) the sidebar goes and the pages are a strip that scrolls sideways, with
//     faded edges to say there's more (overflow affordance)
// A page's "New …" button sits at the top of the list it adds to, not up here.
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

export const RAIL_KEY = 'pillar.app.rail';
// the frame's widths (css/base.css): the full sidebar, and the page's side gutter
export const SIDE_W = 232;
export const PAGE_GUTTER = 22;
// With no choice saved, windows this wide or narrower start folded: the widest window on which the
// full sidebar would leave the workspace under WIDE, pushing the phone into a drawer. 1140 + 44 +
// 232 − 1 = 1415, so a 1440 window keeps the names and still shows list · editor · phone (the
// approved mockup), and a 1280 or 1366 laptop gets the rail and the same three panes. (DESIGN said
// 1366; between 1367 and 1415 the full sidebar cost the phone its column.)
export const RAIL_BELOW = WIDE + 2 * PAGE_GUTTER + SIDE_W - 1;

/** 'rail' | 'full' as saved, or null when nobody has chosen. */
export function savedRail() {
  try {
    const v = window.localStorage.getItem(RAIL_KEY);
    return v === 'rail' || v === 'full' ? v : null;
  } catch { return null; }
}
/** The sidebar to start with: what was chosen, else folded on a smaller window. */
export function startRail() {
  const saved = savedRail();
  if (saved) return saved;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  return w && w <= RAIL_BELOW ? 'rail' : 'full';
}
function saveRail(v) {
  try { window.localStorage.setItem(RAIL_KEY, v); } catch { /* private mode: it just isn't remembered */ }
}

const linkClass = ({ isActive }) => (isActive ? 'active' : '');

export default function AppShell({ title, subtitle, tabs, actions, children, fill = false }) {
  const [live, setLive] = useState(liveNow);
  const [ready, setReady] = useState(instant);
  const [rail, setRail] = useState(startRail);
  const strip = useRef(null);
  // the member app's fonts for the phone previews, fetched once an App page opens (layout.jsx)
  useAppFonts();

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

  // until someone chooses, the sidebar follows the window's width
  useEffect(() => {
    const onResize = () => { if (!savedRail()) setRail(startRail()); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const flip = useCallback(() => {
    setRail((r) => {
      const next = r === 'rail' ? 'full' : 'rail';
      saveRail(next);
      return next;
    });
  }, []);
  // [ folds and unfolds the sidebar. ⌘/Ctrl+S never opens the browser's own Save dialog in here:
  // everything already saves as you type, and an editor that registers mod+s saves on the spot.
  useHotkeys({ '[': flip, 'mod+s': () => {} });

  // on a phone, the page you're on is in view in the strip
  useEffect(() => {
    const el = strip.current;
    const on = el && el.querySelector ? el.querySelector('a.active') : null;
    if (on && el.scrollTo && el.clientWidth) el.scrollTo({ left: Math.max(0, on.offsetLeft - 16) });
  }, []);

  const folded = rail === 'rail';
  const connection = ready === null ? 'Checking the connection to phones…'
    : ready ? 'Changes reach open phones within a second or two.'
    : 'Changes reach phones the next time the page is opened. (Run app-live-updates.sql for instant updates.)';
  const nameOf = (p) => (p.live && live ? `${p.label} — live now` : p.label);
  const flipWord = folded ? 'Show page names' : 'Show only icons';

  return (
    <div className={`ax ax-wrap${folded ? ' rail' : ''}`}>
      <div className="ax-top"><TopNav /></div>
      <aside className="ax-side">
        <div className="ax-side-title">Bethesda App</div>
        <div className="ax-side-mark" aria-hidden="true">BA</div>
        <nav className="ax-nav" aria-label="App pages">
          {PAGES.map((p) => (
            <NavLink key={p.to} to={p.to} className={linkClass} aria-label={nameOf(p)} title={folded ? nameOf(p) : undefined}>
              <Icon d={p.icon} size={19} />
              <span className="ax-nav-label">{p.label}</span>
              {p.live && live ? <span className="ax-nav-live">LIVE</span> : null}
              {p.live && live ? <span className="ax-nav-dot" /> : null}
            </NavLink>
          ))}
        </nav>
        <div className="ax-side-foot">
          <div className="ax-side-status" title={folded ? connection : undefined}>
            <span className={`ax-dot ${ready ? 'on' : ''}`} />
            <span className="ax-side-status-text">{connection}</span>
          </div>
          {/* the same place folded or not, so it can be flipped back without moving (Fitts's law) */}
          <button type="button" className="ax-rail-toggle" onClick={flip} aria-pressed={folded}
            aria-label={flipWord} title={`${flipWord} ( [ )`}>
            <Icon d={folded ? P.chevR : P.chevL} size={20} />
            <span className="ax-rail-toggle-word">Fold the menu</span>
          </button>
        </div>
      </aside>
      <main className={`ax-main${fill ? ' fill' : ''}`}>
        <div className={`ax-page${fill ? ' fill' : ''}`}>
          <div className="ax-strip-wrap">
            <div className="ax-strip-cap">Bethesda App</div>
            <nav ref={strip} className="ax-strip" aria-label="App pages">
              {PAGES.map((p) => (
                <NavLink key={p.to} to={p.to} className={linkClass} aria-label={nameOf(p)}>
                  <Icon d={p.icon} size={17} />
                  <span>{p.label}</span>
                  {p.live && live ? <span className="ax-nav-dot" /> : null}
                </NavLink>
              ))}
            </nav>
          </div>
          {/* one row: what this page is on the left, its tabs on the right (they drop to a line of
              their own when the page is narrower than 760px) */}
          <header className={`ax-head${tabs ? ' has-tabs' : ''}`}>
            <div className="ax-head-text">
              <h1 className="ax-title">{title}</h1>
              {subtitle ? <p className="ax-sub" title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</p> : null}
            </div>
            {actions ? <div className="ax-head-actions">{actions}</div> : null}
            {tabs ? (
              <div className="ax-head-tabs">
                <Seg label={tabs.label || 'Show'} value={tabs.value} onChange={tabs.onChange} options={tabs.options} />
              </div>
            ) : null}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
