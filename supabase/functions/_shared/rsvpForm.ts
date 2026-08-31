/*
 * Turning what someone typed into the public RSVP form into a row the dinner
 * list can count. Pure, and kept out of the function so it can be exercised
 * directly against the same tally the Responses tab uses.
 */

/* Marks a row as having come from the web form rather than a text. */
export const WEB_STATUS = 'WebRSVP';

export const MAX_PLATES = 40;
export const MAX_NAME = 60;
/* A ceiling on how many reservations one dinner can collect from the open web,
   so a stranger with a script cannot bury the real list. */
export const MAX_PER_DINNER = 600;

/*
 * A web reservation has no phone number, but the dinner list keys on one — the
 * tally groups replies by the number they came from. So each name gets a
 * stable, deliberately impossible number: ten digits with a leading zero, which
 * no real US number has. The same person submitting twice then corrects their
 * reservation instead of doubling it.
 */
export function webNumber(name: string): string {
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return '0' + String(h % 1_000_000_000).padStart(9, '0');
}

/* Names are shown to staff, so strip anything that is not one. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export function cleanPlates(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PLATES) return null;
  return n;
}
