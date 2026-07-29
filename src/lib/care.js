import { supabase } from './supabase';
import { sendProspectSms } from './sms';

export const CATEGORIES = [
  'Hospitalized', 'Grieving', 'New Member', 'Homebound', 'Crisis',
  'Pain', 'Sick', 'Prayer Request', 'Follow Up', 'Surgery',
  'Test/Treatment', 'Recovering', 'Other',
];

export const PRIORITIES = ['High', 'Medium', 'Low'];
export const STATUSES   = ['Active', 'Inactive', 'Resolved'];
export const LOG_TYPES  = ['Phone Call', 'Text Message', 'Dinner/Meal', 'Update/Visit'];

// Categories that reveal medical fields
export const MEDICAL_CATEGORIES = ['Hospitalized', 'Surgery'];

/* Any mention of surgery in free text (drives the notes highlight + step 2). */
export const SURGERY_RE = /surger(?:y|ies|ical)/i;

/*
 * Best-effort surgery type from care notes. Known procedures first (most
 * specific match wins), then "<body part> surgery", then "surgery on <part>".
 * Returns '' when nothing confident — never guesses from arbitrary words.
 */
const PROCEDURES = [
  ['knee replacement', 'Knee Replacement'], ['hip replacement', 'Hip Replacement'],
  ['open heart', 'Open Heart Surgery'], ['triple bypass', 'Triple Bypass'],
  ['bypass', 'Heart Bypass'], ['appendectomy', 'Appendectomy'],
  ['gallbladder', 'Gallbladder Removal'], ['hysterectomy', 'Hysterectomy'],
  ['cataract', 'Cataract Surgery'], ['tonsil', 'Tonsillectomy'],
  ['c-section', 'C-Section'], ['hernia', 'Hernia Repair'],
  ['pacemaker', 'Pacemaker Placement'], ['stent', 'Stent Placement'],
];
const BODY_PARTS = new Set([
  'knee', 'hip', 'back', 'heart', 'shoulder', 'brain', 'spine', 'spinal',
  'hand', 'foot', 'ankle', 'wrist', 'elbow', 'neck', 'eye', 'sinus',
  'dental', 'oral', 'jaw', 'lung', 'kidney', 'liver',
]);
const cap = w => w.charAt(0).toUpperCase() + w.slice(1);

export function extractSurgeryType(notes = '') {
  const s = String(notes).toLowerCase();
  if (!SURGERY_RE.test(s)) return '';
  for (const [needle, label] of PROCEDURES) if (s.includes(needle)) return label;
  let m = s.match(/([a-z-]+)\s+surger(?:y|ies)/);
  if (m && BODY_PARTS.has(m[1])) return `${cap(m[1])} Surgery`;
  m = s.match(/surgery\s+on\s+(?:his\s|her\s|their\s|the\s)?([a-z-]+)/);
  if (m && BODY_PARTS.has(m[1])) return `${cap(m[1])} Surgery`;
  return '';
}

export const CATEGORY_COLORS = {
  Hospitalized:     '#E5484D',
  Grieving:         '#8B5CF6',
  'New Member':     '#10B981',
  Homebound:        '#F59E0B',
  Crisis:           '#DC2626',
  Pain:             '#EC4899',
  Sick:             '#F97316',
  'Prayer Request': '#3B82F6',
  'Follow Up':      '#06B6D4',
  Surgery:          '#E5484D',
  'Test/Treatment': '#8B5CF6',
  Recovering:       '#10B981',
  Other:            '#6B7280',
};

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };


/* ── Cares SMS alerts to staff ──
   Recipients are staff an admin gave a mobile number AND switched
   "Cares alerts" on for (Admin → Users → Edit User). Carrier rules require
   an opt-out notice on the first message to any number, so the first send
   carries "Reply STOP to opt out" and we remember that it went. */

