import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { P, Icon } from '../../lib/icons';

// The App section's workspace (redesign, 2026-09-23 — Pillar-backups/redesign/DESIGN.md §3).
//
// Every page is the same three panes side by side — what's there · the one you're changing · how it
// looks on a phone — filling the window's height, each scrolling on its own, so nothing important
// is ever below the fold (horizontal first). Learn one page and you know them all (Jakob's law).
//
//   const [opened, setOpened] = useState(false);   // a row was clicked (not merely auto-picked)
//   <AppShell title=… fill>
//     <Workspace detail={opened} hasPreview>
//       <ListPane newLabel="New sermon" onNew=… search=… onSearch=… filters=… >…RowList…</ListPane>
//       <EditorPane status={<SaveState …/>} switches={…Toggles…} actions={…Delete…} onSave={auto.flush}
//         onBack={() => setOpened(false)} empty=…>
//         <Cols><ColA title="Words">…</ColA><ColB title="Media">…</ColB></Cols>
//       </EditorPane>
//       <PreviewPane label="On phones"><PhoneFrame dock="watch">…</PhoneFrame></PreviewPane>
//     </Workspace>
//   </AppShell>
//
// `detail` is "the editor is what they're looking at", NOT "something is picked": a list that picks
// its first row by itself would otherwise open every phone straight into the editor. A row click
// sets it (and New), Back (onBack) clears it.
//
// Widths are container queries on the workspace (css/base.css), so they follow the room the sidebar
// leaves rather than the window. The numbers reproduce the approved mockup (1440 × 900, full
// sidebar: a 1164px workspace = list 300 · editor 536 in two columns · phone 300):
//   ≥ 1140   list | editor | phone, all three
//   760–1139 with `hasPreview` the phone slides in as a drawer (the Preview button in the editor's
//            head); without it the phone stays beside the editor (Notifications, Home's Shortcuts)
//   < 760    one pane at a time (Back returns to the list); a phone that isn't a drawer stacks
//            under the editor and the workspace scrolls as one
//
// This file imports only react, ../../lib/icons and ./kit, so a test can load it with the same
// stubs as kit.jsx.

/* ─────────────────────────────── keys ─────────────────────────────── */

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// Pillar's own dialogs, sheets and menus own the keyboard while they're up: confirm dialogs
// (components/Dialogs.jsx), the shared .modal-overlay, MobileNav's sheet, the Settings modal TopNav
// opens over any page (SettingsContext), the document preview, the attendance modal, a remote-control
// consent prompt (ControlContext) and TopNav's open menus
export const MODAL_UP = '.dlg-overlay, .modal-overlay, .mn-scrim, .setm-overlay, .dpv-overlay, .hm-modal-overlay, .ctl-overlay, .tn-backdrop';

