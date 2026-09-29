import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  TITLE_MAX, TEXT_MAX, htmlToDoc, docToHtml, textToDoc, tidy, docLength, docEmpty, docSummary,
  fetchPopups, postPopup, editPopup, takeDownPopup, restorePopup,
} from '../../lib/testPopups';
import { Field, Alert, Loading, useLeaveGuard, useUndo } from './kit';
import { Workspace, EditorPane, PreviewPane, PhoneFrame, PhoneIcon, Cols, ColA, ColB, useHotkeys, modKey } from './layout';
import { AppHome } from './SettingsPage';

// ── TESTING · goes when the app's test kit does ───────────────────────────────
//
// App → Notifications → Update popup (user, 2026-09-24: "allow me to post a popup card to all users that
// looks like the give popup. I should be able to type anything, have bullet points, dashes, bold font,
// italics, underline, etc." … "It needs to be orange, similar to the orange background in settings, so
// people know its a temp popup with recent updates").
//
// Laid out like the push notification beside it (Jakob's law — the same workspace as every App page):
//   · the words on the left: a title, then the words with the toolbar every word processor has
//     (recognition over recall: B I U S, a heading, three kinds of list — their shortcuts in the tooltips)
//     and the one button that puts it on phones at their foot (proximity; Von Restorff: the only filled one)
//   · what's on phones now on the right: the popup that's up, Edit and Take it down — no "are you sure":
//     taking it down, or posting over it, says so with an Undo (the office's rule: Undo over asking)
//   · the phone beside them: the orange card, over the app's Home, as members will see it
// ⌘/Ctrl+Enter posts from anywhere on the page. The draft stays while they're elsewhere in Pillar.

const DRAFT_KEY = 'pillar.app.popup.draft';
const DASH = 'ax-rt-dash';   // a dash list in the editor (testPopups.js docToHtml writes it)
const BLANK = { v: 1, blocks: [] };

function readDraft() {
  try {
    const d = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' ? { title: String(d.title || '').slice(0, TITLE_MAX), doc: tidy(d.doc) } : null;
  } catch { return null; }
}
function keepDraft(title, doc) {
  try {
    if (title.trim() || !docEmpty(doc)) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, doc }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* not kept — nothing else changes */ }
}

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/* ─────────────────────────────── the editor ─────────────────────────────── */

