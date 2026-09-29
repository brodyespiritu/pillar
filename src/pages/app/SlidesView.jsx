import { useCallback, useEffect, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  listSlides, saveSlide, setSlideSort, deleteSlide,
  slideProblems, slideReady, uploadSlide, notSetUp, SETUP_HINT, CAPTION_MAX,
} from '../../lib/bulletinSlides';
import {
  useRows, useSaveQueue, useAutosave,
  SaveState, Field, Toggle, Loading, RowList, ImageDrop,
} from './kit';
import { ListPane, EditorPane, Cols, ColA, ColB } from './layout';

// App → Bulletin → Slides: the pictures from Sunday's screen, for the Bulletin's Slides fold.
// Drop them in — all of them at once — drag them into the order they were shown, switch them on.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4 Bulletin):
//   · the slides' state lives in BulletinPage (useSlides), so switching to Announcements and back
//     never reloads them or forgets which one was picked (Doherty threshold), and the first slide is
//     picked on load like every other list (one rule everywhere — Jakob's law)
//   · the workspace: list | editor | phone (the app's Bulletin with the Slides fold open)
//   · many pictures in one drop make one slide each, in file-name order (Tesler's law: the office
//     had to press New, choose a picture and wait, once per slide) — ImageDrop still replaces one
//   · Undo is the page's one toast, shared with Announcements
//   · pictures dropped while a batch is still going up JOIN it (one card, one count, one "Show all");
//     the whole list pane takes a drop, and a near miss anywhere else is refused, never opened in
//     place of Pillar (useWindowFileDrop)
//   · a picture chosen in the editor saves when its upload lands, even if the office has moved on
//     (setPicture) — the editor's autosave has flushed by then
//   · Delete waits for a first save still on its way, then deletes what it made

export const slideFormOf = (r) => ({
  image_url: r.image_url || '', caption: r.caption || '', on_date: r.on_date || '', published: r.published === true,
});
export const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
const upload = (file) => uploadSlide(file);   // answers { url } or { error }

export const PICTURE_TYPES = 'image/jpeg,image/png,image/webp';
const isPicture = (f) => !!f && /^image\/(jpeg|png|webp)$/i.test(String(f.type || ''));
// "slide 2" before "slide 10": the order a folder of exported slides lists them in
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quoted = (names) => names.map((n) => `“${n}”`).join(', ');
/** After every slide there is — never on top of one (New and the many-files drop both add at the end). */
export const nextSort = (list) => Math.max((list || []).length * 10, ...(list || []).map((r) => Number(r.sort) || 0)) + 10;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-09-20' → 'Sunday, Sep 20' (the app's own longDate); anything else as it is. */
export function dayWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]}, ${SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** '2026-09-27' → that day at noon (a Date), or null for anything that isn't a date. */
export function dateOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
/** The app only ever shows a slide on the Sunday it's pinned to (utils/bulletinSlides slidesFor): a
 *  Wednesday never comes. The weekday's name when the date isn't a Sunday, else ''. */
export function notSunday(iso) {
  const d = dateOf(iso);
  return d && d.getDay() !== 0 ? DAYS[d.getDay()] : '';
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'In the Bulletin' },
  { key: 'hidden', label: 'Hidden' },
];

/**
 * Everything the Slides tab knows, held by BulletinPage so it outlives the tab: the rows, the pick,
 * the search, the list's filter, and a many-files upload that keeps going while you look at
 * Announcements. `undo(message, fn)` is the page's one toast.
 */
