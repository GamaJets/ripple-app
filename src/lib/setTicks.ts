// Ticking a PLANNED set off, one at a time, so what is left is on screen.
//
// "A tick box to send feedback/log sets been completed." — TestFlight, Repple
// Coach 1.3.0 (20), 8 September.
//
// ── There is no completion column, and this does not invent one ───────────
//
// A set is done in this app because it was LOGGED. `workouts` stores `sets` as
// `[reps, kg]` pairs and carries no flag saying a set finished; the plan screen
// asks `logged[id].length >= setCount(e)` and the guided runner asks
// `results[idx].length`, and both of those are counts of sets already recorded.
// Nothing anywhere holds "set 3 of 4 is complete" as a separate fact.
//
// That is the right model and it stays. A completion flag beside the log would
// be a second answer to a question the log already answers, and the two would
// disagree the first time somebody deleted an entry. So a tick here does not
// mark a set complete — IT LOGS IT, at the figures the plan asked for, and the
// tick being drawn as filled is that logged set being read back.
//
// ── Which means a tick is testimony, and can only be offered where the plan
//    says something definite ────────────────────────────────────────────────
//
// One tap has to write a rep count. The plan screen already learned what that
// costs: its quick-log used `parseInt(e.reps, 10) || 8`, so 'AMRAP' became
// eight and '8-10' became eight whatever was done, written by the fastest
// control in the app into the log behind somebody's records and next session's
// target.
//
// `readRepSpan` (src/lib/setRows.ts) is the reader that already decides this
// for the coach's side, and it decides it here. A single number is a definite
// count. A RANGE, a hold written in seconds, an AMRAP and a blank are all "not
// known in advance", and where the answer is not known there is no tick — the
// row is drawn, it says what it is waiting for, and the set is typed instead.
// A prescription in seconds is the one exception, because `prescribedSeconds`
// reads a definite figure out of '45 sec' and a hold that was asked for and
// performed is exactly as definite as ten reps.
//
// ── Order ──────────────────────────────────────────────────────────────────
//
// Sets come off the top. The tick is offered on the FIRST set not yet logged,
// and the untick on the LAST one that was — because the log is a list of sets
// in the order they happened, with no set numbers in it, and there is no such
// thing as removing the third of five from the middle of that list without
// renumbering the two after it into sets nobody did. A checklist that lets you
// tick set 4 before set 2 is offering an order the store cannot hold.
import { readRepSpan, type PlannedSet } from './setRows';
import { prescribedSeconds } from './timedSets';

/**
 * What one tap would record: reps, or SECONDS on a movement prescribed as a
 * hold, plus whatever the plan says is on the bar.
 *
 * `loadKg` is null for a bodyweight set and stays null — see
 * src/lib/bodyweightSets.ts on why a stored 0 and a load nobody prescribed
 * cannot be told apart afterwards.
 */
export type TickRecord =
  | { kind: 'reps'; value: number; loadKg: number | null }
  | { kind: 'hold'; secs: number; loadKg: number | null };

/**
 * What a tick on this planned set would write, or null where the plan does not
 * say definitely enough for one tap to say it.
 *
 * The hold is asked about FIRST. '45 sec' contains a number that `readRepSpan`
 * would refuse anyway, but the order is deliberate rather than incidental: a
 * prescription that names a unit of time is a hold whatever else can be read
 * out of it, and a future rep reader that got cleverer must not start reading
 * planks as forty-five repetitions.
 */
export function tickRecord(set: PlannedSet): TickRecord | null {
  const secs = prescribedSeconds(set.reps);
  if (secs != null) return { kind: 'hold', secs, loadKg: set.loadKg };
  const span = readRepSpan(set.reps);
  if (span && span.low === span.high && span.low > 0) {
    return { kind: 'reps', value: span.low, loadKg: set.loadKg };
  }
  return null;
}

/** Where one planned set stands in the session. */
export type TickState =
  /** Logged. The tick is filled, and this set can be taken back if it is the
   *  most recent one. */
  | 'done'
  /** The set to do next — the only one a tick may be put on. */
  | 'next'
  /** Still to come. Drawn, never tickable: see the header on order. */
  | 'later';

