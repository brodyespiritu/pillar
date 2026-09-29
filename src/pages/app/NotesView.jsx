import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import {
  listSheets, saveSheet, deleteSheet, sheetProblems, sheetReady, countBlanks, fromSermon, sermonLinkReady,
  notSetUp, SETUP_HINT, SERMON_HINT, SHEET_LIMITS, BLANK,
} from '../../lib/sermonSheets';
import { youtubeThumbs } from '../../lib/youtube';
import {
  useRows, useSaveQueue, useAutosave,
  SaveState, Field, GrowText, Toggle, Loading, RowList, VideoDrop,
} from './kit';
import {
  Workspace, ListPane, EditorPane, PreviewPane, Cols, ColA, ColB, Fields, PhoneFrame, PhoneIcon,
} from './layout';

// App → Watch → Notes: the fill-in-the-blank sermon notes the congregation gets on the app's Bible
// page. Type the outline and put ___ wherever the congregation writes something in; the app turns
// each one into a box they tap. What they type is kept on their own record, never here.
//
// Notes can go with one sermon from the Sermons tab: pick it in the editor (or press "Fill-in notes"
// on the sermon itself). Its title, speaker, date and video fill in, and the app offers the notes on
// that sermon's card. One sheet per sermon.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4):
//   · the notes' state lives in WatchPage (useNotes below), so going to Sermons and back neither asks
//     the database again nor forgets the sheet that was open, and Undo lasts across tabs (Doherty)
//   · the same workspace as every App page — list · editor · phone (Jakob's law); the editor's head
//     keeps the save state, "In the app" and Delete beside the fields (Fitts's law); the message's
//     details on one side and the outline on the other (law of proximity)
//   · the phone is the app's own notes page (BethesdaApp screens/Bible/NotesSheet.js): the black band
//     with the message, Sermon Notes | Journal, two points at a time with a box for every blank, and
//     ‹ Points 1–2 of 6 › with Save — its arrows really page through, to check a long outline

const formOf = (r) => ({
  sermon_id: r.sermon_id ? String(r.sermon_id) : '',
  title: r.title || '', speaker: r.speaker || '', passage: r.passage || '', on_date: r.on_date || '',
  video_url: r.video_url || '', body: r.body || '', published: r.published === true,
});
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
const bg = (u) => (u ? { backgroundImage: cssUrl(u) } : undefined);
const sermonTitle = (s) => String(s?.title || '').trim() || 'Untitled sermon';
const sermonSub = (s) => [s?.speaker, s?.date].filter(Boolean).join(' · ') || 'No speaker or date yet';
const inApp = (r) => r._saved !== null && r.published === true;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const matches = (needle, ...values) => !needle || values.some((v) => String(v || '').toLowerCase().includes(needle));
const AT_ONCE = (fn) => fn();

/* ─────────────────────────────── the notes, lifted into WatchPage ─────────────────────────────── */

/**
 * Every sheet, loaded once for the whole Watch page: pick, add, change (it saves as you type), switch
 * on and off, delete with Undo. `undo` is the page's own toast (kit useUndo), so a sheet deleted here
 * can still be brought back after moving to another tab. Like every list on Watch, the first sheet is
 * picked when the list arrives (one rule for every list — kit-autopick-first-row).
 */
