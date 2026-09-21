// Member sign-in (supabase/member-app-auth.sql) against an in-memory Postgres (PGlite) that imitates
// Supabase: anon/authenticated/service_role, auth.users/sessions/identities, auth.uid()/auth.jwt().
//
// Run:   cd supabase/tests && npm i --no-save @electric-sql/pglite && node member-auth.test.mjs
//   or:  PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node member-auth.test.mjs
// Node 22.6+ (it imports functions/_shared/memberContact.ts directly for the SQL ↔ TS parity check).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SUPA, supabaseLikeDb } from './_pg.mjs';

const { normEmail, normPhone } = await import(pathToFileURL(path.join(SUPA, 'functions/_shared/memberContact.ts')).href);

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};
const section = (t) => console.log(`\n── ${t}`);

const { db, as, migrationError } = await supabaseLikeDb();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// ── Migration (applied twice by _pg.mjs) ─────────────────────────────────────
section('migration');
ok(!migrationError, 'member-app-auth.sql applies cleanly, twice', migrationError || '');
if (migrationError) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const fnExists = async (name) => (await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name])).n > 0;
for (const f of ['member_claim', 'app_caller_email', 'app_caller_phone', 'app_auth_user_for_identifier', 'app_members_for_identifier', 'app_rate_check', 'app_phone10']) {
  ok(!(await fnExists(f)), `v1 function ${f} is gone`);
}
const careRule = await one(`select qual from pg_policies where tablename = 'care_members' and policyname = 'staff read care'`);
ok(/is_active_staff/.test(careRule.qual) && !/auth\.role/.test(careRule.qual), 'any-signed-in policy rewritten to staff-only', careRule.qual);
const storageRule = await one(`select with_check from pg_policies where tablename = 'objects' and policyname = 'website images upload'`);
ok(/is_active_staff/.test(storageRule.with_check), 'authenticated-only storage rule gets a staff check', storageRule.with_check);
const startSettings = await one(`select signin_enabled, sms_enabled, email_enabled from app_auth_settings`);
ok(startSettings.signin_enabled && startSettings.email_enabled && startSettings.sms_enabled === false, 'sign-in starts with email on and texting off', JSON.stringify(startSettings));

// ── SQL ↔ TypeScript parity ──────────────────────────────────────────────────
section('contact normalisation parity (SQL vs functions/_shared/memberContact.ts)');
const EMAILS = [
  'Mary@Example.com', '  mary@example.com\t', 'mary.o+church@example.co.uk', "o'brien@example.com", 'mary@example',
  'mary@@example.com', 'mary @example.com', 'mary@exa_mple.com', 'mary@-example.com', 'mary@example-.com',
  'maría@example.com', 'mary@example.com.', '', '   ', 'a@b.co', 'mary@example.com, john@example.com',
  'x'.repeat(250) + '@e.co', 'MARY@EXAMPLE.COM\n', 'mary@sub.example.org', '"mary"@example.com',
];
const PHONES = [
  '(706) 555-0100', '(706) 312-0100', '706-312-0100', '706.312.0100', '+1 706 312 0100', '1-706-312-0100', '17063120100',
  '7063120100', ' 7063120100 ', '706 312 0100 ext 12', '706-312-0100 x12', '706-312-0100 / 706-312-0199', '312-0100',
  '0063120100', '1063120100', '7060120100', '7061120100', '4113120100', '8003120100', '8883120100', '9003120100',
  '8763120100', '8093120100', '2423120100', '3403120100', '7873120100', '4163120100', '2222222222', '(251) 509-9295',
  '+44 20 7946 0958', '27063120100', '', 'abc', '706-312-O100', '+1(706)312-0100', '911', '706 311 0100', '5003120100',
  '5013120100', '6583120100', '4043120100', '4703120100',
];
let parityBad = [];
for (const e of EMAILS) {
  const s = (await one(`select public.app_norm_email($1) v`, [e])).v;
  if (s !== normEmail(e)) parityBad.push(`email ${JSON.stringify(e)} sql=${s} ts=${normEmail(e)}`);
}
for (const p of PHONES) {
  const s = (await one(`select public.app_norm_phone($1) v`, [p])).v;
  if (s !== normPhone(p)) parityBad.push(`phone ${JSON.stringify(p)} sql=${s} ts=${normPhone(p)}`);
}
ok(parityBad.length === 0, `SQL and TypeScript agree on ${EMAILS.length + PHONES.length} inputs`, parityBad.join(' | '));
ok(normPhone('(706) 312-0100') === '7063120100' && normPhone('+1 706 312 0100') === '7063120100', 'formats of one number normalise the same');
ok([ '706 312 0100 ext 12', '8003120100', '8763120100', '2222222222', '7065550100', '9003120100' ].every((p) => normPhone(p) === null),
  'extensions, toll-free, Caribbean, repeated digits, 555 and premium numbers are not sign-in contacts');
ok(normPhone('3403120100') === '3403120100' && normPhone('7873120100') === '7873120100' && normPhone('4163120100') === '4163120100',
  'US territories and Canada are allowed');
ok(normEmail('Mary@Example.com') === 'mary@example.com' && normEmail('maría@example.com') === null, 'emails lowercased; non-ASCII rejected');

// ── Seed ─────────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const STAFF = uid(), STAFF_OLD = uid();
await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'pastor@church.test', now()), ($2, 'former@church.test', now())`, [STAFF, STAFF_OLD]);
await db.query(`insert into staff (id, name, email, role, active) values ($1, 'Pastor', 'pastor@church.test', 'Admin', true), ($2, 'Former', 'former@church.test', 'Staff', false)`, [STAFF, STAFF_OLD]);

async function member(fields) {
  const cols = Object.keys(fields);
  const r = await one(`insert into church_members (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(fields));
  return r.id;
}
const M = {
  alice:   await member({ name: 'Alice Adams', email: 'Alice@Example.com ', phone: '(706) 312-0101', address: '1 Main', birthday: '1980-02-02', notes: 'private note', tags: 'choir', family_id: 'H-ADAMS' }),
  bob:     await member({ name: 'Bob Brown', phone: '706.312.0102', family_id: 'H-BROWN' }),                                         // age unknown, own number
  john:    await member({ name: 'John Smith', email: 'smiths@example.com', family_id: 'H-SMITH', family_position: 'Head' }),
  jane:    await member({ name: 'Jane Smith', email: 'smiths@example.com', family_id: 'H-SMITH', family_position: 'Spouse' }),
  jimmy:   await member({ name: 'Jimmy Smith', email: 'smiths@example.com', family_id: 'H-SMITH' }),                               // no age data → never offered on a shared contact
  kid:     await member({ name: 'Kid Brown', phone: '706-312-0103', family_id: 'H-BROWN', family_position: 'Child' }),
  teen:    await member({ name: 'Teen Adams', email: 'teen@example.com', birthday: '2014-06-01', family_id: 'H-ADAMS' }),
  gone:    await member({ name: 'Inactive Ivy', email: 'ivy@example.com', status: 'Inactive' }),
  prospect:await member({ name: 'Paul Prospect', email: 'paul@example.com', record_type: 'Prospect' }),
  denied:  await member({ name: 'Denied Dan', email: 'dan@example.com', app_access: 'deny' }),
  cousinA: await member({ name: 'Carl Cousin', email: 'cousins@example.com', family_id: 'H-C1', family_position: 'Head' }),
  cousinB: await member({ name: 'Cora Cousin', email: 'cousins@example.com', family_id: 'H-C2', family_position: 'Head' }),
  office:  await member({ name: 'Office Oscar', phone: '706-312-0199', family_id: 'H-O' }),
  noAdult1:await member({ name: 'Unknown One', email: 'shared@example.com', family_id: 'H-U' }),
  noAdult2:await member({ name: 'Unknown Two', email: 'shared@example.com', family_id: 'H-U' }),
};
await db.query(`insert into app_contact_blocklist (contact_norm, note) values ('7063120199', 'office line')`);
const staffJwt = { sub: STAFF, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] };

