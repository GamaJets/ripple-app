// Work per MUSCLE over a window — the layer the body diagram, the Training
// Summary, the Recovery Map and the rankings all stand on.
//
// ── Why this is beside src/lib/muscleVolume.ts and not inside it ───────────
//
// This was the first decision and it is the load-bearing one, so it is written
// out rather than left to be inferred from two files with similar names.
//
// `muscleBoard` keys on the catalogue's `muscle_group`: eleven display strings,
// one per movement, chosen so a Library filter has something to filter on. It
// is exactly right for "have I trained legs this week" and it is unusable for a
// picture of a body, for two reasons measured on production (608 rows):
//
//   · 200 of the 608 movements are filed under 'Full body'. A third of the
//     catalogue lands in a bucket that names no part of anybody. Lighting a
//     diagram from that colours the whole figure for a kettlebell swing.
//   · a group is ONE string per movement. A back squat is 'Legs'. The
//     catalogue already knows it is quadriceps and gluteus maximus primarily
//     and hamstrings, erector spinae and adductors besides — five muscles, in
//     `primary_muscles` and `secondary_muscles`, populated on 601 and 563 of
//     the 608 rows. The group throws all of that away.
//
// So this file joins on the same key (`exerciseSlug`) against the same table
// and reads the finer columns. It is NOT an extension of `muscleBoard`, and
// widening `MuscleWork` in place would have been a silent defect rather than a
// refactor: a group total is ADDITIVE across rows and a muscle total is not.
// One set of back squats is three sets under 'Legs' and three sets under EACH
// of five muscles, so `Σ board.muscles[].primarySets` is not the number of sets
// anybody performed. Every existing caller that sums or ranks `muscleBoard`'s
// rows would have started double-counting on the commit that widened it, and
// nothing would have failed. `setsCounted` on the board below is the figure a
// screen must use for "sets performed"; the per-muscle counts are per muscle
// and may not be added up.
//
// `muscleBoard` stays. Library filters on the group, the group is what a coach
// writes on a programme, and the two answers are answers to two questions.
//
// ── How a secondary muscle counts, and why it is not one ───────────────────
//
// `SECONDARY_SHARE` below. The reasoning is in full on the constant, because
// it is the single number in this file that somebody will want to change and
// there is nothing in the data that could settle an argument about it.
//
// ── What this file refuses to compute ──────────────────────────────────────
//
// A weighted TONNAGE. It would have been the obvious symmetry — half the
// kilograms to the assisting muscle — and it is the one figure here that would
// have been a fabrication rather than a summary. A kilogram is a physical unit:
// "your hamstrings moved 4,200 kg" is a measurement nobody took, of a quantity
// that does not exist, and a member reading it would have no way to know. What
// actually happened is that a bar carrying 8,400 kg of work moved through sets
// in which the catalogue names the hamstrings as an assistant. So the tonnages
// below are UNWEIGHTED and are labelled by the role rather than by the muscle —
// `primaryVolumeKg` is the tonnage of the sets in which this muscle was the
// prime mover, not the tonnage this muscle produced.
//
// The weighting lives only in `primaryEquivalentSets`, which is dimensionless
// and is a ranking score. It is named the way it is so that it cannot be
// printed as "sets" by accident — a member who did six direct trapezius sets
// must never read "18 sets" because thirty other movements listed the
// trapezius as an assistant.
//
// ── And the catalogue's vocabulary is wider than the artwork's ─────────────
//
// Checked on production: 30 distinct muscle names across both columns, of which
// 27 ever appear as a primary. The three that never do are `serratus anterior`
// (40 movements), `supraspinatus` (1) and `forearms` (1) — and src/lib/
// muscleMap.ts, which was built against the 27, draws none of them. That is not
// a bug in the map and this file does not paper over it: `serratus anterior` is
// genuinely not a layer in assets/muscle-heatmap/manifest.json, and there is no
// honest muscle to stand in for it. It arrives here as work that happened,
// counts in every ranking, and is reported through `undrawn` so the screen
// showing the picture can say what the picture is missing. Counting it and
// drawing nothing, silently, is the failure `unmapped()` exists to prevent.
import type { WorkoutEntry } from './mockData';
import { exerciseSlug } from './exerciseId';
import { entryTonnage, type BodyweightHistory } from './bodyweightSets';
import { isTimedSet } from './timedSets';
import { unmapped, approximations, drawnIntensity, type DrawnMuscle } from './muscleMap';
import { isWhole, worstStatus, type LoadStatus } from '../ui/loadStatus';

