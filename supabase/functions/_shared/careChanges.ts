/*
 * What changed on a care record, in words.
 *
 * The digest used to be able to say only "Also edited: Pansy Loudermilk",
 * because nothing anywhere recorded what an edit consisted of — the row was
 * overwritten and the old values were gone. A name with no change attached is
 * worse than silence: it tells a reader something happened and then makes them
 * open the record to find out what, which is the work the digest exists to save.
 *
 * The app writes these into change_log when a record is saved; the care summary
 * texts and the Change Log screen read them back. All three use this file.
 *
 * An emptied field is said to be removed. It is never shown as an empty value:
 * "Note: (blank)" went out to staff in a summary text, where it read as a broken
 * message rather than as a note someone had taken off.
 *
 * Only fields a person would talk about are compared. Nobody needs to be told
 * that updated_at moved.
 */

export const WATCHED: [string, string][] = [
  ['category',      'Care type'],
  ['status',        'Status'],
  ['priority',      'Priority'],
  ['care_notes',    'Note'],
  ['hospital_name', 'Hospital'],
  ['room_number',   'Room'],
  ['floor',         'Floor'],
  ['surgery_type',  'Surgery'],
  ['surgery_date',  'Surgery date'],
  ['admission_date','Admitted'],
  ['assigned_name', 'Assigned to'],
  ['phone',         'Phone'],
  ['address',       'Address'],
];

export function describeChanges(before: any = {}, after: any = {}): string[] {
  const out: string[] = [];
  for (const [key, label] of WATCHED) {
    if (!(key in (after || {}))) continue;         // not part of this save
    const was = String(before?.[key] ?? '').trim();
    const now = String(after?.[key] ?? '').trim();
    if (was === now) continue;
    /* A note is quoted rather than shown as "x -> y": the new wording is the
       information, and the old wording is just noise once it is replaced. */
    if (key === 'care_notes') out.push(now ? `Note: ${now}` : 'Note removed');
    else if (!now) out.push(`${label} removed (was ${was})`);
    else if (!was) out.push(`${label}: ${now}`);
    else out.push(`${label}: ${was} → ${now}`);
  }
  return out;
}

/*
 * Change notes saved before that wording, or by a copy of the app that was open
 * before it and has not been reloaded, still say "(blank)" for an empty value.
 * This says them the way describeChanges does now, so no text and no screen
 * ever shows the word.
 */
const BLANK = '(blank)';

export function readableChanges(details: unknown): string {
  const text = String(details ?? '');
  if (!text.includes(BLANK)) return text;
  return text.split('; ').map(part => {
    let m: RegExpMatchArray | null;
    if (/^Note: \(blank\)$/.test(part)) return 'Note removed';
    if (/^.+?: \(blank\) → \(blank\)$/.test(part)) return '';      // nothing actually changed
    if ((m = part.match(/^(.+?): \(blank\) → (.+)$/)) && !m[2].includes(BLANK)) return `${m[1]}: ${m[2]}`;
    if ((m = part.match(/^(.+?): (.+) → \(blank\)$/)) && !m[2].includes(BLANK)) return `${m[1]} removed (was ${m[2]})`;
    if ((m = part.match(/^(.+?): \(blank\)$/))) return `${m[1]} removed`;
    // Anywhere else, such as inside a note's own wording: drop the word itself.
    return part.split(BLANK).join('').replace(/\s{2,}/g, ' ').trim();
  }).filter(Boolean).join('; ');
}
