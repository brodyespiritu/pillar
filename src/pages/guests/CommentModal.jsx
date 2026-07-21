import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { addGreeterComment } from '../../lib/recap';
import '../care/Modal.css';
import './Guests.css';

/*
 * Greeter observation → stored in `greeter_comments` and shown under
 * "Pathway to Belonging" in the Weekly Recap (printable + emailed).
 */
export default function CommentModal({ onClose, onSaved }) {
  const { profile } = useAuth();
  const [name, setName]       = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  async function save() {
    if (!comment.trim()) { setError('Please write a comment.'); return; }
    setSaving(true); setError('');
    const { error } = await addGreeterComment({
      person_name: name, comment, submitted_by: profile?.name || null,
    });
    setSaving(false);
    if (error) { setError(error.message || 'Could not save the comment.'); return; }
    onSaved?.();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <h2>Greeter Comment</h2>
            <p className="tp-sub">Shared under “Pathway to Belonging” in the recap.</p>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="gf-field">
            <label className="gf-label">Who is this about? <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. The Johnson family" />
          </div>
          <div className="gf-field" style={{ marginTop: 14 }}>
            <label className="gf-label">Comment</label>
            <textarea rows={4} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="What did you notice? A need, a milestone, a follow-up…" />
          </div>
          {error && <p className="gf-error" style={{ color: 'var(--red)', marginTop: 10, fontSize: 13 }}>{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
