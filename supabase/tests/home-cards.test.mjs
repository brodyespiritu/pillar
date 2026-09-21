// What app-home-cards.sql promises: staff choose the cards under Home's four boxes; members read
// only what is published and in season, signed in or not; a card always has what its kind needs; a
// button can only do one of four known things; and phones hear about changes as they happen.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node home-cards.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const SQL = fs.readFileSync(path.join(SUPA, 'app-home-cards.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();

// what a Supabase project already has, and this migration leans on
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table if not exists public.staff (id uuid primary key, active boolean default true);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  create or replace function public.touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at = now(); return new; end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  insert into public.staff (id) values ('11111111-1111-1111-1111-111111111111');
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
const STAFF = '11111111-1111-1111-1111-111111111111';
const insertAsStaff = (cols) => {
  const keys = Object.keys(cols);
  return as('authenticated', STAFF,
    `insert into public.app_home_cards (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
    keys.map((k) => (typeof cols[k] === 'object' && cols[k] !== null ? JSON.stringify(cols[k]) : cols[k])));
};

console.log('\n── it runs, and runs again ──');
let err = null;
try { await db.exec(SQL); } catch (e) { err = e.message; }
ok('the migration applies', !err, err);
try { await db.exec(SQL); err = null; } catch (e) { err = e.message; }
ok('and applies a second time without complaint', !err, err);

console.log('\n── what Home shows today, seeded once ──');
const seeded = await db.query(`select kind, audience from public.app_home_cards order by sort`);
ok('the plate card for members, the welcome card for everyone else',
  JSON.stringify(seeded.rows) === JSON.stringify([
    { kind: 'dinner', audience: 'signed_in' }, { kind: 'welcome', audience: 'signed_out' }]),
  JSON.stringify(seeded.rows));

console.log('\n── a card has what its kind needs ──');
ok('a picture card needs its picture',
  !!(await insertAsStaff({ kind: 'image', title: 'Easter' })).error);
ok('…and its title',
  !!(await insertAsStaff({ kind: 'image', image_url: 'https://x.org/a.jpg' })).error);
ok('a complete picture card is fine',
  !(await insertAsStaff({ kind: 'image', title: 'Easter', image_url: 'https://x.org/a.jpg' })).error);
ok('a video card needs its video',
  !!(await insertAsStaff({ kind: 'video', title: 'Baptisms' })).error);
ok('a text card needs a title', !!(await insertAsStaff({ kind: 'text', body: 'hello' })).error);
ok('the built-in cards need nothing', !(await insertAsStaff({ kind: 'welcome', sort: 99 })).error);
ok('an unknown kind is refused', !!(await insertAsStaff({ kind: 'banner', title: 'x' })).error);
ok('an unknown audience is refused', !!(await insertAsStaff({ kind: 'text', title: 'x', audience: 'deacons' })).error);

console.log('\n── a draft may be half-written; a card on phones may not ──');
const draft = await insertAsStaff({ kind: 'image', title: 'Half done', published: false });
ok('a draft picture card saves without its picture', !draft.error, draft.error);
ok('an untitled draft saves too', !(await insertAsStaff({ kind: 'text', published: false })).error);
const publish = await as('authenticated', STAFF,
  `update public.app_home_cards set published = true where id = $1 returning id`, [draft.rows?.[0]?.id]);
ok('…but it can’t go on phones until it has one', !!publish.error, JSON.stringify(publish));
const finish = await as('authenticated', STAFF,
  `update public.app_home_cards set image_url = 'https://x.org/p.jpg', published = true where id = $1 returning id`, [draft.rows?.[0]?.id]);
ok('with its picture, it can', !finish.error && finish.rows.length === 1, JSON.stringify(finish));

// a project that ran the first, stricter version of this file gets the looser rule on the next run
await db.exec(`
  alter table public.app_home_cards drop constraint app_home_cards_complete;
  delete from public.app_home_cards where not published;
  alter table public.app_home_cards add constraint app_home_cards_complete check (
    case kind when 'image' then image_url is not null and coalesce(btrim(title), '') <> '' else true end);
`);
ok('(the old rule refuses a draft without a picture)',
  !!(await insertAsStaff({ kind: 'image', title: 'x', published: false })).error);
try { await db.exec(SQL); err = null; } catch (e) { err = e.message; }
ok('running the file again replaces it', !err, err);
ok('…and the draft saves', !(await insertAsStaff({ kind: 'image', title: 'x', published: false })).error);
ok('…while a published card still needs its picture',
  !!(await insertAsStaff({ kind: 'image', title: 'x', published: true })).error);

console.log('\n── a link has to be a web address ──');
ok('a javascript: picture is refused',
  !!(await insertAsStaff({ kind: 'image', title: 'x', image_url: 'javascript:alert(1)' })).error);
ok('a file: video is refused',
  !!(await insertAsStaff({ kind: 'video', title: 'x', video_url: 'file:///etc/passwd' })).error);

console.log('\n── a button can only do one of four things ──');
const withButtons = (buttons) => insertAsStaff({ kind: 'text', title: 'x', buttons });
ok('open a link', !(await withButtons([{ label: 'Read', action: 'url', target: 'https://x.org' }])).error);
ok('open an app page', !(await withButtons([{ label: 'Calendar', action: 'page', target: 'Calendar' }])).error);
ok('reserve a plate', !(await withButtons([{ label: 'Reserve', action: 'plate' }])).error);
ok('play the video', !(await withButtons([{ label: 'Watch', action: 'video' }])).error);
ok('anything else is refused', !!(await withButtons([{ label: 'Do it', action: 'delete-everything' }])).error);
ok('a link that is not a web address is refused',
  !!(await withButtons([{ label: 'Go', action: 'url', target: 'javascript:alert(1)' }])).error);
ok('a page the app does not have is refused',
  !!(await withButtons([{ label: 'Go', action: 'page', target: 'Admin' }])).error);
ok('a button with no label is refused', !!(await withButtons([{ label: ' ', action: 'plate' }])).error);
ok('a label too long for a button is refused',
  !!(await withButtons([{ label: 'x'.repeat(25), action: 'plate' }])).error);
ok('three buttons are one too many', !!(await withButtons([
  { label: 'a', action: 'plate' }, { label: 'b', action: 'plate' }, { label: 'c', action: 'plate' }])).error);
ok('buttons must be a list', !!(await withButtons({ label: 'a', action: 'plate' })).error);

console.log('\n── who reads what ──');
await db.exec(`
  delete from public.app_home_cards;
  insert into public.app_home_cards (kind, title, published, starts_on, ends_on, sort) values
    ('text', 'Live',       true,  null,                     null,                     1),
    ('text', 'Draft',      false, null,                     null,                     2),
    ('text', 'Not yet',    true,  public.church_today() + 3, null,                     3),
    ('text', 'Over',       true,  null,                      public.church_today() - 1, 4),
    ('text', 'Today only', true,  public.church_today(),     public.church_today(),     5);
`);
const titles = (r) => (r.rows || []).map((x) => x.title).join(',');
const anon = await as('anon', null, `select title from public.app_home_cards order by sort`);
ok('signed out: only what is published and in season', titles(anon) === 'Live,Today only', titles(anon) || anon.error);
const member = await as('authenticated', '22222222-2222-2222-2222-222222222222',
  `select title from public.app_home_cards order by sort`);
ok('signed in: the same — a member session must not hide the cards', titles(member) === 'Live,Today only',
  titles(member) || member.error);
const staffRead = await as('authenticated', STAFF, `select title from public.app_home_cards order by sort`);
ok('the office sees its drafts and its scheduled cards too', (staffRead.rows || []).length === 5, titles(staffRead));
const anonWrite = await as('anon', null, `insert into public.app_home_cards (kind, title) values ('text', 'x') returning id`);
ok('the public cannot add a card', !!anonWrite.error || (anonWrite.rows || []).length === 0, anonWrite.error);
const memberWrite = await as('authenticated', '22222222-2222-2222-2222-222222222222',
  `update public.app_home_cards set title = 'hijacked' returning id`);
ok('nor can a member change one', (memberWrite.rows || []).length === 0, JSON.stringify(memberWrite));

console.log('\n── phones hear about changes ──');
const pub = await db.query(`select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and tablename = 'app_home_cards'`);
ok('the table is on the realtime publication', pub.rows.length === 1);

console.log('\n── pictures ──');
const bucket = await db.query(`select public, allowed_mime_types from storage.buckets where id = 'app-media'`);
ok('a public app-media bucket', bucket.rows[0]?.public === true, JSON.stringify(bucket.rows));
ok('for pictures only', JSON.stringify(bucket.rows[0]?.allowed_mime_types) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp']));
const sp = await db.query(`select policyname, qual, with_check from pg_policies
  where schemaname = 'storage' and policyname like '%app media%'`);
ok('staff alone may upload', sp.rows.some((p) => p.policyname === 'staff upload app media'
  && /is_active_staff/.test(p.with_check || '')), JSON.stringify(sp.rows.map((p) => p.policyname)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
