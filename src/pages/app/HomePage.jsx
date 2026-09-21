import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  listCards, saveCard, setCardSort, deleteCard, uploadCardImage,
  cardProblems, draftProblems, hasCardContent, liveLabel, isLive,
  KINDS, BUILT_IN, ACTIONS, PAGES, LIMITS,
} from '../../lib/homeCards';
import { listTiles, saveTile, tileProblems, uploadTileImage, SLOTS, TILE_LIMITS } from '../../lib/homeTiles';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo, ask,
  SaveState, Field, GrowText, Toggle, Seg, Choices, Alert, Loading, RowList, ImageDrop, VideoDrop,
} from './kit';

// App → Home: the cards under the four boxes on the app's Home page. Pick a card and change it —
// it saves as you type; flip its switch to put it on phones or take it off; drag to reorder. The
// phone on the right is Home as a member (or a visitor) sees it right now.

const AUDIENCE = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'signed_in', label: 'Members' },
  { key: 'signed_out', label: 'Visitors' },
];
const KIND_ICON = { image: P.folder, video: P.play, text: P.doc, dinner: P.meal, welcome: P.home };

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

// the four boxes: only what the office changed; blank means the app's own words
const tileForm = (r) => ({ title: r.title || '', subtitle: r.subtitle || '', image_url: r.image_url || '' });
const tileOf = (slot) => SLOTS.find((s) => s.slot === slot);

const nameOf = (r) => (BUILT_IN.has(r.kind) ? KINDS.find((k) => k.key === r.kind)?.label : String(r.title || '').trim());
const kindLabel = (k) => KINDS.find((x) => x.key === k)?.label || 'Card';
const audienceLabel = (a) => AUDIENCE.find((x) => x.key === a)?.label || 'Everyone';
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")`;

