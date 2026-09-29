import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  listCards, saveCard, setCardSort, deleteCard, uploadCardImage, listHomeEvents, listHomeLocations, dinnerNow,
  cardProblems, draftProblems, hasCardContent, liveLabel, isLive,
  KINDS, BUILT_IN, ACTIONS, PAGES, LIMITS,
} from '../../lib/homeCards';
import { listTiles, saveTile, tileProblems, uploadTileImage, SLOTS, TILE_LIMITS } from '../../lib/homeTiles';
import { listPageHeaders } from '../../lib/pageHeaders';
import { getSermons } from '../../lib/appApi';
import { youtubeThumbs, youtubePicture } from '../../lib/youtube';
import { useAuth } from '../../context/AuthContext';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo, ask,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList, ImageDrop, VideoDrop,
} from './kit';
import {
  Workspace, ListPane, EditorPane, PreviewPane, Cols, ColA, ColB, Fields,
  HotkeyHint, PhoneFrame, PhoneIcon, usePreview, useHotkeys, PHONE,
} from './layout';

// App → Home: the app's Home screen — the round shortcuts and the ONE card under the latest sermon,
// then the Announcements row. Pick a card and change it — it saves as you type; flip its switch to put
// it on phones or take it off; drag to reorder. The phone on the right IS the app's Home screen, as a
// member (or a visitor) sees it right now, and it's a way in: click a card on it to change that card,
// click a shortcut or the latest post to change its words.
//
// Since the Home redesign (2026-09-23) phones show a row of round shortcuts and ONE card: the first
// card here that's for them — the plate card only while dinner reservations are open — and, with
// none, the latest post (BethesdaApp components/TimelyCard.js). The order below is that choice.
//
// Pillar's redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4 Home), and the laws behind it:
//   · Jakob's law — the same workspace as every App page: cards · the one being changed · the phone
//   · horizontal first — the three side by side at the window's height, each scrolling on its own;
//     the editor's words on the left, its picture, buttons and dates on the right (proximity)
//   · Fitts's law — the save state, the On phones switch, Duplicate and Delete share the editor head's
//     first row whatever the save state says (it cuts itself short rather than push them away); the kind
//     takes the row under them
//   · Hick's law — the kind is five small icons, not five cards of prose; filters narrow a long list
//   · recognition over recall — the picked kind says, in words, what it looks like on phones now
//   · consistency — the list's line, the editor's line and the phone come from the same rules, for the
//     Home the phone is showing, so the three never disagree
//   · Von Restorff — New card is the one filled button; "on phones" is green everywhere
//   · Doherty threshold — the list, the pick, the search and both tabs live here, so switching between
//     Cards and Shortcuts never reloads or forgets anything
//   · Tesler's law — N makes a card, / searches, ⌘/Ctrl+S saves now, Esc closes what's open, and the
//     phone takes you straight to the thing you click

const AUDIENCE = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'signed_in', label: 'Members' },
  { key: 'signed_out', label: 'Visitors' },
];
// Material "image" and "content_copy" — Pillar's own icon set has neither
const IMAGE_ICON = 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z';
const COPY_ICON = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
const KIND_ICON = { image: IMAGE_ICON, video: P.play, text: P.doc, dinner: P.meal, welcome: P.home };
const KIND_WORD = { image: 'Picture', video: 'Video', text: 'Words', dinner: 'Plate', welcome: 'Welcome' };
// What each kind looks like on phones NOW — the app since its Home redesign (TimelyCard.js: the card on
// top, a 64pt picture beside the words; AnnouncementsShelf.js: the words over the picture, or a dark card
// with none). homeCards.js KINDS keeps its older hints (tests pin that list), so the words live here.
const KIND_HINT = {
  image: 'a photograph with your words, over it in Announcements and beside it as the card on top.',
  video: 'a video that plays inside the app, with a play button on its picture.',
  text: 'words only: a dark card in Announcements, with a bell beside the words as the card on top.',
  dinner: 'the app’s own plate card, on top of Home for members while Wednesday dinner is taking reservations.',
  welcome: 'the app’s own “Welcome to the new Bethesda App” card, with its photo, for the top of Home.',
};
// the office's own kinds: the ones that go in the Announcements row and open to their whole announcement
const OFFICE = new Set(['image', 'video', 'text']);

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'On phones' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'ended', label: 'Ended' },
];

// the shortcuts in the order the phone shows them (the latest post is the card under them)
const SLOT_ORDER = ['prayer', 'connect', 'bulletin', 'post'];
const SLOT_ICON = { prayer: P.heart, connect: P.users, bulletin: P.doc, post: P.announce };

// what the editor changes — and what "saved" is measured against
const formOf = (r) => ({
  kind: r.kind || 'image',
  audience: r.audience || 'everyone',
  kicker: r.kicker || '',
  title: r.title || '',
  subtitle: r.subtitle || '',
  body: r.body || '',
  image_url: r.image_url || '',
  video_url: r.video_url || '',
  buttons: (r.buttons || []).map((b) => ({ label: b.label || '', action: b.action || 'url', target: b.target || '' })),
  starts_on: r.starts_on || '',
  ends_on: r.ends_on || '',
  published: r.published !== false,
});

// the shortcuts and the latest post (app_home_tiles): only what the office changed; blank means the app's own words
const tileForm = (r) => ({ title: r.title || '', subtitle: r.subtitle || '', image_url: r.image_url || '' });
const tileOf = (slot) => SLOTS.find((s) => s.slot === slot);

const nameOf = (r) => (BUILT_IN.has(r.kind) ? KINDS.find((k) => k.key === r.kind)?.label : String(r.title || '').trim());
const kindLabel = (k) => KINDS.find((x) => x.key === k)?.label || 'Card';
const audienceLabel = (a) => AUDIENCE.find((x) => x.key === a)?.label || 'Everyone';
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;

// "2026-10-03" → "Oct 3" (the year only when it isn't this one) — the list and the phone say dates
// the way people do
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function niceDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const s = `${MON_SHORT[Number(m[2]) - 1]} ${Number(m[3])}`;
  return Number(m[1]) === new Date().getFullYear() ? s : `${s}, ${m[1]}`;
}
const niceLive = (label) => String(label || '').replace(/\d{4}-\d{2}-\d{2}/, (d) => niceDay(d));

/** Where a card is: 'live' (on phones), 'scheduled', 'ended' or 'drafts' (a card never saved is a draft). */
function stageOf(r) {
  if (!r.id) return 'drafts';
  const l = liveLabel(r);
  if (l === 'Draft') return 'drafts';
  if (l.startsWith('Starts')) return 'scheduled';
  if (l.startsWith('Ended')) return 'ended';
  return 'live';
}

// a web address the app will open or show — the app's own test (BethesdaApp utils/homeCards.js isWebLink)
const appLink = (v) => /^https?:\/\/[^\s]+$/i.test(String(v || '').trim());

/** A card's picture as the app finds it (BethesdaApp homeCardsData.js cardPicture): its own, or a
 *  YouTube video's frame; none for words. */
function cardPic(c) {
  const own = appLink(c.image_url) ? String(c.image_url).trim() : '';
  if (c.kind === 'image') return own;
  if (c.kind === 'video') return own || (appLink(c.video_url) && youtubeThumbs(c.video_url)?.hq) || '';
  return '';
}

/** The buttons the app keeps (BethesdaApp utils/homeCards.js cleanButtons): a label, and something it can
 *  carry out — a web link, one of its pages, the plate, or this card's own video. Two at most. */
function appButtons(c) {
  if (BUILT_IN.has(c.kind)) return [];
  return (c.buttons || []).map((b) => ({
    label: String(b.label || '').trim(), action: String(b.action || ''), target: String(b.target || '').trim(),
  })).filter((b) => {
    if (!b.label) return false;
    if (b.action === 'url') return appLink(b.target);
    if (b.action === 'page') return PAGES.some((p) => p.key === b.target);
    if (b.action === 'plate') return true;
    if (b.action === 'video') return c.kind === 'video' && appLink(c.video_url);
    return false;
  }).slice(0, 2);
}

// something on the phone you can click (or Enter / Space) to go and change it
const press = (fn, label) => ({
  role: 'button',
  tabIndex: 0,
  'aria-label': label,
  title: label,
  onClick: (e) => { e.stopPropagation(); fn(); },
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } },
});

/* ─────────────────────── what phones show (the app's own rules) ─────────────────────── */

/**
 * Home for one audience — the app's own choice (BethesdaApp components/homeCardsData.js pickTimely and
 * officeShelf): the plate card for members, else the first other card for them, else the latest post;
 * then the office's next cards, five at most, for the Announcements row.
 */
function homeShows(rows, as) {
  const shows = (r) => { const a = formOf(r).audience; return a === 'everyone' || a === as; };
  // which card phones show now — the app's own rule (BethesdaApp components/TimelyCard.js pickTimely)
  const forThem = rows.filter((r) => r.id && isLive(r) && shows(r));
  const dinner = as === 'signed_in' ? forThem.find((r) => formOf(r).kind === 'dinner') : null;
  const other = forThem.find((r) => formOf(r).kind !== 'dinner') || null;
  const onPhones = dinner || other;          // null: the latest post
  // the office's next cards, five at most — the app's Announcements row (components/AnnouncementsShelf.js)
  const announced = forThem.filter((r) => r !== onPhones && ['image', 'video', 'text'].includes(formOf(r).kind)).slice(0, 5);
  return { shows, forThem, dinner, other, onPhones, announced };
}

/** The Announcements row as a phone lays it out (homeCardsData.js shelfItems): the calendar's
 *  featured events first, soonest first, then the office's cards — five at most. */
