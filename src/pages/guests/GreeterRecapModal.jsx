import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchAccounts } from '../../lib/email';
import {
  fetchGreeters, fetchStaffEmails, loadRecap,
  recapSubject, recapBody, sendRecap,
} from '../../lib/recap';
import { buildGuestsDoc } from './guestPdf';
import { htmlToPdfAttachment } from '../../lib/printDoc';
import { guestWeekStart, guestWeekLabel, inGuestWeek, fetchGreeterComments } from '../../lib/guests';
import DocPreviewModal from '../../components/DocPreviewModal';
import './emailRecap.css';

const validEmail = e => /\S+@\S+\.\S+/.test(e);

export default function GreeterRecapModal({ guests, onBack, onClose }) {
  const { user, profile } = useAuth();
  const senderName = profile?.name || 'Bethesda Church';

  const [recap, setRecap]       = useState(null);
  const [greeters, setGreeters] = useState([]);
  const [staff, setStaff]       = useState([]);
  const [account, setAccount]   = useState(null);

  const [recipients, setRecipients] = useState([]);
  const [input, setInput]       = useState('');
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState('');
  /* The one document: previewed here, attached to the email, and identical to
     what the Export button produces — same builder, same rasteriser. */
  const [doc, setDoc]           = useState(null);
  const [preview, setPreview]   = useState(false);
  const [progress, setProgress] = useState(null);   // { done, total, sent, failed }
  const [misses, setMisses]     = useState([]);     // addresses that never went

  useEffect(() => {
    (async () => {
      const [g, s, accts, r] = await Promise.all([
        fetchGreeters(), fetchStaffEmails(), fetchAccounts(), loadRecap(guests),
      ]);
      setGreeters(g.rows);
      setStaff(s);
      setAccount(accts.find(a => a.app_password) || accts[0] || null);
      setRecap(r);
      setSubject(recapSubject());
      setBody(recapBody(r, senderName));

      const week = guestWeekStart();
      const weekGuests = (guests || []).filter(x => inGuestWeek(x, week));
      const comments = (await fetchGreeterComments()).filter(c => inGuestWeek(c, week));
      setDoc(buildGuestsDoc(weekGuests, 'guests', guestWeekLabel(week), comments));
    })();
  }, [guests, senderName]);

  async function retryMisses() {
    if (!misses.length || sending) return;
    setSending(true); setError(''); setProgress(null);
    try {
      const attachment = doc ? await htmlToPdfAttachment(doc.html, { filename: 'weekly-recap' }) : null;
      const res = await sendRecap({ account, recipients: misses, subject, body, senderName,
        createdBy: user?.id, recap, attachment, onProgress: setProgress });
      const still = (res?.failed || []).map(f => f.email);
      setMisses(still);
      setError(still.length ? `${still.length} still could not be reached: ${still.join(', ')}` : '');
    } catch (e) {
      setError(String(e.message || e));
    }
    setSending(false);
  }

  const has = e => recipients.some(r => r.toLowerCase() === e.toLowerCase());
  const addEmails = list => setRecipients(prev => {
    const next = [...prev];
    for (const e of list) {
      const em = e.trim();
      if (em && validEmail(em) && !next.some(x => x.toLowerCase() === em.toLowerCase())) next.push(em);
    }
    return next;
  });
  const removeEmail = e => setRecipients(prev => prev.filter(x => x !== e));
  function commitInput() {
    const parts = input.split(/[,\s]+/).filter(Boolean);
    if (parts.length) addEmails(parts);
    setInput('');
  }


  async function send() {
    if (!recipients.length || sending) return;
    setError(''); setSending(true);
    try {
      // Exactly the document shown by Preview above.
      const attachment = doc
        ? await htmlToPdfAttachment(doc.html, { filename: 'weekly-recap' })
        : null;

      const res = await sendRecap({ account, recipients, subject, body, senderName,
        createdBy: user?.id, recap, attachment, onProgress: setProgress });
      // A partial failure used to look identical to a clean send.
      const missed = (res?.failed || []).map(f => f.email);
      setMisses(missed);
      if (missed.length) {
        setError(`Sent to ${res.sent} of ${recipients.length}. ${missed.length} did not go out — use Retry below.`);
      }
      setSent(true);
    } catch (e) {
      setError(String(e.message || e));
    }
    setSending(false);
  }

  const m = recap?.metrics;

  return (
    <>
    <div className="er-overlay" onClick={onClose}>
      <div className="er-modal" onClick={e => e.stopPropagation()}>
        <div className="er-head">
          <button className="er-back" onClick={onBack}><Icon d={P.chevL} size={18} />Templates</button>
          <button className="er-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="er-title-row">
          <div className="er-badge" style={{ '--tc': '#8B5CF6' }}><Icon d={P.mail} size={20} /></div>
          <div>
            <h2>Greeter Ministry Recap</h2>
            <p>Weekly summary for your greeter team.</p>
          </div>
        </div>

        {sending ? (
          /* A minute of sequential sends needs its own screen — a button that
             just says "Sending…" looks stuck. */
          <div className="er-sending">
            <div className="er-sending-ic"><Icon d={P.send} size={24} /></div>
            <h3>Sending the recap</h3>
            <p>One email per person, so a single bad address can't stop the rest.</p>

            <div className="er-bar" role="progressbar"
              aria-valuenow={progress?.done ?? 0} aria-valuemin={0} aria-valuemax={progress?.total ?? recipients.length}>
              <div className="er-bar-fill" style={{
                width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%`,
              }} />
            </div>

            <div className="er-sending-count">
              <strong>{progress?.done ?? 0}</strong> of {progress?.total ?? recipients.length} sent
              {progress?.failed ? <span className="er-miss"> · {progress.failed} failed</span> : null}
            </div>
            <p className="er-sending-note">Keep this window open until it finishes.</p>
          </div>
        ) : sent ? (
          <div className="er-sent">
            <div className="er-sent-ic"><Icon d={P.check} size={26} /></div>
            <h3>Recap sent</h3>
            <p>
              Sent to {progress?.sent ?? recipients.length} of {recipients.length} recipient{recipients.length === 1 ? '' : 's'}.
              {misses.length > 0 && <><br /><span className="er-miss">Not delivered: {misses.join(', ')}</span></>}
            </p>
            <div className="er-sent-actions">
              {misses.length > 0 && (
                <button className="btn-primary" onClick={retryMisses} disabled={sending}>
                  {sending ? 'Retrying…' : `Retry ${misses.length}`}
                </button>
              )}
              <button className="btn-ghost" onClick={() => setPreview(true)} disabled={!doc}>Open Recap PDF</button>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="er-body">
            {/* Live stats */}
            <div className="er-stats">
              <Stat n={m?.guests ?? '—'} label="Guests this week" />
              <Stat n={recap ? recap.returning.length : '—'} label="Returning" />
              <Stat n={recap ? recap.prospects.length : '—'} label="New prospects" />
              <Stat n={m ? m.salvations + m.baptisms + m.newMembers : '—'} label="Decisions" />
            </div>

            {/* Recipients */}
            <div className="er-field">
              <label>Recipients</label>
              <div className="er-chips">
                {recipients.map(e => (
                  <span key={e} className="er-chip">
                    {e}
                    <button onClick={() => removeEmail(e)}><Icon d={P.close} size={12} /></button>
                  </span>
                ))}
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitInput(); }
                    if (e.key === 'Backspace' && !input && recipients.length) removeEmail(recipients[recipients.length - 1]);
                  }}
                  onBlur={commitInput}
                  placeholder={recipients.length ? '' : 'Add email…'}
                />
              </div>
              <div className="er-quick">
                <button className="er-quick-btn" onClick={() => addEmails(staff.map(s => s.email))} disabled={!staff.length}>
                  <Icon d={P.plus} size={13} />Staff <em>{staff.length}</em>
                </button>
                <button className="er-quick-btn" onClick={() => addEmails(greeters.map(g => g.email))} disabled={!greeters.length}>
                  <Icon d={P.plus} size={13} />Greeters <em>{greeters.length}</em>
                </button>
                {/* Saved greeters are added as one group. Listing all 32 as
                    individual chips buried the two buttons that matter. */}
              </div>
            </div>

            {/* Subject + body */}
            <div className="er-field">
              <label>Subject</label>
              <input className="er-input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="er-field">
              <label>Message</label>
              <textarea className="er-textarea" rows={9} value={body} onChange={e => setBody(e.target.value)} />
            </div>

            <div className="er-pdfnote">
              <Icon d={P.pdf} size={15} />
              <span>The <strong>Weekly Recap PDF</strong> is automatically attached to this email. Preview it before sending:</span>
              <button className="er-pdf-btn" onClick={() => setPreview(true)} disabled={!doc}>
                <Icon d={P.pdf} size={14} /> Preview PDF
              </button>
            </div>

            {!account && (
              <div className="er-warn">No personal email account connected — this will send from the church account (noreply@bethesdaupdates.org).</div>
            )}
            {error && <div className="er-error">{error}</div>}

            <div className="er-foot">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={send} disabled={sending || !recipients.length || !subject.trim()}>
                <Icon d={P.send} size={15} />
                {sending
                  ? (progress ? `Sending ${progress.done} of ${progress.total}…` : 'Sending…')
                  : `Send to ${recipients.length || 0}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {preview && doc && (
      <DocPreviewModal
        html={doc.html}
        filename="weekly-recap"
        title={`${doc.heading} — attached to this email`}
        onClose={() => setPreview(false)}
      />
    )}
    </>
  );
}

function Stat({ n, label }) {
  return (
    <div className="er-stat">
      <span className="er-stat-n">{n}</span>
      <span className="er-stat-l">{label}</span>
    </div>
  );
}
