import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { ROLES, normalizeRole } from '../../lib/admin';
import '../care/Modal.css';

export default function EditUserModal({ user, testMode, onClose, onSave }) {
  const [name, setName]   = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [role, setRole]   = useState(normalizeRole(user.role));
  const [dept, setDept]   = useState(user.department || '');
  const [active, setActive] = useState(user.active !== false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({ name, email, role, department: dept, active });
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