export function useSlides({ undo }) {
  const rows = useRows(slideFormOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // the drop card: { id, keys (every slide it will offer to show), total, done (uploads), running }
  const [batch, setBatch] = useState(null);
  // the upload going now, outside React so a second drop can join it:
  // { id, items: [{ file, key }], next, active (workers), done, failed: [{ name, error }], notPics: [] }
  const job = useRef(null);
  const jobs = useRef(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = (await listSlides()) || [];
      rows.load(list);
      setSetUp(true);
      // the first slide is picked, as on every other list; a pick that is still there stays
      setPicked((p) => (p && list.some((r) => String(r.id) === p) ? p : (list[0] ? String(list[0].id) : null)));
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
    const f = slideFormOf(r);
    try {
      const saved = await saveSlide({ id: rows.idOf(key), sort: r.sort, ...f });
      rows.saved(key, f, saved);
    } catch (e) { rows.failed(key, notSetUp(e) ? SETUP_HINT : e.message); throw e; }
  }), [queue, rows]);

  const add = () => {
    setSearch(''); setFilter('all');   // the new slide can't hide behind a search
    const key = rows.add({ image_url: '', caption: '', on_date: '', published: false, sort: nextSort(list) }, { first: false });
    setPicked(key);
    return key;
  };

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return false;
    if (on && !slideReady(slideFormOf(r))) { setError(slideProblems(slideFormOf(r))[0]); return false; }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); return true; } catch (e) {
      rows.patch(key, { published: !on });
      // it used to flip back without a word (only the row's "Not saved" said so)
      setError(notSetUp(e) ? SETUP_HINT : e.message);
      return false;
    }
  };

  /** A picture the editor's box finished uploading: on the slide AND saved, at once — the office may
   *  have picked another slide (or tab) meanwhile, and that editor's autosave flushed when it went.
   *  persist is queued and skips a clean row, so the autosave of the same change can't copy it. */
  const setPicture = (key, url) => {
    rows.patch(key, { image_url: url });
    persist(key).catch(() => { /* the row says "Not saved", and why */ });
  };

  const remove = async (key) => {
    const all = list || [];
    const r = rows.get(key);
    if (!r) return;
    const at = all.findIndex((x) => x._key === key);
    rows.remove(key);
    setPicked((p) => (p === key ? (all[at + 1] || all[at - 1])?._key || null : p));
    // a first save still on its way lands after this: let it, then delete what it made (rows.saved
    // keeps the new id even for a row that's gone) — else a hidden slide comes back on the next load
    await queue(key, async () => {});
    const id = r._saved !== null ? r.id : rows.idOf(key);
    if (!id) return;   // it never reached the database
    try { await queue(key, () => deleteSlide(id)); }
    catch (e) { rows.restore({ ...r, id }, at); setError(e.message); return; }
    undo('Slide deleted.', async () => {
      try { setPicked(rows.restore(await saveSlide({ sort: r.sort, ...slideFormOf(r) }), at)); }
      catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  };

  const reorder = async (keys) => {
    rows.order(keys);
    try {
      for (let i = 0; i < keys.length; i++) {
        const id = rows.idOf(keys[i]);
        rows.patch(keys[i], { sort: (i + 1) * 10 });
        if (id) await setSlideSort(id, (i + 1) * 10);
      }
    } catch (e) { setError(e.message); load(); }
  };

  // the batch is over when its last worker runs dry: the card offers "Show all", the pick stays on a
  // slide that's still there, and what went wrong is said once, for every drop that joined it
  const finish = (j) => {
    if (job.current === j) job.current = null;
    setBatch((b) => (b && b.id === j.id ? { ...b, running: false } : b));
    const keys = j.items.map((it) => it.key);
    setPicked((p) => (p && rows.get(p) ? p : keys.find((k) => rows.get(k)) || null));
    const said = [];
    if (j.failed.length) said.push(`${plural(j.failed.length, 'picture')} couldn’t be added: ${j.failed.map((f) => `“${f.name}” (${f.error})`).join('; ')}.`);
    said.push(...j.notPics);
    if (said.length) setError(said.join(' '));
  };

  // one of (at most) three uploaders, pulling from the batch's queue until it's empty — a drop that
  // joins the batch adds to the same queue
  const work = async (j) => {
    j.active += 1;
    while (j.next < j.items.length) {
      const { file, key } = j.items[j.next++];
      let r;
      try { r = await uploadSlide(file); } catch (e) { r = { error: e.message }; }
      if (r && r.url) {
        // a picture chosen in the editor meanwhile wins over the one still on its way
        rows.patch(key, (row) => ({ _up: false, ...(row.image_url ? {} : { image_url: r.url }) }));
        try { await persist(key); } catch { /* the row says "Not saved", and why */ }
      } else {
        rows.remove(key);
        j.failed.push({ name: file.name || 'A picture', error: (r && r.error) || 'It didn’t upload.' });
      }
      j.done += 1;
      setBatch((b) => (b && b.id === j.id ? { ...b, done: j.done } : b));
    }
    j.active -= 1;
    if (j.active === 0) finish(j);
  };

  /**
   * Many pictures at once: one slide per picture, in file-name order, after the slides already
   * there (ascending sort). Each is what New + the picture box did by hand — add the row, upload the
   * picture (uploadSlide), save it (persist) — three pictures at a time. They arrive hidden, as a
   * New slide does; the drop card then offers to show them all with one click. Pictures dropped
   * while a batch is still going up join it: the same card counts all of them, and "Show all" shows
   * all of them (a new batch used to replace the running one, losing its count and its offer).
   */
  const addFiles = (files) => {
    if (!setUp) return;
    const all = Array.from(files || []);
    const pics = all.filter(isPicture).sort(byName);
    const skipped = all.filter((f) => !isPicture(f)).map((f) => f.name || 'A file');
    const notPics = skipped.length
      ? `${quoted(skipped)} ${skipped.length === 1 ? 'isn’t a picture' : 'aren’t pictures'} — choose JPG, PNG or WebP.` : '';
    if (!pics.length) { if (notPics) setError(notPics); return; }
    setSearch(''); setFilter('all');
    const base = nextSort(rows.rows || []);
    const keys = pics.map((f, i) => rows.add(
      { image_url: '', caption: '', on_date: '', published: false, sort: base + i * 10, _up: true }, { first: false },
    ));
    let j = job.current;
    if (j) {
      // joining: the office is already looking at the batch's first slide, so the pick stays put
      setBatch((b) => (b && b.id === j.id ? { ...b, keys: [...b.keys, ...keys], total: b.total + pics.length } : b));
    } else {
      j = { id: ++jobs.current, items: [], next: 0, active: 0, done: 0, failed: [], notPics: [] };
      job.current = j;
      const id = j.id;
      setError('');
      setPicked(keys[0]);
      // a finished batch still offering "Show all" keeps its slides in the offer: one click for both
      setBatch((b) => ({ id, keys: [...(b && !b.running ? b.keys : []), ...keys], total: pics.length, done: 0, running: true }));
    }
    if (notPics) j.notPics.push(notPics);
    pics.forEach((file, i) => j.items.push({ file, key: keys[i] }));
    // back up to three uploaders (a batch near its end may be down to one)
    const more = Math.min(3 - j.active, j.items.length - j.next);
    for (let n = 0; n < more; n++) work(j);
  };

  // the batch's new slides that are saved and still hidden — every drop that joined it
  const waiting = (batch && !batch.running ? batch.keys : [])
    .map((k) => rows.get(k))
    .filter((r) => r && !r._up && r._saved !== null && !slideFormOf(r).published && slideReady(slideFormOf(r)));
  const showBatch = async () => {
    for (const r of waiting) {
      if (!(await setLive(r._key, true))) return;   // the first failure stops it, and says why
    }
    setBatch(null);
  };

  const uploading = (list || []).some((r) => r._up);
  const unsaved = (list || []).some((r) => r._up || (rows.dirty(r) && !!slideFormOf(r).image_url));

  return {
    rows, list, picked, setPicked, error, setError, setUp, load, persist, setPicture,
    add, setLive, remove, reorder, addFiles, search, setSearch, filter, setFilter,
    batch, waiting, showBatch, dismissBatch: () => setBatch(null), uploading, unsaved,
  };
}

const hasFiles = (e) => !!(e && e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));
// which of `zones` (selectors) the pointer is over — a drag's target can be a text node
function zoneOf(e, zones) {
  const t = e && e.target;
  const el = t && t.nodeType === 3 ? t.parentElement : t;
  if (!el || typeof el.closest !== 'function' || !zones) return null;
  return Object.keys(zones).find((sel) => el.closest(sel)) || null;
}

