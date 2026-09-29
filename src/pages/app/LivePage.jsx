import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getLivestream, putLivestream,
  getLiveCard, pushLiveCard, clearLiveCard, getLiveCardVotes,
  getLiveCardTemplates, saveLiveCardTemplate, deleteLiveCardTemplate,
  getChat, genId,
} from '../../lib/appApi';
import { useAutosave, useUndo, useLeaveGuard, ask, SaveState, Field, GrowText, Toggle, Seg, Alert, Loading } from './kit';
import {
  Workspace, Pane, EditorPane, Fields, Section, SearchBox, FilterChips, HotkeyHint, useHotkeys, usePreview,
  PhoneFrame, PhoneIcon,
} from './layout';

// App → Live: the control room for a service (redesign, 2026-09-23 — Pillar-backups/redesign/DESIGN.md
// §4 and the approved mockup Live.dc.html). One screen, nothing to scroll at 1180px and wider:
//
//   Stream        the go-live switch (it asks first), how it's going, title, link, notes (folded)
//   Show          the card last sent to phones (Take down, a poll's votes as they come) and the
//                 saved cards, each one click from viewers' screens
//   Write a card  a verse, an announcement or a poll, with a phone beside it that draws the card
//                 exactly as the app's live player does (BethesdaApp screens/MediaPlayer.js)
//   Chat          the stream's chat, read-only, on a rail of its own that scrolls by itself
//
// How a card reaches phones (MediaPlayer.js, so the words here never promise more): a phone playing
// the stream asks every 4 s, shows each new card (an id it hasn't seen) for 12 seconds, then hides
// it by itself — Take down doesn't hide it sooner. A phone that opens the stream after the card went
// out never shows it. So "sent", not "on screen", and a saved card can always go out again (a fresh
// id pops it up again).
//
// Laws behind the layout (named where they apply below):
//   Fitts    the service's frequent actions — Show a saved card, Take down, the switch — are big and
//            always in view, never under a long form; a saved card's whole head is its Edit
//   Hick     the rarely touched (the stream's notes) folds away; each card kind shows only its fields
//   Jakob    the same panes, heads, search box, filter chips and phone as every other App page
//   proximity  the phone sits beside the words it draws; Reference and Note share a row
//   Von Restorff  one filled button (Show now); "sent" and "live" are the only green and red
//   Tesler   N writes a new card, / searches the saved ones, ⌘/Ctrl+S saves now, Esc closes a drawer
//
// Widths (css/live.css — container queries on the page, so they follow the room the sidebar leaves):
//   ≥ 1560   stream | show | write | phone | chat — everything at once
//   1140–1559  stream | show | write | chat; Preview puts the phone in the chat's column and the
//              chat becomes a drawer (Chat, top right) — nothing is out of reach
//   760–1139   two columns (stream over show | write); the chat is a drawer (Chat, top right), and
//              Preview adds the phone as a third column, so Take down and Show stay in view
//   < 760    one column in that order (the phone under the card when Preview is on)
//
// Data stays exactly as before: the stream is ONE whole-object PUT (switch and details alike), and
// its isLive is the server's own, read just before each details save (so a switch flipped somewhere
// else is never undone from here); going live fires 'pillar-app-live' for the sidebar's LIVE badge;
// cards keep the shapes the app reads (scripture {reference, text, note}, informative {title, body,
// buttonLabel, destination}, poll {question, options}) with a fresh genId() id; and neither cards nor
// saved cards signal app_refresh (phones poll them — tests/rules.test.mjs).

export const CARD_TYPES = [
  { key: 'scripture', label: 'Scripture' },
  { key: 'informative', label: 'Announcement' },
  { key: 'poll', label: 'Poll' },
];
// where an announcement card's button may go — the app's own pages (BethesdaApp MediaPlayer)
export const DESTINATIONS = [
  { key: '', label: 'No button' },
  { key: 'Sermons', label: 'Watch' },
  { key: 'Give', label: 'Give' },
  { key: 'Bible', label: 'Bible' },
];
export const BLANK = { type: 'scripture', reference: '', text: '', note: '', title: '', body: '', buttonLabel: '', destination: '', question: '', options: ['', ''] };

// how often the page asks: the card last sent (and a poll's votes) every 5 s; the chat every 7 s
// while live, and only every 30 s when it isn't (nobody is chatting); the stream itself every 15 s,
// so a switch flipped somewhere else — another tab, another staffer — shows here. All of them ask
// again the moment the window comes back into focus.
export const CARD_EVERY = 5000;
export const CHAT_EVERY = { live: 7000, off: 30000 };
export const STREAM_EVERY = 15000;
// the page widths the control room changes at (css/live.css has the same numbers)
export const ONE_COLUMN = 760;      // below: one column
export const TWO_COLUMNS = 1140;    // below: two columns, the chat a drawer
export const PHONE_COLUMN = 1560;   // from here the phone has a column of its own
// how long a phone shows a card as it arrives (MediaPlayer.js showVerseCard: setTimeout 12000)
export const CARD_SECONDS = 12;

/**
 * Is the chat a drawer at this workspace width, with Preview open or not? (null: not measured yet —
 * the CSS decides whether its Chat button shows, so the button still works.)
 */
export function chatIsDrawer(width, phoneOpen) {
  if (width == null) return true;
  if (width < ONE_COLUMN) return false;
  if (width < TWO_COLUMNS) return true;
  return width < PHONE_COLUMN && !!phoneOpen;
}

const kindOf = (c) => (c && c.type) || 'scripture';
const destLabel = (key) => (DESTINATIONS.find((d) => d.key === key) || {}).label || key;

/** What a card is called in a list: its title, question or reference. */
export const summary = (c) => (!c ? '' : c.type === 'informative' ? (c.title || 'Announcement') : c.type === 'poll' ? (c.question || 'Poll') : (c.reference || 'Scripture'));

/** The line under a saved card's name: its kind and what else it carries. */
export function detailOf(c) {
  const k = kindOf(c);
  if (k === 'informative') return c.destination && c.buttonLabel ? `Announcement · button: ${destLabel(c.destination)}` : 'Announcement';
  if (k === 'poll') { const n = (c.options || []).length; return `Poll · ${n} answer${n === 1 ? '' : 's'}`; }
  return c.note ? `Scripture · ${c.note}` : 'Scripture';
}

/**
 * The card the app will get, from what's typed: trimmed, a poll's empty answers dropped, and an
 * announcement's button label kept only while its button goes somewhere ("No button" used to send a
 * stale label, and the app then drew a button that only closed the card).
 */
export function buildCard(d, id = genId()) {
  const base = { id, type: d.type };
  if (d.type === 'informative') {
    const destination = d.destination || '';
    return { ...base, title: d.title.trim(), body: d.body.trim(), buttonLabel: destination ? d.buttonLabel.trim() : '', destination };
  }
  if (d.type === 'poll') return { ...base, question: d.question.trim(), options: d.options.map((o) => o.trim()).filter(Boolean) };
  return { ...base, reference: d.reference.trim(), text: d.text.trim(), note: d.note.trim() };
}

