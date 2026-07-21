import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { MINISTRIES } from '../../lib/ministries';
import { addNewConnection } from '../../lib/recap';
import '../care/Modal.css';
import './Guests.css';

/*
 * New Connection flow:
 *  1. type a name
 *  2. pick a ministry card
 * → attaches the ministry to the person's Members profile AND records it under
 *   "New Connections" in the Weekly Recap (printable + emailed).
 */
export default function NewConnectionModal({ onClose, onSaved }) {
  const { profile } = useAuth();
  const [step, setStep]   = useState(1);
  const [name, setName]   = useState('');
  const [saving, setSaving] = useState('');   // ministry name being saved
  const [error, setError] = useState('');
  const [done, setDone]   = useState(null);   // { ministry, created }

  function next() {
    if (!name.trim()) { setError('Please enter a name.'); return; }
    setError(''); setStep(2);
  }

  async function pick(ministry) {
    if (saving) return;
    setSaving(ministry); setError('');
    const { error, created } = await addNewConnection({
      person_name: name, ministry, submitted_by: profile?.name || null,
    });
    setSaving('');
    if (error) { setError(error.message || 'Could not save the connection.'); return; }
    setDone({ ministry, created });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <h2>New Connection</h2>
            <p className="tp-sub">
              {done ? 'Connection recorded.' : step === 1 ? 'Who did you connect with?' : `Connect ${name.trim()} to a ministry`}
            </p>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          {done ? (
            <div className="nc-done">
              <div className="nc-done-ic"><Icon d={P.check} size={30} /></div>
              <p className="nc-done-title">{name.trim()} → {done.ministry}</p>
              <p className="nc-done-sub">
                {done.created ? 'Added to Members' : 'Attached to their Members profile'} and listed under
                “New Connections” in this week’s recap.
              </p>
            </div>
          ) : step === 1 ? (
            <div className="gf-field">
              <label className="gf-label">Name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && next()}
                placeholder="First and last name" />
              {error && <p style={{ color: 'var(--red)', marginTop: 10, fontSize: 13 }}>{error}</p>}
            </div>
          ) : (
            <>
              <div className="tp-grid">
                {MINISTRIES.map(m => (
                  <button key={m.name} className="tp-card" style={{ '--tc': m.color }}
                    disabled={!!saving} onClick={() => pick(m.name)}>
                    <div className="tp-icon"><Icon d={m.icon} size={22} /></div>
                    <div className="tp-text">
                      <span className="tp-name">{m.name}</span>
                      <span className="tp-desc">{saving === m.name ? 'Connecting…' : m.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
              {error && <p style={{ color: 'var(--red)', marginTop: 12, fontSize: 13 }}>{error}</p>}
            </>
          )}
        </div>

        <div className="modal-foot">
          {done ? (
            <button className="btn-primary" onClick={onSaved} style={{ marginLeft: 'auto' }}>Done</button>
          ) : step === 1 ? (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={next}>Continue</button>
            </>
          ) : (
            <button className="btn-ghost" onClick={() => { setStep(1); setError(''); }}>Back</button>
          )}
        </div>
      </div>
    </div>
  );
}
