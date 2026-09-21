import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  getSermons, saveSermon, deleteSermon,
  getMediaLayout, putMediaLayout,
  getCustomBlocks, saveCustomBlock, deleteCustomBlock,
  getResources, saveResource, deleteResource,
  uploadImage, genId,
} from '../../lib/appApi';
import {
  listSeries, saveSeries, setSeriesSort, deleteSeries,
  seriesProblems, seriesReady, cleanItems,
  listFeatured, setFeatured, notSetUp, SETUP_HINT, SERIES_LIMITS,
} from '../../lib/mediaSeries';
import NotesView from './NotesView';
import {
  useServerList, useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList, ImageDrop, VideoDrop,
} from './kit';

// App → Watch: everything on the app's Media tab — the sermons, the series they belong to, the
// extra videos and the resources. One page, four views; each list works like the rest of App:
// pick, change (it saves as you type), switch on or off.
//
// Two switches decide where something shows in the app:
//   In the app   members can see it at all
//   Featured     it sits right below the big card at the top of Media
// A series is its own row on Media, with everything in it side by side.

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
  duration: r.duration || '', thumbnailUrl: r.thumbnailUrl || '', videoLink: r.videoLink || '',
  mainVerse: r.mainVerse || '', notes: r.notes || '', published: r.published !== false,
});
const blockForm = (r) => ({
  title: r.title || '', subtitle: r.subtitle || '', videoUrl: r.videoUrl || '', thumbnail: r.thumbnail || '',
  playInContainer: r.playInContainer !== false, published: r.published !== false,
});
const resourceForm = (r) => ({
  title: r.title || '', subtitle: r.subtitle || '', type: r.type || 'Series', coverUrl: r.coverUrl || '',
  link: r.link || '', published: r.published !== false,
});
const seriesForm = (r) => ({
  name: r.name || '', subtitle: r.subtitle || '', image_url: r.image_url || '',
  items: cleanItems(r.items), published: r.published === true,
});
const titled = (f) => !!String(f.title || '').trim();
const named = (f) => !!String(f.name || '').trim();
const upload = async (file) => {
  const url = await uploadImage(file);
  return url ? { url } : { error: 'The upload didn’t return an address.' };
};
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;

/* ── what is featured: the row right below the big card on Media ── */

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

/** The star beside a row, and the switch inside an editor. */
function FeaturedSwitch({ feat, id, kind, saved, small }) {
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
      sub={!feat.setUp ? SETUP_HINT : on ? 'Right below the big card on Media' : 'Not below the big card'} />
  );
}

/* ── suggested: the row under Featured, kept on the app server's media layout ── */

function useSuggested() {
  const [layout, setLayout] = useState(null);
  const [error, setError] = useState('');
  const queue = useSaveQueue();

  useEffect(() => {
    getMediaLayout().then((l) => setLayout(l || {})).catch((e) => { setLayout({}); setError(e.message); });
  }, []);

  const ids = Array.isArray(layout?.suggestedIds) ? layout.suggestedIds : [];
  const has = (id) => ids.includes(String(id));
  const toggle = (id, on) => queue('suggested', async () => {
    const key = String(id);
    const next = on ? [...ids, key] : ids.filter((x) => x !== key);
    setLayout((l) => ({ ...(l || {}), suggestedIds: next }));
    try { await putMediaLayout({ ...(layout || {}), suggestedIds: next }); }
    catch (e) { setError(e.message); setLayout((l) => ({ ...(l || {}), suggestedIds: ids })); }
  });

  return { ready: layout !== null, has, toggle, error, setError, count: ids.length };
}

