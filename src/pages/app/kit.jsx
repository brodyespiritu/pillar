import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { confirmDialog } from '../../lib/dialog';
import {
  uploadVideo, videoStill, videoProblem, videoFacts, tooHeavy, describeVideo,
  formatBytes, isVideoFile, VIDEO_ACCEPT,
} from '../../lib/videoUpload';

// The pieces every App page is built from, so each one works the same way:
//
//   · a list of what's there, where one click picks something and a drag puts it in order
//   · the picked thing's fields, always open beside the list, saved a moment after you stop typing
//   · an on/off switch for "members can see this", right on the row
//   · delete without a dialog — it happens at once, with Undo
//
// Nothing here knows about a particular kind of content; the pages pass that in.

/* ─────────────────────────────── rows ─────────────────────────────── */

/**
 * A page's list as the server has it, plus whatever has been typed since. Each row carries
 *   _key    stays the same for the row's whole life on the page (its id, or a stand-in until saved)
 *   _saved  the form as last saved, as JSON — null while it has never been saved
 *   _error  why its last save failed
 * `formOf(row)` picks the fields an editor changes (and autosaves). It must be a stable function.
 */
export function useRows(formOf) {
  const [rows, setRows] = useState(null);
  // the rows as of the last change, not the last render: a save that starts straight after a
  // change must see it
  const latest = useRef(null);
  const ids = useRef({});
  const seq = useRef(0);

  const api = useMemo(() => {
    const adopt = (r) => ({ ...r, _key: String(r.id), _saved: JSON.stringify(formOf(r)), _error: '' });
    const put = (next) => { latest.current = next; setRows(next); };
    const edit = (fn) => put(fn(latest.current || []));
    return {
      load: (list) => put((list || []).map(adopt)),
      fail: () => put(latest.current || []),
      add(row, { first = false } = {}) {
        const _key = `new-${++seq.current}`;
        const r = { ...row, _key, _saved: null, _error: '' };
        edit((l) => (first ? [r, ...l] : [...l, r]));
        return _key;
      },
      /** Put a deleted row back (Undo), where it was. */
      restore(row, index) {
        const r = adopt(row);
        edit((l) => { const next = [...l]; next.splice(Math.min(index, next.length), 0, r); return next; });
        return r._key;
      },
      patch: (key, p) => edit((l) => l.map((r) => (r._key === key ? { ...r, ...(typeof p === 'function' ? p(r) : p) } : r))),
      remove: (key) => edit((l) => l.filter((r) => r._key !== key)),
      order: (keys) => edit((l) => keys.map((k) => l.find((r) => r._key === k)).filter(Boolean)),
      get: (key) => (latest.current || []).find((r) => r._key === key) || null,
      idOf: (key) => ids.current[key] ?? (latest.current || []).find((r) => r._key === key)?.id ?? null,
      /** A save came back: remember the id at once (the next save must update, not insert), then mark it clean. */
      saved(key, form, server) {
        if (server && server.id != null) ids.current[key] = server.id;
        const extra = server && server.id != null ? { id: server.id } : {};
        edit((l) => l.map((r) => (r._key === key ? { ...r, ...extra, _saved: JSON.stringify(form), _error: '' } : r)));
      },
      failed: (key, message) => edit((l) => l.map((r) => (r._key === key ? { ...r, _error: message } : r))),
      dirty: (r) => r._saved !== JSON.stringify(formOf(r)),
    };
  }, [formOf]);

  return useMemo(() => ({ rows, ...api }), [rows, api]);
}

/**
 * Saves for the same row, one after another — so a switch flipped while the row's first save is
 * still on its way can't make a second copy. `queue(key, task)` → the task's promise.
 */
export function useSaveQueue() {
  const chains = useRef(new Map());
  return useCallback((key, task) => {
    const next = (chains.current.get(key) || Promise.resolve()).catch(() => {}).then(task);
    chains.current.set(key, next);
    return next;
  }, []);
}

/**
 * A list kept on the app server (announcements, sermons, videos, resources): each item carries an
 * id Pillar makes, and one call saves it whether it is new or not. Everything a page needs to pick,
 * add, change, switch on and off, and delete (with Undo).
 */
