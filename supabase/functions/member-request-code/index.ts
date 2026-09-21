// Supabase Edge Function — send a one-time sign-in code to a member of the congregation.
//
// Deploy:  npx supabase functions deploy member-request-code --no-verify-jwt
//          (called before the member has a login, so there is no JWT to check)
// Needs:   supabase/member-app-auth.sql, secret MEMBER_AUTH_KEY, and for each channel its
//          provider secrets (email: RESEND_API_KEY + MEMBER_CODE_FROM; texts, which are off unless
//          app_auth_settings.sms_enabled is turned on: TELNYX_API_KEY + TELNYX_CODE_FROM_NUMBER or
//          TELNYX_FROM_NUMBER). See supabase/MEMBER-SIGN-IN.md.
//
// GET  → { channels: { sms, email } }   which ways of signing in are switched on (same for everyone)
// POST { identifier, mode: 'phone'|'email' }
//      → 200 { ok, channel, expires_in, resend_after }   whether or not the contact is on file
//      → 400 invalid_contact · 429 too_many_requests · 503 channel_unavailable / unavailable / busy
//
// Everything that depends on membership — the record lookup, issuing the code, sending it —
// happens AFTER the reply, in the background, so neither the reply nor its timing can reveal
// who attends. Codes only ever go to a contact that is on an eligible church record.

import { parseContact } from '../_shared/memberContact.ts';
import { macHex, sixDigitCode } from '../_shared/memberCrypto.ts';
import {
  adminClient, background, breakerOpen, channels, clientIp, EMAIL_TTL_SECONDS, floor, json, loadConfig, logEvent,
  memberKeys, MSG, preflight, rateHit, RESEND_AFTER_SECONDS, sendEmail, sendSms, SMS_TTL_SECONDS,
  type Admin, type AuthConfig,
} from '../_shared/memberAuthServer.ts';
import type { Contact } from '../_shared/memberContact.ts';
import type { MemberKeys } from '../_shared/memberCrypto.ts';

const REPLY_FLOOR_MS = 600;

