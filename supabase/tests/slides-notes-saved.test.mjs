// What app-slides-notes-saved.sql promises: the office posts slides and fill-in-the-blank notes that
// every phone can read; what a member keeps is theirs alone, reachable only through the three
// functions, and never by another member — signed in or not.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node slides-notes-saved.test.mjs
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
const ANN   = '22222222-2222-2222-2222-222222222222';   // a member
const BEN   = '33333333-3333-3333-3333-333333333333';   // another member

// a Supabase-shaped project with just enough of Pillar's member world
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table public.staff (id uuid primary key, active boolean default true);
  create table public.church_members (id uuid primary key, name text);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  -- the real one resolves a church-code session; here the signed-in user IS the member
  create or replace function public.app_caller_member_id() returns uuid language sql stable
    security definer set search_path = '' as
    $$ select m.id from public.church_members m where m.id = auth.uid() $$;
  revoke all on function public.app_caller_member_id() from public, anon, authenticated;
  create or replace function public.touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at = now(); return new; end $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  insert into public.staff (id) values ('${STAFF}');
  insert into public.church_members (id, name) values ('${ANN}', 'Ann'), ('${BEN}', 'Ben');
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
try { await db.exec(read('app-slides-notes-saved.sql')); } catch (e) { err = e.message; }
ok('app-slides-notes-saved.sql applies', !err, err);
try { await db.exec(read('app-slides-notes-saved.sql')); err = null; } catch (e) { err = e.message; }
ok('…and applies again', !err, err);

console.log('\n── the slides from Sunday ──');
let r = await as('authenticated', STAFF, `insert into public.app_bulletin_slides (image_url, caption, published, sort)
  values ('https://x.org/slide1.jpg', 'Welcome', true, 10) returning id`);
ok('staff post a slide', !r.error, r.error);
r = await as('anon', null, `select image_url, caption from public.app_bulletin_slides`);
ok('a phone reads it, signed in or out', !r.error && r.rows.length === 1, JSON.stringify(r).slice(0, 120));
r = await as('authenticated', ANN, `insert into public.app_bulletin_slides (image_url) values ('https://x.org/no.jpg')`);
ok('a member can’t post one', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_bulletin_slides (image_url) values ('javascript:alert(1)')`);
ok('a slide that isn’t a picture on the web is refused', !!r.error);

console.log('\n── the notes ──');
r = await as('authenticated', STAFF, `insert into public.app_sermon_notes (title, speaker, body, video_url, published)
  values ('The Life of Moses', 'Pastor', 'God is ___ in all things.', 'https://x.org/v.m3u8', true) returning id`);
ok('staff write a sheet with a blank in it', !r.error, r.error);
const sheet = (await db.query(`select id from public.app_sermon_notes limit 1`)).rows[0].id;
r = await as('anon', null, `select title, body from public.app_sermon_notes`);
ok('a phone reads it', !r.error && /___/.test(r.rows[0].body), JSON.stringify(r).slice(0, 120));
r = await as('authenticated', STAFF, `insert into public.app_sermon_notes (title, body) values ('  ', 'x')`);
ok('a sheet with no title is refused', !!r.error);
r = await as('authenticated', STAFF, `insert into public.app_sermon_notes (title, body, video_url) values ('t', 'b', 'javascript:1')`);
ok('a video that isn’t a web address is refused', !!r.error);

console.log('\n── what a member keeps ──');
r = await as('authenticated', ANN, `select * from public.member_saved`);
ok('nobody reads the table directly, not even its owner', !!r.error, JSON.stringify(r).slice(0, 100));
r = await as('authenticated', ANN, `select public.app_caller_member_id()`);
ok('and nobody can ask who they are directly either', !!r.error);

r = await as('authenticated', ANN, `select public.member_save('sermon', 's1', '{"title":"Moses"}'::jsonb)`);
ok('a member stars a sermon', !r.error, r.error);
r = await as('authenticated', ANN, `select public.member_save('notes', '${sheet}', '{"0":"faithful"}'::jsonb)`);
ok('…and keeps the answers they typed', !r.error, r.error);
r = await as('authenticated', ANN, `select kind, ref, data from public.member_saved_list()`);
ok('they get both back', !r.error && r.rows.length === 2, JSON.stringify(r).slice(0, 160));
r = await as('authenticated', ANN, `select kind from public.member_saved_list('sermon')`);
ok('…or just the sermons', !r.error && r.rows.length === 1 && r.rows[0].kind === 'sermon');

r = await as('authenticated', BEN, `select kind, ref from public.member_saved_list()`);
ok('another member sees none of it', !r.error && r.rows.length === 0, JSON.stringify(r.rows));
r = await as('authenticated', BEN, `select public.member_save('sermon', 's1', '{"title":"Mine"}'::jsonb)`);
const anns = await db.query(`select data ->> 'title' as t from public.member_saved where member_id = '${ANN}' and ref = 's1'`);
ok('…and saving the same sermon doesn’t touch theirs', anns.rows[0].t === 'Moses', JSON.stringify(anns.rows));

r = await as('anon', null, `select public.member_saved_list()`);
ok('a signed-out phone gets nothing', !!r.error || r.rows.length === 0, JSON.stringify(r).slice(0, 100));
r = await as('anon', null, `select public.member_save('sermon', 's9')`);
ok('…and can’t save anything', !!r.error);

r = await as('authenticated', ANN, `select public.member_save('nonsense', 'x')`);
ok('only a sermon or notes can be kept', !!r.error);

r = await as('authenticated', ANN, `select public.member_unsave('sermon', 's1')`);
const left = (await db.query(`select count(*)::int n from public.member_saved where member_id = '${ANN}'`)).rows[0].n;
ok('a member takes a star off again', !r.error && left === 1, `${r.error || left}`);
r = await as('authenticated', BEN, `select public.member_unsave('sermon', 's1')`);
const bens = (await db.query(`select count(*)::int n from public.member_saved where member_id = '${BEN}'`)).rows[0].n;
ok('…and only ever their own', bens === 0);

console.log('\n── phones hear about it ──');
await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `update public.app_bulletin_slides set caption = 'Welcome home'`);
let moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('a new slide reaches an open bulletin', JSON.stringify(moved) === '["announcements"]', JSON.stringify(moved));
await db.query(`update public.app_refresh set at = '2000-01-01'`);
await as('authenticated', STAFF, `update public.app_sermon_notes set body = 'God is ___ and ___.'`);
moved = (await db.query(`select part from public.app_refresh where at > '2000-01-01'`)).rows.map((x) => x.part);
ok('and new notes reach an open Bible page', JSON.stringify(moved) === '["sermons"]', JSON.stringify(moved));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
