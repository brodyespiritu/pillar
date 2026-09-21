// End-to-end: the member sign-in Edge Functions (member-request-code, member-verify-code,
// member-delete-account, member-contact-request) running on Node with the REAL SQL in PGlite.
// Supabase Auth's admin API, Telnyx and Resend are test doubles (supabase-js-stub.mjs, fetch).
//
// Run:   cd supabase/tests && npm i --no-save @electric-sql/pglite && node member-functions.test.mjs
//   or:  PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node member-functions.test.mjs
// Node 23.5+ (module.registerHooks, TypeScript type stripping). Takes ~1 minute: replies have floors.

import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HERE, SUPA, supabaseLikeDb } from './_pg.mjs';

const STUB = pathToFileURL(path.join(HERE, 'supabase-js-stub.mjs')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('npm:@supabase/supabase-js')) return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};
const section = (t) => console.log(`\n── ${t}`);

// ── World ────────────────────────────────────────────────────────────────────
const { db, as, migrationError } = await supabaseLikeDb();
if (migrationError) { console.log('migration failed:', migrationError); process.exit(1); }
const stub = await import(STUB);
stub.world.db = db; stub.world.as = as;

const ENV = {
  SUPABASE_URL: 'http://pg.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role', SUPABASE_ANON_KEY: 'anon-key',
  MEMBER_AUTH_KEY: Buffer.alloc(32, 7).toString('base64'),
  TELNYX_API_KEY: 'telnyx-key', TELNYX_FROM_NUMBER: '+17065550000',
  RESEND_API_KEY: 're_test', MEMBER_CODE_FROM: 'Bethesda Baptist Church <signin@bethesdaupdates.app>',
};
const handlers = {};
let current = null;
const pending = [];
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handlers[current] = h; } };
globalThis.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

