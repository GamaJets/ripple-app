// "I want to train triceps" — the member names the target, this builds the week.
//
// Asked for by a member through the owner, in two sentences that are two
// different features: "they want the ability to say i want to train for example
// 'triceps' and the app builds a workout for triceps for them to follow", and
// "they should be able to select what muscle groups they want to work out and
// the app builds the workout program for them".
//
// ── Triceps is not a muscle group, and that is the whole problem ──────────
//
// `public.exercises` carries the body at TWO resolutions and they are not the
// same list:
//
//   `muscle_group`      11 coarse values — Full body, Core, Legs, Chest, Back,
//                       Shoulders, Glutes, Hamstrings, Calves, Lower back, Arms.
//   `primary_muscles`   27 anatomical names — 'triceps brachii', 'latissimus
//                       dorsi', 'gluteus medius'.
//
// "Triceps" lives only in the second one. Serving a member who asked for
// triceps out of the Arms group would hand them biceps curls and forearm work
// and call it what they asked for; serving them out of `primary_muscles` gives
// 50 movements that actually train the muscle they named. So this file takes
// BOTH kinds of target and keeps them apart: a `muscle` target is matched on
// `primary_muscles`, a `group` target on `muscle_group`, and nothing here ever
// quietly promotes one to the other.
//
// ── Why the friendly names are a map and not a prettifier ─────────────────
//
// Nobody says "latissimus dorsi". They say lats. And the translation is not a
// tidy-up of the string — it is one-to-MANY in both directions and the pairs
// are anatomical facts, not spellings:
//
//   Biceps   -> biceps brachii, brachialis, brachioradialis   (three muscles)
//   Calves   -> gastrocnemius, soleus
//   Shoulders-> anterior, lateral and posterior deltoid       (110 movements)
//   Glutes   -> gluteus maximus, gluteus medius
//
// A `startsWith` or a word-strip cannot produce any of those, and the one it
// would produce for "Biceps" — biceps brachii alone — silently drops the 14
// movements filed under brachialis and brachioradialis. So it is written out,
// the catalogue's spelling on one side and the member's on the other, and
// `MUSCLE_TARGETS` is checked against the live table by the test.
//
// The catalogue's 27 names are all spoken for. A muscle nobody put in this map
// would be unreachable through the one control whose job is reaching it, which
// is why the test asserts the whole set rather than the entries it likes.
//
// ── Where this meets "No equipment", and what it must refuse to do ────────
//
// The no-kit option built alongside this (src/lib/equipmentFacet.ts, and
// src/lib/noKitProgram.ts which composes a whole week out of it) composes with
// this one, and the combination has real holes in it. Counted against the live
// table: biceps brachii 33 movements / 0 without equipment, rhomboids 31/0,
// brachialis 10/0, forearm extensors 6/0, brachioradialis 4/0, quadratus
// lumborum 1/0. "Biceps" plus "No equipment" is an EMPTY SET, and there are
// exactly three dishonest ways out of it: serve the triceps instead because
// they are also arms, serve a biceps movement that needs a dumbbell anyway, or
// return four movements and let the screen imply that is the whole answer.
//
// The honest way out is the fourth: build what can be built, and hand back a
// per-target report naming what could not be served and WHY — nothing in the
// catalogue at all, or nothing that can be done with no equipment. That is
// `TargetCoverage`, and `targetedCoverageNote` says it in words.
//
// ── Nothing here reads ────────────────────────────────────────────────────
//
// The caller passes the rows it already holds, the same contract
// `noKitProgram` keeps and for the same reason: a failed catalogue read must
// never arrive at a member as "there are no triceps exercises". An empty
// `rows` produces an empty program and a report that says the pool was empty,
// and the screen decides what that means.
import { needsNoKit, type KitRow } from './equipmentFacet';
import { exerciseSlug } from './exerciseId';
import { dayNameAt, isStretch, list, repsFor, setsFor } from './noKitProgram';
import type { Program, ProgramDay, ProgramExercise } from './programs';

