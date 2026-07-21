import { useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import { PALETTE, MUSICAL_KEYS, SERVICE_TIMES, makeBlock, nextId } from './blocks';
import { openServicePrint, downloadServicePdf, fmtServiceDate } from './serviceDoc';
import SendServiceModal from './SendServiceModal';
import './ServicePlanner.css';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function sundaysOfMonth(ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth();
  const out = [];
  const d = new Date(y, m, 1);
  while (d.getMonth() === m) { if (d.getDay() === 0) out.push(iso(new Date(d))); d.setDate(d.getDate() + 1); }
  return out;
}

export default function ServicePlanner() {
  const navigate = useNavigate();
  const location = useLocation();

  const sundays = useMemo(() => sundaysOfMonth(), []);
  const defaultSunday = useMemo(() => {
    const todayIso = iso(new Date());
    return sundays.find(s => s >= todayIso) || sundays[0] || todayIso;
  }, [sundays]);

  const [service, setService] = useState(null);          // null → show picker first
  const [title, setTitle]     = useState('Sunday Service');
  const [date, setDate]       = useState(defaultSunday);
  const [blocks, setBlocks]   = useState([]);
  const [over, setOver]       = useState(null);           // insertion index being hovered
  const [sendOpen, setSendOpen] = useState(false);

  const drag = useRef(null);   // { source:'palette', i } | { source:'canvas', id }

  const plan = { service, title, date, blocks };

  /* ── mutations ── */
  const insertAt = (block, index) =>
    setBlocks(prev => { const next = [...prev]; next.splice(index, 0, block); return next; });

  const removeBlock = id => setBlocks(prev => prev.filter(b => b.id !== id));

  const duplicateBlock = id => setBlocks(prev => {
    const i = prev.findIndex(b => b.id === id);
    if (i === -1) return prev;
    const copy = { ...prev[i], id: nextId() };
    const next = [...prev]; next.splice(i + 1, 0, copy); return next;
  });

  const moveBlock = (id, dir) => setBlocks(prev => {
    const i = prev.findIndex(b => b.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const patchBlock = (id, patch) =>
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));

  const addFromPalette = (p, index = blocks.length) => insertAt(makeBlock(p), index);

  /* ── drag & drop ── */
  const onDropAt = (index, e) => {
    e?.preventDefault?.();
    const d = drag.current;
    setOver(null);
    if (!d) return;
    if (d.source === 'palette') { addFromPalette(PALETTE[d.i], index); }
    else if (d.source === 'canvas') {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === d.id);
        if (from === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(from < index ? index - 1 : index, 0, moved);
        return next;
      });
    }
    drag.current = null;
  };

  const allowDrop = index => e => { e.preventDefault(); setOver(index); };

  if (!service) {
    return (
      <ServicePicker
        onPick={t => { setService(t); if (location.state?.send) setSendOpen(true); }}
        onClose={() => navigate(-1)}
      />
    );
  }

  return (
    <div className="sp-wrap">
      {/* ── Toolbar ── */}
      <header className="sp-topbar">
        <div className="sp-tb-left">
          <button className="sp-icon-btn" onClick={() => navigate('/calendar')} title="Back to calendar">
            <Icon d={P.chevL} size={18} />
          </button>
          <input className="sp-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Service title" />
        </div>

        <div className="sp-tb-center">
          <div className="sp-seg">
            {SERVICE_TIMES.map(t => (
              <button key={t} className={service === t ? 'on' : ''} onClick={() => setService(t)}>{t}</button>
            ))}
          </div>
          <label className="sp-datepick">
            <Icon d={P.calendar} size={15} />
            <select value={date} onChange={e => setDate(e.target.value)}>
              {sundays.length === 0 && <option value={date}>{fmtServiceDate(date)}</option>}
              {sundays.map(s => (
                <option key={s} value={s}>{fmtServiceDate(s)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="sp-tb-right">
          <button className="sp-tb-btn" onClick={() => openServicePrint(plan)}><Icon d={P.print} size={15} />Print</button>
          <button className="sp-tb-btn" onClick={() => downloadServicePdf(plan)}><Icon d={P.pdf} size={15} />PDF</button>
          <button className="sp-tb-btn primary" onClick={() => setSendOpen(true)}><Icon d={P.mail} size={15} />Email</button>
        </div>
      </header>

      <div className="sp-body">
        {/* ── Palette ── */}
        <aside className="sp-palette">
          <p className="sp-palette-head">Building blocks</p>
          <p className="sp-palette-sub">Drag onto the flow, or click to add.</p>
          {PALETTE.map((p, i) => (
            <button key={p.label + i} className="sp-pal-item" style={{ '--tc': p.color }}
              draggable
              onDragStart={e => { drag.current = { source: 'palette', i }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', p.label); }}
              onDragEnd={() => { drag.current = null; setOver(null); }}
              onClick={() => addFromPalette(p)}>
              <span className="sp-pal-icon"><Icon d={p.icon} size={18} /></span>
              <span className="sp-pal-text">
                <span className="sp-pal-name">{p.label}</span>
                {p.desc && <span className="sp-pal-desc">{p.desc}</span>}
              </span>
              <Icon d={P.plus} size={14} />
            </button>
          ))}
        </aside>

        {/* ── Flow / canvas ── */}
        <main className="sp-canvas" onDragOver={allowDrop(blocks.length)} onDrop={e => onDropAt(blocks.length, e)}>
          <div className="sp-canvas-inner">
            <div className="sp-flow-head">
              <h2>{title || 'Sunday Service'}</h2>
              <p>{service} · {fmtServiceDate(date)} · {blocks.length} {blocks.length === 1 ? 'item' : 'items'}</p>
            </div>

            {blocks.length === 0 ? (
              <div className="sp-empty"
                onDragOver={allowDrop(0)} onDrop={e => onDropAt(0, e)}>
                <div className="sp-empty-ic"><Icon d={P.planner || P.grid} size={30} /></div>
                <p className="sp-empty-title">Build your service order</p>
                <p className="sp-empty-sub">Drag blocks from the left, or click one to add it here.</p>
              </div>
            ) : (
              <div className="sp-flow">
                <Gap active={over === 0} on={allowDrop(0)} drop={() => onDropAt(0)} />
                {blocks.map((b, i) => (
                  <div key={b.id}>
                    <BlockCard
                      block={b} index={i} last={i === blocks.length - 1}
                      onDragStart={e => { drag.current = { source: 'canvas', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                      onDragEnd={() => { drag.current = null; setOver(null); }}
                      patch={patch => patchBlock(b.id, patch)}
                      onUp={() => moveBlock(b.id, -1)}
                      onDown={() => moveBlock(b.id, 1)}
                      onDup={() => duplicateBlock(b.id)}
                      onDel={() => removeBlock(b.id)}
                    />
                    <Gap active={over === i + 1} on={allowDrop(i + 1)} drop={() => onDropAt(i + 1)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {sendOpen && <SendServiceModal plan={plan} onClose={() => setSendOpen(false)} />}
    </div>
  );
}

/* Insertion drop-zone between blocks */
function Gap({ active, on, drop }) {
  return (
    <div className={`sp-gap ${active ? 'active' : ''}`} onDragOver={on}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(); }}>
      <span className="sp-gap-line" />
    </div>
  );
}

function BlockCard({ block: b, index, last, onDragStart, onDragEnd, patch, onUp, onDown, onDup, onDel }) {
  return (
    <div className="sp-block" style={{ '--tc': b.color }}>
      <div className="sp-block-drag" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder">
        <Icon d={P.grid} size={14} />
      </div>
      <div className="sp-block-num">{index + 1}</div>
      <div className="sp-block-icon"><Icon d={b.icon} size={18} /></div>

      <div className="sp-block-body">
        {b.kind === 'music' && (
          <div className="sp-fields">
            <input className="sp-field-main" value={b.title} placeholder="Song title"
              onChange={e => patch({ title: e.target.value })} />
            <select className="sp-key" value={b.musicKey} onChange={e => patch({ musicKey: e.target.value })}>
              <option value="">Key…</option>
              {MUSICAL_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        )}
        {b.kind === 'sermon' && (
          <>
            <input className="sp-field-main" value={b.title} placeholder="Sermon title"
              onChange={e => patch({ title: e.target.value })} />
            <textarea className="sp-field-notes" rows={2} value={b.notes} placeholder="Notes, scripture, key points…"
              onChange={e => patch({ notes: e.target.value })} />
          </>
        )}
        {b.kind === 'item' && (
          <>
            <input className="sp-field-main" value={b.label} placeholder="Name this item"
              onChange={e => patch({ label: e.target.value })} />
            <textarea className="sp-field-notes" rows={1} value={b.notes} placeholder="Notes (optional)"
              onChange={e => patch({ notes: e.target.value })} />
          </>
        )}
      </div>

      <div className="sp-block-actions">
        <button onClick={onUp} disabled={index === 0} title="Move up"><Icon d={P.arrowUp} size={15} /></button>
        <button onClick={onDown} disabled={last} title="Move down"><Icon d={P.arrowDown} size={15} /></button>
        <button onClick={onDup} title="Duplicate"><Icon d={P.layers} size={15} /></button>
        <button className="del" onClick={onDel} title="Delete"><Icon d={P.trash} size={15} /></button>
      </div>
    </div>
  );
}

/* First-open: which service are you planning? */
function ServicePicker({ onPick, onClose }) {
  return (
    <div className="sp-picker-overlay">
      <div className="sp-picker">
        <button className="sp-picker-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        <div className="sp-picker-badge"><Icon d={P.planner || P.calendar} size={26} /></div>
        <h1>Plan a Sunday service</h1>
        <p>Which service are you planning for?</p>
        <div className="sp-picker-grid">
          {SERVICE_TIMES.map(t => (
            <button key={t} className="sp-picker-card" onClick={() => onPick(t)}>
              <span className="sp-picker-time">{t}</span>
              <span className="sp-picker-go">Start planning<Icon d={P.arrowRight} size={16} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
