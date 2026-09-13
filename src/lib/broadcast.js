import { supabase } from './supabase';
import { sendProspectSms } from './sms';
import { markAwaitingApproval, findNewGroup, NEW_GROUP } from './consent';
import { fetchMembers } from './care';
import { fetchGuests } from './guests';
/* The exact file the send functions use, so the cost shown is the cost billed. */
import { smsCost, toGsm } from '../../supabase/functions/_shared/smsEncoding.ts';

/* ── Contacts ── */
/*
 * PostgREST caps a response at 1000 rows silently. The shared contact list is
 * already ~490 and grows with the congregation; past 1000 a broadcast to
 * "everyone" would quietly skip the tail of the alphabet. Page instead.
 * The .order('id') tiebreak keeps rows from shifting between pages.
 */
const PAGE = 1000;

export async function fetchContacts() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('sms_contacts').select('*')
      .order('name').order('id').range(from, from + PAGE - 1);
    if (error) return rows.length ? { rows, missing: false } : { rows: [], missing: true };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, missing: false };
}
/*
 * Adding somebody puts them in the New group, not straight onto the list —
 * they have not agreed to be texted yet. See lib/consent.js.
 */
export async function addContact(row) {
  const res = await supabase.from('sms_contacts').insert(row).select().single();
  if (!res.error && res.data?.id) await markAwaitingApproval(row.owner, [res.data.id]);
  return res;
}
/* Batch insert — one round-trip for the member-directory picker. */
export async function addContacts(rows) {
  if (!rows.length) return { count: 0 };
  const { data, error } = await supabase.from('sms_contacts').insert(rows).select('id');
  if (!error) await markAwaitingApproval(rows[0]?.owner, (data || []).map(r => r.id));
  return { error, count: rows.length };
}
export async function updateContact(id, patch) {
  return supabase.from('sms_contacts').update(patch).eq('id', id);
}
export async function deleteContact(id) {
  return supabase.from('sms_contacts').delete().eq('id', id);
}

/* ── Groups ── */
export async function fetchGroups() {
  const { data, error } = await supabase.from('sms_groups').select('*').order('name');
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}
export async function addGroup(row) {
  return supabase.from('sms_groups').insert(row).select().single();
}
export async function deleteGroup(id) {
  return supabase.from('sms_groups').delete().eq('id', id);
}

/* ── Group membership (many-to-many) ── */
export async function fetchMemberships() {
  const { data } = await supabase.from('sms_group_members').select('*');
  return data || [];
}
/*
 * New is a consent state, not a group somebody assigns, so it is left alone
 * here. Without that, saving a brand-new contact wiped the New membership the
 * moment after it was set — this function clears every membership before
 * writing the ticked ones back, and New had just been added by addContact.
 * Only sending the approval takes somebody out of New.
 */
export async function setContactGroups(contactId, groupIds) {
  const newId = await findNewGroup();
  let del = supabase.from('sms_group_members').delete().eq('contact_id', contactId);
  if (newId) del = del.neq('group_id', newId);
  await del;

  const ids = groupIds.filter(g => g !== newId);
  if (ids.length) {
    await supabase.from('sms_group_members').insert(ids.map(g => ({ group_id: g, contact_id: contactId })));
  }
}

/* ── Import phone numbers already in Pillar (care members + guests) ── */
export async function importFromPillar(owner, existingPhones) {
  const [members, guests] = await Promise.all([fetchMembers(), fetchGuests()]);
  const have = new Set(existingPhones.map(normalizePhone));
  const seen = new Set();
  const toAdd = [];
  [...members.map(m => ({ name: m.full_name, phone: m.phone })),
   ...guests.map(g => ({ name: g.full_name, phone: g.phone }))]
    .forEach(c => {
      if (!c.phone?.trim()) return;
      const key = normalizePhone(c.phone);
      if (have.has(key) || seen.has(key)) return;
      seen.add(key);
      toAdd.push({ owner, name: c.name, phone: c.phone.trim() });
    });
  if (toAdd.length) {
    const { data, error } = await supabase.from('sms_contacts').insert(toAdd).select('id');
    if (!error) await markAwaitingApproval(owner, (data || []).map(r => r.id));
  }
  return toAdd.length;
}
const normalizePhone = p => String(p || '').replace(/\D/g, '').slice(-10);

