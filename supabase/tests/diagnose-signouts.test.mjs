// diagnose-member-signouts.sql — the read-only look at why a member keeps getting signed out of the app
// (user, 2026-09-24: "A user is stating that they keep getting logged out of the app"). It must run as
// the SQL Editor sends it, change nothing, and say what happened to the member it's pointed at.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node diagnose-signouts.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SUPA, supabaseLikeDb } from './_pg.mjs';

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
};

const { db, migrationError } = await supabaseLikeDb();
ok(!migrationError, 'member-app-auth.sql applies', migrationError || '');
// what hosted Supabase has that the stand-in leaves out: when a session was last renewed, the phone it's
// on, and the renewals themselves
await db.exec(`
  alter table auth.sessions add column if not exists updated_at timestamptz default now(),
    add column if not exists refreshed_at timestamp, add column if not exists user_agent text;
  create table if not exists auth.refresh_tokens (id bigserial primary key, token text, user_id text, revoked boolean,
    created_at timestamptz default now(), updated_at timestamptz default now(), parent text,
    session_id uuid references auth.sessions(id) on delete cascade);
`);
const SQL = fs.readFileSync(path.join(SUPA, 'diagnose-member-signouts.sql'), 'utf8');
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// Peggy: nothing of her own (the family address), signed in three times; the office changed her
// household's address once. One phone session is live, one Supabase refused a renewal on, one is gone.
const hank = (await one(`insert into church_members (name, email, family_id, family_position) values ('Hank Hill', 'hills@example.com', 'H-HILL', 'Head') returning id`)).id;
const peggy = (await one(`insert into church_members (name, family_id, family_position) values ('Peggy Hill', 'H-HILL', 'Spouse') returning id`)).id;
const login = (await one(`insert into auth.users (email, email_confirmed_at, raw_app_meta_data, last_sign_in_at)
  values ('m-1@members.invalid', now(), $1, now()) returning id`, [JSON.stringify({ bbc_member_id: peggy })])).id;
await db.query(`update church_members set auth_user_id = $1, app_login_email = 'm-1@members.invalid', app_linked_at = now() where id = $2`, [login, peggy]);
await db.query(`update church_members set app_not_before = now() - interval '2 days' where id = $1`, [peggy]);
const live = (await one(`insert into auth.sessions (user_id, created_at, user_agent) values ($1, now() - interval '1 hour', 'Bethesda/17 CFNetwork/3826 Darwin/25.0.0') returning id`, [login])).id;
const refused = (await one(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 day') returning id`, [login])).id;
await db.query(`insert into auth.refresh_tokens (token, user_id, revoked, session_id) values ('a', $1, false, $2), ('b', $1, true, $3), ('c', $1, true, $3)`, [login, live, refused]);
const gone = '00000000-0000-4000-8000-00000000dead';
for (const [sid, ago] of [[live, '1 hour'], [refused, '1 day'], [gone, '3 days']]) {
  await db.query(`insert into member_sessions (session_id, member_id, auth_user_id, minted_at, channel, bound_at)
    values ($1, $2, $3, now() - $4::interval, 'email', now() - $4::interval)`, [sid, peggy, login, ago]);
}
await db.query(`insert into member_auth_events (event, channel, member_id, outcome, created_at) values ('signed_in', 'email', $1, 'chosen', now() - interval '1 hour')`, [peggy]);

const before = await one(`select (select count(*) from church_members)::int m, (select count(*) from member_sessions)::int s, (select count(*) from auth.sessions)::int a,
  (select app_not_before from church_members where id = $1) nb`, [peggy]);
let rows = null, err = null;
try {
  rows = await db.transaction(async (tx) => {
    await tx.exec('set transaction read only');
    const r = await tx.exec(SQL.replace("'Their Name'", "'peggy'"));
    return r[r.length - 1].rows;
  });
} catch (e) { err = e.message; }
ok(!err && Array.isArray(rows), 'runs as one script, as the SQL Editor sends it — inside a read-only transaction', err || '');
rows = rows || [];
const said = rows.map((r) => `${r.what}: ${r.detail}`);
const after = await one(`select (select count(*) from church_members)::int m, (select count(*) from member_sessions)::int s, (select count(*) from auth.sessions)::int a,
  (select app_not_before from church_members where id = $1) nb`, [peggy]);
ok(JSON.stringify(before) === JSON.stringify(after), 'changes nothing');
ok(said.some((s) => s.startsWith('their record: Peggy Hill') && s.includes('NOTHING OF THEIR OWN') && s.includes('household H-HILL') && s.includes('allowed in the app')),
  'names the member, and that she signs in on the family address', said[0]);
ok(said.some((s) => s.startsWith('CUT-OFF')), 'shows the cut-off');
ok(said.filter((s) => s.startsWith('app sign-in')).length === 3 && said.some((s) => s.startsWith('app sign-in') && s.includes('SESSION GONE')),
  'lists each sign-in, and which ones are gone', said.filter((s) => s.startsWith('app sign-in')).join(' | '));
ok(said.some((s) => s.startsWith('phone session') && s.includes('2 renewals, 0 unused')) && said.some((s) => s.includes('1 renewals, 1 unused') && s.includes('Bethesda/17')),
  'shows a session Supabase stopped renewing, and the phone and build of a live one', said.filter((s) => s.startsWith('phone session')).join(' | '));
ok(said.some((s) => s.startsWith('sign-in log: signed_in')), 'and the sign-in log');
ok(rows.every((r, i) => i === 0 || r.at === null || rows[i - 1].at === null || new Date(rows[i - 1].at) >= new Date(r.at)), 'newest first');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
