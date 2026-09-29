import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getSermons, saveSermon, deleteSermon,
  getCustomBlocks, saveCustomBlock, deleteCustomBlock,
  getResources, saveResource, deleteResource,
  uploadImage, genId,
} from '../../lib/appApi';
import {
  listSeries, saveSeries, setSeriesSort, deleteSeries,
  seriesProblems, seriesReady, cleanItems,
  listFeatured, setFeatured, notSetUp, SETUP_HINT, SERIES_LIMITS,
} from '../../lib/mediaSeries';
import { SETUP_HINT as NOTES_SETUP_HINT } from '../../lib/sermonSheets';
import NotesView, { useNotes } from './NotesView';
import { useMediaLayout } from './mediaLayout';
import { youtubePicture, youtubeThumbs } from '../../lib/youtube';
import {
  useServerList, useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo, ask,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList, ImageDrop, VideoDrop,
} from './kit';
import {
  Workspace, ListPane, EditorPane, PreviewPane, Cols, ColA, ColB, Fields, Section, SubPanel,
  SearchBox, FilterChips, PhoneFrame, PhoneIcon, usePreview, useHotkeys,
} from './layout';

// App → Watch: everything on the app's Watch tab — the sermons, the series they belong to, the
// extra videos, the resources and the fill-in-the-blank notes. One page, five views; each list works
// like the rest of App: pick, change (it saves as you type), switch on or off. Notes can go with one
// sermon, and each sermon has a button that opens (or starts) its notes.
//
// The switches decide where something shows in the app:
//   In the app          members can see it at all
//   Big card on Media   a sermon is the big card at the top of Watch (one at a time; with none, the newest)
//   Featured            it sits right below the big card
//   Suggested for You   the "Recommended" row under Featured shows only the sermons switched on here
// A series is its own row on Watch, with everything in it side by side.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4) — the laws behind the layout:
//   · Jakob's law: every view is the App section's one workspace — list · editor · phone — so the five
//     tabs work alike, and like Home, Bulletin and Groups
//   · Doherty threshold: every list (Series and Notes too) is loaded once, here, for the whole page;
//     switching tabs never asks the server again or forgets what was picked, the search typed or the
//     filter chosen, and one Undo toast serves the whole page
//   · Fitts's law: the save state, the switches and Delete sit in the editor's head beside what they
//     change; every switch stays in the head, wrapping to a second row of it on a narrow editor (the
//     approved Main and PhoneEditor mockups) — only a tablet's drawer width folds Featured, Suggested
//     and Delete under ⋯ More, as the approved Tablet mockup does
//   · Hick's law: short chip labels; rarely needed things (Add from Watch) open only when asked for
//   · Law of proximity: words on one side of the editor, pictures and video on the other
//   · Tesler's law: a new sermon is made INSIDE its series — the series word filled in, joined to the
//     series the moment it saves — instead of a trip to Sermons and back; N new, / search, ⌘S save now
//   · Von Restorff: New … is the one filled button in the list, "New sermon in this series" the one in
//     the series editor; "in the app" is green; what the phone shows for the thing picked is outlined
//   · the phone is the member app itself (BethesdaApp screens/SermonsScreen.js and
//     AllMessagesScreen.js, drawn with css/phone.css at the app's own sizes), with what's picked where
//     it really appears: the big card (its tall picture), Featured, Recommended, a series row…

const TABS = [
  { key: 'sermons', label: 'Sermons' },
  { key: 'series', label: 'Series' },
  { key: 'videos', label: 'Videos' },
  { key: 'resources', label: 'Resources' },
  { key: 'notes', label: 'Notes' },
];
const RESOURCE_TYPES = ['Series', 'Study Guide', 'Devotional', 'Podcast', 'Other'];

const sermonForm = (r) => ({
  title: r.title || '', speaker: r.speaker || '', date: r.date || '', series: r.series || '',
  duration: r.duration || '', thumbnailUrl: r.thumbnailUrl || '', thumbnailTallUrl: r.thumbnailTallUrl || '',
  videoLink: r.videoLink || '',
  mainVerse: r.mainVerse || '', notes: r.notes || '', published: r.published !== false,
});
const blockForm = (r) => ({
  title: r.title || '', subtitle: r.subtitle || '', videoUrl: r.videoUrl || '', thumbnail: r.thumbnail || '',
  playInContainer: r.playInContainer !== false, published: r.published !== false,
});
// A resource's cover. The app draws it from thumbnailUrl (BethesdaApp screens/SermonsScreen.js resCard,
// ResourceStoriesModal.js; the app's own old admin, screens/Admin/ResourceManager.js, wrote it there)
// while Pillar has always kept it as coverUrl — and the app server stores a resource exactly as it's
// sent (bethesda-admin server.js, POST /api/resources), so no cover saved from Pillar reached a phone.
// The form carries both: coverUrl is the cover the editor shows (Pillar's, else one the app's admin
// saved), thumbnailUrl what phones show; ResourceEditor's set() writes a cover under both names.
const coverOf = (r) => r.coverUrl || r.thumbnailUrl || '';
const resourceForm = (r) => ({
  title: r.title || '', subtitle: r.subtitle || '', type: r.type || 'Series',
  coverUrl: coverOf(r), thumbnailUrl: r.thumbnailUrl || '',
  link: r.link || '', published: r.published !== false,
});
const seriesForm = (r) => ({
  name: r.name || '', subtitle: r.subtitle || '', image_url: r.image_url || '',
  items: cleanItems(r.items), published: r.published === true,
});

// what a new one starts as (and it is never in the app until someone switches it on)
const SERMON_BLANK = { title: '', speaker: '', date: '', series: '', duration: '', thumbnailUrl: '', thumbnailTallUrl: '', videoLink: '', mainVerse: '', notes: '' };
const BLOCK_BLANK = { title: '', subtitle: '', videoUrl: '', thumbnail: '', playInContainer: true };
const RESOURCE_BLANK = { title: '', subtitle: '', type: 'Series', coverUrl: '', thumbnailUrl: '', link: '' };

const titled = (f) => !!String(f.title || '').trim();
const named = (f) => !!String(f.name || '').trim();
const upload = async (file) => {
  const url = await uploadImage(file);
  return url ? { url } : { error: 'The upload didn’t return an address.' };
};
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
const bg = (u) => (u ? { backgroundImage: cssUrl(u) } : undefined);
const norm = (v) => String(v || '').trim().toLowerCase();
const matches = (needle, ...values) => !needle || values.some((v) => String(v || '').toLowerCase().includes(needle));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// in the app: saved AND switched on (a sermon, video or resource; a series says published === true)
const inApp = (r) => r._saved !== null && r.published !== false;
const seriesLive = (r) => r._saved !== null && r.published === true;
// a sermon made in a series that nobody typed anything into (closing its panel takes it away again)
const blankSermon = (r, word) => Object.keys(SERMON_BLANK).every((k) => (k === 'series'
  ? ['', norm(word)].includes(norm(r.series))
  : !String(r[k] || '').trim()));
const WAITING = 'Waiting for the app server…';
const UPLOADING = 'A video is still uploading. Stop it and go on?';

/* ─────────────────────────────── the app's own words ─────────────────────────────── */

// How the member app says when and how long (BethesdaApp utils/sermonWhen.js and latestSermon.js
// adminDay — the same rules), so the phone preview reads exactly as a phone does.
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 86400000;

