// Guests → directory (Pillar/src/lib/directoryTransfer.js): who is on a guest entry, who of them is
// already in the directory, and exactly what a transfer writes — a household becomes one entry per
// person, nobody is added twice, and nothing already on a directory entry is overwritten.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const calls = [];
let insertAnswer = null;   // (rows) => { data, error }
let updateError = null;
const table = (name) => ({
  insert: (rows) => ({
    select: () => {
      calls.push({ table: name, op: 'insert', rows });
      return Promise.resolve(insertAnswer ? insertAnswer(rows) : { data: rows.map((r, i) => ({ id: `new-${i}`, name: r.name })), error: null });
    },
  }),
  update: (patch) => ({
    eq: (c, v) => {
      calls.push({ table: name, op: 'update', patch, where: [c, v] });
      return Promise.resolve({ data: null, error: name === 'church_members' ? updateError : null });
    },
  }),
});
globalThis.__supabase = { from: table };

const load = (file, out, replace) => {
  let src = fs.readFileSync(path.join(PILLAR, file), 'utf8');
  for (const [a, b] of replace) { assert.ok(src.includes(a), `${file}: ${a}`); src = src.replace(a, b); }
  fs.writeFileSync(path.join(OUT, out), src);
};
const STUB = ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'];
load('src/lib/guests.js', 'guests.mjs', [STUB]);
load('src/lib/members.js', 'members.mjs', [STUB]);
load('src/lib/directoryTransfer.js', 'directoryTransfer.mjs', [
  STUB,
  ["from './guests';", "from './guests.mjs';"],
  ["from './members';", "from './members.mjs';"],
]);
const guests = await import(pathToFileURL(path.join(OUT, 'guests.mjs')).href);
const lib = await import(pathToFileURL(path.join(OUT, 'directoryTransfer.mjs')).href);

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };
const names = (people) => people.map((p) => `${p.name} (${p.position})`);

console.log('\n── reading a guest entry ──');

await t('the name line comes apart the way the guest form wrote it', async () => {
  const line = guests.composeFullName('John', 'Smith', 'Mary', [{ relation: 'Son', name: 'Tim', age: '5' }]);
  assert.strictEqual(line, 'John + Mary, Smith. with son Tim (5)');
  assert.deepStrictEqual(guests.parseGuestName(line), { first: 'John', spouse: 'Mary', last: 'Smith' });
});

await t('an initial keeps its surname (the children start at ". with ", not the first full stop)', async () => {
  assert.deepStrictEqual(guests.parseGuestName('John D., Smith'), { first: 'John D.', spouse: '', last: 'Smith' });
  assert.deepStrictEqual(guests.parseGuestName('Mary Ann, Van Buren'), { first: 'Mary Ann', spouse: '', last: 'Van Buren' });
  assert.deepStrictEqual(guests.parseGuestName('Solo'), { first: 'Solo', spouse: '', last: '' });
});

await t('a household is one person each, head first, all carrying the surname', async () => {
  const family = [{ relation: 'Son', name: 'Tim', age: '5' }, { relation: 'Grandson', name: 'Leo' }, { relation: 'Daughter', name: 'Ann Smith' }];
  const g = { full_name: guests.composeFullName('John', 'Smith', 'Mary', family), spouse: 'Mary', family };
  const people = lib.peopleOnGuest(g);
  assert.deepStrictEqual(names(people), ['John Smith (Head)', 'Mary Smith (Spouse)', 'Tim Smith (Child)', 'Leo Smith (Other)', 'Ann Smith (Child)']);
  assert.strictEqual(people[2].age, '5');
  assert.strictEqual(people[3].relation, 'Grandson');
});

await t('one person on their own is just them; a spouse on the entry is found even without a "+"', async () => {
  assert.deepStrictEqual(names(lib.peopleOnGuest({ full_name: 'Solo' })), ['Solo (Head)']);
  assert.deepStrictEqual(names(lib.peopleOnGuest({ full_name: 'Kim, Lee', spouse: 'Sam' })), ['Kim Lee (Head)', 'Sam Lee (Spouse)']);
});

console.log('\n── who is already in the directory ──');

