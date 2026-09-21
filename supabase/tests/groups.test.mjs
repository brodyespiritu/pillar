// What the groups table promises: staff write it, the public reads only what is published, and a
// leader is always a named person.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node groups.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite } from './_pg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(SUPA, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail == null ? '' : `— ${detail}`); }
};

const PGlite = await loadPGlite();
const db = new PGlite();

// the bits groups-schema.sql leans on — a Supabase project has these already
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table if not exists public.staff (id uuid primary key, active boolean default true);
  create or replace function public.touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at = now(); return new; end $$;
`);
await db.exec(read('groups-schema.sql'));

console.log('\n── the table ──');
const cols = await db.query(`select column_name from information_schema.columns
                              where table_name = 'church_groups' order by column_name`);
const names = cols.rows.map((r) => r.column_name);
ok('it holds what a group card needs',
  ['about', 'audience', 'filter_key', 'leaders', 'location', 'meets', 'name', 'published', 'sort'].every((c) => names.includes(c)),
  names.join(', '));

console.log('\n── seeded from the calendar\'s own ministry groups ──');
const seeded = await db.query(`select name, filter_key, about, meets, leaders from public.church_groups order by sort`);
ok('the five the app already shows', seeded.rows.length === 5, seeded.rows.length);
ok('tied to the calendar filters',
  seeded.rows.map((r) => r.filter_key).join(',') === 'kids,youth,college,women,men',
  seeded.rows.map((r) => r.filter_key).join(','));
ok('and nothing written for them — the office does that',
  seeded.rows.every((r) => !r.about && !r.meets && JSON.stringify(r.leaders) === '[]'));

console.log('\n── re-running is safe ──');
await db.exec(read('groups-schema.sql'));
const again = await db.query('select count(*)::int as n from public.church_groups');
ok('it does not seed twice', again.rows[0].n === 5, again.rows[0].n);

console.log('\n── a leader is always a named person ──');
const rejects = async (leaders) => {
  try { await db.exec(`update public.church_groups set leaders = '${leaders}'::jsonb where filter_key = 'men'`); return false; }
  catch { return true; }
};
ok('a bare string is refused',        await rejects('["Jane Doe"]'));
ok('an object with no name is refused', await rejects('[{"role":"Leader"}]'));
ok('an empty name is refused',        await rejects('[{"name":"   "}]'));
ok('not an array at all is refused',  await rejects('{"name":"Jane"}'));
await db.exec(`update public.church_groups
                  set leaders = '[{"name":"Jane Doe","role":"Leader"}]'::jsonb where filter_key = 'men'`);
const led = await db.query(`select leaders -> 0 ->> 'name' as who from public.church_groups where filter_key = 'men'`);
ok('a name goes in', led.rows[0].who === 'Jane Doe', led.rows[0].who);

console.log('\n── who may read it ──');
const pol = await db.query(`select policyname, cmd, roles::text, qual from pg_policies
                             where tablename = 'church_groups' order by policyname`);
const pub = pol.rows.find((p) => p.policyname === 'public read groups');
ok('the public may read', !!pub && pub.cmd === 'SELECT', pol.rows.map((p) => p.policyname).join(', '));
ok('anon only', !!pub && pub.roles.includes('anon'), pub && pub.roles);
ok('and only what is published', !!pub && /published/.test(pub.qual || ''), pub && pub.qual);
ok('writing is staff only',
  pol.rows.some((p) => p.policyname === 'staff write groups' && /is_active_staff/.test(p.qual || '')));
ok('row level security is on',
  (await db.query(`select relrowsecurity from pg_class where relname = 'church_groups'`)).rows[0].relrowsecurity === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
