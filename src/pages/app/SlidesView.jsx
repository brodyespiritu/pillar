import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  listSlides, saveSlide, setSlideSort, deleteSlide,
  slideProblems, slideReady, uploadSlide, notSetUp, SETUP_HINT, CAPTION_MAX,
} from '../../lib/bulletinSlides';
import {
  useRows, useSaveQueue, useAutosave, useUndo,
  SaveState, Field, Toggle, Alert, Loading, RowList, ImageDrop,
} from './kit';

// App → Bulletin → Slides: the pictures from Sunday's screen, for the Bulletin's Slides fold.
// Drop them in, drag them into the order they were shown, switch each one on.

const formOf = (r) => ({
  image_url: r.image_url || '', caption: r.caption || '', on_date: r.on_date || '', published: r.published === true,
});
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;
const upload = (file) => uploadSlide(file);   // answers { url } or { error }

export default function SlidesView() {
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);
  const [toast, undo] = useUndo();

  const load = useCallback(async () => {
    setError('');
    try { rows.load(await listSlides()); setSetUp(true); }
    catch (e) { rows.load([]); if (notSetUp(e)) setSetUp(false); else setError(e.message); }
  }, [rows.load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const list = rows.rows;

  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const f = formOf(r);
    try {
      const saved = await saveSlide({ id: rows.idOf(key), sort: r.sort, ...f });
      rows.saved(key, f, saved);
    } catch (e) { rows.failed(key, notSetUp(e) ? SETUP_HINT : e.message); throw e; }
  }), [queue, rows]);

  const add = () => setPicked(rows.add({ image_url: '', caption: '', on_date: '', published: false, sort: ((list || []).length + 1) * 10 }, { first: false }));

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return;
    if (on && !slideReady(formOf(r))) { setError(slideProblems(formOf(r))[0]); return; }
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
    try { await queue(key, () => deleteSlide(r.id)); }
    catch (e) { rows.restore(r, at); setError(e.message); return; }
    undo('Slide deleted.', async () => {
      try { setPicked(rows.restore(await saveSlide({ sort: r.sort, ...formOf(r) }), at)); }
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

  if (list === null) return <Loading />;
  const current = list.find((r) => r._key === picked) || null;

  return (
    <>
      {!setUp && <Alert>{SETUP_HINT}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="ax-split two wide-list">
        <section className="ax-stack" style={{ gap: 14 }}>
          <button type="button" className="ax-btn primary" onClick={add} disabled={!setUp}>
            <Icon d={P.plus} size={17} />New slide
          </button>
          <div className="ax-panel tight">
            <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
              <span className="ax-list-count">
                {`${list.length} slide${list.length === 1 ? '' : 's'} · ${list.filter((r) => r.published).length} in the Bulletin`}
              </span>
            </div>
            <RowList rows={list} picked={picked} onPick={setPicked} onMove={reorder}
              empty={<div className="ax-empty"><strong>No slides yet</strong>Drop in the pictures from Sunday’s screen.</div>}
              renderRow={(r) => {
                const i = list.findIndex((x) => x._key === r._key);
                const f = formOf(r);
                return (
                  <>
                    <span className="ax-num">{i + 1}</span>
                    <span className="ax-thumb" style={f.image_url ? { backgroundImage: cssUrl(f.image_url) } : undefined}>
                      {!f.image_url && <Icon d={P.folder} size={18} />}
                    </span>
                    <span className="ax-row-main">
                      <span className={`ax-row-title${f.caption.trim() ? '' : ' muted'}`}>{f.caption.trim() || `Slide ${i + 1}`}</span>
                      <span className="ax-row-sub">
                        {r._error ? <span className="ax-row-flag">Not saved</span>
                          : r._saved === null ? 'Not saved yet'
                            : f.on_date || 'Whichever Sunday is showing'}
                      </span>
                    </span>
                    <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                      title={f.published ? 'In the Bulletin — switch off to take it out' : 'Hidden — switch on to show it'} />
                  </>
                );
              }} />
          </div>
        </section>
        <section>
          {current
            ? <SlideEditor key={current._key} row={current} rows={rows} persist={persist} setLive={setLive} remove={remove} />
            : <div className="ax-panel"><div className="ax-empty"><strong>Pick a slide to change it</strong>or add a new one.</div></div>}
        </section>
      </div>
      {toast}
    </>
  );
}

function SlideEditor({ row, rows, persist, setLive, remove }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: !!f.image_url, save: () => persist(key) });

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting="Not saved — a slide needs a picture" />
        <Toggle checked={f.published} onChange={(on) => setLive(key, on)} label="In the Bulletin"
          sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
      </div>
      <div className="ax-form">
        <Field label="The slide">
          <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={upload}
            label="Choose the slide" hint="A picture of what was on the screen." />
        </Field>
        <Field label="Caption" hint="What it was about. The app shows it under the slide." count={f.caption.length} max={CAPTION_MAX}>
          <input className="ax-input" value={f.caption} maxLength={CAPTION_MAX} onChange={(e) => set('caption', e.target.value)} />
        </Field>
        <Field label="The Sunday it belongs to" hint="Leave it empty and it shows with whichever Sunday the Bulletin is on.">
          <input className="ax-input" type="date" value={f.on_date} onChange={(e) => set('on_date', e.target.value)} />
        </Field>
      </div>
      <div className="ax-editor-foot">
        <span className="ax-hint">Drag the list to put the slides in the order they were shown.</span>
        <button type="button" className="ax-btn danger" onClick={() => remove(key)}><Icon d={P.trash} size={16} />Delete</button>
      </div>
    </div>
  );
}
