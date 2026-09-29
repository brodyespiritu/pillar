// What member-requests.sql promises: a signed-in member can ask for a change (words and/or a photo) or
// for their account to be deleted, and see whether one is still waiting — and nothing else. Only staff
// read the requests and close them out; a photo reaches the member's record only when staff use it.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node member-requests.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const SQL = fs.readFileSync(path.join(SUPA, 'member-requests.sql'), 'utf8');

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
  create table public.church_members (id uuid primary key, name text, photo_url text);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  -- the real one resolves a church-code session; here the signed-in user IS the member
  create or replace function public.app_caller_member_id() returns uuid language sql stable
    security definer set search_path = '' as
    $$ select m.id from public.church_members m where m.id = auth.uid() $$;
  revoke all on function public.app_caller_member_id() from public, anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  insert into public.staff (id) values ('${STAFF}');
  insert into public.church_members (id, name) values ('${ANN}', 'Ann Lee'), ('${BEN}', 'Ben Cole');
  grant select, update on public.church_members to authenticated;
`);

let err = null;
try { await db.exec(SQL); await db.exec(SQL); } catch (e) { err = e.message; }
ok('member-requests.sql applies cleanly, twice', !err, err);

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

const PHOTO = `data:image/jpeg;base64,${'QUJD'.repeat(50)}`;

// ── asking ──
let r = await as('anon', null, `select public.member_request('change', 'hi', null) v`);
ok('signed out: no requests', /permission denied/.test(r.error || ''), r.error || 'it ran');
r = await as('authenticated', ANN, `select public.member_request('change', null, $1, $2::jsonb) v`,
  [PHOTO, JSON.stringify({ name: '  Ann Lee-Park ', phone: '706-555-0101' })]);
ok('a member sends their edited details and a new photo', !r.error && r.rows[0].v.change === true && r.rows[0].v.delete === false, r.error || JSON.stringify(r.rows[0]?.v));
let row = (await db.query(`select * from public.member_requests where member_id = $1`, [ANN])).rows[0];
ok('kept trimmed, with the photo, waiting', row && row.changes.name === 'Ann Lee-Park' && row.changes.phone === '706-555-0101'
  && row.message === null && row.photo === PHOTO && row.handled_at === null, JSON.stringify(row?.changes));
r = await as('authenticated', ANN, `select public.member_open_requests() v`);
ok('they see it waiting ("Updating…" in the app)', !r.error && r.rows[0].v.change === true, JSON.stringify(r.rows[0]?.v));
r = await as('authenticated', BEN, `select public.member_open_requests() v`);
ok("another member sees nothing of it", !r.error && r.rows[0].v.change === false && r.rows[0].v.delete === false);
r = await as('authenticated', BEN, `select public.member_request('delete', 'I moved away.') v`);
ok('a member asks for their account to be deleted, with a reason', !r.error && r.rows[0].v.delete === true, r.error);

// ── what is refused ──
for (const [name, sql, params] of [
  ['an empty request', `select public.member_request('change', '   ', null)`, []],
  ['a request of another kind', `select public.member_request('rename', 'x', null)`, []],
  ['a photo with a deletion', `select public.member_request('delete', 'bye', $1)`, [PHOTO]],
  ['a photo that is a link, not a picture', `select public.member_request('change', null, 'https://x.org/me.jpg')`, []],
  ['a photo far too big', `select public.member_request('change', null, $1)`, [`data:image/jpeg;base64,${'A'.repeat(600001)}`]],
  ['words far too long', `select public.member_request('change', $1, null)`, ['x'.repeat(1001)]],
  ['a detail members can\'t ask for here', `select public.member_request('change', null, null, $1::jsonb)`, [JSON.stringify({ address: '1 Elm' })]],
  ['a blank detail', `select public.member_request('change', null, null, $1::jsonb)`, [JSON.stringify({ name: '   ' })]],
  ['a detail far too long', `select public.member_request('change', null, null, $1::jsonb)`, [JSON.stringify({ email: `${'x'.repeat(200)}@x.org` })]],
  ['details that aren\'t a list', `select public.member_request('change', null, null, $1::jsonb)`, [JSON.stringify(['name'])]],
  ['details with a deletion', `select public.member_request('delete', 'bye', null, $1::jsonb)`, [JSON.stringify({ name: 'X' })]],
]) {
  r = await as('authenticated', ANN, sql, params);
  ok(`refused: ${name}`, !!r.error, 'it was accepted');
}
for (let i = 0; i < 4; i++) await as('authenticated', ANN, `select public.member_request('change', $1, null)`, [`request ${i}`]);
r = await as('authenticated', ANN, `select public.member_request('change', 'one too many', null)`);
ok('five waiting at once, then no more until the office catches up', /too many requests waiting/.test(r.error || ''), r.error || 'accepted');

// ── members never touch the table ──
r = await as('authenticated', ANN, `select count(*)::int n from public.member_requests`);
ok("a member can't read the requests", !!r.error || r.rows[0].n === 0, JSON.stringify(r.rows?.[0]));
r = await as('authenticated', ANN, `insert into public.member_requests (member_id, kind, message) values ($1, 'change', 'sneaky')`, [BEN]);
ok("nor add one in someone else's name", !!r.error);
r = await as('authenticated', ANN, `update public.member_requests set handled_at = now() returning id`);
ok('nor close their own', !!r.error || r.rows.length === 0);
r = await as('anon', null, `select count(*)::int n from public.member_requests`);
ok('and nobody signed out reads a thing', !!r.error || r.rows[0].n === 0);

// ── the office ──
r = await as('authenticated', STAFF, `select r.id, r.kind, r.message, r.photo is not null has_photo, m.name
  from public.member_requests r join public.church_members m on m.id = r.member_id where r.handled_at is null order by r.created_at`);
ok('staff read every waiting request, with who sent it', !r.error && r.rows.length === 6 && r.rows[0].name === 'Ann Lee' && r.rows[0].has_photo, r.error || r.rows.length);
const first = r.rows[0].id;
// Approve: the changes and the photo onto the record, and the request closed out
r = await as('authenticated', STAFF, `update public.church_members m set name = coalesce(q.changes ->> 'name', m.name), photo_url = coalesce(q.photo, m.photo_url)
  from public.member_requests q where q.id = $1 and m.id = q.member_id returning m.name, m.photo_url`, [first]);
ok('what they asked for goes on the record only when staff approve it', !r.error && r.rows[0].name === 'Ann Lee-Park' && r.rows[0].photo_url === PHOTO, r.error);
r = await as('authenticated', STAFF, `update public.member_requests set handled_at = now(), handled_by = $2, outcome = 'approved'
  where id = $1 returning outcome`, [first, STAFF]);
ok('and staff close it out', !r.error && r.rows[0].outcome === 'approved', r.error);
await as('authenticated', STAFF, `update public.member_requests set handled_at = now(), outcome = 'done' where member_id = $1 and handled_at is null`, [ANN]);
r = await as('authenticated', ANN, `select public.member_open_requests() v`);
ok('with nothing waiting, "Updating…" goes away', !r.error && r.rows[0].v.change === false, JSON.stringify(r.rows[0]?.v));
r = await as('authenticated', STAFF, `update public.member_requests set outcome = 'maybe' where member_id = $1 returning id`, [BEN]);
ok('only the three outcomes', !!r.error);

// running the file again keeps every request
err = null;
try { await db.exec(SQL); } catch (e) { err = e.message; }
const kept = (await db.query(`select count(*)::int n from public.member_requests`)).rows[0].n;
ok('running it again keeps every request', !err && kept === 6, err || kept);   // Ann's five, Ben's one

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
