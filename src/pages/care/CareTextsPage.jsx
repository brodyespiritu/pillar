import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { flashSaved } from '../../lib/flash';
import { confirmDialog, alertDialog } from '../../lib/dialog';
import {
  canSeeCareTexts, canTrainCareTexts, MODES, KIND_LABEL, usd,
  fetchCareAiSettings, saveCareAiSettings, fetchCareAiDrafts, fetchCareAiExamples,
  addCareAiExample, removeCareAiExample, careAiStatus, previewCareAi,
} from '../../lib/careTexts';
import './Modal.css';
import './CareTexts.css';

/*
 * Care Texts — teaching the AI that writes the texts to deacons and staff.
 *
 * Three things to teach it with, in the order a person reaches for them: the
 * rules (plain words, one audience each), the mode it runs in, and corrections
 * made on the texts it actually wrote. Each recent text shows Pillar's wording
 * beside the AI's, so a correction is made looking at the real thing.
 */

const RULE_HINTS = {
  deacons: 'One rule per line, in plain words. For example:\nLead with the person\'s name.\nSay where they are, but not the diagnosis.\nKeep it to one text when you can.',
  staff: 'One rule per line. For example:\nPut hospital stays first.\nShorten long notes to one line each.\nKeep each person on one line.',
};

/*
 * Rules being written survive a re-lock. Any sign-in event (the hourly session
 * refresh among them) brings the PIN back, and the page behind it is rebuilt —
 * which used to throw away a half-written set of rules. Unsaved text waits in
 * this tab's session storage until it is saved.
 */
