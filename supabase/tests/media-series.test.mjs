// What app-media-series.sql promises: the office can make series and say what is featured, every
// phone can read both signed in or out, nobody else can change them, and the videos the app shows
// today keep showing.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node media-series.test.mjs
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

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub } : {})]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

let err = null;
try { await db.exec(read('app-media-series.sql')); } catch (e) { err = e.message; }
ok('app-media-series.sql applies', !err, err);
try { await db.exec(read('app-media-series.sql')); err = null; } catch (e) { err = e.message; }
ok('…and applies again', !err, err);

console.log('\n── series ──');
let r = await as('authenticated', STAFF, `insert into public.app_media_series (name, subtitle, items, published, sort)
  values ('Life of Moses', 'Four weeks in Exodus', '[{"id":"100","kind":"sermon"},{"id":"200","kind":"video"}]'::jsonb, true, 10)
  returning id, jsonb_array_length(items) as n`);
ok('staff make a series holding sermons and videos', !r.error && r.rows[0].n === 2, r.error);

r = await as('anon', null, `select name, subtitle, items from public.app_media_series where published`);
ok('a signed-out phone reads it', !r.error && r.rows.length === 1 && r.rows[0].name === 'Life of Moses', JSON.stringify(r).slice(0, 140));
r = await as('authenticated', MEMBER, `select count(*)::int n from public.app_media_series`);
ok('a signed-in member reads it too', !r.error && r.rows[0].n === 1, JSON.stringify(r));
r = await as('authenticated', MEMBER, `update public.app_media_series set name = 'Mine'`);
ok('nobody else may change one', !!r.error || (await db.query(`select name from public.app_media_series`)).rows[0].name === 'Life of Moses');
r = await as('anon', null, `insert into public.app_media_series (name) values ('Nope')`);
ok('…nor make one', !!r.error);

r = await as('authenticated', STAFF, `insert into public.app_media_series (name) values ('  ')`);
ok('a series with no name is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_media_series (name) values ('${'x'.repeat(61)}')`);
ok('a name too long for a row title is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_media_series (name, image_url) values ('Bad', 'javascript:alert(1)')`);
ok('a cover that isn’t a web address is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_media_series (name, items) values ('Bad', '{"id":"1"}'::jsonb)`);
ok('items has to be a list', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_media_series (name) values ('New series') returning published, sort`);
ok('a new series starts hidden', !r.error && r.rows[0].published === false, JSON.stringify(r));

console.log('\n── featured ──');
const seeded = await db.query(`select item_id, kind from public.app_media_featured`);
ok('the video the app shows today is already featured, so nothing disappears',
  seeded.rows.length === 1 && seeded.rows[0].kind === 'video', JSON.stringify(seeded.rows));

r = await as('authenticated', STAFF, `insert into public.app_media_featured (item_id, kind, sort) values ('100', 'sermon', 20) returning item_id`);
ok('staff feature a sermon', !r.error, r.error);
r = await as('authenticated', STAFF, `insert into public.app_media_featured (item_id, kind) values ('300', 'resource')`);
ok('only a sermon or a video can be featured', !!r.error);
r = await as('anon', null, `select item_id, kind from public.app_media_featured order by sort`);
ok('a phone reads what is featured, in order', !r.error && r.rows.length === 2 && r.rows[1].item_id === '100', JSON.stringify(r.rows));
r = await as('authenticated', MEMBER, `delete from public.app_media_featured where item_id = '100'`);
ok('a member can’t unfeature anything', (await db.query(`select count(*)::int n from public.app_media_featured`)).rows[0].n === 2);
r = await as('authenticated', STAFF, `delete from public.app_media_featured where item_id = '100' returning item_id`);
ok('staff switch it off again', !r.error && r.rows.length === 1, r.error);

console.log('\n── phones hear about it ──');
await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `update public.app_media_series set subtitle = 'Five weeks' where name = 'Life of Moses'`);
let moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('a change to a series tells open phones (Media’s own kind)', JSON.stringify(moved) === '["media"]', JSON.stringify(moved));

await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `insert into public.app_media_featured (item_id, kind) values ('999', 'sermon')`);
moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('and so does featuring something', JSON.stringify(moved) === '["media"]', JSON.stringify(moved));

const pub = (await db.query(`select tablename from pg_publication_tables
  where pubname = 'supabase_realtime' and tablename like 'app_media%' order by 1`)).rows.map((x) => x.tablename);
ok('both are on the live feed', JSON.stringify(pub) === '["app_media_featured","app_media_series"]', JSON.stringify(pub));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
