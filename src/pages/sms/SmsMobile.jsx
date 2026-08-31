import { useMemo, useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { confirmDialog } from '../../lib/dialog';
import { sendBroadcast, recordSend, smsSegments, scheduleBroadcast } from '../../lib/broadcast';
import { REPEATS } from '../../lib/recurrence';
import { groupCampaigns } from '../../lib/campaigns';
import { sendText, markRead, formatPhone } from '../../lib/conversations';
import { NEW_GROUP } from '../../lib/consent';
import { tapSelect, tapOpen, tapClose, tapSaved, tapFailed } from '../../lib/haptics';
import './SmsMobile.css';

/*
 * SMS on a phone: send something, and read what came back.
 *
 * The desktop page has five tabs — Broadcast, Library, Contacts, Groups,
 * Responses. Four of those are desk work: building groups, tidying the contact
 * list, saving templates, scheduling. Nobody does that standing in a car park,
 * and cramming them into a phone made the two things people *do* need harder to
 * reach.
 *
 * So this is those two. Everything else is still on the desktop page, untouched.
 */

const TYPES = [
  { key: 'General', label: 'Message' },
  { key: 'Dinner',  label: 'Dinner',  hint: 'Replies are counted into a headcount' },
];

const shortWhen = iso => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function SmsMobile({ owner, contacts, groups, members, threads, library = [], reload }) {
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('all');
  const [type, setType] = useState('General');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [queued, setQueued] = useState(null);
  const [openCamp, setOpenCamp] = useState(null);
  const [open, setOpen] = useState(null);      // thread being read

  /* Nobody in the New group has agreed to be texted yet. */
  const awaitingIds = useMemo(() => {
    const g = groups.find(x => x.name === NEW_GROUP);
    if (!g) return new Set();
    return new Set(members.filter(m => m.group_id === g.id).map(m => m.contact_id));
  }, [groups, members]);

  const recipients = useMemo(() => {
    if (target === 'all') {
      return contacts.filter(c => c.phone?.trim() && !c.opted_out && !awaitingIds.has(c.id));
    }
    const ids = new Set(members.filter(m => m.group_id === target).map(m => m.contact_id));
    return contacts.filter(c => ids.has(c.id) && c.phone?.trim() && !c.opted_out);
  }, [target, contacts, members, awaitingIds]);

  const targetLabel = target === 'all'
    ? 'All congregation'
    : (groups.find(g => g.id === target)?.name || 'Group');

  /*
   * Grouped by the message they answer, through the same groupCampaigns the
   * desktop uses — so a dinner headcount is the same number on both, and a
   * reminder's replies land on the campaign it chased rather than on whatever
   * went out most recently.
   */
  const campaigns = useMemo(
    () => groupCampaigns(threads, library, t => t.name || formatPhone(t.number)),
    [threads, library],
  );
  const unread = campaigns.reduce((n, c) => n + c.unread, 0);

  const seg = smsSegments(body);

  async function send() {
    if (!body.trim() || !recipients.length || sending) return;
    const ok = await confirmDialog({
      message: `Send this to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}?`,
    });
    if (!ok) return;
    setSending(true);
    const res = await sendBroadcast(recipients, body);
    setSending(false);
    if (res.sent) {
      await recordSend(owner, body.trim(), targetLabel, recipients.length, null, type);
      tapSaved();
      setBody('');
      reload?.();
    } else {
      tapFailed();
    }
  }

  return (
    <div className="sm-wrap">
      <main className="sm-scroll">

        <header className="sm-head">
          <h1 className="sm-title">SMS</h1>
        </header>

        {/* ── Say something ── */}
        <section className="sm-compose">
          <textarea
            className="sm-input"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What do you want to say to the congregation?"
            rows={4}
            aria-label="Message"
          />

          <div className="sm-row-actions">
            {/* Everything about WHO and WHAT KIND lives behind here, so the row
                itself stays three buttons wide however long a group is named. */}
            <button className="sm-icon" onClick={() => { tapOpen(); setSettingsOpen(true); }} aria-label="Message settings">
              <Icon d={P.settings} size={20} />
            </button>

            <span className="sm-row-spacer" />

            <button
              className="sm-icon"
              onClick={() => { tapOpen(); setScheduling(true); }}
              disabled={!body.trim() || !recipients.length}
              aria-label="Schedule for later"
            >
              <Icon d={P.clock} size={20} />
            </button>
            <button
              className="sm-send"
              onClick={send}
              disabled={!body.trim() || !recipients.length || sending}
              aria-label="Send now"
            >
              {sending ? '…' : <Icon d={P.send} size={21} />}
            </button>
          </div>

          {/* The settings are behind a button, so they are said in words here —
              otherwise there is nothing on screen saying who this reaches. */}
          <p className="sm-summary">
            {targetLabel} · {recipients.length}
            {type === 'Dinner' && <span className="sm-tag">Dinner</span>}
          </p>

          {/* Only worth saying once the message is long enough to cost extra. */}
          {seg.segments > 1 && (
            <p className="sm-seg">{seg.segments} texts · {seg.len} characters</p>
          )}
        </section>

        {queued && (
          <p className="sm-queued">
            Queued for {queued.toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </p>
        )}

        {/* ── What came back ── */}
        <div className="sm-replies-head">
          <h2 className="sm-h">Replies</h2>
          {unread > 0 && <span className="sm-unread">{unread} new</span>}
        </div>

        {campaigns.length === 0 ? (
          <p className="sm-empty">Nothing has come back yet.</p>
        ) : (
          <div className="sm-list">
            {campaigns.map(c => (
              <button key={c.key} className="sm-camp" onClick={() => { tapOpen(); setOpenCamp(c); }}>
                <span className={`sm-dot ${c.unread ? 'on' : ''}`} />
                <span className="sm-camp-txt">
                  <span className="sm-camp-top">
                    <span className="sm-camp-name">{c.key}</span>
                    <span className="sm-row-when">{shortWhen(c.lastAt)}</span>
                  </span>
                  <span className="sm-camp-meta">
                    {/* One bold thing per card: the headcount when there is one,
                        otherwise how many people answered. */}
                    {c.showTally
                      ? <><strong>{c.tally.total}</strong> plates · {c.replies.length} {c.replies.length === 1 ? 'reply' : 'replies'}</>
                      : <><strong>{c.replies.length}</strong> {c.replies.length === 1 ? 'reply' : 'replies'}</>}
                    {c.showTally && c.tally.unclear.length > 0 && (
                      <span className="sm-unclear">{c.tally.unclear.length} unclear</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {settingsOpen && (
        <SettingsSheet
          groups={groups}
          members={members}
          contacts={contacts}
          awaitingIds={awaitingIds}
          target={target}
          type={type}
          onTarget={setTarget}
          onType={setType}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {scheduling && (
        <ScheduleSheet
          onClose={() => setScheduling(false)}
          onConfirm={async ({ sendAt, repeat }) => {
            const { error } = await scheduleBroadcast({
              owner,
              body: body.trim(),
              target_label: targetLabel,
              recipients,
              send_at: sendAt.toISOString(),
              message_type: type,
              repeat_rule: repeat,
              /* Recorded so a repeating send rebuilds its list each time rather
                 than texting a snapshot that goes stale. */
              target_key: target,
            });
            setScheduling(false);
            if (error) { tapFailed(); return; }
            tapSaved();
            setQueued(sendAt);
            setBody('');
            reload?.();
          }}
        />
      )}

      {openCamp && (
        <CampaignSheet
          campaign={openCamp}
          onClose={() => setOpenCamp(null)}
          onOpenThread={t => { setOpenCamp(null); setOpen(t); }}
          reload={reload}
        />
      )}

      {open && <ThreadSheet thread={open} onClose={() => setOpen(null)} reload={reload} />}
    </div>
  );
}

/* ── Who it goes to, and what kind of message it is ── */
function SettingsSheet({ groups, members, contacts, awaitingIds, target, type, onTarget, onType, onClose }) {
  const countFor = id => {
    if (id === 'all') return contacts.filter(c => c.phone?.trim() && !c.opted_out && !awaitingIds.has(c.id)).length;
    const ids = new Set(members.filter(m => m.group_id === id).map(m => m.contact_id));
    return contacts.filter(c => ids.has(c.id) && c.phone?.trim() && !c.opted_out).length;
  };
  const rows = [
    { id: 'all', name: 'All congregation' },
    ...groups.filter(g => g.name !== NEW_GROUP),
  ];

  return (
    <div className="sm-scrim" onClick={onClose}>
      <div className="sm-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Message settings">
        <span className="sm-grab" />
        <div className="sm-sheet-scroll">
          <h3 className="sm-sub">Kind of message</h3>
          <div className="sm-types">
            {TYPES.map(t => (
              <button
                key={t.key}
                className={`sm-type ${type === t.key ? 'on' : ''}`}
                onClick={() => { tapSelect(); onType(t.key); }}
                aria-pressed={type === t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="sm-hint">{TYPES.find(t => t.key === type)?.hint || 'An ordinary message.'}</p>

          <h3 className="sm-sub">Send to</h3>
          <div className="sm-picks">
            {rows.map(r => (
              <button
                key={r.id}
                className={`sm-pick ${target === r.id ? 'on' : ''}`}
                onClick={() => { tapSelect(); onTarget(r.id); }}
              >
                <span className="sm-pick-name">{r.name}</span>
                <span className="sm-pick-n">{countFor(r.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="sm-done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ── Later, rather than now ── */
function ScheduleSheet({ onClose, onConfirm }) {
  /* Default to an hour from now, rounded to the next five minutes — a time
     nobody has to correct if they just want "shortly". */
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 5) * 5, 0, 0);
  const pad = n => String(n).padStart(2, '0');

  const [date, setDate] = useState(
    `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
  const [time, setTime] = useState(`${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  const [repeat, setRepeat] = useState('none');

  /* Built from the parts rather than parsed from a string, so it is the sender's
     own clock and not UTC. */
  const when = (() => {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
  })();
  const valid = !Number.isNaN(when.getTime()) && when > new Date();

  return (
    <div className="sm-scrim" onClick={onClose}>
      <div className="sm-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Schedule">
        <span className="sm-grab" />
        <div className="sm-sheet-scroll">
          <h2 className="sm-sheet-h">Send later</h2>

          <div className="sm-when">
            <label className="sm-field">
              <span>Date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label className="sm-field">
              <span>Time</span>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </label>
          </div>

          <h3 className="sm-sub">Repeat</h3>
          <div className="sm-picks">
            {REPEATS.map(r => (
              <button
                key={r.key}
                className={`sm-pick ${repeat === r.key ? 'on' : ''}`}
                onClick={() => { tapSelect(); setRepeat(r.key); }}
              >
                <span className="sm-pick-name">{r.label}</span>
              </button>
            ))}
          </div>

          {!valid && <p className="sm-warn">Pick a time in the future.</p>}
        </div>

        <button className="sm-done primary" disabled={!valid} onClick={() => onConfirm({ sendAt: when, repeat })}>
          Schedule
        </button>
      </div>
    </div>
  );
}

/* ── Everyone who answered one message ── */
function CampaignSheet({ campaign: c, onClose, onOpenThread, reload }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    /* Opening the group is reading it. */
    const unread = c.replies.filter(r => !r.read_at).map(r => r.id);
    if (unread.length) markRead(unread).then(reload);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [c, onClose, reload]);

  return (
    <div className="sm-scrim" onClick={onClose}>
      <div className="sm-sheet tall" onClick={e => e.stopPropagation()} role="dialog">
        <button className="sm-x" onClick={() => { tapClose(); onClose(); }} aria-label="Close">
          <Icon d={P.close} size={19} />
        </button>

        <div className="sm-camp-head">
          <h2 className="sm-sheet-h">{c.key}</h2>
          {c.showTally && (
            <p className="sm-total">
              <strong>{c.tally.total}</strong> plates
              {c.tally.declined.length > 0 && <span> · {c.tally.declined.length} declined</span>}
              {c.tally.unclear.length > 0 && <span> · {c.tally.unclear.length} unclear</span>}
            </p>
          )}
        </div>

        <div className="sm-camp-list">
          {c.replies.map(r => (
            <button key={r.id} className="sm-reply-row" onClick={() => { tapSelect(); onOpenThread(r.thread); }}>
              <span className="sm-reply-txt">
                <span className="sm-camp-top">
                  <span className="sm-row-name">{r.who || formatPhone(r.thread.number)}</span>
                  <span className="sm-row-when">{shortWhen(r.created_at)}</span>
                </span>
                <span className="sm-row-last">{r.body}</span>
              </span>
              <Icon d={P.chevR} size={17} className="sm-reply-go" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── One conversation ── */
function ThreadSheet({ thread, onClose, reload }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function send() {
    if (!reply.trim() || sending) return;
    setSending(true);
    const res = await sendText({ number: thread.number, name: thread.name, body: reply.trim() });
    setSending(false);
    if (res?.error) { tapFailed(); return; }
    tapSaved();
    setReply('');
    reload?.();
    onClose();
  }

  return (
    <div className="sm-scrim" onClick={onClose}>
      <div className="sm-sheet tall" onClick={e => e.stopPropagation()} role="dialog">
        <button className="sm-x" onClick={() => { tapClose(); onClose(); }} aria-label="Close">
          <Icon d={P.close} size={19} />
        </button>

        <div className="sm-thread-head">
          <h2 className="sm-sheet-h">{thread.name || formatPhone(thread.number)}</h2>
          <a className="sm-call" href={`tel:${String(thread.number).replace(/[^\d+]/g, '')}`} aria-label="Call">
            <Icon d={P.phone} size={19} />
          </a>
        </div>

        <div className="sm-bubbles">
          {thread.messages.map(m => (
            <div key={m.id} className={`sm-bub ${(m.direction || 'out') === 'in' ? 'in' : 'out'}`}>
              <span className="sm-bub-body">{m.body}</span>
              <span className="sm-bub-when">
                {new Date(m.created_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>

        <div className="sm-reply">
          <input
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Reply"
            aria-label="Reply"
          />
          <button onClick={send} disabled={!reply.trim() || sending} aria-label="Send reply">
            <Icon d={P.send} size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
