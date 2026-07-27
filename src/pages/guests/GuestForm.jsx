import { useState, useEffect, useMemo, useRef } from 'react';
import { P, Icon } from '../../lib/icons';
import { supabase } from '../../lib/supabase';
import {
  STATUSES, RELATIONS, composeFullName, saveGuest, TYPE_COLORS,
  splitAddress, joinAddress, gradeOptions,
} from '../../lib/guests';
import { placeSuggest, placeDetails } from '../../lib/places';
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
  const [addr, setAddr] = useState(() => splitAddress(guest?.address));
  const setAddrField = (k, v) => setAddr(a => ({ ...a, [k]: v }));
  const [addrSug, setAddrSug] = useState([]);
  const [showAddr, setShowAddr] = useState(false);
  const skipLookup = useRef(false);   // don't re-query a street we just filled in

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

  // Address prediction — debounced so we don't fire a lookup on every keystroke.
  useEffect(() => {
    if (skipLookup.current) { skipLookup.current = false; return; }
    const q = addr.street.trim();
    if (q.length < 3) { setAddrSug([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      placeSuggest(q, ctrl.signal).then(setAddrSug);
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [addr.street]);

  // Fill every box from the chosen address.
  async function chooseAddress(s) {
    setShowAddr(false);
    setAddrSug([]);
    skipLookup.current = true;
    const d = await placeDetails(s.placeId);
    setAddr(a => (d
      ? {
        street: d.street || s.main || a.street,
        line2:  d.line2  || a.line2,
        city:   d.city   || a.city,
        state:  d.state  || a.state,
        zip:    d.zip    || a.zip,
      }
      : { ...a, street: s.main || a.street }));
  }

  const isReturning = type === 'Returning Guest/Member';
  const isProspectType = type === 'Prospect';
  const color = TYPE_COLORS[type] || '#3B82F6';

  const preview = useMemo(() => composeFullName(first, last, spouse, family), [first, last, spouse, family]);

  const addFamily    = () => setFamily(f => [...f, { relation: 'Son', name: '', age: '' }]);
  const updateFamily = (i, k, v) => setFamily(f => f.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const patchFamily  = (i, patch) => setFamily(f => f.map((x, idx) => idx === i ? { ...x, ...patch } : x));
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
      phone, email, address: joinAddress(addr),
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
                <div key={i} className="gf-family-block">
                  <div className="gf-family-row">
                    <select value={f.relation} onChange={e => updateFamily(i, 'relation', e.target.value)}>
                      {RELATIONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                    <input placeholder="Name" value={f.name} onChange={e => updateFamily(i, 'name', e.target.value)} />
                    <input className="gf-age" placeholder="Age" value={f.age} onChange={e => updateFamily(i, 'age', e.target.value)} />
                    <button className="gf-family-x" onClick={() => removeFamily(i)}><Icon d={P.close} size={16} /></button>
                  </div>
                  {f.school == null ? (
                    <button type="button" className="gf-add-school" onClick={() => updateFamily(i, 'school', '')}>
                      <Icon d={P.plus} size={12} />Add school
                    </button>
                  ) : (
                    <SchoolField
                      school={f.school}
                      grade={f.grade}
                      onSchool={v => patchFamily(i, { school: v, grade: gradeOptions(v).includes(f.grade) ? f.grade : '' })}
                      onGrade={v => patchFamily(i, { grade: v })}
                      onRemove={() => patchFamily(i, { school: null, grade: null })}
                    />
                  )}
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
              <label className="field-group"><span>Street Address</span>
                <div className="cf-ac">
                  <input
                    value={addr.street}
                    onChange={e => { setAddrField('street', e.target.value); setShowAddr(true); }}
                    onFocus={() => { if (addrSug.length) setShowAddr(true); }}
                    onBlur={() => setTimeout(() => setShowAddr(false), 150)}
                    onKeyDown={e => e.key === 'Escape' && setShowAddr(false)}
                    placeholder="Start typing an address…"
                    autoComplete="off"
                  />
                  {showAddr && addrSug.length > 0 && (
                    <div className="cf-ac-menu">
                      {addrSug.map(s => (
                        <button
                          type="button"
                          key={s.placeId}
                          className="cf-ac-item"
                          onMouseDown={() => chooseAddress(s)}
                        >
                          <span className="cf-ac-name">{s.main}</span>
                          <span className="cf-ac-sub">{s.secondary}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <label className="field-group"><span>Apt / Suite <em>(optional)</em></span>
                <input
                  value={addr.line2}
                  onChange={e => setAddrField('line2', e.target.value)}
                  placeholder="Apt 4B"
                  autoComplete="address-line2"
                />
              </label>
              <div className="field-row gf-addr-row">
                <label className="field-group gf-city"><span>City</span>
                  <input
                    value={addr.city}
                    onChange={e => setAddrField('city', e.target.value)}
                    placeholder="Columbus"
                    autoComplete="address-level2"
                  />
                </label>
                <label className="field-group gf-state"><span>State</span>
                  <input
                    value={addr.state}
                    onChange={e => setAddrField('state', e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="GA"
                    maxLength={2}
                    autoComplete="address-level1"
                  />
                </label>
                <label className="field-group gf-zip"><span>ZIP Code</span>
                  <input
                    value={addr.zip}
                    onChange={e => setAddrField('zip', e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
                    placeholder="31909"
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                </label>
              </div>
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

/* School lookup for a family member — Google Places, filtered to schools.
   The grade list narrows to whatever the chosen school actually serves. */
function SchoolField({ school, grade, onSchool, onGrade, onRemove }) {
  const [sug, setSug] = useState([]);
  const [show, setShow] = useState(false);
  const skip = useRef(false);   // don't re-query the name we just picked

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = String(school || '').trim();
    if (q.length < 3) { setSug([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => { placeSuggest(q, ctrl.signal, 'school').then(setSug); }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [school]);

  function pick(s) {
    skip.current = true;
    onSchool(s.main);
    setSug([]);
    setShow(false);
  }

  const grades = gradeOptions(school);

  return (
    <div className="gf-school-row">
      <div className="cf-ac gf-school-ac">
        <input
          value={school || ''}
          onChange={e => { onSchool(e.target.value); setShow(true); }}
          onFocus={() => { if (sug.length) setShow(true); }}
          onBlur={() => setTimeout(() => setShow(false), 150)}
          onKeyDown={e => e.key === 'Escape' && setShow(false)}
          placeholder="Start typing a school…"
          autoComplete="off"
        />
        {show && sug.length > 0 && (
          <div className="cf-ac-menu">
            {sug.map(s => (
              <button type="button" key={s.placeId} className="cf-ac-item" onMouseDown={() => pick(s)}>
                <span className="cf-ac-name">{s.main}</span>
                <span className="cf-ac-sub">{s.secondary}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <select className="gf-grade" value={grade || ''} onChange={e => onGrade(e.target.value)} aria-label="Grade">
        <option value="">Grade</option>
        {grades.map(g => <option key={g} value={g}>{g}</option>)}
      </select>
      <button type="button" className="gf-family-x" onClick={onRemove} title="Remove school">
        <Icon d={P.close} size={15} />
      </button>
    </div>
  );
}