export function useServerList({ get, save, del, formOf, undo, blank, noun = 'item', ready: readyOf }) {
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const strip = ({ _key, _saved, _error, ...rest }) => rest;

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await get();
      const items = Array.isArray(list) ? list : [];
      rows.load(items);
      setPicked((p) => p ?? (items[0] ? String(items[0].id) : null));
    } catch (e) {
      rows.fail();
      setError(e.message);
    }
  }, [get, rows.load, rows.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = formOf(r);
    try {
      await save({ ...strip(r), ...form });
      rows.saved(key, form, { id: r.id });
    } catch (e) {
      rows.failed(key, e.message);
      throw e;
    }
  }), [queue, rows, save, formOf]);

  const add = (id) => {
    const key = rows.add({ id, ...blank, published: false }, { first: true });
    setPicked(key);
  };

  const setLive = async (key, on) => {
    const r = rows.get(key);
    if (!r) return;
    if (on && !readyOf(formOf(r))) { setError(`Give the ${noun} a title before members can see it.`); return; }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  };

  const remove = async (key) => {
    const list = rows.rows || [];
    const r = rows.get(key);
    if (!r) return;
    const at = list.findIndex((x) => x._key === key);
    const next = list[at + 1] || list[at - 1];
    rows.remove(key);
    setPicked(next ? next._key : null);
    if (r._saved === null) return;   // it never reached the server
    try {
      await queue(key, () => del(r.id));
    } catch (e) {
      rows.restore(strip(r), at);
      setError(e.message);
      return;
    }
    undo(`“${String(r.title || '').trim() || `This ${noun}`}” deleted.`, async () => {
      try {
        const back = { ...strip(r), ...formOf(r) };
        await save(back);
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  };

  return { rows, picked, setPicked, error, setError, persist, add, setLive, remove, load };
}

/** Ask before leaving the page while something hasn't reached the server. */
export function useLeaveGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/* ─────────────────────────────── autosave ─────────────────────────────── */

/**
 * Save `value` a moment after it stops changing — whenever it differs from `savedJson` and is
 * `ready`. Saves never overlap: a change made during one is saved straight after it. Whatever is
 * left is saved when the editor closes. `save(value)` must record success itself (rows.saved).
 * → { status: 'saved' | 'pending' | 'waiting' | 'saving' | 'error', error, flush }
 */
export function useAutosave({ value, savedJson, ready, save, delay = 700 }) {
  const json = JSON.stringify(value);
  const dirty = json !== savedJson;
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const latest = useRef({});
  latest.current = { value, ready, save, dirty };
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef(null);
  const mounted = useRef(true);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    const { value: v, ready: ok, save: fn, dirty: d } = latest.current;
    if (!d || !ok) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    if (mounted.current) { setPhase('saving'); setError(''); }
    try {
      await fn(v);
      if (mounted.current) setPhase('idle');
    } catch (e) {
      if (mounted.current) { setPhase('error'); setError(e?.message || 'Couldn’t save.'); }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; flush(); }
    }
  }, []);

  useEffect(() => {
    if (!dirty || !ready) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    return undefined;
  }, [json, dirty, ready, delay, flush]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flush(); };
  }, [flush]);

  const status = phase === 'saving' ? 'saving'
    : phase === 'error' ? 'error'
    : !dirty ? 'saved'
    : ready ? 'pending' : 'waiting';
  return { status, error, flush };
}

/** "Saved" / "Saving…" / "Not saved — Try again", beside an editor's title. */
export function SaveState({ auto, waiting = 'Not saved yet', saved = 'Saved' }) {
  const { status, error, flush } = auto;
  if (status === 'error') {
    return (
      <span className="ax-save error" role="status">
        <span className="ax-dot" />Not saved: {error} <button type="button" onClick={flush}>Try again</button>
      </span>
    );
  }
  const text = status === 'saving' ? 'Saving…'
    : status === 'pending' ? 'Saving…'
    : status === 'waiting' ? waiting
    : saved;
  return <span className={`ax-save ${status === 'saved' ? 'saved' : ''}`} role="status"><span className="ax-dot" />{text}</span>;
}

/* ─────────────────────────────── fields ─────────────────────────────── */

