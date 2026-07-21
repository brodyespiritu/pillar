import { supabase } from './supabase';

export const CATEGORIES = [
  'Hospitalized', 'Grieving', 'New Member', 'Homebound', 'Crisis',
  'Pain', 'Sick', 'Prayer Request', 'Follow Up', 'Surgery',
  'Test/Treatment', 'Recovering', 'Other',
];

export const PRIORITIES = ['High', 'Medium', 'Low'];
export const STATUSES   = ['Active', 'Inactive', 'Resolved'];
export const LOG_TYPES  = ['Phone Call', 'Text Message', 'Dinner/Meal', 'Update/Visit'];

// Categories that reveal medical fields
export const MEDICAL_CATEGORIES = ['Hospitalized', 'Surgery'];

export const CATEGORY_COLORS = {
  Hospitalized:     '#E5484D',
  Grieving:         '#8B5CF6',
  'New Member':     '#10B981',
  Homebound:        '#F59E0B',
  Crisis:           '#DC2626',
  Pain:             '#EC4899',
  Sick:             '#F97316',
  'Prayer Request': '#3B82F6',
  'Follow Up':      '#06B6D4',
  Surgery:          '#E5484D',
  'Test/Treatment': '#8B5CF6',
  Recovering:       '#10B981',
  Other:            '#6B7280',
};

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

/* ── Reads ─────────────────────────────────────────── */
export async function fetchMembers() {
  const { data, error } = await supabase
    .from('care_members')
    .select('*, contact_logs(id, type, notes, logged_by_name, created_at)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return []; }
  // High priority always to top, then most-recent
  return (data || []).sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

/* ── Member CRUD ───────────────────────────────────── */
export async function saveMember(member) {
  const payload = { ...member };
  delete payload.contact_logs;
  // strip empty date strings → null
  ['admission_date', 'surgery_date'].forEach(k => {
    if (payload[k] === '') payload[k] = null;
  });
  // empty uuid / foreign keys → null (avoids "invalid input syntax for type uuid")
  ['assigned_to'].forEach(k => {
    if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
  });
  if (member.id) {
    const { data, error } = await supabase
      .from('care_members').update(payload).eq('id', member.id).select().single();
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase
    .from('care_members').insert(payload).select().single();
  return { data, error };
}

export async function deleteMember(id) {
  return supabase.from('care_members').delete().eq('id', id);
}

/* ── Contact logs ──────────────────────────────────── */
export async function addLog(log) {
  return supabase.from('contact_logs').insert(log).select().single();
}

export async function deleteLog(id) {
  return supabase.from('contact_logs').delete().eq('id', id);
}

/* ── Derived stats for QuickBoxes + AI summary ─────── */
export function computeStats(members) {
  const active      = members.filter(m => m.status === 'Active');
  const needsAttn   = members.filter(m => m.priority === 'High' && m.category !== 'Recovering');
  const notVisited  = members.filter(m => !(m.contact_logs?.length));
  const hospitalized = members.filter(m => m.category === 'Hospitalized');
  const surgeries   = members.filter(m => m.category === 'Surgery');
  const prayer      = members.filter(m => m.category === 'Prayer Request');
  return {
    active: active.length,
    needsAttention: needsAttn.length,
    notVisited: notVisited.length,
    hospitalized: hospitalized.length,
    surgeries: surgeries.length,
    prayer: prayer.length,
    total: members.length,
  };
}

export function buildSummary(members) {
  const s = computeStats(members);
  if (s.active === 0) {
    return 'No active care cases at the moment. Your congregation is well supported!';
  }
  const parts = [`You have ${s.active} active care case${s.active === 1 ? '' : 's'}`];
  const clauses = [];
  if (s.hospitalized) clauses.push(`${s.hospitalized} hospitalization${s.hospitalized === 1 ? '' : 's'}`);
  if (s.surgeries)    clauses.push(`${s.surgeries} upcoming surger${s.surgeries === 1 ? 'y' : 'ies'}`);
  if (clauses.length) parts[0] += `, including ${clauses.join(' and ')}`;
  parts[0] += '.';

  if (s.prayer) parts.push(`${s.prayer} prayer request${s.prayer === 1 ? '' : 's'} need attention.`);

  const stale = members.filter(m => {
    if (!m.contact_logs?.length) return false;
    const last = Math.max(...m.contact_logs.map(l => new Date(l.created_at)));
    return (Date.now() - last) > 7 * 864e5;
  });
  const never = members.filter(m => !(m.contact_logs?.length) && m.status === 'Active');
  const uncontacted = stale.length + never.length;
  if (uncontacted) parts.push(`${uncontacted} ${uncontacted === 1 ? 'person hasn\'t' : "people haven't"} been contacted in over a week.`);

  const recent = [...members]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3).map(m => m.full_name);
  if (recent.length) parts.push(`Recently added: ${recent.join(', ')}.`);

  return parts.join(' ');
}

export function lastContacted(member) {
  if (!member.contact_logs?.length) return null;
  return member.contact_logs
    .map(l => l.created_at)
    .sort((a, b) => new Date(b) - new Date(a))[0];
}
