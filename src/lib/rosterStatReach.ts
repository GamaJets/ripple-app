// What a roster row may say about a client when the reads behind its figures
// did not bring back everything.
//
// ── the two ways a figure goes missing, and why they are one rule ─────────
//
// src/ui/roster.tsx decorates each client with three per-client reads — scans,
// workouts, check-ins. Every one of them can come back SHORT of the whole set,
// and there are two separate ways for that to happen:
//
//   · TRUNCATED — the read happened and PostgREST stopped at its 1000-row
//     ceiling (src/lib/rowCap.ts). Some rows came back; there are more.
//   · FAILED — the read did not happen. Refused by row-level security, a
//     dropped connection, a 414 on an over-long request line. No rows came
//     back, and supabase-js RESOLVES on all of those rather than throwing, so
//     the failure arrives looking exactly like an empty table.
//
// Both leave the loader holding no rows for a client, and both mean the same
// thing about that client: nothing has been established. Only the first of the
// two was being carried, so a refused stats read set the roster's status to
// 'error' — correctly — and then went on to write "no activity yet" onto every
// client's own card. A banner over the list does not unsay a sentence printed
// against a person's name, and the sentence is the one a coach acts on: they
// chase somebody who has been training all month.
//
// ── why the weight delta has its own answer ───────────────────────────────
//
// A weight change is LAST minus FIRST, and the roster reads scans newest-first
// so that a capped page still answers "most recent" exactly. The row a
// newest-first cap drops is therefore the FIRST one — the subtrahend. Computing
// the delta from the tail of a client's history does not produce a smaller
// number, it produces a wrong one, and often the wrong sign: a client who lost
// four kilos shown as having gained two. So a truncated scans read forfeits the
// delta even though it answered the last-active question perfectly.
//
// Pure, and takes no clock — the elapsed time has already been resolved into
// words by the time it reaches here.

/**
 * How completely a set of rows was read.
 *
 * Two independent booleans rather than one enum, because a page can be both:
 * chunked reads (src/lib/cappedByIds.ts) stop at the first chunk that fails,
 * so rows from earlier chunks are in hand AND the rest were never asked for.
 */
export interface StatReach {
  /** The read answered and stopped at the row ceiling. */
  readonly truncated: boolean;
  /** The read was refused, dropped, or otherwise did not happen. */
  readonly failed: boolean;
}

/** Nothing is missing: the rows in hand are the whole set. */
export function reachIsWhole(reach: StatReach): boolean {
  return !reach.truncated && !reach.failed;
}

/**
 * The em dash the roster writes when a figure is not a figure.
 *
 * Named rather than inlined because `lastActiveLine` in src/lib/lastActiveLine.ts
 * matches on this exact character to turn it into the sentence "When they were
 * last active could not be read, so this is not a statement that they have been
 * quiet." The two files must not be able to drift apart on which character that
 * is.
 */
export const STAT_UNKNOWN = '—';

/** What the roster writes for a client with an account and nothing recorded. */
export const NO_ACTIVITY_YET = 'no activity yet';

/**
 * The `lastActive` cell for one client.
 *
 * @param ago   the elapsed time already resolved into words ("3d ago"), or null
 *              when no row was seen for this client.
 * @param reach how completely the reads behind it landed.
 *
 * A phrase in hand is always the answer: a client who appears in a capped page
 * at all appears with their NEWEST row, by construction, so the figure is exact
 * however much of the set was missed.
 *
 * Absent from the page is where the two readings part. Under a whole read that
 * is a fact about the client — they have recorded nothing. Under a short one it
 * is a fact about the read, and this returns the dash rather than the sentence,
 * because "no activity yet" is an assertion nobody is in a position to make.
 */
export function lastActiveCell(ago: string | null | undefined, reach: StatReach): string {
  const v = (ago ?? '').trim();
  if (v) return v;
  return reachIsWhole(reach) ? NO_ACTIVITY_YET : STAT_UNKNOWN;
}

/**
 * The weight change for one client, or null where it may not be computed.
 *
 * Null rather than zero, and the difference is the whole point: the roster
 * renders null as "no change recorded" and zero as a client who has held their
 * weight exactly. See the header for why a truncated scans read forfeits this
 * figure even though it answers the last-active question.
 */
export function weightDeltaCell(delta: number | null | undefined, reach: StatReach): number | null {
  if (!reachIsWhole(reach)) return null;
  return delta ?? null;
}

/**
 * One `lastActive` cell, cased for a chip that sits beside Title Case siblings.
 *
 * ── what went wrong ───────────────────────────────────────────────────────
 *
 * 14 Oct 2026, on the coach's own client profile: "Online · just added", under
 * a roster row reading "Fat Loss · Online · just added" and a legend reading
 * "On Track". Three call sites had each written this cell's display form by
 * hand and landed on three conventions — app/(trainer)/client.tsx lower-cased
 * the prefix ("last active 3d ago"), app/(trainer)/dashboard.tsx capitalised it
 * ("Last active 3d ago"), and both passed the status phrases straight through
 * in the lower case the roster stores them in.
 *
 * scripts/check-caps.mjs is built for exactly this and could not see it: its
 * rule 2 compares the segments of a `·` run, and every one of these runs is
 * assembled from variables at runtime, so there are no literals on the line to
 * compare. The gate's own header names this miss.
 *
 * ── what it does, and the one thing it leaves alone ───────────────────────
 *
 * The stored phrases — "just added", "added by you", "no activity yet" — are
 * STATUS WORDS, and the house rule puts those in Title Case. They keep their
 * stored spelling in src/lib/rosterStatReach.ts and src/ui/roster.tsx because
 * src/lib/lastActiveLine.ts and src/lib/leaderboardFacts.ts both match them by
 * exact value to build prose sentences, where lower case is correct; casing
 * here, at the one place that draws them as a chip, is what keeps those two
 * registers from having to agree.
 *
 * An elapsed form is left as typed. "3d ago" is a measurement, and this
 * codebase does not capitalise those — src/lib/coverage.test.ts asserts the
 * same thing of kcal. It gets the prefix the two screens already wanted.
 *
 * The dash is returned untouched: it is the app's unknown-not-zero sign.
 */
export function lastActiveChip(lastActive: string | null | undefined): string {
  const s = String(lastActive ?? '').trim();
  if (!s || s === STAT_UNKNOWN) return STAT_UNKNOWN;
  if (/\bago$/.test(s)) return `Last Active ${s}`;
  // Only the words are lifted; a digit or a symbol starts no word to lift.
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
