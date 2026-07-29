import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { LOG_TYPES, CATEGORY_COLORS, addLog, deleteLog, notifyCareUpdateSms } from '../../lib/care';
import { PriorityBadge } from './CaresPage';
import './Modal.css';

const LOG_ICON = {
  'Phone Call':   P.phone,
  'Text Message': P.chat,
  'Dinner/Meal':  P.meal,
  'Update/Visit': P.location,
};
const LOG_SHORT = {
  'Phone Call':   'Call',
  'Text Message': 'Text',
  'Dinner/Meal':  'Meal',
  'Update/Visit': 'Visit',
};

export default function MemberProfile({ member, startLogging, onClose, onEdit, onDelete, onChanged }) {
  const { user, profile } = useAuth();
  const [logs, setLogs]   = useState(member.contact_logs || []);
  const [adding, setAdding] = useState(!!startLogging);
  const [logType, setLogType] = useState('Update/Visit');
  const [logNote, setLogNote] = useState('');

  async function submitLog() {
    if (!logNote.trim()) return;
    const { data } = await addLog({
      member_id: member.id,
      type: logType,
      notes: logNote,
      logged_by: user?.id,
      logged_by_name: profile?.name || 'Staff',
    });
    if (data) setLogs(l => [data, ...l]);
    const note = logNote;
    setLogNote(''); setAdding(false);
    onChanged?.();
    // Best-effort: a texting failure must never make a saved log look unsaved.
    notifyCareUpdateSms({ memberName: member.full_name, note })
      .catch(e => console.warn('Cares update SMS failed:', e));
  }

  async function removeLog(id) {
    await deleteLog(id);
    setLogs(l => l.filter(x => x.id !== id));
    onChanged?.();
  }

  const sortedLogs = [...logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const catColor = CATEGORY_COLORS[member.category] || '#6B7280';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet mp-profile" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="mp-title">
            <h2>{member.full_name}</h2>
            <div className="mp-badges">
              <span className="mt-cat" style={{ '--c': catColor }}>{member.category}</span>
              <PriorityBadge p={member.priority} />
              <span className={`mp-status mp-status-${member.status?.toLowerCase()}`}>{member.status}</span>
            </div>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          {/* Contact */}
          <div className="mp-contact">
            {member.phone && <a href={`tel:${member.phone}`} className="mp-chip"><Icon d={P.phone} size={15} />{member.phone}</a>}
            {member.email && <a href={`mailto:${member.email}`} className="mp-chip"><Icon d={P.mail} size={15} />{member.email}</a>}
            {member.address && <span className="mp-chip"><Icon d={P.location} size={15} />{member.address}</span>}
          </div>

          {member.assigned_name && (
            <div className="mp-row"><span className="mp-k">Assigned to</span><span className="mp-v">{member.assigned_name}</span></div>
          )}
          {member.family_member && (
            <div className="mp-row"><span className="mp-k">Family</span><span className="mp-v">{member.family_member}</span></div>
          )}

          {member.care_notes && (
            <div className="mp-notes">
              <p className="mp-section">Care Notes</p>
              <p>{member.care_notes}</p>
            </div>
          )}

          {(member.hospital_name || member.surgery_type) && (
            <div className="mp-medical">
              <p className="mp-section">Medical</p>
              {member.hospital_name && <div className="mp-row"><span className="mp-k">Hospital</span><span className="mp-v">{member.hospital_name}{member.room_number ? ` · Rm ${member.room_number}` : ''}</span></div>}
              {member.surgery_type && <div className="mp-row"><span className="mp-k">Surgery</span><span className="mp-v">{member.surgery_type}{member.surgery_date ? ` · ${new Date(member.surgery_date).toLocaleDateString()}` : ''}</span></div>}
              {member.insurance_carrier && <div className="mp-row"><span className="mp-k">Insurance</span><span className="mp-v">{member.insurance_carrier}</span></div>}
            </div>
          )}

          {/* Contact log timeline */}
          <div className="mp-logs">
            <div className="mp-logs-head">
              <p className="mp-section">Contact Log ({sortedLogs.length})</p>
              <button className="mp-log-add" onClick={() => setAdding(a => !a)}>
                <Icon d={P.plus} size={14} />Log Contact
              </button>
            </div>

            {adding && (
              <div className="mp-log-form">
                <div className="mp-log-types">
                  {LOG_TYPES.map(t => (
                    <button key={t} className={`mp-log-type ${logType === t ? 'on' : ''}`} onClick={() => setLogType(t)} title={t}>
                      <Icon d={LOG_ICON[t]} size={15} />{LOG_SHORT[t] || t}
                    </button>
                  ))}
                </div>
                <textarea rows={2} placeholder="Add a note…" value={logNote} onChange={e => setLogNote(e.target.value)} autoFocus />
                <div className="mp-log-form-foot">
                  <button className="btn-ghost sm" onClick={() => setAdding(false)}>Cancel</button>
                  <button className="btn-primary sm" onClick={submitLog} disabled={!logNote.trim()}>Save</button>
                </div>
              </div>
            )}

            {sortedLogs.length === 0 && !adding && <p className="mp-log-empty">No contact logged yet.</p>}

            <div className="mp-timeline">
              {sortedLogs.map(log => (
                <div key={log.id} className="mp-log">
                  <div className="mp-log-icon"><Icon d={LOG_ICON[log.type] || P.location} size={14} /></div>
                  <div className="mp-log-body">
                    <div className="mp-log-top">
                      <span className="mp-log-type-label">{log.type}</span>
                      <span className="mp-log-time">{new Date(log.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    {log.notes && <p className="mp-log-note">{log.notes}</p>}
                    <div className="mp-log-foot">
                      <span>{log.logged_by_name || 'Staff'}</span>
                      <button onClick={() => removeLog(log.id)}><Icon d={P.trash} size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn-danger" onClick={() => onDelete(member)}><Icon d={P.trash} size={15} />Delete</button>
          <button className="btn-primary" onClick={() => onEdit(member)}><Icon d={P.edit} size={15} />Edit Member</button>
        </div>
      </div>
    </div>
  );
}
