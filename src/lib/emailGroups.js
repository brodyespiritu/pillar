import { supabase } from './supabase';

/*
 * Email groups — reusable named recipient lists, shared across staff.
 * Stored in the existing `email_config` table (group_name + email + name);
 * the Greeter Recap's "greeters" is just one such group.
 * Requires supabase/email-recap-schema.sql.
 */

export async function fetchEmailGroups() {
  const [membersRes, groupsRes] = await Promise.all([
    supabase.from('email_config').select('*')
      .order('group_name', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('email_groups').select('name').order('name', { ascending: true }),
  ]);
  if (membersRes.error) {
    return { groups: {}, missing: /relation|does not exist/i.test(membersRes.error.message || '') };
  }
  const groups = {};
  // Register named groups (so empty ones persist). email_groups may not exist yet — that's fine.
  if (!groupsRes.error) for (const g of groupsRes.data || []) groups[g.name] ||= [];
  // Attach members.
  for (const r of membersRes.data || []) (groups[r.group_name] ||= []).push(r);
  return { groups, missing: false };
}

/** Persist a (possibly empty) group. Safe no-op if email_groups isn't created yet. */
export async function createGroup(name, createdBy) {
  return supabase.from('email_groups').insert({ name: name.trim(), created_by: createdBy || null });
}

export async function addGroupEmail({ group_name, email, name }) {
  return supabase.from('email_config')
    .insert({ group_name: group_name.trim(), email: email.trim(), name: name?.trim() || null })
    .select().single();
}

export async function removeGroupEmail(id) {
  return supabase.from('email_config').delete().eq('id', id);
}

export async function deleteGroup(group_name) {
  await supabase.from('email_config').delete().eq('group_name', group_name);
  return supabase.from('email_groups').delete().eq('name', group_name);
}
