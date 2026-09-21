// The coach's own share of why a gym's month would not close.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// `closeBlockers` in src/lib/monthEnd.ts is the whole refusal: eight kinds of
// reason a month may not be presented as closed, computed on the owner's
// console over payments, invoices, memberships, passes and one-to-ones. Two of
// those eight are not the owner's work at all —
//
//     kind: 'unmarked_sessions'
//     `${t.unmarked} session${s} finished in ${w.label} with no outcome recorded.
//      Payroll counts delivered sessions, so this month's figure is wrong by
//      exactly those until somebody marks them.`
//
// — and the somebody is a coach, who is not on that screen, does not have the
// console, and in most cases does not know the month is being held up. The
// sentence names the work and is printed to the one person who cannot do it.
//
// The coach's own app already holds both halves of the answer and neither is
// framed as a deadline. app/(trainer)/sessions.tsx has a marking queue over a
// rolling ninety days; app/(trainer)/my-register.tsx lists classes with no
// register over a rolling seven, thirty or ninety. Both are "some time", and a
// month close is a date. Nothing anywhere told a coach that August is the
// month somebody is trying to sign off and that three of their sessions are
// what is stopping it.
//
// ── The two halves are NOT the same claim, and this module refuses to say
//    they are ────────────────────────────────────────────────────────────────
//
// An unmarked one-to-one genuinely blocks the close. `CLOSE_PARTS` is
// `['payments', 'invoices', 'sessions', 'memberships', 'passes']` and
// `CLOSE_COST.sessions` is "payroll cannot be computed and no month can be
// closed over it"; `payrollTotal.unmarked` counts exactly `isAwaitingOutcome`,
// which is what the coach's own queue counts.
//
// An open CLASS REGISTER does not. Class attendance is not one of the five
// close parts and `closeBlockers` never looks at it, so a month with six
// registers never taken closes without complaint. Saying otherwise would be the
// easy version of this feature and it would be a lie — and a lie of the worst
// available shape, because a coach who is told something is urgent, does it,
// and finds nothing changes stops believing the next sentence. What an open
// register actually costs is stated instead, and it is not small: the gym's
// record says nobody attended that class.
//
// ── What this cannot know, and says so ────────────────────────────────────
//
// Whether the gym has ALREADY closed the month. `gym_month_closes` carries one
// policy — `gym_month_closes_owner`, `is_owner_of(tenant_id)` — so a coach
// cannot read it, and this module must never print "your gym has not closed
// August yet". It says what is outstanding and what that does, which are facts
// about the coach's own rows, and leaves the month's state to the month's
// owner. `CLOSE_STATE_IS_THE_GYMS` is that sentence.
//
// Pure: no react, no supabase, no clock beyond the `now` handed in.
import { isAwaitingOutcome, type PtSession } from './gymSessions';
import { missingRegisters, type RegisterGap } from './registerGaps';
import type { ClassSummaryRow } from './classRates';
import { noGymNote } from './gymLink';
// One place decides what 'none' and 'unknown' mean — see src/lib/coachKit.ts,
// which imports the same type for the same reason.
import type { GymLink } from './coachPayTerms';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * The clause that separates what this app knows from what the gym knows.
 *
 * Printed under every month queue, including an empty one. Without it a coach
 * who clears their two sessions reads the empty list as "the month is closed",
 * which is a claim about a table they have no permission to read.
 */
export const CLOSE_STATE_IS_THE_GYMS =
  'Whether your gym has already signed this month off is its own record, not one this app can read. ' +
  'This is your side of it.';

/** Why an unmarked session is a deadline and not a chore. Quotes the rule the
 *  owner's console actually applies, because that is what makes it true. */
export const UNMARKED_BLOCKS_THE_CLOSE =
  'A month cannot be signed off with a session in it that nobody has said what happened to. ' +
  'Payroll counts delivered sessions, so the gym’s figure for this month is wrong by exactly these until they are marked.';