/**
 * Files dragged in from the computer, for the whole window while `enabled`: over one of `zones`
 * ({ selector: onFiles(files) }) they're taken; anywhere else the browser is told no, so a near miss
 * (the list's head, its padding, the editor, a list still loading) never opens the picture in place
 * of Pillar. A box that takes its own drop first (the editor's picture box) is left alone. Answers
 * the selector the files are over, or null. One window listener, so a drop is never taken twice.
 */
export function useWindowFileDrop(zones, enabled = true) {
  const [over, setOver] = useState(null);
  const latest = useRef(zones);
  latest.current = zones;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const onEnter = (e) => { if (hasFiles(e) && !e.defaultPrevented) e.preventDefault(); };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      if (e.defaultPrevented) { setOver(null); return; }   // a box below took it
      e.preventDefault();
      const z = zoneOf(e, latest.current);
      if (e.dataTransfer) e.dataTransfer.dropEffect = z ? 'copy' : 'none';
      setOver(z);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      setOver(null);
      if (e.defaultPrevented) return;
      e.preventDefault();
      const z = zoneOf(e, latest.current);
      if (z) latest.current[z](Array.from(e.dataTransfer.files || []));
    };
    const onLeave = (e) => { if (!e.relatedTarget) setOver(null); };   // out of the window
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragleave', onLeave);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragleave', onLeave);
      setOver(null);
    };
  }, [enabled]);
  return over;
}

