// Church staff (2026-09-21): a position on a member's record (church_members.staff_title), kept in
// Pillar on the member's page (Members → the member → Church Staff), puts a "Church Staff" banner with
// that title on their profile in the member app.
//
// Saving: the database takes a position or nothing — never an empty one — so a blank field clears it,
// and saving anything else leaves it alone. The card is always on the member's page — editable once
// member-directory-open.sql has added the column, a note saying so before — and the add/edit form
// (the phone's too) carries the field once the column exists. And the three places that carry it agree
// on its name: Pillar's SQL, the app's account code, and the app's banner.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(__dirname, '.build-staff'); fs.mkdirSync(OUT, { recursive: true });
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

// a pretend church_members table with the database's rule for staff_title
const sent = [];
function from(table) {
  assert.strictEqual(table, 'church_members');
  let payload = null;
  const q = {
    update(p) { payload = p; return q; },
    insert(p) { payload = p; return q; },
    eq() { return q; }, select() { return q; },
    async single() {
      sent.push(payload);
      const t = payload.staff_title;
      if (t !== undefined && t !== null && !(String(t).trim().length >= 1 && String(t).trim().length <= 80)) {
        return { data: null, error: { code: '23514', message: 'new row for relation "church_members" violates check constraint "church_members_staff_title_check"' } };
      }
      return { data: { id: 'm1', ...payload }, error: null };
    },
  };
  return q;
}
stub('./supabase', { supabase: { from } });
const { saveChurchMember } = require(xform(path.join(PILLAR, 'src/lib/members.js'), 'members.cjs'));

(async () => {
  let ok = 0; let failed = 0;
  const t = async (name, fn) => {
    try { await fn(); ok++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
  };

  await t('a position saves trimmed', async () => {
    sent.length = 0;
    const r = await saveChurchMember({ id: 'm1', staff_title: '  Communications Director ' });
    assert.ifError(r.error);
    assert.strictEqual(sent[0].staff_title, 'Communications Director');
  });
  await t('a blank position clears it, instead of being refused', async () => {
    for (const blank of ['', '   ', null]) {
      sent.length = 0;
      const r = await saveChurchMember({ id: 'm1', staff_title: blank });
      assert.ifError(r.error);
      assert.strictEqual(sent[0].staff_title, null, JSON.stringify(blank));
    }
  });
  await t('saving anything else leaves the position alone', async () => {
    sent.length = 0;
    await saveChurchMember({ id: 'm1', name: 'Brody Espiritu' });
    assert.ok(!('staff_title' in sent[0]), JSON.stringify(sent[0]));
  });

  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/members/MembersPage.jsx'), 'utf8');
  await t('the member page always has a Church Staff card: editable once the column exists, a note before', () => {
    // the office couldn't find it when it hid until the SQL had run (user, 2026-09-21)
    assert.ok(/\{'staff_title' in member \? \(\s*<EditableCard title="Church Staff"/.test(page), 'editable when the record has the column');
    assert.ok(/\) : \(\s*<div className="mp2-card">\s*<div className="mp2-card-head"><h2 className="mp2-card-title">Church Staff<\/h2><\/div>/.test(page),
      'and still there, as a plain card, when it doesn\'t');
    assert.ok(/Staff positions turn on once member-directory-open\.sql has been run in Supabase/.test(page), 'saying what turns it on');
    assert.ok(/key: 'staff_title', label: 'Position', placeholder: 'e\.g\. Communications Director', maxLength: 80/.test(page));
    assert.ok(/<input type=\{f\.type \|\| 'text'\} value=\{draft\[f\.key\] \|\| ''\} maxLength=\{f\.maxLength\}/.test(page),
      'the field stops at the database\'s 80 characters');
  });
  await t('the add/edit form (the phone\'s too) has the position, once the column exists', () => {
    assert.ok(/\.\.\.\('staff_title' in member \? \{ staff_title: member\.staff_title \|\| '' \} : \{\}\)/.test(page),
      'only a record with the column carries it, so an older database never gets sent it');
    assert.ok(/\{'staff_title' in f && \(\s*<label className="field-group"><span>Church Staff Position<\/span>\s*<input value=\{f\.staff_title\} maxLength=\{80\}/.test(page));
  });

  await t('Pillar, the app and the banner agree on the name', () => {
    const sql = fs.readFileSync(path.join(PILLAR, 'supabase/member-directory-open.sql'), 'utf8');
    const auth = fs.readFileSync(path.join(PILLAR, 'supabase/member-app-auth.sql'), 'utf8');
    for (const [name, text] of [['member-directory-open.sql', sql], ['member-app-auth.sql', auth]]) {
      assert.ok(/'staff_title', nullif\(btrim\(m\.staff_title\), ''\)/.test(text), `${name}: member_me sends it`);
      assert.ok(/birthday text,\s*staff_title text\)/.test(text), `${name}: member_directory returns it`);
    }
    if (!fs.existsSync(APP)) { console.log('     (the app repo is not beside Pillar — skipped the app half)'); return; }
    const memberAuth = fs.readFileSync(path.join(APP, 'utils/memberAuth.js'), 'utf8');
    const account = fs.readFileSync(path.join(APP, 'context/AccountContext.js'), 'utf8');
    const card = fs.readFileSync(path.join(APP, 'components/MemberProfileSheet.js'), 'utf8');
    const profile = fs.readFileSync(path.join(APP, 'screens/ProfileScreen.js'), 'utf8');
    assert.ok(/staffTitle:\s+me\.staff_title/.test(memberAuth), 'the app reads member_me\'s staff_title');
    assert.ok(/staffTitle: m\.staff_title/.test(account), 'the app reads the directory\'s staff_title');
    assert.ok(/<StaffBanner title=\{m\.staffTitle\}>/.test(card), 'the member card shows it');
    assert.ok(/<StaffBanner title=\{staffTitle\}>/.test(profile), 'My Profile shows it');
  });

  if (failed) { console.log(`${ok} passed, ${failed} failed`); process.exit(1); }
  console.log(`${ok} church-staff checks passed`);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