export default function WatchPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'sermons';
  const setTab = (t) => setParams(t === 'sermons' ? {} : { tab: t }, { replace: true });
  const [toast, undo] = useUndo();
  const feat = useFeatured();
  const sugg = useSuggested();

  const sermons = useServerList({
    get: getSermons, save: saveSermon, del: deleteSermon, formOf: sermonForm, undo, noun: 'sermon', ready: titled,
    blank: { title: '', speaker: '', date: '', series: '', duration: '', thumbnailUrl: '', videoLink: '', mainVerse: '', notes: '' },
  });
  const blocks = useServerList({
    get: getCustomBlocks, save: saveCustomBlock, del: deleteCustomBlock, formOf: blockForm, undo, noun: 'video', ready: titled,
    blank: { title: '', subtitle: '', videoUrl: '', thumbnail: '', playInContainer: true },
  });
  const resources = useServerList({
    get: getResources, save: saveResource, del: deleteResource, formOf: resourceForm, undo, noun: 'resource', ready: titled,
    blank: { title: '', subtitle: '', type: 'Series', coverUrl: '', link: '' },
  });

  const all = [sermons, blocks, resources];
  useLeaveGuard(all.some((l) => (l.rows.rows || []).some((r) => l.rows.dirty(r) && String(r.title || '').trim())));

  // everything a series can hold, in one list
  const library = useMemo(() => [
    ...(sermons.rows.rows || []).filter((r) => r._saved !== null).map((r) => ({
      id: String(r.id), kind: 'sermon', title: String(r.title || '').trim() || 'Untitled',
      sub: [r.speaker, r.date].filter(Boolean).join(' · '), thumb: r.thumbnailUrl, live: r.published !== false,
    })),
    ...(blocks.rows.rows || []).filter((r) => r._saved !== null).map((r) => ({
      id: String(r.id), kind: 'video', title: String(r.title || '').trim() || 'Untitled',
      sub: r.subtitle || 'Video', thumb: r.thumbnail, live: r.published !== false,
    })),
  ], [sermons.rows.rows, blocks.rows.rows]);

  const actions = tab === 'sermons'
    ? <button type="button" className="ax-btn primary" onClick={() => sermons.add(genId())}><Icon d={P.plus} size={17} />New sermon</button>
    : tab === 'videos'
      ? <button type="button" className="ax-btn primary" onClick={() => blocks.add(genId())}><Icon d={P.plus} size={17} />New video</button>
      : tab === 'resources'
        ? <button type="button" className="ax-btn primary" onClick={() => resources.add(genId())}><Icon d={P.plus} size={17} />New resource</button>
        : null;
  const error = (tab === 'sermons' ? sermons.error : tab === 'videos' ? blocks.error : tab === 'resources' ? resources.error : '') || feat.error || sugg.error;
  const clear = () => {
    feat.setError('');
    sugg.setError('');
    if (tab === 'sermons') sermons.setError('');
    else if (tab === 'videos') blocks.setError('');
    else if (tab === 'resources') resources.setError('');
  };

  return (
    <AppShell title="Watch" subtitle="Everything on the app’s Media tab. Changes save as you type." actions={actions}>
      <div style={{ marginBottom: 28 }}>
        <Seg big label="Show" value={tab} onChange={setTab} options={TABS} />
      </div>
      <Alert onClose={error ? clear : null}>{error}</Alert>

      {tab === 'sermons' && <SermonsView list={sermons} feat={feat} sugg={sugg} />}
      {tab === 'series' && <SeriesView library={library} undo={undo} />}
      {tab === 'videos' && <BlocksView list={blocks} feat={feat} />}
      {tab === 'resources' && <ResourcesView list={resources} />}
      {tab === 'notes' && <NotesView />}
      {toast}
    </AppShell>
  );
}

/* ── the list column, shared by the lists ── */

function ListColumn({ list, count, empty, sub, thumb, tall, search, star }) {
  const rows = list.rows.rows || [];
  const shown = search ? rows.filter(search) : rows;
  return (
    <div className="ax-panel tight">
      <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
        <span className="ax-list-count">{count(rows)}</span>
      </div>
      <RowList rows={shown} picked={list.picked} onPick={list.setPicked}
        empty={<div className="ax-empty">{empty}</div>}
        renderRow={(r) => {
          const pic = thumb(r);
          return (
            <>
              <span className={`ax-thumb${tall ? ' tall' : ''}`} style={pic ? { backgroundImage: cssUrl(pic) } : undefined}>
                {!pic && <Icon d={P.play} size={18} />}
              </span>
              <span className="ax-row-main">
                <span className={`ax-row-title${String(r.title || '').trim() ? '' : ' muted'}`}>{String(r.title || '').trim() || 'Untitled'}</span>
                <span className="ax-row-sub">
                  {r._error ? <span className="ax-row-flag">Not saved</span> : (r._saved === null ? 'Not saved yet' : sub(r))}
                </span>
              </span>
              {star ? star(r) : null}
              <Toggle small checked={r.published !== false} onChange={(on) => list.setLive(r._key, on)}
                title={r.published !== false ? 'Members see it — switch off to hide it' : 'Hidden — switch on to show it'} />
            </>
          );
        }} />
    </div>
  );
}

