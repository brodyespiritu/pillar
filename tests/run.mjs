// Every check on Pillar's own code, one after another, with a line each and a total at the end.
// Run from here:  npm install && npm test   (or: node run.mjs)
//
// The SQL files have their own suites in ../supabase/tests. A few checks here read the app's
// source too, to prove Pillar and the app agree — they find it beside Pillar (../../BethesdaApp),
// or wherever BETHESDA_APP points.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const suites = fs.readdirSync(HERE).filter((f) => /\.test\.(mjs|cjs)$/.test(f)).sort();

let failed = 0;
for (const f of suites) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { cwd: HERE, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
  // the summary is the last thing a suite prints to stdout; stderr carries the renderer's notices
  const said = (r.stdout || '').trim().split('\n');
  const last = said[said.length - 1] || out[out.length - 1] || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${f.replace(/\.test\.(mjs|cjs)$/, '').padEnd(12)} ${last}`);
  if (!ok) console.log(out.slice(-12).map((l) => `    ${l}`).join('\n'));
}
console.log(`\n${suites.length - failed} of ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
