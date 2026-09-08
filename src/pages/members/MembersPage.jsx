import { confirmDialog, alertDialog } from "../../lib/dialog";
import { flashSaved } from '../../lib/flash';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsMobile } from '../../lib/useIsMobile';
import MembersMobile from './MembersMobile';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { normalizeRole } from '../../lib/admin';
import { printHtml } from '../../lib/printDoc';
import {
  fetchChurchMembers, saveChurchMember, deleteChurchMember, STATUSES, initials, fileToAvatarDataUrl,
  readClipboardImage, removeWhiteBackground,
  FAMILY_POSITIONS, GENDERS, MARITAL_STATUSES, MEMBER_STATUSES, RECORD_TYPES, JOINED_HOW_OPTIONS,
  fmtMDY, ageFromBirthday, familyMembers,
  parseCsv, mapIndividualList, importMembers,
  allGroups, inGroup, assignedToDeacon, deaconOf, DEACON_GROUP, groupByFamily,
  markMemberAsProspect, restoreProspectToMember, isHiddenProspect,
  markMemberInactive, reactivateMember, isInactive, isArchived,
  createNewHousehold, newHouseholdPatch,
} from '../../lib/members';
import ManageGroupsModal from './ManageGroupsModal';
import AddFamilyModal from './AddFamilyModal';
import '../care/Modal.css';
import './Members.css';

