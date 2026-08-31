import { useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { LOG_TYPES, addLog } from '../../lib/care';
import { useAuth } from '../../context/AuthContext';
import { tapClose, tapSelect, tapSaved } from '../../lib/haptics';
import './LogContactSheet.css';

/*
 * Logging a contact, and nothing else.
 *
 * This used to open the whole member profile with the log form expanded inside
 * it — every field, the history, edit and delete — one tap after the card that
 * had just shown the same information. The person tapping "Log Contact" has
 * already decided who they spoke to and why; all that is left is what kind of
 * contact it was and what was said.
 *
 * So: the name to confirm who this is against, four choices, a note, one
 * button. Nothing here is a second route to somewhere else.
 */

/* Each kind of contact gets its own glyph — four is few enough to recognise
 * without reading, which is the point of a picker over a dropdown. */
const ICONS = {
  'Phone Call':   P.phone,
  'Text Message': P.sms,
  'Dinner/Meal':  P.meal,
  'Update/Visit': P.heart,
};

export default function LogContactSheet({ member, onClose, onSaved }) {
  const { user, profile } = useAuth();
  const [type, setType] = useState('Update/Visit');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function save() {
    if (!note.trim() || saving) return;
    setSaving(true);
    setError('');
    const { data, error: err } = await addLog({
      member_id: member.id,
      type,
      notes: note.trim(),
      logged_by: user?.id,
      logged_by_name: profile?.name || 'Staff',
    });
    setSaving(false);
    if (err) { setError(err.message || 'Could not save that.'); return; }
    tapSaved();
    onSaved?.(data);
  }

  return (
    <div className="lc-scrim" onClick={onClose}>
      <div className="lc-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Log contact">
        <button className="lc-x" onClick={() => { tapClose(); onClose(); }} aria-label="Close">
          <Icon d={P.close} size={19} />
        </button>

        <div className="lc-body">
        <h2 className="lc-title">Log contact</h2>
        {/* The one thing worth keeping from the profile: which record this
            lands on. Getting that wrong is the only expensive mistake here. */}
        <p className="lc-who">{member.full_name}</p>

        <div className="lc-types" role="radiogroup" aria-label="Kind of contact">
          {LOG_TYPES.map(t => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              className={`lc-type ${type === t ? 'on' : ''}`}
              onClick={() => { tapSelect(); setType(t); }}
            >
              <Icon d={ICONS[t] || P.check} size={20} />
              <span>{t}</span>
            </button>
          ))}
        </div>

        <label className="lc-note">
          <span>Note</span>
          <textarea
            rows={4}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What was said, and anything to follow up."
            /* eslint-disable-next-line jsx-a11y/no-autofocus */
            autoFocus
          />
        </label>

        {error && <p className="lc-error">{error}</p>}
        </div>

        <button className="lc-save" onClick={save} disabled={!note.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
