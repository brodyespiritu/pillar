// What app-page-headers.sql promises: the office picks the photo at the top of Home, Directory and
// Groups; every phone reads it, signed in or not; nobody else changes it; and a change reaches open
// phones (it signals 'home' through app-live-updates.sql).
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node page-headers.test.mjs
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
  insert into public.staff (id) values ('${STAFF}');
`);
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
try { await db.exec(read('app-page-headers.sql')); await db.exec(read('app-page-headers.sql')); } catch (e) { err = e.message; }
ok('app-page-headers.sql applies, twice', !err, err);
ok('nothing is seeded — every page keeps the app’s own photo', (await db.query('select count(*)::int n from public.app_page_headers')).rows[0].n === 0);

const before = (await db.query(`select at from public.app_refresh where part = 'home'`)).rows[0]?.at;
let r = await as('authenticated', STAFF, `insert into public.app_page_headers (page, image_url) values ('directory', 'https://x.supabase.co/storage/v1/object/public/app-media/home/a.jpg')
  on conflict (page) do update set image_url = excluded.image_url returning page`);
ok('staff set a page’s photo', !r.error, r.error);
const after = (await db.query(`select at from public.app_refresh where part = 'home'`)).rows[0]?.at;
ok('and open phones are told (the home signal moves)', after && (!before || new Date(after) > new Date(before)), `${before} → ${after}`);

r = await as('anon', null, `select page, image_url from public.app_page_headers`);
ok('phones read it signed out', !r.error && r.rows.length === 1 && r.rows[0].page === 'directory', r.error);
r = await as('authenticated', MEMBER, `select page from public.app_page_headers`);
ok('and signed in', !r.error && r.rows.length === 1, r.error);
r = await as('authenticated', MEMBER, `update public.app_page_headers set image_url = 'https://evil.example/x.jpg' returning page`);
ok('a member can’t change one', !!r.error || r.rows.length === 0);
r = await as('anon', null, `insert into public.app_page_headers (page, image_url) values ('groups', 'https://x.org/a.jpg')`);
ok('nor can anyone signed out', !!r.error);

for (const [name, sql] of [
  ['a page the app doesn’t have', `insert into public.app_page_headers (page, image_url) values ('calendar', 'https://x.org/a.jpg')`],
  ['a picture that isn’t https', `insert into public.app_page_headers (page, image_url) values ('groups', 'http://x.org/a.jpg')`],
  ['a picture that isn’t a link', `insert into public.app_page_headers (page, image_url) values ('groups', 'javascript:alert(1)')`],
]) {
  r = await as('authenticated', STAFF, sql);
  ok(`refused: ${name}`, !!r.error, 'accepted');
}
r = await as('authenticated', STAFF, `update public.app_page_headers set image_url = null where page = 'directory' returning image_url`);
ok('clearing one gives the page its own photo back', !r.error && r.rows[0].image_url === null, r.error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
