import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useCallback } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getMediaLayout, putMediaLayout, getSermons,
  getResources, saveResource, deleteResource,
  getCustomBlocks, saveCustomBlock, deleteCustomBlock,
  uploadImage, genId,
} from '../../lib/appApi';

const RESOURCE_TYPES = ['Series', 'Study Guide', 'Devotional', 'Podcast', 'Other'];

export default function MediaPage() {
  const [tab, setTab] = useState('layout');
  return (
    <AppShell title="Media Page" subtitle="Curate the app’s Media tab — what’s featured, suggested, and available.">
      <div className="ap-subtabs">
        <button className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}>Layout</button>
        <button className={tab === 'blocks' ? 'on' : ''} onClick={() => setTab('blocks')}>Custom Video</button>
        <button className={tab === 'resources' ? 'on' : ''} onClick={() => setTab('resources')}>Resources</button>
      </div>
      {tab === 'layout' ? <Layout /> : tab === 'blocks' ? <CustomBlocks /> : <Resources />}
    </AppShell>
  );
}

/* ── Layout ── */
function Layout() {
  const [sermons, setSermons] = useState([]);
  const [featured, setFeatured] = useState('');
  const [suggested, setSuggested] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [resourcesOrder, setResourcesOrder] = useState([]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [lay, serms] = await Promise.all([getMediaLayout(), getSermons()]);
      setSermons(Array.isArray(serms) ? serms : []);
      setFeatured(lay?.featuredSermonId || '');
      setSuggested(Array.isArray(lay?.suggestedIds) ? lay.suggestedIds : []);
      setResourcesOrder(Array.isArray(lay?.resourcesOrder) ? lay.resourcesOrder : []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleSuggested = id => setSuggested(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try { await putMediaLayout({ featuredSermonId: featured || null, suggestedIds: suggested, resourcesOrder }); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch (e) { setError(e.message); }
    setSaving(false);
  }

  if (loading) return <div className="ap-loading"><span className="ap-spinner" />Loading layout…</div>;

  return (
    <>
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}
      <div className="ap-panel" style={{ padding: 24 }}>
        <div className="ap-field" style={{ maxWidth: 420 }}>
          <label className="ap-label">Featured sermon</label>
          <select className="ap-select" value={featured} onChange={e => setFeatured(e.target.value)}>
            <option value="">None</option>
            {sermons.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <span className="ap-hint">Shown prominently at the top of the Media tab.</span>
        </div>

        <h3 className="ap-section-title" style={{ marginTop: 24 }}>Suggested sermons</h3>
        <div className="ap-checklist">
          {sermons.length === 0 ? <p className="ap-hint">No sermons available.</p> : sermons.map(s => (
            <label key={s.id} className={`ap-checkitem ${suggested.includes(s.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={suggested.includes(s.id)} onChange={() => toggleSuggested(s.id)} />
              <span>{s.title}</span>
              {suggested.includes(s.id) && <Icon d={P.check} size={15} />}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>}
          <button className="ap-btn primary" onClick={save} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />Save layout</>}</button>
        </div>
      </div>
    </>
  );
}

/* ── Custom video blocks ── */
function CustomBlocks() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await getCustomBlocks(); setRows(Array.isArray(r) ? r : []); } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function togglePublish(b) {
    const next = { ...b, published: !b.published };
    setRows(l => l.map(x => (x.id === b.id ? next : x)));
    try { await saveCustomBlock(next); } catch (e) { setError(e.message); load(); }
  }
  async function remove(b) {
    if (!(await confirmDialog({ message: `Delete “${b.title}”?` }))) return;
    try { await deleteCustomBlock(b.id); setRows(l => l.filter(x => x.id !== b.id)); } catch (e) { setError(e.message); }
  }

  return (
    <>
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}
      <div className="ap-panel">
        <div className="ap-toolbar">
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{rows.length} block{rows.length === 1 ? '' : 's'}</span>
          <button className="ap-btn primary" onClick={() => setEditing({})}><Icon d={P.plus} size={15} />Add video block</button>
        </div>
        {loading ? <div className="ap-loading"><span className="ap-spinner" />Loading…</div>
          : rows.length === 0 ? <div className="ap-empty">No custom video blocks yet.</div>
          : <div className="ap-table-wrap"><table className="ap-table">
              <thead><tr><th></th><th>Title</th><th>Plays</th><th>Status</th><th></th></tr></thead>
              <tbody>{rows.map(b => (
                <tr key={b.id}>
                  <td>{b.thumbnail ? <img className="ap-thumb" src={b.thumbnail} alt="" /> : <div className="ap-thumb" />}</td>
                  <td><div className="ap-cell-title">{b.title || 'Untitled'}</div><div className="ap-cell-sub">{b.subtitle}</div></td>
                  <td>{b.playInContainer ? 'In-app' : 'External'}</td>
                  <td><button className={`ap-badge ${b.published ? 'on' : 'off'}`} onClick={() => togglePublish(b)}><span className={`ap-dot ${b.published ? 'ok' : 'off'}`} />{b.published ? 'Published' : 'Draft'}</button></td>
                  <td><div className="ap-row-actions">
                    <button className="ap-icon-btn" onClick={() => setEditing(b)}><Icon d={P.edit} size={16} /></button>
                    <button className="ap-icon-btn danger" onClick={() => remove(b)}><Icon d={P.trash} size={16} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>
      {editing && <CustomBlockForm item={editing} onClose={() => setEditing(null)} onSaved={s => { setRows(l => l.some(x => x.id === s.id) ? l.map(x => x.id === s.id ? s : x) : [s, ...l]); setEditing(null); }} />}
    </>
  );
}

function CustomBlockForm({ item, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState({
    id: item.id || genId(), title: item.title || '', subtitle: item.subtitle || '',
    videoUrl: item.videoUrl || '', thumbnail: item.thumbnail || '',
    playInContainer: item.playInContainer !== false, published: item.published !== false,
  });
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  async function onThumb(e) { const file = e.target.files?.[0]; if (!file) return; setUploading(true); try { const url = await uploadImage(file); if (url) set('thumbnail', url); } catch (err) { setError(err.message); } setUploading(false); }
  async function save() {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try { await saveCustomBlock(f); onSaved(f); } catch (e) { setError(e.message); setSaving(false); }
  }
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isNew ? 'Add video block' : 'Edit video block'}</h2><button className="ap-modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button></div>
        <div className="ap-modal-body">
          <div className="ap-field"><label className="ap-label">Title</label><input className="ap-input" value={f.title} onChange={e => set('title', e.target.value)} autoFocus /></div>
          <div className="ap-field"><label className="ap-label">Subtitle</label><input className="ap-input" value={f.subtitle} onChange={e => set('subtitle', e.target.value)} /></div>
          <div className="ap-field"><label className="ap-label">Video URL</label><input className="ap-input" value={f.videoUrl} onChange={e => set('videoUrl', e.target.value)} placeholder="YouTube, HLS, Dropbox…" /></div>
          <div className="ap-field"><label className="ap-label">Thumbnail</label>
            <div className="ap-uploader">
              {f.thumbnail ? <img className="ap-uploader-preview" src={f.thumbnail} alt="" /> : <div className="ap-uploader-preview"><Icon d={P.folder} size={18} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <label className="ap-btn" style={{ cursor: 'pointer' }}>{uploading ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={15} />Upload</>}<input type="file" accept="image/*" onChange={onThumb} style={{ display: 'none' }} /></label>
                <input className="ap-input" value={f.thumbnail} onChange={e => set('thumbnail', e.target.value)} placeholder="…or paste URL" />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label className="ap-switch"><input type="checkbox" checked={f.playInContainer} onChange={e => set('playInContainer', e.target.checked)} /><span className="ap-switch-track" />Play in-app</label>
            <label className="ap-switch"><input type="checkbox" checked={f.published} onChange={e => set('published', e.target.checked)} /><span className="ap-switch-track" />{f.published ? 'Published' : 'Draft'}</label>
          </div>
          {error && <div className="ap-banner error" style={{ margin: 0 }}><Icon d={P.close} size={16} />{error}</div>}
        </div>
        <div className="ap-modal-foot"><button className="ap-btn" onClick={onClose}>Cancel</button><button className="ap-btn primary" onClick={save} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />{isNew ? 'Add' : 'Save'}</>}</button></div>
      </div>
    </div>
  );
}

/* ── Resources ── */
function Resources() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await getResources(); setRows(Array.isArray(r) ? r : []); } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function togglePublish(r) {
    const next = { ...r, published: !r.published };
    setRows(l => l.map(x => (x.id === r.id ? next : x)));
    try { await saveResource(next); } catch (e) { setError(e.message); load(); }
  }
  async function remove(r) {
    if (!(await confirmDialog({ message: `Delete “${r.title}”?` }))) return;
    try { await deleteResource(r.id); setRows(l => l.filter(x => x.id !== r.id)); } catch (e) { setError(e.message); }
  }

  return (
    <>
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}
      <div className="ap-panel">
        <div className="ap-toolbar">
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{rows.length} resource{rows.length === 1 ? '' : 's'}</span>
          <button className="ap-btn primary" onClick={() => setEditing({})}><Icon d={P.plus} size={15} />Add resource</button>
        </div>
        {loading ? <div className="ap-loading"><span className="ap-spinner" />Loading…</div>
          : rows.length === 0 ? <div className="ap-empty">No resources yet.</div>
          : <div className="ap-table-wrap"><table className="ap-table">
              <thead><tr><th></th><th>Title</th><th>Type</th><th>Status</th><th></th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}>
                  <td>{r.coverUrl ? <img className="ap-thumb" style={{ width: 30, height: 40 }} src={r.coverUrl} alt="" /> : <div className="ap-thumb" style={{ width: 30, height: 40 }} />}</td>
                  <td><div className="ap-cell-title">{r.title || 'Untitled'}</div><div className="ap-cell-sub">{r.subtitle}</div></td>
                  <td>{r.type ? <span className="ap-badge tag">{r.type}</span> : '—'}</td>
                  <td><button className={`ap-badge ${r.published ? 'on' : 'off'}`} onClick={() => togglePublish(r)}><span className={`ap-dot ${r.published ? 'ok' : 'off'}`} />{r.published ? 'Published' : 'Draft'}</button></td>
                  <td><div className="ap-row-actions">
                    <button className="ap-icon-btn" onClick={() => setEditing(r)}><Icon d={P.edit} size={16} /></button>
                    <button className="ap-icon-btn danger" onClick={() => remove(r)}><Icon d={P.trash} size={16} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>
      {editing && <ResourceForm item={editing} onClose={() => setEditing(null)} onSaved={s => { setRows(l => l.some(x => x.id === s.id) ? l.map(x => x.id === s.id ? s : x) : [s, ...l]); setEditing(null); }} />}
    </>
  );
}

function ResourceForm({ item, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState({
    id: item.id || genId(), title: item.title || '', subtitle: item.subtitle || '',
    type: item.type || 'Series', coverUrl: item.coverUrl || '', link: item.link || '', published: item.published !== false,
  });
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  async function onCover(e) { const file = e.target.files?.[0]; if (!file) return; setUploading(true); try { const url = await uploadImage(file); if (url) set('coverUrl', url); } catch (err) { setError(err.message); } setUploading(false); }
  async function save() {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try { await saveResource(f); onSaved(f); } catch (e) { setError(e.message); setSaving(false); }
  }
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isNew ? 'Add resource' : 'Edit resource'}</h2><button className="ap-modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button></div>
        <div className="ap-modal-body">
          <div className="ap-field"><label className="ap-label">Title</label><input className="ap-input" value={f.title} onChange={e => set('title', e.target.value)} autoFocus /></div>
          <div className="ap-field"><label className="ap-label">Subtitle</label><input className="ap-input" value={f.subtitle} onChange={e => set('subtitle', e.target.value)} /></div>
          <div className="ap-field"><label className="ap-label">Type</label>
            <select className="ap-select" value={f.type} onChange={e => set('type', e.target.value)}>{RESOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <div className="ap-field"><label className="ap-label">Cover image (3:4)</label>
            <div className="ap-uploader">
              {f.coverUrl ? <img className="ap-uploader-preview" style={{ width: 54, height: 72 }} src={f.coverUrl} alt="" /> : <div className="ap-uploader-preview" style={{ width: 54, height: 72 }}><Icon d={P.folder} size={18} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <label className="ap-btn" style={{ cursor: 'pointer' }}>{uploading ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={15} />Upload</>}<input type="file" accept="image/*" onChange={onCover} style={{ display: 'none' }} /></label>
                <input className="ap-input" value={f.coverUrl} onChange={e => set('coverUrl', e.target.value)} placeholder="…or paste URL" />
              </div>
            </div>
          </div>
          <div className="ap-field"><label className="ap-label">Link</label><input className="ap-input" value={f.link} onChange={e => set('link', e.target.value)} placeholder="https://" /></div>
          <label className="ap-switch"><input type="checkbox" checked={f.published} onChange={e => set('published', e.target.checked)} /><span className="ap-switch-track" />{f.published ? 'Published' : 'Draft'}</label>
          {error && <div className="ap-banner error" style={{ margin: 0 }}><Icon d={P.close} size={16} />{error}</div>}
        </div>
        <div className="ap-modal-foot"><button className="ap-btn" onClick={onClose}>Cancel</button><button className="ap-btn primary" onClick={save} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />{isNew ? 'Add' : 'Save'}</>}</button></div>
      </div>
    </div>
  );
}
