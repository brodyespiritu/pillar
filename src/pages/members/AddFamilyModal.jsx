import { useState, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  initials, newFamilyId, lastNameFamily, updateFamilyLink, saveChurchMember,
} from '../../lib/members';
import '../care/Modal.css';
import './Members.css';

const POSITIONS = ['Spouse', 'Child', 'Other'];

/* Add a spouse/child to a member's household — link an existing person or
   create a new one. Everyone shares one family_id + family_name so they group. */
export default function AddFamilyModal({ current, rows, onClose, onAdded }) {
  const [position, setPosition] = useState('Spouse');
  const [mode, setMode] = useState('existing');   // 'existing' | 'new'
  const [search, setSearch] = useState('');
  const [nf, setNf] = useState({ name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rows.filter(m =>
      m.id !== current.id &&
      (m.name || '').toLowerCase().includes(q) &&
      !(current.family_id && m.family_id === current.family_id)
    ).slice(0, 8);
  }, [rows, search, current]);

  // Make sure the current member anchors a household; return its id + name.
  async function ensureHousehold() {
    const id = current.family_id || newFamilyId();
    const name = current.family_name || lastNameFamily(current.name);
    if (!current.family_id) {
      await updateFamilyLink(current.id, {
        family_id: id, family_name: name, family_position: current.family_position || 'Head',
      });
    }
    return { id, name };
  }

  async function addExisting(target) {
    setBusy(true); setError('');
    const fam = await ensureHousehold();
    const { error } = await updateFamilyLink(target.id, {
      family_id: fam.id, family_name: fam.name, family_position: position,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onAdded();
  }

  async function addNew() {
    if (!nf.name.trim()) return setError('Name is required.');
    setBusy(true); setError('');
    const fam = await ensureHousehold();
    const { error } = await saveChurchMember({
      name: nf.name.trim(), phone: nf.phone.trim() || null, email: nf.email.trim() || null,
      family_id: fam.id, family_name: fam.name, family_position: position, status: 'Active',
    });
    setBusy(false);
    if (error) return setError(error.message);
    onAdded();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>Add to {current.name}'s family</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          <label className="field-group"><span>Relationship</span>
            <select value={position} onChange={e => setPosition(e.target.value)}>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>

          <div className="af-tabs">
            <button className={`af-tab ${mode === 'existing' ? 'on' : ''}`} onClick={() => setMode('existing')}>Link existing person</button>
            <button className={`af-tab ${mode === 'new' ? 'on' : ''}`} onClick={() => setMode('new')}>Create new</button>
          </div>

          {mode === 'existing' ? (
            <div className="mg-add" style={{ marginTop: 4 }}>
              <Icon d={P.search} size={16} className="mg-add-ic" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members by name…" autoFocus />
              {candidates.length > 0 && (
                <div className="mg-add-menu">
                  {candidates.map(m => (
                    <button key={m.id} className="mg-add-item" disabled={busy} onClick={() => addExisting(m)}>
                      <span>{m.name}</span><Icon d={P.plus} size={14} />
                    </button>
                  ))}
                </div>
              )}
              {search.trim() && candidates.length === 0 && <p className="mg-empty">No match — try "Create new" instead.</p>}
            </div>
          ) : (
            <>
              <label className="field-group"><span>Full Name <b>*</b></span>
                <input value={nf.name} onChange={e => setNf(v => ({ ...v, name: e.target.value }))} placeholder="Jane Doe" autoFocus />
              </label>
              <div className="field-row">
                <label className="field-group"><span>Phone</span><input value={nf.phone} onChange={e => setNf(v => ({ ...v, phone: e.target.value }))} placeholder="(555) 123-4567" /></label>
                <label className="field-group"><span>Email</span><input value={nf.email} onChange={e => setNf(v => ({ ...v, email: e.target.value }))} placeholder="jane@email.com" /></label>
              </div>
            </>
          )}

          {error && <p className="modal-error">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          {mode === 'new' && <button className="btn-primary" onClick={addNew} disabled={busy}>{busy ? 'Adding…' : `Add ${position}`}</button>}
        </div>
      </div>
    </div>
  );
}