// ── Eligibility and candidates ───────────────────────────────────────────────
section('eligibility and candidates');
const elig = async (id) => (await one(`select public.app_member_is_eligible(m) v from church_members m where id = $1`, [id])).v;
ok(await elig(M.alice) && await elig(M.bob), 'active adults and unknown-age records are eligible');
ok(!(await elig(M.kid)) && !(await elig(M.teen)), 'children (family position or birthday) are not eligible');
ok(!(await elig(M.gone)) && !(await elig(M.prospect)) && !(await elig(M.denied)), 'inactive, prospect and denied records are not eligible');
const cands = async (email, phone, since = null) => all(`select member_id, name, matched_count from public.app_login_candidates($1, $2, $3)`, [email, phone, since]);
let c = await cands('  ALICE@example.com', null);
ok(c.length === 1 && c[0].member_id === M.alice, 'email match ignores case and spaces', JSON.stringify(c));
c = await cands(null, '+1 (706) 312-0101');
ok(c.length === 1 && c[0].member_id === M.alice, 'phone match ignores formatting');
c = await cands(null, '7063120102');
ok(c.length === 1 && c[0].member_id === M.bob, 'a record with unknown age signs in when it is the only one with that contact');
c = await cands('smiths@example.com', null);
ok(c.length === 2 && c.map((r) => r.name).join() === 'Jane Smith,John Smith' && c[0].matched_count === 3,
  'shared family email offers only the known adults of that household', JSON.stringify(c));
ok((await cands('cousins@example.com', null)).length === 0, 'a contact shared by adults of different households offers no one');
ok((await cands('shared@example.com', null)).length === 0, 'a shared contact with no known adults offers no one');
ok((await cands(null, '706-312-0199')).length === 0, 'blocklisted contact offers no one');
ok((await cands('teen@example.com', null)).length === 0 && (await cands(null, '706-312-0103')).length === 0, "a child's own contact offers no one");
ok((await cands('ivy@example.com', null)).length === 0 && (await cands('paul@example.com', null)).length === 0, 'ineligible records are never offered');
ok((await cands('alice@example.com', '7063120101')).length === 0 && (await cands(null, null)).length === 0, 'exactly one contact is required');
ok((await cands('nobody@example.com', null)).length === 0, 'unknown contact offers no one');
{
  // a family on one address: the adults with nothing of their own are offered too (user, 2026-09-15)
  const dad  = await member({ name: 'Dave Ward', email: 'wards@example.com', family_id: 'H-WARD', family_position: 'Head' });
  const mom  = await member({ name: 'Wendy Ward', family_id: 'H-WARD', family_position: 'Spouse' });
  const kid  = await member({ name: 'Wally Ward', family_id: 'H-WARD', family_position: 'Child' });
  const gran = await member({ name: 'Gail Ward', family_id: 'H-WARD', family_position: 'Head', birthday: '1950-01-01', phone: '706-312-0190' });
  const near = await member({ name: 'Nora Next', family_id: 'H-NEXT', family_position: 'Spouse' });
  let w = await cands('wards@example.com', null);
  ok(w.map((r) => r.name).join() === 'Dave Ward,Wendy Ward', 'a wife with no email of her own is offered on the family address', JSON.stringify(w));
  ok(!w.some((r) => r.name === 'Wally Ward'), '… never the children');
  ok(!w.some((r) => r.name === 'Gail Ward'), '… nor anyone who has a contact of their own (she signs in with hers)');
  ok(!w.some((r) => r.name === 'Nora Next'), '… nor another household');
  ok(w.every((r) => r.matched_count === 2), '… and the count says two people share the address, so the app asks');
  await db.query(`update church_members set family_position = null where id = $1`, [mom]);
  w = await cands('wards@example.com', null);
  ok(w.map((r) => r.name).join() === 'Dave Ward', '… only adults: no position and no birthday means no offer');
  await db.query(`update church_members set family_position = 'Spouse' where id = $1`, [mom]);
  await db.query(`update church_members set status = 'Inactive' where id = $1`, [mom]);
  w = await cands('wards@example.com', null);
  ok(w.map((r) => r.name).join() === 'Dave Ward', '… nor an inactive record');
  await db.query(`update church_members set status = 'Active' where id = $1`, [mom]);
  await db.query(`update church_members set include_directory = include_directory where id = $1`, [dad]);
  w = await cands(null, '706-312-0190');
  ok(w.map((r) => r.name).join() === 'Gail Ward,Wendy Ward', "the same holds for a family's phone number", JSON.stringify(w));
  await db.query(`delete from church_members where id = any($1)`, [[dad, mom, kid, gran, near]]);
}
for (let i = 0; i < 9; i++) await member({ name: `Many ${i}`, email: 'many@example.com', family_id: 'H-M', family_position: i ? 'Spouse' : 'Head' });
ok((await cands('many@example.com', null)).length === 0, 'more than 8 matches offers no one (data problem)');

// ── Trigger ──────────────────────────────────────────────────────────────────
section('record trigger (Pillar edits and imports)');
const row = async (id) => one(`select * from church_members where id = $1`, [id]);
await db.query(`update church_members set directory_listed = true, share_email = true, share_phone = true, share_photo = true where id = $1`, [M.alice]);
let r = await as('authenticated', staffJwt, `update church_members set phone = '706-312-0101', email = 'ALICE@example.com' where id = $1`, [M.alice]);
let a = await row(M.alice);
ok(!r.error && a.app_not_before === null && a.share_phone && a.share_email, 'reformatting a contact signs no one out and keeps sharing', r.error || JSON.stringify({ nb: a.app_not_before, sp: a.share_phone, se: a.share_email, dl: a.directory_listed, phone: a.phone, email: a.email }));
r = await as('authenticated', staffJwt, `update church_members set phone = '706-312-0111' where id = $1`, [M.alice]);
a = await row(M.alice);
ok(!r.error && a.app_not_before !== null && !a.share_phone && a.share_email && a.directory_listed, 'changing the phone stamps the cutoff and stops sharing that phone');
const stamp1 = a.app_not_before;
const fakeUser = uid();
await db.query(`insert into auth.users (id, email) values ($1, 'x@example.com')`, [fakeUser]);
r = await as('authenticated', staffJwt, `update church_members set auth_user_id = $1, app_login_email = 'hijack@members.invalid', app_mint_lease_until = now() + interval '1 hour' where id = $2`, [fakeUser, M.alice]);
a = await row(M.alice);
ok(!r.error && a.auth_user_id === null && a.app_login_email === null && a.app_mint_lease_until === null, 'staff cannot point a record at a login or set its login address');
r = await as('authenticated', staffJwt, `update church_members set app_not_before = '2000-01-01' where id = $1`, [M.alice]);
ok((await row(M.alice)).app_not_before.getTime() === stamp1.getTime(), 'the cutoff never moves backwards');
r = await as('authenticated', staffJwt, `update church_members set app_not_before = now() + interval '10 years' where id = $1`, [M.alice]);
a = await row(M.alice);
ok(a.app_not_before.getTime() <= Date.now() + 5000 && !a.directory_listed, 'raising the cutoff is capped at now and clears the listing (revoke)');
await db.query(`update church_members set directory_listed = true where id = $1`, [M.bob]);
r = await as('authenticated', staffJwt, `update church_members set status = 'Inactive' where id = $1`, [M.bob]);
let b = await row(M.bob);
ok(b.app_not_before !== null && !b.directory_listed, 'losing eligibility stamps the cutoff and clears the listing');
await db.query(`update church_members set status = 'Active', app_not_before = null where id = $1`, [M.bob]);
ok((await row(M.bob)).app_not_before !== null, '… and even the database owner cannot lower it again');
r = await as('authenticated', { sub: uid(), role: 'authenticated' }, `update church_members set name = 'x' where id = $1 returning id`, [M.bob]);
ok(!r.error && r.rows.length === 0, 'a non-staff login cannot update member records');

// ── Rate limits ──────────────────────────────────────────────────────────────
section('rate limits');
const hit = async (hits) => (await one(`select public.app_rate_hit_many($1::jsonb) v`, [JSON.stringify(hits)])).v;
const H = (limit, bucket = 'b1', key = 'k'.repeat(64)) => ({ bucket, key, limit, window_seconds: 3600 });
ok(await hit([H(2), H(5, 'b2')]) === null && await hit([H(2), H(5, 'b2')]) === null, 'under the limit → null (recorded)');
ok(await hit([H(2), H(5, 'b2')]) === 'b1', 'at the limit → that bucket');
ok((await one(`select count(*)::int n from app_rate_events where bucket = 'b2'`)).n === 2, 'a refused request records nothing in any bucket');
ok((await one(`select count(*)::int n from app_rate_events where bucket = 'b1' and created_at > now() - interval '1 second'`)).n === 2, 'events counted per bucket');
r = await as('authenticated', staffJwt, `select public.app_rate_clear($1)`, ['k'.repeat(64)]);
ok(!r.error && (await one(`select count(*)::int n from app_rate_events`)).n === 0, 'staff can clear a key after a targeted lockout', r.error || '');

