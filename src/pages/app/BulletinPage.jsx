import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getAnnouncements, saveAnnouncement, deleteAnnouncement, genId } from '../../lib/appApi';
import { SETUP_HINT } from '../../lib/bulletinSlides';
import { listHomeEvents } from '../../lib/homeCards';
import { listPosts, isLiveNow } from '../../lib/groupPosts';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo,
  SaveState, Field, GrowText, Toggle, Alert, Loading, RowList,
} from './kit';
import {
  Workspace, ListPane, EditorPane, PreviewPane, Cols, ColA, ColB, PhoneFrame, PhoneIcon,
} from './layout';
import SlidesView, { useSlides, useWindowFileDrop, slideFormOf, cssUrl, dayWords, dateOf, notSunday } from './SlidesView';

// App → Bulletin: the announcements at the top of the app's Digital Bulletin, and (the Slides tab)
// the pictures from Sunday's screen. The Bulletin's other parts fill themselves — "This week's
// calendar" is Pillar's Calendar, and "Group Events" are the cards under Groups — so this page only
// holds what the office writes here.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4 Bulletin):
//   · the same workspace as every App page — list | editor | phone — the window's height, each pane
//     scrolling on its own (horizontal first; Jakob's law: learn one page, know them all)
//   · the phone is the member app's own Bulletin screen (BethesdaApp screens/BulletinScreen.js): its
//     title under the Back button, the dark Sunday plate, the four cream folds with the one being
//     edited open, the Email me / AirPrint boxes, the dock — drawn at the app's sizes in points and
//     scaled as one piece (css/bulletin.css, css/phone.css)
//   · both tabs' state lives here, so switching never reloads or forgets the pick (Doherty threshold)
//   · one Undo toast for the whole page; N new · / search · ⌘/Ctrl+S save now · Esc closes the drawer
//   · length counters on every announcement field — a guide, never a wall: past the number the
//     counter turns amber and says so, and everything typed or pasted is kept and saved (the app
//     server has no limits, and the old page had none)
//   · the phone's Calendar and Group Events folds count what the app counts (read once; their
//     words are the app's own), and a slides upload's trouble shows on both tabs

const formOf = (r) => ({
  title: r.title || '',
  body: r.body || '',
  tag: r.tag || '',
  date: r.date || '',
  published: r.published !== false,
});
// what the app server keeps that this page doesn't touch (an old "tap destination", say) rides along
const stripMeta = ({ _key, _saved, _error, ...rest }) => rest;

/** How long each announcement field should run (the counters; Home's cards use the same title
 *  length). A guide only: nothing is cut off, and a longer one still saves. */
export const NOTICE_MAX = { title: 80, body: 1000, tag: 24, date: 40 };

// under a field that has run past its counter: amber, like the counter, and it says nothing is lost
function TooLong({ length, max, noun }) {
  if (length <= max) return null;
  return <p className="ax-hint ax-bl-long" role="status">That’s {length - max} over {max} — it still saves, but a shorter {noun} reads better on a phone.</p>;
}

const VIEWS = [{ key: 'notices', label: 'Announcements' }, { key: 'slides', label: 'Slides' }];
const SUBTITLE = {
  notices: 'The announcements at the top of the app’s Digital Bulletin. Changes save as you type.',
  slides: 'The pictures from Sunday’s screen, in the Bulletin’s Slides fold. Changes save as you type.',
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'In the Bulletin' },
  { key: 'drafts', label: 'Drafts' },
];
// in the Bulletin: saved, and not switched off (what the app's own filter keeps)
const inBulletin = (r) => r._saved !== null && r.published !== false;