export function Field({ label, count, max, hint, children, htmlFor }) {
  const near = max && count != null && count > max * 0.9;
  return (
    <div className="ax-field">
      {(label || max) && (
        <label className="ax-label" htmlFor={htmlFor}>
          <span>{label}</span>
          {max ? <span className={`ax-count${near ? ' near' : ''}`}>{count ?? 0}/{max}</span> : null}
        </label>
      )}
      {children}
      {hint ? <p className="ax-hint">{hint}</p> : null}
    </div>
  );
}

/** A box that grows with what's typed in it. */
export function GrowText({ value, onChange, minRows = 4, className = 'ax-textarea', ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 3, minRows * 24 + 30)}px`;
  }, [value, minRows]);
  return <textarea ref={ref} className={className} value={value} onChange={onChange} rows={minRows} {...rest} />;
}

export function Toggle({ checked, onChange, label, sub, disabled, small, live, title }) {
  return (
    <label className={`ax-toggle${small ? ' small' : ''}${live ? ' live' : ''}`} title={title}
      onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        aria-label={typeof label === 'string' ? label : title} />
      <span className="ax-toggle-track" />
      {label ? <span className="ax-toggle-label">{label}{sub ? <small>{sub}</small> : null}</span> : null}
    </label>
  );
}

/** A row of pills; one is on. */
export function Seg({ value, options, onChange, big, label }) {
  return (
    <div className={`ax-seg${big ? ' big' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key}
          className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Choices with a line under each. */