export default function MembersPage() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { profile } = useAuth();
  const isAdmin = normalizeRole(profile?.role) === 'Admin';
  const [data, setData]   = useState({ rows: [], missing: false });
  const [search, setSearch] = useState('');
  const [edit, setEdit]   = useState(location.state?.add ? {} : null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(0);
  const [groupFilter, setGroupFilter] = useState('');
  const [groupsOpen, setGroupsOpen] = useState(false);
  const importRef = useRef(null);
  const openedRef = useRef(false);
  const PAGE_SIZE = 12;

  async function load() {
    const d = await fetchChurchMembers();
    setData(d);
    // keep an open profile in sync after edits/deletes
    setViewing(v => v ? (d.rows.find(x => x.id === v.id) || null) : v);
  }
  useEffect(() => { load(); }, []);

  // Open a specific member when arriving from Reports (?state.openMember), once.
  useEffect(() => {
    if (openedRef.current) return;
    const id = location.state?.openMember;
    if (id && data.rows.length) {
      const m = data.rows.find(x => x.id === id);
      if (m) { setViewing(m); openedRef.current = true; }
    }
  }, [data.rows, location.state]);

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const mapped = mapIndividualList(parseCsv(text));
      if (!mapped.length) { setImporting(false); return alertDialog('No members found in that file.'); }
      if (!(await confirmDialog({ title: 'Import members', message: `Import ${mapped.length} members from "${file.name}"? People already imported (same source id) will be updated, not duplicated.`, confirmLabel: 'Import' }))) {
        setImporting(false); return;
      }
      const { data: res, error } = await importMembers(mapped);
      setImporting(false);
      if (error) return alertDialog(`Import failed: ${error.message}`);
      await load();
      alertDialog(`Import complete.\n\n${res.inserted} added · ${res.updated} updated\nDirectory now has ${res.total} members.`);
    } catch (err) {
      setImporting(false);
      alertDialog(`Could not read that file: ${err.message}`);
    }
  }

  async function makeProspect(m) {
    const ok = await confirmDialog({
      title: 'Mark as prospect',
      message: `Move ${m.name} out of the member directory and keep them on the prospect list? Their record isn't deleted — view them any time with the "Prospects" filter.`,
      confirmLabel: 'Mark as prospect',
    });
    if (!ok) return;
    const { error } = await markMemberAsProspect(m.id);
    if (error) return alertDialog(`Could not update ${m.name}: ${error.message}`);
    flashSaved();
    setViewing(null);
    await load();
  }

  /*
   * Out of their parents' household and into their own — the eighteenth
   * birthday case. Nothing is deleted; they keep the record, the roll and the
   * groups, and simply stop being filed under someone else's family.
   */
  async function newHousehold(m) {
    const others = familyMembers(data.rows, m);
    const ok = await confirmDialog({
      title: 'Create new household',
      message: others.length
        ? `Move ${m.name} into their own household, separate from ${others.map(o => o.name).join(', ')}? `
          + `${m.name} becomes the head of it. Nothing is deleted, and the rest of the household is unchanged.`
        : `${m.name} is not in a household with anyone else. Create one for them anyway?`,
      confirmLabel: 'Create household',
    });
    if (!ok) return;
    const { error } = await createNewHousehold(m);
    if (error) return alertDialog(`Could not update ${m.name}: ${error.message}`);
    flashSaved();
    await load();
    /* Kept open, showing the new household — the person doing this usually
       wants to see it took. */
    setViewing(v => (v && v.id === m.id ? { ...v, ...newHouseholdPatch(v) } : v));
  }

  async function restoreMember(m) {
    // One "Restore" for both states — whichever parked them, this brings them back.
    const { error } = isInactive(m) ? await reactivateMember(m.id) : await restoreProspectToMember(m.id);
    if (!error) flashSaved();
    if (error) return alertDialog(`Could not restore ${m.name}: ${error.message}`);
    setViewing(null);
    await load();
  }

  async function makeInactive(m) {
    const ok = await confirmDialog({
      title: 'Mark as inactive',
      message: `Move ${m.name} out of the member directory? Nothing is deleted — their whole profile is kept and you can find them again under Reports → Inactive, or the "Inactive" filter here.`,
      confirmLabel: 'Mark as inactive',
    });
    if (!ok) return;
    const { error } = await markMemberInactive(m.id);
    if (!error) flashSaved();
    if (error) return alertDialog(`Could not update ${m.name}: ${error.message}`);
    setViewing(null);
    await load();
  }

  /*
   * Prospect and Inactive records are deliberately kept out of the directory.
   * Saving one made it vanish with no explanation, which reads as "it didn't
   * save" — say where it went and switch the filter to show it.
   */
  async function onMemberSaved(saved) {
    setEdit(null);
    await load();
    // Prospects stay visible, so only an Inactive save needs explaining.
    if (!saved || !isInactive(saved) || groupFilter === '__inactive') return;
    setGroupFilter('__inactive');
    alertDialog(`${saved.name} is saved as inactive, so they are kept out of the main member list. Showing the Inactive list now.`);
  }

  async function removeMember(m) {
    if (!(await confirmDialog({ message: `Remove ${m.name}? This cannot be undone.` }))) return;
    await deleteChurchMember(m.id);
    setViewing(null);
    load();
  }

  const groups = useMemo(() => allGroups(data.rows.filter(m => !isInactive(m))), [data.rows]);
  const prospectCount = useMemo(() => data.rows.filter(isHiddenProspect).length, [data.rows]);
  const inactiveCount = useMemo(() => data.rows.filter(isInactive).length, [data.rows]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Prospects live off to the side — only the explicit filter shows them.
    /* Prospects sit in the directory with a badge — hiding them meant 119
       imported people were invisible with no hint why. Inactive still steps
       out of the way, and each still has its own filter. */
    let out = groupFilter === '__prospects' ? data.rows.filter(isHiddenProspect)
      : groupFilter === '__inactive'  ? data.rows.filter(isInactive)
      : data.rows.filter(m => !isInactive(m));
    if (groupFilter && !groupFilter.startsWith('__')) out = out.filter(m => inGroup(m, groupFilter));
    if (q) out = out.filter(m => [m.name, m.phone, m.email, m.tags, m.family, m.family_name]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
    return out;
  }, [data.rows, search, groupFilter]);

  useEffect(() => { setPage(0); }, [search, groupFilter]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  /* The phone gets its own directory — a grid of people rather than a table
     with a pager, which is unusable at this width. It loads its own rows, so
     none of the desktop state above applies to it. */
  if (isMobile) return <MembersMobile />;

  return (
    <div className="mbr-wrap">
      <TopNav />
      <main className="mbr-scroll">
        <div className="mbr-container">
          {viewing ? (
            <MemberProfile
              member={viewing}
              allRows={data.rows}
              onOpenMember={m => setViewing(m)}
              onChanged={load}
              onBack={() => setViewing(null)}
              onEdit={() => setEdit(viewing)}
              onNewHousehold={familyMembers(data.rows, viewing).length ? () => newHousehold(viewing) : null}
              onMakeProspect={() => makeProspect(viewing)}
              onMakeInactive={() => makeInactive(viewing)}
              onRestoreMember={() => restoreMember(viewing)}
              onDelete={() => removeMember(viewing)}
            />
          ) : (<>
            <header className="mbr-hero">
              <span className="mbr-pill">My Church</span>
              <h1 className="mbr-title">Members</h1>
              <p className="mbr-subtitle">Your congregation directory — search, view, and keep everyone's details up to date.</p>

              <div className="mbr-search-row">
                <div className="mbr-search">
                  <Icon d={P.search} size={18} className="mbr-search-icon" />
                  <input placeholder="Search members by name, phone, or email…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="mbr-groupfilter">
                  <Icon d={P.users} size={16} className="mbr-groupfilter-ic" />
                  <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} aria-label="Filter by group">
                    <option value="">All groups</option>
                    {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    {prospectCount > 0 && <option value="__prospects">Prospects ({prospectCount})</option>}
                    {inactiveCount > 0 && <option value="__inactive">Inactive ({inactiveCount})</option>}
                  </select>
                </div>
                {isAdmin && (
                  <>
                    <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
                    <button className="mbr-import" onClick={() => setGroupsOpen(true)}>
                      <Icon d={P.layers} size={16} />Manage Groups
                    </button>
                  </>
                )}
                <button className="mbr-add" onClick={() => setEdit({})}><Icon d={P.plus} size={16} />Add Member</button>
              </div>
            </header>

            {/* A half-loaded directory is what made added members "disappear" —
                never let it look complete again. */}
            {data.partial && (
              <div className="mbr-partial">
                <Icon d={P.shield} size={15} />
                Only part of the directory loaded, so some members are missing from this list.
                <button type="button" onClick={load}>Retry</button>
              </div>
            )}

            {data.missing ? (
              <div className="mbr-empty-state">
                <div className="mbr-empty-icon"><Icon d={P.person} size={28} /></div>
                <p className="mbr-empty-title">Set up the directory</p>
                <p className="mbr-empty-sub">Run supabase/members-schema.sql to enable the members directory.</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="mbr-empty-state">
                <div className="mbr-empty-icon"><Icon d={P.person} size={28} /></div>
                <p className="mbr-empty-title">{search ? 'No members match your search' : 'No members yet'}</p>
                <p className="mbr-empty-sub">{search ? 'Try a different name or number.' : 'Add your first member to get started.'}</p>
              </div>
            ) : (<>
              <div className="mbr-grid">
                {pageRows.map(m => <MemberCard key={m.id} member={m} onOpen={() => setViewing(m)} />)}
              </div>
              {rows.length > PAGE_SIZE && (
                <div className="mbr-pager">
                  <button className="mbr-pager-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0} aria-label="Previous page">
                    <Icon d={P.chevL} size={18} />
                  </button>
                  <span className="mbr-pager-info">
                    {safePage * PAGE_SIZE + 1}–{Math.min(rows.length, safePage * PAGE_SIZE + PAGE_SIZE)} of {rows.length}
                  </span>
                  <button className="mbr-pager-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} aria-label="Next page">
                    <Icon d={P.chevR} size={18} />
                  </button>
                </div>
              )}
            </>)}
          </>)}
        </div>
      </main>

      {edit && <MemberModal member={edit} onClose={() => setEdit(null)} onSaved={onMemberSaved} onDeleted={() => { setEdit(null); load(); }} />}
      {groupsOpen && (
        <ManageGroupsModal
          rows={data.rows}
          onClose={() => setGroupsOpen(false)}
          onChanged={load}
          onImport={isAdmin ? () => importRef.current?.click() : null}
        />
      )}
    </div>
  );
}

