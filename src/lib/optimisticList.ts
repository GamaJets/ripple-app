// What happens to a row a screen drew before the server had answered.
//
// ── The house rule, and the fifth time it was broken ───────────────────────
//
// Count what the server confirmed, never what you sent. Drawing a row the
// instant somebody taps Save is not itself the breach — a measurement typed in
// a gym basement has to appear, and `src/lib/outbox.ts` exists so it can be
// sent later. The breach is drawing it and then never taking it back.
//
// `src/ui/measurements.tsx` did exactly that:
//
//     setEntries((p) => [entry, ...p].sort(…));
//     …
//     if (out === 'refused') return 'refused';
//
// The screen raises an honest alert — "These are on screen but could not be
// sent to your account, so they will be gone at the next launch" — and then
// leaves the row exactly where it is. Until the app is killed that phantom is
// `latest`: it is the hero waist figure, it is the "Measured …" line, it is a
// row in History, it is part of "{n} entries", and it is the number every
// change-since-last-time is computed against. The alert tells the truth and the
// screen contradicts it for the rest of the session.
//
// And the list does not stay on the screen. `app/(client)/scans.tsx` hands it
// to `clientReportDoc` — the progress summary a member gives a physiotherapist
// — so a figure the member's own account REFUSED to store is printed in a
// document a clinician reads.
//
// ── The three outcomes, and why only one is taken back ─────────────────────
//
//   'stored'  the server wrote it. The row is real; keep it.
//   'queued'  the server was not reachable and it is on the outbox. The row is
//             a promise this app has made and intends to keep; keep it, and the
//             screen says it is waiting.
//   'refused' the server READ the request and declined it — a policy, a bad
//             payload, no session. Offering it again gets the same answer, so
//             it is not queued, and nothing is ever going to make it true.
//             The row comes off.
//
// The distinction is the one `src/lib/reachability.ts` is built on: unreachable
// and refused are different events and they get different treatment. Only the
// refusal is a thing that did not happen.
export type WriteSettlement = 'stored' | 'queued' | 'unsent' | 'refused';

/** Whether a row drawn before the answer came back may stay on the screen. */
export function keepOptimistic(outcome: WriteSettlement): boolean {
  return outcome !== 'refused';
}

/**
 * The list, once the server has answered about the row that was added to it.
 *
 * By id, not by index: a re-read, a queue flush or a second entry may have
 * moved the row since it went in, and removing position zero would take
 * somebody else's measurement off the screen instead.
 *
 * Returns the same array reference when nothing changes, so a provider holding
 * it in state does not re-render every subscriber on a write that landed.
 */
export function settleOptimistic<T extends { id: string }>(
  rows: T[],
  id: string,
  outcome: WriteSettlement,
): T[] {
  if (keepOptimistic(outcome)) return rows;
  if (!rows.some((r) => r.id === id)) return rows;
  return rows.filter((r) => r.id !== id);
}

/**
 * The list, once the server has answered about a row that was taken OFF it
 * before the answer came back.
 *
 * The mirror of `settleOptimistic`, and the same rule read from the other end:
 * count what the server confirmed. A screen that removes a row on the tap and
 * keeps it removed over a refused DELETE is not showing an optimistic row that
 * turned out to be false — it is HIDING a row that is still there, which is the
 * worse half of the pair, because there is nothing on the screen to be
 * suspicious of. `src/ui/availability.ts` is the worked example: a weekly slot
 * dropped from the phone over a delete the server declined leaves a coach whose
 * week no longer shows an hour the nightly generator is still opening sessions
 * at, and clients go on booking it.
 *
 * `confirmed` is what the SERVER said, never what was asked for — see
 * `writeFailure` in src/lib/wroteRows.ts for how a DELETE that matched nothing
 * arrives looking exactly like one that matched a row.
 *
 * Restored by value rather than by re-reading, because the row is in hand and a
 * re-read is a second thing that can fail. Position is not restored: the caller
 * sorts, and every list this is used on has an order of its own. Appending is
 * how the row gets back into that sort without this module inventing one.
 *
 * Returns the same array reference when nothing changes, and is idempotent — a
 * row already back in the list is not appended twice, so a retry that races a
 * re-read cannot double it.
 */
export function settleRemoval<T extends { id: string }>(
  rows: T[],
  removed: T | null | undefined,
  confirmed: boolean,
): T[] {
  if (confirmed) return rows;
  if (!removed) return rows;
  if (rows.some((r) => r.id === removed.id)) return rows;
  return [...rows, removed];
}
