// Supabase Edge Function — the Cares alert digests.
//
// Three sends a day to STAFF ONLY — the people an admin gave a mobile number
// and switched "Cares alerts" on for in Admin -> Users:
//
//   8:00 AM   everything since 5:00 PM yesterday + today's appointments/surgeries
//   1:00 PM   everything since 8:00 AM
//   5:00 PM   everything since 1:00 PM
//
// "Everything" means care members added, contact logs posted, and records
// edited inside that window. This replaced per-event texting: staff were
// getting a message every time anyone touched a record.
//
// Deploy:
//   supabase functions deploy cares-recap
// Schedule (see supabase/cares-recap-schedule.sql): pg_cron calls this on the
// hour AND the half hour, and the function decides whether the local time is
// one of the three slots. Half-hourly rather than fixed UTC times so daylight
// saving needs no changes. It still runs half-hourly even though no slot now
// falls on the half hour, because the "starts in 30 minutes" reminders below
// need that resolution.
//
// Manual test (ignores the schedule, sends nothing, claims nothing):
//   curl -X POST '.../functions/v1/cares-recap' -H 'Authorization: Bearer <SERVICE_ROLE>' \
//        -H 'Content-Type: application/json' -d '{"dryRun":true}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { upcomingCareEvents } from '../_shared/careEvents.ts';
import {
  matchDeacon, cadenceByPhone, DEFAULT_CADENCE, addedAlert, updateAlert, alertText, alertParts,
  dailyParts, loadDirectory, last10,
} from '../_shared/deacons.ts';
import { activeMaintenance } from '../_shared/maintenance.ts';
import { smsCost, toGsm } from '../_shared/smsEncoding.ts';
import { systemCaller } from '../_shared/callers.ts';
import { packLines, PART_SEGMENTS } from '../_shared/smsParts.ts';
import { verifiedDeaconPhones } from '../_shared/recipients.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/* A dedicated secret for the scheduler, so the cron job doesn't need the
   service-role JWT pasted into it by hand — that paste is what kept failing,
   silently, with no way to tell from outside. */
const CRON_SECRET = Deno.env.get('CARES_CRON_SECRET') || '';

const TZ = 'America/New_York';   // Ellerslie / Columbus, GA

/* Local minutes past midnight. The first slot carries the morning briefing. */
const SLOTS = [8 * 60, 16 * 60];          // 8:00 AM and 4:00 PM
const SLOT_WINDOW = 30;          // a firing counts if it lands inside the half hour
const MORNING = SLOTS[0];

const STOP_NOTICE = 'Reply STOP to opt out.';
const NOTE_FRESH_DAYS = 2;       // how stale a note may be and still say "today"

/*
 * Only Pillar's own machinery may run this: the half-hourly cron's secret, or
 * the service-role key — each matched exactly (_shared/callers.ts). verify_jwt
 * is NOT an authorization check: it accepts any project-signed JWT, and the
 * anon key is one of those and ships in the public browser bundle.
 *
 * This used to accept, as well, any token whose payload merely CLAIMED role
 * "service_role" — read with atob, never verified. A token typed by hand passed,
 * and a dry run then returned the full care digest to whoever sent it. Gone.
 */
function authorized(req: Request) {
  return systemCaller(req, { serviceRole: SERVICE_ROLE, cronSecret: CRON_SECRET }) !== null;
}

/* The scheduler may only trigger a send. Reading care data back (dryRun) or
   forcing a re-send requires the service role, so the cron secret can't be used
   to pull records. */
function isServiceRole(req: Request) {
  return systemCaller(req, { serviceRole: SERVICE_ROLE }) === 'service';
}

/*
 * The church's wall clock, as a Date whose LOCAL getters return those values.
 * Edge functions run in UTC and careEvents.ts reads local fields throughout —
 * without this, anything after 8 PM Eastern would be filed under tomorrow.
 */
function wallClock(tz = TZ, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(at).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]),
  ) as Record<string, number>;
  const hour = p.hour === 24 ? 0 : p.hour;   // some runtimes render midnight as 24
  return new Date(p.year, p.month - 1, p.day, hour, p.minute);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/*
 * A local wall-clock time expressed as a real UTC instant, for querying
 * timestamptz. Derived per-call rather than by adding hours, so the windows
 * either side of a daylight-saving switch stay correct.
 */
