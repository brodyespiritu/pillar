// Supabase Edge Function — check a member's one-time code and start their app session.
//
// Deploy:  npx supabase functions deploy member-verify-code --no-verify-jwt
//
// POST { identifier, mode, code }            the code from the text or email
// POST { identifier, mode, ticket, choice }  "Which one is you?" when a family shares a contact
//   → 200 { status: 'signed_in', token_hash, grant, expires_in }
//         the app calls supabase.auth.verifyOtp({ token_hash, type: 'email' }) and then
//         rpc('member_bind_session', { p_grant: grant })
//   → 200 { status: 'choose', ticket, expires_in, candidates: [{ choice, name }] }
//   → 200 { status: 'no_member' }
//   → 400 invalid_code · 400 ticket_expired · 429 too_many_attempts · 503 unavailable / busy
//
// Every wrong, missing, expired, used or exhausted code gets the same invalid_code reply, at the
// same pace. The other answers need a correct code, so none of them reveals who attends.
//
// A session is minted for the record's OWN login (m-<random>@<domain>, no phone, no password anyone
// knows, created here). Supabase Auth's token only works together with the grant: the member RPCs
// serve sessions that redeemed a grant, so a session obtained any other way gets nothing.

import { parseContact, type Contact } from '../_shared/memberContact.ts';
import { macHex, randomLoginEmail, randomToken, sha256Hex } from '../_shared/memberCrypto.ts';
import {
  adminClient, clientIp, env, floor, GRANT_TTL_SECONDS, json, loadConfig, logEvent, memberKeys, MSG, preflight,
  rateHit, TICKET_TTL_SECONDS, type Admin, type AuthConfig,
} from '../_shared/memberAuthServer.ts';

const FAIL_FLOOR_MS = 900;
const invalidCode = () => json({ error_code: 'invalid_code', error: "That code didn't work." }, 400);
const ticketExpired = () => json({ error_code: 'ticket_expired', error: 'That took a little too long. Please start again.' }, 400);
const busy = () => json({ error_code: 'busy', error: MSG.busy }, 503);

class Busy extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const started = Date.now();
  const admin = adminClient();
  const keys = await memberKeys();
  const cfg = await loadConfig(admin);
  if (!cfg || !keys || !cfg.signin_enabled) return floor(started, FAIL_FLOOR_MS, json({ error_code: 'unavailable', error: MSG.notReady }, 503));

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'phone' ? 'phone' : body?.mode === 'email' ? 'email' : null;
  const contact = parseContact(body?.identifier, mode);
  const ipId = await macHex(keys.ip, clientIp(req));
  if (!contact) return floor(started, FAIL_FLOOR_MS, body?.ticket ? ticketExpired() : invalidCode());
  const contactId = await macHex(keys.contact, contact.key);
  const channel = contact.kind === 'phone' ? 'sms' : 'email';

  try {
    if (body?.ticket != null) return await choose(started, admin, contact, contactId, ipId, String(body.ticket), Number(body.choice));
    return await verify(started, admin, keys.code, cfg, contact, contactId, ipId, String(body?.code ?? ''));
  } catch (e) {
    await logEvent(admin, { event: e instanceof Busy ? 'mint_busy' : 'verify_error', channel, contactId, ipId, outcome: (e as Error)?.message ?? null });
    return floor(started, FAIL_FLOOR_MS, busy());
  }
});

