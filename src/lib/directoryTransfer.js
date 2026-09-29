import { supabase } from './supabase';
import { parseGuestName } from './guests';
import { newFamilyId } from './members';

/*
 * Guest list → directory.
 *
 * A guest entry is a household written as one line ("John + Mary, Smith. with
 * son Tim (5)"); the directory is a list of people, grouped into households by
 * family_id. So a transfer adds each person as their own directory entry, all
 * in one household, rather than copying the line: an entry named "John + Mary,
 * Smith. with son Tim (5)" is not one anybody could find by searching for Mary.
 *
 * Nobody is added twice. Someone already in the directory is updated instead:
 * their record type becomes the one chosen, and a phone, email, address or
 * household they lack is filled in. Nothing they already have is overwritten.
 *
 * The guest entry is left as it is (visits, notes, who is following up) and
 * linked to the directory entry, so the guest list can say who has moved over.
 */

/* Enough to recognise people by, without everyone's photo. */
export const DIRECTORY_INDEX_COLUMNS =
  'id, name, phone, email, address, record_type, member_status, status, family_id, family_name, family_position';

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/* What a name is compared by: case, spacing and punctuation don't count. */
export const nameKey = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
/* The last ten digits, so "+1 (555) 123-4567" and "555.123.4567" agree. */
export const phoneKey = s => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const emailKey = s => clean(s).toLowerCase();

const CHILDREN = new Set(['son', 'daughter', 'twins']);

/* "Mary" in the Smith household is Mary Smith; "Mary Smith" already is. */
function withSurname(name, last) {
  const n = clean(name);
  if (!n || !clean(last)) return n;
  const k = nameKey(n), l = nameKey(last);
  return k === l || k.endsWith(` ${l}`) ? n : `${n} ${clean(last)}`;
}

export const guestSurname = g => parseGuestName(g?.full_name).last;

/* Everyone on a guest entry, head of the household first. */
export function peopleOnGuest(g) {
  const { first, spouse: typedSpouse, last } = parseGuestName(g?.full_name);
  const people = [{ key: 'head', name: withSurname(first, last) || clean(g?.full_name), position: 'Head', relation: '' }];
  const spouse = clean(g?.spouse) || typedSpouse;
  if (spouse) people.push({ key: 'spouse', name: withSurname(spouse, last), position: 'Spouse', relation: 'Spouse' });
  (Array.isArray(g?.family) ? g.family : []).forEach((f, i) => {
    const name = clean(f?.name);
    if (!name) return;
    const relation = clean(f.relation) || 'Family Member';
    people.push({
      key: `family-${i}`,
      name: withSurname(name, last),
      relation,
      age: clean(f.age),
      position: CHILDREN.has(relation.toLowerCase()) ? 'Child' : 'Other',
    });
  });
  return people;
}

/*
 * Who on the entry is already in the directory: { [person.key]: directory row }.
 *
 * The head of the household is found by name. Where several people share it,
 * the entry's phone or email has to agree as well; and a lone match whose phone
 * or email disagrees is taken to be somebody else. A second entry is easy to
 * tidy up, where changing the wrong person's record is not.
 *
 * Everyone else is looked for only inside the head's household. "Tim Smith"
 * elsewhere in the directory is much more likely to be another Tim Smith.
 */
export function findExisting(people, guest, index) {
  const phone = phoneKey(guest?.phone);
  const email = emailKey(guest?.email);
  const agrees = m => (phone && phoneKey(m.phone) === phone) || (email && emailKey(m.email) === email);
  const conflicts = m => !agrees(m) && (
    (phone && phoneKey(m.phone) && phoneKey(m.phone) !== phone)
    || (email && emailKey(m.email) && emailKey(m.email) !== email));

  const found = {};
  const headPerson = people.find(p => p.key === 'head');
  let head = null;
  if (headPerson && nameKey(headPerson.name)) {
    const same = index.filter(m => nameKey(m.name) === nameKey(headPerson.name));
    const agreeing = same.filter(agrees);
    head = agreeing.length === 1 ? agreeing[0]
      : same.length === 1 && !conflicts(same[0]) ? same[0]
      : null;
    if (head) found.head = head;
  }

  const household = clean(head?.family_id);
  if (household) {
    for (const p of people) {
      if (p.key === 'head' || !nameKey(p.name)) continue;
      const hits = index.filter(m => m.id !== head.id && clean(m.family_id) === household
        && nameKey(m.name) === nameKey(p.name));
      if (hits.length === 1) found[p.key] = hits[0];
    }
  }
  return found;
}