export function Choices({ value, options, onChange, label }) {
  return (
    <div className="ax-choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key}
          className={`ax-choice${value === o.key ? ' on' : ''}`} onClick={() => onChange(o.key)}>
          <strong>{o.label}</strong>
          {o.hint ? <span>{o.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Alert({ children, onClose }) {
  if (!children) return null;
  return (
    <div className="ax-alert" role="alert">
      <span>{children}</span>
      {onClose ? <button type="button" onClick={onClose}>Dismiss</button> : null}
    </div>
  );
}

export function Loading({ children = 'Loading…' }) {
  return <div className="ax-loading"><span className="ax-spinner" />{children}</div>;
}

/* ─────────────────────────────── the list ─────────────────────────────── */

/**
 * Rows you pick with a click and order with a drag (or Alt + ↑/↓). `renderRow(row)` draws the
 * inside; `onMove(keys)` gets the new order. Leave `onMove` out for a list that has no order.
 */
export function RowList({ rows, picked, onPick, onMove, renderRow, empty }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  if (!rows.length) return empty || null;

  const keys = rows.map((r) => r._key);
  const move = (next) => { if (next.join('\n') !== keys.join('\n')) onMove(next); };
  const moveBy = (key, d) => {
    const i = keys.indexOf(key);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    move(next);
  };
  const drop = () => {
    if (drag && over && over.key !== drag) {
      const next = keys.filter((k) => k !== drag);
      let at = next.indexOf(over.key);
      if (over.side === 'below') at += 1;
      next.splice(at, 0, drag);
      move(next);
    }
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="ax-list" role="listbox" aria-label="Items">
      {rows.map((r) => {
        const cls = ['ax-row'];
        if (r._key === picked) cls.push('on');
        if (drag === r._key) cls.push('dragging');
        if (over && over.key === r._key && drag && drag !== r._key) cls.push(over.side === 'above' ? 'drop-above' : 'drop-below');
        const sortable = !!onMove;
        return (
          <div key={r._key} role="option" aria-selected={r._key === picked} tabIndex={0} className={cls.join(' ')}
            onClick={() => onPick(r._key)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r._key); }
              if (sortable && e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveBy(r._key, -1); }
              if (sortable && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveBy(r._key, 1); }
            }}
            draggable={sortable}
            onDragStart={sortable ? (e) => {
              setDrag(r._key);
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', r._key); } catch { /* some browsers */ }
            } : undefined}
            onDragOver={sortable ? (e) => {
              if (!drag) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const side = e.clientY < box.top + box.height / 2 ? 'above' : 'below';
              if (!over || over.key !== r._key || over.side !== side) setOver({ key: r._key, side });
            } : undefined}
            onDrop={sortable ? (e) => { e.preventDefault(); drop(); } : undefined}
            onDragEnd={sortable ? () => { setDrag(null); setOver(null); } : undefined}
            title={sortable ? 'Drag to reorder (or Alt + ↑ / ↓)' : undefined}>
            {sortable ? <span className="ax-grip" aria-hidden="true"><Icon d={P.grip} size={18} /></span> : null}
            {renderRow(r)}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── undo ─────────────────────────────── */

/** "Deleted — Undo" for a few seconds, instead of asking first. */
export function useUndo() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, undo) => {
    clearTimeout(timer.current);
    setToast({ message, undo });
    timer.current = setTimeout(() => setToast(null), 7000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = toast ? (
    <div className="ax-toast" role="status">
      <span>{toast.message}</span>
      {toast.undo ? (
        <button type="button" onClick={() => { const u = toast.undo; setToast(null); u(); }}>Undo</button>
      ) : null}
    </div>
  ) : null;
  return [node, show];
}

export const ask = (message) => confirmDialog({ message });

/* ─────────────────────────────── pictures ─────────────────────────────── */

const fileFrom = (e) => e.dataTransfer?.files?.[0] || null;

/**
 * A picture: drop one on it or choose one; paste a link if it's already online.
 * `upload(file)` → { url } | { error }.
 */
export function ImageDrop({ value, onChange, upload, tall, label = 'Choose a photo', hint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState(false);
  const input = useRef(null);

  async function take(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) { setError('That isn’t a picture — choose a JPG, PNG or WebP.'); return; }
    setBusy(true); setError('');
    let r;
    try { r = await upload(file); } catch (e) { r = { error: e.message }; }
    setBusy(false);
    if (r?.error) setError(r.error);
    else if (r?.url) onChange(r.url);
  }

  return (
    <div className="ax-rows">
      <div className={`ax-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(fileFrom(e)); }}>
        <div className={`ax-drop-preview${tall ? ' tall' : ''}`} style={value ? { backgroundImage: `url("${String(value).replace(/["\\\n]/g, encodeURIComponent)}")` } : undefined}>
          {!value && <Icon d={P.folder} size={20} />}
        </div>
        <div className="ax-drop-text">
          <strong>{value ? 'Drop a new picture to replace it' : 'Drop a picture here'}</strong>
          {hint || 'or choose one from your computer.'}
        </div>
        <div className="ax-inline">
          <button type="button" className="ax-btn sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <><span className="ax-spinner" />Uploading…</> : value ? 'Replace' : label}
          </button>
          {value && !busy ? <button type="button" className="ax-btn quiet sm" onClick={() => onChange('')}>Remove</button> : null}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      </div>
      {paste || (value && !/^https:\/\/[^/]*(supabase\.co|storage\.googleapis\.com)\//.test(value) && !value.startsWith(`${window.location.origin}/`)) ? (
        <input className="ax-input" value={value || ''} inputMode="url" placeholder="https://…"
          onChange={(e) => onChange(e.target.value)} aria-label="Picture address" />
      ) : (
        <button type="button" className="ax-btn quiet sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPaste(true)}>
          Use a picture that’s already online
        </button>
      )}
      {error ? <p className="ax-hint" style={{ color: 'var(--ax-danger)' }}>{error}</p> : null}
    </div>
  );
}

/* ─────────────────────────────── videos ─────────────────────────────── */

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A video: drop or choose a file (it goes to the church's video storage — lib/videoUpload.js), or
 * paste a YouTube, stream or file link. `onStill(blob)` gets a frame from an uploaded file, for a
 * picture. `busyRef.current` is true while a file is on its way up.
 */
export function VideoDrop({ value, onChange, onStill, busyRef, linkHint = 'YouTube, a stream (.m3u8) or a video file.' }) {
  const [up, setUp] = useState(null);      // { name, size, progress, started }
  const [heavy, setHeavy] = useState(null); // a video phones would struggle with, waiting on a yes or no
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef(null);
  const stop = useRef(null);

  useEffect(() => {
    if (busyRef) busyRef.current = !!up;
    if (!up) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', warn); };
  }, [up, busyRef]);
  useEffect(() => () => { stop.current?.abort(); if (busyRef) busyRef.current = false; }, [busyRef]);

  async function take(file) {
    if (!file) return;
    const problem = videoProblem(file);
    if (problem) { setError(problem); return; }
    setError(''); setNote(''); setHeavy(null);
    // a camera or screen recording can be ten times what a phone can pull down — say so before the wait
    const facts = await videoFacts(file);
    if (tooHeavy(facts)) { setHeavy({ file, facts }); return; }
    send(file);
  }

  async function send(file) {
    const ctrl = new AbortController();
    stop.current = ctrl;
    setNow(Date.now());
    setUp({ name: file.name, size: file.size, progress: 0, started: Date.now() });
    const still = onStill ? videoStill(file) : Promise.resolve(null);
    const r = await uploadVideo(file, {
      signal: ctrl.signal,
      onProgress: (p) => setUp((u) => (u ? { ...u, progress: p } : u)),
    });
    stop.current = null;
    setUp(null);
    if (r.error) { if (!r.cancelled) setError(r.error); return; }
    onChange(r.url);
    if (r.unconfirmed) setNote('Uploaded, but Pillar couldn’t double-check it from here — play it below to be sure.');
    const blob = await still;
    if (blob && onStill) onStill(blob);
  }

  async function cancel() {
    if (!(await ask('Stop uploading this video?'))) return;
    stop.current?.abort();
  }

  if (heavy) {
    return (
      <div className="ax-upload">
        <div className="ax-upload-top">
          <span className="ax-upload-name">{heavy.file.name}</span>
          <span className="ax-upload-pct">{formatBytes(heavy.file.size)}</span>
        </div>
        <p className="ax-hint">
          This video is <strong>{describeVideo(heavy.facts)}</strong>. Phones can’t pull that down fast enough, so it
          plays a little, waits, plays a little more. Export it smaller first — in QuickTime Player, File → Export As →
          1080p — and it will play straight through. The picture looks the same on a phone.
        </p>
        <div className="ax-upload-foot">
          <button type="button" className="ax-btn sm" onClick={() => { setHeavy(null); input.current?.click(); }}>
            Choose a smaller export
          </button>
          <button type="button" className="ax-btn sm" onClick={() => { const f = heavy.file; setHeavy(null); send(f); }}>
            Upload it anyway
          </button>
        </div>
        <input ref={input} type="file" accept={VIDEO_ACCEPT} hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      </div>
    );
  }

  if (up) {
    const pct = up.progress == null ? null : Math.round(up.progress * 100);
    return (
      <div className="ax-upload" aria-live="polite">
        <div className="ax-upload-top">
          <span className="ax-upload-name">{up.name}</span>
          <span className="ax-upload-pct">
            {pct == null ? `${formatBytes(up.size)} · ${clock(now - up.started)}` : `${pct}% of ${formatBytes(up.size)}`}
          </span>
        </div>
        <div className={`ax-progress${pct == null ? ' busy' : ''}`} role="progressbar" aria-label="Video upload"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <span style={pct == null ? undefined : { width: `${pct}%` }} />
        </div>
        <div className="ax-upload-foot">
          <span className="ax-hint">
            {pct == null ? 'Uploading — a long video can take several minutes. Keep Pillar open.' : 'Keep Pillar open until it finishes.'}
          </span>
          <button type="button" className="ax-btn sm" onClick={cancel}>Cancel upload</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ax-rows">
      {isVideoFile(value) ? <video key={value} className="ax-video" src={value} controls muted playsInline preload="metadata" /> : null}
      <div className={`ax-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(fileFrom(e)); }}>
        <div className="ax-drop-text">
          <strong>{value ? 'Drop a new video to replace it' : 'Drop a video here'}</strong>
          MP4 or MOV from your computer, up to 2 GB.
        </div>
        <div className="ax-inline">
          <button type="button" className="ax-btn sm" onClick={() => input.current?.click()}>
            {value ? 'Choose another' : 'Choose a video'}
          </button>
          {value ? <button type="button" className="ax-btn quiet sm" onClick={() => { onChange(''); setNote(''); }}>Remove</button> : null}
        </div>
        <input ref={input} type="file" accept={VIDEO_ACCEPT} hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      </div>
      <input className="ax-input" value={value || ''} inputMode="url" placeholder="…or paste a link"
        onChange={(e) => { onChange(e.target.value); setNote(''); }} aria-label="Video link" />
      {note ? <p className="ax-hint">{note}</p> : <p className="ax-hint">{linkHint}</p>}
      {error ? <p className="ax-hint" style={{ color: 'var(--ax-danger)' }}>{error}</p> : null}
    </div>
  );
}
