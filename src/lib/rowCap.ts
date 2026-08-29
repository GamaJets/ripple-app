// A read that came back at the row limit is not the whole set.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// PostgREST answers with at most 1000 rows unless the request says otherwise,
// and it does not say so. There is no error, no flag, no partial-content
// status the client surfaces — a query that matched three thousand sessions
// returns one thousand of them and looks exactly like a query that matched one
// thousand. Every read in this codebase that aggregates rows into a figure is
// therefore capable of reporting a third of the truth with total confidence.
//
// That is strictly worse than a failed read, and the difference matters. This
// codebase already reasons carefully about failure: `fetchGymTrainers` throws
// rather than defaulting its session read, on the grounds that a swallowed
// error makes every trainer show 0 delivered and prices payroll at exactly
// zero owed. A truncated read defeats that reasoning completely. It does not
// fail. It succeeds, quietly, with the wrong number — and the screen renders it
// as fact because nothing anywhere had cause to doubt it.
//
// ── Why not simply raise the limit ─────────────────────────────────────────
//
// Passing `.limit(5000)` moves the cliff without removing it, and leaves the
// failure just as silent when a gym eventually crosses the new line. The point
// is not to fit more rows. It is to be able to tell the difference between
// "this is all of them" and "this is as many as you asked for", which requires
// asking for one row more than you are willing to accept: come back with
// cap + 1 and the set was larger than the cap, whatever the cap is.
//
// ── What callers do with it ────────────────────────────────────────────────
//
// Throw. A figure computed from part of a set is not a smaller figure, it is a
// wrong one, and this codebase's standing rule is that a number the record
// cannot stand behind renders as a dash rather than a guess. The read screens
// already treat a thrown read as an error and say so; that is the correct
// outcome here, and it is the honest one.
//
// ── Where throwing is the wrong answer ─────────────────────────────────────
//
// That rule was written for the console, where every capped read feeds a
// figure. The phone app is different: most of its capped reads feed a LIST —
// a workout history, a message thread, a roster — and a list of 1000 real
// sessions is genuinely useful to the coach looking at it. Throwing away a
// read that succeeded, to protect a figure nobody was computing, would leave a
// coach with an empty screen and an error where they had their work.
//
// So the phone providers keep the rows and carry the fact separately, as the
// 'partial' member of `LoadStatus` (see src/ui/loadStatus.ts). `capped()`
// below is what they call: it hands back the honest page and the flag together,
// because the one mistake that reintroduces the silent lie is trimming the
// probe row off and forgetting to mention that there was one.

/** Rows PostgREST will return for an unbounded request. Supabase's default. */
export const ROW_CAP = 1000;

/**
 * What to pass to `.limit()`. One past the cap, so a full page and a truncated
 * one stop looking identical.
 */
export function capLimit(cap: number = ROW_CAP): number {
  return cap + 1;
}

/** A read that hit the ceiling, and so cannot be aggregated honestly. */
export class TruncatedRead extends Error {
  readonly what: string;
  readonly cap: number;
  constructor(what: string, cap: number) {
    super(
      `The read of ${what} came back at its ${cap}-row limit, so it is not the ` +
      `whole set. Refusing to report a figure computed from part of it.`,
    );
    this.name = 'TruncatedRead';
    this.what = what;
    this.cap = cap;
  }
}

/**
 * Rows through, unless there are more than the cap — which can only happen if
 * the caller asked for `capLimit()` and got every one of them.
 *
 * `what` is a plain-English noun phrase for the set, because this message can
 * reach a gym owner's screen: "the read of sessions in the last 30 days …",
 * not the name of a function they have never heard of.
 */
export function assertWhole<T>(
  rows: T[] | null | undefined,
  what: string,
  cap: number = ROW_CAP,
): T[] {
  const r = rows ?? [];
  if (r.length > cap) throw new TruncatedRead(what, cap);
  return r;
}

/** True when this looks like a set that was cut off rather than one that ended. */
export function isTruncated(rows: unknown[] | null | undefined, cap: number = ROW_CAP): boolean {
  return (rows?.length ?? 0) > cap;
}

/** A read that came back, and whether it came back whole. */
export interface CappedRead<T> {
  /** At most `cap` rows. The probe row is never in here — it is not data. */
  rows: T[];
  /** True when the set was larger than the cap, so `rows` is a prefix of it. */
  truncated: boolean;
}

/**
 * Split a `capLimit()` read into the rows a screen may show and the fact that
 * there were more of them.
 *
 * This is one function rather than `isTruncated()` plus a `.slice()` at every
 * call site because those two steps have to happen together and the failure
 * mode when they come apart is the one this whole file exists to prevent: slice
 * without the flag and the screen quietly shows a prefix as the whole set,
 * flag without the slice and the extra probe row — which was requested to be
 * counted, not read — is rendered to the user as a real row.
 */
export function capped<T>(rows: T[] | null | undefined, cap: number = ROW_CAP): CappedRead<T> {
  const r = rows ?? [];
  return r.length > cap ? { rows: r.slice(0, cap), truncated: true } : { rows: r, truncated: false };
}
