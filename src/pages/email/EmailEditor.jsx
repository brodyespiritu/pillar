import { confirmDialog, alertDialog } from "../../lib/dialog";
import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import {
  BLOCK_TYPES, DEFAULT_THEME, newBlock, starterBlocks, renderBlockContent,
  fetchTemplates, saveTemplate, deleteTemplate,
} from '../../lib/emailTemplates';
import './emailEditor.css';

const ALIGNS = ['left', 'center', 'right'];

export default function EmailEditor({ onClose, initial, onApply, applyLabel = 'Use in email' }) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [missing, setMissing]     = useState(false);
  const [openMenu, setOpenMenu]   = useState(false);

  const [id, setId]         = useState(initial?.id ?? null);
  const [name, setName]     = useState(initial?.name ?? 'Untitled template');
  const [theme, setTheme]   = useState(initial?.theme ?? DEFAULT_THEME);
  const [blocks, setBlocks] = useState(() => initial?.blocks?.length ? initial.blocks : starterBlocks(DEFAULT_THEME));
  const [selId, setSelId]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const selected = useMemo(() => blocks.find(b => b.id === selId) || null, [blocks, selId]);

  async function loadList() {
    const { rows, missing } = await fetchTemplates();
    setTemplates(rows); setMissing(missing);
  }
  useEffect(() => { loadList(); }, []);

  function newTemplate() {
    setId(null); setName('Untitled template'); setTheme(DEFAULT_THEME);
    setBlocks(starterBlocks(DEFAULT_THEME)); setSelId(null); setOpenMenu(false); setSavedAt(null);
  }
  function openTemplate(t) {
    setId(t.id); setName(t.name); setTheme({ ...DEFAULT_THEME, ...(t.theme || {}) });
    setBlocks(t.blocks || []); setSelId(null); setOpenMenu(false); setSavedAt(null);
  }

  const patchBlock = (bid, patch) => setBlocks(bs => bs.map(b => b.id === bid ? { ...b, ...patch } : b));
  const addBlock = type => {
    const b = newBlock(type, theme);
    setBlocks(bs => {
      const i = selId ? bs.findIndex(x => x.id === selId) + 1 : bs.length;
      const next = [...bs]; next.splice(i, 0, b); return next;
    });
    setSelId(b.id);
  };
  const moveBlock = (bid, dir) => setBlocks(bs => {
    const i = bs.findIndex(b => b.id === bid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= bs.length) return bs;
    const next = [...bs];[next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const removeBlock = bid => { setBlocks(bs => bs.filter(b => b.id !== bid)); if (selId === bid) setSelId(null); };
  const dupBlock = bid => setBlocks(bs => {
    const i = bs.findIndex(b => b.id === bid);
    if (i < 0) return bs;
    const copy = JSON.parse(JSON.stringify(bs[i]));
    copy.id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const next = [...bs]; next.splice(i + 1, 0, copy);
    setSelId(copy.id);
    return next;
  });

  async function save() {
    setSaving(true);
    const { data, error } = await saveTemplate({ id, name, category: 'general', blocks, theme, created_by: user?.id });
    setSaving(false);
    if (!error && data) { setId(data.id); setSavedAt(Date.now()); loadList(); }
    else if (error) alertDialog(/relation|does not exist/i.test(error.message || '') ? 'Run supabase/email-templates-schema.sql to save templates.' : error.message);
  }
  async function removeTemplate(t, e) {
    e.stopPropagation();
    if (!(await confirmDialog({ message: `Delete template "${t.name}"?` }))) return;
    await deleteTemplate(t.id);
    if (t.id === id) newTemplate();
    loadList();
  }

  return (
    <div className="ee-overlay">
      {/* Top bar */}
      <div className="ee-top">
        <div className="ee-top-left">
          <button className="ee-icon-btn" onClick={onClose} title="Close"><Icon d={P.close} size={18} /></button>
          <input className="ee-name" value={name} onChange={e => setName(e.target.value)} />
          <div className="ee-open">
            <button className="ee-open-btn" onClick={() => setOpenMenu(m => !m)}>Open <Icon d={P.chevron} size={14} /></button>
            {openMenu && (<>
              <div className="ee-open-backdrop" onClick={() => setOpenMenu(false)} />
              <div className="ee-open-menu">
                <button className="ee-open-new" onClick={newTemplate}><Icon d={P.plus} size={14} />New template</button>
                {missing && <div className="ee-open-note">Run email-templates-schema.sql to save & list.</div>}
                {templates.map(t => (
                  <button key={t.id} className={`ee-open-row ${t.id === id ? 'on' : ''}`} onClick={() => openTemplate(t)}>
                    <span>{t.name}</span>
                    <span className="ee-open-del" onClick={e => removeTemplate(t, e)}><Icon d={P.trash} size={13} /></span>
                  </button>
                ))}
                {!templates.length && !missing && <div className="ee-open-note">No saved templates yet.</div>}
              </div>
            </>)}
          </div>
        </div>
        <div className="ee-top-right">
          {savedAt && <span className="ee-saved">Saved</span>}
          <button className="ee-save ghost" onClick={save} disabled={saving}><Icon d={P.check} size={15} />{saving ? 'Saving…' : 'Save template'}</button>
          {onApply && (
            <button className="ee-save" onClick={() => onApply(blocks, theme)}><Icon d={P.arrowRight} size={15} />{applyLabel}</button>
          )}
        </div>
      </div>

      <div className="ee-body">
        {/* Left: add blocks + theme */}
        <aside className="ee-rail left">
          <p className="ee-rail-title">Add block</p>
          <div className="ee-palette">
            {BLOCK_TYPES.map(bt => (
              <button key={bt.type} className="ee-pal-btn" onClick={() => addBlock(bt.type)}>
                <span className="ee-pal-ic">{bt.icon}</span>{bt.label}
              </button>
            ))}
          </div>

          <p className="ee-rail-title">Theme</p>
          <ColorField label="Accent / buttons" value={theme.accent} onChange={v => setTheme(t => ({ ...t, accent: v }))} />
          <ColorField label="Page background" value={theme.pageBg} onChange={v => setTheme(t => ({ ...t, pageBg: v }))} />
          <ColorField label="Card background" value={theme.cardBg} onChange={v => setTheme(t => ({ ...t, cardBg: v }))} />
        </aside>

        {/* Center: canvas */}
        <main className="ee-canvas-wrap" style={{ background: theme.pageBg }} onClick={() => setSelId(null)}>
          <div className="ee-canvas" style={{ background: theme.cardBg }}>
            {blocks.length === 0 && <div className="ee-canvas-empty">Add a block from the left to start building.</div>}
            {blocks.map(b => (
              <div
                key={b.id}
                className={`ee-block ${selId === b.id ? 'sel' : ''}`}
                onClick={e => { e.stopPropagation(); setSelId(b.id); }}
              >
                <div className="ee-block-inner" dangerouslySetInnerHTML={{ __html: renderBlockContent(b, theme) }} />
                {selId === b.id && (
                  <div className="ee-block-tools" onClick={e => e.stopPropagation()}>
                    <button onClick={() => moveBlock(b.id, -1)} title="Move up"><Icon d={P.arrowUp} size={13} /></button>
                    <button onClick={() => moveBlock(b.id, 1)} title="Move down"><Icon d={P.arrowDown} size={13} /></button>
                    <button onClick={() => dupBlock(b.id)} title="Duplicate"><Icon d={P.layers} size={13} /></button>
                    <button onClick={() => removeBlock(b.id)} title="Delete"><Icon d={P.trash} size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>

        {/* Right: inspector */}
        <aside className="ee-rail right">
          {selected
            ? <Inspector block={selected} theme={theme} patch={p => patchBlock(selected.id, p)} />
            : <div className="ee-inspector-empty"><Icon d={P.edit} size={22} /><p>Select a block to edit its content.</p></div>}
        </aside>
      </div>
    </div>
  );
}

/* ── Per-block inspector ── */
function Inspector({ block: b, theme, patch }) {
  const AlignRow = () => (
    <Field label="Align">
      <div className="ee-seg">
        {ALIGNS.map(a => <button key={a} className={b.align === a ? 'on' : ''} onClick={() => patch({ align: a })}>{a}</button>)}
      </div>
    </Field>
  );

  return (
    <div className="ee-inspector">
      <p className="ee-rail-title">{b.type} block</p>

      {(b.type === 'heading' || b.type === 'text') && <>
        <Field label="Text"><textarea rows={b.type === 'text' ? 6 : 2} value={b.text} onChange={e => patch({ text: e.target.value })} /></Field>
        <Field label="Size"><input type="number" value={b.size} onChange={e => patch({ size: +e.target.value })} /></Field>
        <ColorField label="Color" value={b.color} onChange={v => patch({ color: v })} />
        <AlignRow />
      </>}

      {b.type === 'button' && <>
        <Field label="Label"><input value={b.text} onChange={e => patch({ text: e.target.value })} /></Field>
        <Field label="Link URL"><input value={b.url} onChange={e => patch({ url: e.target.value })} placeholder="https://" /></Field>
        <ColorField label="Button color" value={b.bg} onChange={v => patch({ bg: v })} />
        <ColorField label="Text color" value={b.color} onChange={v => patch({ color: v })} />
        <Field label="Corner radius"><input type="number" value={b.radius ?? 8} onChange={e => patch({ radius: +e.target.value })} /></Field>
        <Toggle label="Full width" on={!!b.fullWidth} onChange={v => patch({ fullWidth: v })} />
        <AlignRow />
      </>}

      {b.type === 'image' && <>
        <Field label="Image URL"><input value={b.src} onChange={e => patch({ src: e.target.value })} placeholder="https://…/image.png" /></Field>
        <Field label="Alt text"><input value={b.alt} onChange={e => patch({ alt: e.target.value })} /></Field>
        <Field label="Link (optional)"><input value={b.href} onChange={e => patch({ href: e.target.value })} placeholder="https://" /></Field>
        <Toggle label="Full width" on={!!b.fullWidth} onChange={v => patch({ fullWidth: v })} />
        {!b.fullWidth && <Field label="Width (px)"><input type="number" value={b.width} onChange={e => patch({ width: +e.target.value })} /></Field>}
        <AlignRow />
        <p className="ee-hint">Images must be hosted at a public URL to show in email.</p>
      </>}

      {b.type === 'columns' && <>
        <Field label="Left column"><textarea rows={4} value={b.cols?.[0]?.text || ''} onChange={e => patch({ cols: [{ text: e.target.value }, b.cols?.[1] || { text: '' }] })} /></Field>
        <Field label="Right column"><textarea rows={4} value={b.cols?.[1]?.text || ''} onChange={e => patch({ cols: [b.cols?.[0] || { text: '' }, { text: e.target.value }] })} /></Field>
        <Field label="Text size"><input type="number" value={b.size} onChange={e => patch({ size: +e.target.value })} /></Field>
        <Field label="Gap (px)"><input type="number" value={b.gap} onChange={e => patch({ gap: +e.target.value })} /></Field>
        <ColorField label="Text color" value={b.color} onChange={v => patch({ color: v })} />
      </>}

      {b.type === 'divider' && <ColorField label="Line color" value={b.color} onChange={v => patch({ color: v })} />}
      {b.type === 'spacer' && <Field label="Height (px)"><input type="number" value={b.height} onChange={e => patch({ height: +e.target.value })} /></Field>}

      {b.type !== 'spacer' && <>
        <p className="ee-rail-title" style={{ marginTop: 20 }}>Block style</p>
        <div className="ee-field">
          <span>Background</span>
          <div className="ee-color">
            <input type="color" value={b.bg || '#ffffff'} onChange={e => patch({ bg: e.target.value })} />
            <input type="text" value={b.bg || ''} placeholder="none" onChange={e => patch({ bg: e.target.value })} />
            {b.bg && <button className="ee-clear" onClick={() => patch({ bg: null })}>clear</button>}
          </div>
        </div>
        <Field label="Vertical padding (px)"><input type="number" value={b.padY ?? 10} onChange={e => patch({ padY: +e.target.value })} /></Field>
      </>}
    </div>
  );
}

function Toggle({ label, on, onChange }) {
  return (
    <label className="ee-toggle">
      <span>{label}</span>
      <button type="button" className={`ee-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
    </label>
  );
}

function Field({ label, children }) {
  return <label className="ee-field"><span>{label}</span>{children}</label>;
}
function ColorField({ label, value, onChange }) {
  return (
    <label className="ee-field">
      <span>{label}</span>
      <div className="ee-color">
        <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} />
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} />
      </div>
    </label>
  );
}
