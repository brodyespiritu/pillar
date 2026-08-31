import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  fetchStaff, updateStaff, removeStaff, resetPin, resetPassword, normalizeRole, roleColor,
  fetchTimeOff, decideTimeOff, fetchChangeLog, ACTION_COLORS,
  setEmulation, timeAgo,
} from '../../lib/admin';
import EditUserModal from './EditUserModal';
import AddUserModal from './AddUserModal';
import { useAuth } from '../../context/AuthContext';
import { useControl } from '../../context/ControlContext';
import MergeTool from './MergeTool';
import TimeOffTab from './TimeOffTab';
import RemindersTab from './RemindersTab';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { supabase } from '../../lib/supabase';
import { fetchAccounts, sendMessage } from '../../lib/email';
import { genInviteCode, buildInviteHtml } from '../../lib/invite';
import LocationsPanel from '../calendar/LocationsPanel';
import './Admin.css';

const TABS = [
  { key: 'users',   name: 'Users',    icon: P.users },
  { key: 'timeoff', name: 'Time Off', icon: P.clock },
  { key: 'data',    name: 'Data',     icon: P.layers },
  { key: 'email',   name: 'Email',    icon: P.mail },
  { key: 'tools',   name: 'Tools',    icon: P.form },
];

export default function AdminPage() {
  const location = useLocation();
  const [tab, setTab] = useState(() => location.state?.tab || 'users');
  const [testMode, setTestMode] = useState(false);
  const [staff, setStaff] = useState([]);
  const [timeOff, setTimeOff] = useState({ rows: [], missing: false });

  async function loadStaff() { setStaff(await fetchStaff()); }
  useEffect(() => { loadStaff(); fetchTimeOff().then(setTimeOff); }, []);

  const pendingPTO = timeOff.rows.filter(r => r.status === 'Pending').length;

  return (
    <div className="adm-wrap">
      <TopNav />

      <main className="adm-scroll">
        {testMode && (
          <div className="adm-testbanner">
            <Icon d={P.shield} size={16} />
            Test Mode is on — all actions are simulated and nothing is saved or sent.
          </div>
        )}

        <div className="adm-container">
          {/* Hero */}
          <header className="adm-hero">
            <span className="adm-pill">Admin</span>
            <h1 className="adm-title">Admin Dashboard</h1>
            <p className="adm-subtitle">Staff management, settings & tools.</p>
          </header>

          {/* Tab bar + test mode */}
          <div className="adm-controls">
            <nav className="adm-tabrow">
              {TABS.map(t => (
                <button key={t.key} className={`adm-tabu ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                  <Icon d={t.icon} size={15} />{t.name}
                  {t.key === 'timeoff' && pendingPTO > 0 && <span className="adm-tab-dot" />}
                </button>
              ))}
            </nav>
            <button className={`adm-testtoggle ${testMode ? 'on' : ''}`} onClick={() => setTestMode(t => !t)}>
              <span className="adm-testdot" />
              Test Mode {testMode ? 'On' : 'Off'}
            </button>
          </div>

          {/* Content */}
          <div className="adm-content">
            {tab === 'users'   && <UsersTab staff={staff} testMode={testMode} pendingPTO={pendingPTO} reload={loadStaff} onGoTimeOff={() => setTab('timeoff')} initialSearch={location.state?.q || ''} />}
            {tab === 'timeoff' && <TimeOffTab data={timeOff} staff={staff} testMode={testMode} reload={() => fetchTimeOff().then(setTimeOff)} reloadStaff={loadStaff} />}
            {tab === 'data' && (<>
              <MergeTool testMode={testMode} />
              <ChangeLogTab />
            </>)}
            {tab === 'email' && (<>
              <RemindersTab staff={staff} testMode={testMode} />
              <div className="adm-panel">
                <div className="adm-panel-head"><h2>Event Locations &amp; Photos</h2></div>
                {/* The panel carries its own description, including a live
                    "N of M have a photo" count. */}
                <LocationsPanel />
              </div>
              <div className="adm-cards">
                <FeatureCard icon={P.mail} title="Email Settings" desc="Daily summary digest with time picker & subscribers, instant alert triggers, and per-category alert thresholds." />
                <FeatureCard icon={P.grid} title="Email Designer" desc="Drag-and-drop visual email builder — block toolbox, live canvas, per-block property editors, and send dialog." />
              </div>
            </>)}
            {tab === 'tools' && (
              <div className="adm-cards">
                <FeatureCard icon={P.form} title="Forms" desc="Global branding for public forms (logo, colors, fonts, button styles) with live preview, plus per-form AES-256 encryption." />
                <FeatureCard icon={P.link} title="Integrations" desc="Manage the SermonPro API (Canva Connect) token — expiration warnings, masked input, Save & Test Connection." />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ═══════════ Users ═══════════ */
function UsersTab({ staff, testMode, pendingPTO, reload, onGoTimeOff, initialSearch = '' }) {
  const { user } = useAuth();
  const { requestControl } = useControl();
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [menu, setMenu] = useState(null);
  const [menuUp, setMenuUp] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  function openMenu(id, e) {
    if (menu === id) { setMenu(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuUp(window.innerHeight - rect.bottom < 280);   // flip up if little room below
    setMenu(id);
  }

  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.active !== false).length,
    admins: staff.filter(s => normalizeRole(s.role) === 'Admin').length,
    pto: pendingPTO,
  }), [staff, pendingPTO]);

  const rows = useMemo(() => {
    let list = staff;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => [s.name, s.email, s.role, s.department].filter(Boolean).some(v => v.toLowerCase().includes(q)));
    }
    const { key, dir } = sort;
    return [...list].sort((a, b) => {
      const av = (a[key] ?? '').toString().toLowerCase(), bv = (b[key] ?? '').toString().toLowerCase();
      return av < bv ? (dir === 'asc' ? -1 : 1) : av > bv ? (dir === 'asc' ? 1 : -1) : 0;
    });
  }, [staff, search, sort]);

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); }

  async function doSave(patch) {
    if (testMode) { toast('Test Mode: changes not saved.'); setEditUser(null); return; }
    /* A database trigger blocks non-admins from changing role, permissions or
       active status. Swallowing that error closed the dialog as if it had
       saved — keep it open and say what happened. */
    const { error } = await updateStaff(editUser.id, patch);
    if (error) return toast(`Could not save: ${error.message}`);
    setEditUser(null); reload();
  }
  async function doReset(u) {
    if (testMode) return toast('Test Mode: PIN not reset.');
    const pin = await promptDialog({ title: 'Reset PIN', message: `Set a new 4-digit PIN for ${u.name}:`, numeric: true, maxLength: 4, placeholder: '4 digits', confirmLabel: 'Set PIN' });
    if (!pin || !/^\d{4}$/.test(pin)) return;
    const { error } = await resetPin(u.id, pin);
    if (error) return toast(`Could not reset PIN: ${error.message}`);
    toast('PIN reset.'); reload();
  }
  async function doResetPassword(u) {
    setMenu(null);
    if (testMode) return toast('Test Mode: password not reset.');
    const pw = await promptDialog({ title: 'Reset login password', message: `Set a new login password for ${u.name}. Share it with them — they can change it later.`, placeholder: 'New password (min 6 characters)', confirmLabel: 'Reset password' });
    if (!pw) return;
    if (pw.length < 6) return toast('Password must be at least 6 characters.');
    const { error } = await resetPassword(u.id, pw);
    if (error) return toast(`Could not reset password: ${error.message}`);
    toast(`Password reset for ${u.name}.`);
  }
  async function doInvite(u) {
    setMenu(null);
    if (testMode) return toast('Test Mode: invite not sent.');
    if (!u.email) return toast('This user has no email on file.');
    const code = genInviteCode();
    const { error: cErr } = await supabase.from('staff').update({ invite_code: code }).eq('id', u.id);
    if (cErr) return toast(`Could not save invite: ${cErr.message}`);
    const accts = await fetchAccounts();
    const account = accts.find(a => a.app_password) || accts[0];
    if (!account) return toast('Connect a mail account in the Email module to send invites.');
    try {
      await sendMessage(account, { to: u.email, subject: 'Set up your Pillar account', htmlBody: buildInviteHtml(u, code) });
      toast(`Invite emailed to ${u.email}.`);
    } catch (e) {
      toast(`Code saved, but the email failed: ${e.message}`);
    }
  }
  async function doRemove(u) {
    setMenu(null);
    if (!(await confirmDialog({ title: 'Remove user', message: `Remove ${u.name}? This removes their profile from Pillar.`, danger: true, confirmLabel: 'Remove' }))) return;
    if (testMode) return toast('Test Mode: user not removed.');
    const { error } = await removeStaff(u.id);
    if (error) return toast(`Could not remove: ${error.message}`);
    toast('User removed.'); reload();
  }

  const STATS = [
    { label: 'Total Users', value: stats.total,  color: 'var(--accent)', icon: P.users },
    { label: 'Active',      value: stats.active, color: 'var(--green)',  icon: P.check },
    { label: 'Admins',      value: stats.admins, color: '#8B5CF6',       icon: P.shield },
    { label: 'Time Off Requests', value: stats.pto, color: 'var(--yellow)', icon: P.clock, pulse: stats.pto > 0, onClick: onGoTimeOff },
  ];

  return (
    <div>
      <div className="adm-stats">
        {STATS.map(s => (
          <button key={s.label} className="adm-stat" onClick={s.onClick} style={{ cursor: s.onClick ? 'pointer' : 'default' }}>
            <div className="adm-stat-icon" style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}>
              <Icon d={s.icon} size={18} />
            </div>
            <div>
              <span className="adm-stat-value" style={{ color: s.color }}>{s.value}</span>
              <span className="adm-stat-label">{s.label}{s.pulse && <span className="adm-pulse" />}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="adm-panel adm-users-panel">
        <div className="adm-panel-head">
          <h2>Staff</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="adm-search">
              <Icon d={P.search} size={16} />
              <input placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn-primary sm" onClick={() => setAddOpen(true)}><Icon d={P.plus} size={14} />Add user</button>
          </div>
        </div>

        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} className="sortable">User</th>
                <th onClick={() => toggleSort('role')} className="sortable">Role</th>
                <th>Department</th>
                <th>Auth</th>
                <th>PIN</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(u => {
                const role = normalizeRole(u.role);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="adm-user">
                        <span className="adm-avatar">{(u.name || '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()}</span>
                        <div><span className="adm-user-name">{u.name}</span><span className="adm-user-email">{u.email}</span></div>
                      </div>
                    </td>
                    <td><span className="adm-role" style={{ '--c': roleColor(role) }}>{role}</span></td>
                    <td className="adm-muted">{u.department || '—'}</td>
                    <td className="adm-muted">{u.auth_method || 'email'}</td>
                    <td>{u.pin_hash ? <span className="adm-pin yes">Set</span> : <span className="adm-pin no">None</span>}</td>
                    <td>{u.active !== false ? <span className="adm-status active">Active</span> : <span className="adm-status inactive">Inactive</span>}</td>
                    <td className="adm-actions-cell">
                      <button className="adm-menu-btn" onClick={e => openMenu(u.id, e)}>⋯</button>
                      {menu === u.id && (
                        <>
                          <div className="adm-menu-backdrop" onClick={() => setMenu(null)} />
                          <div className={`adm-menu ${menuUp ? 'up' : ''}`}>
                            <button onClick={() => { setEditUser(u); setMenu(null); }}><Icon d={P.edit} size={14} />Edit User</button>
                            <button onClick={() => { setEditUser(u); setMenu(null); }}><Icon d={P.shield} size={14} />Permissions</button>
                            <button disabled={u.id === user?.id} onClick={() => { setMenu(null); requestControl(u.id, u.name); }}>
                              <Icon d={P.radio} size={14} />Control{u.id === user?.id ? ' (you)' : ''}
                            </button>
                            <button onClick={() => { setMenu(null); doReset(u); }}><Icon d={P.lock} size={14} />Reset PIN</button>
                            <button onClick={() => { setMenu(null); doResetPassword(u); }}><Icon d={P.person} size={14} />Reset Password</button>
                            <button onClick={() => doInvite(u)}><Icon d={P.mail} size={14} />Send Invite</button>
                            <button onClick={() => { setMenu(null); setEmulation({ id: u.id, name: u.name, role: normalizeRole(u.role) }); toast(`Now viewing as ${u.name}.`); }}>
                              <Icon d={P.person} size={14} />Emulate User
                            </button>
                            <button className="danger" onClick={() => doRemove(u)}><Icon d={P.trash} size={14} />Remove User</button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="adm-empty">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editUser && <EditUserModal user={editUser} testMode={testMode} onClose={() => setEditUser(null)} onSave={doSave} />}
      {addOpen && <AddUserModal testMode={testMode} onClose={() => setAddOpen(false)}
        onCreated={(f, test) => {
          setAddOpen(false);
          toast(test ? 'Test Mode: user not created.' : `${f?.name || 'User'} added.`);
          if (!test) { setSearch(''); reload(); }   // clear any filter so the new user is visible
        }} />}
    </div>
  );
}

/* ═══════════ Change Log ═══════════ */
function ChangeLogTab() {
  const [data, setData] = useState({ rows: [], missing: false });
  const [search, setSearch] = useState('');
  useEffect(() => { fetchChangeLog().then(setData); }, []);
  if (data.missing) return <Placeholder title="Change Log" icon={P.doc} desc="Run supabase/admin-schema.sql to enable the audit trail — every care-list Create / Update / Delete / Merge / Contact-Logged action with who, what, and when. Search, filter, and export to CSV." />;
  const rows = data.rows.filter(r => !search.trim() || [r.member_name, r.action, r.changed_by, r.details].filter(Boolean).some(v => v.toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h2>Change Log</h2>
        <div className="adm-search"><Icon d={P.search} size={16} /><input placeholder="Search log…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Member</th><th>Action</th><th>Details</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="adm-user-name">{r.member_name}</td>
                <td><span className="adm-role" style={{ '--c': ACTION_COLORS[r.action] || '#6B7280' }}>{r.action}</span></td>
                <td className="adm-muted">{r.details}</td>
                <td className="adm-muted">{r.changed_by}</td>
                <td className="adm-muted">{timeAgo(r.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="adm-empty">No log entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════ Feature card (compact coming-soon) ═══════════ */
function FeatureCard({ icon, title, desc }) {
  return (
    <div className="adm-feature">
      <div className="adm-feature-icon"><Icon d={icon} size={22} /></div>
      <div className="adm-feature-text">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <span className="adm-placeholder-tag">Coming soon</span>
    </div>
  );
}

/* ═══════════ Placeholder ═══════════ */
function Placeholder({ title, icon, desc }) {
  return (
    <div className="adm-placeholder">
      <div className="adm-placeholder-icon"><Icon d={icon} size={28} /></div>
      <h2>{title}</h2>
      <p>{desc}</p>
      <span className="adm-placeholder-tag">Coming soon</span>
    </div>
  );
}

/* tiny toast */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2200);
}