// the toolbar's own small pictures (the lists): three lines with their markers
const ListGlyph = ({ kind }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    {kind === 'bullet' ? <><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></> : null}
    {kind === 'dash' ? <><path d="M3 6h3M3 12h3M3 18h3" /></> : null}
    {kind === 'number' ? <text x="1.5" y="9" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">1</text> : null}
    {kind === 'number' ? <text x="1.5" y="20" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">2</text> : null}
    <path d="M9 6h12M9 12h12M9 18h12" />
  </svg>
);

/**
 * A word-processor box: what's typed is formatted in place, and every change comes back as the popup's
 * document (never as HTML). `loadKey` changing puts `doc` in it (a draft, "Edit", "Use again").
 */
export function RichEditor({ loadKey, doc, onChange, id, placeholder }) {
  const ref = useRef(null);
  const [on, setOn] = useState({});
  const [empty, setEmpty] = useState(true);
  const mod = modKey() === '⌘' ? '⌘' : 'Ctrl+';

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = htmlToDoc(el.innerHTML);
    setEmpty(docEmpty(next) && !el.querySelector('li'));
    onChange(next);
  }, [onChange]);

  // a new document to edit
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = docToHtml(doc);
    setEmpty(docEmpty(doc));
    setOn({});   // nothing's on in a fresh box until the cursor says so
    onChange(tidy(doc));
  }, [loadKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // which buttons are on where the cursor is
  const inside = (name) => {
    const sel = window.getSelection();
    let n = sel && sel.anchorNode;
    while (n && n !== ref.current) {
      if (n.nodeName === name) return n;
      n = n.parentNode;
    }
    return null;
  };
  const listHere = () => inside('UL') || inside('OL');
  const readState = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
    const list = listHere();
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    setOn({
      bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
      heading: !!inside('H3'),
      bullet: !!list && list.nodeName === 'UL' && !list.classList.contains(DASH),
      dash: !!list && list.nodeName === 'UL' && list.classList.contains(DASH),
      number: !!list && list.nodeName === 'OL',
    });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.addEventListener('selectionchange', readState);
    return () => document.removeEventListener('selectionchange', readState);
  }, [readState]);

  const run = (name, arg) => {
    ref.current?.focus();
    try { document.execCommand('styleWithCSS', false, false); } catch { /* older browsers */ }
    document.execCommand(name, false, arg);
    sync(); readState();
  };
  const list = (kind) => {
    ref.current?.focus();
    const at = listHere();
    if (kind === 'number') { run('insertOrderedList'); return; }
    if (at && at.nodeName === 'UL') {
      const isDash = at.classList.contains(DASH);
      if ((kind === 'dash') === isDash) { run('insertUnorderedList'); return; }   // the same again: off
      at.classList.toggle(DASH, kind === 'dash');                                   // the other kind: switched
      sync(); readState();
      return;
    }
    const had = new Set(ref.current ? ref.current.querySelectorAll('ul') : []);
    run('insertUnorderedList');
    const now = listHere();
    if (!now || now.nodeName !== 'UL') return;
    // Chrome joins a new list to the list beside it. Beside one of the other kind (bullets under
    // dashes, or dashes under bullets) that would turn the whole neighbour into this kind — so this
    // line is lifted out into a list of its own, and the neighbour keeps its kind.
    if (had.has(now)) { if (now.classList.contains(DASH) !== (kind === 'dash')) splitOut(now, kind); }
    else now.classList.toggle(DASH, kind === 'dash');
    sync(); readState();
  };
  // the line the cursor is on, out of `ul` into a new list of `kind` in its place: the items before it
  // stay where they are, the ones after it go on in a list of the old kind after it
  const splitOut = (ul, kind) => {
    const li = inside('LI');
    if (!li || li.parentNode !== ul) return;
    const sel = window.getSelection();
    const node = sel && sel.anchorNode;
    const offset = sel ? sel.anchorOffset : 0;
    const mine = document.createElement('ul');
    if (kind === 'dash') mine.className = DASH;
    const rest = document.createElement('ul');
    if (ul.classList.contains(DASH)) rest.className = DASH;
    for (let n = li.nextSibling; n;) { const next = n.nextSibling; rest.appendChild(n); n = next; }
    ul.after(mine);
    mine.appendChild(li);
    if (rest.firstChild) mine.after(rest);
    if (!ul.querySelector('li')) ul.remove();
    // moving the line moves the cursor out of it: put it back where it was
    try { if (node) sel.collapse(node, offset); } catch { /* the cursor stays at the list */ }
  };
  const heading = () => run('formatBlock', inside('H3') ? '<div>' : '<h3>');

  // a paste keeps its words and the formatting the popup has — nothing else comes with it
  const paste = (e) => {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain');
    const pasted = html ? htmlToDoc(html) : textToDoc(text);
    if (docEmpty(pasted)) return;
    document.execCommand('insertHTML', false, docToHtml(pasted));
    sync();
  };

  const TOOLS = [
    { key: 'bold', label: 'Bold', keys: `${mod}B`, glyph: <b>B</b>, act: () => run('bold') },
    { key: 'italic', label: 'Italic', keys: `${mod}I`, glyph: <i>I</i>, act: () => run('italic') },
    { key: 'underline', label: 'Underline', keys: `${mod}U`, glyph: <u>U</u>, act: () => run('underline') },
    { key: 'strike', label: 'Strikethrough', glyph: <s>S</s>, act: () => run('strikeThrough') },
    'sep',
    { key: 'heading', label: 'Heading', glyph: <span className="ax-rt-h">H</span>, act: heading },
    'sep',
    { key: 'bullet', label: 'Bullet points', glyph: <ListGlyph kind="bullet" />, act: () => list('bullet') },
    { key: 'dash', label: 'Dashes', glyph: <ListGlyph kind="dash" />, act: () => list('dash') },
    { key: 'number', label: 'Numbered list', glyph: <ListGlyph kind="number" />, act: () => list('number') },
    'sep',
    { key: 'clear', label: 'Clear formatting', glyph: <span className="ax-rt-clear">T<small>×</small></span>, act: () => run('removeFormat') },
  ];

  return (
    <div className="ax-rt">
      <div className="ax-rt-tools" role="toolbar" aria-label="Formatting" aria-controls={id}>
        {TOOLS.map((t, i) => (t === 'sep' ? <span key={`s${i}`} className="ax-rt-sep" aria-hidden="true" /> : (
          <button key={t.key} type="button" className={`ax-rt-btn${on[t.key] ? ' on' : ''}`}
            aria-pressed={t.key === 'clear' ? undefined : !!on[t.key]} aria-label={t.label}
            title={t.keys ? `${t.label} (${t.keys})` : t.label}
            // keep the words picked: a click on a button mustn't take the selection away
            onMouseDown={(e) => e.preventDefault()} onClick={t.act}>
            {t.glyph}
          </button>
        )))}
      </div>
      <div ref={ref} id={id} className={`ax-rt-area${empty ? ' empty' : ''}`} contentEditable suppressContentEditableWarning
        role="textbox" aria-multiline="true" aria-label="What’s new" data-placeholder={placeholder}
        onInput={sync} onPaste={paste} onKeyUp={readState} onMouseUp={readState} onFocus={readState} />
    </div>
  );
}

