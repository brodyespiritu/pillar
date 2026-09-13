/*
 * Phone numbers, compared the one way that works.
 *
 * The contact list stores numbers however they were typed — "(706) 555-0100",
 * "706-555-0100", "706.555.0100" — the message log keeps whatever the sender was
 * handed, and Telnyx reports E.164. So two records are the same phone when their
 * last ten digits agree, and never by comparing the strings.
 *
 * The database carries the same rule as stored columns (sms_messages.to10,
 * sms_contacts.phone10, staff.phone10 — see supabase/sms-recipient-guards.sql),
 * because `ilike '%7065550100'` silently misses every formatted number. That is
 * how STOP failed to flag contacts and dinner replies lost track of the
 * invitation they answered.
 */

export const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10);

/* Telnyx requires E.164 (+17065550100). Normalises however the number was stored. */
export function toE164(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d ? '+' + d : '';
}

/* A US number Telnyx can send to. Anything shorter is not a phone. */
export const isSendable = (raw: unknown) => /^\+1\d{10}$/.test(toE164(raw));
