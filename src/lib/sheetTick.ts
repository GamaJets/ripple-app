// Ticking a set off on the coach's sheet, standing next to the person doing it.
//
// "There should be a check mark to the right of the exercise set being
// performed that logs this set as being completed."
//
// The same thing arrived through TestFlight against Repple Coach 1.3.0 (20) on
// 8 September — "A tick box to send feedback/log sets been completed." — and
// the MEMBER's half of it was built then: src/lib/setTicks.ts, on the client's
// own plan screen. This is the coach's half, and it is a separate file for one
// reason that matters, set out under "A hold is not tickable here" below.
//
// ── There is still no completion column, and this still does not invent one ─
//
// `workouts` stores `sets` as `[reps, kg]` pairs and carries no flag saying a
// set finished. `setTicks.ts` made the decision for the member's screen and it
// is the right one: a tick does not mark a set complete, IT RECORDS ONE.
//
// On this screen the recording is not a write — it is the reps box. The sheet
// IS the draft, and `entriesToWrite` in app/(trainer)/log-session.tsx saves
// exactly those sets whose reps box holds a count above zero. So:
//
//     A FILLED TICK MEANS THIS SET WILL BE SAVED. Nothing else.
//
// That invariant is the whole design and it is worth being blunt about, because
// the obvious alternative — a `done: boolean` on each set — is a second answer
// to a question the boxes already answer, and the two disagree the first time
// somebody ticks a set and then clears the reps. It also walks straight into
// the fault this repo fixed on the client's own finish screen the same week: a
// screen that collects a gesture it will not keep reads as broken, and is.
//
// ── Which means a tick can only be offered where the plan is definite ──────
//
// One tap has to put a rep count in a box that becomes somebody's permanent
// record. `readRepSpan` (src/lib/setRows.ts) is the reader that already decides
// what a prescription definitely says, and it decides it here — asked rather
// than re-implemented, because two readers of the same strings is how the two
// halves of an app come to disagree about what a plank is.
//
// A single whole number is a definite count. A RANGE is not: '6-8' is a target
// with a decision inside it, and the fastest control on the screen must not
// make that decision on the coach's behalf. AMRAP is not. A blank is not. Where
// the answer is not known, the tick is drawn as something to type into rather
// than something to tap, and it says what it is waiting for.
//
// ── A hold is not tickable here, and that is the difference from setTicks ──
//
// `setTicks.ts` DOES tick a hold: the member's runner writes `timed[i] === true`
// beside the pair, so `sets[i][0]` means seconds rather than reps
// (src/lib/timedSets.ts), and '45 sec' asked for and performed is exactly as
// definite as ten reps.
//
// app/(trainer)/log-session.tsx has no such flag. It writes `[reps, kg]` and
// nothing else, so a 45 put into its reps box IS forty-five repetitions in
// somebody else's permanent record, written by their coach, which they cannot
// delete. src/lib/planPrefill.ts refuses to seed a hold for exactly this reason
// and this file refuses to tick one.
//
// `readRepSpan('45 sec')` is already null, so the refusal would happen anyway.
// It is written out explicitly all the same, through `prescribedSeconds`, so
// that the day somebody widens the span reader the hold does not quietly
// become tickable — and so the reason is on screen rather than in a diff.
import { num } from './format';
import { readRepSpan } from './setRows';
import { prescribedSeconds } from './timedSets';

/**
 * What the tick beside one set of the sheet is, right now.
 *
 * Derived from the boxes every time. Never stored: see the invariant above.
 *
 *   · `fill`    — the plan states a definite count and the box is empty. One
 *                 tap puts `reps` in it.
 *   · `clear`   — the box holds exactly what the plan asked for, which means
 *                 the tick put it there. One tap takes it back out.
 *   · `done`    — the box holds a count the COACH typed, which is not the
 *                 plan's figure. Drawn as done, because it will be saved, and
 *                 NOT tappable: a tick must not be able to erase a figure a
 *                 person entered by hand. This screen has no undo and its own
 *                 `loadPlanDay` is written under the same rule.
 *   · `manual`  — nothing definite to tick. `reason` says what it is waiting
 *                 for, in the coach's words.
 */
export type SheetTick =
  | { state: 'fill'; reps: number }
  | { state: 'clear'; reps: number }
  | { state: 'done' }
  | { state: 'manual'; reason: string };

