// What group-posts.sql promises: staff write the group cards; the public reads only published cards
// inside their window, by the church's own date; a button is a label AND a web address; and a change
// tells open phones when instant updates are set up, whichever file ran first.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node group-posts.test.mjs
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
await db.exec(read('groups-schema.sql'));

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub } : {})]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

console.log('\n── it runs, and runs again ──');
let err = null;
try { await db.exec(read('group-posts.sql')); } catch (e) { err = e.message; }
ok('the migration applies', !err, err);
try { await db.exec(read('group-posts.sql')); err = null; } catch (e) { err = e.message; }
ok('and applies a second time without complaint', !err, err);

console.log('\n── the church\'s own date ──');
const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const today = (await db.query(`select public.church_today()::text as d`)).rows[0].d;
ok('church_today() is today in Georgia', today === et, `${today} vs ${et}`);
const late = (await db.query(`select (timestamptz '2026-09-20 23:30:00-04' at time zone 'America/New_York')::date::text as d`)).rows[0].d;
ok('(half past eleven on a Sunday night there is still Sunday)', late === '2026-09-20', late);

console.log('\n── what the public reads ──');
await db.exec(`
  insert into public.group_posts (title, published, starts_on, ends_on, sort) values
    ('Live',       true,  null,                      null,                      1),
    ('Draft',      false, null,                      null,                      2),
    ('Not yet',    true,  public.church_today() + 1, null,                      3),
    ('Over',       true,  null,                      public.church_today() - 1, 4),
    ('Today only', true,  public.church_today(),     public.church_today(),     5);
`);
let r = await as('anon', null, `select title from public.group_posts order by sort`);
ok('only published cards inside their window',
  JSON.stringify((r.rows || []).map((x) => x.title)) === JSON.stringify(['Live', 'Today only']), JSON.stringify(r));
r = await as('authenticated', STAFF, `select count(*)::int as n from public.group_posts`);
ok('staff see every card, drafts included', r.rows?.[0]?.n === 5, JSON.stringify(r));

console.log('\n── who writes ──');
r = await as('anon', null, `insert into public.group_posts (title) values ('Spam')`);
ok('the public cannot add a card', !!r.error, JSON.stringify(r));
r = await as('anon', null, `update public.group_posts set title = 'x' returning id`);
ok('…nor change one', !!r.error || r.rows.length === 0, JSON.stringify(r));
r = await as('authenticated', STAFF, `insert into public.group_posts (title, button_label, button_url) values ('Supper', 'Sign up', 'https://x.org/s') returning id`);
ok('staff add a card with a button', !r.error, r.error);
r = await as('authenticated', STAFF, `insert into public.group_posts (title, button_label) values ('Supper', 'Sign up')`);
ok('a button with nowhere to go is refused', !!r.error, JSON.stringify(r));
r = await as('authenticated', STAFF, `insert into public.group_posts (title, button_label, button_url) values ('x', 'Go', 'javascript:alert(1)')`);
ok('a link the app would not open is refused', !!r.error, JSON.stringify(r));

console.log('\n── telling open phones ──');
let t = await db.query(`select count(*)::int as n from pg_trigger where tgname = 'trg_app_refresh' and tgrelid = 'public.group_posts'::regclass`);
ok('no instant updates yet, so no signal (and no error)', t.rows[0].n === 0);
try { await db.exec(read('app-live-updates.sql')); err = null; } catch (e) { err = e.message; }
ok('app-live-updates.sql runs after it', !err, err);
try { await db.exec(read('group-posts.sql')); err = null; } catch (e) { err = e.message; }
ok('group-posts.sql runs again after that', !err, err);
t = await db.query(`select count(*)::int as n from pg_trigger where tgname = 'trg_app_refresh' and tgrelid = 'public.group_posts'::regclass`);
ok('…with exactly one signal on the table', t.rows[0].n === 1, JSON.stringify(t.rows));
await db.query(`update public.app_refresh set at = '2000-01-01'`);
r = await as('authenticated', STAFF, `update public.group_posts set sort = sort + 1 returning id`);
const moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01' order by part`)).rows.map((x) => x.part);
ok('a staff edit tells phones showing groups', !r.error && JSON.stringify(moved) === '["groups"]', JSON.stringify({ r, moved }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
