import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { ROLES, normalizeRole } from '../../lib/admin';
import { toE164, formatAsTyped, formatUsPhone, isValidUsPhone, phoneKey } from '../../lib/phone';
import '../care/Modal.css';

export default function EditUserModal({ user, testMode, onClose, onSave }) {
  const [name, setName]   = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [role, setRole]   = useState(normalizeRole(user.role));
  const [dept, setDept]   = useState(user.department || '');
  const [active, setActive] = useState(user.active !== false);
  const [phone, setPhone] = useState(formatUsPhone(user.phone || ''));
  const [caresSms, setCaresSms] = useState(user.preferences?.caresSmsOptIn === true);
  const [phoneErr, setPhoneErr] = useState('');
  const [saving, setSaving] = useState(false);

  const canOptIn = isValidUsPhone(phone);
  const optedOutBySms = user.preferences?.caresStopOptedOut === true;

  function onPhone(v) {
    setPhone(formatAsTyped(v));
    setPhoneErr('');
    if (!isValidUsPhone(v)) setCaresSms(false);   // no number, no alerts
  }

  async function save() {
    if (phone.trim() && !canOptIn) return setPhoneErr('Enter a 10-digit US mobile number.');
    setSaving(true);
    const e164 = toE164(phone);
    const prefs = { ...(user.preferences || {}), caresSmsOptIn: canOptIn && caresSms };
    // A new number hasn't seen the opt-out notice yet — send it on the next text.
    if (phoneKey(e164) !== phoneKey(user.phone)) {
      delete prefs.caresStopNoticeSent;
      delete prefs.caresStopOptedOut;
    }
    await onSave({ name, email, role, department: dept, active, phone: e164, preferences: prefs });
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Edit User</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          {testMode && <div className="adm-testnote"><Icon d={P.shield} size={14} />Test Mode — changes won't be saved.</div>}
          <label className="field-group"><span>Name</span>
            <input value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field-group"><span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field-group"><span>Role</span>
              <select value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="field-group"><span>Department</span>
              <input value={dept} onChange={e => setDept(e.target.value)} placeholder="e.g. Pastoral" />
            </label>
          </div>
          <label className="field-group"><span>Mobile phone</span>
            <input
              type="tel"
              value={phone}
              onChange={e => onPhone(e.target.value)}
              placeholder="(706) 555-0187"
              aria-invalid={phoneErr ? 'true' : undefined}
            />
            {phoneErr && <span className="field-err">{phoneErr}</span>}
          </label>

          <div className="adm-opt">
            <label className="adm-check">
              <input
                type="checkbox"
                checked={caresSms && canOptIn}
                disabled={!canOptIn}
                onChange={e => setCaresSms(e.target.checked)}
              />
              Cares alerts
            </label>
            <p className="adm-opt-help">
              {canOptIn
                ? 'Send this user text alerts for Cares assignments and reminders.'
                : 'Add a mobile phone number to enable Cares text alerts.'}
            </p>
            {optedOutBySms && (
              <p className="adm-opt-warn">
                <Icon d={P.shield} size={13} />
                This number replied STOP. Turning alerts back on requires their permission.
              </p>
            )}
          </div>

          <label className="adm-check">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Active user
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}
