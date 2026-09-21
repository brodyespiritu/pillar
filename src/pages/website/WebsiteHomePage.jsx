/*
 * Home page editor.
 *
 * The sections below follow the running order of website/index.html, so what
 * you scroll past here is what a visitor scrolls past there.
 *
 * Every field is pre-filled from HOME_DEFAULTS with the copy and photos the
 * site ships with, so the form opens showing the real page rather than blanks
 * — and saving without touching anything is a verified no-op.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import WebsiteShell from './WebsiteShell';
import { P, Icon } from '../../lib/icons';
import { ImageSlot, Field } from './fields';
import {
  getPageContent, savePageContent, uploadWebsiteImage, resolveUrl, HOME_DEFAULTS,
} from '../../lib/websiteContent';


export default function WebsiteHomePage() {
  const [form, setForm] = useState(HOME_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [stripBusy, setStripBusy] = useState(false);
  const stripRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await getPageContent('home');
    if (res.error) setError(res.error);
    else { setForm(res.content); setUpdatedAt(res.updatedAt); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // set('hero.times', v) — path setter, so a nested field needs no boilerplate
  const set = (path, value) => setForm(prev => {
    const keys = path.split('.');
    const next = structuredClone(prev);
    let node = next;
    for (const k of keys.slice(0, -1)) node = node[k];
    node[keys[keys.length - 1]] = value;
    return next;
  });

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    const res = await savePageContent('home', form);
    if (res.error) setError(res.error);
    else { setSaved(true); setTimeout(() => setSaved(false), 2600); load(); }
    setSaving(false);
  }

  /* ── photo strip ── */
  async function addStripPhotos(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setStripBusy(true); setError('');
    const added = [];
    for (const file of files) {
      const res = await uploadWebsiteImage(file, 'strip');
      if (res.error) { setError(res.error); break; }
      // the strip alternates wide and tall frames; classify by what was uploaded
      added.push({ url: res.url, orientation: res.width >= res.height ? 'land' : 'port' });
    }
    if (added.length) set('strip.photos', [...(form.strip?.photos || []), ...added]);
    setStripBusy(false);
    if (stripRef.current) stripRef.current.value = '';
  }
  const removeStrip = i => set('strip.photos', form.strip.photos.filter((_, k) => k !== i));
  const moveStrip = (i, dir) => {
    const j = i + dir;
    const list = form.strip?.photos || [];
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    set('strip.photos', next);
  };

  const actions = (
    <>
      <a className="ap-btn" href="http://localhost:8000/index.html" target="_blank" rel="noreferrer">
        <Icon d={P.link} size={15} />View site
      </a>
      <button className="ap-btn primary" onClick={save} disabled={saving || loading}>
        {saving ? <><span className="ap-spinner" />Saving…</> : saved ? <><Icon d={P.check} size={15} />Saved</> : 'Save changes'}
      </button>
    </>
  );

  if (loading) {
    return <WebsiteShell title="Home page" subtitle="Loading…" actions={actions}>
      <div className="ap-loading"><span className="ap-spinner" />Loading home page content…</div>
    </WebsiteShell>;
  }

  const strip = form.strip?.photos || [];

  return (
    <WebsiteShell
      title="Home page"
      subtitle={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : 'Not saved yet — showing what the site ships with'}
      actions={actions}
    >
      {error && <div className="ap-banner error">{error}</div>}
      <p className="ap-hint wb-lead">
        Sections are in the same order a visitor meets them. These are the photos and
        wording currently on the site — replace any of them, or clear one to drop it.
      </p>

      {/* ── HERO ── */}
      <section className="ap-panel">
        <h2 className="ap-section-title">Hero</h2>
        <ImageSlot
          label="Hero photo" slotName="hero" wide
          hint="The full-screen photo behind the headline. Very wide crops lose the top and bottom — a tall photo works well."
          value={form.hero.image} onChange={v => set('hero.image', v)}
        />
        <Field
          label="Crop position" hint="How far down the photo to centre on, e.g. 46%. Lower shows more of the top."
          className="ap-input wb-narrow"
          value={form.hero.focus} onChange={v => set('hero.focus', v)}
        />
        <div className="ap-form-grid">
          <Field label="Headline — rotating words"
            hint="Shown one after another where the headline reads “Where ___”. Separate with commas."
            value={(form.hero.words || []).join(', ')}
            onChange={v => set('hero.words', v.split(',').map(s => s.trim()).filter(Boolean))} />
          <Field label="Headline — fixed part" value={form.hero.tail} onChange={v => set('hero.tail', v)} />
          <Field label="Service times line" value={form.hero.times} onChange={v => set('hero.times', v)} />
          <Field label="Address line" value={form.hero.address} onChange={v => set('hero.address', v)} />
          <Field label="Button label" value={form.hero.ctaLabel} onChange={v => set('hero.ctaLabel', v)} />
          <Field label="Button links to" hint="A page on the site, e.g. new-here.html"
            value={form.hero.ctaHref} onChange={v => set('hero.ctaHref', v)} />
        </div>
      </section>

      {/* ── WELCOME ── */}
      <section className="ap-panel">
        <h2 className="ap-section-title">Welcome statement</h2>
        <div className="ap-form-grid">
          <Field label="Small label above" value={form.intro.kicker} onChange={v => set('intro.kicker', v)} />
        </div>
        <Field label="Statement" textarea rows={3}
          hint="The large sentence. The highlighted phrase below is added to the end of it."
          value={form.intro.statement} onChange={v => set('intro.statement', v)} />
        <Field label="Highlighted phrase"
          hint="Gets the orange marker sweep as the visitor scrolls."
          value={form.intro.highlight} onChange={v => set('intro.highlight', v)} />
        <div className="ap-form-grid">
          {(form.intro.buttons || []).map((b, i) => (
            <Field key={i} label={`Button ${i + 1}`} value={b.label}
              onChange={v => set(`intro.buttons.${i}.label`, v)} />
          ))}
        </div>
        <ImageSlot label="Photo beside the statement" slotName="welcome" wide
          value={form.intro.image} onChange={v => set('intro.image', v)} />
      </section>

      {/* ── WEEKLY ACTIVITIES ── */}
      <section className="ap-panel">
        <h2 className="ap-section-title">Weekly Activities</h2>
        <Field label="Section sentence" textarea rows={2}
          value={form.ministries.lead} onChange={v => set('ministries.lead', v)} />
        {/* Three cards, fixed by the website's markup — there is no add or remove
            here on purpose. Changing one means changing what it says. */}
        <div className="wb-tiles">
          {(form.ministries.cards || []).map((c, i) => (
            <div key={i} className="wb-tile">
              <ImageSlot label={c.title || `Card ${i + 1}`} slotName={`card-${c.title || i}`} wide
                value={c.image} onChange={v => set(`ministries.cards.${i}.image`, v)} />
              <Field label="Title" value={c.title} onChange={v => set(`ministries.cards.${i}.title`, v)} />
              <Field label="When" value={c.when} onChange={v => set(`ministries.cards.${i}.when`, v)} />
              <Field label="Description" textarea rows={2}
                value={c.body} onChange={v => set(`ministries.cards.${i}.body`, v)} />
              <div className="ap-form-grid">
                <Field label="Button label" value={c.label} onChange={v => set(`ministries.cards.${i}.label`, v)} />
                <Field label="Links to" value={c.href} onChange={v => set(`ministries.cards.${i}.href`, v)} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PHOTO STRIP ── */}
      <section className="ap-panel">
        <h2 className="ap-section-title">Sliding photo strip</h2>
        <p className="ap-hint">
          The band of photos that scrolls sideways. Upload as many as you like — they
          play in the order below and loop, so reordering here reorders the strip on the site.
        </p>
        <div className="wb-strip">
          {strip.map((ph, i) => (
            <figure key={ph.url + i} className={`wb-strip-item ${ph.orientation}`}>
              <img src={resolveUrl(ph.url)} alt="" />
              <figcaption>
                <button type="button" className="ap-icon-btn" onClick={() => moveStrip(i, -1)} disabled={i === 0} title="Move earlier">←</button>
                <button type="button" className="ap-icon-btn" onClick={() => moveStrip(i, 1)} disabled={i === strip.length - 1} title="Move later">→</button>
                <button type="button" className="ap-icon-btn danger" onClick={() => removeStrip(i)} title="Remove">
                  <Icon d={P.trash} size={14} />
                </button>
              </figcaption>
            </figure>
          ))}
          <label className="wb-strip-add">
            {stripBusy ? <><span className="ap-spinner" />Uploading…</> : <><Icon d={P.plus} size={18} />Add photos</>}
            <input ref={stripRef} type="file" accept="image/*" multiple onChange={addStripPhotos} style={{ display: 'none' }} />
          </label>
        </div>
        {strip.length > 0 && (
          <p className="ap-hint">{strip.length} photo{strip.length === 1 ? '' : 's'} — replaces the site's built-in strip.</p>
        )}
      </section>

      <div className="wb-save-bar">
        <button className="ap-btn primary" onClick={save} disabled={saving}>
          {saving ? <><span className="ap-spinner" />Saving…</> : saved ? <><Icon d={P.check} size={15} />Saved</> : 'Save changes'}
        </button>
        <button className="ap-btn" onClick={load} disabled={saving}>Discard changes</button>
      </div>
    </WebsiteShell>
  );
}
