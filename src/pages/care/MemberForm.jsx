import { alertDialog } from "../../lib/dialog";
import { useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { supabase } from '../../lib/supabase';
import {
  CATEGORIES, PRIORITIES, STATUSES, MEDICAL_CATEGORIES, saveMember,
} from '../../lib/care';
import './Modal.css';

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

export default function MemberForm({ member, onClose, onSaved }) {
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(member || {}) }));
  const [staff, setStaff] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    supabase.from('staff').select('id, name').then(({ data }) => setStaff(data || []));
  }, []);

  const showMedical = MEDICAL_CATEGORIES.includes(form.category);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function onAssign(id) {
    const s = staff.find(x => x.id === id);
    setForm(f => ({ ...f, assigned_to: id || null, assigned_name: s?.name || '' }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const { error } = await saveMember(form);
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>{member ? 'Edit Care Member' : 'Add Care Member'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <form className="modal-body" onSubmit={submit}>
          <Section title="Contact Info">
            <Field label="Full Name" required>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Jane Doe" />
            </Field>
            <Row>
              <Field label="Phone"><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></Field>
              <Field label="Email"><input value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@email.com" /></Field>
            </Row>
            <Field label="Address">
              <input value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" />
            </Field>
            <Field label="Family Member (optional)">
              <input value={form.family_member || ''} onChange={e => set('family_member', e.target.value)} placeholder="Linked relative" />
            </Field>
          </Section>

          <Section title="Care Classification">
            <Row>
              <Field label="Category">
                <select value={form.category} onChange={e => set('category', e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Status">
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Assigned To">
                <select value={form.assigned_to || ''} onChange={e => onAssign(e.target.value)}>
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </Row>
          </Section>

          {showMedical && (
            <Section title="Medical Details">
              <Row>
                <Field label="Hospital Name"><input value={form.hospital_name || ''} onChange={e => set('hospital_name', e.target.value)} /></Field>
                <Field label="Room #"><input value={form.room_number || ''} onChange={e => set('room_number', e.target.value)} /></Field>
              </Row>
              <Row>
                <Field label="Floor"><input value={form.floor || ''} onChange={e => set('floor', e.target.value)} /></Field>
                <Field label="Admission Date"><input type="date" value={form.admission_date || ''} onChange={e => set('admission_date', e.target.value)} /></Field>
              </Row>
              {form.category === 'Surgery' && (
                <Row>
                  <Field label="Surgery Type"><input value={form.surgery_type || ''} onChange={e => set('surgery_type', e.target.value)} /></Field>
                  <Field label="Surgery Date"><input type="date" value={form.surgery_date || ''} onChange={e => set('surgery_date', e.target.value)} /></Field>
                </Row>
              )}
              {form.category === 'Surgery' && (
                <Field label="Surgeon"><input value={form.surgeon_name || ''} onChange={e => set('surgeon_name', e.target.value)} /></Field>
              )}

              <div className="ins-head">
                <span>Insurance</span>
                <button type="button" className="ins-ocr" onClick={() => alertDialog('Insurance card OCR — coming soon. Snap a photo and fields auto-fill.')}>
                  <Icon d={P.grid} size={14} /> Scan card
                </button>
              </div>
              <Row>
                <Field label="Carrier"><input value={form.insurance_carrier || ''} onChange={e => set('insurance_carrier', e.target.value)} /></Field>
                <Field label="Plan Type"><input value={form.insurance_plan_type || ''} onChange={e => set('insurance_plan_type', e.target.value)} /></Field>
              </Row>
              <Row>
                <Field label="Policy #"><input value={form.insurance_policy || ''} onChange={e => set('insurance_policy', e.target.value)} /></Field>
                <Field label="Group #"><input value={form.insurance_group || ''} onChange={e => set('insurance_group', e.target.value)} /></Field>
              </Row>
              <Field label="Member ID"><input value={form.insurance_member_id || ''} onChange={e => set('insurance_member_id', e.target.value)} /></Field>
            </Section>
          )}

          <Section title="Care Notes">
            <Field label="">
              <textarea rows={4} value={form.care_notes || ''} onChange={e => set('care_notes', e.target.value)} placeholder="Detailed care notes…" />
            </Field>
          </Section>

          {error && <p className="modal-error">{error}</p>}
        </form>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : member ? 'Save Changes' : 'Add Member'}
          </button>
        </div>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div className="form-section">
    <p className="form-section-title">{title}</p>
    {children}
  </div>
);
const Field = ({ label, required, children }) => (
  <label className="field-group">
    {label && <span>{label}{required && <b> *</b>}</span>}
    {children}
  </label>
);
const Row = ({ children }) => <div className="field-row">{children}</div>;
