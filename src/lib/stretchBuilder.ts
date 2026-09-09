// Assembling a stretch routine to fit the time somebody actually has.
//
// The six routines in src/lib/stretchRoutine.ts are written down: fixed
// stretches, fixed holds, fixed length. That answers "give me a good back
// routine" and does not answer the thing that was asked for — "you tell it how
// long you want to stretch for and it builds your stretch program". A member
// with ten minutes before bed should not have to pick the seven-minute one and
// wonder what to do with the other three.
//
// So this module PRODUCES a routine. It hands back the same `StretchRoutine`
// the six are, which means `StretchRunner` plays it with no changes at all —
// the runner never learns that some routines were written and some were
// assembled, and that is the whole point of the split. Everything about how a
// routine is FOLLOWED (stage expansion, sides, the estimate, what reaches the
// log) stays in stretchRoutine.ts and is imported from there rather than
// re-derived, so there is one piece of arithmetic and both kinds of routine
// are measured by it.
//
// ── Why a sibling module and not more of stretchRoutine.ts ────────────────
//
// stretchRoutine.ts is already 470 lines and it holds two things: the six
// routines we wrote, and the vocabulary the runner speaks. This file holds the
// rule for turning catalogue rows into candidates and a selection algorithm.
// Putting them together would mix "the routines a person chose to write" with
// "the machinery that invents one", which are edited for completely different
// reasons — a new fixed routine is a copy decision, a change here is an
// arithmetic decision. They stay apart. Nothing in stretchRoutine.ts imports
// this, so the fixed six do not acquire a dependency on the builder.
//
// ── Where the builder's three facts come from ─────────────────────────────
//
// This is the load-bearing decision in the file, so it is written out — and it
// has been REVERSED, which is why the argument that used to stand here is
// summarised rather than deleted.
//
// The builder needs three facts about a stretch: which part of the body it is
// for, whether it is done on each side, and whether it moves. Until the RepDB
// v1.41 drop our `exercises` table stored none of them, so all three were typed
// out here as a 51-row constant, and this file said so at length: reading names
// from the database while taking sides and area from a constant would have been
// two sources for one row, "and the day they disagree is the day somebody
// stretches one leg"; adding columns to serve a routine builder was a schema
// change to avoid typing out rows that do not change.
//
// Two of those three columns now exist and are populated, `body_part text` and
// `is_unilateral boolean not null default false`, both granted SELECT to
// `authenticated`. The third was never missing: `force` has been on the table
// since supabase/parts/71-exercise-catalogue.sql and part 74 populates it from
// RepDB's `force_type` — the old note here claiming otherwise was simply wrong
// about our own schema, which is the kind of wrong a comment gets to be for a
// year without anything failing.
//
// So the constant is gone and the builder reads the columns, through
// `stretchCandidates()` below. Three things follow and all three are the point:
//
//   · ONE source per row. The name, the area, the sides and the flow all
//     arrive on the same row of the same table, so they cannot disagree.
//   · The list stops going stale. The constant said 51; the pack now carries
//     58 equipment-free stretching rows, 54 of them outside Pilates — Lateral
//     Leg Swing, Front-to-Back Leg Swing and Torso Twists arrived with v1.41
//     and no routine could ever have contained them.
//   · This screen now HAS a load status, and the screen that draws it has to
//     say which of loading, unreadable and genuinely empty it is looking at.
//     There is no fallback list to quietly serve instead: a second copy of the
//     catalogue kept for offline is the two-sources defect wearing a coat.
//
// `buildRoutine` still answers an empty catalogue with a sentence, and that
// case is now REACHABLE rather than theoretical — a read that came back with
// nothing, or a focus filtered down to nothing, both land there.
import {
  routineTotalSec, routineMinutes,
  type StretchRoutine, type StretchStep,
} from './stretchRoutine';

/* ── the shape of the catalogue ──────────────────────────────────────────── */

/**
 * RepDB's `body_part`, verbatim.
 *
 * Not re-grouped, and not corrected. Two rows read oddly under it — the neck
 * stretch is filed under `back`, and Cow Face Pose is filed under `shoulders`
 * with a glute as its primary muscle, which is fair since the pose is both. The
 * temptation is to override those here. The reason not to is that an override
 * list is a second opinion about the pack that nothing keeps in step with it,
 * and this file would then hold facts that are true of nothing. Instead the
 * FOCUS groups below are ours and are named for what they actually contain, so
 * the neck stretch turns up under a heading that says "Neck" on it.
 */
