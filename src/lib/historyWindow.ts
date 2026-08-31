// The oldest month of a truncated read is a fraction of a month, and a chart
// cannot say so.
//
// ── The bug this exists for ────────────────────────────────────────────────
//
// app/(client)/history.tsx is the long view — months and years — and it read
// `.from('workouts').select('*').order('performed_at', { ascending: true })`
// with no limit at all. PostgREST answers with 1000 rows and says nothing (see
// src/lib/rowCap.ts), so a member who has trained four times a week for five
// years got their OLDEST thousand sessions and nothing since. The screen then
// stated, in plain English and in the past tense:
//
//     "Nothing logged since Mar 2023, 29 months ago."
//
// to somebody who had trained the previous evening. Every other figure on the
// page — lifetime tonnage, sessions, best month, the breaks list, the personal
// best timeline — was computed over that same prefix and rendered as fact.
//
// The read is now newest-first with `capLimit()`, which puts the truncation at
// the far end of the member's history rather than at today. That fixes the
// sentence above outright. What it leaves is this: the oldest month in the page
// is cut off part-way through, so its bar is a fraction of the month drawn at
// the same scale as its whole neighbours, and a short bar on this chart means
// "you trained less that month". It does not mean that. It means the read
// stopped there.
//
// A month that cannot be shown whole is therefore not shown at all, and the
// screen names it so the omission is visible rather than inferred.
//
// ── Why not simply raise the limit ─────────────────────────────────────────
//
// Because the cliff moves rather than goes, and because the honest window is
// bounded anyway: `MAX_MONTHS` in src/lib/longView.ts charts 36 months, which
// at four sessions a week is roughly 620 rows. The cap only bites on the
// months BEHIND the chart, where its only effect is on lifetime totals — and
// those the screen withholds under truncation rather than under-reports.
import { monthKey } from './longView';
import type { WorkoutEntry } from './mockData';

/** What a screen may draw, and the month it had to leave out to be honest. */
export interface WholeMonths {
  /** Entries belonging to months that came back complete. */
  log: WorkoutEntry[];
  /**
   * The month key ('2024-03') dropped because the read stopped inside it, or
   * null when nothing was dropped. Non-null is what a screen says out loud —
   * "before Mar 2024 is not on this page" — so the gap is stated rather than
   * left for the member to misread as a quiet month.
   */
  droppedMonth: string | null;
}

/**
 * Drop the oldest month of a truncated read, because it is a part-month.
 *
 * `truncated` comes from `capped()` in src/lib/rowCap.ts. When it is false the
 * set is whole and nothing is dropped — this must be a no-op on a complete
 * read, or every member with under a thousand sessions loses their first month
 * for no reason.
 *
 * Entries whose timestamp will not parse have no month and are kept: they are
 * already handled as nulls downstream, and dropping them here would be a second
 * silent subtraction of the kind this module exists to prevent.
 */
export function wholeMonths(log: WorkoutEntry[], truncated: boolean): WholeMonths {
  if (!truncated || log.length === 0) return { log, droppedMonth: null };

  let oldest: string | null = null;
  for (const e of log) {
    const k = monthKey(e.t);
    if (k == null) continue;
    if (oldest == null || k < oldest) oldest = k;
  }
  if (oldest == null) return { log, droppedMonth: null };

  const kept = log.filter((e) => monthKey(e.t) !== oldest);
  // Every entry in the set belongs to that one month. Dropping it would leave
  // the screen with nothing and no way to say why, which is a worse answer than
  // a single part-month clearly labelled as one — so the set is returned whole
  // and the caller is told nothing was dropped.
  if (kept.length === 0) return { log, droppedMonth: null };
  return { log: kept, droppedMonth: oldest };
}
