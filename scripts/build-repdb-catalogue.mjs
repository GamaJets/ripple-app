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
const SUPERSEDED = join(ROOT, 'data/repdb-superseded.json');

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
/** [id RepDB gave us, id the name slugs to] for every row where the two differ.
 *  Emitted as a rename below — see the paragraph beside `renames`. */
const renames = [];
for (const r of rows) {
  // ── The id is the slug of the NAME WE DISPLAY, never RepDB's own ─────────
  //
  // This was `slug(r.id || r.name_en)`, on the reasonable-looking grounds that
  // RepDB's ids are already in our slug convention. For 521 of the 601 they
  // are. For 80 they are not: the row RepDB calls `bench-press` is named
  // "Barbell Bench Press", `bicep-curl` is "Dumbbell Bicep Curl",
  // `childs-pose` is "Child's Pose".
  //
  // That breaks the one rule the whole app is built on. A program stores an
  // exercise NAME; every screen that wants the catalogue entry — the client's,
  // the coach's, the owner's — resolves it with exerciseSlug(name). So those
  // 80 movements are in the catalogue and unreachable from it: tap "Barbell
  // Bench Press" and the screen looks up `barbell-bench-press`, finds nothing,
  // and says the movement is not in our catalogue. Illustrated, described, and
  // invisible.
  //
  // slug(name_en) is unique across all 601, so this costs nothing but the
  // rename below.
  const id = slug(r.name_en || r.id);
  if (!id) continue;
  if (seen.has(id)) { collisions.push(id); continue; }
  seen.add(id);
  const priorId = slug(r.id || r.name_en);
  if (priorId && priorId !== id) renames.push([priorId, id]);
  const bp = String(r.body_part || '').toLowerCase();
  const group = GROUP[bp] || GROUP[String((r.primary_muscles || [])[0] || '').toLowerCase()] || 'Full body';
  // Two frames, start and peak. The free tier is stills; the paid tier adds a
  // looping animation, which lands in animation_path and takes precedence
  // over these without anything else changing.
  // Stills. The free tier ships two SHAPES and only one was handled: 467
  // exercises give {start, peak} — a movement with two distinct positions —
  // and 134 give {main}, a single illustration for something that has no two
  // ends to show (a plank, a carry, a stretch held in place).
  //
  // Reading only start/peak left those 134 with no picture, which looked like
  // RepDB not covering them. It covers all 601; the generator was dropping a
  // fifth of them on the floor.
  const flat = r.images?.flat || {};
  const imgs = [flat.start, flat.peak, flat.main].filter(Boolean);
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
    // What a coach would say while watching, as distinct from the ordered
    // steps. Kept apart from instructions on purpose: a cue buried in the
    // middle of a numbered list is a cue nobody reads.
    tips: r.tips_en || [],
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
  + `${arr(r.instructions)}, ${arr(r.tips)}, ${arr(r.images)}, ${num(r.met)}, ${arr(r.goals)}, ${arr(r.tags)}, 'repdb')`,
).join(',\n');

/**
 * Move the rows an earlier run of this generator keyed by RepDB's own id onto
 * the id their name slugs to.
 *
 * Without this the fix above only helps a database that has never run this
 * part. One that HAS — production has, and it is where the 80 unreachable
 * movements actually are — would get 80 correct rows inserted alongside the 80
 * wrong ones, so the picker would list every one of them twice.
 *
 * Three guards, each for a specific way this could do damage:
 *
 *   · `source = 'repdb'` — never touch an id somebody else's import owns;
 *   · the `not exists` — if the destination id is already taken (usually by
 *     the free-exercise-db row for the same movement) the rename is skipped
 *     and the insert below simply enriches that row instead, which is the
 *     outcome we wanted anyway;
 *   · exact literals, computed by the one slug function in this file. The
 *     alternative was reimplementing exerciseSlug() in SQL, and a second copy
 *     of the identity rule is how the two drift apart silently.
 *
 * Idempotent: on a database that never ran the old version nothing matches.
 */
const renameSql = renames.length ? renames.map(([from, to]) =>
  `update public.exercises set id = ${q(to)}\n`
  + `  where id = ${q(from)} and source = 'repdb'\n`
  + `    and not exists (select 1 from public.exercises x where x.id = ${q(to)});`,
).join('\n') : '-- nothing to repoint: every RepDB id already equals the slug of its name.';

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

-- ── The four columns this part is the first to need ──────────────────────
--
-- Part 71 added category, equipment, level, mechanic, force and the arrays.
-- description, met, goals and tags arrived with RepDB and nothing declares
-- them, so the insert below named four columns that do not exist on a database
-- built from setup.sql — the whole part fails on \`column "description" of
-- relation "exercises" does not exist\`, and a fresh environment ends up with
-- the 917-row free-exercise-db catalogue and no descriptions at all, which is
-- the one thing this dataset was adopted for.
alter table public.exercises add column if not exists description text;
-- numeric(4,1) rather than bare numeric: production already carries these four
-- columns, added by hand, and met is 4,1 there. A fresh database built from
-- this file must match it exactly rather than nearly — two environments whose
-- column types differ is the drift check-schema.mjs exists to catch.
alter table public.exercises add column if not exists met         numeric(4,1);
alter table public.exercises add column if not exists goals       text[];
alter table public.exercises add column if not exists tags        text[];
-- Coaching cues, kept apart from the ordered steps in instructions: a cue
-- buried in the middle of a numbered list is a cue nobody reads.
alter table public.exercises add column if not exists tips        text[];

comment on column public.exercises.description is
  'What the movement IS, in one sentence — distinct from instructions, which are how to perform it. Null on rows that predate RepDB; a screen must say nothing rather than invent one.';

-- ── Every id is the slug of the name, including on a database already run ─
--
-- ${renames.length} of the ${out.length} rows were keyed by RepDB's own id, which for those is
-- not the slug of the name we display: RepDB's \`bench-press\` is named "Barbell
-- Bench Press". Every screen resolves a program's exercise NAME through
-- exerciseSlug(), so those rows were in the catalogue and unreachable from it —
-- illustrated, described, and answering "not in our catalogue" when tapped.
--
-- The insert below now keys on the name. This repoints the rows an earlier run
-- already wrote, so a database that has run this part is corrected rather than
-- given a second copy of all ${renames.length}. Skipped where the destination id is taken,
-- which means the free-exercise-db row for the same movement is there and the
-- insert enriches it instead.
${renameSql}

insert into public.exercises
  (id, name, muscle_group, is_cardio, description, category, equipment, level, mechanic, force,
   primary_muscles, secondary_muscles, instructions, tips, image_paths, met, goals, tags, source) values
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
  tips              = excluded.tips,
  image_paths       = excluded.image_paths,
  met               = excluded.met,
  goals             = excluded.goals,
  tags              = excluded.tags,
  source            = excluded.source;
`;