export type StretchArea =
  | 'upper_legs' | 'lower_legs' | 'back' | 'core' | 'chest'
  | 'shoulders' | 'upper_arms' | 'lower_arms' | 'full_body';

/** One stretch the builder may choose, with the three facts it chooses on. */
export interface StretchCandidate {
  /** `exercises.id`, which for a seeded row is `exerciseSlug(name)`. The same
   *  key the fixed routines use, and for the same reason: get it wrong and the
   *  stretch renders with a name and no picture, which reads as artwork we are
   *  missing rather than as a key we typed wrong. Taken from the row rather
   *  than re-derived from the name, because six of these rows are exactly where
   *  our id and RepDB's disagree — ours is 'child-s-pose' and theirs is
   *  'childs-pose', which cost this repo an incident once already. */
  id: string;
  /** `exercises.name` — the catalogue's own spelling, and the identity a
   *  logged routine is written under. Never a translated name. */
  name: string;
  /** `exercises.body_part`. */
  area: StretchArea;
  /**
   * The first of `exercises.primary_muscles`, used ONLY to spread a selection
   * out. `upper_legs` holds twenty-six stretches and six of them are for the
   * hamstrings; without this, a ten-minute leg routine is six ways to touch
   * your toes. It is never shown on screen — it is a raw RepDB token, not copy.
   * Empty string where the row names none, which sorts as its own pile and is
   * the honest answer rather than an invented muscle.
   */
  muscle: string;
  /** 2 when `exercises.is_unilateral` is true. It COSTS DOUBLE, and a builder
   *  that forgets that overruns every routine it makes by half. */
  sides: 1 | 2;
  /** `exercises.force === 'dynamic'` — a stretch that moves rather than one
   *  that is held. */
  flow: boolean;
}

/**
 * One catalogue row, as the columns hand it over.
 *
 * Named separately from `StretchCandidate` because the two are different
 * things: this is what the database says, and a candidate is what the builder
 * can use. `stretchCandidates()` below is the whole of the distance between
 * them, and it is the only place in the app that reads a `body_part` string.
 */
export interface StretchRow {
  id: string;
  name: string;
  /** `body_part`. Null on a row the pack has not classified, and null is
   *  ordinary — it is a nullable column with no default. */
  bodyPart: string | null;
  isUnilateral: boolean;
  /** `force`, which is RepDB's `force_type`: 'static', 'dynamic', 'push',
   *  'pull'. Null where the row does not say. */
  force: string | null;
  /** `equipment`. Null means the movement needs none, which is the whole of
   *  the equipment-free test below. */
  equipment: string | null;
  primaryMuscles: string[];
}

const AREAS: readonly StretchArea[] = [
  'upper_legs', 'lower_legs', 'back', 'core', 'chest',
  'shoulders', 'upper_arms', 'lower_arms', 'full_body',
];

const isArea = (v: string | null | undefined): v is StretchArea =>
  !!v && (AREAS as readonly string[]).includes(v);

