import { supabase } from './supabase';

export const STATUSES = ['Active', 'Inactive'];

/* ── Personal-information option lists ── */
export const FAMILY_POSITIONS = ['Head', 'Spouse', 'Child', 'Other'];
export const GENDERS = ['Male', 'Female'];
export const MARITAL_STATUSES = ['Single', 'Married', 'Widowed', 'Divorced', 'Separated'];
export const MEMBER_STATUSES = ['Member', 'Regular Attender', 'Visitor', 'Inactive'];
export const RECORD_TYPES = ['Member', 'Visitor', 'Prospect'];
export const JOINED_HOW_OPTIONS = ['Statement', 'Baptism', 'Transfer', 'Profession of Faith', 'Other'];

/* Order family members so the head comes first, then spouse, then children. */
const FAMILY_ORDER = { head: 0, spouse: 1, child: 2, other: 3 };

/* Format a date value as MM/DD/YYYY without timezone drift. */
export function fmtMDY(d) {
  if (!d) return null;
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const x = new Date(d);
  if (isNaN(x)) return null;
  return `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()}`;
}

/* Whole-years age from a birthday (YYYY-MM-DD or Date-parseable). */
export function ageFromBirthday(b) {
  if (!b) return null;
  const s = String(b);
  let y, mo, d;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { const x = new Date(b); if (isNaN(x)) return null; y = x.getFullYear(); mo = x.getMonth() + 1; d = x.getDate(); }
  const now = new Date();
  let age = now.getFullYear() - y;
  const mDiff = (now.getMonth() + 1) - mo;
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/* Household key — the import's family_id if present, else the free-text name. */
const familyKey = r => (r.family_id || '').trim() || (r.family_name || '').trim().toLowerCase();

/* Everyone else in the same household, head-first. */
export function familyMembers(rows, member) {
  const key = familyKey(member);
  if (!key) return [];
  return rows
    .filter(r => r.id !== member.id && familyKey(r) === key)
    .sort((a, b) => {
      const pa = FAMILY_ORDER[(a.family_position || 'other').toLowerCase()] ?? 3;
      const pb = FAMILY_ORDER[(b.family_position || 'other').toLowerCase()] ?? 3;
      return pa - pb || (a.name || '').localeCompare(b.name || '');
    });
}

/* ── CSV import ── */

/* Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas,
   escaped quotes ("") and \r\n / \n line endings. Returns array of rows. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore, handled by \n */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Map a parsed CSV (Realm "Individual List" export) to church_members rows.
   Keyed by header name, so column order can vary. */
export function mapIndividualList(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name.toLowerCase());
  const col = {
    id: idx('Individual Id'), label: idx('Label'), first: idx('First Name'), last: idx('Last Name'),
    email: idx('Primary Email'), phone: idx('Primary Phone Number'), family: idx('Family Id'),
    deceased: idx('Date Marked Deceased'),
    a1: idx('Mailing Address 1'), a2: idx('Mailing Address 2'), city: idx('Mailing City'),
    region: idx('Mailing Region'), postal: idx('Mailing Postal Code'),
  };
  const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');

  const out = [];
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n];
    if (!r || r.every(v => !String(v || '').trim())) continue; // skip blank lines
    const first = get(r, col.first), last = get(r, col.last);
    const name = get(r, col.label) || [first, last].filter(Boolean).join(' ').trim();
    if (!name) continue;

    const street = [get(r, col.a1), get(r, col.a2)].filter(Boolean).join(', ');
    const cityLine = [get(r, col.city), [get(r, col.region), get(r, col.postal)].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    const address = [street, cityLine].filter(Boolean).join(', ');
    const deceased = !!get(r, col.deceased);

    out.push({
      external_id: get(r, col.id) || null,
      name,
      email: get(r, col.email) || null,
      phone: get(r, col.phone) || null,
      address: address || null,
      family_id: get(r, col.family) || null,
      family_name: last ? `${last} Family` : null,
      active: !deceased,
      status: deceased ? 'Inactive' : 'Active',
    });
  }
  return out;
}

/* Bulk import via the admin-only edge function; returns confirmed DB counts. */
export async function importMembers(rows) {
  const { data, error } = await supabase.functions.invoke('admin-import-members', { body: { rows } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep default */ }
    return { error: { message: msg } };
  }
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function fetchChurchMembers() {
  const { data, error } = await supabase.from('church_members').select('*').order('name');
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}

export async function saveChurchMember(member) {
  const payload = { ...member };
  if (payload.birthday === '') payload.birthday = null;
  if (payload.date_joined === '') payload.date_joined = null;
  if (member.id) {
    const { data, error } = await supabase.from('church_members').update(payload).eq('id', member.id).select().single();
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase.from('church_members').insert(payload).select().single();
  return { data, error };
}

export async function deleteChurchMember(id) {
  return supabase.from('church_members').delete().eq('id', id);
}

/*
 * Attach a person to a ministry on their member profile.
 * Matches an existing member by name (case-insensitive); if none exists,
 * creates one. The ministry is added to the member's `tags` (dedup'd),
 * which is what the Members page shows under "Groups".
 * Returns the up-to-date member row (or { error }).
 */
export async function attachMinistry(name, ministry) {
  const clean = (name || '').trim();
  if (!clean) return { error: new Error('Name is required.') };

  const { data: existing } = await supabase
    .from('church_members').select('*').ilike('name', clean).limit(1);
  const member = existing?.[0];

  if (member) {
    const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.some(t => t.toLowerCase() === ministry.toLowerCase())) tags.push(ministry);
    const { data, error } = await supabase.from('church_members')
      .update({ tags: tags.join(', ') }).eq('id', member.id).select().single();
    return { data, error, created: false };
  }

  const { data, error } = await supabase.from('church_members')
    .insert({ name: clean, tags: ministry, status: 'Active' }).select().single();
  return { data, error, created: true };
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

/* Read an image file, downscale/crop to a square thumbnail, return a compact JPEG data URI */
export function fileToAvatarDataUrl(file, size = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // center-crop to a square, then scale to `size`
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('That image could not be loaded.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
