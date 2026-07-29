import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchAccounts, sendMessage } from '../../lib/email';
import { fetchStaffEmails } from '../../lib/recap';
import { buildServicePdfFile, fmtServiceDate, openServicePrint } from './serviceDoc';
import { blockTitle } from './blocks';
import '../guests/emailRecap.css';

const validEmail = e => /\S+@\S+\.\S+/.test(e);

export default function SendServiceModal({ plan, onClose }) {
  const { profile } = useAuth();
  const senderName = profile?.name || 'Bethesda Church';

  const [staff, setStaff]     = useState([]);
  const [account, setAccount] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [input, setInput]     = useState('');
  const [note, setNote]       = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    (async () => {
      const [s, accts] = await Promise.all([fetchStaffEmails(), fetchAccounts()]);
      setStaff(s);
      setAccount(accts.find(a => a.app_password) || accts[0] || null);
      setRecipients(s.map(x => x.email));   // staff pre-selected
    })();
  }, []);

  const has = e => recipients.some(r => r.toLowerCase() === e.toLowerCase());
  const addEmails = list => setRecipients(prev => {
    const next = [...prev];
    for (const e of list) {
      const em = (e || '').trim();
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

  const missingStaff = useMemo(() => staff.filter(s => !has(s.email)), [staff, recipients]);

  const subject = `${plan.title || 'Sunday Service'} — ${plan.service || ''} · ${fmtServiceDate(plan.date)}`.trim();

  function buildBody() {
    const lines = [];
    if (note.trim()) lines.push(note.trim(), '');
    lines.push(`${plan.title || 'Sunday Service'}`, `${plan.service || ''}  ·  ${fmtServiceDate(plan.date)}`, '');
    lines.push('Service order:');
    plan.blocks.forEach((b, i) => {
      const detail = b.kind === 'music' ? (b.musicKey ? ` (Key of ${b.musicKey})` : '')
        : (b.notes ? ` — ${b.notes.replace(/\s+/g, ' ').trim()}` : '');
      lines.push(`${i + 1}. ${blockTitle(b)}${detail}`);
    });
    if (!plan.blocks.length) lines.push('(No items yet.)');
    lines.push('', 'The full formatted service order is attached as a PDF.', '', `— ${senderName}`);
    return lines.join('\n');
  }

  async function send() {
    if (!recipients.length || sending || !account) return;
    setError(''); setSending(true);
    try {
      await sendMessage(account, {
        to: recipients.join(', '),
        subject,
        body: buildBody(),
        attachments: [buildServicePdfFile(plan)],
      });
      setSent(true);
    } catch (e) {
      setError(String(e.message || e));
    }
    setSending(false);
  }

  return (
    <div className="er-overlay" onClick={onClose}>
      <div className="er-modal" onClick={e => e.stopPropagation()}>
        <div className="er-head">
          <span />
          <button className="er-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="er-title-row">
          <div className="er-badge" style={{ '--tc': '#006BFF' }}><Icon d={P.mail} size={20} /></div>
          <div>
            <h2>Send service plan</h2>
            <p>{plan.service || ''} · {fmtServiceDate(plan.date)}</p>
          </div>
        </div>

        {sent ? (
          <div className="er-sent">
            <div className="er-sent-ic"><Icon d={P.check} size={26} /></div>
            <h3>Plan sent</h3>
            <p>Sent to {recipients.length} recipient{recipients.length === 1 ? '' : 's'}.</p>
            <div className="er-sent-actions">
              <button className="btn-ghost" onClick={() => openServicePrint(plan)}>Open PDF</button>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="er-body">
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
                <button className="er-quick-btn" onClick={() => addEmails(staff.map(s => s.email))} disabled={!missingStaff.length}>
                  <Icon d={P.plus} size={13} />All staff <em>{staff.length}</em>
                </button>
                {missingStaff.map(s => (
                  <button key={s.email} className="er-quick-btn saved" onClick={() => addEmails([s.email])} title={s.email}>
                    <Icon d={P.plus} size={13} />{s.name || s.email}
                  </button>
                ))}
              </div>
            </div>

            <div className="er-field">
              <label>Subject</label>
              <input className="er-input" value={subject} readOnly />
            </div>
            <div className="er-field">
              <label>Note at the top <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span></label>
              <textarea className="er-textarea" rows={4} value={note} onChange={e => setNote(e.target.value)}
                placeholder="Add a message for the team…" />
            </div>

            <div className="er-pdfnote">
              <Icon d={P.pdf} size={15} />
              <span>The formatted <strong>service order PDF</strong> is attached automatically.</span>
              <button className="er-pdf-btn" onClick={() => openServicePrint(plan)}><Icon d={P.pdf} size={14} /> Preview</button>
            </div>

            {!account && (
              <div className="er-warn">Connect an email account in the <strong>Email</strong> module (desktop app) to send. You can still Print or download the PDF.</div>
            )}
            {error && <div className="er-error">{error}</div>}

            <div className="er-foot">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={send} disabled={sending || !recipients.length || !account}>
                <Icon d={P.send} size={15} />{sending ? 'Sending…' : `Send to ${recipients.length || 0}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