// the two places Slides takes a drop: the whole list pane, and (no slides yet) the editor's big card
const LIST_ZONE = '.ax-bl-list';
const BIG_ZONE = '.ax-bl-bigdrop';

/**
 * The card that takes a whole folder of slides: drop them anywhere on the list pane (all of it is
 * the target — Fitts's law) or choose them. While they go up it counts — more dropped meanwhile join
 * the count; afterwards it offers to show them all (one click instead of one switch per slide).
 */
export function SlidesDrop({ s, over = false, big = false }) {
  const input = useRef(null);
  const b = s.batch;
  const cls = `ax-bl-drop${big ? ' big' : ''}`;
  if (b && b.running) {
    const pct = Math.round((b.done / Math.max(1, b.total)) * 100);
    return (
      <div className={`${cls} busy`} aria-live="polite">
        <span className="ax-bl-drop-icon"><span className="ax-spinner" /></span>
        <div className="ax-bl-drop-text">
          <strong>Adding {plural(b.total, 'slide')}…</strong>
          {b.done} of {b.total} uploaded. Keep working — even on Announcements.
        </div>
        <div className="ax-progress" role="progressbar" aria-label="Slides uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (b && s.waiting.length) {
    return (
      <div className={`${cls} done`} aria-live="polite">
        <span className="ax-bl-drop-icon"><Icon d={P.check} size={20} /></span>
        <div className="ax-bl-drop-text">
          <strong>{plural(s.waiting.length, 'new slide')} — hidden for now</strong>
          Look them over, then show them all at once.
        </div>
        <div className="ax-bl-drop-btns">
          <button type="button" className="ax-btn sm" onClick={s.showBatch}>Show all {s.waiting.length} in the Bulletin</button>
          <button type="button" className="ax-iconbtn" onClick={s.dismissBatch} aria-label="Not now" title="Not now">
            <Icon d={P.close} size={18} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`${cls}${over ? ' over' : ''}`}>
      <span className="ax-bl-drop-icon"><Icon d={P.layers} size={20} /></span>
      <div className="ax-bl-drop-text">
        <strong>{over ? 'Let go to add them' : big ? 'Drop in the pictures from Sunday’s screen' : 'Drop Sunday’s slides here'}</strong>
        As many as you like — one slide each, in file-name order.
      </div>
      <button type="button" className="ax-btn sm" disabled={!s.setUp || s.uploading}
        onClick={() => input.current && input.current.click()}>
        <Icon d={P.folder} size={16} />Choose pictures
      </button>
      <input ref={input} type="file" accept={PICTURE_TYPES} multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; s.addFiles(f); }} />
    </div>
  );
}