const WAIT_MESSAGES: Record<string, { error: string; retry_after: number }> = {
  'req-contact-1m': { error: 'Please wait a minute before asking for another code.', retry_after: 60 },
  'req-contact-1h': { error: "You've asked for a few codes. Please wait an hour before asking again.", retry_after: 3600 },
  'req-contact-1d': { error: "You've asked for several codes today. Please try again tomorrow, or contact the church office.", retry_after: 86400 },
  'req-contact-7d': { error: 'Too many codes this week. Please contact the church office.', retry_after: 86400 },
  'req-ip-10m':     { error: 'Too many sign-in requests from this network. Please try again in a few minutes.', retry_after: 600 },
  'req-ip-1d':      { error: 'Too many sign-in requests from this network today. Please try again later.', retry_after: 3600 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  const started = Date.now();
  const admin = adminClient();
  const keys = await memberKeys();

  if (req.method === 'GET') {
    const cfg = await loadConfig(admin);
    return json({ channels: channels(cfg, keys) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'phone' ? 'phone' : body?.mode === 'email' ? 'email' : null;
  const contact = parseContact(body?.identifier, mode);
  if (!contact) {
    return floor(started, REPLY_FLOOR_MS, json({
      error_code: 'invalid_contact',
      error: mode === 'phone' ? 'Enter a 10-digit US mobile number.' : 'Enter a valid email address.',
    }, 400));
  }

  const cfg = await loadConfig(admin);
  if (!cfg || !keys || !cfg.signin_enabled) {
    return floor(started, REPLY_FLOOR_MS, json({ error_code: 'unavailable', error: MSG.notReady }, 503));
  }
  const channel = contact.kind === 'phone' ? 'sms' : 'email';
  if (!channels(cfg, keys)[channel]) {
    return floor(started, REPLY_FLOOR_MS, json({
      error_code: 'channel_unavailable',
      error: channel === 'sms'
        ? "Signing in by text message isn't available right now. Please use your email address."
        : "Signing in by email isn't available right now. Please use your mobile number.",
    }, 503));
  }
  if (breakerOpen(cfg)) return floor(started, REPLY_FLOOR_MS, json({ error_code: 'busy', error: MSG.busy }, 503));

  const contactId = await macHex(keys.contact, contact.key);
  const ipId = await macHex(keys.ip, clientIp(req));

  // Uniform limits, checked before anything is looked up.
  let refused: string | null;
  try {
    refused = await rateHit(admin, [
      { bucket: 'req-contact-1m', key: contactId, limit: 1,   window_seconds: 60 },
      { bucket: 'req-contact-1h', key: contactId, limit: 3,   window_seconds: 3600 },
      { bucket: 'req-contact-1d', key: contactId, limit: 5,   window_seconds: 86400 },
      { bucket: 'req-contact-7d', key: contactId, limit: 10,  window_seconds: 604800 },
      { bucket: 'req-ip-10m',     key: ipId,      limit: 30,  window_seconds: 600 },
      { bucket: 'req-ip-1d',      key: ipId,      limit: 200, window_seconds: 86400 },
      { bucket: 'req-all-1h',     key: 'all',     limit: 600, window_seconds: 3600 },
    ]);
  } catch {
    return floor(started, REPLY_FLOOR_MS, json({ error_code: 'busy', error: MSG.busy }, 503));
  }
  if (refused) {
    await logEvent(admin, { event: 'request_rate_limited', channel, contactId, ipId, outcome: refused });
    const wait = WAIT_MESSAGES[refused];
    return floor(started, REPLY_FLOOR_MS, wait
      ? json({ error_code: 'too_many_requests', ...wait }, 429)
      : json({ error_code: 'busy', error: MSG.busy }, 503));
  }

  background(sendIfMember(admin, keys, cfg, contact, contactId, ipId));
  return floor(started, REPLY_FLOOR_MS, json({
    ok: true, channel,
    expires_in: channel === 'sms' ? SMS_TTL_SECONDS : EMAIL_TTL_SECONDS,
    resend_after: RESEND_AFTER_SECONDS,
  }));
});

async function sendIfMember(admin: Admin, keys: MemberKeys, cfg: AuthConfig, contact: Contact, contactId: string, ipId: string) {
  const channel = contact.kind === 'phone' ? 'sms' : 'email';
  try {
    if (Math.random() < 0.05) await admin.rpc('app_auth_purge');

    const { data: candidates, error: cErr } = await admin.rpc('app_login_candidates', {
      p_email: contact.kind === 'email' ? contact.norm : null,
      p_phone: contact.kind === 'phone' ? contact.norm : null,
      p_since: null,
    });
    if (cErr) throw new Error('candidates');
    if (!candidates?.length) {
      await logEvent(admin, { event: 'request_no_match', channel, contactId, ipId });
      return;
    }

    const capped = await rateHit(admin, channel === 'sms'
      ? [{ bucket: 'send-sms-1h', key: 'all', limit: cfg.sms_per_hour, window_seconds: 3600 },
         { bucket: 'send-sms-1d', key: 'all', limit: cfg.sms_per_day, window_seconds: 86400 }]
      : [{ bucket: 'send-email-1h', key: 'all', limit: cfg.email_per_hour, window_seconds: 3600 },
         { bucket: 'send-email-1d', key: 'all', limit: cfg.email_per_day, window_seconds: 86400 }]);
    if (capped) {
      await logEvent(admin, { event: 'send_capped', channel, contactId, ipId, outcome: capped });
      return;
    }

    const code = sixDigitCode();
    const codeMac = await macHex(keys.code, `${contactId}:${code}`);
    const ttl = channel === 'sms' ? SMS_TTL_SECONDS : EMAIL_TTL_SECONDS;
    const { data: issuedAt, error: iErr } = await admin.rpc('app_code_issue', {
      p_contact_id: contactId, p_channel: channel, p_code_mac: codeMac, p_ttl_seconds: ttl,
    });
    if (iErr) throw new Error('issue');

    const result = channel === 'sms'
      ? await sendSms(contact.sendTo, code)
      : await sendEmail(contact.sendTo, code, `${contactId.slice(0, 32)}-${new Date(String(issuedAt)).getTime()}`);
    await logEvent(admin, {
      event: result.ok ? 'send_ok' : 'send_failed', channel, contactId, ipId, providerCode: result.providerCode,
    });
  } catch (e) {
    await logEvent(admin, { event: 'request_error', channel, contactId, ipId, outcome: (e as Error)?.message ?? 'error' });
  }
}
