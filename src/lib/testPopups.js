import { supabase } from './supabase';

// ── TESTING · goes when the app's test kit does ───────────────────────────────
//
// The update popup (user, 2026-09-24: "allow me to post a popup card to all users that looks like the
// give popup. I should be able to type anything, have bullet points, dashes, bold font, italics,
// underline, etc." … "It needs to be orange, similar to the orange background in settings, so people
// know its a temp popup with recent updates"). Pillar → App → Notifications → Update popup writes it;
// every phone shows it once, in the test kit's orange (BethesdaApp components/testkit/UpdatePopup.js).
// Its table and functions: supabase/app-test-popups.sql.
//
// The words are kept as a small document, never as HTML — so nothing a browser pastes can reach a
// phone, and the app draws it with its own text:
//
//   { v: 1, blocks: [ { t, s: [ { x, b?, i?, u?, k? } ] } ] }
//     t   'p' a paragraph (no spans: an empty line) · 'h' a heading · 'bullet' • · 'dash' – · 'number' 1.
//     s   runs of text: x the words; b bold, i italic, u underline, k struck through
//
// Twin: BethesdaApp components/testkit/RichText.js draws the same document.

export const TITLE_MAX = 80;
export const TEXT_MAX = 3000;          // the words, formatting aside
export const BLOCK_TYPES = ['p', 'h', 'bullet', 'dash', 'number'];
const MARKS = ['b', 'i', 'u', 'k'];

// ── HTML → the document ─────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
// what a tag, or its style, says about the words inside it
function marksOf(name, tag) {
  const m = {};
  if (name === 'b' || name === 'strong') m.b = true;
  if (name === 'i' || name === 'em') m.i = true;
  if (name === 'u' || name === 'ins') m.u = true;
  if (name === 's' || name === 'strike' || name === 'del') m.k = true;
  const style = attr(tag, 'style').toLowerCase();
  if (style) {
    const weight = /font-weight\s*:\s*(bold|bolder|[6-9]00)/.exec(style);
    if (weight) m.b = true;
    if (/font-weight\s*:\s*(normal|[1-5]00)/.test(style)) m.b = false;
    if (/font-style\s*:\s*italic/.test(style)) m.i = true;
    if (/text-decoration[^;]*underline/.test(style)) m.u = true;
    if (/text-decoration[^;]*line-through/.test(style)) m.k = true;
  }
  return m;
}
const BLOCKS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'section', 'article']);
const DROP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'button', 'select', 'textarea']);
// tags that never close: nothing inside them to format
const VOID = new Set(['img', 'hr', 'input', 'wbr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track']);

/**
 * The editor's HTML (a browser's contenteditable, or anything pasted into it) → the document. Only
 * words and the formatting above survive: every other tag, attribute and style is dropped.
 */