/* The most recent Dinner send — replies after it are that dinner's RSVPs. */
export async function latestDinnerSend() {
  const { data, error } = await supabase.from('sms_library')
    .select('id, body, target_label, recipient_count, last_sent_at')
    .eq('message_type', 'Dinner')
    .not('last_sent_at', 'is', null)
    .order('last_sent_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

/*
 * Every recorded poll answer — one per person per poll, a later reply replacing
 * an earlier one. The inbound webhook writes these; the Responses tab reads them.
 */
export async function fetchPollAnswers() {
  const { data, error } = await supabase.from('sms_poll_answers')
    .select('poll_body, to_number, choice, answered_at');
  if (error) return [];
  return data || [];
}

/* ── Message library (saved broadcasts, resendable) ── */
export async function fetchLibrary() {
  const { data, error } = await supabase
    .from('sms_library').select('*')
    .order('last_sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}
export async function deleteLibraryItem(id) {
  return supabase.from('sms_library').delete().eq('id', id);
}
/** Record a broadcast in the library — dedupes on identical body. */
export async function recordSend(owner, body, target_label, recipient_count, title = null, message_type = 'General') {
  const { data } = await supabase.from('sms_library').select('id').eq('body', body).limit(1);
  const now = new Date().toISOString();
  if (data?.length) {
    return supabase.from('sms_library')
      .update({ last_sent_at: now, target_label, recipient_count, message_type, ...(title ? { title } : {}) })
      .eq('id', data[0].id);
  }
  return supabase.from('sms_library')
    .insert({ owner, title, body, target_label, recipient_count, message_type, last_sent_at: now });
}
/** Save without marking as sent (used by "save to library" on schedule). */
export async function saveToLibrary(owner, body, target_label, recipient_count, title = null) {
  const { data } = await supabase.from('sms_library').select('id').eq('body', body).limit(1);
  if (data?.length) {
    return supabase.from('sms_library')
      .update({ target_label, recipient_count, ...(title ? { title } : {}) })
      .eq('id', data[0].id);
  }
  return supabase.from('sms_library')
    .insert({ owner, title, body, target_label, recipient_count });
}

/* ── Scheduled broadcasts (dispatched by the send-scheduled-sms edge function) ── */
export async function fetchScheduled() {
  const { data, error } = await supabase
    .from('sms_scheduled').select('*')
    .neq('status', 'canceled')
    .order('send_at', { ascending: true });
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}
export async function scheduleBroadcast({
  owner, body, target_label, recipients, send_at,
  message_type = 'General', repeat_rule = 'none', target_key = null,
}) {
  const snapshot = recipients
    .filter(c => c.phone?.trim())
    .map(c => ({ name: c.name || '', phone: c.phone.trim() }));
  const row = { owner, body, target_label, recipients: snapshot, send_at };

  const res = await supabase.from('sms_scheduled')
    .insert({ ...row, message_type, repeat_rule, target_key }).select().single();
  /*
   * These columns arrived after the table did. A database that has not had the
   * migration run still has to be able to schedule a text — losing the repeat
   * or the dinner tag is a smaller failure than the send never being queued.
   */
  if (res.error && /message_type|repeat_rule|target_key/.test(res.error.message || '')) {
    return supabase.from('sms_scheduled').insert(row).select().single();
  }
  return res;
}
export async function cancelScheduled(id) {
  return supabase.from('sms_scheduled').update({ status: 'canceled' }).eq('id', id).eq('status', 'pending');
}

/* ── Who a send reaches ── */

/*
 * Numbers Telnyx has refused as not mobile — the sms_landlines view. They are
 * skipped on every send, so they are left out of the count too.
 */
export async function fetchLandlines() {
  const { data, error } = await supabase.from('sms_landlines').select('to10');
  if (error) return new Set();
  return new Set((data || []).map(r => r.to10).filter(Boolean));
}

/*
 * The directory's deacons — members tagged Deacons. A text to the Deacons group
 * only reaches numbers that belong to one of them (the server enforces it), and
 * the Groups tab uses the same list to show who does not line up.
 */
export async function fetchDeaconDirectory() {
  const { data, error } = await supabase.from('church_members')
    .select('id, name, phone, tags').ilike('tags', '%deacon%');
  if (error) return null;
  return (data || [])
    .filter(m => String(m.tags || '').split(',').some(t => t.trim().toLowerCase() === 'deacons'))
    .map(m => ({ id: m.id, name: m.name || '', phone10: normalizePhone(m.phone) }));
}

export const isDeaconsGroup = g => String(g?.name || '').trim().toLowerCase() === 'deacons';

/*
 * The people a composer send will actually reach, and why anyone else is left
 * out — the same rules as supabase/functions/_shared/recipients.ts, so the
 * number on the button is the number that goes. The server checks again at the
 * moment of sending regardless; this is so nobody is surprised by it.
 */
export function planRecipients({ target, contacts = [], groups = [], members = [], landlines = new Set(), deacons = null }) {
  const newGroup = groups.find(g => g.name === NEW_GROUP);
  const group = target === 'all' ? null : groups.find(g => g.id === target);
  const inGroup = group ? new Set(members.filter(m => m.group_id === group.id).map(m => m.contact_id)) : null;
  const awaiting = new Set(newGroup ? members.filter(m => m.group_id === newGroup.id).map(m => m.contact_id) : []);
  const isNew = !!(group && newGroup && group.id === newGroup.id);
  const deaconPhones = isDeaconsGroup(group) && deacons ? new Set(deacons.map(d => d.phone10)) : null;

  const list = [];
  const left = { waiting: 0, landlines: 0, duplicates: 0, notDeacons: 0 };
  const seen = new Set();
  for (const c of contacts) {
    if (!String(c.phone || '').trim() || c.opted_out) continue;
    if (inGroup && !inGroup.has(c.id)) continue;
    if (target !== 'all' && !group) continue;
    const p = normalizePhone(c.phone);
    if (!isNew && awaiting.has(c.id)) { left.waiting++; continue; }
    if (deaconPhones && !deaconPhones.has(p)) { left.notDeacons++; continue; }
    if (landlines.has(p)) { left.landlines++; continue; }
    if (seen.has(p)) { left.duplicates++; continue; }
    seen.add(p);
    list.push(c);
  }
  return { list, left };
}

/* "3 waiting for approval · 29 landlines" — the people left out, in words. */
export function leftOutText(left) {
  const n = (k, one, many) => (left[k] ? `${left[k]} ${left[k] === 1 ? one : many}` : null);
  return [
    n('waiting', 'waiting for approval', 'waiting for approval'),
    n('notDeacons', 'not a deacon in the member directory', 'not deacons in the member directory'),
    n('landlines', 'landline', 'landlines'),
    n('duplicates', 'duplicate number', 'duplicate numbers'),
  ].filter(Boolean).join(' · ');
}

export const targetSpec = target => (target === 'all' ? { kind: 'all' } : { kind: 'group', id: target });

/* ── Send broadcast (reuses the Telnyx edge function) ── */
/*
 * One message per phone: two contacts sharing a number used to get two copies
 * of every broadcast — 22 extra texts on each send to the whole list.
 * `target` lets the server re-check the group as it stands at the moment of
 * sending, not as it stood when this screen loaded.
 */
export async function sendBroadcast(contacts, body, status, campaign, target) {
  const text = String(body || '').trim();
  const seen = new Set();
  const messages = [];
  for (const c of contacts) {
    if (!c.phone?.trim()) continue;
    const key = normalizePhone(c.phone);
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({ to_number: c.phone.trim(), to_name: c.name || '', body: text });
  }
  return sendProspectSms(messages, status, campaign, target);
}

/*
 * The phones a send actually reached. Anyone the server refused or skipped as a
 * landline is left out; a copy skipped only because the same phone already got
 * one counts as reached. An answer that does not say which numbers failed can
 * only vouch for a send in which nothing failed.
 */
export function reachedPhones(contacts, res) {
  if (!res?.sent) return new Set();
  const misses = [
    ...(res.failed || []),
    ...(res.skipped || []).filter(x => !/same number/i.test(x.reason || '')),
  ];
  if (misses.some(x => !x.to_number)) return new Set();
  const missed = new Set(misses.map(x => normalizePhone(x.to_number)));
  return new Set(contacts.map(c => normalizePhone(c.phone)).filter(p => p && !missed.has(p)));
}

/* What happened, for a result line: counts and the first reason given. */
export function sendSummary(res) {
  const failed = res?.failed || [];
  const skipped = res?.skipped || [];
  return {
    sent: res?.sent || 0,
    notSent: failed.length,
    skipped: skipped.length,
    reason: failed[0]?.error || skipped[0]?.reason || '',
  };
}

/* ── Chasing the people who never answered ── */

export const REMINDER_TEXT =
  "Hi there! We haven't heard from you yet - any plate reservations for Wednesday? Thanks!";

/*
 * A reminder is not a new question. The Responses tab reads the last thing sent
 * to someone as what their next reply answers, so filing reminders under their
 * own status keeps a late headcount attached to the dinner it belongs to
 * instead of splitting off into a box of its own.
 */
export const REMIND_STATUS = 'Reminder';

/* Carrier keywords that mean stop. Somebody who ever sent one is never chased. */
const STOPPED = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)\b/i;

/*
 * Everyone who was sent this message and has said nothing back.
 *
 * Worked out from the threads already on screen — the send is in each person's
 * thread, so anyone holding an inbound message after it has answered. Excluded:
 * numbers the send failed on (landlines, which will only fail again), anyone
 * who has ever texted STOP, and the placeholder numbers behind web
 * reservations, which are not phones at all.
 */
export function silentRecipients(prompt, threads, familyOf = null) {
  const asked = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!asked) return [];

  const out = [];
  const answeredPhones = [];
  for (const t of threads) {
    const digits = String(t.number || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10 || digits.startsWith('0')) continue;   // not a real phone

    let sentAt = null, answered = false, stopped = false;
    for (const m of t.messages) {
      if ((m.direction || 'out') === 'in') {
        if (sentAt && m.created_at >= sentAt) answered = true;
        if (STOPPED.test(m.body || '')) stopped = true;
        continue;
      }
      if (m.status === 'Failed') continue;                          // never reached them
      if (String(m.body || '').replace(/\s+/g, ' ').trim() === asked) sentAt = m.created_at;
    }
    if (!sentAt) continue;
    if (answered) { answeredPhones.push(digits); continue; }
    if (!stopped) out.push({ name: t.name || '', phone: t.number });
  }

  /*
   * A household answers once. If the mother has already reserved plates for the
   * family, texting her son to ask again is a second message about a decision
   * that has been made — so anyone whose family already replied is dropped.
   *
   * Families come from the member directory (family_id); a number that isn't in
   * it, or is in a household of one, is unaffected.
   */
  if (!familyOf) return out;
  const answeredFamilies = new Set();
  for (const p of answeredPhones) {
    const fam = familyOf.get(p);
    if (fam) answeredFamilies.add(fam);
  }
  if (!answeredFamilies.size) return out;
  return out.filter(r => {
    const fam = familyOf.get(String(r.phone || '').replace(/\D/g, '').slice(-10));
    return !fam || !answeredFamilies.has(fam);
  });
}

/* SMS segment math (GSM-7 = 160, unicode = 70) */
/*
 * What this text will actually cost, in segments.
 *
 * Measured by the same file the send functions use, on the text as it goes to
 * Telnyx — punctuation straightened — so the number here is the number billed.
 * The old estimate was wrong in both directions: it called any non-ASCII
 * character Unicode (é, £ and ñ are plain SMS characters), and it divided long
 * texts by 160 and 70 when a split message holds 153 and 67 a segment.
 *
 * `len` stays the length as typed — that is what the person is looking at.
 */
export function smsSegments(text) {
  const typed = String(text ?? '');
  const cost = smsCost(toGsm(typed));
  const multipart = cost.segments > 1;
  const per = cost.encoding === 'GSM-7' ? (multipart ? 153 : 160) : (multipart ? 67 : 70);
  return { len: typed.length, segments: typed.length === 0 ? 0 : cost.segments, per, encoding: cost.encoding };
}

/* ── Public RSVP link ── */

/*
 * The address the church posts. The form is served at the root of this domain
 * and always shows whichever dinner is current, so the link never changes —
 * only the menu behind it does.
 */
export const RSVP_SITE = 'https://bethesda.rsvp';

/*
 * A token identifying one dinner to the public form. Short enough to sit in a
 * Facebook post, random enough that nobody guesses their way onto the list.
 */
function rsvpToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(36)).join('').slice(0, 14);
}

