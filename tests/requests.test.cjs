// Member requests on Home (src/lib/memberRequests.js, src/pages/home/MemberRequests.jsx, 2026-09-21):
// what a member asked for from their profile in the app. A change reads old → new; Approve puts exactly
// that on their record (and the photo), then closes it. A deletion closes as Done. Nothing else changes.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');
const PILLAR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.build-requests'); fs.mkdirSync(OUT, { recursive: true });
const babel = require(path.join(DEPS, '@babel/core'));
const xform = (src, out) => { fs.writeFileSync(path.join(OUT, out), babel.transformFileSync(src, { babelrc: false, configFile: false,
  plugins: [path.join(DEPS, '@babel/plugin-transform-modules-commonjs')] }).code); return path.join(OUT, out); };
const STUBS = {};
const stub = (req, exp) => { const f = path.join(OUT, '__stubs__', req.replace(/[^\w.-]/g, '_') + '.js'); const m = new Module(f); m.filename = f; m.loaded = true; m.exports = exp; require.cache[f] = m; STUBS[req] = f; };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (STUBS[request]) return STUBS[request];
  return origResolve.call(this, request, parent, ...rest);
};

const writes = [];
let failNext = null;
function from(table) {
  const call = { table, patch: null, eq: null };
  const q = {
    update(p) { call.patch = p; return q; },
    eq(col, v) { call.eq = [col, v]; writes.push(call); const e = failNext; failNext = null; return Promise.resolve({ error: e }); },
  };
  return q;
}
stub('./supabase', { supabase: { from } });
const R = require(xform(path.join(PILLAR, 'src/lib/memberRequests.js'), 'memberRequests.cjs'));

const member = { id: 'm1', name: 'Al Adams', email: 'al@x.org', phone: '706-555-0111', photo_url: 'data:image/jpeg;base64,T0xE' };
const change = { id: 'r1', kind: 'change', member, photo: 'data:image/jpeg;base64,TkVX', changes: { name: 'Allen Adams', phone: '706-555-0199' }, message: null };
const deletion = { id: 'r2', kind: 'delete', member, message: 'I moved away.' };

(async () => {
  let ok = 0; let failed = 0;
  const t = async (name, fn) => {
    try { await fn(); ok++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
  };

  await t('a change reads as it is → as they’d like it, in a fixed order', () => {
    assert.deepStrictEqual(R.detailChanges(change), [
      { key: 'name', label: 'Name', from: 'Al Adams', to: 'Allen Adams' },
      { key: 'phone', label: 'Mobile', from: '706-555-0111', to: '706-555-0199' },
    ]);
  });
  await t('the list line says what they asked for', () => {
    assert.strictEqual(R.summary(change), 'Name, Mobile and a new photo');
    assert.strictEqual(R.summary({ kind: 'change', photo: 'x', member }), 'A new photo');
    assert.strictEqual(R.summary({ kind: 'change', changes: { email: 'a@b.c' }, member }), 'Email');
    assert.strictEqual(R.summary(deletion), 'I moved away.');
  });
  await t('Approve puts exactly that on the record, photo too, then closes it as approved', async () => {
    writes.length = 0;
    await R.approveRequest(change, 's1');
    assert.deepStrictEqual(writes[0], { table: 'church_members', patch: { name: 'Allen Adams', phone: '706-555-0199', photo_url: 'data:image/jpeg;base64,TkVX' }, eq: ['id', 'm1'] });
    assert.strictEqual(writes[1].table, 'member_requests');
    assert.deepStrictEqual([writes[1].patch.outcome, writes[1].patch.handled_by, writes[1].eq], ['approved', 's1', ['id', 'r1']]);
    assert.ok(writes[1].patch.handled_at, 'and when');
    assert.strictEqual(writes.length, 2);
  });
  await t('if the record won’t save, the request stays open', async () => {
    writes.length = 0;
    failNext = { message: 'permission denied' };
    await assert.rejects(() => R.approveRequest(change, 's1'), (e) => /permission denied/.test(e.message));
    assert.strictEqual(writes.length, 1, 'nothing closed');
  });
  await t('a deletion closes as Done, and Decline closes without touching the record', async () => {
    writes.length = 0;
    await R.closeRequest(deletion.id, 's1', 'done');
    await R.closeRequest(change.id, 's1', 'declined');
    assert.deepStrictEqual(writes.map((w) => [w.table, w.patch.outcome]), [['member_requests', 'done'], ['member_requests', 'declined']]);
  });

  if (failed) { console.log(`${ok} passed, ${failed} failed`); process.exit(1); }
  console.log(`${ok} member-request checks passed`);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
