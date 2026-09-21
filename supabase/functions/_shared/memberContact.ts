/*
 * Member sign-in contacts — the TypeScript twin of public.app_norm_email / public.app_norm_phone
 * in supabase/member-app-auth.sql. The two MUST stay identical: the database decides which records
 * a contact matches, the Edge Functions decide where codes go and key rate limits on the result.
 * supabase/tests/member-auth.test.mjs checks them against each other.
 *
 * Deliberately strict: anything unusual (extensions, two numbers in one field, placeholder
 * numbers, non-geographic or Caribbean +1 area codes) is not a sign-in contact at all.
 */

const TRIM_RE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

// toll-free, premium, non-geographic, and NANP countries outside the US/Canada (billed as international)
const BLOCKED_AREA_CODES = new Set([
  '800', '833', '844', '855', '866', '877', '888', '900', '500', '533', '544', '566', '577', '588', '600', '700', '710',
  '242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721', '758', '767', '784',
  '809', '829', '849', '868', '869', '876',
]);

export function normEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(TRIM_RE, '');
  return v.length <= 254 && EMAIL_RE.test(v) ? v.toLowerCase() : null;
}

export function normPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(TRIM_RE, '');
  if (!/^[0-9+(). -]*$/.test(v)) return null;
  let d = v.replace(/[^0-9]/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(d)) return null;
  if (d.slice(1, 3) === '11' || d.slice(4, 6) === '11' || d.slice(3, 6) === '555' || /^(.)\1+$/.test(d)) return null;
  if (BLOCKED_AREA_CODES.has(d.slice(0, 3))) return null;
  return d;
}

export type Contact =
  | { kind: 'email'; norm: string; key: string; sendTo: string }
  | { kind: 'phone'; norm: string; key: string; sendTo: string };

/** What the member typed + which tab they were on → a contact, or null if it isn't one. */
export function parseContact(raw: unknown, mode: unknown): Contact | null {
  if (mode === 'phone') {
    const d = normPhone(raw);
    return d ? { kind: 'phone', norm: d, key: `phone:+1${d}`, sendTo: `+1${d}` } : null;
  }
  if (mode === 'email') {
    const e = normEmail(raw);
    return e ? { kind: 'email', norm: e, key: `email:${e}`, sendTo: e } : null;
  }
  return null;
}
