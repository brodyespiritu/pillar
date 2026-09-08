import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import {
  fetchContacts, addContact, addContacts, updateContact, deleteContact,
  fetchGroups, addGroup, deleteGroup,
  fetchMemberships, setContactGroups, importFromPillar,
  sendBroadcast, smsSegments,
  fetchLibrary, deleteLibraryItem, recordSend, saveToLibrary, createRsvpLink, fetchRsvpInfo,
  silentRecipients, REMINDER_TEXT, REMIND_STATUS,
  fetchScheduled, scheduleBroadcast, cancelScheduled,
} from '../../lib/broadcast';
import { fetchChurchMembers, initials } from '../../lib/members';
import { fetchThreads, sendText, markRead, setRsvp, normPhone, formatPhone, sepLabel } from '../../lib/conversations';
/* The conversation primitives — .cv-scroll, .cv-msg, .cv-bubble, .cv-compose,
   .cv-send, .cv-ava, .cv-placeholder — are shared with the Guests conversations
   modal. None of that file's shell selectors match this markup. */
import '../guests/conversations.css';
import { tallyReplies, parseHeadcount } from '../../lib/rsvp';
import { groupCampaigns, campaignLabel } from '../../lib/campaigns';
import { pollOptions } from '../../lib/poll';
import RsvpLink, { MenuEditor } from './RsvpLink';
import SmsOverview from './SmsOverview';
import PillMenu from './PillMenu';
import { splitByHours, windowOpen, WINDOW_LABEL } from '../../lib/quietHours';
import { REPEATS, repeatSummary } from '../../lib/recurrence';
import { NEW_GROUP, DISCLOSURE_DEFAULT, STOP_LINE, withStopLine, clearApproved } from '../../lib/consent';
import '../care/Modal.css';
import '../admin/Admin.css';
import { useIsMobile } from '../../lib/useIsMobile';
import SmsMobile from './SmsMobile';
import './Sms.css';

/* Dinner is the one that changes behaviour: its replies are tallied. */
const MESSAGE_TYPES = [
  { key: 'Dinner',  icon: P.meal,  hint: 'Count the replies into a headcount' },
  /* A poll takes its options from the message text — "[1] Immediately" — so the
     wording people read and the answers we accept can never drift apart. */
  { key: 'Poll',    icon: P.check, hint: 'Numbered options; replies record a choice' },
  { key: 'General', icon: P.sms,   hint: 'An ordinary message' },
];

const TABS = [
  { key: 'broadcast', name: 'Broadcast' },
  { key: 'library',   name: 'Library' },
  { key: 'contacts',  name: 'Contacts' },
  { key: 'groups',    name: 'Groups' },
  { key: 'responses', name: 'Responses' },
];

