/*
 * Telling a deacon when someone they shepherd needs care.
 *
 * The chain has four links and the middle one is the weak one:
 *
 *   care_members  →  church_members  →  deacon_id  →  the Deacons SMS group
 *
 * care_members has no foreign key to church_members — a care record is created
 * by typing a name, with an autocomplete that copies the phone across. So the
 * match is made on phone first (ten digits, which people cannot mistype into
 * someone else's) and only falls back to an exact name. A fuzzy name match here
 * would tell the wrong deacon about the wrong family, which is worse than
 * telling nobody, so anything that does not match cleanly is skipped.
 *
 * Cadence comes from the poll: 1 = as it happens, 2 = a summary each morning.
 */

export const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10);
const normName = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export type Cadence = 'immediate' | 'daily';

/*
 * Nobody is opted in by silence. A deacon who has not answered the poll gets
 * the morning summary rather than a text per event — the quieter of the two, so
 * an unanswered poll cannot turn into a phone buzzing all day.
 */
export const DEFAULT_CADENCE: Cadence = 'daily';

/* choice 1 → as it happens, 2 → the morning summary. Anything else is unknown
   wording and falls back rather than guessing. */
export function cadenceOf(choice: number | null | undefined): Cadence {
  if (choice === 1) return 'immediate';
  if (choice === 2) return 'daily';
  return DEFAULT_CADENCE;
}

/*
 * Which deacon shepherds this care record, and how they want to hear about it.
 *
 * `directory` is church_members, `deaconPhones` the ten-digit numbers actually
 * in the Deacons SMS group — a deacon who is not on that group is not textable
 * and is skipped, which is the answer to "how do we reach a deacon".
 */
export function deaconFor(
  careMember: { full_name?: string; phone?: string },
  directory: any[],
  deaconPhones: Set<string>,
) {
  const phone = last10(careMember.phone);
  const name = normName(careMember.full_name);

  const person =
    (phone && directory.find(m => last10(m.phone) === phone)) ||
    (name && directory.filter(m => normName(m.name) === name).length === 1
      ? directory.find(m => normName(m.name) === name)
      : null);
  if (!person?.deacon_id) return null;

  const deacon = directory.find(m => m.id === person.deacon_id);
  if (!deacon) return null;

  const dp = last10(deacon.phone);
  /* On the record but not on the group: no way to reach them, so nothing is
     sent and nothing is claimed — adding them to the group later picks it up. */
  if (!dp || !deaconPhones.has(dp)) return null;

  return { deacon, phone: dp, person };
}

/* ── Wording ── */

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function addedText(m: any) {
  const where = [m.hospital_name, m.room_number ? `Rm ${m.room_number}` : '']
    .filter(Boolean).join(', ');
  return `${m.full_name} has been added to the care list${m.category ? ` (${m.category})` : ''}.`
    + (where ? `\n${clean(where)}` : '')
    + (m.care_notes ? `\n${clean(m.care_notes)}` : '');
}

export function updateText(name: string, note: string) {
  return `Update on ${name}: ${clean(note)}`;
}

/* The morning summary: everything about this deacon's families since yesterday,
   in one message rather than one per event. */
export function dailyText(items: { name: string; line: string }[]) {
  const head = items.length === 1
    ? 'One update on your families:'
    : `${items.length} updates on your families:`;
  return [head, ...items.map(i => `- ${i.line}`)].join('\n');
}
