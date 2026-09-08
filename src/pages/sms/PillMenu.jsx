import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { P, Icon } from '../../lib/icons';
import './PillMenu.css';

/*
 * A pill that opens a short list — the composer's To and Type controls, and the
 * care card's kind and category.
 *
 * Chosen over a row of chips because the bar has room for two controls, not
 * six: the congregation can have any number of groups, and they cannot all sit
 * on one line beside the send button.
 *
 * The list is rendered into a portal at the end of <body> rather than inside
 * the pill. Positioned normally it is a child of a panel that scrolls, and a
 * scrolling box clips whatever overflows it — so the menu was cut off by
 * whichever edge it happened to reach, and opening it the other way only moved
 * which options were unreachable. Out at body level nothing can clip it, and it
 * is placed against the pill's position on screen instead.
 */

const GAP = 8;      // between pill and menu
const EDGE = 12;    // nearest the menu may come to the window edge
const MIN = 140;    // below this, a side is not worth opening into

/*
 * Where the menu goes, given the pill's place on screen and the height of the
 * window. Pure, and exported, so the decision can be exercised directly instead
 * of only through a browser.
 *
 * A viewport height of 0 is a real case, not a guard against nonsense: some
 * embedded and hidden contexts report it, and every measurement derived from it
 * goes negative, which is what throws a menu off screen. There, it opens
 * downward at its natural height and lets the browser deal with it.
 */
export function placeMenu(r, vh) {
  const left = Math.round(r.left + r.width / 2);
  if (!vh) return { left, top: Math.round(r.bottom + GAP) };
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  /* Downward unless there is genuinely not room, in which case whichever side
     is roomier. Either way the height is capped to what is actually there, so
     the menu scrolls rather than running off screen. */
  const up = below < MIN && above > below;
  return {
    left,
    top: up ? undefined : Math.round(r.bottom + GAP),
    bottom: up ? Math.round(vh - r.top + GAP) : undefined,
    maxHeight: Math.max(MIN, Math.round(up ? above : below)),
  };
}

export default function PillMenu({ icon, value, options, onChange, ariaLabel, placeholder = '', className = '', menuClass = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  const menu = useRef(null);
  /*
   * With a placeholder there is a real "nothing chosen yet" state, so an unknown
   * value must not silently fall back to the first option — that would show a
   * category the person never picked and read as though they had.
   */
  const current = options.find(o => o.key === value) || (placeholder ? null : options[0]);

  /* Placed before paint, so it never appears in the wrong spot and jumps. */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }

    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.visualViewport?.height
        || window.innerHeight
        || document.documentElement?.clientHeight
        || 0;
      setPos(placeMenu(r, vh));
    };

    place();
    /* Capture phase: the panel behind scrolls, not the window. */
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    /* The menu is no longer inside the pill, so closing on an outside click has
       to count it as inside — otherwise mousedown closed the menu and the click
       that would have chosen an option never landed on anything. */
    const away = e => {
      if (box.current?.contains(e.target) || menu.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span className="pill-wrap" ref={box}>
      <button type="button" className={`pill ${open ? 'open' : ''} ${className}`} aria-label={ariaLabel}
        aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {icon && <Icon d={icon} size={15} />}
        {current ? current.label : placeholder}
        {current?.badge != null && <em>{current.badge}</em>}
        <Icon d={P.chevron} size={14} className="pill-chev" />
      </button>

      {open && pos && createPortal(
        <div ref={menu} className={`pill-menu ${menuClass}`}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}>
          {options.map(o => (
            <button key={o.key} type="button" className={`pill-item ${o.key === value ? 'on' : ''}`}
              onClick={() => { onChange(o.key); setOpen(false); }}>
              <span>{o.label}</span>
              {o.badge != null && <em>{o.badge}</em>}
              {o.key === value && <Icon d={P.check} size={15} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