function EditorFrame({ auto, published, onLive, onDelete, noun, waiting, extra, children }) {
  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting={waiting || `Not saved — give the ${noun} a title`} />
        <Toggle checked={published} onChange={onLive} label="In the app"
          sub={published ? 'Members see it now' : 'Hidden — only you see it'} />
      </div>
      <div className="ax-form">{children}</div>
      {extra ? <div className="ax-editor-extra">{extra}</div> : null}
      <div className="ax-editor-foot">
        <span className="ax-hint">{published ? 'Changes reach phones as you make them.' : 'Switch it on to show it in the app.'}</span>
        <button type="button" className="ax-btn danger" onClick={onDelete}><Icon d={P.trash} size={16} />Delete</button>
      </div>
    </div>
  );
}

const Pick = ({ noun }) => (
  <div className="ax-panel"><div className="ax-empty"><strong>{`Pick a ${noun} to change it`}</strong>or add a new one.</div></div>
);

/* ── sermons ── */

function SermonsView({ list, feat, sugg }) {
  const [q, setQ] = useState('');
  const rows = list.rows.rows;
  if (rows === null) return <Loading>Reaching the app server… (the first load can take up to a minute)</Loading>;
  const needle = q.trim().toLowerCase();
  const current = rows.find((r) => r._key === list.picked) || null;
  return (
    <div className="ax-split wide-list">
      <section className="ax-stack" style={{ gap: 14 }}>
        <input className="ax-input" type="search" value={q} placeholder="Search title, speaker, series…"
          onChange={(e) => setQ(e.target.value)} aria-label="Search sermons" />
        <ListColumn list={list} thumb={(r) => r.thumbnailUrl}
          search={needle ? (r) => [r.title, r.speaker, r.series].some((v) => String(v || '').toLowerCase().includes(needle)) : null}
          star={(r) => <FeaturedSwitch small feat={feat} id={r.id} kind="sermon" saved={r._saved !== null} />}
          count={(all) => `${all.length} sermon${all.length === 1 ? '' : 's'} · ${all.filter((r) => r._saved !== null && r.published !== false).length} in the app`}
          sub={(r) => [r.speaker, r.date].filter(Boolean).join(' · ') || 'No speaker or date yet'}
          empty={needle ? 'No sermons match.' : <><strong>No sermons</strong>Add the first one.</>} />
      </section>
      <section>
        {current ? <SermonEditor key={current._key} row={current} list={list} feat={feat} sugg={sugg} /> : <Pick noun="sermon" />}
      </section>
      <aside className="ax-aside">
        <div className="ax-sticky ax-phone-wrap">
          <div className="ax-phone">
            <div className="ax-phone-title">Media</div>
            {current ? <SermonPreview s={sermonForm(current)} /> : <div className="ax-phone-none">Pick a sermon to see it here</div>}
          </div>
          <p className="ax-phone-cap">The big card at the top of Media is the newest sermon. The star puts one in the Featured row right under it; “Suggested for You” is the row below that.</p>
        </div>
      </aside>
    </div>
  );
}