const sent = [];
let telnyxReply = () => ({ status: 200, body: { data: { id: 'msg_1' } } });
let resendReply = () => ({ status: 200, body: { id: 'em_1' } });
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (String(url).startsWith('https://api.telnyx.com/')) {
    sent.push({ via: 'telnyx', to: body.to, text: body.text, from: body.from, auth: init.headers.Authorization });
    const r = telnyxReply(body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url).startsWith('https://api.resend.com/')) {
    sent.push({ via: 'resend', to: body.to[0], text: body.text, html: body.html, subject: body.subject, from: body.from, idem: init.headers['Idempotency-Key'], headers: body.headers });
    const r = resendReply(body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

for (const name of ['member-request-code', 'member-verify-code', 'member-delete-account', 'member-contact-request']) {
  current = name;
  await import(pathToFileURL(path.join(SUPA, 'functions', name, 'index.ts')).href);
}
const server = await import(pathToFileURL(path.join(SUPA, 'functions/_shared/memberAuthServer.ts')).href);

let ipCounter = 1;
async function call(fn, { method = 'POST', body, ip, headers = {} } = {}) {
  const req = new Request(`http://fn/${fn}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `203.0.113.${ipCounter}`, ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const t0 = Date.now();
  const res = await handlers[fn](req);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, ms: Date.now() - t0 };
}
const request = (identifier, mode, ip) => call('member-request-code', { body: { identifier, mode }, ip });
const verify = (identifier, mode, code, ip) => call('member-verify-code', { body: { identifier, mode, code }, ip });
const lastCode = () => { const m = /\b(\d{6})\b/.exec(sent[sent.length - 1]?.text || ''); return m && m[1]; };
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// The app's side of a signed_in reply: verifyOtp(token_hash), then member_bind_session(grant).
async function finishSignIn(reply) {
  const s = await stub.verifyTokenHash(reply.json.token_hash);
  if (!s) return { error: 'verifyOtp failed' };
  const r = await as('authenticated', s.claims, `select public.member_bind_session($1) v`, [reply.json.grant]);
  return { ...s, profile: r.error ? null : r.rows[0].v, error: r.error };
}
const me = async (claims) => { const r = await as('authenticated', claims, `select public.member_me() v`); return r.error ? null : r.rows[0].v; };

// ── Seed ─────────────────────────────────────────────────────────────────────
async function member(fields) {
  const cols = Object.keys(fields);
  return (await one(`insert into church_members (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(fields))).id;
}
const M = {
  alice: await member({ name: 'Alice Adams', email: 'alice@example.com', phone: '(706) 312-0101', family_id: 'H1', family_position: 'Head' }),
  john:  await member({ name: 'John Smith', email: 'smiths@example.com', phone: '706-312-0120', family_id: 'H2', family_position: 'Head' }),
  jane:  await member({ name: 'Jane Smith', email: 'smiths@example.com', family_id: 'H2', family_position: 'Spouse' }),
  gary:  await member({ name: 'Gary Gone', email: 'gary@example.com', phone: '706-312-0130' }),
  eve:   await member({ name: 'Eve Email', email: 'Eve@Example.com' }),
};
const STAFF = (await one(`insert into auth.users (email, email_confirmed_at) values ('pastor@church.test', now()) returning id`)).id;
await db.query(`insert into staff (id, name, active) values ($1, 'Pastor', true)`, [STAFF]);

// ── Channels and validation ──────────────────────────────────────────────────
section('channels and validation');
let r = await call('member-request-code', { method: 'GET' });
ok(r.status === 200 && r.json.channels.sms === false && r.json.channels.email === true, 'out of the box only email is offered (texting stays off until switched on)', JSON.stringify(r.json));
r = await request('7063120101', 'phone');
ok(r.status === 503 && r.json.error_code === 'channel_unavailable' && sent.length === 0, 'a switched-off channel is refused the same way for everyone, and nothing is texted');
await db.query(`update app_auth_settings set sms_enabled = true`);
r = await call('member-request-code', { method: 'GET' });
ok(r.json.channels.sms === true && r.json.channels.email === true, 'switching texting on in settings offers both');
r = await request('706-312-0101 ext 4', 'phone');
ok(r.status === 400 && r.json.error_code === 'invalid_contact' && r.ms >= 590, 'invalid number → 400 at the same pace', JSON.stringify(r));
r = await request('alice@', 'email');
ok(r.status === 400 && r.json.error_code === 'invalid_contact', 'invalid email → 400');
r = await request('alice@example.com', 'carrier-pigeon');
ok(r.status === 400, 'unknown mode → 400');

// ── Requesting codes: same answer for members and strangers ─────────────────
section('requesting a code');
ipCounter++;
sent.length = 0;
const rMember = await request('(706) 312-0101', 'phone', '198.51.100.1');
const rStranger = await request('(706) 312-0999', 'phone', '198.51.100.2');
await settle();
ok(rMember.status === 200 && rStranger.status === 200 && JSON.stringify(rMember.json) === JSON.stringify(rStranger.json),
  'member and stranger get identical replies', JSON.stringify([rMember.json, rStranger.json]));
ok(rMember.ms >= 590 && rStranger.ms >= 590, 'both replies take at least the floor');
ok(sent.length === 1 && sent[0].via === 'telnyx' && sent[0].to === '+17063120101' && sent[0].from === '+17065550000', 'only the member is texted, at their normalised number', JSON.stringify(sent));
ok(/^\d{6} is your Bethesda Baptist Church app sign-in code\. It expires in 5 minutes\. Never share it\.$/.test(sent[0].text), 'text message wording', sent[0].text);
ok(rMember.json.expires_in === 300 && rMember.json.resend_after === 60, 'texts expire in 5 minutes; resend after 60 s');
const aliceCode = lastCode();
const events = (await db.query(`select event, contact_ref, provider_code from member_auth_events order by id`)).rows;
ok(events.some((e) => e.event === 'send_ok') && events.some((e) => e.event === 'request_no_match'), 'audit trail records a send and a no-match', JSON.stringify(events));
ok(!/7063120|alice|example\.com/i.test(JSON.stringify(events)) && !JSON.stringify(events).includes(aliceCode), 'audit trail never holds contacts or codes', JSON.stringify(events));
const codeRows = (await db.query(`select contact_id, code_mac from member_login_codes`)).rows;
ok(codeRows.length === 1 && !JSON.stringify(codeRows).includes(aliceCode) && /^[0-9a-f]{64}$/.test(codeRows[0].contact_id), 'only HMACs are stored for the one live code');

r = await request('706.312.0101', 'phone', '198.51.100.3');
ok(r.status === 429 && r.json.error_code === 'too_many_requests' && r.json.retry_after === 60, 'asking again within a minute → wait (per contact, any network)', JSON.stringify(r.json));
r = await request('706.312.0999', 'phone', '198.51.100.4');
ok(r.status === 429 && r.json.error_code === 'too_many_requests', '… same for a stranger, so limits reveal nothing');

// ── Verifying ────────────────────────────────────────────────────────────────
section('verifying a code');
const wrong = aliceCode === '000000' ? '111111' : '000000';
for (let i = 0; i < 3; i++) {
  r = await verify('7063120101', 'phone', wrong, '198.51.100.9');
  ok(r.status === 400 && r.json.error_code === 'invalid_code' && r.ms >= 890, `wrong code #${i + 1} → invalid_code`);
}
r = await verify('7063120999', 'phone', '123456', '198.51.100.9');
ok(r.status === 400 && r.json.error_code === 'invalid_code', 'a code for a contact that never got one looks exactly the same');
r = await verify('(706) 312-0101', 'phone', aliceCode, '198.51.100.9');
const firstReply = r;
ok(r.status === 200 && r.json.status === 'signed_in' && r.json.token_hash && r.json.grant && r.json.expires_in === 300, 'the right code signs in', JSON.stringify(r.json));
ok(!('email_otp' in r.json) && !JSON.stringify(r.json).includes('members.invalid') && !JSON.stringify(r.json).includes('action_link'), 'reply carries only the token hash and grant');
const login1 = await one(`select auth_user_id, app_login_email from church_members where id = $1`, [M.alice]);
ok(/^m-[0-9a-f]{32}@members\.invalid$/.test(login1.app_login_email) && login1.auth_user_id, 'the record got its own random login address', JSON.stringify(login1));
const u1 = await one(`select email, phone, raw_app_meta_data from auth.users where id = $1`, [login1.auth_user_id]);
ok(u1.phone === null && u1.raw_app_meta_data.bbc_member_id === M.alice && u1.email === login1.app_login_email, 'the login holds no real contact');
const s1 = await finishSignIn(r);
ok(s1.profile && s1.profile.member_id === M.alice && s1.profile.name === 'Alice Adams', 'verifyOtp + bind → profile', JSON.stringify(s1));
ok((await me(s1.claims))?.member_id === M.alice, 'member_me works for the bound session');
r = await verify('7063120101', 'phone', aliceCode, '198.51.100.9');
ok(r.status === 400 && r.json.error_code === 'invalid_code', 'a code works once');
ok(await stub.verifyTokenHash(firstReply.json.token_hash) === null, 'a token_hash works once');
ok((await one(`select app_mint_lease_until from church_members where id = $1`, [M.alice])).app_mint_lease_until === null, 'redeeming ends the short hold on the record');

// grant cannot be reused by another session of the same login (e.g. a Supabase /recover session)
{
  const sid = (await one(`insert into auth.sessions (user_id) values ($1) returning id`, [login1.auth_user_id])).id;
  const claims = { sub: login1.auth_user_id, role: 'authenticated', session_id: sid, amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }] };
  ok(await me(claims) === null, 'a session on the same login that did not come through the code flow gets nothing');
}