/**
 * What the join needs from a catalogue row.
 *
 * Declared structurally rather than imported from src/ui/exerciseDetail.ts, for
 * the reason `GroupedExercise` gives in src/lib/muscleVolume.ts: that module
 * pulls in React and Supabase and this one has to run under plain node for its
 * test. The field names match `ExerciseDetail` exactly, so a detail row
 * satisfies this without a mapping step.
 */
export interface MuscledExercise {
  /** The catalogue's id, which IS the slug. */
  id: string;
  name: string;
  /** The catalogue's TRAINING vocabulary, space-separated: 'gluteus maximus'. */
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

/**
 * What one set of a movement is worth to a muscle the catalogue lists as an
 * ASSISTANT, relative to one in which it is the prime mover.
 *
 * ── Why it is not 1 ────────────────────────────────────────────────────────
 *
 * Because the annotation is far commoner than the training. Counted on
 * production, `hamstrings` is a primary on 55 movements and a secondary on 115;
 * `erector spinae` 44 and 102; `trapezius` 33 and 99; `anterior deltoid` 59 and
 * 100. At parity those four would sit at the top of nearly every member's
 * ranking, not because anybody trains them hardest but because the catalogue
 * mentions them on almost everything. A "most trained muscle" that is really a
 * measure of how often a word appears in a text column is worse than no
 * ranking: it is confidently wrong and it looks like a finding.
 *
 * ── Why it is not 0 ────────────────────────────────────────────────────────
 *
 * Because 563 of the 608 rows carry the column and it is the only record of the
 * work. Ninety-five movements list the triceps as an assistant. A diagram that
 * draws a bench presser's triceps cold, after a week of pressing, is telling
 * them their log is broken.
 *
 * ── Why exactly one half ───────────────────────────────────────────────────
 *
 * A half is a claim a person can hold: assisting counts half as much as doing.
 * Anything finer would be a lie about the source. `secondary_muscles` is an
 * ungraded list — every name in it is as secondary as every other, there is no
 * ordering and no magnitude — so there is nothing in the data that could
 * distinguish 0.35 from 0.5, and printing a ranking built on 0.35 would imply a
 * precision that was invented here rather than measured anywhere. Physiology
 * cannot settle it either: this is a text annotation, not an EMG reading, and
 * the same word covers a triceps in a close-grip press and a triceps in a
 * pullover.
 *
 * So it is a DISPLAY WEIGHT and it is stated as one. `RANKING_BASIS` below is
 * the sentence a screen shows next to any ordering that used it, so a member is
 * never left to assume a measurement happened.
 */
export const SECONDARY_SHARE = 0.5;

/** What a screen must say beside an ordering built on `SECONDARY_SHARE`. */
export const RANKING_BASIS =
  'Ordered by sets, counting a set where the muscle is the main mover as one ' +
  'and a set where it assists as a half. The exercise catalogue lists which ' +
  'muscles assist but not how much, so this is a way of ordering the list ' +
  'rather than a measurement of effort.';

/** One muscle's window. Rows are PER MUSCLE and may not be added together —
 *  see the header: one set reaches every muscle the movement names. */
export interface MuscleEffort {
  /** The catalogue's own name, lowercased: 'gluteus maximus'. */
  muscle: string;
  /** Sets in which this muscle was named the prime mover. A whole count of
   *  real sets, safe to print as "sets". Warm-ups are in it, for the reason
   *  `MuscleWork.sets` gives: a warm-up squat still loads the quadriceps. */
  primarySets: number;
  /** Sets in which the catalogue named it an assistant. Also a whole count of
   *  real sets, and also safe to print — as ASSISTING sets, never added to the
   *  line above and shown as one total. */
  secondarySets: number;
  /**
   * `primarySets + SECONDARY_SHARE × secondarySets`.
   *
   * Dimensionless, and named at length on purpose. It is a ranking score in
   * units of prime-mover sets and it is NOT a number of sets performed. A
   * screen may order on it and may not print it with the word "sets" after it.
   */
  primaryEquivalentSets: number;
  /** Σ reps × load over the sets where this muscle was the prime mover, in
   *  kilograms; null, never 0, when none of them could be priced. Unweighted,
   *  and it is the tonnage of the SETS, not of the muscle — see the header. */
  primaryVolumeKg: number | null;
  /** The same, over the sets where it assisted. Kept apart rather than summed
   *  because the two mean different things and one total would mean neither. */
  secondaryVolumeKg: number | null;
  /** Sets counted above whose load nobody has recorded, so they are in no
   *  tonnage here — a bodyweight set with no weigh-in behind it. */
  unpricedSets: number;
  /** Distinct movements that reached this muscle, as they were written. */
  exercises: string[];
  /** The most recent instant a counted set named this muscle, or null. Raw ms
   *  rather than a day key, because src/lib/muscleRecovery.ts has to reason
   *  about elapsed time and a day key has already thrown that away. */
  lastTrainedMs: number | null;
  /** `YYYY-MM-DD`, LOCAL, for the same instant. What a screen prints. */
  lastDay: string | null;
  /**
   * Sets on `lastDay` that named this muscle, in either role.
   *
   * The DAY and not the entry, for the reason `WeekStats.days` gives at length:
   * one gym visit writes several rows with several timestamps, so the sets
   * belonging to "the last time I trained this" are the day's, not the newest
   * row's. Role-agnostic on purpose — this is the answer to "what did I ask it
   * to do", and a member does not think of eight sets of pressing as six
   * triceps sets and two.
   */
  lastDaySets: number;
  /** True when the muscle reaches at least one overlay in the artwork. False
   *  for the ones the picture cannot show — see `undrawn` on the board. */
  drawn: boolean;
}

export interface MuscleWorkBoard {
  /** Highest `primaryEquivalentSets` first. A muscle with no work in the
   *  window is ABSENT rather than present with a zero, for the reason
   *  `MuscleBoard.groups` gives: thirty rows of noughts read as thirty
   *  measurements. Absence is `untrainedMuscles`, and only when it can be
   *  stated at all. */
  muscles: MuscleEffort[];
  /**
   * Sets counted, once each.
   *
   * THE figure for "sets performed". `Σ muscles[].primarySets` is not it and is
   * not close: one set of back squats is one set here and five muscles up
   * there. This exists so no screen has to work that out.
   */
  setsCounted: number;
  /** The window that was asked for. */
  sinceMs: number;
  nowMs: number;
  /**
   * The oldest instant actually counted, or null when nothing was.
   *
   * A screen captioned "the last 90 days" over a log whose first row is twelve
   * days old is describing a window rather than a record, and this codebase has
   * already shipped the other half of that mistake — "Since the first day on
   * record" printed over 84 days of a three-year history. A caption may name
   * the window OR the record; this is the record, and `windowNote()` picks.
   */
  coveredFromMs: number | null;
  /**
   * Every muscle name the catalogue uses anywhere, or null when the catalogue
   * read was not whole.
   *
   * Null is not "none". It is the same rule `MuscleBoard.untrained` follows:
   * the vocabulary is the list an absence would be asserted against, so it may
   * only be published when the list itself was read completely.
   */
  vocabulary: string[] | null;
  /**
   * Catalogue names in this window that the artwork cannot draw, from
   * `unmapped()`. `serratus anterior` is the real one — 40 movements name it
   * and the manifest has no layer for it. Work that happened, counted in every
   * figure here, and not in the picture.
   */
  undrawn: string[];
  /** The approximations the picture would be relying on, as sentences, from
   *  `approximations()`. A screen lighting an approximate muscle says so. */
  approximations: string[];
  /** Movements no catalogue row matched, by the name they were logged under.
   *  Same meaning and same reason as `MuscleBoard.unmatched`. */
  unmatched: string[];
  unmatchedSets: number;
  /**
   * Movements that DID match a catalogue row, where the row names no muscle at
   * all. Seven rows on production are like this.
   *
   * Deliberately not folded into `unmatched`: the two need different sentences
   * and different fixes. An unmatched movement is one the member typed that we
   * have never heard of; an unattributed one is in our catalogue with a gap in
   * it, which is ours to close and not theirs.
   */
  unattributed: string[];
  unattributedSets: number;
  /** The worst of the log and catalogue reads. Gate every figure above on
   *  `isWhole(status)` — never on `status !== 'error'`. */
  status: LoadStatus;
  /**
   * True when every count and tonnage above is a FLOOR: at least this, possibly
   * more, because the read came back at PostgREST's row ceiling and what is
   * here is a prefix of an unknown set (see src/lib/rowCap.ts). A screen must
   * word the figure as a floor rather than printing it as a total.
   */
  isFloor: boolean;
}

export const EMPTY_WORK_BOARD: MuscleWorkBoard = {
  muscles: [], setsCounted: 0, sinceMs: 0, nowMs: 0, coveredFromMs: null,
  vocabulary: null, undrawn: [], approximations: [], unmatched: [], unmatchedSets: 0,
  unattributed: [], unattributedSets: 0, status: 'loading', isFloor: false,
};

/** The LOCAL calendar day an instant falls on. Matches `dayKey` in
 *  ./streaks.ts and `dayOf` in ./muscleVolume.ts, for the reason given there:
 *  an evening session in a UTC+2 gym belongs to the evening, not to tomorrow. */
const dayOf = (ms: number): string => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** Names off a catalogue row, normalised and deduplicated. A row that repeats a
 *  name, or that lists the same muscle as primary and secondary, must not count
 *  it twice — the catalogue is hand-written and one row already does. */
const namesOf = (v: unknown): string[] => {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  for (const x of v) { const n = norm(x); if (n && !out.includes(n)) out.push(n); }
  return out;
};

/** A dimensionless score is still floating point. Three places is far finer
 *  than any ordering needs and keeps `0.5 × 3` from arriving as 1.4999…. */
const score = (n: number): number => Math.round(n * 1000) / 1000;

interface Acc {
  muscle: string;
  primarySets: number;
  secondarySets: number;
  primaryKg: number;
  secondaryKg: number;
  primaryPriced: boolean;
  secondaryPriced: boolean;
  unpricedSets: number;
  exercises: string[];
  lastTrainedMs: number | null;
  lastDayKey: string;
  lastDaySets: number;
}

/**
 * Work per muscle over a window.
 *
 * `sinceMs` is inclusive. An entry whose timestamp will not parse is left out
 * entirely rather than filed under today — the defect src/lib/ownTraining.ts
 * documents. Cardio is left out too, for the reason `muscleBoard` gives: a run
 * has no primary mover in the catalogue's sense and inventing one here would be
 * this file holding the opinion its header refuses to hold.
 *
 * `logStatus` and `catalogueStatus` are carried, not consulted for filtering.
 * The arithmetic is the same however the rows arrived; what changes is what a
 * screen is allowed to SAY about the answer, and that is `status` and `isFloor`
 * on the result.
 */
export function muscleWorkBoard(
  log: readonly WorkoutEntry[],
  catalogue: readonly MuscledExercise[],
  opts: {
    sinceMs: number;
    nowMs?: number;
    history?: BodyweightHistory;
    logStatus?: LoadStatus;
    catalogueStatus?: LoadStatus;
  },
): MuscleWorkBoard {
  const {
    sinceMs, nowMs = Date.now(), history = [],
    logStatus = 'ready', catalogueStatus = 'ready',
  } = opts;
  const status = worstStatus(logStatus, catalogueStatus);

  const bySlug = new Map<string, { primary: string[]; secondary: string[] }>();
  const vocab = new Set<string>();
  for (const row of catalogue) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    const primary = namesOf(row.primaryMuscles);
    // A name that is already a primary on the same row is not also an
    // assistant on it. Without this the muscle would take a set AND half a set
    // off one movement, which is a score above what doing it outright is worth.
    const secondary = namesOf(row.secondaryMuscles).filter((m) => !primary.includes(m));
    bySlug.set(row.id, { primary, secondary });
    for (const m of primary) vocab.add(m);
    for (const m of secondary) vocab.add(m);
  }

