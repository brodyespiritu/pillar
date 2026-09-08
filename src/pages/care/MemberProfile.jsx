import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { LOG_TYPES, CATEGORIES, addLog, deleteLog, saveMember } from '../../lib/care';
import { flashSaved } from '../../lib/flash';
import PillMenu from '../sms/PillMenu';
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
  const [logType, setLogType] = useState('Update/Visit');
  const [logNote, setLogNote] = useState('');
  /*
   * Chosen for THIS update, not seeded from the record.
   *
   * Starting it at the member's current category meant the commonest mistake —
   * writing "she's home now" and leaving the tag on Hospitalized — took no
   * action at all to make. Empty forces the choice to be deliberate.
   */
  const [catChoice, setCatChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [catShake, setCatShake] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  async function submitLog() {
    if (!logNote.trim() || saving) return;
    /* The category is part of the update, so an update cannot be filed without
       one. Saying so where the choice is, rather than in a banner elsewhere. */
    if (!catChoice) {
      setSaveErr('Choose a category before saving this update.');
      setCatShake(true);
      setTimeout(() => setCatShake(false), 500);
      return;
    }
    setSaving(true); setSaveErr('');
    /* No member passed: the person has just said what the category is, and an
       explicit choice must beat anything read out of the wording. */
    const { data } = await addLog({
      member_id: member.id,
      type: logType,
      notes: logNote,
      logged_by: user?.id,
      logged_by_name: profile?.name || 'Staff',
    });
    if (catChoice !== member.category) {
      await saveMember({ ...member, category: catChoice }, member);
    }
    setSaving(false);
    if (data) setLogs(l => [data, ...l]);
    flashSaved();
    setLogNote(''); setCatChoice('');
    onChanged?.();
  }

  async function removeLog(id) {
    await deleteLog(id);
    setLogs(l => l.filter(x => x.id !== id));
    onChanged?.();
  }

  const sortedLogs = [...logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet mp-profile" onClick={e => e.stopPropagation()}>
        {/*
          * A banner, not a title bar: the name is the biggest thing on the
          * card and the original report sits under it, because those two are
          * what a reader needs before anything else.
          */}
        <header className="mp-hero">
          <h2>{member.full_name}</h2>
          {member.care_notes && <p className="mp-hero-report">{member.care_notes}</p>}
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
        </header>

        <div className="modal-body">
          <textarea className="mp-compose-body" rows={3} value={logNote} autoFocus={!!startLogging}
            onChange={e => setLogNote(e.target.value)}
            placeholder="Type the update here" />

          {/* The two things an update carries, centred between writing it and
              reading what came before. */}
          <div className="mp-pills">
            <PillMenu
              ariaLabel="Kind of contact"
              value={logType}
              onChange={setLogType}
              options={LOG_TYPES.map(t => ({ key: t, label: LOG_SHORT[t] || t }))}
            />
            <PillMenu
              ariaLabel="Category"
              value={catChoice}
              onChange={c => { setCatChoice(c); setSaveErr(''); }}
              placeholder="Category"
              className={`${catChoice ? '' : 'unset'} ${catShake ? 'shake' : ''}`}
              menuClass="mp-pill-menu"
              options={CATEGORIES.map(c => ({ key: c, label: c }))}
            />
          </div>
          {saveErr && <p className="mp-save-err">{saveErr}</p>}

          <ol className="mp-tl">
            {sortedLogs.length === 0 && <p className="mp-log-empty">No contact logged yet.</p>}
            {sortedLogs.map((log, i) => (
              <li key={log.id} className={`mp-tl-row ${i === 0 ? 'now' : ''}`}>
                <span className="mp-tl-mark" aria-hidden="true" />
                <span className="mp-tl-body">
                  <span className="mp-tl-head">
                    <span className="mp-tl-date">
                      {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="mp-tl-kind">{LOG_SHORT[log.type] || log.type} · {log.logged_by_name || 'Staff'}</span>
                    <button className="mp-log-del" onClick={() => removeLog(log.id)} aria-label="Delete this update">
                      <Icon d={P.trash} size={12} />
                    </button>
                  </span>
                  {log.notes && <span className="mp-tl-note">{log.notes}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="modal-foot">
          {/* Kept, quietly: the rest of the record — phone, hospital, who it is
              assigned to — is still only editable through the full form. */}
          <button className="mp-edit-link" onClick={() => onEdit(member)}>Edit details</button>
          <span className="mp-foot-gap" />
          <button className="mp-btn danger icon" onClick={() => onDelete(member)}
            aria-label="Delete member" title="Delete member">
            <Icon d={P.trash} size={18} />
          </button>
          <button className="mp-btn save" onClick={submitLog} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
