import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  listGroups, saveGroup, setGroupSort, deleteGroup, groupProblems, kindPills, KINDS, FILTER_KEYS,
  listPosts, savePost, setPostSort, deletePost, postProblems, isLiveNow, liveLabel,
} from '../../lib/groupPosts';
import { listPageHeaders } from '../../lib/pageHeaders';
// the church calendar exactly as the app reads it (public church events, today → two months out, in
// the app's order) — an existing read, only for the phone's "coming up" chip, "This week" and the
// when / where a group borrows from its next event
import { listHomeEvents } from '../../lib/homeCards';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo, ask,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList,
} from './kit';
import {
  Workspace, ListPane, EditorPane, PreviewPane, Cols, ColA, ColB, Fields, SubPanel,
  PhoneFrame, PhoneIcon, HotkeyHint, usePreview,
} from './layout';

// App → Groups: the app's Groups page (Home's Groups shortcut and Find a Group button, More → Groups —
// one name for it everywhere since the app's 2026-09-23 change), and the cards members swipe through
// there and in the Bulletin's Group Events.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4) — the same workspace as every App page
// (Jakob's law): the list on the left, the one being changed in the middle, the member app's own
// Groups screen on the right, side by side and the height of the window so nothing
// is below the fold (horizontal first).
//   · a group's cards live WITH the group (law of proximity / common region): the group editor's
//     second column lists them, with their switches and drag, and "New card for this group" writes
//     one right there in a panel over the editor — no trip to the Cards tab and back (Tesler: the
//     page carries the work, not the office). A group that hasn't saved yet saves the moment it has
//     a name, then the card is made; a group that can't save yet says why on the button (never a
//     silently dead button — Hick).
//   · the Cards tab stays for every card, the "Everyone" ones included, filtered by group. Card
//     order is ONE order for all of them (the Groups page strip and the Bulletin's Group Events), so
//     a drag inside a group's cards, or in a filtered list, moves only those and leaves every other
//     card where it was (mergeOrder).
//   · the card panel is the shared SubPanel, the same one Watch's "New sermon in this series" opens
//     (Jakob's law: one way to make a thing inside its parent, on every page).
//   · the switches, the save state and Delete sit in the editor's head, beside what they change
//     (Fitts). Von Restorff, one filled button per pane, as on Watch: New group in the list, "New
//     card for this group" in the group, Done in the card panel; on is green.
//   · tabs keep their picks (Doherty): the card panel never moves the Cards tab's pick.
//   · N new · / search · ⌘/Ctrl+S save now · Esc closes the card panel or the phone drawer.
//   · the phone is the app's own screen (BethesdaApp screens/GroupsScreen.js, drawn at its true
//     size and scaled as one piece): the short page photo (the app's own community.jpg when none is
//     picked), the search, the filter pills, "From the groups", "All groups" — a cream card each,
//     with what the church calendar says ("3 coming up", the next event's when and where, "This
//     week"), who leads it and Follow — and "Can't find one that fits?"; the picked group or card
//     outlined, and a Pillar flag when it isn't on phones yet. Clicking a group or a card on the
//     phone opens it here.

/* ─────────────────────────────── forms and pure helpers ─────────────────────────────── */