/** Whether this set, as the boxes stand, is one `entriesToWrite` will save. */
export function willSave(tick: SheetTick): boolean {
  return tick.state === 'clear' || tick.state === 'done';
}

/** Whether tapping does anything. */
export function isTappable(tick: SheetTick): boolean {
  return tick.state === 'fill' || tick.state === 'clear';
}

/**
 * The rep count in a box, or null when there is not one that would be saved.
 *
 * `entriesToWrite` filters on `(parseInt(reps, 10) || 0) > 0`, and this agrees
 * with it deliberately — including on the two cases that look like typos and
 * are not. A box holding '0' is not a set of no repetitions, it is a set that
 * does not get written; a box holding rubbish is the same. Both must read as
 * un-ticked, or the tick claims a save that will not happen.
 */
function boxReps(reps: string | null | undefined): number | null {
  const n = parseInt(String(reps ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The tick for one set.
 *
 * `target` is the coach's own prescription carried across by
 * src/lib/planPrefill.ts — '8', '6-8', 'AMRAP', '30s' — or null on a row the
 * coach added by hand. `reps` is whatever is in the box at this moment.
 */
export function sheetTick(target: string | null | undefined, reps: string | null | undefined): SheetTick {
  const typed = boxReps(reps);
  const held = prescribedSeconds(target);
  // A hold, before anything else. See the header: this sheet cannot record
  // seconds, so a definite hold is still not a tickable set here — and saying
  // so first means the reason on screen names the hold rather than shrugging.
  const span = held == null ? readRepSpan(target) : null;
  const definite = span && span.low === span.high ? span.low : null;

  if (typed != null) {
    return definite != null && typed === definite ? { state: 'clear', reps: definite } : { state: 'done' };
  }
  if (definite != null) return { state: 'fill', reps: definite };

  const t = String(target ?? '').trim();
  if (held != null) {
    return { state: 'manual', reason: `${t} is a hold — this sheet records repetitions, so type what they did.` };
  }
  if (span) return { state: 'manual', reason: `You wrote ${t} — type what they actually did.` };
  if (t) return { state: 'manual', reason: `You wrote ${t} — type what they actually did.` };
  return { state: 'manual', reason: 'Type the reps to save this set.' };
}

/**
 * What a screen reader says about the tick.
 *
 * Spoken in full rather than as "checkbox, unchecked", because the one thing a
 * coach using VoiceOver cannot do is see that the control beside set three is
 * greyed out and read the caption underneath it explaining why.
 */
export function sheetTickLabel(tick: SheetTick, movement: string, setNo: number): string {
  const where = `${movement} set ${setNo}`;
  switch (tick.state) {
    case 'fill': return `Tick ${where} as done at ${tick.reps} reps, which is what you wrote for it`;
    case 'clear': return `${where} is done at ${tick.reps} reps. Tap to clear it.`;
    case 'done': return `${where} is done and will be saved`;
    case 'manual': return `${where} is not ticked. ${tick.reason}`;
  }
}

/**
 * How much of the sheet is ticked, or null when there is nothing to count.
 *
 * Null rather than "0 of 0": a sheet with no sets on it has not had none of
 * them done, and a line saying so reads as a reproach to a coach who has just
 * opened the screen.
 */
export function sheetTicksLine(done: number, total: number): string | null {
  if (total <= 0) return null;
  // Through the formatter, not raw. A set count reaching four digits is not a
  // realistic sheet, but `check:numbers` is mechanical on purpose: the gate
  // exists because "this one cannot get big" has been wrong before, and an
  // exemption costs more to read than the call does.
  const all = num(total);
  // One set is the ordinary state of a freshly added exercise — it is what
  // `addExercise` creates — so the singular is not an edge case here, it is the
  // first thing a coach sees. "None of the 1 sets" and "All 1 sets" were both
  // on screen within a minute of opening the screen.
  const one = total === 1;
  if (done <= 0) {
    return one
      ? 'The one set on the sheet has no rep count yet, so nothing would be saved.'
      : `None of the ${all} sets on the sheet has a rep count yet, so nothing would be saved.`;
  }
  if (done >= total) {
    return one
      ? 'The one set has a rep count and will be saved.'
      : `All ${all} sets have a rep count and will be saved.`;
  }
  const left = total - done;
  const other = left === 1 ? 'The other one will not be saved.' : `The other ${num(left)} will not be saved.`;
  return `${num(done)} of ${all} sets have a rep count. ${other}`;
}
