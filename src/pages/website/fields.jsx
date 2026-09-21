/*
 * The two controls every website editor needs. They lived inside the Home page
 * editor until the Calendar page needed them too — one copy, so a change to how
 * an upload behaves lands in both places rather than one.
 */
import { useState, useRef } from 'react';
import { P, Icon } from '../../lib/icons';
import { uploadWebsiteImage, resolveUrl } from '../../lib/websiteContent';

/* ── Image slot ────────────────────────────────────────────────────────────
 * Upload replaces the URL; Clear empties it. An empty slot means the website
 * paints nothing there, so Clear is for removing a photo, not for resetting
 * one — re-upload to put an image back. */
function ImageSlot({ label, hint, value, onChange, slotName, wide }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    const res = await uploadWebsiteImage(file, slotName || label);
    if (res.error) setErr(res.error); else onChange(res.url);
    setBusy(false);
    if (ref.current) ref.current.value = '';
  }

  return (
    <div className="wb-slot">
      <div className="ap-label">{label}</div>
      <div className="wb-slot-body">
        <div className={`wb-thumb ${wide ? 'wide' : ''}`}>
          {value
            ? <img src={resolveUrl(value)} alt="" />
            : <span className="wb-thumb-empty"><Icon d={P.folder} size={18} />No image</span>}
        </div>
        <div className="wb-slot-actions">
          <label className="ap-btn" style={{ cursor: 'pointer' }}>
            {busy ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={15} />{value ? 'Replace' : 'Upload'}</>}
            <input ref={ref} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
          </label>
          {value && (
            <button type="button" className="ap-btn" onClick={() => onChange('')}>
              <Icon d={P.trash} size={15} />Clear
            </button>
          )}
          {hint && <p className="ap-hint">{hint}</p>}
          {err && <p className="wb-err">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, textarea, ...rest }) {
  return (
    <div className="ap-field">
      <label className="ap-label">{label}</label>
      {textarea
        ? <textarea className="ap-textarea" value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />
        : <input className={rest.className || 'ap-input'} value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />}
      {hint && <p className="ap-hint">{hint}</p>}
    </div>
  );
}

export { ImageSlot, Field };
