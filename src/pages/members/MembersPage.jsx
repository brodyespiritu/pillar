import { confirmDialog, alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  fetchChurchMembers, saveChurchMember, deleteChurchMember, STATUSES, initials, fileToAvatarDataUrl,
} from '../../lib/members';
import '../care/Modal.css';
import './Members.css';

export default function MembersPage() {
  const location = useLocation();
  const [data, setData]   = useState({ rows: [], missing: false });
  const [search, setSearch] = useState('');
  const [edit, setEdit]   = useState(location.state?.add ? {} : null);
  const [viewing, setViewing] = useState(null);

  async function load() {
    const d = await fetchChurchMembers();
    setData(d);
    // keep an open profile in sync after edits/deletes
    setViewing(v => v ? (d.rows.find(x => x.id === v.id) || null) : v);
  }
  useEffect(() => { load(); }, []);

  async function removeMember(m) {
    if (!(await confirmDialog({ message: `Remove ${m.name}? This cannot be undone.` }))) return;
    await deleteChurchMember(m.id);
    setViewing(null);
    load();
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(m => [m.name, m.phone, m.email, m.tags, m.family]
      .filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }, [data.rows, search]);

  return (
    <div className="mbr-wrap">
      <TopNav />
      <main className="mbr-scroll">
        <div className="mbr-container">
          {viewing ? (
            <MemberProfile member={viewing} onBack={() => setViewing(null)} onEdit={() => setEdit(viewing)} onDelete={() => removeMember(viewing)} />
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
            ) : (
              <div className="mbr-grid">
                {rows.map(m => <MemberCard key={m.id} member={m} onOpen={() => setViewing(m)} />)}
              </div>
            )}
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

function MemberProfile({ member, onBack, onEdit, onDelete }) {
  const [tab, setTab] = useState('Info');
  const [menu, setMenu] = useState(false);
  const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const fmt = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const mapUrl = member.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(member.address)}` : null;

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
          <div className="mp2-card">
            <h2 className="mp2-card-title">Contact Information</h2>
            <Row label="Name" value={member.name} />
            <Row label="Home Address" value={member.address}
              extra={mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="mp2-link">View Map</a>} />
            <Row label="Phone" value={member.phone && <a href={`tel:${member.phone}`} className="mp2-link">{member.phone}</a>} />
            <Row label="Email" value={member.email && <a href={`mailto:${member.email}`} className="mp2-link">{member.email}</a>} />
            <Row label="Birthday" value={fmt(member.birthday)} />
            <Row label="Status" value={<span className={`mp2-statusbadge ${member.status === 'Inactive' ? 'off' : 'on'}`}>{member.status || 'Active'}</span>} last />
          </div>

          <aside className="mp2-side">
            <div className="mp2-sidecard">
              <p className="mp2-side-title">Groups</p>
              {tags.length ? <div className="mbr-card-tags">{tags.map(t => <span key={t} className="mbr-tag">{t}</span>)}</div>
                : <p className="mp2-side-empty">No groups assigned.</p>}
            </div>
            <div className="mp2-sidecard">
              <p className="mp2-side-title">Family</p>
              {member.family ? <p className="mp2-side-text">{member.family}</p> : <p className="mp2-side-empty">No family recorded.</p>}
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
          <label className="field-group"><span>Family</span><input value={f.family} onChange={e => set('family', e.target.value)} placeholder="Spouse & children" /></label>
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
