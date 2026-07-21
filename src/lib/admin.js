import { supabase } from './supabase';

/* ── Roles ── */
export const ROLES = ['Admin', 'Coordinator', 'Staff', 'Viewer'];
export const ROLE_COLORS = {
  Admin:       '#8B5CF6',
  Coordinator: '#3B82F6',
  Staff:       '#10B981',
  Viewer:      '#6B7280',
};
export const roleColor = r => ROLE_COLORS[normalizeRole(r)] || '#6B7280';
export function normalizeRole(r) {
  if (!r) return 'Staff';
  const s = String(r).toLowerCase();
  if (s.includes('admin')) return 'Admin';
  if (s.includes('coord')) return 'Coordinator';
  if (s.includes('view'))  return 'Viewer';
  return 'Staff';
}

/* ── Staff ── */
export async function fetchStaff() {
  const { data } = await supabase.from('staff').select('*').order('name');
  return data || [];
}
export async function updateStaff(id, patch) {
  return supabase.from('staff').update(patch).eq('id', id).select().single();
}
export async function removeStaff(id) {
  return supabase.from('staff').delete().eq('id', id);
}
export async function resetPin(id, pin) {
  // Server-side: hashes the PIN into staff_pins; the hash never touches the client.
  return supabase.rpc('admin_set_pin', { target: id, input: pin });
}

/* ── Add a new user (auth login + staff row) via edge function ── */
export async function createUser(payload) {
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });
  if (error) {
    // The function returns real detail in its JSON body on a non-2xx — surface it.
    let msg = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* body not JSON */ }
    if (/Failed to fetch|NetworkError/i.test(msg)) {
      msg = 'Could not reach the user backend (network). Is admin-create-user deployed?';
    }
    return { error: { message: msg } };
  }
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

/* ── Permissions model ── */
export const MODULES = [
  { key: 'cares',      label: 'Cares' },
  { key: 'guests',     label: 'Guests' },
  { key: 'calendar',   label: 'Calendar' },
  { key: 'members',    label: 'Members' },
  { key: 'email',      label: 'Email' },
  { key: 'sms',        label: 'SMS' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'admin',      label: 'Admin' },
];
export const ACCESS = ['none', 'view', 'edit'];

/** Default per-module access for a role preset. */
export function permsForRole(role) {
  const r = normalizeRole(role);
  const base = Object.fromEntries(MODULES.map(m => [m.key, r === 'Viewer' ? 'view' : 'edit']));
  base.admin = r === 'Admin' ? 'edit' : 'none';
  if (r === 'Staff') base.members = 'view';
  if (r === 'Viewer') base.admin = 'none';
  return base;
}

/* ── Time off ── */
export async function fetchTimeOff() {
  const { data, error } = await supabase.from('time_off_requests').select('*').order('created_at', { ascending: false });
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}
export async function decideTimeOff(id, status, extra = {}) {
  return supabase.from('time_off_requests').update({ status, ...extra }).eq('id', id);
}
export async function createTimeOff(row) {
  return supabase.from('time_off_requests').insert(row).select().single();
}

/* Inclusive day count for a PTO request (0.5 for half days) */
export function ptoDays(r) {
  if (r.half_day) return 0.5;
  if (!r.start_date || !r.end_date) return 1;
  const ms = new Date(r.end_date) - new Date(r.start_date);
  return Math.max(1, Math.round(ms / 864e5) + 1);
}

/* ── Change log ── */
export async function fetchChangeLog() {
  const { data, error } = await supabase.from('change_log').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}
export const ACTION_COLORS = {
  Created: '#10B981', Updated: '#3B82F6', Deleted: '#E5484D',
  Merged: '#8B5CF6', 'Contact Logged': '#14B8A6',
};

/* ── Emulation (localStorage) ── */
const EMU_KEY = 'pillar_emulate';
export function getEmulation() {
  try { return JSON.parse(localStorage.getItem(EMU_KEY) || 'null'); } catch { return null; }
}
export function setEmulation(user) {
  if (user) localStorage.setItem(EMU_KEY, JSON.stringify(user));
  else localStorage.removeItem(EMU_KEY);
  window.dispatchEvent(new Event('pillar-emulation'));
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
