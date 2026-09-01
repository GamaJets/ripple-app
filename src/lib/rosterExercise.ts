/**
 * ONE MOVEMENT, THE WHOLE BOOK — "who is stalled on bench".
 *
 * The coach app could read one client's history of one exercise
 * (src/lib/exerciseHistory.ts, drawn by app/(trainer)/exercise.tsx) and there
 * was no way to ask the same question of a roster. A coach with forty clients
 * opened forty screens, so nobody did it, so the insight that scales with a
 * coach's book was the one insight the app withheld from a busy coach.
 *
 * ── The two blockers, and where each is answered ──────────────────────────
 *
 * The row cap and the free-text exercise name. Both are answered in
 * supabase/parts/178-who-across-the-book-is-stalled-on-this-lift.sql: a
 * generated `exercise_slug` column so the database matches movements by the
 * same rule src/lib/exerciseId.ts does, and an aggregate that returns ONE ROW
 * PER CLIENT so the result is bounded by the roster and can never come back
 * truncated. That last property is the reason this screen can print figures at
 * all — a raw roster-wide read of `workouts` would hit `capLimit()` every time
 * and every total over it would be a dash.
 *
 * ── What "stalled" means here, and what it deliberately does not ──────────
 *
 * Stalled is a JUDGEMENT and this file is where it is made, in the open, with a
 * named threshold and a sentence a coach can disagree with — the same
 * discipline src/lib/programReview.ts applies to its findings and
 * src/lib/clientDrift.ts to its bands. It is not computed in SQL, because a
 * threshold buried in a migration is one nobody can find, test or change.
 *
 * It means, precisely: this client has logged this movement in BOTH halves of
 * the window, and their heaviest set in the recent half is no heavier than
 * their heaviest set in the earlier half. That is a claim about the record and
 * nothing else. It is not a claim that they are not progressing — reps at the
 * same load are progress, and so is a set that felt easier — and `StalledLevel`
 * carries `'no-load'` for exactly the movements where load is the wrong axis.
 *
 * The states a coach must never see collapsed into "stalled":
 *
 *   'unseen'   they have not logged this movement in the window at all. Which
 *              may be the most important row on the screen and is not stalling.
 *   'new'      logged only in the recent half. There is nothing to compare it
 *              against, and "stalled" over one data point is a coin toss.
 *   'no-load'  logged in both halves and no set in either carried a weight.
 *              Press-ups, chin-ups, planks. A tonnage of nothing is not a
 *              plateau.
 *
 * ── Every figure is an estimate and says so ───────────────────────────────
 *
 * `e1rmKg` is Epley off logged sets — nobody in this app has TESTED a maximum —
 * and it is the same arithmetic `priorBest1RM` in src/lib/progression.ts uses
 * for one client, so the roster view and the client view cannot disagree.
 *
 * The pure half of this file takes rows and returns judgements and is tested
 * without a database. The read at the bottom is the only part that touches one.
 */
import { type LoadStatus } from '../ui/loadStatus';

/**
 * How far back the comparison looks, in days.
 *
 * Fifty-six — eight weeks, split into two fours. Four weeks either side is the
 * shortest window in which "no heavier than before" is worth saying: a client
 * training a movement once a week has four outings in each half, which is
 * enough that one bad session does not decide it, and short enough that the
 * earlier half is still the same block of training rather than a different
 * season.
 *
 * The same 28 days `WINDOW_DAYS` in src/lib/planVsActual.ts uses, doubled,
 * deliberately: a coach reading both screens about the same client should not
 * have to hold two different windows in their head.
 */
export const ROSTER_WINDOW_DAYS = 56;

/** Where the window is split into "earlier" and "recent". Half, so neither
 *  half is given an advantage by being longer. */
export const ROSTER_SPLIT_DAYS = 28;

/** One client's row of the aggregate, exactly as the database returns it. */
export interface RosterExerciseRow {
  clientId: string;
  lastAt: string | null;
  recentOutings: number;
  priorOutings: number;
  recentTopKg: number | null;
  priorTopKg: number | null;
  recentE1rmKg: number | null;
  priorE1rmKg: number | null;
}