/**
 * What an open class register does and does not do.
 *
 * The second sentence is the honest half and the reason this is separate copy:
 * the month close reads one-to-ones and money, and class attendance is not one
 * of its five parts. Telling a coach it blocks the month would be an urgency
 * they would find out was invented.
 */
export const REGISTERS_DO_NOT_BLOCK =
  'These do not hold the month up. A month close reads one-to-ones and money, not class attendance. ' +
  'They do mean your gym’s record of those classes says nobody came.';

/** Nothing outstanding, said rather than drawn as a blank space. */
export const CLOSE_QUEUE_CLEAR =
  'Nothing of yours is outstanding for this month: every one-to-one has an outcome and every class with a booking has a register.';

/** A read that did not land. Never rendered as an empty queue. */
export const CLOSE_QUEUE_UNREAD =
  'Your own rows for this month could not be read, so nothing here is a statement that you are clear. ' +
  'It is not a claim about the month either way.';

/** One half of the queue that did not land, where the other did. */
export const CLOSE_HALF_UNREAD =
  'This part could not be read. It is unknown rather than empty, and the list beside it is unaffected.';

/* ── the shapes ───────────────────────────────────────────────────────────── */

/** One one-to-one that finished and that nobody has recorded an outcome for. */
export interface UnmarkedSession {
  id: string;
  /** As the row carried it. Formatted by the screen, never here. */
  startsAt: string;
  /** Who it was with, or null. `rowToSession` already answers null for a name
   *  it could not read, and a null renders as "a client" rather than as a gap. */
  clientName: string | null;
}

/** Half of the queue: rows, or the fact that we do not have them. */
export type QueueHalf<T> =
  | { state: 'unread' }
  | { state: 'ready'; rows: T[] };

/**
 * What the coach's month-close section draws. Never an empty list standing in
 * for a gym that is not there or a read that did not happen.
 */
export type CoachCloseView =
  /** The tenant read has not settled. Nothing may be said about anything. */
  | { kind: 'unread'; note: string }
  /** The account carries no gym, so no gym is closing a month around them. */
  | { kind: 'no_gym'; note: string }
  | {
      kind: 'month';
      /** 'August 2026', in the reader's own language. */
      monthLabel: string;
      /** 'YYYY-MM'. The fixed thing everything is matched on. */
      monthKey: string;
      sessions: QueueHalf<UnmarkedSession>;
      registers: QueueHalf<RegisterGap>;
      /**
       * True only when a WHOLE sessions read found at least one unmarked
       * session. Never true off a failed read, and never true off the register
       * half — which does not block, whatever it holds.
       */
      blocking: boolean;
      /**
       * True only when BOTH halves were read whole and both are empty. A single
       * unread half makes this false, because "you are clear" is a claim and
       * half a read cannot support it.
       */
      clear: boolean;
    };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/**
 * The coach's own sessions in a month that finished with no outcome recorded.
 *
 * `isAwaitingOutcome` and not "outcome is null": a session still in the future,
 * or one that was never booked, is not waiting for anybody. That is the same
 * test `payrollTotal.unmarked` applies on the gym's side, which is what makes
 * this list the same list the owner's blocker is counting.
 *
 * Bounded at both ends by the month window, as instants. `fromIso`/`toIso` come
 * from `monthAtGym`, so the bounds are the GYM's month rather than the phone's
 * — a session at 22:00 on the 31st belongs to the month the gym was open in.
 * `toIso` is exclusive for the reason `MonthWindow` states on itself.
 *
 * Oldest first, which is the opposite of the marking queue on
 * app/(trainer)/sessions.tsx and deliberate: that screen is "what have I
 * forgotten lately", this one is a month being closed behind them, and the
 * session at the far end is the one whose detail has faded most.
 */
