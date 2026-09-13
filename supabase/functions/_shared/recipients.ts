/*
 * Who a text may reach — decided on the server, at the moment of sending, for
 * every message that leaves Pillar.
 *
 * The screens already pick sensible recipients. This is the check behind them,
 * for the cases a screen cannot see: a Deacons list loaded before somebody was
 * taken off it, a scheduled text whose snapshot is a week old, a contact who
 * texted STOP in the meantime, a care text handed the wrong number by a bug, a
 * contact list with the same phone on it twice.
 *
 * Every rule here works on the last ten digits of a number (see phone.ts) and
 * on data read fresh from the database, never on what the caller claims.
 *
 * THE RULES
 *
 *   Everyone     A valid US number. Not opted out. One copy of a given text
 *                per phone per send. Known landlines are skipped — they are
 *                refused every time, so trying again only slows the send.
 *
 *   Care texts   (channel 'care') Only the audience the caller names, checked
 *                against the source of truth for that audience:
 *                  staff    active staff an admin put on the Cares list
 *                  deacons  deacons in the member directory who are also on
 *                           the Deacons texting group
 *                A care text that names no audience is treated as staff-only.
 *
 *   Group sends  (a `target` given) Only people who are in that group NOW —
 *                not when the screen loaded. Nobody still waiting in New unless
 *                this is their welcome text. And a text to a group called
 *                Deacons only reaches numbers that belong to a deacon in the
 *                member directory: being added to the texting group by mistake
 *                is not enough to start receiving deacon messages.
 *
 *   Congregation (channel 'sms') Never the wording of Pillar's own care
 *                texts. Those only ever go out on the care channel, where the
 *                rules above apply; seeing one here means something upstream is
 *                wrong, and it is refused rather than delivered.
 *
 * Blocked messages are refusals — the reason is returned and shown. Skipped
 * messages are ones that could never have arrived (a landline, a duplicate).
 */

import { last10, isSendable } from './phone.ts';

export type Target = { kind: 'all' } | { kind: 'group'; id: string };
export type Audience = 'staff' | 'deacons';
export type OutMsg = { to_number: string; to_name?: string; body: string; [k: string]: unknown };
export type Screened = OutMsg & { reason: string };

export type Roster = {
  optedOut: Set<string>;
  landlines: Set<string>;
  careStaff?: Set<string>;
  deacons?: Set<string>;
  /* Set when a target was given. `error` means it could not be confirmed. */
  target?: {
    kind: 'all' | 'group';
    name: string;
    members: Set<string>;
    awaiting: Set<string>;
    isNew: boolean;
    isDeacons: boolean;
    directoryDeacons: Set<string>;
    error?: string;
  };
};

export const DEACONS_GROUP = 'deacons';
export const NEW_GROUP = 'New';

/* Pillar's own care wording. Deliberately narrow — only phrases the system
   itself writes, so a prayer request typed into a broadcast is untouched. */
const CARE_TEMPLATE = new RegExp([
  String.raw`^\s*(?:\(\d+\/\d+\)\s*)?Bethesda Cares\b`,
  String.raw`^\s*(?:\(\d+\/\d+\)\s*)?CARES - `,
  String.raw`\bhas been added to the care list\b`,
  String.raw`\bupdates? on your families:`,
  String.raw`\bto Cares \(`,
].join('|'), 'im');

export const isCareWording = (body: unknown) => CARE_TEMPLATE.test(String(body ?? ''));

const normBody = (b: unknown) => String(b ?? '').replace(/\s+/g, ' ').trim();

export const isDeaconTag = (tags: unknown) =>
  String(tags ?? '').split(',').some(t => t.trim().toLowerCase() === DEACONS_GROUP);

/*
 * The decision for one send. Pure — no network — so every rule can be exercised
 * directly against a hand-built roster.
 */
