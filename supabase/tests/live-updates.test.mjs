// What app-live-updates.sql promises: phones can read when each kind of content last changed, signed
// in or out; only active staff can say something changed; Pillar's own tables say so themselves, once
// per statement, whichever page made the change; a failed signal never blocks the change itself; and
// the order the migrations run in doesn't matter.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node live-updates.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const LIVE = fs.readFileSync(path.join(SUPA, 'app-live-updates.sql'), 'utf8');
const CARDS = fs.readFileSync(path.join(SUPA, 'app-home-cards.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();

const STAFF = '11111111-1111-1111-1111-111111111111';
const FORMER = '22222222-2222-2222-2222-222222222222';
const MEMBER = '33333333-3333-3333-3333-333333333333';

// a Supabase-shaped project with Pillar's calendar and groups tables (but no Home cards yet)
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table public.staff (id uuid primary key, active boolean default true);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  create or replace function public.touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at = now(); return new; end $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public grant usage, select on sequences to anon, authenticated;

  create table public.events (id serial primary key, title text, calendar text default 'church', is_private boolean default false);
  create table public.locations (id serial primary key, name text);
  create table public.church_groups (id uuid primary key default gen_random_uuid(), name text);
  create table public.group_posts (id uuid primary key default gen_random_uuid(), group_id uuid, title text);
  do $$ declare t text; begin
    foreach t in array array['events', 'locations', 'church_groups', 'group_posts'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
      execute format('create policy "staff write" on public.%I for all to authenticated
                        using (public.is_active_staff()) with check (public.is_active_staff())', t);
    end loop;
  end $$;

  insert into public.staff (id, active) values ('${STAFF}', true), ('${FORMER}', false);
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

// set every part's time far back, then report which parts moved after `fn`
const LONG_AGO = '2000-01-01T00:00:00Z';
async function bumped(fn) {
  await db.query(`update public.app_refresh set at = $1`, [LONG_AGO]);
  const r = await fn();
  const moved = (await db.query(`select part from public.app_refresh where at > $1 order by part`, [LONG_AGO])).rows.map((x) => x.part);
  return { moved, r };
}

console.log('\n── it runs, and runs again ──');
let err = null;
try { await db.exec(LIVE); } catch (e) { err = e.message; }
ok('the migration applies', !err, err);
try { await db.exec(LIVE); err = null; } catch (e) { err = e.message; }
ok('and applies a second time without complaint', !err, err);

const parts = (await db.query(`select part from public.app_refresh order by part`)).rows.map((x) => x.part);
ok('a row for each kind of content the app shows',
  JSON.stringify(parts) === JSON.stringify(['announcements', 'calendar', 'groups', 'home', 'live', 'media', 'sermons']),
  JSON.stringify(parts));

const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
ok('phones can listen to it (it is in the realtime publication)', pub.rows.some((r) => r.tablename === 'app_refresh'),
  JSON.stringify(pub.rows));

console.log('\n── who may read, who may say something changed ──');
let r = await as('anon', null, `select part, at from public.app_refresh`);
ok('a signed-out phone reads it', !r.error && r.rows.length === 7, r.error);
r = await as('authenticated', MEMBER, `select part from public.app_refresh`);
ok('a signed-in member reads it', !r.error && r.rows.length === 7, r.error);

r = await as('anon', null, `update public.app_refresh set at = now() where part = 'home' returning part`);
ok('a signed-out phone cannot bump anything', !!r.error || r.rows.length === 0, JSON.stringify(r));
r = await as('anon', null, `insert into public.app_refresh (part) values ('home')`);
ok('…nor add a row', !!r.error, JSON.stringify(r));
r = await as('authenticated', MEMBER, `update public.app_refresh set at = now() returning part`);
ok('a member cannot bump anything', !!r.error || r.rows.length === 0, JSON.stringify(r));
r = await as('authenticated', MEMBER, `delete from public.app_refresh returning part`);
ok('…nor delete the rows', !!r.error || r.rows.length === 0, JSON.stringify(r));

let b = await bumped(() => as('anon', null, `select public.app_touch('home')`));
ok('a signed-out phone cannot call the bump', !!b.r.error && b.moved.length === 0, JSON.stringify(b));
b = await bumped(() => as('authenticated', MEMBER, `select public.app_touch('home')`));
ok('a member cannot call the bump', !!b.r.error && b.moved.length === 0, JSON.stringify(b));
b = await bumped(() => as('authenticated', FORMER, `select public.app_touch('home')`));
ok('a former staff member cannot either', !!b.r.error && b.moved.length === 0, JSON.stringify(b));

b = await bumped(() => as('authenticated', STAFF, `select public.app_touch('announcements')`));
ok('active staff bump one kind — and only that one', !b.r.error && JSON.stringify(b.moved) === '["announcements"]',
  JSON.stringify(b));
b = await bumped(async () => {
  const first = await as('authenticated', STAFF, `select public.app_touch('sermons')`);
  return first.error ? first : as('authenticated', STAFF, `select public.app_touch('sermons')`);
});
ok('bumping twice is fine', !b.r.error && JSON.stringify(b.moved) === '["sermons"]', JSON.stringify(b));
r = await as('authenticated', STAFF, `select public.app_touch('everything')`);
ok('an unknown kind is refused', !!r.error, JSON.stringify(r));
r = await as('authenticated', STAFF, `select count(*)::int as n from public.app_refresh`);
ok('…and adds no row', r.rows?.[0]?.n === 7, JSON.stringify(r));

console.log('\n── Pillar\'s tables say so themselves ──');
b = await bumped(() => as('authenticated', STAFF, `insert into public.events (title) values ('Revival') returning id`));
ok('a new calendar event bumps the calendar', !b.r.error && JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `update public.events set title = 'Revival Week' returning id`));
ok('an edited one does too', !b.r.error && JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `delete from public.events returning id`));
ok('…and a deleted one', !b.r.error && JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `insert into public.locations (name) values ('Fellowship Hall') returning id`));
ok('a place bumps the calendar (events show where they are)', !b.r.error && JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `insert into public.church_groups (name) values ('Women') returning id`));
ok('a group bumps groups', !b.r.error && JSON.stringify(b.moved) === '["groups"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `insert into public.group_posts (title) values ('Dinner out') returning id`));
ok('a group card bumps groups', !b.r.error && JSON.stringify(b.moved) === '["groups"]', JSON.stringify(b));
b = await bumped(() => db.query(`truncate public.locations`));
ok('even emptying a table bumps its kind', JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));

