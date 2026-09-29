// What app-test-popups.sql promises (TESTING — goes with the app's test kit): only staff put the update
// popup up, change it or take it down; one is up at a time; every phone (signed in or not) can read the
// one that's up and nothing else; and each change rings the 'popup' signal so open phones look at once.
//
// Run: node test-popups.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const SQL = fs.readFileSync(path.join(SUPA, 'app-test-popups.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();
const STAFF = '11111111-1111-1111-1111-111111111111';
const FORMER = '22222222-2222-2222-2222-222222222222';

// a Supabase-shaped project with just enough of Pillar: staff, the live signal (before 'popup' existed)
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table public.staff (id uuid primary key, active boolean default true);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  create table public.app_refresh (part text primary key, at timestamptz not null default now());
  alter table public.app_refresh add constraint app_refresh_part_check
    check (part in ('home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live', 'replies'));
  insert into public.app_refresh (part) values ('replies');
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  insert into public.staff (id, active) values ('${STAFF}', true), ('${FORMER}', false);
`);

let err = null;
try { await db.exec(SQL); await db.exec(SQL); } catch (e) { err = e.message; }
ok('app-test-popups.sql applies cleanly, twice', !err, err);

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}
const DOC = (words) => JSON.stringify({ v: 1, blocks: [{ t: 'h', s: [{ x: 'New' }] }, { t: 'bullet', s: [{ x: words, b: 1 }] }] });
const post = (sub, title, body = DOC('The Watch page is faster')) => as('authenticated', sub, `select public.app_test_popup_post($1, $2::jsonb) as id`, [title, body]);
const signalAt = async () => (await db.query(`select at from public.app_refresh where part = 'popup'`)).rows[0]?.at;
const phone = (sql = `select id, title, body from public.app_test_popups`) => as('anon', null, sql);

ok("the live signal knows 'popup' now — and still 'replies'", !!(await signalAt())
  && (await db.query(`select 1 from public.app_refresh where part = 'replies'`)).rows.length === 1);

// ── who may post ──
ok('a phone (anon) can’t post', !!(await post(null, 'Hi')).error);
ok('a signed-in member can’t either', /Only church staff/.test((await post('99999999-9999-9999-9999-999999999999', 'Hi')).error || ''));
ok('nor staff who have left', /Only church staff/.test((await post(FORMER, 'Hi')).error || ''));
ok('no title: refused', /title first/.test((await post(STAFF, '   ')).error || ''));
ok('an over-long title: refused', /under 80/.test((await post(STAFF, 'x'.repeat(81))).error || ''));
ok('no words: refused', /what’s new first/.test((await post(STAFF, 'Hi', JSON.stringify({ v: 1, blocks: [] }))).error || ''));
ok('not a document: refused', /what’s new first/.test((await post(STAFF, 'Hi', '"<b>html</b>"')).error || ''));

// ── posting ──
let before = await signalAt();
await new Promise((r) => setTimeout(r, 15));
const first = await post(STAFF, '  Recent updates ');
ok('staff put it up', !first.error && !!first.rows?.[0]?.id, first.error);
const firstId = first.rows?.[0]?.id;
ok('… and that rings the popup signal', new Date(await signalAt()) > new Date(before));
let seen = await phone();
ok('every phone reads it — signed in or not — title trimmed, the document as sent', seen.rows?.length === 1 && seen.rows[0].title === 'Recent updates'
  && seen.rows[0].body.blocks[1].s[0].b === 1, JSON.stringify(seen));

const second = await post(STAFF, 'Newer updates', DOC('Journal is new'));
const secondId = second.rows?.[0]?.id;
seen = await phone();
ok('posting another takes the first down: one up at a time', seen.rows?.length === 1 && seen.rows[0].id === secondId && secondId !== firstId, JSON.stringify(seen));
const all = (await db.query(`select id, live, taken_down_at from public.app_test_popups order by created_at`)).rows;
ok('… the first kept, taken down and dated', all.length === 2 && !all[0].live && !!all[0].taken_down_at && all[1].live);
let e2 = null;
try { await db.query(`update public.app_test_popups set live = true where id = $1`, [firstId]); } catch (e) { e2 = e.message; }
ok('the database itself never holds two up at once', /duplicate|unique/i.test(e2 || ''), e2);

ok('phones read only the one that’s up — never the old ones', (await phone(`select id from public.app_test_popups where id = '${firstId}'`)).rows?.length === 0);
const staffRead = await as('authenticated', STAFF, `select id from public.app_test_popups`);
ok('staff see them all (for "Use again")', staffRead.rows?.length === 2, staffRead.error);
ok('no one writes to the table directly — not a phone', !!(await as('anon', null, `insert into public.app_test_popups (title, body, live) values ('x', '{"blocks":[{}]}', true)`)).error);
ok('… not even staff', !!(await as('authenticated', STAFF, `update public.app_test_popups set title = 'x'`)).error
  || (await db.query(`select count(*)::int n from public.app_test_popups where title = 'x'`)).rows[0].n === 0);

// ── changing the one that's up ──
before = await signalAt();
await new Promise((r) => setTimeout(r, 15));
let r = await as('authenticated', STAFF, `select public.app_test_popup_edit($1, $2, $3::jsonb)`, [secondId, 'Newer updates!', DOC('Journal is here')]);
ok('staff fix a typo where it is', !r.error, r.error);
seen = await phone();
ok('… same popup (phones that put it away aren’t shown it again), new words', seen.rows?.[0]?.id === secondId && seen.rows[0].title === 'Newer updates!'
  && seen.rows[0].body.blocks[1].s[0].x === 'Journal is here');
ok('… and the signal rings', new Date(await signalAt()) > new Date(before));
r = await as('authenticated', STAFF, `select public.app_test_popup_edit($1, $2, $3::jsonb)`, [firstId, 'Old', DOC('x')]);
ok('one that’s been taken down can’t be edited back up', /isn’t up any more/.test(r.error || ''), r.error);
ok('a phone can’t edit it', !!(await as('anon', null, `select public.app_test_popup_edit($1, 'x', $2::jsonb)`, [secondId, DOC('x')])).error);

// ── taking it down ──
ok('a phone can’t take it down', !!(await as('anon', null, `select public.app_test_popup_take_down()`)).error);
before = await signalAt();
await new Promise((r2) => setTimeout(r2, 15));
r = await as('authenticated', STAFF, `select public.app_test_popup_take_down()`);
ok('staff take it down', !r.error, r.error);
ok('… nothing up on any phone', (await phone()).rows?.length === 0);
ok('… and the signal rings, so open phones stop showing it', new Date(await signalAt()) > new Date(before));

// ── Undo: the same popup back ──
ok('a phone can’t put it back', !!(await as('anon', null, `select public.app_test_popup_restore($1)`, [secondId])).error);
r = await as('authenticated', STAFF, `select public.app_test_popup_restore($1)`, [secondId]);
seen = await phone();
ok('staff put it back — the same one, so phones that put it away don’t see it again', !r.error && seen.rows?.[0]?.id === secondId, r.error);
ok('… no longer marked as taken down', !(await db.query(`select taken_down_at from public.app_test_popups where id = $1`, [secondId])).rows[0].taken_down_at);
r = await as('authenticated', STAFF, `select public.app_test_popup_restore($1)`, [firstId]);
ok('an older one can’t go back up over the one that’s up', /take it down first/.test(r.error || ''), r.error);
await as('authenticated', STAFF, `select public.app_test_popup_take_down()`);

// ── re-running the older files keeps the part ──
const LIVE = fs.readFileSync(path.join(SUPA, 'app-live-updates.sql'), 'utf8');
const REPLIES = fs.readFileSync(path.join(SUPA, 'app-report-replies.sql'), 'utf8');
ok("app-live-updates.sql and app-report-replies.sql list 'popup' too, so re-running either keeps it",
  /'replies', 'popup', 'directory'\)\)/.test(LIVE) && /'replies', 'popup', 'directory'\]\)/.test(LIVE) && /'replies', 'popup', 'directory'\)\)/.test(REPLIES));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