async function verify(started: number, admin: Admin, codeKey: CryptoKey, cfg: AuthConfig, contact: Contact,
  contactId: string, ipId: string, rawCode: string): Promise<Response> {
  const channel = contact.kind === 'phone' ? 'sms' : 'email';
  const code = rawCode.replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return floor(started, FAIL_FLOOR_MS, invalidCode());

  const refused = await rateHit(admin, [
    { bucket: 'verify-contact-1d', key: contactId, limit: 10, window_seconds: 86400 },
    { bucket: 'verify-ip-10m',     key: ipId,      limit: 60, window_seconds: 600 },
  ]);
  if (refused) {
    await logEvent(admin, { event: 'verify_rate_limited', channel, contactId, ipId, outcome: refused });
    return floor(started, FAIL_FLOOR_MS, json({
      error_code: 'too_many_attempts',
      error: refused === 'verify-ip-10m'
        ? 'Too many tries from this network. Please wait a few minutes.'
        : 'Too many tries. For your security, sign-in is paused for this email or number. Try again tomorrow, or contact the church office.',
    }, 429));
  }

  const codeMac = await macHex(codeKey, `${contactId}:${code}`);
  const { data: rows, error } = await admin.rpc('app_code_consume', { p_contact_id: contactId, p_code_mac: codeMac });
  if (error) throw new Error('consume');
  const row = rows?.[0] as { ok: boolean; channel: string; code_created_at: string } | undefined;

  if (!row || !row.ok) {
    await logEvent(admin, { event: 'verify_invalid', channel, contactId, ipId, outcome: row ? 'live' : 'no_live_code' });
    if (row) {
      // Only failures against a live code count toward the breaker (others can never succeed).
      const tripped = await rateHit(admin, [
        { bucket: 'verify-fail-1h', key: 'all', limit: cfg.breaker_fails_hour, window_seconds: 3600 },
        { bucket: 'verify-fail-1d', key: 'all', limit: cfg.breaker_fails_day, window_seconds: 86400 },
      ]);
      if (tripped) {
        await admin.rpc('app_breaker_open', { p_minutes: 60 });
        await logEvent(admin, { event: 'breaker_open', outcome: tripped });
      }
    }
    return floor(started, FAIL_FLOOR_MS, invalidCode());
  }

  const candidates = await loadCandidates(admin, contact, row.code_created_at);
  if (!candidates.length) {
    await logEvent(admin, { event: 'verify_no_member', channel, contactId, ipId });
    return json({ status: 'no_member' });
  }
  if (candidates.length === 1 && candidates[0].matched_count === 1) {
    const minted = await mint(admin, candidates[0].member_id, contact, row.code_created_at);
    await logEvent(admin, { event: 'signed_in', channel, contactId, ipId, memberId: candidates[0].member_id });
    return json({ status: 'signed_in', ...minted, expires_in: GRANT_TTL_SECONDS });
  }

  const ticket = randomToken(32);
  const { error: tErr } = await admin.rpc('app_ticket_create', {
    p_ticket_hash: await sha256Hex(ticket), p_contact_id: contactId, p_channel: channel,
    p_member_ids: candidates.map((c) => c.member_id), p_code_created_at: row.code_created_at,
    p_ttl_seconds: TICKET_TTL_SECONDS,
  });
  if (tErr) throw new Error('ticket');
  await logEvent(admin, { event: 'choose_issued', channel, contactId, ipId, outcome: String(candidates.length) });
  return json({
    status: 'choose', ticket, expires_in: TICKET_TTL_SECONDS,
    candidates: candidates.map((c, i) => ({ choice: i + 1, name: c.name })),
  });
}

async function choose(started: number, admin: Admin, contact: Contact, contactId: string, ipId: string,
  ticket: string, choice: number): Promise<Response> {
  const channel = contact.kind === 'phone' ? 'sms' : 'email';
  const refused = await rateHit(admin, [{ bucket: 'choose-ip-10m', key: ipId, limit: 30, window_seconds: 600 }]);
  if (refused) {
    return floor(started, FAIL_FLOOR_MS, json({ error_code: 'too_many_attempts', error: 'Too many tries from this network. Please wait a few minutes.' }, 429));
  }
  if (ticket.length < 32 || ticket.length > 64) return floor(started, FAIL_FLOOR_MS, ticketExpired());

  const { data: rows, error } = await admin.rpc('app_ticket_use', { p_ticket_hash: await sha256Hex(ticket), p_contact_id: contactId });
  if (error) throw new Error('ticket_use');
  const t = rows?.[0] as { member_ids: string[]; code_created_at: string } | undefined;
  if (!t || !Number.isInteger(choice) || choice < 1 || choice > t.member_ids.length) {
    await logEvent(admin, { event: 'ticket_invalid', channel, contactId, ipId });
    return floor(started, FAIL_FLOOR_MS, ticketExpired());
  }
  const memberId = t.member_ids[choice - 1];
  const still = (await loadCandidates(admin, contact, t.code_created_at)).some((c) => c.member_id === memberId);
  if (!still) {
    await logEvent(admin, { event: 'ticket_stale', channel, contactId, ipId });
    return floor(started, FAIL_FLOOR_MS, ticketExpired());
  }
  const minted = await mint(admin, memberId, contact, t.code_created_at);
  await logEvent(admin, { event: 'signed_in', channel, contactId, ipId, memberId, outcome: 'chosen' });
  return json({ status: 'signed_in', ...minted, expires_in: GRANT_TTL_SECONDS });
}

type Candidate = { member_id: string; name: string; household: string; matched_count: number };
async function loadCandidates(admin: Admin, contact: Contact, since: string): Promise<Candidate[]> {
  const { data, error } = await admin.rpc('app_login_candidates', {
    p_email: contact.kind === 'email' ? contact.norm : null,
    p_phone: contact.kind === 'phone' ? contact.norm : null,
    p_since: since,
  });
  if (error) throw new Error('candidates');
  return (data ?? []) as Candidate[];
}

