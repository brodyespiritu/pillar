import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getPushCount, sendNotification } from '../../lib/appApi';
import { ask, Field, GrowText, Alert } from './kit';

// App → Notifications: write it, see it as a phone shows it, send it. Sending is the one thing in
// App that can't be taken back, so it's the one thing that asks first.

const TITLE_MAX = 80;
const BODY_MAX = 300;

export default function NotificationsPage() {
  const [count, setCount] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { getPushCount().then((r) => setCount(r?.count ?? 0)).catch(() => setCount(null)); }, []);

  const phones = count == null ? 'every phone with the app' : `${count} phone${count === 1 ? '' : 's'}`;
  const ready = title.trim() && body.trim();

  async function send() {
    if (!ready) return;
    if (!(await ask(`Send “${title.trim()}” to ${phones} now? It can’t be taken back.`))) return;
    setSending(true); setError(''); setSent('');
    try {
      await sendNotification({ title: title.trim(), body: body.trim() });
      setSent(`Sent to ${phones}.`);
      setTitle(''); setBody('');
    } catch (e) { setError(e.message); }
    setSending(false);
  }

  return (
    <AppShell title="Notifications" subtitle={`A message to ${phones}, straight to the lock screen.`}>
      <div className="ax-split wide-aside">
        <div className="ax-panel">
          <Alert onClose={error ? () => setError('') : null}>{error}</Alert>
          {sent ? (
            <div className="ax-note" style={{ marginBottom: 28 }}>
              <Icon d={P.check} size={18} /><span style={{ flex: 1 }}>{sent}</span>
              <button type="button" className="ax-btn quiet sm" onClick={() => setSent('')}>Write another</button>
            </div>
          ) : null}
          <div className="ax-form">
            <Field label="Title" count={title.length} max={TITLE_MAX}>
              <input className="ax-input title" value={title} maxLength={TITLE_MAX} placeholder="What it’s about"
                onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message" count={body.length} max={BODY_MAX}>
              <GrowText value={body} maxLength={BODY_MAX} minRows={3} placeholder="What you want everyone to know"
                onChange={(e) => setBody(e.target.value)} />
            </Field>
          </div>
          <div className="ax-editor-foot">
            <span className="ax-hint">Goes to {phones} at once, and can’t be taken back.</span>
            <button type="button" className="ax-btn primary" onClick={send} disabled={!ready || sending}>
              {sending ? <><span className="ax-spinner" />Sending…</> : <><Icon d={P.send} size={16} />Send now</>}
            </button>
          </div>
        </div>

        <aside className="ax-aside">
          <div className="ax-sticky ax-phone-wrap">
            <div className="ax-phone" style={{ background: 'linear-gradient(180deg, #3d5a80 0%, #98c1d9 100%)', minHeight: 360 }}>
              <div style={{ textAlign: 'center', color: '#fff', margin: '14px 0 28px' }}>
                <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.9 }}>Sunday</div>
                <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, letterSpacing: -2 }}>9:41</div>
              </div>
              <div className="ax-push">
                <div className="ax-push-icon">B</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ax-push-top"><span>BethesdaApp</span><span>now</span></div>
                  <div className="ax-push-title">{title.trim() || 'Title'}</div>
                  <div className="ax-push-body">{body.trim() || 'Your message shows here.'}</div>
                </div>
              </div>
            </div>
            <p className="ax-phone-cap">How it looks on a locked phone.</p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
