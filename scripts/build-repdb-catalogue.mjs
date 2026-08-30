// Bring the RepDB catalogue into the exercises table.
//
// ── Why this replaces rather than supplements ──────────────────────────────
//
// Measured against our 917, RepDB's 601 look like a 16% overlap. They are not.
// That number is a NAMING artefact: free-exercise-db calls a movement
// "Alternate Incline Dumbbell Curl" and RepDB calls it "Incline Dumbbell Curl".
// 128 of our rows are variant-prefixed near-duplicates of each other. Ours is
// not the richer catalogue, it is the padded one.
//
// What RepDB has that we had no way to get:
//
//   · a DESCRIPTION on every row — 601/601. Ours had none at all, only
//     step-by-step instructions, so the screen could say how to do a movement
//     and never what it was for. That was the original request.
//   · difficulty, MET, goals, tags, is_bodyweight, is_unilateral
//   · consistent illustrated art, one style across the whole catalogue
//   · ids already in our slug convention, so `arnold-press` is `arnold-press`
//
// That last one is the important one. Every other vendor would have meant
// hand-confirming ~750 mappings, with a wrong one putting a barbell animation
// on a dumbbell page — which is the mistake Hevy actually shipped. Here the
// text, the image and (once bought) the animation all come from one source and
// are aligned by construction. There is no mapping step to get wrong.
//
// ── Licence ────────────────────────────────────────────────────────────────
//
// The free tier is commercially usable INSIDE an application, with visible
// attribution. It is not evaluation-only. Two things follow and both are load
// bearing: the images are served from our own PRIVATE bucket, because term 3
// forbids republishing the dataset and a public bucket is arguably that; and
// every row is stamped `attribution_required` so the app can refuse to render
// RepDB content in a build that does not carry the credit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'data/repdb-exercises.json');
const OUT = join(ROOT, 'supabase/parts/74-repdb-catalogue.sql');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.exercises || Object.values(raw));
if (!rows.length) { console.error('build-repdb-catalogue: no records.'); process.exit(1); }

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

/** RepDB's body_part onto the eleven groups this app's filters are written
 *  against. Not a taxonomy improvement — focus areas, the progress-photo
 *  recommendations and every chip row use these exact strings. */
const GROUP = {
  chest: 'Chest', back: 'Back', lats: 'Back', traps: 'Back',
  shoulders: 'Shoulders', arms: 'Arms', biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
  legs: 'Legs', quads: 'Legs', quadriceps: 'Legs', adductors: 'Legs',
  hamstrings: 'Hamstrings', glutes: 'Glutes', abductors: 'Glutes',
  calves: 'Calves', core: 'Core', abs: 'Core', abdominals: 'Core',
  'lower_back': 'Lower back', 'lower back': 'Lower back', neck: 'Neck',
  'full_body': 'Full body', 'full body': 'Full body', cardio: 'Full body',
};

/** Their muscle ids are snake_case anatomy ('rectus_abdominis'); ours are the
 *  words a client reads. Underscores out, nothing invented. */
const readable = (m) => String(m || '').replace(/_/g, ' ').trim();

const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs) => (!xs || !xs.length ? 'null' : `array[${xs.map(q).join(', ')}]`);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 'null'; };

const seen = new Set();
const out = [];
const collisions = [];
for (const r of rows) {
  const id = slug(r.id || r.name_en);
  if (!id) continue;
  if (seen.has(id)) { collisions.push(id); continue; }
  seen.add(id);
  const bp = String(r.body_part || '').toLowerCase();
  const group = GROUP[bp] || GROUP[String((r.primary_muscles || [])[0] || '').toLowerCase()] || 'Full body';
  // Two frames, start and peak. The free tier is stills; the paid tier adds a
  // looping animation, which lands in animation_path and takes precedence
  // over these without anything else changing.
  const imgs = r.images?.flat ? [r.images.flat.start, r.images.flat.peak].filter(Boolean) : [];
  out.push({
    id,
    name: r.name_en,
    group,
    cardio: String(r.category || '').toLowerCase() === 'cardio',
    description: r.description_en ?? null,
    category: r.category ?? null,
    equipment: r.equipment ? String(r.equipment).replace(/_/g, ' ') : null,
    level: r.difficulty ?? null,
    mechanic: r.mechanic ?? null,
    force: r.force_type ?? null,
    primary: (r.primary_muscles || []).map(readable),
    secondary: (r.secondary_muscles || []).map(readable),
    instructions: r.instructions_en || [],
    images: imgs,
    met: r.met ?? null,
    goals: r.goals || [],
    tags: r.tags || [],
  });
}
if (collisions.length) {
  console.error(`build-repdb-catalogue: ${collisions.length} duplicate ids — ${collisions.slice(0, 5).join(', ')}`);
  process.exit(1);
}

