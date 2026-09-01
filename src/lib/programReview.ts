/**
 * PROGRAMME CHECKS — a rule engine that reads a programme before it is assigned.
 *
 * ── What it is called, and why that is the first thing in this file ────────
 *
 * The roadmap item this was built from is headed "AI programme review". It is
 * not one, and it is not called one anywhere a coach can see. There is no
 * model here, no scores, no grade and no verdict: `reviewProgram` runs seven
 * named rules over the exercises a coach has typed and returns the ones that
 * matched, each carrying the day, the movement and the figure it matched on.
 * The screen says "Programme checks" and lists them.
 *
 * src/lib/financialAI.ts is why that sentence is at the top. It is ninety
 * lines of arithmetic — margin, churn, growth, a weighted score out of a
 * hundred — rendered under a heading reading "AI Financial Review", and the
 * label did real damage: a `grade >= 'A'` string comparison meant every gym on
 * the platform read "your gym is in strong financial health", and an owner
 * reading a *verdict from an AI* has nothing to check it against. An owner
 * reading "margin 4%, churn 9%/mo" would have seen the contradiction in a
 * second. Calling a rule engine what it is does not make it weaker; it hands
 * the reader the only thing that lets them disagree with it.
 *
 * ── Every finding names its evidence, and none of them is an opinion ───────
 *
 * A coach stops reading a list of findings at the first one they disagree
 * with, so a rule earns its place only if a coach who disagrees can point at
 * the specific thing it is wrong about. Every `Finding` therefore carries:
 *
 *   · `day`        the day as the coach named it, or null for the programme
 *   · `exercises`  the movements, spelled exactly as the coach wrote them
 *   · `detail`     one sentence, containing counts, seconds and rep targets
 *                  that are all readable off the screen behind it
 *   · `volume`     kilogram figures, for the ONE rule that has any
 *
 * Nothing here returns a score, a rating, a colour or a total. There is no
 * "programme quality" figure, because there is no number behind one.
 *
 * ── The rules ─────────────────────────────────────────────────────────────
 *
 *   injury         a movement that loads an area this client has disclosed
 *   set-count      `sets` disagreeing with the rows actually written out
 *   group-muscle   two movements in one superset sharing a primary group
 *   heavy-rest     a low-rep movement with a short rest, or none set at all
 *   warmup-volume  a movement NAMED as a warm-up whose sets count as work
 *   volume-jump    planned volume far above what this client has been doing
 *   goal-reps      rep targets counted against the goal on record
 *
 * ── And what is deliberately NOT checked ──────────────────────────────────
 *
 * Weekly set counts per muscle group, movement ordering, session length,
 * training frequency, "not enough posterior chain", exercise selection, and a
 * rep convention for a fat-loss or toning goal. Every one of those is a
 * coaching judgement with no settled answer, and a rule engine stating one as
 * a finding is exactly the failure this file's header is about. `NOT_CHECKED`
 * below names the ones a reader would expect to find and says so on the screen.
 *
 * ── Reads that did not land ───────────────────────────────────────────────
 *
 * Three of the seven rules need something other than the programme: the
 * client's disclosures, their training log, their goal. A rule whose input did
 * not load does NOT quietly return nothing — silence from a check reads as a
 * pass, and "no injury conflicts" over an injury list that failed to load is
 * the same lie `guardInjuries` in src/lib/injuryGate.ts exists to stop. Such a
 * rule goes into `skipped` with its reason, and `status` drops to 'partial' so
 * the screen can say which questions were not asked.
 *
 * Kilograms throughout, as everywhere else in this app. Nothing here converts
 * a unit or formats a load — `volume` hands the raw figures out and the screen
 * puts them through `volumeIn` in src/lib/units.ts, once, at the render
 * boundary. See the header of src/lib/exerciseHistory.ts for why that is not
 * negotiable.
 */
