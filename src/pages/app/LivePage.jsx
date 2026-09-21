import { useCallback, useEffect, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getLivestream, putLivestream,
  getLiveCard, pushLiveCard, clearLiveCard, getLiveCardVotes,
  getLiveCardTemplates, saveLiveCardTemplate, deleteLiveCardTemplate,
  getChat, genId,
} from '../../lib/appApi';
import { useAutosave, useUndo, ask, SaveState, Field, GrowText, Toggle, Seg, Alert, Loading } from './kit';

// App → Live: the stream (one switch, and its details saved as you type), the cards pushed onto
// viewers' screens during it, and the chat, all on one page.

const CARD_TYPES = [
  { key: 'scripture', label: 'Scripture' },
  { key: 'informative', label: 'Announcement' },
  { key: 'poll', label: 'Poll' },
];
// where an announcement card's button may go — the app's own pages (BethesdaApp MediaPlayer)
const DESTINATIONS = [
  { key: '', label: 'No button' },
  { key: 'Sermons', label: 'Watch' },
  { key: 'Give', label: 'Give' },
  { key: 'Bible', label: 'Bible' },
];
const BLANK = { type: 'scripture', reference: '', text: '', note: '', title: '', body: '', buttonLabel: '', destination: '', question: '', options: ['', ''] };

const summary = (c) => (!c ? '' : c.type === 'informative' ? (c.title || 'Announcement') : c.type === 'poll' ? (c.question || 'Poll') : (c.reference || 'Scripture'));
const streamForm = (s) => ({ liveTitle: s?.liveTitle || '', liveStreamUrl: s?.liveStreamUrl || '', liveNotes: s?.liveNotes || '' });
const announce = (on) => window.dispatchEvent(new CustomEvent('pillar-app-live', { detail: on }));

export default function LivePage() {
  return (
    <AppShell title="Live" subtitle="Go live, put cards on viewers’ screens, and follow the chat.">
      <div className="ax-split wide-aside">
        <div className="ax-stack">
          <Stream />
          <Cards />
        </div>
        <aside className="ax-aside">
          <div className="ax-sticky"><Chat /></div>
        </aside>
      </div>
    </AppShell>
  );
}

/* ── the stream ── */