function localTimeUtc(day: Date, minutes: number, tz = TZ) {
  const localIso = `${isoDay(day)}T${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}:00`;
  const guess = new Date(`${localIso}Z`);
  const driftMs = wallClock(tz, guess).getTime() - new Date(localIso).getTime();
  return new Date(guess.getTime() - driftMs);
}

const slotLabel = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${mm ? ':' + pad2(mm) : ':00'} ${h < 12 ? 'AM' : 'PM'}`;
};

/* Which slot this firing belongs to, or null. */
function currentSlot(now: Date) {
  const mod = now.getHours() * 60 + now.getMinutes();
  return SLOTS.find(s => mod >= s && mod < s + SLOT_WINDOW) ?? null;
}

const nextSlot = (slot: number) => SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length];

/* Everything since the previous slot — for the morning slot, since 5 PM yesterday. */
function windowFor(today: Date, slot: number) {
  const i = SLOTS.indexOf(slot);
  const end = localTimeUtc(today, slot);
  if (i > 0) return { start: localTimeUtc(today, SLOTS[i - 1]), end };
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return { start: localTimeUtc(yesterday, SLOTS[SLOTS.length - 1]), end };
}

/* ── Message ── */
const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/* Plain hyphens throughout. The digest's own copy used em dashes, and one is
   enough to send the entire text as UCS-2 at less than half the capacity —
   see _shared/smsEncoding.ts. buildDigest also normalises everything it sends,
   staff notes included, so this is belt and braces rather than the fix. */
const renderAdded   = (m: any) => `- ${m.full_name}${m.category ? ` - ${m.category}` : ''}`;
const renderUpdate  = (u: any) => `- ${u.name}: ${clean(u.notes)}`;
/*
 * An edit, with what it consisted of.
 *
 * "Also edited: Pansy Loudermilk" told a reader that something had happened and
 * then made them open the record to find out what — the exact work the digest
 * exists to save. `details` comes from change_log when the edit was made in the
 * app; when there is no recorded diff (an older edit, or one made directly in
 * the database) the record's current standing is reported instead, which is
 * still an answer to "what about her?".
 */
const renderEdit = (e: any) => {
  if (e.details) return `- ${e.name}: ${clean(e.details)}`;
  const now = [
    e.category,
    e.hospital_name ? `at ${e.hospital_name}` : '',
    e.room_number ? `Rm ${e.room_number}` : (e.floor ? `Floor ${e.floor}` : ''),
  ].filter(Boolean).join(', ');
  const note = clean(e.care_notes || '');
  return `- ${e.name}: ${now || 'record updated'}${note ? ` - ${note}` : ''}`;
};
const renderEvent   = (e: any) => {
  // Time and place only when actually recorded — no "time TBD" filler.
  const when = e.time?.label ? `${e.time.label} ` : '';
  const where = e.place ? ` at ${e.place}` : '';
  /*
   * The named kind, not the bare one: "Chemotherapy" or "MRI" rather than
   * "Appointment", because a digest exists to be acted on and "Appointment"
   * tells a visiting pastor nothing.
   *
   * When the note genuinely does not say, that is stated outright. Silence and
   * "we could not tell" look identical on a phone otherwise, and the second one
   * is a prompt to go and find out.
   */
  const what = e.label || e.kind;
  const named = what === 'Appointment' ? 'Appointment - Details not given' : what;
  return `- ${when}${e.member.full_name} - ${named}${where}`;
};

/*
 * Someone whose situation has not changed is still someone in a hospital bed.
 * They generate no log and no edit, so every other section is blind to them and
 * they quietly drop out of the digest the day after they are admitted — which
 * reads as "discharged" to anyone scanning it.
 */
const renderOngoing = (m: any) => {
  const where = [m.hospital_name, m.room_number ? `Rm ${m.room_number}` : '',
                 !m.room_number && m.floor ? `Floor ${m.floor}` : '']
    .filter(Boolean).join(' ');
  return `- ${m.full_name} - Still in hospital${where ? `, ${clean(where)}` : ''}`;
};

function sectionLines(title: string, items: any[], render: (x: any) => string) {
  if (!items.length) return [];
  return [`${title} (${items.length}):`, ...items.map(render)];
}

/*
 * Nothing is ever cut. Notes go out in full, every item is listed, and a
 * digest too long for one text is split into numbered parts rather than
 * trimmed — staff act on these, and a note that stops mid-sentence ("…to see
 * what") is worse than a second message.
 */
/*
 * A part's size is measured in SEGMENTS, not characters — PART_SEGMENTS and the
 * packing live in _shared/smsParts.ts, shared with the deacon alerts.
 *
 * This was PART_MAX = 1400 characters, on the reasoning that "Telnyx takes
 * 1600". That holds only while every character is in the GSM-7 alphabet. One
 * that is not — an em dash, a curly apostrophe typed on an iPhone — sends the
 * whole text as UCS-2 at 67 characters a segment, and 1,400 characters becomes
 * 21 segments. Telnyx refuses anything over 10, which is how the Sep 12 4:00 PM
 * digest reached nobody while reporting itself as a single part.
 */

/*
 * Returns the digest as one or more message bodies — one entry per text to
 * send, in order. Callers must send every part.
 */
export function buildDigest(
  { slot, added, updates, edited, events, ongoing = [] }:
  { slot: number; added: any[]; updates: any[]; edited: any[]; events: any[]; ongoing?: any[] },
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
      content.push(...sectionLines('Ongoing', ongoing, renderOngoing));
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


/* ── "Starts in 30 minutes" reminders ────────────────────
 *
 * Fires on every cron run, independently of the digest slots: an appointment
 * at 2:15 is no use in a 5:00 PM summary. The cron runs on the hour and the
 * half hour, so each firing looks 15-45 minutes ahead — a 30-minute span, which
 * contains exactly one firing for any given event. That is what keeps a single
 * reminder per appointment without needing the times to land on the half hour.
 */
const LEAD_MIN = 15;    // nearest an event may be and still be reminded
const LEAD_MAX = 45;    // furthest

/* Where it is happening: the note's own place if it named one, otherwise the
   hospital and room from the record. */
function reminderPlace(e: any) {
  const m = e.member || {};
  const fromRecord = [m.hospital_name, m.room_number ? `Rm ${m.room_number}` : '',
                      !m.room_number && m.floor ? `Floor ${m.floor}` : '']
    .filter(Boolean).join(', ');
  return e.place || fromRecord || '';
}

export function reminderText(e: any) {
  const kind = e.kind === 'Surgery' ? 'surgery' : 'an appointment';
  // The clock time is included because the lead is 15-45 minutes, not exactly
  // 30 — without it "in 30 minutes" could be off by a quarter of an hour.
  const head = `${e.member.full_name} has ${kind} in 30 minutes`
    + (e.time?.label ? ` (${e.time.label}).` : '.');

  const lines = [head];
  const what = e.kind === 'Surgery' ? (e.member.surgery_type || '') : '';
  if (what) lines.push(what);
  const where = reminderPlace(e);
  if (where) lines.push(where);
  // Nothing else to go on — the note itself is better than a bare name.
  if (!what && !where && e.snippet) lines.push(e.snippet);
  return lines.join('\n');
}

/*
 * Deacon alerts.
 *
 * Runs on every firing, so "as it happens" means within the half hour the recap
 * already wakes on even when the database trigger's own call is lost. The
 * morning slot also carries the summary for everyone who asked for one instead.
 *
 * Every send is claimed first, the way reminders are: the same admission must
 * not be texted twice because the function ran again. A claim whose text never
 * went out is handed back, so the next firing tries again — it used to stand,
 * and a refused text was recorded as delivered for good.
 */

/*
 * How far back the half-hourly sweep looks.
 *
 * It looked back 4½ hours, not the half hour intended: `now` here is a wall
 * clock (Eastern values in a UTC runtime), and subtracting from it produced an
 * instant four hours early. Timestamps are real instants now. The lookback is
 * two hours rather than exactly thirty minutes on purpose — the claim table
 * makes overlap free, and an exact window loses anything written in the seconds
 * between one firing's query and the next firing's start.
 */
const SWEEP_LOOKBACK_MS = 2 * 3600_000;
/* The morning summary covers everything since that deacon's previous summary,
   never more than two days back, and a day when there was no previous one. */
const DAILY_FIRST_MS = 24 * 3600_000;
const DAILY_MAX_MS = 48 * 3600_000;

type Planned = { phone: string; deacon: string; kind: string; ref: string; parts: string[] };

/*
 * What the deacon alerts would do now, without doing it. Shared by the real run
 * and the dry run, so a dry run cannot drift from what actually happens.
 */
async function planDeaconAlerts(
  supabase: any, nowMs: number, isMorning: boolean, stamp: string, sinceMs?: number,
) {
  const counts = { events: 0, unmatched: 0, ambiguous: 0, 'no deacon': 0, 'not a deacon': 0, unreachable: 0, daily_cadence: 0 };

  /* Who is reachable: deacons in the directory who are also on the texting group. */
  const { phones: deaconPhones, error: rosterErr } = await verifiedDeaconPhones(supabase);
  if (rosterErr) throw new Error(`deacon roster unavailable: ${rosterErr.message}`);
  if (!deaconPhones.size) return { skipped: 'no reachable deacons', counts, immediate: [] as Planned[], daily: [] as Planned[] };

  /* How each wants to hear — from the deacon poll only, never any other poll. */
  const { data: answers } = await supabase.from('sms_poll_answers')
    .select('poll_body, to_number, choice, answered_at');
  const cadence = cadenceByPhone(answers || []);

  const directory = await loadDirectory(supabase);

  const since = new Date(sinceMs ?? nowMs - SWEEP_LOOKBACK_MS).toISOString();
  const { data: added, error: aErr } = await supabase.from('care_members')
    .select('id, full_name, phone, category, care_notes, hospital_name, room_number, created_at')
    .gte('created_at', since);
  if (aErr) throw aErr;
  const { data: logs, error: lErr } = await supabase.from('contact_logs')
    .select('id, notes, created_at, member_id, care_members(full_name, phone)')
    .gte('created_at', since);
  if (lErr) throw lErr;

  const events: { kind: string; ref: string; care: any; alert: any }[] = [];
  for (const m of added || []) events.push({ kind: 'added', ref: m.id, care: m, alert: addedAlert(m) });
  for (const l of logs || []) {
    const cm = (l as any).care_members;
    if (!cm || !String(l.notes || '').trim()) continue;
    events.push({ kind: 'update', ref: l.id, care: cm, alert: updateAlert(cm.full_name, l.notes) });
  }
  counts.events = events.length;

  const immediate: Planned[] = [];
  for (const e of events) {
    const m = matchDeacon(e.care, directory, deaconPhones);
    if (!m.ok) { counts[m.why]++; continue; }      // unmatched, ambiguous or unreachable — never guessed
    if ((cadence.get(m.phone) || DEFAULT_CADENCE) === 'daily') { counts.daily_cadence++; continue; }
    immediate.push({ phone: m.phone, deacon: m.deacon.name || '', kind: e.kind, ref: String(e.ref), parts: alertParts(e.alert) });
  }

  const daily: Planned[] = [];
  if (isMorning) {
    /* Each deacon's previous summary, so today's picks up exactly where it left off. */
    const { data: prior } = await supabase.from('deacon_alerts_sent')
      .select('deacon_phone, ref_id, sent_at').eq('kind', 'daily')
      .gte('sent_at', new Date(nowMs - DAILY_MAX_MS - 3600_000).toISOString());
    const lastSummary = new Map<string, number>();
    for (const p of prior || []) {
      if (p.ref_id === stamp) continue;
      const t = Date.parse(p.sent_at);
      if (!lastSummary.has(p.deacon_phone) || t > lastSummary.get(p.deacon_phone)!) lastSummary.set(p.deacon_phone, t);
    }
    const startFor = (phone: string) => Math.max(lastSummary.get(phone) ?? nowMs - DAILY_FIRST_MS, nowMs - DAILY_MAX_MS);

    const from = new Date(nowMs - DAILY_MAX_MS).toISOString();
    const { data: dAdded } = await supabase.from('care_members')
      .select('id, full_name, phone, category, care_notes, hospital_name, room_number, created_at')
      .gte('created_at', from);
    const { data: dLogs } = await supabase.from('contact_logs')
      .select('id, notes, created_at, member_id, care_members(full_name, phone)')
      .gte('created_at', from);

    const byDeacon = new Map<string, { deacon: string; lines: { line: string }[] }>();
    const push = (care: any, at: string, line: string) => {
      const m = matchDeacon(care, directory, deaconPhones);
      if (!m.ok) return;
      if ((cadence.get(m.phone) || DEFAULT_CADENCE) !== 'daily') return;
      if (Date.parse(at) < startFor(m.phone)) return;
      if (!byDeacon.has(m.phone)) byDeacon.set(m.phone, { deacon: m.deacon.name || '', lines: [] });
      byDeacon.get(m.phone)!.lines.push({ line });
    };
    for (const m of dAdded || []) push(m, m.created_at, alertText(addedAlert(m)));
    for (const l of dLogs || []) {
      const cm = (l as any).care_members;
      if (cm && String(l.notes || '').trim()) push(cm, l.created_at, alertText(updateAlert(cm.full_name, l.notes)));
    }
    for (const [phone, v] of byDeacon) {
      if (v.lines.length) daily.push({ phone, deacon: v.deacon, kind: 'daily', ref: stamp, parts: dailyParts(v.lines) });
    }
  }

  return { deacons: deaconPhones.size, counts, immediate, daily };
}

/* Every part to one deacon. How many actually went, so a claim is only kept for
   a text that arrived. */
async function deliverToDeacon(phone: string, parts: string[]) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({
      channel: 'care', audience: 'deacons',
      messages: parts.map(body => ({ to_number: phone, to_name: '', body })),
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.maintenance || typeof out?.sent !== 'number') {
    console.error('deacon alert send failed:', res.status, out?.error || (out?.maintenance ? 'maintenance' : ''));
    return 0;
  }
  if (out.failed?.length) console.error('deacon alert part refused:', out.failed[0]?.error);
  return out.sent as number;
}

async function sendDeaconAlerts(supabase: any, nowMs: number, isMorning: boolean, stamp: string, sinceMs?: number) {
  const plan = await planDeaconAlerts(supabase, nowMs, isMorning, stamp, sinceMs);
  if ('skipped' in plan && plan.skipped) return { skipped: plan.skipped };

  let immediate = 0, daily = 0, released = 0;
  for (const p of [...plan.immediate, ...plan.daily]) {
    /* Claim before sending — a repeat firing, or the trigger's own call, must not text again. */
    const { error } = await supabase.from('deacon_alerts_sent')
      .insert({ deacon_phone: p.phone, kind: p.kind, ref_id: p.ref });
    if (error) continue;                                   // 23505 = already told

    const went = await deliverToDeacon(p.phone, p.parts);
    if (went > 0) { if (p.kind === 'daily') daily++; else immediate++; continue; }

    /* Nothing arrived: give the claim back so the next firing tries again. */
    await supabase.from('deacon_alerts_sent').delete()
      .eq('deacon_phone', p.phone).eq('kind', p.kind).eq('ref_id', p.ref);
    released++;
  }
  return { deacons: plan.deacons, ...plan.counts, immediate, daily, released };
}

async function sendReminders(supabase: any, members: any[], now: Date, today: Date) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sentOn = isoDay(today);

  const due = upcomingCareEvents(members || [], now, { pastDays: 0, aheadDays: 0 })
    .filter((e: any) => e.date === sentOn && e.time
      && e.time.minutes - nowMin >= LEAD_MIN && e.time.minutes - nowMin < LEAD_MAX);
  if (!due.length) return { due: 0, sent: 0 };

  const { data: staff } = await supabase
    .from('staff').select('id, name, phone, active, preferences');
  const recipients = (staff || []).filter((s: any) =>
    s.active !== false && String(s.phone || '').trim() && s.preferences?.caresSmsOptIn === true);
  if (!recipients.length) return { due: due.length, sent: 0, skipped: 'no opted-in staff' };

  let sent = 0;
  for (const e of due) {
    // Claim first: a duplicate firing must not text everyone again.
    const { error: claimErr } = await supabase.from('care_reminders_sent').insert({
      member_id: e.member.id, event_date: e.date, event_minutes: e.time.minutes, kind: e.kind,
    });
    if (claimErr) continue;      // 23505 = already reminded

    const body = reminderText(e);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        channel: 'care', audience: 'staff',
        messages: recipients.map((s: any) => ({ to_number: String(s.phone).trim(), to_name: s.name || '', body })),
      }),
    });
    const out = await res.json().catch(() => ({}));
    await supabase.from('care_reminders_sent')
      .update({ recipients: out?.sent ?? 0 })
      .eq('member_id', e.member.id).eq('event_date', e.date).eq('event_minutes', e.time.minutes);
    if (out?.sent) sent++;
  }
  return { due: due.length, sent };
}

Deno.serve(async (req) => {
  try {
    if (!authorized(req)) return json({ ok: false, error: 'forbidden' }, 403);
    const opts = await req.json().catch(() => ({}));
    const dryRun = opts?.dryRun === true && isServiceRole(req);   // reading data back is service-role only
    /* Manual = "push this slot now", e.g. a slot that was missed. It consumes
       the slot like any other send, so the scheduled firing can't repeat it. */
    const manual = opts?.manual === true;
    const force  = opts?.force === true && isServiceRole(req);   // deliberate re-send
    const forceSlot = Number.isInteger(opts?.slot) ? opts.slot : null;
    /*
     * Catching up deacon alerts after a gap — a maintenance window, an outage.
     * The sweep normally looks back two hours; this widens it for one run. The
     * claim table still stops anyone being told twice. Service role only, and
     * with deaconsOnly the reminders and the digest are left alone entirely.
     */
    const deaconsSince = isServiceRole(req) && typeof opts?.deaconsSince === 'string'
      && !Number.isNaN(Date.parse(opts.deaconsSince)) ? Date.parse(opts.deaconsSince) : undefined;
    const deaconsOnly = opts?.deaconsOnly === true && isServiceRole(req);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    /*
     * Scheduled maintenance: stop here, ahead of all three senders below.
     *
     * Reminders, deacon alerts and the digest each claim their row BEFORE they
     * send, so that a repeat firing cannot text twice. Blocking only at
     * send-prospect-sms would let every claim land and every send fail —
     * leaving all three recorded as delivered with nothing delivered, and a
     * claimed row is never retried.
     *
     * A dry run is let through on purpose. It claims nothing and sends nothing,
     * and reading the digest back is exactly what you want while working on it.
     */
    if (!dryRun) {
      const paused = await activeMaintenance(supabase);
      if (paused) return json({ ok: true, skipped: 'maintenance', until: paused.ends_at });
    }

    const now = wallClock();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* Reminders run on EVERY firing — an appointment at 2:15 is no use in the
       5:00 PM digest. Loaded here because the slot gate below returns early. */
    const { data: allMembers } = await supabase
      .from('care_members')
      .select('id, full_name, status, care_notes, surgery_date, surgery_type, hospital_name, room_number, floor, updated_at, created_at, contact_logs(notes, created_at)')
      .neq('status', 'Inactive');
    const reminders = deaconsOnly ? { skipped: 'deaconsOnly' } : dryRun
      ? { due: upcomingCareEvents(allMembers || [], now, { pastDays: 0, aheadDays: 0 })
            .filter((e: any) => e.date === isoDay(today) && e.time).length, sent: 0, dryRun: true }
      : await sendReminders(supabase, allMembers || [], now, today);

    /* Deacon alerts run on every firing too, for the same reason reminders do:
       the slot gate below returns early, and "as it happens" cannot wait for
       8:00 or 4:00. The morning firing also carries the daily summaries. */
    const isMorningFiring = currentSlot(now) === MORNING;
    /* A dry run reports what the alerts would do in numbers only — who and how
       many, never what the texts say. */
    const deacons = dryRun
      ? await planDeaconAlerts(supabase, Date.now(), isMorningFiring || opts?.morning === true, isoDay(today), deaconsSince)
          .then((p: any) => p.skipped ? { dryRun: true, skipped: p.skipped } : {
            dryRun: true, deacons: p.deacons, ...p.counts,
            immediate: p.immediate.length, daily: p.daily.length,
            texts: [...p.immediate, ...p.daily].reduce((n: number, x: any) => n + x.parts.length, 0),
            longestSegments: Math.max(0, ...[...p.immediate, ...p.daily].flatMap((x: any) => x.parts.map((b: string) => smsCost(b).segments))),
          })
          .catch((e: any) => ({ dryRun: true, error: String(e?.message || e) }))
      : await sendDeaconAlerts(supabase, Date.now(), isMorningFiring, isoDay(today), deaconsSince).catch((e: any) => {
          console.error('deacon alerts failed:', e?.message || e);
          return { error: String(e?.message || e) };
        });
    if (deaconsOnly) return json({ ok: true, deacons });

    const slot = forceSlot ?? currentSlot(now)
      ?? ((dryRun || manual) ? (SLOTS.find(s => s >= now.getHours() * 60) ?? MORNING) : null);
    if (slot === null) {
      return json({ ok: true, reminders, deacons,
        skipped: `local time ${pad2(now.getHours())}:${pad2(now.getMinutes())} is not a send slot` });
    }

    const sentOn = isoDay(today);
    const { start, end } = windowFor(today, slot);

    // 1. Care members added in this window.
    const { data: addedRows, error: addErr } = await supabase
      .from('care_members')
      .select('id, full_name, category, created_at')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: true });
    if (addErr) throw addErr;
    const added = addedRows || [];
    const addedIds = new Set(added.map(a => a.id));

    // 2. Contact logs posted in this window.
    const { data: logs, error: logErr } = await supabase
      .from('contact_logs')
      .select('notes, created_at, member_id, care_members(full_name)')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: true });
    if (logErr) throw logErr;
    const updates = (logs || [])
      .filter(l => String(l.notes || '').trim())
      .map(l => ({ name: (l as any).care_members?.full_name || 'Unknown', notes: l.notes, id: l.member_id }));
    const loggedIds = new Set(updates.map(u => u.id));

    // 3. Everything else, for today's schedule and to spot edited records.
    const { data: members, error: memErr } = await supabase
      .from('care_members')
      /* contact_logs is load-bearing: a date texted in about someone already in
         care lands in a log, not in care_notes. Without the embed the schedule
         only ever saw the profile — which is how a surgery logged yesterday for
         today went unannounced. */
      .select('id, full_name, status, category, care_notes, surgery_date, surgery_type, hospital_name, room_number, floor, updated_at, created_at, contact_logs(notes, created_at)')
      .neq('status', 'Inactive');
    if (memErr) throw memErr;

    /* Edited in this window, but neither newly added nor already covered by a
       log — otherwise the same person would be listed twice. */
    const editedRows = (members || [])
      .filter(m => {
        const u = new Date(m.updated_at || 0).getTime();
        return u >= start.getTime() && u < end.getTime()
          && !addedIds.has(m.id) && !loggedIds.has(m.id);
      });
    const editedIds = new Set(editedRows.map(m => m.id));

    /*
     * What each of those edits actually was. change_log carries a field-level
     * diff written by the app at save time; it is matched by name because that
     * is the only key the table holds. A missing row is not an error — edits
     * made before this was recorded, or made straight in the database, simply
     * fall back to reporting where the record stands now.
     */
    const { data: changes } = await supabase
      .from('change_log')
      .select('member_name, details, created_at')
      .eq('action', 'Updated')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: true });

    const detailFor = new Map<string, string[]>();
    for (const c of changes || []) {
      const k = String(c.member_name || '').trim().toLowerCase();
      if (!k || !String(c.details || '').trim()) continue;
      if (!detailFor.has(k)) detailFor.set(k, []);
      detailFor.get(k)!.push(String(c.details).trim());
    }

    const edited = editedRows.map(m => ({
      name: m.full_name,
      details: (detailFor.get(String(m.full_name || '').trim().toLowerCase()) || []).join('; '),
      category: m.category,
      hospital_name: m.hospital_name,
      room_number: m.room_number,
      floor: m.floor,
      care_notes: m.care_notes,
    }));

    /*
     * Still in a hospital bed, and nothing new said about them this window.
     *
     * Anyone who was added, logged against or edited is already named above, so
     * they are excluded here rather than appearing twice. Resolved is filtered
     * out as well as Inactive: the query above keeps Resolved rows, and someone
     * discharged should not be reported as still admitted.
     */
    const ongoing = (members || []).filter(m =>
      m.category === 'Hospitalized'
      && m.status !== 'Inactive' && m.status !== 'Resolved'
      && !addedIds.has(m.id) && !loggedIds.has(m.id) && !editedIds.has(m.id));

    /*
     * Relative wording ("tomorrow") is resolved against the moment the note was
     * written, so it no longer drifts. Freshness is judged on that same anchor.
     * Using the member's updated_at instead meant a note written yesterday was
     * discarded because the RECORD had not been edited for three days — which
     * is exactly how a surgery scheduled for today went unannounced.
     */
    const freshCutoff = Date.now() - NOTE_FRESH_DAYS * 864e5;
    const events = slot === MORNING
      ? upcomingCareEvents(members || [], now, { pastDays: 0, aheadDays: 0 })
          .filter((e: any) => e.date === sentOn)
          .filter((e: any) => !e.relative
            || new Date(e.anchor || e.member.updated_at || 0).getTime() >= freshCutoff)
      : [];

    // Every slot sends, quiet or not — a "nothing to report" check is itself
    // the signal that the system is alive and was looked at.
    const payload = { slot, added, updates, edited, events, ongoing };
    // One or more parts — a long digest is split, never trimmed.
    const parts = buildDigest(payload);
    const partsWithNotice = buildDigest(payload, { tail: STOP_NOTICE });

    // 4. Recipients — the admin-managed opt-in list, staff only.
    const { data: staff, error: staffErr } = await supabase
      .from('staff').select('id, name, phone, active, preferences');
    if (staffErr) throw staffErr;
    const recipients = (staff || []).filter(s =>
      s.active !== false && String(s.phone || '').trim() && s.preferences?.caresSmsOptIn === true);

    if (dryRun) {
      return json({ ok: true, dryRun: true, sentOn, slot: slotLabel(slot),
        body: parts.join('\n\n— — —\n\n'), parts: parts.length,
        longest: Math.max(...parts.map(p => p.length)),
        /* What Telnyx will actually count. Characters alone were how a digest
           that needed 21 segments reported itself as one part. */
        segments: parts.map(p => smsCost(p)),
        window: { from: start.toISOString(), to: end.toISOString() },
        added: added.length, updates: updates.length, edited: edited.length, events: events.length,
        ongoing: ongoing.length,
        recipients: recipients.map(r => r.name) });
    }

    if (!recipients.length) return json({ ok: true, sentOn, slot, skipped: 'no opted-in staff' });

    /* One message per part per person. flatMap, not map — mapping would send
       only the first part and silently drop the rest of the digest. */
    const messages = recipients.flatMap(s => {
      const mine = s.preferences?.caresStopNoticeSent === true ? parts : partsWithNotice;
      return mine.map(body => ({
        to_number: String(s.phone).trim(),
        to_name: s.name || '',
        body,
      }));
    });

    /*
     * Claim the slot immediately before the only step that can double-text.
     * Claiming earlier meant a transient read error burned the slot with
     * nothing sent and no retry possible.
     */
    {
      const { error } = await supabase.from('cares_alert_sends').insert({ sent_on: sentOn, slot });
      if (error && !(error.code === '23505' && force)) {
        if (error.code === '23505') return json({ ok: true, skipped: 'already sent this slot', sentOn, slot });
        throw error;
      }
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ messages, channel: 'care', audience: 'staff' }),   // never into the SMS log
    });
    const out = await res.json().catch(() => ({}));

    /*
     * A batch-level failure returns no `sent` and no `failed`. Treating that as
     * "nobody failed" would report success AND permanently mark the opt-out
     * notice delivered to people who never got a message.
     */
    if (!res.ok || typeof out?.sent !== 'number') {
      const reason = out?.error || `send-prospect-sms HTTP ${res.status}`;
      await supabase.from('cares_alert_sends')
        .update({ recipients: 0, note: `send failed: ${reason}` })
        .eq('sent_on', sentOn).eq('slot', slot);
      return json({ ok: false, sentOn, slot, error: reason, attempted: recipients.length }, 502);
    }

    /* Only mark the opt-out notice delivered for people we actually reached —
       matched by number, not name: two staff can share a name, and a refused
       part must not mark a different person as told. */
    const failed = new Set([...(out?.failed || []), ...(out?.skipped || []).filter((x: any) => /landline/i.test(x.reason || ''))]
      .map((f: any) => last10(f.to_number)).filter(Boolean));
    const missed = (s: any) => failed.has(last10(s.phone));
    await Promise.all(recipients
      .filter(s => s.preferences?.caresStopNoticeSent !== true && !missed(s))
      .map(s => supabase.from('staff')
        .update({ preferences: { ...(s.preferences || {}), caresStopNoticeSent: true } })
        .eq('id', s.id)));

    /* out.sent counts MESSAGES; with a split digest that is people × parts.
       Report people, or a 2-part send to 5 staff reads as 10 recipients. */
    const reached = recipients.filter(s => !missed(s)).length;

    await supabase.from('cares_alert_sends')
      .update({ recipients: reached,
                added: added.length, updates: updates.length, events: events.length,
                note: parts.length > 1 ? `${parts.length} parts` : null })
      .eq('sent_on', sentOn).eq('slot', slot);

    return json({ ok: true, sentOn, slot: slotLabel(slot), sent: reached,
      parts: parts.length, messages: out?.sent ?? 0,
      failed: out?.failed ?? [], added: added.length, updates: updates.length,
      edited: edited.length, events: events.length });
  } catch (e) {
    console.error('cares-recap error:', e);
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