export function useNotes(undo) {
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await listSheets();
      rows.load(list);
      setSetUp(true);
      setPicked((p) => p ?? (list && list[0] ? String(list[0].id) : null));
    } catch (e) { rows.load([]); if (notSetUp(e)) setSetUp(false); else setError(e.message); }
  }, [rows.load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const list = rows.rows;

  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const f = formOf(r);
    try {
      const saved = await saveSheet({ id: rows.idOf(key), sort: r.sort, ...f });
      rows.saved(key, f, saved);
    } catch (e) { rows.failed(key, notSetUp(e) ? SETUP_HINT : e.message); throw e; }
  }), [queue, rows]);

  const add = (sermon) => {
    const start = {
      sermon_id: '', title: '', speaker: '', passage: '', on_date: '', video_url: '', body: '', published: false,
      ...(sermon ? fromSermon(sermon) : {}),
    };
    // `_start`: the sheet as it began (blank, or filled in from its sermon) — only what's typed after
    // that is the office's own work (the leave guard, below)
    const key = rows.add({ ...start, sort: ((list || []).length + 1) * 10, _start: JSON.stringify(formOf(start)) }, { first: true });
    setPicked(key);
    return key;
  };

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return;
    const f = formOf(r);
    if (on && !sheetReady(f)) { setError(sheetProblems(f)[0]); return; }
    setError('');
    rows.patch(key, { published: on });
    // a switch that didn't take says why, not only with the row's "Not saved" (watch-alert-layers)
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  };

  const remove = async (key) => {
    const all = list || [];
    const r = rows.get(key);
    if (!r) return;
    const at = all.findIndex((x) => x._key === key);
    rows.remove(key);
    setPicked((p) => (p === key ? (all[at + 1] || all[at - 1])?._key || null : p));
    if (r._saved === null) return;
    try { await queue(key, () => deleteSheet(r.id)); }
    catch (e) { rows.restore(r, at); setError(e.message); return; }
    if (undo) {
      undo(`“${String(r.title || '').trim() || 'These notes'}” deleted.`, async () => {
        try { setPicked(rows.restore(await saveSheet({ sort: r.sort, ...formOf(r) }), at)); }
        catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
      });
    }
  };

  // unsaved work leaving would lose (the page's leave guard): a saved sheet changed since, or a new one
  // with something typed into it. One only filled in from its sermon ("Write notes for this sermon":
  // a title, no notes — so it can't save yet) holds nothing of the office's own, and asks nothing
  const dirty = (list || []).some((r) => rows.dirty(r)
    && (r._saved !== null || JSON.stringify(formOf(r)) !== r._start));

  return { rows, list, picked, setPicked, error, setError, setUp, persist, add, setLive, remove, load, dirty };
}

/* ─────────────────────────────── the Notes workspace ─────────────────────────────── */

/**
 * `notes` is useNotes() from WatchPage; `sermons` the saved sermons (for "which sermon"); `busyRef`
 * the page's upload flag and `after(fn, needed)` its "a video is still uploading" question (fn at
 * once while nothing uploads, otherwise after a yes); `opened` /
 * `setOpened` whether a narrow screen shows the editor; `find` the list's search and filter, kept by
 * the page so they survive a tab switch. Everything but `notes` has a stand-in, so the view also works
 * on its own.
 */