/** One line of the checklist. */
export interface SetTick {
  /** 1-based, because it is the number in the SET column. */
  n: number;
  state: TickState;
  /**
   * What a tap would write, or null where the plan is not definite.
   *
   * Answered for EVERY row, including the ones still to come, because it is a
   * property of the planned set rather than of the tap. A checklist that only
   * knew the next set's figures could not draw the rows below it, and it could
   * not say — before somebody gets there — that set 4 is an AMRAP and will have
   * to be typed. Whether a tap does anything is `actionable`, and that is the
   * only thing order gates.
   */
  records: TickRecord | null;
  /** Whether a tap does anything at all. False on every 'later' row, on a
   *  'next' row the plan cannot answer for, and on every 'done' row except the
   *  most recent. */
  actionable: boolean;
}

/**
 * The checklist for one movement.
 *
 * `done` is how many sets have already been logged against it in this session.
 * It can EXCEED the plan — somebody who does a fifth set of a four-set movement
 * did something real — and the extra sets simply have no planned row to sit on.
 * Nothing here invents rows for them; the log holds them and the runner lists
 * them underneath.
 */
export function setTicks(plan: readonly PlannedSet[], done: number): SetTick[] {
  const n = Number.isFinite(done) ? Math.max(0, Math.floor(done)) : 0;
  return plan.map((p, i) => {
    const state: TickState = i < n ? 'done' : i === n ? 'next' : 'later';
    const records = tickRecord(p);
    // The last logged set, and only the last, can be taken back. See the header
    // on order: the log has no set numbers in it, so "undo set 2 of 5" is not a
    // thing the store can express.
    const actionable = state === 'done' ? i === n - 1 : state === 'next' && records != null;
    return { n: p.n, state, records, actionable };
  });
}

/**
 * What is left, in a sentence.
 *
 * Null where there is no plan to count against, because "0 of 0 sets" is not a
 * sentence — a member adding sets of their own to a movement with no
 * prescription is not behind on anything.
 *
 * Never says "done" while sets remain and never says a figure it cannot stand
 * behind: `done` and `planned` are both counts this screen is holding, one of
 * them the session's own logged sets, so there is nothing here to gate on a
 * read. The caller gates the PLAN.
 */
export function ticksLine(planned: number, done: number): string | null {
  if (!Number.isFinite(planned) || planned <= 0) return null;
  const did = Number.isFinite(done) ? Math.max(0, Math.floor(done)) : 0;
  if (did >= planned) {
    const extra = did - planned;
    if (extra > 0) return `All ${planned} sets done, and ${extra} more.`;
    return `All ${planned} sets done.`;
  }
  const left = planned - did;
  return `${did} of ${planned} sets done · ${left} to go`;
}

/**
 * What a screen reader is told about one line of the checklist.
 *
 * `loadText` is the load already rendered in the reader's own unit — this
 * module converts nothing and formats nothing, because a label that spelled out
 * kilograms would be reading a stored figure to somebody whose whole app is in
 * pounds. Null where the plan names no load, which is a bodyweight set and is
 * said as one rather than as "at nothing".
 *
 * The sentence names the FIGURES rather than repeating the prescription,
 * because that is what the tap writes, and a control whose spoken label is not
 * what it does is worse than one with no label at all.
 */
export function tickLabel(tick: SetTick, movement: string, loadText: string | null): string {
  const at = loadText ? ` at ${loadText}` : ' at bodyweight';
  if (tick.state === 'done') {
    return tick.actionable
      ? `Set ${tick.n} of ${movement} is logged. Take it back.`
      : `Set ${tick.n} of ${movement} is logged.`;
  }
  if (tick.state === 'later') return `Set ${tick.n} of ${movement}, still to come.`;
  if (!tick.records) {
    return `Set ${tick.n} of ${movement}. Type what you did — the plan does not say a single figure, so this cannot be ticked off.`;
  }
  return tick.records.kind === 'hold'
    ? `Log set ${tick.n} of ${movement}: a ${tick.records.secs} second hold${at}.`
    : `Log set ${tick.n} of ${movement}: ${tick.records.value} reps${at}.`;
}