function SermonEditor({ row, list, feat, sugg }) {
  const key = row._key;
  const f = sermonForm(row);
  const set = (k, v) => list.rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => list.persist(key) });
  return (
    <EditorFrame auto={auto} published={f.published} onLive={(on) => list.setLive(key, on)} onDelete={() => list.remove(key)} noun="sermon"
      extra={(
        <div className="ax-switch-row">
          <FeaturedSwitch feat={feat} id={row.id} kind="sermon" saved={row._saved !== null} />
          <Toggle checked={sugg.has(row.id)} disabled={!sugg.ready || row._saved === null}
            onChange={(on) => sugg.toggle(row.id, on)} label="Suggested for You"
            sub={sugg.has(row.id) ? 'In the row under Featured' : 'Media fills that row on its own'} />
        </div>
      )}>
      <Field label="Title">
        <input className="ax-input title" value={f.title} autoFocus={row._saved === null} placeholder="The sermon’s title"
          onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="ax-row2">
        <Field label="Speaker"><input className="ax-input" value={f.speaker} onChange={(e) => set('speaker', e.target.value)} /></Field>
        <Field label="Date"><input className="ax-input" value={f.date} placeholder="Sep 14, 2026" onChange={(e) => set('date', e.target.value)} /></Field>
      </div>
      <div className="ax-row3">
        <Field label="Series" hint="A word on the card, not a Series row."><input className="ax-input" value={f.series} onChange={(e) => set('series', e.target.value)} /></Field>
        <Field label="Length"><input className="ax-input" value={f.duration} placeholder="42 min" onChange={(e) => set('duration', e.target.value)} /></Field>
        <Field label="Main verse"><input className="ax-input" value={f.mainVerse} placeholder="Book 1:1" onChange={(e) => set('mainVerse', e.target.value)} /></Field>
      </div>
      <Field label="Video">
        <VideoDrop value={f.videoLink} onChange={(u) => set('videoLink', u)}
          onStill={async (blob) => {
            if (list.rows.get(key)?.thumbnailUrl) return;
            try {
              const url = await uploadImage(new File([blob], 'still.jpg', { type: 'image/jpeg' }));
              if (url) list.rows.patch(key, (r) => (r.thumbnailUrl ? {} : { thumbnailUrl: url }));
            } catch { /* the still is a nicety */ }
          }} />
      </Field>
      <Field label="Thumbnail">
        <ImageDrop value={f.thumbnailUrl} onChange={(u) => set('thumbnailUrl', u)} upload={upload} />
      </Field>
      <Field label="Notes" hint="Shown with the sermon in the app.">
        <GrowText value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </EditorFrame>
  );
}

