// Two pictures for one sermon (user, 2026-09-22: "In Pillar, give the user two options to upload a
// thumbnail. A vertical and horizontal one. vertical is not required").
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const PILLAR = path.resolve(import.meta.dirname, '..');
const watch = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
let ok = 0; const check = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { console.log('  ✗', n, '\n   ', e.message); process.exitCode = 1; } };

// Redesign (2026-09-23, DESIGN.md §4): a new sermon's fields moved into one SERMON_BLANK (the Sermons
// list and a sermon made inside a series start from the same blank), and the editor is two columns —
// words, then media — so "Notes" now comes BEFORE the pictures. The checks follow the code to its
// new places; what they protect is the same: both pictures, the tall one optional, the wide one the
// picture the app knows.
check('a sermon carries a wide picture and a tall one', () => {
  assert.match(watch, /thumbnailUrl: r\.thumbnailUrl \|\| '', thumbnailTallUrl: r\.thumbnailTallUrl \|\| ''/);
  assert.match(watch, /const SERMON_BLANK = \{[^}]*thumbnailUrl: '', thumbnailTallUrl: ''/);
  assert.match(watch, /useServerList\(\{\s*get: getSermons,[^}]*blank: SERMON_BLANK/, 'a new sermon starts from it');
});

check('the editor offers both, side by side', () => {
  // the media column: from the wide picture's field to the end of the column
  const at = watch.indexOf('Thumbnail · wide');
  const row = watch.slice(at - 200, watch.indexOf('</ColB>', at));
  const drops = [...row.matchAll(/<ImageDrop /g)];
  assert.strictEqual(drops.length, 2, `two pictures to choose, got ${drops.length}`);
  assert.match(row, /value=\{f\.thumbnailUrl\} onChange=\{\(u\) => set\('thumbnailUrl', u\)\}/);
  assert.match(row, /value=\{f\.thumbnailTallUrl\} onChange=\{\(u\) => set\('thumbnailTallUrl', u\)\} upload=\{upload\} tall/);
});

check('the tall one is optional, and says so', () => {
  assert.match(watch, /label="Thumbnail · tall \(optional\)"/);
  assert.match(watch, /Left empty, the wide one is used\./);
  // nothing anywhere refuses to save without it
  assert.ok(!/thumbnailTallUrl[^\n]*required/i.test(watch));
});

check('the wide one is still the picture the app knows', () => {
  // (the list's rows are drawn by the Sermons view itself now, through sermonThumb)
  assert.match(watch, /const sermonThumb = \(r\) => r\.thumbnailUrl;/, 'the list still shows the wide picture');
  assert.match(watch, /const pic = sermonThumb\(r\);/);
  assert.match(watch, /set\('thumbnailUrl', ytPicture\)/, "and YouTube still fills the wide one in");
  // …and the app's big card takes the tall one first (SermonsScreen.js featPic); the phone does too
  assert.match(watch, /const bigPic = big \? big\.thumbnailTallUrl \|\| big\.thumbnailUrl \|\| '' : '';/);
});

// user, 2026-09-22: "fix the layout of the this section because its too squished"
//
// The redesign (2026-09-23, DESIGN.md §2–3) moved these breakpoints from the window (@media) to the
// page's own width (@container page): the sidebar now folds to a 72px rail, so the window's width no
// longer says how much room the page has. The intent is the same — before three columns can squeeze
// the editor, the phone drops below it; on a narrow page every column stacks.
//
// The shared rules then moved from appx.css into css/base.css (review fix, 2026-09-23): appx.css is
// now only the @import order (phone.css, base.css, then each page's file), so a page's own rule wins
// on order alone. The checks read base.css, and that appx.css still pulls it in.
const appx = fs.readFileSync(path.join(PILLAR, 'src/pages/app/appx.css'), 'utf8');
const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/base.css'), 'utf8');
// the body of an @container / @media block, by matching its braces (the nth one with that head)
const block = (head, nth = 0) => {
  let at = -1;
  for (let k = 0; k <= nth; k++) {
    at = css.indexOf(head, at + 1);
    assert.ok(at >= 0, `no ${head} (#${nth + 1}) in css/base.css`);
  }
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`${head} never closes`);
};

