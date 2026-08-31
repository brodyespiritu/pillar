/*
 * Appointment & surgery watcher — pure logic, no I/O.
 *
 * Lives under supabase/functions/_shared so the nightly cares-recap edge
 * function and the web app run the SAME parser. Deployed functions can only
 * import from inside supabase/functions, and a second copy of this would drift
 * from the on-screen calendar the first time the rules change.
 *
 * Every date/time helper reads LOCAL clock fields, so callers in UTC (edge
 * functions) must pass a `now` built from the church's wall clock.
 */

/* Any mention of surgery in free text (drives the notes highlight + step 2). */
const PROCEDURES = [
  ['knee replacement', 'Knee Replacement'], ['hip replacement', 'Hip Replacement'],
  ['open heart', 'Open Heart Surgery'], ['triple bypass', 'Triple Bypass'],
  ['bypass', 'Heart Bypass'], ['appendectomy', 'Appendectomy'],
  ['gallbladder', 'Gallbladder Removal'], ['hysterectomy', 'Hysterectomy'],
  ['cataract', 'Cataract Surgery'], ['tonsil', 'Tonsillectomy'],
  ['c-section', 'C-Section'], ['hernia', 'Hernia Repair'],
  ['pacemaker', 'Pacemaker Placement'], ['stent', 'Stent Placement'],
];

/*
 * A named procedure is a surgery whether or not the note says the word.
 *
 * This used to be /surger(y|ies|ical)/ alone, which meant "Hip replacement
 * scheduled for October 4th" was not detected as a surgery at all — missing
 * from the appointments strip and from the digest that texts staff about the
 * week ahead. Building the pattern from the same list that names the procedure
 * keeps the two from drifting apart.
 */
export const SURGERY_RE = new RegExp(
  ['surger(?:y|ies|ical)', ...PROCEDURES.map(([needle]) =>
    needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))].join('|'),
  'i',
);


/*
 * Best-effort surgery type from care notes. Known procedures first (most
 * specific match wins), then "<body part> surgery", then "surgery on <part>".
 * Returns '' when nothing confident — never guesses from arbitrary words.
 */
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

/*
 * What kind of appointment, in the words a church would use.
 *
 * The mirror of extractSurgeryType. APPT_RE already knows the vocabulary well
 * enough to decide that a sentence IS an appointment; this decides what to call
 * it, so a card can say "Cardiology" or "Dialysis" instead of "Appointment"
 * four times over.
 *
 * Ordered most specific first: "chemo appointment" is Chemotherapy, not a
 * generic appointment, and a named specialty beats "follow-up" in the same
 * sentence.
 */
const APPT_KINDS: [RegExp, string][] = [
  // Treatments — the ones people most want to see named
  [/\bchemo(?:therapy)?\b/, 'Chemotherapy'],
  [/\bradiation\b/, 'Radiation'],
  [/\bdialysis\b/, 'Dialysis'],
  [/\binfusion\b/, 'Infusion'],
  [/\btransfusion\b/, 'Transfusion'],
  // Tests and imaging
  [/\bmri\b/, 'MRI'],
  [/\b(?:ct|cat)\s*scan\b/, 'CT Scan'],
  [/\bpet\s*scan\b/, 'PET Scan'],
  [/\bx[- ]?ray\b/, 'X-ray'],
  [/\bultrasound\b|\bsonogram\b/, 'Ultrasound'],
  [/\bmammogram?\b/, 'Mammogram'],
  [/\bcolonoscopy\b/, 'Colonoscopy'],
  [/\bendoscopy\b/, 'Endoscopy'],
  [/\bbiopsy\b/, 'Biopsy'],
  [/\bstress test\b/, 'Stress Test'],
  [/\becho(?:cardiogram)?\b/, 'Echocardiogram'],
  [/\bblood\s?work\b|\blab\s?work\b/, 'Bloodwork'],
  // Specialists
  [/\bcardiolog/, 'Cardiology'],
  [/\boncolog/, 'Oncology'],
  [/\bneurolog/, 'Neurology'],
  [/\bdermatolog/, 'Dermatology'],
  [/\borthoped/, 'Orthopedics'],
  [/\burolog/, 'Urology'],
  [/\bgastroenterolog/, 'Gastroenterology'],
  [/\bnephrolog/, 'Nephrology'],
  [/\bpulmonolog/, 'Pulmonology'],
  [/\brheumatolog/, 'Rheumatology'],
  [/\bendocrinolog/, 'Endocrinology'],
  [/\bophthalmolog|\boptometr/, 'Eye Doctor'],
  [/\bpodiatr/, 'Podiatry'],
  [/\bdentist|\bdental\b|\borthodont/, 'Dentist'],
  [/\bphysical therap/, 'Physical Therapy'],
  [/\btherap/, 'Therapy'],
  // Generic shapes, last
  [/\bpre[- ]?op\b/, 'Pre-op'],
  [/\bpost[- ]?op\b/, 'Post-op'],
  [/\bfollow[- ]?up\b/, 'Follow-up'],
  [/\bcheck[- ]?up\b/, 'Check-up'],
  [/\bconsult/, 'Consultation'],
];

