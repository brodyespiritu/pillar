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

/*
 * No-year dates resolve to the nearest sensible occurrence: this year, unless
 * that day passed more than a week ago — then next year. Past tense turns it
 * round: "had surgery on Dec 28", written Jan 2, is last year's December.
 */
function resolveMonthDay(mo: number, dayNum: number, now: Date, year: number | null, past = false) {
  if (year) return new Date(year < 100 ? 2000 + year : year, mo, dayNum);
  const cand = new Date(now.getFullYear(), mo, dayNum);
  const daysAgo = (+day0(now) - +cand) / 864e5;
  if (past) return daysAgo < -7 ? new Date(now.getFullYear() - 1, mo, dayNum) : cand;
  return daysAgo > 7 ? new Date(now.getFullYear() + 1, mo, dayNum) : cand;
}

/*
 * Month names spelled out or abbreviated — whole words only. The prefix alone
 * used to count, so "Marcus 3" read as March 3 and "separate 2" as September 2.
 */
const MONTH_WORD = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY_WORD = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';

/* Wording that puts what it describes in the past. */
export const PAST_RE = /\b(had|has had|underwent|went|came home|was seen|was released|got out|did|completed)\b/i;

/*
 * Every date mentioned in the text, left to right, each with where it sits and
 * whether it is relative ("today", "Tuesday") — resolved against `now`, the
 * moment the words were written.
 *
 * All of them, not the first rule that matches. Checking "today" before anything
 * else meant "surgery on Sept 22 — doing well today" put the surgery on today.
 */
function dateCandidates(text: unknown, now: Date = new Date(), past = false) {
  const s = String(text);
  const base = day0(now);
  const out: { idx: number; len: number; date: string; relative: boolean }[] = [];
  const add = (idx: number, len: number, date: Date, relative: boolean) => out.push({ idx, len, date: isoDay(date), relative });
  let m: RegExpExecArray | null;

  const REL = /\b(today|tonight|this (?:morning|afternoon|evening))\b|\b(tomorrow)\b|\b(yesterday|last night)\b/gi;
  while ((m = REL.exec(s))) {
    const shift = m[1] ? 0 : m[2] ? 1 : -1;
    add(m.index, m[0].length, new Date(base.getTime() + shift * 864e5), true);
  }

  /* "Wednesday, September 23" is one date; the weekday rides along with it. */
  const MD = new RegExp(String.raw`\b(?:${WEEKDAY_WORD},?\s+)?${MONTH_WORD}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?`, 'gi');
  while ((m = MD.exec(s))) {
    const day = +m[3];
    if (day < 1 || day > 31) continue;
    add(m.index, m[0].length, resolveMonthDay((MONTHS as Record<string, number>)[m[2].toLowerCase().slice(0, 3)], day, now, m[4] ? +m[4] : null, past), false);
  }

  const SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = SLASH.exec(s))) {
    const mo = +m[1], day = +m[2];
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    /* A score or a reading, not a date: "pain is 7/10", "rated her pain 8/10". */
    if (/\b(pain|scale|level|rated?|rating|score|pressure|bp|sugar|glucose|oxygen|o2)\b[^\d]{0,12}$/i.test(s.slice(Math.max(0, m.index - 24), m.index))) continue;
    /* A fraction: "3/4 of a mile", "1/2 a tablet". */
    if (!m[3] && /^(1\/2|1\/3|2\/3|1\/4|3\/4)$/.test(m[0])
        && /^\s+(of|a|an|cup|dose|mile|hour|tablet|pill|teaspoon|tsp)\b/i.test(s.slice(m.index + m[0].length))) continue;
    add(m.index, m[0].length, resolveMonthDay(mo - 1, day, now, m[3] ? +m[3] : null, past), false);
  }

  const WD = new RegExp(String.raw`\b(?:(next|last|this)\s+)?${WEEKDAY_WORD}\b`, 'gi');
  while ((m = WD.exec(s))) {
    const want = WEEKDAYS.indexOf(m[2].toLowerCase());
    const q = (m[1] || '').toLowerCase();
    let d: Date;
    if (q === 'last' || (!q && past)) {
      /* "had surgery Monday" is the Monday just gone, not the one coming. */
      let back = (base.getDay() - want + 7) % 7;
      if (q === 'last' && back === 0) back = 7;
      d = new Date(base.getTime() - back * 864e5);
    } else {
      let ahead = (want - base.getDay() + 7) % 7;
      /* "next Tuesday" is the Tuesday of next week: a week on when that day is
         still to come this week, the coming one when it has already passed. */
      if (q === 'next' && (ahead === 0 || want > base.getDay())) ahead += 7;
      d = new Date(base.getTime() + ahead * 864e5);
    }
    add(m.index, m[0].length, d, true);
  }

  /* Left to right; a date inside a longer one ("Tuesday" in "Tuesday, Sept 22") is dropped. */
  out.sort((a, b) => a.idx - b.idx || b.len - a.len);
  const kept: typeof out = [];
  for (const c of out) {
    const last = kept[kept.length - 1];
    if (last && c.idx < last.idx + last.len) continue;
    kept.push(c);
  }
  return kept;
}