// (integration, 2026-09-23: every App page is the workspace now, so the pre-workspace three columns —
// .ax-split and the breakpoints that dropped its phone under the editor — are gone as dead code. The
// promise they kept, "the phone never squeezes the editor", is the workspace's: the next check.)
check('the editor gets the room: the old three columns are gone, the workspace keeps the promise', () => {
  assert.match(appx, /@import '\.\/css\/base\.css';/, 'appx.css pulls in the shared rules');
  assert.match(css, /\.ax-page \{ container: page \/ inline-size;/, 'the page is the container the breakpoints measure');
  assert.ok(!/\.ax-split\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no .ax-split rules left');
  const app = path.join(PILLAR, 'src/pages/app');
  for (const f of fs.readdirSync(app).filter((x) => /\.jsx?$/.test(x))) {
    assert.ok(!/ax-split\b/.test(fs.readFileSync(path.join(app, f), 'utf8')), `${f} uses the workspace, not .ax-split`);
  }
  // on a narrow page, fields side by side stack
  assert.match(block('@container page (max-width: 759px)'), /\.ax-row2 \{ grid-template-columns: 1fr; \}/);
  // nothing still keys the columns off the window's width
  assert.ok(!/@media \(max-width: (1440|980)px\)/.test(css), 'the old window breakpoints are gone');
});

// Review fix (2026-09-23): the workspace's numbers now reproduce the approved mockup at its own
// 1440 × 900 — the full sidebar leaves a 1164px workspace, and there list 300 · editor 536 in two
// columns · phone 300 all show. So the drawer starts under 1140 (was 1180, which hid the phone at
// 1440 and on every common laptop), and the fields split in two from a 520px editor (was 820). The
// promise is unchanged: the phone becomes a drawer before it squeezes the editor, and one pane at a
// time on a narrow screen.
check('the workspace keeps the same promise: the phone becomes a drawer before the editor squeezes', () => {
  assert.match(css, /\.ax-page \{[^}]*padding: 16px 22px 18px;/, 'the mockup’s gutters: 1440 − 232 − 44 = 1164');
  assert.match(css, /\.ax-work \{ container: work \/ inline-size;[^}]*gap: 14px;/);
  assert.match(css, /\.ax-list-pane \{ flex: 0 0 clamp\(268px, 25\.8%, 360px\); \}/, 'the list: 300 at 1164');
  assert.match(css, /\.ax-preview-pane \{ flex: 0 0 clamp\(300px, 22%, 380px\); \}/, 'the phone: 300 at 1164');
  // 1164 − 300 − 300 − 2 × 14 = 536 ≥ 520: two columns, as drawn
  assert.ok(1164 - 300 - 300 - 28 >= 520);
  const drawer = block('@container work (max-width: 1139px)');
  assert.match(drawer, /\.ax-work\.has-preview > \.ax-preview-pane \{\s*position: absolute;/, 'below 1140px of workspace the phone is a drawer…');
  // …but only a PreviewPane in a workspace that has the Preview button to open it (hasPreview)
  assert.ok(!/\.ax-work > \.ax-preview-pane/.test(drawer), 'never a drawer nobody can open');
  assert.match(drawer, /\.ax-work\.has-preview > \.ax-drawer-scrim \{ display: block;/);
  const one = block('@container work (max-width: 759px)');
  assert.match(one, /\.ax-work:not\(\.detail\) > \.ax-list-pane ~ \.ax-editor-pane \{ display: none; \}/, 'below 760px, one pane at a time');
  // no drawer: the phone stacks under the editor and the workspace scrolls as one
  assert.match(one, /\.ax-work:not\(\.has-preview\) > \.ax-pane \{ flex: none; overflow: visible; \}/);
  assert.match(block('@container page (max-width: 759px)', 1), /\.ax-work:not\(\.has-preview\) \{ flex-direction: column;/,
    'the workspace itself turns to a column (asked of the page: a container can\'t query itself)');
  assert.match(block('@container editor (min-width: 520px)'), /\.ax-cols \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    'an editor splits its fields in two once it has 520px (the mockup’s is 536)');
  // the fields inside a column still never squeeze: auto-fit, 220 at the least
  assert.match(css, /\.ax-fields \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, var\(--ax-field-min, 220px\)\), 1fr\)\);/);
});

check('fields sit side by side only while they fit', () => {
  assert.match(css, /\.ax-row2 \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\); gap: 20px; \}/);
  // (.ax-row3 went with the old editors — no page lays three fields in a row that way now; the
  // workspace's own .ax-fields is auto-fit too, checked above)
  // the two pictures are a row2, so they drop to one column rather than halving a narrow editor
  assert.match(watch, /\{\/\* Two pictures for one sermon[\s\S]{0,400}?<div className="ax-row2">/);
});

console.log(`\n${ok} thumbnail checks passed`);
