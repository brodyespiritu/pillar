import { confirmDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import {
  fetchMembers, deleteMember, computeStats, buildSummary,
  CATEGORIES, PRIORITIES, CATEGORY_COLORS, lastContacted,
} from '../../lib/care';
import MemberForm from './MemberForm';
import MemberProfile from './MemberProfile';
import BulkAddModal from './BulkAddModal';
import { exportMembersPDF } from './pdfExport';
import './CaresPage.css';

const FILTERS = {
  active:     { label: 'Currently Active', color: '#10B981', icon: P.heart,    soft: '#E8F8F1' },
  attention:  { label: 'Needs Attention',  color: '#E5484D', icon: P.shield,   soft: '#FDEEEE' },
  notVisited: { label: 'Not Yet Visited',  color: '#F59E0B', icon: P.location, soft: '#FEF6E7' },
};

export default function CaresPage() {
  const location = useLocation();
  const deepLinked = useRef(false);
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState(null);
  const [search, setSearch]     = useState('');
  const [priorityF, setPriorityF] = useState('All');
  const [categoryF, setCategoryF] = useState('All');
  const [formOpen, setFormOpen]     = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [profileMember, setProfileMember] = useState(null);
  const [profileLogging, setProfileLogging] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimer = useRef(null);
  const holdRAF   = useRef(null);

  async function load() {
    setLoading(true);
    setMembers(await fetchMembers());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Deep link from global search → open the exact member's profile
  useEffect(() => {
    if (deepLinked.current) return;
    if (location.state?.add) {
      openAdd();
      deepLinked.current = true;
      return;
    }
    if (!members.length) return;
    const id = location.state?.openMember;
    if (id) {
      const m = members.find(x => x.id === id);
      if (m) { setProfileMember(m); setFilter('active'); setSearch(m.full_name); }
      deepLinked.current = true;
    }
  }, [members, location.state]);

  const stats = useMemo(() => computeStats(members), [members]);
  const summary = useMemo(() => buildSummary(members), [members]);

  const filtered = useMemo(() => {
    let list = members;
    if (filter === 'active')     list = list.filter(m => m.status === 'Active');
    if (filter === 'attention')  list = list.filter(m => m.priority === 'High' && m.category !== 'Recovering');
    if (filter === 'notVisited') list = list.filter(m => !(m.contact_logs?.length));
    if (priorityF !== 'All') list = list.filter(m => m.priority === priorityF);
    if (categoryF !== 'All') list = list.filter(m => m.category === categoryF);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        [m.full_name, m.phone, m.email, m.assigned_name, m.care_notes, m.family_member]
          .filter(Boolean).some(v => v.toLowerCase().includes(q)));
    }
    return list;
  }, [members, filter, priorityF, categoryF, search]);

  function toggleFilter(key) {
    setFilter(f => (f === key ? null : key));
    setPriorityF('All'); setCategoryF('All'); setSearch('');
  }
  function openAdd()   { setEditMember(null); setFormOpen(true); }
  function openEdit(m) { setEditMember(m); setFormOpen(true); setProfileMember(null); }
  function openProfile(m, logging = false) { setProfileMember(m); setProfileLogging(logging); }

  async function handleDelete(m) {
    if (!(await confirmDialog({ message: `Delete ${m.full_name}? This cannot be undone.` }))) return;
    await deleteMember(m.id);
    setProfileMember(null);
    load();
  }

  /* hold-to-voice */
  function startHold() {
    const start = Date.now();
    holdRAF.current = requestAnimationFrame(function tick() {
      const p = Math.min((Date.now() - start) / 1000, 1);
      setHoldProgress(p);
      if (p < 1) holdRAF.current = requestAnimationFrame(tick);
    });
    holdTimer.current = setTimeout(() => { endHold(); startVoiceSearch(); }, 1000);
  }
  function endHold() {
    clearTimeout(holdTimer.current);
    cancelAnimationFrame(holdRAF.current);
    setHoldProgress(0);
  }
  function handleAddClick() { if (holdProgress === 0) openAdd(); }

  function startVoiceSearch() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { openAdd(); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.onresult = e => { setSearch(e.results[0][0].transcript); setFilter('active'); };
    rec.start();
  }

  return (
    <div className="cp-wrap">
      <TopNav onNewClick={openAdd} />

      <main className="cp-scroll">
        <div className="cp-container">
          {/* ── Hero ── */}
          <header className="cp-hero">
            <span className="cp-pill">Pastoral Care</span>
            <h1 className="cp-title">Care List</h1>
            <p className="cp-subtitle">{summary}</p>

            <div className="cp-search-row">
              <div className="cp-search">
                <Icon d={P.search} size={18} className="cp-search-icon" />
                <input
                  placeholder="Search by name, phone, or staff…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); if (!filter) setFilter('active'); }}
                />
                <button className="cp-mic" onClick={startVoiceSearch} title="Voice search">
                  <Icon d={P.mic} size={16} />
                </button>
              </div>
              <div className="cp-select">
                <select value={priorityF} onChange={e => { setPriorityF(e.target.value); if (!filter) setFilter('active'); }}>
                  <option value="All">All priorities</option>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p} priority</option>)}
                </select>
                <Icon d={P.chevron} size={18} className="cp-select-chev" />
              </div>
            </div>
          </header>

          {/* ── Colored filters ── */}
          <div className="cp-filters">
            <button
              className="qb qb-add"
              onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold}
              onClick={handleAddClick}
            >
              <div className="qb-hold-fill" style={{ height: `${holdProgress * 100}%` }} />
              <div className="qb-content">
                <div className="qb-icon"><Icon d={holdProgress > 0.45 ? P.mic : P.plus} size={20} /></div>
                <div className="qb-meta">
                  <span className="qb-value">Add</span>
                  <span className="qb-label">Add Matter</span>
                </div>
              </div>
            </button>
            <QB k="active"     value={stats.active}         filter={filter} toggle={toggleFilter} />
            <QB k="attention"  value={stats.needsAttention} filter={filter} toggle={toggleFilter} />
            <QB k="notVisited" value={stats.notVisited}     filter={filter} toggle={toggleFilter} />
          </div>

          {/* ── Results ── */}
          {filter ? (
            <section className="cp-results">
              <div className="cp-results-head">
                <div className="cp-results-title">
                  <h2>{FILTERS[filter].label}</h2>
                  <span className="cp-count">{filtered.length}</span>
                </div>
                <div className="cp-results-tools">
                  <div className="cp-select sm">
                    <select value={categoryF} onChange={e => setCategoryF(e.target.value)}>
                      <option value="All">All categories</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <Icon d={P.chevron} size={16} className="cp-select-chev" />
                  </div>
                  <button className="cp-tool-btn" onClick={() => exportMembersPDF(filtered)}>
                    <Icon d={P.pdf} size={15} />Export PDF
                  </button>
                  <button className="cp-tool-btn ghost" onClick={() => setFilter(null)}>Hide</button>
                </div>
              </div>

              {loading ? (
                <div className="cp-state">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="cp-state">No members match this filter.</div>
              ) : (
                <div className="cp-cards">
                  {filtered.map(m => (
                    <MemberCard key={m.id} member={m}
                      onOpen={() => openProfile(m)}
                      onEdit={() => openEdit(m)}
                      onUpdate={() => openProfile(m, true)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="cp-empty">
              <div className="cp-empty-icon"><Icon d={P.heart} size={26} /></div>
              <p className="cp-empty-title">Select a filter to view members</p>
              <p className="cp-empty-sub">Tap a colored card above, or start typing to search.</p>
            </div>
          )}
        </div>
      </main>

      {formOpen && (
        <MemberForm member={editMember} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} />
      )}
      {profileMember && (
        <MemberProfile member={profileMember} startLogging={profileLogging}
          onClose={() => { setProfileMember(null); setProfileLogging(false); }}
          onEdit={openEdit} onDelete={handleDelete} onChanged={load} />
      )}
      {bulkOpen && (
        <BulkAddModal onClose={() => setBulkOpen(false)} onSaved={() => { setBulkOpen(false); load(); }} />
      )}
    </div>
  );
}

/* ── Colored filter card ── */
function QB({ k, value, filter, toggle }) {
  const f = FILTERS[k];
  const on = filter === k;
  return (
    <button
      className={`qb ${on ? 'active' : ''}`}
      style={{ '--qb-color': f.color, '--qb-soft': f.soft }}
      onClick={() => toggle(k)}
    >
      <div className="qb-content">
        <div className="qb-icon" style={{ color: f.color, background: f.soft }}>
          <Icon d={f.icon} size={20} />
        </div>
        <div className="qb-meta">
          <span className="qb-value" style={{ color: f.color }}>{value}</span>
          <span className="qb-label">{f.label}</span>
        </div>
      </div>
    </button>
  );
}

/* ── Member card ── */
function MemberCard({ member, onOpen, onEdit, onUpdate }) {
  const lc = lastContacted(member);
  return (
    <div className="mc" onClick={onOpen}>
      <h3 className="mc-name">
        {member.full_name}
        {member.family_member && <span className="mc-family"> · {member.family_member}</span>}
      </h3>

      <p className="mc-sub">
        {member.category}
        <span className="mc-dot">·</span>
        {lc ? `Last contact ${new Date(lc).toLocaleDateString()}` : 'Not yet visited'}
      </p>

      <div className="mc-foot" onClick={e => e.stopPropagation()}>
        <button className="mc-view" onClick={onOpen}>View <Icon d={P.arrowRight} size={18} /></button>
        <div className="mc-hover">
          <button className="mc-hbtn" onClick={onEdit}><Icon d={P.edit} size={14} />Edit</button>
          <button className="mc-hbtn primary" onClick={onUpdate}><Icon d={P.clock} size={14} />Update</button>
        </div>
      </div>
    </div>
  );
}

export function PriorityBadge({ p }) {
  return <span className={`pb pb-${p?.toLowerCase()}`}>{p}</span>;
}
