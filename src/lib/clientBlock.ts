/**
 * WHICH WEEK OF THE BLOCK THE CLIENT IS ACTUALLY SHOWN.
 *
 * ── The half that was missing ─────────────────────────────────────────────
 *
 * src/lib/programBlock.ts holds a whole block and src/lib/programStart.ts says
 * which week of it today falls in. Between them they answered every question
 * the COACH's screens asked and none of the one question the client's screens
 * ask, which is simply: what am I training. `app/(client)/workouts.tsx` read
 * `program.days` — week one — so a client on a twelve week block trained week
 * one twelve times and their coach's other eleven weeks were written into a
 * column nobody rendered.
 *
 * This file is the one rule that answers it, and it is deliberately in `lib`
 * rather than inside the screen, because THREE readers have to agree:
 * the client's Train tab, the client's This Week screen, and the coach's
 * app/(trainer)/client-training.tsx, whose whole purpose is to compare the
 * record against the week the client was actually shown. A coach comparing
 * against a week their client never saw is the exact failure that screen
 * exists to prevent, and two implementations of "which week" is how that comes
 * back.
 *
 * ── The date still does not hold anything back ────────────────────────────
 *
 * This is the load-bearing decision and it is worth stating rather than
 * inferring from the switch below. A start date now decides WHICH WEEK OF A
 * BLOCK is on screen. It does not decide WHETHER the programme is on screen.
 * Every phase resolves to a real week that the client can train today:
 *
 *   · 'before'      week one, now, exactly as before this file existed. A block
 *                   dated next Monday and assigned on a Thursday is on their
 *                   Train tab on the Thursday. That is what `CLIENT_STARTS_NOW`
 *                   promises the coach and it stays true.
 *   · 'no-date'     week one. Which is every assignment made before
 *                   supabase/parts/175 and every one a coach makes without
 *                   choosing a date.
 *   · 'unreadable'  week one, and the screen says why rather than guessing a
 *                   number out of a date it could not parse.
 *   · 'during'      the week the date counts to.
 *   · 'after'       the LAST week, which stays on their tab. Not an empty
 *                   screen and not a locked one: a block whose last week has
 *                   passed is the plan they still have, and a client whose
 *                   coach has not written the next one yet must not open Train
 *                   to nothing.
 *
 * There is no phase that withholds a programme, and there is no way to add one
 * here without deleting one of the five branches, which is the point of writing
 * them as five branches rather than as a fallback.
 *
 * ── And the client can look at any of it ──────────────────────────────────
 *
 * `clientWeekLine` takes the week being VIEWED separately from the week the
 * date resolves to, because the screen lets a client tap along the block and
 * read week six in week two. Nothing is hidden from the person doing the work:
 * they can see what is coming, and the line tells them which week is theirs so
 * that looking ahead cannot be mistaken for having been moved on.
 *
 * Pure and framework-free.
 */
import type { BlockPosition } from './programStart';

/**
 * Why this week and not another. Six answers, kept apart for the same reason
 * `BlockPhase` keeps five apart: each one is a different sentence to a client,
 * and folding two of them together is how a screen ends up saying "week one"
 * to somebody whose coach set no date and to somebody whose date this build
 * could not read, when only the second is worth anybody looking into.
 */
export type WeekReason =
  /** The programme is one week long. Every programme written before
   *  `Program.weeks` existed is this, and nothing on screen names a week. */
  | 'only-week'
  /** The start date has passed and this is the week it counts to. */
  | 'counted'
  /** No start date on the assignment, so week one. */
  | 'no-date'
  /** A start date is stored that this build cannot parse, so week one. */
  | 'unreadable'
  /** The block is dated to start later and the client is on week one already. */
  | 'not-started'
  /** The block has run past its last week, which stays on screen. */
  | 'ended';

export interface ClientWeek {
  /** 0-based, because it indexes `programWeeks`. The screen adds one to print
   *  it. */
  index: number;
  /** How many weeks the block is, carried so a caller says "week 3 of 8"
   *  without asking a second module and getting a different answer. */
  count: number;
  reason: WeekReason;
}

/**
 * The week of the block the client is on.
 *
 * `weeks` is the block's own length from `weekCount` in
 * src/lib/programBlock.ts, and must be the same number that was handed to
 * `blockPosition` to produce `pos`. Clamped rather than trusted: `pos.week`
 * comes from arithmetic on a date and a programme can be edited between the two
 * calls, and an index past the end of the block renders an empty training day
 * over a programme that is not empty.
 */
export function clientWeek(pos: BlockPosition, weeks: number): ClientWeek {
  const count = Number.isFinite(weeks) && weeks >= 1 ? Math.floor(weeks) : 1;
  // Asked first, so a one-week programme can never be given a week number by
  // any of the branches below. A start date on a one-week programme is a real
  // and ordinary thing for a coach to set, and it must not make the client's
  // screen start counting weeks that do not exist.
  if (count === 1) return { index: 0, count, reason: 'only-week' };
  switch (pos.phase) {
    case 'during':
      return { index: Math.min(Math.max(pos.week ?? 1, 1), count) - 1, count, reason: 'counted' };
    case 'before':
      return { index: 0, count, reason: 'not-started' };
    case 'after':
      return { index: count - 1, count, reason: 'ended' };
    case 'unreadable':
      return { index: 0, count, reason: 'unreadable' };
    case 'no-date':
      return { index: 0, count, reason: 'no-date' };
  }
}

/**
 * The line the CLIENT reads under the week strip, in sentence case.
 *
 * `viewing` is the week whose days are on screen, which is the resolved week
 * until the client taps another one. When the two differ this says so and says
 * nothing else: a client reading ahead is not being told anything about their
 * effort, their adherence or their coach, only which week they have opened.
 *
 * Null for a one-week programme, so a programme written before blocks existed
 * renders exactly as it did, with no week number anywhere on the screen.
 */
export function clientWeekLine(w: ClientWeek, viewing: number): string | null {
  if (w.count <= 1) return null;
  const n = viewing + 1;
  if (viewing !== w.index) {
    return `You are looking at week ${n} of ${w.count}. Your coach has you on week ${w.index + 1}.`;
  }
  switch (w.reason) {
    case 'counted':
      return `Week ${n} of ${w.count}, counted from the day your coach set this block to start.`;
    case 'not-started':
      // The honest half of `CLIENT_STARTS_NOW`, said to the person it is about.
      // A coach who dates a block for next Monday and assigns it on a Thursday
      // has changed this week's training, and the client is the one standing in
      // the gym wondering why today's session is not the one they did on
      // Tuesday.
      return `Your coach wrote this block to start later. Week one of it is on your plan now, so there is nothing to wait for.`;
    case 'ended':
      return `The last week of this block has passed. Your plan stays on week ${n} of ${w.count} until your coach writes the next one.`;
    case 'no-date':
      return `Your coach set no start date on this block, so your plan stays on week one. Tap any week to read ahead.`;
    case 'unreadable':
      return `A start date is stored on this block and this app cannot read it, so your plan stays on week one rather than guessing a week number.`;
    case 'only-week':
      return null;
  }
}
