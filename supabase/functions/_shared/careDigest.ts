/*
 * What the Cares texts say — the staff digest at 8:00 AM and 4:00 PM, and the
 * "starts in 30 minutes" reminders.
 *
 * Pure functions, no network, so the wording can be checked against real
 * records without sending anything (cares-recap's dry run) and in tests.
 *
 * EVERY LINE CARRIES EVERYTHING A VISITOR WOULD ACT ON: who, what, when, where,
 * and the note in the words it was written. The morning digest used to read
 * "Mary Smith - Appointment - Details not given" above a note that said exactly
 * where and when — the line was built from the event's label and the note was
 * thrown away. "- Mary Smith - Hospitalized" told nobody which hospital, and an
 * update never said who had made it.
 *
 * Nothing is ever cut. A digest too long for one text is split into numbered
 * parts (smsParts.ts) rather than trimmed; a note that stops mid-sentence is
 * worse than a second message.
 */

import { smsCost, toGsm } from './smsEncoding.ts';
import { packLines, PART_SEGMENTS } from './smsParts.ts';

/* Local minutes past midnight. The first slot carries the morning briefing. */
export const SLOTS = [8 * 60, 16 * 60];          // 8:00 AM and 4:00 PM
export const MORNING = SLOTS[0];

const pad2 = (n: number) => String(n).padStart(2, '0');

