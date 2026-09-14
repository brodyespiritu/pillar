/*
 * Telling a deacon when someone they shepherd needs care.
 *
 * The chain has four links and the middle one is the weak one:
 *
 *   care_members  →  church_members  →  deacon_id  →  the Deacons SMS group
 *
 * care_members has no foreign key to church_members — a care record is created
 * by typing a name, with an autocomplete that copies the phone across. So the
 * match is made on phone and on exact name, and when the two point at different
 * deacons nothing is sent. A fuzzy or first-found match here would tell the
 * wrong deacon about the wrong family, which is worse than telling nobody.
 *
 * Cadence comes from the deacon poll: as it happens, or a summary each morning.
 */

import { last10 } from './phone.ts';
import { pollOptions } from './poll.ts';
import { splitMessage } from './smsParts.ts';
import { isDeaconTag } from './recipients.ts';
import { shortDate, wherePlace, byWhom } from './careDigest.ts';

export { last10 };
const normName = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export type Cadence = 'immediate' | 'daily';

/*
 * Nobody is opted in by silence. A deacon who has not answered the poll gets
 * the morning summary rather than a text per event — the quieter of the two, so
 * an unanswered poll cannot turn into a phone buzzing all day.
 */
export const DEFAULT_CADENCE: Cadence = 'daily';

/* choice 1 → as it happens, 2 → the morning summary, for callers that only
   have the number. Prefer cadenceFromAnswer, which reads the option's words. */
export function cadenceOf(choice: number | null | undefined): Cadence {
  if (choice === 1) return 'immediate';
  if (choice === 2) return 'daily';
  return DEFAULT_CADENCE;
}

const IMMEDIATE_RE = /immediate|as it happens|right away|real[- ]?time|each time|every time/i;
const DAILY_RE = /summary|daily|once (?:a|per) day|each (?:morning|day)|every (?:morning|day)/i;

/*
 * Is this poll the one that asks deacons how they want to hear?
 *
 * Cadence used to be read from a deacon's latest answer to ANY poll. The first
 * unrelated poll sent to the congregation — "Reply 1 for Saturday, 2 for
 * Sunday" — would have switched every deacon who answered "1" to a text per
 * event. Only a poll offering both an as-it-happens and a summary option counts.
 */
export function isCadencePoll(body: unknown) {
  const opts = pollOptions(String(body ?? ''));
  return opts.some(o => IMMEDIATE_RE.test(o.label)) && opts.some(o => DAILY_RE.test(o.label));
}

/* The cadence an answer chose, by the words of the option picked — so a poll
   that lists the summary first cannot invert everyone's choice. */
export function cadenceFromAnswer(pollBody: unknown, choice: number | null | undefined): Cadence | null {
  if (!isCadencePoll(pollBody)) return null;
  const opt = pollOptions(String(pollBody ?? '')).find(o => o.n === choice);
  if (!opt) return null;
  if (IMMEDIATE_RE.test(opt.label) && !DAILY_RE.test(opt.label)) return 'immediate';
  if (DAILY_RE.test(opt.label)) return 'daily';
  return null;
}

/* Each number's latest cadence answer. `answers` is sms_poll_answers rows. */
export function cadenceByPhone(answers: any[]): Map<string, Cadence> {
  const latest = new Map<string, { at: string; how: Cadence }>();
  for (const a of answers || []) {
    const how = cadenceFromAnswer(a.poll_body, a.choice);
    if (!how) continue;
    const p = last10(a.to_number);
    const at = String(a.answered_at || a.created_at || '');
    const prev = latest.get(p);
    if (!prev || at >= prev.at) latest.set(p, { at, how });
  }
  return new Map([...latest].map(([p, v]) => [p, v.how]));
}

/* The whole directory — PostgREST stops at 1000 rows and the church has more.
   A cut-off directory drops deacons and families without a word. */