/*
 * The writes a transfer makes, worked out without making them: the new rows to
 * insert, and a patch for each person already in the directory (only what
 * changes; nothing when nothing would).
 */
export function planTransfer({ guest, people, recordType, existing }) {
  const last = guestSurname(guest);
  const familyName = last ? `${last} Family` : null;
  const fresh = people.filter(p => !existing[p.key]);
  const headRec = existing.head;
  /* One household for everyone: the head's, when they are already in the
     directory with one, or else a new one. */
  const familyId = clean(headRec?.family_id) || newFamilyId();
  /* The entry's phone and email are the head's — the rest of the household
     keeps its own, which the entry never recorded. */
  const contact = p => (p.key === 'head'
    ? { phone: clean(guest?.phone) || null, email: clean(guest?.email) || null }
    : { phone: null, email: null });
  const address = clean(guest?.address) || null;

  const inserts = fresh.map(p => ({
    key: p.key,
    row: {
      name: clean(p.name),
      record_type: recordType,
      member_status: recordType === 'Member' ? 'Member' : 'Visitor',
      status: 'Active',
      active: true,
      ...contact(p),
      address,
      family_id: familyId,
      family_name: clean(headRec?.family_name) || familyName,
      family_position: p.position,
    },
  }));

  const updates = people.filter(p => existing[p.key]).map(p => {
    const m = existing[p.key];
    const c = contact(p);
    const patch = {};
    if ((m.record_type || '') !== recordType) patch.record_type = recordType;
    /* Made a member: a Visitor status (what a prospect is given) goes with it.
       Made a prospect: whatever status they had is left as it was. */
    if (recordType === 'Member' && ['', 'visitor'].includes(clean(m.member_status).toLowerCase())) patch.member_status = 'Member';
    if (!clean(m.phone) && c.phone) patch.phone = c.phone;
    if (!clean(m.email) && c.email) patch.email = c.email;
    if (!clean(m.address) && address) patch.address = address;
    if (!clean(m.family_id) && fresh.length) {
      patch.family_id = familyId;
      if (!clean(m.family_name) && familyName) patch.family_name = familyName;
      if (!clean(m.family_position)) patch.family_position = p.position;
    }
    return { key: p.key, id: m.id, patch };
  }).filter(u => Object.keys(u.patch).length);

  return { inserts, updates };
}

/*
 * Adds `people` (the ones ticked, names as corrected) to the directory as
 * `recordType`, 'Member' or 'Prospect'. Returns { added, updated, linkId }, or
 * { error } with whatever was already written counted.
 */
export async function transferToDirectory({ guest, people, recordType, existing }) {
  const { inserts, updates } = planTransfer({ guest, people, recordType, existing });
  const ids = Object.fromEntries(Object.entries(existing).map(([k, m]) => [k, m.id]));

  /* All the new people in one statement, so a household is never half added. */
  if (inserts.length) {
    const { data, error } = await supabase.from('church_members')
      .insert(inserts.map(i => i.row)).select('id, name');
    if (error) return { error, added: 0, updated: 0 };
    /* Paired back by name, not by position — nothing promises the rows come
       back in the order they went in. */
    const left = [...(data || [])];
    for (const i of inserts) {
      const at = left.findIndex(r => r.name === i.row.name);
      if (at !== -1) ids[i.key] = left.splice(at, 1)[0].id;
    }
  }

  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase.from('church_members').update(u.patch).eq('id', u.id);
    if (error) return { error, added: inserts.length, updated };
    updated++;
  }

  /* The link is guests.member_id (guests-directory-link.sql). Until that has
     run, the transfer still stands; the list just can't show it yet. */
  const linkId = ids.head || ids[people[0]?.key] || null;
  if (linkId && guest?.id) {
    const { error } = await supabase.from('guests').update({ member_id: linkId }).eq('id', guest.id);
    if (error) console.warn('guest not linked to the directory:', error.message);
  }
  return { added: inserts.length, updated, linkId };
}
