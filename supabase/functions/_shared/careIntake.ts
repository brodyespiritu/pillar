/*
 * Turning a staff text into a care record.
 *
 * "Susie is in hospital because she broke her wrist"
 *   -> person: Susie Grant (matched against people we already know)
 *   -> category: Hospitalized
 *   -> notes: "in hospital because she broke her wrist"
 *
 * The name is resolved by matching against the actual directory rather than by
 * parsing English grammar. Grammar-based extraction breaks on every phrasing a
 * real person uses; matching known names does not, and it can only ever produce
 * someone who genuinely exists.
 *
 * Pure functions only — no network — so the whole decision path is testable.
 */

/* Kept in step with CATEGORIES in src/lib/care.js — the app offers fourteen and
   a record texted in has to be filable as any of them. */
export const CATEGORIES = [
  'Hospitalized', 'Grieving', 'New Member', 'Homebound', 'Crisis',
  'Pain', 'Sick', 'Cancer', 'Prayer Request', 'Follow Up', 'Surgery',
  'Test/Treatment', 'Recovering', 'Other',
];

/* Ordered: the first match wins, so specific beats general. "surgery at the
   hospital" is Surgery, not Hospitalized. */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['Grieving',       /passed away|passed on|died|death of|funeral|memorial service|lost (?:her|his|their) /i],
  ['Surgery',        /surger|operat(?:ion|ing)|going under the knife|procedure to/i],
  /* The diagnosis, not the appointment: "chemo Tuesday" is still Test/Treatment,
     but naming the disease files it under the disease. */
  ['Cancer',         /\bcancer\b|\boncolog|\btumou?rs?\b|\bmalignan|\bleukemia\b|\blymphoma\b|\bcarcinoma\b|\bmetasta/i],
  ['Test/Treatment', /chemo|radiation|dialysis|biopsy|\bscan\b|\bmri\b|\bct\b|x-?ray|blood work|lab work|treatment|infusion/i],
  ['Hospitalized',   /hospital|admitted|icu\b|\ber\b|emergency room|ambulance/i],
  ['Recovering',     /recover|rehab|physical therapy|healing|discharged|home from/i],
  ['Homebound',      /homebound|shut[- ]?in|can'?t get out|housebound/i],
  ['Crisis',         /crisis|urgent|critical|emergency|life support|hospice/i],
  ['Pain',           /\bin pain|hurting|aching|severe pain/i],
  ['Sick',           /\bsick|\bill\b|\billness|\bflu\b|covid|pneumonia|infection|fever|stroke|heart attack|brok(?:e|en)|fracture|injur|\bfell\b|\bwreck|accident/i],
  ['Follow Up',      /follow[- ]?up|check(?:ing)? in on|touch base/i],
  ['Prayer Request', /pray|prayer|lift (?:her|him|them) up/i],
];

/* Does this text look like it is reporting a care situation at all? Keeps the
   system silent on "thanks" and "got it" instead of interrogating people. */
export const CARE_SIGNAL = new RegExp(
  CATEGORY_RULES.map(([, re]) => re.source).join('|')
  + '|brok(?:e|en)|\\bfell\\b|\\bfall\\b|injur|\\bwreck|accident|diagnos|\\bhurt',
  'i',
);

export function inferCategory(text: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Other';
}

/* Hospitalized/Crisis/Grieving get eyes on them sooner. */
export function inferPriority(category: string, text: string): string {
  if (/critical|icu\b|life support|hospice|emergency/i.test(text)) return 'High';
  if (['Crisis', 'Grieving', 'Hospitalized', 'Surgery'].includes(category)) return 'High';
  if (['Prayer Request', 'Follow Up', 'Recovering'].includes(category)) return 'Low';
  return 'Medium';
}

export const norm = (s: string) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/*
 * Words that are also first names. A first-name-only match on one of these is
 * ignored unless it is capitalised in the original text, so "the bill is due"
 * doesn't open a care record on Bill.
 */
const AMBIGUOUS_NAMES = new Set([
  'bill', 'will', 'grace', 'faith', 'hope', 'joy', 'rose', 'may', 'june',
  'art', 'mark', 'rob', 'sue', 'dawn', 'don', 'frank', 'pat', 'gene', 'earl',
]);

export type Person = { id: string; name: string; source: 'care' | 'member' };
export type Match = { person: Person; how: 'full' | 'first'; index: number };