// exhausted code
ipCounter++;
await db.query(`delete from app_rate_events where bucket like 'req-contact%'`);
await request('eve@example.com', 'email', '198.51.100.20');
await settle();
const eveCode = /\n(\d{6})\n/.exec(sent[sent.length - 1].text)[1];
ok(sent[sent.length - 1].via === 'resend' && sent[sent.length - 1].to === 'eve@example.com', 'email code goes to the lowercased address on file');
ok(!sent[sent.length - 1].subject.match(/\d{6}/) && !sent[sent.length - 1].html.match(/https?:\/\//) && sent[sent.length - 1].headers['Auto-Submitted'] === 'auto-generated',
  'email: no code in the subject, no links, marked auto-generated');
ok(/^[0-9a-f]{32}-\d+$/.test(sent[sent.length - 1].idem) && !sent[sent.length - 1].idem.includes('eve'), 'email idempotency key has no address in it');
for (let i = 0; i < 5; i++) await verify('eve@example.com', 'email', eveCode === '000000' ? '111111' : '000000', '198.51.100.21');
r = await verify('eve@example.com', 'email', eveCode, '198.51.100.21');
ok(r.status === 400 && r.json.error_code === 'invalid_code', 'after 5 wrong tries the right code no longer works');
r = await verify('eve@example.com', 'email', eveCode, '198.51.100.21');
ok(r.status === 400, '… and keeps not working');
for (let i = 0; i < 5; i++) await verify('eve@example.com', 'email', '222222', '198.51.100.22');
r = await verify('eve@example.com', 'email', '333333', '198.51.100.23');
ok(r.status === 429 && r.json.error_code === 'too_many_attempts', 'more than 10 tries a day for one contact → paused', JSON.stringify(r.json));

// ── Family sharing an email ──────────────────────────────────────────────────
section('shared family email');
ipCounter++;
await request('smiths@example.com', 'email', '198.51.100.30');
await settle();
const smithCode = /\n(\d{6})\n/.exec(sent[sent.length - 1].text)[1];
r = await verify('SMITHS@example.com', 'email', smithCode, '198.51.100.30');
ok(r.status === 200 && r.json.status === 'choose' && r.json.candidates.length === 2 && r.json.ticket, 'shared email → choose', JSON.stringify(r.json));
ok(JSON.stringify(r.json.candidates) === JSON.stringify([{ choice: 1, name: 'Jane Smith' }, { choice: 2, name: 'John Smith' }]), 'candidates are names with choice numbers, no ids');
const ticket = r.json.ticket;
let c = await call('member-verify-code', { body: { identifier: 'someone@example.com', mode: 'email', ticket, choice: 1 }, ip: '198.51.100.30' });
ok(c.status === 400 && c.json.error_code === 'ticket_expired', 'a ticket only works with the contact that earned it');
c = await call('member-verify-code', { body: { identifier: 'smiths@example.com', mode: 'email', ticket, choice: 1 }, ip: '198.51.100.30' });
ok(c.status === 200 && c.json.status === 'signed_in', 'choosing signs in', JSON.stringify(c.json));
const sj = await finishSignIn(c);
ok(sj.profile?.member_id === M.jane, 'as the chosen person');
c = await call('member-verify-code', { body: { identifier: 'smiths@example.com', mode: 'email', ticket, choice: 2 }, ip: '198.51.100.30' });
ok(c.status === 400 && c.json.error_code === 'ticket_expired', 'a ticket works once');

// ── Record changes between request and verify / after sign-in ────────────────
section('records changing');
ipCounter++;
await request('gary@example.com', 'email', '198.51.100.40');
await settle();
const garyCode = /\n(\d{6})\n/.exec(sent[sent.length - 1].text)[1];
await db.query(`update church_members set status = 'Inactive' where id = $1`, [M.gary]);
r = await verify('gary@example.com', 'email', garyCode, '198.51.100.40');
ok(r.status === 200 && r.json.status === 'no_member', 'record deactivated after the code was sent → no_member', JSON.stringify(r.json));
await db.query(`update church_members set status = 'Active' where id = $1`, [M.gary]);

// office changes Alice's phone → her session stops; her next sign-in rebuilds the login
await as('authenticated', { sub: STAFF, role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] },
  `update church_members set phone = '706-312-0102' where id = $1`, [M.alice]);