import type { Program } from './programs';
import type { Goal } from './types';
import type { Injury } from './injuries';
import { areaLabel, injuryFlag } from './injuries';
import type { WorkoutEntry } from './mockData';
import type { LoadStatus } from '../ui/loadStatus';
import { groupLabel, groupRuns } from './setGroups';
import { countsToVolume } from './setMethods';
import { expandSets, hasSetRows, plannedVolume, readRepSpan, setCount } from './setRows';
import { DEFAULT_REST_SEC } from './restTimer';
import { exerciseOutings } from './exerciseHistory';
import { pctChange } from './deltaLabel';

/* ── the catalogue ────────────────────────────────────────────────────────── */

export type CheckId =
  | 'injury' | 'set-count' | 'group-muscle' | 'heavy-rest'
  | 'warmup-volume' | 'volume-jump' | 'goal-reps';

export interface CheckDef {
  id: CheckId;
  /** What the check is, said to a coach. Sentence case: this is prose on the
   *  screen, not a button. */
  label: string;
  /** What it has to read besides the programme itself. */
  needs: 'programme' | 'injuries' | 'history' | 'goal';
}

/**
 * The rules, in the order their findings are listed.
 *
 * Injury first because it is the only one about somebody getting hurt, and
 * `set-count` second because it is a plain disagreement between two stored
 * numbers rather than anything about training. The rest are ordered by how
 * little interpretation they need, which puts `goal-reps` — the only one that
 * counts against a convention — last.
 */
export const CHECKS: readonly CheckDef[] = [
  { id: 'injury', label: 'movements that load a disclosed injury', needs: 'injuries' },
  { id: 'set-count', label: 'set counts that disagree with the sets written out', needs: 'programme' },
  { id: 'group-muscle', label: 'supersets whose movements share a muscle group', needs: 'programme' },
  { id: 'heavy-rest', label: 'rest on low-rep movements', needs: 'programme' },
  { id: 'warmup-volume', label: 'warm-ups and cool-downs counted as working volume', needs: 'programme' },
  { id: 'volume-jump', label: 'planned volume against what this client has been doing', needs: 'history' },
  { id: 'goal-reps', label: 'rep targets against the goal on record', needs: 'goal' },
];

const ORDER = new Map<CheckId, number>(CHECKS.map((c, i) => [c.id, i]));

/**
 * Checks a coach would reasonably expect to find here and will not, each with
 * the reason it is absent. Shown on screen, because a list of findings implies
 * a list of questions asked, and the ones not asked are part of that.
 *
 * They are not `skipped` entries: nothing failed to load and no future read
 * would enable them. They are decisions.
 */
export const NOT_CHECKED: readonly string[] = [
  'weekly sets per muscle group, which has no settled figure to check against',
  'the order movements are done in within a day',
  'how many days a week this client trains',
  'whether the exercises chosen suit the goal',
];

/* ── the thresholds, each with the reason it is that number ───────────────── */

/**
 * The top of a rep range at or below which `heavy-rest` calls a movement
 * low-rep. Six because it is the conventional top of a strength range and,
 * more to the point, because the rule only reports the rest — it does not say
 * the reps are wrong.
 */
export const HEAVY_REPS = 6;

/**
 * A rest short enough to be worth naming beside a low-rep movement, in
 * seconds. Under a minute between sets of five is a decision, not an oversight
 * — the finding says what was written and lets the coach agree with it.
 */
export const SHORT_REST_SEC = 60;

/**
 * How far above a client's own recent best a planned volume has to sit before
 * `volume-jump` reports it. Half again, which is a big enough step that the
 * arithmetic is not the interesting part — a coach ramping 10% a week never
 * sees this, and one who copied a template written for somebody else does.
 */
export const VOLUME_JUMP = 1.5;

/** How many of the client's most recent sessions on a movement are compared
 *  against. Six, so a single heavy day is not treated as their normal and a
 *  block from six months ago is not either. */
export const RECENT_OUTINGS = 6;

