/**
 * The week of the block a client's screens are looking at, resolved once.
 *
 * SIX client screens read `program.days` — Train, This Week, the dashboard, the
 * calendar, the habits panel and the coach tab — and `days` is week one. On a
 * twelve week block that made every one of them draw week one for twelve weeks.
 * Fixing them one at a time is how they come to disagree: a dashboard saying
 * "Push" over a Train tab showing the deload week is worse than both of them
 * being wrong together, because the client cannot tell which one to believe.
 *
 * So the rule lives in src/lib/clientBlock.ts, where it is pure and tested, and
 * this hook is the single place that feeds it the two things it needs from
 * providers: the assignment's start date and the device's own today. Every
 * screen asks this and none of them does the arithmetic.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 *
 * It never withholds a programme. `clientWeek` resolves all five phases of
 * `blockPosition` to a real week — see the header there — so there is no state
 * this hook can be in where `days` is empty because of a date.
 *
 * It reads the COACH's date against the CLIENT's clock, and that is stated
 * rather than hidden: `starts_on` is a bare date with no offset, because there
 * is no client timezone column anywhere in this schema. For a few hours a day a
 * client in Los Angeles and a coach in Dubai disagree about which day today is,
 * so a block can read as week two for one of them and week one for the other.
 * The week number is never shown without the sentence that says it is counted
 * from the day the coach set.
 */
import { useMemo } from 'react';
import type { Program, ProgramDay, ProgramWeek } from '../lib/programs';
import { programWeeks } from '../lib/programBlock';
import { blockPosition, type BlockPosition } from '../lib/programStart';
import { clientWeek, type ClientWeek } from '../lib/clientBlock';
import { isoToday } from '../lib/dayPlan';
import { useAssignedPrograms } from './assignedPrograms';

export interface ClientBlockView {
  /** Every week of the block, week one first. One entry for a programme
   *  written before blocks existed, which is most of them. */
  weeks: ProgramWeek[];
  position: BlockPosition;
  /** Which week they are on, and why that one. */
  week: ClientWeek;
  /** The days of that week. THE list every screen renders. */
  days: ProgramDay[];
  /** The day the coach said the block begins, or null. Carried so a screen can
   *  say the date rather than only the week number. */
  startsOn: string | null;
}

/**
 * `program` is the programme the screen is actually drawing, which is the
 * coach's assignment where there is one and the app's own generated programme
 * where there is not. Both go through here: a generated programme is one week
 * long, so it resolves to week one with reason 'only-week' and no screen prints
 * a week number over it.
 */
export function useClientWeek(program: Program | null | undefined, clientId: string): ClientBlockView {
  const { startsOn } = useAssignedPrograms();
  // Absent from the map is "no start date on this assignment", which is every
  // assignment made before supabase/parts/175. See the note on `startsOn` in
  // src/ui/assignedPrograms.tsx.
  const on = startsOn[clientId] ?? null;
  return useMemo(() => {
    const weeks = programWeeks(program);
    // `programWeeks` returns at least one week for any programme and an empty
    // array only for a null one — a screen still rendering while the provider
    // reads. One, not zero, so `blockPosition` cannot be handed a block of no
    // weeks and answer 'after' on the day it started.
    const count = weeks.length || 1;
    const position = blockPosition(on, isoToday(new Date()), count);
    const week = clientWeek(position, count);
    return { weeks, position, week, days: weeks[week.index]?.days ?? [], startsOn: on };
  }, [program, on]);
}
