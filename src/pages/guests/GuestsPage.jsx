import { confirmDialog, alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  fetchGuests, deleteGuests, computeGuestStats, weekLabel,
  isProspect, TYPE_COLORS, STATUS_COLORS,
} from '../../lib/guests';
import GuestTypePicker from './GuestTypePicker';
import GuestForm from './GuestForm';
import CommentModal from './CommentModal';
import NewConnectionModal from './NewConnectionModal';
import TextProspectsModal from './TextProspectsModal';
import ConversationsModal from './ConversationsModal';
import EmailTemplatePicker from './EmailTemplatePicker';
import { exportGuestsPDF } from './guestPdf';
import './Guests.css';

const SUB_MIDDLE = [
  { label: 'Send Email',        icon: P.mail, key: 'email' },
  { label: 'Start Text',        icon: P.sms,  key: 'text' },
  { label: 'View Conversations', icon: P.chat, key: 'convo' },
];
const SUB_RIGHT = [
  { label: 'Export',          icon: P.pdf,    key: 'pdf' },
  { label: 'Digital Retainer', icon: P.folder, key: 'retainer' },
];

const COLUMNS = [
  { key: 'full_name', label: 'Name' },
  { key: 'type',      label: 'Type' },
  { key: 'phone',     label: 'Phone' },
  { key: 'email',     label: 'Email' },
  { key: 'first_visit', label: 'First Visit' },
  { key: 'last_visit',  label: 'Last Visit' },
  { key: 'status',    label: 'Status' },
];

