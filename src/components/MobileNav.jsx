import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { P, Icon } from '../lib/icons';
import { useSettings } from '../context/SettingsContext';
import { tapOpen, tapClose, tapSelect } from '../lib/haptics';
import './MobileNav.css';

/*
 * The phone's navigation: one glass button, bottom right, that pulls the menu
 * up from the bottom edge.
 *
 * It replaced a five-tab bar. A tab bar spends a permanent strip across the
 * foot of every screen to show four destinations, and Pillar has no four that
 * everyone agrees on — the pastor lives in Cares, the greeter in Guests, the
 * office in SMS. A single button costs almost no screen and opens all of them.
 *
 * Five destinations, one level. Trimmed deliberately: the rest of Pillar is
 * still there and still routed, it just is not on the phone's menu for now.
 *
 * Bottom right because that is where a thumb rests on a large phone.
 */

const ITEMS = [
  { to: '/',         icon: P.grid,     label: 'Home' },
  { to: '/cares',    icon: P.heart,    label: 'Cares' },
  { to: '/calendar', icon: P.calendar, label: 'Calendar' },
  { to: '/sms',      icon: P.chat,     label: 'SMS' },
  { settings: true,  icon: P.settings, label: 'Settings' },
];

export default function MobileNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { openSettings } = useSettings();

  const [open, setOpen] = useState(false);

  /* A menu that survives a route change is a menu nobody asked to keep. */
  useEffect(() => { setOpen(false); }, [pathname]);


  /* The page behind a sheet should not scroll under it. */
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const on = to => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  const pick = m => {
    tapSelect();
    setOpen(false);
    if (m.settings) { openSettings('general'); return; }
    navigate(m.to);
  };

  return (
    <>
      {open && (
        <div className="mn-scrim" onClick={() => setOpen(false)}>
          <nav className="mn-sheet" onClick={e => e.stopPropagation()} aria-label="Main">
            <span className="mn-grab" />

            <div className="mn-head">
              <h2 className="mn-title">Pillar</h2>
            </div>

            <div className="mn-list">
              {ITEMS.map(m => (
                <button
                  key={m.label}
                  className={`mn-row ${m.to && on(m.to) ? 'on' : ''}`}
                  onClick={() => pick(m)}
                  aria-current={m.to && on(m.to) ? 'page' : undefined}
                >
                  <span className="mn-row-ic"><Icon d={m.icon} size={21} /></span>
                  <span className="mn-row-name">{m.label}</span>
                  <Icon d={P.chevR} size={18} className="mn-row-go" />
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}

      <button
        className={`mn-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => { (o ? tapClose : tapOpen)(); return !o; })}
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <Icon d={open ? P.close : P.menu} size={26} />
      </button>
    </>
  );
}