/** A catalogue row, as much of one as this needs. Structurally a subset of
 *  `CatalogueRow` in src/ui/exerciseDetail.ts, so a screen passes its rows
 *  straight in. */
export interface TargetRow extends KitRow {
  name: string;
  /** `exercises.muscle_group`, one of the 11. Null where the catalogue does
   *  not place it, which puts the row outside every group target. */
  group: string | null;
  /** `exercises.primary_muscles`, in the catalogue's own spelling. The column
   *  a muscle target is answered from. */
  primaryMuscles: readonly string[];
  /** `exercises.category` — a stretch is prescribed as a hold. */
  category?: string | null;
  /** `exercises.mechanic` — 'compound' or 'isolation', null on 7 of 615 rows.
   *  Only ever used to ORDER a pool, never to include or exclude one. */
  mechanic?: string | null;
}

/**
 * One thing a member can ask to train, in their words and in the catalogue's.
 *
 * `under` is the coarse group the muscle sits in, and it is here for the
 * PICKER rather than for the matching — it is what lets a member who opened
 * Arms find Triceps without knowing that Triceps is not a group. Matching
 * never touches it: a muscle target is answered from `muscles` alone, or the
 * distinction this file exists for would collapse on the first lookup.
 */
export interface MuscleTarget {
  /** What the member calls it. Title Case, because it is a label. */
  label: string;
  /** The catalogue's `primary_muscles` names it covers, lower case as stored. */
  muscles: readonly string[];
  /** The `muscle_group` this sits under, in the catalogue's spelling. */
  under: string;
}

/**
 * The member's vocabulary for the catalogue's 27 primary muscles.
 *
 * Every one of the 27 appears at least once; several appear twice, because a
 * muscle genuinely belongs to two things a member asks for (gluteus medius is
 * part of the glutes AND is the muscle that does hip abduction). Overlap is
 * the normal case here, not an edge one.
 *
 * Ordered by where they sit on the body — arms, shoulders, chest, back, core,
 * legs — because this is read as a menu. Within a group, the biggest pool
 * first.
 */
export const MUSCLE_TARGETS: readonly MuscleTarget[] = [
  { label: 'Triceps', muscles: ['triceps brachii'], under: 'Arms' },
  // Three muscles, not one. The brachialis sits under the biceps and the
  // brachioradialis runs to the forearm; both are bent-elbow work and a member
  // asking for biceps is asking for all three. Dropping the last two would
  // lose 14 movements without telling anybody.
  { label: 'Biceps', muscles: ['biceps brachii', 'brachialis', 'brachioradialis'], under: 'Arms' },
  { label: 'Forearms', muscles: ['forearm flexors', 'forearm extensors', 'brachioradialis'], under: 'Arms' },
  // The catalogue splits the deltoid three ways and the member does not.
  { label: 'Shoulders', muscles: ['anterior deltoid', 'lateral deltoid', 'posterior deltoid'], under: 'Shoulders' },
  { label: 'Rear Delts', muscles: ['posterior deltoid'], under: 'Shoulders' },
  { label: 'Chest', muscles: ['pectoralis major'], under: 'Chest' },
  { label: 'Lats', muscles: ['latissimus dorsi'], under: 'Back' },
  { label: 'Upper Back', muscles: ['trapezius', 'rhomboids'], under: 'Back' },
  { label: 'Lower Back', muscles: ['erector spinae', 'quadratus lumborum'], under: 'Lower back' },
  { label: 'Abs', muscles: ['rectus abdominis', 'transverse abdominis'], under: 'Core' },
  { label: 'Obliques', muscles: ['obliques'], under: 'Core' },
  { label: 'Glutes', muscles: ['gluteus maximus', 'gluteus medius'], under: 'Glutes' },
  { label: 'Quads', muscles: ['quadriceps'], under: 'Legs' },
  { label: 'Hamstrings', muscles: ['hamstrings'], under: 'Hamstrings' },
  { label: 'Calves', muscles: ['gastrocnemius', 'soleus'], under: 'Calves' },
  { label: 'Hip Flexors', muscles: ['hip flexors'], under: 'Legs' },
  { label: 'Inner Thighs', muscles: ['adductors'], under: 'Legs' },
  { label: 'Outer Hips', muscles: ['abductors', 'gluteus medius'], under: 'Glutes' },
];