ok(await me(s1.claims) === null, "office changing a member's phone signs their sessions out");
await db.query(`delete from app_rate_events where bucket like 'req-%'`);
const sentBeforeOld = sent.length;
await request('7063120101', 'phone', '198.51.100.41');
await settle();
ok(sent.length === sentBeforeOld, "the number the office removed no longer gets codes");
r = await request('7063120102', 'phone', '198.51.100.42');
await settle();
const newCode = lastCode();
ok(sent[sent.length - 1].to === '+17063120102', 'the old number no longer gets codes; the new one does');
r = await verify('7063120102', 'phone', newCode, '198.51.100.42');
ok(r.status === 200 && r.json.status === 'signed_in', 'sign-in with the new number works', JSON.stringify(r.json));
const login2 = await one(`select auth_user_id, app_login_email from church_members where id = $1`, [M.alice]);
ok(login2.auth_user_id !== login1.auth_user_id && login2.app_login_email !== login1.app_login_email, 'the old login was replaced with a new one at a new address');
ok((await one(`select count(*)::int n from auth.users where id = $1`, [login1.auth_user_id])).n === 0, 'the old login (and its sessions) are gone');
const s2 = await finishSignIn(r);
ok(s2.profile?.member_id === M.alice, 'Alice is signed in again');

// tampering with the login (a phone added via Supabase's own API) → rebuilt on next sign-in
await db.query(`update auth.users set phone = '17065550199' where id = $1`, [login2.auth_user_id]);
ok(await me(s2.claims) === null, 'a login someone changed stops working at once');
await db.query(`delete from app_rate_events where bucket like 'req-%'`);
await request('7063120102', 'phone', '198.51.100.43');
await settle();
r = await verify('7063120102', 'phone', lastCode(), '198.51.100.43');
const login3 = await one(`select auth_user_id from church_members where id = $1`, [M.alice]);
ok(r.json.status === 'signed_in' && login3.auth_user_id !== login2.auth_user_id, 'and is rebuilt on the next sign-in');
const s3 = await finishSignIn(r);

