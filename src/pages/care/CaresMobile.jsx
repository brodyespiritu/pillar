import { useMemo, useState, useEffect } from 'react';
import { P, Icon } from '../../lib/icons';
import { initials } from '../../lib/members';
import { lastContacted, splitReason, upcomingCareEvents } from '../../lib/care';
import { tapOpen, tapClose, tapSelect } from '../../lib/haptics';
import { hasUnseen, markSeen, newestUpdate } from '../../lib/careSeen';
import './CaresMobile.css';

/*
 * The care list on a phone: everybody as a tile, three to a row.
 *
 * A grid answers "who are we caring for" in one glance, which a scrolling list
 * of detail cards never does. The detail moves into a sheet that comes up when
 * you tap someone, so the overview stays uncluttered.
 *
 * Tiles carry initials rather than photos. Most of the care list has no
 * directory photo, and a grid where half the tiles fall back to a letter and
 * half show a face looks broken.
 *
 * Every tile is the same grey. Colouring each one by category turned the grid
 * into a swatch chart: thirteen categories meant thirteen hues, none of which
 * ranked against the others, so the loudest colour drew the eye rather than the
 * most urgent person. Instead:
 *
 *   urgency → which section a tile sits in, plus a red ring inside it
 *   type    → a small muted glyph in the corner, from four families
 *
 * Red therefore appears only where it has been earned.
 */

/*
 * The colour a tile is filled with. Only the categories that carry clinical
 * weight get one; the rest stay plain grey, so a colour always means something.
 *
 * Hospitalized and Surgery share red because they share a section — those two
 * are the whole of Most Critical.
 *
 * Pastels, so the initials sit in the app's navy rather than white. Each tone
 * was checked twice over: against the navy, where the weakest measures 7.4:1,
 * and against the plain grey the uncoloured categories use, so a pastel never
 * reads as "no category".
 */
const FILL = {
  Hospitalized:     '#F6BCC5',   // rose
  Surgery:          '#F6BCC5',   // rose
  Cancer:           '#E3C9F0',   // lavender
  'Test/Treatment': '#BADCEE',   // sky blue
  Pain:             '#F7DBA4',   // amber
  Recovering:       '#BCE3C9',   // sage
  'Prayer Request': '#C2BEF5',   // periwinkle
};/* Legend order, so the key below the list reads the way the colours rank. */
const LEGEND = ['Hospitalized', 'Surgery', 'Cancer', 'Test/Treatment', 'Pain', 'Recovering', 'Prayer Request'];

/*
 * Initials pick their own colour by WCAG contrast rather than being hardcoded
 * white. White on lavender is 2.7:1 and on green 2.5:1 — unreadable, and this
 * congregation skews older. Deriving it means a category added later cannot
 * quietly produce illegible text.
 */
