import { useState, useEffect, useMemo, useRef } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  CATEGORIES, MEDICAL_CATEGORIES, CATEGORY_COLORS,
  SURGERY_RE, extractSurgeryType, saveMember,
} from '../../lib/care';
import { fetchChurchMembers } from '../../lib/members';
import { placeSuggest } from '../../lib/places';
import './Modal.css';
import '../guests/Guests.css';

const BLANK = {
  full_name: '', phone: '', email: '', address: '', family_member: '',
  category: 'Other', priority: 'Medium', status: 'Active',
  assigned_to: '', assigned_name: '',
  hospital_name: '', room_number: '', floor: '', admission_date: '',
  surgery_type: '', surgery_date: '', surgeon_name: '',
  insurance_carrier: '', insurance_policy: '', insurance_group: '',
  insurance_member_id: '', insurance_plan_type: '',
  care_notes: '',
};

const CATEGORY_ICONS = {
  Hospitalized: P.plus, Surgery: P.cross, Grieving: P.heart, 'New Member': P.star,
  Homebound: P.location, Crisis: P.announce, Pain: P.water, Sick: P.person,
  'Prayer Request': P.handshake, 'Follow Up': P.repeat, 'Test/Treatment': P.form,
  Recovering: P.check, Other: P.grid,
};

const STEP_LABELS = {
  who: 'Who', contact: 'Contact', type: 'Type', notes: 'Notes',
  procedure: 'Surgery', stay: 'Stay',
};
const STEP_QUESTIONS = {
  who: 'Who needs care?', contact: 'How do we reach them?', type: 'What kind of care?',
  notes: 'Care notes', procedure: 'Surgery details', stay: 'Hospital stay',
};

