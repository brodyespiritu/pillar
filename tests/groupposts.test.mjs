// The rules that decide what reaches a member's card (Pillar/src/lib/groupPosts.js).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'build'); fs.mkdirSync(OUT, { recursive: true });
// the module imports the live supabase client; the pure rules under test don't touch it
const src = fs.readFileSync(path.join(PILLAR, 'src/lib/groupPosts.js'), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = null;');
const file = path.join(OUT, 'groupPosts.mjs');
fs.writeFileSync(file, src);
const { postPatch, postProblems, isLiveNow, liveLabel } = await import(pathToFileURL(file).href);

let ok = 0; const t = (n, f) => { f(); ok++; console.log('  ✓', n); };

t('a card needs a title, and nothing else', () => {
  assert.deepStrictEqual(postProblems({ title: 'Going out to eat' }), []);
  assert.ok(postProblems({ title: '   ' })[0].includes('title'));
});

t('a button is a label AND a web address, or it is not a button', () => {
  assert.ok(postProblems({ title: 'T', button_label: 'Sign up' })[0].includes('needs a link'));
  assert.ok(postProblems({ title: 'T', button_url: 'https://x.org' })[0].includes('needs a label'));
  assert.deepStrictEqual(postProblems({ title: 'T', button_label: 'Sign up', button_url: 'https://x.org' }), []);
});

t('a link the app would refuse to open is refused here first', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c', 'x.org', 'ftp://x.org']) {
    const p = postProblems({ title: 'T', button_label: 'Go', button_url: bad });
    assert.ok(p.some(m => /http:\/\/ or https:\/\//.test(m)), `${bad} should be refused, got ${p}`);
  }
  assert.deepStrictEqual(postProblems({ title: 'T', button_label: 'Go', button_url: 'http://x.org/a?b=1' }), []);
});

t('a half-filled button is saved as no button at all', () => {
  assert.strictEqual(postPatch({ title: 'T', button_label: 'Go', button_url: '' }).button_label, null);
  assert.strictEqual(postPatch({ title: 'T', button_label: '', button_url: 'https://x.org' }).button_url, null);
  const both = postPatch({ title: 'T', button_label: ' Go ', button_url: ' https://x.org ' });
  assert.strictEqual(both.button_label, 'Go');
  assert.strictEqual(both.button_url, 'https://x.org');
});

t('an empty box is null, not an empty string — the columns are checked against null', () => {
  const p = postPatch({ title: ' Room change ', body: '   ', starts_on: '', ends_on: '', group_id: '' });
  assert.strictEqual(p.title, 'Room change');
  assert.strictEqual(p.body, null);
  assert.strictEqual(p.starts_on, null);
  assert.strictEqual(p.group_id, null);
  assert.strictEqual(p.published, true, 'a new card is published unless the office says otherwise');
});

t('the lengths match the database checks', () => {
  assert.ok(postProblems({ title: 'x'.repeat(81) }).some(m => /80/.test(m)));
  assert.ok(postProblems({ title: 'T', body: 'x'.repeat(601) }).some(m => /600/.test(m)));
  assert.ok(postProblems({ title: 'T', button_label: 'x'.repeat(31), button_url: 'https://x.org' }).some(m => /30/.test(m)));
  assert.ok(postProblems({ title: 'T', starts_on: '2026-10-02', ends_on: '2026-10-01' }).some(m => /before/.test(m)));
});

t('"Showing" tells the truth about why a card is not on a phone', () => {
  const day = new Date('2026-09-16T12:00:00Z');
  assert.strictEqual(liveLabel({ published: false }, day), 'Draft');
  assert.strictEqual(liveLabel({ published: true }, day), 'Live');
  assert.strictEqual(liveLabel({ published: true, starts_on: '2026-09-20' }, day), 'Starts 2026-09-20');
  assert.strictEqual(liveLabel({ published: true, ends_on: '2026-09-10' }, day), 'Ended 2026-09-10');
  assert.strictEqual(isLiveNow({ published: true, starts_on: '2026-09-16', ends_on: '2026-09-16' }, day), true,
    'a one-day card is live on its day');
  assert.strictEqual(isLiveNow({ published: true, ends_on: '2026-09-15' }, day), false);
});

console.log(`${ok} group-card rule checks passed`);