const shelfOf = (featured, announced) => [
  ...(featured || []).map((ev) => ({ key: `event:${ev.id}`, ev })),
  ...announced.map((row) => ({ key: row._key, row })),
].slice(0, 5);

/** What a card's line in the list says after its kind and audience: its date, or where phones show it. */
function rowState(r, v, shelf, as) {
  if (!r.id) return { text: 'Not saved yet' };
  const l = liveLabel(r);
  if (l !== 'Live') return { text: niceLive(l) };
  const f = formOf(r);
  if (!v.shows(r)) return { text: 'Live' };   // not for the audience being previewed — its label says who
  if (r === v.onPhones) return { text: f.kind === 'dinner' ? 'While reservations are open' : 'On phones now', on: true };
  const i = shelf.findIndex((x) => x.row === r);
  if (i >= 0) return { text: `Announcements #${i + 1}`, on: true };
  if (f.kind === 'dinner' && as !== 'signed_in') return { text: 'Only for members' };
  return { text: OFFICE.has(f.kind) ? 'Not in the first five' : 'Another card comes first' };
}

/** A card's line in the list, as the mockup has it: its kind, who it's for only when that isn't
 *  everyone, then where it is — three short facts, the one that changes most at the end. */
const rowLine = (f, state) => [
  KIND_WORD[f.kind] || 'Card',
  f.audience !== 'everyone' && `${audienceLabel(f.audience)} only`,
  state.text,
].filter(Boolean).join(' · ');

/** Why the picked card isn't on this phone — Pillar's own badge over it (a card in the Announcements
 *  row IS on phones, so it never gets one: it's outlined where it is). */
function badgeFor(r, v, as) {
  if (!r.id) return 'Not saved yet';
  const l = liveLabel(r);
  if (l === 'Draft') return 'Draft — not on phones';
  if (l !== 'Live') return niceLive(l);
  if (!v.shows(r)) return `Not for ${as === 'signed_in' ? 'members' : 'visitors'}`;
  const f = formOf(r);
  if (f.kind === 'dinner' && as !== 'signed_in') return 'Not for visitors';
  return OFFICE.has(f.kind) ? 'Not in the first five' : 'Another card comes first';
}

/**
 * The editor's one line on where the card stands — worked out from the same rules as its line in the
 * list and the phone (homeShows, shelfOf, rowState), for the Home the phone is showing, so the three
 * never disagree. `keep`: what stops a card that's switched on from saving — phones keep its last saved
 * version until it's whole again. → { text, tone: 'on' | 'bad' | '' }
 */
function standingOf({ row, f, publishable, keep, as, shows: v, shelf }) {
  // switched on or not, a plate card for visitors reaches no one (pickTimely shows it only to members)
  if (f.kind === 'dinner' && f.audience === 'signed_out') {
    return { text: 'Nobody sees it: the app shows the plate card only to members. Choose Members or Everyone.', tone: 'bad' };
  }
  if (!f.published) {
    return publishable.length
      ? { text: `A draft — only you see it. Before it can go on phones: ${publishable[0]}`, tone: 'bad' }
      : { text: 'A draft — only you see it. Ready — switch it on to show it.', tone: '' };
  }
  const bad = keep.length ? 'bad' : '';
  const held = (seen) => (keep.length
    ? ` ${seen ? 'Phones keep the last saved version' : 'It stays as it was last saved'} until: ${keep[0]}` : '');
  const live = liveLabel(row);
  if (live.startsWith('Starts')) return { text: `Scheduled — phones show it from ${niceDay(f.starts_on)}.${held(false)}`, tone: bad };
  if (live !== 'Live') return { text: `${niceLive(live)} — phones don’t show it any more. Change the dates to bring it back.${held(false)}`, tone: bad };
  if (!row.id) return { text: 'Saving — it reaches phones as soon as it has saved.', tone: '' };
  const who = as === 'signed_in' ? 'members' : 'visitors';
  if (!v.shows(row)) {
    const them = f.audience === 'signed_in' ? 'Members' : 'Visitors';
    return { text: `Only ${them.toLowerCase()} see it — show Home as ${them} to see where it is.${held(false)}`, tone: bad };
  }
  const reach = held(true) || ' Changes reach phones as you make them.';
  if (row === v.onPhones) {
    return {
      text: `${f.kind === 'dinner' ? 'On top of Home for members while Wednesday dinner is taking reservations.'
        : `On phones now — the card on top of Home for ${who}.`}${reach}`,
      tone: bad || 'on',
    };
  }
  const i = shelf.findIndex((x) => x.row === row);
  if (i >= 0) return { text: `On phones now — #${i + 1} in the Announcements row for ${who}.${reach}`, tone: bad || 'on' };
  if (f.kind === 'dinner') return { text: 'Visitors never see the plate card — it’s for members, while dinner reservations are open.', tone: '' };
  return {
    text: `${OFFICE.has(f.kind)
      ? `Switched on, but not on ${who}’ phones: Announcements shows five at most, and this one comes later.`
      : `Switched on, but another card comes first for ${who}.`}${held(false)}`,
    tone: bad,
  };
}

/* ─────────────── What's Happening (BethesdaApp utils/churchCalendar.js, the same rules) ─────────────── */

const fromISO = (s) => {
  const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
};
const clockOf = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};
/** normalize(): the calendar's rows as the app holds them, past ones dropped. */
function upcomingOf(rows, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return (rows || []).map((e) => {
    const start = fromISO(e.start_date);
    const end = fromISO(e.end_date);
    return {
      id: e.id,
      title: e.title || '',
      cat: e.category || 'Event',
      when: start,
      end: end || start,
      times: [clockOf(e.start_time), clockOf(e.end_time)].filter(Boolean).join(' – '),
      location: e.location || '',
      featured: e.featured === true,
      imageUrl: /^https?:\/\/[^\s]+$/i.test(String(e.image_url || '').trim()) ? String(e.image_url).trim() : '',
    };
  }).filter((e) => e.when && e.end >= today);
}
const runOf = (ev, upcoming) => upcoming.filter((e) => e.title === ev.title);
const soonest = (list) => [...(list || [])].sort((a, b) => (a.when && b.when ? a.when - b.when : 0));
// buildHappening().cards (BethesdaApp utils/churchCalendar.js): the office's "Featured" events, soonest
// first, one per title, four at most — and nothing else. With none ticked there are none; the app no
// longer guesses a Big Events headline into a card (user, 2026-09-27: "Remove the pumpkin olympic and
// veterans day example cards from the app").
function featuredOf(upcoming) {
  const chosen = [];
  const seen = new Set();
  soonest(upcoming).forEach((e) => {
    if (!e.featured || seen.has(e.title) || chosen.length >= 4) return;
    seen.add(e.title);
    chosen.push(e);
  });
  return chosen;
}
/** nextOthers(): the next three under What's Happening, leaving out what's up in Announcements. */
function nextOthers(upcoming, shown, n = 3) {
  const skip = new Set((shown || []).map((e) => e.title));
  const seen = new Set();
  const out = [];
  soonest(upcoming).forEach((e) => {
    if (out.length >= n || skip.has(e.title) || seen.has(e.title)) return;
    seen.add(e.title);
    out.push(e);
  });
  return out;
}
function relativeDay(when, now = new Date()) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(when) - day(now)) / 86400000);
  return {
    top: days >= 0 && days < 7 ? DAY_NAMES[when.getDay()].slice(0, 3) : MON_SHORT[when.getMonth()],
    lead: days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : '',
  };
}
function runWhen(ev, upcoming) {
  const run = runOf(ev, upcoming);
  const last = run[run.length - 1];
  return run.length > 1
    ? `${MON_SHORT[ev.when.getMonth()]} ${ev.when.getDate()} – ${MON_SHORT[last.when.getMonth()]} ${last.when.getDate()}`
    : `${DAY_NAMES[ev.when.getDay()]}, ${MON_LONG[ev.when.getMonth()]} ${ev.when.getDate()}`;
}
function rowMeta(ev, upcoming) {
  const run = runOf(ev, upcoming);
  const oneOf = (key) => { const vals = new Set(run.map((e) => e[key]).filter(Boolean)); return vals.size === 1 ? [...vals][0] : ''; };
  return run.length > 1
    ? [oneOf('times'), oneOf('location')].filter(Boolean).join(' · ')
    : [ev.times, ev.location].filter(Boolean).join(' · ');
}
function longWhen(ev) {
  let s = `${DAY_NAMES[ev.when.getDay()]}, ${MON_LONG[ev.when.getMonth()]} ${ev.when.getDate()}`;
  if (+ev.end !== +ev.when) s += ` – ${MON_LONG[ev.end.getMonth()]} ${ev.end.getDate()}`;
  return s;
}

// A featured event's picture, the app's way (churchCalendar.js photoFor): the office's own picture on
// the event, else its room's photo (Pillar's Locations, the name matched loosely), else a photo that
// comes with the app — the room's, the event's, or the church's. → { url } or { stock }
const normName = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squashName = (s) => normName(s).replace(/ /g, '');
const ROOM_PHOTOS = { 'lyn class': 'lyn', sanctuary: 'hero' };
const TITLE_PHOTOS = { "men's bible study": 'lyn', 'mac powell concert': 'mac' };
function lookName(map, s) {
  if (!s) return null;
  const n = normName(s);
  const q = squashName(s);
  const k = Object.keys(map).find((x) => normName(x) === n || squashName(x) === q);
  return k ? map[k] : null;
}
function eventPhoto(ev, rooms) {
  if (ev.imageUrl) return { url: ev.imageUrl };
  const db = {};
  (rooms || []).forEach((l) => { if (l && l.name && l.photo_url) db[l.name] = l.photo_url; });
  const room = lookName(db, ev.location);
  if (room) return { url: room };
  return { stock: lookName(ROOM_PHOTOS, ev.location) || lookName(TITLE_PHOTOS, ev.title) || 'hero' };
}