async function deleteLogin(admin: Admin, id: string) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error && (error as { status?: number }).status !== 404) throw new Busy('delete_login');
}

/** The record's own login → a one-time Supabase token plus our grant. */
async function mint(admin: Admin, memberId: string, contact: Contact, since: string) {
  const channel = contact.kind === 'phone' ? 'sms' : 'email';
  // One sign-in per record at a time. Another device may have just been handed a token for this
  // login (held ~10 s so it can redeem it): wait for it rather than silently voiding its token.
  let p: { login_email: string; auth_user_id: string | null; login_ok: boolean; lease: string } | undefined;
  for (let i = 0; i < 25 && !p; i++) {
    const { data: prep, error: pErr } = await admin.rpc('app_member_login_prepare', {
      p_member_id: memberId, p_new_login_email: randomLoginEmail(env.loginDomain),
    });
    if (pErr) throw new Error('prepare');
    p = prep?.[0];
    if (!p) await new Promise((r) => setTimeout(r, 500));
  }
  if (!p) throw new Busy('lease');
  const lease = p.lease;

  let succeeded = false;
  try {
    let uid = p.auth_user_id;
    let loginEmail = p.login_email;

    if (!uid || !p.login_ok) {
      // Anything not exactly as we left it (a password set, email or phone changed, contacts changed
      // at the office since it was made) is thrown away, with its sessions, and made again. Only
      // logins made for this record are ever deleted — never staff logins — and a banned one blocks
      // sign-in instead of being replaced.
      const { data: users, error: uErr } = await admin.rpc('app_member_login_users', { p_member_id: memberId });
      if (uErr) throw new Error('login_users');
      const logins = (users ?? []) as { auth_user_id: string; banned: boolean }[];
      if (logins.some((u) => u.banned)) throw new Busy('banned');
      for (const u of logins) await deleteLogin(admin, u.auth_user_id);

      let created: { id: string } | null = null;
      for (let i = 0; i < 2 && !created; i++) {
        const { data: rotated, error: rErr } = await admin.rpc('app_member_login_rotate', {
          p_member_id: memberId, p_new_login_email: randomLoginEmail(env.loginDomain), p_lease: lease,
        });
        if (rErr || !rotated) throw new Busy('rotate');
        loginEmail = String(rotated);
        const { data, error } = await admin.auth.admin.createUser({
          email: loginEmail, email_confirm: true, app_metadata: { bbc_member_id: memberId },
        });
        if (!error && data?.user?.id) created = { id: data.user.id };
        else if (!/already|exist|registered/i.test(String(error?.message ?? ''))) throw new Error('create_login');
      }
      if (!created) throw new Busy('create_login');
      uid = created.id;

      const { data: linked, error: lErr } = await admin.rpc('app_member_link_login', {
        p_member_id: memberId, p_auth_user_id: uid,
        p_email: contact.kind === 'email' ? contact.norm : null,
        p_phone: contact.kind === 'phone' ? contact.norm : null,
        p_since: since, p_lease: lease,
      });
      if (lErr || linked !== true) { await deleteLogin(admin, uid).catch(() => {}); throw new Busy('link'); }
      const { data: okNow } = await admin.rpc('app_member_login_ok', { p_member_id: memberId });
      if (okNow !== true) throw new Busy('login_check');
    }

    // type 'recovery': a missing address fails instead of quietly creating a user.
    const { data: link, error: gErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: loginEmail });
    const props = link?.properties as { hashed_token?: string; verification_type?: string } | undefined;
    if (gErr || link?.user?.id !== uid || props?.verification_type !== 'recovery' || !props?.hashed_token) {
      throw new Error('generate_link');
    }

    // The grant is only created if nothing about the record changed since the code was issued.
    const grant = randomToken(32);
    const { data: granted, error: gcErr } = await admin.rpc('app_grant_create', {
      p_grant_hash: await sha256Hex(grant), p_member_id: memberId, p_auth_user_id: uid,
      p_ttl_seconds: GRANT_TTL_SECONDS, p_code_created_at: since, p_channel: channel,
    });
    if (gcErr || granted !== true) throw new Busy('grant');
    succeeded = true;
    return { token_hash: props.hashed_token, grant };
  } finally {
    if (succeeded) await admin.rpc('app_member_login_hold', { p_member_id: memberId, p_lease: lease, p_seconds: 10 });
    else await admin.rpc('app_member_login_release', { p_member_id: memberId, p_lease: lease });
  }
}
