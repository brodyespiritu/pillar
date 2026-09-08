import { useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { supabase } from '../../lib/supabase';
import { CATEGORIES, RECURRENCE, catColor, saveEvent, iso } from '../../lib/calendar';
import { fetchLocations } from '../../lib/locations';
import LocationPicker from './LocationPicker';
import { useAuth } from '../../context/AuthContext';
import { useIsMobile } from '../../lib/useIsMobile';
import '../care/Modal.css';
import './Calendar.css';
import './locations.css';

export default function EventWizard({ calendar, initialDate, event, onClose, onSaved }) {
  const { user } = useAuth();
  const editing = !!event;
  /*
   * On a phone the four steps become one scrolling form. A wizard exists to
   * keep a wide screen from feeling empty; on a narrow one it just adds three
   * Continue taps and a progress bar to an event that is usually a title, a
   * date and a time.
   */
  const isMobile = useIsMobile();

  /*
   * Two questions to a card on a phone.
   *
   * It used to do the opposite: `oneForm = useIsMobile()` put every field of the
   * wizard on one scroll for phones and kept the steps for desktop, which is the
   * wrong way round — a long form is at its worst on the screen where you can
   * see least of it at once.
   *
   * A paired row counts as one question: start and end of the same date, or of
   * the same time, is one decision presented twice.
   */
  const MOBILE_STEPS = [
    ['title', 'dates'],
    ['times', 'location'],
    ['organizer', 'category'],
    ['description'],
    ['options'],
  ];
  /* Desktop keeps the four it already had. */
  const DESKTOP_STEP = {
    title: 1, dates: 1,
    times: 2, location: 2, organizer: 2,
    category: 3,
    description: 4, options: 4,
  };
  const lastStep = isMobile ? MOBILE_STEPS.length : 4;
  const show = k => (isMobile ? (MOBILE_STEPS[step - 1] || []).includes(k) : DESKTOP_STEP[k] === step);
  const [step, setStep] = useState(1);
  const [f, setF] = useState(() => ({
    title: event?.title || '',
    start_date: event?.start_date || initialDate || iso(new Date()),
    end_date: event?.end_date || '',
    start_time: event?.start_time || '',
    end_time: event?.end_time || '',
    location: event?.location || '',
    organizer: event?.organizer || '',
    category: event?.category || 'Meetings',
    description: event?.description || '',
    is_private: event?.is_private || false,
    is_recurring: event?.is_recurring || false,
    recurrence: event?.recurrence || 'Weekly',
    recurrence_end: event?.recurrence_end || '',
    request_content: false,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  /* Locations are a short list, so load once and filter in memory rather than
     querying per keystroke. A failed load leaves the picker as a plain text
     field — the wizard must never block on it. */
  const [locations, setLocations] = useState([]);
  useEffect(() => { fetchLocations().then(r => setLocations(r.rows)); }, []);

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const multiDay = f.end_date && f.end_date !== f.start_date;

  async function submit() {
    if (!f.title.trim()) { setStep(1); setError('Title is required.'); return; }
    setSaving(true); setError('');
    const { request_content, ...payload } = f;
    const { error } = await saveEvent({
      ...payload,
      id: event?.id,
      calendar,
      created_by: user?.id || null,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    onSaved();
  }

  const STEPS = ['Basics', 'Timing', 'Category', 'Extras'];   // desktop chips only

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h2>{editing ? 'Edit Event' : 'New Event'}</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="gf-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`gf-step ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'done' : ''}`}
              onClick={() => setStep(i + 1)}>
              <span className="gf-step-num">{step > i + 1 ? <Icon d={P.check} size={13} /> : i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>

        <div className="modal-body">
          {show('title') && (<>
            <p className="gf-q">What is it called?</p>
            <label className="field-group"><span>Title <b>*</b></span>
              <input value={f.title} onChange={e => set('title', e.target.value)} placeholder="Sunday Service" autoFocus />
            </label>
          </>)}

          {show('dates') && (<>
            <p className="gf-q">Which day?</p>
            <div className="field-row">
              <label className="field-group"><span>Start Date</span>
                <input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} />
              </label>
              <label className="field-group"><span>End Date (optional)</span>
                <input type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} />
              </label>
            </div>
            {multiDay && <div className="cw-multiday"><Icon d={P.calendar} size={14} />Multi-day event</div>}
          </>)}

          {show('times') && (<>
            <p className="gf-q">What time?</p>
            <div className="field-row">
              <label className="field-group"><span>Start Time</span>
                <input type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)} />
              </label>
              <label className="field-group"><span>End Time</span>
                <input type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)} />
              </label>
            </div>
          </>)}

          {show('location') && (<>
            <p className="gf-q">Where is it?</p>
            <div className="field-group"><span>Room / Location</span>
              <LocationPicker
                value={f.location}
                locations={locations}
                onChange={v => set('location', v)}
                onCreated={loc => setLocations(ls => [...ls, loc].sort((a, b) => a.name.localeCompare(b.name)))}
              />
            </div>
          </>)}

          {show('organizer') && (<>
            <p className="gf-q">Who is running it?</p>
            <label className="field-group"><span>Organizer</span>
              <input value={f.organizer} onChange={e => set('organizer', e.target.value)} placeholder="Pastor Mike" />
            </label>
          </>)}

          {show('category') && (<>
            <p className="gf-q">What kind of event?</p>
            <div className="cw-cats">
              {CATEGORIES.map(c => (
                <button key={c.key} className={`cw-cat ${f.category === c.key ? 'on' : ''}`}
                  style={{ '--cc': c.color }} onClick={() => set('category', c.key)}>
                  <span className="cw-cat-dot" />{c.key}
                </button>
              ))}
            </div>
          </>)}

          {show('description') && (<>
            <p className="gf-q">Anything to add?</p>
            <label className="field-group"><span>Description</span>
              <textarea rows={3} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Event details…" />
            </label>
          </>)}

          {show('options') && (<>
            <p className="gf-q">Anything special?</p>
            <label className="cw-check">
              <input type="checkbox" checked={f.is_private} onChange={e => set('is_private', e.target.checked)} />
              <Icon d={P.lock} size={15} /> Private event (staff only)
            </label>
            {!editing && (
              <label className="cw-check">
                <input type="checkbox" checked={f.is_recurring} onChange={e => set('is_recurring', e.target.checked)} />
                <Icon d={P.repeat} size={15} /> Recurring event
              </label>
            )}
            {f.is_recurring && !editing && (
              <div className="field-row">
                <label className="field-group"><span>Frequency</span>
                  <select value={f.recurrence} onChange={e => set('recurrence', e.target.value)}>
                    {RECURRENCE.map(r => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <label className="field-group"><span>Repeat Until</span>
                  <input type="date" value={f.recurrence_end} onChange={e => set('recurrence_end', e.target.value)} />
                </label>
              </div>
            )}
            <label className="cw-check">
              <input type="checkbox" checked={f.request_content} onChange={e => set('request_content', e.target.checked)} />
              <Icon d={P.grid} size={15} /> Request content for this event
            </label>
          </>)}

          {error && <p className="modal-error">{error}</p>}
        </div>

        <div className="modal-foot">
          {/* Both layouts are stepped now, so both get the same pair of controls
              — the only difference is how many steps there are. */}
          {step > 1
            ? <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>
            : <button className="btn-ghost" onClick={onClose}>Cancel</button>}
          {step < lastStep
            ? <button className="btn-primary" onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Event'}
              </button>}
        </div>
      </div>
    </div>
  );
}
