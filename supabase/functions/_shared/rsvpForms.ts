/*
 * RSVP forms — the rules both sides share.
 *
 * The staff page builds a form out of fields; the public page at bethesda.rsvp
 * renders them; the rsvp-forms edge function checks every answer again before
 * saving. One file, imported by the browser and by Deno, so the three can never
 * disagree about what a valid phone number or a required field is.
 *
 * Pure functions only.
 */

export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea';
export type FieldKey = 'first_name' | 'last_name' | 'email' | 'phone' | 'count';
export type FormField = { id: string; type: FieldType; label: string; required: boolean; key?: FieldKey };

export const LIMITS = { fields: 20, label: 80, title: 120, description: 600 };

export const FIELD_TYPES: Record<FieldType, { name: string; max: number }> = {
  text:     { name: 'Short answer', max: 200 },
  textarea: { name: 'Long answer',  max: 1000 },
  email:    { name: 'Email',        max: 254 },
  phone:    { name: 'Phone',        max: 20 },
  number:   { name: 'Number',       max: 3 },
};

/* The fields most sign-ups start with, one tap each on the staff page. */
export const PRESETS: Array<Omit<FormField, 'id'>> = [
  { key: 'first_name', type: 'text',   label: 'First name',          required: true },
  { key: 'last_name',  type: 'text',   label: 'Last name',           required: true },
  { key: 'email',      type: 'email',  label: 'Email',               required: false },
  { key: 'phone',      type: 'phone',  label: 'Phone number',        required: false },
  { key: 'count',      type: 'number', label: 'How many are coming', required: false },
];

const TYPES = new Set(Object.keys(FIELD_TYPES));
const KEYS = new Set(['first_name', 'last_name', 'email', 'phone', 'count']);

/* Short random ids and link tokens. Browsers and Deno both have crypto. */
export function randomToken(length = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

const oneLine = (s: unknown) => String(s ?? '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();

/*
 * A form's fields as staff saved them, made safe to render and to check against:
 * known types only, a label on every field, unique ids, no more than the limit.
 */
export function cleanFields(raw: unknown): FormField[] {
  const seen = new Set<string>();
  const out: FormField[] = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    const type = TYPES.has(f?.type) ? f.type as FieldType : 'text';
    const label = oneLine(f?.label).slice(0, LIMITS.label);
    if (!label) continue;
    let id = String(f?.id ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || randomToken(8);
    while (seen.has(id)) id = randomToken(8);
    seen.add(id);
    const key = KEYS.has(f?.key) ? f.key as FieldKey : undefined;
    out.push({ id, type, label, required: f?.required === true, ...(key ? { key } : {}) });
    if (out.length >= LIMITS.fields) break;
  }
  return out;
}

export const phoneDigits = (s: unknown) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};
export const formatPhone = (s: unknown) => {
  const d = phoneDigits(s);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(s ?? '');
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/*
 * Every answer checked against its field. Returns the cleaned values, keyed by
 * field id, and a message per field that needs fixing — worded for the person
 * filling it in, not for staff.
 */
export function validateAnswers(fields: FormField[], raw: unknown) {
  const input = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const f of fields) {
    const given = input[f.id];
    const max = FIELD_TYPES[f.type].max;
    let v = f.type === 'textarea'
      ? String(given ?? '').replace(/[<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      : oneLine(given);

    if (!v) {
      if (f.required) errors[f.id] = `Please fill in ${f.label.toLowerCase()}.`;
      continue;
    }

    if (f.type === 'email') {
      v = v.toLowerCase();
      if (v.length > max || !EMAIL_RE.test(v)) { errors[f.id] = 'Please enter a valid email address.'; continue; }
    } else if (f.type === 'phone') {
      if (phoneDigits(v).length !== 10) { errors[f.id] = 'Please enter a 10-digit phone number.'; continue; }
      v = formatPhone(v);
    } else if (f.type === 'number') {
      if (!/^\d{1,3}$/.test(v)) { errors[f.id] = 'Please enter a whole number.'; continue; }
      v = String(Number(v));
    } else if (v.length > max) {
      errors[f.id] = `Please keep this under ${max} characters.`;
      continue;
    }
    values[f.id] = v;
  }
  return { values, errors };
}

/* Name, phone and email pulled out for the responses list and the text. */
export function summarize(fields: FormField[], values: Record<string, string>) {
  const byKey = (k: FieldKey) => {
    const f = fields.find(x => x.key === k);
    return f ? (values[f.id] || '') : '';
  };
  const firstPhone = fields.find(f => f.type === 'phone' && values[f.id]);
  const firstEmail = fields.find(f => f.type === 'email' && values[f.id]);
  return {
    name: [byKey('first_name'), byKey('last_name')].filter(Boolean).join(' '),
    phone: byKey('phone') || (firstPhone ? values[firstPhone.id] : ''),
    email: byKey('email') || (firstEmail ? values[firstEmail.id] : ''),
  };
}

/*
 * The text a linked person receives about one response: the form's name, then
 * every answer given. Name, phone and email lead without labels, the way anyone
 * writes a contact down; everything else is "Question: answer".
 */
export function noticeText(title: string, fields: FormField[], values: Record<string, string>) {
  const who = summarize(fields, values);
  const lines: string[] = [];
  if (who.name) lines.push(who.name);
  if (who.phone) lines.push(who.phone);
  if (who.email) lines.push(who.email);
  for (const f of fields) {
    const v = values[f.id];
    if (!v) continue;
    if (f.key === 'first_name' || f.key === 'last_name') continue;
    if (v === who.phone || v === who.email) continue;
    lines.push(`${f.label}: ${v.replace(/\s+/g, ' ')}`);
  }
  if (!lines.length) lines.push('(no answers given)');
  return { header: `New RSVP - ${oneLine(title)}`, lines };
}