const SEGMENT = 160;
const STOP_NOTICE = 'Reply STOP to opt out.';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/* The spec's formats end without punctuation ("Reason: Broken wrist"), so
   anything we append needs a separator or the words run together. */
const joinSentence = (text, clause) =>
  clause ? `${text}${/[.!?…]$/.test(text) ? '' : '.'} ${clause}` : text;

/* Trim the message so it stays a single segment, leaving room for the tail. */
function fit(base, tail = '') {
  const room = SEGMENT - (tail ? tail.length + 2 : 0);   // +2 for ". "
  const body = base.length <= room ? base : `${base.slice(0, Math.max(0, room - 1))}…`;
  return joinSentence(body, tail);
}

/*
 * The reason someone joined the list is the first sentence of the care note
 * ("Broken wrist"); anything after it is extra detail we append. With no note
 * at all, the category is the closest thing to a reason.
 */
export function splitReason(careNotes, category) {
  const note = clean(careNotes);
  if (!note) return { reason: clean(category) || 'Care need', extra: '' };
  const m = note.match(/^(.+?[.!?])\s+(.*)$/);
  return m ? { reason: m[1].replace(/[.!?]$/, ''), extra: m[2] } : { reason: note, extra: '' };
}

/** "Bethesda Cares: Gail Sheppard has been added to cares list. Reason: Broken wrist" */
export function addedToCaresSms(member, { withStop = false } = {}) {
  const { reason, extra } = splitReason(member?.care_notes, member?.category);
  const base = joinSentence(
    `Bethesda Cares: ${clean(member?.full_name)} has been added to cares list. Reason: ${reason}`,
    extra);
  return fit(base, withStop ? STOP_NOTICE : '');
}

/** "Cares Update: Gail Sheppard. Note: Went to hospital" */
export function caresUpdateSms({ memberName, note }, { withStop = false } = {}) {
  return fit(`Cares Update: ${clean(memberName)}. Note: ${clean(note)}`, withStop ? STOP_NOTICE : '');
}

/* Staff who can receive Cares texts: opted in, active, with a mobile number. */
export async function fetchCaresSmsStaff() {
  const { data, error } = await supabase.from('staff').select('id, name, phone, active, preferences');
  if (error) return [];
  return (data || []).filter(s =>
    s.active !== false
    && String(s.phone || '').trim()
    && s.preferences?.caresSmsOptIn === true);
}

/* Remember that a number has seen the opt-out notice, so we send it once. */
async function markStopNoticeSent(staffRow) {
  const prefs = { ...(staffRow.preferences || {}), caresStopNoticeSent: true };
  await supabase.from('staff').update({ preferences: prefs }).eq('id', staffRow.id);
}

/*
 * Send a Cares text to the opted-in staff.
 * `build(staff, opts)` returns the message body for that person.
 * Returns { sent, failed, skipped }.
 */
export async function sendCaresSms(build) {
  const staff = await fetchCaresSmsStaff();
  if (!staff.length) return { sent: 0, failed: [], skipped: true };

  const messages = staff.map(s => ({
    to_number: s.phone.trim(),
    to_name: s.name || '',
    body: build(s, { withStop: s.preferences?.caresStopNoticeSent !== true }),
  }));

  try {
    const res = await sendProspectSms(messages);
    // Only record the notice for people we actually reached.
    const failedNames = new Set((res.failed || []).map(f => f.to_name));
    await Promise.all(staff
      .filter(s => s.preferences?.caresStopNoticeSent !== true && !failedNames.has(s.name || ''))
      .map(markStopNoticeSent));
    return { ...res, skipped: false };
  } catch (e) {
    return { sent: 0, failed: [{ error: String(e?.message || e) }], skipped: false };
  }
}

/* Someone was added to the cares list. */
export function notifyCareSms(member) {
  return sendCaresSms((s, o) => addedToCaresSms(member, o));
}