/** Why a card can't go out yet, in words — '' when it can (Hick: never a silently dead button). */
export function cardProblem(d) {
  if (d.type === 'informative') {
    if (!d.title.trim()) return 'An announcement needs a title.';
    if (d.destination && !d.buttonLabel.trim()) return 'The button needs a label, like “Give now” — or choose No button.';
    return '';
  }
  if (d.type === 'poll') {
    const n = d.options.filter((o) => o.trim()).length;
    if (!d.question.trim()) return n < 2 ? 'A poll needs a question and at least two answers.' : 'A poll needs a question.';
    if (n < 2) return 'A poll needs at least two answers.';
    return '';
  }
  const ref = d.reference.trim();
  const text = d.text.trim();
  if (!ref && !text) return 'A verse card needs the reference and the verse.';
  if (!ref) return 'Add the reference, like John 3:16.';
  if (!text) return 'Add the words of the verse.';
  return '';
}

/** The field to fix for cardProblem(d) — its id in the composer ('' when nothing is wrong). */
export function problemField(d) {
  if (d.type === 'informative') return !d.title.trim() ? 'ax-live-atitle' : d.destination && !d.buttonLabel.trim() ? 'ax-live-blabel' : '';
  if (d.type === 'poll') {
    if (!d.question.trim()) return 'ax-live-q';
    if (d.options.filter((o) => o.trim()).length >= 2) return '';
    const empty = d.options.findIndex((o) => !o.trim());
    return `ax-live-a${empty < 0 ? 1 : empty + 1}`;
  }
  return !d.reference.trim() ? 'ax-live-ref' : !d.text.trim() ? 'ax-live-verse' : '';
}

/** Nothing typed for the kind that's picked. */
export const isBlank = (d) => (d.type === 'informative' ? !(d.title.trim() || d.body.trim() || d.buttonLabel.trim() || d.destination)
  : d.type === 'poll' ? !(d.question.trim() || d.options.some((o) => o.trim()))
  : !(d.reference.trim() || d.text.trim() || d.note.trim()));

/** A saved card, back in the composer (Edit). */
export function draftOf(t) {
  const type = kindOf(t);
  const d = { ...BLANK, type };
  if (type === 'informative') return { ...d, title: t.title || '', body: t.body || '', buttonLabel: t.buttonLabel || '', destination: t.destination || '' };
  if (type === 'poll') {
    const options = (t.options || []).map((o) => String(o)).slice(0, 5);
    while (options.length < 2) options.push('');
    return { ...d, question: t.question || '', options };
  }
  return { ...d, reference: t.reference || '', text: t.text || '', note: t.note || '' };
}

/** A card without its id — what a saved card is, whatever id it goes out with. */
export const cardFields = (c) => { if (!c) return null; const { id, ...rest } = c; return rest; };
/** The same card? Compared by what it says, not its id (a saved card goes out with a fresh one). */
export const fingerprint = (c) => { const f = cardFields(c); return f ? JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]])) : ''; };

