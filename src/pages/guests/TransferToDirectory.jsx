import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { fetchChurchMembers } from '../../lib/members';
import {
  DIRECTORY_INDEX_COLUMNS, peopleOnGuest, findExisting, transferToDirectory,
} from '../../lib/directoryTransfer';
import '../care/Modal.css';
import './Guests.css';

/*
 * Transfer to directory: Member or Prospect.
 *
 * The question is the two cards at the bottom, and picking one does it. Above
 * them is who it applies to. A guest entry is often a whole household, and each
 * person becomes their own directory entry, so each can be left out or have
 * their name put right first (the entry only ever stored "Mary", and she may
 * not be a Smith). Anyone already in the directory says so, since picking
 * updates that entry rather than adding a second one.
 */

const CHOICES = [
  { type: 'Member',   icon: P.person,   color: 'var(--accent)', desc: 'Part of the church.' },
  { type: 'Prospect', icon: P.location, color: '#0F766E',       desc: 'Still being followed up.' },
];

const aOrAn = w => (/^[aeiou]/i.test(w) ? `an ${w.toLowerCase()}` : `a ${w.toLowerCase()}`);

export default function TransferToDirectory({ guest, onClose, onDone }) {
  const [people, setPeople] = useState(() => peopleOnGuest(guest).map(p => ({ ...p, on: true })));
  const [index, setIndex] = useState(null);          // the directory, once it has loaded
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  /* Nothing can be added until the directory is in hand: without it there is
     no telling who is already there, and guessing is how duplicates start. */
  useEffect(() => {
    let live = true;
    fetchChurchMembers(DIRECTORY_INDEX_COLUMNS).then(d => {
      if (!live) return;
      if (d.missing || d.partial) setLoadError('The directory did not load, so there is no way to check who is already in it. Close this and try again.');
      else setIndex(d.rows);
    });
    return () => { live = false; };
  }, []);

  const existing = useMemo(() => (index ? findExisting(people, guest, index) : {}), [people, guest, index]);
  const chosen = people.filter(p => p.on);
  const household = people.length > 1;
  const set = (key, patch) => { setError(''); setPeople(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p))); };

  async function run(type) {
    if (busy || !index) return;
    if (!chosen.length) { setError('Tick at least one person to add.'); return; }
    if (chosen.some(p => !p.name.trim())) { setError('Everyone being added needs a name.'); return; }
    setBusy(type);
    setError('');
    const res = await transferToDirectory({ guest, people: chosen, recordType: type, existing });
    setBusy('');
    if (res.error) {
      const done = res.added + res.updated;
      setError(`Could not finish${done ? ` (${done} ${done === 1 ? 'person was' : 'people were'} already saved)` : ''}: ${res.error.message}`);
      return;
    }
    onDone({ ...res, type, count: chosen.length });
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal sheet td" onClick={e => e.stopPropagation()} role="dialog" aria-label="Transfer to directory">
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <h2>Transfer to directory</h2>
            <p className="tp-sub">
              {household
                ? 'Each person gets their own entry, together as one household.'
                : 'They get their own entry in the church directory.'}
            </p>
          </div>
          <button className="modal-x" onClick={onClose} disabled={!!busy} aria-label="Close"><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          <section className="td-section">
            <p className="td-label">{household ? 'Who to add' : 'Name in the directory'}</p>
            <div className="td-people">
              {people.map(p => {
                const found = existing[p.key];
                return (
                  <div key={p.key} className={`td-person ${p.on ? '' : 'off'} ${household ? 'with-check' : ''}`}>
                    {household && (
                      <input type="checkbox" checked={p.on} disabled={!!busy}
                        onChange={e => set(p.key, { on: e.target.checked })}
                        aria-label={`Add ${p.name || 'this person'}`} />
                    )}
                    <div className="td-person-main">
                      <input className="td-name" value={p.name} disabled={!p.on || !!busy}
                        onChange={e => set(p.key, { name: e.target.value })}
                        aria-label={`Name${p.relation ? ` (${p.relation.toLowerCase()})` : ''}`} />
                      {household && (
                        <span className="td-rel">
                          {[p.key === 'head' ? 'Head of household' : p.relation, p.age && `age ${p.age}`].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    {found && p.on && (
                      <p className="td-found">
                        <Icon d={P.check} size={14} />
                        Already in the directory{found.record_type ? ` as ${aOrAn(found.record_type)}` : ''}. This updates that entry instead of adding another.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="td-section">
            <p className="td-label">
              Add {!household || !chosen.length ? 'them' : chosen.length === 1 ? 'this person' : `these ${chosen.length} people`} as
            </p>
            <div className="tp-grid">
              {CHOICES.map(c => (
                <button key={c.type} className="tp-card" style={{ '--tc': c.color }}
                  onClick={() => run(c.type)} disabled={!index || !!busy || !chosen.length}>
                  <div className="tp-icon"><Icon d={c.icon} size={22} /></div>
                  <div className="tp-text">
                    <span className="tp-name">{busy === c.type ? 'Adding…' : c.type}</span>
                    <span className="tp-desc">{c.desc}</span>
                  </div>
                </button>
              ))}
            </div>
            {!index && !loadError && <p className="td-note">Checking who is already in the directory…</p>}
            {(loadError || error) && <p className="td-error">{loadError || error}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