/* ── Member card (care-card style + avatar top-right) ── */
function MemberCard({ member, onOpen }) {
  const meta = [member.phone, member.email].filter(Boolean).join(' · ');
  const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  return (
    <button className="mbr-card" onClick={onOpen}>
      <div className="mbr-card-top">
        <div className="mbr-card-headtext">
          <h3 className="mbr-card-name">{member.name}</h3>
          {isHiddenProspect(member) && <span className="mbr-status prospect">Prospect</span>}
          {member.status === 'Inactive' && <span className="mbr-status">Inactive</span>}
        </div>
        <div className="mbr-avatar">
          {member.photo_url
            ? <img src={member.photo_url} alt={member.name} />
            : <span>{initials(member.name)}</span>}
        </div>
      </div>
      <p className="mbr-card-meta">{meta || 'No contact info'}</p>
      {member.family && <p className="mbr-card-family"><Icon d={P.users} size={13} />{member.family}</p>}
      {tags.length > 0 && <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>}
    </button>
  );
}

/* ── Full member profile ── */
const PROFILE_TABS = ['Info', 'Notes', 'Groups', 'Attachments'];

function MemberProfile({ member, onNewHousehold, allRows = [], onOpenMember, onChanged, onBack, onEdit, onMakeProspect, onMakeInactive, onRestoreMember, onDelete }) {
  const [tab, setTab] = useState('Info');
  const [menu, setMenu] = useState(false);
  const [addFam, setAddFam] = useState(false);
  const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const fmt = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const mapUrl = member.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(member.address)}` : null;
  const age = ageFromBirthday(member.birthday);
  const family = familyMembers(allRows, member);
  const myDeacon = deaconOf(allRows, member);
  const iShepherd = inGroup(member, DEACON_GROUP) ? assignedToDeacon(allRows, member.id) : [];
  const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : null);
  const trueFalse = v => (v === true ? 'True' : v === false ? 'False' : null);

  return (
    <div className="mp2">
      <button className="mp2-back" onClick={onBack}><Icon d={P.chevL} size={18} />Back to directory</button>

      {/* Header */}
      <div className="mp2-header">
        <div className="mp2-photo">
          {member.photo_url ? <img src={member.photo_url} alt={member.name} /> : <span>{initials(member.name)}</span>}
        </div>
        <div className="mp2-headinfo">
          <div className="mp2-nameRow">
            <Icon d={P.person} size={22} className="mp2-nameIcon" />
            <h1 className="mp2-name">{member.name}</h1>
            <span className={`mp2-statusdot ${member.status === 'Inactive' ? 'off' : 'on'}`} title={member.status} />
            <div className="mp2-menuWrap">
              <button className="mp2-menu-btn" onClick={() => setMenu(m => !m)}>⋯</button>
              {menu && (<>
                <div className="mp2-menu-backdrop" onClick={() => setMenu(false)} />
                <div className="mp2-menu">
                  <button onClick={() => { setMenu(false); onEdit(); }}><Icon d={P.edit} size={14} />Edit Member</button>
                  {/* Parked either way — one Restore brings them back. Neither
                      deletes anything, and neither touches the Guest page. */}
                  {isArchived(member)
                    ? <button onClick={() => { setMenu(false); onRestoreMember?.(); }}>
                        <Icon d={P.person} size={14} />Restore to Members
                      </button>
                    : <>
                        <button onClick={() => { setMenu(false); onMakeProspect?.(); }}>
                          <Icon d={P.location} size={14} />Mark as Prospect
                        </button>
                        <button onClick={() => { setMenu(false); onMakeInactive?.(); }}>
                          <Icon d={P.archive} size={14} />Mark as Inactive
                        </button>
                      </>}
                  {/* Only where there is a household to leave — offering it to
                      someone already on their own says nothing. */}
                  {onNewHousehold && (
                    <button onClick={() => { setMenu(false); onNewHousehold(); }}>
                      <Icon d={P.users} size={14} />Create New Household
                    </button>
                  )}
                  <button className="danger" onClick={() => { setMenu(false); onDelete(); }}><Icon d={P.trash} size={14} />Remove Member</button>
                </div>
              </>)}
            </div>
          </div>
          <p className="mp2-meta">
            {member.birthday && <>Birthday <strong>{fmt(member.birthday)}</strong> · </>}
            {member.updated_at && <>Updated <strong>{fmt(member.updated_at)}</strong> · </>}
            Added on <strong>{fmt(member.created_at) || '—'}</strong>
          </p>
          <div className="mp2-actions">
            {/* Each card carries its own pencil now. The full form stays
                reachable from the ⋯ menu, since the photo lives only there. */}
            <button className="btn-ghost sm" onClick={() => printMember(member)}><Icon d={P.print} size={14} />Print</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="mp2-tabs">
        {PROFILE_TABS.map(t => (
          <button key={t} className={`mp2-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {/* Body */}
      {tab === 'Info' && (
        <div className="mp2-grid">
          <div className="mp2-col">
            <EditableCard title="Contact Information" member={member} onSaved={onChanged}
              fields={[
                { key: 'name',    label: 'Name' },
                { key: 'address', label: 'Home Address' },
                { key: 'phone',   label: 'Phone', placeholder: '(555) 123-4567' },
                { key: 'email',   label: 'Email', placeholder: 'jane@email.com' },
              ]}>
              <Row label="Name" value={member.name} />
              <Row label="Home Address" value={member.address}
                extra={mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="mp2-link">View Map</a>} />
              <Row label="Phone" value={member.phone && <a href={`tel:${member.phone}`} className="mp2-link">{member.phone}</a>} />
              <Row label="Email" value={member.email && <a href={`mailto:${member.email}`} className="mp2-link">{member.email}</a>} last />
            </EditableCard>

            <EditableCard title="Personal Information" member={member} onSaved={onChanged}
              fields={[
                { key: 'family_position', label: 'Family Position', type: 'select', options: FAMILY_POSITIONS },
                { key: 'birthday',        label: 'Birthday', type: 'date' },
                { key: 'gender',          label: 'Gender', type: 'select', options: GENDERS },
                { key: 'marital_status',  label: 'Marital Status', type: 'select', options: MARITAL_STATUSES },
                { key: 'member_status',   label: 'Member Status', type: 'select', options: MEMBER_STATUSES },
                { key: 'record_type',     label: 'Record Type', type: 'select', options: RECORD_TYPES },
                { key: 'joined_how',      label: 'Joined How', type: 'select', options: JOINED_HOW_OPTIONS },
                { key: 'date_joined',     label: 'Date Joined', type: 'date' },
                { key: 'include_directory', label: 'Include on Directory', type: 'bool' },
                { key: 'status_code',     label: 'Status Code' },
                { key: 'active',          label: 'Active', type: 'bool' },
              ]}>
              <Row label="Family Position" value={member.family_position} />
              <Row label="Birthday" value={member.birthday && <>{fmtMDY(member.birthday)}{age != null && <span className="mp2-muted"> / {age} years old</span>}</>} />
              <Row label="Gender" value={member.gender} />
              <Row label="Marital Status" value={member.marital_status} />
              <Row label="Member Status" value={member.member_status} />
              <Row label="Record Type" value={member.record_type} />
              <Row label="Joined How" value={member.joined_how} />
              <Row label="Date Joined" value={fmtMDY(member.date_joined)} />
              <Row label="Include on Directory" value={yesNo(member.include_directory)} />
              <Row label="Status Code" value={member.status_code} />
              <Row label="Active" value={trueFalse(member.active)} last />
            </EditableCard>
          </div>

          <aside className="mp2-side">
            <div className="mp2-sidecard">
              <p className="mp2-side-title">Family</p>
              {family.length ? (
                <div className="mp2-family">
                  {family.map(fm => (
                    <button key={fm.id} type="button" className="mp2-family-item" onClick={() => onOpenMember?.(fm)}>
                      <span className="mp2-family-avatar">
                        {fm.photo_url ? <img src={fm.photo_url} alt={fm.name} /> : <span>{initials(fm.name)}</span>}
                      </span>
                      <span className="mp2-family-text">
                        <span className="mp2-family-name">{fm.name}</span>
                        {fm.family_position && <span className="mp2-family-role">{fm.family_position}</span>}
                      </span>
                      <Icon d={P.chevron} size={16} className="mp2-family-caret" />
                    </button>
                  ))}
                </div>
              ) : member.family ? (
                <p className="mp2-side-text">{member.family}</p>
              ) : (
                <p className="mp2-side-empty">No family recorded.</p>
              )}
              <button className="mp2-addfam" onClick={() => setAddFam(true)}>
                <Icon d={P.plus} size={14} />Add spouse or child
              </button>
            </div>
            <div className="mp2-sidecard">
              <p className="mp2-side-title">Groups</p>
              {tags.length ? <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>
                : <p className="mp2-side-empty">No groups assigned.</p>}
            </div>

            {(iShepherd.length > 0 || myDeacon) && (
              <div className="mp2-sidecard">
                <p className="mp2-side-title">{iShepherd.length > 0 ? 'Shepherding' : 'Your Deacon'}</p>
                {iShepherd.length > 0 ? (
                  <div className="mp2-family">
                    {groupByFamily(iShepherd).map(g => (
                      <button key={g.key} type="button" className="mp2-family-item" onClick={() => onOpenMember?.(g.head)}>
                        <span className="mp2-family-avatar">{g.head.photo_url ? <img src={g.head.photo_url} alt={g.label} /> : <span>{initials(g.label)}</span>}</span>
                        <span className="mp2-family-text">
                          <span className="mp2-family-name">{g.label}</span>
                          {g.members.length > 1 && <span className="mp2-family-role">{g.members.length} in household</span>}
                        </span>
                        <Icon d={P.chevron} size={16} className="mp2-family-caret" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="mp2-family-item" onClick={() => onOpenMember?.(myDeacon)}>
                    <span className="mp2-family-avatar">{myDeacon.photo_url ? <img src={myDeacon.photo_url} alt={myDeacon.name} /> : <span>{initials(myDeacon.name)}</span>}</span>
                    <span className="mp2-family-text"><span className="mp2-family-name">{myDeacon.name}</span><span className="mp2-family-role">Deacon</span></span>
                    <Icon d={P.chevron} size={16} className="mp2-family-caret" />
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === 'Notes' && (
        <EditableCard title="Notes" member={member} onSaved={onChanged}
          fields={[{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Anything worth remembering…' }]}>
          {member.notes ? <p className="mp2-notes">{member.notes}</p> : <p className="mp2-side-empty">No notes yet.</p>}
        </EditableCard>
      )}
      {tab === 'Groups' && (
        <EditableCard title="Groups" member={member} onSaved={onChanged}
          fields={[{ key: 'tags', label: 'Groups / Tags', placeholder: 'e.g. Choir, Small Group A' }]}>
          {tags.length ? <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>
            : <p className="mp2-side-empty">This member isn't in any groups yet.</p>}
        </EditableCard>
      )}
      {tab === 'Attachments' && (
        <div className="mp2-card"><h2 className="mp2-card-title">Attachments</h2><p className="mp2-side-empty">No attachments — file uploads coming soon.</p></div>
      )}

      {addFam && (
        <AddFamilyModal
          current={member}
          rows={allRows}
          onClose={() => setAddFam(false)}
          onAdded={() => { setAddFam(false); onChanged?.(); }}
        />
      )}
    </div>
  );
}


/*
 * A profile card you can edit in place: pencil in the corner, the same rows
 * turn into inputs, Save writes only this card's fields. Editing one detail no
 * longer means opening the whole member form and hunting for it.
 *
 * `fields` describes what to show — the same list drives the read view and the
 * edit view, so the two cannot drift apart.
 */
function EditableCard({ title, member, fields, onSaved, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function start() {
    setDraft(Object.fromEntries(fields.map(f => [f.key, member[f.key] ?? (f.type === 'bool' ? false : '')])));
    setError(''); setEditing(true);
  }

  async function save() {
    setSaving(true); setError('');
    const { error: err } = await saveChurchMember({ ...draft, id: member.id });
    setSaving(false);
    if (err) return setError(err.message);
    setEditing(false);
    onSaved?.();
  }

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <div className={`mp2-card ${editing ? 'editing' : ''}`}>
      <div className="mp2-card-head">
        <h2 className="mp2-card-title">{title}</h2>
        {!editing && (
          <button className="mp2-card-edit" onClick={start} title={`Edit ${title}`} aria-label={`Edit ${title}`}>
            <Icon d={P.edit} size={15} />
          </button>
        )}
      </div>

      {editing ? (<>
        {/* Same rows, same label column — only the value becomes a control, so
            the card does not visibly change shape when you start editing. */}
        {fields.map((f, i) => (
          <div key={f.key} className={`mp2-row ${i === fields.length - 1 ? 'last' : ''}`}>
            <span className="mp2-row-label">{f.label}</span>
            <span className="mp2-row-value">
              {f.type === 'select'
                ? <SelectWithValue value={draft[f.key]} onChange={v => set(f.key, v)} options={f.options} />
                : f.type === 'bool'
                ? <select value={draft[f.key] ? 'Yes' : 'No'} onChange={e => set(f.key, e.target.value === 'Yes')}>
                    <option>Yes</option><option>No</option>
                  </select>
                : f.type === 'textarea'
                ? <textarea rows={4} value={draft[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
                : <input type={f.type || 'text'} value={draft[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />}
            </span>
          </div>
        ))}
        {error && <p className="modal-error">{error}</p>}
        <div className="mp2-edit-foot">
          <button className="btn-ghost sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button className="btn-primary sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </>) : children}
    </div>
  );
}

/* A <select> that always includes the current value, even if it isn't one of
   the presets (CSV imports may bring values like "STATEMENT"). */
function SelectWithValue({ value, onChange, options, placeholder = 'Select…' }) {
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Row({ label, value, extra, last }) {
  return (
    <div className={`mp2-row ${last ? 'last' : ''}`}>
      <span className="mp2-row-label">{label}</span>
      <span className="mp2-row-value">
        {value || <em className="mp2-row-empty">Not set</em>}
        {extra && <div className="mp2-row-extra">{extra}</div>}
      </span>
    </div>
  );
}

function printMember(m) {
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(m.name)}</title>
    <style>body{font-family:Georgia,serif;margin:40px;color:#1a1a1a}h1{font-size:24px}.r{margin:8px 0}.l{color:#666;display:inline-block;width:130px}</style></head><body>
    <h1>${esc(m.name)}</h1>
    <div class="r"><span class="l">Phone</span> ${esc(m.phone)}</div>
    <div class="r"><span class="l">Email</span> ${esc(m.email)}</div>
    <div class="r"><span class="l">Address</span> ${esc(m.address)}</div>
    <div class="r"><span class="l">Birthday</span> ${m.birthday ? new Date(m.birthday).toLocaleDateString() : ''}</div>
    <div class="r"><span class="l">Family</span> ${esc(m.family)}</div>
    <div class="r"><span class="l">Groups</span> ${esc(m.tags)}</div>
    <div class="r"><span class="l">Notes</span> ${esc(m.notes)}</div>
  </body></html>`;
  return printHtml(html, { filename: `member-${esc(m.name).replace(/\s+/g, '-').toLowerCase()}` });
}

/* ── Add / Edit member ── */
/* Exported so the phone's directory can reuse it — it is a .modal.sheet, which
   mobileForms.css already restyles for a phone, so a second edit form would be
   two forms to keep in step for no gain. */
export function MemberModal({ member, onClose, onSaved, onDeleted }) {
  const editing = !!member.id;
  const [f, setF] = useState({
    name: member.name || '', phone: member.phone || '', email: member.email || '',
    address: member.address || '', photo_url: member.photo_url || '', birthday: member.birthday || '',
    family: member.family || '', tags: member.tags || '', status: member.status || 'Active', notes: member.notes || '',
    family_name: member.family_name || '', family_position: member.family_position || '',
    gender: member.gender || '', marital_status: member.marital_status || '',
    member_status: member.member_status || 'Member', record_type: member.record_type || 'Member',
    joined_how: member.joined_how || '', date_joined: member.date_joined || '',
    include_directory: member.include_directory ?? true, status_code: member.status_code || 'Active',
    active: member.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function onPhotoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError('');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      set('photo_url', dataUrl);
    } catch (err) {
      setError(err.message || 'Could not process that image.');
    }
    setUploading(false);
  }

  // Run a data URL through the white-background knockout and store it.
  async function applyCleaned(dataUrl) {
    setUploading(true); setError('');
    try { set('photo_url', await removeWhiteBackground(dataUrl)); }
    catch (err) { setError(err.message || 'Could not process that image.'); }
    setUploading(false);
  }

  async function onPasteClick() {
    const dataUrl = await readClipboardImage();
    if (dataUrl) return applyCleaned(dataUrl);
    setError('Copy an image, then press ⌘V (Ctrl+V) here to paste it.');
  }

  async function onRemoveWhite() {
    if (f.photo_url) applyCleaned(f.photo_url);
  }

  // Paste an image anywhere in the modal with ⌘V / Ctrl+V.
  useEffect(() => {
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => applyCleaned(reader.result);
      reader.readAsDataURL(blob);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  async function save() {
    if (!f.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const { data, error } = await saveChurchMember({ ...f, id: member.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved(data);
  }
  async function remove() {
    if (!(await confirmDialog({ message: `Remove ${f.name}? This cannot be undone.` }))) return;
    await deleteChurchMember(member.id); onDeleted();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>{editing ? 'Edit Member' : 'Add Member'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <div className="mbr-photo-row">
            <div className="mbr-avatar lg">
              {f.photo_url ? <img src={f.photo_url} alt="" /> : <span>{initials(f.name)}</span>}
            </div>
            <div className="mbr-photo-actions">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhotoFile} />
              <div className="mbr-photo-btns">
                <button type="button" className="btn-ghost sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Icon d={P.person} size={14} />{uploading ? 'Processing…' : f.photo_url ? 'Change' : 'Upload'}
                </button>
                <button type="button" className="btn-ghost sm" onClick={onPasteClick} disabled={uploading}>
                  <Icon d={P.paperclip} size={14} />Paste image
                </button>
              </div>
              {f.photo_url && (
                <div className="mbr-photo-btns">
                  <button type="button" className="btn-ghost sm" onClick={onRemoveWhite} disabled={uploading}>
                    <Icon d={P.layers} size={14} />Remove white bg
                  </button>
                  <button type="button" className="mbr-photo-remove" onClick={() => set('photo_url', '')}>Remove</button>
                </div>
              )}
              <span className="mbr-photo-hint">Upload, or copy a photo and press ⌘V. White around a circular avatar is removed automatically.</span>
            </div>
          </div>

          <label className="field-group"><span>Full Name <b>*</b></span>
            <input value={f.name} onChange={e => set('name', e.target.value)} placeholder="Jane Doe" autoFocus />
          </label>
          <div className="field-row">
            <label className="field-group"><span>Phone</span><input value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></label>
            <label className="field-group"><span>Email</span><input value={f.email} onChange={e => set('email', e.target.value)} placeholder="jane@email.com" /></label>
          </div>
          <label className="field-group"><span>Address</span><input value={f.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" /></label>
          {/* Status and Record Type together: one says whether they are current,
              the other whether they are a member or a prospect. Both drive what
              the directory shows, so they lead rather than sit in a sub-section. */}
          <div className="field-row">
            <label className="field-group"><span>Status</span>
              <select value={f.status} onChange={e => set('status', e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="field-group"><span>Record Type</span>
              <SelectWithValue value={f.record_type} onChange={v => set('record_type', v)} options={RECORD_TYPES} placeholder="Select…" />
            </label>
          </div>
          <div className="field-row">
            <label className="field-group"><span>Family / Household Name</span><input value={f.family_name} onChange={e => set('family_name', e.target.value)} placeholder="e.g. Smith Family" /></label>
            <label className="field-group"><span>Family Position</span>
              <SelectWithValue value={f.family_position} onChange={v => set('family_position', v)} options={FAMILY_POSITIONS} placeholder="Select…" />
            </label>
          </div>
          <label className="field-group"><span>Birthday</span><input type="date" value={f.birthday} onChange={e => set('birthday', e.target.value)} /></label>

          {/*
           * The rest came in with the CallMultiplier import and is almost never
           * touched: across 1,171 members, Status Code is "Active" for every
           * single one, and Gender, Marital Status and Joined How are filled in
           * for fewer than five people between them. Folded away rather than
           * deleted — the columns still hold whatever the import brought.
           */}
          <button type="button" className="mbr-more" onClick={() => setShowMore(v => !v)}>
            <Icon d={showMore ? P.arrowUp : P.arrowDown} size={14} />
            {showMore ? 'Hide extra details' : 'More details'}
          </button>

          {showMore && (<>
            <div className="field-row">
              <label className="field-group"><span>Gender</span>
                <SelectWithValue value={f.gender} onChange={v => set('gender', v)} options={GENDERS} placeholder="Select…" />
              </label>
              <label className="field-group"><span>Marital Status</span>
                <SelectWithValue value={f.marital_status} onChange={v => set('marital_status', v)} options={MARITAL_STATUSES} placeholder="Select…" />
              </label>
            </div>
            <div className="field-row">
              <label className="field-group"><span>Member Status</span>
                <SelectWithValue value={f.member_status} onChange={v => set('member_status', v)} options={MEMBER_STATUSES} placeholder="Select…" />
              </label>
              <label className="field-group"><span>Joined How</span>
                <SelectWithValue value={f.joined_how} onChange={v => set('joined_how', v)} options={JOINED_HOW_OPTIONS} placeholder="Select…" />
              </label>
            </div>
            <div className="field-row">
              <label className="field-group"><span>Date Joined</span><input type="date" value={f.date_joined || ''} onChange={e => set('date_joined', e.target.value)} /></label>
              <label className="field-group"><span>Include on Directory</span>
                <select value={f.include_directory ? 'Yes' : 'No'} onChange={e => set('include_directory', e.target.value === 'Yes')}><option>Yes</option><option>No</option></select>
              </label>
            </div>
            <label className="field-group"><span>Status Code</span><input value={f.status_code} onChange={e => set('status_code', e.target.value)} placeholder="Active" /></label>
          </>)}

          <label className="field-group"><span>Groups / Tags</span><input value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. Choir, Small Group A" /></label>
          <label className="field-group"><span>Notes</span><textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything worth remembering…" /></label>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-foot">
          {editing && <button className="btn-danger" onClick={remove}><Icon d={P.trash} size={15} />Delete</button>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Member'}</button>
        </div>
      </div>
    </div>
  );
}