export function htmlToDoc(html) {
  const blocks = [];
  const marks = [{}];          // a stack: the formatting in force
  const lists = [];            // a stack: 'bullet' | 'dash' | 'number'
  let heading = 0;             // inside an h1–h6
  let dropping = 0;            // inside a script, a style …
  let inItem = 0;              // inside a list item
  let cur = null;              // the block being filled
  const typeHere = () => (lists.length && inItem ? lists[lists.length - 1] : heading ? 'h' : 'p');
  const end = () => {
    if (cur) {
      // spaces at the ends of a line are HTML's, not the writer's
      if (cur.s.length) {
        cur.s[0].x = cur.s[0].x.replace(/^\s+/, '');
        const last = cur.s[cur.s.length - 1];
        last.x = last.x.replace(/\s+$/, '');
        cur.s = cur.s.filter((r) => r.x);
      }
      blocks.push(cur);
    }
    cur = null;
  };
  const start = () => { end(); cur = { t: typeHere(), s: [] }; };
  const text = (words) => {
    if (dropping) return;
    const clean = decode(words).replace(/[\r\n\t ]+/g, ' ');
    if (!clean) return;
    if (!cur) { if (!clean.trim()) return; cur = { t: typeHere(), s: [] }; }
    const m = marks[marks.length - 1];
    const run = { x: clean };
    MARKS.forEach((k) => { if (m[k]) run[k] = 1; });
    const prev = cur.s[cur.s.length - 1];
    if (prev && MARKS.every((k) => !!prev[k] === !!run[k])) prev.x += clean;
    else cur.s.push(run);
    // a space right after a line start or another space is HTML's
    if (cur.s.length === 1 && !cur.s[0].x.trim()) cur.s = [];
  };

  const tokens = String(html || '').replace(/<!--[\s\S]*?-->/g, '').split(/(<[^>]*>)/);
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok[0] !== '<') { text(tok); continue; }
    const m = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(tok);
    if (!m) continue;
    const closing = !!m[1];
    const name = m[2].toLowerCase();
    const selfClosing = /\/\s*>$/.test(tok);
    if (DROP.has(name)) { if (!selfClosing) dropping += closing ? -1 : 1; dropping = Math.max(0, dropping); continue; }
    if (dropping) continue;
    if (name === 'br') {
      // a line break ends the line; an empty line stays one empty paragraph
      if (cur) end(); else blocks.push({ t: typeHere() === 'h' ? 'p' : typeHere(), s: [] });
      continue;
    }
    if (BLOCKS.has(name)) {
      if (!closing) {
        if (name === 'ul' || name === 'ol') {
          end();
          const dash = /\bdash\b/i.test(attr(tok, 'class')) || /list-style-type\s*:\s*['"]?[-–—]/i.test(attr(tok, 'style'));
          lists.push(name === 'ol' ? 'number' : dash ? 'dash' : 'bullet');
        } else if (name === 'li') { end(); inItem += 1; cur = { t: typeHere(), s: [] }; }
        else if (/^h[1-6]$/.test(name)) { end(); heading += 1; cur = { t: 'h', s: [] }; }
        else if (cur && cur.s.length) start();
        marks.push({ ...marks[marks.length - 1], ...marksOf(name, tok) });
      } else {
        if (name === 'ul' || name === 'ol') { end(); lists.pop(); }
        else if (name === 'li') { end(); inItem = Math.max(0, inItem - 1); }
        else if (/^h[1-6]$/.test(name)) { end(); heading = Math.max(0, heading - 1); }
        else end();
        if (marks.length > 1) marks.pop();
      }
      continue;
    }
    if (VOID.has(name)) continue;
    // inline: its formatting applies to what's inside it
    if (!closing && !selfClosing) marks.push({ ...marks[marks.length - 1], ...marksOf(name, tok) });
    else if (closing && marks.length > 1) marks.pop();
  }
  end();
  return tidy({ v: 1, blocks });
}

/** A document as the app may draw it: known kinds and marks only, at most one empty line in a row, none
 *  at the ends — and ANY input (a stored row, a hand-made object) comes out safe. */
export function tidy(doc) {
  const out = [];
  for (const raw of Array.isArray(doc?.blocks) ? doc.blocks : []) {
    if (!raw || typeof raw !== 'object') continue;
    const t = BLOCK_TYPES.includes(raw.t) ? raw.t : 'p';
    const s = (Array.isArray(raw.s) ? raw.s : [])
      .map((r) => {
        const run = { x: String(r?.x ?? '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '') };
        MARKS.forEach((k) => { if (r?.[k]) run[k] = 1; });
        return run;
      })
      .filter((r) => r.x);
    if (!s.some((r) => r.x.trim())) {
      // an empty line is a paragraph with nothing in it — never first, never two in a row; an empty
      // heading or list item is nothing at all
      const prev = out[out.length - 1];
      if (t === 'p' && prev && !(prev.t === 'p' && !prev.s.length)) out.push({ t: 'p', s: [] });
      continue;
    }
    out.push({ t, s });
  }
  while (out.length && !out[out.length - 1].s.length) out.pop();
  return { v: 1, blocks: out };
}

// ── the document → the editor's HTML ────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function runHtml(r) {
  let h = esc(r.x);
  if (r.k) h = `<s>${h}</s>`;
  if (r.u) h = `<u>${h}</u>`;
  if (r.i) h = `<i>${h}</i>`;
  if (r.b) h = `<b>${h}</b>`;
  return h;
}
// the editor marks a dash list with a class of its own (Pillar's ax- prefix); a pasted class="dash" reads as one too
const LIST_TAG = { bullet: '<ul>', dash: '<ul class="ax-rt-dash">', number: '<ol>' };
const LIST_END = { bullet: '</ul>', dash: '</ul>', number: '</ol>' };

/** The document as HTML the editor opens with (and the preview draws). */
export function docToHtml(doc) {
  const { blocks } = tidy(doc);
  let html = '';
  let open = null;
  for (const b of blocks) {
    const list = b.t === 'bullet' || b.t === 'dash' || b.t === 'number';
    if (open && open !== b.t) { html += LIST_END[open]; open = null; }
    const inner = b.s.map(runHtml).join('') || '<br>';
    if (list) {
      if (!open) { html += LIST_TAG[b.t]; open = b.t; }
      html += `<li>${inner}</li>`;
    } else if (b.t === 'h') html += `<h3>${inner}</h3>`;
    else html += `<div>${inner}</div>`;
  }
  if (open) html += LIST_END[open];
  return html;
}

// ── plain text (a paste with no formatting) → the document ─────────────────

/** Lines as the office types them in an email: "- " a dash, "• " or "* " a bullet, "1. " a number. */
export function textToDoc(text) {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const dash = /^\s*[-–—]\s+(.*)$/.exec(line);
    if (dash) return { t: 'dash', s: [{ x: dash[1] }] };
    const bullet = /^\s*[•*·]\s+(.*)$/.exec(line);
    if (bullet) return { t: 'bullet', s: [{ x: bullet[1] }] };
    const number = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (number) return { t: 'number', s: [{ x: number[1] }] };
    return { t: 'p', s: line.trim() ? [{ x: line.replace(/\s+/g, ' ').trim() }] : [] };
  });
  return tidy({ v: 1, blocks });
}

