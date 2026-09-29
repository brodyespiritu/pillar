// A sermon's picture from its YouTube link (src/lib/youtube.js, the sermon editor on App → Watch; user,
// 2026-09-21: "if I use a link for a sermon video in pillar, can you pull the thumbnail?").
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { youtubeId, youtubeThumbs, youtubePicture } from '../src/lib/youtube.js';

const PILLAR = path.resolve(import.meta.dirname, '..');
let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };

await t('every shape of YouTube link gives the video, anything else gives nothing', () => {
  for (const link of ['https://www.youtube.com/watch?v=F30BN2xi5z0', 'https://youtu.be/F30BN2xi5z0?t=90',
    'https://m.youtube.com/watch?feature=share&v=F30BN2xi5z0', 'https://www.youtube.com/live/F30BN2xi5z0',
    'https://www.youtube.com/embed/F30BN2xi5z0', 'https://www.youtube.com/shorts/F30BN2xi5z0', '  https://youtube.com/watch?v=F30BN2xi5z0  ']) {
    assert.strictEqual(youtubeId(link), 'F30BN2xi5z0', link);
  }
  for (const x of ['https://storage.googleapis.com/bethesdaonline/sermons/a.mp4', 'https://www.youtube.com/@bethesda',
    'https://www.youtube.com/watch?v=<script>', 'https://evil.example/watch?v=F30BN2xi5z0', '', null]) {
    assert.strictEqual(youtubeId(x), null, String(x));
  }
  assert.deepStrictEqual(youtubeThumbs('https://youtu.be/F30BN2xi5z0'), {
    max: 'https://i.ytimg.com/vi/F30BN2xi5z0/maxresdefault.jpg', hq: 'https://i.ytimg.com/vi/F30BN2xi5z0/hqdefault.jpg',
  });
});

await t('the 1280-wide picture when YouTube made one; hq when it answered with its grey stand-in or nothing', async () => {
  const link = 'https://www.youtube.com/watch?v=F30BN2xi5z0';
  assert.strictEqual(await youtubePicture(link, async () => 1280), 'https://i.ytimg.com/vi/F30BN2xi5z0/maxresdefault.jpg');
  assert.strictEqual(await youtubePicture(link, async () => 120), 'https://i.ytimg.com/vi/F30BN2xi5z0/hqdefault.jpg');
  assert.strictEqual(await youtubePicture(link, async () => { throw new Error('404'); }), 'https://i.ytimg.com/vi/F30BN2xi5z0/hqdefault.jpg');
  let asked = 0;
  assert.strictEqual(await youtubePicture('https://storage.googleapis.com/x/a.mp4', async () => { asked++; return 1280; }), null);
  assert.strictEqual(asked, 0, 'a file link isn’t looked up at all');
});

await t('the sermon editor puts it in when there’s no picture yet, and offers it when there is one', () => {
  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
  // the redesign (2026-09-23) replaced SermonPreview with the app's own Watch screen further down, so
  // the editor now runs to the Series view that follows it — and it's the one editor for both the
  // Sermons tab and a sermon made inside its series
  const from = page.indexOf('function SermonEditor(');
  const to = page.indexOf('function SeriesView(');
  assert.ok(from > 0 && to > from, 'the sermon editor, then the series view');
  const editor = page.slice(from, to);
  assert.ok(/youtubePicture\(f\.videoLink\)\.then/.test(editor), 'looked up from the link');
  assert.ok(/list\.rows\.patch\(key, \(r\) => \(r\.thumbnailUrl \? \{\} : \{ thumbnailUrl: url \}\)\)/.test(editor), 'never over a picture already there');
  assert.ok(/\}, \[f\.videoLink\]\);/.test(editor), 'again whenever the link changes');
  assert.ok(/Use the video’s picture/.test(editor) && /set\('thumbnailUrl', ytPicture\)/.test(editor), 'and a button to swap to it');
});

console.log(`\n${ok} YouTube picture checks passed`);
