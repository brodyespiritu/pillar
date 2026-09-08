import { useState, useEffect, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  fetchChurchMembers, initials, isArchived,
  markMemberAsProspect, markMemberInactive, deleteChurchMember,
} from '../../lib/members';
import { confirmDialog } from '../../lib/dialog';
import { MemberModal } from './MembersPage';
import { tapOpen, tapClose, tapSaved } from '../../lib/haptics';
import './MembersMobile.css';

/*
 * The directory on a phone.
 *
 * Built to the same shape as the care list — a squircle per person, three to a
 * row, tapped to open a sheet — because they are the same act: find a person,
 * see who they are, reach them. Two different layouts for that would be two
 * things to learn.
 *
 * Where it differs: care tiles are tinted by category, because which situation
 * somebody is in is the thing you are scanning for. A directory has no such
 * ranking, so every tile carries one blue — the same blue as the Cares card on
 * the home screen — and the name does the distinguishing.
 */

const sortName = (a, b) =>
  String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });

export default function MembersMobile() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [editing, setEditing] = useState(null);

  async function load() {
    const d = await fetchChurchMembers();
    setRows(d.rows || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  /* Archived covers both inactive people and records demoted to prospects —
     neither belongs in a directory you are using to reach somebody today. */
  const list = useMemo(() => {
    let l = rows.filter(m => !isArchived(m));
    const s = q.trim().toLowerCase();
    if (s) {
      l = l.filter(m => [m.name, m.phone, m.email, m.family, m.tags]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(s)));
    }
    return [...l].sort(sortName);
  }, [rows, q]);

  const close = () => { tapClose(); setPicked(null); };

  return (
    <div className="mm-wrap">
      <main className="mm-scroll">

        <header className="mm-head">
          <h1 className="mm-title">Members</h1>
          <span className="mm-count">{list.length}</span>
        </header>

        <div className="mm-search">
          <Icon d={P.search} size={19} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setQ('')}
            placeholder="Search by name, phone, or family"
            aria-label="Search the directory"
          />
          {q && (
            <button type="button" className="mm-search-x" onClick={() => setQ('')} aria-label="Clear search">
              <Icon d={P.close} size={17} />
            </button>
          )}
        </div>

        {loading && <p className="mm-empty">Loading…</p>}

        {!loading && list.length === 0 && (
          <p className="mm-empty">
            {q.trim() ? `Nobody matches “${q.trim()}”.` : 'No members yet.'}
          </p>
        )}

        <div className="mm-grid">
          {list.map(m => (
            <button key={m.id} className="mm-tile" onClick={() => { tapOpen(); setPicked(m); }}>
              <span className="mm-sq">
                {m.photo_url
                  ? <img src={m.photo_url} alt="" className="mm-photo" />
                  : <span className="mm-ini">{initials(m.name)}</span>}
              </span>
              <span className="mm-name">{m.name}</span>
            </button>
          ))}
        </div>
      </main>

      {picked && (
        <MemberSheet
          member={picked}
          onClose={close}
          onEdit={() => { setEditing(picked); setPicked(null); }}
          onChanged={() => { setPicked(null); load(); }}
        />
      )}

      {editing && (
        <MemberModal
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDeleted={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* One person, from the bottom. The same sheet material as everywhere else. */
function MemberSheet({ member: m, onClose, onEdit, onChanged }) {
  const [busy, setBusy] = useState('');
  const groups = String(m.tags || '').split(',').map(s => s.trim()).filter(Boolean);

  /*
   * Every one of these changes or removes a record, so every one asks first.
   * `danger` is reserved for the delete: marking somebody a prospect or
   * inactive is reversible from the desktop list, and dressing all three in red
   * would make the one that is not reversible look like the others.
   */
  async function act(kind) {
    const spec = {
      prospect: {
        message: `Move ${m.name} to prospects? They will come off the member directory.`,
        run: () => markMemberAsProspect(m.id),
      },
      inactive: {
        message: `Mark ${m.name} inactive? They stay on record but leave the directory.`,
        run: () => markMemberInactive(m.id),
      },
      remove: {
        message: `Remove ${m.name} permanently? This cannot be undone.`,
        danger: true,
        run: () => deleteChurchMember(m.id),
      },
    }[kind];
    if (!spec || busy) return;
    if (!(await confirmDialog({ message: spec.message, danger: spec.danger }))) return;
    setBusy(kind);
    await spec.run();
    setBusy('');
    tapSaved();
    onChanged?.();
  }

  return (
    <div className="mm-scrim" onClick={onClose}>
      <div className="mm-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={m.name}>
        <button className="mm-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={19} /></button>

        <span className="mm-sq lg">
          {m.photo_url
            ? <img src={m.photo_url} alt="" className="mm-photo" />
            : <span className="mm-ini">{initials(m.name)}</span>}
        </span>
        <h2 className="mm-sheet-name">{m.name}</h2>

        {groups.length > 0 && (
          <div className="mm-tags">
            {groups.map(g => <span key={g} className="mm-tag">{g}</span>)}
          </div>
        )}

        {/* Reaching them is the point of opening this, so it comes first. */}
        {(m.phone || m.email) && (
          <div className="mm-actions">
            {m.phone && <a className="mm-act" href={`tel:${m.phone}`}><Icon d={P.phone} size={19} />Call</a>}
            {m.phone && <a className="mm-act" href={`sms:${m.phone}`}><Icon d={P.chat} size={19} />Text</a>}
            {m.email && <a className="mm-act" href={`mailto:${m.email}`}><Icon d={P.mail} size={19} />Email</a>}
          </div>
        )}

        <div className="mm-facts">
          {m.phone   && <p className="mm-fact"><span>Phone</span>{m.phone}</p>}
          {m.email   && <p className="mm-fact"><span>Email</span>{m.email}</p>}
          {m.address && <p className="mm-fact"><span>Address</span>{m.address}</p>}
          {m.family  && <p className="mm-fact"><span>Family</span>{m.family}</p>}
        </div>

        {m.notes && <p className="mm-notes">{m.notes}</p>}

        {/* Managing the record, under its own rule — separate from reading it. */}
        <div className="mm-manage">
          <button className="mm-manage-row" onClick={onEdit}>
            <Icon d={P.edit} size={18} />Edit member
          </button>
          <button className="mm-manage-row" onClick={() => act('prospect')} disabled={!!busy}>
            <Icon d={P.person} size={18} />{busy === 'prospect' ? 'Moving…' : 'Mark as prospect'}
          </button>
          <button className="mm-manage-row" onClick={() => act('inactive')} disabled={!!busy}>
            <Icon d={P.archive} size={18} />{busy === 'inactive' ? 'Marking…' : 'Mark as inactive'}
          </button>
          <button className="mm-manage-row danger" onClick={() => act('remove')} disabled={!!busy}>
            <Icon d={P.trash} size={18} />{busy === 'remove' ? 'Removing…' : 'Remove member'}
          </button>
        </div>
      </div>
    </div>
  );
}
