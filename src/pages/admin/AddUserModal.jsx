import { useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { ROLES, MODULES, ACCESS, permsForRole, createUser } from '../../lib/admin';
import './addUser.css';

const STEPS = ['Account', 'Access', 'Profile', 'Security', 'Review'];
const DEPARTMENTS = ['Pastoral', 'Care', 'Worship', 'Communications', 'Youth', 'Children', 'Operations', 'Volunteers'];
const validEmail = e => /\S+@\S+\.\S+/.test(e);
const genPassword = () => Array.from({ length: 12 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'[Math.floor(Math.random() * 58)]).join('');

export default function AddUserModal({ testMode, onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [f, setF] = useState({
    name: '', email: '', auth_method: 'email', password: genPassword(),
    role: 'Staff', permissions: permsForRole('Staff'),
    department: '', title: '', phone: '', active: true, pto_total: 15,
    pin: '', pinConfirm: '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setPerm = (mod, lvl) => setF(p => ({ ...p, permissions: { ...p.permissions, [mod]: lvl } }));
  const applyRole = role => setF(p => ({ ...p, role, permissions: permsForRole(role) }));

  const stepValid = useMemo(() => {
    if (step === 0) return f.name.trim() && validEmail(f.email) && (f.auth_method === 'google' || f.password.length >= 6);
    if (step === 3) return !f.pin || (/^\d{4}$/.test(f.pin) && f.pin === f.pinConfirm);
    return true;
  }, [step, f]);

  async function create() {
    setError('');
    if (f.pin && (!/^\d{4}$/.test(f.pin) || f.pin !== f.pinConfirm)) { setStep(3); setError('PIN must be 4 digits and match.'); return; }
    if (testMode) { onCreated?.(null, true); return; }
    setBusy(true);
    const { error } = await createUser({
      name: f.name.trim(), email: f.email.trim(), auth_method: f.auth_method,
      password: f.auth_method === 'email' ? f.password : undefined,
      role: f.role, permissions: f.permissions,
      department: f.department || null, title: f.title || null, phone: f.phone || null,
      active: f.active, pto_total: Number(f.pto_total) || 15, pin: f.pin || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    onCreated?.(f);
  }

  const last = step === STEPS.length - 1;

  return (
    <div className="au-overlay" onClick={onClose}>
      <div className="au-card" onClick={e => e.stopPropagation()}>
        <button className="au-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>

        <div className="au-body">
          {/* Step rail */}
          <aside className="au-steps">
            <p className="au-steps-title">Add user</p>
            {STEPS.map((s, i) => (
              <button key={s} className={`au-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)}>
                <span className="au-step-num">{i < step ? <Icon d={P.check} size={13} /> : i + 1}</span>{s}
              </button>
            ))}
          </aside>

          {/* Step content */}
          <section className="au-main">
            {step === 0 && (
              <Panel title="Account" sub="How this person signs in.">
                <Field label="Full name"><input className="au-in" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Jane Doe" autoFocus /></Field>
                <Field label="Email"><input className="au-in" type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="jane@bethesdaonline.org" /></Field>
                <Field label="Sign-in method">
                  <div className="au-seg">
                    {['email', 'google'].map(m => <button key={m} className={f.auth_method === m ? 'on' : ''} onClick={() => set('auth_method', m)}>{m === 'email' ? 'Email + password' : 'Google'}</button>)}
                  </div>
                </Field>
                {f.auth_method === 'email' && (
                  <Field label="Temporary password" hint="Share it securely; they can change it later.">
                    <div className="au-pwrow">
                      <input className="au-in" value={f.password} onChange={e => set('password', e.target.value)} />
                      <button className="au-mini" onClick={() => set('password', genPassword())} title="Generate"><Icon d={P.repeat} size={15} /></button>
                    </div>
                  </Field>
                )}
              </Panel>
            )}

            {step === 1 && (
              <Panel title="Role & access" sub="A role sets defaults; fine-tune per module below.">
                <Field label="Role">
                  <div className="au-roles">
                    {ROLES.map(r => <button key={r} className={`au-role ${f.role === r ? 'on' : ''}`} onClick={() => applyRole(r)}>{r}</button>)}
                  </div>
                </Field>
                <div className="au-perm-head"><span>Module</span><span>Access</span></div>
                {MODULES.map(m => (
                  <div key={m.key} className="au-perm-row">
                    <span className="au-perm-mod">{m.label}</span>
                    <div className="au-seg sm">
                      {ACCESS.map(a => <button key={a} className={f.permissions[m.key] === a ? 'on' : ''} onClick={() => setPerm(m.key, a)}>{a}</button>)}
                    </div>
                  </div>
                ))}
              </Panel>
            )}

            {step === 2 && (
              <Panel title="Profile" sub="Optional details for the directory.">
                <Field label="Department">
                  <select className="au-in" value={f.department} onChange={e => set('department', e.target.value)}>
                    <option value="">—</option>
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Title"><input className="au-in" value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Care Coordinator" /></Field>
                <Field label="Phone"><input className="au-in" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></Field>
                <Field label="PTO days / year"><input className="au-in" type="number" value={f.pto_total} onChange={e => set('pto_total', e.target.value)} /></Field>
                <Field label="Status">
                  <label className="au-toggle"><span>Active</span>
                    <button className={`au-switch ${f.active ? 'on' : ''}`} onClick={() => set('active', !f.active)}><i /></button>
                  </label>
                </Field>
              </Panel>
            )}

            {step === 3 && (
              <Panel title="Security" sub="An optional 4-digit lock-screen PIN. They can set it later.">
                <Field label="PIN"><input className="au-in" type="password" inputMode="numeric" maxLength={4} value={f.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, ''))} placeholder="••••" /></Field>
                <Field label="Confirm PIN"><input className="au-in" type="password" inputMode="numeric" maxLength={4} value={f.pinConfirm} onChange={e => set('pinConfirm', e.target.value.replace(/\D/g, ''))} placeholder="••••" /></Field>
              </Panel>
            )}

            {step === 4 && (
              <Panel title="Review" sub="Confirm and create the account.">
                <div className="au-review">
                  <ReviewRow label="Name" value={f.name} />
                  <ReviewRow label="Email" value={f.email} />
                  <ReviewRow label="Sign-in" value={f.auth_method === 'email' ? 'Email + password' : 'Google'} />
                  <ReviewRow label="Role" value={f.role} />
                  <ReviewRow label="Access" value={MODULES.filter(m => f.permissions[m.key] !== 'none').map(m => `${m.label}·${f.permissions[m.key]}`).join(', ') || 'None'} />
                  <ReviewRow label="Department" value={f.department || '—'} />
                  <ReviewRow label="Title" value={f.title || '—'} />
                  <ReviewRow label="PIN" value={f.pin ? 'Set' : 'Not set'} />
                  <ReviewRow label="Status" value={f.active ? 'Active' : 'Inactive'} />
                </div>
              </Panel>
            )}

            {error && <div className="au-error">{error}</div>}

            <div className="au-foot">
              {step > 0 ? <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button> : <span />}
              {last
                ? <button className="btn-primary" onClick={create} disabled={busy}><Icon d={P.plus} size={15} />{busy ? 'Creating…' : 'Create user'}</button>
                : <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!stepValid}>Continue</button>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, sub, children }) {
  return (<div className="au-panel"><h2>{title}</h2><p className="au-panel-sub">{sub}</p>{children}</div>);
}
function Field({ label, hint, children }) {
  return (<label className="au-field"><span className="au-field-label">{label}</span>{children}{hint && <span className="au-field-hint">{hint}</span>}</label>);
}
function ReviewRow({ label, value }) {
  return (<div className="au-review-row"><span>{label}</span><b>{value}</b></div>);
}
