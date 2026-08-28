#!/usr/bin/env node
// Every read must look at `error`.
//
// This is the bug this codebase keeps producing. supabase-js does not reject on
// a database error — it RESOLVES, with `error` set and `data` null. So
//
//     const { data } = await supabase.from('x').select('*');
//     return data ?? [];
//
// turns every failure into a confident empty answer, and the screen above it
// then says something specific and false: "No purchases yet" to somebody who
// has paid, "No feedback yet" to an owner whose testers are talking, "0
// sessions left" to a client holding ten.
//
// It has been found and fixed by hand at least nine times in this repo, each
// time by someone noticing a wrong sentence on a screen. Hand-searching does
// not hold a line; this does.
//
// A read that genuinely does not care about failure is allowed — say so on the
// line above and say why:
//
//     // eslint-disable-next-line -- no-error-ok: a tie-break; absent is the same as none
//     const { data } = await supabase.from('clients').select('trainer_id')…
//
// The marker is `no-error-ok:` followed by a reason. The reason is the point:
// it is the sentence a reviewer reads when deciding whether a fabricated empty
// answer is honestly indistinguishable from a true one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The web console reads the same tables through the same client, so it has the
// same failure mode and gets the same rule.
const ROOTS = ['src', 'app', 'studio-web/app', 'studio-web/lib'];
const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
for (const r of ROOTS) { try { walk(r); } catch { /* a root that is not there yet */ } }
// A check that inspects no files passes every time. The first version of this
// walked from '.' and filtered for paths starting './src/', which join()
// normalises away — it reported success having read nothing.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

const offenders = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // A destructure that takes `data` (possibly renamed) and never `error`.
    if (!/const\s*\{[^}]*\bdata\b[^}]*\}\s*=\s*await\b/.test(line)) return;
    if (/\berror\b/.test(line)) return;
    // Auth calls carry their own error shape and are read separately.
    if (/supabase\.auth\./.test(line)) return;
    // Not a real read — a comment describing one.
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const above = lines.slice(Math.max(0, i - 3), i).join('\n');
    if (/no-error-ok:\s*\S/.test(above)) return;
    offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
}

if (offenders.length) {
  console.error(`${offenders.length} read${offenders.length === 1 ? '' : 's'} that cannot tell failure from emptiness:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nRead `error`, and return null rather than an empty answer — or mark the line');
  console.error('`no-error-ok: <why an empty answer is honest here>` if failure genuinely does not matter.');
  process.exit(1);
}
console.log(`reads ok — ${files.length} files across the apps and the console; every read either checks error or says why it need not.`);