export default function NotesView({ notes, sermons = [], busyRef, after = AT_ONCE, opened, setOpened, find }) {
  const own = useRef(false);
  const uploading = busyRef || own;
  const [ownOpen, setOwnOpen] = useState(false);
  const detail = opened === undefined ? ownOpen : !!opened;
  const open = setOpened || setOwnOpen;
  const [ownFind, setOwnFind] = useState({ q: '', show: 'all' });
  const look = find || {
    q: ownFind.q, show: ownFind.show,
    setQ: (q) => setOwnFind((o) => ({ ...o, q })), setShow: (show) => setOwnFind((o) => ({ ...o, show })),
  };
  const [params, setParams] = useSearchParams();
  const list = notes.list;

  // Opened from a sermon (Watch → Sermons → "Fill-in notes"): its notes, or new ones for it.
  const forSermon = params.get('for');
  const handled = useRef(null);
  useEffect(() => {
    if (!forSermon || list === null || handled.current === forSermon) return;
    const theirs = list.find((r) => formOf(r).sermon_id === forSermon);
    const sermon = sermons.find((s) => String(s.id) === forSermon);
    if (!theirs && !sermon) return;   // the sermons are still on their way
    handled.current = forSermon;
    if (theirs) notes.setPicked(theirs._key);
    else if (notes.setUp) notes.add(sermon);
    open(true);
    const next = new URLSearchParams(params);
    next.delete('for');
    setParams(next, { replace: true });
  }, [forSermon, list, sermons]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = list || [];
  const needle = look.q.trim().toLowerCase();
  const tests = { all: () => true, live: inApp, drafts: (r) => !inApp(r) };
  const shown = all.filter((r) => (tests[look.show] || tests.all)(r) && matches(needle, r.title, r.speaker, r.passage));
  const current = all.find((r) => r._key === notes.picked) || null;
  const sermonOf = (id) => (id ? sermons.find((s) => String(s.id) === id) || null : null);
  // the sermons that already have notes, besides the one being changed
  const taken = new Set(all.filter((r) => r !== current).map((r) => formOf(r).sermon_id).filter(Boolean));

  const pick = (key) => after(() => {
    notes.setPicked(key);
    open(true);
  }, key !== notes.picked);
  const add = () => after(() => {
    look.setQ('');
    look.setShow('all');
    notes.add();
    open(true);
  });
  const remove = (key) => after(() => notes.remove(key));

  const live = all.filter(inApp).length;
  const filters = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'live', label: 'In the app', count: live },
    { key: 'drafts', label: 'Drafts', count: all.length - live },
  ];

  return (
    <Workspace detail={detail} hasPreview className="ax-watch ax-watch-notes">
      {/* New waits for the list: its load replaces every row, so a sheet made before it lands was lost */}
      <ListPane label="Sermon notes" newLabel="New notes" onNew={add} newDisabled={!notes.setUp || list === null}
        newHint={!notes.setUp ? SETUP_HINT : list === null ? 'Loading the notes…' : undefined}
        search={look.q} onSearch={look.setQ} searchPlaceholder="Search title, speaker, passage…"
        filters={filters} filter={look.show} onFilter={look.setShow}
        count={list === null ? null : `${plural(all.length, 'sheet')} · ${live} in the app`}>
        {list === null ? <Loading /> : (
          <RowList rows={shown} picked={notes.picked} onPick={pick}
            empty={<div className="ax-empty">{all.length ? 'No notes match.' : <><strong>No notes yet</strong>Write the outline and mark the blanks.</>}</div>}
            renderRow={(r) => {
              const f = formOf(r);
              const blanks = countBlanks(f.body);
              const pic = sermonOf(f.sermon_id)?.thumbnailUrl;
              return (
                <>
                  <span className="ax-thumb" style={bg(pic)}>
                    {!pic && <Icon d={f.sermon_id ? P.link : P.doc} size={18} />}
                  </span>
                  <span className="ax-row-main">
                    <span className={`ax-row-title${f.title.trim() ? '' : ' muted'}`}>{f.title.trim() || 'Untitled notes'}</span>
                    <span className="ax-row-sub">
                      {r._error ? <span className="ax-row-flag">Not saved</span>
                        : r._saved === null ? 'Not saved yet'
                          : [f.on_date, `${blanks} blank${blanks === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Toggle small checked={f.published} onChange={(on) => notes.setLive(r._key, on)}
                    title={f.published ? 'In the app — switch off to take it out' : 'Hidden — switch on to show it'} />
                </>
              );
            }} />
        )}
      </ListPane>

      {current ? (
        <SheetEditor key={current._key} row={current} notes={notes} sermons={sermons} taken={taken}
          uploading={uploading} onBack={() => open(false)} onDelete={() => remove(current._key)} />
      ) : (
        <EditorPane label="Notes" onBack={() => open(false)} backLabel="Notes"
          empty={list === null ? 'Loading…' : <><strong>Pick a sheet to change it</strong>or write a new one.</>} />
      )}

      <PreviewPane note="Bible → Sermon notes">
        <SheetPhone key={current ? current._key : 'none'} f={current ? formOf(current) : null} />
        <p className="ax-phone-cap">Every ___ becomes a box the member taps and types into. What they write is kept on their own record.</p>
      </PreviewPane>
    </Workspace>
  );
}

function SheetEditor({ row, notes, sermons, taken, uploading, onBack, onDelete }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => notes.rows.patch(key, { [k]: v });
  // the database takes a sheet once it has a title and some notes, so that's when it saves
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: sheetReady(f), save: () => notes.persist(key) });
  const blanks = countBlanks(f.body);
  const problem = sheetProblems(f)[0];

  return (
    <EditorPane label="Notes" onBack={onBack} backLabel="Notes" onSave={auto.flush}
      status={<SaveState auto={auto} waiting={problem ? `Not saved yet. ${problem}` : 'Not saved yet'} />}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={f.published} onChange={(on) => notes.setLive(key, on)} label="In the app"
            title={f.published ? 'Members see it now — switch off to take it out' : 'Hidden — only you see it. Switch on to show it'} />
        </span>
      )}
      actions={(
        <button type="button" className="ax-headbtn danger" onClick={onDelete} aria-label="Delete these notes" title="Delete these notes">
          <Icon d={P.trash} size={18} />
        </button>
      )}>
      <Cols>
        <ColA title="The message">
          <SermonField f={f} sermons={sermons} taken={taken}
            onPick={(s) => notes.rows.patch(key, (r) => fromSermon(s, formOf(r)))}
            onClear={() => set('sermon_id', '')} />
          <Field label="Title">
            <input className="ax-input title" value={f.title} autoFocus={row._saved === null && !f.sermon_id}
              maxLength={SHEET_LIMITS.title} placeholder="The message’s title"
              onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Fields min={140}>
            <Field label="Speaker"><input className="ax-input" value={f.speaker} onChange={(e) => set('speaker', e.target.value)} /></Field>
            <Field label="Passage"><input className="ax-input" value={f.passage} placeholder="Book 1:1" onChange={(e) => set('passage', e.target.value)} /></Field>
            <Field label="Date"><input className="ax-input" type="date" value={f.on_date} onChange={(e) => set('on_date', e.target.value)} /></Field>
          </Fields>
          <Field label="Video" hint="Plays at the top of the page while they fill the notes in.">
            <VideoDrop value={f.video_url} onChange={(u) => set('video_url', u)} busyRef={uploading} />
          </Field>
        </ColA>
        <ColB title="The outline" right={blanks ? `${blanks} box${blanks === 1 ? '' : 'es'} to fill in` : 'No blanks yet'}>
          <Field label="The notes"
            hint={`Put ${BLANK} wherever the congregation writes something in. ${blanks} blank${blanks === 1 ? '' : 's'} so far. A numbered line (1. 2. 3.) starts a new point.`}
            count={f.body.length} max={SHEET_LIMITS.body}>
            <GrowText value={f.body} minRows={12} autoFocus={row._saved === null && !!f.sermon_id}
              onChange={(e) => set('body', e.target.value)}
              placeholder={`1. God is ${BLANK} in all things.\n\n2. His mercy is ${BLANK} every morning.`} />
          </Field>
        </ColB>
      </Cols>
    </EditorPane>
  );
}

/** Which sermon these notes go with: the one picked, or a list to pick from. */
function SermonField({ f, sermons, taken, onPick, onClear }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  if (!sermonLinkReady()) {
    return <Field label="Sermon"><div className="ax-note"><Icon d={P.link} size={18} /><span>{SERMON_HINT}</span></div></Field>;
  }
  const current = f.sermon_id ? sermons.find((s) => String(s.id) === f.sermon_id) || null : null;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? sermons.filter((s) => [s.title, s.speaker, s.date, s.series].some((v) => String(v || '').toLowerCase().includes(needle)))
    : sermons;
  const close = () => { setOpen(false); setQ(''); };

  if (open) {
    return (
      <Field label="Sermon">
        <div className="ax-subrow">
          <input className="ax-input" type="search" value={q} autoFocus placeholder="Search title, speaker, date…"
            onChange={(e) => setQ(e.target.value)} aria-label="Search sermons" />
          <button type="button" className="ax-btn quiet sm" onClick={close}>Cancel</button>
        </div>
        <div className="ax-picker ax-list">
          {shown.length === 0
            ? <div className="ax-empty">{sermons.length ? 'No sermons match.' : 'No sermons yet. Add one on the Sermons tab.'}</div>
            : shown.map((s) => {
              const id = String(s.id);
              const has = taken.has(id);
              return (
                <button key={id} type="button" className="ax-row pickable" disabled={has}
                  onClick={() => { onPick(s); close(); }}>
                  <span className="ax-thumb" style={bg(s.thumbnailUrl)}>
                    {!s.thumbnailUrl && <Icon d={P.play} size={18} />}
                  </span>
                  <span className="ax-row-main">
                    <span className="ax-row-title">{sermonTitle(s)}</span>
                    <span className="ax-row-sub">{has ? 'Already has its own notes' : sermonSub(s)}</span>
                  </span>
                  {id === f.sermon_id ? <Icon d={P.check} size={16} /> : null}
                </button>
              );
            })}
        </div>
      </Field>
    );
  }

  if (!f.sermon_id) {
    return (
      <Field label="Sermon" hint="Pick the sermon these notes go with. Its title, speaker, date and video fill in, and members find the notes on that sermon in the app.">
        <button type="button" className="ax-btn fit" onClick={() => setOpen(true)}><Icon d={P.link} size={16} />Choose the sermon</button>
      </Field>
    );
  }

  return (
    <Field label="Sermon" hint="Members open these notes from this sermon in the app, and from Sermon notes on the Bible page while they’re the newest.">
      <div className="ax-picked">
        <span className="ax-thumb" style={bg(current?.thumbnailUrl)}>
          {!current?.thumbnailUrl && <Icon d={P.play} size={18} />}
        </span>
        <span className="ax-row-main">
          <span className="ax-row-title">{current ? sermonTitle(current) : 'A sermon that’s no longer on Watch'}</span>
          <span className="ax-row-sub">{current ? sermonSub(current) : 'Pick another, or remove it'}</span>
        </span>
        <div className="ax-row-btns">
          <button type="button" className="ax-btn sm" onClick={() => setOpen(true)}>Change</button>
          <button type="button" className="ax-btn quiet sm" onClick={onClear}>Remove</button>
        </div>
      </div>
    </Field>
  );
}

/* ─────────────────────────────── the app's notes page, on a phone ─────────────────────────────── */

// How the app cuts a sheet up (BethesdaApp utils/sermonNotes.js layout() and points(), the same
// rules): every ___ is a box; a numbered line ("1.", "2)", "IV.") starts a point and the lines under
// it belong to it; an empty line ends one; a sheet with neither is a point per line.
const BLANK_RE = /_{3,}/;
const NUMBERED = /^\s*(\d{1,3}|[IVX]{1,5})[.)]\s/;

/** The outline as lines of pieces: { words } or { blank: n }, the blanks counted across the sheet. */
export function sheetLayout(body) {
  let n = 0;
  return String(body || '').split('\n').map((line) => {
    const pieces = [];
    let rest = line;
    for (;;) {
      const at = rest.search(BLANK_RE);
      if (at === -1) { if (rest) pieces.push({ words: rest }); break; }
      if (at > 0) pieces.push({ words: rest.slice(0, at) });
      pieces.push({ blank: n++ });
      rest = rest.slice(at).replace(BLANK_RE, '');
    }
    return pieces;
  });
}

/** The sheet a point at a time: [{ lines, blanks }]. */
export function sheetPoints(body) {
  const raw = String(body || '').split('\n');
  const laid = sheetLayout(body);
  const used = raw.map((l) => !!String(l).trim());
  const first = used.indexOf(true);
  const final = used.lastIndexOf(true);
  if (first === -1) return [];
  const numbered = raw.some((l) => NUMBERED.test(l));
  const gaps = used.some((u, i) => !u && i > first && i < final);
  const out = [];
  let cur = null;
  raw.forEach((line, i) => {
    if (!used[i]) { cur = null; return; }
    if (!cur || (numbered ? NUMBERED.test(line) : !gaps)) { cur = []; out.push(cur); }
    cur.push(laid[i]);
  });
  return out.map((lines) => ({ lines, blanks: lines.flat().filter((p) => p.blank !== undefined).map((p) => p.blank) }));
}

// icons the app draws here that the phone kit doesn't carry: Feather's film and rotate arrows, and
// Ionicons' journal-outline (the Journal's own mark, components/AppIcon.js)
const Film = () => (
  <svg className="ax-pa-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" /><line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);
const Rotate = ({ back }) => (
  <svg className="ax-pa-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {back
      ? <><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>
      : <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>}
  </svg>
);
const Journal = ({ size = 16 }) => (
  <svg className="ax-pa-icon" width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
    <rect x="96" y="48" width="320" height="416" rx="48" ry="48" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="32" />
    <path d="M320 48v416" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="60" />
  </svg>
);
// YouTube's own play mark, as its player shows it before the message starts
const YouTubeMark = () => (
  <svg className="ax-wn-yt" width="68" height="48" viewBox="0 0 68 48" aria-hidden="true">
    <path d="M66.5 7.7c-.8-2.9-2.5-5.4-5.4-6.2C55.8.1 34 0 34 0S12.2.1 6.9 1.6c-3 .8-4.6 3.3-5.4 6.1C.1 13 0 24 0 24s.1 11 1.5 16.3c.8 2.8 2.5 5.3 5.4 6.1C12.2 47.9 34 48 34 48s21.8-.1 27.1-1.6c2.9-.8 4.6-3.3 5.4-6.1C67.9 35 68 24 68 24s-.1-11-1.5-16.3z" fill="#f00" />
    <path d="M45 24 27 14v20" fill="#fff" />
  </svg>
);

/** A church video file plays in the app's own player, its controls in the white under it (components/NotesMediaBar.js). */
function MediaBar() {
  return (
    <div className="ax-wn-media">
      <div className="ax-wn-seek">
        <span className="ax-wn-clock">0:00</span>
        <span className="ax-wn-track"><i /></span>
        <span className="ax-wn-clock right">-0:00</span>
      </div>
      <div className="ax-wn-controls">
        <span className="ax-wn-round on"><PhoneIcon name="file-text" size={22} /></span>
        <span className="ax-wn-round"><Rotate back /><b>15</b></span>
        <span className="ax-wn-playbig"><PhoneIcon name="play" size={28} /></span>
        <span className="ax-wn-round"><Rotate /><b>15</b></span>
        <span className="ax-wn-round"><Journal size={22} /></span>
      </div>
    </div>
  );
}

/**
 * The sheet as the app's notes page draws it (BethesdaApp screens/Bible/NotesSheet.js), in the app's
 * light look: the black band (Back, the title, the message 16:9 edge to edge), then Sermon Notes |
 * Journal — or the player's controls for a church video file — then two points at a time, a box for
 * every blank, and ‹ Points 1–2 of N › with Save (filled on the last page). The dock slides away on
 * this page in the app, so there is none here.
 *
 * The band: YouTube's own still and play mark (its embed shows them before the message starts); a
 * church file is black, as the app's VideoView is until the file plays (no poster there, so none
 * here); no video at all, the app's film mark and "No video with these notes".
 */
export function SheetPhone({ f }) {
  const pts = sheetPoints(f ? f.body : '');
  const pages = [];
  for (let i = 0; i < pts.length; i += 2) pages.push(pts.slice(i, i + 2));
  const [at, setAt] = useState(0);
  const last = pages.length - 1;
  const now = Math.max(0, Math.min(at, last));
  const page = pages[now] || null;
  const link = f ? String(f.video_url || '').trim() : '';
  const video = /^https?:\/\/[^\s]+$/i.test(link) ? link : '';
  const yt = video ? youtubeThumbs(video) : null;
  const file = !!video && !yt;
  const from = now * 2 + 1;
  const upTo = Math.min(pts.length, from + (page ? page.length - 1 : 0));
  const label = from === upTo ? `Point ${from} of ${pts.length}` : `Points ${from}–${upTo} of ${pts.length}`;
  const poster = yt ? yt.hq : '';

  return (
    <PhoneFrame statusBar="light" label="Sermon notes, as a phone shows them">
      <div className="ax-wn">
        <div className="ax-wn-top">
          <div className="ax-wn-bar">
            <span className="ax-wn-back"><PhoneIcon name="chevron-left" size={22} /></span>
            <span className="ax-wn-bartitle">{(f && f.title.trim()) || 'Sermon notes'}</span>
          </div>
          <div className="ax-wn-video" style={bg(poster)}>
            {!video ? <span className="ax-wn-none"><Film /><span>No video with these notes</span></span>
              : yt ? <YouTubeMark /> : null}
          </div>
        </div>
        {file ? <MediaBar /> : (
          <div className="ax-wn-tabs">
            <span className="ax-wn-tab on"><PhoneIcon name="file-text" size={16} />Sermon Notes</span>
            <span className="ax-wn-tab"><Journal size={16} />Journal</span>
          </div>
        )}
        <div className="ax-wn-points">
          {!page ? (
            <p className="ax-wn-empty">{f ? 'These notes are empty.' : 'No sermon notes for this message yet. Use the Journal to write your own.'}</p>
          ) : page.map((pt, pi) => (
            <div key={`pt${now}-${pi}`} className={pi > 0 ? 'ax-wn-next' : undefined}>
              {pt.lines.map((pieces, i) => (
                <div key={`l${i}`} className="ax-wn-line">
                  {pieces.map((p, j) => (p.blank === undefined
                    ? <span key={`w${j}`} className="ax-wn-words">{p.words}</span>
                    : <span key={`b${p.blank}`} className="ax-wn-box">…</span>))}
                </div>
              ))}
            </div>
          ))}
        </div>
        {f && page ? (
          <div className="ax-wn-nav">
            <div className="ax-wn-stepper">
              <button type="button" className={`ax-wn-step${now <= 0 ? ' off' : ''}`} disabled={now <= 0}
                onClick={() => setAt(now - 1)} aria-label="Previous point">
                <PhoneIcon name="chevron-left" size={24} />
              </button>
              <span className="ax-wn-steplabel">{label}</span>
              <button type="button" className={`ax-wn-step${now >= last ? ' off' : ''}`} disabled={now >= last}
                onClick={() => setAt(now + 1)} aria-label="Next point">
                <PhoneIcon name="chevron-right" size={24} />
              </button>
            </div>
            <span className={`ax-pa-btn lg ${now === last ? 'filled' : 'outline'} ax-wn-save`}>
              <PhoneIcon name="bookmark" size={17} /><span>Save</span>
            </span>
          </div>
        ) : null}
      </div>
    </PhoneFrame>
  );
}