/*
 * The date a stretch of text is about: its first written-out date if it has
 * one, otherwise its first relative one. `relative` dates re-resolve against
 * whatever "now" is — fine on screen, dangerous for a daily job, so callers
 * decide whether the words are still fresh.
 */
function parseDateWithIndex(text: unknown, now: Date = new Date(), past = false) {
  const found = dateCandidates(text, now, past);
  return found.find(c => !c.relative) || found[0] || null;
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
function allDates(text: unknown, now: Date) {
  return dateCandidates(text, now);
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
    if (m) { cuts.push(from + m.index + m[0].length); continue; }
    /*
     * No "and" or "then" between them: cut after the first comma or semicolon,
     * else at the space nearest the middle. Cutting at the exact middle split
     * words in half — "…September 23, the surgery will be on September 30" lost
     * the word "surgery" from its own half, and the surgery became an appointment.
     */
    const punct = between.search(/[,;]\s*/);
    if (punct >= 0) { cuts.push(from + punct + between.slice(punct).match(/^[,;]\s*/)[0].length); continue; }
    const mid = Math.floor(between.length / 2);
    const spaces = [...between.matchAll(/\s+/g)].map(x => x.index + x[0].length);
    const best = spaces.length ? spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : mid;
    cuts.push(from + best);
  }

  const parts = [];
  let start = 0;
  for (const c of cuts) { parts.push(sentence.slice(start, c)); start = c; }
  parts.push(sentence.slice(start));
  return parts.map(s => s.trim()).filter(Boolean);
}

/*
 * The church's wall clock at an instant, as a Date whose local getters read it.
 * A note's timestamp is an instant; "tomorrow" in it means the day after it was
 * written in Columbus. In an edge function (UTC) a note written at 9 PM Eastern
 * is already the next day, so without this the digest read it a day late.
 */
export function churchClock(instant: unknown, tz = 'America/New_York') {
  const d = instant instanceof Date ? instant : new Date(instant as string);
  if (Number.isNaN(d.getTime())) return new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  return new Date(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute);
}

/* A plan called off is not on the calendar. */
const CANCELLED_RE = /\bcancel(?:l?ed|s|ling)?\b|\bcalled off\b|\bno longer\b/i;
/* Before-surgery wording: the appointment that prepares for one. */
const PREOP_RE = /\bpre[- ]?op(?:erative)?\b|\bpre[- ]?surg|\bpre[- ]?admission|\bpre[- ]?testing/i;
/*
 * "will have testing for his surgery on the 23rd" — something done FOR a
 * surgery, on that date, is not the surgery. "is scheduled for surgery on the
 * 30th" and "will have surgery on the 30th" stay surgeries: neither has, gets or
 * sees something else for it.
 */
const FOR_SURGERY_RE = /\b(?:have|having|has|get|getting|go(?:ing)?\s+(?:in\s+)?for|see|seeing|meet(?:ing)?(?:\s+with)?|attend(?:ing)?|do|doing)\s+(?:[\w'’-]+\s+){0,5}?(?:for|before|ahead of|prior to)\s+(?:his|her|their|the|a|an|this|that|upcoming)?\s*(?:[\w'’-]+\s+)?surger(?:y|ies)\b/i;