// ── Provider failures, caps, breaker, kill switch ────────────────────────────
section('failures and safety switches');
await db.query(`delete from app_rate_events where bucket like 'req-%'`);
telnyxReply = () => ({ status: 403, body: { errors: [{ code: '40300', title: 'Blocked due to STOP message', detail: 'Messages cannot be sent from +17065550000 to +17063120120' }] } });
r = await request('706-312-0120', 'phone', '198.51.100.50');
await settle();
telnyxReply = () => ({ status: 200, body: { data: { id: 'msg' } } });
const stopEvent = await one(`select event, provider_code, outcome from member_auth_events order by id desc limit 1`);
ok(r.status === 200 && stopEvent.event === 'send_failed' && stopEvent.provider_code === 'blocked_stop', 'a member who texted STOP: same reply, logged as blocked_stop', JSON.stringify(stopEvent));
ok(!JSON.stringify(await db.query(`select * from member_auth_events`)).includes('+1706'), 'provider error details (with numbers) are never logged');

await db.query(`delete from app_rate_events where bucket like 'req-%' or bucket like 'send-%'`);
await db.query(`update app_auth_settings set sms_per_hour = 1`);
const before = sent.length;
await request('706-312-0130', 'phone', '198.51.100.51');
await settle();
await db.query(`delete from app_rate_events where bucket like 'req-%'`);
await request('706-312-0120', 'phone', '198.51.100.52');
await settle();
ok(sent.length === before + 1 && (await one(`select event from member_auth_events order by id desc limit 1`)).event === 'send_capped', 'the hourly text cap stops sends (logged)');
await db.query(`update app_auth_settings set sms_per_hour = 40`);

await db.query(`update app_auth_settings set breaker_fails_hour = 2`);
await db.query(`delete from app_rate_events where bucket like 'req-%' or bucket like 'send-%' or bucket like 'verify-%'`);
await request('706-312-0130', 'phone', '198.51.100.53');
await settle();
const garyText = lastCode();
for (let i = 0; i < 3; i++) await verify('706-312-0130', 'phone', garyText === '000000' ? '111111' : '000000', `198.51.100.${60 + i}`);
const settings = await one(`select breaker_open_until from app_auth_settings`);
ok(settings.breaker_open_until && new Date(settings.breaker_open_until) > new Date(), 'too many failed guesses at live codes opens the breaker');
r = await request('alice@example.com', 'email', '198.51.100.70');
ok(r.status === 503 && r.json.error_code === 'busy', 'while open, no new codes are issued');
await db.query(`update app_auth_settings set breaker_open_until = null, breaker_fails_hour = 50`);

await db.query(`update app_auth_settings set signin_enabled = false`);
r = await request('alice@example.com', 'email', '198.51.100.71');
const rv = await verify('alice@example.com', 'email', '123456', '198.51.100.71');
ok(r.status === 503 && r.json.error_code === 'unavailable' && rv.status === 503, 'kill switch stops requests and verification');
await db.query(`update app_auth_settings set signin_enabled = true`);

const savedKey = server.env.resendKey;
server.env.resendKey = undefined;
r = await request('alice@example.com', 'email', '198.51.100.72');
ok(r.status === 503 && r.json.error_code === 'channel_unavailable', 'email without Resend configured → channel_unavailable');
server.env.resendKey = savedKey;

// ── Two devices, one record ──────────────────────────────────────────────────
section('two devices signing in to one record');
{
  await db.query(`delete from app_rate_events where bucket like 'req-%'`);
  await db.query(`update church_members set email = 'john.own@example.com' where id = $1`, [M.john]);   // John's own email + phone
  await request('706-312-0120', 'phone', '198.51.100.80');
  await settle();
  const phoneCode = lastCode();
  await request('john.own@example.com', 'email', '198.51.100.81');
  await settle();
  const emailCode = /\n(\d{6})\n/.exec(sent[sent.length - 1].text)[1];
  const d1 = await verify('706-312-0120', 'phone', phoneCode, '198.51.100.80');
  ok(d1.json?.status === 'signed_in', 'phone signs in', JSON.stringify(d1.json));
  const t0 = Date.now();
  const d2p = verify('john.own@example.com', 'email', emailCode, '198.51.100.81');   // starts while device 1 hasn't redeemed
  await new Promise((res) => setTimeout(res, 1500));
  const s1 = await finishSignIn(d1);                                                   // device 1 redeems → hold ends
  const d2 = await d2p;
  ok(s1.profile?.member_id === M.john, 'device 1 redeems its token even though device 2 was verifying at the same time');
  ok(d2.json?.status === 'signed_in' && Date.now() - t0 < 9000, 'device 2 waits for the hold, then signs in', JSON.stringify({ ms: Date.now() - t0, j: d2.json }));
  const s2 = await finishSignIn(d2);
  ok(s2.profile?.member_id === M.john && (await me(s1.claims))?.member_id === M.john, 'both devices are signed in');
}