/**
 * The Slides tab's list and editor (the phone beside them is the page's — BulletinPage). `s` is
 * useSlides(); `onOpen` = a row was clicked or New (a narrow screen then shows the editor), `onBack`
 * is the editor's Back.
 */
export default function SlidesView({ s, onOpen, onBack }) {
  const list = s.list;
  // pictures dropped before the slides can take them are refused with a reason, not silently
  const take = (files) => {
    if (s.setUp && list !== null) s.addFiles(files);
    else s.setError(s.setUp ? 'The slides are still loading — drop the pictures again in a moment.' : 'Slides aren’t ready yet — see the note above.');
  };
  const over = useWindowFileDrop({ [LIST_ZONE]: take, [BIG_ZONE]: take });
  const q = s.search.trim().toLowerCase();
  const all = list || [];
  const place = new Map(all.map((r, i) => [r._key, i]));
  const liveCount = all.filter((r) => slideFormOf(r).published).length;
  const shown = all.filter((r) => {
    const f = slideFormOf(r);
    if (s.filter === 'live' && !f.published) return false;
    if (s.filter === 'hidden' && f.published) return false;
    if (!q) return true;
    return `${f.caption} ${f.on_date} ${dayWords(f.on_date)} slide ${place.get(r._key) + 1}`.toLowerCase().includes(q);
  });
  const narrowed = !!q || s.filter !== 'all';
  const current = all.find((r) => r._key === s.picked) || null;
  const pick = (key) => { s.setPicked(key); onOpen(); };

  return (
    <>
      {/* the list: New on top (the view's one filled button — Von Restorff), search, filters; the
          whole pane, head and all, takes dropped pictures (Fitts: the biggest target on the page) */}
      <ListPane label="Slides" className={`ax-bl-list${over === LIST_ZONE ? ' over' : ''}`}
        newLabel="New slide" onNew={() => { s.add(); onOpen(); }}
        newDisabled={!s.setUp || list === null}
        newHint={!s.setUp ? 'Slides need their table set up first — see the note above.' : 'Loading the slides…'}
        search={s.search} onSearch={s.setSearch} searchPlaceholder="Search captions, Sundays…"
        filters={FILTERS.map((f) => ({ ...f, count: f.key === 'all' ? all.length : f.key === 'live' ? liveCount : all.length - liveCount }))}
        filter={s.filter} onFilter={s.setFilter}
        count={list === null ? null : `${all.length} slide${all.length === 1 ? '' : 's'} · ${liveCount} in the Bulletin`}>
        {list === null ? <Loading /> : (
          <div className="ax-bl-dropzone">
            {s.setUp && all.length > 0 ? <SlidesDrop s={s} over={over === LIST_ZONE} /> : null}
            <RowList rows={shown} picked={s.picked} onPick={pick}
              // dragging a filtered list would drop the slides it isn't showing: only the whole list orders
              onMove={narrowed || s.uploading ? undefined : s.reorder}
              empty={all.length
                ? <div className="ax-empty"><strong>No slides match</strong>{q ? `Nothing has “${s.search.trim()}” in it.` : 'Try another filter.'}</div>
                : <div className="ax-empty"><strong>No slides yet</strong>Drop in the pictures from Sunday’s screen.</div>}
              renderRow={(r) => {
                const i = place.get(r._key);
                const f = slideFormOf(r);
                return (
                  <>
                    {/* its place in the order, on the picture (a 300px list has no room for both side by side) */}
                    <span className="ax-thumb ax-bl-thumb" style={f.image_url ? { backgroundImage: cssUrl(f.image_url) } : undefined}>
                      {r._up ? <span className="ax-spinner" /> : !f.image_url ? <Icon d={P.folder} size={18} /> : null}
                      <span className="ax-num ax-bl-num">{i + 1}</span>
                    </span>
                    <span className="ax-row-main">
                      <span className={`ax-row-title${f.caption.trim() ? '' : ' muted'}`}>{f.caption.trim() || `Slide ${i + 1}`}</span>
                      <span className="ax-row-sub">
                        {r._up ? 'Uploading…'
                          : r._error ? <span className="ax-row-flag">Not saved</span>
                            : r._saved === null ? 'Not saved yet'
                              : f.on_date ? dayWords(f.on_date) : 'Whichever Sunday is showing'}
                      </span>
                    </span>
                    <Toggle small checked={f.published} onChange={(on) => s.setLive(r._key, on)} disabled={!!r._up}
                      title={f.published ? 'In the Bulletin — switch off to take it out' : 'Hidden — switch on to show it'} />
                  </>
                );
              }} />
            {all.length > 1 ? (
              <p className="ax-hint ax-list-hint">
                {narrowed ? 'Clear the search and filter to drag the slides into order.' : 'Drag to put the slides in the order they were shown.'}
              </p>
            ) : null}
          </div>
        )}
      </ListPane>

      {current ? (
        <SlideEditor key={current._key} row={current} rows={s.rows} persist={s.persist} setLive={s.setLive}
          setPicture={s.setPicture} remove={s.remove} position={place.get(current._key) + 1} total={all.length} onBack={onBack} />
      ) : (
        <EditorPane onBack={onBack} backLabel="Slides" label="Slide"
          empty={list === null ? <Loading />
            : s.setUp && !all.length ? <div className="ax-bl-bigdrop"><SlidesDrop s={s} over={over === BIG_ZONE} big /></div>
              : <><strong>Pick a slide to change it</strong>or add a new one.</>}>
          {null}
        </EditorPane>
      )}
    </>
  );
}

