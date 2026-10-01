// The AI writer for care texts: supabase/care-ai-writer.sql (who may read and change the settings,
// drafts and corrections) and functions/_shared/careWriter.ts (what the AI is told, and every check
// its version must pass before it may be sent). Made-up people throughout; no AI is called.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { supabaseLikeDb, SUPA } from './_pg.mjs';

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };
const SQL = fs.readFileSync(path.join(SUPA, 'care-ai-writer.sql'), 'utf8');

const w = await import(pathToFileURL(path.join(SUPA, 'functions/_shared/careWriter.ts')).href);
const digest = await import(pathToFileURL(path.join(SUPA, 'functions/_shared/careDigest.ts')).href);

console.log('\n── care-ai-writer.sql ──');

const { db, as } = await supabaseLikeDb({ migrate: false });
await db.exec(`alter table public.staff add column if not exists permissions jsonb not null default '{}'::jsonb;`);

const people = {};
async function person(key, { role = 'Staff', cares, member = false } = {}) {
  const meta = member ? { bbc_member_id: 'm-1' } : {};
  const { rows: [u] } = await db.query(`insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id`,
    [`${key}@example.org`, JSON.stringify(meta)]);
  await db.query(`insert into public.staff (id, name, role, permissions) values ($1, $2, $3, $4)`,
    [u.id, key, role, JSON.stringify(cares ? { cares } : {})]);
  people[key] = { sub: u.id, role: 'authenticated' };
}
await person('admin', { role: 'Admin' });
await person('viewer', { cares: 'view' });
await person('editor', { cares: 'edit' });
await person('plain');
await person('memberLogin', { role: 'Admin', member: true });

await t('applies cleanly, twice over, and starts in practice with a $10 limit', async () => {
  await db.exec(SQL);
  await db.exec(SQL);
  const { rows } = await db.query(`select mode, monthly_cap_usd::float as cap, count(*) over () as n from care_ai_settings`);
  assert.deepStrictEqual(rows, [{ mode: 'practice', cap: 10, n: 1 }]);
});

await t('care details stay with Cares staff: admins and Cares access read, no one else', async () => {
  const read = async (k) => (await as('authenticated', people[k], `select id from care_ai_settings`)).rows?.length ?? 'error';
  assert.deepStrictEqual(
    await Promise.all(['admin', 'viewer', 'editor', 'plain', 'memberLogin'].map(read)), [1, 1, 1, 0, 0],
    'a member-app login is never staff, whatever the staff row says');
});

await t('only admins and Cares edit change the rules or the mode', async () => {
  const set = (k, v) => as('authenticated', people[k], `update care_ai_settings set rules_deacons = $1 where id = 1`, [v]);
  await set('editor', 'No diagnoses for deacons.');
  await set('viewer', 'Viewer was here.');
  await set('plain', 'Plain was here.');
  const { rows: [s] } = await db.query(`select rules_deacons from care_ai_settings`);
  assert.strictEqual(s.rules_deacons, 'No diagnoses for deacons.');
  const bad = await as('authenticated', people.admin, `update care_ai_settings set mode = 'sometimes'`);
  assert.match(bad.error || '', /check constraint/, 'off, practice or live, nothing else');
});

await t('drafts are written by the functions alone, once per text', async () => {
  const draft = (ref) => `insert into care_ai_drafts (kind, audience, label, ref, mode, original, people)
    values ('deacon_alert', 'deacons', 'To Deacon Test', ${ref ? `'${ref}'` : 'null'}, 'practice', 'Update on Pat Doe:', '{Pat Doe}')`;
  assert.ok(!(await as('service_role', {}, draft('alert:update:5550000000:1'))).error);
  assert.match((await as('authenticated', people.admin, draft('alert:update:5550000000:2'))).error || '', /row-level security/,
    'not even an admin writes one from the app');
  assert.match((await as('service_role', {}, draft('alert:update:5550000000:1'))).error || '', /unique/,
    'the instant alert and the sweep cannot both write the same text');
  assert.ok(!(await as('service_role', {}, draft(null))).error && !(await as('service_role', {}, draft(null))).error,
    'previews carry no ref, and any number of them may be kept');
  const seen = async (k) => (await as('authenticated', people[k], `select id from care_ai_drafts`)).rows.length;
  assert.deepStrictEqual([await seen('viewer'), await seen('plain')], [3, 0]);
});