export default function GuestsPage() {
  const location = useLocation();
  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState(location.state?.prospect ? 'prospects' : 'guests'); // guests | prospects
  const [search, setSearch]   = useState(location.state?.q || '');
  const [sort, setSort]       = useState({ key: 'last_visit', dir: 'desc' });
  const [selected, setSelected] = useState(new Set());

  const [picker, setPicker]   = useState(false);
  const [formType, setFormType] = useState(null);
  const [editGuest, setEditGuest] = useState(null);
  const [textOpen, setTextOpen] = useState(false);
  const [convoOpen, setConvoOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  async function load() {
    setLoading(true);
    setGuests(await fetchGuests());
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !location.state?.add) return;
    setPicker(true);
    deepLinked.current = true;
  }, [location.state]);

  const stats = useMemo(() => computeGuestStats(guests), [guests]);
  const guestCount    = useMemo(() => guests.filter(g => !isProspect(g)).length, [guests]);
  const prospectCount = useMemo(() => guests.filter(isProspect).length, [guests]);

  const rows = useMemo(() => {
    let list = guests.filter(g => (tab === 'prospects' ? isProspect(g) : !isProspect(g)));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(g => [g.full_name, g.phone, g.email, g.type, g.status, g.assigned_name]
        .filter(Boolean).some(v => v.toLowerCase().includes(q)));
    }
    const { key, dir } = sort;
    list = [...list].sort((a, b) => {
      const av = a[key] ?? '', bv = b[key] ?? '';
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [guests, tab, search, sort]);

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }
  function toggleRow(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  }
  async function bulkDelete() {
    if (!(await confirmDialog({ message: `Delete ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}?` }))) return;
    await deleteGuests([...selected]);
    load();
  }

  function handleAction(key) {
    if (key === 'new') setPicker(true);
    else if (key === 'pdf') exportGuestsPDF(guests, tab === 'prospects' ? 'prospects' : 'guests');
    else if (key === 'text') setTextOpen(true);
    else if (key === 'convo') setConvoOpen(true);
    else if (key === 'email') setEmailOpen(true);
    else {
      const labels = { retainer: 'Digital Retainer' };
      alertDialog(`${labels[key] || 'This feature'} — coming soon.`);
    }
  }
  function handlePick(type) {
    setPicker(false);
    if (type === 'Comment') { setCommentOpen(true); return; }
    if (type === 'New Connection') { setConnectOpen(true); return; }
    setEditGuest(null); setFormType(type);
  }
  function openEdit(g) { setEditGuest(g); setFormType(g.type); }

  const showAddress = tab === 'prospects';
  const cols = COLUMNS.filter(c => !(c.key === 'first_visit' && showAddress));

  return (
    <div className="gp-wrap">
      <TopNav onNewClick={() => setPicker(true)} />

      <main className="gp-scroll">
        <div className="gp-container">
          {/* Hero */}
          <header className="gp-hero">
            <span className="gp-pill">Front Door</span>
            <h1 className="gp-title">Guest List</h1>
            <p className="gp-subtitle">Track every visitor's journey — from first visit to connected member.</p>
          </header>

          {/* Stats */}
          <div className="gp-stats">
            <div className="gp-stat">
              <span className="gp-stat-value">{stats.thisWeek}</span>
              <span className="gp-stat-label">This Week</span>
              <span className="gp-stat-sub">{weekLabel()}</span>
            </div>
            <div className="gp-stat">
              <span className="gp-stat-value">{stats.prospects}</span>
              <span className="gp-stat-label">Total Prospects</span>
              <span className="gp-stat-sub">All time</span>
            </div>
            <div className="gp-stat">
              <span className="gp-stat-value">{stats.recap}</span>
              <span className="gp-stat-label">Recap</span>
              <span className="gp-stat-sub">Salvations · Baptisms · Members</span>
            </div>
          </div>

          {/* Sub-action bar */}
          <div className="gp-subbar">
            <div className="gp-subsection left">
              <button className="gp-subbtn primary" onClick={() => handleAction('new')}>
                <Icon d={P.plus} size={16} />New Entry
              </button>
            </div>
            <div className="gp-subsection middle">
              {SUB_MIDDLE.map(a => (
                <button key={a.key} className="gp-subbtn" onClick={() => handleAction(a.key)}>
                  <Icon d={a.icon} size={16} />{a.label}
                </button>
              ))}
            </div>
            <div className="gp-subsection right">
              {SUB_RIGHT.map(a => (
                <button key={a.key} className="gp-subbtn" onClick={() => handleAction(a.key)}>
                  <Icon d={a.icon} size={16} />{a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs + search */}
          <div className="gp-controls">
            <div className="gp-tabs">
              <button className={`gp-tab ${tab === 'guests' ? 'active' : ''}`} onClick={() => { setTab('guests'); setSelected(new Set()); }}>
                Guests <span className="gp-tab-count">{guestCount}</span>
              </button>
              <button className={`gp-tab ${tab === 'prospects' ? 'active' : ''}`} onClick={() => { setTab('prospects'); setSelected(new Set()); }}>
                Prospects <span className="gp-tab-count">{prospectCount}</span>
              </button>
            </div>
            <div className="gp-search">
              <Icon d={P.search} size={16} />
              <input placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="gp-bulk">
              <span>{selected.size} selected</span>
              <button onClick={bulkDelete}><Icon d={P.trash} size={15} />Delete {selected.size}</button>
            </div>
          )}

          {/* Table */}
          <div className="gp-table-wrap">
            {loading ? (
              <div className="gp-empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="gp-empty">
                No {tab === 'prospects' ? 'prospects' : 'guests'} yet. Click <strong>New Entry</strong> to add one.
              </div>
            ) : (
              <table className="gp-table">
                <thead>
                  <tr>
                    <th className="gp-check">
                      <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
                    </th>
                    {cols.map(c => (
                      <th key={c.key} onClick={() => toggleSort(c.key)} className="gp-sortable">
                        {c.label}
                        {sort.key === c.key && <Icon d={sort.dir === 'asc' ? P.arrowUp : P.arrowDown} size={14} className="gp-sort-icon" />}
                      </th>
                    ))}
                    {showAddress && <th>Address</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(g => (
                    <tr key={g.id} className={selected.has(g.id) ? 'sel' : ''}>
                      <td className="gp-check" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleRow(g.id)} />
                      </td>
                      <td className="gp-name" onClick={() => openEdit(g)}>{g.full_name}</td>
                      <td><span className="gp-badge" style={{ '--c': TYPE_COLORS[g.type] || '#6B7280' }}>{g.type}</span></td>
                      <td className="gp-muted">{g.phone || '—'}</td>
                      <td className="gp-muted">{g.email || '—'}</td>
                      {!showAddress && <td className="gp-muted">{g.first_visit ? new Date(g.first_visit).toLocaleDateString() : '—'}</td>}
                      <td className="gp-muted">{g.last_visit ? new Date(g.last_visit).toLocaleDateString() : '—'}</td>
                      <td><span className="gp-status" style={{ '--c': STATUS_COLORS[g.status] || '#6B7280' }}>{g.status}</span></td>
                      {showAddress && <td className="gp-muted">{g.address || '—'}</td>}
                      <td className="gp-row-actions" onClick={e => e.stopPropagation()}>
                        <button title="Edit" onClick={() => openEdit(g)}><Icon d={P.edit} size={15} /></button>
                        <button title="Delete" onClick={async () => { if (await confirmDialog({ message: `Delete ${g.full_name}?` })) { await deleteGuests([g.id]); load(); } }}>
                          <Icon d={P.trash} size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="gp-footer">
            {rows.length} {tab === 'prospects' ? 'prospects' : 'guests'} · {selected.size} selected · {stats.thisWeek} this week
          </div>
        </div>
      </main>

      {picker && <GuestTypePicker onPick={handlePick} onClose={() => setPicker(false)} />}
      {formType && (
        <GuestForm type={formType} guest={editGuest}
          onClose={() => { setFormType(null); setEditGuest(null); }}
          onSaved={() => { setFormType(null); setEditGuest(null); load(); }} />
      )}
      {textOpen && <TextProspectsModal guests={guests} onClose={() => setTextOpen(false)} />}
      {convoOpen && <ConversationsModal guests={guests} onClose={() => setConvoOpen(false)} />}
      {emailOpen && <EmailTemplatePicker guests={guests} onClose={() => setEmailOpen(false)} />}
      {commentOpen && <CommentModal onClose={() => setCommentOpen(false)} onSaved={() => setCommentOpen(false)} />}
      {connectOpen && <NewConnectionModal onClose={() => setConnectOpen(false)} onSaved={() => setConnectOpen(false)} />}
    </div>
  );
}