const DRAFT_KEY = 'pillar.careTexts.unsavedRules';
const readUnsaved = () => {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; }
};
const keepUnsaved = (aud, text, saved) => {
  try {
    const d = readUnsaved();
    if (text === saved) delete d[aud]; else d[aud] = text;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch { /* storage refused: the text is simply not kept */ }
};

const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
/* A digest's draft holds its lines; the header is Pillar's and goes on top. */
const shown = (d, body) => (d.header && body ? `${d.header}\n\n${body}` : body || '');

export default function CareTextsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canSee = canSeeCareTexts(profile);
  const canTrain = canTrainCareTexts(profile);
  const byName = profile?.name || '';

  const [loading, setLoading] = useState(true);
  const [setUp, setSetUp] = useState(true);
  const [settings, setSettings] = useState(null);
  const [rules, setRules] = useState({ deacons: '', staff: '' });
  const [cap, setCap] = useState('');
  const [saving, setSaving] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [examples, setExamples] = useState([]);
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState('all');

  async function load() {
    const [s, d, e, st] = await Promise.all([fetchCareAiSettings(), fetchCareAiDrafts(), fetchCareAiExamples(), careAiStatus()]);
    if (s.setUp === false) { setSetUp(false); setLoading(false); return; }
    if (s.settings) {
      setSettings(s.settings);
      const unsaved = readUnsaved();
      setRules({
        deacons: unsaved.deacons ?? (s.settings.rules_deacons || ''),
        staff: unsaved.staff ?? (s.settings.rules_staff || ''),
      });
      setCap(String(Number(s.settings.monthly_cap_usd ?? 10)));
    }
    setDrafts(d.rows);
    setExamples(e.rows);
    setStatus(st.data || { error: st.error });
    setLoading(false);
  }
  useEffect(() => { if (canSee) load(); else setLoading(false); }, [canSee]);

  async function save(patch, what) {
    setSaving(what);
    const { data, error } = await saveCareAiSettings(patch, byName);
    setSaving('');
    if (error) return alertDialog(`Could not save: ${error.message}`);
    setSettings(data);
    if (what === 'deacons' || what === 'staff') keepUnsaved(what, '', '');
    flashSaved();
  }

  async function setMode(mode) {
    if (!settings || mode === settings.mode || saving) return;
    if (mode === 'live' && !(await confirmDialog({
      title: 'Let the AI write the texts',
      message: 'From the next text on, deacons and staff get the AI\'s version whenever it passes every check. '
        + 'Anything that fails a check still goes out in Pillar\'s own wording. You can switch back at any time.',
      confirmLabel: 'Turn on',
    }))) return;
    save({ mode }, 'mode');
  }

  function saveCap() {
    const n = Number(cap);
    if (!Number.isFinite(n) || n < 0 || n > 500) return alertDialog('Enter a monthly limit between $0 and $500.');
    save({ monthly_cap_usd: n }, 'cap');
  }

  async function addExample(draft, shouldRead, why) {
    const { data, error } = await addCareAiExample({ draft, shouldRead, why, byName });
    if (error) { alertDialog(`Could not save that: ${error.message}`); return false; }
    setExamples(x => [data, ...x]);
    flashSaved('Saved. The AI follows it from the next text.');
    return true;
  }

  async function removeExample(ex) {
    if (!(await confirmDialog({ message: 'Remove this example? The AI stops following it from the next text.', confirmLabel: 'Remove', danger: true }))) return;
    const { error } = await removeCareAiExample(ex.id);
    if (error) return alertDialog(`Could not remove it: ${error.message}`);
    setExamples(x => x.filter(e => e.id !== ex.id));
  }

  const shownDrafts = useMemo(() => drafts.filter(d => filter === 'all' || d.audience === filter), [drafts, filter]);
  const correctedIds = useMemo(() => new Set(examples.map(e => e.draft_id).filter(Boolean)), [examples]);
  const mode = settings?.mode || 'off';
  const configured = status?.configured === true;

  if (!canSee) {
    return (
      <div className="ct-wrap">
        <TopNav />
        <main className="ct-scroll"><div className="ct-container">
          <div className="ct-card ct-note">You need Cares access to see the care texts.</div>
        </div></main>
      </div>
    );
  }

  return (
    <div className="ct-wrap">
      <TopNav />
      <main className="ct-scroll">
        <div className="ct-container">
          <button className="ct-back" onClick={() => navigate('/cares')}><Icon d={P.chevL} size={18} />Care List</button>

          <header className="ct-hero">
            <span className="ct-pill">Pastoral Care</span>
            <h1 className="ct-title">Care Texts</h1>
            <p className="ct-subtitle">
              Teach the AI that writes the texts to deacons and staff. Give it rules, then correct what it writes.
              It only ever rewords what Pillar would have sent.
            </p>
          </header>

          {loading ? <p className="ct-empty">Loading…</p> : !setUp ? (
            <div className="ct-card ct-note">
              <Icon d={P.shield} size={18} />
              <span>Care Texts isn't set up yet. Until it is, every care text goes out in Pillar's own wording.</span>
            </div>
          ) : (<>
            {status && !configured && (
              <div className="ct-card ct-note">
                <Icon d={P.shield} size={18} />
                <span>
                  {status.error
                    ? `Could not check the AI connection: ${status.error}`
                    : 'The AI key hasn\'t been added yet, so every care text goes out in Pillar\'s own wording for now. '
                      + 'An admin adds it in Supabase, under Edge Functions, Secrets, as ANTHROPIC_API_KEY.'}
                </span>
              </div>
            )}

            {/* ── How texts go out ── */}
            <section className="ct-card ct-status">
              <div className="ct-status-main">
                <h2 className="ct-h2">How texts go out</h2>
                <div className="ct-seg" role="radiogroup" aria-label="How texts go out">
                  {MODES.map(m => (
                    <button key={m.key} role="radio" aria-checked={mode === m.key}
                      className={`ct-seg-btn ${mode === m.key ? 'on' : ''}`}
                      disabled={!canTrain || !!saving} onClick={() => setMode(m.key)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="ct-status-sub">{MODES.find(m => m.key === mode)?.sub}</p>
                {settings?.updated_by_name && (
                  <span className="ct-meta">Settings last changed {day(settings.updated_at)} by {settings.updated_by_name}</span>
                )}
              </div>
              <div className="ct-spend">
                <span className="ct-spend-label">This month</span>
                <span className="ct-spend-value">{usd(status?.spentUsd)}</span>
                <span className="ct-spend-sub">of a {usd(settings?.monthly_cap_usd)} limit. Past it, texts go out in Pillar's wording.</span>
                {canTrain && (
                  <div className="ct-cap">
                    <span>$</span>
                    <input value={cap} onChange={e => setCap(e.target.value)} inputMode="decimal" aria-label="Monthly limit in dollars" />
                    <button className="btn-ghost sm" onClick={saveCap}
                      disabled={saving === 'cap' || Number(cap) === Number(settings?.monthly_cap_usd)}>
                      {saving === 'cap' ? 'Saving…' : 'Set limit'}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* ── Rules ── */}
            <section className="ct-rules">
              {[['deacons', 'For deacons', 'Alerts and the morning summary'], ['staff', 'For the staff digest', '8:00 AM and 4:00 PM']]
                .map(([aud, title, sub]) => {
                  const saved = settings?.[`rules_${aud}`] || '';
                  const changed = rules[aud] !== saved;
                  return (
                    <div key={aud} className="ct-card ct-rule">
                      <div className="ct-rule-head">
                        <h2 className="ct-h2">{title}</h2>
                        <span className="ct-rule-sub">{sub}</span>
                      </div>
                      <textarea className="ct-textarea" rows={7} value={rules[aud]} placeholder={RULE_HINTS[aud]}
                        disabled={!canTrain} maxLength={6000}
                        onChange={e => {
                          const text = e.target.value;
                          setRules(r => ({ ...r, [aud]: text }));
                          keepUnsaved(aud, text, saved);
                        }} />
                      <div className="ct-rule-foot">
                        {canTrain && (
                          <button className="btn-primary sm" disabled={!changed || saving === aud}
                            onClick={() => save({ [`rules_${aud}`]: rules[aud] }, aud)}>
                            {saving === aud ? 'Saving…' : 'Save rules'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </section>

            {/* ── Recent texts ── */}
            <section className="ct-section">
              <div className="ct-section-head">
                <h2 className="ct-h2">Recent texts</h2>
                <div className="ct-chips" role="tablist" aria-label="Show">
                  {[['all', 'All'], ['deacons', 'Deacons'], ['staff', 'Staff']].map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={filter === k}
                      className={`ct-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
                  ))}
                </div>
              </div>

              {shownDrafts.length === 0 ? (
                <p className="ct-empty">
                  {!configured
                    ? 'Once the AI key is added, every care text shows up here with the AI\'s version beside it.'
                    : mode === 'off'
                      ? 'The AI is off. Switch to Practice to see what it would write.'
                      : 'Nothing yet. The next care text shows up here with the AI\'s version beside it.'}
                </p>
              ) : shownDrafts.map(d => (
                <DraftCard key={d.id} draft={d} canTrain={canTrain} corrected={correctedIds.has(d.id)}
                  rules={rules[d.audience]} onExample={addExample} />
              ))}
            </section>

            {/* ── Examples ── */}
            <section className="ct-section">
              <div className="ct-section-head">
                <h2 className="ct-h2">Examples it follows</h2>
                <span className="ct-meta">The newest twelve for each audience go with every text it writes.</span>
              </div>
              {examples.length === 0 ? (
                <p className="ct-empty">None yet. Use Correct it or Looks right on a text above, and the AI follows it from then on.</p>
              ) : (
                <div className="ct-examples">
                  {examples.map(ex => (
                    <div key={ex.id} className="ct-card ct-example">
                      <div className="ct-example-head">
                        <span className="ct-tag">{ex.audience === 'staff' ? 'Staff' : 'Deacons'}</span>
                        <span className="ct-meta">{day(ex.created_at)}{ex.created_by_name ? ` · ${ex.created_by_name}` : ''}</span>
                        {canTrain && (
                          <button className="ct-link danger" onClick={() => removeExample(ex)}>Remove</button>
                        )}
                      </div>
                      <p className="ct-text">{ex.should_read}</p>
                      {ex.why && <p className="ct-why">{ex.why}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>)}
        </div>
      </main>
    </div>
  );
}

/* One text: Pillar's wording beside the AI's, and what to do about it. */
function DraftCard({ draft: d, canTrain, corrected, rules, onExample }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState('');
  const [retry, setRetry] = useState(null);   // { text, problems, cost } | { error }

  const problems = d.problems || [];
  const status = d.used === 'ai' ? { cls: 'sent', label: 'Sent the AI\'s version' }
    : d.mode === 'practice' && d.written && !problems.length ? { cls: 'practice', label: 'Practice · not sent' }
    : d.mode === 'practice' ? { cls: 'held', label: 'Practice · would not be sent' }
    : { cls: 'held', label: 'Sent Pillar\'s wording' };

  function startCorrect() {
    setText(d.written || d.original);
    setWhy('');
    setEditing(true);
  }

  async function saveCorrection() {
    if (!text.trim()) return;
    setBusy('save');
    const done = await onExample(d, text, why);
    setBusy('');
    if (done) setEditing(false);
  }

  async function looksRight() {
    setBusy('ok');
    await onExample(d, d.written, '');
    setBusy('');
  }

  async function tryAgain() {
    setBusy('retry');
    setRetry(null);
    const { data, error } = await previewCareAi(d.id, rules);
    setBusy('');
    setRetry(error ? { error } : data);
  }

  return (
    <article className="ct-card ct-draft">
      <div className="ct-draft-head">
        <div className="ct-draft-title">
          <span className="ct-draft-label">{d.label || KIND_LABEL[d.kind]}</span>
          <span className="ct-meta">{KIND_LABEL[d.kind]} · {when(d.created_at)}</span>
        </div>
        <div className="ct-draft-tags">
          {corrected && <span className="ct-tag">Example saved</span>}
          <span className={`ct-status-chip ${status.cls}`}>{status.label}</span>
        </div>
      </div>

      {problems.length > 0 && (
        <p className="ct-problem"><Icon d={P.shield} size={15} />{problems.join(' ')}</p>
      )}

      <div className="ct-compare">
        <div className="ct-version">
          <span className="ct-version-label">Pillar's wording</span>
          <p className="ct-text">{shown(d, d.original)}</p>
        </div>
        <div className="ct-version ai">
          <span className="ct-version-label">The AI's version</span>
          {d.written
            ? <p className="ct-text">{shown(d, d.written)}</p>
            : <p className="ct-text ct-muted">It didn't write one this time.</p>}
        </div>
      </div>

      {retry && (
        <div className="ct-retry">
          <span className="ct-version-label">Written again with the rules on this page</span>
          {retry.error ? <p className="ct-problem">{retry.error}</p> : (<>
            {retry.text ? <p className="ct-text">{shown(d, retry.text)}</p> : <p className="ct-text ct-muted">It didn't write one.</p>}
            {retry.problems?.length > 0 && <p className="ct-problem"><Icon d={P.shield} size={15} />{retry.problems.join(' ')}</p>}
            <span className="ct-meta">Cost {`$${Number(retry.cost || 0).toFixed(3)}`} · nothing was sent</span>
          </>)}
        </div>
      )}

      {editing ? (
        <div className="ct-correct">
          <label className="ct-version-label" htmlFor={`fix-${d.id}`}>How it should read</label>
          <textarea id={`fix-${d.id}`} className="ct-textarea" rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
            value={text} onChange={e => setText(e.target.value)} maxLength={8000} />
          <input className="ct-input" value={why} onChange={e => setWhy(e.target.value)} maxLength={1000}
            placeholder="Why? (optional) For example: deacons don't need the diagnosis" />
          <div className="ct-actions">
            <button className="btn-ghost sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary sm" onClick={saveCorrection} disabled={!text.trim() || busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save as an example'}
            </button>
          </div>
        </div>
      ) : canTrain && (
        <div className="ct-actions">
          <button className="btn-ghost sm" onClick={tryAgain} disabled={!!busy}>
            <Icon d={P.repeat} size={14} />{busy === 'retry' ? 'Writing…' : 'Try again with these rules'}
          </button>
          {d.written && !problems.length && !corrected && (
            <button className="btn-ghost sm" onClick={looksRight} disabled={!!busy}>
              <Icon d={P.check} size={14} />{busy === 'ok' ? 'Saving…' : 'Looks right'}
            </button>
          )}
          <button className="btn-primary sm" onClick={startCorrect} disabled={!!busy}>
            <Icon d={P.edit} size={14} />Correct it
          </button>
        </div>
      )}
    </article>
  );
}