/** Pillar's free-text date → a day number, or null (the app's adminDay). */
export function adminDay(str) {
  const s = String(str || '').trim();
  let m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MON.indexOf(m[1].slice(0, 3).toLowerCase());
    return mo < 0 ? null : Date.UTC(+m[3], mo, +m[2]) / DAY_MS;
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return Date.UTC(+m[1], m[2] - 1, +m[3]) / DAY_MS;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return Date.UTC(+m[3], m[1] - 1, +m[2]) / DAY_MS;
  return null;
}
/** "Today" · "Yesterday" · "Sunday" · "Sep 14" · "Sep 14, 2025"; else as typed. */
export function sermonWhen(date, now = new Date()) {
  const day = adminDay(date);
  if (day == null) return String(date || '').trim();
  const ago = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS - day;
  const d = new Date(day * DAY_MS);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago > 1 && ago < 7) return DAYS[d.getUTCDay()];
  const md = `${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getFullYear() ? md : `${md}, ${d.getUTCFullYear()}`;
}
/** "42:10" → "42 min", "1:05:00" → "1 hr 5 min"; anything else as typed. */
export function shortLength(duration) {
  const s = String(duration || '').trim();
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return s;
  const mins = (+m[1] || 0) * 60 + +m[2] + (+m[3] >= 30 ? 1 : 0);
  if (mins < 1) return 'Under a minute';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} hr${mins % 60 ? ` ${mins % 60} min` : ''}`;
}
/** Speaker · when · length — whichever there are. */
export function sermonMeta(x, now = new Date()) {
  return [x?.speaker, sermonWhen(x?.date, now), shortLength(x?.duration)].filter(Boolean).join(' · ');
}
function sermonMonth(date) {
  const day = adminDay(date);
  if (day == null) return null;
  const d = new Date(day * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ── what is featured: the row right below the big card on Watch ── */

function useFeatured() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const queue = useSaveQueue();

  const load = useCallback(async () => {
    try { setRows(await listFeatured()); setSetUp(true); }
    catch (e) { setRows([]); if (notSetUp(e)) setSetUp(false); else setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = rows || [];
  const has = useCallback((id) => list.some((r) => r.item_id === String(id)), [list]);
  const toggle = (id, kind, on) => queue(`feat:${id}`, async () => {
    const key = String(id);
    const sort = (list.length + 1) * 10;
    setRows((l) => (on
      ? [...(l || []), { item_id: key, kind, sort }]
      : (l || []).filter((r) => r.item_id !== key)));
    try { await setFeatured(key, kind, on, sort); }
    catch (e) { setError(notSetUp(e) ? SETUP_HINT : e.message); load(); }
  });

  return { rows, list, has, toggle, error, setError, setUp, count: list.length };
}

/** The star beside a row, and the switch inside an editor (`chip`: the short one in an editor's head). */
function FeaturedSwitch({ feat, id, kind, saved, small, chip }) {
  const on = feat.has(id);
  const disabled = !saved || !feat.setUp;
  const title = !feat.setUp ? SETUP_HINT
    : !saved ? 'Save it first'
      : on ? 'Featured — right below the big card on Media' : 'Switch on to feature it below the big card';
  if (small) {
    return (
      <button type="button" className={`ax-star${on ? ' on' : ''}`} disabled={disabled} title={title}
        aria-pressed={on} aria-label="Featured"
        onClick={(e) => { e.stopPropagation(); feat.toggle(id, kind, !on); }}>
        <Icon d={P.star} size={16} />
      </button>
    );
  }
  return (
    <Toggle checked={on} disabled={disabled} onChange={(v) => feat.toggle(id, kind, v)} label="Featured"
      title={chip ? title : undefined}
      sub={chip ? undefined : !feat.setUp ? SETUP_HINT : on ? 'Right below the big card on Media' : 'Not below the big card'} />
  );
}

/* ─────────────────────────────── the editor head's switches ─────────────────────────────── */

/** "In the app": members see it at all — green while it's on (Von Restorff). */
function LiveSwitch({ on, onChange, chip }) {
  return (
    <span className="ax-sw-on">
      <Toggle checked={on} onChange={onChange} label="In the app"
        title={chip ? (on ? 'Members see it now — switch off to hide it' : 'Hidden — only you see it. Switch on to show it') : undefined}
        sub={chip ? undefined : on ? 'Members see it now' : 'Hidden — only you see it'} />
    </span>
  );
}

/** The big card at the top of Watch: one sermon at a time; with none, the newest. */
function BigCardSwitch({ sugg, row, chip }) {
  const big = sugg.isBig(row.id);
  const sub = big ? 'The big card at the top of Media'
    : sugg.bigCard ? 'Switch on to put this one there instead'
      : 'Switch on to put it at the top of Media — until then it’s the newest sermon';
  return (
    <Toggle checked={big} disabled={!sugg.ready || row._saved === null}
      onChange={(on) => sugg.setBig(row.id, on)} label={chip ? 'Big card' : 'Big card on Media'}
      title={chip ? `Big card on Media — ${sub}` : undefined} sub={chip ? undefined : sub} />
  );
}

/** "Suggested for You" — the app's Recommended row shows only the sermons switched on here. */
function SuggestedSwitch({ sugg, row, chip }) {
  const on = sugg.has(row.id);
  const sub = on ? 'In the Recommended row under Featured' : 'Switch on to show it there — only switched-on sermons appear';
  return (
    <Toggle checked={on} disabled={!sugg.ready || row._saved === null}
      onChange={(v) => sugg.toggle(row.id, v)} label={chip ? 'Suggested' : 'Suggested for You'}
      title={chip ? `Suggested for You — ${sub}` : undefined} sub={chip ? undefined : sub} />
  );
}

/** One icon button for the whole page (.ax-headbtn, 44 square) — Delete, Take out, More. */
function DeleteButton({ noun, onClick }) {
  return (
    <button type="button" className="ax-headbtn danger" onClick={onClick} aria-label={`Delete ${noun}`} title={`Delete ${noun}`}>
      <Icon d={P.trash} size={18} />
    </button>
  );
}

/**
 * What a tablet-wide editor head folds away, one click away under ⋯ (the approved Tablet mockup:
 * "More: Featured, Suggested, Delete"). Closes on Escape, on a click outside it, or once used.
 */
function MoreMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useHotkeys({ escape: () => setOpen(false) }, open);
  useEffect(() => {
    if (!open || typeof document === 'undefined' || !document.addEventListener) return undefined;
    const away = (e) => { if (ref.current && ref.current.contains && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div ref={ref} className="ax-watch-more">
      <button type="button" className={`ax-headbtn${open ? ' on' : ''}`} aria-expanded={open} aria-haspopup="true"
        aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        <PhoneIcon name="more-horizontal" size={20} />
      </button>
      {open ? <div className="ax-watch-menu" role="group" aria-label={label}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

/**
 * Where the sermon editor's switches go — from the workspace's own mode, never from pane widths
 * copied out of the CSS:
 *   'wide'     all four in the head (In the app, Big card, Featured, Suggested) and Delete. On a
 *              narrow editor they wrap to a second row of the head, as both approved mockups draw
 *              it — Main at a laptop's 536px editor, PhoneEditor on a phone (css/watch.css). Fitts's
 *              law: the placement switches the office uses most are never a menu away.
 *   'compact'  the phone is a drawer on a tablet-wide workspace (760–1139): In the app and Big card
 *              in view, Featured, Suggested and Delete under ⋯ More — the approved Tablet mockup,
 *              the one width where More was approved (Hick's law: the head keeps to one row there)
 */
function useHeadRoom() {
  const { drawer, narrow } = usePreview();
  return drawer && !narrow ? 'compact' : 'wide';
}

/**
 * A sub-panel's "In the app" switch (a sermon or video opened over its series) reports to its own
 * list — whose error the page shows only on that list's tab, so over a series a refusal ("Give the
 * sermon a title before members can see it.") or a failed save was silent, then turned up later,
 * stale, on the Sermons tab. The panel says it itself, right beside the switch (law of proximity),
 * and takes it away with the panel.
 */
function usePanelLive(list, key) {
  const [spoke, setSpoke] = useState(false);
  const used = useRef(false);
  const clear = useRef(list.setError);
  clear.current = list.setError;
  useEffect(() => () => { if (used.current) clear.current(''); }, []);
  return {
    setLive: (on) => { used.current = true; setSpoke(true); return list.setLive(key, on); },
    error: spoke ? list.error : '',
    dismiss: () => list.setError(''),
  };
}

/* ─────────────────────────────── series, lifted ─────────────────────────────── */

/**
 * Every series, loaded once for the page (not on each visit to the tab), with what's open over the
 * series editor (`sub`) and the sermons waiting to join a series (`joins`: sermon row → series row —
 * a sermon joins the moment it has saved, wherever the office is by then). `sermons` is the page's
 * sermons list: a sermon made inside a series is made there.
 */
function useSeries(undo, sermons) {
  const rows = useRows(seriesForm);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const [sub, setSubNow] = useState(null);
  const subNow = useRef(null);
  subNow.current = sub;
  const [joins, setJoins] = useState({});
  // the sermons made here whose first save has started: from then on each is a real sermon on the app
  // server, whatever happens to its title — never quietly dropped (it joins once that save lands)
  const sent = useRef(new Set());

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await listSeries();
      rows.load(list);
      setSetUp(true);
      setPicked((p) => p ?? (list && list[0] ? String(list[0].id) : null));
    } catch (e) {
      rows.load([]);
      if (notSetUp(e)) setSetUp(false); else setError(e.message);
    }
  }, [rows.load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const list = rows.rows;
  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = seriesForm(r);
    try {
      const saved = await saveSeries({ id: rows.idOf(key), sort: r.sort, ...form });
      rows.saved(key, form, saved);
    } catch (e) {
      rows.failed(key, notSetUp(e) ? SETUP_HINT : e.message);
      throw e;
    }
  }), [queue, rows]);

  const join = useCallback((sermonKey, seriesKey) => setJoins((j) => ({ ...j, [sermonKey]: seriesKey })), []);
  const unjoin = useCallback((sermonKey) => setJoins((j) => {
    if (!(sermonKey in j)) return j;
    const next = { ...j };
    delete next[sermonKey];
    return next;
  }), []);

  /** A sermon's save, from its editor: marks it as sent, then saves it through the sermons list. */
  const send = (key) => { sent.current.add(key); return sermons.persist(key); };

  /**
   * Close whatever is open over the series editor and open `next` (or nothing) — the ONE way the
   * panel changes: Done, Escape, picking another series, New series, deleting the series, another
   * panel, a series item, Add from Watch, "New sermon in this series" again, an "In series" chip. A
   * sermon made in it that nobody typed into, never sent to the app server, goes away again with its
   * join (it used to stay behind as an "Untitled" on Sermons, still set to join the series). One whose
   * save has started stays, even with its title cleared since: it's on the server, and it joins the
   * series once that save lands — so Pillar and the server never disagree about it.
   */
  const closeSub = (next = null) => {
    const cur = subNow.current;
    if (cur && cur.kind === 'sermon' && cur.isNew && !sent.current.has(cur.key)) {
      const r = sermons.rows.get(cur.key);
      const s = rows.get(cur.series);
      const word = cur.word ?? (s ? s.name : '');
      if (r && r._saved === null && blankSermon(r, word)) {
        sermons.rows.remove(cur.key);
        unjoin(cur.key);
      }
    }
    subNow.current = next;
    setSubNow(next);
  };

  // A new series goes at the top of the list AND at the top of Watch: its sort is below every other
  // one's, so it stays first after a reload (it used to show first here and jump to the end later).
  const add = () => {
    const all = list || [];
    const sort = all.length ? Math.min(...all.map((r) => Number(r.sort) || 0)) - 10 : 10;
    closeSub();
    const key = rows.add({ name: '', subtitle: '', image_url: '', items: [], published: false, sort }, { first: true });
    setPicked(key);
    return key;
  };

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return;
    const form = seriesForm(r);
    if (on && !seriesReady(form)) {
      setError(seriesProblems(form)[0] || 'Put at least one sermon or video in the series first.');
      return;
    }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  };

  const remove = async (key) => {
    const all = list || [];
    const r = rows.get(key);
    if (!r) return;
    const at = all.findIndex((x) => x._key === key);
    const next = all[at + 1] || all[at - 1];
    closeSub();   // before the series goes: a blank sermon made in it is still recognised by its name
    rows.remove(key);
    setPicked(next ? next._key : null);
    if (r._saved === null) return;
    try { await queue(key, () => deleteSeries(r.id)); }
    catch (e) { rows.restore(r, at); setError(e.message); return; }
    undo(`“${String(r.name || '').trim() || 'This series'}” deleted.`, async () => {
      try {
        const back = await saveSeries({ sort: r.sort, ...seriesForm(r) });
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  };

  const reorder = async (keys) => {
    rows.order(keys);
    try {
      for (let i = 0; i < keys.length; i++) {
        const id = rows.idOf(keys[i]);
        rows.patch(keys[i], { sort: (i + 1) * 10 });
        if (id) await setSeriesSort(id, (i + 1) * 10);
      }
    } catch (e) { setError(e.message); load(); }
  };

  const dirty = (list || []).some((r) => rows.dirty(r) && named(seriesForm(r)));
  return {
    rows, list, picked, setPicked, error, setError, setUp, persist, add, setLive, remove, reorder,
    sub, closeSub, send, joins, join, unjoin, dirty, load,
  };
}

/** Each tab's search and filter, kept by the page so a tab switch doesn't clear them. */
function useFinds() {
  const [all, setAll] = useState({});
  return useCallback((tab) => {
    const cur = all[tab] || {};
    const put = (k) => (v) => setAll((o) => ({ ...o, [tab]: { ...(o[tab] || {}), [k]: v } }));
    return { q: cur.q || '', show: cur.show || 'all', setQ: put('q'), setShow: put('show') };
  }, [all]);
}

/* ─────────────────────────────── the page ─────────────────────────────── */

export default function WatchPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'sermons';
  const [toast, undo] = useUndo();
  const feat = useFeatured();
  const sugg = useMediaLayout();

  const sermons = useServerList({
    get: getSermons, save: saveSermon, del: deleteSermon, formOf: sermonForm, undo, noun: 'sermon', ready: titled,
    blank: SERMON_BLANK,
  });
  const blocks = useServerList({
    get: getCustomBlocks, save: saveCustomBlock, del: deleteCustomBlock, formOf: blockForm, undo, noun: 'video', ready: titled,
    blank: BLOCK_BLANK,
  });
  const resources = useServerList({
    get: getResources, save: saveResource, del: deleteResource, formOf: resourceForm, undo, noun: 'resource', ready: titled,
    blank: RESOURCE_BLANK,
  });
  const series = useSeries(undo, sermons);
  const notes = useNotes(undo);
  const find = useFinds();
  // true while a video is on its way up (every VideoDrop on the page reports here — the Home pattern)
  const uploading = useRef(false);
  // which tab's editor is in front on a narrow screen (a row click or New; Back clears it)
  const [opened, setOpened] = useState(null);

  // Leaving the item, the tab or the editor unmounts a VideoDrop, which stops its upload — so ask first.
  // `after(fn)` runs fn at once while nothing is uploading (no pause, no question), otherwise after a
  // yes; `needed` = false skips the question (staying on the same thing unmounts nothing)
  const after = useCallback((fn, needed = true) => {
    if (!needed || !uploading.current) return fn();
    return Promise.resolve(ask(UPLOADING)).then((yes) => (yes ? fn() : undefined));
  }, []);
  const go = (t, before) => after(() => {
    if (before) before();
    setParams(t === 'sermons' ? {} : { tab: t }, { replace: true });
  });
  const openNotes = (id) => after(() => {
    setOpened('notes');
    setParams({ tab: 'notes', for: String(id) });
  });
  const openSeries = (key) => go('series', () => { series.setPicked(key); series.closeSub(); setOpened('series'); });

  // ask before the tab closes while anything with a title or a name hasn't reached the server — now
  // series and notes too (they weren't covered)
  const dirtyTitled = (l) => (l.rows.rows || []).some((r) => l.rows.dirty(r) && String(r.title || '').trim());
  useLeaveGuard(dirtyTitled(sermons) || dirtyTitled(blocks) || dirtyTitled(resources) || series.dirty || notes.dirty);

  // everything a series can hold, in one list
  const library = useMemo(() => [
    ...(sermons.rows.rows || []).filter((r) => r._saved !== null).map((r) => ({
      id: String(r.id), key: r._key, kind: 'sermon', title: String(r.title || '').trim() || 'Untitled',
      sub: [r.speaker, r.date].filter(Boolean).join(' · '), date: r.date, speaker: r.speaker, word: r.series,
      thumb: r.thumbnailUrl, live: r.published !== false,
    })),
    ...(blocks.rows.rows || []).filter((r) => r._saved !== null).map((r) => ({
      id: String(r.id), key: r._key, kind: 'video', title: String(r.title || '').trim() || 'Untitled',
      sub: r.subtitle || 'Video', word: '', thumb: r.thumbnail, live: r.published !== false,
    })),
  ], [sermons.rows.rows, blocks.rows.rows]);
  // 'loading' while the app server hasn't answered: a series' items then say "Loading…", never "deleted"
  const libraryState = sermons.rows.rows === null || blocks.rows.rows === null ? 'loading' : library.length ? 'ready' : 'empty';

  // A sermon made inside a series joins it the moment it has saved (it needs a title): its
  // { id, kind: 'sermon' } goes on the end of the series' items and the series saves. Watched here, not
  // in the panel, so it still happens after Done or a switch to another tab.
  useEffect(() => {
    Object.entries(series.joins).forEach(([sermonKey, seriesKey]) => {
      const s = sermons.rows.get(sermonKey);
      if (s && s._saved === null) return;   // not saved yet
      series.unjoin(sermonKey);
      const r = s ? series.rows.get(seriesKey) : null;
      if (!r) return;                       // the sermon or the series went before it saved
      const id = String(s.id);
      // added to the series' items as they are NOW (functional, like every change to them)
      let added = false;
      series.rows.patch(seriesKey, (row) => {
        const items = cleanItems(row.items);
        if (items.some((i) => i.id === id)) return {};
        added = true;
        return { items: [...items, { id, kind: 'sermon' }] };
      });
      if (added && named(seriesForm(r))) series.persist(seriesKey).catch(() => {});
    });
  }, [sermons.rows.rows, series.joins]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedSermons = useMemo(() => (sermons.rows.rows || []).filter((r) => r._saved !== null), [sermons.rows.rows]);
  // which sermons have fill-in notes: straight from the notes the page already holds (it used to ask
  // the database again each time Sermons opened)
  const hasNotes = (id) => (notes.list || []).some((r) => r._saved !== null && String(r.sermon_id || '') === String(id));
  // the series a sermon or video is in (the editor's "In series" chips)
  const seriesOf = (id) => (series.list || []).filter((r) => cleanItems(r.items).some((i) => i.id === String(id)));

  // what the phone preview draws: everything as it is now, typed changes included
  const phone = {
    sermons: sermons.rows.rows || [], blocks: blocks.rows.rows || [], resources: resources.rows.rows || [],
    layout: { featuredSermonId: sugg.bigCard, suggestedIds: sugg.ids, resourcesOrder: sugg.resourcesOrder },
    // the app falls back to its own arrangement when the Series / Featured tables aren't there
    featured: feat.setUp ? feat.list : null,
    series: series.setUp ? series.list || [] : null,
  };

  const tabError = { sermons: sermons.error, videos: blocks.error, resources: resources.error, series: series.error, notes: notes.error }[tab];
  const error = tabError || feat.error || sugg.error;
  const clear = () => {
    feat.setError('');
    sugg.setError('');
    ({ sermons, videos: blocks, resources, series, notes })[tab].setError('');
  };

  const w = {
    sermons, blocks, resources, series, notes, feat, sugg, library, libraryState, uploading, after,
    opened, setOpened, find, openNotes, openSeries, hasNotes, seriesOf, phone,
  };

  return (
    <AppShell title="Watch" subtitle="Everything on the app’s Watch tab · changes save as you type"
      tabs={{ value: tab, onChange: (t) => { if (t !== tab) go(t); }, options: TABS }} fill>
      <Alert onClose={error ? clear : null}>{error}</Alert>
      {/* Series and Featured share one SQL file. Without it the Featured switches (list stars, the
          editor head's chip) are off — and the chip has no room for the reason under it, so Sermons
          and Videos say it here, as Series does for its own table */}
      {(tab === 'series' && !series.setUp) || ((tab === 'sermons' || tab === 'videos') && !feat.setUp)
        ? <Alert>{SETUP_HINT}</Alert> : null}
      {tab === 'notes' && !notes.setUp ? <Alert>{NOTES_SETUP_HINT}</Alert> : null}

      {tab === 'sermons' ? <SermonsView w={w} /> : null}
      {tab === 'series' ? <SeriesView w={w} /> : null}
      {tab === 'videos' ? <VideosView w={w} /> : null}
      {tab === 'resources' ? <ResourcesView w={w} /> : null}
      {tab === 'notes' ? (
        <NotesView notes={notes} sermons={savedSermons} busyRef={uploading} after={after}
          opened={opened === 'notes'} setOpened={(on) => setOpened(on ? 'notes' : null)} find={find('notes')} />
      ) : null}
      {toast}
    </AppShell>
  );
}

/* ─────────────────────────────── sermons ─────────────────────────────── */

const sermonThumb = (r) => r.thumbnailUrl;   // the list shows the wide picture, the one on every card

function SermonsView({ w }) {
  const { sermons: list, feat, sugg } = w;
  const { q, setQ, show, setShow } = w.find('sermons');
  const rows = list.rows.rows;
  const all = rows || [];
  const needle = norm(q);
  const tests = {
    all: () => true, live: inApp, drafts: (r) => !inApp(r),
    big: (r) => sugg.isBig(r.id), featured: (r) => feat.has(r.id), suggested: (r) => sugg.has(r.id),
  };
  const shown = all.filter((r) => (tests[show] || tests.all)(r) && matches(needle, r.title, r.speaker, r.series));
  const current = all.find((r) => r._key === list.picked) || null;
  const live = all.filter(inApp).length;

  const pick = (key) => w.after(() => {
    list.setPicked(key);
    w.setOpened('sermons');
  }, key !== list.picked);
  const add = () => w.after(() => {
    setQ('');
    setShow('all');
    list.add(genId());
    w.setOpened('sermons');
  });
  const filters = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'live', label: 'In the app', count: live },
    { key: 'drafts', label: 'Drafts', count: all.length - live },
    { key: 'big', label: 'Big card' },
    { key: 'featured', label: 'Featured', count: all.filter((r) => feat.has(r.id)).length },
    { key: 'suggested', label: 'Suggested', count: all.filter((r) => sugg.has(r.id)).length },
  ];
  const model = watchModel(w.phone, current ? { kind: 'sermon', id: current.id } : null);

  return (
    <Workspace detail={w.opened === 'sermons'} hasPreview className="ax-watch">
      {/* New waits for the list: the load replaces every row, so one made before it lands was wiped
          (its typing lost) — the old view showed no New until then either (Hick: it says why) */}
      <ListPane label="Sermons" newLabel="New sermon" onNew={add}
        newDisabled={rows === null} newHint={rows === null ? WAITING : undefined}
        search={q} onSearch={setQ} searchPlaceholder="Search title, speaker, series…"
        filters={filters} filter={show} onFilter={setShow}
        count={rows === null ? null : `${plural(all.length, 'sermon')} · ${live} in the app`}>
        {rows === null ? <Loading>Reaching the app server… (the first load can take up to a minute)</Loading> : (
          <RowList rows={shown} picked={list.picked} onPick={pick}
            empty={<div className="ax-empty">{all.length ? 'No sermons match.' : <><strong>No sermons</strong>Add the first one.</>}</div>}
            renderRow={(r) => {
              const pic = sermonThumb(r);
              return (
                <>
                  <span className="ax-thumb" style={bg(pic)}>{!pic && <Icon d={P.play} size={18} />}</span>
                  <span className="ax-row-main">
                    <span className={`ax-row-title${titled(r) ? '' : ' muted'}`}>{String(r.title || '').trim() || 'Untitled'}</span>
                    <span className="ax-row-sub">
                      {r._error ? <span className="ax-row-flag">Not saved</span>
                        : r._saved === null ? 'Not saved yet'
                          : [r.speaker, r.date, sugg.isBig(r.id) && 'Big card', sugg.has(r.id) && 'Suggested'].filter(Boolean).join(' · ') || 'No speaker or date yet'}
                    </span>
                  </span>
                  <FeaturedSwitch small feat={feat} id={r.id} kind="sermon" saved={r._saved !== null} />
                  <Toggle small checked={r.published !== false} onChange={(on) => list.setLive(r._key, on)}
                    title={r.published !== false ? 'Members see it — switch off to hide it' : 'Hidden — switch on to show it'} />
                </>
              );
            }} />
        )}
      </ListPane>

      {current ? <SermonEditor key={current._key} row={current} w={w} onBack={() => w.setOpened(null)} /> : (
        <EditorPane label="Sermon" onBack={() => w.setOpened(null)} backLabel="Sermons"
          empty={rows === null ? 'Reaching the app server…' : <><strong>Pick a sermon to change it</strong>or add a new one.</>} />
      )}

      <PreviewPane note={model.screen === 'all' ? 'Watch → All messages' : 'Watch tab'}>
        <WatchPhone model={model} />
        <PlaceCaption model={model} none="Pick a sermon to see where it shows." />
        <p className="ax-hint">The big card is the sermon switched on as “Big card on Media” — or, with none, the newest. Featured sits right under it; Recommended shows only the sermons switched on as “Suggested for You”.</p>
      </PreviewPane>
    </Workspace>
  );
}

/**
 * One sermon: the words on one side, the video and pictures on the other. `mode` 'pane' is the Sermons
 * tab's editor (switches in the head); 'sub' is the same editor in a panel over a series, for a sermon
 * made or opened there (its own save state and Done; the switches under the fields). `joining`: the
 * series a new sermon joins — { name, at, joined }.
 */
function SermonEditor({ row, w, mode = 'pane', onBack, onDone, joining }) {
  const list = w.sermons;
  const { feat, sugg } = w;
  const key = row._key;
  const f = sermonForm(row);
  const set = (k, v) => list.rows.patch(key, { [k]: v });
  // saved through the series hook, which notes that it went (a sermon made in a series is then kept
  // when its panel closes, whatever its title is by then — useSeries closeSub)
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => w.series.send(key) });
  const saved = row._saved !== null;
  const room = useHeadRoom();
  const panel = usePanelLive(list, key);

  // A YouTube link and no picture yet: the video's own goes in, and saves like anything typed (user,
  // 2026-09-21: "if I use a link for a sermon video in pillar, can you pull the thumbnail?"). A file
  // uploaded here gets a still from the video itself (onStill, below). A linked file can't: the
  // church's bucket doesn't let a browser read its frames.
  const yt = youtubeThumbs(f.videoLink);
  const [ytPicture, setYtPicture] = useState(null);
  useEffect(() => {
    setYtPicture(null);
    if (!yt) return undefined;
    let alive = true;
    youtubePicture(f.videoLink).then((url) => {
      if (!alive || !url) return;
      setYtPicture(url);
      list.rows.patch(key, (r) => (r.thumbnailUrl ? {} : { thumbnailUrl: url }));
    });
    return () => { alive = false; };
  }, [f.videoLink]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hasNotes = w.hasNotes(row.id);
  const inSeries = saved ? w.seriesOf(row.id) : [];
  const remove = () => w.after(() => {
    list.remove(key);
  });

  const cols = (
    <Cols>
      <ColA title="Words">
        <Field label="Title">
          <input className="ax-input title" value={f.title} autoFocus={mode === 'pane' && !saved} placeholder="The sermon’s title"
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Fields min={128}>
          <Field label="Speaker"><input className="ax-input" value={f.speaker} onChange={(e) => set('speaker', e.target.value)} /></Field>
          <Field label="Date"><input className="ax-input" value={f.date} placeholder="Sep 14, 2026" onChange={(e) => set('date', e.target.value)} /></Field>
        </Fields>
        <Fields min={116}>
          <Field label="Series word" hint={joining && norm(f.series) === norm(joining.name) ? 'Filled in from the series.' : 'A word on the card, not a Series row.'}>
            <input className="ax-input" value={f.series} onChange={(e) => set('series', e.target.value)} />
          </Field>
          <Field label="Length"><input className="ax-input" value={f.duration} placeholder="42 min" onChange={(e) => set('duration', e.target.value)} /></Field>
          <Field label="Main verse"><input className="ax-input" value={f.mainVerse} placeholder="Book 1:1" onChange={(e) => set('mainVerse', e.target.value)} /></Field>
        </Fields>
        <Field label="Notes" hint="Shown with the sermon in the app.">
          <GrowText value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <Field label="Fill-in notes" hint={!saved
          ? 'Give the sermon a title first. Then write an outline with blanks that members fill in while they watch.'
          : hasNotes ? 'Members open them from this sermon in the app.' : 'An outline with blanks that members fill in while they watch.'}>
          <button type="button" className="ax-btn fit" disabled={!saved} onClick={() => w.openNotes(row.id)}>
            <Icon d={P.doc} size={16} />{hasNotes ? 'Open this sermon’s notes' : 'Write notes for this sermon'}
          </button>
        </Field>
        {mode === 'pane' ? (
          // the Series rows it's in (derived from their items — the series word above is only a word)
          <Field label="In series" hint={!saved ? 'Once it’s saved, put it in a series from the Series tab.'
            : inSeries.length ? 'Click one to open that series.' : 'Not in a series yet. Series → Add from Watch puts it in one.'}>
            {inSeries.length ? (
              <div className="ax-watch-chips">
                {inSeries.map((sr) => (
                  <button key={sr._key} type="button" className="ax-watch-chip" onClick={() => w.openSeries(sr._key)}
                    title={`Open “${String(sr.name || '').trim() || 'Untitled series'}” on the Series tab`}>
                    <Icon d={P.layers} size={15} />{String(sr.name || '').trim() || 'Untitled series'}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
        ) : null}
      </ColA>
      <ColB title="Media">
        <Field label="Video">
          <VideoDrop value={f.videoLink} onChange={(u) => set('videoLink', u)} busyRef={w.uploading}
            onStill={async (blob) => {
              if (list.rows.get(key)?.thumbnailUrl) return;
              try {
                const url = await uploadImage(new File([blob], 'still.jpg', { type: 'image/jpeg' }));
                if (url) list.rows.patch(key, (r) => (r.thumbnailUrl ? {} : { thumbnailUrl: url }));
              } catch { /* the still is a nicety */ }
            }} />
        </Field>
        {/* Two pictures for one sermon (user, 2026-09-22: "give the user two options to upload a
            thumbnail. A vertical and horizontal one. vertical is not required"). The wide one is the
            picture the app has always used; the tall one is for the big card at the top of Watch and
            can be left empty, in which case the wide one is used. */}
        <div className="ax-row2">
          <Field label="Thumbnail · wide" hint={yt ? 'From a YouTube link, the video’s own picture goes in by itself.' : '16:9, the picture on every card.'}>
            <ImageDrop value={f.thumbnailUrl} onChange={(u) => set('thumbnailUrl', u)} upload={upload} />
            {ytPicture && f.thumbnailUrl && f.thumbnailUrl !== ytPicture ? (
              <button type="button" className="ax-btn fit" onClick={() => set('thumbnailUrl', ytPicture)}>
                <Icon d={P.play} size={16} />Use the video’s picture
              </button>
            ) : null}
          </Field>
          <Field label="Thumbnail · tall (optional)" hint="Upright, for the big card at the top of Watch. Left empty, the wide one is used.">
            <ImageDrop value={f.thumbnailTallUrl} onChange={(u) => set('thumbnailTallUrl', u)} upload={upload} tall
              label="Choose an upright photo" />
          </Field>
        </div>
      </ColB>
    </Cols>
  );

  const liveSwitch = (chip) => <LiveSwitch chip={chip} on={f.published} onChange={(on) => list.setLive(key, on)} />;
  const bigSwitch = (chip) => <BigCardSwitch chip={chip} sugg={sugg} row={row} />;
  const featSwitch = (chip) => <FeaturedSwitch chip={chip} feat={feat} id={row.id} kind="sermon" saved={saved} />;
  const suggSwitch = (chip) => <SuggestedSwitch chip={chip} sugg={sugg} row={row} />;

  if (mode === 'sub') {
    const line = !joining ? 'The same sermon as on the Sermons tab — changes save as you type.'
      : joining.joined ? `In “${joining.name}” as #${joining.at}.`
        : `Joins “${joining.name}” as #${joining.at} the moment it has a title.`;
    return (
      <SubPanel title={joining ? 'New sermon' : (f.title.trim() || 'Untitled sermon')} sub={line} className="ax-watch-sub"
        status={<SaveState auto={auto} waiting="Not saved — give the sermon a title" saved={joining && joining.joined ? 'Saved · added to the series' : 'Saved'} />}
        onDone={onDone} onSave={auto.flush}>
        {cols}
        <Section title="Where it shows in the app" right="Everything the Sermons tab has is here too.">
          <Alert onClose={panel.error ? panel.dismiss : null}>{panel.error}</Alert>
          <div className="ax-watch-switches">
            <LiveSwitch on={f.published} onChange={panel.setLive} />{bigSwitch(false)}{featSwitch(false)}{suggSwitch(false)}
          </div>
        </Section>
      </SubPanel>
    );
  }

  // Fitts: every switch in the head, beside what it changes (wrapping to a second row of the head on
  // a narrow editor — css/watch.css); only a tablet's drawer width folds three under More (Hick)
  const more = room === 'compact' ? (
    <MoreMenu label="More: Featured, Suggested, Delete">
      {(close) => (
        <>
          {featSwitch(false)}
          {suggSwitch(false)}
          <hr />
          <button type="button" className="ax-btn danger block" onClick={() => { close(); remove(); }}>
            <Icon d={P.trash} size={16} />Delete sermon
          </button>
        </>
      )}
    </MoreMenu>
  ) : null;
  return (
    <EditorPane label="Sermon" onBack={onBack} backLabel="Sermons" onSave={auto.flush}
      status={<SaveState auto={auto} waiting="Not saved — give the sermon a title" />}
      switches={(
        <>
          {liveSwitch(true)}
          {bigSwitch(true)}
          {room === 'wide' ? <>{featSwitch(true)}{suggSwitch(true)}</> : null}
        </>
      )}
      actions={more || <DeleteButton noun="sermon" onClick={remove} />}>
      {cols}
    </EditorPane>
  );
}

/* ─────────────────────────────── series: each one is its own row on Watch ─────────────────────────────── */

function SeriesView({ w }) {
  const s = w.series;
  const { q, setQ, show, setShow } = w.find('series');
  const list = s.list;
  const all = list || [];
  const needle = norm(q);
  const tests = { all: () => true, live: seriesLive, drafts: (r) => !seriesLive(r) };
  const shown = all.filter((r) => (tests[show] || tests.all)(r) && matches(needle, r.name, r.subtitle));
  const current = all.find((r) => r._key === s.picked) || null;
  // dragging works on the whole list, so only while nothing is hidden by a search or a filter
  const sortable = !needle && show === 'all';
  const live = all.filter(seriesLive).length;

  const pick = (key) => w.after(() => {
    s.setPicked(key);
    s.closeSub();
    w.setOpened('series');
  }, key !== s.picked);
  const add = () => w.after(() => {
    setQ('');
    setShow('all');
    s.add();
    w.setOpened('series');
  });
  const filters = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'live', label: 'In the app', count: live },
    { key: 'drafts', label: 'Drafts', count: all.length - live },
  ];
  const model = watchModel(w.phone, current ? { kind: 'series', id: current.id ?? current._key } : null);

  return (
    <Workspace detail={w.opened === 'series'} hasPreview className="ax-watch">
      {/* New waits for the list (its load replaces every row) and for the table itself */}
      <ListPane label="Series" newLabel="New series" onNew={add} newDisabled={!s.setUp || list === null}
        newHint={!s.setUp ? SETUP_HINT : list === null ? 'Loading the series…' : undefined}
        search={q} onSearch={setQ} searchPlaceholder="Search series…"
        filters={filters} filter={show} onFilter={setShow}
        count={list === null ? null : `${all.length} series · ${live} on Media`}>
        {list === null ? <Loading /> : (
          <>
            <RowList rows={shown} picked={s.picked} onPick={pick} onMove={sortable ? s.reorder : undefined}
              empty={<div className="ax-empty">{all.length ? 'No series match.' : <><strong>No series yet</strong>Make one and it becomes its own row on Media.</>}</div>}
              renderRow={(r) => {
                const f = seriesForm(r);
                const sermonsIn = f.items.filter((i) => i.kind === 'sermon').length;
                const videosIn = f.items.length - sermonsIn;
                return (
                  <>
                    <span className="ax-thumb" style={bg(f.image_url)}>{!f.image_url && <Icon d={P.layers} size={18} />}</span>
                    <span className="ax-row-main">
                      <span className={`ax-row-title${named(f) ? '' : ' muted'}`}>{f.name.trim() || 'Untitled series'}</span>
                      <span className="ax-row-sub">
                        {r._error ? <span className="ax-row-flag">Not saved</span>
                          : r._saved === null ? 'Not saved yet'
                            : f.items.length ? [sermonsIn && plural(sermonsIn, 'sermon'), videosIn && plural(videosIn, 'video')].filter(Boolean).join(' · ')
                              : 'Nothing in it yet'}
                      </span>
                    </span>
                    <Toggle small checked={f.published} onChange={(on) => s.setLive(r._key, on)}
                      title={f.published ? 'On Media — switch off to hide the row' : 'Hidden — switch on to show the row'} />
                  </>
                );
              }} />
            {!sortable && shown.length > 1 ? <p className="ax-hint ax-watch-listhint">Clear the search and the filter to drag the series into order.</p> : null}
          </>
        )}
      </ListPane>

      {current ? <SeriesEditor key={current._key} row={current} w={w} onBack={() => w.setOpened(null)} /> : (
        <EditorPane label="Series" onBack={() => w.setOpened(null)} backLabel="Series"
          empty={list === null ? 'Loading…' : <><strong>Pick a series to change it</strong>or make a new one.</>} />
      )}

      <PreviewPane note="Watch tab · the series row">
        <WatchPhone model={model} />
        <PlaceCaption model={model} none="Pick a series to see its row." />
      </PreviewPane>
    </Workspace>
  );
}

function SeriesEditor({ row, w, onBack }) {
  const s = w.series;
  const key = row._key;
  const f = seriesForm(row);
  const set = (k, v) => s.rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: named(f), save: () => s.persist(key) });
  const nameRef = useRef(null);
  const [needName, setNeedName] = useState(false);

  const items = f.items;
  // Every change to the items (drag, Take out, Add from Watch) is made to the series' items as they are
  // at that moment, not to this render's copy: a sermon made in the series joins it straight after its
  // save lands (WatchPage's join effect), and a click in between would otherwise write it back out.
  const put = (edit) => s.rows.patch(key, (r) => ({ items: edit(cleanItems(r.items)) }));
  const byId = new Map(w.library.map((x) => [x.id, x]));
  const sub = s.sub && s.sub.series === key ? s.sub : null;
  const subSermon = sub && sub.kind === 'sermon' ? (w.sermons.rows.rows || []).find((r) => r._key === sub.key) || null : null;
  const subVideo = sub && sub.kind === 'video' ? (w.blocks.rows.rows || []).find((r) => r._key === sub.key) || null : null;
  const waiting = w.sermons.rows.rows === null;

  // what the office sees for each thing in the series — never "deleted" while the app server's
  // library is still on its way (or came back empty)
  const info = (it) => {
    const x = byId.get(it.id);
    if (x) {
      return { x, title: x.title, sub: !x.live ? 'Hidden in the app' : it.kind === 'video' ? 'Video' : ['Sermon', x.date].filter(Boolean).join(' · ') };
    }
    if (w.libraryState === 'loading') return { title: 'Loading…', sub: 'Waiting for the app server', wait: true };
    if (w.libraryState === 'empty') return { title: 'Not found yet', sub: 'The app server sent no sermons or videos', wait: true };
    return { title: 'No longer on Watch', sub: 'It was deleted — take it out', gone: true };
  };

  // another panel over this one unmounts whatever was open (and its upload), so that asks first
  const openSub = (next) => w.after(() => s.closeSub(next), !!s.sub);
  // Tesler: make the sermon right here. It's created through the page's sermons list (so it's on the
  // Sermons tab too), with the series word filled in and not in the app yet, and it joins the series
  // the moment it has saved (WatchPage, the joins effect). With no name yet, the button says so and
  // puts the cursor in the Name field instead of doing nothing.
  const newSermon = () => {
    if (!named(f)) {
      setNeedName(true);
      if (nameRef.current && nameRef.current.focus) nameRef.current.focus();
      return undefined;
    }
    if (waiting) return undefined;
    return w.after(() => {
      const word = f.name.trim();
      const sermonKey = w.sermons.rows.add({ id: genId(), ...SERMON_BLANK, series: word, published: false }, { first: true });
      s.join(sermonKey, key);
      // `word`: the series word it was filled in with, so closing can tell nobody typed into it
      s.closeSub({ kind: 'sermon', key: sermonKey, series: key, isNew: true, word });
    }, !!s.sub);
  };
  // Done, Escape or a click beside the panel (a blank new sermon goes away with it — useSeries closeSub)
  const done = () => w.after(() => s.closeSub());
  const remove = () => w.after(() => {
    s.remove(key);
  });

  const at = subSermon ? items.findIndex((i) => i.id === String(subSermon.id)) : -1;
  const joining = sub && sub.isNew && subSermon ? { name: f.name.trim(), at: at >= 0 ? at + 1 : items.length + 1, joined: at >= 0 } : null;
  const itemRows = items.map((it, i) => ({ ...it, _key: it.id, at: i }));

  return (
    <EditorPane label="Series" onBack={onBack} backLabel="Series" onSave={auto.flush}
      status={<SaveState auto={auto} waiting="Not saved — give the series a name" />}
      switches={<LiveSwitch chip on={f.published} onChange={(on) => s.setLive(key, on)} />}
      actions={<DeleteButton noun="series" onClick={remove} />}>
      <Cols>
        <ColA title="The series">
          <Field label="Name" hint="The row’s title on Media." count={f.name.length} max={SERIES_LIMITS.name}>
            <input ref={nameRef} className="ax-input title" value={f.name} autoFocus={row._saved === null} placeholder="A series name"
              maxLength={SERIES_LIMITS.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Line under it" count={f.subtitle.length} max={SERIES_LIMITS.subtitle}>
            <input className="ax-input" value={f.subtitle} maxLength={SERIES_LIMITS.subtitle}
              onChange={(e) => set('subtitle', e.target.value)} />
          </Field>
          <Field label="Cover" hint="Used when something in the series has no picture of its own.">
            <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={upload} />
          </Field>
        </ColA>
        <ColB title={`In this series${items.length ? ` · ${items.length}` : ''}`}
          right={items.length > 1 ? 'Plays in this order · drag, or Alt + ↑/↓' : 'Plays in this order'}>
          {items.length === 0 ? (
            <p className="ax-hint">Nothing yet — make a new sermon for it, or add one that’s already on Watch.</p>
          ) : (
            <div className="ax-watch-items">
              <RowList rows={itemRows} picked={sub && sub.kind !== 'add' && (subSermon || subVideo) ? String((subSermon || subVideo).id) : null}
                onPick={(id) => {
                  const it = items.find((i) => i.id === id);
                  const x = byId.get(id);
                  if (it && x) openSub({ kind: it.kind, key: x.key, series: key });
                }}
                onMove={(keys) => put((now) => [
                  ...keys.map((k) => now.find((i) => i.id === k)).filter(Boolean),
                  ...now.filter((i) => !keys.includes(i.id)),   // one that joined since the drag began stays, at the end
                ])}
                renderRow={(it) => {
                  const x = info(it);
                  const pic = x.x ? x.x.thumb : '';
                  return (
                    <>
                      <span className="ax-num">{it.at + 1}</span>
                      <span className="ax-thumb" style={bg(pic)}>{!pic && <Icon d={it.kind === 'video' ? P.play : P.doc} size={16} />}</span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${x.wait || x.gone ? ' muted' : ''}`}>{x.title}</span>
                        <span className="ax-row-sub">{x.gone ? <span className="ax-row-flag">{x.sub}</span> : x.sub}</span>
                      </span>
                      <button type="button" className="ax-headbtn danger" aria-label="Take it out of the series" title="Take it out of the series"
                        onClick={(e) => { e.stopPropagation(); put((now) => now.filter((i) => i.id !== it.id)); }}>
                        <Icon d={P.close} size={16} />
                      </button>
                    </>
                  );
                }} />
            </div>
          )}
          <div className="ax-watch-actions">
            <button type="button" className="ax-btn primary" onClick={newSermon} disabled={named(f) && waiting}
              title={waiting ? 'Waiting for the app server' : undefined}>
              <Icon d={P.plus} size={17} />{named(f) ? 'New sermon in this series' : 'Name the series first'}
            </button>
            <button type="button" className="ax-btn" onClick={() => openSub({ kind: 'add', series: key })}>
              <Icon d={P.search} size={16} />Add from Watch
            </button>
          </div>
          {!named(f) ? (
            <p className={`ax-hint${needName ? ' bad' : ''}`}>The new sermon joins the series by its name, so give the series a name first.</p>
          ) : waiting ? <p className="ax-hint">Waiting for the app server before a sermon can be made…</p> : null}
        </ColB>
      </Cols>

      {subSermon ? (
        <SermonEditor key={subSermon._key} row={subSermon} w={w} mode="sub" onDone={done} joining={joining} />
      ) : null}
      {subVideo ? <BlockEditor key={subVideo._key} row={subVideo} w={w} mode="sub" onDone={done} /> : null}
      {sub && sub.kind === 'add' ? (
        <AddFromWatch f={f} w={w} onDone={done}
          onAdd={(x) => put((now) => (now.some((i) => i.id === x.id) ? now : [...now, { id: x.id, kind: x.kind }]))} />
      ) : null}
    </EditorPane>
  );
}

/**
 * Everything on Watch that isn't in this series yet — a search (title, speaker, date, series word), a
 * Sermons | Videos filter, and first the sermons whose series word is this series' name (recognition
 * over recall). A click adds one to the end; the panel stays open for the next.
 */
function AddFromWatch({ f, w, onAdd, onDone }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const input = useRef(null);
  useEffect(() => { if (input.current && input.current.focus) input.current.focus({ preventScroll: true }); }, []);
  const inSeries = new Set(f.items.map((i) => i.id));
  const needle = norm(q);
  const rest = w.library.filter((x) => !inSeries.has(x.id) && (kind === 'all' || x.kind === kind)
    && matches(needle, x.title, x.speaker, x.date, x.word, x.sub));
  const word = norm(f.name);
  const suggested = word ? rest.filter((x) => x.kind === 'sermon' && norm(x.word) === word) : [];
  const others = rest.filter((x) => !suggested.includes(x));
  const row = (x) => (
    <button key={`${x.kind}:${x.id}`} type="button" className="ax-row pickable" onClick={() => onAdd(x)}>
      <span className="ax-thumb" style={bg(x.thumb)}>{!x.thumb && <Icon d={P.play} size={18} />}</span>
      <span className="ax-row-main">
        <span className="ax-row-title">{x.title}</span>
        <span className="ax-row-sub">{x.kind === 'video' ? 'Video' : 'Sermon'}{x.sub ? ` · ${x.sub}` : ''}{x.live ? '' : ' · hidden'}</span>
      </span>
      <span className="ax-add"><Icon d={P.plus} size={16} /></span>
    </button>
  );
  const sermonsLeft = w.library.filter((x) => !inSeries.has(x.id) && x.kind === 'sermon').length;
  const videosLeft = w.library.filter((x) => !inSeries.has(x.id) && x.kind === 'video').length;
  return (
    <SubPanel title="Add from Watch" className="ax-watch-sub"
      sub={`A click puts it at the end of “${f.name.trim() || 'this series'}”.`} onDone={onDone}>
      <div className="ax-watch-find">
        <SearchBox value={q} onChange={setQ} placeholder="Search sermons and videos…" label="Search sermons and videos" inputRef={input} hint={null} />
        <FilterChips label="Kind" value={kind} onChange={setKind}
          filters={[{ key: 'all', label: 'All' }, { key: 'sermon', label: 'Sermons', count: sermonsLeft }, { key: 'video', label: 'Videos', count: videosLeft }]} />
      </div>
      {w.libraryState === 'loading' ? <Loading>Reaching the app server…</Loading> : (
        <>
          {suggested.length ? (
            <Section title="Suggested" right={`Their series word is “${f.name.trim()}”`}>
              <div className="ax-list">{suggested.map(row)}</div>
            </Section>
          ) : null}
          <Section title={suggested.length ? 'Everything else' : 'Everything on Watch'}>
            {others.length ? <div className="ax-list">{others.map(row)}</div> : (
              <div className="ax-empty">{w.library.length ? (needle || kind !== 'all' ? 'Nothing matches.' : 'Nothing else to add.') : 'Add a sermon or a video first.'}</div>
            )}
          </Section>
        </>
      )}
    </SubPanel>
  );
}

/* ─────────────────────────────── videos (Watch's own video cards) ─────────────────────────────── */

function VideosView({ w }) {
  const { blocks: list, feat } = w;
  const { q, setQ, show, setShow } = w.find('videos');
  const rows = list.rows.rows;
  const all = rows || [];
  const needle = norm(q);
  const tests = { all: () => true, live: inApp, drafts: (r) => !inApp(r), featured: (r) => feat.has(r.id) };
  const shown = all.filter((r) => (tests[show] || tests.all)(r) && matches(needle, r.title, r.subtitle));
  const current = all.find((r) => r._key === list.picked) || null;
  const live = all.filter(inApp).length;
  // the count is of VIDEOS featured (it counted featured sermons too)
  const featured = all.filter((r) => feat.has(r.id)).length;

  const pick = (key) => w.after(() => {
    list.setPicked(key);
    w.setOpened('videos');
  }, key !== list.picked);
  const add = () => w.after(() => {
    setQ('');
    setShow('all');
    list.add(genId());
    w.setOpened('videos');
  });
  const filters = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'live', label: 'In the app', count: live },
    { key: 'drafts', label: 'Drafts', count: all.length - live },
    { key: 'featured', label: 'Featured', count: featured },
  ];
  const model = watchModel(w.phone, current ? { kind: 'video', id: current.id } : null);

  return (
    <Workspace detail={w.opened === 'videos'} hasPreview className="ax-watch">
      <ListPane label="Videos" newLabel="New video" onNew={add}
        newDisabled={rows === null} newHint={rows === null ? WAITING : undefined}
        search={q} onSearch={setQ} searchPlaceholder="Search videos…"
        filters={filters} filter={show} onFilter={setShow}
        count={rows === null ? null : `${plural(all.length, 'video')} · ${featured} featured`}>
        {rows === null ? <Loading>Reaching the app server…</Loading> : (
          <RowList rows={shown} picked={list.picked} onPick={pick}
            empty={<div className="ax-empty">{all.length ? 'No videos match.' : <><strong>No videos</strong>Add a video to show on Media.</>}</div>}
            renderRow={(r) => (
              <>
                <span className="ax-thumb" style={bg(r.thumbnail)}>{!r.thumbnail && <Icon d={P.play} size={18} />}</span>
                <span className="ax-row-main">
                  <span className={`ax-row-title${titled(r) ? '' : ' muted'}`}>{String(r.title || '').trim() || 'Untitled'}</span>
                  <span className="ax-row-sub">
                    {r._error ? <span className="ax-row-flag">Not saved</span>
                      : r._saved === null ? 'Not saved yet'
                        : r.subtitle || (r.playInContainer !== false ? 'Plays in the app' : 'Opens outside the app')}
                  </span>
                </span>
                <FeaturedSwitch small feat={feat} id={r.id} kind="video" saved={r._saved !== null} />
                <Toggle small checked={r.published !== false} onChange={(on) => list.setLive(r._key, on)}
                  title={r.published !== false ? 'Members see it — switch off to hide it' : 'Hidden — switch on to show it'} />
              </>
            )} />
        )}
      </ListPane>

      {current ? <BlockEditor key={current._key} row={current} w={w} onBack={() => w.setOpened(null)} /> : (
        <EditorPane label="Video" onBack={() => w.setOpened(null)} backLabel="Videos"
          empty={rows === null ? 'Reaching the app server…' : <><strong>Pick a video to change it</strong>or add a new one.</>} />
      )}

      <PreviewPane note="Watch tab">
        <WatchPhone model={model} />
        <PlaceCaption model={model} none="Pick a video to see where it shows." />
        <p className="ax-hint">A video shows on Watch when it’s Featured, or when it’s in a series.</p>
      </PreviewPane>
    </Workspace>
  );
}

function BlockEditor({ row, w, mode = 'pane', onBack, onDone }) {
  const list = w.blocks;
  const { feat } = w;
  const key = row._key;
  const f = blockForm(row);
  const set = (k, v) => list.rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => list.persist(key) });
  const saved = row._saved !== null;
  const panel = usePanelLive(list, key);
  const remove = () => w.after(() => {
    list.remove(key);
  });
  const cols = (
    <Cols>
      <ColA title="Words">
        <Field label="Title">
          <input className="ax-input title" value={f.title} autoFocus={mode === 'pane' && !saved} placeholder="The video’s title"
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Line under it">
          <input className="ax-input" value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
        </Field>
        <Toggle checked={f.playInContainer} onChange={(on) => set('playInContainer', on)} label="Plays inside the app"
          sub={f.playInContainer ? 'In the app’s own player' : 'Opens in the browser or YouTube'} />
      </ColA>
      <ColB title="Media">
        <Field label="Video">
          <VideoDrop value={f.videoUrl} onChange={(u) => set('videoUrl', u)} busyRef={w.uploading}
            onStill={async (blob) => {
              if (list.rows.get(key)?.thumbnail) return;
              try {
                const url = await uploadImage(new File([blob], 'still.jpg', { type: 'image/jpeg' }));
                if (url) list.rows.patch(key, (r) => (r.thumbnail ? {} : { thumbnail: url }));
              } catch { /* the still is a nicety */ }
            }} />
        </Field>
        <Field label="Thumbnail">
          <ImageDrop value={f.thumbnail} onChange={(u) => set('thumbnail', u)} upload={upload} />
        </Field>
      </ColB>
    </Cols>
  );
  const status = <SaveState auto={auto} waiting="Not saved — give the video a title" />;
  if (mode === 'sub') {
    return (
      <SubPanel title={f.title.trim() || 'Untitled video'} sub="The same video as on the Videos tab — changes save as you type."
        className="ax-watch-sub" status={status} onDone={onDone} onSave={auto.flush}>
        {cols}
        <Section title="Where it shows in the app">
          <Alert onClose={panel.error ? panel.dismiss : null}>{panel.error}</Alert>
          <div className="ax-watch-switches">
            <LiveSwitch on={f.published} onChange={panel.setLive} />
            <FeaturedSwitch feat={feat} id={row.id} kind="video" saved={saved} />
          </div>
        </Section>
      </SubPanel>
    );
  }
  return (
    <EditorPane label="Video" onBack={onBack} backLabel="Videos" onSave={auto.flush} status={status}
      switches={(
        <>
          <LiveSwitch chip on={f.published} onChange={(on) => list.setLive(key, on)} />
          <FeaturedSwitch chip feat={feat} id={row.id} kind="video" saved={saved} />
        </>
      )}
      actions={<DeleteButton noun="video" onClick={remove} />}>
      {cols}
    </EditorPane>
  );
}

/* ─────────────────────────────── resources ─────────────────────────────── */

function ResourcesView({ w }) {
  const { resources: list } = w;
  const { q, setQ, show, setShow } = w.find('resources');
  const rows = list.rows.rows;
  const all = rows || [];
  const needle = norm(q);
  const tests = { all: () => true, live: inApp, drafts: (r) => !inApp(r) };
  const shown = all.filter((r) => (tests[show] || tests.all)(r) && matches(needle, r.title, r.subtitle, r.type));
  const current = all.find((r) => r._key === list.picked) || null;
  const live = all.filter(inApp).length;

  const pick = (key) => w.after(() => {
    list.setPicked(key);
    w.setOpened('resources');
  }, key !== list.picked);
  const add = () => w.after(() => {
    setQ('');
    setShow('all');
    list.add(genId());
    w.setOpened('resources');
  });
  const filters = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'live', label: 'In the app', count: live },
    { key: 'drafts', label: 'Drafts', count: all.length - live },
  ];
  const model = watchModel(w.phone, current ? { kind: 'resource', id: current.id } : null);

  return (
    <Workspace detail={w.opened === 'resources'} hasPreview className="ax-watch">
      <ListPane label="Resources" newLabel="New resource" onNew={add}
        newDisabled={rows === null} newHint={rows === null ? WAITING : undefined}
        search={q} onSearch={setQ} searchPlaceholder="Search resources…"
        filters={filters} filter={show} onFilter={setShow}
        count={rows === null ? null : `${plural(all.length, 'resource')} · ${live} in the app`}>
        {rows === null ? <Loading>Reaching the app server…</Loading> : (
          <RowList rows={shown} picked={list.picked} onPick={pick}
            empty={<div className="ax-empty">{all.length ? 'No resources match.' : <><strong>No resources</strong>Add a study guide, series or podcast.</>}</div>}
            renderRow={(r) => (
              <>
                <span className="ax-thumb tall" style={bg(coverOf(r))}>{!coverOf(r) && <Icon d={P.play} size={18} />}</span>
                <span className="ax-row-main">
                  <span className={`ax-row-title${titled(r) ? '' : ' muted'}`}>{String(r.title || '').trim() || 'Untitled'}</span>
                  <span className="ax-row-sub">
                    {r._error ? <span className="ax-row-flag">Not saved</span>
                      : r._saved === null ? 'Not saved yet'
                        : [r.type, r.subtitle].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Toggle small checked={r.published !== false} onChange={(on) => list.setLive(r._key, on)}
                  title={r.published !== false ? 'Members see it — switch off to hide it' : 'Hidden — switch on to show it'} />
              </>
            )} />
        )}
      </ListPane>

      {current ? <ResourceEditor key={current._key} row={current} w={w} onBack={() => w.setOpened(null)} /> : (
        <EditorPane label="Resource" onBack={() => w.setOpened(null)} backLabel="Resources"
          empty={rows === null ? 'Reaching the app server…' : <><strong>Pick a resource to change it</strong>or add a new one.</>} />
      )}

      <PreviewPane note="Watch tab · Resources">
        <WatchPhone model={model} />
        <PlaceCaption model={model} none="Pick a resource to see it in the row." />
      </PreviewPane>
    </Workspace>
  );
}

function ResourceEditor({ row, w, onBack }) {
  const list = w.resources;
  const { sugg } = w;
  const key = row._key;
  const f = resourceForm(row);
  // every change also puts the cover where phones look for it (thumbnailUrl — see resourceForm): a
  // new cover goes under both names, anything else carries the cover there is, so a resource saved
  // before this reaches phones with its cover from its next change on
  const set = (k, v) => list.rows.patch(key, (r) => ({ [k]: v, thumbnailUrl: k === 'coverUrl' ? v : coverOf(r) }));
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => list.persist(key) });
  const remove = () => w.after(() => {
    list.remove(key);
  });
  // the app shows only what's in its saved resource order, whenever there is one
  const leftOut = row._saved !== null && sugg.ready && sugg.resourcesOrder.length > 0 && !sugg.resourcesOrder.includes(String(row.id));
  // a cover phones don't show (the phone beside says so too): saved as Pillar's coverUrl only, or the
  // app's admin left another one where phones look — one click puts this one there
  const coverOff = row._saved !== null && !!f.coverUrl && f.thumbnailUrl !== f.coverUrl;
  return (
    <EditorPane label="Resource" onBack={onBack} backLabel="Resources" onSave={auto.flush}
      status={<SaveState auto={auto} waiting="Not saved — give the resource a title" />}
      switches={<LiveSwitch chip on={f.published} onChange={(on) => list.setLive(key, on)} />}
      actions={<DeleteButton noun="resource" onClick={remove} />}>
      {coverOff ? (
        <div className="ax-note spaced ax-watch-order">
          <Icon d={P.folder} size={18} />
          <span className="ax-note-main">
            {f.thumbnailUrl ? 'Phones show a different cover for this resource.'
              : 'Phones don’t show this cover yet — it was saved where the app doesn’t look for it.'}
          </span>
          <button type="button" className="ax-btn sm" onClick={() => set('coverUrl', f.coverUrl)}>Show this cover on phones</button>
        </div>
      ) : null}
      {leftOut ? (
        <div className="ax-note spaced ax-watch-order">
          <Icon d={P.layers} size={18} />
          <span className="ax-note-main">
            The app shows only the resources in its saved order, and this one isn’t in it — so members don’t see it yet.
          </span>
          <button type="button" className="ax-btn sm" onClick={() => sugg.includeResource(row.id)}>Add it to the app’s order</button>
        </div>
      ) : null}
      <Cols>
        <ColA title="Words">
          <Field label="Title">
            <input className="ax-input title" value={f.title} autoFocus={row._saved === null} placeholder="The resource’s title"
              onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Line under it">
            <input className="ax-input" value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
          </Field>
          <Field label="Kind">
            <Seg label="Kind" value={f.type} onChange={(t) => set('type', t)} options={RESOURCE_TYPES.map((t) => ({ key: t, label: t }))} />
          </Field>
          <Field label="Link" hint="Where it opens — a web address.">
            <input className="ax-input" value={f.link} inputMode="url" placeholder="https://" onChange={(e) => set('link', e.target.value)} />
          </Field>
        </ColA>
        <ColB title="Cover">
          <Field label="Cover" hint="Tall, like a book cover (3 by 4).">
            <ImageDrop value={f.coverUrl} onChange={(u) => set('coverUrl', u)} upload={upload} tall />
          </Field>
        </ColB>
      </Cols>
    </EditorPane>
  );
}

/* ─────────────────────────────── the Watch tab, on a phone ─────────────────────────────── */

const WEB = /^https?:\/\/[^\s]+$/i;

/**
 * The member app's Watch tab, worked out from what Pillar has — the same rules as BethesdaApp
 * screens/SermonsScreen.js, in the same order: the big card (the office's pick, else the newest; its
 * TALL picture first), Featured (the office's stars, less the big card), Recommended (the sermons
 * switched on for it, less the big card and anything Featured, at most 7), a row per series (or, with
 * none, the series the app works out from each sermon's series word), Featured videos (only when the
 * Series tables aren't set up), Resources (in the app's saved order when there is one), then the newest
 * three messages. `focus` is what the office has picked ({ kind, id }): it is drawn even while it isn't
 * in the app yet (with a flag), and `places` says where on the page it is. A sermon that shows nowhere
 * on Watch itself is only in All messages, so that's the screen then (`screen: 'all'`).
 */
export function watchModel(data, focus) {
  const d = data || {};
  const layout = d.layout || {};
  const fk = focus ? focus.kind : null;
  const fid = focus && focus.id != null ? String(focus.id) : null;
  const isFocus = (kind, id) => fk === kind && fid !== null && String(id) === fid;
  // what a phone shows: saved, with `published` set — the app keeps only `x && x.published`
  // (SermonsScreen.js and AllMessagesScreen.js `published()`), so a row the server has with no
  // `published` at all is hidden on phones, whatever the editor's switch reads (it reads that as on)
  const shows = (r) => r._saved !== null && !!r.published;
  const keep = (kind) => (r) => shows(r) || isFocus(kind, r.id);
  const S = (d.sermons || []).filter(keep('sermon'));
  const B = (d.blocks || []).filter(keep('video'));
  const R = (d.resources || []).filter(keep('resource'));
  const sById = new Map(S.map((r) => [String(r.id), r]));
  const bById = new Map(B.map((r) => [String(r.id), r]));
  const rById = new Map(R.map((r) => [String(r.id), r]));

  const chosen = layout.featuredSermonId != null && layout.featuredSermonId !== '' ? sById.get(String(layout.featuredSermonId)) : null;
  const big = chosen || S[0] || null;
  const bigId = big ? String(big.id) : null;
  const bigPic = big ? big.thumbnailTallUrl || big.thumbnailUrl || '' : '';

  // the app reads Series and Featured together; either table missing and it uses neither
  const shelves = Array.isArray(d.featured) && Array.isArray(d.series);
  const feats = shelves ? d.featured
    .map((r) => ({ id: String(r.item_id ?? '').trim(), kind: r.kind === 'sermon' ? 'sermon' : 'video', sort: Number(r.sort) || 0 }))
    .filter((r) => r.id).sort((a, b) => a.sort - b.sort) : [];
  const cardFor = (it) => {
    if (it.kind === 'video') {
      const b = bById.get(it.id);
      return b ? { key: `video-${it.id}`, kind: 'video', id: it.id, title: b.title, sub: b.subtitle || '', thumb: b.thumbnail || b.thumbnailUrl || '' } : null;
    }
    const s = sById.get(it.id);
    return s ? { key: `sermon-${it.id}`, kind: 'sermon', id: it.id, title: s.title, sub: [s.speaker, s.date].filter(Boolean).join(' · '), thumb: s.thumbnailUrl || '', sermon: s } : null;
  };
  const inFeaturedRow = new Set(feats.filter((it) => it.kind !== 'video').map((it) => it.id));
  let featuredRow = feats.map(cardFor).filter(Boolean).filter((c) => !(c.kind === 'sermon' && c.id === bigId));
  const sugIds = (Array.isArray(layout.suggestedIds) ? layout.suggestedIds : []).map(String);
  const suggestedAll = sugIds.filter((id) => sById.has(id) && id !== bigId && !inFeaturedRow.has(id)).map((id) => sById.get(id));
  const suggested = suggestedAll.slice(0, 7);

  const series = shelves ? d.series
    .map((r) => {
      const id = String(r.id ?? r._key);
      return {
        id, name: String(r.name || '').trim(), subtitle: String(r.subtitle || '').trim(),
        image: WEB.test(String(r.image_url || '').trim()) ? String(r.image_url).trim() : '',
        items: cleanItems(r.items), sort: Number(r.sort) || 0, live: seriesLive(r), focus: isFocus('series', id),
      };
    })
    .filter((r) => r.focus || (r.live && r.name && r.items.length > 0))
    .sort((a, b) => a.sort - b.sort)
    .map((r) => ({ ...r, cards: r.items.map(cardFor).filter(Boolean) }))
    .filter((r) => r.focus || r.cards.length > 0) : [];

  // with no series of the office's own, the app groups sermons by their series word (two or more)
  const fallback = [];
  if (!series.length) {
    const byWord = new Map();
    S.forEach((s, i) => {
      if (!s.series) return;
      if (!byWord.has(s.series)) byWord.set(s.series, { name: s.series, sermons: [], thumbnail: s.thumbnailUrl, gi: i });
      byWord.get(s.series).sermons.push(s);
    });
    byWord.forEach((v) => { if (v.sermons.length >= 2) fallback.push(v); });
  }
  const featuredVideos = shelves ? [] : B;

  const order = (Array.isArray(layout.resourcesOrder) ? layout.resourcesOrder : []).map(String);
  let resources = order.length ? order.filter((id) => rById.has(id)).map((id) => rById.get(id)) : R;
  let leftOut = false;
  if (fk === 'resource' && rById.has(fid) && !resources.some((r) => String(r.id) === fid)) {
    resources = [...resources, rById.get(fid)];
    leftOut = true;
  }

  // a video that's in no row still shows the office where it would go: first in Featured
  const inRows = (kind, id) => featuredRow.some((c) => c.kind === kind && c.id === id)
    || series.some((sr) => sr.cards.some((c) => c.kind === kind && c.id === id));
  let nowhere = false;
  if (fk === 'video' && bById.has(fid) && !inRows('video', fid) && !featuredVideos.some((b) => String(b.id) === fid)) {
    featuredRow = [cardFor({ id: fid, kind: 'video' }), ...featuredRow];
    nowhere = true;
  }

  const all3 = S.slice(0, 3);
  const places = [];
  if (fk === 'sermon' && sById.has(fid)) {
    if (bigId === fid) places.push('the big card at the top');
    if (featuredRow.some((c) => c.kind === 'sermon' && c.id === fid)) places.push('Featured');
    if (suggested.some((s) => String(s.id) === fid)) places.push('Recommended');
    series.forEach((sr) => { if (sr.cards.some((c) => c.kind === 'sermon' && c.id === fid)) places.push(`the “${sr.name || 'Untitled series'}” row`); });
    fallback.forEach((sr) => { if (sr.sermons.some((s) => String(s.id) === fid)) places.push(`the “${sr.name}” series card`); });
    if (all3.some((s) => String(s.id) === fid)) places.push('All messages');
  } else if (fk === 'video' && bById.has(fid) && !nowhere) {
    if (featuredRow.some((c) => c.kind === 'video' && c.id === fid)) places.push('Featured');
    series.forEach((sr) => { if (sr.cards.some((c) => c.kind === 'video' && c.id === fid)) places.push(`the “${sr.name || 'Untitled series'}” row`); });
    if (featuredVideos.some((b) => String(b.id) === fid)) places.push('Featured videos');
  } else if (fk === 'series' && series.some((sr) => sr.id === fid)) {
    places.push('its own row');
  } else if (fk === 'resource' && rById.has(fid) && !leftOut) {
    places.push('Resources');
  }
  const screen = fk === 'sermon' && sById.has(fid) && !places.length ? 'all' : 'watch';
  if (screen === 'all') places.push('All messages (Watch → See all)');

  // is the thing picked in the app yet?
  const picked = fk === 'sermon' ? sById.get(fid) : fk === 'video' ? bById.get(fid) : fk === 'resource' ? rById.get(fid) : null;
  const pickedSeries = fk === 'series' ? series.find((sr) => sr.id === fid) : null;
  const draft = picked ? !shows(picked) : pickedSeries ? !pickedSeries.live : false;
  const empty = !!pickedSeries && pickedSeries.cards.length === 0;
  const flag = draft ? 'Not in the app yet' : nowhere || empty ? 'Not on Watch yet' : leftOut ? 'Left out by the app’s order' : null;
  const why = empty ? 'An empty series doesn’t show on Watch — put a sermon or video in it.'
    : nowhere ? 'It isn’t on Watch yet — switch Featured on, or put it in a series. It would show here.'
      : leftOut ? 'The app’s saved resource order leaves it out, so members don’t see it (the editor can add it).'
        : '';

  return {
    focus: !!focus && (!!picked || !!pickedSeries), focusKey: fk ? `${fk}:${fid}` : '', isFocus, screen, places, flag, draft, why,
    S, big, bigPic, featuredRow, suggested, suggestedMore: suggestedAll.length > suggested.length, series, fallback, featuredVideos,
    resources, all3,
  };
}

/** Bring the outlined piece into view — down the page, and along its row. */
function bringIntoView(box) {
  if (!box || typeof box.querySelector !== 'function') return;
  const to = (node, where) => { if (typeof node.scrollTo === 'function') node.scrollTo({ ...where, behavior: 'smooth' }); };
  const el = box.querySelector('.ax-pa-picked');
  if (!el) { to(box, { top: 0 }); return; }
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // the phone is scaled as one piece: what the screen measures, over what the page lays out
  const k = box.clientHeight ? b.height / box.clientHeight : 1;
  const s = k > 0 ? k : 1;
  to(box, { top: Math.max(0, box.scrollTop + (r.top - b.top) / s - 150) });
  const row = typeof el.closest === 'function' ? el.closest('.ax-wp-hrow') : null;
  if (row) {
    const rr = row.getBoundingClientRect();
    to(row, { left: Math.max(0, row.scrollLeft + (r.left - rr.left) / s - 20) });
  }
}

function WatchPhone({ model }) {
  const scrollRef = useRef(null);
  const at = `${model.screen}|${model.focusKey}|${model.places.join('|')}`;
  useEffect(() => { bringIntoView(scrollRef.current); }, [at]);
  if (model.screen === 'all') {
    // All messages is a route of its own ('Messages', App.js), not one of the dock's four tabs: the
    // dock marks no tab there (all four words, no dot) — `dock` true is "none picked"
    return (
      <PhoneFrame dock back scrollRef={scrollRef} label="All messages, as a phone shows it">
        <AllMessagesScreen m={model} />
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame dock="watch" scrollRef={scrollRef} label="The app’s Watch tab, as a phone shows it">
      <WatchScreen m={model} />
    </PhoneFrame>
  );
}

/** "On phones: the big card at the top · Featured." — or why it isn't there yet. */
function PlaceCaption({ model, none }) {
  if (!model.focus) return <p className="ax-phone-cap">{none}</p>;
  const where = model.places.join(' · ');
  if (model.why) return <p className="ax-phone-cap ax-watch-place">{model.why}</p>;
  if (model.draft) {
    return (
      <p className="ax-phone-cap ax-watch-place">
        <strong>Not in the app yet.</strong>{where ? ` Switched on, it shows in ${where}.` : ' Switched on, it shows here.'}
      </p>
    );
  }
  return <p className="ax-phone-cap ax-watch-place">On phones: <strong>{where}</strong>.</p>;
}

/* the app's pieces, at its own sizes (css/watch.css .ax-wp-*, css/phone.css .ax-pa-*). Titles and names
   are printed as they are — the app has no stand-in words for a missing one ("Untitled"), so neither
   does its phone here; Pillar's own flag and the caption under the phone say what's missing. */

function PhoneHead({ title, seeAll, tight }) {
  return (
    <div className={`ax-pa-head ax-wp-head${tight ? ' tight' : ''}`}>
      <span className="ax-pa-heading">{title}</span>
      {seeAll ? <span className="ax-pa-seeall">See all</span> : null}
    </div>
  );
}

/** components/ShelfCard.js: 220 wide, a 16:9 picture (or its gradient), two lines under it. */
function Shelf({ uri, title, meta, corner, index = 0, on, flag }) {
  return (
    <div className="ax-pa-shelf">
      <div className={`ax-pa-shelf-pic${uri ? '' : ` ax-pa-fallback-${index % 4}`}${on ? ' ax-pa-picked' : ''}`} style={bg(uri)}>
        {flag}
        {corner ? <span className="ax-pa-shelf-corner">{corner}</span> : null}
      </div>
      <div className="ax-pa-shelf-title">{title}</div>
      {meta ? <div className="ax-pa-shelf-meta">{meta}</div> : null}
    </div>
  );
}

/** A Featured card (SermonsScreen.js MediaBigCard): the picture 16:9, its words at the foot, the play disc in the corner. */
function MediaCard({ c, on, flag }) {
  return (
    <div className={`ax-wp-media${on ? ' ax-pa-picked' : ''}`}>
      {c.thumb ? <span className="ax-wp-fill" style={bg(c.thumb)} /> : <span className="ax-wp-fill ax-wp-grad-0" />}
      {c.thumb ? <span className="ax-pa-blur" /> : null}
      <span className="ax-wp-media-shade" />
      {flag}
      <div className="ax-wp-media-words">
        {c.sub ? <div className="ax-wp-media-sub">{c.sub}</div> : null}
        <div className="ax-wp-media-title">{c.title}</div>
      </div>
      <span className="ax-pa-play corner" />
    </div>
  );
}

function WatchScreen({ m }) {
  const on = (kind, id) => m.isFocus(kind, id);
  const flag = (kind, id) => (m.flag && m.isFocus(kind, id) ? <span className="ax-pa-flag">{m.flag}</span> : null);
  const big = m.big;
  return (
    <div className="ax-pa-screen ax-wp">
      {/* the big card on the blur of its own picture, fading into the page */}
      <div className="ax-wp-top">
        {m.bigPic ? <span className="ax-wp-top-pic" style={bg(m.bigPic)} /> : null}
        <span className="ax-wp-top-wash" />
        <span className="ax-wp-top-fade" />
        <div className="ax-wp-header">
          <span className="ax-pa-title">Watch</span>
          <span className="ax-wp-search"><PhoneIcon name="search" size={20} /></span>
        </div>
        {big ? (
          <div className={`ax-wp-big${on('sermon', big.id) ? ' ax-pa-picked' : ''}`}>
            {m.bigPic ? <span className="ax-wp-fill" style={bg(m.bigPic)} /> : <span className="ax-wp-fill ax-wp-grad-0" />}
            {m.bigPic ? <span className="ax-pa-blur" /> : null}
            <span className="ax-wp-big-shade" />
            {flag('sermon', big.id)}
            <div className="ax-wp-big-words">
              {big.series ? <div className="ax-wp-big-kicker">{String(big.series).toUpperCase()}</div> : null}
              <div className="ax-wp-big-title">{big.title}</div>
              <div className="ax-wp-big-meta">{sermonMeta(big)}</div>
              <div className="ax-wp-big-actions">
                <div className="ax-wp-big-btns">
                  <span className="ax-pa-btn on-dark"><PhoneIcon name="file-text" size={15} /><span>Sermon notes</span></span>
                </div>
                <span className="ax-pa-play" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {m.featuredRow.length ? (
        <section className="ax-wp-section first">
          <PhoneHead title="Featured" />
          <div className="ax-wp-list">
            {m.featuredRow.map((c) => <MediaCard key={c.key} c={c} on={on(c.kind, c.id)} flag={flag(c.kind, c.id)} />)}
          </div>
        </section>
      ) : null}

      {m.suggested.length ? (
        <section className="ax-wp-section">
          <PhoneHead title="Recommended" seeAll={m.suggestedMore} />
          <div className="ax-wp-hrow">
            {m.suggested.map((s, i) => (
              <Shelf key={s.id} index={i} uri={s.thumbnailUrl} title={s.title} meta={sermonMeta(s)}
                on={on('sermon', s.id)} flag={flag('sermon', s.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {m.series.map((sr) => (
        <section key={sr.id} className={`ax-wp-section${on('series', sr.id) ? ' ax-pa-picked' : ''}`}>
          {/* Pillar's flag floats in the gap above the heading (css/watch.css), so the row keeps the
              app's own spacing: section → SectionHead → the line under it → the row */}
          {flag('series', sr.id)}
          <PhoneHead title={sr.name} seeAll={sr.cards.length > 3} tight={!!sr.subtitle} />
          {sr.subtitle ? <p className="ax-wp-sub">{sr.subtitle}</p> : null}
          <div className="ax-wp-hrow">
            {sr.cards.length ? sr.cards.map((c, i) => (
              <Shelf key={c.key} index={i} uri={c.thumb || sr.image} title={c.title}
                meta={c.kind === 'sermon' ? sermonMeta(c.sermon) : c.sub} on={on(c.kind, c.id)} flag={flag(c.kind, c.id)} />
            )) : <div className="ax-wp-emptyrow">Nothing in this series yet</div>}
          </div>
        </section>
      ))}

      {m.fallback.length ? (
        <section className="ax-wp-section">
          <PhoneHead title="Series" />
          <div className="ax-wp-hrow">
            {m.fallback.map((sr, i) => (
              <Shelf key={sr.name} index={sr.gi ?? i} uri={sr.thumbnail} title={sr.name} corner={`${sr.sermons.length} messages`}
                on={sr.sermons.some((s) => on('sermon', s.id))} />
            ))}
          </div>
        </section>
      ) : null}

      {m.featuredVideos.length ? (
        <section className="ax-wp-section">
          <PhoneHead title="Featured videos" />
          <div className="ax-wp-list">
            {m.featuredVideos.map((b) => {
              const c = { kind: 'video', id: String(b.id), title: b.title, sub: b.subtitle || '', thumb: b.thumbnail || b.thumbnailUrl || '' };
              return <MediaCard key={c.id} c={c} on={on('video', c.id)} flag={flag('video', c.id)} />;
            })}
          </div>
        </section>
      ) : null}

      {m.resources.length ? (
        <section className="ax-wp-section">
          <PhoneHead title="Resources" />
          <div className="ax-wp-hrow">
            {m.resources.map((r, i) => {
              // the cover as the app reads it: thumbnailUrl only (a cover Pillar kept only as coverUrl
              // isn't on phones — the gradient stands in, as it does there; see resourceForm)
              const uri = r.thumbnailUrl || '';
              return (
                <div key={r.id} className="ax-wp-res">
                  <div className={`ax-wp-res-pic${uri ? '' : ` ax-wp-grad-${i % 5}`}${on('resource', r.id) ? ' ax-pa-picked' : ''}`} style={bg(uri)}>
                    {uri ? <span className="ax-pa-blur" /> : null}
                    <span className="ax-wp-res-shade" />
                    {flag('resource', r.id)}
                    <span className="ax-wp-res-badge">{r.type || 'Series'}</span>
                  </div>
                  <div className="ax-wp-res-name">{r.title}</div>
                  {r.subtitle ? <div className="ax-wp-res-sub">{r.subtitle}</div> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {m.S.length ? (
        <section className="ax-wp-section">
          <PhoneHead title="All messages" seeAll />
          <div className="ax-wp-list">
            {m.all3.map((x, i) => (
              <div key={x.id} className={`ax-wp-all${i > 0 ? ' line' : ''}`}>
                <div className={`ax-wp-all-pic${x.thumbnailUrl ? '' : ` ax-wp-grad-${i % 5}`}${on('sermon', x.id) ? ' ax-pa-picked' : ''}`} style={bg(x.thumbnailUrl)} />
                <div className="ax-wp-all-words">
                  <div className="ax-wp-all-title">{x.title}</div>
                  <div className="ax-wp-all-meta">{sermonMeta(x)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** screens/AllMessagesScreen.js: every message, newest first, under its month when every one has a date. */
function AllMessagesScreen({ m }) {
  const items = m.S;
  const months = items.map((x) => sermonMonth(x.date));
  const groups = [];
  if (!items.length || months.some((mo) => !mo)) groups.push({ month: null, items });
  else {
    const byMonth = new Map();
    items.forEach((x, i) => {
      if (!byMonth.has(months[i])) byMonth.set(months[i], []);
      byMonth.get(months[i]).push(x);
    });
    byMonth.forEach((list, month) => groups.push({ month, items: list }));
  }
  return (
    <div className="ax-pa-screen ax-wp-page">
      <div className="ax-wp-page-head">
        <div className="ax-pa-title">All messages</div>
        <div className="ax-wp-page-count">{items.length === 1 ? '1 message' : `${items.length} messages`}</div>
      </div>
      {groups.map((g) => (
        <div key={g.month || 'undated'} className="ax-wp-group">
          {g.month ? <div className="ax-wp-month">{g.month}</div> : null}
          {g.items.map((x, i) => (
            <div key={x.id} className={`ax-wp-arow${i === 0 ? ' first' : ''}`}>
              <div className={`ax-wp-arow-pic${x.thumbnailUrl ? '' : ' ax-wp-grad-0'}${m.isFocus('sermon', x.id) ? ' ax-pa-picked' : ''}`} style={bg(x.thumbnailUrl)}>
                {m.flag && m.isFocus('sermon', x.id) ? <span className="ax-pa-flag">{m.flag}</span> : null}
              </div>
              <div className="ax-wp-all-words">
                <div className="ax-wp-all-title">{x.title}</div>
                <div className="ax-wp-all-meta">{sermonMeta(x)}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
