import { useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { LOG_TYPES, CATEGORIES, addLog, saveMember } from '../../lib/care';
import { useAuth } from '../../context/AuthContext';
import { tapClose, tapSelect, tapSaved, tapFailed } from '../../lib/haptics';
import PillMenu from '../sms/PillMenu';
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

/* Short forms, because a pill has room for a word and not a phrase. */
const SHORT = {
  'Phone Call':   'Call',
  'Text Message': 'Text',
  'Dinner/Meal':  'Meal',
  'Update/Visit': 'Visit',
};

export default function LogContactSheet({ member, onClose, onSaved }) {
  const { user, profile } = useAuth();
  const [type, setType] = useState('Update/Visit');
  /*
   * Chosen for this update, not seeded from the record — the same rule the
   * desktop card follows. Starting it at the member's current category made the
   * commonest mistake, writing "she's home now" and leaving the tag on
   * Hospitalized, take no action at all to make.
   */
  const [catChoice, setCatChoice] = useState('');
  const [catShake, setCatShake] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* A missing category is a prompt, a failed write is a fault — they should not
     look the same. */
  const [errWarn, setErrWarn] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function save() {
    if (!note.trim() || saving) return;
    if (!catChoice) {
      setError('Choose a category before saving this update.');
      setErrWarn(true);
      setCatShake(true);
      tapFailed();
      setTimeout(() => setCatShake(false), 500);
      return;
    }
    setSaving(true);
    setError(''); setErrWarn(false);
    /* No member passed: the person has just said what the category is, and an
       explicit choice must beat anything read out of the wording. */
    const { data, error: err } = await addLog({
      member_id: member.id,
      type,
      notes: note.trim(),
      logged_by: user?.id,
      logged_by_name: profile?.name || 'Staff',
    });
    if (!err && catChoice !== member.category) {
      await saveMember({ ...member, category: catChoice }, member);
    }
    setSaving(false);
    if (err) { setError(err.message || 'Could not save that.'); setErrWarn(false); return; }
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

        {/* Two pills, the same pair as the desktop card: what kind of contact
            it was, and where the person stands now. Four glyph buttons across
            the sheet took a whole row to say one word. */}
        <div className="lc-pills">
          <PillMenu
            ariaLabel="Kind of contact"
            value={type}
            onChange={t => { tapSelect(); setType(t); }}
            options={LOG_TYPES.map(t => ({ key: t, label: SHORT[t] || t }))}
          />
          <PillMenu
            ariaLabel="Category"
            value={catChoice}
            onChange={c => { tapSelect(); setCatChoice(c); setError(''); setErrWarn(false); }}
            placeholder="Category"
            className={`${catChoice ? '' : 'unset'} ${catShake ? 'shake' : ''}`}
            options={CATEGORIES.map(c => ({ key: c, label: c }))}
          />
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

        {error && <p className={`lc-error ${errWarn ? 'warn' : ''}`}>{error}</p>}
        </div>

        <button className="lc-save" onClick={save} disabled={!note.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