function SermonPreview({ s }) {
  return (
    <div className="ax-cp ax-cp-text" style={{ cursor: 'default', padding: 0, background: '#fff' }}>
      <div className="ax-cp-photo" style={{ borderRadius: 16, aspectRatio: '16 / 9', ...(s.thumbnailUrl ? { backgroundImage: cssUrl(s.thumbnailUrl) } : {}) }}>
        <div className="ax-cp-play">▶</div>
      </div>
      <div style={{ padding: '12px 2px 0' }}>
        {s.series ? <div className="ax-cp-kicker dark">{s.series.toUpperCase()}</div> : null}
        <div className="ax-cp-title dark">{s.title || 'Title'}</div>
        <div className="ax-cp-sub dark">{[s.speaker, s.date, s.duration].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

/* ── series: each one is its own row on Media ── */

function SeriesView({ library, undo }) {
  const rows = useRows(seriesForm);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try { rows.load(await listSeries()); setSetUp(true); }
    catch (e) {
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

  const add = () => {
    const key = rows.add({ name: '', subtitle: '', image_url: '', items: [], published: false, sort: ((list || []).length + 1) * 10 }, { first: true });
    setPicked(key);
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
    try { await persist(key); } catch { rows.patch(key, { published: !on }); }
  };

  const remove = async (key) => {
    const all = list || [];
    const r = rows.get(key);
    if (!r) return;
    const at = all.findIndex((x) => x._key === key);
    const next = all[at + 1] || all[at - 1];
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

  if (list === null) return <Loading />;
  const current = list.find((r) => r._key === picked) || null;

  return (
    <>
      {!setUp && <Alert>{SETUP_HINT}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="ax-split two">
        <section className="ax-stack" style={{ gap: 14 }}>
          <button type="button" className="ax-btn primary" onClick={add} disabled={!setUp}>
            <Icon d={P.plus} size={17} />New series
          </button>
          <div className="ax-panel tight">
            <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
              <span className="ax-list-count">
                {`${list.length} series · ${list.filter((r) => r.published).length} on Media`}
              </span>
            </div>
            <RowList rows={list} picked={picked} onPick={setPicked} onMove={reorder}
              empty={<div className="ax-empty"><strong>No series yet</strong>Make one and it becomes its own row on Media.</div>}
              renderRow={(r) => {
                const f = seriesForm(r);
                return (
                  <>
                    <span className="ax-thumb" style={f.image_url ? { backgroundImage: cssUrl(f.image_url) } : undefined}>
                      {!f.image_url && <Icon d={P.layers} size={18} />}
                    </span>
                    <span className="ax-row-main">
                      <span className={`ax-row-title${f.name.trim() ? '' : ' muted'}`}>{f.name.trim() || 'Untitled series'}</span>
                      <span className="ax-row-sub">
                        {r._error ? <span className="ax-row-flag">Not saved</span>
                          : r._saved === null ? 'Not saved yet'
                            : `${f.items.length} ${f.items.length === 1 ? 'video' : 'videos'}`}
                      </span>
                    </span>
                    <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                      title={f.published ? 'On Media — switch off to hide the row' : 'Hidden — switch on to show the row'} />
                  </>
                );
              }} />
          </div>
        </section>
        <section>
          {current
            ? <SeriesEditor key={current._key} row={current} rows={rows} library={library} persist={persist} setLive={setLive} remove={remove} />
            : <div className="ax-panel"><div className="ax-empty"><strong>Pick a series to change it</strong>or make a new one.</div></div>}
        </section>
      </div>
    </>
  );
}

function SeriesEditor({ row, rows, library, persist, setLive, remove }) {
  const key = row._key;
  const f = seriesForm(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: named(f), save: () => persist(key) });
  const [q, setQ] = useState('');

  const chosen = f.items;
  const inSeries = new Set(chosen.map((i) => i.id));
  const byId = new Map(library.map((x) => [x.id, x]));
  const needle = q.trim().toLowerCase();
  const rest = library.filter((x) => !inSeries.has(x.id) && (!needle || x.title.toLowerCase().includes(needle)));

  const put = (items) => set('items', items);
  const addItem = (x) => put([...chosen, { id: x.id, kind: x.kind }]);
  const dropItem = (id) => put(chosen.filter((i) => i.id !== id));
  const move = (at, by) => {
    const to = at + by;
    if (to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    [next[at], next[to]] = [next[to], next[at]];
    put(next);
  };

  return (
    <EditorFrame auto={auto} published={f.published} onLive={(on) => setLive(key, on)} onDelete={() => remove(key)}
      noun="series" waiting="Not saved — give the series a name">
      <Field label="Name" hint="The row’s title on Media.">
        <input className="ax-input title" value={f.name} autoFocus={row._saved === null} placeholder="A series name"
          maxLength={SERIES_LIMITS.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="Line under it">
        <input className="ax-input" value={f.subtitle} maxLength={SERIES_LIMITS.subtitle}
          onChange={(e) => set('subtitle', e.target.value)} />
      </Field>
      <Field label="Cover" hint="Used when something in the series has no picture of its own.">
        <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={upload} />
      </Field>

      <Field label={`In this series${chosen.length ? ` · ${chosen.length}` : ''}`} hint="They play in this order.">
        {chosen.length === 0 ? (
          <p className="ax-hint">Nothing yet — add a sermon or a video below.</p>
        ) : (
          <div className="ax-list">
            {chosen.map((it, i) => {
              const x = byId.get(it.id);
              return (
                <div key={it.id} className="ax-row static">
                  <span className="ax-num">{i + 1}</span>
                  <span className="ax-thumb" style={x?.thumb ? { backgroundImage: cssUrl(x.thumb) } : undefined}>
                    {!x?.thumb && <Icon d={P.play} size={18} />}
                  </span>
                  <span className="ax-row-main">
                    <span className="ax-row-title">{x ? x.title : 'No longer on Watch'}</span>
                    <span className="ax-row-sub">
                      {!x ? 'It was deleted — take it out' : x.live ? (it.kind === 'video' ? 'Video' : 'Sermon') : 'Hidden in the app'}
                    </span>
                  </span>
                  <span className="ax-row-btns">
                    <button type="button" className="ax-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><Icon d={P.arrowUp} size={15} /></button>
                    <button type="button" className="ax-icon-btn" onClick={() => move(i, 1)} disabled={i === chosen.length - 1} aria-label="Move down"><Icon d={P.arrowDown} size={15} /></button>
                    <button type="button" className="ax-icon-btn danger" onClick={() => dropItem(it.id)} aria-label="Take out"><Icon d={P.close} size={15} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Field>

      <Field label="Add a sermon or video">
        <input className="ax-input" type="search" value={q} placeholder="Search everything on Watch…"
          onChange={(e) => setQ(e.target.value)} aria-label="Search sermons and videos" />
        <div className="ax-list ax-picker">
          {rest.length === 0 ? (
            <div className="ax-empty">{library.length ? 'Nothing else to add.' : 'Add a sermon or a video first.'}</div>
          ) : rest.map((x) => (
            <button key={`${x.kind}:${x.id}`} type="button" className="ax-row pickable" onClick={() => addItem(x)}>
              <span className="ax-thumb" style={x.thumb ? { backgroundImage: cssUrl(x.thumb) } : undefined}>
                {!x.thumb && <Icon d={P.play} size={18} />}
              </span>
              <span className="ax-row-main">
                <span className="ax-row-title">{x.title}</span>
                <span className="ax-row-sub">{x.kind === 'video' ? 'Video' : 'Sermon'}{x.sub ? ` · ${x.sub}` : ''}{x.live ? '' : ' · hidden'}</span>
              </span>
              <span className="ax-add"><Icon d={P.plus} size={16} /></span>
            </button>
          ))}
        </div>
      </Field>
    </EditorFrame>
  );
}

/* ── videos (Watch's own video cards) ── */

function BlocksView({ list, feat }) {
  const rows = list.rows.rows;
  if (rows === null) return <Loading>Reaching the app server…</Loading>;
  const current = rows.find((r) => r._key === list.picked) || null;
  return (
    <div className="ax-split two wide-list">
      <section>
        <ListColumn list={list} thumb={(r) => r.thumbnail}
          star={(r) => <FeaturedSwitch small feat={feat} id={r.id} kind="video" saved={r._saved !== null} />}
          count={(all) => `${all.length} video${all.length === 1 ? '' : 's'} · ${feat.count} featured`}
          sub={(r) => r.subtitle || (r.playInContainer !== false ? 'Plays in the app' : 'Opens outside the app')}
          empty={<><strong>No videos</strong>Add a video to show on Media.</>} />
      </section>
      <section>
        {current ? <BlockEditor key={current._key} row={current} list={list} feat={feat} /> : <Pick noun="video" />}
      </section>
    </div>
  );
}

function BlockEditor({ row, list, feat }) {
  const key = row._key;
  const f = blockForm(row);
  const set = (k, v) => list.rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => list.persist(key) });
  return (
    <EditorFrame auto={auto} published={f.published} onLive={(on) => list.setLive(key, on)} onDelete={() => list.remove(key)} noun="video"
      extra={<FeaturedSwitch feat={feat} id={row.id} kind="video" saved={row._saved !== null} />}>
      <Field label="Title">
        <input className="ax-input title" value={f.title} autoFocus={row._saved === null} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Line under it">
        <input className="ax-input" value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
      </Field>
      <Field label="Video">
        <VideoDrop value={f.videoUrl} onChange={(u) => set('videoUrl', u)}
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
      <Toggle checked={f.playInContainer} onChange={(on) => set('playInContainer', on)} label="Plays inside the app"
        sub={f.playInContainer ? 'In the app’s own player' : 'Opens in the browser or YouTube'} />
    </EditorFrame>
  );
}

/* ── resources ── */

function ResourcesView({ list }) {
  const rows = list.rows.rows;
  if (rows === null) return <Loading>Reaching the app server…</Loading>;
  const current = rows.find((r) => r._key === list.picked) || null;
  return (
    <div className="ax-split two">
      <section>
        <ListColumn list={list} tall thumb={(r) => r.coverUrl}
          count={(all) => `${all.length} resource${all.length === 1 ? '' : 's'}`}
          sub={(r) => [r.type, r.subtitle].filter(Boolean).join(' · ')}
          empty={<><strong>No resources</strong>Add a study guide, series or podcast.</>} />
      </section>
      <section>
        {current ? <ResourceEditor key={current._key} row={current} list={list} /> : <Pick noun="resource" />}
      </section>
    </div>
  );
}

function ResourceEditor({ row, list }) {
  const key = row._key;
  const f = resourceForm(row);
  const set = (k, v) => list.rows.patch(key, { [k]: v });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: titled(f), save: () => list.persist(key) });
  return (
    <EditorFrame auto={auto} published={f.published} onLive={(on) => list.setLive(key, on)} onDelete={() => list.remove(key)} noun="resource">
      <Field label="Title">
        <input className="ax-input title" value={f.title} autoFocus={row._saved === null} onChange={(e) => set('title', e.target.value)} />
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
      <Field label="Cover" hint="Tall, like a book cover (3 by 4).">
        <ImageDrop value={f.coverUrl} onChange={(u) => set('coverUrl', u)} upload={upload} tall />
      </Field>
    </EditorFrame>
  );
}
