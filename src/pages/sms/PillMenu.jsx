import { useState, useRef, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';

/*
 * A pill that opens a short list — the composer's To and Type controls.
 *
 * Chosen over a row of chips because the bar has room for two controls, not
 * six: the congregation can have any number of groups, and they cannot all sit
 * on one line beside the send button.
 */
export default function PillMenu({ icon, value, options, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = options.find(o => o.key === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const away = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span className="pill-wrap" ref={box}>
      <button type="button" className={`pill ${open ? 'open' : ''}`} aria-label={ariaLabel}
        aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {icon && <Icon d={icon} size={15} />}
        {current?.label}
        {current?.badge != null && <em>{current.badge}</em>}
        <Icon d={P.chevron} size={14} className="pill-chev" />
      </button>
      {open && (
        <div className="pill-menu">
          {options.map(o => (
            <button key={o.key} type="button" className={`pill-item ${o.key === value ? 'on' : ''}`}
              onClick={() => { onChange(o.key); setOpen(false); }}>
              <span>{o.label}</span>
              {o.badge != null && <em>{o.badge}</em>}
              {o.key === value && <Icon d={P.check} size={15} />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
