// Two invariants the exercise catalogue must hold, both learned the hard way.
//
// ── 1. Every scanner target must exist in the catalogue ───────────────────
//
// src/lib/machines.ts maps a scanned gym machine to an exercise BY NAME — a
// client photographs a Smith Machine and the app names the movement. If a
// retirement removes the row that name resolves to, scanning still succeeds and
// then opens a screen saying the movement is not in our catalogue. Nothing
// fails; the feature just quietly stops working for that machine.
//
// This nearly happened: "Cable Machine" and "Smith Machine" were about to be
// deleted as "equipment, not movements" — which is true, and is exactly why
// they are in the machine list.
//
// ── 2. Every id must be the slug of its own name ──────────────────────────
//
// Every screen resolves a movement through exerciseSlug(name). A row keyed by
// anything else is in the catalogue and unreachable from it: 68 rows arrived
// that way from RepDB, where 'squat' is "Barbell Back Squat" and 'childs-pose'
// is "Child's Pose". They listed in the picker, showed an illustration and a
// description, and answered "not in our catalogue" when tapped.
//
// Both are checked against the LIVE database, because both are properties of
// the data rather than of the code, and the code cannot be read to discover
// them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

// The machine list, read from source. src/lib/machines.ts is what the scanner
// resolves a photographed machine against, so every name in it has to name a
// row that exists.
const machinesSrc = readFileSync(join(ROOT, 'src/lib/machines.ts'), 'utf8');
const machineNames = [...machinesSrc.matchAll(/name:\s*'((?:[^'\\]|\\.)*)'/g)]
  .map((m) => m[1].replace(/\\'/g, "'"));
if (machineNames.length < 20) {
  console.error(`check-catalogue: only parsed ${machineNames.length} machines from src/lib/machines.ts — the format moved.`);
  process.exit(1);
}

// Read from the GENERATED SQL rather than from the live database. That file is
// what builds the catalogue, it is in the repo, and it needs no credentials —
// so this runs in CI and on a laptop, and it fails on the commit that
// introduces the fault rather than on whoever deploys next. The anon key cannot
// read `exercises` (RLS), which rules out the live route anyway.
const partFiles = ['supabase/parts/49-exercise-video-library.sql', 'supabase/parts/74-repdb-catalogue.sql'];
const rows = [];
for (const f of partFiles) {
  let src;
  try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  // ('id', 'Name', … — the leading two columns of every seeded row.
  for (const m of src.matchAll(/\n\s*\('([a-z0-9-]+)',\s*'((?:[^']|'')*)'/g)) {
    rows.push({ id: m[1], name: m[2].replace(/''/g, "'") });
  }
}
if (rows.length < 100) {
  // A guard that silently stops guarding is how both of the faults above
  // survived. An empty parse is a failure, never a clean run.
  console.error(`check-catalogue: only parsed ${rows.length} rows from the seed files — the format moved.`);
  process.exit(1);
}

const problems = [];
const ids = new Set(rows.map((r) => r.id));

for (const n of machineNames) {
  if (!ids.has(slug(n))) {
    problems.push(
      `src/lib/machines.ts offers "${n}" to the machine scanner, and no seeded row has the id "${slug(n)}". `
      + 'Scanning that machine would name a movement the app cannot open.',
    );
  }
}

const unreachable = rows.filter((r) => r.id !== slug(r.name));
for (const r of unreachable.slice(0, 10)) {
  problems.push(
    `"${r.name}" is seeded as "${r.id}" but resolves as "${slug(r.name)}". `
    + 'Every screen looks a movement up by the slug of its name, so this row would be in the catalogue and unreachable from it.',
  );
}
if (unreachable.length > 10) problems.push(`…and ${unreachable.length - 10} more whose id is not the slug of their name.`);

if (problems.length) {
  console.error(`${problems.length} catalogue problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log(
  `catalogue ok — ${rows.length} seeded exercises, every id is the slug of its own name, `
  + `and all ${machineNames.length} machine-scanner targets resolve.`,
);
