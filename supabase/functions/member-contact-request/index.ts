// Supabase Edge Function — "contact the church office" from the app, for people whose email or
// mobile number isn't on file yet, and for members asking the office to change their details.
//
// Deploy:  npx supabase functions deploy member-contact-request --no-verify-jwt
//
// { name, contact, message } → public.member_access_requests (staff-only). Rate limited per IP.
// Staff confirm the person out of band (a number already on file, or in person) before adding a
// contact to a record: a contact on a record IS a sign-in credential.

import { macHex } from '../_shared/memberCrypto.ts';
import { adminClient, clientIp, json, logEvent, memberKeys, MSG, preflight, rateHit } from '../_shared/memberAuthServer.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const b = await req.json().catch(() => ({}));
  const name    = String(b?.name ?? '').trim();
  const contact = String(b?.contact ?? '').trim();
  const message = String(b?.message ?? '').trim();
  if (name.length < 2 || name.length > 100)       return json({ error: 'Please enter your name.' }, 400);
  if (contact.length < 5 || contact.length > 200) return json({ error: 'Please enter an email or phone number we can reach you at.' }, 400);
  if (message.length > 1000)                      return json({ error: 'Please keep your message under 1,000 characters.' }, 400);

  const admin = adminClient();
  const keys = await memberKeys();
  if (!keys) return json({ error: MSG.notReady }, 503);
  try {
    const ipId = await macHex(keys.ip, clientIp(req));
    const refused = await rateHit(admin, [
      { bucket: 'contact-ip-1h', key: ipId,  limit: 5,   window_seconds: 3600 },
      { bucket: 'contact-all-1d', key: 'all', limit: 200, window_seconds: 86400 },
    ]);
    if (refused) return json({ error: 'Too many requests. Please try again later.' }, 429);

    const { error } = await admin.from('member_access_requests').insert({ name, contact, message: message || null });
    if (error) throw new Error('insert');
    await logEvent(admin, { event: 'office_request', ipId });
    return json({ ok: true });
  } catch {
    return json({ error: 'Your message could not be sent. Please try again.' }, 500);
  }
});
