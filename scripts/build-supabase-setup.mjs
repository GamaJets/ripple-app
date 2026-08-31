#!/usr/bin/env node
// Regenerates supabase/setup.sql by concatenating supabase/parts/*.sql in
// filename order. The number prefix IS the dependency order — 22 must stay last,
// because it re-narrows the sessions_client_read policy that 09 defines wide.
//
//   node scripts/build-supabase-setup.mjs          rebuild setup.sql
//   node scripts/build-supabase-setup.mjs --check   fail if setup.sql is stale
//
// setup.sql is generated. Edit the part, never the bundle.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PARTS = 'supabase/parts';
const OUT = 'supabase/setup.sql';

const header = `-- ═══════════════════════════════════════════════════════════════════════════
-- Repple — ONE-SHOT Supabase setup. Paste this whole file into the Supabase
-- SQL editor (Dashboard ▸ SQL Editor ▸ New query) and Run.
-- Every part below is idempotent; order is dependency-correct and safe to re-run.
-- GENERATED from supabase/parts/*.sql by scripts/build-supabase-setup.mjs.
-- Do not hand-edit — edit the part and rebuild.
-- ═══════════════════════════════════════════════════════════════════════════
`;

// Sorted by the NUMBER in the prefix, not by the string.
//
// A plain .sort() is lexicographic, and the first three-digit part broke the
// one rule this file states: '100-ad-accounts.sql' sorts between '09-' and
// '10-', because '0' < '1' at the second character. Part 100 references tables
// created in parts 81 and 98, so the bundle it produced failed on the first
// statement — and it failed in the Supabase SQL editor, on a paste, with no
// build step anywhere that could have caught it.
//
// The prefix is the dependency order. This makes the sort agree with that
// sentence for parts 100 and up, and is identical to the old behaviour for
// every part below it. A file with no numeric prefix keeps its place by name.
const partNumber = (f) => {
  const m = /^(\d+)-/.exec(f);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};
const files = readdirSync(PARTS)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => partNumber(a) - partNumber(b) || a.localeCompare(b));
if (!files.length) { console.error(`no parts found in ${PARTS}`); process.exit(1); }

const body = files
  .map((f) => `\n-- ▶ ${f.replace(/^\d+-/, '')}\n\n${readFileSync(join(PARTS, f), 'utf8').trimEnd()}\n`)
  .join('');
const built = header + body;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== built) {
    console.error(`${OUT} is stale — run: node scripts/build-supabase-setup.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${files.length} parts)`);
} else {
  writeFileSync(OUT, built);
  console.log(`wrote ${OUT} from ${files.length} parts`);
}
