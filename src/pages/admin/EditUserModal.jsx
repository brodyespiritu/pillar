import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { ROLES, normalizeRole, MODULES, ACCESS, permsForRole } from '../../lib/admin';
import { toE164, formatAsTyped, formatUsPhone, isValidUsPhone, phoneKey } from '../../lib/phone';
import '../care/Modal.css';
import './addUser.css';

export default function EditUserModal({ user, testMode, onClose, onSave }) {
  const [name, setName]   = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [role, setRole]   = useState(normalizeRole(user.role));
  const [dept, setDept]   = useState(user.department || '');
  const [active, setActive] = useState(user.active !== false);
  const [phone, setPhone] = useState(formatUsPhone(user.phone || ''));
  const [caresSms, setCaresSms] = useState(user.preferences?.caresSmsOptIn === true);
  /* The Care List's Update button, which emails everyone's latest care update. */
  const [careUpdates, setCareUpdates] = useState(user.permissions?.careUpdates === true);
  const [phoneErr, setPhoneErr] = useState('');
  /* Permissions were only settable when creating a user — an existing person's
     access could never be changed without deleting and re-adding them. */
  const [perms, setPerms] = useState(() => ({
    ...permsForRole(user.role), ...(user.permissions || {}),
  }));
  const setPerm = (mod, lvl) => setPerms(p => ({ ...p, [mod]: lvl }));

  /* Changing the role re-applies that role's defaults, the way Add User does. */
  function chooseRole(next) {
    setRole(next);
    setPerms(permsForRole(next));
  }
  const [saving, setSaving] = useState(false);

  const canOptIn = isValidUsPhone(phone);
  const optedOutBySms = user.preferences?.caresStopOptedOut === true;
  /* Set by the database when this person changed their own number while on the
     Cares list — care texts stop until an admin has seen the new number. */
  const pausedForNumber = user.preferences?.caresPausedForNewNumber === true;

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
    // Saving here is an admin looking at the number, which is what the pause waits for.
    delete prefs.caresPausedForNewNumber;
    // A new number hasn't seen the opt-out notice yet — send it on the next text.
    if (phoneKey(e164) !== phoneKey(user.phone)) {
      delete prefs.caresStopNoticeSent;
      delete prefs.caresStopOptedOut;
    }
    await onSave({ name, email, role, department: dept, active, phone: e164,
      permissions: { ...perms, careUpdates }, preferences: prefs });
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
              <select value={role} onChange={e => chooseRole(e.target.value)}>
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
            {pausedForNumber && !optedOutBySms && (
              <p className="adm-opt-warn">
                <Icon d={P.shield} size={13} />
                Cares texts were paused because this number was changed. Check it, then turn them back on.
              </p>
            )}
          </div>

          <div className="adm-opt">
            <label className="adm-check">
              <input type="checkbox" checked={careUpdates} onChange={e => setCareUpdates(e.target.checked)} />
              Email care updates
            </label>
            <p className="adm-opt-help">
              Shows an Update button on the Care List for emailing everyone's latest care update to an email group.
            </p>
          </div>

          <div className="eu-perms">
            <div className="au-perm-head"><span>Module access</span><span>Access</span></div>
            {MODULES.map(m => (
              <div key={m.key} className="au-perm-row">
                <span className="au-perm-mod">{m.label}</span>
                <div className="au-seg sm">
                  {ACCESS.map(a => (
                    <button key={a} type="button" className={perms[m.key] === a ? 'on' : ''}
                      onClick={() => setPerm(m.key, a)}>{a}</button>
                  ))}
                </div>
              </div>
            ))}
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