/**
 * The rep count at or above which `goal-reps` counts a working set as high-rep
 * against a muscle-building goal. Fifteen, and the WHOLE range has to be at or
 * above it — "12-15" is not counted, "15-20" is — so a coach who programmed a
 * range that merely reaches fifteen is never told anything.
 */
export const HIGH_REPS = 15;

/** The fewest high-rep sets `goal-reps` will report, whatever the share. Three,
 *  because two sets is a finisher and not a pattern. */
export const MIN_GOAL_SETS = 3;

/* ── what comes out ───────────────────────────────────────────────────────── */

/** The kilogram figures behind a `volume-jump` finding. Raw, for the screen to
 *  convert — this module prints no loads. */
export interface VolumeEvidence {
  /** The planned working volume, Σ reps × load at the LOW end of every rep
   *  range, over the sets whose method counts. Kilograms. */
  plannedKg: number;
  /** The most this client has actually logged for the movement in one day
   *  within the compared window. Kilograms. */
  bestKg: number;
  /** How far above, as a percentage, for `deltaLabel`. Null when the earlier
   *  figure is zero and the arithmetic has nothing to say. */
  changePct: number | null;
  /** `YYYY-MM-DD` of that best session, or null when the record carries no
   *  readable date for it. Never faked to a day nobody trained on. */
  bestDay: string | null;
  /** How many sessions were compared. Named so the finding cannot imply a
   *  longer record than was read. */
  compared: number;
}

export interface Finding {
  id: CheckId;
  /** The day as the coach named it — 'Mon', 'Day 1' — or null where the
   *  finding is about the whole programme. */
  day: string | null;
  /** The movements, spelled as the coach wrote them. */
  exercises: string[];
  /** One sentence, sentence case. Every figure in it is one the coach can read
   *  off the exercise it names. */
  detail: string;
  /** Kilograms, for the screen to convert. Null on every rule but one. */
  volume: VolumeEvidence | null;
}

export interface SkippedCheck {
  id: CheckId;
  /** 'unread' means something did not load and the answer is unknown;
   *  'absent' means the input is legitimately not there and no read would
   *  change it. Only 'unread' moves `status`. */
  kind: 'unread' | 'absent';
  /** Addressed to the coach, sentence case. */
  why: string;
}

export interface ProgramReview {
  /**
   * 'ready' when every rule ran. 'partial' when at least one could not, and
   * `skipped` says which. 'loading' and 'error' are never returned: the
   * programme itself is on the screen in front of the coach, so the structural
   * rules always run and there is always something true to show.
   */
  status: LoadStatus;
  findings: Finding[];
  skipped: SkippedCheck[];
  /** What was read, so the screen can say how much the checks covered rather
   *  than implying they covered a programme. */
  counted: { days: number; exercises: number; sets: number };
}

