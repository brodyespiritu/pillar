import { useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { fetchGreeters, addGreeter, removeGreeter } from '../../lib/recap';
import GreeterRecapModal from './GreeterRecapModal';
import './emailRecap.css';

const validEmail = e => /\S+@\S+\.\S+/.test(e);

const TEMPLATES = [
  {
    key: 'greeter_recap',
    name: 'Greeter Ministry Recap',
    desc: 'Weekly summary for your greeter team — live stats plus a printable Weekly Recap PDF.',
    color: '#8B5CF6',
    icon: P.mail,
  },
];

export default function EmailTemplatePicker({ guests, onClose }) {
  const [screen, setScreen] = useState('pick');   // pick | manage | greeter_recap

  if (screen === 'greeter_recap') {
    return <GreeterRecapModal guests={guests} onBack={() => setScreen('pick')} onClose={onClose} />;
  }

  return (
    <div className="er-overlay" onClick={onClose}>
      <div className="er-modal" onClick={e => e.stopPropagation()}>
        <div className="er-head">
          {screen === 'manage'
            ? <button className="er-back" onClick={() => setScreen('pick')}><Icon d={P.chevL} size={18} />Templates</button>
            : <span className="er-head-title">Send Email</span>}
          <button className="er-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        {screen === 'manage'
          ? <ManageGreeters />
          : (
            <div className="er-body">
              <div className="er-tpl-list">
                {TEMPLATES.map(t => (
                  <button key={t.key} className="er-tpl" onClick={() => setScreen(t.key)}>
                    <span className="er-badge" style={{ '--tc': t.color }}><Icon d={t.icon} size={20} /></span>
                    <span className="er-tpl-text">
                      <span className="er-tpl-name">{t.name}</span>
                      <span className="er-tpl-desc">{t.desc}</span>
                    </span>
                    <Icon d={P.arrowRight} size={16} className="er-tpl-go" />
                  </button>
                ))}
              </div>

              <button className="er-manage-link" onClick={() => setScreen('manage')}>
                <Icon d={P.settings} size={15} />Manage Saved Emails
              </button>
            </div>
          )}
      </div>
    </div>
  );
}

/* ── Manage the shared "Greeters" saved-email group ── */
function ManageGreeters() {
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { rows, missing } = await fetchGreeters();
    setRows(rows); setMissing(missing);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!validEmail(email)) return;
    setBusy(true);
    await addGreeter({ email, name });
    setEmail(''); setName(''); setBusy(false);
    load();
  }
  async function remove(id) {
    await removeGreeter(id); load();
  }

  return (
    <div className="er-body">
      <div className="er-manage-head">
        <h2>Saved Greeters</h2>
        <p>Shared across all staff. Used by the “+ Greeters” quick-add and one-click chips.</p>
      </div>

      {missing && <div className="er-warn">Run <strong>supabase/email-recap-schema.sql</strong> to enable saved emails.</div>}

      <div className="er-add-row">
        <input placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="email@church.org" value={email} onChange={e => setEmail(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn-primary sm" onClick={add} disabled={busy || !validEmail(email)}>
          <Icon d={P.plus} size={14} />Add
        </button>
      </div>

      <div className="er-greeter-list">
        {rows.map(g => (
          <div key={g.id} className="er-greeter-row">
            <div className="er-greeter-info">
              <span className="er-greeter-name">{g.name || g.email}</span>
              {g.name && <span className="er-greeter-email">{g.email}</span>}
            </div>
            <button className="er-greeter-del" onClick={() => remove(g.id)} title="Remove"><Icon d={P.trash} size={15} /></button>
          </div>
        ))}
        {rows.length === 0 && !missing && <div className="er-empty">No saved greeters yet. Add one above.</div>}
      </div>
    </div>
  );
}
