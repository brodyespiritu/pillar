import { useState, useEffect } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getPushCount, sendNotification } from '../../lib/appApi';

export default function NotificationsPage() {
  const [count, setCount]   = useState(null);
  const [title, setTitle]   = useState('');
  const [body, setBody]     = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);   // { ok, msg }

  useEffect(() => { getPushCount().then(r => setCount(r?.count ?? 0)).catch(() => setCount(null)); }, []);

  const canSend = title.trim() && body.trim();

  async function doSend() {
    setSending(true); setResult(null);
    try {
      await sendNotification({ title: title.trim(), body: body.trim() });
      setResult({ ok: true, msg: `Sent to ${count ?? 'all'} device${count === 1 ? '' : 's'}.` });
      setTitle(''); setBody('');
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setSending(false); setConfirm(false);
  }

  return (
    <AppShell title="Notifications" subtitle="Send a push notification to everyone with the app installed.">
      <div className="ap-banner warn">
        <Icon d={P.chat} size={16} />
        Push notifications are irreversible and reach every registered device{count != null ? ` (${count})` : ''}. Double-check before sending.
      </div>

      <div className="ap-panel" style={{ padding: 24, maxWidth: 620 }}>
        <div className="ap-field">
          <label className="ap-label">Title</label>
          <input className="ap-input" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="e.g. We’re live now!" />
        </div>
        <div className="ap-field" style={{ marginTop: 16 }}>
          <label className="ap-label">Message</label>
          <textarea className="ap-textarea" rows={4} value={body} onChange={e => setBody(e.target.value)} maxLength={300} placeholder="What do you want to tell the congregation?" />
          <span className="ap-hint">{body.length}/300</span>
        </div>

        {result && (
          <div className={`ap-banner ${result.ok ? 'warn' : 'error'}`} style={{ marginTop: 16, marginBottom: 0, background: result.ok ? 'var(--green-soft)' : undefined, color: result.ok ? 'var(--green)' : undefined, borderColor: result.ok ? '#B8E6D8' : undefined }}>
            <Icon d={result.ok ? P.check : P.close} size={16} />{result.msg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="ap-btn primary" disabled={!canSend} onClick={() => setConfirm(true)}>
            <Icon d={P.send} size={15} />Send notification
          </button>
        </div>
      </div>

      {confirm && (
        <div className="ap-overlay" onClick={() => !sending && setConfirm(false)}>
          <div className="ap-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="ap-modal-head"><h2>Send to every device?</h2></div>
            <div className="ap-modal-body">
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
                This sends <strong>“{title.trim()}”</strong> to all {count ?? ''} registered device{count === 1 ? '' : 's'} immediately. It can’t be undone.
              </p>
            </div>
            <div className="ap-modal-foot">
              <button className="ap-btn" onClick={() => setConfirm(false)} disabled={sending}>Cancel</button>
              <button className="ap-btn primary" onClick={doSend} disabled={sending}>
                {sending ? <><span className="ap-spinner" />Sending…</> : <><Icon d={P.send} size={15} />Send now</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
