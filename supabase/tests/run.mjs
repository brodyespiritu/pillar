// Every SQL suite in this folder, one after another, with a line each and a total at the end.
// Run from here:  npm install && npm test   (or: node run.mjs)
//
// Each suite builds its own throwaway Postgres in memory (PGlite), applies the real files from
// ../ and checks what they promise. Nothing here ever connects to the church's Supabase project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const suites = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const f of suites) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { cwd: HERE, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
  const said = (r.stdout || '').trim().split('\n');
  const last = said[said.length - 1] || out[out.length - 1] || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${f.replace('.test.mjs', '').padEnd(24)} ${last}`);
  if (!ok) console.log(out.slice(-12).map((l) => `    ${l}`).join('\n'));
}
console.log(`\n${suites.length - failed} of ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