export const groupForm = (r) => ({
  name: r.name || '',
  kind: r.kind || '',
  about: r.about || '',
  meets: r.meets || '',
  location: r.location || '',
  audience: r.audience || '',
  filter_key: r.filter_key || '',
  leaders: (r.leaders || []).map((p) => ({ name: p.name || '', role: p.role || '' })),
  published: r.published !== false,
});
export const postForm = (r) => ({
  group_id: r.group_id || '',
  title: r.title || '',
  body: r.body || '',
  button_label: r.button_label || '',
  button_url: r.button_url || '',
  starts_on: r.starts_on || '',
  ends_on: r.ends_on || '',
  published: r.published !== false,
});
const setupHint = (m) => (/schema cache|does not exist/i.test(m || '') ? ' — run supabase/groups-schema.sql and group-posts.sql first.' : '');
const nextSort = (list) => list.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 10;
const sameId = (a, b) => a != null && b != null && a !== '' && b !== '' && String(a) === String(b);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One order for the whole list, after some of its rows were dragged: `some` is those rows in their
 * new order (a group's cards, or what a search left showing). They take back the places they held
 * between them, in the new order; every other row stays exactly where it was.
 */
export function mergeOrder(all, some) {
  const moving = new Set(some);
  const next = [...some];
  return all.map((k) => (moving.has(k) ? next.shift() : k));
}

// every word typed has to appear somewhere in the row (the app's own search, utils/eventFilters.js)
const words = (q) => String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
const hits = (parts, q) => {
  const w = words(q);
  if (!w.length) return true;
  const hay = parts.join(' ').toLowerCase();
  return w.every((x) => hay.includes(x));
};
/** A group the search finds: its name, kind, about, when and where, who for, its leaders. */
export function groupMatches(r, q) {
  const f = groupForm(r);
  return hits([f.name, f.kind, f.about, f.meets, f.location, f.audience, ...f.leaders.map((p) => `${p.name} ${p.role}`)], q);
}
/** A card the search finds: its title, message, button, and who it's for. */
export function cardMatches(r, q, group = '') {
  const f = postForm(r);
  return hits([f.title, f.body, f.button_label, group || 'Everyone'], q);
}

// the member app's own rules (BethesdaApp) — so the phone shows what a member would see
/** utils/memberAuth.js initialsOf */
export const initialsOf = (name) => String(name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
/** utils/groupPosts.js: a button is a label AND a web address, or no button */
const webLink = (v) => {
  const url = String(v || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
};
/** screens/GroupsScreen.js ICONS: a face for the ministry, from what the church calls it */
const ICONS = [
  [/youth|student|teen/i, 'users'],
  [/child|kid|nursery|awana/i, 'smile'],
  [/music|choir|worship|praise/i, 'music'],
  [/pray/i, 'heart'],
  [/mission|outreach/i, 'globe'],
  [/bible|study|class|school/i, 'book-open'],
  [/senior|golden/i, 'coffee'],
];
export const iconFor = (name) => (ICONS.find(([re]) => re.test(name)) || [null, 'users'])[1];
// the calendar's ministries (utils/eventFilters.js MINISTRY_FILTERS — FILTER_KEYS has the same keys and words)
const MINISTRIES = FILTER_KEYS.filter((k) => k.key);
/** utils/eventFilters.js MINISTRY_FILTERS: which calendar events belong to a ministry — its
 * categories, or words in the event's title. */
export const MINISTRY_RULES = {
  kids: { words: /\b(kid|kids|children|child|awana|vbs|preschool)\b/i },
  youth: { cats: ['Youth & Young Adults'], words: /\b(youth|student|students)\b/i },
  college: { cats: ['Youth & Young Adults'], words: /\b(college|young adults?)\b/i },
  women: { words: /\b(women|women's|ladies|girls)\b/i },
  men: { words: /(\bmen\b|\bmen's|\bboys\b)/i },
};
const isMinistry = (key) => !!key && Object.prototype.hasOwnProperty.call(MINISTRY_RULES, key);
/** utils/eventFilters.js matchesFilter, for a ministry */
export function matchesMinistry(key, ev) {
  if (!isMinistry(key)) return false;
  const f = MINISTRY_RULES[key];
  return (f.cats || []).includes(ev.cat) || (!!f.words && f.words.test(ev.title));
}

// utils/churchCalendar.js: the days and months it says, a date read as a LOCAL day (never UTC), a time
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = 7 * 24 * 60 * 60 * 1000;   // screens/GroupsScreen.js WEEK
function fromISO(s) {
  const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
}
function appTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}
/** utils/churchCalendar.js normalize: the rows as the app holds them; what has ended is dropped. */
export function calendarEvents(rows, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return (rows || []).map((e) => {
    const when = fromISO(e.start_date);
    const end = fromISO(e.end_date);
    return {
      title: e.title || '',
      cat: e.category || 'Event',
      when,
      end: end || when,
      times: [appTime(e.start_time), appTime(e.end_time)].filter(Boolean).join(' – '),
      location: e.location || '',
    };
  }).filter((e) => e.when && e.end >= today);
}
/** screens/GroupsScreen.js meetsWhen: "Wednesday at 6:30 PM", from the next thing on the calendar. */
export function meetsWhen(ev) {
  if (!ev?.when) return null;
  const day = DAYS[ev.when.getDay()];
  const time = String(ev.times || '').split('–')[0].trim();
  return time ? `${day} at ${time}` : `${day}, ${SHORT[ev.when.getMonth()]} ${ev.when.getDate()}`;
}
/**
 * screens/GroupsScreen.js groupsWith, for one group: how many things its ministry has on the calendar
 * (null before the calendar is read — the app's own "not yet"), the next one, and whether that is
 * inside a week. A group not tied to the calendar has nothing on it.
 */
export function calendarFor(filterKey, events, now = new Date()) {
  if (!events) return { count: null, next: null, soon: false };
  const mine = isMinistry(filterKey)
    ? events.filter((ev) => matchesMinistry(filterKey, ev)).sort((a, b) => a.when - b.when)
    : [];
  const next = mine.length ? mine[0] : null;
  return { count: mine.length, next, soon: !!(next && next.when - now <= WEEK) };
}

/**
 * The pills under the search on the Groups page (screens/GroupsScreen.js groupFilters), keyed
 * as the app keys them: All; This week once a group's next event is inside seven days (`soon`); a
 * pill per kind once two different kinds are in use (sorted); a pill per calendar ministry once two
 * different ones are in use (in the order the groups first name them). The app also offers
 * "Following" (the groups that phone follows), which Pillar can't know. Only drawn when there's more than All.
 */
export function phonePills(groups) {
  const out = [{ key: 'all', label: 'All' }];
  if (groups.some((g) => g.soon)) out.push({ key: 'week', label: 'This week' });
  const kinds = [];
  groups.forEach((g) => {
    const k = String(g.kind || '').trim();
    if (k && !kinds.includes(k)) kinds.push(k);
  });
  if (kinds.length > 1) kinds.sort().forEach((k) => out.push({ key: `kind:${k}`, label: k }));
  const mins = [];
  groups.forEach((g) => {
    const m = MINISTRIES.find((x) => x.key === g.filter_key);
    if (m && !mins.includes(m)) mins.push(m);
  });
  if (mins.length > 1) mins.forEach((m) => out.push({ key: `who:${m.key}`, label: m.label }));
  return out;
}

/* ─────────────────────────────── the page ─────────────────────────────── */

export default function GroupsPage() {
  const groups = useRows(groupForm);
  const posts = useRows(postForm);
  const queue = useSaveQueue();
  const [tab, setTab] = useState('groups');
  const [pickedGroup, setPickedGroup] = useState(null);
  const [pickedPost, setPickedPost] = useState(null);
  // the editor is what they're looking at (a row was clicked, or New) — on a narrow screen it shows
  // instead of the list; the first row being picked by itself on load doesn't count
  const [opened, setOpened] = useState(false);
  const [subCard, setSubCard] = useState(null);   // the card open in the panel over the group editor
  // the blank card "New card for this group" made, as it was made ({ key, json }) — closing the panel
  // on it untouched throws it away; a card the panel only opened is never thrown away
  const blankRef = useRef(null);
  const [making, setMaking] = useState(null);      // the group saving so its first card can go with it (its key)
  const makingRef = useRef(null);                  // the same, at once (a second click before the next render)
  const [gq, setGq] = useState('');
  const [gf, setGf] = useState('all');
  const [pq, setPq] = useState('');
  const [pf, setPf] = useState('all');
  const [header, setHeader] = useState(null);      // the Groups page's photo (Settings → Page photos)
  const [events, setEvents] = useState(null);      // the church calendar as the app holds it (null: not read)
  const [error, setError] = useState('');
  const [toast, undo] = useUndo();
  const pickRef = useRef(pickedGroup);   // the group picked right now, for a save that finishes later
  pickRef.current = pickedGroup;

  const load = useCallback(async () => {
    setError('');
    const [g, p] = await Promise.allSettled([listGroups(), listPosts()]);
    if (g.status === 'fulfilled') {
      groups.load(g.value);
      setPickedGroup((k) => k ?? (g.value[0] ? String(g.value[0].id) : null));
    } else { groups.fail(); setError(`${g.reason?.message}${setupHint(g.reason?.message)}`); }
    if (p.status === 'fulfilled') {
      posts.load(p.value);
      setPickedPost((k) => k ?? (p.value[0] ? String(p.value[0].id) : null));
    } else { posts.fail(); setError((e) => e || `${p.reason?.message}${setupHint(p.reason?.message)}`); }
  }, [groups.load, groups.fail, posts.load, posts.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // the page's photo, as the app shows it — the office's pick, else the app's own (''). Only an
  // https:// address, as the app keeps only those (BethesdaApp utils/pageHeaders.js clean)
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(listPageHeaders)
      .then((h) => {
        const url = String((h && h.groups) || '');
        if (alive) setHeader(/^https:\/\/\S+$/.test(url) ? url : '');
      })
      .catch(() => { if (alive) setHeader(''); });
    return () => { alive = false; };
  }, []);

  // the calendar, read once (the phone's cards count what each group's ministry has coming up). A
  // read that fails leaves it unread — what the app shows when it can't reach the calendar
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => listHomeEvents())
      .then((rows) => { if (alive) setEvents(calendarEvents(rows)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const gl = groups.rows || [];
  const pl = posts.rows || [];
  useLeaveGuard(gl.some((r) => groups.dirty(r) && r.name?.trim()) || pl.some((r) => posts.dirty(r) && r.title?.trim()));

  // ── saving ──
  const persistGroup = useCallback((key) => queue(`g:${key}`, async () => {
    const r = groups.get(key);
    if (!r || !groups.dirty(r)) return;
    const form = groupForm(r);
    try {
      const saved = await saveGroup({ ...form, id: groups.idOf(key), sort: r.sort });
      groups.saved(key, form, saved);
    } catch (e) { groups.failed(key, e.message); throw e; }
  }), [queue, groups]);

  const persistPost = useCallback((key) => queue(`p:${key}`, async () => {
    const r = posts.get(key);
    if (!r || !posts.dirty(r)) return;
    const form = postForm(r);
    try {
      const saved = await savePost({ ...form, id: posts.idOf(key), sort: r.sort });
      posts.saved(key, form, saved);
    } catch (e) { posts.failed(key, e.message); throw e; }
  }), [queue, posts]);

  // ── the card panel over the group editor ──
  // Done (or leaving the group) closes it. The blank card "New card for this group" made goes with it
  // when nothing on it changed — not a letter, a date, who it's for or its switch; a card the panel
  // only opened, or one with anything on it, stays. The Cards tab's pick is left alone (Doherty).
  const neighbour = (k) => {
    const at = pl.findIndex((x) => x._key === k);
    return (pl[at + 1] || pl[at - 1] || null)?._key ?? null;
  };
  function closeCard() {
    const k = subCard;
    const made = blankRef.current;
    blankRef.current = null;
    setSubCard(null);
    if (!k || !made || made.key !== k) return;
    const r = posts.get(k);
    if (r && r._saved === null && JSON.stringify(postForm(r)) === made.json) {
      if (pickedPost === k) setPickedPost(neighbour(k));
      posts.remove(k);
    }
  }
  // the panel lets go of its card without throwing anything away (it moved, or it was deleted)
  function releaseCard() {
    blankRef.current = null;
    setSubCard(null);
  }

  // ── picking ──
  function switchTab(next) {
    if (next === tab) return;
    if (subCard) closeCard();
    setTab(next);
    setOpened(false);   // the other tab opens on its list (narrow screens)
  }
  function pickGroup(key) {
    if (subCard && key !== pickedGroup) closeCard();   // the panel belongs to the group it was opened in
    setTab('groups');
    setPickedGroup(key);
    setOpened(true);
  }
  function pickPost(key) {
    // clicking the panel's own card on the phone carries it to the Cards tab as it is — never thrown
    // away on the way; any other card closes the panel as Done would
    if (key === subCard) releaseCard();
    else if (subCard) closeCard();
    setTab('cards');
    setPickedPost(key);
    setOpened(true);
  }

  // ── adding ──
  function addGroup() {
    if (subCard) closeCard();
    setTab('groups');
    setGq('');
    setGf('all');   // the new row can't hide behind a search or a kind
    setPickedGroup(groups.add({ name: '', leaders: [], published: false, sort: nextSort(gl) }));
    setOpened(true);
  }
  function addPost() {
    if (subCard) closeCard();
    setTab('cards');
    setPq('');
    // filtered to one group: the new card is for that group (Tesler — one choice fewer)
    const gid = pOn.startsWith('g:') ? pOn.slice(2) : '';
    setPickedPost(posts.add({ group_id: gid, title: '', published: false, sort: nextSort(pl) }));
    setOpened(true);
  }
  /**
   * "New card for this group": a group that has never saved saves first (it needs to be whole for
   * that — the button says what's missing), then the card, in a panel. A group already saved can
   * always take a card: the card only needs the group's id, not its unsaved edits.
   */
  async function newCardFor(key) {
    const r = groups.get(key);
    if (!r || makingRef.current === key) return;
    let id = groups.idOf(key);
    if (!id) {
      if (groupProblems(groupForm(r)).length) return;   // the button says what's missing
      makingRef.current = key;
      setMaking(key);
      try {
        await persistGroup(key);
      } catch (e) {
        setError(`The group didn’t save, so its card can’t be made yet: ${e.message}`);
        return;
      } finally {
        if (makingRef.current === key) makingRef.current = null;
        setMaking((m) => (m === key ? null : m));
      }
      id = groups.idOf(key);
      if (!id || pickRef.current !== key) return;   // they moved on to another group meanwhile
    }
    const blank = { group_id: String(id), title: '', published: false, sort: nextSort(pl) };
    const k = posts.add(blank);
    blankRef.current = { key: k, json: JSON.stringify(postForm(blank)) };
    setSubCard(k);
  }
  function openCard(key) {
    if (subCard === key) return;
    if (subCard) closeCard();
    setSubCard(key);   // the Cards tab keeps its own pick
  }

  // ── on / off ──
  async function setLive(which, key, on) {
    const api = which === 'group' ? groups : posts;
    const form = which === 'group' ? groupForm : postForm;
    const persist = which === 'group' ? persistGroup : persistPost;
    const r = api.get(key);
    if (!r) return;
    if (on) {
      const problems = which === 'group' ? groupProblems(form(r)) : postProblems(form(r));
      if (problems.length) { setError(`Not yet — ${problems[0]}`); return; }
    }
    setError('');
    api.patch(key, { published: on });
    try { await persist(key); } catch (e) { api.patch(key, { published: !on }); setError(e.message); }
  }

  // ── order: `keys` is the WHOLE list in its new order (mergeOrder for a part of it) ──
  async function reorder(which, keys) {
    const api = which === 'group' ? groups : posts;
    const list = which === 'group' ? gl : pl;
    const save = which === 'group' ? setGroupSort : setPostSort;
    const before = new Map(list.map((r) => [r._key, r.sort]));
    api.order(keys);
    const moved = keys.map((k, i) => [k, (i + 1) * 10]).filter(([k, sort]) => before.get(k) !== sort);
    moved.forEach(([k, sort]) => api.patch(k, { sort }));
    try {
      // each on its row's own queue, so it can't race that row's autosave
      await Promise.all(moved.map(([k, sort]) => queue(`${which === 'group' ? 'g' : 'p'}:${k}`, async () => {
        const id = api.idOf(k);
        if (id) await save(id, sort);
      })));
    } catch (e) { setError(`The new order didn’t save: ${e.message}`); load(); }
  }
  const movePart = (which, part) => reorder(which, mergeOrder((which === 'group' ? gl : pl).map((r) => r._key), part));

  // ── deleting (at once, with Undo; a group with cards asks first — its cards go with it) ──
  async function removeGroup(key) {
    const r = groups.get(key);
    if (!r) return;
    const id = groups.idOf(key);
    const mine = id ? pl.filter((p) => sameId(p.group_id, id)) : [];
    // the ones in the database (the table deletes them with the group — ON DELETE CASCADE); a card
    // never saved just goes
    const cards = mine.filter((p) => p._saved !== null);
    if (cards.length && !(await ask(`Delete “${r.name}”? Its ${cards.length} card${cards.length === 1 ? '' : 's'} go with it.`))) return;
    const at = gl.findIndex((x) => x._key === key);
    const next = gl[at + 1] || gl[at - 1];
    if (subCard) releaseCard();
    groups.remove(key);
    mine.forEach((p) => posts.remove(p._key));
    setPickedGroup(next ? next._key : null);
    // the Cards tab's pick moves only when it was one of the cards that went
    if (mine.some((p) => p._key === pickedPost)) setPickedPost(pl.find((x) => !mine.includes(x))?._key ?? null);
    if (!id) return;
    try {
      await queue(`g:${key}`, () => deleteGroup(id));
    } catch (e) { setError(e.message); load(); return; }
    undo(`“${r.name || 'Group'}” deleted${cards.length ? ` with its ${cards.length} card${cards.length === 1 ? '' : 's'}` : ''}.`, async () => {
      try {
        // a NEW id (the table makes it), so each card is put back pointing at the new one
        const back = await saveGroup({ ...groupForm(r), sort: r.sort });
        setPickedGroup(groups.restore(back, at));
        for (const p of cards) {
          const card = await savePost({ ...postForm(p), group_id: back.id, sort: p.sort });
          posts.restore(card, pl.findIndex((x) => x._key === p._key));
        }
      } catch (e) { setError(`Couldn’t bring it all back: ${e.message}`); load(); }
    });
  }

  async function removePost(key) {
    const r = posts.get(key);
    if (!r) return;
    const at = pl.findIndex((x) => x._key === key);
    const id = posts.idOf(key);
    // the Cards tab's pick moves only when it's the card going (a delete in the group's card panel
    // leaves the Cards tab where it was — Doherty)
    const wasPicked = pickedPost === key;
    if (subCard === key) releaseCard();
    posts.remove(key);
    if (wasPicked) setPickedPost(neighbour(key));
    if (!id) return;
    try {
      await queue(`p:${key}`, () => deletePost(id));
    } catch (e) { posts.restore({ ...r, id }, at); setError(e.message); return; }
    undo(`“${r.title || 'Card'}” deleted.`, async () => {
      try {
        const back = await savePost({ ...postForm(r), sort: r.sort });
        const k = posts.restore(back, at);
        if (wasPicked) setPickedPost(k);
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  // ── what the lists show ──
  const groupName = useMemo(() => {
    const by = new Map(gl.filter((g) => g.id).map((g) => [String(g.id), g.name]));
    return (id) => (id ? by.get(String(id)) || 'A deleted group' : '');
  }, [gl]);
  const cardCount = useMemo(() => {
    const by = new Map();
    pl.forEach((p) => { if (p.group_id) by.set(String(p.group_id), (by.get(String(p.group_id)) || 0) + 1); });
    return (id) => (id ? by.get(String(id)) || 0 : 0);
  }, [pl]);

  // Hick: a filter that can't narrow anything isn't offered (one kind on every group is "All")
  const groupFilters = useMemo(() => {
    const kinds = new Map();
    gl.forEach((g) => { const k = String(g.kind || '').trim(); if (k) kinds.set(k, (kinds.get(k) || 0) + 1); });
    const out = [{ key: 'all', label: 'All', count: gl.length }];
    [...kinds.keys()].sort().forEach((k) => out.push({ key: `kind:${k}`, label: k, count: kinds.get(k) }));
    const hidden = gl.filter((g) => g.published === false).length;
    if (hidden) out.push({ key: 'hidden', label: 'Hidden', count: hidden });
    return out.length === 2 && out[1].count === gl.length ? [] : out.length > 1 ? out : [];
  }, [gl]);
  const cardFilters = useMemo(() => {
    const out = [{ key: 'all', label: 'All', count: pl.length }];
    const everyone = pl.filter((p) => !p.group_id).length;
    if (everyone) out.push({ key: 'everyone', label: 'Everyone', count: everyone });
    gl.forEach((g) => {
      const n = g.id ? cardCount(g.id) : 0;
      if (n) out.push({ key: `g:${g.id}`, label: String(g.name || '').trim() || 'A group', count: n });
    });
    return out.length === 2 && out[1].count === pl.length ? [] : out.length > 1 ? out : [];
  }, [gl, pl, cardCount]);
  const gOn = groupFilters.some((f) => f.key === gf) ? gf : 'all';
  const pOn = cardFilters.some((f) => f.key === pf) ? pf : 'all';
  const groupShows = (r) => {
    if (gOn === 'hidden') return r.published === false;
    if (gOn.startsWith('kind:')) return String(r.kind || '').trim() === gOn.slice(5);
    return true;
  };
  const cardShows = (r) => {
    if (pOn === 'everyone') return !r.group_id;
    if (pOn.startsWith('g:')) return sameId(r.group_id, pOn.slice(2));
    return true;
  };
  const shownGroups = gl.filter((r) => groupShows(r) && groupMatches(r, gq));
  const shownPosts = pl.filter((r) => cardShows(r) && cardMatches(r, pq, groupName(r.group_id)));

  const liveGroups = gl.filter((g) => g._saved !== null && g.published !== false).length;
  const livePosts = pl.filter((p) => p._saved !== null && isLiveNow(p)).length;
  const loading = groups.rows === null || posts.rows === null;
  const curGroup = gl.find((r) => r._key === pickedGroup) || null;
  const curPost = pl.find((r) => r._key === pickedPost) || null;
  const subRow = subCard ? pl.find((r) => r._key === subCard) || null : null;
  const groupCards = curGroup && curGroup.id ? pl.filter((p) => sameId(p.group_id, curGroup.id)) : [];
  const kinds = [...new Set([...KINDS, ...gl.map((g) => String(g.kind || '').trim()).filter(Boolean)])];
  const savedGroups = gl.filter((g) => g.id);
  const pills = kindPills(gl.filter((g) => g._saved !== null).map(groupForm));

  const groupsCount = `${shownGroups.length === gl.length ? '' : `${shownGroups.length} of `}${plural(gl.length, 'group')} · ${liveGroups} in the app`;
  const cardsCount = `${shownPosts.length === pl.length ? '' : `${shownPosts.length} of `}${plural(pl.length, 'card')} · ${livePosts} showing`;
  const nothing = (q, noun) => (
    <div className="ax-empty"><strong>No {noun} match</strong>{q.trim() ? `Nothing has “${q.trim()}” in it.` : 'Try another filter.'}</div>
  );

  return (
    <AppShell
      title="Groups"
      subtitle="The groups on the app’s Groups page, and the cards members swipe through there and in the Bulletin. Changes save as you type."
      tabs={{ value: tab, onChange: switchTab, label: 'Show', options: [
        { key: 'groups', label: `Groups · ${gl.length}` },
        { key: 'cards', label: `Cards · ${pl.length}` },
      ] }}
      fill
    >
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      {loading ? <Loading /> : (
        <Workspace detail={opened} hasPreview className="ax-groups">
          {tab === 'groups' ? (
            <ListPane label="Groups" newLabel="New group" onNew={addGroup}
              search={gq} onSearch={setGq} searchPlaceholder="Search groups…"
              filters={groupFilters} filter={gOn} onFilter={setGf} count={groupsCount}
              footer={<ListFoot hint="Drag to change the order members see." />}>
              <RowList rows={shownGroups} picked={pickedGroup} onPick={pickGroup} onMove={(k) => movePart('group', k)}
                empty={gl.length ? nothing(gq, 'groups') : <div className="ax-empty"><strong>No groups</strong>Add the church’s groups and ministries.</div>}
                renderRow={(r) => {
                  const f = groupForm(r);
                  const n = cardCount(r.id);
                  return (
                    <>
                      <span className="ax-thumb"><Icon d={P.users} size={19} /></span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${f.name.trim() ? '' : ' muted'}`}>{f.name.trim() || 'New group'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [f.kind || 'No kind', n ? plural(n, 'card') : '', r._saved === null ? 'Not saved yet' : f.meets].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive('group', r._key, on)}
                        title={f.published ? 'In the app — switch off to hide it' : 'Hidden — switch on to show it'} />
                    </>
                  );
                }} />
            </ListPane>
          ) : (
            <ListPane label="Cards" newLabel="New card" onNew={addPost}
              search={pq} onSearch={setPq} searchPlaceholder="Search cards…"
              filters={cardFilters} filter={pOn} onFilter={setPf} count={cardsCount}
              footer={<ListFoot hint="Drag to change the order members swipe through." />}>
              <RowList rows={shownPosts} picked={pickedPost} onPick={pickPost} onMove={(k) => movePart('post', k)}
                empty={pl.length ? nothing(pq, 'cards') : <div className="ax-empty"><strong>No cards</strong>Add one and it appears under the filters on the Groups page.</div>}
                renderRow={(r) => {
                  const f = postForm(r);
                  const state = r._saved === null ? 'Not saved yet' : (f.published && liveLabel(r) !== 'Live' ? liveLabel(r) : '');
                  return (
                    <>
                      <span className="ax-thumb"><Icon d={P.announce} size={18} /></span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${f.title.trim() ? '' : ' muted'}`}>{f.title.trim() || 'New card'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [groupName(f.group_id) || 'Everyone', state].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive('post', r._key, on)}
                        title={f.published ? 'Showing — switch off to hide it' : 'Hidden — switch on to show it'} />
                    </>
                  );
                }} />
            </ListPane>
          )}

          {tab === 'groups' ? (
            curGroup ? (
              <GroupEditor key={curGroup._key} row={curGroup} rows={groups} persist={persistGroup} kinds={kinds}
                isNew={curGroup._saved === null} cards={groupCards} pickedCard={subCard} making={making === curGroup._key}
                events={events}
                onBack={() => setOpened(false)}
                onLive={(on) => setLive('group', curGroup._key, on)}
                onDelete={() => removeGroup(curGroup._key)}
                onNewCard={() => newCardFor(curGroup._key)}
                onOpenCard={openCard}
                onCardLive={(k, on) => setLive('post', k, on)}
                onCardsMove={(keys) => movePart('post', keys)}>
                {subRow ? (
                  <CardPanel key={subRow._key} row={subRow} rows={posts} persist={persistPost} groups={savedGroups}
                    groupName={groupName} onDone={closeCard}
                    onLive={(on) => setLive('post', subRow._key, on)}
                    onDelete={() => removePost(subRow._key)} />
                ) : null}
              </GroupEditor>
            ) : (
              <EditorPane label="Group" onBack={() => setOpened(false)}
                empty={<><strong>Pick a group to change it</strong>or add a new one.</>}>{null}</EditorPane>
            )
          ) : curPost ? (
            <PostEditor key={curPost._key} row={curPost} rows={posts} persist={persistPost}
              groups={savedGroups} isNew={curPost._saved === null}
              onBack={() => setOpened(false)}
              onLive={(on) => setLive('post', curPost._key, on)} onDelete={() => removePost(curPost._key)} />
          ) : (
            <EditorPane label="Card" onBack={() => setOpened(false)}
              empty={<><strong>Pick a card to change it</strong>or write a new one.</>}>{null}</EditorPane>
          )}

          <PreviewPane note="Groups page">
            <GroupsPhone header={header} groups={gl} posts={pl} events={events}
              pickedGroup={tab === 'groups' ? pickedGroup : null}
              pickedPost={tab === 'cards' ? pickedPost : subCard}
              onGroup={pickGroup} onPost={pickPost} />
            <p className="ax-phone-cap">
              {tab === 'cards' || subCard
                ? 'The card as members see it — on this page and in the Bulletin’s Group Events.'
                : pills.length
                  ? 'Each kind in use becomes a pill, and so does each calendar tie once two are in use. Click a group on the phone to open it.'
                  : 'A kind pill appears once two different kinds are in use — one kind on every group is the same as “All”.'}
            </p>
          </PreviewPane>
        </Workspace>
      )}
      {toast}
    </AppShell>
  );
}

/** The list's foot: how its order works, and the keys that work right now — N and / wait while the
 * card panel is open (layout.jsx ListPane), ⌘S only while an editor saves on it. */
function ListFoot({ hint }) {
  const { saves, sub } = usePreview();
  return (
    <>
      <p className="ax-hint ax-gr-drag">{hint}</p>
      <HotkeyHint keys={[!sub && 'n', !sub && '/', saves && 'mod+s']} />
    </>
  );
}

/* ─────────────────────────────── a group ─────────────────────────────── */

function GroupEditor({
  row, rows, persist, kinds, isNew, cards, pickedCard, making, events,
  onBack, onLive, onDelete, onNewCard, onOpenCard, onCardLive, onCardsMove, children,
}) {
  const key = row._key;
  const f = groupForm(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const setLeaders = (fn) => rows.patch(key, (r) => ({ leaders: fn(groupForm(r).leaders) }));
  const problems = groupProblems(f);
  const ready = problems.length === 0;
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });
  // never a silently dead button: it says what it's waiting for. Only a group that has never saved
  // waits (it saves first, so it has to be whole); a saved one takes a card whatever is half-typed
  const why = row.id ? ''
    : !f.name.trim() ? 'Give the group a name first — then its cards can go with it.'
    : problems.length ? `Not yet — ${problems[0]}` : '';
  // what the calendar tie gives the group's card on phones right now (the app's own count and words)
  const tie = MINISTRIES.find((m) => m.key === f.filter_key);
  const cal = tie ? calendarFor(f.filter_key, events) : null;
  const tieNow = !cal || cal.count == null ? ''
    : cal.count ? ` On phones now: “${cal.count} coming up” — next, ${cal.next.title || 'an event'}, ${meetsWhen(cal.next)}.`
    : ` Nothing on the calendar matches ${tie.label} in the next two months.`;

  return (
    <EditorPane label="Group" onBack={onBack} onSave={auto.flush}
      status={<SaveState auto={auto} waiting={`Not saved — ${problems[0] || 'give the group a name'}`} />}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={f.published} onChange={onLive} label="In the app"
            sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
        </span>
      )}
      actions={(
        <button type="button" className="ax-headbtn danger" onClick={onDelete} aria-label="Delete group" title="Delete group">
          <Icon d={P.trash} size={18} />
        </button>
      )}>
      <Cols>
        {/* words about the group on one side, its cards on the other (proximity) */}
        <ColA title="The group">
          <Field label="Name" count={f.name.length} max={80}>
            <input className="ax-input title" value={f.name} maxLength={80} autoFocus={isNew} placeholder="The group’s name"
              aria-label="Name" onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Kind" hint="Shows under the name on phones, and becomes a filter pill once two kinds are in use. Pick one or type your own.">
            <div className="ax-chips" role="group" aria-label="Kinds">
              {kinds.map((k) => (
                <button key={k} type="button" className={`ax-chip${f.kind === k ? ' on' : ''}`} aria-pressed={f.kind === k}
                  onClick={() => set('kind', f.kind === k ? '' : k)}>{k}</button>
              ))}
            </div>
            <input className="ax-input" value={f.kind} maxLength={40} placeholder="Or type a kind" aria-label="Kind"
              onChange={(e) => set('kind', e.target.value)} />
          </Field>
          <Field label="About" count={f.about.length} max={1000}>
            <GrowText value={f.about} maxLength={1000} minRows={3} placeholder="What this group is, in your own words."
              aria-label="About" onChange={(e) => set('about', e.target.value)} />
          </Field>
          <Fields min={170}>
            <Field label="When it meets">
              <input className="ax-input" value={f.meets} maxLength={120} placeholder="Sundays at 9:45 AM"
                aria-label="When it meets" onChange={(e) => set('meets', e.target.value)} />
            </Field>
            <Field label="Where">
              <input className="ax-input" value={f.location} maxLength={120} placeholder="The room"
                aria-label="Where" onChange={(e) => set('location', e.target.value)} />
            </Field>
          </Fields>
          <Field label="Who it’s for" hint="Shows under the name on phones, after the kind.">
            <input className="ax-input" value={f.audience} maxLength={80} placeholder="Anyone welcome"
              aria-label="Who it’s for" onChange={(e) => set('audience', e.target.value)} />
          </Field>
          <Field label="Tied to the calendar"
            hint={`How the app counts what this group has coming up, and where a blank “When it meets” or “Where” comes from. Leave it off for a group with nothing on the calendar.${tieNow}`}>
            <Seg label="Tied to the calendar" value={f.filter_key} onChange={(k) => set('filter_key', k)}
              options={FILTER_KEYS.map((k) => ({ key: k.key, label: k.key ? k.label : 'Not tied' }))} />
          </Field>
          <Field label="Leaders" hint="Real names only — members see these.">
            <div className="ax-rows">
              {f.leaders.map((p, i) => (
                <div key={i} className="ax-subrow">
                  <input className="ax-input" value={p.name} placeholder="Name" aria-label={`Leader ${i + 1} name`}
                    onChange={(e) => setLeaders((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="ax-input" value={p.role} placeholder="Role (optional)" aria-label={`Leader ${i + 1} role`}
                    onChange={(e) => setLeaders((ls) => ls.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                  <button type="button" className="ax-iconbtn danger" title="Remove this leader" aria-label={`Remove leader ${i + 1}`}
                    onClick={() => setLeaders((ls) => ls.filter((_, j) => j !== i))}><Icon d={P.close} size={18} /></button>
                </div>
              ))}
              <button type="button" className="ax-btn sm fit"
                onClick={() => setLeaders((ls) => [...ls, { name: '', role: '' }])}>
                <Icon d={P.plus} size={15} />Add a leader
              </button>
            </div>
          </Field>
        </ColA>

        <ColB title="Cards for this group" right="Groups page · Bulletin">
          <RowList rows={cards} picked={pickedCard} onPick={onOpenCard} onMove={onCardsMove}
            empty={<p className="ax-hint ax-gr-nocards">No cards yet. A card is news for this group — members swipe through them on the Groups page and in the Bulletin.</p>}
            renderRow={(r) => {
              const c = postForm(r);
              const label = liveLabel({ ...r, published: c.published });
              const state = r._saved === null ? 'Not saved yet' : !c.published ? 'Hidden'
                : label === 'Live' ? (c.ends_on ? `Until ${c.ends_on}` : 'Showing') : label;
              return (
                <>
                  <span className="ax-row-main">
                    <span className={`ax-row-title${c.title.trim() ? '' : ' muted'}`}>{c.title.trim() || 'New card'}</span>
                    <span className="ax-row-sub">
                      {r._error ? <span className="ax-row-flag">Not saved</span>
                        : [state, c.button_label.trim() ? `Button: ${c.button_label.trim()}` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Toggle small checked={c.published} onChange={(on) => onCardLive(r._key, on)}
                    title={c.published ? 'Showing — switch off to hide it' : 'Hidden — switch on to show it'} />
                </>
              );
            }} />
          <div className="ax-gr-newcard">
            <button type="button" className="ax-btn primary" onClick={onNewCard} disabled={!!why || making}
              title={why || undefined} aria-describedby={why ? `ax-gr-why-${key}` : undefined}>
              {making ? <><span className="ax-spinner" />Saving the group…</> : <><Icon d={P.plus} size={17} />New card for this group</>}
            </button>
            {why ? <p className="ax-hint" id={`ax-gr-why-${key}`}>{why}</p>
              : cards.length > 1 ? <p className="ax-hint">Drag to change the order members swipe through — the other groups’ cards keep their places.</p>
              : null}
          </div>
        </ColB>
      </Cols>
      {children}
    </EditorPane>
  );
}

/* ─────────────────────────────── a card ─────────────────────────────── */

// one card's autosave, shared by the Cards tab's editor and the panel over a group
function usePostEdit(row, rows, persist) {
  const key = row._key;
  const f = postForm(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const problems = postProblems(f);
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: problems.length === 0, save: () => persist(key) });
  const state = liveLabel({ ...row, published: f.published });
  return { key, f, set, problems, auto, state };
}
const showingSub = (ed) => (ed.f.published ? (ed.state === 'Live' ? 'Members see it now' : ed.state) : 'A draft — only you see it');

function PostFields({ ed, groups, isNew }) {
  const { f, set, problems } = ed;
  const buttonProblem = problems.find((m) => /button|link/i.test(m));
  const dateProblem = problems.find((m) => /date/i.test(m));
  return (
    <Cols>
      <ColA title="The card">
        <Field label="Title" count={f.title.length} max={80}>
          <input className="ax-input title" value={f.title} maxLength={80} autoFocus={isNew} placeholder="What’s happening"
            aria-label="Title" onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Who it’s for" hint="A card for everyone shows whatever a member has filtered to.">
          <select className="ax-select" value={f.group_id} aria-label="Who it’s for" onChange={(e) => set('group_id', e.target.value)}>
            <option value="">Everyone</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.published === false ? ' (hidden group)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Message" count={f.body.length} max={600}>
          <GrowText value={f.body} maxLength={600} minRows={3} placeholder="Anything you want to say to this group."
            aria-label="Message" onChange={(e) => set('body', e.target.value)} />
        </Field>
      </ColA>
      <ColB title="Button and dates">
        {/* the hint says what the check allows — http:// or https:// (lib/groupPosts.js postProblems, and
            the app opens either); it used to promise https:// only */}
        <Field label="Button" hint={buttonProblem ? null : 'Optional. Fill in both, or leave both empty. The link has to start with http:// or https://.'}>
          <Fields min={150}>
            <input className="ax-input" value={f.button_label} maxLength={30} placeholder="Label, like Sign up"
              aria-label="Button label" onChange={(e) => set('button_label', e.target.value)} />
            <input className="ax-input" value={f.button_url} inputMode="url" placeholder="https://"
              aria-label="Button link" onChange={(e) => set('button_url', e.target.value)} />
          </Fields>
          {buttonProblem ? <p className="ax-hint bad">{buttonProblem}</p> : null}
        </Field>
        <Field label="When it shows" hint={dateProblem ? null : 'Leave both empty to keep it up until you switch it off.'}>
          <Fields min={150}>
            <label className="ax-field ax-gr-date">
              <span className="ax-gr-date-word">From</span>
              <input className="ax-input" type="date" value={f.starts_on} aria-label="Show from"
                onChange={(e) => set('starts_on', e.target.value)} />
            </label>
            <label className="ax-field ax-gr-date">
              <span className="ax-gr-date-word">Until</span>
              <input className="ax-input" type="date" value={f.ends_on} aria-label="Show until"
                onChange={(e) => set('ends_on', e.target.value)} />
            </label>
          </Fields>
          {dateProblem ? <p className="ax-hint bad">{dateProblem}</p> : null}
        </Field>
        <p className="ax-hint">{f.published ? 'Changes reach phones as you make them.' : 'Switch it on to show it.'}</p>
      </ColB>
    </Cols>
  );
}

function PostEditor({ row, rows, persist, groups, isNew, onBack, onLive, onDelete }) {
  const ed = usePostEdit(row, rows, persist);
  return (
    <EditorPane label="Card" onBack={onBack} onSave={ed.auto.flush}
      status={<SaveState auto={ed.auto} waiting={`Not saved — ${ed.problems[0] || 'give the card a title'}`} />}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={ed.f.published} onChange={onLive} label="Showing" sub={showingSub(ed)} />
        </span>
      )}
      actions={(
        <button type="button" className="ax-headbtn danger" onClick={onDelete} aria-label="Delete card" title="Delete card">
          <Icon d={P.trash} size={18} />
        </button>
      )}>
      <PostFields ed={ed} groups={groups} isNew={isNew} />
    </EditorPane>
  );
}

/** A group's card, written without leaving the group: a panel over the group editor (SubPanel). */
function CardPanel({ row, rows, persist, groups, groupName, onDone, onLive, onDelete }) {
  const ed = usePostEdit(row, rows, persist);
  const who = groupName(ed.f.group_id);
  return (
    <SubPanel title={ed.f.title.trim() || (row._saved === null ? 'New card' : 'Card')}
      sub={who ? `For ${who} — on the Groups page and in the Bulletin` : 'For everyone — on the Groups page and in the Bulletin'}
      status={<SaveState auto={ed.auto} waiting={`Not saved — ${ed.problems[0] || 'give the card a title'}`} />}
      onDone={onDone} onSave={ed.auto.flush}>
      {/* its switch and Delete first, beside the title (Fitts) */}
      <div className="ax-gr-subbar">
        <span className="ax-sw-on">
          <Toggle checked={ed.f.published} onChange={onLive} label="Showing" sub={showingSub(ed)} />
        </span>
        <span className="ax-grow" />
        <button type="button" className="ax-btn danger sm" onClick={onDelete}><Icon d={P.trash} size={16} />Delete card</button>
      </div>
      <PostFields ed={ed} groups={groups} isNew={false} />
    </SubPanel>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

// Feather marks the Groups page draws that the shared PhoneIcon doesn't (GroupsScreen.js ICONS, and
// the office button's envelope)
const MORE_FEATHER = {
  smile: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
  coffee: <><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></>,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
};
function AppIcon({ name, size }) {
  const extra = MORE_FEATHER[name];
  if (!extra) return <PhoneIcon name={name} size={size} />;
  return (
    <svg className="ax-pa-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{extra}</svg>
  );
}

/** screens/GroupsScreen.js ledBy: "Led by Janet Barber", "Led by A and B", "Led by A, B and C" — every
 * leader by name, whole. */
export function ledBy(leaders) {
  const names = (leaders || []).map((p) => p.name).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `Led by ${names[0]}`;
  return `Led by ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// screens/GroupsScreen.js HUES: each KIND of group wears one of the church website's sticker colours —
// on its mark, its filter pill's dot and its tag on an announcement (law of similarity) — a rich tint
// behind, a deep tone for the glyph and words on it. The LIGHT look's pairs are css/groups.css
// .ax-gr-hue-*; here only their order.
export const HUES = ['gold', 'teal', 'tangerine', 'pink', 'red'];
/** screens/GroupsScreen.js categoryOf: the office's kind, else its calendar ministry's name, else "Group". */
export function categoryOf(f) {
  const kind = String(f.kind || '').trim();
  if (kind) return kind;
  const m = MINISTRIES.find((x) => x.key === f.filter_key);
  return m ? m.label : 'Group';
}
/** screens/GroupsScreen.js groupHues: each category a colour, in a steady (alphabetical) order. */
export function groupHues(forms) {
  const cats = [...new Set((forms || []).map(categoryOf))].sort();
  return new Map(cats.map((c, i) => [c, HUES[i % HUES.length]]));
}

const photoUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
// a Pillar flag on the picked piece when a member wouldn't see it (not the app's — ax-pa-flag)
function groupFlag(r) {
  if (r._saved === null) return 'Not saved yet';
  if (r.published === false) return 'Hidden';
  if (!String(r.name || '').trim()) return 'No name';
  return '';
}

/**
 * The Groups page as the member app draws it (BethesdaApp screens/GroupsScreen.js, its 2026-09-23
 * layout), from what is in Pillar right now: the short photo with FIND YOUR PEOPLE over "Groups", the
 * search, the filter pills, "From the groups" (the office's cards), "All groups" — a cream card per
 * published group — and "Can't find one that fits?" with the office one message away. What only a
 * phone knows (the groups it follows: "Your groups", the Following pill, a followed card's blue check)
 * isn't drawn — Pillar shows the page as it first opens. What's picked here is outlined; clicking a
 * group or a card on the phone opens it.
 */
function GroupsPhone({ header, groups, posts, events, pickedGroup, pickedPost, onGroup, onPost }) {
  const { drawer, setOpen } = usePreview();
  const scrollRef = useRef(null);
  const close = () => { if (drawer) setOpen(false); };

  // what a member's phone gets: published groups with a name (utils/groups.js), in the office's order
  const members = groups.filter((g) => g._saved !== null && g.published !== false && String(g.name || '').trim());
  const byId = new Map(members.filter((g) => g.id).map((g) => [String(g.id), g]));
  const picked = groups.find((g) => g._key === pickedGroup) || null;
  // no groups at all: the app falls back to the calendar's ministries (a name, and what the calendar says)
  const fallback = !members.length;
  // each with what the calendar says about its ministry (groupsWith): a count, the next one, soon
  const now = new Date();
  const withCal = (c) => ({ ...c, cal: calendarFor(c.form.filter_key, events, now) });
  const base = (fallback
    ? MINISTRIES.map((m) => ({ key: `min:${m.key}`, form: { ...groupForm({ name: m.label }), filter_key: m.key }, row: null }))
    : members.map((g) => ({ key: g._key, form: groupForm(g), row: g }))).map(withCal);
  // the pills come from what members get (the fallback's five ministries make five pills too)
  const pills = phonePills(base.map((c) => ({ ...c.form, soon: c.cal.soon })));
  // each kind its colour, from what members get (hueOf: the app's HUES[0] for one it doesn't know)
  const hues = groupHues(base.map((c) => c.form));
  const hueOf = (form) => hues.get(categoryOf(form)) || HUES[0];
  // a kind or ministry pill carries its colour's dot (pillHue)
  const pillHue = (key) => {
    const at = key.indexOf(':');
    if (at < 0) return null;
    const what = key.slice(0, at); const value = key.slice(at + 1);
    const label = what === 'kind' ? value : (MINISTRIES.find((x) => x.key === value)?.label || '');
    return hues.get(label) || null;
  };
  let cards = base;
  if (picked && !members.includes(picked)) {
    const at = fallback ? 0 : members.filter((g) => groups.indexOf(g) < groups.indexOf(picked)).length;
    cards = [...base.slice(0, at), withCal({ key: picked._key, form: groupForm(picked), row: picked, flag: groupFlag(picked) }), ...base.slice(at)];
  }

  // the strip: live cards for a group members can see, or for everyone (postsForGroups) — and the
  // picked one wherever it is, flagged when members wouldn't see it
  const strip = posts.map((p) => {
    const f = postForm(p);
    const group = f.group_id ? byId.get(String(f.group_id)) : null;
    const reaches = p._saved !== null && f.title.trim() && isLiveNow(f) && (!f.group_id || group);
    const isPicked = p._key === pickedPost;
    if (!reaches && !isPicked) return null;
    let flag = '';
    if (!reaches) {
      flag = p._saved === null ? 'Not saved yet'
        : !f.published ? 'Draft'
        : liveLabel(f) !== 'Live' ? liveLabel(f)
        : !f.title.trim() ? 'No title'
        : f.group_id && !groups.some((g) => sameId(g.id, f.group_id)) ? 'Its group was deleted'
        : 'Its group is hidden';
    }
    const label = f.button_label.trim();
    const url = webLink(f.button_url);
    const g = group || (f.group_id ? groups.find((x) => sameId(x.id, f.group_id)) : null);
    return {
      key: p._key, flag, picked: isPicked,
      tag: g ? String(g.name || '').trim() : '',
      hue: g ? hueOf(groupForm(g)) : null,
      title: f.title.trim() || 'Title',
      body: f.body.trim(),
      button: label && url ? label : '',
    };
  }).filter(Boolean);

  // bring the picked piece into view on the phone (and along the strip) when the pick changes — not
  // on opening the page, which shows the screen from its top, as a member first sees it
  const pickKey = `${pickedGroup}|${pickedPost}`;
  const firstPick = useRef(true);
  useEffect(() => {
    if (firstPick.current) { firstPick.current = false; return; }
    const box = scrollRef.current;
    if (!box || typeof box.querySelector !== 'function') return;
    const el = box.querySelector('[data-picked="true"]');
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const outer = box.getBoundingClientRect();
    const scale = outer.height && box.clientHeight ? outer.height / box.clientHeight : 1;   // the phone is scaled as one piece
    const at = el.getBoundingClientRect();
    const row = typeof el.closest === 'function' ? el.closest('.ax-gr-strip') : null;
    if (row && row.scrollTo) {
      const r = row.getBoundingClientRect();
      row.scrollTo({ left: Math.max(0, (at.left - r.left) / scale + row.scrollLeft - 20), behavior: 'smooth' });
    }
    const top = (at.top - outer.top) / scale + box.scrollTop;
    const bottom = top + at.height / scale;
    if (box.scrollTo && (top < box.scrollTop + 110 || bottom > box.scrollTop + box.clientHeight - 150)) {
      box.scrollTo({ top: Math.max(0, top - 120), behavior: 'smooth' });
    }
  }, [pickKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (fn) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => { fn(); close(); },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); close(); } },
  });

  return (
    <PhoneFrame dock="more" back statusBar="light" scrollRef={scrollRef} label="The Groups page on a phone">
      <div className="ax-pa-screen ax-pa-dock-space ax-gr-screen">
        {/* the photo, short (150 under the status bar), with the page's name over it; while the photo
            is still being asked for, the header's own dark ground */}
        <div className={`ax-pa-photohead${header === '' ? ' ax-gr-photo-none' : ''}`}
          style={header ? { backgroundImage: photoUrl(header) } : undefined}>
          <div className="ax-pa-blur" />
          <div className="ax-pa-photohead-words">
            <div className="ax-pa-kicker on-photo">Find your people</div>
            <div className="ax-pa-title on-photo">Groups</div>
          </div>
        </div>

        <div className="ax-gr-search"><div className="ax-pa-search">Search groups</div></div>

        {pills.length > 1 ? (
          <div className="ax-pa-filters ax-gr-filters">
            {pills.map((p) => {
              const hue = pillHue(p.key);
              return (
                <span key={p.key} className={`ax-pa-filter${p.key === 'all' ? ' on' : ''}`}>
                  {hue ? <span className={`ax-gr-pill-dot ax-gr-hue-${hue}`} /> : null}{p.label}
                </span>
              );
            })}
          </div>
        ) : null}

        {strip.length ? (
          <div className="ax-gr-section">
            <div className="ax-pa-head ax-pa-gutter"><span className="ax-pa-heading">From the groups</span></div>
            <div className="ax-gr-strip">
              {strip.map((c) => (
                <div key={c.key} className={`ax-gr-ev${c.picked ? ' ax-pa-picked' : ''}`} data-picked={c.picked ? 'true' : undefined}
                  title="Open this card" {...press(() => onPost(c.key))}>
                  {c.flag ? <span className="ax-pa-flag">{c.flag}</span> : null}
                  {c.tag ? <span className={`ax-pa-tag${c.hue ? ` ax-gr-tag-hue ax-gr-hue-${c.hue}` : ''}`}>{c.tag}</span> : null}
                  <div className="ax-gr-ev-title">{c.title}</div>
                  {c.body ? <div className="ax-gr-ev-body">{c.body}</div> : null}
                  {c.button ? (
                    <span className="ax-pa-btn ax-gr-ev-btn"><span>{c.button}</span><PhoneIcon name="arrow-up-right" size={15} /></span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* every group, a cream card each — "All groups" while nothing is followed or searched */}
        <div className="ax-gr-section">
          <div className="ax-pa-head ax-pa-gutter"><span className="ax-pa-heading">All groups</span></div>
          <div className="ax-gr-list">
            {cards.map((c) => (
              <PhoneGroupCard key={c.key} g={c.form} cal={c.cal} flag={c.flag} hue={hueOf(c.form)}
                picked={!!c.row && c.row._key === pickedGroup}
                pick={c.row ? press(() => onGroup(c.row._key)) : null} />
            ))}
          </div>
        </div>

        {/* never a dead end: the office, one message away */}
        <div className="ax-gr-cantfind">
          <span className="ax-gr-cantfind-text">Can’t find one that fits?</span>
          <span className="ax-pa-btn outline ax-gr-office"><AppIcon name="mail" size={16} /><span>Message the office</span></span>
        </div>
      </div>
    </PhoneFrame>
  );
}

/**
 * One group, as GroupCard (GroupsScreen.js) draws it: its mark in its kind's colour and its name,
 * with the kind and who it's for under the name; then, on the name's left edge, when and where (the
 * office's words, else the next event's) and "N coming up" when the calendar has something; who leads
 * it — every face side by side and every name, whole; then "Ask about joining" when there's nothing to
 * say about when or where, and Follow in the same corner of every card.
 */
function PhoneGroupCard({ g, cal, hue, picked, flag, pick }) {
  const next = cal ? cal.next : null;
  const count = cal ? cal.count : null;
  const when = g.meets.trim() || meetsWhen(next) || '';   // the office's words first
  const where = g.location.trim() || next?.location || '';
  const sub = [g.kind.trim(), g.audience.trim()].filter(Boolean).join(' · ');
  const leaders = g.leaders.map((p) => ({ name: p.name.trim(), role: p.role.trim() })).filter((p) => p.name);
  const bare = !next && !when && !where;
  const name = g.name.trim() || 'New group';
  return (
    <div className={`ax-gr-card${picked ? ' ax-pa-picked' : ''}`} data-picked={picked ? 'true' : undefined}
      title={pick ? 'Open this group' : undefined} {...(pick || {})}>
      {flag ? <span className="ax-pa-flag">{flag}</span> : null}
      <div className="ax-gr-card-head">
        <span className={`ax-gr-mark ax-gr-hue-${hue}`}><AppIcon name={iconFor(name)} size={20} /></span>
        <div className="ax-gr-card-name">
          <div className="ax-gr-card-title">{name}</div>
          {sub ? <div className="ax-gr-card-sub">{sub}</div> : null}
        </div>
      </div>
      <div className="ax-gr-card-body">
        {when || where || count > 0 ? (
          <div className="ax-gr-facts">
            {when ? <div className="ax-gr-fact"><PhoneIcon name="clock" size={15} /><span className="ax-gr-fact-text">{when}</span></div> : null}
            {where ? <div className="ax-gr-fact"><PhoneIcon name="map-pin" size={15} /><span className="ax-gr-fact-text">{where}</span></div> : null}
            {count > 0 ? <div className="ax-gr-fact"><PhoneIcon name="calendar" size={15} /><span className="ax-gr-fact-text">{`${count} coming up`}</span></div> : null}
          </div>
        ) : null}
        {leaders.length ? (
          <div className="ax-gr-led">
            <span className="ax-gr-faces">
              {leaders.map((p, i) => <span key={`${p.name}-${i}`} className="ax-gr-face">{initialsOf(p.name)}</span>)}
            </span>
            <span className="ax-gr-led-text">{ledBy(leaders)}</span>
          </div>
        ) : null}
        <div className="ax-gr-card-foot">
          {bare ? <span className="ax-pa-quiet ax-gr-ask">Ask about joining</span> : <span className="ax-gr-foot-space" />}
          <span className="ax-pa-btn ax-gr-follow"><PhoneIcon name="bell" size={15} /><span>Follow</span></span>
        </div>
      </div>
    </div>
  );
}
