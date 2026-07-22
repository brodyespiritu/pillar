import { confirmDialog, alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { normalizeRole } from '../../lib/admin';
import {
  fetchChurchMembers, saveChurchMember, deleteChurchMember, STATUSES, initials, fileToAvatarDataUrl,
  FAMILY_POSITIONS, GENDERS, MARITAL_STATUSES, MEMBER_STATUSES, RECORD_TYPES, JOINED_HOW_OPTIONS,
  fmtMDY, ageFromBirthday, familyMembers,
  parseCsv, mapIndividualList, importMembers,
} from '../../lib/members';
import '../care/Modal.css';
import './Members.css';

export default function MembersPage() {
  const location = useLocation();
  const { profile } = useAuth();
  const isAdmin = normalizeRole(profile?.role) === 'Admin';
  const [data, setData]   = useState({ rows: [], missing: false });
  const [search, setSearch] = useState('');
  const [edit, setEdit]   = useState(location.state?.add ? {} : null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(0);
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

  async function removeMember(m) {
    if (!(await confirmDialog({ message: `Remove ${m.name}? This cannot be undone.` }))) return;
    await deleteChurchMember(m.id);
    setViewing(null);
    load();
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(m => [m.name, m.phone, m.email, m.tags, m.family, m.family_name]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }, [data.rows, search]);

  useEffect(() => { setPage(0); }, [search]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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
              onBack={() => setViewing(null)}
              onEdit={() => setEdit(viewing)}
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
                {isAdmin && (
                  <>
                    <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
                    <button className="mbr-import" onClick={() => importRef.current?.click()} disabled={importing}>
                      <Icon d={P.arrowUp} size={16} />{importing ? 'Importing…' : 'Import CSV'}
                    </button>
                  </>
                )}
                <button className="mbr-add" onClick={() => setEdit({})}><Icon d={P.plus} size={16} />Add Member</button>
              </div>
            </header>

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

      {edit && <MemberModal member={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} onDeleted={() => { setEdit(null); load(); }} />}
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

function MemberProfile({ member, allRows = [], onOpenMember, onBack, onEdit, onDelete }) {
  const [tab, setTab] = useState('Info');
  const [menu, setMenu] = useState(false);
  const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const fmt = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const mapUrl = member.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(member.address)}` : null;
  const age = ageFromBirthday(member.birthday);
  const family = familyMembers(allRows, member);
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
            <button className="btn-primary sm" onClick={onEdit}><Icon d={P.edit} size={14} />Edit</button>
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
            <div className="mp2-card">
              <h2 className="mp2-card-title">Contact Information</h2>
              <Row label="Name" value={member.name} />
              <Row label="Home Address" value={member.address}
                extra={mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="mp2-link">View Map</a>} />
              <Row label="Phone" value={member.phone && <a href={`tel:${member.phone}`} className="mp2-link">{member.phone}</a>} />
              <Row label="Email" value={member.email && <a href={`mailto:${member.email}`} className="mp2-link">{member.email}</a>} last />
            </div>

            <div className="mp2-card">
              <h2 className="mp2-card-title">Personal Information</h2>
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
            </div>
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
            </div>
            <div className="mp2-sidecard">
              <p className="mp2-side-title">Groups</p>
              {tags.length ? <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>
                : <p className="mp2-side-empty">No groups assigned.</p>}
            </div>
          </aside>
        </div>
      )}

      {tab === 'Notes' && (
        <div className="mp2-card">
          <h2 className="mp2-card-title">Notes</h2>
          {member.notes ? <p className="mp2-notes">{member.notes}</p> : <p className="mp2-side-empty">No notes yet.</p>}
        </div>
      )}
      {tab === 'Groups' && (
        <div className="mp2-card">
          <h2 className="mp2-card-title">Groups</h2>
          {tags.length ? <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>
            : <p className="mp2-side-empty">This member isn't in any groups yet.</p>}
        </div>
      )}
      {tab === 'Attachments' && (
        <div className="mp2-card"><h2 className="mp2-card-title">Attachments</h2><p className="mp2-side-empty">No attachments — file uploads coming soon.</p></div>
      )}
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
  const w = window.open('', '_blank');
  if (!w) return alertDialog('Please allow pop-ups to print.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(m.name)}</title>
    <style>body{font-family:Georgia,serif;margin:40px;color:#1a1a1a}h1{font-size:24px}.r{margin:8px 0}.l{color:#666;display:inline-block;width:130px}</style></head><body>
    <h1>${esc(m.name)}</h1>
    <div class="r"><span class="l">Phone</span> ${esc(m.phone)}</div>
    <div class="r"><span class="l">Email</span> ${esc(m.email)}</div>
    <div class="r"><span class="l">Address</span> ${esc(m.address)}</div>
    <div class="r"><span class="l">Birthday</span> ${m.birthday ? new Date(m.birthday).toLocaleDateString() : ''}</div>
    <div class="r"><span class="l">Family</span> ${esc(m.family)}</div>
    <div class="r"><span class="l">Groups</span> ${esc(m.tags)}</div>
    <div class="r"><span class="l">Notes</span> ${esc(m.notes)}</div>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ── Add / Edit member ── */
function MemberModal({ member, onClose, onSaved, onDeleted }) {
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

  async function save() {
    if (!f.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const { error } = await saveChurchMember({ ...f, id: member.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved();
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
              <button type="button" className="btn-ghost sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Icon d={P.person} size={14} />{uploading ? 'Processing…' : f.photo_url ? 'Change photo' : 'Upload photo'}
              </button>
              {f.photo_url && <button type="button" className="mbr-photo-remove" onClick={() => set('photo_url', '')}>Remove</button>}
              <span className="mbr-photo-hint">JPG or PNG from your computer</span>
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
          <div className="field-row">
            <label className="field-group"><span>Birthday</span><input type="date" value={f.birthday} onChange={e => set('birthday', e.target.value)} /></label>
            <label className="field-group"><span>Status</span>
              <select value={f.status} onChange={e => set('status', e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
            </label>
          </div>
          <div className="field-row">
            <label className="field-group"><span>Family / Household Name</span><input value={f.family_name} onChange={e => set('family_name', e.target.value)} placeholder="e.g. Smith Family" /></label>
            <label className="field-group"><span>Family Position</span>
              <SelectWithValue value={f.family_position} onChange={v => set('family_position', v)} options={FAMILY_POSITIONS} placeholder="Select…" />
            </label>
          </div>

          <div className="mbr-section-label">Personal Information</div>
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
            <label className="field-group"><span>Record Type</span>
              <SelectWithValue value={f.record_type} onChange={v => set('record_type', v)} options={RECORD_TYPES} placeholder="Select…" />
            </label>
          </div>
          <div className="field-row">
            <label className="field-group"><span>Joined How</span>
              <SelectWithValue value={f.joined_how} onChange={v => set('joined_how', v)} options={JOINED_HOW_OPTIONS} placeholder="Select…" />
            </label>
            <label className="field-group"><span>Date Joined</span><input type="date" value={f.date_joined || ''} onChange={e => set('date_joined', e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label className="field-group"><span>Include on Directory</span>
              <select value={f.include_directory ? 'Yes' : 'No'} onChange={e => set('include_directory', e.target.value === 'Yes')}><option>Yes</option><option>No</option></select>
            </label>
            <label className="field-group"><span>Status Code</span><input value={f.status_code} onChange={e => set('status_code', e.target.value)} placeholder="Active" /></label>
          </div>
          <label className="field-group"><span>Active</span>
            <select value={f.active ? 'True' : 'False'} onChange={e => set('active', e.target.value === 'True')}><option>True</option><option>False</option></select>
          </label>

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