export function screenMessages(
  messages: OutMsg[],
  roster: Roster,
  opts: { channel: 'sms' | 'care'; audience?: Audience | null; status?: string | null },
) {
  const send: OutMsg[] = [];
  const blocked: Screened[] = [];
  const skipped: Screened[] = [];
  const seen = new Set<string>();
  const t = roster.target;

  for (const m of messages) {
    const body = String(m?.body ?? '');
    const p10 = last10(m?.to_number);
    const no = (reason: string) => blocked.push({ ...m, reason });

    if (!body.trim()) { no('Empty message'); continue; }
    if (!isSendable(m?.to_number)) { no('Not a valid mobile number'); continue; }

    const key = `${p10}|${normBody(body)}`;
    if (seen.has(key)) { skipped.push({ ...m, reason: 'Same number already gets this text' }); continue; }
    seen.add(key);

    if (roster.optedOut.has(p10)) { no('Opted out (texted STOP)'); continue; }

    if (opts.channel === 'care') {
      if (opts.audience === 'deacons') {
        if (!roster.deacons?.has(p10)) { no('Deacon alerts only go to deacons in the member directory'); continue; }
      } else if (!roster.careStaff?.has(p10)) {
        no('Care texts only go to staff on the Cares list'); continue;
      }
    } else {
      if (isCareWording(body)) { no('Care wording can only go out as a care text'); continue; }
      if (t) {
        if (t.error) { no(t.error); continue; }
        if (!t.members.has(p10)) {
          no(t.kind === 'all' ? 'Not on the contact list anymore' : `Not in ${t.name} anymore`); continue;
        }
        if (t.awaiting.has(p10) && !t.isNew && opts.status !== 'Approval') {
          no("Hasn't been sent the welcome text yet"); continue;
        }
        if (t.isDeacons && !t.directoryDeacons.has(p10)) {
          no('Not a deacon in the member directory'); continue;
        }
      }
    }

    if (roster.landlines.has(p10)) { skipped.push({ ...m, reason: "Landline - can't receive texts" }); continue; }
    send.push(m);
  }
  return { send, blocked, skipped };
}

/* ── Reading the roster ───────────────────────────────────────────────── */

/* PostgREST stops at 1000 rows and says nothing. */
async function pageAll(make: (from: number, to: number) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data || []));
    if (!data || data.length < 1000) return { rows, error: null };
  }
}

async function groupPhones(supabase: any, groupIds: string[]) {
  const { rows, error } = await pageAll((a, b) => supabase.from('sms_group_members')
    .select('group_id, contact_id, sms_contacts(phone, opted_out)')
    .in('group_id', groupIds).order('group_id').order('contact_id').range(a, b));
  const phones = new Set<string>();
  for (const r of rows) {
    const c = r.sms_contacts;
    if (c && !c.opted_out && last10(c.phone).length === 10) phones.add(last10(c.phone));
  }
  return { phones, error };
}

/* Numbers belonging to members tagged Deacons in the directory. */
export async function directoryDeaconPhones(supabase: any) {
  const { rows, error } = await pageAll((a, b) => supabase.from('church_members')
    .select('id, phone, tags').ilike('tags', '%deacon%').order('id').range(a, b));
  const phones = new Set<string>();
  for (const m of rows) if (isDeaconTag(m.tags) && last10(m.phone).length === 10) phones.add(last10(m.phone));
  return { phones, error };
}

/*
 * The deacons a care text may reach: in the directory as a deacon AND on the
 * Deacons texting group, not opted out. Either list alone is not enough.
 */
export async function verifiedDeaconPhones(supabase: any) {
  const { data: groups, error: gErr } = await supabase.from('sms_groups').select('id, name');
  if (gErr) return { phones: new Set<string>(), error: gErr };
  const ids = (groups || []).filter((g: any) => String(g.name || '').trim().toLowerCase() === DEACONS_GROUP).map((g: any) => g.id);
  if (!ids.length) return { phones: new Set<string>(), error: null };
  const [{ phones: texting, error: tErr }, { phones: directory, error: dErr }] =
    await Promise.all([groupPhones(supabase, ids), directoryDeaconPhones(supabase)]);
  const phones = new Set([...texting].filter(p => directory.has(p)));
  return { phones, error: tErr || dErr };
}

