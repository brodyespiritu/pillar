// Where a push notification opens when it's tapped (src/lib/pushTargets.js): the choice Pillar keeps,
// the data it sends, the announcements it offers (only the ones on phones now), and the words that say
// what a tap does. The app reads the data back (BethesdaApp tests/ui/notificationlinks.test.cjs); the
// app server checks it on the way (bethesda-admin test/push-target.test.js).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const ADMIN = process.env.BETHESDA_ADMIN || path.resolve(PILLAR, '../bethesda-admin');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

// the two places the announcements come from, as the test says
let bulletin = []; let bulletinFails = false;
let cards = []; let cardsFails = false;
globalThis.__pushApi = { getAnnouncements: async () => { if (bulletinFails) throw new Error('asleep'); return bulletin; } };
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
globalThis.__pushCards = {
  listCards: async () => { if (cardsFails) throw new Error('offline'); return cards; },
  // the real rule (src/lib/homeCards.js isLive), for a card with no dates or dated around today
  isLive: (c) => !!c.published && (!c.starts_on || c.starts_on <= TODAY) && (!c.ends_on || c.ends_on >= TODAY),
};
let src = fs.readFileSync(path.join(PILLAR, 'src/lib/pushTargets.js'), 'utf8');
assert.ok(src.includes("import { getAnnouncements } from './appApi';") && src.includes("import { listCards, isLive } from './homeCards';"));
src = src.replace("import { getAnnouncements } from './appApi';", 'const { getAnnouncements } = globalThis.__pushApi;')
  .replace("import { listCards, isLive } from './homeCards';", 'const { listCards, isLive } = globalThis.__pushCards;');
fs.writeFileSync(path.join(OUT, 'pushTargets.mjs'), src);
const T = await import(pathToFileURL(path.join(OUT, 'pushTargets.mjs')).href);

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

console.log('\n── the choice and what it sends ──');

await t('three choices; the app is the default, and a kept draft can hold nothing else', () => {
  assert.deepStrictEqual(T.OPENS.map((o) => o.label), ['The app', 'A page', 'An announcement']);
  assert.deepStrictEqual(T.opensOf(null), T.BLANK_OPENS);
  assert.deepStrictEqual(T.opensOf({ kind: 'url', page: 'Admin', ann: 'javascript:1' }), { kind: 'app', page: 'Home', ann: '' });
  assert.deepStrictEqual(T.opensOf({ kind: 'announcement', page: 'Bible', ann: 'card:abc-1' }), { kind: 'announcement', page: 'Bible', ann: 'card:abc-1' });
});

await t('the data: none for the app, the page for a page, the page and the id for an announcement', () => {
  assert.strictEqual(T.pushData({ kind: 'app', page: 'Bible' }), null);
  assert.deepStrictEqual(T.pushData({ kind: 'page', page: 'Calendar' }), { page: 'Calendar' });
  assert.deepStrictEqual(T.pushData({ kind: 'announcement', ann: 'notice:1782618176547' }), { page: 'Bulletin', notice: '1782618176547' });
  assert.deepStrictEqual(T.pushData({ kind: 'announcement', ann: 'card:0b9c6a1e-2f3d' }), { page: 'Home', card: '0b9c6a1e-2f3d' });
  assert.strictEqual(T.pushData({ kind: 'announcement', ann: '' }), null, 'not picked yet: nothing to send');
});

await t('the pages: the app’s own list, and the app server’s, in the same order', () => {
  const keys = T.PUSH_PAGES.map((p) => p.key);
  assert.deepStrictEqual(keys, ['Home', 'Sermons', 'Bible', 'Bulletin', 'Calendar', 'Groups', 'Directory', 'Give', 'Profile']);
  assert.deepStrictEqual(T.PUSH_PAGES.map((p) => p.label), ['Home', 'Watch', 'Bible', 'Digital Bulletin', 'Calendar', 'Groups', 'Directory', 'Give', 'My Profile']);
  const app = fs.readFileSync(path.join(APP, 'utils/notificationLinks.js'), 'utf8');
  const list = `[${keys.map((k) => `'${k}'`).join(', ')}]`;
  assert.ok(app.includes(`export const PUSH_PAGES = ${list};`), 'BethesdaApp utils/notificationLinks.js');
  if (fs.existsSync(path.join(ADMIN, 'pushTarget.js'))) {
    assert.ok(fs.readFileSync(path.join(ADMIN, 'pushTarget.js'), 'utf8').includes(`const PUSH_PAGES = ${list};`), 'bethesda-admin pushTarget.js');
  }
});

console.log('\n── the announcements it offers ──');

