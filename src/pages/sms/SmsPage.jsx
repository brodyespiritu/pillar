import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo } from 'react';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import {
  fetchContacts, addContact, updateContact, deleteContact,
  fetchGroups, addGroup, deleteGroup,
  fetchMemberships, setContactGroups, importFromPillar,
  sendBroadcast, smsSegments,
  fetchLibrary, deleteLibraryItem, recordSend, saveToLibrary,
  fetchScheduled, scheduleBroadcast, cancelScheduled,
} from '../../lib/broadcast';
import '../care/Modal.css';
import '../admin/Admin.css';
import './Sms.css';

const TABS = [
  { key: 'broadcast', name: 'Broadcast', icon: P.sms },
  { key: 'library',   name: 'Library',   icon: P.archive },
  { key: 'contacts',  name: 'Contacts',  icon: P.users },
  { key: 'groups',    name: 'Groups',    icon: P.layers },
];

export default function SmsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('broadcast');
  const [contacts, setContacts] = useState({ rows: [], missing: false });
  const [groups, setGroups] = useState({ rows: [], missing: false });
  const [members, setMembers] = useState([]); // group memberships
  const [library, setLibrary] = useState({ rows: [], missing: false });
  const [scheduled, setScheduled] = useState({ rows: [], missing: false });
  const [draft, setDraft] = useState({ body: '', n: 0 }); // n bumps to remount compose

  async function load() {
    const [c, g, m, l, s] = await Promise.all([
      fetchContacts(), fetchGroups(), fetchMemberships(), fetchLibrary(), fetchScheduled(),
    ]);
    setContacts(c); setGroups(g); setMembers(m); setLibrary(l); setScheduled(s);
  }
  useEffect(() => { load(); }, []);

  const useMessage = body => { setDraft(d => ({ body, n: d.n + 1 })); setTab('broadcast'); };

  const missing = contacts.missing && groups.missing;

  return (
    <div className="sms-wrap">
      <TopNav />
      <main className="sms-scroll">
        <div className="sms-container">
          <header className="sms-hero">
            <span className="sms-pill">Communications</span>
            <h1 className="sms-title">SMS</h1>
            <p className="sms-subtitle">Text your whole congregation — or just a group — in a couple taps.</p>
          </header>

          {missing ? (
            <div className="adm-placeholder">
              <div className="adm-placeholder-icon"><Icon d={P.sms} size={28} /></div>
              <h2>Set up SMS</h2>
              <p>Run <strong>supabase/sms-schema.sql</strong> and <strong>supabase/broadcast-schema.sql</strong> to enable contacts, groups, and congregation texting.</p>
            </div>
          ) : (<>
            <nav className="sms-tabs">
              {TABS.map(t => (
                <button key={t.key} className={`sms-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                  <Icon d={t.icon} size={15} />{t.name}
                  <span className="sms-tab-count">{
                    t.key === 'contacts' ? contacts.rows.length
                    : t.key === 'groups' ? groups.rows.length
                    : t.key === 'library' ? (library.rows.length || '')
                    : ''
                  }</span>
                </button>
              ))}
            </nav>

            {tab === 'broadcast' && (
              <Broadcast key={draft.n} owner={user?.id} initialBody={draft.body}
                         contacts={contacts.rows} groups={groups.rows} members={members} reload={load} />
            )}
            {tab === 'library'   && <Library library={library} scheduled={scheduled} onUse={useMessage} reload={load} />}
            {tab === 'contacts'  && <Contacts owner={user?.id} contacts={contacts.rows} groups={groups.rows} members={members} reload={load} />}
            {tab === 'groups'    && <Groups owner={user?.id} groups={groups.rows} members={members} reload={load} />}
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

  const recipients = useMemo(() => {
    if (target === 'all') return contacts.filter(c => c.phone?.trim());
    const ids = new Set(members.filter(m => m.group_id === target).map(m => m.contact_id));
    return contacts.filter(c => ids.has(c.id) && c.phone?.trim());
  }, [target, contacts, members]);

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
      await recordSend(owner, body.trim(), targetLabel, recipients.length);
      setBody('');
      reload?.();
    }
  }

  async function onScheduled({ sendAt, save, title }) {
    const when = sendAt.toISOString();
    const { error } = await scheduleBroadcast({
      owner, body: body.trim(), target_label: targetLabel, recipients, send_at: when,
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
      <div className="sms-compose">
        <div className="sms-field">
          <label>Send to</label>
          <div className="sms-targets">
            <button className={`sms-target ${target === 'all' ? 'on' : ''}`} onClick={() => setTarget('all')}>
              <Icon d={P.users} size={15} />All congregation
              <span>{contacts.filter(c => c.phone?.trim()).length}</span>
            </button>
            {groups.map(g => {
              const count = members.filter(m => m.group_id === g.id).length;
              return (
                <button key={g.id} className={`sms-target ${target === g.id ? 'on' : ''}`} onClick={() => setTarget(g.id)}>
                  <Icon d={P.layers} size={15} />{g.name}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sms-field">
          <label>Message</label>
          <textarea rows={6} value={body} onChange={e => setBody(e.target.value)} placeholder="Type your message to the congregation…" />
          <div className="sms-meta">
            <span>{seg.len} characters · {seg.segments} segment{seg.segments === 1 ? '' : 's'}</span>
            <span className="sms-reccount">{recipients.length} recipient{recipients.length === 1 ? '' : 's'}</span>
          </div>
        </div>

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

        <div className="sms-send-row">
          <button className="sms-schedule-link" onClick={() => setScheduling(true)}
                  disabled={sending || !body.trim() || !recipients.length}>
            <Icon d={P.clock} size={15} />Schedule for later
          </button>
          <button className="btn-primary" onClick={send} disabled={sending || !body.trim() || !recipients.length}>
            <Icon d={P.send} size={15} />{sending ? 'Sending…' : `Send to ${recipients.length}`}
          </button>
        </div>
      </div>

      {scheduling && (
        <ScheduleModal
          recipientCount={recipients.length}
          targetLabel={targetLabel}
          body={body}
          onClose={() => setScheduling(false)}
          onConfirm={onScheduled}
        />
      )}

      <aside className="sms-preview">
        <span className="sms-preview-label">Preview</span>
        <div className="sms-bubble">{body || 'Your message will appear here.'}</div>
        <p className="sms-preview-note">Each person receives their own text — no group thread.</p>
      </aside>
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
    await onConfirm({ sendAt, save, title: title.trim() });
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
    if (!(await confirmDialog({ message: 'Cancel this scheduled text?' }))) return;
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
                  <span className="sms-lib-meta">Sends {fmtWhen(s.send_at)} · {(s.recipients || []).length} recipients · {s.target_label}</span>
                </div>
                <button className="btn-ghost sm" onClick={() => cancel(s)}>Cancel</button>
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
          <button className="btn-primary sm" onClick={() => setEdit({})}><Icon d={P.plus} size={14} />Add Contact</button>
        </div>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Groups</th><th></th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td className="adm-user-name">{c.name || '—'}</td>
                <td className="adm-muted">{c.phone}</td>
                <td>{groupsFor(c.id).map(g => <span key={g} className="sms-chip">{g}</span>)}</td>
                <td className="adm-actions-cell">
                  <button className="adm-menu-btn" title="Edit" onClick={() => setEdit(c)} style={{ fontSize: 15 }}>✎</button>
                  <button className="adm-menu-btn" title="Remove" onClick={() => remove(c)} style={{ fontSize: 15 }}>×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="adm-empty">No contacts yet. Add one or import from Pillar.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <ContactModal owner={owner} contact={edit} groups={groups} members={members} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
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
          {groups.length > 0 && (
            <div className="field-group"><span>Groups</span>
              <div className="sms-group-checks">
                {groups.map(g => (
                  <label key={g.id} className={`sms-group-check ${groupIds.includes(g.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
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

/* ═══════════ Groups ═══════════ */
function Groups({ owner, groups, members, reload }) {
  const [name, setName] = useState('');
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
                <span className="adm-user-email">{members.filter(m => m.group_id === g.id).length} contacts</span>
              </div>
            </div>
            <button className="adm-menu-btn" onClick={() => remove(g)} style={{ fontSize: 15 }}>×</button>
          </div>
        ))}
        {groups.length === 0 && <div className="adm-empty">No groups yet. Create one, then assign contacts to it.</div>}
      </div>
      <p className="sms-group-note">Assign contacts to groups from the <strong>Contacts</strong> tab (edit a contact).</p>
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
