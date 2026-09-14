import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import { cleanFields, validateAnswers, summarize } from '../../../supabase/functions/_shared/rsvpForms.ts';
import './rsvp.css';

/*
 * One sign-up form on bethesda.rsvp — built on the RSVP page in Pillar.
 *
 * Public, no sign-in, and shaped like the dinner form beside it: large type, one
 * column, the right keyboard for each field. Answers are checked here as they
 * will be checked again by the rsvp-forms function, which alone saves them.
 */

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rsvp-forms`;

/* The keyboard and autofill each kind of field should get on a phone. */
function inputProps(f) {
  if (f.key === 'first_name') return { autoComplete: 'given-name', autoCapitalize: 'words' };
  if (f.key === 'last_name') return { autoComplete: 'family-name', autoCapitalize: 'words' };
  if (f.type === 'email') return { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'off' };
  if (f.type === 'phone') return { type: 'tel', inputMode: 'tel', autoComplete: 'tel' };
  /* type=tel with a numeric inputMode opens the number pad on iPhone and Android
     without the spinners type=number adds. */
  if (f.type === 'number') return { type: 'tel', inputMode: 'numeric', pattern: '[0-9]*' };
  return {};
}

export default function PublicForm({ form: given = null, onBack }) {
  const { slug } = useParams();
  const [form, setForm] = useState(given);
  const [loadError, setLoadError] = useState('');
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  /* A field people never see, and when the form was opened: both catch scripts. */
  const [website, setWebsite] = useState('');
  const opened = useRef(Date.now());
  const formRef = useRef(null);

  /* Opened by its own link: fetch the one form. */
  useEffect(() => {
    if (given || !slug) return;
    let live = true;
    fetch(`${ENDPOINT}?slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'This sign-up is not available.');
        if (live) setForm(d.form);
      })
      .catch(e => { if (live) setLoadError(e.message || 'This sign-up is not available.'); });
    return () => { live = false; };
  }, [slug, given]);

  const fields = useMemo(() => cleanFields(form?.fields), [form]);

  const set = (id, v) => {
    setValues(vs => ({ ...vs, [id]: v }));
    if (errors[id]) setErrors(es => { const n = { ...es }; delete n[id]; return n; });
  };

  function focusFirstError(errs) {
    const first = fields.find(f => errs[f.id]);
    if (first) formRef.current?.querySelector(`[name="${first.id}"]`)?.focus();
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const { values: clean, errors: errs } = validateAnswers(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) { setError(''); focusFirstError(errs); return; }

    setBusy(true);
    setError('');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: form.slug, answers: values, startedAt: opened.current, website }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d?.fields) { setErrors(d.fields); focusFirstError(d.fields); }
        throw new Error(d?.error || 'Something went wrong. Please try again.');
      }
      setDone({ name: summarize(fields, clean).name });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const back = onBack && (
    <button type="button" className="rsvp-back" onClick={onBack}>
      <Icon d={P.chevL} size={18} />All sign-ups
    </button>
  );

  if (loadError) {
    return (
      <div className="rsvp-wrap">
        <main className="rsvp-card">
          <h1 className="rsvp-title">Sign-up not available</h1>
          <p className="rsvp-sub">{loadError}</p>
          <a className="rsvp-again rsvp-link-btn" href="/">See what's open</a>
        </main>
      </div>
    );
  }

  if (!form) {
    return <div className="rsvp-wrap"><div className="rsvp-card rsvp-loading" aria-busy="true" aria-label="Loading" /></div>;
  }

  if (done) {
    const first = (done.name || '').split(' ')[0];
    return (
      <div className="rsvp-wrap">
        <main className="rsvp-card rsvp-done">
          {back}
          <div className="rsvp-tick"><Icon d={P.check} size={34} /></div>
          <h1 className="rsvp-title">You're registered</h1>
          <p className="rsvp-sub">
            Thank you{first ? `, ${first}` : ''}. We have your sign-up for <strong>{form.title}</strong>.
          </p>
          <button className="rsvp-again" onClick={() => { setDone(null); setValues({}); opened.current = Date.now(); }}>
            Register someone else
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="rsvp-wrap">
      <form className="rsvp-card" onSubmit={submit} ref={formRef} noValidate>
        {back}
        <h1 className="rsvp-title">{form.title}</h1>
        {form.description
          ? <p className="rsvp-sub rsvp-desc">{form.description}</p>
          : <p className="rsvp-sub">Bethesda Baptist Church</p>}

        {fields.map(f => {
          const id = `rf-${f.id}`;
          const err = errors[f.id];
          return (
            <div className="rsvp-field" key={f.id}>
              <label className="rsvp-label" htmlFor={id}>
                {f.label}{!f.required && <span className="rsvp-optional"> (optional)</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea id={id} name={f.id} className={`rsvp-input rsvp-textarea ${err ? 'bad' : ''}`} rows={4}
                  value={values[f.id] || ''} onChange={e => set(f.id, e.target.value)}
                  aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} />
              ) : (
                <input id={id} name={f.id} className={`rsvp-input ${err ? 'bad' : ''}`}
                  value={values[f.id] || ''}
                  onChange={e => set(f.id, f.type === 'number' ? e.target.value.replace(/\D/g, '').slice(0, 3) : e.target.value)}
                  enterKeyHint="next" aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined}
                  {...inputProps(f)} />
              )}
              {err && <p className="rsvp-field-error" id={`${id}-err`}>{err}</p>}
            </div>
          );
        })}

        {/* Invisible to people; a script that fills every box fills this one. */}
        <div className="rsvp-hp" aria-hidden="true">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
        </div>

        {error && <p className="rsvp-error">{error}</p>}

        <button className="rsvp-go" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Register'}
        </button>
      </form>
    </div>
  );
}