/*
 * Every known person whose name appears in the text.
 * A full-name hit always beats a first-name hit, so "Susie Grant" is not also
 * reported as an ambiguous "Susie".
 */
export function findPeople(text: string, people: Person[]): Match[] {
  const hay = ` ${norm(text)} `;
  const capitalised = new Set(
    (text.match(/\b[A-Z][a-z'’-]+/g) || []).map(w => norm(w)),
  );

  const full: Match[] = [];
  const first: Match[] = [];

  for (const p of people) {
    const parts = norm(p.name).split(' ').filter(Boolean);
    if (!parts.length) continue;

    const whole = parts.join(' ');
    const at = hay.indexOf(` ${whole} `);
    if (parts.length > 1 && at >= 0) { full.push({ person: p, how: 'full', index: at }); continue; }

    // First name alone — only when it is capitalised where it appears.
    const fn = parts[0];
    const fAt = hay.indexOf(` ${fn} `);
    if (fAt >= 0 && capitalised.has(fn) && !(AMBIGUOUS_NAMES.has(fn) && parts.length === 1)) {
      first.push({ person: p, how: 'first', index: fAt });
    }
  }

  if (full.length) return dedupe(full);
  return dedupe(first);
}

function dedupe(ms: Match[]): Match[] {
  const seen = new Set<string>();
  return ms
    .filter(m => (seen.has(m.person.id) ? false : (seen.add(m.person.id), true)))
    .sort((a, b) => a.index - b.index);
}

/*
 * The situation, with the person's name and connective filler stripped, so the
 * care note reads "broke her wrist" rather than repeating the whole text.
 */
export function extractNotes(text: string, personName = ''): string {
  let s = String(text || '').trim().replace(/\s+/g, ' ');
  const parts = String(personName || '').split(/\s+/).filter(Boolean);
  const whole = parts.join('\\s+');
  // Try the full name, then the first name alone — texts usually use just one.
  if (whole) s = s.replace(new RegExp(`\\b${whole}\\b`, 'ig'), ' ');
  if (parts[0]) s = s.replace(new RegExp(`\\b${parts[0]}\\b`, 'ig'), ' ');
  s = s.replace(/\s+/g, ' ').trim();

  s = s
    .replace(/^(?:hey|hi|hello|fyi|just so you know|heads up|please note)\b[,: ]*/i, '')
    .replace(/^(?:'s|s)\b/i, '')
    .replace(/^(?:is|was|has been|has|had|will be|got|went|just)\b\s*/i, '')
    .replace(/^(?:please\s+)?(?:pray|praying)\s+for\b\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:.\-\s]+/, '')
    .trim();

  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(text || '').trim();
}

export type Decision =
  | { kind: 'ignore'; why: string }
  | { kind: 'ask_person'; notes: string; category: string }
  | { kind: 'ask_choice'; options: Person[]; notes: string; category: string }
  | { kind: 'ask_reason'; person: Person }
  | { kind: 'update'; person: Person; notes: string; category: string }
  | { kind: 'create'; person: Person | null; name: string; notes: string; category: string; priority: string };

/*
 * What to do with one inbound message. Never acts on a message that names
 * nobody and describes nothing — silence is correct for "thanks".
 */
export function decide(text: string, people: Person[]): Decision {
  const body = String(text || '').trim();
  if (!body) return { kind: 'ignore', why: 'empty' };

  const matches = findPeople(body, people);
  const signal = CARE_SIGNAL.test(body);

  if (!matches.length && !signal) return { kind: 'ignore', why: 'no person, no care signal' };

  const category = inferCategory(body);

  // Named somebody we don't know, or nobody at all, but clearly reporting something.
  if (!matches.length) {
    return { kind: 'ask_person', notes: extractNotes(body), category };
  }

  if (matches.length > 1) {
    return { kind: 'ask_choice', options: matches.map(m => m.person), notes: extractNotes(body), category };
  }

  const person = matches[0].person;
  const notes = extractNotes(body, person.name);

  // A bare name with no situation — ask rather than filing an empty record.
  if (!signal && notes.length < 3) return { kind: 'ask_reason', person };

  if (person.source === 'care') return { kind: 'update', person, notes, category };
  return { kind: 'create', person, name: person.name, notes, category, priority: inferPriority(category, body) };
}