export function extractApptType(notes = '') {
  const s = String(notes).toLowerCase();
  for (const [re, label] of APPT_KINDS) if (re.test(s)) return label;
  return '';
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
  // `relative` dates re-resolve against whatever "now" is. Fine on screen,
  // dangerous for a daily job: a note saying "today" would fire every morning
  // forever, so callers must decide whether the note is still fresh.
  let m = s.match(/\b(today|tonight|this (?:morning|afternoon|evening))\b/i);
  if (m) return { date: isoDay(day0(now)), idx: m.index, len: m[0].length, relative: true };
  m = s.match(/\btomorrow\b/i);
  if (m) return { date: isoDay(new Date(day0(now).getTime() + 864e5)), idx: m.index, len: m[0].length, relative: true };

  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
  if (m && +m[2] >= 1 && +m[2] <= 31) {
    const d = resolveMonthDay(MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2], now, m[3] ? +m[3] : null);
    return { date: isoDay(d), idx: m.index, len: m[0].length };
  }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    return { date: isoDay(resolveMonthDay(+m[1] - 1, +m[2], now, m[3] ? +m[3] : null)), idx: m.index, len: m[0].length };
  }
  m = s.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (m) {
    const want = WEEKDAYS.indexOf(m[1].toLowerCase());
    const base = day0(now);
    let ahead = (want - base.getDay() + 7) % 7;
    if (/next\s/i.test(m[0])) ahead += 7;   // "next Tuesday" = the following week
    return { date: isoDay(new Date(base.getTime() + ahead * 864e5)), idx: m.index, len: m[0].length, relative: true };
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
/*
 * Where an event happens, from "... at Emory", "at St. Francis Hospital".
 * Only capitalised runs count, so "at 9:45AM" and "at 3 pm" are never places,
 * and the run stops at the first lower-case word ("at Emory to discuss" -> Emory).
 */
const PLACE_STOP = /^(?:the|a|an|to|for|with|on|in|at|and|or|about|regarding)$/i;

export function extractPlace(text) {
  const m = String(text || '')
    .match(/\bat\s+(?:the\s+)?((?:[A-Z][\w'&.\-]*)(?:\s+[A-Z][\w'&.\-]*){0,3})/);
  if (!m) return '';
  const words = m[1].split(/\s+/).filter(w => !PLACE_STOP.test(w));
  // A bare month/weekday after "at" is a date, not a place.
  const first = (words[0] || '').toLowerCase().slice(0, 3);
  if (!words.length || MONTHS[first] !== undefined || WEEKDAYS.some(d => d.startsWith(first))) return '';
  return words.join(' ').replace(/[.,;]+$/, '');
}

/* The member's own recorded location — hospital, plus room when known. */
export function memberPlace(member) {
  return [member?.hospital_name, member?.room_number ? `Rm ${member.room_number}` : '']
    .filter(Boolean).join(' ').trim();
}

/* Every date in a stretch of text, left to right. */
function allDates(text, now) {
  const out = [];
  const s = String(text);
  let offset = 0;
  while (offset < s.length) {
    const found = parseDateWithIndex(s.slice(offset), now);
    if (!found) break;
    out.push({ ...found, idx: found.idx + offset });
    offset += found.idx + Math.max(found.len || 1, 1);
  }
  return out;
}

/* Where one clause ends and the next begins. */
const CONNECTOR = /,\s+and\s+|\s+and\s+|;\s*|,\s+then\s+|\s+then\s+|,\s+plus\s+|,\s+also\s+/gi;

/*
 * One sentence can hold two appointments on two days —
 *   "chemo on Monday, August 3, and will see an Orthopedic on Tuesday, August 4"
 * — and taking only the first date silently dropped the second. When a sentence
 * carries more than one date, cut it at the clause connector between them so
 * each date is read with its own procedure. Single-date sentences are returned
 * untouched, so nothing that already worked changes.
 */
function splitByDates(sentence, now) {
  const dates = allDates(sentence, now);
  if (dates.length < 2) return [sentence];

  const cuts = [];
  for (let i = 1; i < dates.length; i++) {
    const from = dates[i - 1].idx + (dates[i - 1].len || 1);
    const to = dates[i].idx;
    if (to <= from) continue;
    CONNECTOR.lastIndex = 0;
    const between = sentence.slice(from, to);
    const m = CONNECTOR.exec(between);          // first connector keeps the most context
    cuts.push(m ? from + m.index + m[0].length : Math.floor((from + to) / 2));
  }

  const parts = [];
  let start = 0;
  for (const c of cuts) { parts.push(sentence.slice(start, c)); start = c; }
  parts.push(sentence.slice(start));
  return parts.map(s => s.trim()).filter(Boolean);
}

export function extractCareEvents(member, now = new Date()) {
  const events = [];
  const seen = new Set();
  const push = (kind, date, time, snippet, place = '', relative = false, anchor = null) => {
    if (!date) return;
    // Two different times on one day are two different events. Keying on date
    // alone dropped the second, and dropped a note's time when the structured
    // surgery_date (which has no time) was pushed first.
    const key = `${kind}|${date}|${time?.minutes ?? 'none'}`;
    if (seen.has(key)) return;
    const untimed = events.find(e => e.kind === kind && e.date === date && !e.time);
    if (time && untimed) {                       // same event, now with a time
      untimed.time = time;
      if (!untimed.place) untimed.place = place;
      seen.add(key);
      return;
    }
    seen.add(key);
    // `anchor` is when the words were written — what a freshness check must
    // judge, rather than when the member record was last touched.
    /* What to call it on screen. Falls back to the bare kind so a card is never
       blank, and prefers the structured surgery_type when the note itself does
       not name the procedure. */
    const label = kind === 'Surgery'
      ? (extractSurgeryType(snippet) || String(member.surgery_type || '').trim() || 'Surgery')
      : (extractApptType(snippet) || 'Appointment');
    events.push({ kind, date, time, snippet, place, relative, anchor, label });
  };

  if (member.surgery_date) {
    const bits = [member.surgery_type, member.hospital_name ? `at ${member.hospital_name}` : '']
      .filter(Boolean).join(' ');
    push('Surgery', member.surgery_date, null, bits || 'Scheduled surgery', memberPlace(member));
  }

  /*
   * `when` anchors relative wording. "Surgery tomorrow" means the day after the
   * note was WRITTEN, not the day after whenever the page happens to render —
   * anchoring to render time made such an event walk forward a day at a time
   * and never arrive.
   */
  const scan = (text: any, when: any) => {
  // Mask abbreviation periods (Dr., Mrs., …) so they don't end a sentence.
  const notes = String(text || '')
    .replace(/\b(dr|mr|mrs|ms|rev|jr|sr|st)\./gi, (mm) => mm.slice(0, -1) + '\u0001');
  const now = when;
  for (const raw of notes.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.replace(/\u0001/g, '.').trim();
    if (!sentence) continue;
    // A sentence naming two dates holds two events; one date is left whole.
    let carried = null;                       // kind from an earlier clause
    for (const clause of splitByDates(sentence, now)) {
    const surgIdx = clause.search(SURGERY_RE);
    const apptIdx = clause.search(APPT_RE);
    const found = parseDateWithIndex(clause, now);
    if (!found) continue;
    // "chemo on Monday and Tuesday" — the second clause has the date but the
    // procedure was named once, in the first. Carry it rather than lose the day.
    if (surgIdx < 0 && apptIdx < 0) {
      if (!carried) continue;
      push(carried, found.date, parseTimeFrom(clause),
        clause.replace(/\s+/g, ' ').slice(0, 110),
        extractPlace(clause) || (carried === 'Surgery' ? memberPlace(member) : ''),
        found.relative === true, when);
      continue;
    }
    // Double wording ("appointment ... to discuss surgeries"): the keyword
    // nearest the date names the event — that sentence is an appointment,
    // while "pre-op MRI then knee surgery on Friday" stays a surgery.
    let kind;
    if (surgIdx >= 0 && apptIdx >= 0) {
      // Talking ABOUT a surgery (discuss/about/scheduling it) is an appointment;
      // otherwise the keyword nearest the date names the event.
      const discussion = /\b(discuss|about|regarding|schedul|plan|date of|options)/i.test(clause);
      kind = discussion || Math.abs(apptIdx - found.idx) <= Math.abs(surgIdx - found.idx)
        ? 'Appointment' : 'Surgery';
    } else {
      kind = surgIdx >= 0 ? 'Surgery' : 'Appointment';
    }
    // A surgery with no named venue happens where they're admitted; an
    // appointment could be anywhere, so never guess one.
    carried = kind;
    push(kind, found.date, parseTimeFrom(clause),
      clause.replace(/\s+/g, ' ').slice(0, 110),
      extractPlace(clause) || (kind === 'Surgery' ? memberPlace(member) : ''),
      found.relative === true, when);
    }
  }
  };

  /* The profile's own notes. Their best available timestamp is the record's
     last edit — closer to when the words were typed than "now" is. */
  scan(member.care_notes, member.updated_at ? new Date(member.updated_at) : now);

  /*
   * Contact logs — this is how a texted update reaches the calendar. A staff
   * text about someone already in care is filed as a log, not into care_notes,
   * so scanning only the profile meant "Surgery tomorrow" never showed up here.
   * Each log is read against its own created_at.
   */
  for (const log of member.contact_logs || []) {
    scan(log?.notes, log?.created_at ? new Date(log.created_at) : now);
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