  const acc = new Map<string, Acc>();
  const unmatched = new Map<string, number>();
  const unattributed = new Map<string, number>();
  let unmatchedSets = 0, unattributedSets = 0, setsCounted = 0;
  let coveredFromMs: number | null = null;

  for (const e of log) {
    if (!e || typeof e.t !== 'string') continue;
    const ms = Date.parse(e.t);
    if (!Number.isFinite(ms) || ms < sinceMs || ms > nowMs) continue;
    if (!e.sets?.length) continue;
    // A hold loaded the muscle and is a set; it carries no tonnage, which
    // `entryTonnage` already knows. Identical to `muscleBoard`'s line, and
    // identical on purpose — two files counting sets differently is how one
    // screen came to disagree with the screen beside it.
    const setCount = e.sets.filter((s, i) => (s?.[0] ?? 0) > 0 || isTimedSet(e, i)).length;
    if (setCount <= 0) continue;
    const slug = exerciseSlug(e.exercise || '');
    const row = slug ? bySlug.get(slug) : undefined;
    const name = (e.exercise || '').trim() || 'Unnamed';
    if (!row) {
      unmatched.set(name, (unmatched.get(name) ?? 0) + setCount);
      unmatchedSets += setCount;
      continue;
    }
    if (!row.primary.length && !row.secondary.length) {
      unattributed.set(name, (unattributed.get(name) ?? 0) + setCount);
      unattributedSets += setCount;
      continue;
    }
    setsCounted += setCount;
    if (coveredFromMs == null || ms < coveredFromMs) coveredFromMs = ms;
    const t = entryTonnage(e, history);
    const day = dayOf(ms);

    const touch = (muscle: string, primary: boolean) => {
      let a = acc.get(muscle);
      if (!a) {
        a = {
          muscle, primarySets: 0, secondarySets: 0, primaryKg: 0, secondaryKg: 0,
          primaryPriced: false, secondaryPriced: false, unpricedSets: 0,
          exercises: [], lastTrainedMs: null, lastDayKey: '', lastDaySets: 0,
        };
        acc.set(muscle, a);
      }
      if (primary) {
        a.primarySets += setCount;
        if (t.kg > 0) { a.primaryKg += t.kg; a.primaryPriced = true; }
      } else {
        a.secondarySets += setCount;
        if (t.kg > 0) { a.secondaryKg += t.kg; a.secondaryPriced = true; }
      }
      a.unpricedSets += t.unknownSets;
      if (!a.exercises.includes(e.exercise)) a.exercises.push(e.exercise);
      if (a.lastTrainedMs == null || ms > a.lastTrainedMs) a.lastTrainedMs = ms;
      // The last DAY's sets, accumulated across every row of that day, because
      // one gym visit writes several rows with several timestamps. The log is
      // not ordered, so a newer day resets the count and an older one is
      // ignored; two `YYYY-MM-DD` strings compare the same way in every zone.
      if (day) {
        if (day > a.lastDayKey) { a.lastDayKey = day; a.lastDaySets = setCount; }
        else if (day === a.lastDayKey) a.lastDaySets += setCount;
      }
    };

    for (const m of row.primary) touch(m, true);
    for (const m of row.secondary) touch(m, false);
  }

