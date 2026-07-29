/*
 * US phone handling for Cares SMS.
 *
 * Stored as E.164 (+14255550187) because that's what Telnyx requires;
 * displayed as (425) 555-0187 because that's what staff read.
 */

/** "(425) 555-0187", "425.555.0187", "1-425-555-0187" → "+14255550187" (or ''). */
export function toE164(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return '';
  // North American numbering: area code and exchange can't start with 0 or 1.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return '';
  return `+1${d}`;
}

export const isValidUsPhone = input => toE164(input) !== '';

/** "+14255550187" → "(425) 555-0187". Anything unrecognised passes through. */
export function formatUsPhone(input) {
  const e = toE164(input);
  if (!e) return String(input || '');
  const d = e.slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Progressive formatting while typing, so the field reads naturally. */
export function formatAsTyped(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Same 10 digits regardless of formatting — for matching inbound replies. */
export const phoneKey = input => String(input || '').replace(/\D/g, '').slice(-10);
