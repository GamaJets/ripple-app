/**
 * WHETHER A CLIENT'S BLOCK IS RUNNING OUT, for the coach's Needs Attention queue.
 *
 * The data-layout review lists "plan ending" as a valid attention reason, and
 * the dashboard already holds every input: the assignment's start date
 * (`startsOn` from src/ui/assignedPrograms.tsx) and the block's length
 * (`weekCount` in src/lib/programBlock.ts). This answers one question over
 * them, through `blockPosition` so it can never disagree with the week number
 * the client's Train tab shows.
 *
 * Null whenever the date cannot support a verdict. A block with no start date
 * has no end date either, and "ended" said of an assignment nobody dated would
 * be a reason made out of a missing field.
 *
 * Pure and framework-free.
 */
import { blockPosition } from './programStart';

export type BlockEnd =
  /** The last day is within the next seven, 0 meaning today. */
  | { state: 'ending'; daysLeft: number }
  /** The last day has passed, `daysAgo` whole days ago (1 = yesterday). */
  | { state: 'ended'; daysAgo: number };

/** How many days ahead counts as "ending soon". */
export const BLOCK_ENDING_WINDOW_DAYS = 7;

export function blockEnding(
  startsOn: string | null | undefined,
  todayISO: string,
  weeks: number,
): BlockEnd | null {
  const pos = blockPosition(startsOn, todayISO, weeks);
  if (pos.dayOffset == null) return null;
  // The block's last day is day (weeks * 7 - 1) counted from its start.
  const left = pos.weeks * 7 - 1 - pos.dayOffset;
  if (left < 0) return { state: 'ended', daysAgo: -left };
  if (pos.phase === 'during' && left < BLOCK_ENDING_WINDOW_DAYS) return { state: 'ending', daysLeft: left };
  return null;
}