/**
 * What the record says about one client and one movement.
 *
 *   'unseen'   not logged in the window at all.
 *   'new'      logged in the recent half only — nothing to compare against.
 *   'no-load'  logged in both halves, no set in either carried a weight.
 *   'holding'  logged in both halves and the heaviest recent set is no heavier
 *              than the heaviest earlier one.
 *   'climbing' the heaviest recent set is heavier.
 *   'dropping' the heaviest recent set is LIGHTER, which is its own answer and
 *              not a shade of holding: a coach reads it differently and often
 *              knows exactly why — an injury, a deload they wrote themselves.
 */
export type StalledLevel = 'unseen' | 'new' | 'no-load' | 'holding' | 'climbing' | 'dropping';

/** One client, judged. */
export interface RosterExerciseClient {
  clientId: string;
  level: StalledLevel;
  /** The heaviest set logged in the recent half, kilograms; null when none
   *  carried a load. Never 0 — see the header on `no-load`. */
  topKg: number | null;
  /** The heaviest in the earlier half, for the comparison to be readable. */
  priorTopKg: number | null;
  /** Estimated one-rep max in the recent half, kilograms. An ESTIMATE, and
   *  every screen that prints it says so. */
  e1rmKg: number | null;
  /** Change in top load across the two halves, as a percentage, for
   *  `deltaLabel`. Null when either half has no load — a change from nothing is
   *  not a percentage, it is a first measurement. */
  changePct: number | null;
  outings: number;
  lastAt: string | null;
}

/** How the ranking sorts. Lowest first, so the rows a coach must act on lead. */
const RANK: Record<StalledLevel, number> = {
  // Somebody who has stopped doing a movement entirely is the first thing a
  // coach wants to see, ahead of somebody merely not adding weight — the
  // programme is not being followed, which is a different and larger problem.
  unseen: 0,
  dropping: 1,
  holding: 2,
  'no-load': 3,
  new: 4,
  // Last, and still listed. A coach scanning for problems still wants to see
  // who is going well, and hiding them would make the screen look like a list
  // of failures rather than a picture of a roster.
  climbing: 5,
};

/**
 * How much heavier counts as heavier.
 *
 * Zero. Not a tolerance band, and the reason is the smallest increment in a
 * gym: 1.25 kg change plates are the finest most gyms carry and 2.5 kg is the
 * ordinary step, so any real increase is already far outside a rounding. A
 * tolerance here would only ever swallow a genuine 1 kg microload — which is
 * exactly what a coach working with a stalled client prescribes — and report
 * it as still stalled.
 */
const HEAVIER_BY_KG = 0;

/** Percentage change between two figures, or null when the earlier one has
 *  nothing to be a percentage of. Deliberately not imported from deltaLabel:
 *  this returns the NUMBER and `deltaLabel` owns every sign and arrow that is
 *  ever rendered from it — scripts/check-deltas.mjs exists because
 *  twenty-five screens each wrote their own. */
function pct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/**
 * Judge one client's row.
 *
 * The order of the branches is the whole of the logic and each one excludes the
 * next: no outings at all, then no earlier half to compare against, then no
 * load anywhere to compare, and only then the comparison itself. Written as
 * early returns rather than as one condition, because a single boolean
 * expression covering four "we cannot answer" cases is where one of them
 * silently becomes 'holding'.
 */
export function judgeRosterRow(r: RosterExerciseRow): RosterExerciseClient {
  const base = {
    clientId: r.clientId,
    topKg: r.recentTopKg,
    priorTopKg: r.priorTopKg,
    e1rmKg: r.recentE1rmKg,
    changePct: pct(r.priorTopKg, r.recentTopKg),
    outings: r.recentOutings + r.priorOutings,
    lastAt: r.lastAt,
  };
  if (r.recentOutings <= 0 && r.priorOutings <= 0) return { ...base, level: 'unseen' };
  if (r.priorOutings <= 0) return { ...base, level: 'new' };
  // Logged in both halves but the coach has stopped seeing loads: they have
  // moved onto a machine that does not show one, or the movement is bodyweight.
  // Either way there is no weight to plateau.
  if (r.recentTopKg == null || r.priorTopKg == null) return { ...base, level: 'no-load' };
  if (r.recentTopKg > r.priorTopKg + HEAVIER_BY_KG) return { ...base, level: 'climbing' };
  if (r.recentTopKg < r.priorTopKg) return { ...base, level: 'dropping' };
  return { ...base, level: 'holding' };
}