export default function SmsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('broadcast');
  const [contacts, setContacts] = useState({ rows: [], missing: false });
  const [threads, setThreads] = useState({ rows: [], missing: false });
  const [groups, setGroups] = useState({ rows: [], missing: false });
  const [members, setMembers] = useState([]); // group memberships
  const [library, setLibrary] = useState({ rows: [], missing: false });
  const [scheduled, setScheduled] = useState({ rows: [], missing: false });
  const [draft, setDraft] = useState({ body: '', n: 0 }); // n bumps to remount compose

  async function load() {
    const [c, g, m, l, s, th] = await Promise.all([
      fetchContacts(), fetchGroups(), fetchMemberships(), fetchLibrary(), fetchScheduled(),
      fetchThreads(),
    ]);
    setContacts(c); setGroups(g); setMembers(m); setLibrary(l); setScheduled(s); setThreads(th);
  }
  useEffect(() => { load(); }, []);

  const useMessage = body => { setDraft(d => ({ body, n: d.n + 1 })); setTab('broadcast'); };

  const missing = contacts.missing && groups.missing;

  if (isMobile) {
    return (
      <SmsMobile
        owner={user?.id}
        contacts={contacts.rows}
        groups={groups.rows}
        members={members}
        threads={threads.rows}
        library={library.rows}
        reload={load}
      />
    );
  }

  return (
    <div className="sms-wrap">
      <TopNav />
      <main className={`sms-scroll ${tab === 'responses' ? 'pane' : ''}`}>
        {/* A coloured band, with the composer sitting across its lower edge. */}
        <div className={`sms-band ${tab === 'broadcast' ? 'tall' : ''}`}>
          <div className="sms-band-inner">
            <h1 className="sms-title">SMS</h1>
            {/* Names only. The icons repeated what the words said, and the
                counts are already on the sections below the composer. */}
            {!missing && (
              <nav className="sms-tabs">
                {TABS.map(t => (
                  <button key={t.key} className={`sms-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                    {t.name}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </div>

        <div className={`sms-container ${tab === 'broadcast' ? 'overlap' : ''} ${tab === 'responses' ? 'pane' : ''}`}>
          {missing ? (
            <div className="adm-placeholder">
              <div className="adm-placeholder-icon"><Icon d={P.sms} size={28} /></div>
              <h2>Set up SMS</h2>
              <p>Run <strong>supabase/sms-schema.sql</strong> and <strong>supabase/broadcast-schema.sql</strong> to enable contacts, groups, and congregation texting.</p>
            </div>
          ) : (<>
            {tab === 'broadcast' && (<>
              <Broadcast key={draft.n} owner={user?.id} initialBody={draft.body}
                         contacts={contacts.rows} groups={groups.rows} members={members} reload={load} />
              <SmsOverview threads={threads} library={library} scheduled={scheduled}
                           groups={groups.rows} members={members} contacts={contacts.rows}
                           onOpen={setTab} />
            </>)}
            {tab === 'library'   && <Library library={library} scheduled={scheduled} onUse={useMessage} reload={load} />}
            {tab === 'contacts'  && <Contacts owner={user?.id} contacts={contacts.rows} groups={groups.rows} members={members} reload={load} />}
            {tab === 'groups'    && <Groups owner={user?.id} groups={groups.rows} members={members}
                                 contacts={contacts.rows} reload={load} />}
            {tab === 'responses' && <Responses threads={threads} contacts={contacts.rows}
              library={library.rows} reload={load} />}
          </>)}
        </div>
      </main>
    </div>
  );
}

/* ═══════════ Broadcast ═══════════ */
function Broadcast({ owner, initialBody = '', contacts, groups, members, reload }) {
  const [target, setTarget] = useState('all');   // 'all' | groupId
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [scheduling, setScheduling] = useState(false);   // modal open
  const [scheduledFor, setScheduledFor] = useState(null); // confirmation banner
  /* A Dinner send has its replies counted into a headcount on the Responses
     tab; everything else is just a message. */
  const [msgType, setMsgType] = useState('General');
  /* The shareable reservation link for this dinner, once someone asks for it.
     Asking opens the menu first — what is being served shows on the form. */
  const [link, setLink] = useState('');
  const [menu, setMenu] = useState(null);        // null until "Create link" is pressed
  const [linking, setLinking] = useState(false);
  const [linkErr, setLinkErr] = useState('');

  /* Open the editor on whatever this dinner already has, not a blank slate. */
  async function openMenu() {
    setMenu(['']);
    const info = await fetchRsvpInfo(body);
    setMenu(info.menu.length ? info.menu : ['']);
  }


  async function saveLink() {
    if (linking) return;
    setLinking(true); setLinkErr('');
    const res = await createRsvpLink(owner, body, menu);
    setLinking(false);
    if (res.error) setLinkErr(res.error);
    else { setLink(res.url); setMenu(null); }
  }
  /* A different message is a different dinner — the old link is not its link. */
  useEffect(() => { setLink(''); setMenu(null); setLinkErr(''); }, [body, msgType]);

  /*
   * Anyone still in New has not been told they are on the list, so a
   * congregation-wide send leaves them out — being told is what puts them on
   * the regular list. Choosing the New group by name still reaches them, which
   * is how the approval itself goes out.
   */
  const awaitingIds = useMemo(() => {
    const g = groups.find(x => x.name === NEW_GROUP);
    if (!g) return new Set();
    return new Set(members.filter(m => m.group_id === g.id).map(m => m.contact_id));
  }, [groups, members]);

  const recipients = useMemo(() => {
    /* Anyone who texted STOP is out of every list. Telnyx would refuse them
       anyway; excluding them here keeps the count honest. */
    if (target === 'all') return contacts.filter(c => c.phone?.trim() && !c.opted_out && !awaitingIds.has(c.id));
    const ids = new Set(members.filter(m => m.group_id === target).map(m => m.contact_id));
    return contacts.filter(c => ids.has(c.id) && c.phone?.trim() && !c.opted_out);
  }, [target, contacts, members, awaitingIds]);

  const targetLabel = target === 'all'
    ? 'All congregation'
    : (groups.find(g => g.id === target)?.name || 'Group');

  const seg = smsSegments(body);

  async function send() {
    if (!body.trim() || !recipients.length) return;
    if (!(await confirmDialog({ message: `Send this message to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}?` }))) return;
    setSending(true); setResult(null); setScheduledFor(null);
    const res = await sendBroadcast(recipients, body);
    setResult(res);
    setSending(false);
    if (res.sent) {
      await recordSend(owner, body.trim(), targetLabel, recipients.length, null, msgType);
      setBody('');
      reload?.();
    }
  }

  async function onScheduled({ sendAt, save, title, repeat }) {
    const when = sendAt.toISOString();
    const { error } = await scheduleBroadcast({
      owner, body: body.trim(), target_label: targetLabel, recipients, send_at: when,
      message_type: msgType,
      repeat_rule: repeat,
      /* Recorded so a repeating send rebuilds its list each time instead of
         texting the congregation as it stood the day it was scheduled. */
      target_key: target,
    });
    if (error) {
      setScheduling(false);
      setResult({ sent: 0, failed: [{ error: /relation|does not exist/i.test(error.message || '') ? 'Run supabase/sms-library-schema.sql to enable scheduling.' : error.message }] });
      return;
    }
    if (save) await saveToLibrary(owner, body.trim(), targetLabel, recipients.length, title || null);
    setScheduling(false);
    setScheduledFor(sendAt);
    setBody('');
    reload?.();
  }

  return (
    <div className="sms-broadcast">
      {/*
        * One sheet: what you are writing, then a single bar of controls under
        * it. Who it goes to and what kind of message it is are pills rather
        * than labelled rows — the bar has room for two controls, and the send
        * is the only round thing on the page.
        */}
      <div className="sms-compose">
        <textarea className="sms-body" rows={5} value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What do you want to say to the congregation?" />

        <div className="sms-bar">
          <PillMenu
            ariaLabel="Who to send to"
            icon={P.users}
            value={target}
            onChange={setTarget}
            options={[
              { key: 'all', label: 'All congregation',
                badge: contacts.filter(c => c.phone?.trim() && !c.opted_out && !awaitingIds.has(c.id)).length },
              ...groups.map(g => ({
                key: g.id, label: g.name,
                badge: members.filter(m => m.group_id === g.id).length,
              })),
            ]}
          />
          <PillMenu
            ariaLabel="Message type"
            icon={msgType === 'Dinner' ? P.meal : msgType === 'Poll' ? P.check : P.sms}
            value={msgType}
            onChange={setMsgType}
            options={MESSAGE_TYPES.map(mt => ({ key: mt.key, label: mt.key }))}
          />

          <span className="sms-bar-gap" />

          <button className="sms-round ghost" onClick={() => setScheduling(true)} title="Schedule for later"
                  disabled={sending || !body.trim() || !recipients.length}>
            <Icon d={P.clock} size={18} />
          </button>
          <button className="sms-round send" onClick={send} title={`Send to ${recipients.length}`}
                  disabled={sending || !body.trim() || !recipients.length}>
            <Icon d={P.send} size={18} />
          </button>
        </div>
      </div>

      <p className="sms-meta">
        {recipients.length} recipient{recipients.length === 1 ? '' : 's'} · {targetLabel}
        {seg.len > 0 && ` · ${seg.segments} segment${seg.segments === 1 ? '' : 's'}`}
        {' · '}Each person gets their own text, not a group thread.
        {target === 'all' && awaitingIds.size > 0 &&
          ` ${awaitingIds.size} new contact${awaitingIds.size === 1 ? '' : 's'} left out until approval is sent.`}
      </p>

      {/* What a poll will actually accept, read back from the wording. Written
          here so a numbered list that does not parse is caught before it goes
          out, not after nobody's replies are recorded. */}
      {msgType === 'Poll' && <PollPreview body={body} />}

      {msgType === 'Dinner' && (
        <div className="sms-dinner">
          {link ? <RsvpLink url={link} />
            : menu ? (<>
              <MenuEditor items={menu} onChange={setMenu} />
              <button type="button" className="sms-link-btn" onClick={saveLink} disabled={linking}>
                {linking ? 'Saving…' : 'Save'}
              </button>
            </>) : (
              <button type="button" className="sms-link-btn" onClick={openMenu} disabled={!body.trim()}>
                <Icon d={P.link} size={15} />Update link
              </button>
            )}
          {linkErr && <p className="sms-link-err">{linkErr}</p>}
          <p className="sms-type-hint">
            {link
              ? 'The website is updated. Same link every week — it always shows the current dinner.'
              : 'Replies are counted into a headcount on the Responses tab.'}
          </p>
        </div>
      )}

      {result && (
        <div className={`sms-result ${result.failed?.length ? 'warn' : 'ok'}`}>
          <Icon d={result.failed?.length ? P.shield : P.check} size={15} />
          {result.sent} sent{result.failed?.length ? ` · ${result.failed.length} failed` : ''}
          {result.failed?.length > 0 && <span className="sms-result-err">{result.failed[0].error}</span>}
        </div>
      )}
      {scheduledFor && (
        <div className="sms-result ok">
          <Icon d={P.clock} size={15} />
          Scheduled for {scheduledFor.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {scheduling && (
        <ScheduleModal
          recipientCount={recipients.length}
          targetLabel={targetLabel}
          body={body}
          onClose={() => setScheduling(false)}
          onConfirm={onScheduled}
        />
      )}

    </div>
  );
}

/* ═══════════ Schedule for later ═══════════ */
function ScheduleModal({ recipientCount, targetLabel, body, onClose, onConfirm }) {
  const pad = n => String(n).padStart(2, '0');
  const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toTimeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // Default: one hour from now, rounded up to the next half hour
  const init = new Date(Date.now() + 60 * 60 * 1000);
  init.setMinutes(init.getMinutes() < 30 ? 30 : 60, 0, 0);

  const [date, setDate] = useState(toDateStr(init));
  const [time, setTime] = useState(toTimeStr(init));
  const [save, setSave] = useState(true);
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [busy, setBusy] = useState(false);

  const PRESETS = useMemo(() => {
    const list = [];
    const today5 = new Date(); today5.setHours(17, 0, 0, 0);
    if (today5 > new Date()) list.push({ label: 'Today 5:00 PM', d: today5 });
    const tom9 = new Date(); tom9.setDate(tom9.getDate() + 1); tom9.setHours(9, 0, 0, 0);
    list.push({ label: 'Tomorrow 9:00 AM', d: tom9 });
    const sun = new Date(); sun.setDate(sun.getDate() + ((7 - sun.getDay()) % 7 || 7)); sun.setHours(8, 0, 0, 0);
    list.push({ label: `Sunday 8:00 AM`, d: sun });
    return list;
  }, []);

  const sendAt = useMemo(() => {
    if (!date || !time) return null;
    const d = new Date(`${date}T${time}`);
    return isNaN(d) ? null : d;
  }, [date, time]);
  const inFuture = sendAt && sendAt > new Date();
  const isPreset = p => sendAt && sendAt.getTime() === p.d.getTime();

  async function confirm() {
    if (!inFuture) return;
    setBusy(true);
    await onConfirm({ sendAt, save, title: title.trim(), repeat });
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>Schedule for later</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <div className="sms-sched-summary">
            <div className="sms-sched-bubble">{body}</div>
            <span>Sends to <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? '' : 's'} · {targetLabel}</span>
          </div>

          <div className="field-group"><span>When</span>
            <div className="sms-sched-presets">
              {PRESETS.map(p => (
                <button key={p.label} className={`sms-sched-preset ${isPreset(p) ? 'on' : ''}`}
                        onClick={() => { setDate(toDateStr(p.d)); setTime(toTimeStr(p.d)); }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="sms-sched-when">
              <input type="date" value={date} min={toDateStr(new Date())} onChange={e => setDate(e.target.value)} />
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            {!inFuture && <span className="sms-sched-err">Pick a time in the future.</span>}
          </div>

          <div className="field-group"><span>Repeat</span>
            <div className="sms-sched-presets">
              {REPEATS.map(r => (
                <button key={r.key} className={`sms-sched-preset ${repeat === r.key ? 'on' : ''}`}
                        onClick={() => setRepeat(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            {repeat !== 'none' && sendAt && (
              <span className="sms-sched-repeat">
                {repeatSummary(repeat, sendAt)} at{' '}
                {sendAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.
                Each send queues the next one, and the list is rebuilt every time so
                people added later are included.
              </span>
            )}
          </div>

          <label className={`sms-group-check ${save ? 'on' : ''}`} style={{ marginTop: 4 }}>
            <input type="checkbox" checked={save} onChange={() => setSave(s => !s)} />
            Save this message to the Library
          </label>
          {save && (
            <label className="field-group" style={{ marginTop: 10 }}><span>Library name (optional)</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sunday service reminder" />
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={confirm} disabled={busy || !inFuture}>
            <Icon d={P.clock} size={15} />{busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Library ═══════════ */
function Library({ library, scheduled, onUse, reload }) {
  const fmtWhen = iso => new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  if (library.missing && scheduled.missing) {
    return (
      <div className="adm-placeholder">
        <div className="adm-placeholder-icon"><Icon d={P.archive} size={28} /></div>
        <h2>Set up the Library</h2>
        <p>Run <strong>supabase/sms-library-schema.sql</strong> to enable saved messages and scheduled sends.</p>
      </div>
    );
  }

  const pending = scheduled.rows.filter(s => s.status === 'pending' || s.status === 'processing');
  const past    = scheduled.rows.filter(s => s.status === 'sent' || s.status === 'failed').slice(-3);

  async function cancel(s) {
    /* A repeating schedule is only ever one pending row — the next occurrence is
       written when this one sends — so cancelling it ends the whole series. */
    const repeating = s.repeat_rule && s.repeat_rule !== 'none';
    if (!(await confirmDialog({
      title: repeating ? 'End this repeating text?' : 'Cancel this scheduled text?',
      message: repeating
        ? `${repeatSummary(s.repeat_rule, new Date(s.send_at))}. Ending it stops this send and every one after it.`
        : undefined,
      confirmLabel: repeating ? 'End series' : 'Cancel it',
      danger: true,
    }))) return;
    await cancelScheduled(s.id); reload();
  }
  async function removeItem(item) {
    if (!(await confirmDialog({ message: 'Delete this message from the library?' }))) return;
    await deleteLibraryItem(item.id); reload();
  }

  return (
    <div className="sms-library">
      {(pending.length > 0 || past.length > 0) && (
        <div className="adm-panel">
          <div className="adm-panel-head"><h2>Scheduled</h2></div>
          <div className="sms-lib-list">
            {pending.map(s => (
              <div key={s.id} className="sms-lib-row">
                <div className="sms-lib-icon sched"><Icon d={P.clock} size={17} /></div>
                <div className="sms-lib-main">
                  <span className="sms-lib-body">{s.body}</span>
                  <span className="sms-lib-meta">
                    Sends {fmtWhen(s.send_at)} · {(s.recipients || []).length} recipients · {s.target_label}
                    {s.repeat_rule && s.repeat_rule !== 'none' &&
                      ` · ${repeatSummary(s.repeat_rule, new Date(s.send_at))}`}
                  </span>
                </div>
                <button className="btn-ghost sm" onClick={() => cancel(s)}>
                  {s.repeat_rule && s.repeat_rule !== 'none' ? 'End series' : 'Cancel'}
                </button>
              </div>
            ))}
            {past.map(s => (
              <div key={s.id} className="sms-lib-row past">
                <div className={`sms-lib-icon ${s.status}`}><Icon d={s.status === 'sent' ? P.check : P.shield} size={17} /></div>
                <div className="sms-lib-main">
                  <span className="sms-lib-body">{s.body}</span>
                  <span className="sms-lib-meta">
                    {s.status === 'sent' ? `Sent ${fmtWhen(s.sent_at || s.send_at)} · ${s.sent_count ?? 0} delivered` : `Failed · ${s.error || 'unknown error'}`}
                  </span>
                </div>
              </div>
            ))}
            {pending.length === 0 && past.length === 0 && (
              <div className="adm-empty">Nothing scheduled.</div>
            )}
          </div>
        </div>
      )}

      <div className="adm-panel">
        <div className="adm-panel-head"><h2>Saved messages</h2></div>
        <div className="sms-lib-list">
          {library.rows.map(item => (
            <div key={item.id} className="sms-lib-row">
              <div className="sms-lib-icon"><Icon d={P.sms} size={17} /></div>
              <div className="sms-lib-main">
                {item.title && <span className="sms-lib-title">{item.title}</span>}
                <span className="sms-lib-body">{item.body}</span>
                <span className="sms-lib-meta">
                  {item.last_sent_at
                    ? `Last sent ${fmtWhen(item.last_sent_at)} · ${item.recipient_count || 0} recipients`
                    : 'Not sent yet'}
                  {item.target_label ? ` · ${item.target_label}` : ''}
                </span>
              </div>
              <div className="sms-lib-actions">
                <button className="btn-primary sm" onClick={() => onUse(item.body)}><Icon d={P.send} size={13} />Use</button>
                <button className="adm-menu-btn" title="Delete" onClick={() => removeItem(item)} style={{ fontSize: 15 }}>×</button>
              </div>
            </div>
          ))}
          {library.rows.length === 0 && (
            <div className="adm-empty">No saved messages yet. Every broadcast you send lands here automatically — or check "Save to Library" when scheduling.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Contacts ═══════════ */
function Contacts({ owner, contacts, groups, members, reload }) {
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);   // contact being edited, or {} for new
  const [importing, setImporting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const groupsFor = id => members.filter(m => m.contact_id === id).map(m => groups.find(g => g.id === m.group_id)?.name).filter(Boolean);
  const rows = contacts.filter(c => !search.trim() || [c.name, c.phone].filter(Boolean).some(v => v.toLowerCase().includes(search.toLowerCase())));

  async function doImport() {
    setImporting(true);
    const n = await importFromPillar(owner, contacts.map(c => c.phone));
    setImporting(false);
    reload();
    toast(n ? `Imported ${n} contact${n === 1 ? '' : 's'} from Pillar.` : 'No new phone numbers found.');
  }
  async function remove(c) {
    if (!(await confirmDialog({ message: `Remove ${c.name || c.phone}?` }))) return;
    await deleteContact(c.id); reload();
  }

  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h2>Contacts</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="adm-search"><Icon d={P.search} size={16} /><input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <button className="btn-ghost sm" onClick={doImport} disabled={importing}><Icon d={P.folder} size={14} />{importing ? 'Importing…' : 'Import'}</button>
          <button className="btn-ghost sm" onClick={() => setPickerOpen(true)}><Icon d={P.person} size={14} />From Members</button>
          <button className="btn-primary sm" onClick={() => setEdit({})}><Icon d={P.plus} size={14} />Add Contact</button>
        </div>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table sms-ctable">
          <thead><tr><th>Name</th><th>Phone</th><th>Groups</th><th></th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td className="adm-user-name">{c.name || '—'}</td>
                <td className="sms-ctable-phone">{c.phone}</td>
                <td>{groupsFor(c.id).map(g => <span key={g} className="sms-chip">{g}</span>)}</td>
                <td className="adm-actions-cell">
                  <button className="adm-menu-btn" title="Edit" onClick={() => setEdit(c)}><Icon d={P.edit} size={14} /></button>
                  <button className="adm-menu-btn" title="Remove" onClick={() => remove(c)}><Icon d={P.close} size={14} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="adm-empty">No contacts yet. Add one or import from Pillar.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <ContactModal owner={owner} contact={edit} groups={groups} members={members} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {pickerOpen && <MemberPickerModal owner={owner} contacts={contacts} onClose={() => setPickerOpen(false)} onAdded={n => { setPickerOpen(false); reload(); toast(`Added ${n} contact${n === 1 ? '' : 's'} from Members.`); }} />}
    </div>
  );
}

/* ── Pull contacts straight from the member directory ──
   Left: everyone on the Members page with a phone number. Click a name to
   stage it on the right; "Add" copies the staged people into SMS Contacts. */
function MemberPickerModal({ owner, contacts, onClose, onAdded }) {
  const [directory, setDirectory] = useState(null);   // null = loading
  const [search, setSearch] = useState('');
  const [staged, setStaged] = useState([]);           // member ids, in click order
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchChurchMembers().then(d => setDirectory(d.rows || [])); }, []);

  const norm = p => String(p || '').replace(/\D/g, '').slice(-10);
  const inContacts = useMemo(() => new Set(contacts.map(c => norm(c.phone)).filter(Boolean)), [contacts]);

  const withPhones = useMemo(() => (directory || []).filter(m => m.phone?.trim()), [directory]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withPhones;
    return withPhones.filter(m => [m.name, m.phone].filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }, [withPhones, search]);

  const stagedRows = useMemo(
    () => staged.map(id => withPhones.find(m => m.id === id)).filter(Boolean),
    [staged, withPhones],
  );

  const toggle = m => {
    if (inContacts.has(norm(m.phone))) return;   // already a contact
    setStaged(s => (s.includes(m.id) ? s.filter(x => x !== m.id) : [...s, m.id]));
  };

  async function save() {
    if (!stagedRows.length || saving) return;
    setSaving(true);
    // Dedupe by phone within the staged batch too (e.g. spouses sharing a line).
    const seen = new Set();
    const toAdd = [];
    for (const m of stagedRows) {
      const key = norm(m.phone);
      if (seen.has(key)) continue;
      seen.add(key);
      toAdd.push({ owner, name: m.name, phone: m.phone.trim() });
    }
    const { error } = await addContacts(toAdd);
    setSaving(false);
    if (error) return toast(`Could not add contacts: ${error.message}`);
    onAdded(toAdd.length);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Add from Members</h2>
            <p className="tp-sub">Click a name to copy it into SMS Contacts.</p>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="mp-body">
          {/* Left — the member directory */}
          <div className="mp-left">
            <div className="adm-search mp-search"><Icon d={P.search} size={16} /><input placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)} autoFocus /></div>
            <div className="mp-list">
              {directory === null && <p className="mp-note">Loading members…</p>}
              {directory !== null && rows.length === 0 && <p className="mp-note">{withPhones.length ? 'No matches.' : 'No members with phone numbers yet.'}</p>}
              {rows.map(m => {
                const already = inContacts.has(norm(m.phone));
                const picked = staged.includes(m.id);
                return (
                  <button key={m.id} type="button"
                    className={`mp-row ${picked ? 'picked' : ''} ${already ? 'have' : ''}`}
                    onClick={() => toggle(m)} disabled={already}>
                    <span className="mp-avatar">{m.photo_url ? <img src={m.photo_url} alt="" /> : <span>{initials(m.name)}</span>}</span>
                    <span className="mp-row-text">
                      <span className="mp-row-name">{m.name}</span>
                      <span className="mp-row-phone">{m.phone}</span>
                    </span>
                    <span className="mp-row-state">{already ? 'In contacts' : picked ? <Icon d={P.check} size={15} /> : <Icon d={P.plus} size={15} />}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right — staged for copying */}
          <div className="mp-right">
            <p className="mp-right-title">Adding to Contacts <span>{stagedRows.length}</span></p>
            <div className="mp-list">
              {stagedRows.length === 0 && <p className="mp-note">Nothing selected yet — click names on the left.</p>}
              {stagedRows.map(m => (
                <button key={m.id} type="button" className="mp-row picked" onClick={() => toggle(m)}>
                  <span className="mp-row-text">
                    <span className="mp-row-name">{m.name}</span>
                    <span className="mp-row-phone">{m.phone}</span>
                  </span>
                  <span className="mp-row-state"><Icon d={P.close} size={14} /></span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !stagedRows.length}>
            {saving ? 'Adding…' : `Add ${stagedRows.length || ''} to Contacts`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactModal({ owner, contact, groups, members, onClose, onSaved }) {
  const editing = !!contact.id;
  const [name, setName] = useState(contact.name || '');
  const [phone, setPhone] = useState(contact.phone || '');
  const [groupIds, setGroupIds] = useState(editing ? members.filter(m => m.contact_id === contact.id).map(m => m.group_id) : []);
  const [saving, setSaving] = useState(false);

  const toggle = id => setGroupIds(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]);
  const assignable = groups.filter(g => g.name !== NEW_GROUP);

  async function save() {
    if (!phone.trim()) return;
    setSaving(true);
    let id = contact.id;
    if (editing) await updateContact(id, { name, phone });
    else { const { data } = await addContact({ owner, name, phone }); id = data?.id; }
    if (id) await setContactGroups(id, groupIds);
    setSaving(false); onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>{editing ? 'Edit Contact' : 'Add Contact'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <label className="field-group"><span>Name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
          </label>
          <label className="field-group"><span>Phone</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </label>
          {/* New is not offered as a checkbox: it is a consent state, and the
              only way out of it is sending the approval. */}
          {assignable.length > 0 && (
            <div className="field-group"><span>Groups</span>
              <div className="sms-group-checks">
                {assignable.map(g => (
                  <label key={g.id} className={`sms-group-check ${groupIds.includes(g.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {!editing && (
            <p className="sms-new-note">
              <Icon d={P.lock} size={13} />
              {/* One span, not loose text: the parent is a flex row, and each
                  bare text node would otherwise become its own column. */}
              <span>
                They go into <strong>{NEW_GROUP}</strong> until you send the approval
                text — congregation-wide messages skip them until then.
              </span>
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !phone.trim()}>{saving ? 'Saving…' : editing ? 'Save' : 'Add Contact'}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Responses ═══════════ */
/*
 * Replies grouped by the message they answer, not by phone number. A number
 * on its own ("2") means nothing without knowing what was asked, so each
 * inbound reply is attributed to the last thing we sent that person.
 */

function Responses({ threads, contacts, library = [], reload }) {
  /*
   * Which message is open, and which person inside it.
   *
   * The person is keyed by phone, not by reply id: one person can send two
   * replies to the same message (tallyReplies keeps one row per number, latest
   * wins), and the conversation belongs to the person rather than to either
   * row — so both of their rows highlight together, which is correct.
   */
  const [pickedKey, setPickedKey] = useState(null);      // campaign c.key
  const [pickedPhone, setPickedPhone] = useState(null);  // r.thread.key
  const [onlyUnclear, setOnlyUnclear] = useState(false);
  const [q, setQ] = useState('');
  /*
   * Drafts and send errors are keyed by person. One shared draft had to be
   * force-cleared on every selection change to stop a message written for one
   * person reaching the next; keyed, that cannot happen at all, and a
   * half-written text now survives clicking away and back.
   */
  const [drafts, setDrafts] = useState({});
  const [sendErrs, setSendErrs] = useState({});
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [fixing, setFixing] = useState(null);     // reply id whose options are open
  const [saving, setSaving] = useState(false);
  /*
   * The in-flight guards are refs rather than the state flags. Enter-without-
   * shift calls send() directly, so two presses inside one render tick both
   * read `sending === false` and both send.
   */
  const sendingRef = useRef(false);
  const savingRef = useRef(false);
  const railRef = useRef(null);      // column 1 list
  const listRef = useRef(null);      // column 2 list
  const scrollRef = useRef(null);    // column 3 thread
  const keepScroll = useRef(null);   // scroll positions held across a reload
  /* Replies that were still unread when this list was opened. They come up
     green and fade out, so what arrived since the last look is obvious without
     leaving a highlight sitting there afterwards. */
  const [justSeen, setJustSeen] = useState(() => new Set());
  const [linking, setLinking] = useState(null);  // campaign key while its menu loads
  const [linkFor, setLinkFor] = useState(null);  // the dinner whose link dialog is open
  const [linkMenu, setLinkMenu] = useState(['']);
  const [saving2, setSaving2] = useState(false);

  /*
   * Chasing the people who never answered. Nothing is sent from the button on
   * the card — it opens the list and the wording first, and only the Send in
   * that dialog actually texts anybody.
   */
  const [remind, setRemind] = useState(null);
  const [reminding, setReminding] = useState(false);

  /*
   * Whether it is a decent hour to text anyone. Re-read every minute so the
   * button closes itself at five rather than staying live on a page that has
   * been open all afternoon.
   */
  const [canRemind, setCanRemind] = useState(() => windowOpen());
  useEffect(() => {
    const t = setInterval(() => setCanRemind(windowOpen()), 60_000);
    return () => clearInterval(t);
  }, []);

  /*
   * The member directory, read once and only when somebody actually reminds —
   * it is over a thousand rows and nothing else on this tab needs it.
   */
  const familyRef = useRef(null);
  async function familyMap() {
    if (familyRef.current) return familyRef.current;
    const { rows } = await fetchChurchMembers();
    const map = new Map();
    for (const r of rows || []) {
      const phone = normPhone(r.phone);
      const fam = r.family_id || r.family_name;
      if (phone && fam) map.set(phone, String(fam));
    }
    familyRef.current = map;
    return map;
  }

  async function openRemind(c) {
    if (linking) return;
    setLinking(c.key);
    /*
     * A directory that will not load means no family filtering — never a button
     * stuck on "Checking…" and a reminder nobody can send. A failed read throws
     * and a dead connection simply never answers, so both are handled: the read
     * is raced against a deadline.
     */
    let fam = null;
    try {
      fam = await Promise.race([
        familyMap(),
        new Promise(res => setTimeout(() => res(null), 6000)),
      ]);
    } catch (e) { console.error('member directory unavailable:', e); }

    const everyone = silentRecipients(c.prompt, threads.rows);
    const silent = fam ? silentRecipients(c.prompt, threads.rows, fam) : everyone;
    const { ok, held } = splitByHours(silent);
    setLinking(null);
    setRemind({
      title: c.key, prompt: c.prompt, who: ok, held,
      covered: everyone.length - silent.length,
      text: REMINDER_TEXT, sent: null, error: '',
    });
  }

  async function sendReminder() {
    const text = String(remind?.text ?? '').trim();
    if (reminding || !remind?.who?.length || !text) return;

    /*
     * Re-checked at the moment of sending, not just when the dialog opened —
     * it only takes leaving this on screen over five o'clock to turn a legal
     * send into an illegal one.
     */
    const { ok, held } = splitByHours(remind.who);
    if (!ok.length) {
      setRemind(r => ({ ...r, who: [], held: [...r.held, ...held] }));
      return;
    }

    if (!(await confirmDialog({
      title: `Text ${ok.length} ${ok.length === 1 ? 'person' : 'people'}?`,
      message: `"${text}"`,
      confirmLabel: `Send to ${ok.length}`,
    }))) return;

    setReminding(true);
    const res = await sendBroadcast(ok, text, REMIND_STATUS, remind.prompt);
    setReminding(false);
    setRemind(r => ({ ...r, sent: res?.sent ?? 0, error: res?.failed?.[0]?.error || '' }));
    reload();
  }

  /*
   * The link carries the menu, so the menu is asked for first — the same
   * question the composer asks. An existing menu is loaded in to be edited
   * rather than quietly replaced.
   */
  async function openLink(c) {
    if (linking) return;
    /*
     * Marking something a dinner is irreversible from the UI: createRsvpLink
     * forces message_type 'Dinner' on the matching library row and there is no
     * control anywhere that undoes it. On a poll, every "1" and "2" then stops
     * being an option choice and starts being a plate count.
     */
    if (!c.showTally && !(await confirmDialog({
      title: 'Count this as a dinner?',
      message: 'Every number people texted back will be read as plates. If this was a poll, those answers stop being poll choices.',
      confirmLabel: 'Count as dinner',
    }))) return;
    setLinking(c.key);
    const info = await fetchRsvpInfo(c.prompt);
    setLinking(null);
    setLinkMenu(info.menu.length ? info.menu : ['']);
    setLinkFor({ title: c.key, prompt: c.prompt, url: null, wasDinner: c.showTally });
  }

  async function saveLink() {
    if (saving2) return;
    setSaving2(true);
    const res = await createRsvpLink(null, linkFor.prompt, linkMenu);
    setSaving2(false);
    setLinkFor(f => ({ ...f, ...res }));
    /* The only mutation on this tab that did not re-read. showTally is what
       decides whether a rail row carries the green count, so without this it
       stayed stale until somebody hit Refresh. */
    if (!res?.error) await reload();
  }

  /* Record a person's decision about one reply, then re-read from the server so
     every tally on the page moves together. */
  async function decide(reply, patch) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    /* Three independently scrolled columns now. Nothing unmounts on a reload
       and both lists key stably, but holding the offsets makes that explicit
       rather than an untested assumption. */
    keepScroll.current = { rail: railRef.current?.scrollTop ?? 0, list: listRef.current?.scrollTop ?? 0 };
    try { await setRsvp(reply.id, patch); setFixing(null); await reload(); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await reload(); setCheckedAt(new Date()); }
    finally { setRefreshing(false); }
  }

  const nameFor = useMemo(() => {
    const byPhone = new Map(contacts.map(c => [normPhone(c.phone), c.name]));
    return t => byPhone.get(t.key) || t.name || '';
  }, [contacts]);

  /*
   * Walk each thread in time order: whatever we last sent that person is what
   * their next reply is answering.
   */
  const campaigns = useMemo(
    () => groupCampaigns(threads.rows, library, t => nameFor(t) || formatPhone(t.number)),
    [threads.rows, library, nameFor]);

  /*
   * The search decides which messages are LISTED. It never rewrites a campaign.
   *
   * Filtering c.replies down to the matches (which is what this did) left the
   * tally, the unread count and replies.length describing different sets, so a
   * row could read "3 new · 1 reply" beside a headcount covering all of them.
   * The open message is pinned in regardless, so typing can never empty the
   * drill-down out from under you.
   */
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const shown = useMemo(() => (!needle ? campaigns : campaigns.filter(c =>
       c.key === pickedKey
    || (c.key || '').toLowerCase().includes(needle)
    || (c.prompt || '').toLowerCase().includes(needle)
    || c.replies.some(r =>
         (r.who || '').toLowerCase().includes(needle) ||
         (r.body || '').toLowerCase().includes(needle) ||
         /* Guarded: normPhone(x).includes('') is true for every row. */
         (digits.length >= 3 && normPhone(r.thread.number).includes(digits))))),
    [campaigns, needle, digits, pickedKey]);

  /* Derived from the UNFILTERED campaigns, never stored and never taken from
     `shown` — that is what keeps a searched pane from contradicting itself and
     what makes the count picker correct after decide()'s full re-read. */
  const picked = useMemo(() => campaigns.find(c => c.key === pickedKey) || null, [campaigns, pickedKey]);
  const person = useMemo(() => {
    if (!pickedPhone) return null;
    /* The threads fallback matters: after you reply, that person's next message
       can refile under a different campaign, and column 3 would blank mid-
       conversation without it. */
    return picked?.replies.find(r => r.thread.key === pickedPhone)?.thread
        || threads.rows.find(t => t.key === pickedPhone) || null;
  }, [picked, pickedPhone, threads.rows]);

  /*
   * One source of truth for "needs a count". The per-row predicate and the
   * per-phone dedupe in tallyReplies used to disagree, so the card's number and
   * the amber rows could describe different replies.
   */
  const unclearIds = useMemo(() => new Set((picked?.tally.unclear || []).map(u => u.id)), [picked]);
  const countedIds = useMemo(() => {
    const t = picked?.tally;
    if (!t) return new Set();
    return new Set([...t.counted, ...t.declined, ...t.unclear, ...t.excluded].map(x => x.id));
  }, [picked]);

  /* A campaign key can vanish after a refresh — it is a 46-character
     truncation of the message used as a Map key. */
  useEffect(() => {
    if (pickedKey && !campaigns.some(c => c.key === pickedKey)) { setPickedKey(null); setPickedPhone(null); }
  }, [campaigns, pickedKey]);

  useLayoutEffect(() => {
    const k = keepScroll.current;
    if (!k) return;
    if (railRef.current) railRef.current.scrollTop = k.rail;
    if (listRef.current) listRef.current.scrollTop = k.list;
    keepScroll.current = null;
  }, [campaigns]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pickedPhone, person?.messages?.length]);

  /* The picker never had a way out by keyboard, and its old full-screen
     backdrop cannot come back — an in-flow picker underneath one is
     unclickable. Same closer PillMenu already uses in this folder. */
  useEffect(() => {
    if (!fixing) return;
    const onDown = e => { if (!e.target.closest(`[data-reply="${fixing}"]`)) setFixing(null); };
    const onKey = e => { if (e.key === 'Escape') setFixing(null); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [fixing]);

  const draft = person ? (drafts[person.key] ?? '') : '';
  const sendErr = person ? (sendErrs[person.key] ?? '') : '';
  /* A website reservation is given a deliberately impossible number — ten
     digits with a leading zero. Telnyx accepts it and fails. */
  const webOnly = person ? normPhone(person.number).startsWith('0') : false;
  const rows = onlyUnclear ? (picked?.replies || []).filter(r => unclearIds.has(r.id)) : (picked?.replies || []);

  async function send() {
    const body = draft.trim();
    if (!body || !person || webOnly || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    const key = person.key;
    setSendErrs(s => ({ ...s, [key]: '' }));
    const res = await sendText({
      /* person.number, never from_number — the inbound webhook stores the
         sender in to_number and OUR Telnyx number in from_number. */
      number: person.number,
      /* Never persist a formatted phone as a name: fetchThreads takes the
         thread's name from the first non-empty to_name it sees. */
      name: nameFor(person) || '',
      body,
      status: 'Reply',
      campaign: picked?.prompt || undefined,
    });
    sendingRef.current = false; setSending(false);
    if (!res?.sent) return setSendErrs(s => ({ ...s, [key]: res?.failed?.[0]?.error || 'Could not send that message.' }));
    setDrafts(d => ({ ...d, [key]: '' }));
    reload();
  }

  function pickCampaign(c) {
    /* Idempotent: re-clicking the open message must not collapse two columns
       from under the user, nor replace justSeen and restart the wash. */
    if (c.key === pickedKey) return;
    setPickedKey(c.key); setPickedPhone(null); setOnlyUnclear(false); setFixing(null);
    const ids = c.replies.filter(r => !r.read_at).map(r => r.id);
    // Captured before marking read, which is what erases the evidence.
    setJustSeen(new Set(ids));
    if (ids.length) markRead(ids).then(reload);
  }

  function pickPerson(r) {
    setPickedPhone(r.thread.key); setFixing(null);
    /* Intersected with this campaign. thread.unreadIds spans that number's
       whole log, so marking it wholesale would silently clear the green dots
       on every other message they have replied to. */
    const ids = (picked?.replies || [])
      .filter(x => x.thread.key === r.thread.key && !x.read_at).map(x => x.id);
    if (ids.length) markRead(ids).then(reload);
  }

  function onKeys(e) {
    if (e.key !== 'Escape') return;
    if (fixing) { setFixing(null); e.stopPropagation(); return; }
    if (pickedPhone) { setPickedPhone(null); e.stopPropagation(); return; }
    if (pickedKey) { setPickedKey(null); e.stopPropagation(); }
  }

  function railKeys(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const b = [...e.currentTarget.querySelectorAll('.rsp-camp, .rsp-item-open')];
    const i = b.indexOf(document.activeElement);
    b[Math.min(b.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }

  const when = s => new Date(s).toLocaleString('en-US',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  /* A column row has room for a time or a date, not both. */
  const shortWhen = s => {
    const d = new Date(s), n = new Date();
    return d.toDateString() === n.toDateString()
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  };

  if (threads.missing) {
    return (
      <div className="adm-placeholder">
        <div className="adm-placeholder-icon"><Icon d={P.reply} size={28} /></div>
        <h2>Set up replies</h2>
        <p>Run <strong>supabase/sms-inbound-schema.sql</strong> to record incoming texts.</p>
      </div>
    );
  }

  return (
    <div className="sms-library rsp-shell">
      <div className="rsp-head-row">
        <div>
          <p className="rsp-head-lbl">Responses</p>
          <p className="rsp-sub">
            {campaigns.length
              ? `${campaigns.length} ${campaigns.length === 1 ? 'message' : 'messages'} with replies`
              : 'Replies to your texts appear here, grouped by the message they answer.'}
          </p>
        </div>
        <div className="rsp-refresh">
          {checkedAt && !refreshing && (
            <span className="rsp-checked">
              Checked {checkedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button className="btn-ghost sm" onClick={refresh} disabled={refreshing}>
            <Icon d={P.repeat} size={15} />{refreshing ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="adm-search rsp-search">
          <Icon d={P.search} size={16} />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search a name, number, or what they said" />
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rsp-empty">
          No responses yet. Replies land here once the Telnyx inbound webhook is pointed at Pillar.
        </div>
      ) : (
        <div className={`rsp-cols ${picked ? 'deep' : ''} ${person ? 'person' : ''}`} onKeyDown={onKeys}>

          {/* ── 1 · The messages. For a dinner, this row is where the green count lives. ── */}
          <section className="rsp-col rsp-col-camps" aria-label="Messages with replies">
            <div className="rsp-col-list" ref={railRef} onKeyDown={railKeys}>
              {shown.length === 0 && <p className="rsp-col-note">No messages match that search.</p>}
              {shown.map(c => (
                <button key={c.key}
                  className={`rsp-camp ${c.key === pickedKey ? 'on' : ''} ${c.unread ? 'fresh' : ''}`}
                  onClick={() => pickCampaign(c)}
                  aria-current={c.key === pickedKey || undefined}
                  aria-controls="rsp-replies">
                  <span className="rsp-camp-main">
                    <span className="rsp-camp-title">
                      {c.unread > 0 && <span className="ov-dot" />}{c.key}
                    </span>
                    <span className="rsp-camp-sub">
                      {[c.unread ? `${c.unread} new` : null,
                        `${c.replies.length} ${c.replies.length === 1 ? 'reply' : 'replies'}`,
                        shortWhen(c.lastAt)].filter(Boolean).join('  ·  ')}
                    </span>
                  </span>
                  {c.showTally
                    ? <span className="rsp-camp-tally">{c.tally.total}<em>coming</em></span>
                    : <span className="rsp-camp-n">{c.replies.length}</span>}
                </button>
              ))}
            </div>
          </section>

          {/* ── 2 · The replies to that message. Slides in; renders nothing while closed. ── */}
          <section className="rsp-col rsp-col-replies" id="rsp-replies"
            aria-label={picked ? `Replies to ${picked.key}` : 'Replies'}>
            {picked && (
              <div className="rsp-col-inner">
                <div className="rsp-col-head">
                  <p className="rsp-col-title">
                    {picked.replies.length} {picked.replies.length === 1 ? 'reply' : 'replies'}
                  </p>
                  {picked.showTally && unclearIds.size > 0 && (
                    <button className={`rsp-filter ${onlyUnclear ? 'on' : ''}`} aria-pressed={onlyUnclear}
                      onClick={() => setOnlyUnclear(v => !v)}>Needs a count ({unclearIds.size})</button>
                  )}
                </div>

                <div className="rsp-col-list" ref={listRef} onKeyDown={railKeys}>
                  {rows.length === 0 && <p className="rsp-col-note">Nothing here needs a count.</p>}
                  {rows.map(r => {
                    const manual = Number.isInteger(r.rsvp_count);
                    const off = !!r.rsvp_excluded;
                    const guess = parseHeadcount(r.body);
                    const n = off ? null : manual ? r.rsvp_count : (guess ? guess.count : null);
                    const unclear = unclearIds.has(r.id);
                    /* A later reply from the same number is the one being counted. */
                    const stale = picked.showTally && !off && !countedIds.has(r.id);
                    const on = r.thread.key === pickedPhone;
                    const picking = fixing === r.id;
                    return (
                      /* A div, not a button: it holds the count control and the
                         in-flow picker, and nesting those inside a button is
                         invalid. .rsp-item-open is the single control. */
                      <div key={r.id} data-reply={r.id}
                        className={`rsp-item ${on ? 'on' : ''} ${unclear ? 'unclear' : ''} ${off ? 'off' : ''} ${justSeen.has(r.id) ? 'fresh' : ''}`}>
                        <button className="rsp-item-open" onClick={() => pickPerson(r)}
                          aria-current={on || undefined} aria-controls="rsp-person">
                          <span className="rsp-item-top">
                            <span className="rsp-item-who">{r.who}</span>
                            <span className="rsp-item-when">{shortWhen(r.created_at)}</span>
                          </span>
                          <p className="rsp-item-body">{r.body}</p>
                        </button>

                        {picked.showTally && (
                          <div className="rsp-count-wrap">
                            <button
                              className={`rsp-count ${unclear ? 'unsure' : ''} ${off ? 'off' : ''} ${manual ? 'manual' : ''} ${stale ? 'quiet' : ''}`}
                              onClick={() => setFixing(picking ? null : r.id)}
                              aria-haspopup="true" aria-expanded={picking}
                              aria-label={`Change the count for ${r.who}`}
                              title={off ? 'Not counted'
                                   : stale ? 'A later reply from this number is the one counted'
                                   : manual ? 'Counted by hand'
                                   : unclear ? 'Set a count' : 'Counted automatically'}>
                              {off || stale ? '–' : unclear ? '?' : n}
                            </button>
                          </div>
                        )}

                        {picking && (
                          <div className="rsp-picker" role="group" aria-label="Headcount">
                            {[0, 1, 2, 3, 4, 5, 6].map(v => (
                              <button key={v} disabled={saving}
                                className={`rsp-pick ${!off && n === v ? 'on' : ''}`}
                                onClick={() => decide(r, { count: v })}>{v}</button>
                            ))}
                            <span className="rsp-pick-div" />
                            <button className="rsp-pick icon" disabled={saving} title="Don't count this reply"
                              onClick={() => decide(r, { count: null, excluded: true })}>
                              <Icon d={P.close} size={15} />
                            </button>
                            <button className="rsp-pick icon" disabled={saving} title="Read it automatically again"
                              onClick={() => decide(r, { count: null, excluded: false })}>
                              <Icon d={P.repeat} size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ── 3 · The message, or the person. ── */}
          <section className="rsp-col rsp-col-person" id="rsp-person" aria-label="Conversation">
            {!picked ? (
              <div className="cv-placeholder">
                <div className="cv-placeholder-ic"><Icon d={P.chat} size={28} /></div>
                <p>Pick a message</p>
                <span>Its replies open beside it, and the headcount with them.</span>
              </div>
            ) : !person ? (
              <div className="rsp-brief">
                <div className="rsp-brief-head">
                  <div className="rsp-brief-main">
                    <span className="rsp-brief-when">Last reply {when(picked.lastAt)}</span>
                    <h2 className="rsp-brief-title">{picked.key}</h2>
                  </div>
                  {picked.showTally && (
                    <span className="rsp-box-tally" aria-live="polite">
                      <span className="rsp-box-tally-num">{picked.tally.total}</span>
                      <span className="rsp-box-tally-lbl">coming</span>
                    </span>
                  )}
                </div>

                {picked.prompt ? (
                  <div className="rsp-brief-msg">
                    <div className="cv-msg out"><div className="cv-bubble">{picked.prompt}</div></div>
                  </div>
                ) : (
                  <p className="rsp-brief-orphan">
                    These replies did not follow anything we sent, so there is no message to show,
                    no one to remind, and no link to attach.
                  </p>
                )}

                <div className="rsp-brief-stats">
                  <span className="rsp-stat"><b>{picked.replies.length}</b><span>replies</span></span>
                  {picked.showTally && (<>
                    <span className="rsp-stat"><b>{picked.tally.counted.length}</b><span>coming</span></span>
                    <span className="rsp-stat"><b>{picked.tally.declined.length}</b><span>not coming</span></span>
                    {unclearIds.size > 0 && (
                      <span className="rsp-stat warn"><b>{unclearIds.size}</b><span>need a count</span></span>
                    )}
                  </>)}
                </div>

                <div className="rsp-brief-foot">
                  <button className="rsp-act lead" onClick={() => openLink(picked)}
                    disabled={!!linking || !picked.prompt}>
                    {linking ? 'Opening…' : picked.showTally ? 'Reservation link' : 'Count as dinner'}
                  </button>
                  <button className="rsp-act" onClick={() => openRemind(picked)}
                    disabled={!canRemind || !!linking || !picked.prompt}
                    title={!picked.prompt ? 'There is no original message to chase'
                         : canRemind ? '' : `Texts can only go out between ${WINDOW_LABEL}`}>
                    {linking ? 'Checking…' : 'Remind'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rsp-person">
                <header className="rsp-person-head">
                  <button className="rsp-back" onClick={() => setPickedPhone(null)}>
                    <Icon d={P.chevL} size={16} />Replies
                  </button>
                  <span className="cv-ava sm">{initials(nameFor(person) || '')}</span>
                  <span className="rsp-person-info">
                    <span className="rsp-person-name">{nameFor(person) || formatPhone(person.number)}</span>
                    <span className="rsp-person-num">
                      {webOnly ? 'Reserved on the website' : formatPhone(person.number)}
                    </span>
                  </span>
                </header>

                {/* Every reply already carries its whole conversation, so this
                    pane needs no fetch of its own. */}
                <div className="cv-scroll" ref={scrollRef}>
                  {person.messages.map((m, i) => {
                    const prev = person.messages[i - 1];
                    const dir = m.direction || 'out';
                    const gap = !prev || (new Date(m.created_at) - new Date(prev.created_at)) > 30 * 60 * 1000;
                    const bad = dir === 'out' && m.status === 'Failed';
                    return (
                      <div key={m.id || i}>
                        {gap && <div className="cv-sep">{sepLabel(m.created_at)}</div>}
                        <div className={`cv-msg ${dir}`}>
                          <div className={`cv-bubble ${bad ? 'failed' : ''}`}>{m.body}</div>
                        </div>
                        {bad && <div className="cv-failed">Not delivered</div>}
                      </div>
                    );
                  })}
                </div>

                {webOnly ? (
                  <p className="rsp-th-note">
                    This reservation came in through the website, so there is no number to text back.
                  </p>
                ) : (<>
                  <div className="cv-compose">
                    <textarea rows={1} placeholder={`Text ${nameFor(person) || 'them'}`} value={draft}
                      onChange={e => {
                        const v = e.target.value, k = person.key;
                        setDrafts(d => ({ ...d, [k]: v }));
                        setSendErrs(s => ({ ...s, [k]: '' }));
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                      }} />
                    <button className="cv-send" onClick={send} disabled={sending || !draft.trim()} title="Send">
                      <Icon d={P.arrowUp} size={18} />
                    </button>
                  </div>
                  <div className="rsp-compose-meta">
                    {sendErr && <p className="rsp-err">{sendErr}</p>}
                    {draft.trim() && (() => {
                      const s = smsSegments(draft);
                      return <span className="rsp-segs">{s.len} characters · {s.segments} segment{s.segments === 1 ? '' : 's'}</span>;
                    })()}
                  </div>
                </>)}
              </div>
            )}
          </section>
        </div>
      )}

      {remind && (
        <div className="modal-overlay" onClick={() => setRemind(null)}>
          {/*
            * A review screen, read top to bottom: how many, what they will get,
            * who is being left out, then the action. The message is shown as a
            * message; the exclusions are a list, not three coloured notices of
            * the same weight.
            */}
          <div className="modal sheet rsp-remind" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Remind who hasn&rsquo;t answered</h2>
              <button className="modal-x" onClick={() => setRemind(null)}><Icon d={P.close} size={20} /></button>
            </div>

            {remind.sent !== null ? (
              <div className="modal-body">
                <div className="rsp-remind-done">
                  <span className="rsp-remind-tick"><Icon d={P.check} size={26} /></span>
                  <p className="rsp-remind-num">{remind.sent}</p>
                  <p className="rsp-remind-cap">
                    {remind.sent === 1 ? 'reminder sent' : 'reminders sent'}
                  </p>
                  {remind.error && <p className="rsp-remind-err">{remind.error}</p>}
                </div>
              </div>
            ) : remind.who.length === 0 ? (
              <div className="modal-body">
                <p className="rsp-remind-none">
                  {remind.held.length
                    ? `It is outside ${WINDOW_LABEL} where all ${remind.held.length} of them live, so nobody can be texted right now.`
                    : 'Everyone who got this has already answered.'}
                </p>
              </div>
            ) : (<>
              <div className="modal-body">
                <p className="rsp-remind-num">{remind.who.length}</p>
                <p className="rsp-remind-cap">
                  {remind.who.length === 1 ? 'person will be texted' : 'people will be texted'}
                </p>

                {/* The bubble is the field — tap it and type, no edit mode. */}
                <textarea
                  className="rsp-remind-msg"
                  value={remind.text}
                  onChange={e => setRemind(r => ({ ...r, text: e.target.value }))}
                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                  aria-label="Reminder message"
                />
                <div className="rsp-remind-msg-meta">
                  {remind.text.trim() !== REMINDER_TEXT && (
                    <button type="button" className="rsp-remind-reset"
                      onClick={() => setRemind(r => ({ ...r, text: REMINDER_TEXT }))}>
                      Reset
                    </button>
                  )}
                  <span className={smsSegments(remind.text).segments > 1 ? 'warn' : ''}>
                    {smsSegments(remind.text).len} characters ·{' '}
                    {smsSegments(remind.text).segments} segment{smsSegments(remind.text).segments === 1 ? '' : 's'}
                  </span>
                </div>

                {(remind.covered > 0 || remind.held.length > 0) && (
                  <ul className="rsp-remind-skip">
                    {remind.covered > 0 && (
                      <li><b>{remind.covered}</b> already covered by someone in their family</li>
                    )}
                    {remind.held.length > 0 && (
                      <li><b>{remind.held.length}</b> outside {WINDOW_LABEL} where they live</li>
                    )}
                  </ul>
                )}

                <p className="rsp-remind-note">
                  Anyone who replied &mdash; including a no &mdash; and anyone who has texted STOP
                  is never included.
                </p>
              </div>

              <div className="rsp-remind-foot">
                <button className="rsp-act" onClick={() => setRemind(null)}>Cancel</button>
                <button className="btn-primary" onClick={sendReminder}
                  disabled={reminding || !remind.text.trim()}>
                  {reminding ? 'Sending…' : `Send to ${remind.who.length}`}
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {linkFor && (
        <div className="modal-overlay" onClick={() => setLinkFor(null)}>
          <div className="modal sheet rsp-link-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Reservation link</h2>
              <button className="modal-x" onClick={() => setLinkFor(null)}><Icon d={P.close} size={20} /></button>
            </div>
            <div className="modal-body">
              {linkFor.error && <p className="rsp-link-err">{linkFor.error}</p>}

              {linkFor.url ? (<>
                <p className="rsp-link-lead">
                  The website is updated. Post this anywhere — it is the same link every
                  week and always shows the current dinner.
                </p>
                <RsvpLink url={linkFor.url} />
                {linkFor.direct && (
                  <p className="rsp-link-note">This dinner on its own: {linkFor.direct}</p>
                )}
              </>) : (<>
                <p className="rsp-link-lead">
                  {linkFor.wasDinner
                    ? 'What is being served? This is what people see on the reservation page.'
                    : 'This will be counted as a dinner, and its replies tallied into a headcount. What is being served?'}
                </p>
                <MenuEditor items={linkMenu} onChange={setLinkMenu} />
                <button type="button" className="sms-link-btn" onClick={saveLink} disabled={saving2}>
                  {saving2 ? 'Saving…' : 'Save'}
                </button>
                <p className="rsp-link-note">{linkFor.title}</p>
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════ Groups ═══════════ */
function Groups({ owner, groups, members, contacts = [], reload }) {
  const [name, setName] = useState('');

  /*
   * Approval for everyone still in New. Nothing is sent from the row itself —
   * the wording is shown first, and only Send in that dialog texts anybody.
   */
  const [approve, setApprove] = useState(null);
  const [sending, setSending] = useState(false);
  const [canSend, setCanSend] = useState(() => windowOpen());
  useEffect(() => {
    const t = setInterval(() => setCanSend(windowOpen()), 60_000);
    return () => clearInterval(t);
  }, []);

  const waiting = g => {
    const ids = new Set(members.filter(m => m.group_id === g.id).map(m => m.contact_id));
    return contacts.filter(c => ids.has(c.id) && String(c.phone || '').trim());
  };

  function openApprove(g) {
    const who = waiting(g);
    const { ok, held } = splitByHours(who.map(c => ({ ...c, phone: c.phone })));
    setApprove({ group: g, who: ok, held, body: DISCLOSURE_DEFAULT, sent: null, error: '' });
  }

  async function sendApproval() {
    const body = String(approve?.body ?? '').trim();
    if (sending || !approve?.who?.length || !body) return;

    /* Re-checked at the moment of sending: leaving this dialog open across five
       o'clock would otherwise turn a legal send into an illegal one. */
    const { ok, held } = splitByHours(approve.who);
    if (!ok.length) { setApprove(a => ({ ...a, who: [], held: [...a.held, ...held] })); return; }

    if (!(await confirmDialog({
      title: `Send approval to ${ok.length} ${ok.length === 1 ? 'person' : 'people'}?`,
      message: `"${withStopLine(body)}"`,
      confirmLabel: `Send to ${ok.length}`,
    }))) return;

    setSending(true);
    const res = await sendBroadcast(ok, withStopLine(body), 'Approval');
    /* Only the people actually texted leave New. Anyone held back by the hour
       stays there for next time. */
    if (res?.sent) await clearApproved(approve.group.id, ok.map(c => c.id));
    setSending(false);
    setApprove(a => ({ ...a, sent: res?.sent ?? 0, error: res?.failed?.[0]?.error || '' }));
    reload();
  }

  async function create() {
    if (!name.trim()) return;
    await addGroup({ owner, name: name.trim() }); setName(''); reload();
  }
  async function remove(g) {
    if (!(await confirmDialog({ message: `Delete group "${g.name}"? Contacts are kept.` }))) return;
    await deleteGroup(g.id); reload();
  }
  return (
    <div className="adm-panel">
      <div className="adm-panel-head"><h2>Groups</h2></div>
      <div className="sms-group-new">
        <input placeholder="New group name…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button className="btn-primary sm" onClick={create} disabled={!name.trim()}><Icon d={P.plus} size={14} />Create Group</button>
      </div>
      <div className="sms-group-list">
        {groups.map(g => (
          <div key={g.id} className="sms-group-row">
            <div className="sms-group-info">
              <div className="sms-group-icon"><Icon d={P.layers} size={18} /></div>
              <div>
                <span className="adm-user-name">{g.name}</span>
                <span className="adm-user-email">
                  {members.filter(m => m.group_id === g.id).length} contacts
                  {g.name === NEW_GROUP && ' · waiting to be told they are on the list'}
                </span>
              </div>
            </div>
            {g.name === NEW_GROUP && waiting(g).length > 0 && (
              <button className="sms-approve-btn" onClick={() => openApprove(g)} disabled={!canSend}
                title={canSend ? '' : `Texts can only go out between ${WINDOW_LABEL}`}>
                <Icon d={P.send} size={15} />Send Approval
              </button>
            )}
            <button className="adm-menu-btn" onClick={() => remove(g)} style={{ fontSize: 15 }}>×</button>
          </div>
        ))}
        {groups.length === 0 && <div className="adm-empty">No groups yet. Create one, then assign contacts to it.</div>}
      </div>
      <p className="sms-group-note">Assign contacts to groups from the <strong>Contacts</strong> tab (edit a contact).</p>

      {approve && (
        <div className="modal-overlay" onClick={() => setApprove(null)}>
          <div className="modal sheet rsp-remind" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Send approval</h2>
              <button className="modal-x" onClick={() => setApprove(null)}><Icon d={P.close} size={20} /></button>
            </div>

            {approve.sent !== null ? (
              <div className="modal-body">
                <div className="rsp-remind-done">
                  <span className="rsp-remind-tick"><Icon d={P.check} size={26} /></span>
                  <p className="rsp-remind-num">{approve.sent}</p>
                  <p className="rsp-remind-cap">
                    {approve.sent === 1 ? 'person told' : 'people told'} — they are on the regular list now
                  </p>
                  {approve.error && <p className="rsp-remind-err">{approve.error}</p>}
                </div>
              </div>
            ) : approve.who.length === 0 ? (
              <div className="modal-body">
                <p className="rsp-remind-none">
                  {approve.held.length
                    ? `It is outside ${WINDOW_LABEL} where all ${approve.held.length} of them live, so nobody can be texted right now.`
                    : 'Everyone in New has already been told.'}
                </p>
              </div>
            ) : (<>
              <div className="modal-body">
                <p className="rsp-remind-num">{approve.who.length}</p>
                <p className="rsp-remind-cap">
                  {approve.who.length === 1 ? 'person will be told' : 'people will be told'} they are on the text list
                </p>

                <textarea className="rsp-remind-msg" value={approve.body}
                  onChange={e => setApprove(a => ({ ...a, body: e.target.value }))}
                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                  aria-label="Approval message" />

                {/* Appended by the sender, not typed into the box — carriers
                    require it and it must not be edited away by accident. */}
                <p className="sms-stop-line"><Icon d={P.lock} size={13} />{STOP_LINE}</p>

                <div className="rsp-remind-msg-meta">
                  {approve.body.trim() !== DISCLOSURE_DEFAULT && (
                    <button type="button" className="rsp-remind-reset"
                      onClick={() => setApprove(a => ({ ...a, body: DISCLOSURE_DEFAULT }))}>Reset</button>
                  )}
                  <span className={smsSegments(withStopLine(approve.body)).segments > 1 ? 'warn' : ''}>
                    {smsSegments(withStopLine(approve.body)).len} characters ·{' '}
                    {smsSegments(withStopLine(approve.body)).segments} segment{smsSegments(withStopLine(approve.body)).segments === 1 ? '' : 's'}
                  </span>
                </div>

                {approve.held.length > 0 && (
                  <ul className="rsp-remind-skip">
                    <li><b>{approve.held.length}</b> outside {WINDOW_LABEL} where they live — they stay in New</li>
                  </ul>
                )}
                <p className="rsp-remind-note">
                  Sending this is what moves them onto the regular contact list.
                </p>
              </div>

              <div className="rsp-remind-foot">
                <button className="rsp-act" onClick={() => setApprove(null)}>Cancel</button>
                <button className="btn-primary" onClick={sendApproval}
                        disabled={sending || !approve.body.trim()}>
                  {sending ? 'Sending…' : `Send to ${approve.who.length}`}
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2400);
}

/*
 * What a poll will accept, read back from the message as written.
 *
 * The options are parsed out of the text, so a numbered list that does not
 * parse — a stray line break, "Reply 1 for yes" written as a sentence — records
 * nobody's answer. Better to see that while composing than to discover it from
 * a week of replies that went nowhere.
 */
function PollPreview({ body }) {
  const opts = pollOptions(body || '');
  if (!String(body || '').trim()) return null;
  return (
    <div className="sms-poll">
      {opts.length >= 2 ? (
        <>
          <p className="sms-poll-h">Replies will be recorded as:</p>
          <ul className="sms-poll-list">
            {opts.map(o => <li key={o.n}><b>{o.n}</b>{o.label}</li>)}
          </ul>
        </>
      ) : (
        <p className="sms-poll-warn">
          No numbered options found. Put each choice on its own line, like
          {' '}<code>[1] Immediately</code>. Until then replies are recorded as ordinary messages.
        </p>
      )}
    </div>
  );
}
