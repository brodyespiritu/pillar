/*
 * Cares by text — the conversation flow.
 *
 * Lives apart from the webhook entrypoint so the whole multi-turn exchange can
 * be replayed against a fake database in tests. `supabase` is any client with
 * the PostgREST shape; `send` delivers a reply.
 */

import { decide, findPeople, extractNotes, inferCategory, inferPriority } from './careIntake.ts';
import type { Person } from './careIntake.ts';
import {
  last10, keyword, threadIsFresh, askChoice, askPerson, askReason, askNew,
  confirmCreate, confirmUpdate, confirmUndo, nothingToUndo, readChoice, isYes, isNo,
} from './careReply.ts';

export async function reply(baseUrl: string, key: string, to: string, body: string) {
  await fetch(`${baseUrl}/functions/v1/send-prospect-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: [{ to_number: to, to_name: '', body }], channel: 'care' }),
  }).catch(e => console.error('reply failed:', e));
}

/*
 * Everyone we could plausibly be told about. PostgREST caps a response at 1000
 * rows and says nothing, so the directory (over 1000) must be paged — without
 * this, anyone late in the alphabet silently stops being recognisable.
 */
export async function loadPeople(supabase: any): Promise<Person[]> {
  const people: Person[] = [];

  const { data: care } = await supabase.from('care_members')
    .select('id, full_name').eq('status', 'Active');
  for (const c of care || []) people.push({ id: c.id, name: c.full_name, source: 'care' });

  const inCare = new Set(people.map(p => p.name.toLowerCase().trim()));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('church_members')
      .select('id, name').order('name').order('id').range(from, from + 999);
    if (error) break;
    for (const m of data || []) {
      if (!inCare.has(String(m.name || '').toLowerCase().trim())) {
        people.push({ id: m.id, name: m.name, source: 'member' });
      }
    }
    if (!data || data.length < 1000) break;
  }
  return people;
}

const setThread = (supabase: any, phone: string, state: string, data: any) =>
  supabase.from('care_sms_threads')
    .upsert({ phone, state, data, updated_at: new Date().toISOString() }, { onConflict: 'phone' });

const clearThread = (supabase: any, phone: string, lastAction: any = undefined) =>
  supabase.from('care_sms_threads').upsert({
    phone, state: 'idle', data: {},
    ...(lastAction !== undefined ? { last_action: lastAction } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone' });

/* Create the care record, or log an update against an existing one. */
async function applyDecision(supabase: any, phone: string, d: any, staffName: string) {
  if (d.kind === 'update') {
    const { data: log, error } = await supabase.from('contact_logs').insert({
      member_id: d.person.id, type: 'Update/Visit',
      notes: d.notes, logged_by_name: `${staffName} (text)`,
    }).select().single();
    if (error) return { text: `Could not save that: ${error.message}` };
    await clearThread(supabase, phone, { type: 'log', id: log.id, what: `the update for ${d.person.name}` });
    return { text: confirmUpdate(d.person.name, d.notes) };
  }

  // create
  const { data: row, error } = await supabase.from('care_members').insert({
    full_name: d.name,
    category: d.category,
    priority: d.priority || 'Medium',
    status: 'Active',
    care_notes: d.notes,
  }).select().single();
  if (error) return { text: `Could not save that: ${error.message}` };

  await supabase.from('contact_logs').insert({
    member_id: row.id, type: 'Update/Visit',
    notes: d.notes, logged_by_name: `${staffName} (text)`,
  });
  await clearThread(supabase, phone, { type: 'create', id: row.id, what: `${d.name} from Cares` });
  return { text: confirmCreate(d.name, d.category, d.notes) };
}

async function handleUndo(supabase: any, phone: string, thread: any) {
  const a = thread?.last_action;
  if (!a?.id) return nothingToUndo();
  if (a.type === 'create') await supabase.from('care_members').delete().eq('id', a.id);
  else await supabase.from('contact_logs').delete().eq('id', a.id);
  await supabase.from('care_sms_threads')
    .upsert({ phone, state: 'idle', data: {}, last_action: null, updated_at: new Date().toISOString() },
            { onConflict: 'phone' });
  return confirmUndo(a.what || 'that');
}

/*
 * One inbound text from a staff member. Returns the reply to send, or null to
 * stay quiet — most replies ("thanks") deserve no answer at all.
 */
export async function careIntake(supabase: any, phone: string, text: string, staffName: string) {
  const key = last10(phone);
  const { data: thread } = await supabase.from('care_sms_threads')
    .select('*').eq('phone', key).maybeSingle();

  if (keyword(text) === 'undo') return handleUndo(supabase, key, thread);

  const people = await loadPeople(supabase);
  const open = thread && thread.state && thread.state !== 'idle' && threadIsFresh(thread.updated_at);

  if (open) {
    const d = thread.data || {};

    if (thread.state === 'awaiting_choice') {
      const picked = readChoice(text, d.options || []);
      if (picked) {
        const notes = extractNotes(d.notes, picked.name);
        const dec = picked.source === 'care'
          ? { kind: 'update', person: picked, notes }
          : { kind: 'create', name: picked.name, notes, category: d.category,
              priority: inferPriority(d.category, notes) };
        return (await applyDecision(supabase, key, dec, staffName)).text;
      }
      // Not an answer to the question — fall through and read it fresh.
    }

    if (thread.state === 'awaiting_reason') {
      const person = d.person;
      const notes = extractNotes(text, person?.name || '');
      const dec = person.source === 'care'
        ? { kind: 'update', person, notes }
        : { kind: 'create', name: person.name, notes,
            category: inferCategory(text), priority: inferPriority(inferCategory(text), text) };
      return (await applyDecision(supabase, key, dec, staffName)).text;
    }

    if (thread.state === 'awaiting_person') {
      const matches = findPeople(text, people);
      if (matches.length === 1) {
        const p = matches[0].person;
        const notes = extractNotes(d.notes, p.name);
        const dec = p.source === 'care'
          ? { kind: 'update', person: p, notes }
          : { kind: 'create', name: p.name, notes, category: d.category,
              priority: inferPriority(d.category, notes) };
        return (await applyDecision(supabase, key, dec, staffName)).text;
      }
      if (matches.length > 1) {
        await setThread(supabase, key, 'awaiting_choice',
          { options: matches.map(m => m.person), notes: d.notes, category: d.category });
        return askChoice(matches.map(m => m.person));
      }
      // A name we don't know — offer to add them rather than dropping it.
      const name = text.trim().replace(/\s+/g, ' ').slice(0, 60);
      await setThread(supabase, key, 'awaiting_new', { name, notes: d.notes, category: d.category });
      return askNew(name);
    }

    if (thread.state === 'awaiting_new') {
      if (isYes(text)) {
        const notes = extractNotes(d.notes, d.name);
        const dec = { kind: 'create', name: d.name, notes, category: d.category,
                      priority: inferPriority(d.category, notes) };
        return (await applyDecision(supabase, key, dec, staffName)).text;
      }
      if (isNo(text)) { await clearThread(supabase, key); return 'Okay, nothing saved.'; }
      // Anything else: treat it as a corrected name.
      const matches = findPeople(text, people);
      if (matches.length === 1) {
        const p = matches[0].person;
        const notes = extractNotes(d.notes, p.name);
        const dec = p.source === 'care'
          ? { kind: 'update', person: p, notes }
          : { kind: 'create', name: p.name, notes, category: d.category,
              priority: inferPriority(d.category, notes) };
        return (await applyDecision(supabase, key, dec, staffName)).text;
      }
    }
  }

  // Fresh message.
  const d = decide(text, people);
  if (d.kind === 'ignore') return null;

  if (d.kind === 'ask_person') {
    await setThread(supabase, key, 'awaiting_person', { notes: d.notes, category: d.category });
    return askPerson();
  }
  if (d.kind === 'ask_choice') {
    await setThread(supabase, key, 'awaiting_choice',
      { options: d.options, notes: d.notes, category: d.category });
    return askChoice(d.options);
  }
  if (d.kind === 'ask_reason') {
    await setThread(supabase, key, 'awaiting_reason', { person: d.person });
    return askReason(d.person);
  }
  return (await applyDecision(supabase, key, d, staffName)).text;
}