/* ─────────────────────────────── the phone ─────────────────────────────── */

// The document as the app draws it (BethesdaApp components/testkit/RichText.js): paragraphs, a heading,
// and lists whose markers hang in their own column.
function PhoneBody({ doc }) {
  let n = 0;
  return (
    <div className="ax-pp-body">
      {tidy(doc).blocks.map((b, i) => {
        n = b.t === 'number' ? n + 1 : 0;
        const words = b.s.map((r, j) => {
          const cls = [r.b && 'ax-pp-b', r.i && 'ax-pp-i', r.u && 'ax-pp-u', r.k && 'ax-pp-k'].filter(Boolean).join(' ');
          return <span key={j} className={cls || undefined}>{r.x}</span>;
        });
        if (b.t === 'p' && !b.s.length) return <div key={i} className="ax-pp-gap" />;
        if (b.t === 'h') return <div key={i} className="ax-pp-h">{words}</div>;
        if (b.t === 'p') return <div key={i} className="ax-pp-p">{words}</div>;
        return (
          <div key={i} className={`ax-pp-li ax-pp-${b.t}`}>
            <span className="ax-pp-mark">{b.t === 'bullet' ? '•' : b.t === 'dash' ? '–' : `${n}.`}</span>
            <span className="ax-pp-li-words">{words}</span>
          </div>
        );
      })}
    </div>
  );
}

// The card (BethesdaApp components/testkit/UpdatePopup.js — the Give popup's card in the test kit's
// orange): the 45% scrim, the card 32pt in, corner 24, 24 in; "TESTING VIEW ONLY" with the tool; the
// white disc with the orange bolt; the title 22/700; the words; one dark pill, "Got it".
function PopupPreview({ title, doc, live }) {
  return (
    <PhoneFrame statusBar="light" dock="home" profile={false} screenClassName="ax-set-dim"
      label="The update popup on a phone, over whatever page it’s on"
      overlay={(
        <div className="ax-pa-scrim strong ax-pp-scrim">
          {!live ? <span className="ax-pa-flag ax-set-flag">Not on phones</span> : null}
          <div className="ax-pp-card">
            <span className="ax-pp-label"><PhoneIcon name="tool" size={13} />Testing view only</span>
            <span className="ax-pp-disc"><PhoneIcon name="zap" size={24} /></span>
            <span className={`ax-pp-title${title.trim() ? '' : ' empty'}`}>{title.trim() || 'Recent updates'}</span>
            {docEmpty(doc) ? <div className="ax-pp-body"><div className="ax-pp-p empty">What’s new shows here.</div></div> : <PhoneBody doc={doc} />}
            <span className="ax-pa-btn lg filled block ax-pp-btn"><span>Got it</span></span>
          </div>
        </div>
      )}>
      <AppHome photo="" />
    </PhoneFrame>
  );
}

/* ─────────────────────────────── the page ─────────────────────────────── */

