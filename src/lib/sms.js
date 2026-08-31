import { supabase } from './supabase';

/* ── Session persistence (24h TTL) ── */
const SESSION_KEY = 'pillar_masstext_session';
const TTL = 24 * 3600 * 1000;

export function saveSession(state) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch {}
}
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - (s.savedAt || 0) > TTL) { clearSession(); return null; }
    return s;
  } catch { return null; }
}
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

/* ── Message assembly ── */
export function assembleMessage(note, shared, closing) {
  return [note, shared, closing].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
}

/* Common emojis for the compose picker */
export const EMOJIS = ['🙏', '❤️', '😊', '🙌', '✝️', '👋', '🎉', '☀️', '🤗', '👍', '🔥', '✨', '📖', '⛪', '💒', '😇'];

/* ── Last mass text per number (avoid duplicates) ── */
export async function getLastMassTexts(numbers = []) {
  if (!numbers.length) return {};
  const { data } = await supabase
    .from('sms_messages')
    .select('to_number, body, created_at')
    .in('to_number', numbers)
    .order('created_at', { ascending: false });
  const map = {};
  (data || []).forEach(m => { if (!map[m.to_number]) map[m.to_number] = m; });
  return map;
}

/* ── Send (via Supabase Edge Function → Telnyx) ── */
export async function sendProspectSms(messages, status, campaign) {
  const { data, error } = await supabase.functions.invoke('send-prospect-sms',
    { body: { messages, ...(status ? { status } : {}), ...(campaign ? { campaign } : {}) } });
  if (error) {
    // Function not deployed / not configured → report all as failed with a clear reason.
    const reason = /not found|Failed to fetch|non-2xx/i.test(error.message || '')
      ? 'SMS backend not deployed. Deploy supabase/functions/send-prospect-sms and set Telnyx secrets.'
      : (error.message || String(error));
    return { sent: 0, failed: messages.map(m => ({ to_name: m.to_name, error: reason })) };
  }
  return data;
}
