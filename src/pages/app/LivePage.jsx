import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getLivestream, putLivestream,
  getLiveCard, pushLiveCard, clearLiveCard, getLiveCardVotes,
  getLiveCardTemplates, saveLiveCardTemplate, deleteLiveCardTemplate,
  getChat, genId,
} from '../../lib/appApi';

const CARD_TYPES = [
  { key: 'scripture', label: 'Scripture', icon: P.book },
  { key: 'informative', label: 'Info / CTA', icon: P.announce },
  { key: 'poll', label: 'Poll', icon: P.grid },
];
const DESTINATIONS = ['', 'Sermons', 'Give', 'Bible', 'Connect', 'Link'];

const cardSummary = c => !c ? '' :
  c.type === 'informative' ? (c.title || 'Info card') :
  c.type === 'poll' ? (c.question || 'Poll') :
  (c.reference || 'Scripture');

export default function LivePage() {
  return (
    <AppShell title="Live" subtitle="Control the livestream, push cards to viewers, and watch the chat.">
      <LiveStream />
      <LiveCards />
      <Chat />
    </AppShell>
  );
}

/* ── Livestream control ── */
function LiveStream() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  useEffect(() => {
    getLivestream()
      .then(l => setForm({ isLive: false, liveStreamUrl: '', liveTitle: 'Live Service', liveNotes: '', ...l }))
      .catch(e => setError(e.message));
  }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function persist(next) {
    setSaving(true); setError(''); setSaved(false);
    try { await putLivestream(next); setForm(next); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e) { setError(e.message); }
    setSaving(false);
  }

  function onToggle(v) {
    if (v) { setConfirmLive(true); return; }   // confirm before going live
    persist({ ...form, isLive: false });
  }

  if (!form) return <div className="ap-panel" style={{ padding: 24, marginBottom: 20 }}><div className="ap-loading"><span className="ap-spinner" />Loading livestream…</div></div>;

  return (
    <div className="ap-panel" style={{ padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`ap-dot ${form.isLive ? 'live' : 'off'}`} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{form.isLive ? 'Stream is LIVE' : 'Stream is offline'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{form.isLive ? 'The app is showing the live banner to everyone.' : 'Flip on to put the whole app into live mode.'}</div>
          </div>
        </div>
        <label className="ap-switch"><input type="checkbox" checked={!!form.isLive} onChange={e => onToggle(e.target.checked)} /><span className="ap-switch-track" style={{ transform: 'scale(1.15)' }} /></label>
      </div>

      {error && <div className="ap-banner error"><Icon d={P.close} size={16} />{error}</div>}

      <div className="ap-field"><label className="ap-label">Stream title</label><input className="ap-input" value={form.liveTitle || ''} onChange={e => set('liveTitle', e.target.value)} /></div>
      <div className="ap-field" style={{ marginTop: 14 }}><label className="ap-label">Stream URL (HLS)</label><input className="ap-input" value={form.liveStreamUrl || ''} onChange={e => set('liveStreamUrl', e.target.value)} placeholder="https://…/index.m3u8" /></div>
      <div className="ap-field" style={{ marginTop: 14 }}><label className="ap-label">Notes <span className="ap-hint">(shown when viewers tap Notes)</span></label><textarea className="ap-textarea" rows={3} value={form.liveNotes || ''} onChange={e => set('liveNotes', e.target.value)} /></div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Saved</span>}
        <button className="ap-btn primary" onClick={() => persist(form)} disabled={saving}>{saving ? <><span className="ap-spinner" />Saving…</> : <><Icon d={P.check} size={15} />Save stream details</>}</button>
      </div>

      {confirmLive && (
        <div className="ap-overlay" onClick={() => setConfirmLive(false)}>
          <div className="ap-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="ap-modal-head"><h2>Go live now?</h2></div>
            <div className="ap-modal-body"><p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>This flips the entire app into live mode for everyone within seconds. Make sure your stream URL is ready.</p></div>
            <div className="ap-modal-foot">
              <button className="ap-btn" onClick={() => setConfirmLive(false)}>Cancel</button>
              <button className="ap-btn primary" onClick={() => { setConfirmLive(false); persist({ ...form, isLive: true }); }}><Icon d={P.radio} size={15} />Go live</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Live cards ── */
function LiveCards() {
  const [active, setActive] = useState(null);
  const [votes, setVotes] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ type: 'scripture', reference: '', text: '', note: '', title: '', body: '', buttonLabel: '', destination: '', question: '', options: ['', ''] });
  const pollRef = useRef(null);

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  const loadTemplates = useCallback(() => { getLiveCardTemplates().then(t => setTemplates(Array.isArray(t) ? t : [])).catch(() => {}); }, []);

  // poll the active card (+ votes if it's a poll)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const c = await getLiveCard();
        if (!alive) return;
        setActive(c);
        if (c && c.type === 'poll') { const v = await getLiveCardVotes(); if (alive) setVotes(v?.votes || {}); }
        else setVotes(null);
      } catch { /* ignore transient */ }
    };
    tick(); loadTemplates();
    pollRef.current = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(pollRef.current); };
  }, [loadTemplates]);

  function buildCard() {
    const base = { id: genId(), type: draft.type };
    if (draft.type === 'informative') return { ...base, title: draft.title, body: draft.body, buttonLabel: draft.buttonLabel, destination: draft.destination };
    if (draft.type === 'poll') return { ...base, question: draft.question, options: draft.options.map(o => o.trim()).filter(Boolean) };
    return { ...base, reference: draft.reference, text: draft.text, note: draft.note };
  }
  const draftValid = draft.type === 'informative' ? draft.title.trim()
    : draft.type === 'poll' ? (draft.question.trim() && draft.options.filter(o => o.trim()).length >= 2)
    : (draft.reference.trim() && draft.text.trim());

  async function push(card) {
    setBusy(true); setError('');
    try { await pushLiveCard(card); setActive(card); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function clear() {
    setBusy(true); setError('');
    try { await clearLiveCard(); setActive(null); setVotes(null); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function saveTemplate() {
    setBusy(true); setError('');
    try { await saveLiveCardTemplate(buildCard()); loadTemplates(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function removeTemplate(id) {
    try { await deleteLiveCardTemplate(id); setTemplates(t => t.filter(x => x.id !== id)); } catch (e) { setError(e.message); }
  }

  return (
    <div className="ap-panel" style={{ padding: 24, marginBottom: 20 }}>
      <h3 className="ap-section-title">Live cards</h3>

      {/* Active */}
      <div className="ap-activecard">
        {active ? (
          <>
            <div>
              <span className="ap-badge tag" style={{ marginBottom: 6 }}>{(active.type || 'scripture').toUpperCase()} · ON SCREEN</span>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{cardSummary(active)}</div>
              {active.type === 'poll' && votes && (
                <div className="ap-votes">
                  {(active.options || []).map((opt, i) => <span key={i}>{opt}: <strong>{votes[i] || 0}</strong></span>)}
                </div>
              )}
            </div>
            <button className="ap-btn danger" onClick={clear} disabled={busy}><Icon d={P.close} size={15} />Clear card</button>
          </>
        ) : <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>No card on screen right now.</span>}
      </div>

      {error && <div className="ap-banner error" style={{ marginTop: 16 }}><Icon d={P.close} size={16} />{error}</div>}

      {/* Composer */}
      <div className="ap-typeseg" style={{ marginTop: 18 }}>
        {CARD_TYPES.map(t => (
          <button key={t.key} className={draft.type === t.key ? 'on' : ''} onClick={() => set('type', t.key)}><Icon d={t.icon} size={15} />{t.label}</button>
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {draft.type === 'scripture' && <>
          <div className="ap-field"><label className="ap-label">Reference</label><input className="ap-input" value={draft.reference} onChange={e => set('reference', e.target.value)} placeholder="Matthew 13:24" /></div>
          <div className="ap-field"><label className="ap-label">Text</label><textarea className="ap-textarea" rows={2} value={draft.text} onChange={e => set('text', e.target.value)} /></div>
          <div className="ap-field"><label className="ap-label">Note <span className="ap-hint">(optional)</span></label><input className="ap-input" value={draft.note} onChange={e => set('note', e.target.value)} /></div>
        </>}
        {draft.type === 'informative' && <>
          <div className="ap-field"><label className="ap-label">Title</label><input className="ap-input" value={draft.title} onChange={e => set('title', e.target.value)} /></div>
          <div className="ap-field"><label className="ap-label">Body</label><textarea className="ap-textarea" rows={2} value={draft.body} onChange={e => set('body', e.target.value)} /></div>
          <div className="ap-field row">
            <div className="ap-field"><label className="ap-label">Button label <span className="ap-hint">(optional)</span></label><input className="ap-input" value={draft.buttonLabel} onChange={e => set('buttonLabel', e.target.value)} placeholder="Learn more" /></div>
            <div className="ap-field"><label className="ap-label">Button goes to</label>
              <select className="ap-select" value={draft.destination} onChange={e => set('destination', e.target.value)}>{DESTINATIONS.map(d => <option key={d} value={d}>{d || 'None'}</option>)}</select>
            </div>
          </div>
        </>}
        {draft.type === 'poll' && <>
          <div className="ap-field"><label className="ap-label">Question</label><input className="ap-input" value={draft.question} onChange={e => set('question', e.target.value)} /></div>
          <div className="ap-field"><label className="ap-label">Options</label>
            {draft.options.map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="ap-input" value={o} onChange={e => set('options', draft.options.map((x, k) => k === i ? e.target.value : x))} placeholder={`Option ${i + 1}`} />
                {draft.options.length > 2 && <button className="ap-icon-btn danger" onClick={() => set('options', draft.options.filter((_, k) => k !== i))}><Icon d={P.close} size={15} /></button>}
              </div>
            ))}
            {draft.options.length < 5 && <button className="ap-btn" onClick={() => set('options', [...draft.options, ''])}><Icon d={P.plus} size={14} />Add option</button>}
          </div>
        </>}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="ap-btn" onClick={saveTemplate} disabled={busy || !draftValid}><Icon d={P.plus} size={15} />Save as template</button>
        <button className="ap-btn primary" onClick={() => push(buildCard())} disabled={busy || !draftValid}><Icon d={P.send} size={15} />Push to viewers</button>
      </div>

      {/* Templates */}
      {templates.length > 0 && <>
        <h3 className="ap-section-title" style={{ marginTop: 24 }}>Saved templates</h3>
        <div className="ap-templates">
          {templates.map(t => (
            <div className="ap-template" key={t.id}>
              <span className="ap-badge tag">{(t.type || 'scripture').toUpperCase()}</span>
              <span className="ap-template-name">{cardSummary(t)}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ap-btn" onClick={() => push(t)} disabled={busy}><Icon d={P.send} size={14} />Push</button>
                <button className="ap-icon-btn danger" onClick={() => removeTemplate(t.id)}><Icon d={P.trash} size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

/* ── Chat (read-only moderation feed) ── */
function Chat() {
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const c = await getChat(); if (alive) { setMsgs(Array.isArray(c) ? c : []); setErr(false); } } catch { if (alive) setErr(true); } };
    tick();
    const id = setInterval(tick, 7000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="ap-panel" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 className="ap-section-title" style={{ margin: 0 }}>Live chat</h3>
        <span className="ap-hint">Read-only · clears when the stream ends</span>
      </div>
      <div className="ap-chat">
        {err ? <p className="ap-hint">Couldn’t load chat.</p>
          : msgs.length === 0 ? <p className="ap-hint">No messages yet.</p>
          : msgs.map((m, i) => (
            <div className="ap-chat-msg" key={m.id || i}>
              <span className="ap-chat-who">{m.name || m.user || 'Guest'}</span>
              <span className="ap-chat-text">{m.text || m.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