function Stream() {
  const [stream, setStream] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLivestream()
      .then((l) => {
        const s = { isLive: false, liveStreamUrl: '', liveTitle: '', liveNotes: '', ...l };
        setStream(s);
        setSaved(JSON.stringify(streamForm(s)));
        announce(!!s.isLive);
      })
      .catch((e) => setError(e.message));
  }, []);

  const form = streamForm(stream);
  const save = useCallback(async (v) => {
    const next = { ...stream, ...v };
    await putLivestream(next);
    setSaved(JSON.stringify(v));
  }, [stream]);
  const auto = useAutosave({ value: form, savedJson: saved, ready: stream !== null, save });

  async function goLive(on) {
    if (on && !form.liveStreamUrl.trim()) { setError('Add the stream link first.'); return; }
    if (on && !(await ask('Go live now? The whole app switches to live mode for everyone within seconds.'))) return;
    setBusy(true); setError('');
    const next = { ...stream, ...form, isLive: on };
    try {
      await putLivestream(next);
      setStream(next);
      setSaved(JSON.stringify(streamForm(next)));
      announce(on);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (!stream) return error ? <Alert>{error}</Alert> : <div className="ax-panel"><Loading>Reaching the app server…</Loading></div>;
  const set = (k, v) => setStream((s) => ({ ...s, [k]: v }));

  return (
    <div className="ax-panel">
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>
      <div className="ax-editor-head">
        <div className="ax-inline" style={{ gap: 16 }}>
          <span className={`ax-dot ${stream.isLive ? 'live' : ''}`} style={{ width: 14, height: 14 }} />
          <div>
            <div className="ax-panel-title">{stream.isLive ? 'You’re live' : 'Not live'}</div>
            <p className="ax-panel-sub">{stream.isLive ? 'Every phone shows the live banner.' : 'Switch on when the stream has started.'}</p>
          </div>
        </div>
        <Toggle live checked={!!stream.isLive} disabled={busy} onChange={goLive}
          label={busy ? 'One moment…' : stream.isLive ? 'Live' : 'Go live'} />
      </div>
      <div className="ax-form">
        <div className="ax-inline" style={{ justifyContent: 'flex-end', marginTop: -18 }}><SaveState auto={auto} /></div>
        <Field label="Title">
          <input className="ax-input title" value={form.liveTitle} placeholder="Sunday worship"
            onChange={(e) => set('liveTitle', e.target.value)} />
        </Field>
        <Field label="Stream link" hint="The HLS address from the streaming service — it ends in .m3u8.">
          <input className="ax-input" value={form.liveStreamUrl} inputMode="url" placeholder="https://…/index.m3u8"
            onChange={(e) => set('liveStreamUrl', e.target.value)} />
        </Field>
        <Field label="Notes" hint="What viewers see when they tap Notes during the stream.">
          <GrowText value={form.liveNotes} minRows={3} onChange={(e) => set('liveNotes', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

/* ── cards on viewers' screens ── */

function Cards() {
  const [active, setActive] = useState(undefined);
  const [votes, setVotes] = useState(null);
  const [saved, setSaved] = useState([]);
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, undo] = useUndo();

  const loadSaved = useCallback(() => {
    getLiveCardTemplates().then((t) => setSaved(Array.isArray(t) ? t : [])).catch(() => {});
  }, []);

  // what's on screen, and a poll's votes, kept current
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const c = await getLiveCard();
        if (!alive) return;
        setActive(c || null);
        if (c && c.type === 'poll') { const v = await getLiveCardVotes(); if (alive) setVotes(v?.votes || {}); }
        else setVotes(null);
      } catch { /* a missed tick is fine */ }
    };
    tick();
    loadSaved();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [loadSaved]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const build = () => {
    const base = { id: genId(), type: draft.type };
    if (draft.type === 'informative') return { ...base, title: draft.title.trim(), body: draft.body.trim(), buttonLabel: draft.buttonLabel.trim(), destination: draft.destination };
    if (draft.type === 'poll') return { ...base, question: draft.question.trim(), options: draft.options.map((o) => o.trim()).filter(Boolean) };
    return { ...base, reference: draft.reference.trim(), text: draft.text.trim(), note: draft.note.trim() };
  };
  const valid = draft.type === 'informative' ? draft.title.trim()
    : draft.type === 'poll' ? draft.question.trim() && draft.options.filter((o) => o.trim()).length >= 2
    : draft.reference.trim() && draft.text.trim();

  async function show(card) {
    setBusy(true); setError('');
    try { await pushLiveCard(card); setActive(card); setVotes(null); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function clear() {
    setBusy(true); setError('');
    try { await clearLiveCard(); setActive(null); setVotes(null); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function keep() {
    setBusy(true); setError('');
    try { await saveLiveCardTemplate(build()); loadSaved(); setDraft({ ...BLANK, type: draft.type }); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function forget(t) {
    setSaved((l) => l.filter((x) => x.id !== t.id));
    try { await deleteLiveCardTemplate(t.id); } catch (e) { setError(e.message); loadSaved(); return; }
    undo(`“${summary(t)}” removed.`, async () => {
      try { await saveLiveCardTemplate(t); loadSaved(); } catch (e) { setError(e.message); }
    });
  }

  return (
    <div className="ax-panel">
      <div className="ax-panel-head">
        <div>
          <div className="ax-panel-title">Cards on viewers’ screens</div>
          <p className="ax-panel-sub">A verse, an announcement or a poll, over the live stream.</p>
        </div>
      </div>
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      <div className="ax-note" style={{ marginBottom: 28, alignItems: 'center' }}>
        {active === undefined ? <span>Checking what’s on screen…</span> : active ? (
          <>
            <span style={{ flex: 1 }}>
              <span className="ax-tag">On screen now</span>
              <strong style={{ display: 'block', marginTop: 4, color: 'var(--ax-ink)', fontSize: 16 }}>{summary(active)}</strong>
              {active.type === 'poll' && votes ? (
                <span style={{ display: 'block', marginTop: 4 }}>
                  {(active.options || []).map((o, i) => `${o}: ${votes[i] || 0}`).join(' · ')}
                </span>
              ) : null}
            </span>
            <button type="button" className="ax-btn sm" onClick={clear} disabled={busy}>Take it down</button>
          </>
        ) : <span>Nothing on screen right now.</span>}
      </div>

      <div className="ax-form">
        <Seg label="Kind of card" value={draft.type} onChange={(t) => set('type', t)} options={CARD_TYPES} />
        {draft.type === 'scripture' && (
          <>
            <Field label="Reference"><input className="ax-input" value={draft.reference} placeholder="Book 1:1" onChange={(e) => set('reference', e.target.value)} /></Field>
            <Field label="Verse"><GrowText value={draft.text} minRows={2} onChange={(e) => set('text', e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="ax-input" value={draft.note} onChange={(e) => set('note', e.target.value)} /></Field>
          </>
        )}
        {draft.type === 'informative' && (
          <>
            <Field label="Title"><input className="ax-input" value={draft.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Message"><GrowText value={draft.body} minRows={2} onChange={(e) => set('body', e.target.value)} /></Field>
            <Field label="Button">
              <Seg label="Button goes to" value={draft.destination} onChange={(d) => set('destination', d)} options={DESTINATIONS} />
              {draft.destination ? (
                <input className="ax-input" value={draft.buttonLabel} placeholder="Button label, like Give now"
                  onChange={(e) => set('buttonLabel', e.target.value)} />
              ) : null}
            </Field>
          </>
        )}
        {draft.type === 'poll' && (
          <>
            <Field label="Question"><input className="ax-input" value={draft.question} onChange={(e) => set('question', e.target.value)} /></Field>
            <Field label="Answers" hint="Two to five.">
              <div className="ax-rows">
                {draft.options.map((o, i) => (
                  <div key={i} className="ax-subrow">
                    <input className="ax-input" value={o} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
                      onChange={(e) => set('options', draft.options.map((x, k) => (k === i ? e.target.value : x)))} />
                    {draft.options.length > 2 && (
                      <button type="button" className="ax-iconbtn danger" title="Remove this answer"
                        onClick={() => set('options', draft.options.filter((_, k) => k !== i))}><Icon d={P.close} size={18} /></button>
                    )}
                  </div>
                ))}
                {draft.options.length < 5 && (
                  <button type="button" className="ax-btn sm" style={{ alignSelf: 'flex-start' }}
                    onClick={() => set('options', [...draft.options, ''])}><Icon d={P.plus} size={15} />Add an answer</button>
                )}
              </div>
            </Field>
          </>
        )}
        <div className="ax-inline" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="ax-btn" onClick={keep} disabled={busy || !valid}>Save for later</button>
          <button type="button" className="ax-btn primary" onClick={() => show(build())} disabled={busy || !valid}>
            <Icon d={P.send} size={16} />Show on screen
          </button>
        </div>
      </div>

      {saved.length > 0 && (
        <>
          <div className="ax-divider" style={{ margin: '32px 0 24px' }} />
          <div className="ax-panel-title" style={{ fontSize: 17, marginBottom: 14 }}>Ready to show</div>
          <div className="ax-list">
            {saved.map((t) => (
              <div key={t.id} className="ax-row" style={{ cursor: 'default' }}>
                <span className="ax-row-main">
                  <span className="ax-row-title">{summary(t)}</span>
                  <span className="ax-row-sub">{CARD_TYPES.find((c) => c.key === (t.type || 'scripture'))?.label}</span>
                </span>
                <button type="button" className="ax-btn sm" onClick={() => show(t)} disabled={busy}>Show</button>
                <button type="button" className="ax-iconbtn danger" title="Remove" onClick={() => forget(t)}><Icon d={P.trash} size={17} /></button>
              </div>
            ))}
          </div>
        </>
      )}
      {toast}
    </div>
  );
}

/* ── chat ── */

function Chat() {
  const [msgs, setMsgs] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const c = await getChat(); if (alive) { setMsgs(Array.isArray(c) ? c : []); setFailed(false); } }
      catch { if (alive) setFailed(true); }
    };
    tick();
    const t = setInterval(tick, 7000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <div className="ax-panel">
      <div className="ax-panel-title">Live chat</div>
      <p className="ax-panel-sub" style={{ marginBottom: 20 }}>Read-only here. It clears when the stream ends.</p>
      <div className="ax-chat">
        {failed ? <p className="ax-hint">Couldn’t load the chat.</p>
          : msgs === null ? <p className="ax-hint">Loading…</p>
          : msgs.length === 0 ? <p className="ax-hint">No messages yet.</p>
          : msgs.map((m, i) => (
            <div key={m.id || i} className="ax-chat-msg">
              <span className="ax-chat-who">{m.name || m.user || 'Guest'}</span>
              <span className="ax-chat-text">{m.text || m.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