const head = { key: 'head', name: 'John Smith', position: 'Head' };
const spouse = { key: 'spouse', name: 'Mary Smith', position: 'Spouse' };

await t('the head is found by name, ignoring case, spacing and punctuation', async () => {
  const index = [{ id: 'a', name: 'JOHN  SMITH' }, { id: 'b', name: "Pat O'Neil" }];
  assert.strictEqual(lib.findExisting([head], {}, index).head.id, 'a');
  assert.strictEqual(lib.findExisting([{ ...head, name: 'Pat ONeil' }], {}, index).head.id, 'b');
});

await t('a lone name match whose phone disagrees is somebody else', async () => {
  const index = [{ id: 'a', name: 'John Smith', phone: '(555) 111-2222' }];
  assert.deepStrictEqual(lib.findExisting([head], { phone: '555-999-8888' }, index), {});
  assert.strictEqual(lib.findExisting([head], { phone: '+1 555 111 2222' }, index).head.id, 'a', 'same number, written differently');
  assert.strictEqual(lib.findExisting([head], { phone: '555-999-8888', email: 'J@x.org' }, [{ ...index[0], email: 'j@x.org' }]).head.id, 'a', 'the email agrees');
});

await t('several with the name: only a phone or email that agrees settles it', async () => {
  const index = [{ id: 'a', name: 'John Smith', phone: '5551112222' }, { id: 'b', name: 'John Smith', email: 'js@x.org' }];
  assert.strictEqual(lib.findExisting([head], { email: 'JS@x.org' }, index).head.id, 'b');
  assert.deepStrictEqual(lib.findExisting([head], {}, index), {}, 'nothing to tell them apart: a new entry, not a guess');
});

await t('everyone else is looked for only in the head’s household', async () => {
  const index = [
    { id: 'a', name: 'John Smith', family_id: 'F1' },
    { id: 'm1', name: 'Mary Smith', family_id: 'F1' },
    { id: 'm2', name: 'Mary Smith', family_id: 'F9' },
  ];
  assert.strictEqual(lib.findExisting([head, spouse], {}, index).spouse.id, 'm1');
  assert.strictEqual(lib.findExisting([{ ...head, name: 'Jon Smyth' }, spouse], {}, index).spouse, undefined, 'no head found: the other Mary is left alone');
});

console.log('\n── what a transfer writes ──');

const guest = { id: 'g1', full_name: 'John + Mary, Smith. with son Tim (5)', spouse: 'Mary', phone: '555-111-2222', email: 'john@x.org', address: '1 Main St' };
const tim = { key: 'family-0', name: 'Tim Smith', position: 'Child' };

await t('a new household: one row each, one family, the phone and email on the head only', async () => {
  const { inserts, updates } = lib.planTransfer({ guest, people: [head, spouse, tim], recordType: 'Prospect', existing: {} });
  assert.strictEqual(updates.length, 0);
  const rows = inserts.map((i) => i.row);
  assert.deepStrictEqual(rows.map((r) => [r.name, r.family_position]), [['John Smith', 'Head'], ['Mary Smith', 'Spouse'], ['Tim Smith', 'Child']]);
  assert.ok(rows[0].family_id && rows.every((r) => r.family_id === rows[0].family_id), 'one household');
  assert.ok(rows.every((r) => r.family_name === 'Smith Family' && r.address === '1 Main St'));
  assert.deepStrictEqual([rows[0].phone, rows[0].email, rows[1].phone, rows[1].email], ['555-111-2222', 'john@x.org', null, null]);
  assert.ok(rows.every((r) => r.record_type === 'Prospect' && r.member_status === 'Visitor' && r.status === 'Active'));
  const asMember = lib.planTransfer({ guest, people: [head], recordType: 'Member', existing: {} }).inserts[0].row;
  assert.deepStrictEqual([asMember.record_type, asMember.member_status], ['Member', 'Member']);
});