/** ⌘ on a Mac (and iPad), Ctrl everywhere else — for hints. */
export const modKey = () => (typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`) ? '⌘' : 'Ctrl ');

/** The name a key press goes by in a useHotkeys map: 'n', '/', '[', 'escape', 'mod+s', 'alt+n'… */
export function comboOf(e) {
  const key = e.key === 'Escape' || e.key === 'Esc' ? 'escape' : String(e.key || '').toLowerCase();
  return `${e.metaKey || e.ctrlKey ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${key}`;
}

/**
 * Keyboard shortcuts for as long as the component is mounted (Tesler's law: the office shouldn't
 * have to reach for the mouse to do the common thing). `map` is { combo: handler } — see comboOf.
 *   · plain keys (n, /, [) are ignored while someone is typing in a field or holding a key down;
 *     mod+ combos and Escape come through from inside a field too (an Escape a field already used —
 *     the search box clearing itself — is left alone)
 *   · while a Pillar dialog, sheet or menu is up (MODAL_UP) NOTHING here runs — not N, not Escape
 *     (the dialog closes itself), not ⌘S — though ⌘S's default is still prevented, so the browser's
 *     own Save Page dialog never opens on an App page
 *   · a handled key's default is prevented (⌘S; "/" isn't typed into the box it focuses), except
 *     Escape's, which other layers may also want
 * Every mounted map that has the key runs it. `enabled` = false switches the whole map off.
 */
export function useHotkeys(map, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.addEventListener) return undefined;
    const onKey = (e) => {
      if (e.isComposing) return;
      const combo = comboOf(e);
      const fn = ref.current ? ref.current[combo] : null;
      if (typeof fn !== 'function') return;
      // an Escape something already used (a search box clearing itself) closes nothing else
      if (combo === 'escape' && e.defaultPrevented) return;
      const plain = !combo.startsWith('mod+') && combo !== 'escape';
      if (plain) {
        if (e.repeat) return;
        const t = e.target;
        if (t && (t.isContentEditable || (typeof t.closest === 'function' && t.closest(TYPING)))) return;
      }
      if (typeof document !== 'undefined' && document.querySelector && document.querySelector(MODAL_UP)) {
        if (combo === 'mod+s' && e.preventDefault) e.preventDefault();
        return;
      }
      if (combo !== 'escape' && e.preventDefault) e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const HINT_WORDS = { n: 'new', '/': 'search', 'mod+s': 'save now', '[': 'menu', escape: 'close' };
const keyCap = (k) => (k === 'mod+s' ? `${modKey()}S` : k === 'escape' ? 'Esc' : k.toUpperCase());

/** "N new · / search · ⌘S save now" — the shortcuts, where the eye already is (hidden on touch screens). */
export function HotkeyHint({ keys = ['n', '/', 'mod+s'], words = {} }) {
  const list = keys.filter(Boolean);
  if (!list.length) return null;
  return (
    <p className="ax-hotkeys">
      {list.map((k) => (
        <span key={k} className="ax-hotkey"><kbd>{keyCap(k)}</kbd>{words[k] || HINT_WORDS[k] || ''}</span>
      ))}
    </p>
  );
}

/* ─────────────────────────────── the workspace ─────────────────────────────── */

// The widths the workspace changes at (css/base.css has the same numbers as container queries).
// WIDE is the approved mockup's own: at 1440 × 900 with the full sidebar the workspace is
// 1440 − 232 − 2 × 22 = 1164px, and all three panes must show there (and on a 1280 laptop with the
// rail, the same 1164). Horizontal first: the phone beside the work, not under it.
export const WIDE = 1140;     // list | editor | phone
export const NARROW = 760;    // below this, one pane at a time
export const COLS = 520;      // an editor this wide splits its fields in two (the mockup's is 536)

const NO_WORK = {
  open: false, setOpen: () => {}, toggle: () => {}, drawer: false, narrow: false,
  detail: false, hasPreview: false, width: null, sub: false, holdSub: () => () => {},
  saves: false, holdSave: () => () => {},
};
const WorkCtx = createContext(NO_WORK);

/**
 * The workspace's state, from anywhere inside it: { open, setOpen, toggle } (the preview drawer —
 * `open` is only ever true while the phone IS a drawer), drawer (the phone is a drawer right now),
 * narrow (one pane at a time), detail, hasPreview, width, sub (a SubPanel is open — the list's N
 * and / wait until it closes) and saves (something here saves on ⌘S, so the hint may offer it).
 */
export const usePreview = () => useContext(WorkCtx);

// a counter any number of parts can hold up while they're mounted: returns [held, hold]
function useHold() {
  const [n, setN] = useState(0);
  const hold = useCallback(() => { setN((c) => c + 1); return () => setN((c) => c - 1); }, []);
  return [n > 0, hold];
}

// where the keyboard was, so closing a drawer or a panel can put it back (not on <body>)
const activeNow = () => (typeof document !== 'undefined' && document.activeElement) || null;
function refocus(el) {
  if (!el || typeof el.focus !== 'function' || el.isConnected === false) return;
  if (typeof document !== 'undefined' && el === document.body) return;
  el.focus({ preventScroll: true });
}

// read a box's width now and whenever it changes (nothing happens where ResizeObserver doesn't exist)
const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;
function useWidth(ref, enabled = true) {
  const [width, setWidth] = useState(null);
  useIsoLayout(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return undefined;
    const read = (w) => { if (w > 0) setWidth(Math.round(w)); };
    if (el.getBoundingClientRect) read(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const box = entries && entries[0] && entries[0].contentRect;
      read(box ? box.width : el.getBoundingClientRect().width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return width;
}

/**
 * div.ax-work — the panes side by side, filling what's left of the page's height (AppShell `fill`).
 * `detail`: the editor is what they're looking at (a row was clicked, or New), so on a narrow screen
 *   it shows instead of the list — see the note at the top of this file.
 * `hasPreview`: under 1140px the PreviewPane becomes a drawer, opened by a Preview button in the
 *   editor's head (Escape, its × or a click beside it closes it). Leave it off and the phone stays
 *   beside the editor down to 760px, then stacks under it.
 * Its panes must be its direct children (fragments are fine) — the layout rules use `>`.
 */
export function Workspace({ detail = false, hasPreview = false, className = '', children }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [want, setOpen] = useState(false);
  const [sub, holdSub] = useHold();
  const [saves, holdSave] = useHold();
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const drawer = !!hasPreview && width != null && width < WIDE;
  const narrow = width != null && width < NARROW;
  // an open drawer is only open while there IS a drawer; widen past 1140 and it closes, so it isn't
  // already open the next time the window narrows
  const open = want && drawer;
  useEffect(() => { if (!drawer) setOpen(false); }, [drawer]);

  useHotkeys({ escape: () => setOpen(false) }, open);

  const value = useMemo(() => ({
    open, setOpen, toggle, drawer, narrow, detail: !!detail, hasPreview: !!hasPreview, width, sub, holdSub, saves, holdSave,
  }), [open, toggle, drawer, narrow, detail, hasPreview, width, sub, holdSub, saves, holdSave]);
  const cls = ['ax-work'];
  if (detail) cls.push('detail');
  if (hasPreview) cls.push('has-preview');
  if (open) cls.push('preview-open');
  if (className) cls.push(className);
  return (
    <WorkCtx.Provider value={value}>
      <div ref={ref} className={cls.join(' ')}>{children}</div>
    </WorkCtx.Provider>
  );
}

/** A plain pane — for workspaces that aren't a list and an editor (Live's control room). */
export function Pane({ label, right, className = '', bodyClassName = '', foot, children, ...rest }) {
  return (
    <section className={`ax-pane${className ? ` ${className}` : ''}`} aria-label={typeof label === 'string' ? label : undefined} {...rest}>
      {label || right ? (
        <div className="ax-pane-head ax-pane-bar">
          {label ? <span className="ax-pane-label">{label}</span> : null}
          {right ? <div className="ax-pane-right">{right}</div> : null}
        </div>
      ) : null}
      <div className={`ax-pane-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
      {foot ? <div className="ax-pane-foot">{foot}</div> : null}
    </section>
  );
}