  const trainedNames = [...acc.keys()];
  const drawnFor = new Set(trainedNames.filter((m) => !unmapped([m]).length));

  const muscles: MuscleEffort[] = [...acc.values()].map((a) => ({
    muscle: a.muscle,
    primarySets: a.primarySets,
    secondarySets: a.secondarySets,
    primaryEquivalentSets: score(a.primarySets + SECONDARY_SHARE * a.secondarySets),
    primaryVolumeKg: a.primaryPriced ? Math.round(a.primaryKg) : null,
    secondaryVolumeKg: a.secondaryPriced ? Math.round(a.secondaryKg) : null,
    unpricedSets: a.unpricedSets,
    exercises: a.exercises,
    lastTrainedMs: a.lastTrainedMs,
    lastDay: a.lastDayKey || null,
    lastDaySets: a.lastDaySets,
    drawn: drawnFor.has(a.muscle),
  })).sort((x, y) =>
    y.primaryEquivalentSets - x.primaryEquivalentSets
    || y.primarySets - x.primarySets
    || x.muscle.localeCompare(y.muscle));

  return {
    muscles,
    setsCounted,
    sinceMs,
    nowMs,
    coveredFromMs,
    vocabulary: isWhole(catalogueStatus) ? [...vocab].sort((a, b) => a.localeCompare(b)) : null,
    undrawn: unmapped(trainedNames),
    approximations: approximations(trainedNames),
    unmatched: [...unmatched.keys()].sort((a, b) =>
      (unmatched.get(b) ?? 0) - (unmatched.get(a) ?? 0) || a.localeCompare(b)),
    unmatchedSets,
    unattributed: [...unattributed.keys()].sort((a, b) =>
      (unattributed.get(b) ?? 0) - (unattributed.get(a) ?? 0) || a.localeCompare(b)),
    unattributedSets,
    status,
    isFloor: status === 'partial',
  };
}

