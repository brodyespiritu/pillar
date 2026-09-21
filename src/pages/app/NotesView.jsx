import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import {
  listSheets, saveSheet, deleteSheet, sheetProblems, sheetReady, countBlanks, fromSermon, sermonLinkReady,
  notSetUp, SETUP_HINT, SERMON_HINT, SHEET_LIMITS, BLANK,
} from '../../lib/sermonSheets';
import {
  useRows, useSaveQueue, useAutosave, useUndo,
  SaveState, Field, GrowText, Toggle, Alert, Loading, RowList, VideoDrop,
} from './kit';

// App → Watch → Notes: the fill-in-the-blank sermon notes the congregation gets on the app's Bible
// page. Type the outline and put ___ wherever the congregation writes something in; the app turns
// each one into a box they tap. What they type is kept on their own record, never here.
//
// Notes can go with one sermon from the Sermons tab: pick it at the top of the editor (or press
// "Fill-in notes" on the sermon itself). Its title, speaker, date and video fill in, and the app
// offers the notes on that sermon's card. One sheet per sermon.

const formOf = (r) => ({
  sermon_id: r.sermon_id ? String(r.sermon_id) : '',
  title: r.title || '', speaker: r.speaker || '', passage: r.passage || '', on_date: r.on_date || '',
  video_url: r.video_url || '', body: r.body || '', published: r.published === true,
});
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
const sermonTitle = (s) => String(s?.title || '').trim() || 'Untitled sermon';
const sermonSub = (s) => [s?.speaker, s?.date].filter(Boolean).join(' · ') || 'No speaker or date yet';