/** A target as chosen on screen. `name` is a `MuscleTarget.label` for a muscle
 *  and a `muscle_group` value for a group; nothing else is understood, and an
 *  unrecognised one is reported rather than guessed at. */
export interface Target { kind: 'muscle' | 'group'; name: string }

/** Why a chosen target contributed nothing. */
export type EmptyReason =
  /** Not in `MUSCLE_TARGETS`, or a group no row carries. Nothing was built for
   *  it and nothing was substituted. */
  | 'unknown'
  /** The catalogue holds no movement for it at all. */
  | 'none'
  /** The catalogue holds movements for it, but not one that can be done
   *  without equipment. `held` says how many were turned away. */
  | 'kit';

export interface TargetedCoverage {
  /** How many rows were on offer after the equipment option was applied. Zero
   *  is "the pool was empty", which is a different sentence from "your target
   *  is not in it". */
  poolSize: number;
  /** Whether the caller asked for movements needing no equipment at all. */
  noKit: boolean;
  /** Targets that reached the week, and how many movements the catalogue
   *  actually holds for each. Never rounded up, and `options` below `perDay`
   *  is how a screen knows the day is short. */
  served: { target: string; options: number }[];
  /** Targets that reached nothing, each with its reason attached. */
  empty: { target: string; reason: EmptyReason; held: number }[];
  /** Targets left out because a week has seven days and more than seven were
   *  chosen. They were served by the catalogue and are still not in the plan,
   *  which is not the same admission as the one above. */
  overflow: string[];
}

export interface TargetedPlan {
  program: Program;
  coverage: TargetedCoverage;
}

const norm = (s: string): string => String(s ?? '').trim().toLowerCase();

/** The member's name for a catalogue muscle, or null when nothing covers it.
 *  First match wins, and the order of `MUSCLE_TARGETS` is what decides it. */
export function targetForMuscle(muscle: string): MuscleTarget | null {
  const k = norm(muscle);
  return MUSCLE_TARGETS.find((x) => x.muscles.some((m) => norm(m) === k)) ?? null;
}

/** The muscle targets sitting under one of the 11 groups, for the drill-down.
 *  Empty for a group no muscle is filed under, which the picker draws as a
 *  group you can pick but cannot open rather than as a missing row. */
export function targetsUnder(group: string): MuscleTarget[] {
  const k = norm(group);
  return MUSCLE_TARGETS.filter((x) => norm(x.under) === k);
}

/** Does this row train this target? A muscle asks `primary_muscles`, a group
 *  asks `muscle_group`, and neither ever answers for the other. */
function matches(row: TargetRow, target: Target): boolean {
  if (target.kind === 'group') return norm(row.group || '') === norm(target.name);
  const def = MUSCLE_TARGETS.find((x) => norm(x.label) === norm(target.name));
  if (!def) return false;
  return row.primaryMuscles.some((m) => def.muscles.some((w) => norm(w) === norm(m)));
}

/**
 * Order inside one target's pool.
 *
 * Isolation before compound, which is the one ranking decision in this file and
 * the one that separates "train triceps" from "train Arms". A member who names
 * a muscle is asking for work ON that muscle; the catalogue's 24 compound
 * triceps rows are close-grip presses and dips, which are a chest day with the
 * triceps along for the ride. `mechanic` is the catalogue's own judgement and
 * is read for nothing else.
 *
 * A null `mechanic` — 7 rows of 615 — sorts AFTER both. The catalogue did not
 * say, and putting an unjudged row in front of a judged one would be this file
 * making the judgement instead.
 *
 * Stretches last, whatever their mechanic: a hold is a finisher, not the first
 * thing in a session. Then by name, so the same catalogue gives the same
 * workout every time it is asked — a workout that reshuffles itself on every
 * tap is one nobody can repeat next week.
 */