export default function MemberForm({ member, onClose, onSaved }) {
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(member || {}) }));
  const [step, setStep]   = useState(0);
  const [directory, setDirectory] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [autoType, setAutoType] = useState(false);   // surgery type came from notes
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    fetchChurchMembers().then(d => setDirectory(d.rows || []));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Surgery is in play when the category says so OR the notes mention it.
  const surgeryFlow = form.category === 'Surgery' || SURGERY_RE.test(form.care_notes || '');
  const medicalFlow = surgeryFlow || form.category === 'Hospitalized';

  // Steps appear/disappear with the flow — 2–3 fields each, guest-form style.
  const KEYS = useMemo(() => [
    'who', 'contact', 'type', 'notes',
    ...(surgeryFlow ? ['procedure'] : []),
    ...(medicalFlow ? ['stay'] : []),
  ], [surgeryFlow, medicalFlow]);
  const key = KEYS[Math.min(step, KEYS.length - 1)];
  const isLast = step >= KEYS.length - 1;

  // The watcher: whenever the notes change, keep Surgery Type in sync from
  // keywords — until the user types their own value (clearing the field
  // hands control back to the watcher). All decisions happen OUTSIDE the
  // state updater so React can never skip the companion updates.
  const autoRef = useRef(true);
  const detectedNow = surgeryFlow ? extractSurgeryType(form.care_notes) : '';
  useEffect(() => {
    if (!surgeryFlow) return;
    const manual = form.surgery_type && !autoRef.current;
    if (manual) return;
    if (detectedNow === (form.surgery_type || '')) return;
    autoRef.current = true;
    setAutoType(!!detectedNow);
    setForm(f => ({ ...f, surgery_type: detectedNow }));
  }, [form.care_notes, surgeryFlow]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Reaching the surgery step: correct a mismatched category, and re-run the
  // fill as a belt-and-suspenders pass in case the live watcher was missed.
  useEffect(() => {
    if (key !== 'procedure') return;
    setForm(f => (MEDICAL_CATEGORIES.includes(f.category) ? f : { ...f, category: 'Surgery' }));
    if (!form.surgery_type) {
      const d = extractSurgeryType(form.care_notes);
      if (d) { autoRef.current = true; setAutoType(true); setForm(f => ({ ...f, surgery_type: d })); }
    }
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Name autocomplete against the member directory (church_members).
  const suggestions = useMemo(() => {
    const q = form.full_name.trim().toLowerCase();
    if (!q) return [];
    return directory.filter(m => (m.name || '').toLowerCase().includes(q)).slice(0, 5);
  }, [directory, form.full_name]);

  function pickDirectory(m) {
    setForm(f => ({
      ...f,
      full_name: m.name || f.full_name,
      phone: m.phone || f.phone,
      email: m.email || f.email,
      address: m.address || f.address,
    }));
    setShowSug(false);
  }

  function next() {
    if (key === 'who' && !form.full_name.trim()) { setError('Name is required.'); return; }
    setError('');
    setStep(s => Math.min(s + 1, KEYS.length - 1));
  }

  async function submit() {
    if (!form.full_name.trim()) { setError('Name is required.'); setStep(0); return; }
    setSaving(true); setError('');
    const isNew = !member?.id;
    const { data, error } = await saveMember(form);
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved({ isNew, member: data || form });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>{member ? 'Edit Care Member' : 'Add Care Member'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        {/* Step indicator — same chips as the guest form */}
        <div className={`gf-steps ${KEYS.length > 5 ? 'wrap' : ''}`}>
          {KEYS.map((k, i) => (
            <div key={k} className={`gf-step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}
              onClick={() => setStep(i)}>
              <span className="gf-step-num">{step > i ? <Icon d={P.check} size={13} /> : i + 1}</span>
              <span>{STEP_LABELS[k]}</span>
            </div>
          ))}
        </div>

        <form className="modal-body" onSubmit={e => { e.preventDefault(); isLast ? submit() : next(); }}>
          <p className="gf-q">{STEP_QUESTIONS[key]}</p>

          {key === 'who' && (<>
            <Field label="Full Name" required>
              <input
                value={form.full_name}
                onChange={e => { set('full_name', e.target.value); setShowSug(true); }}
                onFocus={() => { if (form.full_name.trim()) setShowSug(true); }}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
                onKeyDown={e => e.key === 'Escape' && setShowSug(false)}
                placeholder="Start typing a name…"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {showSug && suggestions.length > 0 && (
              /* In-flow (not floating) so the modal grows and nothing clips —
                 every suggestion is visible without scrolling. */
              <div className="cf-ac-list">
                {suggestions.map(m => (
                  <button type="button" key={m.id} className="cf-ac-item" onMouseDown={() => pickDirectory(m)}>
                    <span className="cf-ac-name">{m.name}</span>
                    <span className="cf-ac-sub">{[m.phone, m.email].filter(Boolean).join(' · ') || 'No contact info'}</span>
                  </button>
                ))}
              </div>
            )}
            <Row>
              <Field label="Phone"><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></Field>
              <Field label="Email"><input value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@email.com" /></Field>
            </Row>
          </>)}

          {key === 'contact' && (<>
            <Field label="Address">
              <input value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" />
            </Field>
            <Field label="Family Member (optional)">
              <input value={form.family_member || ''} onChange={e => set('family_member', e.target.value)} placeholder="Linked relative" />
            </Field>
          </>)}

          {key === 'type' && (
            <div className="cp-grid">
              {CATEGORIES.map(c => (
                <button key={c} type="button"
                  className={`cp-card ${form.category === c ? 'on' : ''}`}
                  style={{ '--tc': CATEGORY_COLORS[c] || '#6B7280' }}
                  onClick={() => set('category', c)}>
                  <span className="cp-icon"><Icon d={CATEGORY_ICONS[c] || P.person} size={16} /></span>
                  <span className="cp-name">{c}</span>
                  {form.category === c && <Icon d={P.check} size={14} className="cp-check" />}
                </button>
              ))}
            </div>
          )}


          {key === 'notes' && (<>
            <Field label="">
              <HighlightNotes
                value={form.care_notes || ''}
                onChange={v => set('care_notes', v)}
                placeholder="Detailed care notes… (mentioning surgery adds surgery steps)"
              />
            </Field>
            {surgeryFlow && (
              <p className="cp-surg-hint"><Icon d={P.cross} size={13} />
                {detectedNow
                  ? <>Surgery detected — type: <strong>{detectedNow}</strong>. Details on the next steps.</>
                  : <>Surgery detected — the next steps collect the details.</>}
              </p>
            )}
          </>)}

          {key === 'procedure' && (<>
            <Field label="Hospital">
              <HospitalField value={form.hospital_name || ''} onChange={v => set('hospital_name', v)} />
            </Field>
            <Row>
              <Field label={autoType && form.surgery_type ? 'Surgery Type · detected from notes' : 'Surgery Type'}>
                <input
                  value={form.surgery_type || ''}
                  onChange={e => { autoRef.current = e.target.value === ''; setAutoType(false); set('surgery_type', e.target.value); }}
                  placeholder="Auto-fills from care notes"
                />
              </Field>
            </Row>
            <CareDatePicker label="Surgery Date" value={form.surgery_date || ''} onChange={v => set('surgery_date', v)} />
          </>)}

          {key === 'stay' && (<>
            {!surgeryFlow && (
              <Field label="Hospital">
                <HospitalField value={form.hospital_name || ''} onChange={v => set('hospital_name', v)} />
              </Field>
            )}
            <Row>
              <Field label="Room #"><input value={form.room_number || ''} onChange={e => set('room_number', e.target.value)} /></Field>
              <Field label="Floor"><input value={form.floor || ''} onChange={e => set('floor', e.target.value)} /></Field>
            </Row>
            <CareDatePicker label="Admission Date" value={form.admission_date || ''} onChange={v => set('admission_date', v)} />
          </>)}


          {error && <p className="modal-error">{error}</p>}
        </form>

        <div className="modal-foot">
          {step > 0
            ? <button className="btn-ghost" onClick={() => { setError(''); setStep(s => s - 1); }}>Back</button>
            : <button className="btn-ghost" onClick={onClose}>Cancel</button>}
          {isLast
            ? <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : member ? 'Save Changes' : 'Add Member'}</button>
            : <button className="btn-primary" onClick={next}>Continue</button>}
        </div>
      </div>
    </div>
  );
}

/* Care notes with the word "surgery" pulsing bright purple as you type.
   The backdrop carries the visible text (marks color the word itself); the
   textarea's own glyphs are transparent with a visible caret on top. */
function HighlightNotes({ value, onChange, placeholder }) {
  const taRef = useRef(null);
  const bgRef = useRef(null);

  const html = useMemo(() => {
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return esc(value).replace(/(surger(?:y|ies|ical))/gi, '<mark class="cp-surg-mark">$1</mark>') + '\n';
  }, [value]);

  const sync = () => { if (bgRef.current && taRef.current) bgRef.current.scrollTop = taRef.current.scrollTop; };

  return (
    <div className="cp-hl-wrap">
      <div className="cp-hl-bg" ref={bgRef} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={taRef}
        className="cp-hl-ta"
        rows={5}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={sync}
        placeholder={placeholder}
        autoFocus
      />
    </div>
  );
}

/* Hospital lookup — Google Places, hospitals only. */
function HospitalField({ value, onChange }) {
  const [sug, setSug] = useState([]);
  const [show, setShow] = useState(false);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = String(value || '').trim();
    if (q.length < 3) { setSug([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => { placeSuggest(q, ctrl.signal, 'hospital').then(setSug); }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [value]);

  function pick(s) {
    skip.current = true;
    onChange(s.main);
    setSug([]); setShow(false);
  }

  return (
    <div className="cf-ac">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setShow(true); }}
        onFocus={() => { if (sug.length) setShow(true); }}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        onKeyDown={e => e.key === 'Escape' && setShow(false)}
        placeholder="Start typing a hospital…"
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
  );
}

/* Large in-flow calendar. Expands inside the form (the modal grows), so it
   can never be clipped small the way the native popup was. */
function CareDatePicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const m = String(value || '').match(/^(\d{4})-(\d{2})/);
    const now = new Date();
    return m ? new Date(+m[1], +m[2] - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = iso(new Date());
  const pretty = v => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthLabel = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shift = n => setView(v => new Date(v.getFullYear(), v.getMonth() + n, 1));

  return (
    <div className="field-group">
      <span>{label}</span>
      <button type="button" className={`cdp-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
        <Icon d={P.calendar} size={16} />
        <span className={value ? '' : 'cdp-placeholder'}>{value ? pretty(value) : 'Pick a date…'}</span>
        <Icon d={P.chevron} size={16} className="cdp-caret" />
      </button>

      {open && (
        <div className="cdp-panel">
          <div className="cdp-head">
            <button type="button" className="cdp-nav" onClick={() => shift(-1)} aria-label="Previous month"><Icon d={P.chevL} size={18} /></button>
            <span className="cdp-month">{monthLabel}</span>
            <button type="button" className="cdp-nav" onClick={() => shift(1)} aria-label="Next month"><Icon d={P.chevR} size={18} /></button>
          </div>
          <div className="cdp-grid cdp-dow">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="cdp-grid">
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const dv = iso(new Date(view.getFullYear(), view.getMonth(), d));
              return (
                <button type="button" key={dv}
                  className={`cdp-day ${dv === value ? 'sel' : ''} ${dv === today ? 'today' : ''}`}
                  onClick={() => { onChange(dv); setOpen(false); }}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="cdp-foot">
            <button type="button" className="cdp-link" onClick={() => { onChange(today); setOpen(false); setView(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); }}>Today</button>
            {value && <button type="button" className="cdp-link danger" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, required, children }) => (
  <label className="field-group">
    {label && <span>{label}{required && <b> *</b>}</span>}
    {children}
  </label>
);
const Row = ({ children }) => <div className="field-row">{children}</div>;
