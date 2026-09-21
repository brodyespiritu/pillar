import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getSettings, putSettings, checkAppApiKey, setAppApiAuth, hasAppApiAuth, uploadImage } from '../../lib/appApi';
import { useAutosave, SaveState, Field, Alert, Loading, Seg, ImageDrop } from './kit';

// App → Settings: whether Pillar can reach the app server, and the few settings it keeps that are
// still read by anything (the church website's name, tagline and picture). The app itself reads none
// of them — its Home is built in, with the cards chosen in App → Home.

const SCHEMES = [
  { key: 'bearer', label: 'Authorization: Bearer', header: 'Authorization', prefix: 'Bearer ' },
  { key: 'apikey', label: 'x-api-key', header: 'x-api-key', prefix: '' },
];
const siteForm = (s) => ({ churchName: s?.churchName || '', tagline: s?.tagline || '', heroImageUrl: s?.heroImageUrl || '' });

export default function SettingsPage() {
  return (
    <AppShell title="Settings" subtitle="The connection to the app server, and what the church website borrows from it.">
      <div className="ax-stack" style={{ maxWidth: 880 }}>
        <Connection />
        <Website />
      </div>
    </AppShell>
  );
}

function Connection() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);   // { ok, msg }
  const [dev, setDev] = useState(false);
  const [key, setKey] = useState('');
  const [scheme, setScheme] = useState('bearer');
  const [local, setLocal] = useState(hasAppApiAuth());

  async function test() {
    setTesting(true); setResult(null);
    try {
      const current = await getSettings();   // read what's there…
      await putSettings(current);            // …and write it straight back: nothing changes
      setResult({ ok: true, msg: 'Working — a test change reached the app server just now.' });
    } catch (e) {
      let msg = e.message;
      const c = await checkAppApiKey();
      if (c && c.error) msg = c.error;
      else if (c && !c.accepted) {
        msg = c.upstream === null
          ? `${msg} (The app server didn't answer the check — it may be asleep. Try once more.)`
          : `The app server refused Pillar's key. Pillar holds a ${c.keyLength}-character key${c.hadWhitespace ? ' (it had a stray space, which Pillar trimmed)' : ''}. Check that APP_API_KEY in Vercel is exactly API_KEY on Render.`;
      }
      setResult({ ok: false, msg });
    }
    setTesting(false);
  }

  function useKey() {
    const s = SCHEMES.find((x) => x.key === scheme);
    setAppApiAuth({ key: key.trim(), header: s.header, prefix: s.prefix });
    setLocal(!!key.trim());
    setKey('');
    test();
  }

  return (
    <div className="ax-panel">
      <div className="ax-panel-head">
        <div>
          <div className="ax-panel-title">Connection to the app server</div>
          <p className="ax-panel-sub">
            Pillar’s own server holds the app server’s key and uses it for you once you’re signed in, so there’s
            nothing to enter on any computer. If a change ever refuses to save, test it here.
          </p>
        </div>
      </div>
      {result ? (
        result.ok
          ? <div className="ax-note" style={{ marginBottom: 24 }}><Icon d={P.check} size={18} /><span>{result.msg}</span></div>
          : <Alert>{result.msg}</Alert>
      ) : null}
      <div className="ax-inline">
        <button type="button" className="ax-btn primary" onClick={test} disabled={testing}>
          {testing ? <><span className="ax-spinner" />Testing…</> : 'Test the connection'}
        </button>
        <button type="button" className="ax-btn quiet" onClick={() => setDev((d) => !d)}>
          {dev ? 'Hide developer options' : 'Developer options'}
        </button>
      </div>

      {dev ? (
        <div className="ax-form" style={{ marginTop: 28, paddingTop: 28, borderTop: '1px solid var(--ax-line)' }}>
          <p className="ax-hint">
            Only for a local development copy of Pillar, which has no server of its own. The key stays in this
            browser. On the real Pillar, leave this alone — the key belongs in Vercel as APP_API_KEY.
          </p>
          {local ? (
            <div className="ax-note">
              <span style={{ flex: 1 }}>A key is saved in this browser.</span>
              <button type="button" className="ax-btn quiet sm" onClick={() => { setAppApiAuth({ key: '' }); setLocal(false); }}>Remove it</button>
            </div>
          ) : null}
          <Field label="Key">
            <input className="ax-input" type="password" value={key} autoComplete="off" placeholder="The app server’s key"
              onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="How the server expects it">
            <Seg label="Header" value={scheme} onChange={setScheme} options={SCHEMES.map((s) => ({ key: s.key, label: s.label }))} />
          </Field>
          <div className="ax-inline">
            <button type="button" className="ax-btn" onClick={useKey} disabled={!key.trim() || testing}>Use this key here</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Website() {
  const [raw, setRaw] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then((s) => { setRaw(s || {}); setSaved(JSON.stringify(siteForm(s || {}))); })
      .catch((e) => setError(e.message));
  }, []);

  const form = useMemo(() => siteForm(raw), [raw]);
  const save = useCallback(async (v) => {
    await putSettings({ ...raw, ...v });   // everything else the server keeps goes back untouched
    setSaved(JSON.stringify(v));
  }, [raw]);
  const auto = useAutosave({ value: form, savedJson: saved, ready: raw !== null, save });
  const set = (k, v) => setRaw((r) => ({ ...r, [k]: v }));

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <div>
          <div className="ax-panel-title">Church website</div>
          <p className="ax-panel-sub">The website shows these at the top of its home page. The app doesn’t use them.</p>
        </div>
        {raw ? <SaveState auto={auto} /> : null}
      </div>
      <Alert>{error}</Alert>
      {raw === null ? (error ? null : <Loading>Reaching the app server…</Loading>) : (
        <div className="ax-form">
          <Field label="Church name">
            <input className="ax-input" value={form.churchName} onChange={(e) => set('churchName', e.target.value)} />
          </Field>
          <Field label="Tagline">
            <input className="ax-input" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
          </Field>
          <Field label="Picture">
            <ImageDrop value={form.heroImageUrl} onChange={(u) => set('heroImageUrl', u)}
              upload={async (file) => { const url = await uploadImage(file); return url ? { url } : { error: 'The upload didn’t return an address.' }; }} />
          </Field>
        </div>
      )}
    </div>
  );
}