/** One muscle's row off a board, or null. Case-insensitive, because a caller
 *  holding a name off the artwork or off a coach's note has not normalised it. */
export function effortFor(board: MuscleWorkBoard, muscle: string): MuscleEffort | null {
  const k = norm(muscle);
  return board.muscles.find((m) => m.muscle === k) ?? null;
}

/* ── what a screen is allowed to say about the window ─────────────────────── */

/**
 * How to caption the window, in words that are true of THIS log.
 *
 * The defect this closes has shipped in this product: "Since the first day on
 * record", printed over 84 days of a three-year record, because the read was
 * capped and nobody asked whether the window and the record were the same
 * thing. Three cases, three different sentences, and none of them is optional:
 *
 *   nothing counted   there is no figure to caption
 *   a floor           the window is right and the figures are at-least
 *   whole             the window is right and the figures are totals
 *
 * `days` is the window in whole days, which is what a person reads. It is the
 * WINDOW, never the record: `coveredFromMs` says where the record actually
 * starts, and a screen that wants to say so has it.
 */
export function windowNote(board: MuscleWorkBoard): string | null {
  const days = Math.max(1, Math.round((board.nowMs - board.sinceMs) / 86_400_000));
  if (board.status === 'error') {
    return 'We could not read your training, so nothing below is a figure about you.';
  }
  if (board.status === 'loading') return null;
  if (board.setsCounted <= 0) {
    // An empty board under a PREFIX read is not an empty window. This is the
    // house rule's own example arriving through the back door: "you have logged
    // nothing" is an absence, absence is what a truncated read manufactures for
    // free, and the version of this line that said it unconditionally was
    // telling a member with a full month behind them that they had not trained.
    return board.isFloor
      ? 'Your log was read in part and nothing in what came back could be filed to a muscle, '
        + 'so we cannot say what you trained.'
      : `Nothing is logged in the last ${days} days that we can file to a muscle.`;
  }
  if (board.isFloor) {
    return `Over the last ${days} days. Your log was read in part, so every count `
      + 'below is at least this and may be more.';
  }
  return `Over the last ${days} days.`;
}