// ── Bans ─────────────────────────────────────────────────────────────────────
section('a banned app login');
{
  const jl = (await one(`select auth_user_id from church_members where id = $1`, [M.john])).auth_user_id;
  await db.query(`update auth.users set banned_until = now() + interval '30 days' where id = $1`, [jl]);
  await db.query(`delete from app_rate_events where bucket like 'req-%'`);
  const before = sent.length;
  await request('706-312-0120', 'phone', '198.51.100.82');
  await settle();
  ok(sent.length === before && (await one(`select event from member_auth_events order by id desc limit 1`)).event === 'request_no_match',
    'a banned member gets no code (the ban is not repaired by signing in again)');
  ok((await one(`select count(*)::int n from auth.users where id = $1`, [jl])).n === 1, 'the banned login is left in place');
  await db.query(`update auth.users set banned_until = null where id = $1`, [jl]);
}

// ── Delete account ───────────────────────────────────────────────────────────
section('delete account');
const bearerFor = (claims) => { const t = `t-${Math.random()}`; stub.world.tokens.set(t, claims); return t; };
r = await call('member-delete-account', {});
ok(r.status === 401, 'no token → 401');
r = await call('member-delete-account', { headers: { Authorization: `Bearer ${bearerFor({ sub: STAFF, role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] })}` } });
ok(r.status === 401, 'a staff session cannot delete anything here');
{
  const sid = (await one(`insert into auth.sessions (user_id) values ($1) returning id`, [login3.auth_user_id])).id;
  r = await call('member-delete-account', { headers: { Authorization: `Bearer ${bearerFor({ sub: login3.auth_user_id, role: 'authenticated', session_id: sid, amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }] })}` } });
  ok(r.status === 401, 'an unbound session on the member login cannot delete the account');
}
stub.world.failNext.deleteUser = 1;
r = await call('member-delete-account', { headers: { Authorization: `Bearer ${s3.bearer}` } });
ok(r.status === 500 && (await me(s3.claims))?.member_id === M.alice, 'a failed delete changes nothing (still signed in)');
r = await call('member-delete-account', { headers: { Authorization: `Bearer ${s3.bearer}` } });
ok(r.status === 200 && r.json.ok, 'retrying deletes the app account', JSON.stringify(r.json));
const aliceRow = await one(`select auth_user_id, name, email from church_members where id = $1`, [M.alice]);
ok(aliceRow.auth_user_id === null && aliceRow.name === 'Alice Adams', 'login gone, church record kept');
ok((await one(`select count(*)::int n from auth.users where id = $1`, [login3.auth_user_id])).n === 0 && await me(s3.claims) === null, 'session no longer works');

// ── Contact the office ───────────────────────────────────────────────────────
section('contact the church office');
r = await call('member-contact-request', { body: { name: 'N', contact: 'x@example.com' } });
ok(r.status === 400, 'validation');
for (let i = 0; i < 5; i++) r = await call('member-contact-request', { body: { name: 'New Person', contact: 'new@example.com', message: 'Hi' }, ip: '192.0.2.9' });
ok(r.status === 200 && (await one(`select count(*)::int n from member_access_requests`)).n === 5, 'requests saved for staff');
r = await call('member-contact-request', { body: { name: 'New Person', contact: 'new@example.com' }, ip: '192.0.2.9' });
ok(r.status === 429, 'rate limited per network');

// ── Logs and storage hold no raw contacts ───────────────────────────────────
section('privacy of stored data');
const dump = JSON.stringify([
  (await db.query(`select * from member_auth_events`)).rows, (await db.query(`select * from app_rate_events`)).rows,
  (await db.query(`select * from member_login_codes`)).rows, (await db.query(`select * from member_choice_tickets`)).rows,
  (await db.query(`select * from member_login_grants`)).rows,
]);
ok(!/example\.com|706312|\+1706|203\.0\.113|198\.51\.100/.test(dump), 'no emails, numbers or IPs in sign-in tables');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
