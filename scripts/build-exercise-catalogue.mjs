// Build the exercise catalogue from the vendored public-domain dataset.
//
// The catalogue was 56 rows, hand-typed into supabase/parts/49. That is roughly
// a seventh of what a lifting app is expected to know, and a coach whose client
// does an exercise we have never heard of gets no demo, no muscle list and no
// instructions — the movement simply is not a thing to us.
//
// ── Why a generator and not a hand-written seed ────────────────────────────
//
// 900 rows of SQL cannot be reviewed by reading them. What CAN be reviewed is
// the rule that produced them, and this file is that rule. Re-running it must
// produce a byte-identical file, so nothing here reads the network or the clock
// — the dataset is vendored under data/ for exactly that reason.
//
// ── The one thing this refuses to do ───────────────────────────────────────
//
// It will not guess that two exercises are the same movement.
//
// Hevy's own site illustrates its DUMBBELL decline press with the BARBELL
// decline animation, on the page a trainer sent us as the example to follow.
// That is what fuzzy matching buys: a client is shown a different movement,
// under our name, confidently. Testing our 49 strength exercises against this
// dataset, a similarity match paired `Back Squat` with `Hack Squat` at 0.90 and
// `Hip Abduction` with `Cable Hip Adduction` — the opposite movement.
//
// So linking happens on EXACT slug equality and nothing else. That matches 14
// of our 49. The other 35 are written to a review file with candidates, for a
// human to confirm or reject one at a time. Fourteen right and thirty-five
// unanswered beats forty-nine plausible.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'data/free-exercise-db.json');
const OUT_SQL = join(ROOT, 'supabase/parts/71-exercise-catalogue.sql');
const OUT_REVIEW = join(ROOT, 'docs/exercise-mapping-review.tsv');
const SEED_49 = join(ROOT, 'supabase/parts/49-exercise-video-library.sql');
const MAPPING = join(ROOT, 'data/exercise-mapping.json');

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. The two MUST agree: it is
 *  the only thing that ties a program's exercise name to a catalogue row, and
 *  when it drifts the failure is silent — a demo simply stops resolving. */
const slug = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

/** Their seventeen primary muscles onto the eleven groups this app already
 *  shows. Not a taxonomy improvement — the app's filters, focus areas and
 *  progress-photo recommendations are all written against these names. */
const GROUP = {
  quadriceps: 'Legs', adductors: 'Legs', abductors: 'Glutes', glutes: 'Glutes',
  hamstrings: 'Hamstrings', calves: 'Calves', chest: 'Chest',
  lats: 'Back', 'middle back': 'Back', traps: 'Back', 'lower back': 'Lower back',
  shoulders: 'Shoulders', biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
  abdominals: 'Core', neck: 'Neck',
};

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs) => (!xs || !xs.length ? 'null' : `array[${xs.map(q).join(', ')}]`);

// ── read the 56 already in the catalogue ────────────────────────────────────
// Parsed from the existing seed rather than restated here, so this file cannot
// disagree with what is actually in the database.
const seedSql = readFileSync(SEED_49, 'utf8');
const existing = new Map();
for (const m of seedSql.matchAll(/\('([a-z0-9-]+)',\s*'((?:[^']|'')*)',\s*'([^']*)',\s*(true|false)\)/g)) {
  existing.set(m[1], { id: m[1], name: m[2].replace(/''/g, "'"), group: m[3], cardio: m[4] === 'true' });
}
if (existing.size < 50) {
  console.error(`build-exercise-catalogue: only parsed ${existing.size} rows from part 49 — the seed format moved.`);
  process.exit(1);
}

// ── the source ──────────────────────────────────────────────────────────────
const src = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = new Map();
const collisions = [];
const linked = [];

for (const x of src) {
  const id = slug(x.name);
  if (!id) continue;
  if (rows.has(id)) { collisions.push(`${x.name} and ${rows.get(id).name} both slug to ${id}`); continue; }
  const primary = (x.primaryMuscles || [])[0];
  const group = GROUP[primary] || 'Full body';
  const was = existing.get(id);
  // An id we already ship keeps ITS name and group. Programs, focus areas and
  // the recommendation map are written against those strings; swapping
  // 'Triceps Pushdown' for the dataset's spelling would quietly unlink them.
  if (was) linked.push({ id, ours: was.name, theirs: x.name });
  rows.set(id, {
    id,
    name: was ? was.name : x.name,
    group: was ? was.group : group,
    cardio: was ? was.cardio : x.category === 'cardio',
    category: x.category ?? null,
    equipment: x.equipment ?? null,
    level: x.level ?? null,
    mechanic: x.mechanic ?? null,
    force: x.force ?? null,
    primaryMuscles: x.primaryMuscles || [],
    secondaryMuscles: x.secondaryMuscles || [],
    instructions: x.instructions || [],
    images: x.images || [],
    source: 'free-exercise-db',
  });
}

