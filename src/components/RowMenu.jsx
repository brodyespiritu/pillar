import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { P, Icon } from '../lib/icons';
import './RowMenu.css';

/*
 * The three dots at the end of a table row, and the short list of what can be
 * done to that row.
 *
 * The list is rendered into a portal at the end of <body>, for the reason
 * PillMenu's is: the table sits in a box with overflow hidden (that is what
 * rounds its corners), and a list inside it was cut off at the box's edge. Out
 * at body level it is placed against the button instead: right edges lined up,
 * so it opens in from the end of the row, and upward when the row is too near
 * the bottom of the window for it to fit below.
 *
 * items: [{ key, label, icon, onSelect, danger }]; a falsy entry is skipped, so
 * a caller can write `cond && { … }` in the list.
 */

const GAP = 6;     // between the button and the list
const EDGE = 12;   // nearest the list may come to the window edge

/* Pure, and exported, so the placement can be checked without a browser. A
   window height of 0 (some embedded contexts report it) opens downward. */
export function placeRowMenu(r, menuHeight, vw, vh) {
  const right = Math.max(EDGE, Math.round(vw - r.right));
  if (!vh) return { right, top: Math.round(r.bottom + GAP) };
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  return menuHeight > below && above > below
    ? { right, bottom: Math.round(vh - r.top + GAP) }
    : { right, top: Math.round(r.bottom + GAP) };
}

export default function RowMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const focused = useRef(false);
  const shown = items.filter(Boolean);

  /* Measured and placed before paint: the list is rendered hidden first, so its
     real height decides whether it fits below. */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      setPos(placeRowMenu(
        r,
        list.current?.offsetHeight || 0,
        document.documentElement?.clientWidth || window.innerWidth,
        window.innerHeight || document.documentElement?.clientHeight || 0,
      ));
    };
    place();
    /* Capture phase: the page's own scroller moves, not the window. */
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  /* The first item takes focus once, when the list appears, so the arrow keys
     work straight away. */
  useEffect(() => {
    if (!open) { focused.current = false; return; }
    if (pos && !focused.current) {
      focused.current = true;
      list.current?.querySelector('[role="menuitem"]')?.focus();
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return undefined;
    /* The list is not inside the button, so a press on it has to count as
       inside too, or the click that picks an item would close it first. */
    const away = e => {
      if (btn.current?.contains(e.target) || list.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function onKey(e) {
    const els = [...(list.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = els.indexOf(document.activeElement);
    const go = n => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  function pick(item) {
    setOpen(false);
    item.onSelect?.();
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`rm-btn ${open ? 'open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon d={P.more} size={18} />
      </button>

      {open && createPortal(
        <div
          ref={list}
          className="rm-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          style={pos || { top: 0, right: 0, visibility: 'hidden' }}
        >
          {shown.map(it => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`rm-item ${it.danger ? 'danger' : ''}`}
              onClick={() => pick(it)}
            >
              {it.icon && <Icon d={it.icon} size={16} />}
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