export default function BulletinPage() {
  const [view, setView] = useState('notices');
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // "the editor is what they're looking at" per tab (a narrow screen shows it instead of the list)
  const [opened, setOpened] = useState({ notices: false, slides: false });
  const [toast, undo] = useUndo();
  const slides = useSlides({ undo });

  const load = useCallback(async () => {
    setError('');
    try {
      const list = (await getAnnouncements()) || [];
      rows.load(Array.isArray(list) ? list : []);
      setPicked((p) => p ?? (list[0] ? String(list[0].id) : null));
    } catch (e) {
      rows.fail();
      setError(e.message);
    }
  }, [rows.load, rows.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const list = rows.rows || [];
  useLeaveGuard(list.some((r) => rows.dirty(r) && formOf(r).title.trim()) || slides.unsaved);

  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = formOf(r);
    try {
      await saveAnnouncement({ ...stripMeta(r), ...form });
      rows.saved(key, form, { id: r.id });
    } catch (e) {
      rows.failed(key, e.message);
      throw e;
    }
  }), [queue, rows]);

  const open = (kind) => setOpened((o) => (o[kind] ? o : { ...o, [kind]: true }));
  const close = (kind) => setOpened((o) => ({ ...o, [kind]: false }));

  function add() {
    setSearch(''); setFilter('all');   // a new draft can't hide behind a search or the "In the Bulletin" filter
    const key = rows.add({ id: genId(), title: '', body: '', tag: '', date: '', published: false }, { first: true });
    setPicked(key);
    open('notices');
  }

  async function setLive(key, on) {
    const r = rows.get(key);
    if (!r) return;
    if (on && !formOf(r).title.trim()) { setError('Give the announcement a title before it goes in the Bulletin.'); return; }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  }

  async function remove(key) {
    const r = rows.get(key);
    if (!r) return;
    const at = list.findIndex((x) => x._key === key);
    const next = list[at + 1] || list[at - 1];
    rows.remove(key);
    setPicked(next ? next._key : null);
    // a first save still on its way lands after this: let it, and delete it if it made one (rows.saved
    // records the id even for a row that's gone) — else a draft comes back on the next load
    await queue(key, async () => {});
    const id = r._saved !== null ? r.id : rows.idOf(key);
    if (id == null) return;   // never reached the server
    try {
      await queue(key, () => deleteAnnouncement(id));
    } catch (e) {
      rows.restore(stripMeta(r), at);
      setError(e.message);
      return;
    }
    undo(`“${r.title || 'Announcement'}” deleted.`, async () => {
      try {
        const back = { ...stripMeta(r), ...formOf(r) };
        await saveAnnouncement(back);
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  const shownCount = list.filter(inBulletin).length;
  const q = search.trim().toLowerCase();
  const visible = list.filter((r) => {
    if (filter === 'live' && !inBulletin(r)) return false;
    if (filter === 'drafts' && inBulletin(r)) return false;
    if (!q) return true;
    const f = formOf(r);
    return `${f.title} ${f.body} ${f.tag} ${f.date}`.toLowerCase().includes(q);
  });
  const current = list.find((r) => r._key === picked) || null;
  const tags = [...new Set(list.map((r) => String(r.tag || '').trim().toUpperCase()).filter(Boolean))].slice(0, 8);
  const loading = rows.rows === null;

  // A slide pinned to another Sunday shows only then: the phone shows the Bulletin as it will look
  // (or looked) that Sunday, so the picked slide is seen where members will see it
  const pickedSlide = view === 'slides' ? (slides.list || []).find((r) => r._key === slides.picked) || null : null;
  const pinned = pickedSlide ? slideFormOf(pickedSlide).on_date : '';
  const asOf = pinned && !notSunday(pinned) && pinned !== isoDay(sundayOf()) ? dateOf(pinned) : null;
  const folds = useOtherFolds(asOf);

  // Slides takes dropped pictures on its own tab; here a stray one is refused, never opened in place
  // of Pillar (SlidesView's own listener takes over on its tab — one listener at a time)
  useWindowFileDrop(null, view !== 'slides');

  const pickFromPhone = (kind, key) => {
    if (kind === 'slides') slides.setPicked(key); else setPicked(key);
    open(kind);
  };

  return (
    <AppShell
      title="Bulletin"
      subtitle={SUBTITLE[view]}
      tabs={{ value: view, onChange: setView, options: VIEWS, label: 'Part of the Bulletin' }}
      fill
    >
      {/* each tab's trouble stays in view on both: a slides batch keeps going on Announcements (its
          card says so), so pictures that didn't make it are said there too, one click from Slides */}
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>
      {view === 'slides' && !slides.setUp ? <Alert>{SETUP_HINT}</Alert> : null}
      {slides.error ? (
        <Alert onClose={() => slides.setError('')}>
          {view === 'slides' ? slides.error : (
            <>
              Slides: {slides.error}{' '}
              <button type="button" className="ax-bl-alert-go" onClick={() => setView('slides')}>See the slides</button>
            </>
          )}
        </Alert>
      ) : null}

      <Workspace detail={opened[view]} hasPreview>
        {view === 'slides' ? (
          <SlidesView s={slides} onOpen={() => open('slides')} onBack={() => close('slides')} />
        ) : (
          <>
            {/* New on top (the view's one filled button — Von Restorff), then search and filters (Hick:
                three choices, each with its count) */}
            <ListPane label="Announcements" newLabel="New announcement" onNew={add}
              newDisabled={loading} newHint="Waiting for the app server…"
              search={search} onSearch={setSearch} searchPlaceholder="Search announcements…"
              filters={FILTERS.map((f) => ({ ...f, count: f.key === 'all' ? list.length : f.key === 'live' ? shownCount : list.length - shownCount }))}
              filter={filter} onFilter={setFilter}
              count={loading ? null : `${list.length} announcement${list.length === 1 ? '' : 's'} · ${shownCount} in the Bulletin`}>
              {loading ? <Loading>Reaching the app server… (the first load can take up to a minute)</Loading> : (
                <>
                  <RowList
                    rows={visible}
                    picked={picked}
                    onPick={(key) => { setPicked(key); open('notices'); }}
                    empty={list.length
                      ? <div className="ax-empty"><strong>No announcements match</strong>{q ? `Nothing has “${search.trim()}” in it.` : 'Try another filter.'}</div>
                      : <div className="ax-empty"><strong>No announcements</strong>The Bulletin says “Nothing yet” until you add one.</div>}
                    renderRow={(r) => {
                      const f = formOf(r);
                      return (
                        <>
                          <span className="ax-row-main">
                            <span className={`ax-row-title${f.title.trim() ? '' : ' muted'}`}>{f.title.trim() || 'New announcement'}</span>
                            <span className="ax-row-sub">
                              {r._error ? <span className="ax-row-flag">Not saved</span>
                                : [f.tag.toUpperCase(), f.date, r._saved === null ? 'Not saved yet' : ''].filter(Boolean).join(' · ') || (f.body.trim() || 'No message')}
                            </span>
                          </span>
                          <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                            title={f.published ? 'In the Bulletin — switch off to take it out' : 'Not in the Bulletin — switch on to show it'} />
                        </>
                      );
                    }}
                  />
                  {list.length ? <p className="ax-hint ax-list-hint">The switch puts an announcement in the Bulletin or takes it out.</p> : null}
                </>
              )}
            </ListPane>

            {current ? (
              <NoticeEditor key={current._key} row={current} rows={rows} persist={persist} tags={tags}
                isNew={current._saved === null} onLive={(on) => setLive(current._key, on)} onDelete={() => remove(current._key)}
                onBack={() => close('notices')} />
            ) : (
              <EditorPane label="Announcement" onBack={() => close('notices')} backLabel="Announcements"
                empty={loading ? <Loading /> : <><strong>Pick an announcement to change it</strong>or write a new one.</>}>
                {null}
              </EditorPane>
            )}
          </>
        )}

        <PreviewPane note="The app’s Digital Bulletin">
          <BulletinPhone open={view}
            notices={{ list: rows.rows, picked }}
            slides={{ list: slides.list, picked: slides.picked }}
            folds={folds}
            onPick={pickFromPhone} onFold={setView} now={asOf} />
          {asOf ? (
            <p className="ax-hint">
              {asOf < sundayOf() ? 'As it looked on' : 'As it will look on'} {dayWords(pinned)} — the Sunday this slide belongs to.
            </p>
          ) : null}
          <p className="ax-phone-cap">
            The Bulletin’s calendar comes from <Link className="ax-link" to="/calendar">Calendar</Link>, and its Group Events
            from <Link className="ax-link" to="/app/groups">Groups</Link>.
          </p>
        </PreviewPane>
      </Workspace>
      {toast}
    </AppShell>
  );
}

function NoticeEditor({ row, rows, persist, tags, isNew, onLive, onDelete, onBack }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const ready = !!f.title.trim();
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });
  const id = (k) => `ax-bl-${k}-${key}`;

  return (
    // Fitts: the save state, the switch and Delete stay in the head, beside what they change
    <EditorPane label="Announcement" onBack={onBack} backLabel="Announcements" onSave={auto.flush}
      status={<SaveState auto={auto} waiting="Not saved — give it a title" />}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={f.published} onChange={onLive} label="In the Bulletin"
            sub={f.published ? 'Members see it now' : 'A draft — only you see it'} />
        </span>
      )}
      actions={(
        <button type="button" className="ax-headbtn danger" onClick={onDelete} aria-label="Delete announcement" title="Delete announcement">
          <Icon d={P.trash} size={18} />
        </button>
      )}>
      {/* proximity: what it says on one side, the orange tag and the day that sit above it on the other.
          No maxLength: a counter guides, it never cuts off a pasted message */}
      <Cols>
        <ColA title="Words">
          <Field label="Title" htmlFor={id('title')} count={f.title.length} max={NOTICE_MAX.title}>
            <input id={id('title')} className="ax-input title" value={f.title} autoFocus={isNew}
              placeholder="What’s happening" onChange={(e) => set('title', e.target.value)} />
            <TooLong length={f.title.length} max={NOTICE_MAX.title} noun="title" />
          </Field>
          <Field label="Message" htmlFor={id('body')} count={f.body.length} max={NOTICE_MAX.body}>
            <GrowText id={id('body')} value={f.body}
              placeholder="The details, the way you’d say them from the pulpit." onChange={(e) => set('body', e.target.value)} />
            <TooLong length={f.body.length} max={NOTICE_MAX.body} noun="message" />
          </Field>
        </ColA>
        <ColB title="Above the title">
          <Field label="Tag" htmlFor={id('tag')} hint="A word or two in orange above the title." count={f.tag.length} max={NOTICE_MAX.tag}>
            <input id={id('tag')} className="ax-input" value={f.tag} placeholder="NEW"
              onChange={(e) => set('tag', e.target.value)} />
            <TooLong length={f.tag.length} max={NOTICE_MAX.tag} noun="tag" />
            {tags.length > 0 && (
              <div className="ax-chips">
                {tags.map((t) => (
                  <button key={t} type="button" className={`ax-chip${f.tag.trim().toUpperCase() === t ? ' on' : ''}`}
                    onClick={() => set('tag', f.tag.trim().toUpperCase() === t ? '' : t)}>{t}</button>
                ))}
              </div>
            )}
          </Field>
          <Field label="When" htmlFor={id('date')} hint="As members should read it — “Every Wed.”, “Sunday, 6 PM”."
            count={f.date.length} max={NOTICE_MAX.date}>
            <input id={id('date')} className="ax-input" value={f.date} placeholder="Every Wed."
              onChange={(e) => set('date', e.target.value)} />
            <TooLong length={f.date.length} max={NOTICE_MAX.date} noun="day" />
          </Field>
          <p className="ax-hint">{f.published ? 'Changes reach phones as you make them.' : 'Switch it on to put it in the Bulletin.'}</p>
        </ColB>
      </Cols>
    </EditorPane>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

// Feather marks the Bulletin uses that the shared PhoneIcon set doesn't have (the Slides fold's
// monitor, an open fold's chevron, Email me, AirPrint) — the same 24-grid strokes as the app's
const GLYPHS = {
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>,
  'chevron-up': <polyline points="18 15 12 9 6 15" />,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
  printer: <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
};
function AppIcon({ name, size = 20, className = '' }) {
  const g = GLYPHS[name];
  if (!g) return <PhoneIcon name={name} size={size} className={className} />;
  return (
    <svg className={`ax-pa-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {g}
    </svg>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWebLink = (v) => /^https?:\/\/[^\s]+$/i.test(String(v || '').trim());

/** The Sunday the app's Bulletin covers: today if it's Sunday, otherwise the one just gone (BulletinScreen sundayOf). */
export function sundayOf(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
/** True when that Sunday has already been — every day but Sunday itself (BulletinScreen sundayHasBeen). */
export function sundayHasBeen(sunday, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime() > new Date(sunday).setHours(0, 0, 0, 0);
}

// 'YYYY-MM-DD…' → that day at midnight (BethesdaApp utils/churchCalendar fromISO)
const dayOf = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/**
 * How many events "This Week's Calendar" holds, counted as the app counts them: the rows its
 * calendar read gives (listHomeEvents — the app's fetchCalendar), less any that ended before today
 * (churchCalendar normalize), from the bulletin's Sunday to the Saturday after it (BulletinScreen
 * weekOf). So it runs from today, not from Sunday: what's already over has gone.
 */
export function weekCount(rows, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sunday = sundayOf(now);
  const end = new Date(sunday);
  end.setDate(end.getDate() + 7);
  return (rows || []).filter((e) => {
    const when = dayOf(e.start_date);
    const last = dayOf(e.end_date) || when;
    return !!when && last >= today && last >= sunday && when < end;
  }).length;
}

/**
 * How many cards "Group Events" holds: what the app's anon read gets — published and inside its
 * window (the read policy; groupPosts isLiveNow), the first 50 (its limit), each with a title
 * (utils/groupPosts clean).
 */
export function groupCount(posts, now = new Date()) {
  return (posts || []).filter((p) => isLiveNow(p, now)).slice(0, 50).filter((p) => String(p.title || '').trim()).length;
}

/**
 * The phone's two folds this page doesn't edit, counted for the day it's drawn for (`now`, or
 * today): { week, groups, ready } — each count a number, undefined while reading, null when Pillar
 * couldn't read it (the fold then says nothing rather than something invented); `ready` once the
 * first reads are in. The posts are read once; the calendar once per day drawn (a slide pinned to
 * another Sunday draws that Sunday — only its count line waits for that read, not the whole phone).
 */
function useOtherFolds(now) {
  const day = isoDay(now || new Date());
  const [events, setEvents] = useState({});   // day → rows | null
  const [posts, setPosts] = useState(undefined);
  const asked = useRef({ posts: false, days: new Set() });
  useEffect(() => {
    if (asked.current.posts) return;
    asked.current.posts = true;
    listPosts().then((p) => setPosts(Array.isArray(p) ? p : []), () => setPosts(null));
  }, []);
  useEffect(() => {
    if (asked.current.days.has(day)) return;
    asked.current.days.add(day);
    listHomeEvents(dateOf(day) || new Date())
      .then((rows) => setEvents((m) => ({ ...m, [day]: Array.isArray(rows) ? rows : [] })),
        () => setEvents((m) => ({ ...m, [day]: null })));
  }, [day]);
  const at = now || new Date();
  const rows = events[day];
  return {
    week: rows === undefined ? undefined : rows === null ? null : weekCount(rows, at),
    groups: posts === undefined ? undefined : posts === null ? null : groupCount(posts, at),
    ready: posts !== undefined && Object.keys(events).length > 0,
  };
}

// iOS's small ActivityIndicator — what React Native draws for <ActivityIndicator /> on an iPhone
// (UIActivityIndicatorView, medium): eight rounded spokes in a 20pt circle, darkest at the head,
// stepping round clockwise once a second, in text3 (BulletinScreen s.loading)
const SPOKES = [0.22, 0.3, 0.38, 0.47, 0.57, 0.68, 0.82, 1];
function ActivityIndicator() {
  return (
    <svg className="ax-bl-activity" width={20} height={20} viewBox="0 0 20 20" role="img" aria-label="Loading">
      {SPOKES.map((o, i) => <line key={i} x1="10" y1="1.75" x2="10" y2="4.75" transform={`rotate(${i * 45} 10 10)`} opacity={o} />)}
    </svg>
  );
}

const onKey = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

// A cream fold with its white icon disc (BulletinScreen Fold). `onGo`: the fold for the OTHER tab —
// clicking it on the phone opens that tab in Pillar
function Fold({ icon, title, count, open, onGo, goLabel, children }) {
  const head = (
    <>
      <span className="ax-bl-disc"><AppIcon name={icon} size={18} /></span>
      <span className="ax-bl-fold-words">
        <span className="ax-bl-fold-title">{title}</span>
        {count ? <span className="ax-bl-fold-count">{count}</span> : null}
      </span>
      <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={20} className="ax-bl-chev" />
    </>
  );
  return (
    <div className="ax-bl-fold">
      {onGo ? (
        <div className="ax-bl-fold-head" role="button" tabIndex={0} aria-label={goLabel} title={goLabel}
          onClick={onGo} onKeyDown={onKey(onGo)}>{head}</div>
      ) : <div className="ax-bl-fold-head">{head}</div>}
      {open ? <div className="ax-bl-fold-body">{children}</div> : null}
    </div>
  );
}

// keep the picked announcement or slide in view on the phone's own scroll (never the page's)
function usePickedInView(scrollRef, deps) {
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof box.querySelector !== 'function') return;
    const el = box.querySelector('.ax-pa-picked');
    if (!el) return;
    const row = typeof el.closest === 'function' ? el.closest('.ax-bl-slides') : null;
    if (row && row.scrollTo) {
      const slide = el.parentElement || el;
      const left = slide.offsetLeft;
      if (left < row.scrollLeft || left + slide.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, left - 20), behavior: 'smooth' });
    }
    let top = 0;
    let n = el;
    while (n && n !== box) { top += n.offsetTop || 0; n = n.offsetParent; }
    if (n !== box || !box.scrollTo) return;
    // under the status bar and the Back button at the top; the dock at the foot
    if (top < box.scrollTop + 110 || top + el.offsetHeight > box.scrollTop + box.clientHeight - 160) {
      box.scrollTo({ top: Math.max(0, top - 140), behavior: 'smooth' });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The member app's Digital Bulletin (BethesdaApp screens/BulletinScreen.js), light look, with the
 * fold for this tab open: what members see now, plus the one being edited even if it isn't in the
 * Bulletin yet (a blue Pillar flag says so, and a blue outline says which one is picked — Von
 * Restorff). Clicking one picks it in the list; clicking the other tab's fold opens that tab.
 *   notices / slides: { list (null while loading), picked }
 *   folds: { week, groups, ready } — the Calendar and Group Events counts (useOtherFolds): a count
 *     that is undefined (reading) or null (Pillar couldn't read it) leaves that fold's line off
 */
export function BulletinPhone({ open, notices, slides, folds = {}, onPick, onFold, now }) {
  const scroll = useRef(null);
  const sunday = sundayOf(now || new Date());
  const day = isoDay(sunday);
  const { week, groups } = folds;
  // the app draws the folds once its announcements and its calendar are in (BulletinScreen
  // `loading`); the group cards are read alongside, so their count is there when the folds are
  const loading = notices.list === null || folds.ready === false;

  const noticeRows = notices.list || [];
  const noticeCount = noticeRows.filter(inBulletin).length;
  const noticeItems = noticeRows.filter((r) => inBulletin(r) || r._key === notices.picked);

  // the app's slidesFor(): published, with a picture, pinned to this Sunday or to none
  const slideRows = slides.list || [];
  const members = (r) => {
    const f = slideFormOf(r);
    return r._saved !== null && f.published && isWebLink(f.image_url) && (!f.on_date || f.on_date === day);
  };
  const slideCount = slideRows.filter(members).length;
  const slideItems = slideRows.filter((r) => members(r) || r._key === slides.picked);

  const picked = open === 'slides' ? slides.picked : notices.picked;
  usePickedInView(scroll, [picked, open, loading]);

  return (
    <PhoneFrame dock back scrollRef={scroll} label="The app’s Digital Bulletin, on a phone">
      <div className="ax-pa-screen ax-pa-dock-space ax-bl-screen">
        {/* below the glass Back button (insets.top + useBackButtonClearance: 59 + 62) */}
        <div className="ax-pa-gutter ax-pa-top-back">
          <div className="ax-pa-title">Digital Bulletin</div>
        </div>

        {/* the nameplate: the dark panel the Bible page gives its sermon */}
        <div className="ax-bl-plate">
          <div className="ax-bl-plate-kicker">{sundayHasBeen(sunday, now || new Date()) ? 'THIS PAST SUNDAY' : 'THIS SUNDAY'}</div>
          <div className="ax-bl-plate-date">{dayWords(day)}</div>
        </div>

        {loading ? (
          <div className="ax-bl-loading"><ActivityIndicator /></div>
        ) : (
          <div className="ax-bl-folds">
            <Fold icon="bell" title="Announcements" count={noticeCount ? `${noticeCount} this week` : 'Nothing yet'}
              open={open === 'notices'} onGo={open === 'notices' ? null : () => onFold('notices')} goLabel="Edit the announcements">
              {noticeItems.length ? noticeItems.map((r) => {
                const f = formOf(r);
                const hidden = !inBulletin(r);
                const go = () => onPick('notices', r._key);
                return (
                  <div key={r._key} role="button" tabIndex={0} className={`ax-bl-notice${r._key === notices.picked ? ' ax-pa-picked' : ''}`}
                    aria-label={`Edit “${f.title.trim() || 'New announcement'}”`} onClick={go} onKeyDown={onKey(go)}>
                    <div className="ax-bl-notice-head">
                      {hidden ? <span className="ax-pa-flag">Not in the Bulletin</span> : null}
                      {f.tag ? <span className="ax-bl-tag">{f.tag.toUpperCase()}</span> : null}
                      {f.date ? <span className="ax-bl-when">{f.date}</span> : null}
                    </div>
                    <div className={`ax-bl-notice-title${f.title.trim() ? '' : ' blank'}`}>{f.title || 'Title'}</div>
                    {f.body ? <div className="ax-bl-notice-body">{f.body}</div> : null}
                  </div>
                );
              }) : <div className="ax-bl-empty">Nothing from the office yet this week.</div>}
            </Fold>

            {/* filled in by Calendar and Groups, not here: drawn closed, the way they open, with the
                app's own count lines (BulletinScreen) */}
            <Fold icon="calendar" title="This Week's Calendar" open={false}
              count={week == null ? null : week ? `${week} on the calendar` : 'Nothing on the calendar'} />
            <Fold icon="users" title="Group Events" open={false}
              count={groups == null ? null : groups ? `${groups} from the groups` : 'Nothing from the groups'} />

            <Fold icon="monitor" title="Slides"
              count={slideCount ? `${slideCount} ${slideCount === 1 ? 'slide' : 'slides'}` : 'From the service'}
              open={open === 'slides'} onGo={open === 'slides' ? null : () => onFold('slides')} goLabel="Edit the slides">
              {slideItems.length ? (
                <div className="ax-bl-slides">
                  {slideItems.map((r) => {
                    const f = slideFormOf(r);
                    const flag = r._saved === null || !f.published ? 'Not in the Bulletin'
                      : !isWebLink(f.image_url) ? 'No picture'
                        : notSunday(f.on_date) ? 'Not a Sunday'
                          : f.on_date && f.on_date !== day ? 'Another Sunday' : '';
                    const go = () => onPick('slides', r._key);
                    return (
                      <div key={r._key} className="ax-bl-slide" role="button" tabIndex={0}
                        aria-label={`Edit ${f.caption.trim() ? `“${f.caption.trim()}”` : 'this slide'}`} onClick={go} onKeyDown={onKey(go)}>
                        <div className={`ax-bl-slide-shot${r._key === slides.picked ? ' ax-pa-picked' : ''}`}
                          style={f.image_url ? { backgroundImage: cssUrl(f.image_url) } : undefined}>
                          {flag ? <span className="ax-pa-flag">{flag}</span> : null}
                        </div>
                        {f.caption.trim() ? <div className="ax-bl-slide-cap">{f.caption.trim()}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="ax-bl-empty">The slides shown in the service will appear here once the office posts them.</div>
              )}
            </Fold>
          </div>
        )}

        {/* take it with you: the Bible page's pair of cream boxes (a signed-in member on an iPhone) */}
        {!loading ? (
          <div className="ax-bl-take">
            <div className="ax-bl-take-box">
              <span className="ax-bl-take-disc"><AppIcon name="mail" size={20} /></span>
              <span className="ax-bl-take-title">Email me</span>
              <span className="ax-bl-take-sub">A copy to your inbox</span>
            </div>
            <div className="ax-bl-take-box">
              <span className="ax-bl-take-disc"><AppIcon name="printer" size={20} /></span>
              <span className="ax-bl-take-title">AirPrint</span>
              <span className="ax-bl-take-sub">Print it for the week</span>
            </div>
          </div>
        ) : null}
      </div>
    </PhoneFrame>
  );
}

