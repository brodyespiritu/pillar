// "Update needed" (Pillar/src/lib/updateNotice.js, supabase/app-update-notice.sql, BethesdaApp
// utils/updateNotice.js — user, 2026-09-23): what the office may set, what a save writes, and that
// Pillar, the database and the app accept exactly the same links — a TestFlight link that Pillar
// offered but the database refused is how this suite started.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const calls = [];
globalThis.__supabase = { from: (table) => ({
  upsert: async (row, opts) => { calls.push({ table, row, opts }); return { error: null }; },
  select: async () => ({ data: [{ platform: 'ios', active: true, min_build: 16, link: 'itms-beta://', message: null }], error: null }),
}) };
let src = fs.readFileSync(path.join(PILLAR, 'src/lib/updateNotice.js'), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;');
fs.writeFileSync(path.join(OUT, 'updateNotice.mjs'), src);
const lib = await import(pathToFileURL(path.join(OUT, 'updateNotice.mjs')).href);

let ok = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { console.log('  ✗', n, '\n   ', e.message); process.exitCode = 1; } };

await t('it can\'t be switched on half-made: it needs the newest build and somewhere to send them', () => {
  assert.ok(lib.noticeProblems({ active: true, min_build: '', link: 'itms-beta://' }).some((p) => /which build/.test(p)));
  assert.ok(lib.noticeProblems({ active: true, min_build: '16', link: '' }).some((p) => /where the button goes/.test(p)));
  assert.deepStrictEqual(lib.noticeProblems({ active: true, min_build: '16', link: 'itms-beta://' }), []);
  assert.deepStrictEqual(lib.noticeProblems({ active: false, min_build: '', link: '' }), [], 'off and empty is fine');
});

// user, 2026-09-23: "I dont see the card on the app" — they were on build 15 with 15 set, and the panel
// said "Anyone before build 15 sees the card". It now says who does, and that the newest build doesn't.
await t('the panel says plainly who sees the card — and that the newest build never does', () => {
  assert.strictEqual(lib.whoSees('15'), 'Phones on build 14 or older see the card. Build 15 is up to date, so it doesn’t.');
  assert.strictEqual(lib.whoSees(16), 'Phones on build 15 or older see the card. Build 16 is up to date, so it doesn’t.');
  assert.match(lib.whoSees(''), /which build/);
  assert.match(lib.whoSees('1'), /nobody/);
  const ios = lib.PLATFORMS.find((p) => p.key === 'ios');
  assert.match(ios.buildHint, /Phones already on it never see the card/);
  assert.match(ios.buildHint, /only once the new build is in TestFlight/, 'and when it is safe to raise it');
  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/SettingsPage.jsx'), 'utf8');
  // (Pillar review, 2026-09-23: an Off that hasn't reached the database yet says phones still see the
  // card; On and Off keep these words)
  assert.match(page, /sub=\{offLate \? 'Phones still see the card until this saves\.' : f\.active \? whoSees\(f\.min_build\) : 'Nobody sees the card\.'\}/);
});

await t('a build is a whole number; a link is a store, TestFlight or a web address', () => {
  assert.ok(lib.noticeProblems({ min_build: '16a' }).length);
  assert.ok(lib.noticeProblems({ link: 'javascript:alert(1)' }).length);
  for (const p of lib.PLATFORMS) for (const pre of p.presets) {
    if (pre.link) assert.deepStrictEqual(lib.noticeProblems({ link: pre.link }), [], `${p.key} ${pre.key}: ${pre.link}`);
  }
});

// Pillar redesign (2026-09-23): the pill that shows as picked is read from the link itself. It used to
// be "the preset whose link equals this one", and the APK's preset has no link (a new file every
// build), so its pill never lit up — not when chosen, not with an APK's link pasted.
await t('the picked pill is read from the link — the newest APK\'s too', () => {
  assert.strictEqual(lib.presetFor('ios', 'itms-beta://'), 'testflight');
  assert.strictEqual(lib.presetFor('ios', `itms-apps://apps.apple.com/app/id${lib.APP_STORE_ID}`), 'store');
  assert.strictEqual(lib.presetFor('ios', 'https://example.org/app'), '', 'an iPhone link that is neither lights nothing');
  assert.strictEqual(lib.presetFor('ios', ''), '');
  assert.strictEqual(lib.presetFor('android', ''), 'apk', 'nothing yet: the APK, where the link is pasted');
  assert.strictEqual(lib.presetFor('android', 'https://expo.dev/artifacts/eas/2PKP.apk'), 'apk');
  assert.strictEqual(lib.presetFor('android', `https://play.google.com/store/apps/details?id=${lib.ANDROID_PACKAGE}`), 'store');
  assert.strictEqual(lib.presetFor('android', `market://details?id=${lib.ANDROID_PACKAGE}`), 'store');
  assert.strictEqual(lib.presetFor('windows', 'x'), '');
  for (const p of lib.PLATFORMS) for (const pre of p.presets) {
    if (pre.link) assert.strictEqual(lib.presetFor(p.key, pre.link), pre.key, `${p.key} ${pre.key}`);
    assert.ok(pre.short && pre.when && pre.label, `${p.key} ${pre.key}: a short word for the pill, when it applies, and the long label`);
  }
  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/SettingsPage.jsx'), 'utf8');
  assert.match(page, /presetFor\(platform\.key, f\.link\)/, 'and Settings lights the pill that way');
});

await t('a save writes one row per platform, blanks as nothing', async () => {
  calls.length = 0;
  await lib.saveNotice('android', { active: true, min_build: '7', link: ' https://expo.dev/artifacts/eas/x.apk ', message: '  ' });
  assert.deepStrictEqual(calls[0], { table: 'app_update_notice', opts: { onConflict: 'platform' },
    row: { platform: 'android', active: true, min_build: 7, link: 'https://expo.dev/artifacts/eas/x.apk', message: null } });
});

await t('Pillar, the database and the app accept exactly the same links', () => {
  const sql = fs.readFileSync(path.join(PILLAR, 'supabase/app-update-notice.sql'), 'utf8');
  // POSIX [:space:] inside a bracket is JavaScript's \s
  const dbRe = new RegExp(/link ~ '([^']+)'/.exec(sql)[1].replace(/\[:space:\]/g, '\\s'));
  const app = fs.readFileSync(path.join(APP, 'utils/updateNotice.js'), 'utf8');
  const appRe = new RegExp(/const LINK = \/(.+)\/;/.exec(app)[1]);
  const samples = ['itms-beta://', 'itms-apps://apps.apple.com/app/id6784403023', 'https://expo.dev/a.apk',
    'market://details?id=com.bethesdabaptist.app', 'https://', 'javascript:alert(1)', 'http://x.org', 'itms-apps://'];
  for (const l of samples) {
    const pillar = lib.noticeProblems({ link: l }).length === 0;
    assert.strictEqual(dbRe.test(l), pillar, `database vs Pillar on ${l}`);
    assert.strictEqual(appRe.test(l), pillar, `app vs Pillar on ${l}`);
  }
});

await t('Settings offers it, with the card as the phone draws it', () => {
  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/SettingsPage.jsx'), 'utf8');
  assert.ok(page.includes('<UpdateNeeded />') && page.includes('Update needed'));
  assert.ok(page.includes('Update the app'), 'the button\'s own words');
  const card = fs.readFileSync(path.join(APP, 'components/UpdateNeeded.js'), 'utf8');
  assert.ok(card.includes('Update the app') && card.includes('Update needed'), 'and the app says the same');
});

console.log(`\n${ok} update-needed checks passed`);