/** The newest sermon members can see — the one Home's big card shows (the app reads the same Sunday
 *  from the church's YouTube channel, with YouTube's title and picture). */
function latestSermon(list) {
  const shown = (Array.isArray(list) ? list : []).filter((s) => s && s.published !== false && String(s.title || '').trim());
  const when = (s) => { const t = Date.parse(s.date || ''); return Number.isFinite(t) ? t : -Infinity; };
  const best = shown.reduce((a, s) => (!a || when(s) > when(a) ? s : a), null);
  if (!best) return null;
  return { title: String(best.title).trim(), link: String(best.videoLink || '').trim(), picture: String(best.thumbnailUrl || '').trim() };
}

const NO_DINNER = { open: false, menu: [] };

/**
 * The rest of Home that this page doesn't edit, read once so the phone is the whole screen: the
 * office's Home photo (Settings → Page photos), the latest sermon (Watch), the calendar and its rooms'
 * photos (What's Happening, and the featured events that lead Announcements) and the Wednesday dinner
 * (the plate card's menu). Each is only read; a failure leaves the app's own stand-in (its words, its
 * photos).
 */
function useHomeExtras() {
  const [header, setHeader] = useState(undefined);
  const [latest, setLatest] = useState(undefined);
  const [upcoming, setUpcoming] = useState(undefined);
  const [rooms, setRooms] = useState([]);
  const [plate, setPlate] = useState(NO_DINNER);
  const [bigPic, setBigPic] = useState(null);
  useEffect(() => {
    let alive = true;
    const settle = (read, ok, fallback) => Promise.resolve().then(read)
      .then((v) => { if (alive) ok(v); }, () => { if (alive) ok(fallback); });
    settle(listPageHeaders, (h) => setHeader((h && h.home) || null), null);
    settle(getSermons, (list) => setLatest(latestSermon(list)), null);
    settle(listHomeEvents, (rows) => setUpcoming(upcomingOf(rows)), []);
    settle(listHomeLocations, (rows) => setRooms(Array.isArray(rows) ? rows : []), []);
    settle(dinnerNow, (d) => setPlate(d && d.open && Array.isArray(d.menu) ? d : NO_DINNER), NO_DINNER);
    return () => { alive = false; };
  }, []);
  // the latest sermon's picture as the app shows it: its card IS the YouTube upload, so YouTube's picture
  // — the 1280-wide one when YouTube made it, else hqdefault — before the office's own
  const link = latest ? latest.link : '';
  useEffect(() => {
    let alive = true;
    setBigPic(null);
    if (link && youtubeThumbs(link)) {
      Promise.resolve().then(() => youtubePicture(link)).then((p) => { if (alive && p) setBigPic(p); }, () => {});
    }
    return () => { alive = false; };
  }, [link]);
  const sermon = useMemo(() => {
    if (!latest) return latest;   // undefined while it's read, null with none
    const yt = youtubeThumbs(latest.link);
    return { title: latest.title, picture: bigPic || (yt && yt.hq) || latest.picture || '' };
  }, [latest, bigPic]);
  const featured = useMemo(() => (upcoming ? featuredOf(upcoming) : []), [upcoming]);
  const next = useMemo(() => (upcoming ? nextOthers(upcoming, featured, 3) : null), [upcoming, featured]);
  return { header, sermon, upcoming, featured, next, rooms, plate };
}

/* ─────────────────────────────── the page ─────────────────────────────── */

