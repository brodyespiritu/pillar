import { useState, useEffect, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { supabase } from '../../lib/supabase';
import { fetchMembers } from '../../lib/care';
import './Admin.css';

/* Fields compared side-by-side in step 3 */
const FIELDS = [
  { key: 'full_name',     label: 'Name' },
  { key: 'phone',         label: 'Phone' },
  { key: 'email',         label: 'Email' },
  { key: 'address',       label: 'Address' },
  { key: 'family_member', label: 'Family Member' },
  { key: 'category',      label: 'Category' },
  { key: 'priority',      label: 'Priority' },
  { key: 'status',        label: 'Status' },
  { key: 'assigned_name', label: 'Assigned To' },
  { key: 'hospital_name', label: 'Hospital' },
  { key: 'room_number',   label: 'Room #' },
  { key: 'surgery_type',  label: 'Surgery Type' },
  { key: 'surgery_date',  label: 'Surgery Date' },
  { key: 'surgeon_name',  label: 'Surgeon' },
  { key: 'care_notes',    label: 'Care Notes', combinable: true },
];

export default function MergeTool({ testMode }) {
  const [members, setMembers] = useState([]);
  const [step, setStep] = useState(1);
  const [recA, setRecA] = useState(null);
  const [recB, setRecB] = useState(null);
  const [primary, setPrimary] = useState('A');       // which record survives
  const [choices, setChoices] = useState({});         // { field: 'A' | 'B' | 'combine' }
  const [merging, setMerging] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { fetchMembers().then(setMembers); }, []);

  // default choices whenever entering step 3: prefer primary's non-empty values
  function enterStep3() {
    const init = {};
    FIELDS.forEach(f => {
      const a = recA[f.key], b = recB[f.key];
      const primVal = primary === 'A' ? a : b;
      const otherVal = primary === 'A' ? b : a;
      init[f.key] = primVal ? primary : (otherVal ? (primary === 'A' ? 'B' : 'A') : primary);
    });
    setChoices(init);
    setStep(3);
  }

  function pickAll(side) {
    const next = {};
    FIELDS.forEach(f => { next[f.key] = side; });
    setChoices(next);
  }

  const keeper  = primary === 'A' ? recA : recB;
  const removed = primary === 'A' ? recB : recA;

  async function doMerge() {
    if (testMode) { setDone({ test: true }); return; }
    setMerging(true);
    // 1. Build merged payload from choices
    const patch = {};
    FIELDS.forEach(f => {
      const c = choices[f.key];
      if (c === 'combine' && f.combinable) {
        const parts = [recA[f.key], recB[f.key]].filter(Boolean);
        patch[f.key] = parts.join('\n\n');
      } else {
        patch[f.key] = (c === 'A' ? recA : recB)[f.key] ?? null;
      }
    });
    // 2. Update the surviving record
    await supabase.from('care_members').update(patch).eq('id', keeper.id);
    // 3. Re-link contact logs from the removed record
    await supabase.from('contact_logs').update({ member_id: keeper.id }).eq('member_id', removed.id);
    // 4. Delete the duplicate
    await supabase.from('care_members').delete().eq('id', removed.id);
    // 5. Audit trail (best effort — table may not exist)
    try {
      await supabase.from('change_log').insert({
        member_name: patch.full_name || keeper.full_name,
        action: 'Merged',
        details: `Merged "${removed.full_name}" into "${keeper.full_name}"`,
        changed_by: 'Admin',
      });
    } catch {}
    setMerging(false);
    setDone({ kept: patch.full_name || keeper.full_name, removed: removed.full_name });
  }

  function reset() {
    setStep(1); setRecA(null); setRecB(null); setPrimary('A'); setChoices({}); setDone(null);
    fetchMembers().then(setMembers);
  }

  /* ── Done screen ── */
  if (done) {
    return (
      <div className="adm-placeholder">
        <div className="adm-placeholder-icon" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
          <Icon d={P.check} size={28} />
        </div>
        <h2>{done.test ? 'Test Mode — merge simulated' : 'Records merged'}</h2>
        <p>{done.test
          ? 'Nothing was changed. Turn off Test Mode to perform a real merge.'
          : `"${done.removed}" was merged into "${done.kept}". Contact logs were re-linked and the duplicate was removed.`}</p>
        <button className="btn-primary" onClick={reset}>Merge another</button>
      </div>
    );
  }

  return (
    <div className="adm-panel mt-panel">
      <div className="adm-panel-head">
        <h2>Merge Tool</h2>
        <div className="mt-steps">
          {['Pick records', 'Choose primary', 'Resolve fields'].map((s, i) => (
            <span key={s} className={`mt-step ${step === i + 1 ? 'on' : ''} ${step > i + 1 ? 'done' : ''}`}>
              {step > i + 1 ? <Icon d={P.check} size={12} /> : i + 1}. {s}
            </span>
          ))}
        </div>
      </div>

      {/* ── Step 1: pick two records ── */}
      {step === 1 && (
        <div className="mt-body">
          <p className="adm-panel-desc" style={{ padding: 0 }}>Select the two duplicate care member records to merge.</p>
          <div className="mt-pickers">
            <RecordPicker label="Record A" members={members} excluded={recB} value={recA} onPick={setRecA} />
            <RecordPicker label="Record B" members={members} excluded={recA} value={recB} onPick={setRecB} />
          </div>
          <div className="mt-foot">
            <button className="btn-primary" disabled={!recA || !recB} onClick={() => setStep(2)}>Continue</button>
          </div>
        </div>
      )}

      {/* ── Step 2: choose primary ── */}
      {step === 2 && (
        <div className="mt-body">
          <p className="adm-panel-desc" style={{ padding: 0 }}>Which record should survive? The other will be removed after its data and contact logs are folded in.</p>
          <div className="mt-pickers">
            {[['A', recA], ['B', recB]].map(([side, rec]) => (
              <button key={side} className={`mt-primary-card ${primary === side ? 'on' : ''}`} onClick={() => setPrimary(side)}>
                <span className="mt-side">Record {side}</span>
                <span className="adm-user-name">{rec.full_name}</span>
                <span className="adm-user-email">{rec.category} · {rec.status} · {(rec.contact_logs || []).length} logs</span>
                {primary === side && <span className="mt-keep"><Icon d={P.check} size={13} />Keep this record</span>}
              </button>
            ))}
          </div>
          <div className="mt-foot">
            <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary" onClick={enterStep3}>Continue</button>
          </div>
        </div>
      )}

      {/* ── Step 3: resolve fields ── */}
      {step === 3 && (
        <div className="mt-body">
          <div className="adm-table-wrap">
            <table className="adm-table mt-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th className="mt-colhead" onClick={() => pickAll('A')}>
                    {recA.full_name} <span className="mt-useall">use all</span>
                  </th>
                  <th className="mt-colhead" onClick={() => pickAll('B')}>
                    {recB.full_name} <span className="mt-useall">use all</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(f => {
                  const a = recA[f.key], b = recB[f.key];
                  if (!a && !b) return null;
                  return (
                    <tr key={f.key}>
                      <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{f.label}</td>
                      <td>
                        <button className={`mt-val ${choices[f.key] === 'A' ? 'on' : ''}`} onClick={() => setChoices(c => ({ ...c, [f.key]: 'A' }))}>
                          {a || <em>empty</em>}
                        </button>
                      </td>
                      <td>
                        <button className={`mt-val ${choices[f.key] === 'B' ? 'on' : ''}`} onClick={() => setChoices(c => ({ ...c, [f.key]: 'B' }))}>
                          {b || <em>empty</em>}
                        </button>
                        {f.combinable && a && b && (
                          <button className={`mt-combine ${choices[f.key] === 'combine' ? 'on' : ''}`}
                            onClick={() => setChoices(c => ({ ...c, [f.key]: 'combine' }))}>
                            Combine both
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-foot">
            <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" onClick={doMerge} disabled={merging}>
              <Icon d={P.layers} size={15} />{merging ? 'Merging…' : `Merge into "${keeper.full_name}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Searchable member picker */
function RecordPicker({ label, members, excluded, value, onPick }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => members
    .filter(m => m.id !== excluded?.id)
    .filter(m => !q.trim() || m.full_name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6), [members, excluded, q]);

  return (
    <div className="mt-picker">
      <span className="mt-side">{label}</span>
      {value ? (
        <div className="mt-picked">
          <div>
            <span className="adm-user-name">{value.full_name}</span>
            <span className="adm-user-email">{value.category} · {(value.contact_logs || []).length} logs</span>
          </div>
          <button className="btn-ghost sm" onClick={() => onPick(null)}>Change</button>
        </div>
      ) : (
        <>
          <div className="adm-search" style={{ minWidth: 0 }}>
            <Icon d={P.search} size={15} />
            <input placeholder="Search members…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="mt-results">
            {list.map(m => (
              <button key={m.id} className="mt-result" onClick={() => onPick(m)}>
                <span className="adm-user-name">{m.full_name}</span>
                <span className="adm-user-email">{m.category}</span>
              </button>
            ))}
            {list.length === 0 && <span className="adm-user-email" style={{ padding: 8 }}>No matches.</span>}
          </div>
        </>
      )}
    </div>
  );
}
