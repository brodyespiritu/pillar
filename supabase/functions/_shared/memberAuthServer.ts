/*
 * Shared plumbing for the member sign-in Edge Functions: environment, the service-role client,
 * uniform JSON replies, response-time floors, client IP, audit events and sending.
 * Nothing here ever logs a contact, code, ticket, grant or token.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { loadMemberKeys, type MemberKeys } from './memberCrypto.ts';

export const SMS_TTL_SECONDS = 300;      // texts: 5 minutes
export const EMAIL_TTL_SECONDS = 600;    // emails: 10 minutes
export const RESEND_AFTER_SECONDS = 60;
export const GRANT_TTL_SECONDS = 300;
export const TICKET_TTL_SECONDS = 300;

export const env = {
  url:         Deno.env.get('SUPABASE_URL') ?? '',
  serviceRole: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  anon:        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  authKey:     Deno.env.get('MEMBER_AUTH_KEY'),
  loginDomain: (Deno.env.get('MEMBER_LOGIN_DOMAIN') || 'members.invalid').toLowerCase(),
  telnyxKey:   Deno.env.get('TELNYX_API_KEY'),
  telnyxFrom:  Deno.env.get('TELNYX_CODE_FROM_NUMBER') || Deno.env.get('TELNYX_FROM_NUMBER'),
  resendKey:   Deno.env.get('RESEND_API_KEY'),
  codeFrom:    Deno.env.get('MEMBER_CODE_FROM'),
};

export const MSG = {
  notReady: "Member sign-in isn't switched on yet. Please try again later.",
  busy:     'Sign-in is busy right now. Please try again in a few minutes.',
};

let keysPromise: Promise<MemberKeys | null> | null = null;
export const memberKeys = () => (keysPromise ??= loadMemberKeys(env.authKey));

export const adminClient = () =>
  createClient(env.url, env.serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
export type Admin = ReturnType<typeof adminClient>;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
export const preflight = () => new Response('ok', { headers: cors });
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Wait until at least `ms` have passed since `started`, then return `res`. */
export async function floor(started: number, ms: number, res: Response): Promise<Response> {
  const wait = ms - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return res;
}

/** Best-effort client IP (per-IP limits are anti-scripting only; security rests on per-contact limits). */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : 'unknown';
}

export type AuthConfig = {
  signin_enabled: boolean; sms_enabled: boolean; email_enabled: boolean;
  sms_per_hour: number; sms_per_day: number; email_per_hour: number; email_per_day: number;
  breaker_fails_hour: number; breaker_fails_day: number; breaker_open_until: string | null;
};

export async function loadConfig(admin: Admin): Promise<AuthConfig | null> {
  const { data, error } = await admin.rpc('app_auth_config');
  return error || !data ? null : (data as AuthConfig);
}

export function channels(cfg: AuthConfig | null, keys: MemberKeys | null) {
  const on = !!(cfg && keys && cfg.signin_enabled);
  return {
    sms:   on && !!cfg!.sms_enabled && !!env.telnyxKey && !!env.telnyxFrom,
    email: on && !!cfg!.email_enabled && !!env.resendKey && !!env.codeFrom,
  };
}

export const breakerOpen = (cfg: AuthConfig) =>
  !!cfg.breaker_open_until && new Date(cfg.breaker_open_until).getTime() > Date.now();

export type Hit = { bucket: string; key: string; limit: number; window_seconds: number };
/** null = allowed (recorded); a bucket name = refused (nothing recorded); throws on database error. */
export async function rateHit(admin: Admin, hits: Hit[]): Promise<string | null> {
  const { data, error } = await admin.rpc('app_rate_hit_many', { p_hits: hits });
  if (error) throw new Error('rate limit check failed');
  return (data as string | null) ?? null;
}

export async function logEvent(admin: Admin, e: {
  event: string; channel?: string | null; contactId?: string | null; ipId?: string | null;
  memberId?: string | null; outcome?: string | null; providerCode?: string | null;
}) {
  try {
    await admin.rpc('app_auth_log', {
      p_event: e.event, p_channel: e.channel ?? null, p_contact_ref: e.contactId ? e.contactId.slice(0, 16) : null,
      p_ip_ref: e.ipId ? e.ipId.slice(0, 16) : null, p_member_id: e.memberId ?? null,
      p_outcome: e.outcome ?? null, p_provider_code: e.providerCode ?? null,
    });
  } catch { /* the audit trail must never break sign-in */ }
}

/** Keeps background work alive after the reply (Supabase Edge Runtime). */
export function background(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else p.catch(() => {});
}

// ── Sending ───────────────────────────────────────────────────────────────────
export type SendResult = { ok: boolean; providerCode: string | null };

export async function sendSms(to: string, code: string): Promise<SendResult> {
  const text = `${code} is your Bethesda Baptist Church app sign-in code. It expires in 5 minutes. Never share it.`;
  const attempt = () => fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.telnyxKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.telnyxFrom, to, text }),
    signal: AbortSignal.timeout(8000),
  });
  let res: Response;
  try {
    res = await attempt();
  } catch (e) {
    if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') return { ok: false, providerCode: 'timeout' };
    try { res = await attempt(); } catch { return { ok: false, providerCode: 'network' }; }   // one retry, only when nothing reached Telnyx
  }
  if (res.ok) return { ok: true, providerCode: null };
  const body = await res.json().catch(() => ({}));
  const err = body?.errors?.[0] ?? {};
  const stop = String(err.code) === '40300' && /stop/i.test(String(err.title ?? ''));
  return { ok: false, providerCode: stop ? 'blocked_stop' : `telnyx_${err.code ?? res.status}` };
}

export async function sendEmail(to: string, code: string, idempotencyKey: string): Promise<SendResult> {
  const text = [
    'Your sign-in code for the Bethesda Baptist Church app is:', '', code, '',
    'Enter it in the app within 10 minutes. It can only be used once.', '',
    'Never share this code. Church staff will never ask you for it.', '',
    "Didn't ask for a code? You can ignore this email. No one can sign in without the code.", '',
    'Bethesda Baptist Church',
  ].join('\n');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<meta name="color-scheme" content="light dark"><title>Your Bethesda sign-in code</title></head>'
    + '<body style="margin:0;padding:24px;font-family:-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">'
    + '<p style="margin:0 0 12px">Your sign-in code for the Bethesda Baptist Church app is:</p>'
    + `<p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace">${code.replace(/\D/g, '')}</p>`
    + '<p style="margin:0 0 12px">Enter it in the app within 10 minutes. It can only be used once.</p>'
    + '<p style="margin:0 0 12px">Never share this code. Church staff will never ask you for it.</p>'
    + '<p style="margin:0 0 12px;opacity:.75">Didn\'t ask for a code? You can ignore this email. No one can sign in without the code.</p>'
    + '<p style="margin:0;opacity:.75">Bethesda Baptist Church</p></body></html>';
  const attempt = () => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      from: env.codeFrom, to: [to], subject: 'Your Bethesda sign-in code', text, html,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    }),
    signal: AbortSignal.timeout(8000),
  });
  for (let i = 0; i < 2; i++) {
    let res: Response;
    try { res = await attempt(); } catch { return { ok: false, providerCode: 'network' }; }
    if (res.ok) return { ok: true, providerCode: null };
    const body = await res.json().catch(() => ({}));
    const name = String(body?.name ?? res.status);
    const retryable = (res.status === 429 && name === 'rate_limit_exceeded') || res.status >= 500;
    if (!retryable || i === 1) return { ok: false, providerCode: `resend_${name}` };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, providerCode: 'resend_unknown' };
}
