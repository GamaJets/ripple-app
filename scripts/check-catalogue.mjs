// The exercise catalogue, checked as the thing the parts actually BUILD.
//
// ── What this used to do, and why that was not enough ─────────────────────
//
// It read the INSERT blocks of parts 49 and 74 and checked two invariants over
// the union. Three things were wrong with that, and all three had been wrong
// since it was written:
//
//   · it never opened part 71, the 917-row free-exercise-db seed — the largest
//     slice of the catalogue was unchecked;
//   · it never opened parts 75 and 76, which DELETE 783 rows and 16 rows
//     respectively. A union of inserts is not the catalogue. A machine-scanner
//     target could be seeded by 49 and deleted by 75 and this file would have
//     called it present;
//   · nothing made it fail when a new part started writing to the table. It
//     read two of the five parts that do, and it read them from a hard-coded
//     list, so the day part 71 arrived the guard silently narrowed and said so
//     to nobody.
//
// So it now runs the parts. Not as SQL — there is no database here — but as a
// model: an ordered replay of every INSERT, DELETE and id-rekey that any part
// aims at public.exercises, ending in the set of (id, name, source) a fresh
// `supabase/setup.sql` produces. The invariants are then checked against that
// final state, which is the thing a new environment will actually have.
//
// ── The invariants ────────────────────────────────────────────────────────
//
// 1. EVERY SCANNER TARGET EXISTS. src/lib/machines.ts maps a photographed gym
//    machine to an exercise BY NAME. If a retirement removes the row that name
//    resolves to, scanning still succeeds and then opens a screen saying the
//    movement is not in our catalogue. Nothing fails; the feature quietly stops
//    working for that machine. This nearly happened: "Cable Machine" and
//    "Smith Machine" were about to be deleted as "equipment, not movements" —
//    which is true, and is exactly why they are in the machine list.
//
// 2. EVERY ID IS THE SLUG OF ITS OWN NAME. Every screen resolves a movement
//    through exerciseSlug(name). A row keyed by anything else is in the
//    catalogue and unreachable from it: 68 rows arrived that way from RepDB,
//    where 'squat' is "Barbell Back Squat". They listed in the picker, showed
//    an illustration and a description, and answered "not in our catalogue"
//    when tapped.
//
// 3. ONE CATALOGUE, NOT TWO. Nothing may survive into the final state carrying
//    a free-exercise-db stamp. Part 75 retired that dataset in favour of RepDB
//    because mixing photographs with illustrations was the seam RepDB was
//    adopted to remove, and because bought animations attach to RepDB ids, so
//    the older rows could never have caught up. A surviving
//    'repple+free-exercise-db' row is not a cosmetic stamp: frameUrls()
//    resolves its images against a host this app retired, and it is almost
//    always a row shadowing the RepDB movement of the same name under a
//    different id. This is the invariant that caught the drift this file was
//    widened for — see the note at the bottom.
//
// 4. EVERY PART THAT WRITES TO THE TABLE IS MODELLED HERE. The list below is
//    checked against a scan of supabase/parts for DML against public.exercises.
//    A part that writes and is not modelled fails this file rather than
//    silently shrinking it, which is fault three above, fixed.
//
// ── What this deliberately cannot see ─────────────────────────────────────
//
// It models the parts; it does not execute them, and it is not the database.
// Specifically it does NOT know about:
//
//   · PRODUCTION. It cannot connect — `exercises` is behind RLS and the anon
//     key cannot read it. It says what a FRESH environment gets. Where
//     production differs, that is a ledger fault to be found by comparing the
//     two by hand, as was done on 4 Sep 2026; this file cannot notice it.
//   · rows a coach types (`source = 'coach'`; 4 in production). They are not
//     seeded and no part mentions them.
//   · anything conditional. A `where` clause more interesting than the ones
//     below, a `do $$` block, a trigger, a partial index — none of it is
//     modelled. The four statement shapes it understands are listed in
//     `replay()`; a part using a fifth trips invariant 4 and has to be taught.
//   · CONTENT. Whether a description reads well, whether an image path
//     resolves, whether met is plausible. It checks identity and reachability
//     only.
//   · demo clips. `animation_path` is written by scripts/sync-exercise-demos.mjs
//     and by no part at all, so a movement with no clip is invisible here.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PARTS = join(ROOT, 'supabase/parts');

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

// ── The parts that write to public.exercises, in the order the bundle runs
// them. scripts/build-supabase-setup.mjs sorts by the NUMBER in the prefix, so
// this list is sorted the same way and not lexicographically.
//
// `source` is what a row ends up stamped with when THIS part writes it. Part 49
// predates the column entirely; part 71 adds it, and stamps a row it merely
// enriches differently from one it creates, which is why it carries two.
const WRITERS = [
  { file: '49-exercise-video-library.sql', insertSource: null },
  { file: '71-exercise-catalogue.sql', insertSource: 'free-exercise-db', upsertSource: 'repple+free-exercise-db' },
  { file: '74-repdb-catalogue.sql', insertSource: 'repdb' },
  { file: '75-retire-superseded-exercises.sql' },
  { file: '76-catalogue-dedupe-rekey.sql' },
  { file: '2260-a-fresh-database-would-have-built-a-different-catalogue.sql' },
];