await t('corrections: Cares edit adds and removes them, Cares view only reads', async () => {
  const add = (k) => as('authenticated', people[k], `insert into care_ai_examples (audience, original, should_read, why)
    values ('deacons', 'Update on Pat Doe: in hospital', 'Pat Doe is in the hospital.', 'Plainer') returning id`);
  const mine = await add('editor');
  assert.ok(mine.rows?.length === 1, 'an editor can add one');
  assert.match((await add('viewer')).error || '', /row-level security/);
  assert.strictEqual((await as('authenticated', people.plain, `select id from care_ai_examples`)).rows.length, 0);
  await as('authenticated', people.viewer, `delete from care_ai_examples`);
  assert.strictEqual((await db.query(`select count(*)::int as n from care_ai_examples`)).rows[0].n, 1, 'a viewer cannot remove it');
  await as('authenticated', people.admin, `delete from care_ai_examples where id = $1`, [mine.rows[0].id]);
  assert.strictEqual((await db.query(`select count(*)::int as n from care_ai_examples`)).rows[0].n, 0);
});

console.log('\n── what the AI is told ──');

await t('the rules for that audience, and the latest corrections with the newest nearest the text', async () => {
  const ex = Array.from({ length: 15 }, (_, i) => ({ original: `Pillar ${i}`, should_read: `Better ${i}`, why: i === 0 ? 'Shorter' : '' }));
  const p = w.systemPrompt('deacons', 'Never name the illness.', ex);
  assert.match(p, /deacons, about the families they look after/);
  assert.match(p, /<rules>\nNever name the illness\.\n<\/rules>/);
  assert.strictEqual((p.match(/<example>/g) || []).length, w.EXAMPLES_SHOWN, 'a dozen, not an unbounded list');
  assert.ok(p.indexOf('Better 11') < p.indexOf('Better 0'), 'the newest correction sits last, closest to the text');
  assert.ok(!p.includes('Better 12'), 'the oldest drop off');
  assert.match(w.systemPrompt('staff', ''), /None written yet/);
});

await t('the text itself, with its length as the limit; a digest leaves its header to Pillar', async () => {
  const u = w.userPrompt('deacon_alert', 'Update on Pat Doe:\nGoing home Friday.');
  assert.match(u, /<pillar_text>\nUpdate on Pat Doe:\nGoing home Friday\.\n<\/pillar_text>/);
  assert.match(u, /Keep it to 37 characters or fewer/);
  assert.match(w.userPrompt('staff_digest', 'Added (1):', { header: 'Bethesda Cares - 8:00 AM' }),
    /header line \("Bethesda Cares - 8:00 AM"\)/);
});

await t('its answer is read as lines, and tidied to what a text can carry', async () => {
  assert.deepStrictEqual(w.parseLines('{"lines":["a","b"]}'), ['a', 'b']);
  assert.strictEqual(w.parseLines('Sure! Here it is'), null);
  assert.strictEqual(w.parseLines('{"lines":"a"}'), null);
  assert.deepStrictEqual(
    w.tidyLines(['Bethesda Cares - 8:00 AM', '', '**Added (1):**', '* Pat Doe’s room…', '', '', 'Updates', ''],
      { header: 'Bethesda Cares - 8:00 AM' }),
    ['Added (1):', "- Pat Doe's room...", '', 'Updates'],
    'no repeated header, no formatting marks, plain punctuation, single blank lines');
});

console.log('\n── the checks a version must pass ──');

const original = 'Pat Doe has been added to the care list (Hospitalized, High priority).\nPiedmont Columbus, Rm 412, admitted Sep 12\nFell at home.';
const alertParts = (lines) => w.deaconAlertText({
  alert: { header: lines[0], lines: lines.slice(1) }, kind: 'added', phone: '5550000000', ref: 'x', person: 'Pat Doe',
}).originalParts;
const check = (lines, extra = {}) => w.reviewRewrite({
  original, lines, parts: alertParts(lines), originalParts: alertParts(original.split('\n')), people: ['Pat Doe'], ...extra,
});

await t('a faithful rewrite passes', async () => {
  assert.deepStrictEqual(check(['Pat Doe is in Piedmont Columbus, Rm 412 (admitted Sep 12).', 'She fell at home.']), []);
});

