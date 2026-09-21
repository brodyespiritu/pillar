/*
 * Calendar page editor.
 *
 * Deliberately short. The calendar's substance — the week stepper, the event
 * rows, the ministry list — is built from live Pillar data, so there is nothing
 * in any of it for a person to type here. What IS editable is the banner and
 * the words wrapped around that data, and that is all this offers.
 *
 * Every field opens pre-filled from CALENDAR_DEFAULTS with the copy the site
 * ships with, so saving without touching anything is a verified no-op.
 */
import { useState, useEffect, useCallback } from 'react';
import WebsiteShell from './WebsiteShell';
import { P, Icon } from '../../lib/icons';
import { ImageSlot, Field } from './fields';
import { getPageContent, savePageContent, CALENDAR_DEFAULTS } from '../../lib/websiteContent';

export default function WebsiteCalendarPage() {
  const [form, setForm] = useState(CALENDAR_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await getPageContent('calendar');
    if (res.error) setError(res.error);
    else { setForm(res.content); setUpdatedAt(res.updatedAt); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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
    const res = await savePageContent('calendar', form);
    if (res.error) setError(res.error);
    else { setSaved(true); setTimeout(() => setSaved(false), 2600); load(); }
    setSaving(false);
  }

  const actions = (
    <>
      <a className="ap-btn" href="http://localhost:8000/calendar.html" target="_blank" rel="noreferrer">
        <Icon d={P.link} size={15} />View page
      </a>
      <button className="ap-btn primary" onClick={save} disabled={saving || loading}>
        {saving ? <><span className="ap-spinner" />Saving…</> : saved ? <><Icon d={P.check} size={15} />Saved</> : 'Save changes'}
      </button>
    </>
  );

  return (
    <WebsiteShell
      title="Calendar"
      subtitle={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : 'The public calendar page'}
      actions={actions}
    >
      {error && <div className="ap-banner error">{error}</div>}
      {loading ? <div className="ap-panel"><span className="ap-spinner" />Loading…</div> : (
        <>
          <section className="ap-panel">
            <h2 className="ap-section-title">Banner</h2>
            <ImageSlot label="Banner photo" slotName="calendar-hero" wide
              hint="Shown as a tall card on phones and a wide banner on desktop, so keep the subject near the middle."
              value={form.hero.image} onChange={v => set('hero.image', v)} />
            <div className="ap-form-grid">
              <Field label="Title" value={form.hero.title} onChange={v => set('hero.title', v)} />
              <Field label="Crop" className="ap-input wb-narrow" value={form.hero.focus}
                onChange={v => set('hero.focus', v)}
                hint="How far down the photo to centre on — 0% is the top, 100% the bottom." />
            </div>
          </section>

          <section className="ap-panel">
            <h2 className="ap-section-title">This week</h2>
            <p className="ap-hint wb-lead">
              The heading above the week list. The dates, the events and the times all
              come from the church calendar — change those in Events, not here.
            </p>
            <div className="ap-form-grid">
              <Field label="Small label" value={form.week.eyebrow} onChange={v => set('week.eyebrow', v)} />
              <Field label="Heading" value={form.week.heading} onChange={v => set('week.heading', v)} />
            </div>
          </section>

          <section className="ap-panel">
            <h2 className="ap-section-title">Subscribe block</h2>
            <p className="ap-hint wb-lead">
              The orange band at the foot of the page. The ministries listed in it are
              worked out from event categories, so they are not editable here.
            </p>
            <div className="ap-form-grid">
              <Field label="Small label" value={form.subs.eyebrow} onChange={v => set('subs.eyebrow', v)} />
              <Field label="Heading" value={form.subs.heading} onChange={v => set('subs.heading', v)} />
            </div>
            <Field label="Body" textarea rows={2}
              value={form.subs.lead} onChange={v => set('subs.lead', v)} />
          </section>

          <div className="wb-save-bar">
            <button className="ap-btn primary" onClick={save} disabled={saving}>
              {saving ? <><span className="ap-spinner" />Saving…</> : 'Save changes'}
            </button>
            <button className="ap-btn" onClick={load} disabled={saving}>Discard</button>
          </div>
        </>
      )}
    </WebsiteShell>
  );
}