const problems = [];

// ── Invariant 4, first, because everything below trusts the list ──────────
const dml = /(?:insert\s+into|update|delete\s+from)\s+public\.exercises\b/;
const modelled = new Set(WRITERS.map((w) => w.file));
const writersOnDisk = readdirSync(PARTS)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => dml.test(readFileSync(join(PARTS, f), 'utf8')));
for (const f of writersOnDisk) {
  if (!modelled.has(f)) {
    problems.push(
      `supabase/parts/${f} writes to public.exercises and check-catalogue.mjs does not model it. `
      + 'Add it to WRITERS and teach replay() the statements it uses. A seed this file cannot see is a seed nobody checks — '
      + 'part 71, the largest one, went unchecked for exactly this reason.',
    );
  }
}
for (const w of WRITERS) {
  if (!writersOnDisk.includes(w.file)) {
    problems.push(
      `check-catalogue.mjs models supabase/parts/${w.file}, which no longer writes to public.exercises (or no longer exists). `
      + 'Remove it from WRITERS.',
    );
  }
}
if (problems.length) fail();

// ── Replay ────────────────────────────────────────────────────────────────
//
// The four statement shapes the parts use, and nothing else:
//
//   A. insert into public.exercises … values (…) on conflict (id) do nothing
//      / do update  — reads the first two columns of each row, which are
//      always (id, name). `do update` never touches name or muscle_group in
//      any part, deliberately, so the model does not either.
//   B. update public.exercises set id = 'x' where id = 'y' and source = 'repdb'
//      and not exists (… x.id = 'x')  — part 74's 80 repairs.
//   C. delete … where source is distinct from 'repdb' and id not in (protected)
//      — part 75.
//   D. delete from public.exercises where id in ('a','b',…)  — parts 76, 2260.
//
// plus part 76's rekey-by-slug, which is shaped like B but computed, and the
// `source` rewrites in 75 and 2260, which change no ids and are modelled only
// so invariant 3 sees the right stamps.
//
// `table` is id → { name, source, from }. `from` is the part that created the
// row, and exists so a failure can name a file rather than a slug.
const table = new Map();

const insertsIn = (src) => {
  const out = [];
  for (const block of src.matchAll(/insert into public\.exercises[\s\S]*?\bvalues\b([\s\S]*?)\non conflict(?: \(id\))? do (nothing|update)/g)) {
    const upsert = block[2] === 'update';
    // Only the INSERT's VALUES block. The seeds also carry clean-ups whose
    // mapping pairs — ('ab-crunch', 'crunches') — are indistinguishable from
    // ('id', 'Name') to a regex, and reading those as exercises reported eleven
    // rows as unreachable that do not exist. A guard that cries wolf is a guard
    // people learn to skip.
    for (const m of block[1].matchAll(/\n\s*\('([a-z0-9-]+)',\s*'((?:[^']|'')*)'/g)) {
      out.push({ id: m[1], name: m[2].replace(/''/g, "'"), upsert });
    }
  }
  return out;
};

