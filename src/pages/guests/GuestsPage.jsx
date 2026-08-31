import { confirmDialog, alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  fetchGuests, deleteGuests, saveGuest, computeGuestStats,
  isProspect, TYPE_COLORS, STATUS_COLORS,
  guestWeekStart, guestWeekLabel, inGuestWeek, listGuestWeeks, msUntilNextReset,
  fetchGreeterComments,
} from '../../lib/guests';
import GuestTypePicker from './GuestTypePicker';
import GuestForm from './GuestForm';
import CommentModal from './CommentModal';
import NewConnectionModal from './NewConnectionModal';
import TextProspectsModal from './TextProspectsModal';
import ConversationsModal from './ConversationsModal';
import EmailTemplatePicker from './EmailTemplatePicker';
import { buildGuestsDoc, buildProspectsDoc } from './guestPdf';
import { buildCareDoc } from '../care/pdfExport';
import { fetchMembers as fetchCareMembers } from '../../lib/care';
import DocPreviewModal from '../../components/DocPreviewModal';
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
  const [weekView, setWeekView] = useState(null);   // null = this week, else a past week's start
  const [preview, setPreview] = useState(null);     // { html, filename, heading }
  const [exportPick, setExportPick] = useState(false);   // which export?
  const [building, setBuilding] = useState('');
  const [resetTick, setResetTick] = useState(0);    // bumps when 7:00 AM Sunday passes

  async function load() {
    setLoading(true);
    setGuests(await fetchGuests());
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Roll the list over on its own the moment the Sunday 7:00 AM reset passes,
  // even if the page has been sitting open.
  useEffect(() => {
    const t = setTimeout(() => setResetTick(n => n + 1), msUntilNextReset() + 1000);
    return () => clearTimeout(t);
  }, [resetTick]);

  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !location.state?.add) return;
    setPicker(true);
    deepLinked.current = true;
  }, [location.state]);

  // Which guest week the list is showing — this week, or one picked from history.
  const activeWeek = useMemo(() => weekView || guestWeekStart(), [weekView, resetTick]);
  const stats = useMemo(() => computeGuestStats(guests, activeWeek), [guests, activeWeek]);
  const history = useMemo(() => listGuestWeeks(guests), [guests, resetTick]);
  const guestCount    = useMemo(() => guests.filter(g => !isProspect(g) && inGuestWeek(g, activeWeek)).length, [guests, activeWeek]);
  const prospectCount = useMemo(() => guests.filter(g => isProspect(g) && inGuestWeek(g, activeWeek)).length, [guests, activeWeek]);
  const allProspectCount = useMemo(() => guests.filter(isProspect).length, [guests]);
  const isProspectTab = tab === 'prospects' || tab === 'all';

  const rows = useMemo(() => {
    /* Guests and Weekly Prospects are scoped to one guest week — that list
       resets Sunday 7:00 AM. All Prospects deliberately ignores the window:
       someone who first visited in June is still worth following up. */
    let list = tab === 'all'
      ? guests.filter(isProspect)
      : guests.filter(g => inGuestWeek(g, activeWeek)
          && (tab === 'prospects' ? isProspect(g) : !isProspect(g)));
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
  }, [guests, tab, search, sort, activeWeek]);

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

  /*
   * Export shows exactly what the list shows: only the week being viewed.
   * It used to hand the whole `guests` array straight to the PDF, so every
   * previous week's guests printed too.
   */
  async function openPreview() {
    setExportPick(false);
    /* The prospect sheet is the care-list table, not the card layout — the two
       are printed side by side in a meeting and should match. */
    /* The prospect sheet prints whichever list is on screen. */
    if (isProspectTab) {
      setPreview(buildProspectsDoc(tab === 'all'
        ? guests.filter(isProspect)
        : guests.filter(g => isProspect(g) && inGuestWeek(g, activeWeek))));
      return;
    }
    const weekGuests = guests.filter(g => inGuestWeek(g, activeWeek));
    // Greeter comments live in their own table and share the same week window.
    const allComments = await fetchGreeterComments();
    const weekComments = allComments.filter(c => inGuestWeek(c, activeWeek));
    setPreview(buildGuestsDoc(weekGuests, 'guests', guestWeekLabel(activeWeek), weekComments));
  }

  /*
   * Meeting Flow — the three sheets a Sunday meeting runs on, as one document:
   * the week's recap, the prospect list, then the care list. The care sheet is
   * landscape and the other two are portrait, so they are stacked as separate
   * documents rather than forced into one page size.
   */
  async function openMeetingFlow() {
    setBuilding('flow');
    try {
      const weekGuests = guests.filter(g => inGuestWeek(g, activeWeek));
      const label = guestWeekLabel(activeWeek);
      const allComments = await fetchGreeterComments();
      const weekComments = allComments.filter(c => inGuestWeek(c, activeWeek));
      const careMembers = await fetchCareMembers();

      const recap     = buildGuestsDoc(weekGuests, 'guests', label, weekComments);
      const prospects = buildProspectsDoc(guests.filter(isProspect));
      const care      = buildCareDoc(careMembers);

      setExportPick(false);
      setPreview({
        heading: 'Meeting Flow',
        filename: 'meeting-flow',
        docs: [
          { title: 'Recap',     html: recap.html },
          { title: 'Prospects', html: prospects.html, landscape: true },
          { title: 'Cares',     html: care.html, landscape: true },
        ],
      });
    } catch (e) {
      alertDialog(`Could not build the meeting flow: ${e.message}`);
    } finally { setBuilding(''); }
  }

  /*
   * Move a guest onto the prospect list. `not_prospect` is cleared too — that
   * flag is what excludes someone from the prospect views, so leaving it set
   * would change their type but keep them out of the Prospects tab.
   */
  async function makeProspect(g) {
    const ok = await confirmDialog({
      title: 'Move to prospects',
      message: `Move ${g.full_name} to the prospect list? Nothing is deleted — they stay on this week's sheet, under Prospects.`,
      confirmLabel: 'Move to prospects',
    });
    if (!ok) return;
    const { error } = await saveGuest({ ...g, type: 'Prospect', not_prospect: false });
    if (error) return alertDialog(`Could not move ${g.full_name}: ${error.message}`);
    load();
  }

  function handleAction(key) {
    if (key === 'new') setPicker(true);
    else if (key === 'pdf') setExportPick(true);
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

  const showAddress = isProspectTab;
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
              <span className="gp-stat-label">Guests</span>
              <span className="gp-stat-sub">{guestWeekLabel(activeWeek)}</span>
            </div>
            <div className="gp-stat">
              <span className="gp-stat-value">{stats.prospects}</span>
              <span className="gp-stat-label">Prospects</span>
              <span className="gp-stat-sub">{weekView ? 'That week' : 'This week'}</span>
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
                Weekly Prospects <span className="gp-tab-count">{prospectCount}</span>
              </button>
              <button className={`gp-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => { setTab('all'); setSelected(new Set()); }}>
                All Prospects <span className="gp-tab-count">{allProspectCount}</span>
              </button>
            </div>
            {/* All Prospects spans every week, so a week picker there would
                promise filtering that does not apply. */}
            {tab !== 'all' && (
            <div className="gp-week">
              <Icon d={P.clock} size={15} className="gp-week-ic" />
              <select
                value={weekView ? String(weekView.getTime()) : ''}
                onChange={e => { setWeekView(e.target.value ? new Date(Number(e.target.value)) : null); setSelected(new Set()); }}
                aria-label="Guest week"
              >
                <option value="">This week</option>
                {history.map(w => (
                  <option key={w.start.getTime()} value={String(w.start.getTime())}>
                    {w.label} · {w.guests} guests, {w.prospects} prospects
                  </option>
                ))}
              </select>
            </div>
            )}
            <div className="gp-search">
              <Icon d={P.search} size={16} />
              <input placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {weekView && (
            <div className="gp-archive-note">
              <Icon d={P.clock} size={14} />
              Viewing history — <strong>{guestWeekLabel(weekView)}</strong>. Guests and prospects from that week; new entries always land in the current week.
              <button onClick={() => { setWeekView(null); setSelected(new Set()); }}>Back to this week</button>
            </div>
          )}

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
                {weekView
                  ? <>No {isProspectTab ? 'prospects' : 'guests'} were recorded in {guestWeekLabel(weekView)}.</>
                  : tab === 'all'
                  ? <>No prospects yet. Move a guest to the prospect list from their card.</>
                  : <>No {isProspectTab ? 'prospects' : 'guests'} this week yet — the list cleared at 7:00 AM Sunday. Click <strong>New Entry</strong> to add one.</>}
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
                        {!isProspect(g) && (
                          <button title="Move to prospects" onClick={() => makeProspect(g)}>
                            <Icon d={P.location} size={15} />
                          </button>
                        )}
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
            {rows.length} {isProspectTab ? 'prospects' : 'guests'} · {selected.size} selected
            {tab === 'all' ? ' · all weeks' : ` · ${guestWeekLabel(activeWeek)}`}
          </div>
        </div>
      </main>

      {picker && <GuestTypePicker onPick={handlePick} onClose={() => setPicker(false)} />}
      {formType && (
        <GuestForm type={formType} guest={editGuest}
          onClose={() => { setFormType(null); setEditGuest(null); }}
          onSaved={() => { setFormType(null); setEditGuest(null); load(); }} />
      )}
      {exportPick && (
        <div className="modal-overlay" onClick={() => setExportPick(false)}>
          <div className="modal sheet xp-pick" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Export</h2>
              <button className="modal-x" onClick={() => setExportPick(false)}><Icon d={P.close} size={20} /></button>
            </div>
            <div className="modal-body">
              <button className="xp-opt" onClick={openPreview} disabled={!!building}>
                <span className="xp-opt-ic"><Icon d={P.pdf} size={20} /></span>
                <span className="xp-opt-text">
                  <span className="xp-opt-name">Recap PDF</span>
                  <span className="xp-opt-sub">This week's guests, prospects and greeter comments.</span>
                </span>
              </button>
              <button className="xp-opt" onClick={openMeetingFlow} disabled={!!building}>
                <span className="xp-opt-ic"><Icon d={P.layers} size={20} /></span>
                <span className="xp-opt-text">
                  <span className="xp-opt-name">{building === 'flow' ? 'Building…' : 'Meeting Flow'}</span>
                  <span className="xp-opt-sub">Recap, the full prospect list, and the care list — one document.</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      {preview && (
        <DocPreviewModal
          html={preview.html}
          docs={preview.docs}
          filename={preview.filename}
          title={`${preview.heading} — ${guestWeekLabel(activeWeek)}`}
          onClose={() => setPreview(null)}
        />
      )}
      {textOpen && <TextProspectsModal guests={guests} onClose={() => setTextOpen(false)} />}
      {convoOpen && <ConversationsModal guests={guests} onClose={() => setConvoOpen(false)} />}
      {emailOpen && <EmailTemplatePicker guests={guests} onClose={() => setEmailOpen(false)} />}
      {commentOpen && <CommentModal onClose={() => setCommentOpen(false)} onSaved={() => setCommentOpen(false)} />}
      {connectOpen && <NewConnectionModal onClose={() => setConnectOpen(false)} onSaved={() => setConnectOpen(false)} />}
    </div>
  );
}
