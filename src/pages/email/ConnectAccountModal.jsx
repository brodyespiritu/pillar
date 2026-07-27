import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { PROVIDERS, connectAccount, isDesktop } from '../../lib/email';
import '../care/Modal.css';
import './Email.css';

export default function ConnectAccountModal({ onClose, onConnected }) {
  const { user } = useAuth();
  const [provider, setProvider] = useState(null);
  const [email, setEmail]       = useState('');
  const [name, setName]         = useState('');
  const [pw, setPw]             = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function submit() {
    if (!email.trim() || !pw.trim()) { setError('Email and app password are required.'); return; }
    if (!user?.id) { setError('You appear to be signed out. Sign in again, then reconnect.'); return; }
    setSaving(true); setError('');
    try {
      const { error } = await connectAccount({
        provider, email: email.trim(), display_name: name.trim(), app_password: pw.trim(), owner: user.id,
      });
      if (error) { setError(error.message || 'Could not save the account.'); return; }
      onConnected();
    } catch (e) {
      // Without this the throw escapes, `saving` never clears and the button
      // just looks dead — no message, no spinner, nothing.
      setError(e?.message ? `Could not connect: ${e.message}` : 'Could not connect. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const p = provider ? PROVIDERS[provider] : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <h2>Connect an account</h2>
            <p className="tp-sub">Link Gmail or Yahoo to send and receive mail.</p>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          {!provider ? (
            <div className="ca-providers">
              {Object.values(PROVIDERS).map(pr => (
                <button key={pr.key} className="ca-provider" style={{ '--pc': pr.color }} onClick={() => setProvider(pr.key)}>
                  <div className="ca-provider-mark" style={{ background: pr.color }}>{pr.label[0]}</div>
                  <div className="ca-provider-text">
                    <span className="ca-provider-name">{pr.label}</span>
                    <span className="ca-provider-sub">Connect via app password</span>
                  </div>
                  <Icon d={P.chevron} size={18} className="ca-provider-chev" />
                </button>
              ))}
            </div>
          ) : (
            <>
              <button className="ca-back" onClick={() => setProvider(null)}>← Choose a different provider</button>

              <div className="ca-steps">
                <p className="ca-steps-title">Create a {p.label} app password</p>
                <ol>{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                <a className="ca-steps-link" href={p.help} target="_blank" rel="noreferrer">Open {p.label} app-password page →</a>
              </div>

              <label className="field-group"><span>Email address</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={`you@${provider === 'gmail' ? 'gmail.com' : 'yahoo.com'}`} />
              </label>
              <label className="field-group"><span>Display name (optional)</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Brody Espiritu" />
              </label>
              <label className="field-group"><span>App password</span>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="16-character app password" autoComplete="off" />
              </label>
              <p className="ca-note">
                <Icon d={P.lock} size={13} /> Your password is stored only against your own account and used to reach {p.label}.
                {!isDesktop() && ' Live sending/receiving runs in the desktop app.'}
              </p>
              {error && <p className="modal-error">{error}</p>}
            </>
          )}
        </div>

        {provider && (
          <div className="modal-foot">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Connecting…' : 'Connect account'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
