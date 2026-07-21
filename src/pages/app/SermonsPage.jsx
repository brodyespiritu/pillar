import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getSermons, saveSermon, deleteSermon, uploadImage, genId } from '../../lib/appApi';

export default function SermonsPage() {
  const [sermons, setSermons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState(null);  // sermon obj | {} (new) | null

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const rows = await getSermons(); setSermons(Array.isArray(rows) ? rows : []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sermons;
    return sermons.filter(s => [s.title, s.speaker, s.series].filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }, [sermons, search]);

  async function togglePublish(s) {
    const next = { ...s, published: !s.published };
    setSermons(list => list.map(x => (x.id === s.id ? next : x)));   // optimistic
    try { await saveSermon(next); } catch (e) { setError(e.message); load(); }
  }

  async function remove(s) {
    if (!(await confirmDialog({ message: `Delete “${s.title}”? This removes it from the live app for everyone.` }))) return;
    try { await deleteSermon(s.id); setSermons(list => list.filter(x => x.id !== s.id)); }
    catch (e) { setError(e.message); }
  }

  return (
    <AppShell
      title="Sermons"
      subtitle="Manage the sermon library shown in the app. Changes go live within seconds."
      actions={<button className="ap-btn primary" onClick={() => setEditing({})}><Icon d={P.plus} size={15} />Add sermon</button>}
    >
      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}

      <div className="ap-panel">
        <div className="ap-toolbar">
          <div className="ap-search">
            <Icon d={P.search} size={16} />
            <input placeholder="Search title, speaker, series…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="ap-btn" onClick={load} disabled={loading}><Icon d={P.repeat} size={15} />Refresh</button>
        </div>

        {loading ? (
          <div className="ap-loading"><span className="ap-spinner" />Loading sermons…</div>
        ) : filtered.length === 0 ? (
          <div className="ap-empty">{search ? 'No sermons match your search.' : 'No sermons yet. Add your first one.'}</div>
        ) : (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr><th></th><th>Title</th><th>Series</th><th>Date</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td>{s.thumbnailUrl ? <img className="ap-thumb" src={s.thumbnailUrl} alt="" /> : <div className="ap-thumb" />}</td>
                    <td>
                      <div className="ap-cell-title">{s.title || 'Untitled'}</div>
                      <div className="ap-cell-sub">{[s.speaker, s.duration].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{s.series || '—'}</td>
                    <td>{s.date || '—'}</td>
                    <td>
                      <button className={`ap-badge ${s.published ? 'on' : 'off'}`} onClick={() => togglePublish(s)} title="Toggle published">
                        <span className={`ap-dot ${s.published ? 'ok' : 'off'}`} />{s.published ? 'Published' : 'Draft'}
                      </button>
                    </td>
                    <td>
                      <div className="ap-row-actions">
                        <button className="ap-icon-btn" onClick={() => setEditing(s)} title="Edit"><Icon d={P.edit} size={16} /></button>
                        <button className="ap-icon-btn danger" onClick={() => remove(s)} title="Delete"><Icon d={P.trash} size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <SermonForm
          sermon={editing}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setSermons(list => {
              const exists = list.some(x => x.id === saved.id);
              return exists ? list.map(x => (x.id === saved.id ? saved : x)) : [saved, ...list];
            });
            setEditing(null);
          }}
        />
      )}
    </AppShell>
  );
}

function SermonForm({ sermon, onClose, onSaved }) {
  const isNew = !sermon.id;
  const [f, setF] = useState({
    id: sermon.id || genId(),
    title: sermon.title || '', speaker: sermon.speaker || '', date: sermon.date || '',
    series: sermon.series || '', duration: sermon.duration || '',
    thumbnailUrl: sermon.thumbnailUrl || '', videoLink: sermon.videoLink || '',
    mainVerse: sermon.mainVerse || '', description: sermon.description || '', notes: sermon.notes || '',
    published: sermon.published !== false,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError('');
    try { const url = await uploadImage(file); if (url) set('thumbnailUrl', url); else setError('Upload returned no URL.'); }
    catch (err) { setError(err.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function save() {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try { await saveSermon(f); onSaved(f); }
    catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head">
          <h2>{isNew ? 'Add sermon' : 'Edit sermon'}</h2>
          <button className="ap-modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="ap-modal-body">
          <div className="ap-field">
            <label className="ap-label">Title</label>
            <input className="ap-input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Sermon title" autoFocus />
          </div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Speaker</label><input className="ap-input" value={f.speaker} onChange={e => set('speaker', e.target.value)} placeholder="Pastor…" /></div>
            <div className="ap-field"><label className="ap-label">Date</label><input className="ap-input" value={f.date} onChange={e => set('date', e.target.value)} placeholder="Jun 22, 2026" /></div>
          </div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Series</label><input className="ap-input" value={f.series} onChange={e => set('series', e.target.value)} placeholder="Series name" /></div>
            <div className="ap-field"><label className="ap-label">Duration</label><input className="ap-input" value={f.duration} onChange={e => set('duration', e.target.value)} placeholder="42 min" /></div>
          </div>

          <div className="ap-field">
            <label className="ap-label">Thumbnail</label>
            <div className="ap-uploader">
              {f.thumbnailUrl ? <img className="ap-uploader-preview" src={f.thumbnailUrl} alt="" /> : <div className="ap-uploader-preview"><Icon d={P.folder} size={18} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
                <button type="button" className="ap-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={15} />Upload image</>}
                </button>
                <input className="ap-input" value={f.thumbnailUrl} onChange={e => set('thumbnailUrl', e.target.value)} placeholder="…or paste an image URL" />
              </div>
            </div>
          </div>

          <div className="ap-field">
            <label className="ap-label">Video link</label>
            <input className="ap-input" value={f.videoLink} onChange={e => set('videoLink', e.target.value)} placeholder="YouTube, HLS (.m3u8), Dropbox, or GCS URL" />
            <span className="ap-hint">Paste any supported link. Direct GCS upload can be added later.</span>
          </div>

          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Main verse</label><input className="ap-input" value={f.mainVerse} onChange={e => set('mainVerse', e.target.value)} placeholder="Matthew 13:24" /></div>
            <div className="ap-field" style={{ justifyContent: 'flex-end' }}>
              <label className="ap-switch">
                <input type="checkbox" checked={f.published} onChange={e => set('published', e.target.checked)} />
                <span className="ap-switch-track" />{f.published ? 'Published' : 'Draft'}
              </label>
            </div>
          </div>

          <div className="ap-field">
            <label className="ap-label">Notes / description</label>
            <textarea className="ap-textarea" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes shown in the app" />
          </div>

          {error && <div className="ap-banner error" style={{ margin: 0 }}><Icon d={P.close} size={16} />{error}</div>}
        </div>

        <div className="ap-modal-foot">
          <button className="ap-btn" onClick={onClose}>Cancel</button>
          <button className="ap-btn primary" onClick={save} disabled={saving}>
            {saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />{isNew ? 'Add to app' : 'Save changes'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
