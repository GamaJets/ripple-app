// A read that has not come back, and one that came back refused.
//
// ── Two vocabularies for one idea ─────────────────────────────────────────
//
// `type Unread = 'loading' | 'failed' | null` appeared VERBATIM in fifteen page
// files — accounting, analytics, classes, coach, coach/earnings, coach/roster,
// compliance, costs, deletions, door, equipment, payroll, revenue, settings and
// tax — and `interface Read<T> { rows: T[] | null; state: Unread; why: string |
// null }` in five of them. `Slice<T>` in src/lib/memberView.ts is the shared
// answer and six other screens are built on it.
//
// The fifteen copies are the ones a change cannot reach. When the fourth state
// lands — 'partial', the one src/ui/loadStatus.ts already has and
// src/lib/rowCap.ts argues for at length, "because the one mistake that
// reintroduces the silent lie is trimming the probe row off and forgetting to
// mention that there was one" — it lands in `Slice` and misses fifteen screens.
// Which is precisely how the plain-`<div>` banner survived on one screen after
// the sweep that fixed the other six.
//
// ── Why this is a second module and not an import of `Slice` ──────────────
//
// Because they are genuinely different shapes and collapsing them would be a
// bigger, riskier edit than the one this file makes. `Slice<T>` is a
// discriminated union — the rows exist only in the 'ready' arm, which is what
// makes `sliceReady([])` on an unread gym a compile-visible lie. `Read<T>` is a
// record with three always-present fields, which is what the fifteen screens
// destructure. Rewriting fifteen pages from one to the other is the right end
// state and it is not this change; naming the type once, so the fifteen copies
// become fifteen imports, is what makes that change reachable at all.
//
// Nothing in the shape moves here. `Unread` and `Read<T>` are byte-for-byte
// what the copies declared, so this is a consolidation and not a redesign, and
// a screen that behaved one way before behaves that way after.

/**
 * What a read is when there are no rows: still in flight, or refused.
 *
 * `null` is the third answer and the important one — "this read came back" —
 * which is what makes an empty table distinguishable from a failed one. The
 * three are never allowed to render the same sentence; that rule is the whole
 * argument of this console and it is why the type has three members rather
 * than a boolean.
 */
export type Unread = 'loading' | 'failed' | null;

/**
 * Rows, plus which of the three states they are in, plus the reason when the
 * answer is 'failed'.
 *
 * `rows: null` and `state: null` cannot both be true of a healthy read — null
 * rows means the read has not produced any, and `state` says which of the two
 * reasons that is. `why` is the database's own sentence, kept so the screen can
 * print what was actually refused rather than a generic failure.
 */
export interface Read<T> { rows: T[] | null; state: Unread; why: string | null }

/** The opening state: nothing read yet, and no reason, because nothing has
 *  failed. Declared here so fifteen screens cannot each write a slightly
 *  different one. */
export const reading = <T,>(): Read<T> => ({ rows: null, state: 'loading', why: null });

/**
 * A settled promise as a `Read`.
 *
 * A rejection becomes `state: 'failed'` WITH its message, never `rows: []`.
 * That substitution — an empty array standing in for a read that did not happen
 * — is the defect this console has spent three waves removing, and it is the
 * one thing this helper exists to make impossible to write by accident.
 */
export function landed<T>(res: PromiseSettledResult<T[]>, what: string): Read<T> {
  if (res.status === 'fulfilled') return { rows: res.value, state: null, why: null };
  const why = (res.reason as { message?: string } | undefined)?.message;
  return { rows: null, state: 'failed', why: `Could not read ${what}${why ? `: ${why}` : '.'}` };
}

/** One settled read, as a line for a banner. Null when it came back fine.
 *
 *  Six page files declared this, byte for byte, under the same doc comment. */
export function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as { message?: string } | undefined)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}
