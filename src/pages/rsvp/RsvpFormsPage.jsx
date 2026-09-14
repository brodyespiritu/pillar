import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { confirmDialog } from '../../lib/dialog';
import { flashSaved } from '../../lib/flash';
import {
  fetchForms, createForm, updateForm, deleteForm, fetchResponseCounts, fetchResponses,
  fetchNotifyPeople, fetchPublicListing, responsesCsv, formLink, RSVP_SITE,
  PRESETS, FIELD_TYPES, cleanFields, randomToken,
} from '../../lib/rsvpForms';
import '../sms/Sms.css';
import '../care/Modal.css';
import '../admin/Admin.css';
import './RsvpFormsPage.css';

/*
 * RSVP — sign-up forms for bethesda.rsvp.
 *
 * Laid out like the SMS page it sits beside: the dark band, and a white sheet
 * across its lower edge. Where SMS puts the message box, this puts the one thing
 * you start here with — Create form. Every form below is a box: its questions,
 * whether it is live, how many have signed up, and the link button that sends
 * each new response by text to whoever should hear about it.
 */

const SITE = RSVP_SITE.replace(/^https?:\/\//, '');

/* A new form starts with the two questions nearly every sign-up asks. */
const newDraft = () => ({ title: '', description: '', fields: PRESETS.slice(0, 2).map(p => ({ ...p, id: randomToken(8) })) });

const when = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return `today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function RsvpFormsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [forms, setForms] = useState({ rows: [], missing: false, loaded: false });
  const [counts, setCounts] = useState({ counts: {}, latest: {} });
  const [people, setPeople] = useState([]);
  const [listing, setListing] = useState(null);
  const [editing, setEditing] = useState(null);   // a draft: { id?, title, description, fields }
  const [linking, setLinking] = useState(null);   // the form choosing who is texted
  const [viewing, setViewing] = useState(null);   // the form whose responses are open

  async function load() {
    const [f, c, p, l] = await Promise.all([fetchForms(), fetchResponseCounts(), fetchNotifyPeople(), fetchPublicListing()]);
    setForms({ ...f, loaded: true });
    setCounts(c);
    setPeople(p);
    setListing(l);
  }
  useEffect(() => { load(); }, []);
  /* "Create form" from the top menu arrives with { add: true }. */
  useEffect(() => { if (location.state?.add) setEditing(newDraft()); }, [location.state]);

  const personFor = useMemo(() => {
    const m = new Map(people.map(p => [`${p.type}:${p.id}`, p]));
    return n => m.get(`${n.type}:${n.id}`) || null;
  }, [people]);

  /* What bethesda.rsvp is showing right now, in words. */
  const siteSays = useMemo(() => {
    if (!listing) return null;
    const names = [...(listing.dinner?.open ? ['Wednesday night dinner'] : []), ...(listing.forms || []).map(f => f.title)];
    if (!names.length) return `${SITE} has nothing open right now.`;
    if (names.length === 1) return `${SITE} opens straight onto ${names[0]}.`;
    return `${SITE} shows ${names.length} boxes to choose from: ${names.join(', ')}.`;
  }, [listing]);

  async function save(draft) {
    const payload = { title: draft.title, description: draft.description, fields: draft.fields };
    const { data, error } = draft.id ? await updateForm(draft.id, payload) : await createForm(user?.id, payload);
    if (error) return error.message;
    setEditing(null);
    flashSaved(draft.id ? 'Form saved' : 'Form created');
    await load();
    /* A new form's next step is choosing who hears about its responses. */
    if (!draft.id && data) setLinking(data);
    return null;
  }

  async function setStatus(f, status) {
    if (status === 'closed' && !(await confirmDialog({
      title: `Close ${f.title}?`,
      message: `It comes off ${SITE} and stops taking sign-ups. Responses so far are kept, and you can reopen it.`,
      confirmLabel: 'Close form',
    }))) return;
    await updateForm(f.id, { status });
    flashSaved(status === 'open' ? 'Form reopened' : 'Form closed');
    load();
  }

  async function remove(f) {
    const n = counts.counts[f.id] || 0;
    if (!(await confirmDialog({
      title: `Delete ${f.title}?`,
      message: n ? `This also deletes its ${n} ${n === 1 ? 'response' : 'responses'}. It can't be undone.` : "This can't be undone.",
      confirmLabel: 'Delete form',
      danger: true,
    }))) return;
    await deleteForm(f.id);
    load();
  }

  async function copy(f) {
    try { await navigator.clipboard.writeText(formLink(f.slug)); flashSaved('Link copied'); }
    catch { window.prompt('Copy this link', formLink(f.slug)); }
  }

  async function saveLinks(f, notify) {
    const { error } = await updateForm(f.id, { notify });
    if (error) return error.message;
    setLinking(null);
    flashSaved(notify.length ? 'Texts linked' : 'Texts turned off');
    load();
    return null;
  }

  const rows = forms.rows;

  return (
    <div className="sms-wrap">
      <TopNav />
      <main className="sms-scroll">
        <div className="sms-band rsvpf-band">
          <div className="sms-band-inner">
            <h1 className="sms-title">RSVP</h1>
            <p className="rsvpf-band-sub">
              Sign-up forms at <a href={RSVP_SITE} target="_blank" rel="noreferrer">{SITE}</a>
            </p>
          </div>
        </div>

        <div className="sms-container rsvpf-container">
          {forms.missing ? (
            <div className="adm-placeholder">
              <div className="adm-placeholder-icon"><Icon d={P.form} size={28} /></div>
              <h2>Set up RSVP forms</h2>
              <p>Run <strong>supabase/rsvp-forms-schema.sql</strong> to start building sign-up forms.</p>
            </div>
          ) : (<>
            <section className="rsvpf-create">
              <div className="rsvpf-create-text">
                <h2>Create a sign-up form</h2>
                <p>Choose the questions, link who should get a text for each response, and it goes live on {SITE}.</p>
              </div>
              <button className="rsvpf-create-btn" onClick={() => setEditing(newDraft())}>
                <Icon d={P.plus} size={18} />Create form
              </button>
            </section>

            {siteSays && (
              <p className="rsvpf-site">
                <Icon d={P.link} size={15} />{siteSays}
              </p>
            )}

            {forms.loaded && rows.length === 0 && (
              <div className="rsvpf-empty">
                <h3>No forms yet</h3>
                <p>Build one for an event, a class or a meal. One open form fills the screen on {SITE}; two or more show as boxes to choose between, alongside the Wednesday dinner.</p>
              </div>
            )}

            <div className="rsvpf-grid">
              {rows.map(f => {
                const open = f.status === 'open';
                const fields = cleanFields(f.fields);
                const links = (Array.isArray(f.notify) ? f.notify : []);
                const linked = links.map(personFor);
                const names = linked.filter(Boolean).map(p => p.name);
                const lost = linked.filter(p => !p).length;
                const n = counts.counts[f.id] || 0;
                return (
                  <article key={f.id} className={`rsvpf-card ${open ? '' : 'closed'}`}>
                    <header className="rsvpf-card-head">
                      <h3>{f.title}</h3>
                      <span className={`rsvpf-status ${open ? 'open' : ''}`}>{open ? 'Live' : 'Closed'}</span>
                    </header>
                    {f.description && <p className="rsvpf-desc">{f.description}</p>}

                    <ul className="rsvpf-fields" aria-label="Questions">
                      {fields.map(x => (
                        <li key={x.id}>{x.label}{x.required && <span className="rsvpf-req" title="Required">*</span>}</li>
                      ))}
                    </ul>

                    {/* The link button: who each new response is texted to. */}
                    <button className={`rsvpf-link ${names.length ? 'set' : ''}`} onClick={() => setLinking(f)}>
                      <span className="rsvpf-link-ic"><Icon d={P.link} size={16} /></span>
                      <span className="rsvpf-link-text">
                        {names.length
                          ? <>Each response is texted to <b>{names.join(', ')}</b></>
                          : 'Link a person to get a text for each response'}
                        {lost > 0 && <span className="rsvpf-link-warn"> · {lost} can no longer be texted</span>}
                      </span>
                      <Icon d={P.chevR} size={16} />
                    </button>

                    <footer className="rsvpf-card-foot">
                      <button className="rsvpf-count" onClick={() => setViewing(f)} disabled={!n}>
                        <b>{n}</b> {n === 1 ? 'response' : 'responses'}
                        {counts.latest[f.id] && <span>· last {when(counts.latest[f.id])}</span>}
                      </button>
                      <span className="rsvpf-gap" />
                      <button className="rsvpf-act" onClick={() => copy(f)} disabled={!open} title={open ? formLink(f.slug) : 'Reopen the form to share it'}>Copy link</button>
                      <button className="rsvpf-act" onClick={() => setEditing({ id: f.id, title: f.title, description: f.description || '', fields })}>Edit</button>
                      <button className="rsvpf-act" onClick={() => setStatus(f, open ? 'closed' : 'open')}>{open ? 'Close' : 'Reopen'}</button>
                      <button className="rsvpf-act danger" onClick={() => remove(f)} aria-label={`Delete ${f.title}`}><Icon d={P.trash} size={15} /></button>
                    </footer>
                  </article>
                );
              })}
            </div>
          </>)}
        </div>
      </main>

      {editing && <FormBuilder draft={editing} onClose={() => setEditing(null)} onSave={save} />}
      {linking && (
        <LinkPeople form={linking} people={people} onClose={() => setLinking(null)} onSave={notify => saveLinks(linking, notify)} />
      )}
      {viewing && <ResponsesSheet form={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ── Building a form ── */

function FormBuilder({ draft, onClose, onSave }) {
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [fields, setFields] = useState(draft.fields || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const has = key => fields.some(f => f.key === key);
  const add = preset => setFields(fs => [...fs, { ...preset, id: randomToken(8) }]);
  const addCustom = () => setFields(fs => [...fs, { id: randomToken(8), type: 'text', label: '', required: false }]);
  const patch = (id, p) => setFields(fs => fs.map(f => (f.id === id ? { ...f, ...p } : f)));
  const remove = id => setFields(fs => fs.filter(f => f.id !== id));
  const move = (i, d) => setFields(fs => {
    const j = i + d;
    if (j < 0 || j >= fs.length) return fs;
    const n = [...fs];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  async function submit() {
    if (!title.trim()) return setError('Give the form a name.');
    if (!fields.length) return setError('Add at least one question.');
    if (fields.some(f => !f.label.trim())) return setError('Every question needs wording.');
    setSaving(true);
    setError('');
    const problem = await onSave({ id: draft.id, title, description, fields });
    setSaving(false);
    if (problem) setError(problem);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet rsvpf-builder" onClick={e => e.stopPropagation()} role="dialog" aria-label={draft.id ? 'Edit form' : 'Create form'}>
        <div className="modal-head">
          <h2>{draft.id ? 'Edit form' : 'Create form'}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body rsvpf-builder-body">
          <label className="rsvpf-label">
            <span>Form name</span>
            <input className="rsvpf-input big" value={title} maxLength={120} autoFocus={!draft.id}
              placeholder="Men's Breakfast, October 3" onChange={e => { setTitle(e.target.value); setError(''); }} />
          </label>
          <label className="rsvpf-label">
            <span>Details <em>optional</em></span>
            <textarea className="rsvpf-input" rows={2} value={description} maxLength={600}
              placeholder="Saturday at 8:00 AM in the fellowship hall. Breakfast is provided."
              onChange={e => setDescription(e.target.value)} />
          </label>

          <div className="rsvpf-label">
            <span>Questions</span>
            <div className="rsvpf-presets" role="group" aria-label="Add a question">
              {PRESETS.map(p => (
                <button key={p.key} type="button" className="rsvpf-preset" disabled={has(p.key)} onClick={() => add(p)}>
                  <Icon d={has(p.key) ? P.check : P.plus} size={14} />{p.label}
                </button>
              ))}
              <button type="button" className="rsvpf-preset" onClick={addCustom}>
                <Icon d={P.plus} size={14} />Your own question
              </button>
            </div>
          </div>

          {fields.length === 0 && <p className="rsvpf-hint">Tap a question above to add it.</p>}
          <ol className="rsvpf-rows">
            {fields.map((f, i) => (
              <li key={f.id} className="rsvpf-row">
                <div className="rsvpf-move">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><Icon d={P.arrowUp} size={14} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Move down"><Icon d={P.arrowDown} size={14} /></button>
                </div>
                <input className="rsvpf-input" value={f.label} maxLength={80} placeholder="What should we ask?"
                  aria-label="Question" onChange={e => { patch(f.id, { label: e.target.value }); setError(''); }} />
                {f.key ? (
                  <span className="rsvpf-type">{FIELD_TYPES[f.type].name}</span>
                ) : (
                  <select className="rsvpf-select" value={f.type} aria-label="Kind of answer" onChange={e => patch(f.id, { type: e.target.value })}>
                    {Object.entries(FIELD_TYPES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}
                  </select>
                )}
                <label className="rsvpf-required">
                  <input type="checkbox" checked={f.required} onChange={e => patch(f.id, { required: e.target.checked })} />Required
                </label>
                <button type="button" className="rsvpf-remove" onClick={() => remove(f.id)} aria-label={`Remove ${f.label || 'question'}`}>
                  <Icon d={P.close} size={16} />
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="modal-foot rsvpf-foot">
          {error && <p className="rsvpf-error" role="alert">{error}</p>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : draft.id ? 'Save form' : 'Create form'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Who gets a text for each response ── */

function LinkPeople({ form, people, onClose, onSave }) {
  const [picked, setPicked] = useState(() => new Set((Array.isArray(form.notify) ? form.notify : []).map(n => `${n.type}:${n.id}`)));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const needle = q.trim().toLowerCase();
  const match = p => !needle || `${p.name} ${p.phone}`.toLowerCase().includes(needle);
  const staff = people.filter(p => p.type === 'staff' && match(p));
  const contacts = people.filter(p => p.type === 'contact' && match(p));
  const shownContacts = contacts.slice(0, needle ? 60 : 12);
  const chosen = people.filter(p => picked.has(`${p.type}:${p.id}`));

  const toggle = p => setPicked(s => {
    const n = new Set(s);
    const k = `${p.type}:${p.id}`;
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  async function submit() {
    setSaving(true);
    const problem = await onSave([...picked].map(k => { const [type, id] = k.split(':'); return { type, id }; }));
    setSaving(false);
    if (problem) setError(problem);
  }

  const row = p => {
    const on = picked.has(`${p.type}:${p.id}`);
    return (
      <li key={`${p.type}:${p.id}`}>
        <button type="button" className={`rsvpf-person ${on ? 'on' : ''}`} onClick={() => toggle(p)} aria-pressed={on}>
          <span className="rsvpf-check">{on && <Icon d={P.check} size={14} />}</span>
          <span className="rsvpf-person-name">{p.name}</span>
          <span className="rsvpf-person-phone">{p.phone}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet rsvpf-linker" onClick={e => e.stopPropagation()} role="dialog" aria-label="Link people">
        <div className="modal-head">
          <div>
            <h2>Text each response</h2>
            <p className="rsvpf-sub">{form.title}</p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body rsvpf-linker-body">
          <p className="rsvpf-hint">
            Everyone you pick gets a text from the church number the moment someone signs up, with every answer they gave.
          </p>
          {chosen.length > 0 && (
            <div className="rsvpf-chosen">
              {chosen.map(p => (
                <button key={`${p.type}:${p.id}`} type="button" className="rsvpf-chip" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}>
                  {p.name}<Icon d={P.close} size={12} />
                </button>
              ))}
            </div>
          )}
          <div className="adm-search rsvpf-search">
            <Icon d={P.search} size={15} />
            <input placeholder="Search staff and contacts" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          </div>

          {staff.length > 0 && (<>
            <p className="rsvpf-group">Staff</p>
            <ul className="rsvpf-people">{staff.map(row)}</ul>
          </>)}
          {shownContacts.length > 0 && (<>
            <p className="rsvpf-group">Texting list{!needle && contacts.length > shownContacts.length ? ` · search to find all ${contacts.length}` : ''}</p>
            <ul className="rsvpf-people">{shownContacts.map(row)}</ul>
          </>)}
          {!staff.length && !shownContacts.length && <p className="rsvpf-hint">Nobody with a mobile number matches “{q}”.</p>}
        </div>

        <div className="modal-foot rsvpf-foot">
          {error && <p className="rsvpf-error" role="alert">{error}</p>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : picked.size ? `Text ${picked.size} ${picked.size === 1 ? 'person' : 'people'}` : 'Turn off texts'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Responses ── */

function ResponsesSheet({ form, onClose }) {
  const [rows, setRows] = useState(null);
  const fields = useMemo(() => cleanFields(form.fields), [form]);

  useEffect(() => {
    let live = true;
    fetchResponses(form.id).then(r => { if (live) setRows(r.rows || []); });
    return () => { live = false; };
  }, [form.id]);

  function download() {
    const blob = new Blob([responsesCsv(form, rows || [])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'rsvp'}-responses.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet rsvpf-responses" onClick={e => e.stopPropagation()} role="dialog" aria-label="Responses">
        <div className="modal-head">
          <div>
            <h2>{form.title}</h2>
            <p className="rsvpf-sub">{rows ? `${rows.length} ${rows.length === 1 ? 'response' : 'responses'}` : 'Loading…'}</p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body rsvpf-responses-body">
          {rows && rows.length === 0 && <p className="rsvpf-hint">Nobody has signed up yet.</p>}
          {rows && rows.length > 0 && (
            <div className="rsvpf-table-wrap">
              <table className="rsvpf-table">
                <thead>
                  <tr>
                    <th scope="col">Signed up</th>
                    {fields.map(f => <th scope="col" key={f.id}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td className="rsvpf-when">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      {fields.map(f => <td key={f.id}>{r.answers?.[f.id] || <span className="rsvpf-blank">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-foot rsvpf-foot">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={download} disabled={!rows?.length}>Download spreadsheet</button>
        </div>
      </div>
    </div>
  );
}