/** A poll's votes as counts, percentages (rounded as the app rounds them) and a total. */
export function tally(options = [], votes = {}) {
  const counts = options.map((_, i) => Number((votes || {})[i]) || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  return { total, rows: options.map((label, i) => ({ label, n: counts[i], pct: total > 0 ? Math.round((counts[i] / total) * 100) : 0 })) };
}

/** The votes that belong to THIS card — the server says which card they're for, as the app checks. */
export const votesFor = (card, v) => (v && v.cardId != null && card && String(v.cardId) !== String(card.id) ? {} : (v && v.votes) || {});

// a chat message, whichever way it was written (the app posts { username, message, timestamp })
export const who = (m) => m.name || m.user || m.username || 'Guest';
export const said = (m) => m.text || m.message || '';
export function clock(m) {
  const t = m.at || m.timestamp;
  if (t == null || t === '') return '';
  const d = new Date(typeof t === 'number' || /^\d+$/.test(String(t)) ? Number(t) : String(t));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const streamForm = (s) => ({ liveTitle: s?.liveTitle || '', liveStreamUrl: s?.liveStreamUrl || '', liveNotes: s?.liveNotes || '' });
const withDefaults = (l) => ({ isLive: false, liveStreamUrl: '', liveTitle: '', liveNotes: '', ...l });
const announce = (on) => window.dispatchEvent(new CustomEvent('pillar-app-live', { detail: on }));

// what's being written survives a trip to another page and back (Doherty: never forgets); a saved
// card being edited saves as it goes, so it needn't be kept
let keptDraft = null;
/** Forget the kept draft (tests). */
export const forgetDraft = () => { keptDraft = null; };

// the workspace's width, told to the page that holds it (the chat drawer's keys follow it)
function WorkWidth({ onChange }) {
  const { width } = usePreview();
  useEffect(() => { onChange(width); }, [width, onChange]);
  return null;
}

// where the keyboard was when a drawer opened, so closing it can put it back (never on <body>)
function refocus(el) {
  if (!el || typeof el.focus !== 'function' || el.isConnected === false) return;
  if (typeof document !== 'undefined' && el === document.body) return;
  el.focus({ preventScroll: true });
}

/* ─────────────────────────────── the page ─────────────────────────────── */

export default function LivePage() {
  const st = useStream();
  const cards = useCards();
  const isLive = !!(st.stream && st.stream.isLive);
  const chat = useChat(isLive);

  const [draft, setDraft] = useState(() => keptDraft || BLANK);
  const [editing, setEditing] = useState(null);        // { id, savedJson } — a saved card in the composer
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const stash = useRef(null);                          // what was being written before Edit
  const [shown, setShown] = useState('');              // the fingerprint of the card just sent from here
  const [held, setHeld] = useState(false);             // leaving a saved card was stopped: it doesn't save as it is
  const [phoneWant, setPhoneOpen] = useState(false);
  const [chatWant, setChatWant] = useState(false);
  const [workW, setWorkW] = useState(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [focusAsk, setFocusAsk] = useState(0);
  const composeRef = useRef(null);
  const searchRef = useRef(null);
  const chatClose = useRef(null);

  // (while a saved card is in the composer, what was being written before it is what's kept)
  useEffect(() => { keptDraft = editing ? stash.current : draft; }, [draft, editing]);
  // any change to what's in the composer answers the "not saved" hint
  useEffect(() => { setHeld(false); }, [draft, editing]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const problem = cardProblem(draft);
  const blank = isBlank(draft);
  const busy = cards.busy;

  // a saved card in the composer saves as it's changed (autosave everywhere — no Save button), once
  // it's a card the app could show
  const tplValue = editing ? cardFields(buildCard(draft, editing.id)) : null;
  const tplDirty = !!editing && JSON.stringify(tplValue) !== editing.savedJson;
  const tplSave = useCallback(async (v) => {
    const id = editing && editing.id;
    if (!id) return;
    const t = { ...v, id };
    await saveLiveCardTemplate(t);
    cards.replaceTemplate(t);
    setEditing((e) => (e && e.id === id ? { ...e, savedJson: JSON.stringify(v) } : e));
  }, [editing, cards.replaceTemplate]); // eslint-disable-line react-hooks/exhaustive-deps
  const tplAuto = useAutosave({ value: tplValue, savedJson: editing ? editing.savedJson : null, ready: !!editing && !problem, save: tplSave });

  // the keyboard in the composer's first field (N, Edit)
  useEffect(() => {
    if (!focusAsk) return;
    const el = composeRef.current;
    const first = el && el.querySelector ? el.querySelector('input:not([type="checkbox"]):not([type="search"]), textarea') : null;
    if (first && first.focus) first.focus({ preventScroll: true });
  }, [focusAsk]);

  // a saved card's edit that can't be saved as it is (the verse emptied, say) is never thrown away by
  // leaving it: the composer stays, the keyboard goes to what's missing, and the line under the
  // buttons says so — with a way back to the saved card (no new confirm dialog: DESIGN §1)
  const holdEdit = () => {
    setHeld(true);
    const id = problemField(draft);
    const el = composeRef.current;
    const f = id && el && el.querySelector ? el.querySelector(`#${id}`) : null;
    if (f && f.focus) f.focus({ preventScroll: false });
  };
  const stuck = tplDirty && !!problem;
  /** Done: the saved card's last changes saved, what was being written before back. → false when held. */
  const leaveEditing = () => {
    if (!editing) return true;
    if (stuck) { holdEdit(); return false; }
    tplAuto.flush();
    setEditing(null);
    setDraft(stash.current || { ...BLANK, type: draft.type });
    stash.current = null;
    return true;
  };
  const editTemplate = (t) => {
    if (editing) {
      if (stuck) { holdEdit(); return; }
      tplAuto.flush();
    } else stash.current = blank ? null : draft;
    const d = draftOf(t);
    setEditing({ id: t.id, savedJson: JSON.stringify(cardFields(buildCard(d, t.id))) });
    setDraft(d);
    setFocusAsk((n) => n + 1);
  };
  // "put back the saved card": the edit that can't save goes, with Undo
  const revertEdit = () => {
    if (!editing) return;
    const was = draft;
    const id = editing.id;
    let saved = null;
    try { saved = JSON.parse(editing.savedJson); } catch { return; }
    setDraft(draftOf(saved));
    cards.undo('The saved card is back.', () => {
      const e = editingRef.current;
      if (e && e.id === id) setDraft(was);
    });
  };
  const removeTemplate = (t) => {
    if (editing && editing.id === t.id) {
      setEditing(null);
      setDraft(stash.current || { ...BLANK, type: draft.type });
      stash.current = null;
    }
    cards.forget(t);
  };
  const showDraft = async () => {
    if (problem || busy) return;
    if (editing) tplAuto.flush();
    const card = buildCard(draft);
    if (await cards.show(card)) setShown(fingerprint(card));
  };
  // a saved card's Show: as saved, with a fresh id so phones pop it up again — but the card that's
  // open in the composer goes out as it reads NOW (its last edits may be under 700 ms old)
  const showTemplate = async (t) => {
    if (busy) return;
    if (editing && editing.id === t.id) {
      if (problem) { holdEdit(); return; }
      await showDraft();
      return;
    }
    await cards.show({ ...t, id: genId() });
  };
  const keepDraft = async () => {
    if (problem || busy) return;
    if (await cards.keep(buildCard(draft))) setDraft({ ...BLANK, type: draft.type });
  };
  const clearDraft = () => {
    const was = draft;
    setDraft({ ...BLANK, type: draft.type });
    cards.undo('Card cleared.', () => {
      // a saved card may be in the composer by now: what was cleared goes back where Done brings it
      // from — never into that card, whose autosave would write it there
      if (editingRef.current) { stash.current = was; keptDraft = was; } else setDraft(was);
    });
  };
  const newCard = () => {
    if (editing && !leaveEditing()) return;
    setFocusAsk((n) => n + 1);
  };

  // from 1560 the phone has a column of its own: Preview has nothing to open there
  const phoneColumn = workW != null && workW >= PHONE_COLUMN;
  const phoneOpen = phoneWant && !phoneColumn;
  useEffect(() => { if (phoneColumn) setPhoneOpen(false); }, [phoneColumn]);
  // the chat is a drawer under 1140, and from 1140 to 1559 while Preview has its column; it's only
  // ever open while it IS one (widen the window and it's a column again, not an open, unseen drawer)
  const chatDrawer = chatIsDrawer(workW, phoneOpen);
  const chatOpen = chatWant && chatDrawer;
  useEffect(() => { if (!chatDrawer) setChatWant(false); }, [chatDrawer]);
  // opening the drawer puts the keyboard on its ×; closing it puts it back where it was (Chat)
  useEffect(() => {
    if (!chatOpen) return undefined;
    const from = typeof document !== 'undefined' ? document.activeElement : null;
    if (chatClose.current && chatClose.current.focus) chatClose.current.focus({ preventScroll: true });
    return () => refocus(from);
  }, [chatOpen]);

  // Tesler: the common things from the keyboard (never while typing, never under a Pillar dialog)
  useHotkeys({
    n: newCard,
    '/': () => searchRef.current && searchRef.current.focus && searchRef.current.focus(),
    'mod+s': () => { st.auto.flush(); tplAuto.flush(); },
    escape: () => { if (chatOpen) setChatWant(false); else if (phoneOpen) setPhoneOpen(false); },
  });

  // the phone: the card being written; with nothing written, the card last sent
  const composing = !!editing || !blank;
  const phoneCard = composing ? buildCard(draft, 'preview') : (cards.active || null);
  const phoneNote = composing ? (editing ? 'Saved card' : 'Your card') : cards.active ? 'Last card sent' : 'Nothing on screen';
  const phoneCap = composing ? `How viewers see it over the live stream: it slides up from the bottom of the player, and each phone hides it after ${CARD_SECONDS} seconds.`
    : cards.active ? `The last card sent. Each phone shows a card for ${CARD_SECONDS} seconds as it arrives; anyone who opens the stream later won’t see it.`
    : 'Nothing on viewers’ screens. Write a card, or show a saved one. Where the “–” is, phones show how many are watching.';

  const draftFp = composing ? fingerprint(buildCard(draft, 'x')) : '';
  const sentAsIs = !!shown && shown === draftFp;
  const okLine = editing ? 'Changes save to this card as you type.'
    : sentAsIs && cards.active && fingerprint(cards.active) === shown ? 'Sent to phones. Save it for later too, or clear it.'
    : 'Ready — show it now, or save it for later.';
  // "Leave site?" only while something here isn't saved anywhere: a card being written that hasn't
  // gone out as it reads, stream details or a saved card's edit still waiting to save
  useLeaveGuard((!editing && !blank && !sentAsIs) || st.dirty || tplDirty);

  const templates = cards.templates;
  const kinds = useMemo(() => {
    const list = templates || [];
    return CARD_TYPES.map((c) => ({ key: c.key, label: c.key === 'informative' ? 'Announcements' : c.key === 'poll' ? 'Polls' : c.label, count: list.filter((t) => kindOf(t) === c.key).length }))
      .filter((c) => c.count > 0);
  }, [templates]);
  const filters = kinds.length > 1 ? [{ key: 'all', label: 'All', count: (templates || []).length }, ...kinds] : null;
  // a kind whose last card went is no longer a chip: back to All rather than an empty list
  const kindNow = filters && filters.some((f) => f.key === kind) ? kind : 'all';
  const q = search.trim().toLowerCase();
  const shownTemplates = (templates || []).filter((t) => (kindNow === 'all' || kindOf(t) === kindNow)
    && (!q || [summary(t), t.reference, t.text, t.note, t.title, t.body, t.buttonLabel, t.question, ...(t.options || [])]
      .some((x) => String(x || '').toLowerCase().includes(q))));
  const onScreen = cards.active ? fingerprint(cards.active) : '';
  const searchable = !!(templates && templates.length);

  const cls = ['ax-live'];
  if (phoneOpen) cls.push('phone-open');
  if (chatOpen) cls.push('chat-open');
  const chatCount = Array.isArray(chat.msgs) ? chat.msgs.length : 0;

  // shown while the chat is a drawer (css/live.css): under 1140, and 1140–1559 with Preview open
  const chatToggle = (
    <button type="button" className={`ax-btn sm ax-live-chat-toggle${chatOpen ? ' on' : ''}${phoneOpen ? ' with-phone' : ''}`} aria-expanded={chatOpen}
      onClick={() => setChatWant(chatDrawer && !chatOpen)} title="The live chat">
      <Icon d={P.chat} size={17} />Chat{chatCount ? <span className="ax-live-chat-n">{chatCount}</span> : null}
    </button>
  );

  return (
    <AppShell title="Live" subtitle="Go live, put cards on viewers’ screens, and follow the chat." actions={chatToggle} fill>
      <Alert onClose={cards.error ? () => cards.setError('') : null}>{cards.error}</Alert>
      <Workspace className={cls.join(' ')}>
        <WorkWidth onChange={setWorkW} />
        <StreamPane st={st} />

        {/* Show: the card last sent, then the saved cards — the service's one-click actions (Fitts) */}
        <Pane className="ax-live-show" bodyClassName="ax-live-show-body" aria-label="Sent and ready to show"
          foot={<HotkeyHint keys={['n', searchable ? '/' : null, 'mod+s']} words={{ n: 'new card', '/': 'search', 'mod+s': 'save now' }} />}>
          <OnScreen active={cards.active} votes={cards.votes} busy={busy} onTakeDown={cards.clear} live={st.stream ? isLive : null} />
          <div className="ax-live-ready-head">
            <div className="ax-live-ready-title">
              <span className="ax-pane-label">Ready to show</span>
              {searchable ? <span className="ax-live-ready-n">{templates.length} saved · one click</span> : null}
            </div>
            {searchable ? (
              <SearchBox value={search} onChange={setSearch} placeholder="Search saved cards…" inputRef={searchRef} />
            ) : null}
            {filters ? <FilterChips filters={filters} value={kindNow} onChange={setKind} label="Saved cards to show" /> : null}
          </div>
          {cards.tplError && templates ? (
            <p className="ax-hint bad">Couldn’t refresh the saved cards: {cards.tplError}{' '}
              <button type="button" className="ax-live-retry" onClick={cards.loadTemplates}>Try again</button></p>
          ) : null}
          <div className="ax-live-tiles" role="list" aria-label="Saved cards">
            {templates === null ? (
              cards.tplError ? (
                <p className="ax-hint bad" role="listitem">Couldn’t load the saved cards: {cards.tplError}{' '}
                  <button type="button" className="ax-live-retry" onClick={cards.loadTemplates}>Try again</button></p>
              ) : <p className="ax-hint" role="listitem">Loading the saved cards…</p>
            ) : templates.length === 0 ? (
              <p className="ax-live-empty" role="listitem"><strong>No saved cards yet.</strong>Write one and choose Save for later — it waits here, one click from the screen.</p>
            ) : shownTemplates.length === 0 ? (
              <p className="ax-hint" role="listitem">No saved card matches.</p>
            ) : shownTemplates.map((t) => {
              const on = !!onScreen && fingerprint(t) === onScreen;
              const mine = !!editing && editing.id === t.id;
              const name = summary(t);
              const subId = `ax-live-sub-${t.id}`;
              return (
                <div key={t.id} role="listitem" className={`ax-live-tile${on ? ' on' : ''}${mine ? ' editing' : ''}`}>
                  {/* the tile's head is its Edit (Fitts: the biggest target; Hick: one button fewer),
                      so Show gets the tile's width however narrow the pane */}
                  <button type="button" className="ax-live-tile-top" onClick={() => (mine ? leaveEditing() : editTemplate(t))}
                    aria-label={mine ? `Stop editing “${name}”` : `Edit “${name}”`} aria-describedby={subId} aria-pressed={mine}
                    title={mine ? 'Done editing' : 'Edit this card'}>
                    <span className={`ax-live-kindic ${kindOf(t)}`} aria-hidden="true"><Icon d={KIND_ICON[kindOf(t)]} size={18} /></span>
                    <span className="ax-live-tile-main">
                      <span className="ax-row-title">{name}</span>
                      <span id={subId} className="ax-row-sub">{on ? 'Sent to phones' : mine ? 'In the composer' : detailOf(t)}</span>
                    </span>
                    <span className="ax-live-tile-mark" aria-hidden="true"><Icon d={mine ? P.check : P.edit} size={16} /></span>
                  </button>
                  <div className="ax-live-tile-acts">
                    {/* always one click, even for the card last sent: phones hide a card after 12 s */}
                    <button type="button" className="ax-btn sm ax-live-go" onClick={() => showTemplate(t)} disabled={busy}
                      title={on ? `Phones show a card for ${CARD_SECONDS} seconds; this puts it up again` : `Show “${name}” on viewers’ screens now`}>
                      <Icon d={on ? P.repeat : P.send} size={16} /><span className="ax-live-go-word">{on ? 'Show again' : 'Show'}</span>
                    </button>
                    <button type="button" className="ax-headbtn danger" onClick={() => removeTemplate(t)}
                      aria-label={`Remove “${name}”`} title="Remove">
                      <Icon d={P.trash} size={17} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Pane>

        {/* Write a card: the fields for the kind picked, then what's missing, said in words */}
        <EditorPane className="ax-live-compose" label="Write a card"
          status={(
            <>
              <span className="ax-pane-label">{editing ? 'Editing' : 'Write a card'}</span>
              {editing ? <SaveState auto={tplAuto} waiting="Not saved yet" /> : null}
            </>
          )}
          actions={(
            <>
              <button type="button" className={`ax-btn sm ax-live-preview-toggle${phoneOpen ? ' on' : ''}`} aria-expanded={phoneOpen}
                onClick={() => setPhoneOpen(!phoneOpen)} title="See the card on a phone">
                <PhoneIcon name="smartphone" size={17} />Preview
              </button>
              {editing ? <button type="button" className="ax-btn sm quiet" onClick={leaveEditing}>Done</button>
                : !blank ? <button type="button" className="ax-btn sm quiet" onClick={clearDraft}>Clear</button> : null}
            </>
          )}>
          <div ref={composeRef} className="ax-live-form">
            <div className="ax-live-seg">
              <Seg label="Kind of card" value={draft.type} onChange={(t) => set('type', t)} options={CARD_TYPES} />
            </div>
            {draft.type === 'scripture' && (
              <>
                {/* proximity: the reference and its note on one row, the verse under them */}
                <Fields min={140}>
                  <Field label="Reference" htmlFor="ax-live-ref">
                    <input id="ax-live-ref" className="ax-input" value={draft.reference} placeholder="Book 1:1" onChange={(e) => set('reference', e.target.value)} />
                  </Field>
                  <Field label="Note (optional)" htmlFor="ax-live-note">
                    <input id="ax-live-note" className="ax-input" value={draft.note} onChange={(e) => set('note', e.target.value)} />
                  </Field>
                </Fields>
                <Field label="Verse" htmlFor="ax-live-verse">
                  <GrowText id="ax-live-verse" value={draft.text} minRows={3} onChange={(e) => set('text', e.target.value)} />
                </Field>
              </>
            )}
            {draft.type === 'informative' && (
              <>
                <Field label="Title" htmlFor="ax-live-atitle">
                  <input id="ax-live-atitle" className="ax-input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
                </Field>
                <Field label="Message" htmlFor="ax-live-body">
                  <GrowText id="ax-live-body" value={draft.body} minRows={2} onChange={(e) => set('body', e.target.value)} />
                </Field>
                <Field label="Button">
                  <div className="ax-live-seg">
                    <Seg label="Button goes to" value={draft.destination} onChange={(d) => set('destination', d)} options={DESTINATIONS} />
                  </div>
                  {draft.destination ? (
                    <input id="ax-live-blabel" className="ax-input" value={draft.buttonLabel} placeholder="Button label, like Give now" aria-label="Button label"
                      onChange={(e) => set('buttonLabel', e.target.value)} />
                  ) : null}
                </Field>
              </>
            )}
            {draft.type === 'poll' && (
              <>
                <Field label="Question" htmlFor="ax-live-q">
                  <input id="ax-live-q" className="ax-input" value={draft.question} onChange={(e) => set('question', e.target.value)} />
                </Field>
                <Field label="Answers" hint="Two to five.">
                  <div className="ax-rows">
                    {draft.options.map((o, i) => (
                      <div key={i} className="ax-subrow">
                        <input id={`ax-live-a${i + 1}`} className="ax-input" value={o} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
                          onChange={(e) => set('options', draft.options.map((x, k) => (k === i ? e.target.value : x)))} />
                        {draft.options.length > 2 && (
                          <button type="button" className="ax-iconbtn danger" title="Remove this answer" aria-label={`Remove answer ${i + 1}`}
                            onClick={() => set('options', draft.options.filter((_, k) => k !== i))}><Icon d={P.close} size={18} /></button>
                        )}
                      </div>
                    ))}
                    {draft.options.length < 5 && (
                      <button type="button" className="ax-btn sm fit"
                        onClick={() => set('options', [...draft.options, ''])}><Icon d={P.plus} size={15} />Add an answer</button>
                    )}
                  </div>
                </Field>
              </>
            )}
            <div className="ax-live-acts">
              <button type="button" className="ax-btn primary" onClick={showDraft} disabled={busy || !!problem} aria-describedby="ax-live-why">
                <Icon d={P.send} size={16} />Show now
              </button>
              {!editing ? (
                <button type="button" className="ax-btn" onClick={keepDraft} disabled={busy || !!problem} aria-describedby="ax-live-why">Save for later</button>
              ) : null}
            </div>
            <p id="ax-live-why" className={`ax-hint ax-live-why${!problem ? ' ok' : held && editing ? ' held' : ''}`} role="status">
              {problem && held && editing ? (
                <>Not saved: {problem} Fix it to keep your changes, or{' '}
                  <button type="button" className="ax-live-retry" onClick={revertEdit}>put back the saved card</button>.</>
              ) : (problem || okLine)}
            </p>
          </div>
        </EditorPane>

        {/* the phone beside the words it draws (proximity) — the app's own live player */}
        <Pane className="ax-live-phone" bodyClassName="ax-preview-body" label="On phones"
          right={(
            <>
              <span className="ax-preview-note">{phoneNote}</span>
              <button type="button" className="ax-headbtn ax-live-phone-close" onClick={() => setPhoneOpen(false)}
                aria-label="Close the preview" title="Close the preview (Esc)"><Icon d={P.close} size={18} /></button>
            </>
          )}>
          {/* the title exactly as the app takes it: liveTitle || 'Live Service', untrimmed (SermonsScreen.js) */}
          <LivePlayerPhone title={streamForm(st.stream).liveTitle || 'Live Service'} card={phoneCard}
            notes={streamForm(st.stream).liveNotes} chat={chat.msgs} />
          <p className="ax-phone-cap">{phoneCap}</p>
        </Pane>

        <ChatPane chat={chat} live={isLive} closeRef={chatClose} onClose={() => setChatWant(false)} />
        {chatOpen ? <div className="ax-live-scrim" aria-hidden="true" onClick={() => setChatWant(false)} /> : null}
      </Workspace>
      {cards.toast}
    </AppShell>
  );
}

// the kinds' marks in Pillar's own icon set (a poll is Material's bar chart)
const KIND_ICON = { scripture: P.book, informative: P.announce, poll: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z' };

/* ─────────────────────────────── the stream ─────────────────────────────── */

function useStream() {
  const [stream, setStream] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const now = useRef({ stream: null, saved: null });
  now.current = { stream, saved };
  // writes in flight, and a count bumped as each one starts and ends: a re-read that overlapped a
  // write is dropped (it may say what was true before it)
  const writing = useRef(0);
  const writes = useRef(0);
  const begin = () => { writing.current += 1; writes.current += 1; };
  const end = () => { writing.current -= 1; writes.current += 1; };

  useEffect(() => {
    let alive = true;
    setLoadError('');
    getLivestream()
      .then((l) => {
        if (!alive) return;
        const s = withDefaults(l);
        setStream(s);
        setSaved(JSON.stringify(streamForm(s)));
        announce(!!s.isLive);
      })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [tries]);

  // Read it again every 15 s and when the window comes back into focus: the switch may have been
  // flipped somewhere else (another tab, another staffer, the app's own admin). The server's isLive is
  // always taken — the status box, the chat's pace and the sidebar's badge follow it; its title, link
  // and notes only while nothing typed here is waiting to save.
  const loaded = stream !== null;
  useEffect(() => {
    if (!loaded) return undefined;
    let alive = true;
    const check = async () => {
      if (writing.current) return;
      const w = writes.current;
      let l = null;
      try { l = await getLivestream(); } catch { return; }
      if (!alive || !l || writing.current || w !== writes.current) return;
      const fresh = withDefaults(l);
      const { stream: s, saved: sv } = now.current;
      if (!s || JSON.stringify(fresh) === JSON.stringify(s)) return;
      const on = !!fresh.isLive;
      const clean = sv === JSON.stringify(streamForm(s));
      setStream((cur) => {
        if (!cur) return cur;
        if (clean && cur === s) return fresh;
        return !!cur.isLive === on ? cur : { ...cur, isLive: on };
      });
      if (clean) setSaved(JSON.stringify(streamForm(fresh)));
      if (!!s.isLive !== on) announce(on);
    };
    const t = setInterval(check, STREAM_EVERY);
    window.addEventListener('focus', check);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', check); };
  }, [loaded]);

  const form = streamForm(stream);
  const dirty = stream !== null && JSON.stringify(form) !== saved;
  // the details save into the WHOLE stream object — onto the server's own, read just now, so its
  // isLive is the one the server has (a switch flipped elsewhere since this page loaded is never
  // undone for every phone by a title edit here)
  const save = useCallback(async (v) => {
    begin();
    try {
      const next = { ...withDefaults(await getLivestream()), ...v };
      await putLivestream(next);
      setSaved(JSON.stringify(v));
      const on = !!next.isLive;
      const s = now.current.stream;
      if (s && !!s.isLive !== on) {
        setStream((cur) => (cur ? { ...cur, isLive: on } : cur));
        announce(on);
      }
    } finally { end(); }
  }, []);
  const auto = useAutosave({ value: form, savedJson: saved, ready: stream !== null, save });

  async function goLive(on) {
    if (on && !form.liveStreamUrl.trim()) { setError('Add the stream link first.'); return; }
    if (on && !(await ask('Go live now? The whole app switches to live mode for everyone within seconds.'))) return;
    setBusy(true); setError(''); begin();
    const next = { ...stream, ...form, isLive: on };
    try {
      await putLivestream(next);
      setStream(next);
      setSaved(JSON.stringify(streamForm(next)));
      announce(on);
    } catch (e) { setError(e.message); }
    end();
    setBusy(false);
  }
  const set = (k, v) => setStream((s) => ({ ...s, [k]: v }));
  return { stream, form, dirty, auto, goLive, set, busy, error, setError, loadError, retry: () => setTries((n) => n + 1) };
}

function StreamPane({ st }) {
  const { stream, form, auto, busy, set } = st;
  const live = !!(stream && stream.isLive);
  return (
    <Pane className="ax-live-stream" bodyClassName="ax-live-stream-body" label="Stream"
      right={stream ? <SaveState auto={auto} /> : null}>
      {st.loadError ? (
        <Alert>{st.loadError}{' '}<button type="button" className="ax-live-retry" onClick={st.retry}>Try again</button></Alert>
      ) : !stream ? (
        <Loading>Reaching the app server…</Loading>
      ) : (
        <>
          <Alert onClose={st.error ? () => st.setError('') : null}>{st.error}</Alert>
          {/* the switch: big, first, and red while live (Fitts; Von Restorff) */}
          <div className={`ax-live-status${live ? ' on' : ''}`}>
            <div className="ax-live-status-top">
              <span className={`ax-dot big${live ? ' live' : ''}`} />
              <span className="ax-live-status-words">
                <strong>{live ? 'You’re live' : 'Not live'}</strong>
                <span>{live ? 'Phones show the service at the top of Home and Watch.' : 'Switch on when the stream has started.'}</span>
              </span>
            </div>
            <Toggle live checked={live} disabled={busy} onChange={st.goLive}
              label={busy ? 'One moment…' : live ? 'Live' : 'Go live'} />
            {!live && !form.liveStreamUrl.trim() ? <p className="ax-hint">Add the stream link below before going live.</p> : null}
          </div>
          <Field label="Title" htmlFor="ax-live-title">
            <input id="ax-live-title" className="ax-input title" value={form.liveTitle} placeholder="Sunday worship"
              onChange={(e) => set('liveTitle', e.target.value)} />
          </Field>
          <Field label="Stream link" htmlFor="ax-live-link" hint="The HLS address from the streaming service — it ends in .m3u8.">
            <input id="ax-live-link" className="ax-input" value={form.liveStreamUrl} inputMode="url" placeholder="https://…/index.m3u8"
              onChange={(e) => set('liveStreamUrl', e.target.value)} />
          </Field>
          {/* Hick: the notes are set once before a service — folded until wanted */}
          <Section collapsible defaultOpen={false} title="Notes for the stream" right={form.liveNotes.trim() ? 'Written' : 'None yet'}>
            <Field hint="What viewers see when they tap Notes during the stream.">
              <GrowText value={form.liveNotes} minRows={3} aria-label="Notes for the stream" onChange={(e) => set('liveNotes', e.target.value)} />
            </Field>
          </Section>
        </>
      )}
    </Pane>
  );
}

/* ─────────────────────────────── cards on viewers' screens ─────────────────────────────── */

function useCards() {
  const [active, setActive] = useState(undefined);
  const [votes, setVotes] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [tplError, setTplError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, undo] = useUndo();
  // writes in flight (Show, Take down, Save for later), and a count bumped as each starts and ends:
  // a read that was on its way when one happened answers what was true before it, so it's dropped
  // (it used to flip the box, the green tile and the phone back for up to 5 s)
  const writing = useRef(0);
  const writes = useRef(0);

  // a failed load says so, with Try again (it used to look exactly like "no saved cards")
  const loadTemplates = useCallback(() => {
    setTplError('');
    return getLiveCardTemplates()
      .then((t) => setTemplates(Array.isArray(t) ? t : []))
      .catch((e) => setTplError(e.message || 'Couldn’t reach the app server.'));
  }, []);

  // the card last sent, and a poll's votes, kept current (and asked again when the window gets focus)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (writing.current) return;
      const w = writes.current;
      const stale = () => !alive || writing.current > 0 || w !== writes.current;
      try {
        const c = await getLiveCard();
        if (stale()) return;
        setActive(c || null);
        if (c && c.type === 'poll') { const v = await getLiveCardVotes(); if (!stale()) setVotes(votesFor(c, v)); }
        else setVotes(null);
      } catch { /* a missed tick is fine */ }
    };
    tick();
    loadTemplates();
    const t = setInterval(tick, CARD_EVERY);
    window.addEventListener('focus', tick);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', tick); };
  }, [loadTemplates]);

  const run = async (fn) => {
    setBusy(true); setError('');
    writing.current += 1; writes.current += 1;
    try { await fn(); return true; } catch (e) { setError(e.message); return false; } finally {
      writing.current -= 1; writes.current += 1;
      setBusy(false);
    }
  };
  const show = (card) => run(async () => { await pushLiveCard(card); setActive(card); setVotes(null); });
  const clear = () => run(async () => { await clearLiveCard(); setActive(null); setVotes(null); });
  const keep = (card) => run(async () => { await saveLiveCardTemplate(card); loadTemplates(); });
  const replaceTemplate = useCallback((t) => setTemplates((l) => (l || []).map((x) => (x.id === t.id ? t : x))), []);
  async function forget(t) {
    setTemplates((l) => (l || []).filter((x) => x.id !== t.id));
    try { await deleteLiveCardTemplate(t.id); } catch (e) { setError(e.message); loadTemplates(); return; }
    undo(`“${summary(t)}” removed.`, async () => {
      try { await saveLiveCardTemplate(t); loadTemplates(); } catch (e) { setError(e.message); }
    });
  }
  return { active, votes, templates, tplError, loadTemplates, error, setError, busy, show, clear, keep, forget, replaceTemplate, toast, undo };
}

/**
 * The card last sent to phones — what the server holds. Its words say what phones really do with it
 * (MediaPlayer.js): each shows it for 12 seconds as it arrives, and Take down doesn't hide it sooner.
 * Only the one-line summary below is a live region, so a screen reader hears a new card, not a poll's
 * tally every 5 seconds.
 */
function OnScreen({ active, votes, busy, onTakeDown, live }) {
  const k = kindOf(active);
  const t = active && k === 'poll' ? tally(active.options || [], votes || {}) : null;
  const spoken = active === undefined ? '' : active ? `Sent to phones: ${summary(active)}` : 'Nothing on screen';
  return (
    <div className={`ax-live-now${active ? ' on' : ''}`}>
      <span className="ax-live-sr" aria-live="polite">{spoken}</span>
      {active === undefined ? <p className="ax-hint">Checking what’s on screen…</p> : active ? (
        <>
          <div className="ax-live-now-head">
            <span className="ax-live-now-tag">Sent to phones</span>
            <span className="ax-grow" />
            <button type="button" className="ax-btn sm ax-live-takedown" onClick={onTakeDown} disabled={busy}
              title={`Clear it from the app server. Phones already showing it keep it until their ${CARD_SECONDS} seconds are up.`}>
              <Icon d={P.close} size={16} />Take down
            </button>
          </div>
          <strong className="ax-live-now-title">{summary(active)}</strong>
          {k === 'scripture' && active.text ? <p className="ax-live-now-line">{active.text}</p> : null}
          {k === 'informative' && active.body ? <p className="ax-live-now-line">{active.body}</p> : null}
          {t ? (
            <div className="ax-live-tally">
              {t.rows.map((r, i) => (
                <div key={i} className="ax-live-bar">
                  <span className="ax-live-bar-label" title={r.label}>{r.label}</span>
                  <span className="ax-live-bar-track"><span style={{ width: `${r.pct}%` }} /></span>
                  <span className="ax-live-bar-n">{r.pct}% · {r.n}</span>
                </div>
              ))}
              <span className="ax-live-total">{t.total ? `${t.total} vote${t.total === 1 ? '' : 's'}` : 'No votes yet'}</span>
            </div>
          ) : null}
          <p className="ax-hint ax-live-now-when">Each phone shows it for {CARD_SECONDS} seconds as it arrives; anyone who opens the stream later won’t see it.</p>
        </>
      ) : (
        <>
          <span className="ax-live-now-tag">Nothing on screen</span>
          <p className="ax-hint">Show a saved card below, or write one.</p>
        </>
      )}
      {live === false ? <p className="ax-hint ax-live-now-warn">Phones pick up cards only while you’re live.</p> : null}
    </div>
  );
}

/* ─────────────────────────────── chat ─────────────────────────────── */

function useChat(live) {
  const [msgs, setMsgs] = useState(null);
  const [failed, setFailed] = useState(false);
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const c = await getChat(); if (alive) { setMsgs(Array.isArray(c) ? c : []); setFailed(false); } }
      catch { if (alive) setFailed(true); }
    };
    tick();
    const t = setInterval(tick, live ? CHAT_EVERY.live : CHAT_EVERY.off);
    window.addEventListener('focus', tick);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', tick); };
  }, [live, nudge]);
  return { msgs, failed, retry: () => setNudge((n) => n + 1) };
}

function ChatPane({ chat, live, closeRef, onClose }) {
  const list = useRef(null);
  const stick = useRef(true);   // at the newest message: keep following it
  const { msgs, failed } = chat;
  // the newest message stays in view, unless they've scrolled up to read something
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current && typeof el.scrollHeight === 'number') el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  const n = Array.isArray(msgs) ? msgs.length : 0;
  return (
    <Pane className="ax-live-chat" bodyClassName="ax-live-chat-body" label="Live chat"
      right={(
        <>
          <span className="ax-live-chat-count">{n ? `${n} message${n === 1 ? '' : 's'}` : live ? 'Live' : 'Read-only'}</span>
          <button ref={closeRef} type="button" className="ax-headbtn ax-live-chat-close" onClick={onClose}
            aria-label="Close the chat" title="Close the chat (Esc)"><Icon d={P.close} size={18} /></button>
        </>
      )}>
      <p className="ax-hint ax-live-chat-sub">Read-only here. It clears when the stream ends.</p>
      <div ref={list} className="ax-live-chat-list" onScroll={onScroll} role="log" aria-label="Chat messages">
        {failed ? (
          <p className="ax-hint">Couldn’t load the chat.{' '}<button type="button" className="ax-live-retry" onClick={chat.retry}>Try again</button></p>
        ) : msgs === null ? <p className="ax-hint">Loading…</p>
          : msgs.length === 0 ? <p className="ax-hint">No messages yet.</p>
          : msgs.map((m, i) => {
            const at = clock(m);
            return (
              <div key={m.id || i} className="ax-live-msg">
                <div className="ax-live-msg-top"><span className="ax-live-msg-who">{who(m)}</span>{at ? <span className="ax-live-msg-at">{at}</span> : null}</div>
                <p className="ax-live-msg-text">{said(m)}</p>
              </div>
            );
          })}
      </div>
    </Pane>
  );
}

/* ─────────────────────────────── the phone: the app's live player ─────────────────────────────── */

// Feather marks the live screen uses that the shared phone set doesn't draw (layout.jsx PhoneIcon — not
// this page's to change)
const MORE_FEATHER = {
  'message-square': <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  'bar-chart-2': <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
};
// The Bible button's glyph: MaterialCommunityIcons "book-open-variant", the dock's filled Bible (BethesdaApp
// App.js), traced out of the app's own icon font (@expo/vector-icons MaterialCommunityIcons.ttf, U+F14F7) —
// the em box is 512, 448 above the baseline
const BIBLE_GLYPH = 'M256 11Q235 -3 200.5 -12Q166 -21 139 -21Q79 -21 37 1Q35 2 31.5 2Q28 2 24.5 -1.5Q21 -5 21 -9L21 -320Q38 -333 64 -341Q98 -352 139 -352Q173 -352 201 -345Q234 -337 256 -320Q278 -337 311 -345Q339 -352 373 -352Q414 -352 448 -341Q474 -333 491 -320L491 -9Q491 -5 487.5 -1.5Q484 2 480.5 2Q477 2 475 1Q433 -21 373 -21Q346 -21 311.5 -12Q277 -3 256 11ZM256 -277L256 -32Q277 -45 311.5 -54.5Q346 -64 373 -64Q414 -64 448 -53L448 -299Q414 -309 373 -309Q346 -309 311.5 -300Q277 -291 256 -277ZM277 -203Q312 -224 373 -224Q403 -224 427 -218L427 -251Q398 -256 373 -256Q317 -256 277 -238L277 -203ZM373 -199Q318 -199 277 -182L277 -146Q313 -167 373 -167Q407 -167 427 -162L427 -194Q400 -199 373 -199ZM427 -137Q399 -142 373 -142Q315 -142 277 -125L277 -89Q313 -110 373 -110Q407 -110 427 -105L427 -137Z';
function AppIcon({ name, size }) {
  if (name === 'bible') {
    return <svg className="ax-pa-icon" width={size} height={size} viewBox="0 -448 512 512" aria-hidden="true"><path d={BIBLE_GLYPH} fill="currentColor" /></svg>;
  }
  const f = MORE_FEATHER[name];
  if (!f) return <PhoneIcon name={name} size={size} />;
  return (
    <svg className="ax-pa-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{f}</svg>
  );
}

/**
 * The member app's live service, portrait (BethesdaApp components/LiveOverlay.js over screens/MediaPlayer.js):
 * black, the video fitted across the middle; the status bar, the dock and the profile button hidden
 * (App.js, ProfileButton.js). The live screen stays up — it doesn't fade like a recorded message's
 * controls — so a card lands with it, not on a bare picture:
 *   · top left: who's watching and the LIVE badge — Pillar can't read the number (/api/viewers/ping is the
 *     phones' own), so "–" stands in — the title under them (liveTitle, else the app's 'Live Service'),
 *     then Notes when the stream has some. ✕ on the right.
 *   · the chat's newest messages over the picture, a bubble each, the name above the words (the app fits
 *     as many as 36% of the screen holds; here, the last three)
 *   · a card rests just above the comment row, the chat above it
 *   · the comment row: the box ("Your comment" — who's writing is each phone's own), the chat's round
 *     button, the Bible in the brand orange
 */
export function LivePlayerPhone({ title, card, notes = '', chat = [] }) {
  // as the app takes them (context/LiveChatContext.js cleanMessages): a name and words, the newest last
  const recent = (Array.isArray(chat) ? chat : [])
    .map((m) => ({ id: String(m?.id ?? ''), who: String(m?.username || '').trim(), said: String(m?.message || '').trim(), at: Number(m?.timestamp) || 0 }))
    .filter((m) => m.who && m.said)
    .slice(-3);
  return (
    <PhoneFrame profile={false} statusBar="light" screenClassName="ax-live-screen" label="The live stream on a phone">
      <div className="ax-live-player">
        <div className="ax-live-video" />
        <div className="ax-live-shade-top" />
        <div className="ax-live-shade-bottom" />
        <div className="ax-live-top">
          <div className="ax-live-toprow">
            <span className="ax-live-meta">
              <span className="ax-live-viewers" title="Phones show how many are watching here; Pillar can’t see the number">
                <AppIcon name="users" size={16} /><span className="ax-live-viewers-n">–</span>
              </span>
              <span className="ax-live-livebadge"><i />LIVE</span>
            </span>
            <span className="ax-live-exit"><AppIcon name="x" size={28} /></span>
          </div>
          <p className="ax-live-title">{title}</p>
          {String(notes || '').trim() ? (
            <span className="ax-live-notes"><AppIcon name="file-text" size={15} /><span>Notes</span></span>
          ) : null}
        </div>
        <div className="ax-live-bottom">
          {recent.length ? (
            <div className="ax-live-bubbles">
              {recent.map((m, i) => {
                const prev = recent[i - 1];
                // one person back to back, within five minutes, is one run with one name (LiveOverlay withRuns)
                const joined = !!prev && prev.who === m.who && Math.abs(m.at - prev.at) < 5 * 60 * 1000;
                return (
                  <div key={m.id || i} className={`ax-live-bubble${joined ? ' joined' : ''}`}>
                    {joined ? null : <span className="ax-live-who">{m.who}</span>}
                    <span className="ax-live-said">{m.said}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {card ? <LiveCardOnPhone card={card} /> : null}
          <div className="ax-live-row">
            <span className="ax-live-field">Your comment</span>
            <span className="ax-live-round"><AppIcon name="message-square" size={22} /></span>
            <span className="ax-live-round bible"><AppIcon name="bible" size={24} /></span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** The card as the app draws it (MediaPlayer.js "Verse card"): a poll before anyone has voted. */
export function LiveCardOnPhone({ card }) {
  const k = kindOf(card);
  return (
    <div className="ax-live-cardwrap">
      <div className="ax-live-card">
        <div className="ax-live-card-top">
          <span className={`ax-live-badge ${k}`}>
            <AppIcon name={k === 'informative' ? 'info' : k === 'poll' ? 'bar-chart-2' : 'book-open'} size={12} />
            <span>{k === 'informative' ? 'INFO' : k === 'poll' ? 'POLL' : 'VERSE'}</span>
          </span>
          <span className="ax-live-card-acts">
            {k === 'scripture' ? <span className="ax-live-save"><AppIcon name="bookmark" size={14} /></span> : null}
            <span className="ax-live-close"><AppIcon name="x" size={16} /></span>
          </span>
        </div>
        {k === 'scripture' ? (
          <>
            <p className="ax-live-ref">{card.reference}</p>
            <p className="ax-live-text">&quot;{card.text}&quot;</p>
            {card.note ? <p className="ax-live-note">{card.note}</p> : null}
          </>
        ) : null}
        {k === 'informative' ? (
          <>
            <p className="ax-live-ref">{card.title}</p>
            {card.body ? <p className="ax-live-text plain">{card.body}</p> : null}
            {card.buttonLabel ? (
              <span className="ax-live-infobtn"><span>{card.buttonLabel}</span><AppIcon name="arrow-right" size={14} /></span>
            ) : null}
          </>
        ) : null}
        {k === 'poll' ? (
          <>
            <p className="ax-live-ref q">{card.question}</p>
            {(card.options || []).map((o, i) => <span key={i} className="ax-live-opt"><span>{o}</span></span>)}
            <p className="ax-live-tap">Tap to vote</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