export default function HomePage() {
  const rows = useRows(formOf);
  const tiles = useRows(tileForm);
  const queue = useSaveQueue();
  const [view, setView] = useState('cards');
  const [picked, setPicked] = useState(null);
  const [box, setBox] = useState('post');
  const [tilesReady, setTilesReady] = useState(true);
  const [as, setAs] = useState('signed_in');
  const [error, setError] = useState('');
  const [toast, undo] = useUndo();
  const uploading = useRef(false);

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
      // no table yet: the boxes still say what the app says, they just can't be changed
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

  const list = rows.rows || [];
  const boxes = tiles.rows || [];
  useLeaveGuard(list.some((r) => rows.dirty(r) && hasCardContent(formOf(r))));

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

  async function pick(key) {
    if (key === picked) return;
    if (uploading.current && !(await ask('A video is still uploading. Stop it and open another card?'))) return;
    setPicked(key);
  }

  function add() {
    const last = list.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0);
    const key = rows.add({ kind: 'image', audience: 'everyone', buttons: [], published: false, sort: last + 10 });
    setPicked(key);
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
    if (!r) return;
    const at = list.findIndex((x) => x._key === key);
    const next = list[at + 1] || list[at - 1];
    const id = rows.idOf(key);
    rows.remove(key);
    setPicked(next ? next._key : null);
    if (!id) return;
    try {
      await queue(key, () => deleteCard(id));
    } catch (e) {
      rows.restore({ ...r, id }, at);
      setError(e.message);
      return;
    }
    undo(`“${nameOf(r) || 'Card'}” deleted.`, async () => {
      try {
        const back = await saveCard({ ...formOf(r), sort: r.sort });
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  const liveCount = list.filter((r) => r.id && isLive(r)).length;
  const current = list.find((r) => r._key === picked) || null;

  return (
    <AppShell
      title="Home"
      subtitle="The cards under the four boxes on the app’s Home page. Changes save as you type."
      actions={view === 'cards'
        ? <button type="button" className="ax-btn primary" onClick={add}><Icon d={P.plus} size={17} />New card</button>
        : null}
    >
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      <div style={{ marginBottom: 28 }}>
        <Seg big label="Show" value={view} onChange={setView} options={[
          { key: 'cards', label: `Cards · ${list.length}` },
          { key: 'boxes', label: 'Four boxes' },
        ]} />
      </div>

      {view === 'boxes' ? (
        <div className="ax-split">
          <section>
            <div className="ax-panel tight">
              <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
                <span className="ax-list-count">The four boxes under the search</span>
              </div>
              <RowList rows={boxes} picked={box} onPick={setBox} empty={<Loading />}
                renderRow={(r) => {
                  const d = tileOf(r._key);
                  const f = tileForm(r);
                  return (
                    <>
                      <span className="ax-thumb" style={f.image_url ? { backgroundImage: cssUrl(f.image_url) } : undefined}>
                        {!f.image_url && <Icon d={P.grid} size={18} />}
                      </span>
                      <span className="ax-row-main">
                        <span className="ax-row-title">{f.title || d.title}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : (f.title || f.subtitle || f.image_url) ? 'Your words' : 'The app’s own words'}
                        </span>
                      </span>
                    </>
                  );
                }} />
            </div>
            <p className="ax-hint" style={{ margin: '14px 8px 0' }}>
              What each box opens never changes — only what it says and shows.
            </p>
          </section>

          <section>
            {boxes.find((r) => r._key === box)
              ? <BoxEditor key={box} row={boxes.find((r) => r._key === box)} rows={tiles}
                  persist={persistTile} disabled={!tilesReady} />
              : <div className="ax-panel"><Loading /></div>}
          </section>

          <aside className="ax-aside">
            <div className="ax-sticky">
              <HomePhone rows={list} picked={picked} onPick={pick} as={as} setAs={setAs}
                tiles={boxes} box={box} onPickBox={setBox} />
            </div>
          </aside>
        </div>
      ) : rows.rows === null ? <Loading /> : (
        <div className="ax-split">
          <section>
            <div className="ax-panel tight">
              <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
                <span className="ax-list-count">
                  {list.length} card{list.length === 1 ? '' : 's'} · {liveCount} on phones
                </span>
              </div>
              <RowList
                rows={list}
                picked={picked}
                onPick={pick}
                onMove={reorder}
                empty={<div className="ax-empty"><strong>No cards</strong>Home shows nothing under the four boxes.</div>}
                renderRow={(r) => {
                  const f = formOf(r);
                  const pic = (f.kind === 'image' || f.kind === 'video') && f.image_url;
                  const state = !r.id ? 'Not saved yet' : liveLabel(r) === 'Live' || !f.published ? '' : liveLabel(r);
                  return (
                    <>
                      <span className="ax-thumb" style={pic ? { backgroundImage: cssUrl(pic) } : undefined}>
                        {!pic && <Icon d={KIND_ICON[f.kind] || P.doc} size={19} />}
                      </span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${nameOf(r) ? '' : ' muted'}`}>{nameOf(r) || 'New card'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [kindLabel(f.kind), audienceLabel(f.audience), state].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                        title={f.published ? 'On phones — switch off to take it down' : 'Off phones — switch on to show it'} />
                    </>
                  );
                }}
              />
            </div>
            <p className="ax-hint" style={{ margin: '14px 8px 0' }}>
              Drag a card to change the order. The switch puts it on phones or takes it off.
            </p>
          </section>

          <section>
            {current ? (
              <CardEditor key={current._key} row={current} rows={rows} persist={persist}
                isNew={!current.id && current._saved === null} uploading={uploading}
                onLive={(on) => setLive(current._key, on)} onDelete={() => remove(current._key)} />
            ) : (
              <div className="ax-panel">
                <div className="ax-empty">
                  <strong>Pick a card to change it</strong>
                  or start a new one with <em>New card</em>.
                </div>
              </div>
            )}
          </section>

          <aside className="ax-aside">
            <div className="ax-sticky">
              <HomePhone rows={list} picked={picked} onPick={pick} as={as} setAs={setAs} tiles={boxes} />
            </div>
          </aside>
        </div>
      )}
      {toast}
    </AppShell>
  );
}

/* ─────────────────────────────── the editor ─────────────────────────────── */

function CardEditor({ row, rows, persist, isNew, uploading, onLive, onDelete }) {
  const key = row._key;
  const f = formOf(row);
  const builtIn = BUILT_IN.has(f.kind);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const setButtons = (fn) => rows.patch(key, (r) => ({ buttons: fn(formOf(r).buttons) }));

  const blockers = draftProblems(f);
  const empty = !hasCardContent(f);
  // a card on phones stays as it is until it's whole again
  const onPhones = f.published ? cardProblems(f) : [];
  const ready = !empty && blockers.length === 0 && onPhones.length === 0;
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });
  const why = empty ? 'Type something to save this card' : (blockers[0] || onPhones[0] || '');
  const publishable = cardProblems(f);

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting={why ? `Not saved — ${why}` : 'Not saved yet'} />
        <Toggle checked={f.published} onChange={onLive} label="On phones"
          sub={f.published ? (liveLabel(row) === 'Live' ? 'Members see it now' : liveLabel(row)) : 'A draft — only you see it'} />
      </div>

      <div className="ax-form">
        <Field label="Kind of card">
          <Choices label="Kind of card" value={f.kind} options={KINDS} onChange={(k) => set('kind', k)} />
        </Field>

        <Field label="Who sees it">
          <Seg label="Who sees it" value={f.audience} options={AUDIENCE} onChange={(a) => set('audience', a)} />
        </Field>

        {builtIn ? (
          <div className="ax-note">
            <Icon d={KIND_ICON[f.kind]} size={18} />
            <span>This is one of the app’s own cards — its words and picture are built in, so there is nothing to write.
              Choose who sees it and when.</span>
          </div>
        ) : (
          <>
            <Field label="Title" count={f.title.length} max={LIMITS.title}>
              <input className="ax-input title" value={f.title} maxLength={LIMITS.title} autoFocus={isNew}
                placeholder="What the card is about" onChange={(e) => set('title', e.target.value)} />
            </Field>

            <div className="ax-row2">
              <Field label="Small line above it" count={f.kicker.length} max={LIMITS.kicker}>
                <input className="ax-input" value={f.kicker} maxLength={LIMITS.kicker} placeholder="THIS SUNDAY"
                  onChange={(e) => set('kicker', e.target.value)} />
              </Field>
              <Field label="Line under it" count={f.subtitle.length} max={LIMITS.subtitle}>
                <input className="ax-input" value={f.subtitle} maxLength={LIMITS.subtitle} placeholder="One short line"
                  onChange={(e) => set('subtitle', e.target.value)} />
              </Field>
            </div>

            {f.kind === 'text' && (
              <Field label="Paragraph" count={f.body.length} max={LIMITS.body}>
                <GrowText value={f.body} maxLength={LIMITS.body} onChange={(e) => set('body', e.target.value)} />
              </Field>
            )}

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

            <Field label="Buttons" hint="Up to two. A link has to start with https:// — the app opens nothing else.">
              <div className="ax-rows">
                {f.buttons.map((b, i) => (
                  <div key={i} className="ax-subrow">
                    <input className="ax-input" value={b.label} maxLength={LIMITS.label} placeholder="Label"
                      aria-label={`Button ${i + 1} label`}
                      onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <select className="ax-select" value={b.action} aria-label={`Button ${i + 1} does`}
                      onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, action: e.target.value, target: '' } : x)))}>
                      {ACTIONS.filter((a) => a.key !== 'video' || f.kind === 'video' || b.action === 'video')
                        .map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                    {b.action === 'url' && (
                      <input className="ax-input" value={b.target} inputMode="url" placeholder="https://"
                        aria-label={`Button ${i + 1} link`}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                    )}
                    {b.action === 'page' && (
                      <select className="ax-select" value={b.target} aria-label={`Button ${i + 1} page`}
                        onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                        <option value="">Choose a page…</option>
                        {PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    )}
                    <button type="button" className="ax-iconbtn danger" title="Remove this button"
                      onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}>
                      <Icon d={P.close} size={18} />
                    </button>
                  </div>
                ))}
                {f.buttons.length < LIMITS.buttons && (
                  <button type="button" className="ax-btn sm" style={{ alignSelf: 'flex-start' }}
                    onClick={() => setButtons((bs) => [...bs, { label: '', action: 'url', target: '' }])}>
                    <Icon d={P.plus} size={15} />Add a button
                  </button>
                )}
              </div>
            </Field>
          </>
        )}

        <Field label="When it shows" hint="Leave both empty to keep it up until you switch it off.">
          <div className="ax-row2">
            <input className="ax-input" type="date" value={f.starts_on} aria-label="Show from"
              onChange={(e) => set('starts_on', e.target.value)} />
            <input className="ax-input" type="date" value={f.ends_on} aria-label="Show until"
              onChange={(e) => set('ends_on', e.target.value)} />
          </div>
        </Field>
      </div>

      <div className="ax-editor-foot">
        <span className="ax-hint">
          {f.published ? 'Changes reach phones as you make them.'
            : publishable.length ? `Before it can go on phones: ${publishable[0]}` : 'Ready — switch it on to show it.'}
        </span>
        <button type="button" className="ax-btn danger" onClick={onDelete}>
          <Icon d={P.trash} size={16} />Delete card
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── one of the four boxes ─────────────────────────────── */

function BoxEditor({ row, rows, persist, disabled }) {
  const slot = row._key;
  const d = tileOf(slot);
  const f = tileForm(row);
  const set = (k, v) => rows.patch(slot, { [k]: v });
  const problems = tileProblems({ slot, ...f });
  const auto = useAutosave({ value: f, savedJson: row._saved, ready: !disabled && problems.length === 0, save: () => persist(slot) });
  const mine = !!(f.title || f.subtitle || f.image_url);

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <div>
          <div className="ax-panel-title">{d.name}</div>
          <p className="ax-panel-sub">{d.opens}</p>
        </div>
        {disabled ? null : <SaveState auto={auto} waiting={problems[0] || 'Not saved yet'} />}
      </div>

      {disabled ? (
        <div className="ax-note" style={{ marginBottom: 24 }}>
          <Icon d={P.settings} size={18} />
          <span>These boxes can’t be changed yet — run <strong>supabase/app-home-tiles.sql</strong> in Supabase, then reload.</span>
        </div>
      ) : null}

      <div className="ax-form">
        <Field label="Word on the box" count={f.title.length} max={TILE_LIMITS.title}
          hint={`Leave it empty for the app’s own word: “${d.title}”.`}>
          <input className="ax-input title" value={f.title} maxLength={TILE_LIMITS.title} placeholder={d.title}
            disabled={disabled} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Line under it" count={f.subtitle.length} max={TILE_LIMITS.subtitle}
          hint={`Leave it empty for: “${d.subtitle}”.`}>
          <input className="ax-input" value={f.subtitle} maxLength={TILE_LIMITS.subtitle} placeholder={d.subtitle}
            disabled={disabled} onChange={(e) => set('subtitle', e.target.value)} />
        </Field>
        <Field label="Picture"
          hint={d.photo || 'With a picture the box becomes a photo box, with the words over it.'}>
          <ImageDrop value={f.image_url} onChange={(u) => set('image_url', u)} upload={uploadTileImage} />
        </Field>
      </div>

      <div className="ax-editor-foot">
        <span className="ax-hint">{mine ? 'Members see your words.' : 'This box says what the app says.'}</span>
        <button type="button" className="ax-btn quiet" disabled={disabled || !mine}
          onClick={() => rows.patch(slot, { title: '', subtitle: '', image_url: '' })}>
          Use the app’s own words
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

function HomePhone({ rows, picked, onPick, as, setAs, tiles, box, onPickBox }) {
  const strip = useRef(null);
  const shows = (r) => r.audience === 'everyone' || r.audience === as;
  // what that person sees now — plus the card being changed, marked, if they wouldn't see it
  const cards = rows.filter((r) => (r.id && isLive(r) && shows(r)) || r._key === picked);

  useEffect(() => {
    const row = strip.current;
    const el = row?.querySelector('[data-picked="true"]');
    if (row && el) row.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' });
  }, [picked, cards.length]);

  const live = cards.filter((r) => r._key !== picked || (r.id && isLive(r) && shows(r))).length;
  return (
    <div className="ax-phone-wrap">
      <Seg label="Look as" value={as} onChange={setAs}
        options={[{ key: 'signed_in', label: 'As a member' }, { key: 'signed_out', label: 'As a visitor' }]} />
      <div className="ax-phone">
        <div className="ax-phone-boxes">
          {SLOTS.map((s) => {
            const own = tileForm((tiles || []).find((r) => r._key === s.slot) || {});
            const dark = !!own.image_url || s.slot === 'post';   // a picture box carries its words in white
            const props = onPickBox
              ? { role: 'button', tabIndex: 0, onClick: () => onPickBox(s.slot), onKeyDown: (e) => { if (e.key === 'Enter') onPickBox(s.slot); } }
              : {};
            return (
              <div key={s.slot} {...props}
                className={`ax-phone-box${dark ? ' dark' : ''}${box === s.slot ? ' picked' : ''}`}
                // the words sit on the picture, so the picture carries the app's own dark wash
                style={own.image_url ? { backgroundImage: `linear-gradient(to top, rgba(8, 11, 16, 0.85), rgba(8, 11, 16, 0.15)), ${cssUrl(own.image_url)}` } : undefined}>
                <span>{own.title || s.title}</span>
                <small>{own.subtitle || s.subtitle}</small>
              </div>
            );
          })}
        </div>
        {cards.length === 0 ? (
          <div className="ax-phone-none">Nothing under the boxes</div>
        ) : (
          <div ref={strip} className={cards.length > 1 ? 'ax-phone-row' : ''}>
            {cards.map((r) => {
              const hidden = !(r.id && isLive(r) && shows(r));
              return (
                <div key={r._key} data-picked={r._key === picked}>
                  <CardPreview card={formOf(r)} picked={r._key === picked}
                    badge={hidden ? (!shows(r) ? `NOT FOR ${as === 'signed_in' ? 'MEMBERS' : 'VISITORS'}` : 'NOT ON PHONES') : null}
                    onClick={() => onPick(r._key)} />
                </div>
              );
            })}
          </div>
        )}
        {cards.length > 1 && <div className="ax-phone-hint">Swipe for all {cards.length}</div>}
      </div>
      <p className="ax-phone-cap">
        {live} card{live === 1 ? '' : 's'} on {as === 'signed_in' ? 'members’' : 'visitors’'} phones right now. Click a card to change it.
      </p>
    </div>
  );
}

/** One card, drawn the way the app draws it (BethesdaApp components/HomeCards.js). */
export function CardPreview({ card, picked, badge, onClick }) {
  const c = card;
  const cls = `ax-cp${picked ? ' picked' : ''}`;
  const flag = badge ? <span className="ax-cp-draft">{badge}</span> : null;
  const press = onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter') onClick(); } } : {};
  if (BUILT_IN.has(c.kind)) {
    return (
      <div className={`${cls} ax-cp-photo ax-cp-builtin`} {...press}>
        {flag}
        <div className="ax-cp-foot">
          {c.kind === 'dinner' && <div className="ax-cp-kicker">WEDNESDAY NIGHT</div>}
          <div className="ax-cp-title">{c.kind === 'dinner' ? 'Reserve a plate' : 'Welcome to the new Bethesda App'}</div>
          <div className="ax-cp-note">The app’s own card</div>
        </div>
      </div>
    );
  }
  const buttons = (c.buttons || []).filter((b) => String(b.label || '').trim());
  if (c.kind === 'image' || c.kind === 'video') {
    return (
      <div className={`${cls} ax-cp-photo${c.kind === 'video' ? ' ax-cp-video' : ''}`}
        style={c.image_url ? { backgroundImage: cssUrl(c.image_url) } : undefined} {...press}>
        {flag}
        <div className="ax-cp-shade" />
        {c.kind === 'video' && <div className="ax-cp-play corner">▶</div>}
        <div className="ax-cp-foot">
          {c.kicker && <div className="ax-cp-kicker">{c.kicker.toUpperCase()}</div>}
          <div className="ax-cp-title">{c.title || 'Title'}</div>
          {c.subtitle && <div className="ax-cp-sub">{c.subtitle}</div>}
          {buttons.length > 0 && (
            <div className="ax-cp-btns">{buttons.map((b, i) => <span key={i} className="ax-cp-btn light">{b.label}</span>)}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`${cls} ax-cp-text`} {...press}>
      {flag}
      {c.kicker && <div className="ax-cp-kicker dark">{c.kicker.toUpperCase()}</div>}
      <div className="ax-cp-title dark">{c.title || 'Title'}</div>
      {c.subtitle && <div className="ax-cp-sub dark">{c.subtitle}</div>}
      {c.body && <div className="ax-cp-body">{c.body}</div>}
      {buttons.length > 0 && (
        <div className="ax-cp-btns">{buttons.map((b, i) => <span key={i} className="ax-cp-btn">{b.label}</span>)}</div>
      )}
    </div>
  );
}