// ── the confirmed mappings ──────────────────────────────────────────────────
//
// Decided by a person reading both names against the movement they describe,
// and recorded as data in data/exercise-mapping.json rather than as logic here.
// That file is the reviewable artefact: a wrong line in it is a wrong picture
// in front of a client, and it should be possible to check it without reading
// JavaScript.
//
// Our NAME and GROUP still win — only the media and the written steps come
// across. A mapping naming a movement the dataset does not have is a hard
// error, because the alternative is a row that silently stays blank while this
// file claims it was mapped.
const mapCfg = JSON.parse(readFileSync(MAPPING, 'utf8'));
const byName = new Map(src.map((x) => [x.name, x]));
const badMappings = [];
let mapped = 0;
for (const [id, sourceName] of Object.entries(mapCfg.mappings || {})) {
  const was = existing.get(id);
  if (!was) { badMappings.push(`${id} is not in the catalogue`); continue; }
  const x = byName.get(sourceName);
  if (!x) { badMappings.push(`${id} → "${sourceName}" — no dataset entry by that name`); continue; }
  if (rows.has(id) && rows.get(id).source === 'free-exercise-db') continue; // already exact-matched
  mapped++;
  rows.set(id, {
    id, name: was.name, group: was.group, cardio: was.cardio,
    category: x.category ?? null, equipment: x.equipment ?? null, level: x.level ?? null,
    mechanic: x.mechanic ?? null, force: x.force ?? null,
    primaryMuscles: x.primaryMuscles || [], secondaryMuscles: x.secondaryMuscles || [],
    instructions: x.instructions || [], images: x.images || [],
    source: 'repple+free-exercise-db',
  });
}
if (badMappings.length) {
  console.error(`build-exercise-catalogue: ${badMappings.length} bad mappings in data/exercise-mapping.json:`);
  for (const b of badMappings) console.error('  ' + b);
  process.exit(1);
}

// Our rows the dataset does not contain, and the ones nobody has confirmed,
// stay exactly as they are — no media and no instructions. That is an honest
// gap, not a row to invent.
let kept = 0;
for (const [id, was] of existing) {
  if (rows.has(id)) continue;
  kept++;
  rows.set(id, {
    ...was, category: null, equipment: null, level: null, mechanic: null, force: null,
    primaryMuscles: [], secondaryMuscles: [], instructions: [], images: [], source: 'repple',
  });
}

if (collisions.length) {
  console.error(`build-exercise-catalogue: ${collisions.length} slug collisions — two exercises cannot share an id:`);
  for (const c of collisions) console.error('  ' + c);
  process.exit(1);
}

// ── the review file: what a human still has to decide ───────────────────────
const confirmed = new Set(Object.keys(mapCfg.mappings || {}));
const declined = new Set(Object.keys(mapCfg.deliberately_unmapped || {}));
const unlinked = [...existing.values()].filter(
  (e) => !linked.some((l) => l.id === e.id) && !e.cardio && !confirmed.has(e.id) && !declined.has(e.id),
);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const score = (a, b) => {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(A.size, B.size);
};
const review = ['our_id\tour_name\tcandidate_1\tcandidate_2\tcandidate_3\tconfirmed_source_name'];
for (const e of unlinked) {
  const best = src.map((x) => ({ n: x.name, s: score(e.name, x.name) }))
    .sort((a, b) => b.s - a.s).slice(0, 3)
    .map((c) => `${c.n} (${c.s.toFixed(2)})`);
  review.push([e.id, e.name, ...best, ''].join('\t'));
}

// ── emit ────────────────────────────────────────────────────────────────────
const ordered = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const values = ordered.map((r) =>
  `  (${q(r.id)}, ${q(r.name)}, ${q(r.group)}, ${r.cardio}, ${q(r.category)}, ${q(r.equipment)}, `
  + `${q(r.level)}, ${q(r.mechanic)}, ${q(r.force)}, ${arr(r.primaryMuscles)}, ${arr(r.secondaryMuscles)}, `
  + `${arr(r.instructions)}, ${arr(r.images)}, ${q(r.source)})`,
).join(',\n');

