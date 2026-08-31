import { supabase } from './supabase';

/*
 * Consent before the first text.
 *
 * Somebody added to the contact list has not yet agreed to be texted. They go
 * into a group called New and stay there until an approval message goes out
 * telling them who is writing, roughly how often, and how to stop. Sending it
 * is what moves them onto the ordinary list — so a congregation-wide broadcast
 * only ever reaches people who have been told.
 *
 * The STOP line is appended by the sender rather than typed into the body, so
 * it cannot be edited away by accident. Carriers require it, and so does the
 * TCPA.
 */

export const NEW_GROUP = 'New';

/*
 * Plain ASCII, deliberately. One em dash or curly quote pushes the whole
 * message from GSM-7 into Unicode, which cuts a segment from 160 characters to
 * 70 — the first draft of this text came out as four segments instead of two,
 * and every new contact would have cost four texts to greet.
 */
export const DISCLOSURE_DEFAULT =
  "Hello from Bethesda Baptist Church! You're now on our text list for service "
  + 'reminders, Wednesday dinner reservations and church news. Usually a few '
  + 'messages a month. Message and data rates may apply.';

/* Fixed. Every approval carries it, whatever the body says. */
export const STOP_LINE = 'Reply STOP at any time to stop receiving texts.';

export const withStopLine = body =>
  `${String(body || '').trim()}\n\n${STOP_LINE}`.trim();

/** The New group if it exists, without creating one. */
export async function findNewGroup() {
  const { data } = await supabase
    .from('sms_groups').select('id').eq('name', NEW_GROUP).limit(1);
  return data?.[0]?.id ?? null;
}

/** The New group, created the first time somebody is added. */
export async function ensureNewGroup(owner) {
  const { data } = await supabase
    .from('sms_groups').select('id').eq('name', NEW_GROUP).limit(1);
  if (data?.length) return data[0].id;
  const { data: made, error } = await supabase
    .from('sms_groups').insert({ owner, name: NEW_GROUP }).select('id').single();
  if (error) { console.error('could not create the New group:', error.message); return null; }
  return made?.id ?? null;
}

/** Put freshly added contacts into New. Never throws — a failure here must not
 *  lose the contact that was just added. */
export async function markAwaitingApproval(owner, contactIds = []) {
  const ids = contactIds.filter(Boolean);
  if (!ids.length) return;
  try {
    const groupId = await ensureNewGroup(owner);
    if (!groupId) return;
    await supabase.from('sms_group_members')
      .insert(ids.map(contact_id => ({ group_id: groupId, contact_id })));
  } catch (e) {
    console.error('could not mark contacts as awaiting approval:', e);
  }
}

/**
 * Move people out of New once their approval has gone out. Only the ones that
 * were actually texted — anyone held back by the hour stays for next time.
 */
export async function clearApproved(groupId, contactIds = []) {
  const ids = contactIds.filter(Boolean);
  if (!groupId || !ids.length) return { error: null };
  return supabase.from('sms_group_members')
    .delete().eq('group_id', groupId).in('contact_id', ids);
}
