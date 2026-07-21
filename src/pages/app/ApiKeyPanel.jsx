import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { setAppApiAuth, hasAppApiAuth, getSettings, putSettings } from '../../lib/appApi';

const SCHEMES = [
  { key: 'bearer', label: 'Authorization: Bearer', header: 'Authorization', prefix: 'Bearer ' },
  { key: 'apikey', label: 'x-api-key', header: 'x-api-key', prefix: '' },
  { key: 'custom', label: 'Custom header', header: '', prefix: '' },
];

/*
 * Provision the write-auth key the app server requires (reads are open; writes 401 without it).
 * The admin pastes the key + picks the scheme, then "Save & test" runs a real no-op write.
 */
export default function ApiKeyPanel() {
  const [key, setKey]     = useState('');
  const [scheme, setScheme] = useState('bearer');
  const [customHeader, setCustomHeader] = useState('');
  const [prefix, setPrefix] = useState('');
  const [show, setShow]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);   // { ok, msg }
  const [configured, setConfigured] = useState(hasAppApiAuth());

  async function saveTest() {
    const s = SCHEMES.find(x => x.key === scheme);
    const header = scheme === 'custom' ? (customHeader.trim() || 'Authorization') : s.header;
    const pfx = scheme === 'custom' ? prefix : s.prefix;
    setAppApiAuth({ key: key.trim(), header, prefix: pfx });
    setConfigured(!!key.trim());
    setTesting(true); setResult(null);
    try {
      const current = await getSettings();     // read current
      await putSettings(current);              // no-op write with the new auth
      setResult({ ok: true, msg: 'Write succeeded — the key works. Live edits are now enabled across the App section.' });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  }

  return (
    <div className="ap-panel" style={{ padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span className={`ap-dot ${configured ? 'ok' : 'off'}`} />
        <h3 className="ap-section-title" style={{ margin: 0 }}>App API access {configured ? '· key set' : '· not set'}</h3>
      </div>
      <p className="ap-hint" style={{ marginBottom: 16 }}>
        Reading the app is open, but the server requires a key to <strong>write</strong>. Paste the key issued for the admin
        server and test it — nothing publishes until this succeeds.
      </p>

      <div className="ap-field">
        <label className="ap-label">API key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="ap-input" type={show ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="Paste the server key" autoComplete="off" />
          <button type="button" className="ap-btn" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
        </div>
      </div>

      <div className="ap-field" style={{ marginTop: 14 }}>
        <label className="ap-label">Auth scheme</label>
        <select className="ap-select" value={scheme} onChange={e => setScheme(e.target.value)}>
          {SCHEMES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="ap-hint">Match whatever the server expects. Most likely “Authorization: Bearer”.</span>
      </div>

      {scheme === 'custom' && (
        <div className="ap-field row" style={{ marginTop: 14 }}>
          <div className="ap-field"><label className="ap-label">Header name</label><input className="ap-input" value={customHeader} onChange={e => setCustomHeader(e.target.value)} placeholder="e.g. x-admin-key" /></div>
          <div className="ap-field"><label className="ap-label">Value prefix</label><input className="ap-input" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="(optional, e.g. 'Bearer ')" /></div>
        </div>
      )}

      {result && (
        <div className={`ap-banner ${result.ok ? '' : 'error'}`} style={{ marginTop: 16, marginBottom: 0, background: result.ok ? 'var(--green-soft)' : undefined, color: result.ok ? 'var(--green)' : undefined, border: result.ok ? '1px solid #B8E6D8' : undefined }}>
          <Icon d={result.ok ? P.check : P.close} size={16} />{result.msg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="ap-btn primary" onClick={saveTest} disabled={testing || !key.trim()}>
          {testing ? <><span className="ap-spinner" />Testing…</> : <><Icon d={P.check} size={15} />Save &amp; test write</>}
        </button>
      </div>
    </div>
  );
}