export function unmarkedInMonth(
  sessions: readonly PtSession[],
  fromIso: string,
  toIso: string,
  now: number,
): UnmarkedSession[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  return sessions
    .filter((s) => {
      const at = Date.parse(s.startsAt);
      // An unreadable start is dropped here and NOT counted, unlike an
      // unreadable class start in registerGaps. The difference is which month
      // it belongs to: a class gap is listed whatever its start says because
      // the list is not scoped to a month, and this one is. A row we cannot
      // place in August cannot be offered as a reason August will not close.
      if (!Number.isFinite(at) || at < from || at >= to) return false;
      return isAwaitingOutcome(s, now);
    })
    .map((s) => ({ id: s.id, startsAt: s.startsAt, clientName: s.clientName }))
    .sort((a, b) => (Date.parse(a.startsAt) - Date.parse(b.startsAt)) || a.id.localeCompare(b.id));
}

/**
 * The whole section, decided once.
 *
 * Each half carries its own status. A refused sessions read must not take the
 * register list down with it and vice versa: a coach who can see one of the two
 * is better off than one who sees neither, and the half that failed says it
 * failed rather than rendering as nothing outstanding.
 *
 * `isWhole` on each: a truncated read is not the set. `classSummary` has no
 * partial state at all — it answers null for a truncated range, on the argument
 * its own header makes — and `fetchMySessions` throws through `assertWhole`, so
 * in practice 'partial' cannot arrive here. It is refused anyway, because the
 * day one of those two grows a partial state this must not be the file that
 * quietly accepts it.
 */
export function coachCloseView(
  link: GymLink,
  month: { key: string; label: string; fromIso: string; toIso: string } | null,
  sessions: { status: LoadStatus; rows: readonly PtSession[] | null },
  classes: { status: LoadStatus; rows: readonly ClassSummaryRow[] | null },
  now: number,
): CoachCloseView {
  if (link === 'unknown') return { kind: 'unread', note: CLOSE_QUEUE_UNREAD };
  if (link === 'none') return { kind: 'no_gym', note: noGymNote('months being closed around you') };
  // No window means the month key was not one. There is nothing to scope a
  // queue to, and an unscoped queue on a screen about a month is worse than no
  // queue: every figure on it would be about a period nobody named.
  if (!month) return { kind: 'unread', note: CLOSE_QUEUE_UNREAD };

  const sessHalf: QueueHalf<UnmarkedSession> = isWhole(sessions.status) && sessions.rows
    ? { state: 'ready', rows: unmarkedInMonth(sessions.rows, month.fromIso, month.toIso, now) }
    : { state: 'unread' };

  // `missingRegisters` takes the coach's own instant and uses it only to drop
  // classes that have not happened yet. The rows handed in are already the
  // month's, so the cutoff only ever matters in the month that is still
  // running — which this section is not normally showing.
  const regHalf: QueueHalf<RegisterGap> = isWhole(classes.status) && classes.rows
    ? { state: 'ready', rows: missingRegisters(classes.rows, new Date(now)) }
    : { state: 'unread' };

  const blocking = sessHalf.state === 'ready' && sessHalf.rows.length > 0;
  const clear =
    sessHalf.state === 'ready' && sessHalf.rows.length === 0 &&
    regHalf.state === 'ready' && regHalf.rows.length === 0;

  return {
    kind: 'month',
    monthLabel: month.label,
    monthKey: month.key,
    sessions: sessHalf,
    registers: regHalf,
    blocking,
    clear,
  };
}

/**
 * The figure beside the heading, or null.
 *
 * Null under every view that is not a whole read of at least one half, and null
 * when both halves are clear — the absence is the message, the same rule
 * `gapsHeading` states. A "0" beside a heading about holding the month up is
 * read as a reprimand that has been dealt with, which is a different thing from
 * having nothing to say.
 */
export function closeQueueNote(view: CoachCloseView): string | null {
  if (view.kind !== 'month') return null;
  const parts: string[] = [];
  if (view.sessions.state === 'ready' && view.sessions.rows.length > 0) {
    parts.push(`${view.sessions.rows.length} to mark`);
  }
  if (view.registers.state === 'ready' && view.registers.rows.length > 0) {
    parts.push(`${view.registers.rows.length} to register`);
  }
  return parts.length ? parts.join(' · ') : null;
}
