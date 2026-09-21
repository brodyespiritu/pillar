import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  listSheets, saveSheet, deleteSheet, sheetProblems, sheetReady, countBlanks,
  notSetUp, SETUP_HINT, SHEET_LIMITS, BLANK,
} from '../../lib/sermonSheets';
import {
  useRows, useSaveQueue, useAutosave, useUndo,
  SaveState, Field, GrowText, Toggle, Alert, Loading, RowList, VideoDrop,
} from './kit';

// App → Watch → Notes: the fill-in-the-blank sermon notes the congregation gets on the app's Bible
// page. Type the outline and put ___ wherever the congregation writes something in; the app turns
// each one into a box they tap. What they type is kept on their own record, never here.

const formOf = (r) => ({
  title: r.title || '', speaker: r.speaker || '', passage: r.passage || '', on_date: r.on_date || '',
  video_url: r.video_url || '', body: r.body || '', published: r.published === true,
});
const titled = (f) => !!String(f.title || '').trim();

export default function NotesView() {
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const [toast, undo] = useUndo();

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

  const add = () => setPicked(rows.add({
    title: '', speaker: '', passage: '', on_date: '', video_url: '', body: '', published: false,
    sort: ((list || []).length + 1) * 10,
  }, { first: true }));

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

  return (
    <>
      {!setUp && <Alert>{SETUP_HINT}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="ax-split">
        <section className="ax-stack" style={{ gap: 14 }}>
          <button type="button" className="ax-btn primary" onClick={add} disabled={!setUp}>
            <Icon d={P.plus} size={17} />New notes
          </button>
          <div className="ax-panel tight">
            <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
              <span className="ax-list-count">
                {`${list.length} sheet${list.length === 1 ? '' : 's'} · ${list.filter((r) => r.published).length} in the app`}
              </span>
            </div>
            <RowList rows={list} picked={picked} onPick={setPicked}
              empty={<div className="ax-empty"><strong>No notes yet</strong>Write the outline and mark the blanks.</div>}
              renderRow={(r) => {
                const f = formOf(r);
                const blanks = countBlanks(f.body);
                return (
                  <>
                    <span className="ax-thumb"><Icon d={P.doc} size={18} /></span>
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
            ? <SheetEditor key={current._key} row={current} rows={rows} persist={persist} setLive={setLive} remove={remove} />
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

function SheetEditor({ row, rows, persist, setLive, remove }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => persist(key) });
  const blanks = countBlanks(f.body);

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting="Not saved — give the notes a title" />
        <Toggle checked={f.published} onChange={(on) => setLive(key, on)} label="In the app"
          sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
      </div>
      <div className="ax-form">
        <Field label="Title">
          <input className="ax-input title" value={f.title} autoFocus={row._saved === null}
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
          <GrowText value={f.body} minRows={12} onChange={(e) => set('body', e.target.value)}
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
            {line.trim() === '' ? ' ' : null}
          </p>
        ))}
      </div>
    </div>
  );
}
