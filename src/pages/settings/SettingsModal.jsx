import { confirmDialog } from "../../lib/dialog";
import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { fetchEmailGroups, createGroup as createEmailGroup, addGroupEmail, removeGroupEmail, deleteGroup } from '../../lib/emailGroups';
import './Settings.css';

const SECTIONS = [
  { key: 'general',       label: 'General',       icon: P.settings },
  { key: 'notifications', label: 'Notifications', icon: P.announce },
  { key: 'groups',        label: 'Email Groups',  icon: P.mail },
  { key: 'security',      label: 'Security',      icon: P.lock },
  { key: 'integrations',  label: 'Integrations',  icon: P.link },
];

export default function SettingsModal({ section = 'general', onClose }) {
  const [active, setActive] = useState(section);

  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="setm-overlay" onClick={onClose}>
      <div className="setm-card" onClick={e => e.stopPropagation()}>
        <button className="setm-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
        <div className="setm-body">
          <nav className="set-nav">
            <p className="set-nav-title">Settings</p>
            {SECTIONS.map(s => (
              <button key={s.key} className={`set-nav-item ${active === s.key ? 'on' : ''}`} onClick={() => setActive(s.key)}>
                <Icon d={s.icon} size={16} />{s.label}
              </button>
            ))}
          </nav>

          <section className="set-main">
            {active === 'general'       && <General />}
            {active === 'notifications' && <Notifications />}
            {active === 'groups'        && <Groups />}
            {active === 'security'      && <Security />}
            {active === 'integrations'  && <Integrations />}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable switch ── */
function Switch({ on, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on}
            className={`set-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
  );
}

/* ── General ── */
const LS = k => `pillar_settings_${k}`;
function useLocalState(key, initial) {
  const [v, setV] = useState(() => {
    try { const raw = localStorage.getItem(LS(key)); return raw ? JSON.parse(raw) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(LS(key), JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

function General() {
  const { profile } = useAuth();
  const [org, setOrg] = useLocalState('org', 'Bethesda Baptist Church');
  const [tz, setTz]   = useLocalState('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
  const [weekStart, setWeekStart] = useLocalState('weekStart', 'Sunday');

  return (
    <div>
      <SectionHead title="General" sub="Basic information for your workspace." />
      <Row label="Organization" hint="Shown across Pillar.">
        <input className="set-input" value={org} onChange={e => setOrg(e.target.value)} />
      </Row>
      <Row label="Your name" hint="Managed in Admin.">
        <input className="set-input" value={profile?.name || ''} disabled />
      </Row>
      <Row label="Time zone">
        <select className="set-input" value={tz} onChange={e => setTz(e.target.value)}>
          {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'].map(z => <option key={z} value={z}>{z.replace('America/', '').replace('_', ' ')}</option>)}
        </select>
      </Row>
      <Row label="Week starts on" last>
        <select className="set-input" value={weekStart} onChange={e => setWeekStart(e.target.value)}>
          <option>Sunday</option><option>Monday</option>
        </select>
      </Row>
    </div>
  );
}

/* ── Notifications (the Email / Desktop matrix) ── */
const NOTIF = [
  { cat: 'Care', rows: [
    { key: 'care_attention', label: 'A member needs attention' },
    { key: 'care_visit',     label: 'A care visit is logged' },
  ] },
  { cat: 'Guests', rows: [
    { key: 'guest_new',      label: 'A new guest is added' },
    { key: 'guest_prospect', label: 'A new prospect to follow up' },
  ] },
  { cat: 'Communications', rows: [
    { key: 'sms_reply',      label: 'Someone replies to a text' },
    { key: 'sms_scheduled',  label: 'A scheduled text is sent' },
  ] },
  { cat: 'Calendar', rows: [
    { key: 'event_soon',     label: 'An event is coming up' },
    { key: 'event_changed',  label: 'An event is created or changed' },
  ] },
];
const NOTIF_DEFAULT = Object.fromEntries(NOTIF.flatMap(g => g.rows).map(r => [r.key, { email: true, desktop: false }]));

function Notifications() {
  const [prefs, setPrefs] = useLocalState('notif', NOTIF_DEFAULT);
  const [perm, setPerm]   = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');

  const set = (key, chan, val) => setPrefs(p => ({ ...p, [key]: { ...NOTIF_DEFAULT[key], ...p[key], [chan]: val } }));
  const disableAllDesktop = () => setPrefs(p => {
    const next = { ...p };
    for (const k of Object.keys(NOTIF_DEFAULT)) next[k] = { ...NOTIF_DEFAULT[k], ...next[k], desktop: false };
    return next;
  });
  async function enablePush() {
    if (typeof Notification === 'undefined') return;
    const res = await Notification.requestPermission();
    setPerm(res);
  }

  return (
    <div>
      {perm !== 'granted' && (
        <div className="set-banner">
          <div className="set-banner-ic"><Icon d={P.announce} size={20} /></div>
          <div className="set-banner-text">
            <strong>Allow desktop notifications</strong>
            <span>Get real-time updates in the app. Enable notifications to stay informed.</span>
          </div>
          <button className="set-banner-btn" onClick={enablePush}>Enable</button>
        </div>
      )}

      <div className="set-notif-head">
        <div>
          <SectionHead title="Notifications" sub="Manage when and how you're notified." inline />
        </div>
        <div className="set-notif-cols">
          <div className="set-col"><Icon d={P.mail} size={17} /><span>Email</span></div>
          <div className="set-col">
            <Icon d={P.grid} size={17} /><span>Desktop</span>
            <button className="set-col-link" onClick={disableAllDesktop}>Disable all</button>
          </div>
        </div>
      </div>

      {NOTIF.map(group => (
        <div key={group.cat} className="set-notif-group">
          <p className="set-notif-cat">{group.cat}</p>
          {group.rows.map(r => {
            const v = { ...NOTIF_DEFAULT[r.key], ...prefs[r.key] };
            return (
              <div key={r.key} className="set-notif-row">
                <span className="set-notif-label">{r.label}</span>
                <div className="set-notif-toggle"><Switch on={v.email} onChange={val => set(r.key, 'email', val)} /></div>
                <div className="set-notif-toggle"><Switch on={v.desktop} onChange={val => set(r.key, 'desktop', val)} /></div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Email Groups ── */
const validEmail = e => /\S+@\S+\.\S+/.test(e);
function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState({});
  const [missing, setMissing] = useState(false);
  const [localNew, setLocalNew] = useState([]);
  const [selected, setSelected] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const { groups, missing } = await fetchEmailGroups();
    setGroups(groups); setMissing(missing);
    setSelected(sel => sel || Object.keys(groups)[0] || null);
  }
  useEffect(() => { load(); }, []);

  const names = useMemo(() => [...new Set([...Object.keys(groups), ...localNew])].sort((a, b) => a.localeCompare(b)), [groups, localNew]);

  async function createGroup() {
    const n = groupName.trim();
    if (!n || names.includes(n)) { setGroupName(''); return; }
    setGroupName('');
    setLocalNew(l => [...l, n]); setSelected(n);   // instant feedback
    await createEmailGroup(n, user?.id).catch(() => {}); // persist (safe if table absent)
    load();
  }
  async function addEmail() {
    if (!selected || !validEmail(email)) return;
    setErr('');
    const { error } = await addGroupEmail({ group_name: selected, email, name });
    if (error) {
      // Keep the group + input so nothing "disappears"; show why it failed.
      setErr(/permission|policy|row-level/i.test(error.message || '')
        ? "Couldn't save — the email_config table's write policy is blocking it. Re-run supabase/email-recap-schema.sql."
        : error.message);
      return;
    }
    setEmail(''); setName('');
    await load();   // the persisted group now comes back from the server
  }
  async function removeEmail(id) { await removeGroupEmail(id); load(); }
  async function removeGroup(n) {
    if (!(await confirmDialog({ message: `Delete the "${n}" group and all its emails?` }))) return;
    await deleteGroup(n); setLocalNew(l => l.filter(x => x !== n)); if (selected === n) setSelected(null); load();
  }
  const members = selected ? (groups[selected] || []) : [];

  return (
    <div>
      <SectionHead title="Email Groups" sub="Reusable recipient lists you can drop into any message." />
      {missing ? (
        <div className="set-warn">Run <strong>supabase/email-recap-schema.sql</strong> to enable email groups.</div>
      ) : (
        <div className="set-groups">
          <aside className="set-grouplist">
            {names.map(n => (
              <button key={n} className={`set-group ${selected === n ? 'on' : ''}`} onClick={() => setSelected(n)}>
                <span>{n}</span><em>{(groups[n] || []).length}</em>
              </button>
            ))}
            {names.length === 0 && <div className="set-empty">No groups yet.</div>}
            <div className="set-newgroup">
              <input placeholder="New group…" value={groupName} onChange={e => setGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createGroup()} />
              <button className="btn-primary sm" onClick={createGroup} disabled={!groupName.trim()}><Icon d={P.plus} size={14} /></button>
            </div>
          </aside>
          <div className="set-members">
            {selected ? (<>
              <div className="set-members-head">
                <span className="set-members-name">{selected}</span>
                <button className="set-del-group" onClick={() => removeGroup(selected)}><Icon d={P.trash} size={14} />Delete group</button>
              </div>
              <div className="set-add-row">
                <input placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
                <input placeholder="email@church.org" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} />
                <button className="btn-primary sm" onClick={addEmail} disabled={!validEmail(email)}><Icon d={P.plus} size={14} />Add</button>
              </div>
              {err && <div className="set-warn" style={{ marginBottom: 12 }}>{err}</div>}
              {members.map(m => (
                <div key={m.id} className="set-member">
                  <div><span className="set-member-name">{m.name || m.email}</span>{m.name && <span className="set-member-email">{m.email}</span>}</div>
                  <button className="set-member-del" onClick={() => removeEmail(m.id)}><Icon d={P.trash} size={14} /></button>
                </div>
              ))}
              {members.length === 0 && <div className="set-empty">No emails in this group yet.</div>}
            </>) : <div className="set-empty tall">Select or create a group.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Security ── */
function Security() {
  const { user, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function savePin() {
    setMsg('');
    if (!/^\d{4}$/.test(pin)) { setMsg('PIN must be 4 digits.'); return; }
    if (pin !== confirm) { setMsg('PINs do not match.'); return; }
    setBusy(true);
    const { error } = await supabase.from('staff').update({ pin_hash: pin }).eq('id', user.id);
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg('PIN updated.'); setPin(''); setConfirm(''); }
  }

  return (
    <div>
      <SectionHead title="Security" sub="Your sign-in PIN and session." />
      <Row label="New PIN" hint="4 digits, used on the lock screen.">
        <input className="set-input" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
      </Row>
      <Row label="Confirm PIN">
        <input className="set-input" type="password" inputMode="numeric" maxLength={4} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
      </Row>
      <div className="set-row-actions">
        {msg && <span className={`set-msg ${/updated/.test(msg) ? 'ok' : 'err'}`}>{msg}</span>}
        <button className="btn-primary sm" onClick={savePin} disabled={busy || !pin || !confirm}>Update PIN</button>
      </div>
      <div className="set-divider" />
      <Row label="Session" hint="Sign out of Pillar on this device." last>
        <button className="btn-ghost sm" onClick={signOut}><Icon d={P.lock} size={14} />Sign out</button>
      </Row>
    </div>
  );
}

/* ── Integrations ── */
function Integrations() {
  const items = [
    { name: 'Email (SMTP)', desc: 'Gmail / Yahoo via app password — connected in the Email module.', icon: P.mail },
    { name: 'SMS (Telnyx)', desc: 'Broadcasts, scheduling, and two-way replies via the Telnyx edge functions.', icon: P.chat },
    { name: 'Attendance AI (Claude)', desc: 'Estimates fellowship headcount from a livestream frame.', icon: P.shield },
    { name: 'Database (Supabase)', desc: 'Members, guests, calendar, messages, and settings storage.', icon: P.layers },
  ];
  return (
    <div>
      <SectionHead title="Integrations" sub="Services powering Pillar." />
      <div className="set-integrations">
        {items.map(i => (
          <div key={i.name} className="set-integration">
            <div className="set-int-ic"><Icon d={i.icon} size={20} /></div>
            <div className="set-int-text"><span className="set-int-name">{i.name}</span><span className="set-int-desc">{i.desc}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Shared bits ── */
function SectionHead({ title, sub, inline }) {
  return (
    <div className={`set-head ${inline ? 'inline' : ''}`}>
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}
function Row({ label, hint, children, last }) {
  return (
    <div className={`set-fieldrow ${last ? 'last' : ''}`}>
      <div className="set-fieldrow-l">
        <span className="set-fieldrow-label">{label}</span>
        {hint && <span className="set-fieldrow-hint">{hint}</span>}
      </div>
      <div className="set-fieldrow-c">{children}</div>
    </div>
  );
}