/**
 * The rows a built routine may draw on, from the rows the catalogue holds.
 *
 * The caller hands over every stretching row it read; this narrows them, and
 * every narrowing below follows a decision already made and written down for
 * the fixed six in stretchRoutine.ts:
 *
 *   · EQUIPMENT-FREE ONLY, which is `equipment is null`. Of the 79 rows
 *     carrying `category: 'stretching'`, 58 need no kit, eleven want a
 *     resistance band and ten want a flat bench. A routine built for
 *     somebody's ten spare minutes that opens with "you will need a band" is a
 *     routine most people cannot start. The banded and bench variants stay in
 *     the catalogue and stay reachable from the exercise library; they are
 *     just not what a generated routine may assume.
 *
 *   · NO PILATES. That removes four of the 58 — Roll Down, Saw, Spine Stretch
 *     Forward and Spine Twist — leaving 54. Pilates is its own entry in
 *     MOBILITY_ACTIVITIES, and a member who chose Stretch over Pilates one
 *     screen earlier should not be handed Pilates Saw. stretchRoutine.ts
 *     excludes the same four from the fixed routines for the same reason, and
 *     the builder disagreeing with it would be the two halves of one feature
 *     answering the same question differently. Matched on the id prefix, which
 *     is what the pack actually uses — all four are `pilates-*` and nothing
 *     else is.
 *
 *   · A BODY PART WE RECOGNISE. `body_part` is nullable and the pack's
 *     vocabulary can grow, and a row this file cannot place is a row no focus
 *     covers and no ordering can spread out. It is dropped rather than filed
 *     under a guess: putting an unplaceable stretch in `full_body` would put
 *     it at the end of every routine we build, for no reason anybody could
 *     read off the data.
 *
 * NOT filtered on `category = 'stretching'` here, deliberately. That is a
 * question for the query — it is an indexed equality the database can answer
 * over 615 rows far more cheaply than we can over the ones it sent — and
 * repeating it here would put the same rule in two places. What this function
 * owns is everything the query cannot express without becoming unreadable.
 *
 * Deterministic and order-preserving: the rows come back in the order they
 * arrived, and `orderArea` below is the only thing that decides order.
 */
export function stretchCandidates(rows: readonly StretchRow[]): StretchCandidate[] {
  const out: StretchCandidate[] = [];
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name) continue;
    if (r.equipment != null) continue;
    if (r.id.startsWith('pilates-')) continue;
    if (!isArea(r.bodyPart)) continue;
    out.push({
      id: r.id,
      name: r.name,
      area: r.bodyPart,
      muscle: Array.isArray(r.primaryMuscles) && typeof r.primaryMuscles[0] === 'string' ? r.primaryMuscles[0] : '',
      sides: r.isUnilateral === true ? 2 : 1,
      flow: r.force === 'dynamic',
    });
  }
  return out;
}

/* ── what a member can ask for ───────────────────────────────────────────── */

/** A target area, as the member picks it. */
export interface StretchFocus {
  id: string;
  /** Title Case — it is drawn as a chip beside the mode chips at the top of
   *  Train, which are "Program", "Cardio", "HIIT". */
  label: string;
  /** Lower case, for the middle of a sentence: "spread across your legs and
   *  hips." Kept apart from `label` because a label dropped into prose is how
   *  a screen ends up saying "across your Legs & Hips". */
  phrase: string;
  /**
   * The areas it covers, IN THE ORDER THEY ARE DRAWN FROM.
   *
   * Order is the coverage decision. A five-minute whole-body routine has room
   * for four or five stretches, and this list is what decides which four:
   * legs, then back, then shoulders, then core. Put `full_body` first and the
   * same five minutes is Mountain Pose and a lie-down.
   */
  areas: readonly StretchArea[];
}

/**
 * The focus options, named for what they actually contain.
 *
 * "Back, Neck & Core" says Neck because RepDB files the neck stretch under
 * `back` and we are not overriding the pack — see StretchArea. Naming the group
 * honestly costs nothing and means the one neck stretch we have is findable,
 * where a group called "Back & Core" would have hidden it from the person
 * looking for it.
 *
 * Four rather than nine, because nine chips is a form. The narrow one is real:
 * "Shoulders, Chest & Arms" has seven stretches in it, which is not enough to
 * fill twenty minutes, and that shortfall is reported rather than padded.
 */
export const STRETCH_FOCUS: readonly StretchFocus[] = [
  {
    id: 'whole-body',
    label: 'Whole Body',
    phrase: 'whole body',
    areas: ['upper_legs', 'back', 'shoulders', 'core', 'lower_legs', 'chest', 'upper_arms', 'lower_arms', 'full_body'],
  },
  { id: 'legs', label: 'Legs & Hips', phrase: 'legs and hips', areas: ['upper_legs', 'lower_legs'] },
  { id: 'back', label: 'Back, Neck & Core', phrase: 'back, neck and core', areas: ['back', 'core'] },
  { id: 'upper', label: 'Shoulders, Chest & Arms', phrase: 'shoulders, chest and arms', areas: ['shoulders', 'chest', 'upper_arms', 'lower_arms'] },
];

/** The focus with that id, or null. Null is a real answer for the same reason
 *  `routineById` returns one: the id can arrive from stored state or a link. */