/* An update was posted to someone's care record. */
export function notifyCareUpdateSms({ memberName, note }) {
  if (!clean(note)) return Promise.resolve({ sent: 0, failed: [], skipped: true });
  return sendCaresSms((s, o) => caresUpdateSms({ memberName, note }, o));
}

/* ── Appointment & surgery watcher ──
   Scans care notes for dates mentioned near appointment/surgery language and
   turns them into schedule entries. Wording adapts: a note saying "July 27th"
   renders as "Today" when that day arrives. */
/* Appointment language: the word itself, doctor types, and medical tests —
   a sentence still needs a date before it becomes a schedule entry. */
export const APPT_RE = new RegExp([
  'appointment', '\\bappt\\b', 'check[- ]?up', 'follow[- ]?up', 'consult',
  // people
  'doctor', '\\bdr\\b\\.?', 'physician', 'specialist', 'dentist', 'orthodont',
  'cardiolog', 'oncolog', 'dermatolog', 'neurolog', 'urolog', 'gastroenterolog',
  'orthoped', 'optometr', 'ophthalmolog', 'podiatr', 'rheumatolog',
  'endocrinolog', 'pulmonolog', 'nephrolog', 'therap',
  // tests & treatments
  '\\bmri\\b', '\\bct scan', '\\bcat scan', 'x[- ]?ray', 'ultrasound', 'sonogram',
  'mammogram', 'colonoscopy', 'endoscopy', 'biopsy', 'blood ?work', 'blood test',
  'lab ?work', '\\bekg\\b', '\\becg\\b', 'stress test', 'pet scan', 'screening',
  'imaging', 'dialysis', 'infusion', 'chemo', 'physical therapy', 'rehab',
].join('|'), 'i');

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day0 = now => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/* First time in the text: "9:45AM", "3 pm", "10:30". Bare hours without a
   colon or meridiem ("at 3") are skipped as too ambiguous. */
