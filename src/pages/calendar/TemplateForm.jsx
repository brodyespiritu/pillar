import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { CATEGORIES } from '../../lib/calendar';
import '../care/Modal.css';

const DURATIONS = [30, 45, 60, 90, 120, 180, 240];

/* Create or edit a drag-and-drop template. */
export default function TemplateForm({ template, onClose, onSave }) {
  const editing = !!template;
  const [title, setTitle]     = useState(template?.title || '');
  const [category, setCategory] = useState(template?.category || 'Other');
  const [allDay, setAllDay]   = useState(editing ? !template.start_time : false);
  const [start, setStart]     = useState(template?.start_time || '18:30');
  const [minutes, setMinutes] = useState(template?.minutes || 90);
  const [location, setLocation] = useState(template?.location || '');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  async function save() {
    if (!title.trim()) return setErr('Give the template a name.');
    setSaving(true);
    setErr('');
    const { error } = await onSave({
      title: title.trim(),
      category,
      start_time: allDay ? null : start,
      minutes: allDay ? null : Number(minutes),
      location: location.trim(),
    });
    setSaving(false);
    if (error) return setErr(error.message || 'Could not save the template.');
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? 'Edit Template' : 'New Template'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <label className="field-group"><span>Name</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Pickleball" autoFocus />
          </label>
          <label className="field-group"><span>Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
          </label>

          <label className="modal-check">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
            All day
          </label>

          {!allDay && (
            <div className="field-row">
              <label className="field-group"><span>Starts</span>
                <input type="time" value={start} onChange={e => setStart(e.target.value)} />
              </label>
              <label className="field-group"><span>Lasts</span>
                <select value={minutes} onChange={e => setMinutes(e.target.value)}>
                  {DURATIONS.map(m => (
                    <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="field-group"><span>Location <em>(optional)</em></span>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Fellowship Hall" />
          </label>

          {err && <span className="field-err">{err}</span>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
