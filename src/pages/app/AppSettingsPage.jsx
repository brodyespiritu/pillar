import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getSettings, putSettings, getBlocks, putBlocks, uploadImage } from '../../lib/appApi';
import ApiKeyPanel from './ApiKeyPanel';

const FIELDS = [
  { key: 'churchName', label: 'Church name' },
  { key: 'tagline',    label: 'Tagline' },
  { key: 'address',    label: 'Address' },
  { key: 'phone',      label: 'Phone' },
  { key: 'email',      label: 'Email' },
  { key: 'website',    label: 'Website' },
  { key: 'serviceDay', label: 'Service day' },
  { key: 'service1',   label: 'Service time 1' },
  { key: 'service2',   label: 'Service time 2' },
  { key: 'facebook',   label: 'Facebook handle' },
  { key: 'instagram',  label: 'Instagram handle' },
  { key: 'youtube',    label: 'YouTube handle' },
];

export default function AppSettingsPage() {
  const [raw, setRaw] = useState(null);          // full loaded settings (preserve unknown fields on PUT)
  const [form, setForm] = useState({});
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingS, setSavingS] = useState(false);
  const [savingB, setSavingB] = useState(false);
  const [savedS, setSavedS] = useState(false);
  const [savedB, setSavedB] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, b] = await Promise.all([getSettings(), getBlocks()]);
      setRaw(s || {});
      setForm(Object.fromEntries([...FIELDS.map(f => f.key), 'heroImageUrl', 'heroTitle', 'heroQuote', 'featuredVideoUrl'].map(k => [k, s?.[k] ?? ''])));
      setBlocks(Array.isArray(b) ? b : []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function onHero(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try { const url = await uploadImage(file); if (url) set('heroImageUrl', url); } catch (err) { setError(err.message); }
    setUploading(false); if (fileRef.current) fileRef.current.value = '';
  }

  async function saveSettings_() {
    setSavingS(true); setError(''); setSavedS(false);
    try { await putSettings({ ...raw, ...form }); setSavedS(true); setTimeout(() => setSavedS(false), 2500); }
    catch (e) { setError(e.message); }
    setSavingS(false);
  }

  const moveBlock = (i, dir) => setBlocks(b => {
    const j = i + dir; if (j < 0 || j >= b.length) return b;
    const n = [...b]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const toggleBlock = i => setBlocks(b => b.map((x, k) => (k === i ? { ...x, enabled: !x.enabled } : x)));

  async function saveBlocks_() {
    setSavingB(true); setError(''); setSavedB(false);
    try { await putBlocks(blocks); setSavedB(true); setTimeout(() => setSavedB(false), 2500); }
    catch (e) { setError(e.message); }
    setSavingB(false);
  }

  return (
    <AppShell title="App Settings" subtitle="Church info, home hero media, and the home-screen block layout.">
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}

      <ApiKeyPanel />

      {loading ? (
        <div className="ap-loading"><span className="ap-spinner" />Loading settings…</div>
      ) : (
        <>
          {/* Church info */}
          <div className="ap-panel" style={{ padding: 24, marginBottom: 20 }}>
            <h3 className="ap-section-title">Church information</h3>
            <div className="ap-form-grid">
              {FIELDS.map(f => (
                <div className="ap-field" key={f.key}>
                  <label className="ap-label">{f.label}</label>
                  <input className="ap-input" value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
                </div>
              ))}
            </div>

            <h3 className="ap-section-title" style={{ marginTop: 24 }}>Home hero</h3>
            <p className="ap-hint" style={{ marginTop: -8, marginBottom: 14 }}>This card is the main visual on the app’s home screen.</p>
            <div className="ap-hero-edit">
              <div className="ap-hero-fields">
                <div className="ap-field">
                  <label className="ap-label">Hero image</label>
                  <div className="ap-uploader">
                    {form.heroImageUrl ? <img className="ap-uploader-preview" src={form.heroImageUrl} alt="" /> : <div className="ap-uploader-preview"><Icon d={P.folder} size={18} /></div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                      <input ref={fileRef} type="file" accept="image/*" onChange={onHero} style={{ display: 'none' }} />
                      <button type="button" className="ap-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                        {uploading ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={15} />Upload image</>}
                      </button>
                      <input className="ap-input" value={form.heroImageUrl ?? ''} onChange={e => set('heroImageUrl', e.target.value)} placeholder="…or paste an image URL" />
                    </div>
                  </div>
                </div>
                <div className="ap-field" style={{ marginTop: 14 }}>
                  <label className="ap-label">Hero title</label>
                  <input className="ap-input" value={form.heroTitle ?? ''} onChange={e => set('heroTitle', e.target.value)} placeholder="Welcome Home" />
                  <span className="ap-hint">Falls back to “Welcome Home” in the app if empty.</span>
                </div>
                <div className="ap-field" style={{ marginTop: 14 }}>
                  <label className="ap-label">Hero quote</label>
                  <input className="ap-input" value={form.heroQuote ?? ''} onChange={e => set('heroQuote', e.target.value)} placeholder="A short one-line quote" />
                  <span className="ap-hint">Falls back to the tagline above if empty.</span>
                </div>
                <div className="ap-field" style={{ marginTop: 14 }}>
                  <label className="ap-label">Featured video URL</label>
                  <input className="ap-input" value={form.featuredVideoUrl ?? ''} onChange={e => set('featuredVideoUrl', e.target.value)} placeholder="Dropbox, GCS, or HLS link" />
                </div>
              </div>

              {/* Live preview of the app's home hero card */}
              <div className="ap-hero-preview-wrap">
                <span className="ap-label">Preview</span>
                <div className="ap-hero-preview" style={form.heroImageUrl ? { backgroundImage: `url("${form.heroImageUrl}")` } : undefined}>
                  {!form.heroImageUrl && <div className="ap-hero-preview-placeholder"><Icon d={P.folder} size={26} /></div>}
                  <div className="ap-hero-preview-content">
                    <div className="ap-hero-preview-title">{form.heroTitle?.trim() || 'Welcome Home'}</div>
                    {(form.heroQuote?.trim() || form.tagline?.trim()) &&
                      <div className="ap-hero-preview-quote">{form.heroQuote?.trim() || form.tagline?.trim()}</div>}
                    <div className="ap-hero-preview-meta">
                      {[form.serviceDay, form.service1, form.service2].filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              {savedS && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>}
              <button className="ap-btn primary" onClick={saveSettings_} disabled={savingS}>
                {savingS ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />Save settings</>}
              </button>
            </div>
          </div>

          {/* Home block layout */}
          <div className="ap-panel" style={{ padding: 24 }}>
            <h3 className="ap-section-title">Home screen layout</h3>
            <p className="ap-hint" style={{ marginBottom: 14 }}>Reorder and show/hide the sections on the app’s home screen.</p>
            <div className="ap-blocklist">
              {blocks.map((b, i) => (
                <div className="ap-blockrow" key={b.id || i}>
                  <div className="ap-blockrow-move">
                    <button className="ap-icon-btn" onClick={() => moveBlock(i, -1)} disabled={i === 0}><Icon d={P.arrowUp} size={15} /></button>
                    <button className="ap-icon-btn" onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1}><Icon d={P.arrowDown} size={15} /></button>
                  </div>
                  <span className="ap-blockrow-name">{b.label || b.id}</span>
                  <label className="ap-switch">
                    <input type="checkbox" checked={!!b.enabled} onChange={() => toggleBlock(i)} />
                    <span className="ap-switch-track" />
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
              {savedB && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>}
              <button className="ap-btn primary" onClick={saveBlocks_} disabled={savingB}>
                {savingB ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />Save layout</>}
              </button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
