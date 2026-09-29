import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchReports, closeReport, replyToReport, sinceLabel, isTheTester } from '../../lib/appReports';
import './AppReports.css';

// ── TESTING · goes when the app's test kit does ───────────────────────────────
//
// What testers sent from the app, in the corner of Home: a line each, newest first. Click one to
// read the whole thing and see what their screen looked like; close it out and it doesn't come back.
// Nobody but the tester running the test sees any of this.
//
// Implemented (user, 2026-09-23: "add a third button that says, 'Implemented' … a type box pops up and I
// can type what was implemented in the app. Then, on that exact user who submitted the bug, a card should
// pop up just like the giving card"): the office writes what changed, and the phone that sent the report
// shows it on the app's own card — "Your bug is fixed" or "Your idea is in the app" — then the report
// closes out (lib/appReports.js replyToReport → supabase/app-report-replies.sql).

const POLL_MS = 60 * 1000;
const FEW = 4;
const MAX = 600;
const CARD_TITLE = { fixed: 'Your bug is fixed', added: 'Your idea is in the app' };

/** What they sent with it — a recording plays here, a picture is shown whole. */
function Attachment({ report }) {
  const [broke, setBroke] = useState(false);
  if (broke) {
    return (
      <p className="ar-lost">
        {report.video ? 'The recording wouldn’t play here. ' : 'The picture wouldn’t load here. '}
        <a href={report.link} target="_blank" rel="noreferrer">Open it in a new tab</a>
      </p>
    );
  }
  if (report.video) {
    return (
      <div className="ar-shot">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={report.link} controls preload="metadata" onError={() => setBroke(true)} />
        <a className="ar-shot-link" href={report.link} target="_blank" rel="noreferrer">Open the recording</a>
      </div>
    );
  }
  return (
    <div className="ar-shot">
      <a href={report.link} target="_blank" rel="noreferrer">
        <img src={report.link} alt="What the tester's screen looked like" onError={() => setBroke(true)} />
      </a>
      <a className="ar-shot-link" href={report.link} target="_blank" rel="noreferrer">Open it full size</a>
    </div>
  );
}