function SlideEditor({ row, rows, persist, setLive, setPicture, remove, position, total, onBack }) {
  const key = row._key;
  const f = slideFormOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: !!f.image_url, save: () => persist(key) });
  // an upload hands its picture to the slide itself (setPicture saves it), so a slow one still lands
  // and saves after the office has picked another slide and this editor is gone; the box's own
  // onChange (Remove, a pasted address) goes through the autosave as before
  const uploadTo = async (file) => {
    const r = await upload(file);
    if (r && r.url) setPicture(key, r.url);
    return r;
  };

  return (
    // Fitts: what you'd do to a slide — its save state, its switch, Delete — stays in the head
    <EditorPane label="Slide" onBack={onBack} backLabel="Slides" onSave={auto.flush}
      status={<SaveState auto={auto} waiting={row._up ? 'Uploading the picture…' : 'Not saved — a slide needs a picture'} />}
      switches={(
        <span className="ax-sw-on">
          <Toggle checked={f.published} onChange={(on) => setLive(key, on)} label="In the Bulletin" disabled={!!row._up}
            sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
        </span>
      )}
      actions={(
        <button type="button" className="ax-headbtn danger" onClick={() => remove(key)} aria-label="Delete slide" title="Delete slide">
          <Icon d={P.trash} size={18} />
        </button>
      )}>
      {/* proximity: the picture on one side, the words about it on the other */}
      <Cols>
        <ColA title="The slide" right={`${position} of ${total}`}>
          <Field label="The picture">
            <div className="ax-bl-shot">
              <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={uploadTo}
                label="Choose the slide" hint="A picture of what was on the screen." />
            </div>
          </Field>
        </ColA>
        <ColB title="About it">
          <Field label="Caption" hint="What it was about. The app shows it under the slide." count={f.caption.length} max={CAPTION_MAX}>
            <input className="ax-input" value={f.caption} maxLength={CAPTION_MAX} onChange={(e) => set('caption', e.target.value)} />
          </Field>
          <Field label="The Sunday it belongs to" hint="Leave it empty and it shows with whichever Sunday the Bulletin is on.">
            <input className="ax-input" type="date" value={f.on_date} onChange={(e) => set('on_date', e.target.value)} />
            {notSunday(f.on_date) ? (
              <p className="ax-hint bad" role="status">
                That’s a {notSunday(f.on_date)}. The app shows a slide only on the Sunday it belongs to, so pick a Sunday.
              </p>
            ) : null}
          </Field>
          <p className="ax-hint">Drag the list to put the slides in the order they were shown.</p>
        </ColB>
      </Cols>
    </EditorPane>
  );
}
