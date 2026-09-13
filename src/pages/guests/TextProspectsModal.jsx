import { useState, useEffect, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { isProspect } from '../../lib/guests';
import {
  assembleMessage, getLastMassTexts, sendProspectSms,
  saveSession, loadSession, clearSession,
} from '../../lib/sms';
import { useMaintenance, maintenanceLabel } from '../../lib/maintenance';
import '../care/Modal.css';
import './Guests.css';

export default function TextProspectsModal({ guests, onClose }) {
  const { user } = useAuth();
  /* Scheduled texting maintenance locks the final Send. Writing and personalising
     still work — the session is saved, so the texts can go once the window closes. */
  const paused = useMaintenance();

  const prospects = useMemo(() => guests.filter(isProspect), [guests]);
  const withPhone = useMemo(() => prospects.filter(p => p.phone?.trim()), [prospects]);
  const noPhone   = useMemo(() => prospects.filter(p => !p.phone?.trim()), [prospects]);

  const [phase, setPhase]     = useState('compose'); // compose|personalize|review|sending|done
  const [shared, setShared]   = useState('');
  const [selected, setSelected] = useState(() => new Set(withPhone.map(p => p.id)));
  const [drafts, setDrafts]   = useState({});        // { id: { note, closing } }
  const [pIndex, setPIndex]   = useState(0);
  const [results, setResults] = useState(null);
  const [lastTexts, setLastTexts] = useState({});
  const [resumePrompt, setResumePrompt] = useState(false);
  const [exitPrompt, setExitPrompt] = useState(false);

  // resume prior session?
  useEffect(() => {
    const s = loadSession();
    if (s && s.shared) setResumePrompt(s);
  }, []);

  function doResume(s) {
    setShared(s.shared || '');
    setSelected(new Set(s.selected || []));
    setDrafts(s.drafts || {});
    setPhase(s.phase || 'compose');
    setPIndex(s.pIndex || 0);
    setResumePrompt(false);
  }
  function discardResume() { clearSession(); setResumePrompt(false); }

  // persist as we go
  useEffect(() => {
    if (phase === 'compose' && !shared) return;
    if (phase === 'done') return;
    saveSession({ phase, shared, selected: [...selected], drafts, pIndex });
  }, [phase, shared, selected, drafts, pIndex]);

  const recipients = useMemo(() => withPhone.filter(p => selected.has(p.id)), [withPhone, selected]);

  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll   = () => setSelected(new Set(withPhone.map(p => p.id)));
  const deselectAll = () => setSelected(new Set());
  const setDraft = (id, k, v) => setDrafts(d => ({ ...d, [id]: { ...d[id], [k]: v } }));

  function attemptClose() {
    if ((phase === 'compose' && !shared) || phase === 'done') { onClose(); return; }
    setExitPrompt(true);
  }

  async function goPersonalize() {
    const nums = recipients.map(r => r.phone.trim());
    setLastTexts(await getLastMassTexts(nums));
    setPIndex(0);
    setPhase('personalize');
  }

  async function fireSend() {
    if (paused) return;
    setPhase('sending');
    const messages = recipients.map(r => ({
      to_number: r.phone.trim(),
      to_name: r.full_name,
      body: assembleMessage(drafts[r.id]?.note, shared, drafts[r.id]?.closing),
    }));
    const res = await sendProspectSms(messages);
    setResults(res);
    setPhase('done');
  }

  const cur = recipients[pIndex];
  const prev = recipients[pIndex - 1];

  return (
    <div className="modal-overlay" onClick={attemptClose}>
      <div className="modal sheet tx-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <div className="gf-type" style={{ '--tc': '#14B8A6' }}>Text Prospects</div>
            <h2>{phaseTitle(phase)}</h2>
          </div>
          <button className="modal-x" onClick={attemptClose}><Icon d={P.close} size={20} /></button>
        </div>

        {/* Resume banner */}
        {resumePrompt && (
          <div className="tx-resume">
            <span>You have a saved draft from earlier. Resume where you left off?</span>
            <div>
              <button className="btn-ghost sm" onClick={discardResume}>Discard</button>
              <button className="btn-primary sm" onClick={() => doResume(resumePrompt)}>Resume</button>
            </div>
          </div>
        )}

        {/* ── COMPOSE ── */}
        {phase === 'compose' && (
          <div className="tx-body">
            <div className="tx-main">
              <p className="gf-q">Shared message</p>
              <p className="tx-hint">Everyone receives this. You'll personalize the top & bottom next.</p>
              <textarea rows={5} value={shared}
                onChange={e => setShared(e.target.value)} placeholder="e.g. We'd love to have you back this Sunday at 10:30!" />

              <div className="tx-reclist-head">
                <span>Recipients ({recipients.length}/{withPhone.length})</span>
                <div>
                  <button onClick={selectAll}>Select all</button>
                  <button onClick={deselectAll}>Deselect all</button>
                </div>
              </div>
              <div className="tx-reclist">
                {withPhone.map(p => (
                  <label key={p.id} className="tx-rec">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="tx-rec-name">{p.full_name}</span>
                    <span className="tx-rec-phone">{p.phone}</span>
                  </label>
                ))}
                {withPhone.length === 0 && <p className="tx-empty">No prospects have a phone number on file.</p>}
              </div>

              {noPhone.length > 0 && (
                <div className="tx-excluded">
                  <p>Excluded — no phone on file ({noPhone.length})</p>
                  <span>{noPhone.map(p => p.full_name).join(', ')}</span>
                </div>
              )}
            </div>

            <Preview note="[ personal note ]" shared={shared || '[ shared message ]'} closing="[ closing text ]" />
          </div>
        )}

        {/* ── PERSONALIZE ── */}
        {phase === 'personalize' && cur && (
          <div className="tx-body">
            <div className="tx-main">
              <div className="tx-progress">
                <div className="tx-progress-bar"><div style={{ width: `${((pIndex) / recipients.length) * 100}%` }} /></div>
                <span>{pIndex + 1} of {recipients.length}</span>
              </div>
              <p className="gf-q">{cur.full_name}</p>

              <label className="field-group">
                <span>Personal note <em>(above)</em></span>
                <textarea rows={2} value={drafts[cur.id]?.note || ''} onChange={e => setDraft(cur.id, 'note', e.target.value)}
                  placeholder={`Hey ${cur.full_name.split(' ')[0]}, great meeting you Sunday!`} />
              </label>
              <div className="tx-shared-ro">
                <span className="tx-ro-label">Shared message</span>
                <p>{shared}</p>
              </div>
              <label className="field-group">
                <span>Closing text <em>(below)</em></span>
                <textarea rows={2} value={drafts[cur.id]?.closing || ''} onChange={e => setDraft(cur.id, 'closing', e.target.value)}
                  placeholder="Looking forward to seeing you! — Pastor" />
              </label>

              {prev && (
                <button className="tx-paste" onClick={() => {
                  setDrafts(d => ({ ...d, [cur.id]: { note: d[prev.id]?.note || '', closing: d[prev.id]?.closing || '' } }));
                }}>
                  <Icon d={P.doc} size={14} />Paste from last
                </button>
              )}
            </div>

            <Preview
              note={drafts[cur.id]?.note} shared={shared} closing={drafts[cur.id]?.closing}
              lastText={lastTexts[cur.phone?.trim()]?.body}
            />
          </div>
        )}

        {/* ── REVIEW ── */}
        {phase === 'review' && (
          <div className="modal-body">
            <div className="tx-review-summary">{recipients.length} text{recipients.length === 1 ? '' : 's'} ready to send</div>
            {recipients.map(r => (
              <ReviewCard key={r.id} r={r} body={assembleMessage(drafts[r.id]?.note, shared, drafts[r.id]?.closing)}
                hasNote={!!drafts[r.id]?.note?.trim()} hasClosing={!!drafts[r.id]?.closing?.trim()} />
            ))}
          </div>
        )}

        {/* ── SENDING ── */}
        {phase === 'sending' && (
          <div className="modal-body tx-center">
            <div className="tx-spinner" />
            <p>Sending {recipients.length} text{recipients.length === 1 ? '' : 's'}…</p>
          </div>
        )}

        {/* ── DONE ── */}
        {phase === 'done' && results && (
          <div className="modal-body tx-center">
            <div className={`tx-done-icon ${results.failed?.length || !results.sent ? 'warn' : 'ok'}`}>
              <Icon d={results.failed?.length || !results.sent ? P.shield : P.check} size={30} />
            </div>
            <p className="tx-done-title">
              {results.sent} sent{results.failed?.length ? ` · ${results.failed.length} not sent` : ''}
              {results.skipped?.length ? ` · ${results.skipped.length} skipped` : ''}
            </p>
            {/* Who did not get one, and why — refused (opted out, not a mobile) or skipped (a landline, the same phone twice). */}
            {(results.failed?.length > 0 || results.skipped?.length > 0) && (
              <div className="tx-failed">
                {[...(results.failed || []).map(f => ({ name: f.to_name, why: f.error })),
                  ...(results.skipped || []).map(x => ({ name: x.to_name, why: x.reason }))].map((f, i) => (
                  <div key={i} className="tx-failed-row"><strong>{f.name}</strong><span>{f.why}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="modal-foot">
          {phase === 'compose' && (<>
            <button className="btn-ghost" onClick={attemptClose}>Cancel</button>
            <button className="btn-primary" disabled={!shared.trim() || recipients.length === 0} onClick={goPersonalize}>
              Personalize {recipients.length}
            </button>
          </>)}
          {phase === 'personalize' && (<>
            <button className="btn-ghost" onClick={() => pIndex === 0 ? setPhase('compose') : setPIndex(i => i - 1)}>Back</button>
            {pIndex < recipients.length - 1
              ? <button className="btn-primary" onClick={() => setPIndex(i => i + 1)}>Next</button>
              : <button className="btn-primary" onClick={() => setPhase('review')}>Review</button>}
          </>)}
          {phase === 'review' && (<>
            <button className="btn-ghost" onClick={() => { setPIndex(recipients.length - 1); setPhase('personalize'); }}>Back</button>
            {paused && <p className="maintenance-note" role="status">{maintenanceLabel(paused)}</p>}
            <button className="btn-primary" onClick={fireSend} disabled={!!paused}><Icon d={P.send} size={15} />Send {recipients.length} Texts</button>
          </>)}
          {phase === 'done' && (
            <button className="btn-primary" onClick={() => { clearSession(); onClose(); }} style={{ marginLeft: 'auto' }}>Done</button>
          )}
        </div>

        {/* Exit confirm */}
        {exitPrompt && (
          <div className="tx-confirm">
            <div className="tx-confirm-box">
              <p className="tx-confirm-title">Save and exit?</p>
              <p className="tx-confirm-sub">Your progress is saved for 24 hours — resume anytime.</p>
              <div className="tx-confirm-actions">
                <button className="btn-ghost sm" onClick={() => { clearSession(); onClose(); }}>Discard</button>
                <button className="btn-ghost sm" onClick={() => setExitPrompt(false)}>Keep editing</button>
                <button className="btn-primary sm" onClick={onClose}>Save & exit</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseTitle(p) {
  return { compose: 'Compose', personalize: 'Personalize', review: 'Review', sending: 'Sending', done: 'Done' }[p];
}

/* iMessage-style preview bubble */
function Preview({ note, shared, closing, lastText }) {
  return (
    <aside className="tx-preview">
      {lastText && (
        <div className="tx-preview-last">
          <span className="tx-preview-label">Last text sent</span>
          <div className="tx-bubble gray">{lastText}</div>
        </div>
      )}
      <span className="tx-preview-label">Preview</span>
      <div className="tx-bubble blue">
        {note?.trim() && <p className="tx-bubble-part">{note}</p>}
        <p className="tx-bubble-part">{shared}</p>
        {closing?.trim() && <p className="tx-bubble-part">{closing}</p>}
      </div>
    </aside>
  );
}

function ReviewCard({ r, body, hasNote, hasClosing }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tx-review-card">
      <button className="tx-review-head" onClick={() => setOpen(o => !o)}>
        <span className="tx-review-name">{r.full_name}</span>
        <span className="tx-review-tags">
          {hasNote && <span>note</span>}
          {hasClosing && <span>closing</span>}
          <Icon d={open ? P.chevron : P.chevron} size={16} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        </span>
      </button>
      {open && <div className="tx-review-body">{body}</div>}
    </div>
  );
}