// ── Codes ────────────────────────────────────────────────────────────────────
section('one-time codes');
const C1 = 'c'.repeat(64), GOOD = 'a'.repeat(64), BAD = 'b'.repeat(64);
const consume = async (contact, mac) => all(`select * from public.app_code_consume($1, $2)`, [contact, mac]);
await one(`select public.app_code_issue($1, 'sms', $2, 300)`, [C1, GOOD]);
let used = [];
for (let i = 0; i < 4; i++) used.push(await consume(C1, BAD));
ok(used.every((x) => x.length === 1 && x[0].ok === false && x[0].channel === 'sms'), 'wrong code → counted, not ok');
let right = await consume(C1, GOOD);
ok(right.length === 1 && right[0].ok === true, 'the right code on the 5th try works');
ok((await consume(C1, GOOD)).length === 0, 'a code works once');
await one(`select public.app_code_issue($1, 'sms', $2, 300)`, [C1, GOOD]);
for (let i = 0; i < 5; i++) await consume(C1, BAD);
ok((await consume(C1, GOOD)).length === 0 && (await one(`select attempts from member_login_codes where contact_id = $1`, [C1])).attempts === 5,
  'after 5 wrong tries even the right code fails');
await one(`select public.app_code_issue($1, 'email', $2, 600)`, [C1, GOOD]);
ok((await one(`select attempts, used_at, channel from member_login_codes where contact_id = $1`, [C1])).attempts === 0, 'a new code replaces the old one and resets tries');
await db.query(`update member_login_codes set expires_at = now() - interval '1 second' where contact_id = $1`, [C1]);
ok((await consume(C1, GOOD)).length === 0, 'expired code fails');
ok((await one(`select expires_at - created_at d from member_login_codes where contact_id = $1`, [C1])) !== undefined, 'code row kept for audit');
await one(`select public.app_code_issue($1, 'sms', $2, 100000)`, [C1, GOOD]);
ok((await one(`select extract(epoch from expires_at - created_at)::int s from member_login_codes where contact_id = $1`, [C1])).s === 600, 'code lifetime capped at 10 minutes');

// ── Tickets ──────────────────────────────────────────────────────────────────
section('choice tickets');
const T1 = 'd'.repeat(64);
await one(`select public.app_ticket_create($1, $2, 'email', $3::uuid[], now(), 300)`, [T1, C1, `{${M.john},${M.jane}}`]);
ok((await all(`select * from public.app_ticket_use($1, $2)`, [T1, 'e'.repeat(64)])).length === 0, 'a ticket only works for the contact that earned it');
const tu = await all(`select * from public.app_ticket_use($1, $2)`, [T1, C1]);
ok(tu.length === 1 && tu[0].member_ids.length === 2, 'ticket returns its candidates once');
ok((await all(`select * from public.app_ticket_use($1, $2)`, [T1, C1])).length === 0, 'a ticket works once');

