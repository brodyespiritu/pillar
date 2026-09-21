// What app-home-tiles.sql and calendar-featured.sql promise: the office can change the words and
// pictures on Home's four boxes (and leave any of them to the app), phones read them signed in or
// out, and an event can be marked featured with — or without — a picture, while a private event
// still reaches nobody.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node home-tiles-featured.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(SUPA, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();
const STAFF = '11111111-1111-1111-1111-111111111111';
const MEMBER = '22222222-2222-2222-2222-222222222222';

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table public.staff (id uuid primary key, active boolean default true);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  create or replace function public.touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at = now(); return new; end $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
  insert into public.staff (id) values ('${STAFF}');
`);
await db.exec(read('calendar-schema.sql'));
await db.exec(read('app-live-updates.sql'));
// the website/app read policy this church already runs
await db.exec(`
  drop policy if exists "public read church events" on events;
  create policy "public read church events" on events for select to anon
    using (calendar = 'church' and is_private = false);
`);

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub } : {})]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

console.log('\n── the four boxes ──');
let err = null;
try { await db.exec(read('app-home-tiles.sql')); } catch (e) { err = e.message; }
ok('app-home-tiles.sql applies', !err, err);
try { await db.exec(read('app-home-tiles.sql')); err = null; } catch (e) { err = e.message; }
ok('…and applies again', !err, err);

const empty = await db.query('select count(*)::int as n from public.app_home_tiles');
ok('nothing is seeded — the app keeps its own words', empty.rows[0].n === 0);

let r = await as('authenticated', STAFF,
  `insert into public.app_home_tiles (slot, title, subtitle) values ('prayer', 'Pray with us', 'We would love to') returning slot`);
ok('staff write a box', !r.error, r.error);
r = await as('anon', null, `select slot, title from public.app_home_tiles`);
ok('a signed-out phone reads it', !r.error && r.rows.length === 1 && r.rows[0].title === 'Pray with us', JSON.stringify(r));
r = await as('authenticated', MEMBER, `select count(*)::int as n from public.app_home_tiles`);
ok('a signed-in member reads it too', !r.error && r.rows[0].n === 1, JSON.stringify(r));
r = await as('anon', null, `update public.app_home_tiles set title = 'Mine' returning slot`);
ok('nobody else may change one', !!r.error || r.rows.length === 0, JSON.stringify(r));
r = await as('authenticated', MEMBER, `insert into public.app_home_tiles (slot, title) values ('connect', 'Nope')`);
ok('…nor add one', !!r.error, JSON.stringify(r));

r = await as('authenticated', STAFF, `insert into public.app_home_tiles (slot, title) values ('sermons', 'Watch')`);
ok('a box the app doesn’t have is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_home_tiles (slot, title) values ('connect', '${'x'.repeat(25)}')`);
ok('a word too long for a box is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_home_tiles (slot, image_url) values ('connect', 'javascript:alert(1)')`);
ok('a picture that isn’t a web address is refused', !!r.error);
r = await as('authenticated', STAFF,
  `insert into public.app_home_tiles (slot, image_url) values ('connect', 'https://x.org/p.jpg') returning slot`);
ok('a box with only a picture is fine', !r.error, r.error);
r = await as('authenticated', STAFF, `insert into public.app_home_tiles (slot, title) values ('bulletin', '   ')`);
ok('a box of nothing but spaces is refused', !!r.error);
r = await as('authenticated', STAFF, `delete from public.app_home_tiles where slot = 'connect' returning slot`);
ok('and clearing it gives the app its own words back', !r.error && r.rows.length === 1);

await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `update public.app_home_tiles set subtitle = 'Any time' where slot = 'prayer'`);
let moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('a change tells open phones (the Home page’s own kind)', JSON.stringify(moved) === '["home"]', JSON.stringify(moved));

console.log('\n── featured events ──');
try { await db.exec(read('calendar-featured.sql')); err = null; } catch (e) { err = e.message; }
ok('calendar-featured.sql applies', !err, err);
try { await db.exec(read('calendar-featured.sql')); err = null; } catch (e) { err = e.message; }
ok('…and applies again', !err, err);

const cols = (await db.query(`select column_name, column_default, is_nullable from information_schema.columns
                               where table_name = 'events' and column_name in ('featured', 'image_url')`)).rows;
ok('events gain featured (off by default) and a picture', cols.length === 2
  && cols.find((c) => c.column_name === 'featured')?.column_default?.includes('false'), JSON.stringify(cols));

r = await as('authenticated', STAFF, `insert into public.events (title, calendar, start_date, is_private, featured, image_url)
  values ('Revival', 'church', current_date + 3, false, true, 'https://x.org/revival.jpg') returning id`);
ok('staff mark an event featured, with a picture', !r.error, r.error);
r = await as('authenticated', STAFF, `insert into public.events (title, calendar, start_date, is_private, featured)
  values ('Work day', 'church', current_date + 4, false, true) returning id`);
ok('…or featured with no picture yet', !r.error, r.error);
r = await as('authenticated', STAFF, `insert into public.events (title, calendar, start_date, is_private, featured, image_url)
  values ('Bad', 'church', current_date + 5, false, true, 'javascript:alert(1)') returning id`);
ok('a picture that isn’t a web address is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.events (title, calendar, start_date, is_private, featured, image_url)
  values ('Empty', 'church', current_date + 5, false, true, '') returning id`);
ok('an empty picture is refused too — Pillar must send none at all', !!r.error);
r = await as('authenticated', STAFF, `insert into public.events (title, calendar, start_date, is_private, featured)
  values ('Staff only', 'church', current_date + 6, true, true) returning id`);
ok('a private event may be marked too', !r.error, r.error);

r = await as('anon', null, `select title, featured, image_url from public.events order by start_date`);
const titles = (r.rows || []).map((x) => x.title);
ok('a phone reads the flag and the picture', !r.error && r.rows.some((x) => x.featured && x.image_url), JSON.stringify(r).slice(0, 160));
ok('…and a private one is still invisible, featured or not', !titles.includes('Staff only'), JSON.stringify(titles));
ok('the office sees its own events with no picture yet',
  (r.rows || []).some((x) => x.title === 'Work day' && x.featured && x.image_url === null));

await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `update public.events set featured = false where title = 'Work day'`);
moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('marking one tells open phones', JSON.stringify(moved) === '["calendar"]', JSON.stringify(moved));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