export default function AppReports() {
  const { profile, user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // four at a glance; every one on request (user, 2026-09-23: "It says 'see more' but I cant click")
  const [all, setAll] = useState(false);
  // Implemented: the type box, what it was, and what was sent
  const [implementing, setImplementing] = useState(false);
  const [reply, setReply] = useState('');
  const [replyKind, setReplyKind] = useState('fixed');
  const [implError, setImplError] = useState('');
  const [notice, setNotice] = useState('');
  const mine = isTheTester(profile);

  const load = useCallback(async () => {
    try { setRows(await fetchReports()); setError(''); }
    catch (e) { setRows([]); setError(e.message || 'Couldn’t read the reports.'); }
  }, []);

  useEffect(() => {
    if (!mine) return undefined;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [mine, load]);

  // "Sent" stays a few seconds, then goes
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!mine || !rows || (rows.length === 0 && !notice)) return null;

  const openReport = (r) => {
    setOpen(r);
    setImplementing(false);
    setReply('');
    setImplError('');
    setReplyKind(r.kind === 'praise' ? 'added' : 'fixed');
  };
  const closeCard = () => { setOpen(null); setImplementing(false); };

  const dismiss = async (id) => {
    setBusy(true);
    setRows((l) => l.filter((r) => r.id !== id));      // it goes at once
    setOpen((o) => (o && o.id === id ? null : o));
    try { await closeReport(id, user?.id); }
    catch (e) { setError(e.message || 'It wouldn’t close.'); load(); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const words = reply.trim();
    if (!open || !words || busy) return;
    setBusy(true);
    setImplError('');
    try {
      await replyToReport(open.id, { message: words, kind: replyKind, said: open.words });
      const who = open.from ? open.from.split(/\s+/)[0] : 'They';
      setRows((l) => l.filter((r) => r.id !== open.id));   // answered is closed out
      setOpen(null);
      setImplementing(false);
      setNotice(`Sent — ${who} will see it on their phone.`);
    } catch (e) {
      setImplError(e.message || 'It wouldn’t send. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const shown = all ? rows : rows.slice(0, FEW);
  const more = rows.length - FEW;

  return (
    <>
      <aside className="ar" aria-label="Reports from testers">
        <div className="ar-head">
          <span className="ar-dot" />
          <span className="ar-count">{rows.length ? `${rows.length} from testers` : 'Nothing waiting from testers'}</span>
        </div>
        {notice ? <div className="ar-note" role="status"><Icon d={P.check} size={15} />{notice}</div> : null}
        <div className={`ar-list${all ? ' all' : ''}`} id="ar-list">
          {shown.map((r) => (
            <div key={r.id} className="ar-row">
              <button type="button" className="ar-open" onClick={() => openReport(r)}>
                <span className={`ar-tag ${r.kind}`}>{r.kind === 'praise' ? 'Praise' : 'Bug'}</span>
                <span className="ar-main">
                  <span className="ar-words">{r.words || 'No words'}</span>
                  <span className="ar-who">{[r.from, sinceLabel(r.at)].filter(Boolean).join(' · ')}</span>
                </span>
                {r.link && (r.video
                  ? <span className="ar-thumb film" title="A recording"><Icon d={P.play} size={13} /></span>
                  : <span className="ar-thumb" style={{ backgroundImage: `url("${r.link.replace(/["\\\n]/g, encodeURIComponent)}")` }} />)}
              </button>
              <button type="button" className="ar-x" disabled={busy} title="Close it out"
                aria-label={`Close out ${r.from || 'this report'}`} onClick={() => dismiss(r.id)}>
                <Icon d={P.close} size={15} />
              </button>
            </div>
          ))}
        </div>
        {more > 0 ? (
          <button type="button" className="ar-more" onClick={() => setAll((v) => !v)}
            aria-expanded={all} aria-controls="ar-list">
            {all ? 'Show fewer' : `See all ${rows.length}`}
            <Icon d={P.chevron} size={18} className={all ? 'ar-more-up' : ''} />
          </button>
        ) : null}
        {error && <div className="ar-err">{error}</div>}
      </aside>

      {open && (
        <div className="ar-scrim" role="dialog" aria-modal="true" aria-label="Report" onClick={closeCard}>
          <div className="ar-card" onClick={(e) => e.stopPropagation()}>
            <div className="ar-card-head">
              <span className={`ar-tag ${open.kind}`}>{open.kind === 'praise' ? 'Praise' : 'Bug'}</span>
              <button type="button" className="ar-x" onClick={closeCard} aria-label="Close"><Icon d={P.close} size={17} /></button>
            </div>

            <p className="ar-said">{open.words || 'They didn’t write anything.'}</p>

            {open.link ? <Attachment key={open.id} report={open} /> : null}
            {!open.link && open.lost && (
              <p className="ar-lost">They attached something, but it didn’t make it here.</p>
            )}

            <dl className="ar-facts">
              {[
                ['From', [open.from, open.contact].filter(Boolean).join(' · ')],
                ['Page', open.facts.screen],
                ['Phone', open.facts.phone],
                ['App', open.facts.app],
                ['Sent', [sinceLabel(open.at), open.facts.when].filter(Boolean).join(' · ')],
                ['Signed in as', open.facts['signed in as']],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="ar-fact"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>

            {implementing ? (
              <div className="ar-impl">
                <div className="ar-impl-kind" role="radiogroup" aria-label="What it was">
                  {[['fixed', 'Bug fixed'], ['added', 'Idea added']].map(([k, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={replyKind === k}
                      className={`ar-impl-opt${replyKind === k ? ' on' : ''}`} onClick={() => setReplyKind(k)}>{label}</button>
                  ))}
                </div>
                <label className="ar-impl-label" htmlFor="ar-impl-text">What changed in the app?</label>
                <textarea id="ar-impl-text" className="ar-impl-text" rows={4} maxLength={MAX} autoFocus
                  value={reply} onChange={(e) => setReply(e.target.value)}
                  placeholder={replyKind === 'added' ? 'Saved Verses now shows each verse in its own colour.' : 'The Watch page opens straight away now.'}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
                {/* what their phone will show — the app's card, in words (BethesdaApp components/testkit/ReplyCard.js) */}
                <div className="ar-impl-preview" aria-label="What their phone will show">
                  <span className="ar-impl-preview-title">{CARD_TITLE[replyKind]}</span>
                  <span className="ar-impl-preview-body">{reply.trim() || 'Your words go here.'}</span>
                </div>
                <div className="ar-impl-meta">
                  <span>{`${open.from ? open.from.split(/\s+/)[0] : 'They'} will see this on their phone the next time the app is open.`}</span>
                  <span className="ar-impl-count">{`${reply.length}/${MAX}`}</span>
                </div>
                {implError ? <div className="ar-err" role="alert">{implError}</div> : null}
                <div className="ar-card-foot">
                  <button type="button" className="ar-plain" onClick={() => { setImplementing(false); setImplError(''); }}>Cancel</button>
                  <button type="button" className="ar-done" disabled={busy || !reply.trim()} onClick={send}>
                    {busy ? 'Sending…' : 'Send to their phone'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {!open.canReply ? (
                  <p className="ar-hint">This came from an older build of the app, so Implemented can’t reach their phone — close it out instead.</p>
                ) : null}
                <div className="ar-card-foot">
                  <button type="button" className="ar-plain" onClick={closeCard}>Keep it</button>
                  <button type="button" className="ar-keep" disabled={busy} onClick={() => dismiss(open.id)}>Close it out</button>
                  <button type="button" className="ar-done" disabled={busy || !open.canReply}
                    title={open.canReply ? 'Tell them it’s done — a card shows on their phone' : 'An older build: a reply can’t reach their phone'}
                    onClick={() => { setImplementing(true); setImplError(''); }}>
                    <Icon d={P.check} size={17} />Implemented
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