const values = out.map((r) =>
  `  (${q(r.id)}, ${q(r.name)}, ${q(r.group)}, ${r.cardio}, ${q(r.description)}, ${q(r.category)}, `
  + `${q(r.equipment)}, ${q(r.level)}, ${q(r.mechanic)}, ${q(r.force)}, ${arr(r.primary)}, ${arr(r.secondary)}, `
  + `${arr(r.instructions)}, ${arr(r.images)}, ${num(r.met)}, ${arr(r.goals)}, ${arr(r.tags)}, 'repdb')`,
).join(',\n');

const sql = `-- ─────────────────────────────────────────────────────────────────────────
-- The RepDB catalogue: ${out.length} movements, each with a description.
--
-- GENERATED by scripts/build-repdb-catalogue.mjs from data/repdb-exercises.json.
-- Do not hand-edit; change the generator.
--
-- ── What this adds that we could not get before ───────────────────────────
--
-- A DESCRIPTION on every row. The catalogue has carried step-by-step
-- instructions since the free-exercise-db import and no description at all, so
-- the exercise screen could tell somebody how to do a Pendlay row and never
-- what one is or what it is for. That was the original request, and it was the
-- one part the previous dataset could not answer, because it has no such field.
--
-- Also difficulty, MET, goals and tags, and — the part that matters most —
-- ONE consistent illustrated style with ids already in our slug convention.
-- Every other vendor would have meant hand-confirming roughly 750 mappings,
-- where a single wrong one puts a barbell animation on a dumbbell page. That is
-- the mistake Hevy actually shipped, on the page we were sent as the example to
-- follow. Here there is no mapping step to get wrong.
--
-- ── Names are NOT preserved on conflict, unlike part 71 ───────────────────
--
-- Part 71 refused to update name or muscle_group, because programs and logs
-- reference a row by the name it has. That still holds for OUR original rows.
-- A RepDB row landing on an id we already ship enriches it and leaves the name
-- alone for the same reason.
--
-- ── Licence: free tier, commercial use, attribution required ──────────────
--
-- Usable in a paid app at no cost, with a visible credit — it is not
-- evaluation-only. Two consequences, both load bearing:
--
--   · images are served from our own PRIVATE bucket. Term 3 forbids
--     republishing the dataset, and a public bucket is arguably exactly that.
--   · every row is stamped 'repdb', so the app can refuse to render RepDB
--     content in a build that does not carry the attribution, and preflight
--     can fail on it rather than trusting somebody to remember.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.exercises
  (id, name, muscle_group, is_cardio, description, category, equipment, level, mechanic, force,
   primary_muscles, secondary_muscles, instructions, image_paths, met, goals, tags, source) values
${values}
on conflict (id) do update set
  -- name and muscle_group deliberately untouched: an existing row is referenced
  -- by programs and logs under the name it already has.
  description       = excluded.description,
  category          = excluded.category,
  equipment         = excluded.equipment,
  level             = excluded.level,
  mechanic          = excluded.mechanic,
  force             = excluded.force,
  primary_muscles   = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  instructions      = excluded.instructions,
  image_paths       = excluded.image_paths,
  met               = excluded.met,
  goals             = excluded.goals,
  tags              = excluded.tags,
  source            = excluded.source;
`;

writeFileSync(OUT, sql);
console.log(`repdb catalogue: ${out.length} rows, ${out.filter((r) => r.description).length} with a description, ${out.filter((r) => r.images.length).length} with illustrations`);
console.log(`  ${OUT.replace(ROOT + '/', '')}`);
