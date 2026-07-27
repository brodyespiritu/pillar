import { useState, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { promptDialog } from '../../lib/dialog';
import {
  allGroups, inGroup, addToGroup, removeFromGroup,
  setDeaconForFamily, assignedToDeacon, groupByFamily, initials, DEACON_GROUP,
} from '../../lib/members';
import '../care/Modal.css';
import './Members.css';

/* Manage Groups — create groups, add/remove members, and (for Deacons)
   assign members to each deacon. Groups are stored as member tags. */
export default function ManageGroupsModal({ rows, onClose, onChanged, onImport }) {
  const groups = useMemo(() => allGroups(rows), [rows]);
  const [selected, setSelected] = useState(groups[0] || DEACON_GROUP);
  const [addQuery, setAddQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const displayGroups = useMemo(
    () => [...new Set([...groups, selected].filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups, selected],
  );
  const isDeacons = selected.toLowerCase() === DEACON_GROUP.toLowerCase();
  const groupMembers = useMemo(
    () => rows.filter(m => inGroup(m, selected)).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [rows, selected],
  );
  const candidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return [];
    return rows.filter(m => (m.name || '').toLowerCase().includes(q) && !inGroup(m, selected)).slice(0, 8);
  }, [rows, addQuery, selected]);

  async function run(fn) { setBusy(true); await fn(); setBusy(false); onChanged(); }

  async function newGroup() {
    const name = await promptDialog({ title: 'New group', message: 'Name this group (e.g. Deacons, Choir, Ushers).', placeholder: 'Group name', confirmLabel: 'Create' });
    if (name && name.trim()) { setSelected(name.trim()); setAddQuery(''); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mg-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Manage Groups</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="mg-body">
          {/* Groups list */}
          <aside className="mg-side">
            <button className="mg-new" onClick={newGroup}><Icon d={P.plus} size={14} />New group</button>
            {displayGroups.length === 0 && <p className="mg-empty">No groups yet.</p>}
            {displayGroups.map(g => (
              <button key={g} className={`mg-group ${g === selected ? 'on' : ''}`} onClick={() => { setSelected(g); setAddQuery(''); }}>
                <span className="mg-group-name">{g}</span>
                <span className="mg-group-count">{rows.filter(m => inGroup(m, g)).length}</span>
              </button>
            ))}
          </aside>

          {/* Selected group's members */}
          <div className="mg-main">
            <div className="mg-main-head">
              <h3>{selected || 'Select a group'}</h3>
              <span className="mg-main-sub">{groupMembers.length} {groupMembers.length === 1 ? 'member' : 'members'}</span>
            </div>

            <div className={`mg-content ${isDeacons && groupMembers.length > 0 ? 'split' : ''}`}>
              <div className="mg-col">
                {selected && (
                  <div className="mg-add">
                    <Icon d={P.search} size={16} className="mg-add-ic" />
                    <input value={addQuery} onChange={e => setAddQuery(e.target.value)} placeholder={`Add someone to ${selected}…`} />
                    {candidates.length > 0 && (
                      <div className="mg-add-menu">
                        {candidates.map(m => (
                          <button key={m.id} className="mg-add-item" disabled={busy} onClick={() => run(() => addToGroup(m, selected))}>
                            <span>{m.name}</span><Icon d={P.plus} size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mg-list">
                  {groupMembers.length === 0
                    ? <p className="mg-empty">No one in this group yet — search above to add people.</p>
                    : groupMembers.map(m => (
                      <div key={m.id} className="mg-row">
                        <span className="mg-avatar">{m.photo_url ? <img src={m.photo_url} alt="" /> : <span>{initials(m.name)}</span>}</span>
                        <span className="mg-row-name">{m.name}</span>
                        <button className="mg-remove" disabled={busy} onClick={() => run(() => removeFromGroup(m, selected))} title="Remove from group"><Icon d={P.close} size={15} /></button>
                      </div>
                    ))}
                </div>
              </div>

              {isDeacons && groupMembers.length > 0 && (
                <div className="mg-col mg-col-assign">
                  <DeaconAssignments rows={rows} deacons={groupMembers} busy={busy} run={run} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          {onImport && <button className="btn-ghost" onClick={onImport}><Icon d={P.arrowUp} size={14} />Import CSV</button>}
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* Assign households to each deacon (sets deacon_id for the whole family). */
function DeaconAssignments({ rows, deacons, busy, run }) {
  const [deaconId, setDeaconId] = useState(deacons[0]?.id || '');
  const [query, setQuery] = useState('');
  const deacon = deacons.find(d => d.id === deaconId);
  const assignedFamilies = useMemo(() => groupByFamily(assignedToDeacon(rows, deaconId)), [rows, deaconId]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return rows.filter(m => (m.name || '').toLowerCase().includes(q) && m.id !== deaconId && m.deacon_id !== deaconId).slice(0, 8);
  }, [rows, query, deaconId]);

  return (
    <div className="mg-assign">
      <div className="mg-assign-head">
        <h4>Deacon assignments</h4>
        <select value={deaconId} onChange={e => setDeaconId(e.target.value)}>
          {deacons.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {deacon && (
        <>
          <p className="mg-assign-sub">Households shepherded by <strong>{deacon.name}</strong> — assigning one person adds their whole family. Shows on both profiles.</p>
          <div className="mg-add">
            <Icon d={P.search} size={16} className="mg-add-ic" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Assign a household to ${deacon.name}…`} />
            {candidates.length > 0 && (
              <div className="mg-add-menu">
                {candidates.map(m => (
                  <button key={m.id} className="mg-add-item" disabled={busy} onClick={() => { setQuery(''); run(() => setDeaconForFamily(rows, m, deaconId)); }}>
                    <span>{m.name}</span><Icon d={P.plus} size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mg-list">
            {assignedFamilies.length === 0
              ? <p className="mg-empty">No households assigned to {deacon.name} yet.</p>
              : assignedFamilies.map(g => (
                <div key={g.key} className="mg-row">
                  <span className="mg-avatar">{g.head.photo_url ? <img src={g.head.photo_url} alt="" /> : <span>{initials(g.label)}</span>}</span>
                  <span className="mg-row-name">{g.label}{g.members.length > 1 && <span className="mg-row-count"> · {g.members.length}</span>}</span>
                  <button className="mg-remove" disabled={busy} onClick={() => run(() => setDeaconForFamily(rows, g.head, null))} title="Unassign household"><Icon d={P.close} size={15} /></button>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