/*
 * The shareable link for a dinner, minting one if this is the first time.
 *
 * Asking for a link is itself a statement that the message is a dinner, so the
 * library row is marked as one here — that is the tag replies are matched
 * against, and forgetting to set it is what silently stops reservations being
 * counted.
 */
export async function createRsvpLink(owner, body, menu) {
  const text = String(body || '').trim();
  if (!text) return { error: 'Write the message first.' };

  // Blank rows are how an unused "add another" field comes back; drop them.
  const items = Array.isArray(menu)
    ? menu.map(m => String(m || '').trim()).filter(Boolean).slice(0, 12)
    : null;

  const { data, error } = await supabase
    .from('sms_library').select('id, rsvp_token').eq('body', text).limit(1);
  if (error) return { error: error.message };

  let row = data?.[0];
  if (!row) {
    const ins = await supabase.from('sms_library')
      .insert({ owner, body: text, message_type: 'Dinner', rsvp_token: rsvpToken(),
                rsvp_menu: items || [] })
      .select('rsvp_token').single();
    if (ins.error) return { error: ins.error.message };
    row = ins.data;
  } else {
    /* Re-opening an existing dinner keeps its token — the link already posted
       has to keep working — but the menu is whatever was just typed. */
    const patch = { message_type: 'Dinner' };
    if (!row.rsvp_token) patch.rsvp_token = rsvpToken();
    if (items) patch.rsvp_menu = items;
    const up = await supabase.from('sms_library')
      .update(patch).eq('id', row.id).select('rsvp_token').single();
    if (up.error) return { error: up.error.message };
    row = up.data;
  }
  return { url: RSVP_SITE, direct: `${RSVP_SITE}/rsvp/${row.rsvp_token}` };
}

/*
 * What a dinner already has on file — its menu, and its link if one was made.
 * Read before the menu editor opens so an existing menu is edited rather than
 * silently replaced with whatever gets typed this time.
 */
export async function fetchRsvpInfo(body) {
  const text = String(body || '').trim();
  if (!text) return { menu: [], url: null };
  const { data } = await supabase
    .from('sms_library').select('rsvp_token, rsvp_menu').eq('body', text).limit(1);
  const row = data?.[0];
  return {
    menu: Array.isArray(row?.rsvp_menu) ? row.rsvp_menu.map(String) : [],
    url: row?.rsvp_token ? RSVP_SITE : null,
    direct: row?.rsvp_token ? `${RSVP_SITE}/rsvp/${row.rsvp_token}` : null,
  };
}