export default function NotesView({ sermons = [] }) {
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const [toast, undo] = useUndo();
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    setError('');
    try { rows.load(await listSheets()); setSetUp(true); }
    catch (e) { rows.load([]); if (notSetUp(e)) setSetUp(false); else setError(e.message); }
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

  const add = (sermon) => setPicked(rows.add({
    sermon_id: '', title: '', speaker: '', passage: '', on_date: '', video_url: '', body: '', published: false,
    sort: ((list || []).length + 1) * 10,
    ...(sermon ? fromSermon(sermon) : {}),
  }, { first: true }));

  // Opened from a sermon (Watch → Sermons → "Fill-in notes"): its notes, or new ones for it.
  const forSermon = params.get('for');
  const handled = useRef(null);
  useEffect(() => {
    if (!forSermon || list === null || handled.current === forSermon) return;
    const theirs = list.find((r) => formOf(r).sermon_id === forSermon);
    const sermon = sermons.find((s) => String(s.id) === forSermon);
    if (!theirs && !sermon) return;   // the sermons are still on their way
    handled.current = forSermon;
    if (theirs) setPicked(theirs._key);
    else if (setUp) add(sermon);
    const next = new URLSearchParams(params);
    next.delete('for');
    setParams(next, { replace: true });
  }, [forSermon, list, sermons]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return;
    const f = formOf(r);
    if (on && !sheetReady(f)) { setError(sheetProblems(f)[0]); return; }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch { rows.patch(key, { published: !on }); }
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
    undo(`“${String(r.title || '').trim() || 'These notes'}” deleted.`, async () => {
      try { setPicked(rows.restore(await saveSheet({ sort: r.sort, ...formOf(r) }), at)); }
      catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  };

  if (list === null) return <Loading />;
  const current = list.find((r) => r._key === picked) || null;
  const sermonOf = (id) => (id ? sermons.find((s) => String(s.id) === id) || null : null);
  // the sermons that already have notes, besides the one being changed
  const taken = new Set(list.filter((r) => r !== current).map((r) => formOf(r).sermon_id).filter(Boolean));

  return (
    <>
      {!setUp && <Alert>{SETUP_HINT}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="ax-split">
        <section className="ax-col">
          <button type="button" className="ax-btn primary" onClick={() => add()} disabled={!setUp}>
            <Icon d={P.plus} size={17} />New notes
          </button>
          <div className="ax-panel tight">
            <div className="ax-list-head">
              <span className="ax-list-count">
                {`${list.length} sheet${list.length === 1 ? '' : 's'} · ${list.filter((r) => r.published).length} in the app`}
              </span>
            </div>
            <RowList rows={list} picked={picked} onPick={setPicked}
              empty={<div className="ax-empty"><strong>No notes yet</strong>Write the outline and mark the blanks.</div>}
              renderRow={(r) => {
                const f = formOf(r);
                const blanks = countBlanks(f.body);
                const pic = sermonOf(f.sermon_id)?.thumbnailUrl;
                return (
                  <>
                    <span className="ax-thumb" style={pic ? { backgroundImage: cssUrl(pic) } : undefined}>
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
                    <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                      title={f.published ? 'In the app — switch off to take it out' : 'Hidden — switch on to show it'} />
                  </>
                );
              }} />
          </div>
        </section>
        <section>
          {current
            ? <SheetEditor key={current._key} row={current} rows={rows} persist={persist} setLive={setLive} remove={remove}
                sermons={sermons} taken={taken} />
            : <div className="ax-panel"><div className="ax-empty"><strong>Pick a sheet to change it</strong>or write a new one.</div></div>}
        </section>
        <aside className="ax-aside">
          <div className="ax-sticky ax-phone-wrap">
            <div className="ax-phone">
              <div className="ax-phone-title">Sermon notes</div>
              {current ? <SheetPreview f={formOf(current)} /> : <div className="ax-phone-none">Pick a sheet to see it here</div>}
            </div>
            <p className="ax-phone-cap">Every ___ becomes a box the member taps and types into. What they write is kept on their own record.</p>
          </div>
        </aside>
      </div>
      {toast}
    </>
  );
}

function SheetEditor({ row, rows, persist, setLive, remove, sermons, taken }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  // the database takes a sheet once it has a title and some notes, so that's when it saves
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: sheetReady(f), save: () => persist(key) });
  const blanks = countBlanks(f.body);
  const problem = sheetProblems(f)[0];

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting={problem ? `Not saved yet. ${problem}` : 'Not saved yet'} />
        <Toggle checked={f.published} onChange={(on) => setLive(key, on)} label="In the app"
          sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
      </div>
      <div className="ax-form">
        <SermonField f={f} sermons={sermons} taken={taken}
          onPick={(s) => rows.patch(key, (r) => fromSermon(s, formOf(r)))}
          onClear={() => set('sermon_id', '')} />
        <Field label="Title">
          <input className="ax-input title" value={f.title} autoFocus={row._saved === null && !f.sermon_id}
            maxLength={SHEET_LIMITS.title} placeholder="The message’s title"
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="ax-row3">
          <Field label="Speaker"><input className="ax-input" value={f.speaker} onChange={(e) => set('speaker', e.target.value)} /></Field>
          <Field label="Passage"><input className="ax-input" value={f.passage} placeholder="Book 1:1" onChange={(e) => set('passage', e.target.value)} /></Field>
          <Field label="Date"><input className="ax-input" type="date" value={f.on_date} onChange={(e) => set('on_date', e.target.value)} /></Field>
        </div>
        <Field label="Video" hint="Plays at the top of the page while they fill the notes in.">
          <VideoDrop value={f.video_url} onChange={(u) => set('video_url', u)} />
        </Field>
        <Field label="The notes"
          hint={`Put ${BLANK} wherever the congregation writes something in. ${blanks} blank${blanks === 1 ? '' : 's'} so far.`}
          count={f.body.length} max={SHEET_LIMITS.body}>
          <GrowText value={f.body} minRows={12} autoFocus={row._saved === null && !!f.sermon_id}
            onChange={(e) => set('body', e.target.value)}
            placeholder={`1. God is ${BLANK} in all things.\n\n2. His mercy is ${BLANK} every morning.`} />
        </Field>
      </div>
      <div className="ax-editor-foot">
        <span className="ax-hint">{blanks ? `${blanks} box${blanks === 1 ? '' : 'es'} for the congregation to fill in.` : 'No blanks yet — add ___ where they write.'}</span>
        <button type="button" className="ax-btn danger" onClick={() => remove(key)}><Icon d={P.trash} size={16} />Delete</button>
      </div>
    </div>
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
                  <span className="ax-thumb" style={s.thumbnailUrl ? { backgroundImage: cssUrl(s.thumbnailUrl) } : undefined}>
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
        <span className="ax-thumb" style={current?.thumbnailUrl ? { backgroundImage: cssUrl(current.thumbnailUrl) } : undefined}>
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

/** The sheet as a phone draws it: the words, and a line wherever a blank is. */
function SheetPreview({ f }) {
  const lines = String(f.body || '').split('\n');
  return (
    <div className="ax-sheet">
      <div className="ax-sheet-title">{f.title || 'Title'}</div>
      {[f.speaker, f.passage].filter(Boolean).length > 0 && (
        <div className="ax-sheet-meta">{[f.speaker, f.passage].filter(Boolean).join('  ·  ')}</div>
      )}
      <div className="ax-sheet-body">
        {lines.map((line, i) => (
          <p key={`l${i}`} className="ax-sheet-line">
            {line.split(/_{3,}/).map((bit, j, all) => (
              <span key={`b${j}`}>
                {bit}
                {j < all.length - 1 ? <span className="ax-sheet-blank" /> : null}
              </span>
            ))}
            {line.trim() === '' ? ' ' : null}
          </p>
        ))}
      </div>
    </div>
  );
}