export function extractCareEvents(member: any, now: Date = new Date()) {
  const events: any[] = [];
  const seen = new Set();
  /* `detail` is the whole sentence the event was read from. `snippet` is cut to
     fit a calendar card; a care text has room for all of it, and "Appointment -
     Details not given" beside a note that gives them is the thing to avoid.
     `source` says where it was read — the record's own field, the profile note,
     or a logged update — and `anchor` when those words were written. */
  const push = (kind: string, date: string, time: any, snippet: string, place = '', relative = false, anchor: Date | null = null, detail = '', source = 'log', labelOverride = '') => {
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
      if (detail && !String(untimed.detail || '').includes(detail)) {
        untimed.detail = [untimed.detail, detail].filter(Boolean).join(' ');
      }
      seen.add(key);
      return;
    }
    seen.add(key);
    /* What to call it on screen. Falls back to the bare kind so a card is never
       blank, and prefers the structured surgery_type when the note itself does
       not name the procedure. */
    const label = labelOverride || (kind === 'Surgery'
      ? (extractSurgeryType(snippet) || String(member.surgery_type || '').trim() || 'Surgery')
      : (extractApptType(snippet) || 'Appointment'));
    events.push({ kind, date, time, snippet, place, relative, anchor, label, detail: detail || snippet, source });
  };

  if (member.surgery_date) {
    const bits = [member.surgery_type, member.hospital_name ? `at ${member.hospital_name}` : '']
      .filter(Boolean).join(' ');
    /* Everything the record holds about it: what, who is operating, where. */
    const full = [
      member.surgery_type ? String(member.surgery_type).trim() : 'Surgery',
      member.surgeon_name ? `with ${String(member.surgeon_name).trim()}` : '',
      member.hospital_name ? `at ${String(member.hospital_name).trim()}` : '',
    ].filter(Boolean).join(' ');
    push('Surgery', member.surgery_date, null, bits || 'Scheduled surgery', memberPlace(member), false,
      member.updated_at ? new Date(member.updated_at) : null, full, 'record');
  }

  /*
   * `written` is the instant the words were written; dates are read on the
   * church's clock at that instant. "Surgery tomorrow" means the day after the
   * note was WRITTEN, not the day after whenever the page happens to render.
   *
   * `relativeOk` false ignores "today", "tomorrow" and bare weekdays and keeps
   * only written-out dates — for text whose writing time is not known.
   */
  const scan = (text: unknown, written: Date, source: string, relativeOk = true) => {
    const clock = churchClock(written);
    // Mask abbreviation periods (Dr., Mrs., …) so they don't end a sentence.
    const notes = String(text || '')
      .replace(/\b(dr|mr|mrs|ms|rev|jr|sr|st)\./gi, (mm) => mm.slice(0, -1) + '\u0001');
    for (const raw of notes.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.replace(/\u0001/g, '.').trim();
      if (!sentence) continue;
      // A sentence naming two dates holds two events; one date is left whole.
      let carried = null;                       // kind from an earlier clause
      for (const clause of splitByDates(sentence, clock)) {
        if (CANCELLED_RE.test(clause)) { carried = null; continue; }
        const past = PAST_RE.test(clause);
        const found = parseDateWithIndex(clause, clock, past);
        if (!found) continue;
        if (found.relative && !relativeOk) continue;

        const surgIdx = clause.search(SURGERY_RE);
        const apptHits = [clause.search(APPT_RE), clause.search(PREOP_RE)].filter(i => i >= 0);
        const apptIdx = apptHits.length ? Math.min(...apptHits) : -1;
        const preop = PREOP_RE.test(clause) || (surgIdx >= 0 && FOR_SURGERY_RE.test(clause));
        const place = (k: string) => extractPlace(clause) || (k === 'Surgery' ? memberPlace(member) : '');
        const snippet = clause.replace(/\s+/g, ' ').slice(0, 110);
        const detail = sentence.replace(/\s+/g, ' ');

        // "chemo on Monday and Tuesday" — the second clause has the date but the
        // procedure was named once, in the first. Carry it rather than lose the day.
        if (surgIdx < 0 && apptIdx < 0) {
          if (!carried) continue;
          /* "…surgery on Tuesday, doing well today" — a today or last night on its
             own is how someone is, not a second appointment. */
          if (found.relative && /today|tonight|this (?:morning|afternoon|evening)|yesterday|last night/i
            .test(clause.substr(found.idx, found.len))) continue;
          push(carried, found.date, parseTimeFrom(clause), snippet, place(carried), found.relative === true, written, detail, source);
          continue;
        }

        let kind;
        if (preop) {
          kind = 'Appointment';
        } else if (surgIdx >= 0 && apptIdx >= 0) {
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
        push(kind, found.date, parseTimeFrom(clause), snippet, place(kind), found.relative === true, written, detail, source,
          preop ? 'Pre-op appointment' : '');
      }
    }
  };

  /*
   * The profile's own note. Its words carry no timestamp of their own: the
   * record's updated_at moves with every edit, so reading "tomorrow" against it
   * put a months-old "surgery tomorrow" on the day after whoever last changed
   * the phone number — and the digest announced it. Written-out dates are read
   * against when the record was created, which is only used to settle the year.
   * Day words count only while the record has never been edited, when the note
   * and the record were written together.
   */
  const created = member.created_at ? new Date(member.created_at) : null;
  const edited = member.updated_at ? new Date(member.updated_at) : null;
  const neverEdited = !!created && (!edited || Math.abs(+edited - +created) < 120_000);
  scan(member.care_notes, created || edited || now, 'profile', neverEdited);

  /*
   * Contact logs — this is how a texted update reaches the calendar. A staff
   * text about someone already in care is filed as a log, not into care_notes,
   * so scanning only the profile meant "Surgery tomorrow" never showed up here.
   * Each log is read against its own created_at.
   */
  for (const log of member.contact_logs || []) {
    scan(log?.notes, log?.created_at ? new Date(log.created_at) : now, 'log');
  }

  /*
   * A newer word on a surgery replaces an older date for it. When the latest
   * update to give a surgery date says October 14, an earlier "September 30"
   * that had not yet arrived when that update was written is no longer the
   * plan. Dates already past at that point stay: they are history.
   */
  const surgeryLogs = events.filter(e => e.kind === 'Surgery' && e.source === 'log' && e.anchor);
  if (surgeryLogs.length) {
    const newest = Math.max(...surgeryLogs.map(e => +e.anchor));
    const current = new Set(surgeryLogs.filter(e => +e.anchor === newest).map(e => e.date));
    const writtenDay = isoDay(churchClock(new Date(newest)));
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind !== 'Surgery' || current.has(e.date)) continue;
      const older = !e.anchor || +e.anchor < newest;
      if (older && e.date > writtenDay) events.splice(i, 1);
    }
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