const INK = '#0B3558';
const luminance = h => {
  const c = [1, 3, 5]
    .map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/* Resolved once at load, not per render. */
const INK_ON = Object.fromEntries(Object.entries(FILL).map(
  ([k, v]) => [k, contrast(v, '#FFFFFF') >= contrast(v, INK) ? '#FFFFFF' : INK],
));

const fillOf = m => FILL[m.category] || null;

/* Most Critical is exactly these two. Not a priority flag and not a stale
 * contact date — someone in a hospital bed or heading for an operating table. */
const CRITICAL = ['Hospitalized', 'Surgery'];
const isCritical = m => m.status === 'Active' && CRITICAL.includes(m.category);


/* The newest note actually written about somebody, which is what a list of
 * people in care is scanned for. Falls back to why they are on the list when
 * nothing has been logged yet. */
const latestNote = m => {
  const noted = [...(m.contact_logs || [])]
    .filter(l => String(l.notes || '').trim())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (noted) return noted.notes.trim();
  return splitReason(m.care_notes, m.category).reason || 'Nothing logged yet';
};

const dayLabel = iso => {
  if (!iso) return 'No contact logged';
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return 'Contacted today';
  if (days === 1) return 'Contacted yesterday';
  if (days < 7) return `Contacted ${days} days ago`;
  if (days < 14) return 'Contacted last week';
  return `Contacted ${Math.floor(days / 7)} weeks ago`;
};


/* Inline because the palette is data, not a fixed set of classes — adding a
 * category should not mean adding a CSS rule. Categories with no colour fall
 * through to the stylesheet's grey. */
const fillStyle = m => {
  const c = fillOf(m);
  return c ? { background: c, color: INK_ON[m.category] } : undefined;
};


/* tel: and sms: want digits only; the shell hands them to the phone. */
const dial = p => String(p || '').replace(/[^\d+]/g, '');

export default function CaresMobile({ members, loading, onAdd, onLogContact }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);

  /* The sheet holds a snapshot; if the list reloads underneath it, follow. */
  useEffect(() => {
    if (!picked) return;
    const fresh = members.find(m => m.id === picked.id);
    if (fresh && fresh !== picked) setPicked(fresh);
  }, [members, picked]);

  useEffect(() => {
    if (!picked) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [picked]);

  useEffect(() => {
    if (!picked) return undefined;
    const onKey = e => { if (e.key === 'Escape') setPicked(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  /* Three groups, most pressing first. Sorting inside each is alphabetical —
   * the section already carries the ranking. */
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = m => !needle
      || String(m.full_name || '').toLowerCase().includes(needle)
      || String(m.category || '').toLowerCase().includes(needle);
    const byName = (a, b) =>
      String(a.full_name || '').localeCompare(String(b.full_name || ''));
    const byRecent = (a, b) => {
      const ta = lastContacted(a);
      const tb = lastContacted(b);
      if (!ta && !tb) return byName(a, b);
      if (!ta) return 1;
      if (!tb) return -1;
      return new Date(tb) - new Date(ta) || byName(a, b);
    };

    const rows = (members || []).filter(hit);
    return [
      /* The critical few keep the grid — they are meant to be looked at. The
       * rest are a list, which fits far more people per screen and leaves room
       * for the reason and the last-contact stamp. */
      { key: 'attention', title: 'Most Critical', urgent: true, layout: 'grid',
        rows: rows.filter(isCritical).sort(byName) },
      /* Most recently contacted first — this list is read to see what has just
         happened, and alphabetical order buries it. Anyone never contacted goes
         last: they have no recent contact to rank by. */
      { key: 'care', title: 'In care', urgent: false, layout: 'list',
        rows: rows.filter(m => m.status === 'Active' && !isCritical(m)).sort(byRecent) },
      { key: 'closed', title: 'Resolved', urgent: false, layout: 'list',
        rows: rows.filter(m => m.status !== 'Active').sort(byName) },
    ].filter(g => g.rows.length);
  }, [members, q]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="cm-wrap">
      <main className="cm-scroll">

        <header className="cm-head">
          <h1 className="cm-title">Cares</h1>
          <button className="cm-icon-btn" onClick={onAdd} aria-label="Add someone">
            <Icon d={P.plus} size={22} />
          </button>
        </header>

        <div className="cm-search">
          <Icon d={P.search} size={19} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setQ('')}
            placeholder="Search by name or category"
            aria-label="Search the care list"
          />
          {q && (
            <button type="button" className="cm-search-x" onClick={() => setQ('')} aria-label="Clear search">
              <Icon d={P.close} size={17} />
            </button>
          )}
        </div>

        {!loading && <CareTimeline members={members} onOpen={setPicked} />}

        {loading && <p className="cm-count">Loading…</p>}

        {!loading && total === 0 && (
          <p className="cm-empty">
            {q.trim() ? `Nobody matches “${q.trim()}”.` : 'Nobody is on the care list yet.'}
          </p>
        )}

        {groups.map(g => (
          <section key={g.key} className="cm-group">
            <h2 className={`cm-group-h ${g.urgent ? 'urgent' : ''}`}>
              {g.title}
              <span className="cm-group-n">{g.rows.length}</span>
            </h2>

            {g.layout === 'grid' ? (
              <div className="cm-grid">
                {g.rows.map(m => (
                  <button key={m.id} className="cm-tile" onClick={() => { tapOpen(); markSeen(m.id, newestUpdate(m)); setPicked(m); }}>
                    <span className="cm-sq" style={fillStyle(m)}>
                      <span className="cm-ini">{initials(m.full_name)}</span>
                      <span className="cm-bub">{m.category}</span>
                      {hasUnseen(m) && <span className="cm-new" aria-label="New update" />}
                    </span>
                    <span className="cm-name">{m.full_name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="cm-list">
                {g.rows.map(m => {
                  const note = latestNote(m);
                  return (
                    <button key={m.id} className="cm-lrow" onClick={() => { tapOpen(); markSeen(m.id, newestUpdate(m)); setPicked(m); }}>
                      <span className="cm-sq sm" style={fillStyle(m)} title={m.category}>
                        <span className="cm-ini">{initials(m.full_name)}</span>
                        {hasUnseen(m) && <span className="cm-new" aria-label="New update" />}
                      </span>
                      <span className="cm-ltxt">
                        <span className="cm-lname">{m.full_name}</span>
                        <span className="cm-lsub">{note}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}

        {/* What the outlines mean, so nobody has to guess. */}
        {!loading && total > 0 && (
          <div className="cm-key">
            {LEGEND.map(c => (
              <span key={c} className="cm-key-item">
                <span className="cm-key-dot" style={{ background: FILL[c] }} />
                {c}
              </span>
            ))}
          </div>
        )}
      </main>

      {picked && (
        <CareSheet
          member={picked}
          onClose={() => setPicked(null)}
          onLogContact={mem => { setPicked(null); onLogContact(mem); }}
        />
      )}
    </div>
  );
}

/*
 * Appointments and surgeries, as a timeline.
 *
 * The desktop version is a seven-column week grid. Seven columns on a 375px
 * phone is 53px each, which fits a date and nothing else — so this is one card
 * per event instead of one column per day, scrolling sideways in date order.
 * Same information, and the names stay readable.
 */
function CareTimeline({ members, onOpen }) {
  const events = useMemo(
    () => upcomingCareEvents(members || [], new Date(), { pastDays: 0, aheadDays: 60 }).slice(0, 12),
    [members],
  );

  /* An empty strip above the list is just a box in the way. */
  if (!events.length) return null;

  return (
    <section className="cm-tl">
      <h2 className="cm-tl-h">Appointments &amp; Surgeries</h2>
      <div className="cm-tl-row">
        {events.map((ev, i) => {
          const d = new Date(ev.ts);
          return (
            <button
              key={`${ev.member.id}-${ev.date}-${i}`}
              className={`cm-tl-card ${ev.kind === 'Surgery' ? 'surg' : ''}`}
              onClick={() => onOpen(ev.member)}
            >
              <span className="cm-tl-when">
                <span className="cm-tl-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="cm-tl-num">{d.getDate()}</span>
              </span>
              <span className="cm-tl-txt">
                <span className="cm-tl-name">{ev.member.full_name}</span>
                <span className="cm-tl-kind">
                  {/* What kind, read out of the care note — "Cardiology" or
                      "Knee Replacement" rather than four cards all saying
                      "Appointment". Falls back to the bare kind. */}
                  {ev.label || (ev.kind === 'Surgery' ? 'Surgery' : 'Appointment')}
                  {ev.time?.label ? ` \u00b7 ${ev.time.label}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── The card that comes up from the bottom ── */
function CareSheet({ member: m, onClose, onLogContact }) {
  const phone = dial(m.phone);

  /* Why they are on the list at all. */
  const opening = String(m.care_notes || '').trim() || m.category || 'Care need';

  const shortDate = iso => new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /* Newest first, and closed off with the day they joined the list so the
     timeline has a beginning rather than trailing away. */
  const timeline = [
    ...[...(m.contact_logs || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 6)
      .map(l => ({
        key: l.id,
        when: shortDate(l.created_at),
        kind: l.type || 'Update',
        note: String(l.notes || '').trim(),
      })),
    /*
     * The reason they are on the list, as the entry it actually is: the first
     * thing that happened. It used to sit above everything in large bold type,
     * which made the oldest information on the card the loudest — and put it in
     * competition with the newest, which is what anyone opening this is looking
     * for.
     */
    {
      key: 'added',
      when: m.created_at ? shortDate(m.created_at) : '',
      kind: 'Added to the care list',
      note: opening,
    },
  ];

  return (
    <div className="cm-scrim" onClick={onClose}>
      <div className="cm-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={m.full_name}>
        <button className="cm-x" onClick={() => { tapClose(); onClose(); }} aria-label="Close">
          <Icon d={P.close} size={19} />
        </button>

        <div className="cm-sheet-top">
          <span className="cm-big" style={fillStyle(m)}>
            <span className="cm-ini">{initials(m.full_name)}</span>
            <span className="cm-tag">{m.category || 'Care'}</span>
          </span>

          <h2 className="cm-sheet-name">{m.full_name}</h2>

          {/* Where they are, folded into one quiet line. It had a heading and a
              section of its own, which was a lot of furniture for six words. */}
          {(m.hospital_name || m.room_number) && (
            <p className="cm-where">
              <Icon d={P.location} size={15} />
              {[m.hospital_name, m.room_number && `Room ${m.room_number}`].filter(Boolean).join(' · ')}
            </p>
          )}

          <div className="cm-actions">
            {phone && (
              <>
                <a className="cm-act" href={`tel:${phone}`} aria-label={`Call ${m.full_name}`}>
                  <Icon d={P.phone} size={20} />
                </a>
                <a className="cm-act" href={`sms:${phone}`} aria-label={`Text ${m.full_name}`}>
                  <Icon d={P.sms} size={20} />
                </a>
              </>
            )}
            <button className="cm-act log" onClick={() => { tapSelect(); onLogContact(m); }}>
              <Icon d={P.edit} size={18} />
              Log Contact
            </button>
          </div>
          {!phone && <p className="cm-act-none">No phone number on file</p>}
        </div>

        <hr className="cm-rule" />

        <section className="cm-sec">
          <h3 className="cm-sec-h">Updates</h3>
          {timeline.length ? (
            <ol className="cm-up">
              {timeline.map((t, i) => (
                <li key={t.key} className={`cm-up-row ${i === 0 ? 'now' : ''}`}>
                  {/* The rail is drawn by the marker, not a separate element, so
                      it can never fall out of step with the rows. */}
                  <span className="cm-up-mark" aria-hidden="true" />
                  <span className="cm-up-body">
                    <span className="cm-up-head">
                      <span className="cm-up-date">{t.when}</span>
                      <span className="cm-up-kind">{t.kind}</span>
                    </span>
                    {t.note && <span className="cm-up-note">{t.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cm-sec-p muted">Nothing logged yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