const listIn = (s) => [...s.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

let seeded = 0;
for (const w of WRITERS) {
  const src = readFileSync(join(PARTS, w.file), 'utf8');

  // B — explicit rekeys, before this part's own insert, which is the order
  // part 74 writes them in and the order they must run in.
  for (const m of src.matchAll(/update public\.exercises set id = '([a-z0-9-]+)'\s*\n\s*where id = '([a-z0-9-]+)' and source = '([a-z0-9-]+)'/g)) {
    const [, to, from, wantSource] = m;
    const row = table.get(from);
    if (row && row.source === wantSource && !table.has(to)) {
      table.delete(from);
      table.set(to, row);
    }
  }

  // A — inserts.
  for (const r of insertsIn(src)) {
    seeded++;
    const existing = table.get(r.id);
    if (existing) {
      // name and muscle_group are never updated on conflict, in any part.
      if (r.upsert && w.upsertSource !== undefined) existing.source = w.upsertSource;
      else if (r.upsert) existing.source = w.insertSource;
    } else {
      table.set(r.id, { name: r.name, source: w.insertSource ?? null, from: w.file });
    }
  }

  // C — part 75's retirement: everything not RepDB and not protected.
  const retire = src.match(/with protected\(id\) as \(values ([\s\S]*?)\)\ndelete from public\.exercises e\n\s*where e\.source is distinct from '([a-z0-9-]+)'/);
  if (retire) {
    const keep = new Set(listIn(retire[1]));
    const spare = retire[2];
    for (const [id, row] of [...table]) if (row.source !== spare && !keep.has(id)) table.delete(id);
  }

  // The `with m(ours, theirs)` content copies in 75 and 2260. No id moves; the
  // target takes the source stamp, which invariant 3 reads.
  for (const block of src.matchAll(/with m\(ours, theirs\) as \(values([\s\S]*?)\n\)\nupdate public\.exercises[\s\S]*?source\s+= '([a-z0-9-]+)'/g)) {
    const stamp = block[2];
    for (const m of block[1].matchAll(/\('([a-z0-9-]+)',\s*'([a-z0-9-]+)'\)/g)) {
      if (table.has(m[1]) && table.has(m[2])) table.get(m[1]).source = stamp;
    }
  }

  // Bare `update … set source = 'x' where id in (…) and source = 'y'`.
  for (const m of src.matchAll(/update public\.exercises\nset source = '([a-z0-9-]+)'\nwhere id in \(([^)]*)\)\n\s*and source = '([a-z0-9+-]+)'/g)) {
    const [, to, ids, fromSource] = m;
    for (const id of listIn(ids)) {
      const row = table.get(id);
      if (row && row.source === fromSource) row.source = to;
    }
  }

  // D — delete by explicit id list.
  for (const m of src.matchAll(/delete from public\.exercises\nwhere id in \(([\s\S]*?)\);/g)) {
    for (const id of listIn(m[1])) table.delete(id);
  }

  // Part 76's rekey-by-slug: same shape as B, computed rather than listed.
  if (/update public\.exercises e\nset id = t\.want/.test(src)) {
    for (const [id, row] of [...table]) {
      if (row.source !== 'repdb') continue;
      const want = slug(row.name);
      if (id !== want && want && !table.has(want)) { table.delete(id); table.set(want, row); }
    }
  }
}

if (seeded < 1000) {
  // A guard that silently stops guarding is how both of the faults above
  // survived. A short parse is a failure, never a clean run. The parts insert
  // 1574 rows between them; 1000 is a floor, not a target.
  console.error(`check-catalogue: only parsed ${seeded} inserted rows from ${WRITERS.length} parts — the format moved.`);
  process.exit(1);
}
if (table.size < 400) {
  console.error(`check-catalogue: the replay ends with only ${table.size} exercises — a delete matched more than it should have, or the format moved.`);
  process.exit(1);
}

// ── Invariant 1 ───────────────────────────────────────────────────────────
const machinesSrc = readFileSync(join(ROOT, 'src/lib/machines.ts'), 'utf8');
const machineNames = [...machinesSrc.matchAll(/name:\s*'((?:[^'\\]|\\.)*)'/g)]
  .map((m) => m[1].replace(/\\'/g, "'"));
if (machineNames.length < 20) {
  console.error(`check-catalogue: only parsed ${machineNames.length} machines from src/lib/machines.ts — the format moved.`);
  process.exit(1);
}
for (const n of machineNames) {
  if (!table.has(slug(n))) {
    problems.push(
      `src/lib/machines.ts offers "${n}" to the machine scanner, and a fresh database ends with no row keyed "${slug(n)}". `
      + 'Scanning that machine would name a movement the app cannot open.',
    );
  }
}

// ── Invariant 2 ───────────────────────────────────────────────────────────
const unreachable = [...table].filter(([id, row]) => id !== slug(row.name));
for (const [id, row] of unreachable.slice(0, 10)) {
  problems.push(
    `"${row.name}" ends up keyed "${id}" but resolves as "${slug(row.name)}" (seeded by ${row.from}). `
    + 'Every screen looks a movement up by the slug of its name, so this row would be in the catalogue and unreachable from it.',
  );
}
if (unreachable.length > 10) problems.push(`…and ${unreachable.length - 10} more whose id is not the slug of their name.`);

// ── Invariant 3 ───────────────────────────────────────────────────────────
const stranded = [...table].filter(([, row]) => row.source === 'free-exercise-db' || row.source === 'repple+free-exercise-db');
for (const [id, row] of stranded.slice(0, 10)) {
  problems.push(
    `"${row.name}" (${id}) survives into a fresh database stamped '${row.source}'. `
    + 'Part 75 retired free-exercise-db in favour of RepDB: frameUrls() resolves this row\'s images against a host the app no longer serves, '
    + 'and a row left behind this way is usually shadowing the RepDB movement of the same name under a different id.',
  );
}
if (stranded.length > 10) problems.push(`…and ${stranded.length - 10} more still carrying a free-exercise-db stamp.`);

if (problems.length) fail();

const bySource = {};
for (const [, row] of table) bySource[row.source ?? 'unstamped'] = (bySource[row.source ?? 'unstamped'] ?? 0) + 1;
console.log(
  `catalogue ok — ${WRITERS.length} parts replayed to ${table.size} exercises `
  + `(${Object.entries(bySource).map(([k, v]) => `${v} ${k}`).join(', ')}), `
  + `every id is the slug of its own name, and all ${machineNames.length} machine-scanner targets resolve.`,
);

function fail() {
  console.error(`${problems.length} catalogue problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