b = await bumped(() => as('authenticated', MEMBER, `insert into public.events (title) values ('Not mine to add') returning id`));
ok('a write the rules refuse bumps nothing', !!b.r.error && b.moved.length === 0, JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `update public.events set title = 'x' where false returning id`));
ok('a statement that touches no rows still only bumps its own kind', !b.r.error && JSON.stringify(b.moved) === '["calendar"]',
  JSON.stringify(b));

// once per statement: count the bumps
await db.exec(`
  create table public._bumps (part text);
  create function public._count_bump() returns trigger language plpgsql as
    $$ begin insert into public._bumps values (new.part); return null; end $$;
  create trigger _count after update on public.app_refresh for each row execute function public._count_bump();
`);
await as('authenticated', STAFF, `insert into public.events (title) select 'Week ' || g from generate_series(1, 12) g`);
const n = (await db.query(`select count(*)::int as n from public._bumps where part = 'calendar'`)).rows[0].n;
ok('a dozen events in one save are one bump, not twelve', n === 1, `bumps: ${n}`);
await db.exec(`drop trigger _count on public.app_refresh; drop function public._count_bump(); drop table public._bumps;`);

console.log('\n── a lost signal never costs the change ──');
await db.exec(`drop table public.app_refresh`);
r = await as('authenticated', STAFF, `insert into public.events (title) values ('Still saved') returning id`);
ok('with the table gone, a calendar save still succeeds', !r.error && r.rows.length === 1, JSON.stringify(r));
r = await as('authenticated', STAFF, `insert into public.group_posts (title) values ('Still saved') returning id`);
ok('…and so does a group card', !r.error && r.rows.length === 1, JSON.stringify(r));
try { await db.exec(LIVE); err = null; } catch (e) { err = e.message; }
ok('running the migration again puts it back', !err, err);
b = await bumped(() => as('authenticated', STAFF, `update public.events set title = title returning id`));
ok('…and the signals flow again', !b.r.error && JSON.stringify(b.moved) === '["calendar"]', JSON.stringify(b));

console.log('\n── either order ──');
let t = await db.query(`select 1 from pg_trigger where tgname = 'trg_app_refresh' and tgrelid = 'public.app_home_cards'::regclass`).catch(() => ({ rows: [] }));
ok('no Home cards table yet, so nothing to join', t.rows.length === 0);
try { await db.exec(CARDS); err = null; } catch (e) { err = e.message; }
ok('app-home-cards.sql runs after it', !err, err);
t = await db.query(`select 1 from pg_trigger where tgname = 'trg_app_refresh' and tgrelid = 'public.app_home_cards'::regclass`);
ok('…and joins in by itself', t.rows.length === 1);
b = await bumped(() => as('authenticated', STAFF,
  `insert into public.app_home_cards (kind, title, audience) values ('text', 'Room change', 'everyone') returning id`));
ok('a Home card bumps home', !b.r.error && JSON.stringify(b.moved) === '["home"]', JSON.stringify(b));
b = await bumped(() => as('authenticated', STAFF, `update public.app_home_cards set published = false returning id`));
ok('taking one down does too', !b.r.error && JSON.stringify(b.moved) === '["home"]', JSON.stringify(b));
try { await db.exec(LIVE); await db.exec(CARDS); err = null; } catch (e) { err = e.message; }
ok('both run again, in the other order, without complaint', !err, err);
t = await db.query(`select count(*)::int as n from pg_trigger where tgname = 'trg_app_refresh' and tgrelid = 'public.app_home_cards'::regclass`);
ok('…leaving exactly one signal on the table', t.rows[0].n === 1, JSON.stringify(t.rows));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
