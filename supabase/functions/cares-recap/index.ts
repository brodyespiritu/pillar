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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/* A dedicated secret for the scheduler, so the cron job doesn't need the
   service-role JWT pasted into it by hand — that paste is what kept failing,
   silently, with no way to tell from outside. */
const CRON_SECRET = Deno.env.get('CARES_CRON_SECRET') || '';

const TZ = 'America/New_York';   // Ellerslie / Columbus, GA

/* Local minutes past midnight. The first slot carries the morning briefing. */
const SLOTS = [8 * 60, 13 * 60, 17 * 60];
const SLOT_WINDOW = 30;          // a firing counts if it lands inside the half hour
const MORNING = SLOTS[0];

const STOP_NOTICE = 'Reply STOP to opt out.';
const NOTE_FRESH_DAYS = 2;       // how stale a note may be and still say "today"

/*
 * Only the service role may run this. verify_jwt is NOT an authorization check —
 * it accepts any project-signed JWT, and the anon key is one of those and ships
 * in the public browser bundle.
 */
const enc = new TextEncoder();
function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function roleOf(token: string) {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.role || '';
  } catch { return ''; }
}
function authorized(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (roleOf(token) === 'service_role') return true;                      // a real service-role JWT
  if (CRON_SECRET && timingSafeEqual(token, CRON_SECRET)) return true;    // the scheduler
  return !!SERVICE_ROLE && timingSafeEqual(token, SERVICE_ROLE);
}

/* The scheduler may only trigger a send. Reading care data back (dryRun) still
   requires the service role, so the cron secret can't be used to pull records. */
function isServiceRole(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return roleOf(token) === 'service_role' || (!!SERVICE_ROLE && timingSafeEqual(token, SERVICE_ROLE));
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

const renderAdded   = (m: any) => `- ${m.full_name}${m.category ? ` — ${m.category}` : ''}`;
const renderUpdate  = (u: any) => `- ${u.name}: ${clean(u.notes)}`;
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
  return `- ${when}${e.member.full_name} — ${named}${where}`;
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
const PART_MAX = 1400;          // Telnyx takes 1600; leave room for the (n/m) tag

/* Break at the last space that fits; only mid-word if a single word is
   longer than the whole allowance. */
function splitAt(s: string, room: number): [string, string] {
  const space = s.lastIndexOf(' ', room);
  const at = space > room * 0.5 ? space : room;      // avoid a runt first half
  return [s.slice(0, at).trimEnd(), s.slice(at).trimStart()];
}

/*
 * Packs against the space actually left in the current part, rather than
 * pre-chopping each line to the full budget — otherwise a note longer than one
 * text pushes itself to a fresh part and leaves a near-empty one behind.
 */
function packLines(lines: string[], budget: number): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  const used = () => cur.reduce((n, l) => n + l.length + 1, 0);
  const flush = () => { if (cur.length) { chunks.push(cur); cur = []; } };

  for (const raw of lines) {
    let rest = raw;
    for (;;) {
      const room = budget - used();
      if (rest.length <= room) { cur.push(rest); break; }
      // Too little left to be worth a fragment — start the next part.
      if (room < 60) { flush(); continue; }
      const [head, tail] = splitAt(rest, room);
      cur.push(head); flush(); rest = tail;
    }
  }
  flush();
  return chunks.length ? chunks : [[]];
}

/*
 * Returns the digest as one or more message bodies — one entry per text to
 * send, in order. Callers must send every part.
 */
export function buildDigest(
  { slot, added, updates, edited, events, ongoing = [] }:
  { slot: number; added: any[]; updates: any[]; edited: string[]; events: any[]; ongoing?: any[] },
  { tail = '' }: { tail?: string } = {},
): string[] {
  const morning = slot === MORNING;
  /* Someone still in a hospital bed counts as something to report, so a slot
     carrying only them is not a quiet one. */
  const nothing = !added.length && !updates.length && !edited.length && !ongoing.length;
  const suffix = tail ? `\n\n${tail}` : '';
  const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n').trim();

  /*
   * A quiet check is a single line, not a header with an empty body under it —
   * it reads at a glance on a lock screen. The morning one still carries the
   * day's schedule when there is one.
   */
  if (nothing && !morning) {
    return [`CARES - No recent updates. Next check at ${slotLabel(nextSlot(slot))}` + suffix];
  }

  const header = nothing ? 'CARES - No updates yesterday' : `Bethesda Cares — ${slotLabel(slot)}`;

  const content: string[] = [];
  if (!nothing) {
    content.push(...sectionLines('Added', added, renderAdded));
    if (added.length && (updates.length || edited.length)) content.push('');
    content.push(...sectionLines('Updates', updates, renderUpdate));
    if (edited.length) content.push(`Also edited: ${clean(edited.join(', '))}`);
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

  const whole = tidy([header, '', ...content].join('\n'));
  if (whole.length + suffix.length <= PART_MAX) return [whole + suffix];

  // Every part repeats the header and carries an (n/m) tag, since texts can
  // arrive out of order. Reserve room for both, plus the opt-out tail.
  const budget = PART_MAX - header.length - 12 - suffix.length;
  const chunks = packLines(content, Math.max(80, budget));
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
        channel: 'care',
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

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const now = wallClock();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* Reminders run on EVERY firing — an appointment at 2:15 is no use in the
       5:00 PM digest. Loaded here because the slot gate below returns early. */
    const { data: allMembers } = await supabase
      .from('care_members')
      .select('id, full_name, status, care_notes, surgery_date, surgery_type, hospital_name, room_number, floor, updated_at, created_at, contact_logs(notes, created_at)')
      .neq('status', 'Inactive');
    const reminders = dryRun
      ? { due: upcomingCareEvents(allMembers || [], now, { pastDays: 0, aheadDays: 0 })
            .filter((e: any) => e.date === isoDay(today) && e.time).length, sent: 0, dryRun: true }
      : await sendReminders(supabase, allMembers || [], now, today);

    const slot = forceSlot ?? currentSlot(now)
      ?? ((dryRun || manual) ? (SLOTS.find(s => s >= now.getHours() * 60) ?? MORNING) : null);
    if (slot === null) {
      return json({ ok: true, reminders,
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
    const edited = editedRows.map(m => m.full_name);
    const editedIds = new Set(editedRows.map(m => m.id));

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
      body: JSON.stringify({ messages, channel: 'care' }),   // never into the SMS log
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

    // Only mark the opt-out notice delivered for people we actually reached.
    const failed = new Set((out?.failed || []).map((f: any) => f.to_name));
    await Promise.all(recipients
      .filter(s => s.preferences?.caresStopNoticeSent !== true && !failed.has(s.name || ''))
      .map(s => supabase.from('staff')
        .update({ preferences: { ...(s.preferences || {}), caresStopNoticeSent: true } })
        .eq('id', s.id)));

    /* out.sent counts MESSAGES; with a split digest that is people × parts.
       Report people, or a 2-part send to 5 staff reads as 10 recipients. */
    const reached = recipients.filter(s => !failed.has(s.name || '')).length;

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