await t('only the ones on phones now: the Bulletin’s switched on, Home’s live announcement cards', async () => {
  bulletin = [
    { id: '1782618176547', title: 'Fall Festival', date: 'Oct 12', published: true },
    { id: '5', title: 'Draft notice', published: false },
    { id: '6', title: '  ' },
    { id: 'bad id!', title: 'Odd' },
  ];
  cards = [
    { id: 'c1', kind: 'text', title: 'Baptism Sunday', audience: 'everyone', published: true },
    { id: 'c2', kind: 'image', title: 'Members meeting', audience: 'signed_in', published: true },
    { id: 'c3', kind: 'video', kicker: 'New series', title: '', audience: 'signed_out', published: true },
    { id: 'c4', kind: 'text', title: 'A draft', published: false },
    { id: 'c5', kind: 'text', title: 'Last month', published: true, ends_on: '2000-01-01' },
    { id: 'c6', kind: 'dinner', title: 'Wednesday dinner', published: true },
    { id: 'c7', kind: 'welcome', title: 'Welcome', published: true },
  ];
  const got = await T.listAnnouncementChoices();
  assert.deepStrictEqual(got.failed, []);
  assert.deepStrictEqual(got.list.map((x) => [x.key, x.title, x.note]), [
    ['notice:1782618176547', 'Fall Festival', 'Oct 12'],
    ['notice:6', 'Untitled announcement', ''],
    ['card:c1', 'Baptism Sunday', ''],
    ['card:c2', 'Members meeting', 'Members only'],
    ['card:c3', 'New series', 'Visitors only'],
  ]);
});

await t('one place that can’t be read says so, and the other is still offered', async () => {
  bulletinFails = true;
  let got = await T.listAnnouncementChoices();
  assert.deepStrictEqual(got.failed, ['Digital Bulletin']);
  assert.ok(got.list.length === 3 && got.list.every((x) => x.where === 'home'));
  bulletinFails = false; cardsFails = true;
  got = await T.listAnnouncementChoices();
  assert.deepStrictEqual(got.failed, ['Home']);
  cardsFails = false;
});

console.log('\n── in words ──');

await t('what a tap opens, said under the choice — and what to know first', async () => {
  const { list } = await T.listAnnouncementChoices();
  assert.strictEqual(T.opensHint({ kind: 'app' }, list), 'Tapping it opens the app where they left it.');
  assert.strictEqual(T.opensHint({ kind: 'page', page: 'Sermons' }, list), 'Tapping it opens Watch.');
  assert.strictEqual(T.opensHint({ kind: 'page', page: 'Bulletin' }, list), 'Tapping it opens the Digital Bulletin.');
  assert.strictEqual(T.opensHint({ kind: 'announcement' }, list, { loading: true }), 'Reading the announcements on phones now…');
  assert.strictEqual(T.opensHint({ kind: 'announcement' }, list), 'Choose the announcement it opens.');
  assert.strictEqual(T.opensHint({ kind: 'announcement', ann: 'notice:1782618176547' }, list), 'Tapping it opens “Fall Festival” over the Digital Bulletin.');
  assert.strictEqual(T.opensHint({ kind: 'announcement', ann: 'card:c2' }, list),
    'Tapping it opens “Members meeting” over Home. Only signed-in members see this card — anyone else lands on Home.');
  assert.match(T.opensHint({ kind: 'announcement', ann: 'card:c3' }, list), /Only visitors \(not signed in\) see this card — members land on Home\.$/);
  assert.strictEqual(T.opensHint({ kind: 'announcement', ann: 'card:gone' }, list), 'That announcement isn’t on phones any more — choose another.');
  assert.strictEqual(T.opensHint({ kind: 'announcement' }, []), 'There are no announcements on phones right now — add one in Bulletin or Home first.');
  assert.strictEqual(T.opensHint({ kind: 'announcement' }, [], { failed: ['Home'] }), 'The announcements couldn’t be read just now.');
});

await t('…and in the “are you sure”: the page, or the announcement and where it lives', async () => {
  const { list } = await T.listAnnouncementChoices();
  assert.strictEqual(T.opensWords({ kind: 'page', page: 'Profile' }, list), 'My Profile');
  assert.strictEqual(T.opensWords({ kind: 'page', page: 'Bulletin' }, list), 'the Digital Bulletin');
  assert.strictEqual(T.opensWords({ kind: 'announcement', ann: 'notice:1782618176547' }, list), '“Fall Festival” in the Digital Bulletin');
  assert.strictEqual(T.opensWords({ kind: 'announcement', ann: 'card:c1' }, list), '“Baptism Sunday” on Home');
  assert.strictEqual(T.opensWords({ kind: 'app' }, list), 'the app');
});

console.log(`\n${ok} push-target checks passed`);