/**
 * Every client on the roster, judged and ranked.
 *
 * `rosterIds` is the WHOLE book, not the ids that came back from the aggregate.
 * That is the point: a client who has never touched the movement produces no
 * row at all, and they are the most interesting person on this screen. Building
 * the list from the aggregate's own rows would silently answer only for the
 * people who already do the exercise, which is the question nobody asked.
 *
 * Ranked by `RANK`, then by how recently they last did it — within a band, the
 * one who has not touched it for longest leads — and finally by client id so
 * the order is total and does not shuffle between renders.
 */
export function rankRosterExercise(
  rosterIds: readonly string[],
  rows: readonly RosterExerciseRow[],
): RosterExerciseClient[] {
  const byId = new Map(rows.map((r) => [r.clientId, r]));
  const out = rosterIds.map((id) => judgeRosterRow(byId.get(id) ?? {
    clientId: id, lastAt: null,
    recentOutings: 0, priorOutings: 0,
    recentTopKg: null, priorTopKg: null,
    recentE1rmKg: null, priorE1rmKg: null,
  }));
  return out.sort((a, b) => {
    const r = RANK[a.level] - RANK[b.level];
    if (r !== 0) return r;
    // Oldest last-seen first. A null — never logged — sorts before every date,
    // which puts the people who have never done it at the top of their band.
    const at = (x: RosterExerciseClient) => (x.lastAt ? Date.parse(x.lastAt) : -Infinity);
    const d = at(a) - at(b);
    if (Number.isFinite(d) && d !== 0) return d;
    return a.clientId.localeCompare(b.clientId);
  });
}

/** What each band says on screen, in sentence case — these are prose, not
 *  buttons. Every one of them names the evidence rather than giving a verdict,
 *  so a coach who disagrees knows what to disagree with. */
export const LEVEL_NOTE: Record<StalledLevel, string> = {
  unseen: 'has not logged this movement in the window at all',
  dropping: 'heaviest set is lighter than it was in the first half of the window',
  holding: 'heaviest set has not gone up across the window',
  'no-load': 'has logged this movement with no weight recorded, so there is no load to compare',
  new: 'has only logged this movement in the recent half, so there is nothing to compare it against',
  climbing: 'heaviest set has gone up across the window',
};

/** The Title Case heading each band sits under. */
export const LEVEL_TITLE: Record<StalledLevel, string> = {
  unseen: 'Not Doing It',
  dropping: 'Going Backwards',
  holding: 'Not Moving',
  'no-load': 'No Load Recorded',
  new: 'Too New to Say',
  climbing: 'Going Up',
};

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The line above the list.
 *
 * Never a count under an unread roster or an unread aggregate. Two reads, and
 * either one failing makes every number here a claim about a book the screen
 * did not see — a coach told "3 of 40 are stalled" off a partial roster acts on
 * a denominator that is not their book.
 */
export function rosterExerciseLine(
  status: LoadStatus,
  rosterStatus: LoadStatus,
  clients: readonly RosterExerciseClient[],
  movement: string,
): string {
  if (status === 'loading' || rosterStatus === 'loading') return 'Reading what your clients have logged…';
  if (status === 'error') {
    return `Your clients' training could not be read for ${movement}. An empty list below is about that read, not about them.`;
  }
  if (rosterStatus !== 'ready') {
    return 'Your book could not be read in full, so this cannot say how many of your clients it covers. Everyone listed is real.';
  }
  if (!clients.length) return 'Nobody is on your book yet, so there is nothing to compare.';
  const stalled = clients.filter((c) => c.level === 'holding' || c.level === 'dropping').length;
  const unseen = clients.filter((c) => c.level === 'unseen').length;
  return `${clients.length} client${s(clients.length)} on your book. `
    + `${stalled} ${stalled === 1 ? 'has' : 'have'} not added weight to ${movement} across the last ${ROSTER_WINDOW_DAYS} days, `
    + `and ${unseen} ${unseen === 1 ? 'has' : 'have'} not logged it at all.`;
}