export function parseTimeFrom(text) {
  const m = String(text).match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i)
    || String(text).match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!m) return null;
  let h = +m[1];
  const hasMin = m.length === 4 && m[2] !== undefined && /:/.test(m[0]);
  const min = hasMin ? +m[2] : 0;
  const ap = hasMin ? m[3] : m[2];
  if (h > 23 || min > 59) return null;
  if (ap) {
    const pm = /p/i.test(ap);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h >= 1 && h <= 6) {
    h += 12;   // "at 3:30" with no meridiem — afternoon is the safer read
  }
  const h12 = ((h + 11) % 12) + 1;
  return { label: `${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, minutes: h * 60 + min };
}

/* No-year dates resolve to the nearest sensible occurrence: this year, unless
   that day passed more than a week ago — then next year. */
function resolveMonthDay(mo, dayNum, now, year) {
  if (year) return new Date(year < 100 ? 2000 + year : year, mo, dayNum);
  const cand = new Date(now.getFullYear(), mo, dayNum);
  return (day0(now) - cand) / 864e5 > 7 ? new Date(now.getFullYear() + 1, mo, dayNum) : cand;
}

/* First date mentioned in the text with its position — or null. */
function parseDateWithIndex(text, now = new Date()) {
  const s = String(text);
  let m = s.match(/\b(today|tonight|this (?:morning|afternoon|evening))\b/i);
  if (m) return { date: isoDay(day0(now)), idx: m.index };
  m = s.match(/\btomorrow\b/i);
  if (m) return { date: isoDay(new Date(day0(now).getTime() + 864e5)), idx: m.index };

  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
  if (m && +m[2] >= 1 && +m[2] <= 31) {
    const d = resolveMonthDay(MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2], now, m[3] ? +m[3] : null);
    return { date: isoDay(d), idx: m.index };
  }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    return { date: isoDay(resolveMonthDay(+m[1] - 1, +m[2], now, m[3] ? +m[3] : null)), idx: m.index };
  }
  m = s.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (m) {
    const want = WEEKDAYS.indexOf(m[1].toLowerCase());
    const base = day0(now);
    let ahead = (want - base.getDay() + 7) % 7;
    if (/next\s/i.test(m[0])) ahead += 7;   // "next Tuesday" = the following week
    return { date: isoDay(new Date(base.getTime() + ahead * 864e5)), idx: m.index };
  }
  return null;
}

/* First date mentioned in the text, as YYYY-MM-DD — or null. */
export function parseDateFrom(text, now = new Date()) {
  return parseDateWithIndex(text, now)?.date ?? null;
}

/* Adaptive label: Today / Tomorrow / Yesterday / weekday within a week / date. */
export function relativeDayLabel(dateStr, now = new Date()) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const target = new Date(y, mo - 1, d);
  const diff = Math.round((target - day0(now)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= 6) return target.toLocaleDateString('en-US', { weekday: 'long' });
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* Schedule entries for one care member: the structured surgery date plus any
   dated appointment/surgery sentences found in the notes. */
export function extractCareEvents(member, now = new Date()) {
  const events = [];
  const seen = new Set();
  const push = (kind, date, time, snippet) => {
    if (!date) return;
    const k = `${kind}|${date}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push({ kind, date, time, snippet });
  };

  if (member.surgery_date) {
    const bits = [member.surgery_type, member.hospital_name ? `at ${member.hospital_name}` : '']
      .filter(Boolean).join(' ');
    push('Surgery', member.surgery_date, null, bits || 'Scheduled surgery');
  }

  // Mask abbreviation periods (Dr., Mrs., …) so they don't end a sentence.
  const notes = String(member.care_notes || '')
    .replace(/\b(dr|mr|mrs|ms|rev|jr|sr|st)\./gi, (mm) => mm.slice(0, -1) + '\u0001');
  for (const raw of notes.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.replace(/\u0001/g, '.').trim();
    if (!sentence) continue;
    const surgIdx = sentence.search(SURGERY_RE);
    const apptIdx = sentence.search(APPT_RE);
    if (surgIdx < 0 && apptIdx < 0) continue;
    const found = parseDateWithIndex(sentence, now);
    if (!found) continue;
    // Double wording ("appointment ... to discuss surgeries"): the keyword
    // nearest the date names the event — that sentence is an appointment,
    // while "pre-op MRI then knee surgery on Friday" stays a surgery.
    let kind;
    if (surgIdx >= 0 && apptIdx >= 0) {
      // Talking ABOUT a surgery (discuss/about/scheduling it) is an appointment;
      // otherwise the keyword nearest the date names the event.
      const discussion = /\b(discuss|about|regarding|schedul|plan|date of|options)/i.test(sentence);
      kind = discussion || Math.abs(apptIdx - found.idx) <= Math.abs(surgIdx - found.idx)
        ? 'Appointment' : 'Surgery';
    } else {
      kind = surgIdx >= 0 ? 'Surgery' : 'Appointment';
    }
    push(kind, found.date, parseTimeFrom(sentence),
      sentence.replace(/\s+/g, ' ').slice(0, 110));
  }
  return events;
}

/* All members' entries in a window around today, soonest first. */
export function upcomingCareEvents(members, now = new Date(), { pastDays = 1, aheadDays = 45 } = {}) {
  const min = day0(now).getTime() - pastDays * 864e5;
  const max = day0(now).getTime() + aheadDays * 864e5;
  const out = [];
  for (const m of members) {
    if (m.status === 'Resolved') continue;
    for (const ev of extractCareEvents(m, now)) {
      const [y, mo, d] = ev.date.split('-').map(Number);
      const ts = new Date(y, mo - 1, d).getTime();
      if (ts < min || ts > max) continue;
      out.push({ ...ev, member: m, ts });
    }
  }
  out.sort((a, b) => a.ts - b.ts || (a.time?.minutes ?? 1441) - (b.time?.minutes ?? 1441));
  return out;
}