export const slotLabel = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${mm ? ':' + pad2(mm) : ':00'} ${h < 12 ? 'AM' : 'PM'}`;
};

export const nextSlot = (slot: number) => SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length];

/* ── Pieces ── */

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* A sentence, ending in exactly one stop. */
const sentence = (s: unknown) => {
  const t = clean(s);
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* "Sep 15" from a date column. Read as written — a timezone must never move the day. */
export function shortDate(d: unknown) {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

/* Whole days from one date column to a local day, for "day 4 in hospital". */
function daysSince(d: unknown, today?: Date) {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !today) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const to = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const n = Math.round((to - from) / 864e5);
  return n >= 0 ? n + 1 : null;
}

/* "Piedmont Columbus, Rm 412" — the hospital and the room (or floor). */
export function wherePlace(m: any) {
  return [clean(m?.hospital_name), m?.room_number ? `Rm ${clean(m.room_number)}` : (m?.floor ? `Floor ${clean(m.floor)}` : '')]
    .filter(Boolean).join(', ');
}

/* "texted in by Pastor Tim" / "by Pastor Tim" — who put this on the record. */
export function byWhom(name: unknown) {
  const n = clean(name);
  if (!n) return '';
  const texted = n.match(/^(.*?)\s*\(text\)$/i);
  return texted ? `texted in by ${texted[1]}` : `by ${n}`;
}

/* The newest thing written about someone: their latest log, else the profile note. */
function latestNote(m: any) {
  const logs = [...(m?.contact_logs || [])]
    .filter((l: any) => clean(l?.notes))
    .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return clean(logs[0]?.notes || m?.care_notes);
}

/* ── Lines ── */

/* "- Mary Smith - Hospitalized (High priority). Piedmont Columbus, Rm 412, admitted
   Sep 12. Surgery: Hip replacement on Sep 15 with Dr. Lee. Note: Fell at home." */
export function renderAdded(m: any) {
  const head = `- ${clean(m.full_name)}${m.category ? ` - ${clean(m.category)}` : ''}`
    + (m.priority === 'High' ? ' (High priority)' : '');
  const where = [wherePlace(m), m.admission_date ? `admitted ${shortDate(m.admission_date)}` : '']
    .filter(Boolean).join(', ');
  const surgery = m.surgery_type || m.surgery_date
    ? `Surgery: ${[clean(m.surgery_type) || 'scheduled',
                   m.surgery_date ? `on ${shortDate(m.surgery_date)}` : '',
                   m.surgeon_name ? `with ${clean(m.surgeon_name)}` : ''].filter(Boolean).join(' ')}`
    : '';
  const note = clean(m.care_notes) ? `Note: ${clean(m.care_notes)}` : '';
  const rest = [where, surgery, note].map(sentence).filter(Boolean).join(' ');
  return rest ? `${sentence(head)} ${rest}` : head;
}

/* "- Mary Smith (Piedmont Columbus, Rm 412; Phone Call; by Pastor Tim): Going home Friday." */
export function renderUpdate(u: any) {
  const ctx = [
    clean(u.where),
    u.type && u.type !== 'Update/Visit' ? clean(u.type) : '',
    byWhom(u.by),
  ].filter(Boolean);
  return `- ${clean(u.name)}${ctx.length ? ` (${ctx.join('; ')})` : ''}: ${clean(u.notes)}`;
}

/*
 * An edit, with what it consisted of.
 *
 * `details` comes from change_log when the edit was made in the app; when there
 * is no recorded diff (an older edit, or one made directly in the database) the
 * record's current standing is reported instead, which is still an answer to
 * "what about her?".
 */
export function renderEdit(e: any) {
  if (clean(e.details)) return `- ${clean(e.name)}: ${clean(e.details)}`;
  const now = [
    clean(e.category),
    wherePlace(e) ? `at ${wherePlace(e)}` : '',
  ].filter(Boolean).join(', ');
  const note = clean(e.care_notes);
  return `- ${clean(e.name)}: ${now || 'record updated'}${note ? `. Note: ${note}` : ''}`;
}

/*
 * Someone whose situation has not changed is still someone in a hospital bed.
 * They generate no log and no edit, so every other section is blind to them and
 * they would quietly drop out of the digest the day after they are admitted —
 * which reads as "discharged" to anyone scanning it. The latest note says how
 * they were last known to be.
 */
export function renderOngoing(m: any, today?: Date) {
  const where = wherePlace(m);
  const day = daysSince(m.admission_date, today);
  const since = m.admission_date
    ? ` (admitted ${shortDate(m.admission_date)}${day ? `, day ${day}` : ''})`
    : '';
  const latest = latestNote(m);
  return `- ${clean(m.full_name)} - Still in hospital${where ? `, ${where}` : ''}${since}`
    + (latest ? `. Latest: ${latest}` : '');
}

/*
 * One of today's appointments or surgeries: the time, who, what kind, where, and
 * the sentence it was read from. "Details not given" only when the record truly
 * has nothing more to say — never beside a note that says it.
 */
export function renderEvent(e: any) {
  const m = e.member || {};
  const when = e.time?.label ? `${e.time.label} ` : '';
  const what = clean(e.label || e.kind) || 'Appointment';
  const where = clean(e.place) || (e.kind === 'Surgery' || m.category === 'Hospitalized' ? wherePlace(m) : '');
  const head = `- ${when}${clean(m.full_name)} - ${what}${where ? ` at ${where}` : ''}`;
  const detail = clean(e.detail || e.snippet);
  const saysMore = detail && detail.toLowerCase() !== what.toLowerCase()
    && detail.toLowerCase() !== `${what} at ${where}`.toLowerCase();
  if (saysMore) return `${head}. Note: ${sentence(detail)}`;
  return what === 'Appointment' && !where ? `${head} - Details not given` : head;
}

function sectionLines(title: string, items: any[], render: (x: any) => string) {
  if (!items.length) return [];
  return [`${title} (${items.length}):`, ...items.map(render)];
}

/*
 * The digest as one or more message bodies — one entry per text to send, in
 * order. Callers must send every part.
 */
export function buildDigest(
  { slot, added, updates, edited, events, ongoing = [], today }:
  { slot: number; added: any[]; updates: any[]; edited: any[]; events: any[]; ongoing?: any[]; today?: Date },
  { tail = '' }: { tail?: string } = {},
): string[] {
  const morning = slot === MORNING;
  /* Someone still in a hospital bed counts as something to report, so a slot
     carrying only them is not a quiet one. */
  const nothing = !added.length && !updates.length && !edited.length && !ongoing.length;
  /*
   * Everything that goes out is normalised to plain punctuation first — the
   * header, every staff note, the tail. Measured after, not before: "…" becomes
   * "..." and grows by two characters, so sizing the un-normalised text would
   * under-count exactly the parts this is here to keep under the limit.
   */
  const suffix = toGsm(tail ? `\n\n${tail}` : '');
  const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n').trim();

  /*
   * A quiet check is a single line, not a header with an empty body under it —
   * it reads at a glance on a lock screen. The morning one still carries the
   * day's schedule when there is one.
   */
  if (nothing && !morning) {
    return [toGsm(`CARES - No recent updates. Next check at ${slotLabel(nextSlot(slot))}`) + suffix];
  }

  /* A plain hyphen. The em dash that was here sat on the first line of every
     digest with news in it, so every one of them went out as UCS-2. */
  const header = toGsm(nothing ? 'CARES - No updates yesterday' : `Bethesda Cares - ${slotLabel(slot)}`);

  const content: string[] = [];
  if (!nothing) {
    content.push(...sectionLines('Added', added, renderAdded));
    if (added.length && (updates.length || edited.length)) content.push('');
    content.push(...sectionLines('Updates', updates, renderUpdate));
    if (edited.length) {
      if (added.length || updates.length) content.push('');
      content.push(...sectionLines('Edited', edited, renderEdit));
    }
    /* Last, under its own heading: it is standing context, not news, and should
       not push the things that did change further down the message. */
    if (ongoing.length) {
      if (content.length) content.push('');
      content.push(...sectionLines('Ongoing', ongoing, m => renderOngoing(m, today)));
    }
  }
  if (morning) {
    if (content.length) content.push('');
    content.push(...(events.length
      ? sectionLines('Today', events, renderEvent)
      : ['Today: no appointments or surgeries']));
  }

  const lines = content.map(toGsm);
  const whole = tidy([header, '', ...lines].join('\n'));
  if (smsCost(whole + suffix).segments <= PART_SEGMENTS) return [whole + suffix];

  /*
   * Every part repeats the header and carries an (n/m) tag, since texts can
   * arrive out of order. Each candidate is measured with a tag as wide as the
   * count could make it, and with the opt-out tail — even though only the last
   * part keeps the tail — so no part comes in over the limit once its real tag
   * is set.
   *
   * The count is not known until packing is done. If it turns out to need more
   * digits than were allowed for, pack again with the wider tag. Widening only
   * ever adds parts, so this settles, normally on the first pass.
   */
  let width = 2;
  let chunks: string[][] = [];
  for (;;) {
    const widest = `(${'9'.repeat(width)}/${'9'.repeat(width)})`;
    const fits = (part: string[]) =>
      smsCost([`${header} ${widest}`, '', ...part].join('\n') + suffix).segments <= PART_SEGMENTS;
    chunks = packLines(lines, fits);
    const need = String(chunks.length).length;
    if (need <= width) break;
    width = need;
  }
  const n = chunks.length;
  return chunks.map((c, i) => {
    const part = tidy([`${header} (${i + 1}/${n})`, '', ...c].join('\n'));
    return i === n - 1 ? part + suffix : part;
  });
}

/* ── "Starts in 30 minutes" reminders ── */

/* Where it is happening: the note's own place if it named one, otherwise the
   hospital and room from the record. */
export function reminderPlace(e: any) {
  return clean(e.place) || wherePlace(e.member || {});
}

/*
 * "Mary Smith has surgery (Hip replacement) in 30 minutes (7:30 AM).
 *  At Piedmont Columbus, Rm 412
 *  With Dr. Lee
 *  Note: Hip replacement Tuesday at 7:30 AM, family in the waiting room."
 *
 * The clock time is included because the lead is 15-45 minutes, not exactly
 * 30 — without it "in 30 minutes" could be off by a quarter of an hour. The note
 * goes out whole: it used to appear only when nothing else was known, so a
 * reminder named the place and dropped what the appointment was for.
 */
export function reminderText(e: any) {
  const m = e.member || {};
  const label = clean(e.label);
  const what = e.kind === 'Surgery'
    ? `surgery${label && label !== 'Surgery' ? ` (${label})` : ''}`
    : `an appointment${label && label !== 'Appointment' ? ` (${label})` : ''}`;
  const lines = [`${clean(m.full_name)} has ${what} in 30 minutes${e.time?.label ? ` (${e.time.label})` : ''}.`];
  const where = reminderPlace(e);
  if (where) lines.push(`At ${where}`);
  if (e.kind === 'Surgery' && clean(m.surgeon_name)) lines.push(`With ${clean(m.surgeon_name)}`);
  const detail = clean(e.detail || e.snippet);
  if (detail && detail.toLowerCase() !== label.toLowerCase()) lines.push(`Note: ${detail}`);
  return lines.join('\n');
}