export function focusById(id: string | null | undefined): StretchFocus | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return STRETCH_FOCUS.find((f) => f.id === key) ?? null;
}

/** The durations the picker offers. Data rather than JSX so the test can build
 *  every routine the screen can actually produce and check all of them. */
export const BUILD_MINUTES: readonly number[] = [5, 10, 15, 20];

/* ── the numbers the builder works to ────────────────────────────────────── */

/**
 * The hold every built stretch starts at, in seconds.
 *
 * Thirty. It is the median of the fixed six (which run 20–40), it is long
 * enough to be a stretch rather than a touch, and — the reason it is a single
 * number rather than a band that grows with the routine — it makes the trade
 * legible: extra minutes buy MORE STRETCHES, not longer ones. A builder that
 * lengthens holds first fills twenty minutes with six positions held for two
 * minutes each, which is a much worse routine than fifteen positions and is
 * arrived at by an arithmetic nobody can see.
 */
export const BUILD_HOLD_SEC = 30;

/**
 * How long a hold may be stretched to when there is time left over.
 *
 * Sixty, well under stretchRoutine's MAX_HOLD_SEC of 120. The top-up below
 * exists to spend the remainder after the last stretch that fits — without it,
 * "10 minutes" reliably delivers eight and a half. But it must not become the
 * way the budget is filled: past a minute a side it stops being a longer
 * stretch and starts being padding, and the honest answer at that point is to
 * say the routine is shorter than asked for.
 */
export const MAX_BUILT_HOLD_SEC = 60;

/** The step the top-up works in. Five, so every hold on screen is a round
 *  number — a routine of 37- and 43-second holds looks like a bug. */
export const TOPUP_STEP_SEC = 5;

/**
 * The shortest routine worth building, in minutes.
 *
 * Two: two stretches and the move between them, at 30 seconds each, is 70
 * seconds. One minute is one position, which is a stretch and not a routine,
 * and calling it one would be the app agreeing to something silly rather than
 * saying so.
 */
export const MIN_BUILD_MINUTES = 2;

/**
 * The longest, in minutes.
 *
 * An hour, and it is a guard on typing rather than on training — the same job
 * MAX_HOLD_SEC does one file over, where the note is that 300 meaning five
 * minutes is one keystroke from 3000. Nothing in the app can currently ask for
 * more than 20.
 */
export const MAX_BUILD_MINUTES = 60;

/* ── the answer ──────────────────────────────────────────────────────────── */

/** What the builder hands back. Three fields rather than a routine or a throw,
 *  because there are three genuinely different things to say. */
export interface BuiltRoutine {
  /** The routine, ready for `StretchRunner`, or null when there is none. */
  routine: StretchRoutine | null;
  /**
   * Why there is no routine, as a sentence. Null when there is one.
   *
   * Sentence case and no blame: every one of these is a thing we could not do,
   * not a thing the member did wrong.
   */
  problem: string | null;
  /**
   * Set when the routine is SHORTER than asked for, as a sentence, and null
   * when it fills the time.
   *
   * This is the honest half of the feature. Asked for twenty minutes of
   * shoulders and chest, we have seven equipment-free stretches for it; the
   * choice is to repeat them, hold each for two minutes, or say so. The first
   * two are the app pretending, so it says so.
   */
  shortfall: string | null;
  /** True when stretches were left unused, so building again with a different
   *  seed would genuinely produce a different routine. False when the routine
   *  already holds everything available, and offering to shuffle would be an
   *  offer we cannot keep. */
  canVary: boolean;
}

export interface BuildRequest {
  /** How long the member has, in minutes. */
  minutes: number;
  /** A `StretchFocus` id. Defaults to the whole body. */
  focus?: string;
  /**
   * The stretches to build from — `stretchCandidates()` over the rows the
   * catalogue read returned.
   *
   * Required, with no default and nothing to fall back on. A default would be a
   * second copy of the catalogue kept in this file, which is the two-sources
   * defect the header describes; and a caller that has not read the rows yet
   * must show its member a loading sentence, not a routine assembled from a
   * list this module happened to remember.
   */
  catalogue: readonly StretchCandidate[];
  /**
   * Which routine of the several possible ones to build. Same seed, same
   * routine, every time.
   *
   * The builder is deterministic on purpose. A selection that shuffled itself
   * would give a member a different routine on every render of the same screen,
   * which is untestable and reads as the app changing its mind. Variety is
   * therefore something the member asks for — a button that moves the seed on —
   * rather than something that happens to them.
   */
  seed?: number;
}