await t('leaving someone out fails, naming them by surname is enough', async () => {
  assert.deepStrictEqual(check(['A member is in Piedmont Columbus, Rm 412.']), ['It left out Pat Doe.']);
  assert.deepStrictEqual(check(['Sister Doe is in Piedmont Columbus, Rm 412.']), []);
  assert.strictEqual(w.surnameOf('John Smith Jr.'), 'Smith');
});

await t('a number Pillar did not give is caught; a count Pillar spelled out is not', async () => {
  assert.deepStrictEqual(check(['Pat Doe is in Piedmont Columbus, Rm 414.']),
    ["It added a number Pillar's wording doesn't have: 414."]);
  const summary = 'One update on your families:\n- Update on Pat Doe:\nHome now.';
  assert.deepStrictEqual(w.reviewRewrite({ original: summary, lines: ['1 update:', '- Pat Doe is home now.'],
    parts: ['x'], originalParts: ['x'], people: ['Pat Doe'] }), []);
});

await t('an emoji, a longer text, or a note about the request is never sent', async () => {
  assert.match(check(['Pat Doe is in Piedmont Columbus, Rm 412 🙏']).join(' '), /twice as much/);
  assert.match(check([`Pat Doe is in Piedmont Columbus, Rm 412. ${'Please keep the family in your prayers. '.repeat(6)}`]).join(' '),
    /cost more to send: \d segments instead of 1/);
  assert.match(check(["As an AI, I can't help with medical details, but Pat Doe is in Rm 412."]).join(' '), /note about the request/);
  assert.deepStrictEqual(check([]), ['It came back empty.']);
});

await t('the price of a write follows the model that answered', async () => {
  const usage = { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 1000 };
  assert.strictEqual(Number(w.costOf('claude-opus-5-5', usage).toFixed(4)), 0.0182);
  assert.strictEqual(Number(w.costOf('claude-opus-4-8', usage).toFixed(4)), 0.0230);
});

console.log('\n── one text, start to finish ──');

await t('an alert: the claim\'s own ref, and Pillar\'s lines round-trip to Pillar\'s texts', async () => {
  const a = { header: 'Update on Pat Doe:', lines: ['Going home Friday.'] };
  const text = w.deaconAlertText({ alert: a, kind: 'update', phone: '5550000000', ref: '42', deacon: 'Deacon Lee', person: 'Pat Doe' });
  assert.strictEqual(text.ref, 'alert:update:5550000000:42');
  assert.strictEqual(text.label, 'To Deacon Lee');
  assert.deepStrictEqual(text.build(text.original.split('\n')), text.originalParts);
});

await t('a digest: Pillar\'s header and numbering wrap the AI\'s lines exactly as they wrap its own', async () => {
  const today = new Date(2026, 8, 30);
  const payload = {
    slot: 480, today, edited: [], ongoing: [],
    added: [{ full_name: 'Pat Doe', category: 'Hospitalized', priority: 'High', hospital_name: 'Piedmont Columbus',
      room_number: '412', admission_date: '2026-09-29', care_notes: 'Fell at home.' }],
    updates: Array.from({ length: 30 }, (_, i) => ({ name: `Sam Roe${i}`, notes: `Doing better, going home Friday. ${'More words. '.repeat(8)}`, where: '' })),
    events: [],
  };
  const c = digest.digestContent(payload);
  assert.strictEqual(c.quiet, false);
  const parts = digest.buildDigest(payload);
  assert.ok(parts.length > 1, 'long enough to split');
  assert.deepStrictEqual(digest.packDigest(c.header, c.lines), parts, 'Pillar\'s own digest is unchanged');
  assert.deepStrictEqual(digest.packDigest(c.header, c.lines, { tail: 'Reply STOP to opt out.' }),
    digest.buildDigest(payload, { tail: 'Reply STOP to opt out.' }));
  const text = w.staffDigestText({ header: c.header, lines: c.lines, parts, sentOn: '2026-09-30', slot: 480,
    slotName: '8:00 AM', people: digest.digestPeople(payload) });
  assert.strictEqual(text.ref, 'digest:2026-09-30:480');
  assert.deepStrictEqual(text.build(c.lines), parts);
  assert.strictEqual(text.people.length, 31, 'everyone named, each once');
  assert.deepStrictEqual(digest.digestContent({ ...payload, slot: 960, added: [], updates: [] }).quiet, true,
    'a quiet afternoon is one line, left as it is');
});

console.log(`\n${ok} passed`);
