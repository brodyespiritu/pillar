// What app-report-replies.sql promises (TESTING — goes with the app's test kit): staff answer a tester's
// report and close it out in one step; the answer can be read only with the reply code of the phone that
// sent the report — never from the table, never with another code — and Got it keeps it from coming back.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node report-replies.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const SQL = fs.readFileSync(path.join(SUPA, 'app-report-replies.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();
const STAFF = '11111111-1111-1111-1111-111111111111';
const CODE = 'Ab3dEfGh1jKlMn0pQrStUv-_';          // the phone's reply code (components/testkit/replies.js)
const OTHER = 'Zz9yXw8vUt7sRq6pOn5mLk4j';

// a Supabase-shaped project with just enough of Pillar: staff, the reports table, the live signal
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create table public.staff (id uuid primary key, active boolean default true);
  create or replace function public.is_active_staff() returns boolean language plpgsql stable
    security definer set search_path = public as
    $$ begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end $$;
  create table public.member_access_requests (
    id uuid primary key default gen_random_uuid(), name text not null, contact text not null, message text,
    created_at timestamptz not null default now(), handled_at timestamptz,
    handled_by uuid references public.staff(id) on delete set null);
  create table public.app_refresh (part text primary key, at timestamptz not null default now());
  alter table public.app_refresh add constraint app_refresh_part_check
    check (part in ('home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live'));
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  insert into public.staff (id) values ('${STAFF}');
`);

let err = null;
try { await db.exec(SQL); await db.exec(SQL); } catch (e) { err = e.message; }
ok('app-report-replies.sql applies cleanly, twice', !err, err);

async function as(role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

// two reports: one from this build (with the phone's reply code), one from an older build (without)
const report = (words, code) => `[TEST] Bug: ${words}\n\n— — —\nScreen: Sermons\nPhone: ios 26\nApp: 1.0.0 (15)\nSigned out${code ? `\nReply code: ${code}` : ''}`;
const { rows: [newer] } = await db.query(
  `insert into public.member_access_requests (name, contact, message) values ('Grace', 'grace@example.com', $1) returning id`,
  [report('The Watch page froze', CODE)]);
const { rows: [older] } = await db.query(
  `insert into public.member_access_requests (name, contact, message) values ('Tom', 'tom@example.com', $1) returning id`,
  [report('Old build bug', null)]);

ok('the live signal knows "replies" now',
  (await db.query(`select 1 from public.app_refresh where part = 'replies'`)).rows.length === 1);

// ── answering ──
const reply = (role, sub, id, msg, kind = 'fixed', said = 'The Watch page froze') =>
  as(role, sub, `select public.app_report_reply($1, $2, $3, $4) as id`, [id, msg, kind, said]);

ok('a visitor can\'t answer a report', !!(await reply('anon', null, newer.id, 'Fixed')).error);
ok('a signed-in non-staff user can\'t either',
  /Only church staff/.test((await reply('authenticated', '99999999-9999-9999-9999-999999999999', newer.id, 'Fixed')).error || ''));
ok('an empty answer is refused', /Write what changed/.test((await reply('authenticated', STAFF, newer.id, '   ')).error || ''));
ok('so is one over 600 characters', /under 600/.test((await reply('authenticated', STAFF, newer.id, 'x'.repeat(601))).error || ''));
ok('a report from an older build says why it can\'t be answered on the phone',
  /older version of the app/.test((await reply('authenticated', STAFF, older.id, 'Fixed')).error || ''));

const before = (await db.query(`select at from public.app_refresh where part = 'replies'`)).rows[0].at;
await new Promise((r) => setTimeout(r, 15));
const sent = await reply('authenticated', STAFF, newer.id, '  The Watch page opens straight away now.  ', 'fixed');
ok('staff answer it', !sent.error && !!sent.rows?.[0]?.id, sent.error);
const replyId = sent.rows?.[0]?.id;
const req = (await db.query(`select handled_at, handled_by from public.member_access_requests where id = $1`, [newer.id])).rows[0];
ok('…and that closes the report out, by whoever answered', !!req.handled_at && req.handled_by === STAFF);
const after = (await db.query(`select at from public.app_refresh where part = 'replies'`)).rows[0].at;
ok('…and bumps the "replies" signal, so an open phone looks at once', new Date(after) > new Date(before));
const stored = (await db.query(`select code_hash, kind, said, message from public.app_report_replies where id = $1`, [replyId])).rows[0];
ok('the table keeps a hash of the code, never the code', stored.code_hash.length === 64 && !stored.code_hash.includes(CODE));
ok('the words are trimmed; the kind and what they said are kept',
  stored.message === 'The Watch page opens straight away now.' && stored.kind === 'fixed' && stored.said === 'The Watch page froze');

// ── reading it back ──
ok('nobody reads the table directly — not a visitor', ((await as('anon', null, `select * from public.app_report_replies`)).rows || []).length === 0);
const staffRead = await as('authenticated', STAFF, `select id from public.app_report_replies`);
ok('staff can see what was sent', staffRead.rows?.length === 1, staffRead.error);
ok('no one can write to the table directly',
  !!(await as('authenticated', STAFF, `insert into public.app_report_replies (code_hash, message) values ('x', 'y')`)).error);

const mine = await as('anon', null, `select * from public.app_report_replies_for($1)`, [CODE]);
ok('the phone that sent it gets its answer', mine.rows?.length === 1 && mine.rows[0].message === 'The Watch page opens straight away now.', mine.error);
ok('another phone\'s code gets nothing', ((await as('anon', null, `select * from public.app_report_replies_for($1)`, [OTHER])).rows || []).length === 0);
ok('nor does a code that isn\'t one', ((await as('anon', null, `select * from public.app_report_replies_for($1)`, ['x'])).rows || []).length === 0);

await as('anon', null, `select public.app_report_reply_seen($1, $2)`, [OTHER, replyId]);
ok('someone else can\'t mark it seen', ((await as('anon', null, `select * from public.app_report_replies_for($1)`, [CODE])).rows || []).length === 1);
await as('anon', null, `select public.app_report_reply_seen($1, $2)`, [CODE, replyId]);
ok('Got it: it never comes back', ((await as('anon', null, `select * from public.app_report_replies_for($1)`, [CODE])).rows || []).length === 0);
ok('…and staff can see it arrived',
  !!(await db.query(`select seen_at from public.app_report_replies where id = $1`, [replyId])).rows[0].seen_at);

// an idea, added
const { rows: [idea] } = await db.query(
  `insert into public.member_access_requests (name, contact, message) values ('Grace', 'grace@example.com', $1) returning id`,
  [report('Could the verses page have colours?', CODE).replace('[TEST] Bug', '[TEST] Praise')]);
await reply('authenticated', STAFF, idea.id, 'Saved Verses shows each verse in its colour now.', 'added', 'Could the verses page have colours?');
const next = await as('anon', null, `select kind from public.app_report_replies_for($1)`, [CODE]);
ok('an idea added comes back as one', next.rows?.[0]?.kind === 'added', next.error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
