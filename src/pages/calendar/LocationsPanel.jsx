import { useState, useEffect, useRef, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { confirmDialog, alertDialog } from '../../lib/dialog';
import {
  fetchLocations, createLocation, updateLocation, renameLocation,
  deleteLocation, uploadLocationPhoto, locationKey,
} from '../../lib/locations';
import { fetchEvents } from '../../lib/calendar';
import './locations.css';

const kb = n => `${Math.round(n / 1024)} KB`;

/* Staff see these, not developers. An RLS refusal here means the session is no
   longer authenticated, so say that rather than quoting Postgres. */
const friendly = (msg = '') =>
  /row-level security|JWT|not authenticated|permission denied/i.test(msg)
    ? 'Your sign-in has expired. Refresh the page and sign in again to change locations.'
    : msg || 'Something went wrong.';

/*
 * The locations list itself, with no surrounding chrome — rendered both as a
 * modal from the calendar and as a section in Admin > Email. One component so
 * the two surfaces cannot drift apart.
 */
export default function LocationsPanel({ onChanged }) {
  const [rows, setRows]       = useState([]);
  const [counts, setCounts]   = useState({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding]   = useState('');
  const [editId, setEditId]   = useState(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy]       = useState('');
  const [error, setError]     = useState('');
  const fileRef = useRef(null);
  const uploadFor = useRef(null);

  async function load() {
    setLoading(true);
    const [locs, events] = await Promise.all([fetchLocations(), fetchEvents()]);
    setRows(locs.rows);
    setMissing(locs.missing);
    const tally = {};
    for (const e of events || []) {
      const k = locationKey(e.location);
      if (k) tally[k] = (tally[k] || 0) + 1;
    }
    setCounts(tally);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const used = l => counts[locationKey(l.name)] || 0;
  const withPhotos = useMemo(() => rows.filter(r => r.photo_url).length, [rows]);

  async function add() {
    const name = adding.trim();
    if (!name) return;
    setBusy('add'); setError('');
    const { error: err } = await createLocation(name);
    setBusy('');
    if (err) return setError(/duplicate|unique/i.test(err.message) ? `"${name}" already exists.` : friendly(err.message));
    setAdding('');
    await load(); onChanged?.();
  }

  async function saveRename(l) {
    const next = editName.trim();
    if (!next || next === l.name) { setEditId(null); return; }
    setBusy(l.id); setError('');
    const res = await renameLocation(l.id, l.name, next);
    setBusy(''); setEditId(null);
    if (res.error) return setError(friendly(res.error.message));
    if (res.eventsError) {
      await alertDialog({
        title: 'Renamed, but events were not updated',
        message: `"${next}" was saved, but the events still say "${l.name}" (${res.eventsError.message}). Those events will not show a photo until this is fixed.`,
      });
    } else if (res.eventsUpdated) {
      await alertDialog({ title: 'Renamed', message: `${res.eventsUpdated} event${res.eventsUpdated === 1 ? '' : 's'} updated to "${next}".` });
    }
    await load(); onChanged?.();
  }

  function pickPhoto(l) { uploadFor.current = l; fileRef.current?.click(); }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const l = uploadFor.current;
    if (!file || !l) return;
    setBusy(l.id); setError('');
    try {
      const up = await uploadLocationPhoto(file, l.name);
      if (up.error) throw up.error;
      const { error: err } = await updateLocation(l.id, { photo_url: up.url });
      if (err) throw err;
      await load(); onChanged?.();
      await alertDialog({
        title: 'Photo added',
        message: `${l.name} — ${up.width}×${up.height}, ${kb(up.size)} (down from ${kb(file.size)}).`,
      });
    } catch (err) {
      setError(friendly(err.message));
    } finally { setBusy(''); }
  }

  async function removePhoto(l) {
    setBusy(l.id);
    await updateLocation(l.id, { photo_url: null });
    setBusy('');
    await load(); onChanged?.();
  }

  async function remove(l) {
    const n = used(l);
    /* events.location stores the name, so deleting a location cannot cascade —
       the events keep their text and simply stop resolving to a photo. */
    const ok = await confirmDialog({
      title: `Delete ${l.name}?`,
      message: n
        ? `${n} event${n === 1 ? ' still uses' : 's still use'} this location. Deleting it does not change those events — they keep the name "${l.name}" but lose their photo on the website. This cannot be undone.`
        : 'No events use this location. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setBusy(l.id);
    const { error: err } = await deleteLocation(l.id);
    setBusy('');
    if (err) return setError(friendly(err.message));
    await load(); onChanged?.();
  }

  return (
    <>
      {missing ? (
        <p className="lm-empty">Run <code>supabase/locations-schema.sql</code> to enable locations.</p>
      ) : (<>
        <p className="lm-intro">
          Rooms and spaces you can pick when creating an event. The photo shows on the church
          website's event popup.{rows.length > 0 && ` ${withPhotos} of ${rows.length} have one.`}
        </p>

        <div className="lm-add">
          <input value={adding} placeholder="New location name"
            onChange={e => { setAdding(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button className="btn-primary" onClick={add} disabled={!adding.trim() || busy === 'add'}>
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p className="modal-error">{error}</p>}

        {loading ? <p className="lm-empty">Loading…</p>
          : rows.length === 0 ? <p className="lm-empty">No locations yet.</p>
          : (
            <ul className="lm-list">
              {rows.map(l => (
                <li key={l.id} className={`lm-row ${busy === l.id ? 'busy' : ''}`}>
                  {l.photo_url
                    ? <img className="lm-thumb" src={l.photo_url} alt="" loading="lazy" />
                    : <span className="lm-thumb lm-thumb-empty"><Icon d={P.location} size={18} /></span>}

                  <div className="lm-main">
                    {editId === l.id ? (
                      <input className="lm-rename" value={editName} autoFocus
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveRename(l); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        onBlur={() => saveRename(l)} />
                    ) : (
                      <span className="lm-name">{l.name}</span>
                    )}
                    <span className="lm-sub">
                      {used(l) ? `${used(l)} event${used(l) === 1 ? '' : 's'}` : 'Not used yet'}
                      {!l.photo_url && ' · no photo'}
                    </span>
                  </div>

                  <div className="lm-acts">
                    <button className="lm-btn" onClick={() => { setEditId(l.id); setEditName(l.name); }}
                      title="Rename" aria-label={`Rename ${l.name}`}><Icon d={P.edit} size={14} /></button>
                    <button className="lm-btn" onClick={() => pickPhoto(l)} disabled={busy === l.id}
                      title={l.photo_url ? 'Replace photo' : 'Add photo'}>
                      <Icon d={P.folder} size={14} />{l.photo_url ? 'Replace' : 'Photo'}
                    </button>
                    {l.photo_url && (
                      <button className="lm-btn" onClick={() => removePhoto(l)} disabled={busy === l.id}
                        title="Remove photo" aria-label={`Remove photo from ${l.name}`}>Clear</button>
                    )}
                    <button className="lm-btn danger" onClick={() => remove(l)} disabled={busy === l.id}
                      title="Delete" aria-label={`Delete ${l.name}`}><Icon d={P.trash} size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </>)}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </>
  );
}