export default function HomePage() {
  const rows = useRows(formOf);
  const tiles = useRows(tileForm);
  const queue = useSaveQueue();
  const { profile } = useAuth() || {};
  // "Hi Brody" on a member's Home — the member is whoever's signed in to Pillar
  const firstName = String((profile && profile.name) || '').trim().split(/\s+/)[0] || '';
  const [view, setView] = useState('cards');
  const [picked, setPicked] = useState(null);
  const [opened, setOpened] = useState(false);   // a narrow screen shows the editor instead of the list
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // the shortcut to type in — from a click on the phone ({ at } so the same one can be asked for again);
  // none at first: all four are open at once, so there's nothing to pick
  const [focusSlot, setFocusSlot] = useState({ slot: null, at: 0 });
  const [tilesReady, setTilesReady] = useState(true);
  const [as, setAs] = useState('signed_in');
  const [sheet, setSheet] = useState(false);     // the picked card, opened on the phone
  // counts the office's own picks: the phone scrolls to what they picked — not to the card picked for
  // them on load, so the phone opens at the top of Home, as a member's does
  const [seek, setSeek] = useState(0);
  const seekNow = () => setSeek((k) => k + 1);
  const [error, setError] = useState('');
  const [toast, undo] = useUndo();
  const uploading = useRef(false);
  const extras = useHomeExtras();

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await listCards();
      rows.load(list);
      setPicked((p) => p ?? (list[0] ? String(list[0].id) : null));
    } catch (e) {
      rows.fail();
      setError(/schema cache|does not exist/i.test(e.message || '')
        ? 'The Home cards table isn’t set up yet — run supabase/app-home-cards.sql in the Supabase SQL editor.'
        : e.message);
    }
  }, [rows.load, rows.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const loadTiles = useCallback(async () => {
    try {
      const saved = await listTiles();
      const by = new Map(saved.map((t) => [t.slot, t]));
      tiles.load(SLOTS.map((s) => ({ id: s.slot, ...tileForm(by.get(s.slot) || {}) })));
      setTilesReady(true);
    } catch (e) {
      // no table yet: the shortcuts still say what the app says, they just can't be changed
      tiles.load(SLOTS.map((s) => ({ id: s.slot, ...tileForm({}) })));
      setTilesReady(!/schema cache|does not exist/i.test(e.message || ''));
    }
  }, [tiles.load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTiles(); }, [loadTiles]);

  const persistTile = useCallback((slot) => queue(`tile:${slot}`, async () => {
    const r = tiles.get(slot);
    if (!r || !tiles.dirty(r)) return;
    const form = tileForm(r);
    try {
      await saveTile({ slot, ...form });
      tiles.saved(slot, form, { id: slot });
    } catch (e) {
      tiles.failed(slot, e.message);
      throw e;
    }
  }), [queue, tiles]);

  // null until the cards have loaded: New waits for them, or the load would sweep a new card away
  const loading = rows.rows === null;
  const list = rows.rows || [];
  const boxes = tiles.rows || [];
  // leaving the page asks first while a card with something in it, or a shortcut, hasn't saved
  useLeaveGuard(list.some((r) => rows.dirty(r) && hasCardContent(formOf(r))) || boxes.some((r) => tiles.dirty(r)));

  // one save for a row, whatever asked for it — the editor, its switch, or a drag
  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = formOf(r);
    try {
      const saved = await saveCard({ ...form, id: rows.idOf(key), sort: r.sort });
      rows.saved(key, form, saved);
    } catch (e) {
      rows.failed(key, e.message);
      throw e;
    }
  }), [queue, rows]);

  // search and filters (Hick: a long list narrowed to what's wanted)
  const q = search.trim().toLowerCase();
  const matches = (r) => {
    if (!q) return true;
    const f = formOf(r);
    const hay = [nameOf(r), f.kicker, f.subtitle, f.body, kindLabel(f.kind), audienceLabel(f.audience)].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  };
  const counts = { all: list.length, live: 0, scheduled: 0, drafts: 0, ended: 0 };
  list.forEach((r) => { counts[stageOf(r)] += 1; });
  const visible = list.filter((r) => matches(r) && (filter === 'all' || stageOf(r) === filter));
  // the order is phones' order, so it's only dragged with every card in view
  const ordered = !q && filter === 'all';

  const current = list.find((r) => r._key === picked) || null;
  const shows = useMemo(() => homeShows(list, as), [list, as]);
  const shelf = useMemo(() => shelfOf(extras.featured, shows.announced), [extras.featured, shows]);
  // A card opens on the phone only where a member can open it: in the Announcements row. The card on top
  // does what its first button says instead (TimelyCard.js), so it never opens to the rest.
  const canOpen = view === 'cards' && !!current && OFFICE.has(formOf(current).kind) && shelf.some((x) => x.row === current);
  const liveFor = (aud) => list.filter((r) => r.id && isLive(r) && (formOf(r).audience === 'everyone' || formOf(r).audience === aud)
    && !(aud === 'signed_out' && formOf(r).kind === 'dinner')).length;

  // A video on its way up stops when its editor closes — so whatever closes it asks first: picking
  // another card, New, Duplicate, Delete, the Shortcuts tab, or a kind that isn't Video.
  const mayLeave = async (then) => !uploading.current || ask(`A video is still uploading. Stop it and ${then}?`);

  async function pick(key) {
    if (key === picked) { setOpened(true); seekNow(); return; }
    if (uploading.current && !(await ask('A video is still uploading. Stop it and open another card?'))) return;
    setPicked(key);
    setOpened(true);
    seekNow();
  }

  // a new card goes FIRST — where it's easiest to find, and where phones will show it once it's on —
  // so it takes a place before every other (a card not saved yet carries it into its first save)
  const firstSort = () => (list.length ? Math.min(...list.map((r) => Number(r.sort) || 0)) - 10 : 10);
  const showNew = (key) => { setPicked(key); setOpened(true); setSearch(''); setFilter('all'); seekNow(); };

  async function add() {
    if (rows.rows === null) return;   // still loading: the list that arrives would replace it
    if (!(await mayLeave('start a new card'))) return;
    showNew(rows.add({ kind: 'image', audience: 'everyone', buttons: [], published: false, sort: firstSort() }, { first: true }));
  }

  async function duplicate(key) {
    if (rows.rows === null) return;
    const r = rows.get(key);
    if (!r || !(await mayLeave('copy this card'))) return;
    const f = formOf(r);
    const title = BUILT_IN.has(f.kind) || !f.title.trim() ? f.title : `${f.title.slice(0, LIMITS.title - 7)} (copy)`;
    // a copy starts as a draft: it saves at once (it has content) but reaches no phone until switched on
    showNew(rows.add({ ...f, title, published: false, sort: firstSort() }, { first: true }));
  }

  async function setLive(key, on) {
    const r = rows.get(key);
    if (!r) return;
    if (on) {
      const problems = cardProblems(formOf(r));
      if (problems.length) { setError(`“${nameOf(r) || 'This card'}” can’t go on phones yet — ${problems[0]}`); return; }
    }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  }

  async function reorder(keys) {
    const before = new Map(list.map((r) => [r._key, r.sort]));
    rows.order(keys);
    const moved = keys.map((k, i) => [k, (i + 1) * 10]).filter(([k, sort]) => before.get(k) !== sort);
    moved.forEach(([k, sort]) => rows.patch(k, { sort }));
    try {
      await Promise.all(moved.map(([k, sort]) => queue(k, async () => {
        const id = rows.idOf(k);
        if (id) await setCardSort(id, sort);   // a card not saved yet takes its place when it is
      })));
    } catch (e) {
      setError(`The new order didn’t save: ${e.message}`);
      load();
    }
  }

  async function remove(key) {
    const r = rows.get(key);
    if (!r || !(await mayLeave('delete this card'))) return;
    const at = list.findIndex((x) => x._key === key);
    // the next card in the list AS SHOWN (search and filter on), so the editor never opens one the list hides
    const shownAt = visible.findIndex((x) => x._key === key);
    const next = shownAt >= 0 ? visible[shownAt + 1] || visible[shownAt - 1] || null : null;
    rows.remove(key);
    setPicked(next ? next._key : null);
    if (!next) setOpened(false);
    // The delete waits its turn behind the card's own saves and only then asks for its id: a card whose
    // first save is still on its way (switched on, then deleted at once) has its id by then (rows.saved
    // keeps it even for a row that's gone), so it can't land on phones while Pillar's list has let it go.
    // A card that came with the list carries its own.
    let id = null;
    try {
      await queue(key, async () => {
        id = rows.idOf(key) ?? r.id ?? null;
        if (id) await deleteCard(id);
      });
    } catch (e) {
      rows.restore({ ...r, id }, at);
      setError(e.message);
      return;
    }
    if (!id) return;   // it never reached the database: nothing to bring back
    undo(`“${nameOf(r) || 'Card'}” deleted.`, async () => {
      try {
        const back = await saveCard({ ...formOf(r), sort: r.sort });
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  async function switchView(v) {
    if (v === view) return;
    if (view === 'cards' && !(await mayLeave('switch to Shortcuts'))) return;
    setView(v);
  }

  // Members never see the Groups shortcut's word — their Home says Members there (HomeShortcuts.js) —
  // so while that word is being changed the phone turns to Visitors, whose Home shows it
  const toSlot = (slot) => { if (slot === 'connect') setAs('signed_out'); };

  // The phone is a way in: a card opens its editor (clicked again, a card in Announcements opens as a
  // member sees it when they tap it), a shortcut or the latest post opens Shortcuts with that one ready
  // to type in. From either tab (the old page only did each from one).
  async function openFromPhone(target) {
    if (target.slot) {
      if (view !== 'boxes') {
        if (!(await mayLeave('change the shortcuts'))) return;
        setView('boxes');
      }
      toSlot(target.slot);
      setFocusSlot({ slot: target.slot, at: Date.now() });
      seekNow();
      return;
    }
    const key = target.card;
    if (view !== 'cards') { setView('cards'); setPicked(key); setOpened(true); seekNow(); return; }
    if (key === picked) {
      if (canOpen) setSheet((s) => !s);
      setOpened(true);
      return;
    }
    await pick(key);
  }

  // the card opened on the phone closes when another is picked, the tab changes, the phone turns to the
  // other Home, or on Escape
  useEffect(() => { setSheet(false); }, [picked, view, as]);
  useHotkeys({ escape: () => setSheet(false) }, sheet);

  const sheetCard = sheet && canOpen ? formOf(current) : null;

  const phone = (
    <PreviewPane label="On phones" note="Home screen" className="ax-home-preview">
      <HomePreview rows={list} view={view} picked={view === 'cards' ? picked : null}
        slot={view === 'boxes' ? focusSlot.slot : null} seek={seek} as={as} setAs={setAs}
        counts={{ signed_in: liveFor('signed_in'), signed_out: liveFor('signed_out') }}
        shows={shows} shelf={shelf} tiles={boxes} extras={extras} onOpen={openFromPhone} firstName={firstName}
        sheet={sheetCard} canOpen={canOpen} setSheet={setSheet} />
    </PreviewPane>
  );

  return (
    <AppShell
      title="Home"
      subtitle="The app’s Home screen — click anything on the phone to change it. Changes save as you type."
      tabs={{ value: view, onChange: switchView, options: [
        { key: 'cards', label: `Cards · ${list.length}` },
        { key: 'boxes', label: 'Shortcuts' },
      ] }}
      fill
    >
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      {view === 'boxes' ? (
        <Workspace className="ax-home">
          <ShortcutsEditor rows={tiles} persist={persistTile} disabled={!tilesReady} focus={focusSlot}
            onFocusSlot={(slot) => { toSlot(slot); if (focusSlot.slot !== slot) { setFocusSlot({ slot, at: 0 }); seekNow(); } }} />
          {phone}
        </Workspace>
      ) : (
        <Workspace detail={opened && !!current} hasPreview className="ax-home">
          <ListPane
            label="Cards"
            newLabel="New card"
            onNew={add}
            newDisabled={loading}
            newHint={loading ? 'Loading the cards…' : undefined}
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search cards…"
            filters={FILTERS.map((x) => ({ ...x, count: counts[x.key] }))}
            filter={filter}
            onFilter={setFilter}
            count={ordered ? `${list.length} card${list.length === 1 ? '' : 's'} · ${counts.live} on phones`
              : `${visible.length} of ${list.length} cards`}
            footer={<CardsFoot ordered={ordered} />}
          >
            {loading ? <Loading /> : (
              <RowList
                rows={visible}
                picked={picked}
                onPick={pick}
                onMove={ordered ? reorder : undefined}
                empty={list.length ? (
                  <div className="ax-empty"><strong>Nothing matches</strong>Try other words, or show All.</div>
                ) : (
                  <div className="ax-empty"><strong>No cards yet</strong>Home shows the latest post under the shortcuts until there’s a card for right now.</div>
                )}
                renderRow={(r) => {
                  const f = formOf(r);
                  const pic = cardPic(f);
                  const state = rowState(r, shows, shelf, as);
                  const sub = rowLine(f, state);
                  return (
                    <>
                      <span className="ax-thumb" style={pic ? { backgroundImage: cssUrl(pic) } : undefined}>
                        {!pic && <Icon d={KIND_ICON[f.kind] || P.doc} size={19} />}
                      </span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${nameOf(r) ? '' : ' muted'}`}>{nameOf(r) || 'New card'}</span>
                        <span className={`ax-row-sub${state.on && !r._error ? ' ax-home-on' : ''}`} title={r._error ? r._error : sub}>
                          {r._error ? <span className="ax-row-flag">Not saved</span> : sub}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                        title={f.published ? 'On phones — switch off to take it down' : 'Off phones — switch on to show it'} />
                    </>
                  );
                }}
              />
            )}
          </ListPane>

          {current ? (
            <CardEditor key={current._key} row={current} rows={rows} persist={persist}
              isNew={!current.id && current._saved === null} uploading={uploading} place={{ as, shows, shelf }}
              onLive={(on) => setLive(current._key, on)} onDelete={() => remove(current._key)}
              onDuplicate={() => duplicate(current._key)} onBack={() => setOpened(false)}
              onSheet={(open) => setSheet(open && canOpen)} />
          ) : (
            <EditorPane label="Card" onBack={() => setOpened(false)} backLabel="Cards"
              empty={loading ? <Loading /> : list.length ? (
                <><strong>Pick a card to change it</strong><span>or start a new one with New card.</span></>
              ) : (
                <><strong>Nothing under the shortcuts yet</strong><span>Start one with New card — until then phones show the latest post.</span></>
              )} />
          )}

          {phone}
        </Workspace>
      )}
      {toast}
    </AppShell>
  );
}

/** Under the list: how the order works, then the keys (only the ones that work here). */
function CardsFoot({ ordered }) {
  const { saves } = usePreview();
  return (
    <>
      <p className="ax-hint ax-home-foot">
        {ordered
          ? 'Phones show the first card here that’s for them, then the next five under Announcements. Drag to choose the order; the switch puts a card on phones or takes it off.'
          : 'Showing some of the cards — clear the search and pick All to drag them into order.'}
      </p>
      <HotkeyHint keys={['n', '/', saves ? 'mod+s' : null]} />
    </>
  );
}

/* ─────────────────────────────── the editor ─────────────────────────────── */

/** The kind of card, as five small icons (Hick: one glance, not five paragraphs) — each named, and
 *  described by the line under the head (and on hover). */
function KindPicker({ value, onChange }) {
  return (
    <div className="ax-seg ax-home-kind" role="radiogroup" aria-label="Kind of card" aria-describedby="ax-home-kind-hint">
      {KINDS.map((k) => (
        <button key={k.key} type="button" role="radio" aria-checked={value === k.key}
          className={value === k.key ? 'on' : ''} title={`${k.label} — ${KIND_HINT[k.key] || k.hint}`} onClick={() => onChange(k.key)}>
          <Icon d={KIND_ICON[k.key]} size={17} /><span className="ax-home-kind-word">{KIND_WORD[k.key]}</span>
        </button>
      ))}
    </div>
  );
}

function CardEditor({ row, rows, persist, isNew, uploading, place, onLive, onDelete, onDuplicate, onBack, onSheet }) {
  const key = row._key;
  const f = formOf(row);
  const builtIn = BUILT_IN.has(f.kind);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const setButtons = (fn) => rows.patch(key, (r) => ({ buttons: fn(formOf(r).buttons) }));

  const blockers = draftProblems(f);
  const empty = !hasCardContent(f);
  // a card that's switched on stays as it was last saved until it's whole again
  const keep = f.published ? cardProblems(f) : [];
  const ready = !empty && blockers.length === 0 && keep.length === 0;
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });
  const why = empty ? 'Type something to save this card' : (blockers[0] || keep[0] || '');
  const waiting = why ? `Not saved — ${why}` : 'Not saved yet';
  const publishable = cardProblems(f);
  // one line under the head on where the card stands — next to the switch that changes it (Fitts), and
  // from the same rules as the list and the phone
  const standing = standingOf({ row, f, publishable, keep, ...place });
  // what's typed here shows when a member opens the card from Announcements: the phone opens it while
  // you type it (only where it can be opened — the page decides)
  const opening = { onFocus: () => onSheet(true) };

  // a video on its way up stops when its drop zone goes, and any kind but Video takes it away: ask first
  const changeKind = async (k) => {
    if (k === f.kind) return;
    if (f.kind === 'video' && uploading.current && !(await ask('A video is still uploading. Stop it and change the kind of card?'))) return;
    set('kind', k);
  };

  return (
    <EditorPane
      label="Card"
      onBack={onBack}
      backLabel="Cards"
      onSave={auto.flush}
      status={(
        <div className="ax-home-status">
          <span className="ax-home-save" title={auto.status === 'waiting' ? waiting : undefined}>
            <SaveState auto={auto} waiting={waiting} />
          </span>
          <KindPicker value={f.kind} onChange={changeKind} />
        </div>
      )}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={f.published} onChange={onLive} label="On phones"
            title={f.published ? 'On phones — switch off to take it down' : 'Off phones — switch on to show it'} />
        </span>
      )}
      actions={(
        <>
          <button type="button" className="ax-headbtn" onClick={onDuplicate} aria-label="Duplicate card"
            title="Duplicate card — the copy starts as a draft">
            <Icon d={COPY_ICON} size={18} />
          </button>
          <button type="button" className="ax-headbtn danger" onClick={onDelete} aria-label="Delete card"
            title="Delete card (Undo for a few seconds)">
            <Icon d={P.trash} size={19} />
          </button>
        </>
      )}
    >
      {/* the kind picked, in words: what it looks like on phones now (read out with the kind picker) */}
      <p id="ax-home-kind-hint" className="ax-home-kind-hint" aria-live="polite">
        <strong>{kindLabel(f.kind)}</strong> — {KIND_HINT[f.kind] || ''}
      </p>
      <p className={`ax-home-state${standing.tone ? ` ${standing.tone}` : ''}`}>{standing.text}</p>

      <Cols>
        <ColA title="Words">
          {builtIn ? (
            <div className="ax-note">
              <Icon d={KIND_ICON[f.kind]} size={18} />
              <span>This is one of the app’s own cards — its words and picture are built in, so there is nothing to write.
                Choose who sees it and when.</span>
            </div>
          ) : (
            <>
              <Field label="Title" count={f.title.length} max={LIMITS.title} htmlFor="ax-home-title">
                <input id="ax-home-title" className="ax-input title" value={f.title} maxLength={LIMITS.title} autoFocus={isNew}
                  placeholder="What the card is about" onChange={(e) => set('title', e.target.value)} />
              </Field>

              <Fields min={170}>
                <Field label="Small line above it" count={f.kicker.length} max={LIMITS.kicker} htmlFor="ax-home-kicker">
                  <input id="ax-home-kicker" className="ax-input" value={f.kicker} maxLength={LIMITS.kicker} placeholder="THIS SUNDAY"
                    onChange={(e) => set('kicker', e.target.value)} />
                </Field>
                <Field label="Line under it" count={f.subtitle.length} max={LIMITS.subtitle} htmlFor="ax-home-subtitle">
                  <input id="ax-home-subtitle" className="ax-input" value={f.subtitle} maxLength={LIMITS.subtitle} placeholder="One short line"
                    onChange={(e) => set('subtitle', e.target.value)} />
                </Field>
              </Fields>

              {/* every card may say more: members read it when they open the card from Announcements */}
              <Field label={f.kind === 'text' ? 'Paragraph' : 'More words'} count={f.body.length} max={LIMITS.body}
                hint="Members read it when they open the card from Announcements, with both buttons. On top of Home a tap does what the first button says instead."
                htmlFor="ax-home-body">
                <GrowText id="ax-home-body" value={f.body} maxLength={LIMITS.body} onChange={(e) => set('body', e.target.value)} {...opening} />
              </Field>
            </>
          )}

          <Field label="Who sees it">
            <Seg label="Who sees it" value={f.audience} options={AUDIENCE} onChange={(a) => set('audience', a)} />
          </Field>
        </ColA>

        <ColB title={builtIn ? 'When' : f.kind === 'text' ? 'Buttons, when' : 'Picture, buttons, when'}>
          {f.kind === 'video' && (
            <Field label="Video">
              <VideoDrop value={f.video_url} onChange={(u) => set('video_url', u)} busyRef={uploading}
                onStill={async (blob) => {
                  if (rows.get(key)?.image_url) return;
                  const pic = await uploadCardImage(blob);
                  if (pic.url) rows.patch(key, (r) => (r.image_url ? {} : { image_url: pic.url }));
                }} />
            </Field>
          )}

          {(f.kind === 'image' || f.kind === 'video') && (
            <Field label={f.kind === 'video' ? 'Picture before it plays' : 'Picture'}
              hint={f.kind === 'video' ? 'An uploaded video brings its own — a still from it.' : null}>
              <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={uploadCardImage} />
            </Field>
          )}

          {builtIn ? null : (
            <Field label={`Buttons (up to ${LIMITS.buttons})`}
              hint="On top of Home a tap does what the first one says; opened from Announcements, the card shows both. A link has to start with https:// — the app opens nothing else.">
              <div className="ax-rows">
                {f.buttons.map((b, i) => (
                  <div key={i} className="ax-home-btnrow">
                    <div className="ax-home-btnrow-top">
                      <input className="ax-input" value={b.label} maxLength={LIMITS.label} placeholder="Label"
                        aria-label={`Button ${i + 1} label`} {...opening}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                      <select className="ax-select" value={b.action} aria-label={`Button ${i + 1} does`} {...opening}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, action: e.target.value, target: '' } : x)))}>
                        {ACTIONS.filter((a) => a.key !== 'video' || f.kind === 'video' || b.action === 'video')
                          .map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                      </select>
                      <button type="button" className="ax-iconbtn danger" title="Remove this button" aria-label={`Remove button ${i + 1}`}
                        onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}>
                        <Icon d={P.close} size={18} />
                      </button>
                    </div>
                    {b.action === 'url' && (
                      <input className="ax-input" value={b.target} inputMode="url" placeholder="https://"
                        aria-label={`Button ${i + 1} link`} {...opening}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                    )}
                    {b.action === 'page' && (
                      <select className="ax-select" value={b.target} aria-label={`Button ${i + 1} page`} {...opening}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                        <option value="">Choose a page…</option>
                        {PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {f.buttons.length < LIMITS.buttons && (
                  <button type="button" className="ax-btn sm fit"
                    onClick={() => { onSheet(true); setButtons((bs) => [...bs, { label: '', action: 'url', target: '' }]); }}>
                    <Icon d={P.plus} size={15} />Add a button
                  </button>
                )}
              </div>
            </Field>
          )}

          {/* when it shows: both labelled, so nobody has to guess which box is which */}
          <div className="ax-field">
            <Fields min={150}>
              <Field label="From" htmlFor="ax-home-from">
                <input id="ax-home-from" className="ax-input" type="date" value={f.starts_on} aria-label="Show from"
                  onChange={(e) => set('starts_on', e.target.value)} />
              </Field>
              <Field label="Until" htmlFor="ax-home-until">
                <input id="ax-home-until" className="ax-input" type="date" value={f.ends_on} aria-label="Show until"
                  onChange={(e) => set('ends_on', e.target.value)} />
              </Field>
            </Fields>
            <p className="ax-hint">Leave both empty to keep it up until you switch it off.</p>
          </div>
        </ColB>
      </Cols>
    </EditorPane>
  );
}

/* ─────────────────────────────── the shortcuts ─────────────────────────────── */

/** All four at once, each its own small form that saves itself (proximity: each box is one thing on
 *  the phone). A click on the phone brings the keyboard to the one clicked. */
function ShortcutsEditor({ rows, persist, disabled, focus, onFocusSlot }) {
  const flushes = useRef(new Map());
  const register = useCallback((slot, flush) => {
    flushes.current.set(slot, flush);
    return () => { flushes.current.delete(slot); };
  }, []);
  const saveAll = useCallback(() => { flushes.current.forEach((flush) => flush()); }, []);
  const boxes = rows.rows;
  return (
    <EditorPane label="Shortcuts" onSave={boxes ? saveAll : undefined}
      status={<span className="ax-home-head-note">Home’s round buttons, and the latest post</span>}>
      {boxes === null ? <Loading /> : (
        <>
          {disabled ? (
            <div className="ax-note spaced">
              <Icon d={P.settings} size={18} />
              <span>These shortcuts can’t be changed yet — run <strong>supabase/app-home-tiles.sql</strong> in Supabase, then reload.</span>
            </div>
          ) : null}
          <div className="ax-home-slots">
            {SLOT_ORDER.map((slot) => {
              const row = boxes.find((r) => r._key === slot);
              return row ? (
                <TileForm key={slot} row={row} rows={rows} persist={persist} disabled={disabled} register={register}
                  picked={focus.slot === slot} focusAt={focus.slot === slot ? focus.at : 0} onFocusSlot={onFocusSlot} />
              ) : null;
            })}
          </div>
          <p className="ax-hint ax-home-slots-hint">What each one opens never changes — only what it says.</p>
        </>
      )}
    </EditorPane>
  );
}

/* ─────────────────────────────── one shortcut (or the latest post) ─────────────────────────────── */

function TileForm({ row, rows, persist, disabled, register, picked, focusAt, onFocusSlot }) {
  const slot = row._key;
  const d = tileOf(slot);
  const f = tileForm(row);
  const set = (k, v) => rows.patch(slot, { [k]: v });
  const problems = tileProblems({ slot, ...f });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: !disabled && problems.length === 0, save: () => persist(slot) });
  const mine = d.button ? !!f.title : !!(f.title || f.subtitle || f.image_url);
  const limit = d.button ? TILE_LIMITS.button : TILE_LIMITS.title;
  const input = useRef(null);
  const box = useRef(null);
  useEffect(() => register(slot, auto.flush), [register, slot, auto.flush]);
  // clicked on the phone: the keyboard goes to this one's word
  useEffect(() => {
    if (!focusAt) return;
    if (box.current && box.current.scrollIntoView) box.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (input.current && input.current.focus && !input.current.disabled) input.current.focus({ preventScroll: true });
  }, [focusAt]);
  const id = `ax-home-tile-${slot}`;

  return (
    // typing in one marks it on the phone too (and the latest post shows there, even under a card)
    <section ref={box} className={`ax-home-slot${picked ? ' on' : ''}`} aria-label={d.name}
      onFocus={() => onFocusSlot && onFocusSlot(slot)}>
      <div className="ax-home-slot-head">
        <span className="ax-home-slot-icon"><Icon d={SLOT_ICON[slot] || P.grid} size={18} /></span>
        <div className="ax-home-slot-names">
          <h3 className="ax-home-slot-name">{d.name}</h3>
          <p className="ax-home-slot-opens">{d.opens}</p>
        </div>
        {disabled ? null : <SaveState auto={auto} waiting={problems[0] || 'Not saved yet'} />}
      </div>

      {/* a fieldset turns off every control inside at once — the picture's buttons too */}
      <fieldset className="ax-home-slot-fields" disabled={disabled}>
        <Field label={d.button ? 'Word on the button' : 'Title'} count={f.title.length} max={limit} htmlFor={id}
          hint={d.button
            ? `One short word under the round button. Leave it empty for the app’s own: “${d.title}”.${slot === 'connect'
              ? ' Signed-in members see “Members” here instead — it opens the directory.' : ''}`
            : `Leave it empty for the app’s own: “${d.title}”.`}>
          <input ref={input} id={id} className={`ax-input${d.button ? '' : ' title'}`} value={f.title} maxLength={limit}
            placeholder={d.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        {d.button ? null : (
          <>
            <Field label="Line under it" count={f.subtitle.length} max={TILE_LIMITS.subtitle} htmlFor={`${id}-sub`}
              hint={`Leave it empty for: “${d.subtitle}”.`}>
              <input id={`${id}-sub`} className="ax-input" value={f.subtitle} maxLength={TILE_LIMITS.subtitle} placeholder={d.subtitle}
                onChange={(e) => set('subtitle', e.target.value)} />
            </Field>
            <Field label="Picture" hint={d.photo}>
              <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={uploadTileImage} />
            </Field>
          </>
        )}
      </fieldset>

      <div className="ax-home-slot-foot">
        <span className="ax-hint">{mine ? 'Members see your words.' : 'It says what the app says.'}</span>
        <button type="button" className="ax-btn quiet sm" disabled={disabled || !mine}
          onClick={() => rows.patch(slot, { title: '', subtitle: '', image_url: '' })}>
          Use the app’s own words
        </button>
      </div>
    </section>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

// Home's geometry on a 393 × 852 phone (BethesdaApp screens/HomeScreen.js; the numbers are in
// css/home.css): the photo runs to 606pt, where the status bar turns dark as you scroll past it
const HERO_H = 606;

// HomeShortcuts.js: a shortcut's word shrinks to fit its 74pt (adjustsFontSizeToFit, down to 0.8 —
// minimumFontScale) before it's cut short. Measured in the app's own face (Be Vietnam Pro 600, 13.5);
// where there's no canvas to measure with, estimated.
const WORD_ROOM = 74;
let measurer;
function wordWidth(word) {
  try {
    if (measurer === undefined) {
      const c = typeof document !== 'undefined' && typeof document.createElement === 'function' ? document.createElement('canvas') : null;
      measurer = (c && typeof c.getContext === 'function' && c.getContext('2d')) || null;
    }
    if (measurer) {
      measurer.font = '600 13.5px "Be Vietnam Pro", sans-serif';
      const w = measurer.measureText(String(word)).width;
      if (w > 0) return w;
    }
  } catch { /* no canvas here: estimate */ }
  return String(word).length * 7.1;
}
const wordFit = (word) => Math.max(0.8, Math.min(1, WORD_ROOM / wordWidth(word)));

// the app's fonts arrive after the first paint (PhoneFrame adds them): measure the words again once they have
function useFontsLoaded() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts) return undefined;
    let alive = true;
    const bump = () => { if (alive) setN((x) => x + 1); };
    if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(bump, () => {});
    if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', bump);
    return () => {
      alive = false;
      if (typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', bump);
    };
  }, []);
}

/** The latest post, as the card under the shortcuts says it when nothing else is on (TimelyCard.js). */
function postOf(tiles) {
  const own = tileForm((tiles || []).find((r) => r._key === 'post') || {});
  const d = tileOf('post');
  return {
    title: own.title && own.title !== 'Latest post' ? own.title : d.title,
    sub: own.subtitle || d.subtitle,
    image: appLink(own.image_url) ? String(own.image_url).trim() : '',
  };
}

/** What Home's one card shows for a card (BethesdaApp components/TimelyCard.js describe). `stock`: a
 *  photo that comes with the app (css/home.css .ax-home-photo-*), where the office gave none; `plate`:
 *  the dinner taking reservations now, whose menu is the plate card's line. */
function timelyOf(c, post, plate) {
  const first = appButtons(c)[0] || null;
  switch (c.kind) {
    case 'dinner': {
      const menu = (plate && plate.menu) || [];
      return { stock: 'community', kicker: 'Wednesday night', title: 'Reserve a plate',
        sub: menu.length ? menu.slice(0, 2).join(' · ') : 'Dinner before the midweek service', go: 'arrow-right' };
    }
    case 'welcome':
      return { stock: 'welcome', kicker: 'Bethesda Baptist', title: 'Welcome to the new Bethesda App', sub: '', go: null };
    case 'post':
      return { photo: post.image, stock: post.image ? '' : 'community', kicker: 'Facebook', title: post.title, sub: post.sub, go: 'arrow-up-right' };
    case 'video':
      return { photo: cardPic(c), kicker: c.kicker, title: c.title, sub: c.subtitle, go: 'play' };
    default:   // image, text: the round button goes where the first button the app keeps goes
      return { photo: cardPic(c), kicker: c.kicker, title: c.title, sub: c.subtitle,
        go: first ? (first.action === 'url' ? 'arrow-up-right' : 'arrow-right') : null };
  }
}

/** For the card on top: what a member's tap does there, and that the rest only shows once it's opened
 *  from Announcements (TimelyCard.js runs the first button; it never opens to the whole card). */
function topNoteOf(c) {
  const buttons = appButtons(c);
  const rest = c.kind !== 'video' && buttons.length > 1 ? 'its More words and second button show' : 'its More words show';
  if (c.kind === 'video') return 'On top of Home a tap plays the video — its More words and buttons show only when it’s opened from Announcements.';
  if (buttons.length) return `On top of Home a tap does what “${buttons[0].label}” does — ${rest} only when it’s opened from Announcements.`;
  return `On top of Home it has no button, so a tap does nothing — ${rest} only when it’s opened from Announcements.`;
}

function HomePreview({ rows, view, picked, slot, seek, as, setAs, counts, shows, shelf, tiles, extras, onOpen, firstName, sheet, canOpen, setSheet }) {
  const { drawer, setOpen } = usePreview();
  const scrollRef = useRef(null);
  const [overPhoto, setOverPhoto] = useState(true);
  const member = as === 'signed_in';
  useFontsLoaded();

  // the status bar: light over the photo, dark once the white page is behind it (HomeScreen.js onScroll)
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof box.addEventListener !== 'function') return undefined;
    const on = () => setOverPhoto(box.scrollTop < HERO_H - PHONE.top);
    box.addEventListener('scroll', on, { passive: true });
    return () => box.removeEventListener('scroll', on);
  }, []);

  // a click on the phone opens that thing's editor — and gets the drawer out of the way of it
  const open = (target) => {
    if (drawer && !(target.card && target.card === picked)) setOpen(false);
    onOpen(target);
  };

  const pickedRow = picked ? rows.find((r) => r._key === picked) || null : null;
  const { onPhones, dinner, other } = shows;
  // the card being changed, where phones show it: in the Announcements row it's outlined where it is;
  // anywhere else it takes the one card's place, with a word on why phones don't show it
  const inShelf = !!pickedRow && shelf.some((x) => x.row === pickedRow);
  const hidden = !!pickedRow && pickedRow !== onPhones && !inShelf;
  // on Shortcuts, the latest post being changed is drawn where it shows, even while a card is on
  const postFirst = slot === 'post';
  const timelyRow = postFirst ? null : hidden ? pickedRow : onPhones;
  const badge = postFirst ? (onPhones ? 'Only when no card is on' : null)
    : hidden ? badgeFor(pickedRow, shows, as)
      : timelyRow && formOf(timelyRow).kind === 'dinner' ? 'While reservations are open' : null;
  const post = postOf(tiles);
  const timely = timelyRow ? timelyOf(formOf(timelyRow), post, extras.plate) : timelyOf({ kind: 'post' }, post, extras.plate);
  // the office's own card, on top for this Home: it can't be opened there, so say what a tap does instead
  const topNote = pickedRow && pickedRow === onPhones && OFFICE.has(formOf(pickedRow).kind) ? topNoteOf(formOf(pickedRow)) : null;

  // bring what the office just picked into view on the phone (and along the Announcements row)
  const target = slot ? `slot-${slot}` : picked ? `card-${picked}` : null;
  useEffect(() => {
    const box = scrollRef.current;
    if (!seek || !target || !box || typeof box.querySelector !== 'function') return;
    const el = box.querySelector(`[data-home="${target}"]`);
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const outer = box.getBoundingClientRect();
    const scale = box.clientHeight ? outer.height / box.clientHeight : 1;
    const r = el.getBoundingClientRect();
    const top = (r.top - outer.top) / (scale || 1) + box.scrollTop;
    const bottom = top + r.height / (scale || 1);
    if ((top < box.scrollTop + 60 || bottom > box.scrollTop + box.clientHeight - 150) && box.scrollTo) {
      box.scrollTo({ top: Math.max(0, top - 140), behavior: 'smooth' });
    }
    const row = el.closest ? el.closest('.ax-home-ann-row') : null;
    if (row && row.scrollTo) row.scrollTo({ left: Math.max(0, el.offsetLeft - 20), behavior: 'smooth' });
  }, [seek]); // eslint-disable-line react-hooks/exhaustive-deps

  const own = (s) => tileForm((tiles || []).find((r) => r._key === s) || {});
  const word = (s) => own(s).title || tileOf(s).title;
  const who = member ? 'Members' : 'Visitors';
  const caption = dinner
    ? `Members see the plate card while reservations are open; otherwise ${other ? `“${nameOf(other)}”` : 'the latest post'}.`
    : onPhones ? `${who} see “${nameOf(onPhones)}” — the first card for them.`
      : `No card for ${member ? 'members' : 'visitors'} right now, so Home shows the latest post.`;

  return (
    <>
      {/* which Home to look at, and how many cards each can get now (per-audience counts) */}
      <div className="ax-home-as">
        <Seg label="Show Home as" value={as} onChange={setAs} options={[
          { key: 'signed_in', label: <>Members <span className="ax-home-as-n">{counts.signed_in}</span></> },
          { key: 'signed_out', label: <>Visitors <span className="ax-home-as-n">{counts.signed_out}</span></> },
        ]} />
      </div>

      <PhoneFrame dock="home" statusBar={overPhoto ? 'light' : 'dark'} scrollRef={scrollRef} profile={member}
        label={`The app’s Home screen, as ${member ? 'a member' : 'a visitor'} sees it`}
        overlay={sheet ? (
          <div className="ax-pa-scrim ax-home-sheetwrap" onClick={() => setSheet(false)}>
            <CardPreview card={sheet} onClose={() => setSheet(false)} />
          </div>
        ) : null}>
        <div className={`ax-pa-screen ax-home-screen ${member ? 'ax-home-member' : 'ax-home-visitor'}`}>
          {/* signed out, the profile button is the glass pill "Sign in" (ProfileButton.js), held at the
              top while the page scrolls under it */}
          {member ? null : (
            <div className="ax-home-float" aria-hidden="true">
              <span className="ax-pa-glass ax-home-signin"><PhoneIcon name="user" size={16} /><span className="ax-pa-ui">Sign in</span></span>
            </div>
          )}
          {/* the photo across the top with the website's headline over it (HomeScreen.js) — the office's
              Home photo, else the church photo that comes with the app */}
          <div className="ax-home-hero">
            <div className={`ax-home-hero-photo${extras.header ? '' : ' ax-home-photo-hero'}`}
              style={extras.header ? { backgroundImage: cssUrl(extras.header) } : undefined} />
            <div className="ax-home-hero-shade" />
            <div className="ax-pa-blur ax-home-hero-blur" />
            <div className="ax-home-hero-foot" />
            {/* "Hi Brody", signed in: on the profile button's row, top left (HomeScreen.js s.greeting) */}
            {member && firstName ? <div className="ax-home-greeting">Hi {firstName}</div> : null}
            <div className="ax-home-headline" role="img" aria-label="Where every life matters">
              <div className="ax-home-line">
                <span className="ax-home-hl">Where&nbsp;</span>
                <span className="ax-home-reel"><span className="ax-home-reel-in ax-home-hl"><span>Every</span><span>Your</span><span>Every</span></span></span>
              </div>
              <div className="ax-home-hl ax-home-line2">Life Matters</div>
            </div>
            <div className="ax-home-herobtns">
              {/* FIND A GROUP was GET INVOLVED / GET CONNECTED until the app's 2026-09-23 change */}
              {member ? <span className="ax-pa-btn lg on-dark ax-home-herobtn">Find a Group</span> : (
                <>
                  <span className="ax-pa-btn lg on-dark ax-home-herobtn">Visit</span>
                  <span className="ax-pa-btn lg on-dark-outline ax-home-herobtn ax-home-herobtn-line">Find a Group</span>
                </>
              )}
            </div>
          </div>

          <div className="ax-home-section">
            {/* the four round shortcuts (HomeShortcuts.js): Search, Pray, Groups — Members once signed
                in — and Bulletin */}
            <div className="ax-pa-shortcuts" role="toolbar" aria-label="Shortcuts">
              <PhoneShortcut icon="search" word="Search" />
              <PhoneShortcut icon="heart" word={word('prayer')} slot="prayer" picked={slot === 'prayer'} onOpen={open} />
              {member
                ? <PhoneShortcut icon="person" size={23} word="Members" slot="connect" picked={slot === 'connect'} onOpen={open}
                    label="Members always see “Members” here — change the word visitors see" />
                : <PhoneShortcut icon="users" word={word('connect')} slot="connect" picked={slot === 'connect'} onOpen={open} />}
              <PhoneShortcut icon="file-text" word={word('bulletin')} slot="bulletin" picked={slot === 'bulletin'} onOpen={open} />
            </div>

            {/* ONE card for right now (TimelyCard.js) */}
            <PhoneTimely t={timely} badge={badge}
              picked={timelyRow ? timelyRow._key === picked : slot === 'post'}
              dataKey={timelyRow ? `card-${timelyRow._key}` : 'slot-post'}
              onPress={timelyRow ? () => open({ card: timelyRow._key }) : () => open({ slot: 'post' })}
              label={timelyRow ? `Change “${nameOf(timelyRow) || 'this card'}”` : 'Change the latest post'} />

            {/* the Announcements row (AnnouncementsShelf.js): featured events, then the office's cards */}
            {shelf.length ? (
              <div className="ax-home-ann">
                <div className="ax-pa-head ax-pa-gutter">
                  <span className="ax-pa-heading">Announcements</span>
                  <span className="ax-pa-seeall">See all</span>
                </div>
                <div className="ax-home-ann-row">
                  {shelf.map((item) => {
                    if (item.ev) {
                      const ev = item.ev;
                      const photo = eventPhoto(ev, extras.rooms);
                      return (
                        <PhoneAnnouncement key={item.key} pic={photo.url} stock={photo.stock} kicker={runWhen(ev, extras.upcoming || [])}
                          title={ev.title} sub={[ev.times, ev.location].filter(Boolean).join(' · ')}
                          label="A featured event — change it in the Calendar" />
                      );
                    }
                    const c = formOf(item.row);
                    return (
                      <PhoneAnnouncement key={item.key} pic={cardPic(c)} video={c.kind === 'video'} kicker={c.kicker}
                        title={c.title} sub={c.subtitle} picked={item.row._key === picked} dataKey={`card-${item.row._key}`}
                        onPress={() => open({ card: item.row._key })} label={`Change “${nameOf(item.row) || 'this card'}”`} />
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* What's Happening, on its cream band (HomeScreen.js + ChurchEvents.js AgendaRow); the app's
                small spinner until the calendar has been read */}
            <div className="ax-home-happening">
              <div className="ax-pa-head">
                <span className="ax-pa-heading">What's Happening</span>
                <span className="ax-pa-seeall">See all</span>
              </div>
              <div className="ax-home-agenda">
                {extras.next == null ? <PhoneSpinner /> : extras.next.length
                  ? extras.next.map((ev, i) => <PhoneAgendaRow key={`${ev.id}-${i}`} ev={ev} upcoming={extras.upcoming || []} />)
                  : <p className="ax-home-hap-empty">Nothing else on the calendar just yet — check back soon.</p>}
              </div>
            </div>
          </div>

          {/* the latest sermon, straddling the photo's edge (HomeScreen.js LatestSermonCard); with no
              picture, the church photo that comes with the app */}
          <div className="ax-home-sermon">
            <div className="ax-home-sermon-label">Watch the latest sermon</div>
            <div className={`ax-pa-pic ax-home-sermon-thumb${extras.sermon && extras.sermon.picture ? '' : ' ax-home-photo-hero'}`}
              style={extras.sermon && extras.sermon.picture ? { backgroundImage: cssUrl(extras.sermon.picture) } : undefined}>
              <span className="ax-pa-scrim-foot" />
              <span className="ax-home-sermon-title">{(extras.sermon && extras.sermon.title) || "This Week's Message"}</span>
              <span className="ax-pa-play corner" />
            </div>
          </div>
        </div>
      </PhoneFrame>

      <p className="ax-phone-cap">
        {caption}
        {shelf.length ? ` ${shelf.length} more under Announcements.` : ''}{' '}Click anything on the phone to change it.
      </p>
      {canOpen ? (
        <button type="button" className="ax-btn quiet sm ax-home-open" onClick={() => setSheet(!sheet)} aria-pressed={!!sheet}>
          {sheet ? 'Back to Home' : 'See it opened, as members do'}
        </button>
      ) : topNote ? <p className="ax-hint ax-home-top-note">{topNote}</p> : null}
    </>
  );
}

/** One round shortcut (HomeShortcuts.js): a 58pt cream disc, its icon, and one word under it that
 *  shrinks to fit as the app's does. */
function PhoneShortcut({ icon, size = 21, word, slot, picked, onOpen, label }) {
  const clickable = slot && onOpen ? press(() => onOpen({ slot }), label || `Change “${word}”`) : {};
  const fit = wordFit(word);
  return (
    <div className="ax-pa-shortcut ax-home-sc" data-home={slot ? `slot-${slot}` : undefined} {...clickable}>
      <span className={`ax-pa-shortcut-disc${picked ? ' ax-pa-picked' : ''}`}><PhoneIcon name={icon} size={size} /></span>
      <span className="ax-pa-shortcut-word" style={fit < 1 ? { '--ax-sc-fit': Math.round(fit * 1000) / 1000 } : undefined}>{word}</span>
    </div>
  );
}

/** Home's one card (TimelyCard.js): a 64pt picture, the words, and the round button for what it does. */
function PhoneTimely({ t, badge, picked, dataKey, onPress, label }) {
  const thumb = ['ax-home-timely-thumb'];
  if (!t.photo && t.stock) thumb.push(`ax-home-photo-${t.stock}`);
  return (
    <div className={`ax-home-timely${picked ? ' ax-pa-picked' : ''}`} data-home={dataKey} {...press(onPress, label)}>
      {badge ? <span className="ax-pa-flag ax-home-flag">{badge}</span> : null}
      <span className={thumb.join(' ')} style={t.photo ? { backgroundImage: cssUrl(t.photo) } : undefined}>
        {!t.photo && !t.stock ? <PhoneIcon name="bell" size={22} /> : null}
      </span>
      <span className="ax-home-timely-main">
        {t.kicker ? <span className="ax-home-timely-kicker">{t.kicker}</span> : null}
        <span className={`ax-home-timely-title${t.title ? '' : ' ax-home-blank'}`}>{t.title || 'Title'}</span>
        {t.sub ? <span className="ax-home-timely-sub">{t.sub}</span> : null}
      </span>
      {t.go ? (
        <span className="ax-pa-go">{t.go === 'play' ? <PhoneIcon name="play" size={20} /> : <PhoneIcon name={t.go} size={18} />}</span>
      ) : null}
    </div>
  );
}

/** A card in the Announcements row (AnnouncementsShelf.js): the picture under a blur and a dark
 *  gradient, the words over it, a dot while it's new, the play disc for a video. `stock`: a photo that
 *  comes with the app (a featured event's room, or the church). */
function PhoneAnnouncement({ pic, stock, video, kicker, title, sub, picked, dataKey, onPress, label }) {
  const photo = !!(pic || stock);
  const cls = ['ax-home-anncard'];
  if (!photo) cls.push('solid');
  if (!pic && stock) cls.push(`ax-home-photo-${stock}`);
  if (video) cls.push('video');
  if (picked) cls.push('ax-pa-picked');
  const clickable = onPress ? press(onPress, label) : { title: label };
  return (
    <div className={cls.join(' ')} data-home={dataKey} style={pic ? { backgroundImage: cssUrl(pic) } : undefined} {...clickable}>
      {photo ? <><span className="ax-pa-blur ax-home-anncard-blur" /><span className="ax-home-anncard-shade" /></> : null}
      <span className="ax-home-anncard-dot" />
      <span className="ax-home-anncard-words">
        {kicker ? <span className="ax-home-anncard-kicker">{kicker}</span> : null}
        <span className={`ax-home-anncard-title${title ? '' : ' ax-home-blank'}`}>{title || 'Title'}</span>
        {sub ? <span className="ax-home-anncard-sub">{sub}</span> : null}
      </span>
      {video ? <span className="ax-pa-play corner" /> : null}
    </div>
  );
}

/** An event under What's Happening (ChurchEvents.js AgendaRow): the date tile, the title, the line. */
function PhoneAgendaRow({ ev, upcoming }) {
  const rel = relativeDay(ev.when);
  const today = rel.lead === 'Today';
  const line = [rel.lead, rowMeta(ev, upcoming)].filter(Boolean).join(' · ') || longWhen(ev);
  return (
    <div className="ax-home-agenda-row">
      <span className={`ax-home-agenda-tile${today ? ' today' : ''}`}>
        <span className="ax-home-agenda-top">{rel.top.toUpperCase()}</span>
        <span className="ax-home-agenda-day">{ev.when.getDate()}</span>
      </span>
      <span className="ax-home-agenda-main">
        <span className="ax-home-agenda-title">{ev.title}</span>
        <span className="ax-home-agenda-meta">{line}</span>
      </span>
      <PhoneIcon name="chevron-right" size={20} className="ax-home-agenda-chev" />
    </div>
  );
}

// the iPhone's own small spinner (ActivityIndicator, 20pt): eight spokes, fading behind the leading one
const SPOKES = [1, 0.3, 0.36, 0.44, 0.52, 0.62, 0.74, 0.87];
/** The app's small spinner in What's Happening while the calendar is read (HomeScreen.js, C.text2). */
function PhoneSpinner() {
  return (
    <span className="ax-home-spin" role="img" aria-label="Loading the calendar">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        {SPOKES.map((o, i) => (
          <line key={i} x1="10" y1="2.4" x2="10" y2="6.6" transform={`rotate(${i * 45} 10 10)`} opacity={o} />
        ))}
      </svg>
    </span>
  );
}

/**
 * A card opened, as the app draws it when a member taps it in Announcements (BethesdaApp
 * components/AnnouncementsShelf.js AnnouncementSheet in BottomSheet.js, with SignInUI.js's Header and
 * buttons): the white sheet over the scrim, its handle and close circle, the kicker and title, the
 * picture, every word the office wrote and the buttons the app keeps — the first filled, the second
 * outlined.
 */
export function CardPreview({ card, onClose }) {
  const c = card;
  const pic = cardPic(c);
  const buttons = appButtons(c);
  const body = String(c.body || '').trim();
  return (
    <div className="ax-pa-sheet ax-home-sheet" role="dialog" aria-label={`${c.title || 'The card'}, opened`}
      onClick={(e) => e.stopPropagation()}>
      <div className="ax-pa-grab" />
      <div className="ax-home-sheet-head">
        <div className="ax-home-sheet-bar">
          <span className="ax-home-sheet-spacer" />
          <span className="ax-home-sheet-close" {...(onClose ? press(onClose, 'Close') : {})}><PhoneIcon name="x" size={18} /></span>
        </div>
        <div className="ax-home-sheet-kicker">{c.kicker || 'Announcement'}</div>
        <div className={`ax-home-sheet-title${c.title ? '' : ' ax-home-blank'}`}>{c.title || 'Title'}</div>
      </div>
      <div className="ax-home-sheet-body">
        {pic ? (
          <div className="ax-home-sheet-pic" style={{ backgroundImage: cssUrl(pic) }}>
            {c.kind === 'video' ? <span className="ax-pa-play corner" /> : null}
          </div>
        ) : null}
        {c.subtitle ? <p className="ax-home-sheet-lead">{c.subtitle}</p> : null}
        {body ? <p className="ax-home-sheet-text">{body}</p> : null}
        {buttons.map((b, i) => (i === 0 ? (
          <span key={i} className="ax-pa-btn lg block ax-home-sheet-btn">
            <span>{b.label}</span><PhoneIcon name={b.action === 'url' ? 'arrow-up-right' : 'arrow-right'} size={18} />
          </span>
        ) : (
          <span key={i} className="ax-pa-btn lg outline block ax-home-sheet-btn"><span>{b.label}</span></span>
        )))}
      </div>
    </div>
  );
}