/**
 * What to say about work this board could not file, or null when there is none.
 *
 * Two sentences at most and each names SETS, because the size of the hole is
 * the work in it and not the number of names — the argument `unmatchedNote` in
 * src/lib/muscleVolume.ts makes. The two halves are separate sentences because
 * they are two different problems with two different owners: one is a movement
 * we have never heard of, the other is a movement in our own catalogue with no
 * muscles recorded against it.
 */
export function gapNote(board: MuscleWorkBoard): string | null {
  const out: string[] = [];
  if (board.unmatched.length) {
    const n = board.unmatchedSets;
    const named = board.unmatched.slice(0, 3).join(', ');
    const more = board.unmatched.length > 3 ? `, and ${board.unmatched.length - 3} more` : '';
    out.push(`${n} set${n === 1 ? '' : 's'} are not counted here — ${named}${more} `
      + `${board.unmatched.length === 1 ? 'is' : 'are'} not in the exercise catalogue, so we `
      + `cannot say which muscles ${board.unmatched.length === 1 ? 'it' : 'they'} worked.`);
  }
  if (board.unattributed.length) {
    const n = board.unattributedSets;
    const named = board.unattributed.slice(0, 3).join(', ');
    const more = board.unattributed.length > 3 ? `, and ${board.unattributed.length - 3} more` : '';
    out.push(`Another ${n} set${n === 1 ? '' : 's'} are not counted either — our catalogue has `
      + `${named}${more} but records no muscles for `
      + `${board.unattributed.length === 1 ? 'it' : 'them'} yet.`);
  }
  return out.length ? out.join(' ') : null;
}

