import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { CATEGORIES, PRIORITIES, saveMember } from '../../lib/care';
import './Modal.css';

const blankEntry = () => ({ full_name: '', category: 'Other', priority: 'Medium', care_notes: '' });

export default function BulkAddModal({ onClose, onSaved }) {
  const [entries, setEntries] = useState([blankEntry()]);
  const [saving, setSaving]   = useState(false);

  const update = (i, k, v) => setEntries(es => es.map((e, idx) => idx === i ? { ...e, [k]: v } : e));
  const add    = () => setEntries(es => [...es, blankEntry()]);
  const remove = i => setEntries(es => es.filter((_, idx) => idx !== i));

  async function submit() {
    const valid = entries.filter(e => e.full_name.trim());
    if (!valid.length) return;
    setSaving(true);
    for (const e of valid) await saveMember(e);
    setSaving(false);
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>Bulk Add Members</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          {entries.map((e, i) => (
            <div key={i} className="bulk-entry">
              <div className="bulk-entry-head">
                <span>Member {i + 1}</span>
                {entries.length > 1 && <button onClick={() => remove(i)}><Icon d={P.trash} size={14} /></button>}
              </div>
              <input className="bulk-name" placeholder="Full name" value={e.full_name} onChange={ev => update(i, 'full_name', ev.target.value)} />
              <div className="field-row">
                <select value={e.category} onChange={ev => update(i, 'category', ev.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <select value={e.priority} onChange={ev => update(i, 'priority', ev.target.value)}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <input placeholder="Notes" value={e.care_notes} onChange={ev => update(i, 'care_notes', ev.target.value)} />
            </div>
          ))}
          <button className="bulk-add-another" onClick={add}><Icon d={P.plus} size={15} />Add another</button>
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : `Add ${entries.filter(e => e.full_name.trim()).length || ''} Members`}
          </button>
        </div>
      </div>
    </div>
  );
}
