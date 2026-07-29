import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';

/*
 * Right-click menu, positioned at the cursor.
 *
 * `items` is a list of { icon, label, act, danger } — a falsy entry is skipped
 * so callers can inline conditionals (e.g. series-only actions).
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu on screen when opened near an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.min(x, window.innerWidth  - width  - pad),
      top:  Math.min(y, window.innerHeight - height - pad),
    });
  }, [x, y]);

  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose(); };
    // Scrolling the calendar underneath would leave the menu orphaned.
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const visible = items.filter(Boolean);

  return (
    <>
      <div className="cal-ctx-backdrop" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div ref={ref} className="cal-ctx" style={pos} role="menu">
        {visible.map(it => (
          <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''}
            onClick={() => { onClose(); it.act(); }}>
            <Icon d={it.icon || P.chevron} size={15} />{it.label}
          </button>
        ))}
      </div>
    </>
  );
}