// ── the clean-up, emitted into the same file ───────────────────────────────
//
// Re-seeding re-inserts every RepDB row, including the fifteen our own
// catalogue already covers — so "Elliptical" reappears beside "Elliptical
// Trainer" every single time. That happened three times before this was
// written, each time caught by hand.
//
// A separate migration was the right shape and the wrong ergonomics: it
// depends on whoever re-seeds remembering to run it. Emitting it at the END of
// the seed makes the file idempotent on its own terms — insert everything,
// then leave the catalogue in the state it is supposed to be in.
//
// The media transfer comes FIRST and matters: our row keeps its name, so it
// has to take the refreshed illustration off the twin before the twin is
// deleted. Skipping that is how Elliptical, Treadmill and Upright Bike ended
// up the only rows in the catalogue with no picture at all.
const sup = JSON.parse(readFileSync(SUPERSEDED, 'utf8'));
// Each entry is { repdb_id, repdb_name }. Both are needed: the clean-up below
// also RE-KEYS RepDB rows to the slug of their name, so a twin that survived an
// earlier run comes back under a different id — 'squat' becomes
// 'barbell-back-squat' — and a delete keyed on the id then matches nothing
// while the duplicate sits in the catalogue. Four survived three rounds of
// clean-up exactly that way. The name does not move.
const pairs = Object.entries(sup.ours_wins || {}).map(([ours, v]) => [ours, v.repdb_id, v.repdb_name]);
const dupes = Object.keys(sup.our_own_duplicates || {});
const cleanup = `
-- ─────────────────────────────────────────────────────────────────────────
-- Clean-up, so this file leaves the catalogue in the state it should be in.
--
-- Everything above inserts the whole RepDB catalogue, which includes the
-- ${pairs.length} movements our own rows already cover under our own names. Without this,
-- re-seeding puts "Elliptical" back beside "Elliptical Trainer" — which it did
-- three times before this was written.
--
-- Our row wins on NAME, because src/lib/machines.ts resolves a scanned gym
-- machine by name and src/lib/focus.ts and buildProgram() emit those strings.
-- It takes the twin's media first: our row keeps its own name, so it has to
-- inherit the refreshed illustration BEFORE the twin is deleted.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare refs integer;
begin
  select (select count(*) from public.exercise_videos)
       + (select count(*) from public.workout_logs) into refs;
  if refs > 0 then
    raise exception 'Refusing to de-duplicate the catalogue: % rows reference it.', refs;
  end if;
end $$;

with m(ours, theirs) as (values
${pairs.map(([a, b]) => `    (${q(a)}, ${q(b)})`).join(',\n')}
)
update public.exercises tgt
set image_paths = coalesce(src.image_paths, tgt.image_paths),
    tips        = coalesce(src.tips, tgt.tips),
    description = coalesce(src.description, tgt.description),
    instructions = coalesce(src.instructions, tgt.instructions)
from m join public.exercises src on src.id = m.theirs
where tgt.id = m.ours;

-- By id AND by name. The re-key below moves a RepDB row to the slug of its
-- name, so a twin that outlived an earlier run is no longer sitting at the id
-- this list knows it by. Matching the name as well catches it wherever it
-- ended up, and matching the source column keeps the delete off our own rows,
-- which carry the same movement under our own name.
delete from public.exercises where id in (
${pairs.map(([, b]) => `  ${q(b)}`).concat(dupes.map((d) => `  ${q(d)}`)).join(',\n')}
);

delete from public.exercises
where source = 'repdb'
  and name in (
${pairs.map(([, , n]) => `  ${q(n)}`).join(',\n')}
  );

-- Any row still keyed by RepDB's own id rather than by the slug of the name it
-- displays. Every screen resolves through exerciseSlug(name), so a row keyed
-- otherwise is in the catalogue and unreachable from it.
update public.exercises e
set id = t.want
from (
  select id, trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) as want
  from public.exercises where source = 'repdb'
) t
where e.id = t.id and e.id <> t.want and t.want <> ''
  and not exists (select 1 from public.exercises x where x.id = t.want);
`;

writeFileSync(OUT, sql + cleanup);
console.log(`repdb catalogue: ${out.length} rows, ${out.filter((r) => r.description).length} with a description, ${out.filter((r) => r.tips.length).length} with coaching tips, ${out.filter((r) => r.images.length).length} with illustrations`);
console.log(`  ${OUT.replace(ROOT + '/', '')}`);