// ── Minting ──────────────────────────────────────────────────────────────────
section('login minting');
const prep = async (id, email) => one(`select * from public.app_member_login_prepare($1, $2)`, [id, email]);
let p1 = await prep(M.alice, 'm-11111111111111111111111111111111@members.invalid');
ok(p1 && p1.login_email === 'm-11111111111111111111111111111111@members.invalid' && p1.auth_user_id === null && p1.login_ok === false && /^[0-9a-f-]{36}$/.test(p1.lease), 'prepare gives the record a login address and a lease token');
ok((await prep(M.alice, 'm-2@members.invalid')) === undefined, 'a second sign-in for the same record waits for the lease');
// imitate admin.createUser({ email, email_confirm: true, app_metadata: { bbc_member_id } })
async function createLogin(memberId, email, extra = {}) {
  const id = uid();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, phone) values ($1, $2, now(), $3, $4)`,
    [id, email, JSON.stringify({ bbc_member_id: memberId, ...(extra.meta || {}) }), extra.phone || null]);
  await db.query(`insert into auth.identities (user_id, provider) values ($1, 'email')`, [id]);
  return id;
}
const link = async (memberId, userId, email, phone, lease, since = null) => (await one(`select public.app_member_link_login($1, $2, $3, $4, $5, $6) v`, [memberId, userId, email, phone, since, lease])).v;
const release = async (memberId, lease) => one(`select public.app_member_login_release($1, $2)`, [memberId, lease]);
const grant = async (hash, memberId, userId, channel, codeAt = new Date()) => (await one(`select public.app_grant_create($1, $2, $3, 300, $4, $5) v`, [hash, memberId, userId, codeAt.toISOString(), channel])).v;
const wrongMeta = await createLogin(M.bob, p1.login_email);
ok(await link(M.alice, wrongMeta, 'alice@example.com', null, p1.lease) === false, "a login tagged for another record can't be linked");
await db.query(`delete from auth.users where id = $1`, [wrongMeta]);
{
  // a login that passes every other condition, but belongs to staff
  const s = await createLogin(M.alice, p1.login_email);
  await db.query(`insert into staff (id, name, active) values ($1, 'Staff Too', true)`, [s]);
  ok(await link(M.alice, s, 'alice@example.com', null, p1.lease) === false, 'a staff login is never linked to a member record');
  ok((await all(`select * from public.app_member_login_users($1)`, [M.alice])).length === 0, 'staff logins are never offered for clean-up (deletion)');
  await db.query(`delete from staff where id = $1`, [s]);
  await db.query(`delete from auth.users where id = $1`, [s]);
}
const aliceLogin = await createLogin(M.alice, p1.login_email);
ok(await link(M.alice, aliceLogin, 'bob@example.com', null, p1.lease) === false, "linking re-checks that the verified contact leads to this record");
ok(await link(M.alice, aliceLogin, ' alice@EXAMPLE.com', null, crypto.randomUUID()) === false, "linking needs this sign-in's own lease");
ok(await link(M.alice, aliceLogin, ' alice@EXAMPLE.com', null, p1.lease) === true, 'linking with the verified contact works');
ok((await one(`select public.app_member_login_ok($1) v`, [M.alice])).v === true, 'the new login passes the login check');
await release(M.alice, crypto.randomUUID());
ok((await prep(M.alice, 'm-x@members.invalid')) === undefined, "another sign-in's release can't free this lease");
await release(M.alice, p1.lease);
const p1b = await prep(M.alice, 'm-3@members.invalid');
ok(p1b.login_email === p1.login_email && p1b.lease !== p1.lease, 'the login address is kept once set; each sign-in gets its own lease');
ok((await one(`select public.app_member_login_rotate($1, 'm-4@members.invalid', $2) v`, [M.alice, p1b.lease])).v === null, "the address can't be rotated while its own login is linked");
await release(M.alice, p1b.lease);
{
  // a lease that ran out, or belongs to another sign-in, can't rotate or link (this record has no login yet)
  const lx = await member({ name: 'Lease Test', email: 'lease@example.com' });
  const rotate = async (lease, email) => (await one(`select public.app_member_login_rotate($1, $2, $3) v`, [lx, email, lease])).v;
  const expire = (d) => db.query(`update church_members set app_mint_lease_until = now() + $2::interval where id = $1`, [lx, d]);
  const pl = await prep(lx, 'm-50@members.invalid');
  await expire('-1 second');
  ok(await rotate(pl.lease, 'm-51@members.invalid') === null, 'an expired lease rotates nothing');
  await expire('20 seconds');
  ok(await rotate(crypto.randomUUID(), 'm-51@members.invalid') === null, "another sign-in's lease rotates nothing");
  ok(await rotate(pl.lease, 'm-51@members.invalid') === 'm-51@members.invalid', '… while the live lease can rotate');
  const ll = await createLogin(lx, 'm-51@members.invalid');
  await expire('-1 second');
  ok(await link(lx, ll, 'lease@example.com', null, pl.lease) === false, 'an expired lease links nothing');
  await expire('20 seconds');
  ok(await link(lx, ll, 'lease@example.com', null, pl.lease) === true, '… while the live lease can link');
  await release(lx, pl.lease);
}
const users = await all(`select * from public.app_member_login_users($1)`, [M.alice]);
ok(users.length === 1 && users[0].auth_user_id === aliceLogin && users[0].banned === false, 'logins tagged for a record can be listed for clean-up');
await db.query(`insert into staff (id, name, active) values ($1, 'Oops', true)`, [aliceLogin]);
ok((await one(`select public.app_member_login_ok($1) v`, [M.alice])).v === false, 'a staff row on the linked login fails the login check');
await db.query(`delete from staff where id = $1`, [aliceLogin]);

// ── Grants, binding and the member gate ─────────────────────────────────────
section('session binding and the member gate');
const GRANT = 'g'.repeat(43);
const sha = async (s) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex');
ok(await grant(await sha(GRANT), M.alice, aliceLogin, 'email', new Date(Date.now() - 86400000 * 365 * 10)) === false, 'no grant for a code issued before the record last changed');
ok(await grant(await sha(GRANT), M.alice, STAFF, 'email') === false, 'no grant for a login that is not the linked one');
ok(await grant(await sha(GRANT), M.alice, aliceLogin, 'email') === true, 'grant for the linked login');
const now = () => Math.floor(Date.now() / 1000);
async function session(userId, createdSecondsAgo = 0) {
  return (await one(`insert into auth.sessions (user_id, created_at) values ($1, now() - make_interval(secs => $2)) returning id`, [userId, createdSecondsAgo])).id;
}
const jwt = (userId, sid, amr = [{ method: 'otp', timestamp: now() }]) => ({ sub: userId, role: 'authenticated', session_id: sid, amr });
const sid1 = await session(aliceLogin);
r = await as('authenticated', jwt(aliceLogin, sid1, [{ method: 'password', timestamp: now() }]), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v === null, 'a password session cannot redeem a grant');
r = await as('authenticated', jwt(aliceLogin, sid1, [{ method: 'otp', timestamp: now() - 600 }]), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v === null, 'a session older than the grant cannot redeem it');
r = await as('authenticated', jwt(STAFF, sid1), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v === null, "another login cannot redeem the grant");
r = await as('authenticated', jwt(aliceLogin, sid1), `select public.member_bind_session($1) v`, ['wrong'.repeat(9)]);
ok(!r.error && r.rows[0].v === null, 'a wrong grant does nothing');
r = await as('authenticated', jwt(aliceLogin, sid1), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v && r.rows[0].v.member_id === M.alice && r.rows[0].v.name === 'Alice Adams', 'the fresh OTP session redeems the grant and gets the profile', r.error || JSON.stringify(r.rows));
ok(!('notes' in r.rows[0].v) && !('tags' in r.rows[0].v) && !JSON.stringify(r.rows[0].v).includes('members.invalid'), 'profile never includes notes, tags or the login address');
r = await as('authenticated', jwt(aliceLogin, sid1), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v?.member_id === M.alice, 'the same session asking again (lost reply) just gets its profile');
const sid2 = await session(aliceLogin);
r = await as('authenticated', jwt(aliceLogin, sid2), `select public.member_bind_session($1) v`, [GRANT]);
ok(!r.error && r.rows[0].v === null, 'a grant works once (a second session cannot reuse it)');

const me = async (claims) => { const x = await as('authenticated', claims, `select public.member_me() v`); return x.error ? { error: x.error } : x.rows[0].v; };
ok((await me(jwt(aliceLogin, sid1)))?.member_id === M.alice, 'bound session → member_me works');
ok((await me(jwt(aliceLogin, sid1, [{ method: 'otp', timestamp: now() }, { method: 'totp', timestamp: now() }])))?.member_id === M.alice, '… also after adding TOTP');
ok(await me(jwt(aliceLogin, sid2)) === null, 'an unbound session of the same login (e.g. Supabase /recover) gets nothing');
ok(await me(jwt(aliceLogin, sid1, [{ method: 'otp', timestamp: now() }, { method: 'password', timestamp: now() }])) === null, 'a session carrying a password sign-in gets nothing');
ok(await me(jwt(aliceLogin, sid1, [])) === null && await me({ sub: aliceLogin, role: 'authenticated', session_id: sid1 }) === null, 'missing or empty amr gets nothing');
ok(await me({ ...jwt(aliceLogin, sid1), session_id: 'not-a-uuid' }) === null && await me({ ...jwt(aliceLogin, sid1), session_id: undefined }) === null, 'bad or missing session id gets nothing');
ok(await me({ ...jwt(aliceLogin, sid1), role: 'anon' }) === null, 'anon role claim gets nothing');

// each of these is undone before the next
async function denied(label, breakSql, fixSql, params = []) {
  await db.query(breakSql, params);
  const v = await me(jwt(aliceLogin, sid1));
  await db.query(fixSql, params);
  const back = await me(jwt(aliceLogin, sid1));
  ok(v === null && back?.member_id === M.alice, label, JSON.stringify({ v, back }));
}
{
  const sid3 = await session(aliceLogin);
  await db.query(`insert into member_sessions (session_id, member_id, auth_user_id, minted_at, channel) values ($1, $2, $3, now(), 'email')`, [sid3, M.alice, aliceLogin]);
  ok((await me(jwt(aliceLogin, sid3)))?.member_id === M.alice, 'a second bound session works');
  await db.query(`delete from auth.sessions where id = $1`, [sid3]);
  ok(await me(jwt(aliceLogin, sid3)) === null, 'signed-out session (auth.sessions row gone) gets nothing at once');
}
await denied('session with an expired not_after gets nothing', `update auth.sessions set not_after = now() - interval '1 minute' where id = $1`, `update auth.sessions set not_after = null where id = $1`, [sid1]);
await denied('revoked member session gets nothing', `update member_sessions set revoked_at = now() where session_id = $1`, `update member_sessions set revoked_at = null where session_id = $1`, [sid1]);
await denied("login email changed (e.g. via PUT /user) gets nothing", `update auth.users set email = 'attacker@example.com' where id = $1`, `update auth.users set email = (select app_login_email from church_members where auth_user_id = $1) where id = $1`, [aliceLogin]);
await denied('phone added to the login gets nothing', `update auth.users set phone = '17063120101' where id = $1`, `update auth.users set phone = null where id = $1`, [aliceLogin]);
await denied('phone confirmed on the login gets nothing', `update auth.users set phone_confirmed_at = now() where id = $1`, `update auth.users set phone_confirmed_at = null where id = $1`, [aliceLogin]);
await denied('a linked Google identity gets nothing', `insert into auth.identities (user_id, provider) values ($1, 'google')`, `delete from auth.identities where user_id = $1 and provider = 'google'`, [aliceLogin]);
await denied('banned login gets nothing', `update auth.users set banned_until = now() + interval '1 day' where id = $1`, `update auth.users set banned_until = null where id = $1`, [aliceLogin]);
await denied('app metadata pointing elsewhere gets nothing', `update auth.users set raw_app_meta_data = '{"bbc_member_id":"x"}' where id = $1`, `update auth.users set raw_app_meta_data = jsonb_build_object('bbc_member_id', (select id::text from church_members where auth_user_id = $1)) where id = $1`, [aliceLogin]);
{
  await db.query(`update church_members set app_access = 'deny' where id = $1`, [M.alice]);
  const v = await me(jwt(aliceLogin, sid1));
  await db.query(`update church_members set app_access = 'auto' where id = $1`, [M.alice]);
  ok(v === null && await me(jwt(aliceLogin, sid1)) === null, 'record no longer eligible gets nothing — and stays signed out after it is restored');
  // the member signs in again (a new grant would mint a new member_sessions row after the cutoff)
  await db.query(`update member_sessions set minted_at = clock_timestamp() where session_id = $1`, [sid1]);
  ok((await me(jwt(aliceLogin, sid1)))?.member_id === M.alice, '… until they sign in again');
}
{
  await db.query(`insert into staff (id, name, role, active) values ($1, 'Oops', 'Admin', true)`, [aliceLogin]);
  ok(await me(jwt(aliceLogin, sid1)) === null, 'a staff row on a member login gets nothing');
  const s = await as('authenticated', jwt(aliceLogin, sid1), `select public.is_active_staff() a, public.is_admin() b`);
  ok(!s.error && s.rows[0].a === false && s.rows[0].b === false, '… and a member login is never active staff or admin, even with an Admin row');
  await db.query(`delete from staff where id = $1`, [aliceLogin]);
}
{
  // blocklisting the contact behind a session ends that session (the gate re-checks the contact)
  await db.query(`insert into app_contact_blocklist (contact_norm) values ('alice@example.com')`);
  ok(await me(jwt(aliceLogin, sid1)) === null, 'blocklisting the contact a session came through ends it');
  await db.query(`delete from app_contact_blocklist where contact_norm = 'alice@example.com'`);
  ok((await me(jwt(aliceLogin, sid1)))?.member_id === M.alice, '… (restored)');
  let e = null; try { await db.query(`insert into app_contact_blocklist (contact_norm) values ('(706) 312-0199')`); } catch (x) { e = x.message; }
  ok(/app_contact_blocklist_norm_check/.test(e || ''), 'blocklist entries must be written normalised', e || 'accepted');
  const accepted = [];
  for (const bad of ['706-312-0199 (office)', '706 312 0199 ext 2', 'office line', '']) {
    try { await db.query(`insert into app_contact_blocklist (contact_norm) values ($1)`, [bad]); accepted.push(bad); } catch { /* refused */ }
  }
  ok(accepted.length === 0, "blocklist entries that aren't a usable contact are refused too", JSON.stringify(accepted));
}
{
  const before = await me(jwt(aliceLogin, sid1));
  await db.query(`update church_members set share_email = true where id = $1`, [M.alice]);
  await as('authenticated', staffJwt, `update church_members set email = 'alice.new@example.com' where id = $1`, [M.alice]);
  ok(before?.member_id === M.alice && await me(jwt(aliceLogin, sid1)) === null, 'office changing the email signs existing sessions out');
  ok(!(await row(M.alice)).share_email, '… and the new email is not shared until they say so');
  ok((await one(`select public.app_member_login_ok($1) v`, [M.alice])).v === false, '… and the old login must be recreated before the next sign-in');
}

// ── Member surface ───────────────────────────────────────────────────────────
section('member functions');
// fresh login for Alice after the email change (as member-verify-code would do)
await db.query(`delete from auth.users where id = $1`, [aliceLogin]);
ok((await row(M.alice)).auth_user_id === null, 'deleting the login unlinks the record (FK)');
ok((await row(M.alice)).app_not_before !== null, '… and stamps the cutoff (an unlink outside a sign-in)');
let p2 = await prep(M.alice, 'm-unused@members.invalid');
const newAddr = (await one(`select public.app_member_login_rotate($1, 'm-22222222222222222222222222222222@members.invalid', $2) v`, [M.alice, p2.lease])).v;
const alice2 = await createLogin(M.alice, newAddr);
ok(p2 && await link(M.alice, alice2, 'alice.new@example.com', null, p2.lease) === true, 're-sign-in after a contact change links a new login');
await release(M.alice, p2.lease);
const G2 = 'h'.repeat(43);
ok(await grant(await sha(G2), M.alice, alice2, 'email') === true, 'grant for the new login');
const sidA = await session(alice2);
await as('authenticated', jwt(alice2, sidA), `select public.member_bind_session($1)`, [G2]);
const A = jwt(alice2, sidA);
ok((await me(A))?.email === 'alice.new@example.com', 'new session works');
{
  // My Profile: the household and the shepherding deacon
  await db.query(`update church_members set deacon_id = $1 where id = $2`, [M.john, M.alice]);
  const rita = await member({ name: 'Retired Rita', family_id: 'H-ADAMS', active: false });
  const fam = await as('authenticated', A, `select public.member_family() v`);
  const v = fam.error ? null : fam.rows[0].v;
  ok(v && v.family.length === 1 && v.family[0].name === 'Teen Adams' && v.deacon?.name === 'John Smith' && v.deacon?.email === 'smiths@example.com',
    'member_family: the household (inactive records left out) and the shepherding deacon', fam.error || JSON.stringify(v));
  ok(v && !/notes|birthday|address|tags|private note|choir/.test(JSON.stringify(v.family)), '… household entries carry names and positions only');
  const stranger = await as('authenticated', { sub: uid(), role: 'authenticated', session_id: uid(), amr: [{ method: 'otp', timestamp: now() }] }, `select public.member_family() v`);
  ok(!stranger.error && stranger.rows[0].v === null, '… nothing for a session that is not a member');
  const anonCall = await as('anon', {}, `select public.member_family()`);
  ok(/permission denied/.test(anonCall.error || ''), '… and anon cannot call it', anonCall.error || 'allowed');
  await db.query(`update church_members set deacon_id = null where id = $1`, [M.alice]);
  await db.query(`delete from church_members where id = $1`, [rita]);
}

r = await as('authenticated', A, `select public.member_update_me(p_address => '  9 New Rd ', p_directory_listed => true, p_share_email => true) v`);
ok(!r.error && r.rows[0].v.address === '9 New Rd' && r.rows[0].v.directory_listed && r.rows[0].v.share_email, 'member updates address and directory choices', r.error || '');
r = await as('authenticated', A, `select public.member_update_me(p_address => '') v`);
ok(!r.error && r.rows[0].v.address === null, 'empty address clears it');
r = await as('authenticated', A, `select public.member_update_me(p_address => $1) v`, ['x'.repeat(301)]);
ok(/address too long/.test(r.error || ''), 'overlong address refused');
r = await as('authenticated', { sub: uid(), role: 'authenticated', session_id: uid(), amr: [{ method: 'otp', timestamp: now() }] }, `select public.member_update_me(p_address => 'x')`);
ok(/not signed in/.test(r.error || ''), 'member_update_me refuses non-members');

// Bob signs in too and lists himself, sharing only his phone and photo
await db.query(`update church_members set app_not_before = null where id = $1`, [M.bob]).catch(() => {});
const pb = await prep(M.bob, 'm-33333333333333333333333333333333@members.invalid');
const bobLogin = await createLogin(M.bob, pb.login_email);
ok(await link(M.bob, bobLogin, null, '706-312-0102', pb.lease) === true, 'Bob links');
await release(M.bob, pb.lease);
const G3 = 'i'.repeat(43);
ok(await grant(await sha(G3), M.bob, bobLogin, 'sms') === true, "grant for Bob's text sign-in");
const sidB = await session(bobLogin);
await as('authenticated', jwt(bobLogin, sidB), `select public.member_bind_session($1)`, [G3]);
const B = jwt(bobLogin, sidB);
await db.query(`update church_members set photo_url = 'data:image/jpeg;base64,AAAA' where id = $1`, [M.bob]);
r = await as('authenticated', B, `select public.member_update_me(p_directory_listed => true, p_share_phone => true, p_share_photo => true) v`);
ok(!r.error && r.rows[0].v.share_phone, 'Bob opts in', r.error || '');

let dir = await as('authenticated', A, `select * from public.member_directory(null, 100)`);
const dirNames = () => dir.rows.map((x) => x.name);
ok(!dir.error && ['Alice Adams', 'Bob Brown', 'John Smith', 'Jane Smith', 'Office Oscar', 'Carl Cousin'].every((n) => dirNames().includes(n)),
  'the directory lists every eligible member, app login or not (listed by default)', dir.error || JSON.stringify(dirNames()));
ok(!['Kid Brown', 'Teen Adams', 'Inactive Ivy', 'Paul Prospect', 'Denied Dan'].some((n) => dirNames().includes(n)),
  '… never children, inactive, prospect or denied records', JSON.stringify(dirNames()));
ok(JSON.stringify(dirNames()) === JSON.stringify([...dirNames()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))), '… in name order');
const bobRow = dir.rows.find((x) => x.name === 'Bob Brown');
const aliceRow = dir.rows.find((x) => x.name === 'Alice Adams');
const johnRow = dir.rows.find((x) => x.name === 'John Smith');
ok(bobRow && bobRow.phone === '706.312.0102' && bobRow.email === null && bobRow.has_photo === true, "shows only the fields a member shares");
ok(aliceRow && aliceRow.email === 'alice.new@example.com' && aliceRow.phone === null && aliceRow.has_photo === false, '… for each member');
ok(johnRow && johnRow.email === null && johnRow.phone === null && johnRow.has_photo === false, 'someone who shares nothing is listed by name only');
await db.query(`update church_members set share_phone = true, share_email = true, photo_url = 'data:image/png;base64,BB', share_photo = true where id = $1`, [M.office]);
dir = await as('authenticated', A, `select * from public.member_directory('oscar')`);
r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.office]);
ok(!dir.error && dir.rows.length === 1 && dir.rows[0].phone === null && dir.rows[0].email === null && dir.rows[0].has_photo === false
  && !r.error && r.rows[0].v === null, "a record without its own app login never shares contact details or a photo, whatever its flags say", dir.error || JSON.stringify(dir.rows));
await db.query(`update church_members set share_phone = false, share_email = false, photo_url = null, share_photo = false where id = $1`, [M.office]);
r = await as('authenticated', B, `select public.member_update_me(p_directory_listed => false) v`);
ok(!r.error && r.rows[0].v.directory_listed === false && (await row(M.bob)).directory_hidden === true, 'a member hides themselves (Show me in the directory → off)', r.error || '');
dir = await as('authenticated', A, `select * from public.member_directory(null, 100)`);
r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.bob]);
ok(!dir.error && !dirNames().includes('Bob Brown') && !r.error && r.rows[0].v === null, '… and is gone from the directory, photo included');
ok((await as('authenticated', B, `select public.member_update_me(p_address => 'x') v`)).rows[0].v.directory_listed === false, '… other profile edits leave that choice alone');
r = await as('authenticated', B, `select public.member_update_me(p_directory_listed => true, p_address => '') v`);
ok(!r.error && r.rows[0].v.directory_listed === true && (await row(M.bob)).directory_hidden === false, '… and can come back', r.error || '');
dir = await as('authenticated', A, `select * from public.member_directory(null, 100)`);
ok(!dir.error && dir.rows.find((x) => x.name === 'Bob Brown')?.phone === '706.312.0102', '… with what they shared before');
dir = await as('authenticated', A, `select * from public.member_directory(null, 2)`);
const page2 = await as('authenticated', A, `select * from public.member_directory(null, 2, 2)`);
ok(!dir.error && !page2.error && dir.rows.length === 2 && page2.rows.length === 2 && !page2.rows.some((x) => dir.rows.some((y) => y.id === x.id)), 'pages do not repeat people');
{
  // tapping someone in the directory: their household and their deacon's name
  const deacon = await member({ name: 'Dave Deacon', phone: '706-312-0177', email: 'dave@example.com', family_id: 'H-DEACON' });
  await db.query(`update church_members set deacon_id = $1 where id = $2`, [deacon, M.john]);
  const hiddenSis = await member({ name: 'Hidden Smith', email: 'hid@example.com', family_id: 'H-SMITH', family_position: 'Child', directory_hidden: true });
  const outSis = await member({ name: 'Kept Smith', family_id: 'H-SMITH', family_position: 'Child', include_directory: false });
  const kidSmith = await member({ name: 'Sam Smith', family_id: 'H-SMITH', family_position: 'Child' });
  const goneSmith = await member({ name: 'Gone Smith', family_id: 'H-SMITH', status: 'Inactive' });
  let f = await as('authenticated', A, `select public.member_directory_family($1) v`, [M.john]);
  const names = (f.rows?.[0]?.v?.family || []).map((x) => x.name);
  ok(!f.error && names.join() === 'Jane Smith,Sam Smith,Jimmy Smith', "a member's card lists their household, head/spouse/child first", f.error || JSON.stringify(f.rows?.[0]?.v));
  ok(!names.includes('Hidden Smith') && !names.includes('Kept Smith') && !names.includes('Gone Smith'), '… leaving out who hid, who the office kept out and inactive records');
  ok(JSON.stringify(f.rows[0].v.deacon) === JSON.stringify({ name: 'Dave Deacon' }), "… and their deacon's name only (no deacon phone or email on someone else's card)", JSON.stringify(f.rows[0].v.deacon));
  ok(!JSON.stringify(f.rows[0].v).match(/birthday|address|notes|706|example\.com/), '… nothing but names and positions');
  await db.query(`update church_members set directory_hidden = true where id = $1`, [deacon]);
  f = await as('authenticated', A, `select public.member_directory_family($1) v`, [M.john]);
  ok(!f.error && f.rows[0].v.deacon === null, "… and a deacon who hid themselves isn't named on anyone's card");
  await db.query(`update church_members set directory_hidden = false, include_directory = false where id = $1`, [deacon]);
  f = await as('authenticated', A, `select public.member_directory_family($1) v`, [M.john]);
  ok(!f.error && f.rows[0].v.deacon === null, '… nor one the office kept out of the directory');
  await db.query(`update church_members set include_directory = true where id = $1`, [deacon]);
  f = await as('authenticated', A, `select public.member_directory_family($1) v`, [M.kid]);
  ok(!f.error && f.rows[0].v === null, "nothing for someone who isn't in the directory (a child's own card)");
  await db.query(`update church_members set directory_hidden = true where id = $1`, [M.john]);
  f = await as('authenticated', A, `select public.member_directory_family($1) v`, [M.john]);
  ok(!f.error && f.rows[0].v === null, '… or someone who hid themselves');
  await db.query(`update church_members set directory_hidden = false where id = $1`, [M.john]);
  f = await as('authenticated', staffJwt, `select public.member_directory_family($1) v`, [M.john]);
  ok(!f.error && f.rows[0].v === null, '… or a staff password session');
  f = await as('anon', {}, `select public.member_directory_family($1) v`, [M.john]);
  ok(/permission denied/.test(f.error || ''), '… and anon cannot call it', f.error || 'allowed');
  await db.query(`update church_members set deacon_id = null where id = $1`, [M.john]);
  await db.query(`delete from church_members where id = any($1)`, [[deacon, hiddenSis, outSis, kidSmith, goneSmith]]);
}
ok(!JSON.stringify(dir.rows).match(/notes|tags|address|birthday|members\.invalid/), 'directory never includes notes, tags, address, birthday or login addresses');
dir = await as('authenticated', A, `select * from public.member_directory('bo%')`);
ok(!dir.error && dir.rows.length === 0, 'search wildcards are escaped');
dir = await as('authenticated', A, `select * from public.member_directory('BOB')`);
ok(!dir.error && dir.rows.length === 1, 'search is case-insensitive');
r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.bob]);
ok(!r.error && r.rows[0].v === 'data:image/jpeg;base64,AAAA', 'shared photo fetched one at a time');
r = await as('authenticated', B, `select public.member_directory_photo($1) v`, [M.alice]);
ok(!r.error && r.rows[0].v === null, "a photo that isn't shared is not returned");
await db.query(`update church_members set include_directory = false where id = $1`, [M.bob]);
dir = await as('authenticated', A, `select * from public.member_directory(null)`);
ok(!dir.error && !dir.rows.some((x) => x.name === 'Bob Brown'), "the office's 'not in directory' flag keeps a member out");
r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.bob]);
ok(!r.error && r.rows[0].v === null, "… and the photo isn't served either");
await db.query(`update church_members set include_directory = true where id = $1`, [M.bob]);
{
  // eligibility can change without a row update (the office edits app_member_is_eligible), so the
  // directory checks it itself: skip the trigger that would also clear Bob's listing
  const skipTrigger = (sql) => db.exec(`alter table church_members disable trigger trg_members_app_login_guard; ${sql}; alter table church_members enable trigger trg_members_app_login_guard;`);
  await skipTrigger(`update church_members set active = false where id = '${M.bob}'`);
  dir = await as('authenticated', A, `select * from public.member_directory(null)`);
  r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.bob]);
  ok(!dir.error && !dir.rows.some((x) => x.name === 'Bob Brown') && !r.error && r.rows[0].v === null, "a member who is no longer eligible isn't shown, nor their photo");
  await skipTrigger(`update church_members set active = true where id = '${M.bob}'`);
  r = await as('authenticated', A, `select public.member_directory_photo($1) v`, [M.bob]);
  ok(!r.error && r.rows[0].v === 'data:image/jpeg;base64,AAAA', '… (restored)');
}
dir = await as('authenticated', staffJwt, `select * from public.member_directory(null)`);
ok(!dir.error && dir.rows.length === 0, 'staff password sessions are not served by the member directory');
dir = await as('authenticated', jwt(aliceLogin, sid2), `select * from public.member_directory(null)`);
ok(!dir.error && dir.rows.length === 0, 'unbound sessions get an empty directory');

// ── Permissions ──────────────────────────────────────────────────────────────
section('permissions');
r = await as('anon', {}, `select public.member_me()`);
ok(/permission denied/.test(r.error || ''), 'anon cannot call member functions');
for (const fn of [
  `public.app_login_candidates('alice.new@example.com', null, null)`, `public.app_code_issue('${C1}', 'sms', '${GOOD}', 300)`,
  `public.app_code_consume('${C1}', '${GOOD}')`, `public.app_member_login_prepare('${M.alice}', 'x@members.invalid')`,
  `public.app_member_link_login('${M.alice}', '${alice2}', 'a@b.co', null, null, gen_random_uuid())`,
  `public.app_grant_create('${'f'.repeat(64)}', '${M.alice}', '${alice2}', 300, now(), 'email')`,
  `public.app_import_members('[]'::jsonb)`, `public.app_member_login_hold('${M.alice}', gen_random_uuid(), 5)`,
  `public.app_rate_hit_many('[]'::jsonb)`, `public.app_caller_member_id()`, `public.app_auth_config()`, `public.app_member_forget_login('${M.alice}', '${alice2}')`,
  `public.app_ticket_use('${T1}', '${C1}')`, `public.app_orphan_member_logins()`, `public.app_auth_log('x', null, null, null, null, null, null)`,
]) {
  const x = await as('authenticated', A, `select ${fn}`);
  ok(/permission denied/.test(x.error || ''), `a member cannot call ${fn.split('(')[0]}`, x.error || 'no error');
}
for (const t of ['member_login_codes', 'member_choice_tickets', 'member_login_grants', 'member_sessions', 'app_rate_events']) {
  const x = await as('authenticated', A, `select * from public.${t}`);
  ok(/permission denied/.test(x.error || ''), `a member cannot read ${t}`);
  const y = await as('authenticated', staffJwt, `select * from public.${t}`);
  ok(/permission denied/.test(y.error || '') || (y.rows && y.rows.length === 0), `staff sessions cannot read ${t} either`);
}
for (const t of ['church_members', 'care_members', 'app_auth_settings', 'member_auth_events', 'member_access_requests', 'app_contact_blocklist']) {
  const x = await as('authenticated', A, `select * from public.${t}`);
  ok(!x.error && x.rows.length === 0, `a member session reads nothing from ${t}`, x.error || `${x.rows?.length} rows`);
}
r = await as('authenticated', staffJwt, `select signin_enabled from public.app_auth_settings`);
ok(!r.error && r.rows.length === 1, 'staff can read the sign-in settings');
r = await as('authenticated', { ...staffJwt, sub: STAFF_OLD }, `select signin_enabled from public.app_auth_settings`);
ok(!r.error && r.rows.length === 0, 'inactive staff cannot');
await db.query(`insert into member_access_requests (name, contact) values ('Someone', 'someone@example.com')`);
r = await as('authenticated', staffJwt, `delete from public.member_access_requests returning id`);
ok(!r.error && r.rows.length === 0, 'staff can no longer delete office requests (read and mark handled only)');

// ── Revoke, forget, purge ────────────────────────────────────────────────────
section('revoke, delete account, housekeeping');
r = await as('authenticated', A, `select public.app_member_revoke_login($1)`, [M.bob]);
ok(/staff only/.test(r.error || ''), 'a member cannot revoke another member');
ok((await me(B))?.member_id === M.bob, 'Bob is signed in');
r = await as('authenticated', staffJwt, `select public.app_member_revoke_login($1) v`, [M.bob]);
ok(!r.error && r.rows[0].v === true && await me(B) === null, 'staff revoke signs Bob out of the app everywhere at once', r.error || '');
{
  const bobNow = await row(M.bob);
  dir = await as('authenticated', A, `select * from public.member_directory('bob')`);
  ok(!bobNow.share_phone && !bobNow.share_photo && !bobNow.directory_hidden && dir.rows.length === 1 && dir.rows[0].phone === null && dir.rows[0].has_photo === false,
    '… stops sharing his details; the directory keeps his name (hiding is his own choice)', JSON.stringify(dir.rows));
}
ok((await one(`select public.app_member_forget_login($1, $2) v`, [M.alice, alice2])).v === true && await me(A) === null, 'delete-account clears the link and the session');
const aliceAfter = await row(M.alice);
ok(aliceAfter.auth_user_id === null && aliceAfter.directory_hidden === true && !aliceAfter.share_email && aliceAfter.notes === 'private note',
  "delete-account takes the member out of the directory; the church record itself stays");
let purgeErr = null;
try { await db.query(`select public.app_auth_purge()`); } catch (e) { purgeErr = e.message; }
ok(!purgeErr, 'housekeeping runs', purgeErr || '');
const orphans = await all(`select * from public.app_orphan_member_logins()`);
ok(Array.isArray(orphans), 'orphan login listing runs');

// ── Review follow-ups ────────────────────────────────────────────────────────
section('review follow-ups');
{
  // a staffer can't plant a record pointing at someone else's login
  const planted = await as('authenticated', staffJwt,
    `insert into church_members (name, phone, auth_user_id, app_login_email, app_mint_lease_until, app_mint_lease, app_not_before, directory_listed, share_phone)
     values ('Decoy', '706-312-0177', $1, 'x@members.invalid', now() + interval '1 hour', gen_random_uuid(), now() - interval '1 day', true, true) returning id`, [STAFF]);
  ok(!planted.error, 'staff can still add members', planted.error || '');
  const d = await row(planted.rows[0].id);
  ok(d.auth_user_id === null && d.app_login_email === null && d.app_mint_lease_until === null && d.app_mint_lease === null && d.app_not_before === null && !d.directory_listed && !d.share_phone,
    'a new record added by staff carries no login, lease, cutoff or directory choices', JSON.stringify(d));
  // even if a login link gets set by hand (SQL editor), sign-in detaches it instead of deleting that account
  await db.query(`update church_members set auth_user_id = $1 where id = $2`, [STAFF, d.id]);
  const pd = await prep(d.id, 'm-44444444444444444444444444444444@members.invalid');
  ok((await all(`select * from public.app_member_login_users($1)`, [d.id])).length === 0, "the staff account isn't offered for deletion");
  const rot = (await one(`select public.app_member_login_rotate($1, 'm-55555555555555555555555555555555@members.invalid', $2) v`, [d.id, pd.lease])).v;
  ok(rot === 'm-55555555555555555555555555555555@members.invalid' && (await row(d.id)).auth_user_id === null
     && (await one(`select count(*)::int n from auth.users where id = $1`, [STAFF])).n === 1, 'rotate detaches a link to a login that is not the record\'s own, and deletes nothing');
  await release(d.id, pd.lease);
}
{
  // a ban on a record's app login blocks that record from signing in (instead of being replaced)
  const ban = await member({ name: 'Ban Test', email: 'ban@example.com' });
  const pbn = await prep(ban, 'm-66666666666666666666666666666666@members.invalid');
  const banLogin = await createLogin(ban, pbn.login_email);
  ok(await link(ban, banLogin, 'ban@example.com', null, pbn.lease) === true, 'ban test links');
  await release(ban, pbn.lease);
  await db.query(`update auth.users set banned_until = now() + interval '30 days' where id = $1`, [banLogin]);
  ok((await cands('ban@example.com', null)).length === 0, 'a banned app login blocks its record from getting codes');
  ok((await all(`select * from public.app_member_login_users($1)`, [ban]))[0]?.banned === true, 'banned logins are flagged, not offered for replacement');
  ok((await one(`select public.app_member_login_ok($1) v`, [ban])).v === false, 'banned login fails the login check');
  await db.query(`update auth.users set banned_until = null where id = $1`, [banLogin]);
  await db.query(`insert into auth.identities (user_id, provider) values ($1, 'google')`, [banLogin]);
  ok((await one(`select public.app_member_login_ok($1) v`, [ban])).v === false, 'a login with a Google identity fails the login check');
  // unlinks: inside a sign-in's own lease keep choices; anything else stamps and clears
  await db.query(`update church_members set directory_listed = true, share_email = true where id = $1`, [ban]);
  const pl = await prep(ban, 'm-77777777777777777777777777777777@members.invalid');
  await db.query(`delete from auth.users where id = $1`, [banLogin]);
  const kept = await row(ban);
  ok(kept.auth_user_id === null && kept.directory_listed && kept.app_not_before === null, 'a sign-in replacing its own login keeps directory choices');
  await release(ban, pl.lease);
  const pl2 = await prep(ban, 'x');
  const l2 = await createLogin(ban, (await row(ban)).app_login_email);
  await link(ban, l2, 'ban@example.com', null, pl2.lease);
  await release(ban, pl2.lease);
  await db.query(`delete from auth.users where id = $1`, [l2]);    // e.g. Dashboard → Users → Delete
  const gone = await row(ban);
  ok(gone.app_not_before !== null && !gone.directory_listed && !gone.share_email, 'a login deleted from the Dashboard stamps the cutoff and clears the listing');
}
{
  // changed contacts that aren't usable sign-in contacts still stop being shared
  const ann = await member({ name: 'Ann Multi', email: 'ann@example.com', phone: 'H 706-312-0150 C 706-312-0151', directory_listed: true, share_phone: true });
  await db.query(`update church_members set share_phone = true, directory_listed = true where id = $1`, [ann]);
  await as('authenticated', staffJwt, `update church_members set phone = 'H 706-312-0150 C 404-312-0199' where id = $1`, [ann]);
  ok(!(await row(ann)).share_phone, 'editing an unusual phone field stops sharing it');
}
{
  // household split: a session that came through a now-ambiguous shared contact stops working
  const pj = await prep(M.john, 'm-88888888888888888888888888888888@members.invalid');
  const jl = await createLogin(M.john, pj.login_email);
  ok(await link(M.john, jl, 'smiths@example.com', null, pj.lease) === true, 'John links through the shared family email');
  await release(M.john, pj.lease);
  const GJ = 'j'.repeat(43);
  ok(await grant(await sha(GJ), M.john, jl, 'email') === true, 'grant for John');
  const sj = await session(jl);
  await as('authenticated', jwt(jl, sj), `select public.member_bind_session($1)`, [GJ]);
  ok((await me(jwt(jl, sj)))?.member_id === M.john, 'John is signed in');
  await as('authenticated', staffJwt, `update church_members set family_id = 'h-new' where id = $1`, [M.jane]);
  ok(await me(jwt(jl, sj)) === null, 'moving Jane to another household ends the session that came through their shared email');
  await as('authenticated', staffJwt, `update church_members set family_id = 'H-SMITH' where id = $1`, [M.jane]);
}
{
  // eligibility fields Pillar sets, and strict "since"
  const off = await member({ name: 'Off Flag', email: 'off@example.com', active: false });
  const inact = await member({ name: 'Inactive Member', email: 'inact@example.com', member_status: 'Inactive' });
  ok(!(await elig(off)) && !(await elig(inact)) && (await cands('off@example.com', null)).length === 0 && (await cands('inact@example.com', null)).length === 0,
    'active = false and member status Inactive are not eligible');
  const since = await member({ name: 'Since Test', email: 'since@example.com' });
  await db.query(`update church_members set app_not_before = now() - interval '1 minute' where id = $1`, [since]);
  ok((await cands('since@example.com', null, new Date(Date.now() - 3600000).toISOString())).length === 0, 'a record changed after the code was issued is not offered');
  ok((await cands('since@example.com', null, new Date(Date.now() + 1000).toISOString())).length === 1, '… but is for a code issued after the change');
}
{
  // expiry of grants and tickets
  const pg = await prep(M.eve ?? M.alice, 'x');
  if (pg) await release(M.eve ?? M.alice, pg.lease);
  await db.query(`update member_login_grants set expires_at = now() - interval '1 second', used_at = null, session_id = null where member_id = $1`, [M.bob]);
  const sidX = await session(bobLogin);
  r = await as('authenticated', jwt(bobLogin, sidX), `select public.member_bind_session($1) v`, [G3]);
  const g3 = await one(`select used_at, session_id from member_login_grants where member_id = $1`, [M.bob]);
  ok(!r.error && r.rows[0].v === null && g3.used_at === null && (await one(`select count(*)::int n from member_sessions where session_id = $1`, [sidX])).n === 0,
    'an expired grant binds nothing');
  const T2 = 'e'.repeat(64);
  await one(`select public.app_ticket_create($1, $2, 'email', $3::uuid[], now(), 300)`, [T2, C1, `{${M.john}}`]);
  await db.query(`update member_choice_tickets set expires_at = now() - interval '1 second' where ticket_hash = $1`, [T2]);
  ok((await all(`select * from public.app_ticket_use($1, $2)`, [T2, C1])).length === 0, 'an expired ticket does nothing');
}
{
  // Realm import never overwrites office contacts, never reactivates, keeps Pillar households
  const ext = await member({ name: 'Import Ivy', email: 'ivy.office@example.com', phone: '', status: 'Inactive', active: true, family_id: 'h-pillar' });
  await db.query(`update church_members set external_id = 'R-1' where id = $1`, [ext]);
  const n = (await one(`select public.app_import_members($1::jsonb) v`, [JSON.stringify([
    { external_id: 'R-1', name: 'Import Ivy', email: 'ivy.realm@example.com', phone: '706-312-0160', address: '1 Realm Rd', family_id: 'F-9', family_name: 'Ivy', active: true, status: 'Active' },
    { external_id: 'R-2', name: 'New Person', email: 'new@example.com', phone: null, address: null, family_id: 'F-10', family_name: 'New', active: true, status: 'Active' },
  ])])).v;
  const ivy = await row(ext);
  ok(n === 2 && ivy.email === 'ivy.office@example.com' && ivy.phone === '706-312-0160' && ivy.status === 'Inactive' && ivy.family_id === 'h-pillar' && ivy.address === '1 Realm Rd',
    "import keeps the office's email, fills a blank phone, keeps Inactive and the Pillar household", JSON.stringify(ivy));
  ok((await one(`select count(*)::int n from church_members where external_id = 'R-2'`)).n === 1, 'import adds new people');
  await one(`select public.app_import_members($1::jsonb)`, [JSON.stringify([{ external_id: 'R-2', name: 'New Person', active: false, status: 'Inactive' }])]);
  ok((await one(`select status, active from church_members where external_id = 'R-2'`)).status === 'Inactive', 'import can still mark someone deceased/inactive');
  r = await as('authenticated', staffJwt, `select public.app_import_members('[]'::jsonb)`);
  ok(/permission denied/.test(r.error || ''), 'only the service (Edge Function) can run the import');
}
{
  // a member whose login was tampered with stops sharing (the name stays: everyone is listed)
  await db.query(`update church_members set include_directory = true, directory_listed = true, share_phone = true where id = $1`, [M.bob]);
  const J = jwt((await row(M.john)).auth_user_id, (await one(`select session_id from member_sessions where member_id = $1`, [M.john])).session_id);
  const d1 = await as('authenticated', J, `select * from public.member_directory(null)`);
  ok(!d1.error && d1.rows.some((x) => x.name === 'Bob Brown' && x.phone === '706.312.0102'), 'John (signed in) sees Bob and his shared phone', d1.error || JSON.stringify(d1.rows));
  const bobEmail = (await one(`select email from auth.users where id = $1`, [bobLogin])).email;
  await db.query(`update auth.users set email = 'moved@example.com' where id = $1`, [bobLogin]);
  const d2 = await as('authenticated', J, `select * from public.member_directory(null)`);
  ok(!d2.error && d2.rows.some((x) => x.name === 'Bob Brown' && x.phone === null), 'a member whose login was tampered with shares nothing more (still listed by name)', JSON.stringify(d2.rows.find((x) => x.name === 'Bob Brown')));
  await db.query(`update auth.users set email = $2 where id = $1`, [bobLogin, bobEmail]);
}

section('member-directory-everyone.sql (the live-database update)');
{
  const defs = async () => (await all(`select p.proname, pg_get_functiondef(p.oid) d, array_to_string(p.proacl, ',') acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('member_me', 'member_update_me', 'member_directory', 'member_directory_photo', 'member_directory_family', 'app_member_forget_login') order by 1`));
  const before = await defs();
  const fs = await import('node:fs');
  const sql = fs.readFileSync(path.join(SUPA, 'member-directory-everyone.sql'), 'utf8');
  let err = null;
  try { await db.exec(sql); await db.exec(sql); } catch (e) { err = e.message; }
  const after = await defs();
  ok(!err && before.length === 6 && JSON.stringify(before) === JSON.stringify(after),
    'applies twice and matches member-app-auth.sql exactly (definitions and grants)', err || JSON.stringify(after.map((x, i) => x.d === before[i]?.d && x.acl === before[i]?.acl)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