await t('joining a head already in the directory: their household, and only the blanks filled', async () => {
  const existing = { head: { id: 'a', name: 'John Smith', record_type: 'Member', phone: '', email: 'old@x.org', address: '9 Elm', family_id: 'F1', family_name: 'The Smiths' } };
  const { inserts, updates } = lib.planTransfer({ guest, people: [head, spouse], recordType: 'Prospect', existing });
  assert.deepStrictEqual(inserts.map((i) => [i.row.name, i.row.family_id, i.row.family_name]), [['Mary Smith', 'F1', 'The Smiths']]);
  assert.deepStrictEqual(updates, [{ key: 'head', id: 'a', patch: { record_type: 'Prospect', phone: '555-111-2222' } }], 'email and address kept');
});

await t('made a member, a Visitor status becomes Member; made a prospect, the status is left alone', async () => {
  const was = { id: 'a', name: 'John Smith', record_type: 'Prospect', member_status: 'Visitor', phone: '1', email: 'e', address: 'x', family_id: 'F1' };
  assert.deepStrictEqual(lib.planTransfer({ guest, people: [head], recordType: 'Member', existing: { head: was } }).updates[0].patch,
    { record_type: 'Member', member_status: 'Member' });
  const member = { ...was, record_type: 'Member', member_status: 'Member' };
  assert.deepStrictEqual(lib.planTransfer({ guest, people: [head], recordType: 'Prospect', existing: { head: member } }).updates[0].patch,
    { record_type: 'Prospect' });
});

await t('someone already there as chosen, with nothing missing: no write at all', async () => {
  const existing = { head: { id: 'a', name: 'John Smith', record_type: 'Member', member_status: 'Member', phone: '1', email: 'e', address: 'x', family_id: 'F1' } };
  assert.deepStrictEqual(lib.planTransfer({ guest, people: [head], recordType: 'Member', existing }).updates, []);
});

await t('a head with no household gets the new one, so the family is filed together', async () => {
  const existing = { head: { id: 'a', name: 'John Smith', record_type: 'Member', phone: '1', email: 'e', address: 'x' } };
  const { inserts, updates } = lib.planTransfer({ guest, people: [head, spouse], recordType: 'Member', existing });
  assert.strictEqual(updates[0].patch.family_id, inserts[0].row.family_id);
  assert.deepStrictEqual([updates[0].patch.family_name, updates[0].patch.family_position], ['Smith Family', 'Head']);
});

await t('the writes: one insert for the whole household, then the updates, then the guest is linked', async () => {
  calls.length = 0;
  insertAnswer = (rows) => ({ data: [...rows].reverse().map((r, i) => ({ id: `id-${r.name}`, name: r.name, n: i })), error: null });
  const res = await lib.transferToDirectory({ guest, people: [head, spouse], recordType: 'Prospect', existing: {} });
  assert.deepStrictEqual(res, { added: 2, updated: 0, linkId: 'id-John Smith' }, 'paired by name, though the rows came back reversed');
  assert.deepStrictEqual(calls.map((c) => `${c.table}.${c.op}`), ['church_members.insert', 'guests.update']);
  assert.deepStrictEqual(calls[1], { table: 'guests', op: 'update', patch: { member_id: 'id-John Smith' }, where: ['id', 'g1'] });
});

await t('an insert that fails writes nothing else and says so', async () => {
  calls.length = 0;
  insertAnswer = () => ({ data: null, error: { message: 'permission denied' } });
  const res = await lib.transferToDirectory({ guest, people: [head], recordType: 'Member', existing: {} });
  assert.deepStrictEqual(res, { error: { message: 'permission denied' }, added: 0, updated: 0 });
  assert.strictEqual(calls.length, 1);
  insertAnswer = null;
});

await t('only an update: the guest is linked to the entry that was already there', async () => {
  calls.length = 0;
  const existing = { head: { id: 'a', name: 'John Smith', record_type: 'Member', phone: '1', email: 'e', address: 'x', family_id: 'F1' } };
  const res = await lib.transferToDirectory({ guest, people: [head], recordType: 'Prospect', existing });
  assert.deepStrictEqual(res, { added: 0, updated: 1, linkId: 'a' });
  assert.deepStrictEqual(calls.map((c) => `${c.table}.${c.op}`), ['church_members.update', 'guests.update']);
});

console.log(`\n${ok} passed`);