export interface ReviewInput {
  program: Program | null | undefined;
  /**
   * The client's disclosures, and how that read went.
   *
   * Three answers, exactly as `log` below has three. An ARRAY is what they
   * have disclosed, and it is trusted only under a 'ready' status — an empty
   * list under any other means "we did not find out", not "there are none",
   * which is the distinction src/lib/injuryGate.ts was written for. `null` is
   * that there is no client attached to this draft at all, so there is nobody
   * to have disclosed anything and the check stands down rather than reporting
   * a clean programme it never looked for injuries in.
   */
  injuries: readonly Injury[] | null;
  injuryStatus: LoadStatus;
  /**
   * The client's training log, and how that read went.
   *
   * `null` is a THIRD answer and not an empty log: it means there is nobody to
   * compare against — a template open with no client picked, or a client the
   * coach typed in by hand who has no account to have logged anything under.
   * The volume check stands down for it, where an empty array would run it and
   * report nothing, which reads as a check that ran and passed.
   */
  log: readonly WorkoutEntry[] | null;
  logStatus: LoadStatus;
  /**
   * The goal on record, or null. Null is the ordinary case for a template with
   * no client attached and for a client whose goal was never set, and it is
   * reported as 'absent' rather than 'unread' — the builder already withholds
   * a generated programme when it cannot read a goal, and saying the checks
   * are degraded on top of that would be a second alarm for one fact.
   */
  goal: Goal | null;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** A movement's name as it will be printed. A blank name is a real state — the
 *  builder lets a coach add a custom exercise and clear the field — and a
 *  sentence beginning with nothing reads as a broken screen, which is what
 *  scripts/check-prose.mjs exists to stop. */
const nameOf = (name: string | null | undefined): string =>
  (name ?? '').trim() || 'an unnamed movement';

/** A day as it will be printed, for the same reason. */
const dayOf = (day: string | null | undefined): string =>
  (day ?? '').trim() || 'an unnamed day';

/** The sets of an exercise whose method counts as training volume. Warm-ups
 *  and cool-downs are not work being reviewed, and every rule below that talks
 *  about "working sets" means these. */
function workingSets(ex: Parameters<typeof expandSets>[0]) {
  return expandSets(ex).filter((s) => countsToVolume(s.method));
}

/**
 * The top of an exercise's rep range across its working sets, or null.
 *
 * Null when ANY working set carries reps that are not a count — "45 sec" is an
 * isometric hold and "AMRAP" is a set whose reps are decided in the gym — so a
 * rule that needs a rep target declines to run rather than reading one of them
 * as a number. See `readRepSpan` in src/lib/setRows.ts.
 */
function topRep(ex: Parameters<typeof expandSets>[0]): number | null {
  const highs: number[] = [];
  for (const s of workingSets(ex)) {
    const span = readRepSpan(s.reps);
    if (!span) return null;
    highs.push(span.high);
  }
  // The empty case is answered here rather than by a starting value. This was
  // `let top = 0` with a running `>` comparison, and a mutation run moved the
  // seed to 1 and flipped the comparison to `>=` without a single assertion
  // noticing either — a max needs no seed and no branch, so there is nothing
  // left to be silently wrong about.
  if (!highs.length) return null;
  return Math.max(...highs);
}

/** Whether a rest was actually set on this exercise, by the same test
 *  `restSecondsFor` uses to decide it has to fall back. A zero is not a rest:
 *  `startRest(0)` is how the runner CLEARS the timer. */
function restWasSet(restSec: number | null | undefined): boolean {
  return typeof restSec === 'number' && Number.isFinite(restSec) && restSec > 0;
}

const WARMUP_NAME = /\bwarm[\s-]?ups?\b/i;
const COOLDOWN_NAME = /\bcool[\s-]?downs?\b/i;

/**
 * A detail line as a sentence, with its first character upper-cased.
 *
 * Every detail below opens with a movement name, and a coach may have typed
 * one in lower case or left it blank — and then the finding reads "bench press
 * on Mon loads the shoulder" or, worse, opens on `nameOf`'s fallback phrase.
 * A sentence that starts small looks like the screen has lost its first word,
 * which is the exact fault scripts/check-prose.mjs was written for.
 *
 * It changes only the first letter of the SENTENCE. `Finding.exercises` still
 * carries the movement spelled exactly as the coach wrote it, and that is what
 * a screen renders where the name stands on its own.
 */
const sentence = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ── the engine ───────────────────────────────────────────────────────────── */

export function reviewProgram(input: ReviewInput): ProgramReview {
  const days = input.program?.days ?? [];
  const findings: Finding[] = [];
  const skipped: SkippedCheck[] = [];

  let exercises = 0;
  let sets = 0;
  for (const d of days) {
    for (const ex of d.exercises) { exercises += 1; sets += setCount(ex); }
  }

  /* ── injury ───────────────────────────────────────────────────────────── */
  // Asked BEFORE anything is reported, and the order matters for the same
  // reason it does in guardInjuries: an empty disclosure list means "they have
  // disclosed nothing" only when the read that produced it finished.
  if (input.injuries == null) {
    skipped.push({
      id: 'injury', kind: 'absent',
      why: 'There is no client attached to this draft, so no movement here has been checked against a disclosed injury.',
    });
  } else if (input.injuryStatus !== 'ready') {
    skipped.push({
      id: 'injury', kind: 'unread',
      why: input.injuryStatus === 'loading'
        ? 'This client\'s injuries are still being read, so nothing here has been checked against them.'
        : 'This client\'s injuries could not be read, so no movement here has been checked against them. A programme written around an injury nobody has seen is what this check exists to catch.',
    });
  } else {
    const injuries = input.injuries as Injury[];
    for (const d of days) {
      for (const ex of d.exercises) {
        const flag = injuryFlag(ex.name, ex.group, injuries);
        if (!flag) continue;
        findings.push({
          id: 'injury', day: d.day, exercises: [nameOf(ex.name)], volume: null,
          detail: sentence(`${nameOf(ex.name)} on ${dayOf(d.day)} loads the ${areaLabel(flag.injury.area).toLowerCase()}, `
            + `which this client has disclosed as ${flag.injury.severity} and still active.`),
        });
      }
    }
  }

  /* ── set-count ────────────────────────────────────────────────────────── */
  // `sets` and the length of `setRows` are ONE fact — src/lib/setRows.ts says
  // so at length — and every progress reader in the client's app counts against
  // `sets` alone. A four-row exercise carrying `sets: 3` shows somebody
  // "3 of 3 sets" with a fourth row underneath that nothing will ever log.
  for (const d of days) {
    for (const ex of d.exercises) {
      if (!hasSetRows(ex)) continue;
      const rows = (ex.setRows ?? []).length;
      const stored = Number.isFinite(ex.sets) ? Math.floor(ex.sets) : null;
      if (stored === rows) continue;
      findings.push({
        id: 'set-count', day: d.day, exercises: [nameOf(ex.name)], volume: null,
        detail: sentence(stored == null
          ? `${nameOf(ex.name)} on ${dayOf(d.day)} has ${rows} sets written out but no usable stored set count, `
            + 'and the client\'s app counts their progress against the stored figure.'
          : `${nameOf(ex.name)} on ${dayOf(d.day)} has ${rows} sets written out but is stored as ${stored}, `
            + 'and the client\'s app counts their progress against the stored figure.'),
      });
    }
  }

  /* ── group-muscle ─────────────────────────────────────────────────────── */
  // A superset is two movements done back to back with no rest between them.
  // Two that load the same primary group are the second one being done tired
  // by the first, which a coach may well want — so this reports the pair and
  // the group they share, and says nothing about whether it is wrong.
  for (const d of days) {
    const list = d.exercises;
    for (const run of groupRuns(list)) {
      const label = groupLabel(run.size).toLowerCase();
      for (let k = 0; k < run.size - 1; k += 1) {
        const a = list[run.start + k];
        const b = list[run.start + k + 1];
        const ga = (a.group ?? '').trim();
        const gb = (b.group ?? '').trim();
        // `!gb` is not asked: if `ga` is not blank and the two compare equal,
        // `gb` is not blank either. It was there, and a mutation run rewrote it
        // to `&&` without changing a single result, which is what a term that
        // another term already implies looks like.
        if (!ga || ga.toLowerCase() !== gb.toLowerCase()) continue;
        findings.push({
          id: 'group-muscle', day: d.day,
          exercises: [nameOf(a.name), nameOf(b.name)], volume: null,
          detail: sentence(`${nameOf(a.name)} and ${nameOf(b.name)} are next to each other in the same ${label} on `
            + `${dayOf(d.day)}, and both are listed under ${ga}. There is no rest between them.`),
        });
      }
    }
  }

  /* ── heavy-rest ───────────────────────────────────────────────────────── */
  // Only ever reports what is written. The absent case is the one worth having:
  // a coach who left rest blank on a set of triples has not chosen 90 seconds,
  // they have not been told that is what their client's timer will run.
  for (const d of days) {
    for (const ex of d.exercises) {
      const top = topRep(ex);
      if (top == null || top > HEAVY_REPS) continue;
      if (restWasSet(ex.restSec)) {
        const secs = Math.round(ex.restSec as number);
        if (secs >= SHORT_REST_SEC) continue;
        findings.push({
          id: 'heavy-rest', day: d.day, exercises: [nameOf(ex.name)], volume: null,
          detail: sentence(`${nameOf(ex.name)} on ${dayOf(d.day)} is written at ${top} reps or fewer with ${secs} `
            + `second${secs === 1 ? '' : 's'} of rest between sets.`),
        });
      } else {
        findings.push({
          id: 'heavy-rest', day: d.day, exercises: [nameOf(ex.name)], volume: null,
          detail: sentence(`${nameOf(ex.name)} on ${dayOf(d.day)} is written at ${top} reps or fewer and has no rest set, so `
            + `the client's timer will run the ${DEFAULT_REST_SEC} second fallback between sets.`),
        });
      }
    }
  }

  /* ── warmup-volume ────────────────────────────────────────────────────── */
  // The METHOD decides what counts as volume, never the name — that is the
  // whole point of `countsToVolume` in src/lib/setMethods.ts. So a movement a
  // coach NAMED as a warm-up while leaving its sets ordinary is a disagreement
  // between the two, and the one the app will act on is the method.
  for (const d of days) {
    for (const ex of d.exercises) {
      const isWarm = WARMUP_NAME.test(ex.name ?? '');
      const isCool = COOLDOWN_NAME.test(ex.name ?? '');
      if (!isWarm && !isCool) continue;
      const counted = workingSets(ex).length;
      if (!counted) continue;
      const total = setCount(ex);
      findings.push({
        id: 'warmup-volume', day: d.day, exercises: [nameOf(ex.name)], volume: null,
        detail: sentence(`${nameOf(ex.name)} on ${dayOf(d.day)} is named as a ${isWarm ? 'warm-up' : 'cool-down'} but `
          + `${counted} of its ${total} sets are ordinary working sets, so they will count towards this client's `
          + 'training volume.'),
      });
    }
  }

  /* ── volume-jump ──────────────────────────────────────────────────────── */
  if (input.log == null) {
    skipped.push({
      id: 'volume-jump', kind: 'absent',
      why: 'There is no client attached to this draft, so nothing here has been compared with a training history.',
    });
  } else if (input.logStatus !== 'ready') {
    skipped.push({
      id: 'volume-jump', kind: 'unread',
      why: input.logStatus === 'loading'
        ? 'This client\'s training log is still being read, so nothing here has been compared with what they have actually been doing.'
        : 'This client\'s training log could not be read, so nothing here has been compared with what they have actually been doing.',
    });
  } else {
    const log = input.log;
    for (const d of days) {
      for (const ex of d.exercises) {
        const tally = plannedVolume(ex);
        // A SHORT-CIRCUIT, and it is labelled as one rather than as a
        // correctness test, because it is not: `exerciseOutings` folds this
        // client's whole capped log on every call, and this is what stops it
        // being walked for a bodyweight movement with no volume to compare.
        // The condition that actually decides the finding is the comparison
        // below, which an exercise of no volume fails anyway. It used to read
        // `|| tally.lowKg <= 0` as well; a mutation run moved that zero to a
        // one and flipped its operator with nothing able to tell, because the
        // comparison below already covers every case it did.
        if (!tally.counted) continue;
        const outings = exerciseOutings(log, ex.name ?? '')
          .filter((o) => o.volumeKg != null)
          .slice(0, RECENT_OUTINGS);
        if (!outings.length) continue;
        let best = outings[0];
        for (const o of outings) if ((o.volumeKg as number) > (best.volumeKg as number)) best = o;
        const bestKg = best.volumeKg as number;
        // No `bestKg <= 0` guard: `volumeKg` in src/lib/exerciseHistory.ts is
        // `anyVolume ? Math.round(volume) : null`, and `anyVolume` is set only
        // by a set whose load is above zero — so a non-null one is a positive
        // integer. A mutation run moved that guard's zero to a one and flipped
        // its operator with nothing able to tell, which is what a condition
        // that cannot be false looks like.
        if (tally.lowKg <= bestKg * VOLUME_JUMP) continue;
        findings.push({
          id: 'volume-jump', day: d.day, exercises: [nameOf(ex.name)],
          detail: sentence(`${nameOf(ex.name)} on ${dayOf(d.day)} is written at more working volume than this client has `
            + `logged for it in any of their last ${outings.length} sessions on record.`),
          volume: {
            // Neither figure is rounded again here. `plannedVolume` rounds its
            // own totals to two places, and `volumeKg` is a whole number by
            // construction — a second round2 over both was a line no assertion
            // could ever watch change.
            plannedKg: tally.lowKg,
            bestKg,
            changePct: pctChange(tally.lowKg, bestKg),
            bestDay: best.day,
            compared: outings.length,
          },
        });
      }
    }
  }

  /* ── goal-reps ────────────────────────────────────────────────────────── */
  // Runs for ONE goal, and reports a COUNT rather than a verdict.
  //
  // Fat loss and toning are not checked at all, and that is the honest answer
  // rather than a gap: there is no rep convention for either that this file
  // could state without inventing one, and a rule engine asserting an invented
  // convention as a finding is the thing the header of this file is about.
  // Muscle is checked only on the high side — a set of three inside a
  // hypertrophy block is ordinary strength work and nothing is said about it.
  if (input.goal == null) {
    skipped.push({
      id: 'goal-reps', kind: 'absent',
      why: 'No goal is on record for this client, so the rep targets have nothing to be counted against.',
    });
  } else if (input.goal !== 'muscle') {
    skipped.push({
      id: 'goal-reps', kind: 'absent',
      why: `The goal on record is ${input.goal === 'fatloss' ? 'fat loss' : 'toning'}, and there is no rep `
        + 'convention for it these checks could state without making one up.',
    });
  } else {
    let high = 0;
    let readable = 0;
    for (const d of days) {
      for (const ex of d.exercises) {
        for (const s of workingSets(ex)) {
          const span = readRepSpan(s.reps);
          if (!span) continue;
          readable += 1;
          if (span.low >= HIGH_REPS) high += 1;
        }
      }
    }
    if (high >= MIN_GOAL_SETS && high * 2 > readable) {
      findings.push({
        id: 'goal-reps', day: null, exercises: [], volume: null,
        detail: `The goal on record is to build muscle, and ${high} of the ${readable} working sets with a readable `
          + `rep target are written at ${HIGH_REPS} reps or more.`,
      });
    }
  }

  // `!` rather than `?? 0`: every `CheckId` is a key of `CHECKS` by
  // construction, so the fallback was an arm nothing could reach and a
  // mutation could rewrite unchallenged.
  findings.sort((a, b) => ORDER.get(a.id)! - ORDER.get(b.id)!);

  return {
    // Only an UNREAD skip degrades this. A goal that was never set is not a
    // failed read and the builder already says so in its own words; reporting
    // it twice would train a coach to ignore the word "partial" on a screen
    // where it also means an injury list that did not load.
    status: skipped.some((s) => s.kind === 'unread') ? 'partial' : 'ready',
    findings,
    skipped,
    counted: { days: days.length, exercises, sets },
  };
}

/**
 * The one line the screen puts above the list, saying what this is.
 *
 * Built here rather than typed into the screen so the count cannot drift from
 * `CHECKS`, and so the sentence that refuses the word "AI" lives next to the
 * rules it is refusing it on behalf of.
 */
export function checksLine(): string {
  return `${CHECKS.length} checks run over this draft. They are rules, not a model, and each finding names the `
    + 'exercise, day or figure it came from.';
}
