import { useState, useEffect, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { fetchMembers } from '../../lib/care';
import { fetchAccounts, sendMessage } from '../../lib/email';
import '../care/Modal.css';

export default function RemindersTab({ staff, testMode }) {
  const [members, setMembers] = useState([]);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    fetchMembers().then(setMembers);
    fetchAccounts().then(a => setAccount(a[0] || null));
  }, []);

  return (
    <div>
      <ManualReminders staff={staff} members={members} account={account} testMode={testMode} />
      <AutoReminders staff={staff} members={members} account={account} testMode={testMode} />
    </div>
  );
}

/* ═══════════ Manual follow-up reminders ═══════════ */
function ManualReminders({ staff, members, account, testMode }) {
  const blank = () => ({ staffId: staff[0]?.id || '', memberId: '', note: '' });
  const [pairs, setPairs] = useState([blank()]);
  const [sending, setSending] = useState(false);

  // keep default staff when staff list loads late
  useEffect(() => {
    setPairs(p => p.map(x => x.staffId ? x : { ...x, staffId: staff[0]?.id || '' }));
  }, [staff]);

  const set = (i, k, v) => setPairs(p => p.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const valid = pairs.filter(p => p.staffId && p.memberId);

  async function send() {
    if (testMode) return toast(`Test Mode: ${valid.length} reminder${valid.length === 1 ? '' : 's'} simulated, nothing sent.`);
    if (!account) return toast('Connect an email account (Email page) to send reminders.');
    setSending(true);
    let sent = 0, failed = 0;
    for (const p of valid) {
      const s = staff.find(x => x.id === p.staffId);
      const m = members.find(x => x.id === p.memberId);
      if (!s?.email || !m) { failed++; continue; }
      try {
        await sendMessage(account, {
          to: s.email,
          subject: `Follow-up reminder: ${m.full_name}`,
          body: `Hi ${s.name?.split(' ')[0] || ''},\n\nThis is a reminder to follow up with ${m.full_name} (${m.category}${m.priority ? `, ${m.priority} priority` : ''}).${p.note ? `\n\nNote: ${p.note}` : ''}\n\n— Pillar`,
        });
        sent++;
      } catch (e) {
        failed++;
        toast(String(e.message || e));
        break; // bridge unavailable — no point continuing
      }
    }
    setSending(false);
    if (sent) { toast(`${sent} reminder${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} failed` : ''}.`); setPairs([blank()]); }
  }

  return (
    <div className="adm-panel">
      <div className="adm-panel-head"><h2>Manual Follow-up Reminders</h2></div>
      <p className="adm-panel-desc">Pair a staff member with a church member — each staff member gets a personalized follow-up reminder email.</p>
      <div className="rem-pairs">
        {pairs.map((p, i) => (
          <div key={i} className="rem-pair">
            <select value={p.staffId} onChange={e => set(i, 'staffId', e.target.value)}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="rem-arrow"><Icon d={P.arrowRight} size={15} /></span>
            <select value={p.memberId} onChange={e => set(i, 'memberId', e.target.value)}>
              <option value="">Choose member…</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <input placeholder="Optional note…" value={p.note} onChange={e => set(i, 'note', e.target.value)} />
            {pairs.length > 1 && (
              <button className="rem-x" onClick={() => setPairs(ps => ps.filter((_, idx) => idx !== i))}>
                <Icon d={P.close} size={15} />
              </button>
            )}
          </div>
        ))}
        <div className="rem-pair-foot">
          <button className="gf-add-link" onClick={() => setPairs(p => [...p, blank()])}><Icon d={P.plus} size={14} />Add another pair</button>
          <button className="btn-primary sm" disabled={!valid.length || sending} onClick={send}>
            <Icon d={P.send} size={14} />{sending ? 'Sending…' : `Send ${valid.length || ''} Reminder${valid.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Automated time-based reminders ═══════════ */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function detectTimeRefs(notes) {
  if (!notes) return [];
  const found = [];
  const now = new Date();

  // time of day within the note (default 9:00 AM)
  const timeMatch = notes.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  let hour = 9, minute = 0;
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12 + (timeMatch[3].toLowerCase() === 'pm' ? 12 : 0);
    minute = Number(timeMatch[2] || 0);
  }

  // weekday references — "this Monday", "on Friday", "next Tuesday"
  const dayRe = /\b(?:this|next|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
  let m;
  while ((m = dayRe.exec(notes)) !== null) {
    const day = (m[1] || m[2]).toLowerCase();
    const target = new Date(now);
    let diff = (WEEKDAYS.indexOf(day) - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    target.setDate(now.getDate() + diff);
    target.setHours(hour, minute, 0, 0);
    found.push({ phrase: m[0], when: target });
  }

  // numeric dates — 7/20 or 7/20/2026
  const numRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = numRe.exec(notes)) !== null) {
    const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    const d = new Date(yr, Number(m[1]) - 1, Number(m[2]), hour, minute);
    if (!isNaN(d) && d > now) found.push({ phrase: m[0], when: d });
  }

  // month-name dates — "July 20"
  const monRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi;
  while ((m = monRe.exec(notes)) !== null) {
    const d = new Date(now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), hour, minute);
    if (!isNaN(d) && d > now) found.push({ phrase: m[0], when: d });
  }

  return found;
}

function AutoReminders({ staff, members, account, testMode }) {
  const [results, setResults] = useState(null);
  const [sending, setSending] = useState(false);

  const scan = useMemo(() => () => {
    const rows = [];
    members.forEach(mem => {
      detectTimeRefs(mem.care_notes).forEach(ref => {
        const recipient = staff.find(s => s.id === mem.assigned_to) || null;
        const remindAt = new Date(ref.when.getTime() - 3 * 3600e3);
        rows.push({
          member: mem, phrase: ref.phrase, when: ref.when, remindAt,
          recipients: recipient ? [recipient] : staff.filter(s => s.email),
        });
      });
    });
    return rows.sort((a, b) => a.when - b.when);
  }, [members, staff]);

  function dryRun() { setResults(scan()); }

  async function sendNow() {
    const rows = scan();
    setResults(rows);
    if (!rows.length) return toast('No time references found in care notes.');
    if (testMode) return toast(`Test Mode: ${rows.length} reminder${rows.length === 1 ? '' : 's'} simulated.`);
    if (!account) return toast('Connect an email account (Email page) to send reminders.');
    setSending(true);
    let sent = 0;
    try {
      for (const r of rows) {
        for (const rec of r.recipients) {
          await sendMessage(account, {
            to: rec.email,
            subject: `Reminder: ${r.member.full_name} — "${r.phrase}"`,
            body: `Hi ${rec.name?.split(' ')[0] || ''},\n\n${r.member.full_name}'s care notes mention "${r.phrase}" (${r.when.toLocaleString()}).\n\nNotes:\n${r.member.care_notes}\n\n— Pillar`,
          });
          sent++;
        }
      }
      toast(`${sent} reminder email${sent === 1 ? '' : 's'} sent.`);
    } catch (e) {
      toast(String(e.message || e));
    }
    setSending(false);
  }

  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h2>Automated Time-Based Reminders</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost sm" onClick={dryRun}><Icon d={P.search} size={14} />Preview (Dry Run)</button>
          <button className="btn-primary sm" onClick={sendNow} disabled={sending}>
            <Icon d={P.send} size={14} />{sending ? 'Sending…' : 'Send Reminders Now'}
          </button>
        </div>
      </div>
      <p className="adm-panel-desc">
        Scans care notes for time references ("this Monday", "on Friday", "7/20", "July 20") and emails the assigned staff member 3 hours before the mentioned time.
      </p>

      {results !== null && (
        results.length === 0 ? (
          <div className="adm-empty">No time references found in any care notes.</div>
        ) : (
          <div className="adm-table-wrap" style={{ marginTop: 12 }}>
            <table className="adm-table">
              <thead><tr><th>Member</th><th>Detected Phrase</th><th>Event Time</th><th>Reminder At</th><th>Recipients</th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="adm-user-name">{r.member.full_name}</td>
                    <td><span className="rem-phrase">"{r.phrase}"</span></td>
                    <td className="adm-muted">{r.when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="adm-muted">{r.remindAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="adm-muted">{r.recipients.map(x => x.name).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2600);
}