/**
 * What to say about work that happened and is not in the PICTURE, or null.
 *
 * Separate from `gapNote` because it is a caveat on the diagram and not on the
 * numbers. The muscles named here were counted in every figure on the board;
 * they simply have no overlay in the artwork, so a member who trained them and
 * sees an unlit body is owed the reason. `serratus anterior` is the one this
 * will actually fire on.
 */
export function undrawnNote(board: MuscleWorkBoard): string | null {
  if (!board.undrawn.length) return null;
  const named = board.undrawn.join(', ');
  const one = board.undrawn.length === 1;
  return `${named} ${one ? 'is' : 'are'} counted in the numbers but not shown on the body: `
    + `the diagram has no layer for ${one ? 'it' : 'them'}.`;
}

/* ── the body diagram ─────────────────────────────────────────────────────── */

/** Intensity per drawn overlay, and everything the picture is not saying. */
export interface DiagramShading {
  /** Layer name from the manifest, to 0…1. Layers with no work are ABSENT
   *  rather than 0, so a renderer draws nothing rather than drawing a floor. */
  byLayer: Record<DrawnMuscle, number>;
  /**
   * The `primaryEquivalentSets` that 1.0 stands for.
   *
   * Published rather than kept private because shading is RELATIVE and a
   * picture cannot say so on its own: a week with a hardest muscle of 3 and a
   * week with a hardest muscle of 30 draw the same darkest red. Without this a
   * member reads a deload week as a hard one. A screen showing the diagram is
   * expected to put this figure, or a sentence built from it, beside the key.
   */
  fullScaleAt: number;
  /** Trained muscles with no overlay at all — `board.undrawn`, carried so a
   *  caller holding only the shading still has it. */
  undrawn: string[];
  /** The approximations this particular picture is relying on, as sentences.
   *  Only the ones actually used: a week of exactly-drawn work carries none. */
  approximations: string[];
  /** False when nothing was counted, so there is no picture to draw and a
   *  screen must say why rather than render an unlit body as a rest week. */
  hasWork: boolean;
}

/**
 * Turn a board into per-overlay shading, through `drawnIntensity`.
 *
 * The mapping is muscleMap's and nothing here second-guesses it: several layers
 * for one trained name each take the WHOLE value, several trained names on one
 * layer take the LARGEST. Both rules matter here in particular — three deltoid
 * heads assisting at 4 primary-equivalents each is a shoulder that worked 4,
 * not 12, and summing them would have drawn the darkest shoulder on the body
 * off three half-mentions.
 *
 * Scaled against the hardest-worked muscle in the window by default, because a
 * fixed ceiling means a beginner's whole body is permanently pale and a
 * powerlifter's is permanently saturated. `fullScaleAt` on the result says what
 * the scale was, so the screen can say it too. Pass `fullScaleAt` to fix the
 * ceiling instead — two weeks drawn side by side must share one.
 */
export function diagramShading(
  board: MuscleWorkBoard,
  opts: { fullScaleAt?: number } = {},
): DiagramShading {
  const peak = board.muscles.reduce((m, x) => Math.max(m, x.primaryEquivalentSets), 0);
  const scale = opts.fullScaleAt != null && opts.fullScaleAt > 0 ? opts.fullScaleAt : peak;
  if (scale <= 0) {
    return {
      byLayer: {}, fullScaleAt: 0, undrawn: board.undrawn,
      approximations: board.approximations, hasWork: false,
    };
  }
  const byTrained: Record<string, number> = {};
  for (const m of board.muscles) {
    if (m.primaryEquivalentSets <= 0) continue;
    // Clamped, not left to run past 1, so a fixed ceiling handed in for a
    // side-by-side comparison cannot produce an intensity a renderer has no
    // colour for.
    byTrained[m.muscle] = Math.min(1, m.primaryEquivalentSets / scale);
  }
  return {
    byLayer: drawnIntensity(byTrained),
    fullScaleAt: score(scale),
    undrawn: board.undrawn,
    approximations: board.approximations,
    hasWork: true,
  };
}