const fail = (problem: string): BuiltRoutine =>
  ({ routine: null, problem, shortfall: null, canVary: false });

/** Rotate a list left by n. A rotation, not a shuffle: it is one line, it is
 *  obviously deterministic, and it preserves the muscle interleaving built
 *  below — where a shuffle would undo the one thing the ordering is for. */
function rotate<T>(list: readonly T[], n: number): T[] {
  if (list.length < 2) return [...list];
  const k = ((n % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/**
 * One area's stretches, ordered so that taking the first few spreads across
 * muscles instead of piling onto one.
 *
 * `upper_legs` holds six hamstring stretches out of twenty-six. Sorted by name
 * they arrive in a run, and a short leg routine is four ways to fold forward.
 * So the list is dealt round-robin from one pile per muscle, biggest pile
 * first — hamstrings, adductors, hip flexors, glutes, quads — which is the
 * order that keeps every pile going for as long as possible.
 *
 * Within a muscle the order is alphabetical by id. There is no ranking here on
 * purpose: nothing in the pack says Pigeon is a better glute stretch than
 * Standing Split, and inventing a preference would be an opinion dressed as
 * data. The seed rotates it, so the alphabet is a starting point rather than a
 * verdict.
 */
function orderArea(rows: readonly StretchCandidate[], seed: number): StretchCandidate[] {
  const piles = new Map<string, StretchCandidate[]>();
  for (const c of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const pile = piles.get(c.muscle);
    if (pile) pile.push(c);
    else piles.set(c.muscle, [c]);
  }
  const ordered = [...piles.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const out: StretchCandidate[] = [];
  const deepest = ordered.reduce((n, [, p]) => Math.max(n, p.length), 0);
  for (let depth = 0; depth < deepest; depth++) {
    for (const [, pile] of ordered) {
      const c = pile[depth];
      if (c) out.push(c);
    }
  }
  return rotate(out, seed);
}

const stepOf = (c: StretchCandidate): StretchStep =>
  ({ id: c.id, name: c.name, holdSec: BUILD_HOLD_SEC, sides: c.sides, flow: c.flow });

/**
 * Build a routine that fits.
 *
 * ── The time rule, stated plainly ─────────────────────────────────────────
 *
 * A routine NEVER runs longer than the minutes it was asked for. `routineTotalSec`
 * — the same function that prints "about 7 min" under the fixed six, so the
 * budget and the promise are one number — is kept at or under `minutes × 60`
 * at every step. Overrunning somebody who said "I have ten minutes" is the
 * failure this feature exists to avoid, and there is no tolerance above the
 * line at all.
 *
 * Under the line the tolerance is one top-up step: stretches are chosen at 30
 * seconds until no more fit, and then the remainder is spent lengthening the
 * holds five seconds at a time, so what is left over at the end is under five
 * seconds of the budget unless the catalogue ran out first. In practice every
 * duration the picker offers comes back reading exactly the minutes that were
 * asked for, and where it cannot — one focus is only seven stretches — the
 * `shortfall` sentence says so instead of the routine quietly being short.
 *
 * ── Selection, in two passes that answer different questions ──────────────
 *
 * WHICH stretches is a coverage question: they are taken round-robin across the
 * focus's areas, so a routine cut short by the budget is still spread out. A
 * candidate that does not fit is skipped rather than ending the selection — one
 * two-sided stretch too big for the remaining time must not cost the member the
 * three one-sided ones that would have fitted after it.
 *
 * IN WHAT ORDER is a presentation question, answered afterwards by grouping the
 * chosen stretches back into their areas. Following a routine that jumps
 * legs → back → shoulders → legs is worse than doing the legs together, and
 * separating the two passes is what lets the selection interleave while the
 * routine reads in blocks.
 *
 * No stretch appears twice: each candidate is considered once.
 */
export function buildRoutine(req: BuildRequest): BuiltRoutine {
  const focusId = req.focus ?? 'whole-body';
  const focus = focusById(focusId);
  if (!focus) return fail('We do not have that part of the body as a stretch focus.');

  const catalogue = req.catalogue;
  if (!Array.isArray(catalogue) || !catalogue.length) return fail('We have no stretches to build a routine from.');

  // Floored rather than rejected: a fractional minute is a caller's arithmetic,
  // not a member's request, and 9.5 plainly means "fit it into nine".
  const minutes = Math.floor(req.minutes);
  if (!Number.isFinite(minutes)) return fail('That is not a length of time we can build a routine from.');
  if (minutes < MIN_BUILD_MINUTES) {
    return fail(`Under ${MIN_BUILD_MINUTES} minutes there is room for one position, which is a stretch rather than a routine.`);
  }
  if (minutes > MAX_BUILD_MINUTES) {
    return fail(`We build routines up to ${MAX_BUILD_MINUTES} minutes long.`);
  }

  const seed = Number.isFinite(req.seed) ? Math.trunc(req.seed as number) : 0;
  const budget = minutes * 60;

  const byArea = focus.areas.map((a) => orderArea(catalogue.filter((c) => c.area === a), seed));
  const pool = byArea.reduce((n, list) => n + list.length, 0);
  if (!pool) return fail(`We have no equipment-free stretches for your ${focus.phrase} yet.`);

  // Round-robin across the areas: the first of each, then the second of each.
  const order: { c: StretchCandidate; area: number; pos: number }[] = [];
  const deepest = byArea.reduce((n, list) => Math.max(n, list.length), 0);
  for (let pos = 0; pos < deepest; pos++) {
    byArea.forEach((list, area) => {
      const c = list[pos];
      if (c) order.push({ c, area, pos });
    });
  }

  // Take everything that fits. `routineTotalSec` is asked rather than a private
  // sum, so the number budgeted against and the number printed on the row can
  // never come apart. At the fifty-odd candidates a focus can offer, the
  // repeated walk is a few thousand additions, once, on a tap.
  const picked: { c: StretchCandidate; area: number; pos: number }[] = [];
  const steps: StretchStep[] = [];
  const asRoutine = (ss: StretchStep[]): StretchRoutine => ({ id: 'fit', title: 'Fit', note: 'measured, never shown.', steps: ss });
  for (const cand of order) {
    const trial = [...steps, stepOf(cand.c)];
    if (routineTotalSec(asRoutine(trial)) > budget) continue;
    steps.push(trial[trial.length - 1]);
    picked.push(cand);
  }
  // `steps` cannot be empty here and there is no guard for it: the cheapest
  // possible stretch is one 30-second hold, or 30 + 30 + one 10-second change
  // for a two-sided one, and MIN_BUILD_MINUTES puts at least 120 seconds on the
  // table. A guard no input can reach is a line that outlives its reason.

  // Presentation order — see the header. Sorted by area, then by the position
  // the round-robin had them in, which keeps each area's own muscle spread.
  picked.sort((a, b) => a.area - b.area || a.pos - b.pos);
  const ordered = picked.map((p) => stepOf(p.c));

  // Spend the remainder on the holds, five seconds at a time, dealt round the
  // stretches so that no one of them absorbs the lot. A two-sided stretch costs
  // twice per bump, which is exactly why the check is against its cost and not
  // against the step count.
  //
  // A COUNTED loop, not `while (something changed)`. The two are the same
  // routine — no hold can be raised more than six times before it hits the
  // ceiling, so a seventh pass could never do anything — and they are not the
  // same failure. A condition-terminated loop turns any future mistake in the
  // two `continue`s below into a phone that stops responding on a tap, and a
  // frozen app is worse than any wrong routine it could have produced instead.
  // scripts/mutate.mjs found this the direct way: it made exactly that mistake
  // and the test run hung rather than failing.
  const passes = Math.ceil((MAX_BUILT_HOLD_SEC - BUILD_HOLD_SEC) / TOPUP_STEP_SEC);
  for (let pass = 0; pass < passes; pass++) {
    for (const step of ordered) {
      if (step.holdSec + TOPUP_STEP_SEC > MAX_BUILT_HOLD_SEC) continue;
      const trial = ordered.map((x) => (x === step ? { ...x, holdSec: x.holdSec + TOPUP_STEP_SEC } : x));
      if (routineTotalSec(asRoutine(trial)) > budget) continue;
      step.holdSec += TOPUP_STEP_SEC;
    }
  }

  const routine: StretchRoutine = {
    // Deterministic, and NOT resolvable by `routineById` — a built routine is
    // not in STRETCH_ROUTINES and never will be. The screen holds the object,
    // exactly as it holds a fixed one, so nothing looks this up; it is here
    // because a routine needs an id and two built in one session must not
    // collide as React keys.
    id: `built-${focus.id}-${minutes}-${seed}`,
    // The length it ACTUALLY is, not the length that was asked for. A routine
    // titled "20-Minute" that runs twelve is the small lie somebody plans their
    // evening around, and it is the exact lie the shortfall below exists to
    // avoid, so the title must not reintroduce it.
    title: `${routineMinutes(asRoutine(ordered))}-Minute ${focus.label}`,
    note: `Built for you from ${ordered.length} equipment-free ${ordered.length === 1 ? 'stretch' : 'stretches'}, spread across your ${focus.phrase}.`,
    steps: ordered,
  };

  const built = routineMinutes(routine);
  return {
    routine,
    problem: null,
    shortfall: built < minutes
      ? `We have ${pool} equipment-free ${pool === 1 ? 'stretch' : 'stretches'} for your ${focus.phrase}, which is about ${built} minutes rather than the ${minutes} you asked for.`
      : null,
    canVary: picked.length < pool,
  };
}

/**
 * Everything wrong with a built routine, as sentences, on top of what
 * `routineProblems` already checks about any routine.
 *
 * These are the properties of the BUILDER — that it honoured the time, kept the
 * holds inside the bounds it set itself, and did not repeat a stretch. Run from
 * the test across every duration and focus the screen can ask for, because the
 * failure mode of a builder is not a crash: it is a routine that looks entirely
 * normal and runs four minutes over.
 */
export function buildProblems(built: BuiltRoutine, minutes: number): string[] {
  const problems: string[] = [];
  const r = built.routine;
  if (!r) return built.problem ? [] : ['there is no routine and no reason given for there not being one'];
  if (built.problem) problems.push('there is a routine and a problem sentence, and only one of those can be true');

  const total = routineTotalSec(r);
  // numbers-ok: this figure IS four digits — 1200 seconds for a twenty-minute
  // routine — and it is still right raw, because nobody reads it. `buildProblems`
  // is this module's own self-check: its only callers are the assertions in
  // src/lib/stretchBuilder.test.ts, which expect an EMPTY list, and a non-empty
  // one is a test failure message rather than a sentence on a screen. Grouping
  // it would put a comma in a string that is compared, and would make the one
  // reader of it — whoever is looking at a red test — read a formatted figure
  // where they want the arithmetic.
  if (total > minutes * 60) {
    // numbers-ok: as above — a test failure message, read by nobody else.
    problems.push(`the routine runs ${total}s against a budget of ${minutes * 60}s — somebody who said they had ${minutes} minutes is being kept ${total - minutes * 60}s longer`);
  }
  if (routineMinutes(r) < minutes && !built.shortfall) {
    problems.push(`the routine is ${routineMinutes(r)} minutes against ${minutes} asked for, and nothing says so`);
  }
  if (routineMinutes(r) >= minutes && built.shortfall) {
    problems.push('the routine fills the time and is apologising for not filling it');
  }
  const seen = new Set<string>();
  for (const step of r.steps) {
    if (seen.has(step.id)) problems.push(`${step.id} is in the routine twice`);
    seen.add(step.id);
    if (step.holdSec < BUILD_HOLD_SEC) problems.push(`${step.id} is held for ${step.holdSec}s, under the ${BUILD_HOLD_SEC}s a built stretch starts at`);
    if (step.holdSec > MAX_BUILT_HOLD_SEC) problems.push(`${step.id} is held for ${step.holdSec}s, over the ${MAX_BUILT_HOLD_SEC}s ceiling the top-up works to`);
    if (step.holdSec % TOPUP_STEP_SEC !== 0) problems.push(`${step.id} is held for ${step.holdSec}s, which is not a round number on a screen`);
  }
  return problems;
}