// ── measuring ───────────────────────────────────────────────────────────────

/** The words alone, a line a block (for counting, and for a line in a list). */
export const docText = (doc) => tidy(doc).blocks.map((b) => b.s.map((r) => r.x).join('')).join('\n');
export const docLength = (doc) => docText(doc).replace(/\n/g, '').length;
export const docEmpty = (doc) => !docText(doc).trim();
/** One line to name it by in a list: its first words. */
export const docSummary = (doc, max = 90) => {
  const line = docText(doc).split('\n').find((l) => l.trim()) || '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

// ── the church's database ───────────────────────────────────────────────────

const NOT_SET_UP = 'The update popup isn’t set up in the database yet — run supabase/app-test-popups.sql in the Supabase SQL Editor.';
const friendly = (e) => {
  const msg = String(e?.message || e || '');
  if (/app_test_popup|does not exist|schema cache|PGRST20[0-9]/i.test(msg) && !/Only church staff/.test(msg)) return new Error(NOT_SET_UP);
  return new Error(msg || 'It didn’t save. Try again in a moment.');
};

/** The one up on phones now (or null), and the last few taken down, newest first. */
export async function fetchPopups() {
  const { data, error } = await supabase
    .from('app_test_popups')
    .select('id,title,body,live,created_at,posted_at,taken_down_at')
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(8);
  if (error) throw friendly(error);
  const rows = (data || []).map((r) => ({ ...r, body: tidy(r.body) }));
  return { live: rows.find((r) => r.live) || null, earlier: rows.filter((r) => !r.live).slice(0, 6) };
}

const checked = (title, doc) => {
  const t = String(title || '').trim();
  const body = tidy(doc);
  if (!t) throw new Error('Give it a title first.');
  if (t.length > TITLE_MAX) throw new Error(`Keep the title under ${TITLE_MAX} characters.`);
  if (docEmpty(body)) throw new Error('Write what’s new first.');
  if (docLength(body) > TEXT_MAX) throw new Error(`Keep it under ${TEXT_MAX.toLocaleString('en-US')} characters.`);
  return { t, body };
};

/** Up on every phone, in place of whatever was up — everyone sees it, once. */
export async function postPopup({ title, body }) {
  const c = checked(title, body);
  const { data, error } = await supabase.rpc('app_test_popup_post', { p_title: c.t, p_body: c.body });
  if (error) throw friendly(error);
  return data;
}

/** The one that's up, changed where it is: phones that have already shown it don't show it again. */
export async function editPopup(id, { title, body }) {
  const c = checked(title, body);
  const { error } = await supabase.rpc('app_test_popup_edit', { p_id: id, p_title: c.t, p_body: c.body });
  if (error) throw friendly(error);
}

/** Off every phone. */
export async function takeDownPopup() {
  const { error } = await supabase.rpc('app_test_popup_take_down');
  if (error) throw friendly(error);
}

/** Undo: the same one back up (phones that have already shown it don't show it again). */
export async function restorePopup(id) {
  const { error } = await supabase.rpc('app_test_popup_restore', { p_id: id });
  if (error) throw friendly(error);
}