export default function PopupPanel() {
  const [data, setData] = useState(null);           // { live, earlier }
  const [loadError, setLoadError] = useState('');
  const draft = useRef(readDraft());
  const [title, setTitle] = useState(draft.current?.title || '');
  const [doc, setDoc] = useState(draft.current?.doc || BLANK);
  const [loadKey, setLoadKey] = useState(0);
  const [start, setStart] = useState(draft.current?.doc || BLANK);   // what the editor opened with
  const [editing, setEditing] = useState(null);     // the id of the popup that's up, when changing it in place
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [toast, showUndo] = useUndo();
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    try { setData(await fetchPopups()); setLoadError(''); }
    catch (e) { setData({ live: null, earlier: [] }); setLoadError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!editing) keepDraft(title, doc); }, [title, doc, editing]);

  const len = docLength(doc);
  const typed = !!(title.trim() || !docEmpty(doc));
  const ready = !!(title.trim() && !docEmpty(doc) && len <= TEXT_MAX && title.trim().length <= TITLE_MAX);
  useLeaveGuard(typed && !busy);
  const live = data?.live || null;

  const open = (t, d, id = null) => {
    setTitle(t); setStart(d); setLoadKey((k) => k + 1); setEditing(id); setError(''); setDone('');
    if (titleRef.current?.focus) titleRef.current.focus();
  };
  const clear = () => open('', BLANK);

  async function post() {
    if (!ready || busy) return;
    setBusy(true); setError(''); setDone('');
    const before = live;
    try {
      const id = await postPopup({ title, body: doc });
      clear();
      setDone('Up on every phone. Each shows it once, the next time the app is open.');
      showUndo(before ? `Posted — “${before.title}” came down.` : 'Posted.', async () => {
        try {
          await takeDownPopup();
          if (before) await restorePopup(before.id);
          setDone(''); await load();
        } catch (e) { setError(e.message); }
      });
      void id;
    } catch (e) { setError(e.message); }
    setBusy(false);
    load();
  }
  async function update() {
    if (!ready || busy || !editing) return;
    setBusy(true); setError(''); setDone('');
    try {
      await editPopup(editing, { title, body: doc });
      clear();
      setDone('Changed on phones. Phones that have already shown it don’t show it again.');
    } catch (e) { setError(e.message); }
    setBusy(false);
    load();
  }
  async function takeDown() {
    if (!live || busy) return;
    setBusy(true); setError('');
    const was = live;
    try {
      await takeDownPopup();
      if (editing === was.id) clear();
      showUndo(`“${was.title}” is off every phone.`, async () => {
        try { await restorePopup(was.id); await load(); } catch (e) { setError(e.message); }
      });
    } catch (e) { setError(e.message); }
    setBusy(false);
    load();
  }

  useHotkeys({
    'mod+enter': () => { if (editing) update(); else post(); },
    escape: () => { if (done) setDone(''); else if (error) setError(''); },
  });
  const keys = modKey() === '⌘' ? '⌘↵' : 'Ctrl+Enter';
  const status = !data ? 'Loading…'
    : live ? `“${live.title}” is up on phones — since ${when(live.posted_at)}`
    : 'Nothing up on phones';

  return (
    <Workspace className="ax-pp">
      <EditorPane label="The update popup"
        status={<span className={`ax-save${live ? ' saved' : ''}`} role="status"><span className="ax-dot" />{status}</span>}>
        <Alert onClose={error ? () => setError('') : null}>{error}</Alert>
        <Alert>{loadError}</Alert>
        {done ? (
          <div className="ax-note spaced">
            <Icon d={P.check} size={18} /><span className="ax-note-main">{done}</span>
            <button type="button" className="ax-btn quiet sm" onClick={() => setDone('')}>OK</button>
          </div>
        ) : null}
        <Cols>
          <ColA title={editing ? 'Changing the one that’s up' : 'A new popup'}>
            <p className="ax-pp-testing"><PhoneIcon name="tool" size={14} />Testing — phones show it in orange, marked “Testing view only”, and it goes when testing does.</p>
            <Field label="Title" count={title.length} max={TITLE_MAX} htmlFor="ax-pp-title">
              <input ref={titleRef} id="ax-pp-title" className="ax-input title" value={title} maxLength={TITLE_MAX}
                placeholder="Recent updates" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="What’s new" count={len} max={TEXT_MAX} htmlFor="ax-pp-body">
              <RichEditor id="ax-pp-body" loadKey={loadKey} doc={start} onChange={setDoc}
                placeholder="What changed in this build — lists, bold and all" />
            </Field>
            <div className="ax-nt-send ax-pp-send">
              <span className="ax-hint ax-nt-send-hint">
                {editing ? 'Changes it where it is — phones that have already shown it don’t show it again.'
                  : live ? `Replaces “${live.title}”. Every phone shows the new one once.`
                  : 'Every phone shows it once, the next time the app is open.'}
              </span>
              <span className="ax-hotkeys ax-nt-keys"><span className="ax-hotkey"><kbd>{keys}</kbd>{editing ? 'update' : 'post'}</span></span>
              {editing ? (
                <>
                  <button type="button" className="ax-btn quiet" onClick={clear} disabled={busy}>Cancel</button>
                  <button type="button" className="ax-btn" onClick={post} disabled={!ready || busy}
                    title="Post it as a new popup — every phone shows it again">Post as new</button>
                  <button type="button" className="ax-btn primary" onClick={update} disabled={!ready || busy}>
                    {busy ? <><span className="ax-spinner" />Saving…</> : <><Icon d={P.check} size={16} />Update it</>}
                  </button>
                </>
              ) : (
                <button type="button" className="ax-btn primary" onClick={post} disabled={!ready || busy}
                  title={ready ? `Post to every phone (${keys})` : 'Write a title and what’s new first'}>
                  {busy ? <><span className="ax-spinner" />Posting…</> : <><Icon d={P.send} size={16} />Post to every phone</>}
                </button>
              )}
            </div>
            {/* never a silently dead button (Hick): say what's missing */}
            {!ready && typed ? (
              <p className="ax-hint ax-nt-missing">
                {!title.trim() ? 'Give it a title too.' : docEmpty(doc) ? 'Write what’s new too.' : len > TEXT_MAX ? `That’s ${len - TEXT_MAX} characters too long.` : ''}
              </p>
            ) : null}
          </ColA>

          <ColB title="On phones now">
            {!data ? <Loading /> : live ? (
              <div className="ax-pp-live">
                <span className="ax-pp-live-dot" aria-hidden="true" />
                <div className="ax-pp-live-main">
                  <strong className="ax-pp-live-title">{live.title}</strong>
                  <span className="ax-pp-live-sum">{docSummary(live.body)}</span>
                  <span className="ax-pp-live-when">Up since {when(live.posted_at)}</span>
                </div>
                <div className="ax-pp-live-btns">
                  <button type="button" className="ax-btn sm" onClick={() => open(live.title, live.body, live.id)} disabled={busy}>
                    <Icon d={P.edit} size={15} />Edit
                  </button>
                  <button type="button" className="ax-btn sm danger" onClick={takeDown} disabled={busy}>Take it down</button>
                </div>
              </div>
            ) : (
              <p className="ax-hint ax-pp-none">Nothing is up. The next one you post shows on every phone.</p>
            )}
            {data?.earlier?.length ? (
              <>
                <h4 className="ax-pp-earlier-head">Earlier</h4>
                <ul className="ax-pp-earlier">
                  {data.earlier.map((r) => (
                    <li key={r.id}>
                      <div className="ax-pp-earlier-main">
                        <span className="ax-pp-earlier-title">{r.title}</span>
                        <span className="ax-pp-earlier-when">{when(r.posted_at)}</span>
                      </div>
                      <button type="button" className="ax-btn sm quiet" onClick={() => open(r.title, r.body)}
                        title="Put its words in the editor, to post again or change first">Use again</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </ColB>
        </Cols>
        {toast}
      </EditorPane>

      <PreviewPane label="On phones" note="Over any page">
        {/* nothing typed: the one that's up, as phones show it now; typing: the draft, marked until it's posted */}
        {!typed && !editing && live
          ? <PopupPreview title={live.title} doc={live.body} live />
          : <PopupPreview title={title} doc={doc} live={!!editing} />}
        <p className="ax-phone-cap">A one-time card: every phone with the app shows it once — signed in or not — and never again.</p>
      </PreviewPane>
    </Workspace>
  );
}