/* ── Reads ─────────────────────────────────────────── */
export async function fetchMembers() {
  const { data, error } = await supabase
    .from('care_members')
    .select('*, contact_logs(id, type, notes, logged_by_name, created_at)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return []; }
  // High priority always to top, then most-recent
  return (data || []).sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

/* ── Member CRUD ───────────────────────────────────── */
export async function saveMember(member) {
  const payload = { ...member };
  delete payload.contact_logs;
  // strip empty date strings → null
  ['admission_date', 'surgery_date'].forEach(k => {
    if (payload[k] === '') payload[k] = null;
  });
  // empty uuid / foreign keys → null (avoids "invalid input syntax for type uuid")
  ['assigned_to'].forEach(k => {
    if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
  });
  if (member.id) {
    const { data, error } = await supabase
      .from('care_members').update(payload).eq('id', member.id).select().single();
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase
    .from('care_members').insert(payload).select().single();
  return { data, error };
}

export async function deleteMember(id) {
  return supabase.from('care_members').delete().eq('id', id);
}

/* ── Contact logs ──────────────────────────────────── */
export async function addLog(log) {
  return supabase.from('contact_logs').insert(log).select().single();
}

export async function deleteLog(id) {
  return supabase.from('contact_logs').delete().eq('id', id);
}

/* ── Derived stats for QuickBoxes + AI summary ─────── */
export function computeStats(members) {
  const active      = members.filter(m => m.status === 'Active');
  const needsAttn   = members.filter(m => m.priority === 'High' && m.category !== 'Recovering');
  const notVisited  = members.filter(m => !(m.contact_logs?.length));
  const hospitalized = members.filter(m => m.category === 'Hospitalized');
  const surgeries   = members.filter(m => m.category === 'Surgery');
  const prayer      = members.filter(m => m.category === 'Prayer Request');
  return {
    active: active.length,
    needsAttention: needsAttn.length,
    notVisited: notVisited.length,
    hospitalized: hospitalized.length,
    surgeries: surgeries.length,
    prayer: prayer.length,
    total: members.length,
  };
}

export function buildSummary(members) {
  const s = computeStats(members);
  if (s.active === 0) {
    return 'No active care cases at the moment. Your congregation is well supported!';
  }
  const parts = [`You have ${s.active} active care case${s.active === 1 ? '' : 's'}`];
  const clauses = [];
  if (s.hospitalized) clauses.push(`${s.hospitalized} hospitalization${s.hospitalized === 1 ? '' : 's'}`);
  if (s.surgeries)    clauses.push(`${s.surgeries} upcoming surger${s.surgeries === 1 ? 'y' : 'ies'}`);
  if (clauses.length) parts[0] += `, including ${clauses.join(' and ')}`;
  parts[0] += '.';

  if (s.prayer) parts.push(`${s.prayer} prayer request${s.prayer === 1 ? '' : 's'} need attention.`);

  const stale = members.filter(m => {
    if (!m.contact_logs?.length) return false;
    const last = Math.max(...m.contact_logs.map(l => new Date(l.created_at)));
    return (Date.now() - last) > 7 * 864e5;
  });
  const never = members.filter(m => !(m.contact_logs?.length) && m.status === 'Active');
  const uncontacted = stale.length + never.length;
  if (uncontacted) parts.push(`${uncontacted} ${uncontacted === 1 ? 'person hasn\'t' : "people haven't"} been contacted in over a week.`);

  const recent = [...members]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3).map(m => m.full_name);
  if (recent.length) parts.push(`Recently added: ${recent.join(', ')}.`);

  return parts.join(' ');
}

export function lastContacted(member) {
  if (!member.contact_logs?.length) return null;
  return member.contact_logs
    .map(l => l.created_at)
    .sort((a, b) => new Date(b) - new Date(a))[0];
}