/* ─────────────────────────────── the list ─────────────────────────────── */

/**
 * A search box: label.ax-search > input.ax-search-input (a click anywhere in it types there). Escape clears what's typed, and so does its
 * × (our own — the browser's search decorations are switched off in CSS so it looks the same in
 * every browser). With nothing typed it shows the key that jumps to it.
 */
export function SearchBox({ value = '', onChange, placeholder = 'Search…', label, inputRef, hint = '/' }) {
  const own = useRef(null);
  const input = inputRef || own;
  const clear = () => {
    onChange('');
    if (input.current && input.current.focus) input.current.focus({ preventScroll: true });
  };
  return (
    <label className="ax-search">
      <Icon d={P.search} size={18} />
      <input ref={input} type="search" className="ax-search-input" value={value} placeholder={placeholder}
        aria-label={label || placeholder.replace(/…$/, '')} autoComplete="off" spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }} />
      {value ? (
        <button type="button" className="ax-search-clear" onClick={clear} aria-label="Clear the search" title="Clear (Esc)">
          <Icon d={P.close} size={16} />
        </button>
      ) : hint ? <kbd className="ax-search-key" aria-hidden="true">{hint}</kbd> : null}
    </label>
  );
}

/** Filter chips, one on: [{ key, label, count }] → div.ax-filters > button.ax-filter(.on). */
export function FilterChips({ filters, value, onChange, label = 'Show' }) {
  if (!filters || !filters.length) return null;
  return (
    <div className="ax-filters" role="radiogroup" aria-label={label}>
      {filters.map((f) => (
        <button key={f.key} type="button" role="radio" aria-checked={value === f.key}
          className={`ax-filter${value === f.key ? ' on' : ''}`} onClick={() => onChange(f.key)}>
          {f.label}{f.count != null ? <span className="ax-filter-n">{f.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * section.ax-pane.ax-list-pane: a head that stays put (the New button — the page's one filled
 * button, Von Restorff — then search, filter chips and a count), the rows scrolling under it, and a
 * foot with the keyboard shortcuts. N makes a new one and / jumps to the search (`hotkeys`={false}
 * turns that off, e.g. when two lists share a page). `newHint` says why New is off (Hick: never a
 * silently dead button). `footer`: leave it out for the shortcut hint, null for none, or your own.
 * The hint only offers what works here: N and / when this list has them, ⌘S when the editor beside
 * it saves on ⌘S (EditorPane / SubPanel `onSave`).
 */
export function ListPane({
  newLabel, onNew, newDisabled = false, newHint, search, onSearch, searchPlaceholder = 'Search…',
  filters, filter, onFilter, count, footer, children, className = '', label, hotkeys = true,
}) {
  const inputRef = useRef(null);
  const { sub, saves } = usePreview();
  const canNew = !!onNew && !newDisabled;
  // N and / belong to the list — not while a sub-panel is making something over the editor
  useHotkeys({
    n: canNew ? () => onNew() : undefined,
    '/': onSearch ? () => inputRef.current && inputRef.current.focus() : undefined,
  }, hotkeys && !sub);
  const hint = [hotkeys && canNew && 'n', hotkeys && onSearch && '/', saves && 'mod+s'].filter(Boolean);
  const foot = footer === undefined ? (hint.length ? <HotkeyHint keys={hint} /> : null) : footer;
  return (
    <section className={`ax-pane ax-list-pane${className ? ` ${className}` : ''}`} aria-label={label || 'List'}>
      <div className="ax-pane-head ax-list-pane-head">
        {onNew ? (
          <button type="button" className="ax-btn primary block ax-new" onClick={() => onNew()} disabled={newDisabled}
            title={newDisabled && newHint ? newHint : undefined}>
            <Icon d={P.plus} size={18} />{newLabel}
          </button>
        ) : null}
        {onNew && newDisabled && newHint ? <p className="ax-hint ax-new-hint">{newHint}</p> : null}
        {/* the "/" key on the box only while "/" works: not while a sub-panel makes something (Hick) */}
        {onSearch ? (
          <SearchBox value={search} onChange={onSearch} placeholder={searchPlaceholder} inputRef={inputRef} hint={hotkeys && !sub ? '/' : null} />
        ) : null}
        <FilterChips filters={filters} value={filter} onChange={(k) => onFilter && onFilter(k)} />
        {count != null && count !== false ? <p className="ax-pane-count">{count}</p> : null}
      </div>
      <div className="ax-pane-body ax-list-pane-body">{children}</div>
      {foot ? <div className="ax-pane-foot">{foot}</div> : null}
    </section>
  );
}

/* ─────────────────────────────── the editor ─────────────────────────────── */

// ⌘/Ctrl+S runs `onSave` while `active`, and tells the workspace a save key exists (for the hint)
function useSaveKey(onSave, active = true) {
  const { holdSave } = usePreview();
  const on = typeof onSave === 'function' && active;
  useHotkeys({ 'mod+s': () => onSave() }, on);
  useEffect(() => (on ? holdSave() : undefined), [on, holdSave]);
}

/**
 * section.ax-pane.ax-editor-pane: a head that stays put while the fields scroll (Fitts's law: the
 * save state, the switches and Delete sit next to what they change, never at the foot of a long
 * form) — Back (narrow screens only), `status` (SaveState), `switches` (the item's Toggles), the
 * Preview button (only while the phone is a drawer), then `actions` (Duplicate, Delete…).
 * `onSave` (e.g. the autosave's flush) runs on ⌘/Ctrl+S — everything saves as you type anyway, so
 * it only saves sooner — and puts ⌘S in the list's shortcut hint.
 * With no children it shows `empty` instead (nothing picked).
 */
export function EditorPane({
  status, switches, actions, onBack, backLabel = 'Back', onSave, children, empty, className = '', label,
}) {
  const { hasPreview, open, toggle } = usePreview();
  const nothing = children == null || children === false;
  useSaveKey(onSave, !nothing);
  if (nothing && empty !== undefined) {
    return (
      <section className={`ax-pane ax-editor-pane is-empty${className ? ` ${className}` : ''}`} aria-label={label || 'Editor'}>
        {onBack ? (
          <div className="ax-pane-head ax-editor-pane-head">
            <button type="button" className="ax-btn quiet sm ax-back" onClick={onBack}><Icon d={P.chevL} size={18} />{backLabel}</button>
          </div>
        ) : null}
        <div className="ax-pane-empty">{empty}</div>
      </section>
    );
  }
  return (
    <section className={`ax-pane ax-editor-pane${className ? ` ${className}` : ''}`} aria-label={label || 'Editor'}>
      <div className="ax-pane-head ax-editor-pane-head">
        {onBack ? (
          <button type="button" className="ax-btn quiet sm ax-back" onClick={onBack}><Icon d={P.chevL} size={18} />{backLabel}</button>
        ) : null}
        {status ? <div className="ax-editor-status">{status}</div> : null}
        <span className="ax-grow" />
        {switches ? <div className="ax-editor-switches">{switches}</div> : null}
        {hasPreview ? (
          // a phone, not a telephone handset — P.phone reads as "call" (Jakob's law)
          <button type="button" className={`ax-btn sm ax-preview-toggle${open ? ' on' : ''}`} onClick={toggle}
            aria-expanded={open} title="See it on a phone">
            <PhoneIcon name="smartphone" size={17} />Preview
          </button>
        ) : null}
        {actions ? <div className="ax-editor-actions">{actions}</div> : null}
      </div>
      <div className="ax-pane-body ax-editor-pane-body">{children}</div>
    </section>
  );
}

/**
 * aside.ax-pane.ax-preview-pane: the phone, in its own column with its own scroll. While the
 * workspace is too narrow for three panes it's a drawer from the right (.open), closed by its ×,
 * by Escape, or by a click beside it. `label` is the small caption over it, `note` a word on what
 * part of the app it shows ("Watch tab"). Opening it puts the keyboard on its ×; closing it puts
 * the keyboard back where it was (the Preview button), never on the page's <body>.
 */
export function PreviewPane({ label = 'On phones', note, children, className = '' }) {
  const { open, setOpen } = usePreview();
  const close = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const from = activeNow();
    if (close.current && close.current.focus) close.current.focus({ preventScroll: true });
    return () => refocus(from);
  }, [open]);
  return (
    <>
      {open ? <div className="ax-drawer-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <aside className={`ax-pane ax-preview-pane${open ? ' open' : ''}${className ? ` ${className}` : ''}`} aria-label={label}>
        <div className="ax-pane-head ax-preview-head">
          <span className="ax-pane-label">{label}</span>
          {note ? <span className="ax-preview-note">{note}</span> : null}
          <button ref={close} type="button" className="ax-headbtn ax-preview-close" onClick={() => setOpen(false)}
            aria-label="Close preview" title="Close preview (Esc)">
            <Icon d={P.close} size={18} />
          </button>
        </div>
        <div className="ax-pane-body ax-preview-body">{children}</div>
      </aside>
    </>
  );
}

/* ─────────────────────────────── inside an editor ─────────────────────────────── */

/**
 * Two columns once the editor is ≥ 520px wide (COLS — the mockup's editor is 536), one below (law
 * of proximity: words on one side, media on the other). Inside a SubPanel, one column until the
 * panel itself is 820px wide.
 */
export function Cols({ children, className = '' }) {
  return <div className={`ax-cols${className ? ` ${className}` : ''}`}>{children}</div>;
}
function Col({ side, title, right, children, className }) {
  return (
    <div className={`ax-col-${side}${className ? ` ${className}` : ''}`}>
      {title || right ? (
        <div className="ax-col-head">
          {title ? <h3 className="ax-col-title">{title}</h3> : null}
          {right ? <span className="ax-col-right">{right}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
export const ColA = (props) => <Col side="a" {...props} />;
export const ColB = (props) => <Col side="b" {...props} />;

/** Fields side by side while they fit (auto-fit, never narrower than `min` px, 220 by default). */
export function Fields({ children, min, className = '' }) {
  return (
    <div className={`ax-fields${className ? ` ${className}` : ''}`} style={min ? { '--ax-field-min': `${min}px` } : undefined}>
      {children}
    </div>
  );
}
/** A field that takes the whole row inside Fields. */
export function Span({ children, className = '' }) {
  return <div className={`ax-span${className ? ` ${className}` : ''}`}>{children}</div>;
}

/**
 * A titled group of fields (common region). `collapsible` folds it away behind its title — for the
 * rarely-used things (Hick's law); `defaultOpen` says how it starts. `right` sits at the title's end.
 */
export function Section({ title, right, collapsible = false, defaultOpen = true, children, className = '' }) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (collapsible) {
    return (
      <details className={`ax-section fold${className ? ` ${className}` : ''}`} open={open}
        onToggle={(e) => setOpen(!!e.currentTarget.open)}>
        <summary className="ax-section-head">
          <span className="ax-section-title">{title}</span>
          {right ? <span className="ax-section-right">{right}</span> : null}
          <span className="ax-section-caret" aria-hidden="true"><Icon d={P.chevron} size={20} /></span>
        </summary>
        <div className="ax-section-body">{children}</div>
      </details>
    );
  }
  return (
    <section className={`ax-section${className ? ` ${className}` : ''}`}>
      {title || right ? (
        <div className="ax-section-head">
          {title ? <h3 className="ax-section-title">{title}</h3> : null}
          {right ? <span className="ax-section-right">{right}</span> : null}
        </div>
      ) : null}
      <div className="ax-section-body">{children}</div>
    </section>
  );
}

// fields a person types in (not switches, choices, file pickers or a search box)
const TYPEABLE = ['text', 'url', 'email', 'tel', 'number', 'date', 'time', 'datetime-local']
  .map((t) => `.ax-subpanel-body input[type="${t}"]:not([disabled])`)
  .concat('.ax-subpanel-body input:not([type]):not([disabled])', '.ax-subpanel-body textarea:not([disabled])')
  .join(', ');

/**
 * A panel that slides over an editor from the right, for making something without leaving it: a
 * new sermon inside its series, a new card inside its group. Its own head carries the title, a line
 * under it (`sub` — what happens to it), its own `status` (SaveState) and Done (its one filled
 * button). Done, Escape or a click beside it all close it — it saves as you go, so closing never
 * loses anything. `onSave` runs on ⌘/Ctrl+S (the sub-item's flush). Render it inside an
 * EditorPane's children.
 *
 * It opens with the keyboard in its first field (the title, when there is one) and gives the
 * keyboard back to whatever opened it (the "New sermon in this series" button) when it closes. It
 * covers only the editor — the list beside it still works — so it is a non-modal dialog (no
 * aria-modal: a screen reader may still reach the list, as a mouse can).
 */
export function SubPanel({ title, sub, status, onDone, onSave, doneLabel = 'Done', children, className = '' }) {
  const panel = useRef(null);
  const { open: previewOpen, holdSub } = usePreview();
  useHotkeys({ escape: () => { if (!previewOpen && onDone) onDone(); } });
  useSaveKey(onSave);
  useEffect(() => holdSub(), [holdSub]);
  // where they'll type: the title if there is one, else the first field (never a switch)
  useEffect(() => {
    const from = activeNow();
    const el = panel.current;
    if (el && el.querySelector) {
      const first = el.querySelector('.ax-subpanel-body .ax-input.title:not([disabled])') || el.querySelector(TYPEABLE);
      if (first && first.focus) first.focus({ preventScroll: true });
    }
    return () => refocus(from);
  }, []);
  return (
    <div className={`ax-subpanel-layer${className ? ` ${className}` : ''}`}>
      <div className="ax-subpanel-scrim" aria-hidden="true" onClick={() => onDone && onDone()} />
      <section ref={panel} className="ax-subpanel" role="dialog" aria-label={typeof title === 'string' ? title : 'Panel'}>
        <div className="ax-subpanel-head">
          <div className="ax-subpanel-titles">
            <h3 className="ax-subpanel-title">{title}</h3>
            {sub ? <p className="ax-subpanel-sub">{sub}</p> : null}
          </div>
          <span className="ax-grow" />
          {status ? <div className="ax-editor-status">{status}</div> : null}
          <button type="button" className="ax-btn primary sm ax-subpanel-done" onClick={() => onDone && onDone()}>{doneLabel}</button>
        </div>
        <div className="ax-subpanel-body">{children}</div>
      </section>
    </div>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

// The member app as a phone shows it (BethesdaApp). Drawn at the phone's own size — 393 × 852
// points, an iPhone 15/16, 59 at the top for the status bar and 34 at the foot for the home bar —
// and scaled down by ONE factor (--ax-phone-scale) so every part keeps its true proportions. Inside,
// css/phone.css has the app's own pieces (fonts, colours, buttons, cards) under .ax-phone-app.
export const PHONE = { w: 393, h: 852, bezel: 12, top: 59, bottom: 34, gutter: 20, dock: 72 };

// The member app's two typefaces — Be Vietnam Pro (headings, labels, buttons, most words) and Geist
// (the dock, the player, live chat) — at the weights the app loads. They're added as one <link> the
// first time an App page opens, not @imported by the CSS: Pillar's CSS is one file for every section,
// and an @import there made every page (the login included) wait on Google Fonts.
export const APP_FONTS = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Geist:wght@400;600;700&display=swap';
const FONTS_ID = 'ax-app-fonts';
/** Adds the app fonts' stylesheet to <head>, once. True when it's there. */
export function loadAppFonts() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.head) return false;
  if (typeof document.getElementById === 'function' && document.getElementById(FONTS_ID)) return true;
  const link = document.createElement('link');
  link.id = FONTS_ID;
  link.rel = 'stylesheet';
  link.href = APP_FONTS;
  document.head.appendChild(link);
  return true;
}
/** loadAppFonts() once this component is on the page (AppShell, PhoneFrame). */
export function useAppFonts() {
  useEffect(() => { loadAppFonts(); }, []);
}

// Feather (the app's @expo/vector-icons set): stroked, 24 grid
const FEATHER = {
  search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  'file-text': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></>,
  'arrow-right': <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  'arrow-up-right': <><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>,
  'chevron-left': <polyline points="15 18 9 12 15 6" />,
  'chevron-right': <polyline points="9 18 15 12 9 6" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'more-horizontal': <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  'map-pin': <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  'external-link': <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  'message-circle': <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  'book-open': <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
  'play-circle': <><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></>,
  'refresh-cw': <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>,
  smartphone: <><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  // the update popup (TESTING): the test kit's label and the card's disc (BethesdaApp components/testkit/UpdatePopup.js)
  tool: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
};

// Material Symbols, filled (the dock's own icons, BethesdaApp components/MenuIcons.js; the play
// triangle from PlayIcon.js; the Directory's person from ConnectIcon.js)
const MATERIAL = {
  home: ['0 -960 960 960', 'M136-200v-358q0-25 11.5-47.5T179-643l238-178q29-21 63-21t63 21l238 178q20 15 31.5 37.5T824-558v358q0 45-30.5 75.5T718-94h-95q-22 0-37.5-15.5T570-147v-200q0-22-15.5-37.5T517-400h-74q-22 0-37.5 15.5T390-347v200q0 22-15.5 37.5T337-94h-95q-45 0-75.5-30.5T136-200Z'],
  watch: ['0 -960 960 960', 'M292-258v-444q0-22.53 16-37.76Q324-755 345.33-755q6.67 0 13.67 2t14 7l350 221q12.5 8 18.75 20t6.25 25.16q0 13.16-6.5 25T723-435L373-214q-7 5-14.22 7-7.22 2-13.78 2-21 0-37-15.24T292-258Z'],
  bible: ['0 -960 960 960', 'm480-214-162 69q-53 23-100.5-8.33Q170-184.67 170-242v-528q0-43.72 31.14-74.86Q232.27-876 276-876h408q43.72 0 74.86 31.14T790-770v528q0 57.33-47.5 88.67Q695-122 642-145l-162-69Z'],
  give: ['24 -721 960 960', 'M340-88v-346h276q12.76 0 21.88 8.5t12.12 21q3 12.5-1 26T631-354l-44 36h-93q-17.33 0-28.67 11.5Q454-295 454-278q0 17.33 11 28.67Q476-238 493-238h85q18.1 0 35.55-6Q631-250 645-261l124-100q23-19 50.5-28.5t53.5-9q26 .5 49 12t38 34.5L693-132q-24 20-52 32.5T582-88H340ZM100.58-48Q78-48 63-63.24 48-78.47 48-101v-280q0-22 15.24-37.5Q78.47-434 101-434h159v333q0 22.53-15.28 37.76Q229.45-48 206.86-48H100.58Z'],
  play: ['0 -960 960 960', 'M311.87-268.46v-423.08q0-19.63 13.67-32.57 13.68-12.93 31.83-12.93 5.72 0 12.05 1.62 6.34 1.62 12.06 5.09l333.17 211.79q10.2 6.71 15.42 17.03 5.21 10.31 5.21 21.51 0 11.2-5.21 21.51-5.22 10.32-15.42 17.03L381.48-229.67q-5.72 3.47-12.06 5.09-6.33 1.62-12.05 1.62-18.15 0-31.83-12.93-13.67-12.94-13.67-32.57Z'],
  person: ['0 -960 960 960', 'M361.14-533.34q-49.27-49.27-49.27-118.86 0-69.58 49.27-118.74 49.27-49.15 118.86-49.15t118.86 49.15q49.27 49.16 49.27 118.74 0 69.59-49.27 118.86-49.27 49.27-118.86 49.27t-118.86-49.27ZM151.87-238.8v-29.61q0-36.23 18.74-66.59 18.74-30.37 49.8-46.35 62.72-31.24 127.67-46.98 64.94-15.74 131.92-15.74 67.43 0 132.39 15.62 64.96 15.62 127.2 46.86 31.06 15.95 49.8 46.25t18.74 66.93v29.61q0 37.78-26.61 64.39t-64.39 26.61H242.87q-37.78 0-64.39-26.61t-26.61-64.39Zm91 0h474.26v-28.42q0-10.77-5.5-19.58-5.5-8.81-14.5-13.7-52.56-26.04-106.85-39.3Q536-353.07 480-353.07q-55.52 0-110.28 13.27-54.76 13.26-106.85 39.3-9 4.89-14.5 13.7-5.5 8.81-5.5 19.58v28.42Zm291.6-358.92q22.66-22.65 22.66-54.47 0-31.81-22.65-54.35-22.66-22.55-54.47-22.55t-54.48 22.55q-22.66 22.54-22.66 54.35 0 31.82 22.65 54.47 22.66 22.65 54.47 22.65t54.48-22.65ZM480-652.2Zm0 413.4Z'],
};

/** An icon the way the member app draws it: Feather names (stroked) or the app's own filled Material marks (home, watch, bible, give, play, person). */
export function PhoneIcon({ name, size = 20, stroke = 2, className = '' }) {
  const m = MATERIAL[name];
  if (m) {
    return (
      <svg className={`ax-pa-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox={m[0]} aria-hidden="true">
        <path d={m[1]} fill="currentColor" />
      </svg>
    );
  }
  const f = FEATHER[name];
  if (!f) return null;
  return (
    <svg className={`ax-pa-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {f}
    </svg>
  );
}

// the app's dock: Home, Watch, Bible, Give in a black glass pill, and the round More beside it
// (BethesdaApp App.js FloatingTabBar — the same black glass in light and dark)
const DOCK_TABS = [['home', 'Home'], ['watch', 'Watch'], ['bible', 'Bible'], ['give', 'Give']];

/** The member app's floating dock. `active`: 'home' | 'watch' | 'bible' | 'give' | 'more' (a page behind More). */
export function PhoneDock({ active }) {
  return (
    <div className="ax-pa-dockbar" aria-hidden="true">
      <div className="ax-pa-dock ax-pa-glass">
        {DOCK_TABS.map(([key, word]) => (
          <span key={key} className={`ax-pa-dock-tab${active === key ? ' on' : ''}`}>
            <PhoneIcon name={key} size={21} />
            {active === key ? <span className="ax-pa-dock-dot"><i /></span> : <span className="ax-pa-dock-word">{word}</span>}
          </span>
        ))}
      </div>
      <span className={`ax-pa-dock-more ax-pa-glass${active === 'more' ? ' on' : ''}`}>
        <PhoneIcon name="more-horizontal" size={24} />
      </span>
    </div>
  );
}

function PhoneStatus({ tone }) {
  return (
    <div className={`ax-pa-status ${tone === 'light' ? 'light' : 'dark'}`} aria-hidden="true">
      <span className="ax-pa-time">9:41</span>
      <span className="ax-pa-island" />
      <span className="ax-pa-sys">
        <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3.2" height="4" rx="1" /><rect x="4.8" y="5.5" width="3.2" height="6.5" rx="1" /><rect x="9.6" y="3" width="3.2" height="9" rx="1" /><rect x="14.4" y="0" width="3.2" height="12" rx="1" /></svg>
        <svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.4c2.4 0 4.6.9 6.3 2.5l1.2-1.2A10.6 10.6 0 0 0 8.5.7 10.6 10.6 0 0 0 1 3.7l1.2 1.2a9 9 0 0 1 6.3-2.5Zm0 3.4c1.5 0 2.9.6 4 1.6l1.2-1.2a7.4 7.4 0 0 0-10.4 0l1.2 1.2a5.7 5.7 0 0 1 4-1.6Zm0 3.4c.6 0 1.2.2 1.6.6L8.5 11.4 6.9 9.8c.4-.4 1-.6 1.6-.6Z" /></svg>
        <svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="20" height="9" rx="2.4" /><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" opacity="0.45" /></svg>
      </span>
    </div>
  );
}

/**
 * A phone: the member app's screen at its true size, scaled as one piece to fit where it's put.
 *   children   what's on the screen, drawn with css/phone.css (.ax-pa-*); it scrolls inside the screen
 *   dock       draw the app's dock: 'home' | 'watch' | 'bible' | 'give' | 'more' (true = none picked)
 *   statusBar  'dark' ink (a white page) or 'light' (over a photo)
 *   profile    the floating profile button, top right (every screen has it); back = the glass Back, top left
 *   scale      a fixed scale; otherwise it fits the width it's given (never taller than the window
 *              allows — --ax-phone-chrome on a parent reserves the room around it)
 *   height     the screen's height in points (852 = a whole iPhone screen)
 *   overlay    drawn over the whole screen, dock included (a sheet, the Update needed card) — under
 *              the status bar, and it doesn't scroll with the page
 *   scrollRef  a ref to the screen's scroller, to bring the picked piece into view
 * → div.ax-phone-frame > div.ax-phone-device > div.ax-phone-screen.ax-phone-app > div.ax-phone-scroll
 */
export function PhoneFrame({
  children, dock, className = '', statusBar = 'dark', profile = true, back = false, scale, height = PHONE.h,
  screenClassName = '', label, scrollRef, overlay,
}) {
  const ref = useRef(null);
  useAppFonts();
  const fixed = typeof scale === 'number' && scale > 0;
  const width = useWidth(ref, !fixed);
  const frameW = PHONE.w + PHONE.bezel * 2;
  const frameH = height + PHONE.bezel * 2;
  const s = fixed ? scale : width ? Math.round((width / frameW) * 10000) / 10000 : null;
  const style = {
    '--ax-phone-h': `${height}px`,
    '--ax-phone-ratio': (frameW / frameH).toFixed(4),
  };
  if (s != null) style['--ax-phone-scale'] = s;
  return (
    <div ref={ref} className={`ax-phone-frame${fixed ? ' fixed' : ''}${className ? ` ${className}` : ''}`} style={style}
      role="group" aria-label={label || 'How it looks on a phone'}>
      <div className="ax-phone-device">
        <div className={`ax-phone-screen ax-phone-app${screenClassName ? ` ${screenClassName}` : ''}`}>
          <div ref={scrollRef} className="ax-phone-scroll">{children}</div>
          <PhoneStatus tone={statusBar} />
          {back ? <span className="ax-pa-glassbtn ax-pa-back ax-pa-glass" aria-hidden="true"><PhoneIcon name="chevron-left" size={24} /></span> : null}
          {profile ? <span className="ax-pa-glassbtn ax-pa-profile ax-pa-glass" aria-hidden="true"><PhoneIcon name="user" size={18} /></span> : null}
          {dock ? <PhoneDock active={dock === true ? null : dock} /> : null}
          {overlay ? <div className="ax-phone-overlay">{overlay}</div> : null}
          <span className="ax-pa-homebar" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