const rank = (r: TargetRow): number => {
  const m = norm(r.mechanic || '');
  return (isStretch(r) ? 10 : 0) + (m === 'isolation' ? 0 : m === 'compound' ? 1 : 2);
};

/**
 * A workout for the muscles and groups a member picked.
 *
 * One day per target, in the order they were chosen — so one target is one
 * session ("a triceps workout") and five targets are a five-day week, out of
 * the same code path and with no mode flag deciding which.
 *
 * `rows` is the WHOLE catalogue and not a pre-filtered pool: what a target
 * could not be served from is only knowable from the rows left out.
 */
export function targetedProgram(
  rows: readonly TargetRow[],
  targets: readonly Target[],
  opts: { perDay?: number; noKit?: boolean } = {},
): TargetedPlan {
  const perDay = Math.max(1, Math.min(8, Math.trunc(opts.perDay ?? 5) || 5));
  const noKit = opts.noKit === true;

  // The equipment option narrows the POOL, once, before any target is looked
  // at — so "held" below counts the rows a target has in the catalogue and the
  // pool counts the ones it may use, and the gap between them is exactly the
  // sentence a member needs.
  const pool = noKit ? rows.filter(needsNoKit) : rows.slice();

  // Deduplicated on kind+name: two chips for the same target would be two
  // identical days.
  const chosen: Target[] = [];
  for (const x of targets) {
    const k = `${x.kind}:${norm(x.name)}`;
    if (!chosen.some((y) => `${y.kind}:${norm(y.name)}` === k)) chosen.push(x);
  }

  const served: { target: Target; rows: TargetRow[] }[] = [];
  const empty: TargetedCoverage['empty'] = [];
  for (const target of chosen) {
    const known = target.kind === 'group'
      ? rows.some((r) => norm(r.group || '') === norm(target.name))
      : MUSCLE_TARGETS.some((x) => norm(x.label) === norm(target.name));
    if (!known) { empty.push({ target: target.name, reason: 'unknown', held: 0 }); continue; }
    const usable = pool.filter((r) => matches(r, target));
    if (usable.length) {
      usable.sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name));
      served.push({ target, rows: usable });
      continue;
    }
    // Nothing usable. WHY is the whole point: a member who picked Biceps and
    // No equipment must be told the catalogue has 33 biceps movements and
    // every one of them needs something, not that biceps do not exist.
    const held = rows.filter((r) => matches(r, target)).length;
    empty.push({ target: target.name, reason: held > 0 ? 'kit' : 'none', held });
  }

  // Seven days in a week. More targets than that is a real choice a member can
  // make — there are 11 groups and 18 muscles — and the ones that do not fit
  // are named rather than dropped.
  const fit = served.slice(0, 7);
  const overflow = served.slice(7).map((s) => s.target.name);

  const days: ProgramDay[] = fit.map((s, d) => {
    const exercises: ProgramExercise[] = s.rows.slice(0, perDay).map((row) => ({
      // The day index is in the key because two days can legitimately share a
      // movement — Chest and Triceps both hold Close Grip Push Ups — and the
      // builder's `patchEx` edits by key.
      key: `target-${exerciseSlug(row.name)}-${d}`,
      name: row.name,
      // The catalogue's own group, never the target. A member who asked for
      // Triceps and sees "Chest" on Close-Grip Bench Press is reading a fact
      // about the movement; writing "Triceps" there would put the request back
      // into the data as though the catalogue had said it.
      group: (row.group || '').trim() || s.target.name,
      sets: setsFor(row),
      reps: repsFor(row),
      // The next two movements in this target's own pool — real rows, never
      // invented, and taken from PAST the day so an alternative is never a
      // movement already prescribed three lines up. Empty is the honest answer
      // for a target whose pool the day exhausted.
      alternatives: s.rows.slice(perDay, perDay + 2).map((x) => x.name),
    }));
    return { day: dayNameAt(d, fit.length), focus: s.target.name, exercises };
  });

  const coverage: TargetedCoverage = {
    poolSize: pool.length,
    noKit,
    served: fit.map((s) => ({ target: s.target.name, options: s.rows.length })),
    empty,
    overflow,
  };

  const names = fit.map((s) => s.target.name);
  const note = [
    noKit ? 'Every movement here needs no equipment at all: no bar, no bands, no bench.' : null,
    targetedCoverageNote(coverage, perDay),
  ].filter(Boolean).join(' ');

  return {
    program: {
      title: names.length === 1 ? `${names[0]} Workout` : 'Targeted Program',
      focus: names,
      note,
      days,
    },
    coverage,
  };
}