export async function loadRoster(
  supabase: any,
  opts: { channel: 'sms' | 'care'; audience?: Audience | null; target?: Target | null },
): Promise<Roster> {
  const roster: Roster = { optedOut: new Set(), landlines: new Set() };

  /* Opt-outs and landlines fail open: Telnyx refuses both regardless, so a read
     error here costs a wasted attempt, never a text somebody asked not to get. */
  const [opt, land] = await Promise.all([
    supabase.from('sms_contacts').select('phone').eq('opted_out', true),
    supabase.from('sms_landlines').select('to10'),
  ]);
  if (opt.error) console.error('opt-out list unavailable:', opt.error.message);
  for (const r of opt.data || []) if (last10(r.phone)) roster.optedOut.add(last10(r.phone));
  if (land.error && !/does not exist|relation/i.test(land.error.message || '')) {
    console.error('landline list unavailable:', land.error.message);
  }
  for (const r of land.data || []) if (r.to10) roster.landlines.add(r.to10);

  /* Care audiences fail CLOSED: an unreadable roster allows nobody. */
  if (opts.channel === 'care') {
    if (opts.audience === 'deacons') {
      const { phones, error } = await verifiedDeaconPhones(supabase);
      if (error) console.error('deacon roster unavailable; refusing deacon texts:', error.message);
      roster.deacons = error ? new Set() : phones;
    } else {
      const { data, error } = await supabase.from('staff').select('phone, active, preferences');
      if (error) console.error('staff roster unavailable; refusing care texts:', error.message);
      roster.careStaff = new Set(
        (error ? [] : data || [])
          .filter((s: any) => s.active !== false && s.preferences?.caresSmsOptIn === true)
          .map((s: any) => last10(s.phone)).filter((p: string) => p.length === 10),
      );
    }
  }

  /* A target is confirmed or the send is refused — fail closed. */
  const target = opts.channel === 'sms' ? opts.target : null;
  if (target) {
    const t: NonNullable<Roster['target']> = {
      kind: target.kind, name: 'the contact list', members: new Set(), awaiting: new Set(),
      isNew: false, isDeacons: false, directoryDeacons: new Set(),
    };
    const fail = (why: string, e?: any) => {
      if (e) console.error('target roster:', e.message || e);
      t.error = why;
    };

    const { data: groups, error: gErr } = await supabase.from('sms_groups').select('id, name');
    if (gErr) fail('Could not confirm who is on the list. Try again.', gErr);
    const newIds = (groups || []).filter((g: any) => g.name === NEW_GROUP).map((g: any) => g.id);

    if (!t.error && target.kind === 'group') {
      const g = (groups || []).find((x: any) => x.id === target.id);
      if (!g) fail('That group no longer exists.');
      else {
        t.name = String(g.name || 'the group').trim();
        t.isNew = g.name === NEW_GROUP;
        t.isDeacons = t.name.toLowerCase() === DEACONS_GROUP;
        const { phones, error } = await groupPhones(supabase, [g.id]);
        if (error) fail('Could not confirm who is in that group. Try again.', error);
        t.members = phones;
        if (t.isDeacons) {
          const { phones: dir, error: dErr } = await directoryDeaconPhones(supabase);
          if (dErr) fail('Could not confirm the deacons in the member directory. Try again.', dErr);
          t.directoryDeacons = dir;
        }
      }
    } else if (!t.error) {
      const { rows, error } = await pageAll((a, b) => supabase.from('sms_contacts')
        .select('phone, opted_out').order('id').range(a, b));
      if (error) fail('Could not confirm who is on the contact list. Try again.', error);
      for (const c of rows) if (!c.opted_out && last10(c.phone).length === 10) t.members.add(last10(c.phone));
    }

    if (!t.error && newIds.length) {
      const { phones, error } = await groupPhones(supabase, newIds);
      if (error) fail('Could not confirm who is still waiting for approval. Try again.', error);
      t.awaiting = phones;
    }
    roster.target = t;
  }

  return roster;
}

/* A caller's `target`, accepted only in the two shapes that mean something. */
export function parseTarget(raw: any): Target | null {
  if (raw?.kind === 'all') return { kind: 'all' };
  if (raw?.kind === 'group' && typeof raw.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id)) {
    return { kind: 'group', id: raw.id };
  }
  return null;
}

export const parseAudience = (raw: any): Audience | null =>
  raw === 'deacons' ? 'deacons' : raw === 'staff' ? 'staff' : null;
