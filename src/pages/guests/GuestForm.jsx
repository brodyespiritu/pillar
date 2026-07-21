import { useState, useEffect, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { supabase } from '../../lib/supabase';
import {
  STATUSES, RELATIONS, composeFullName, saveGuest, TYPE_COLORS,
} from '../../lib/guests';
import '../care/Modal.css';
import './Guests.css';

const today = () => new Date().toISOString().slice(0, 10);

function parseName(full = '') {
  // best-effort split of "First + Spouse, Last. with ..."
  const [namePart] = full.split('.');
  let first = namePart, spouse = '', last = '';
  const comma = namePart.lastIndexOf(',');
  if (comma !== -1) { last = namePart.slice(comma + 1).trim(); }
  const left = comma !== -1 ? namePart.slice(0, comma) : namePart;
  const plus = left.split('+');
  first = (plus[0] || '').trim();
  spouse = (plus[1] || '').trim();
  return { first, last, spouse };
}

export default function GuestForm({ type, guest, onClose, onSaved }) {
  const editing = !!guest;
  const parsed = editing ? parseName(guest.full_name) : { first: '', last: '', spouse: '' };

  const [step, setStep] = useState(1);
  const [first, setFirst] = useState(parsed.first);
  const [last, setLast]   = useState(parsed.last);
  const [spouse, setSpouse] = useState(parsed.spouse);
  const [showSpouse, setShowSpouse] = useState(!!parsed.spouse);
  const [family, setFamily] = useState(guest?.family || []);
  const [absence, setAbsence] = useState(guest?.absence_type || '');
  const [notProspect, setNotProspect] = useState(guest?.not_prospect || false);

  const [phone, setPhone]   = useState(guest?.phone || '');
  const [email, setEmail]   = useState(guest?.email || '');
  const [address, setAddress] = useState(guest?.address || '');

  const [firstVisit, setFirstVisit] = useState(guest?.first_visit || today());
  const [lastVisit, setLastVisit]   = useState(guest?.last_visit || today());
  const [status, setStatus] = useState(guest?.status || 'Active');
  const [assignedTo, setAssignedTo] = useState(guest?.assigned_to || '');
  const [assignedName, setAssignedName] = useState(guest?.assigned_name || '');
  const [notes, setNotes]   = useState(guest?.notes || '');

  const [staff, setStaff] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    supabase.from('staff').select('id, name').then(({ data }) => setStaff(data || []));
  }, []);

  const isReturning = type === 'Returning Guest/Member';
  const isProspectType = type === 'Prospect';
  const color = TYPE_COLORS[type] || '#3B82F6';

  const preview = useMemo(() => composeFullName(first, last, spouse, family), [first, last, spouse, family]);

  const addFamily    = () => setFamily(f => [...f, { relation: 'Son', name: '', age: '' }]);
  const updateFamily = (i, k, v) => setFamily(f => f.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const removeFamily = i => setFamily(f => f.filter((_, idx) => idx !== i));

  function onAssign(id) {
    const s = staff.find(x => x.id === id);
    setAssignedTo(id); setAssignedName(s?.name || '');
  }

  async function submit() {
    if (!first.trim()) { setStep(1); setError('First name is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      id: guest?.id,
      full_name: preview,
      type,
      phone, email, address,
      first_visit: firstVisit, last_visit: lastVisit,
      assigned_to: assignedTo || null, assigned_name: assignedName,
      status, notes,
      spouse, family,
      absence_type: isReturning ? absence : null,
      not_prospect: isProspectType ? notProspect : false,
    };
    const { error } = await saveGuest(payload);
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <div className="gf-type" style={{ '--tc': color }}>{type}</div>
            <h2>{editing ? 'Edit Entry' : 'New Entry'}</h2>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        {/* Step indicator */}
        <div className="gf-steps">
          {['Who', 'Contact', 'Visit'].map((s, i) => (
            <div key={s} className={`gf-step ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'done' : ''}`}
              onClick={() => setStep(i + 1)}>
              <span className="gf-step-num">{step > i + 1 ? <Icon d={P.check} size={13} /> : i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>

        <div className="modal-body">
          {step === 1 && (
            <>
              <p className="gf-q">Who are we tracking?</p>
              <div className="field-row">
                <label className="field-group"><span>First Name <b>*</b></span>
                  <input value={first} onChange={e => setFirst(e.target.value)} placeholder="John" autoFocus />
                </label>
                <label className="field-group"><span>Last Name</span>
                  <input value={last} onChange={e => setLast(e.target.value)} placeholder="Smith" />
                </label>
              </div>

              {!showSpouse ? (
                <button className="gf-add-link" onClick={() => setShowSpouse(true)}><Icon d={P.plus} size={14} />Add Spouse</button>
              ) : (
                <label className="field-group"><span>Spouse</span>
                  <input value={spouse} onChange={e => setSpouse(e.target.value)} placeholder="Jane" />
                </label>
              )}

              {family.map((f, i) => (
                <div key={i} className="gf-family-row">
                  <select value={f.relation} onChange={e => updateFamily(i, 'relation', e.target.value)}>
                    {RELATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                  <input placeholder="Name" value={f.name} onChange={e => updateFamily(i, 'name', e.target.value)} />
                  <input placeholder="Age" style={{ maxWidth: 70 }} value={f.age} onChange={e => updateFamily(i, 'age', e.target.value)} />
                  <button className="gf-family-x" onClick={() => removeFamily(i)}><Icon d={P.close} size={16} /></button>
                </div>
              ))}
              <button className="gf-add-link" onClick={addFamily}><Icon d={P.plus} size={14} />Add Family Member</button>

              {isReturning && (
                <div className="gf-field">
                  <span className="gf-label">Absence</span>
                  <div className="gf-toggle-row">
                    {['Brief', 'Long'].map(a => (
                      <button key={a} className={`gf-toggle ${absence === a ? 'on' : ''}`} onClick={() => setAbsence(a)}>
                        {a} absence
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isProspectType && (
                <label className="gf-checkbox">
                  <input type="checkbox" checked={notProspect} onChange={e => setNotProspect(e.target.checked)} />
                  Not actually a prospect
                </label>
              )}

              {preview && (
                <div className="gf-preview">
                  <span className="gf-preview-label">Preview</span>
                  <span className="gf-preview-name">{preview}</span>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="gf-q">Contact details</p>
              <label className="field-group"><span>Phone</span>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
              </label>
              <label className="field-group"><span>Email</span>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="john@email.com" />
              </label>
              <label className="field-group"><span>Address</span>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, City, State" />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <p className="gf-q">Visit & follow-up</p>
              <div className="field-row">
                <label className="field-group"><span>First Visit</span>
                  <input type="date" value={firstVisit} onChange={e => setFirstVisit(e.target.value)} />
                </label>
                <label className="field-group"><span>Last Visit</span>
                  <input type="date" value={lastVisit} onChange={e => setLastVisit(e.target.value)} />
                </label>
              </div>
              <div className="field-row">
                <label className="field-group"><span>Status</span>
                  <select value={status} onChange={e => setStatus(e.target.value)}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="field-group"><span>Assigned To</span>
                  <select value={assignedTo || ''} onChange={e => onAssign(e.target.value)}>
                    <option value="">Unassigned</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="field-group"><span>Notes</span>
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Follow-up notes…" />
              </label>
            </>
          )}

          {error && <p className="modal-error">{error}</p>}
        </div>

        <div className="modal-foot">
          {step > 1
            ? <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>
            : <button className="btn-ghost" onClick={onClose}>Cancel</button>}
          {step < 3
            ? <button className="btn-primary" onClick={() => setStep(step + 1)}>Continue</button>
            : <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Entry'}</button>}
        </div>
      </div>
    </div>
  );
}