/**
 * What the screen says about the targets this could not serve, or null when
 * there is nothing to admit.
 *
 * Named, always, with the reason attached, and never rolled up into "some
 * targets could not be covered" — that sentence tells a member to go and work
 * out which, and the whole value of the report is that we already know.
 *
 * An empty pool gets its own sentence. "Biceps is not covered" said over a
 * catalogue that arrived empty would be a claim about the catalogue we do not
 * have.
 */
export function targetedCoverageNote(c: TargetedCoverage, perDay = 5): string | null {
  if (c.poolSize <= 0) {
    return c.noKit
      ? 'No movement in the catalogue is recorded as needing no equipment, so there is nothing to build this workout from.'
      : 'The exercise catalogue came back empty, so there is nothing to build this workout from.';
  }
  const parts: string[] = [];

  const none = c.empty.filter((x) => x.reason === 'none').map((x) => x.target);
  if (none.length) {
    parts.push(none.length === 1
      ? `${none[0]} is not in this workout: the catalogue holds no movement for it, and none was invented to fill the gap.`
      : `${list(none)} are not in this workout: the catalogue holds no movement for them, and none was invented to fill the gaps.`);
  }

  const kit = c.empty.filter((x) => x.reason === 'kit');
  if (kit.length) {
    const said = kit.map((x) => `${x.target} (${x.held === 1 ? '1 movement' : `${x.held} movements`}, all needing equipment)`);
    parts.push(kit.length === 1
      ? `${said[0]} is not in this workout. Nothing in the catalogue trains it with no equipment, and no other muscle was put in its place.`
      : `${list(said)} are not in this workout. Nothing in the catalogue trains them with no equipment, and no other muscles were put in their place.`);
  }

  const unknown = c.empty.filter((x) => x.reason === 'unknown').map((x) => x.target);
  if (unknown.length) {
    parts.push(unknown.length === 1
      ? `${unknown[0]} is not something this app can look up, so nothing was built for it.`
      : `${list(unknown)} are not things this app can look up, so nothing was built for them.`);
  }

  // Short of a full day. Said because a member counting four rows under a
  // target they picked has no way to tell whether the fifth is missing or
  // never existed.
  const thin = c.served.filter((x) => x.options < perDay);
  if (thin.length) {
    const said = thin.map((x) => `${x.target} has ${x.options === 1 ? 'only one movement' : `only ${x.options} movements`}`);
    parts.push(`${list(said)} in the catalogue${c.noKit ? ' that needs no equipment' : ''}, so that day is shorter than the rest.`);
  }

  if (c.overflow.length) {
    parts.push(`A week has seven days, so ${list(c.overflow)} ${c.overflow.length === 1 ? 'is' : 'are'} not in this program. Build a second one for ${c.overflow.length === 1 ? 'it' : 'them'}.`);
  }

  return parts.length ? parts.join(' ') : null;
}