export async function loadDirectory(supabase: any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('church_members')
      .select('id, name, phone, deacon_id, tags').order('id').range(from, from + 999);
    if (error) throw new Error(`member directory unavailable: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export type DeaconMatch =
  | { ok: true; deacon: any; phone: string; person: any }
  | { ok: false; why: 'unmatched' | 'ambiguous' | 'no deacon' | 'not a deacon' | 'unreachable' };

/*
 * Which deacon shepherds this care record — or why nobody is told.
 *
 * `directory` is church_members (with tags), `deaconPhones` the ten-digit
 * numbers actually on the Deacons texting group.
 *
 * Phone and exact name are both consulted. A phone shared by a household with
 * one deacon is fine; a phone shared by people with DIFFERENT deacons, or a
 * phone and a name that lead to different deacons, is ambiguous and skipped —
 * the first match used to win, which meant whichever row the database returned
 * first decided which deacon heard about somebody else's family.
 */
export function matchDeacon(
  careMember: { full_name?: string; phone?: string },
  directory: any[],
  deaconPhones: Set<string>,
): DeaconMatch {
  const phone = last10(careMember.phone);
  const name = normName(careMember.full_name);

  const byPhone = phone.length === 10 ? directory.filter(m => last10(m.phone) === phone) : [];
  const byName = name ? directory.filter(m => normName(m.name) === name) : [];

  const deaconsOf = (rows: any[]) => new Set(rows.map(m => m.deacon_id || ''));
  let person: any = null;

  if (byPhone.length) {
    const phoneDeacons = deaconsOf(byPhone);
    if (phoneDeacons.size === 1) person = byPhone.find(m => normName(m.name) === name) || byPhone[0];
    else {
      const named = byPhone.filter(m => normName(m.name) === name);
      if (named.length !== 1) return { ok: false, why: 'ambiguous' };
      person = named[0];
    }
    /* The phone says one family, the name says another. */
    if (byName.length === 1 && (byName[0].deacon_id || '') !== (person.deacon_id || '')) {
      return { ok: false, why: 'ambiguous' };
    }
  } else if (byName.length === 1) {
    person = byName[0];
  } else if (byName.length > 1) {
    return { ok: false, why: 'ambiguous' };
  }

  if (!person) return { ok: false, why: 'unmatched' };
  if (!person.deacon_id) return { ok: false, why: 'no deacon' };

  const deacon = directory.find(m => m.id === person.deacon_id);
  /* Assigned to someone the directory does not list as a deacon: never text
     them care details on the strength of an assignment alone. */
  if (!deacon || !isDeaconTag(deacon.tags)) return { ok: false, why: 'not a deacon' };

  const dp = last10(deacon.phone);
  /* On the record but not on the group: no way to reach them, so nothing is
     sent and nothing is claimed — adding them to the group later picks it up. */
  if (dp.length !== 10 || !deaconPhones.has(dp)) return { ok: false, why: 'unreachable' };

  return { ok: true, deacon, phone: dp, person };
}

/* The old shape, for callers that only need a hit or nothing. */
export function deaconFor(careMember: any, directory: any[], deaconPhones: Set<string>) {
  const m = matchDeacon(careMember, directory, deaconPhones);
  return m.ok ? { deacon: m.deacon, phone: m.phone, person: m.person } : null;
}

/* ── Wording ── */

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export type Alert = { header: string; lines: string[] };

/* Everything the record holds that a deacon would act on — the same detail the
   staff digest carries (careDigest.ts): category and priority, the hospital and
   room with the admission date, any surgery, and the note as written. */
export function addedAlert(m: any): Alert {
  const kind = [clean(m.category), m.priority === 'High' ? 'High priority' : ''].filter(Boolean).join(', ');
  const where = [wherePlace(m), m.admission_date ? `admitted ${shortDate(m.admission_date)}` : '']
    .filter(Boolean).join(', ');
  const surgery = m.surgery_type || m.surgery_date
    ? `Surgery: ${[clean(m.surgery_type) || 'scheduled',
                   m.surgery_date ? `on ${shortDate(m.surgery_date)}` : '',
                   m.surgeon_name ? `with ${clean(m.surgeon_name)}` : ''].filter(Boolean).join(' ')}`
    : '';
  return {
    header: `${clean(m.full_name)} has been added to the care list${kind ? ` (${kind})` : ''}.`,
    lines: [where, surgery, clean(m.care_notes)].filter(Boolean),
  };
}

/* "Update on Mary Smith (Phone Call; by Pastor Tim):" — how, and who said so. */
export function updateAlert(name: string, note: string, ctx: { type?: string; by?: string } = {}): Alert {
  const extra = [ctx.type && ctx.type !== 'Update/Visit' ? clean(ctx.type) : '', byWhom(ctx.by)].filter(Boolean).join('; ');
  return { header: `Update on ${clean(name)}${extra ? ` (${extra})` : ''}:`, lines: [clean(note)] };
}

export const alertText = (a: Alert) => [a.header, ...a.lines].join('\n');

/* One alert as the texts that carry it — split, never refused for length. */
export const alertParts = (a: Alert) => splitMessage(a.header, a.lines);

/* Kept for anything still calling the string forms. */
export const addedText = (m: any) => alertText(addedAlert(m));
export const updateText = (name: string, note: string) => alertText(updateAlert(name, note));

/* The morning summary: everything about this deacon's families since the last
   one, in as few texts as fit — one per event would be the noise it replaces. */
export function dailyParts(items: { line: string }[]) {
  const head = items.length === 1
    ? 'One update on your families:'
    : `${items.length} updates on your families:`;
  return splitMessage(head, items.map(i => `- ${i.line}`));
}

export function dailyText(items: { name?: string; line: string }[]) {
  return dailyParts(items).join('\n\n');
}