const sql = `-- ─────────────────────────────────────────────────────────────────────────
-- The exercise catalogue: ${ordered.length} movements, up from ${existing.size}.
--
-- GENERATED by scripts/build-exercise-catalogue.mjs from the vendored
-- public-domain dataset at data/free-exercise-db.json. Do not hand-edit: the
-- next build overwrites it. Change the generator instead.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
-- The catalogue was ${existing.size} rows typed by hand, which is roughly a seventh of
-- what a lifting app is expected to know. An exercise we did not list had no
-- demo, no muscle list and no instructions — it was not a thing to us at all,
-- and a coach who wrote it into a program got nothing on the client's screen.
--
-- Every column beyond the original four carries what a client asks when they
-- do not know a movement: what it works, what equipment it needs, how hard it
-- is, and how to do it.
--
-- ── The ${linked.length} rows that were already ours ──────────────────────────────────
--
-- Where a dataset entry has the same slug as one we already ship, our NAME and
-- GROUP win and the rest is enrichment. Programs, focus areas and the
-- progress-photo recommendation map are written against our strings; taking the
-- dataset's spelling would silently unlink them.
--
-- ── The ${kept} rows the dataset does not have ─────────────────────────────────
--
-- Kept exactly as they were, with no instructions and no images. An honest gap
-- rather than an invented row. Which ones, and what they might map to, is in
-- docs/exercise-mapping-review.tsv — deliberately for a human, because a
-- similarity match paired 'Back Squat' with 'Hack Squat' at 0.90 and
-- 'Hip Abduction' with 'Cable Hip Adduction', the opposite movement.
--
-- ── Images ────────────────────────────────────────────────────────────────
--
-- \`image_paths\` holds RELATIVE paths into the source repository, not URLs and
-- not blobs. A URL bakes somebody else's uptime into our catalogue, and blobs
-- put 130MB of JPEG into a migration. Whatever serves them — our own bucket, a
-- CDN, or a licensed animation pack that replaces them entirely — resolves
-- these paths at read time, so swapping the media never touches this table.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.exercises add column if not exists category         text;
alter table public.exercises add column if not exists equipment        text;
alter table public.exercises add column if not exists level            text;
alter table public.exercises add column if not exists mechanic         text;
alter table public.exercises add column if not exists force            text;
alter table public.exercises add column if not exists primary_muscles   text[];
alter table public.exercises add column if not exists secondary_muscles text[];
alter table public.exercises add column if not exists instructions      text[];
alter table public.exercises add column if not exists image_paths       text[];
alter table public.exercises add column if not exists source            text;

comment on column public.exercises.image_paths is
  'Relative paths into the source dataset, resolved at read time — never URLs, so the media can be swapped without touching this table.';
comment on column public.exercises.source is
  'Where the row came from: ''repple'' for the hand-written originals, ''free-exercise-db'' for the public-domain import.';

insert into public.exercises
  (id, name, muscle_group, is_cardio, category, equipment, level, mechanic, force,
   primary_muscles, secondary_muscles, instructions, image_paths, source) values
${values}
on conflict (id) do update set
  -- name and muscle_group are deliberately NOT updated. A row already in the
  -- catalogue is referenced by programs and logs under the name it has.
  category          = excluded.category,
  equipment         = excluded.equipment,
  level             = excluded.level,
  mechanic          = excluded.mechanic,
  force             = excluded.force,
  primary_muscles   = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  instructions      = excluded.instructions,
  image_paths       = excluded.image_paths,
  source            = excluded.source;
`;

writeFileSync(OUT_SQL, sql);
writeFileSync(OUT_REVIEW, review.join('\n') + '\n');
// The same rows as JSON. The SQL is what the repo reviews and what a fresh
// database is built from; this is what an EXISTING database is loaded from,
// because 818KB of SQL cannot be handed to the migration API in one piece.
// Both come out of this one function, so the two cannot describe different
// catalogues — which is the entire reason the resolution rule lives here and
// is not re-implemented at the loading end.
writeFileSync(join(ROOT, 'data/exercise-catalogue.json'), JSON.stringify(ordered, null, 0));

console.log(
  `exercise catalogue: ${ordered.length} rows (was ${existing.size}) — `
  + `${linked.length} exact-matched, ${mapped} confirmed by hand, ${kept} left as they were, `
  + `${ordered.length - existing.size} new.\n`
  + `  ${OUT_SQL.replace(ROOT + '/', '')}\n`
  + `  ${OUT_REVIEW.replace(ROOT + '/', '')} — ${review.length - 1} mappings for a human to confirm`,
);
