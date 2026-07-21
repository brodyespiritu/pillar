import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import './PINPage.css';

const KEYS = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['','0','⌫'],
];

export default function PINPage({ overlay = false }) {
  const { profile, verifyPin, signOut } = useAuth();
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [shake, setShake]   = useState(false);

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()
    : '?';

  function pressKey(k) {
    if (!k) return;
    if (k === '⌫') { setPin(p => p.slice(0,-1)); setError(''); return; }
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) checkPin(next);
  }

  async function checkPin(entered) {
    const ok = await verifyPin(entered);
    if (!ok) {
      setError('Incorrect PIN');
      setShake(true);
      setTimeout(() => { setShake(false); setPin(''); setError(''); }, 700);
    }
  }

  return (
    <div className={`pin-wrap ${overlay ? 'overlay' : ''}`}>
      <div className="pin-card">
        <div className="pin-avatar">{initials}</div>
        <p className="pin-name">{profile?.name ?? 'Staff'}</p>
        <p className="pin-sub">Enter your PIN to continue</p>

        <div className={`pin-dots ${shake ? 'shake' : ''}`}>
          {[0,1,2,3].map(i => (
            <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''} ${error ? 'error' : ''}`} />
          ))}
        </div>

        {error && <p className="pin-error">{error}</p>}

        <div className="pin-keypad">
          {KEYS.map((row, r) => (
            <div key={r} className="pin-row">
              {row.map((k, c) => (
                <button
                  key={c}
                  className={`pin-key ${!k ? 'invisible' : ''} ${k === '⌫' ? 'back' : ''}`}
                  onClick={() => pressKey(k)}
                  disabled={!k}
                >
                  {k}
                </button>
              ))}
            </div>
          ))}
        </div>

        <button className="pin-signout" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
