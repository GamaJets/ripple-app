// A ROW PER SET, each with its own load, and a tick that says it happened.
//
// Two pieces of TestFlight feedback from one coach on Repple Coach 1.3.0 (20),
// both dated 8 September, and they are the same table seen from two sides:
//
//   · "When entering amount of sets there should be a drop down to record with
//      the weight being used per set"
//   · "A tick box to send feedback/log sets been completed."
//
// ── What was already true, and what was not ───────────────────────────────
//
// The MODEL has carried a load per set since the beginning. A `workouts` row
// stores `sets` as `[reps, kg]` PAIRS — one pair per set, each with its own
// second number — and src/lib/workoutRow.ts round-trips them. src/lib/setRows.ts
// does the same on the coach's prescription side. Nothing about per-set weight
// needed a column, a migration or a new shape.
//
// What collapsed it was one ENTRY control. The coach's own training screen took
// a count, one rep figure and one load, and wrote `Array.from({ length: s },
// () => [r, kg])`: three sets of the identical number, because three boxes
// cannot say anything else. A coach who ramped 60 / 65 / 65 could type 60, or
// 65, and neither was what happened.
//
// So this module is the entry side of a model that was already right: N rows,
// each with its own reps and its own load, and the count box now decides HOW
// MANY ROWS rather than how many copies of one row.
//
// ── The tick, and why nothing is saved without one ────────────────────────
//
// A set is "done" in this app by virtue of having been logged — there is no
// completion column on `workouts` and this does not invent one. What the tick
// changes is WHEN the logging happens: the rows go up before the session, get
// ticked off through it, and only the ticked ones are written.
//
// That is also the strictest possible reading of the one rule this file must
// not break. A row nobody ticked is a set nobody did, and it is not saved — not
// as zero reps, not as an empty load, not at all. `readLadder` cannot even see
// an unticked row's boxes, so there is no path by which a half-filled table
// becomes a set in somebody's history. The count of what will and will not be
// saved is said out loud before the button is pressed; see `ladderNote`.
//
// ── Loads ──────────────────────────────────────────────────────────────────
//
// Every load here is read by `readLift` in src/lib/units.ts, which converts
// from whatever unit is on the keyboard and REFUSES a figure it cannot
// believe. Storage is kilograms, always, and nothing in this file converts
// anything itself.
//
// A blank load box is a bodyweight set and is stored as 0. That is not a
// fabricated figure, it is this app's existing written convention — every other
// writer of `workouts.sets` stores it that way and `setsSummary` in
// src/lib/ownTraining.ts reads it back as "no external load" rather than as
// "0 kg". Changing it here would relabel one screen's history against every
// other screen's.
import { liftIn, plain, readLift, type WeightUnit } from './units';
import { expandSets, type SetRow, type SetSpec } from './setRows';

/**
 * One row of the table, as it is TYPED.
 *
 * Reps and load are text and not numbers, for the reason
 * app/(client)/workouts.tsx already gives about its edit sheet: a controlled
 * input that parses every keystroke re-renders "137.5" as "13" halfway through
 * being typed. They are read once, at the moment of saving.
 *
 * `done` is the tick. It is the person's testimony that the set happened, and
 * it is the only thing that puts the row into the log.
 */
export type LadderRow = { reps: string; load: string; done: boolean };

/**
 * How many sets one entry may carry.
 *
 * 30 is the bound the coach's own training screen has always enforced on its
 * set count, moved here rather than restated. It is not a claim about training
 * — it is the point past which a typo is likelier than a session.
 */
export const MAX_LADDER_SETS = 30;

/**
 * The reps one set may carry.
 *
 * 200 for the same reason, and the same figure that screen already used. A hold
 * measured in seconds does not come through here: this table is reps and load,
 * and src/lib/timedSets.ts owns everything about a set that was held.
 */
const MAX_LADDER_REPS = 200;

/** Either a number of sets, or the sentence to show whoever typed it. */
export type CountRead = { ok: true; n: number } | { ok: false; reason: string };

/**
 * Read the set-count box.
 *
 * Refused rather than coerced, all the way down. `parseInt(x, 10) || 3` is the
 * line this replaces on two screens, and a fat-fingered count silently becoming
 * three is a table with three rows in it that nobody asked for — which, once
 * ticked, is three sets in somebody's history.
 *
 * An EMPTY box is its own answer and not a refusal: somebody who has cleared
 * the box to retype it is mid-thought, and shouting at them for it is the
 * behaviour every other reader in this app declines. The caller shows no table
 * and holds the button.
 */
export function readSetCount(text: string): CountRead {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, reason: 'Say how many sets you did.' };
  // Tested before it is parsed. `Number('3 ')` is 3 and `parseInt('3kg', 10)`
  // is 3, and neither of those is somebody typing a set count.
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: `Sets must be a whole number between 1 and ${MAX_LADDER_SETS}.` };
  }
  const n = Number(s);
  if (n < 1 || n > MAX_LADDER_SETS) {
    return { ok: false, reason: `Sets must be a whole number between 1 and ${MAX_LADDER_SETS}.` };
  }
  return { ok: true, n };
}

/** A row nobody has typed into. Named, because "the empty row" appears in three
 *  places below and an inline literal in each is three chances to disagree. */
const BLANK: LadderRow = { reps: '', load: '', done: false };

/**
 * Grow or shrink the table to `n` rows, keeping what has already been typed.
 *
 * Growing COPIES the last row's reps and load, exactly as `addSetRow` in
 * src/lib/setRows.ts does and for the same stated reason: the commonest fourth
 * set is another one of the third, and a blank row is the one thing it is
 * almost never. It copies no further than that — the new row's TICK is always
 * off, because a copied number is a suggestion and a tick is testimony, and
 * carrying the tick forward would be this module writing a set nobody did.
 *
 * Shrinking drops rows off the END, which is the only end a person means when
 * they change 4 to 3. Nothing is preserved on the way down: somebody who goes
 * back up gets the last row copied again rather than a stale row from before.
 *
 * `n` is trusted here because `readSetCount` is what produces it, but a count
 * off either end still cannot produce a loop that does not stop.
 */
export function resizeLadder(rows: LadderRow[], n: number): LadderRow[] {
  const want = Number.isFinite(n) ? Math.max(0, Math.min(MAX_LADDER_SETS, Math.floor(n))) : 0;
  const out = rows.slice(0, want);
  while (out.length < want) {
    const src = out[out.length - 1];
    out.push(src ? { reps: src.reps, load: src.load, done: false } : { ...BLANK });
  }
  return out;
}

/** Change one row's reps or load. An index off either end changes nothing,
 *  which needs no guard: `map` matches no row and hands back what it was
 *  given. See the same argument in src/lib/setRows.ts. */
export function patchLadderRow(rows: LadderRow[], at: number, patch: Partial<LadderRow>): LadderRow[] {
  return rows.map((r, i) => (i === at ? { ...r, ...patch } : r));
}

/** Tick or untick one row. Reversible in both directions, on purpose: a tick
 *  put on the wrong line is the commonest thing to do with a checklist, and a
 *  control that cannot be undone is one people stop using. */
export function toggleLadderRow(rows: LadderRow[], at: number): LadderRow[] {
  return rows.map((r, i) => (i === at ? { ...r, done: !r.done } : r));
}

/**
 * Tick every row, or clear every tick.
 *
 * The one-tap answer for the ordinary session, where all of it got done. Its
 * absence is what would make the tick a tax on the common case rather than a
 * record of the uncommon one.
 */
export function setAllLadderRows(rows: LadderRow[], done: boolean): LadderRow[] {
  return rows.map((r) => ({ ...r, done }));
}

/** How many rows are ticked. */
export function ladderDone(rows: LadderRow[]): number {
  return rows.filter((r) => r.done).length;
}

/** The sets this table would write, or the sentence saying why it cannot. */
export type LadderRead =
  | { ok: true; sets: [number, number][] }
  | { ok: false; reason: string };

/**
 * Read the table into the pairs a `workouts` row stores.
 *
 * ONLY ticked rows are looked at. That is the whole guarantee of this function
 * and it is worth stating as a guarantee rather than as an implementation
 * detail: a table of four rows with two ticked writes two sets, and the other
 * two do not appear in the result as zeros, as empties or as anything else.
 *
 * A ticked row that does not say what was done is a REFUSAL, named by its set
 * number, and not a set quietly dropped. The two cases are different: an
 * unticked row is somebody saying "I did not do this", and a ticked row with an
 * empty reps box is somebody saying "I did this" and not having said what. Only
 * the second one is a question the app has to ask back.
 */
export function readLadder(rows: LadderRow[], unit: WeightUnit): LadderRead {
  const sets: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.done) continue;
    const reps = String(r.reps ?? '').trim();
    if (!/^\d+$/.test(reps) || Number(reps) < 1 || Number(reps) > MAX_LADDER_REPS) {
      return {
        ok: false,
        reason: `Set ${i + 1} is ticked but its reps are not a whole number between 1 and ${MAX_LADDER_REPS}.`,
      };
    }
    const load = readLift(r.load, unit);
    if (!load.ok) return { ok: false, reason: `Set ${i + 1}: ${load.reason}` };
    // A blank box is a bodyweight set, stored as 0. See the header — this is
    // the convention every other writer of `workouts.sets` already follows,
    // not a figure invented here.
    sets.push([Number(reps), load.kg ?? 0]);
  }
  if (!sets.length) {
    return { ok: false, reason: 'Tick the sets you actually did. Nothing is saved until at least one is ticked.' };
  }
  return { ok: true, sets };
}

/**
 * What to say under the table about what is and is not going to be saved.
 *
 * Null when every row is ticked, because "4 of 4 sets ticked" is a sentence
 * that tells somebody nothing they cannot see. The line exists for the other
 * case, and it names the consequence rather than the count alone: rows left
 * unticked are not saved, and somebody who thought the tick was decoration
 * should find that out before the button and not after it.
 */
export function ladderNote(rows: LadderRow[]): string | null {
  const total = rows.length;
  if (!total) return null;
  const done = ladderDone(rows);
  if (done === total) return null;
  if (done === 0) {
    return `Nothing ticked yet. Tick each set as you finish it — ${total === 1 ? 'the set' : 'a set'} that is not ticked is not saved.`;
  }
  const left = total - done;
  // numbers-ok: `total` is `rows.length` — the set rows on ONE exercise the
  // member is working through right now. It is bounded by what a person can
  // physically do in a session, which is not four digits.
  return `${done} of ${total} sets ticked. The other ${left === 1 ? 'one is' : `${left} are`} not saved.`;
}

/**
 * Whether the ticked rows actually differ from one another.
 *
 * Used to decide whether a summary line is worth drawing: "3 × 8 at 60 kg" is
 * worth one line and three identical rows are the same sentence three times,
 * which is the judgement src/lib/setRows.ts already makes about the coach's
 * table. Unticked rows are excluded because they are not part of what happened.
 */
export function ladderVaried(rows: LadderRow[]): boolean {
  const on = rows.filter((r) => r.done);
  if (on.length < 2) return false;
  return on.some((r) => r.reps !== on[0].reps || r.load !== on[0].load);
}

// ── THE OTHER MEANING OF THE SAME TABLE ───────────────────────────────────
//
// Everything above is a table of sets that HAPPENED. The two functions below
// are the same rows read as a table of sets that are GOING to happen — the
// member's own correction to a movement on their plan, or a movement they typed
// in themselves, where the sheet has until now asked for one count, one rep
// target and one load and could therefore only ever mean "N of the same set".
//
// They are here rather than in a module of their own because the ROWS are the
// same rows and the screen drawing them is the same component. What differs is
// one thing, and it is worth stating loudly because it is the only place in
// this file where a blank box means two things:
//
//   in a LOG      a blank load box is a BODYWEIGHT set, stored as 0.
//   in a PLAN     a blank load box is NO TARGET, stored as null.
//
// Both are right. "I did this with nothing on the bar" and "I have not said
// what to put on the bar" are different sentences, and src/lib/setRows.ts is
// explicit that a `loadKg` of null on a planned row is the second one.

/** The rows to open the sheet on, for an exercise that already has a plan. */
export function ladderFromPlan(ex: SetSpec, unit: WeightUnit): LadderRow[] {
  return expandSets(ex).map((s) => ({
    // The prescription verbatim. A range — "8-10" — is what the coach wrote and
    // it survives being opened and saved again unchanged; nothing here narrows
    // it to one end, which is the defect the plan screen's one-tap log was
    // fixed for.
    reps: s.reps ?? '',
    // Rendered in the unit the sheet is set to, because what is shown has to be
    // what would be saved. `plain` rather than String, so 42.5 does not open as
    // 42.500000000000004 after a conversion.
    load: s.loadKg == null ? '' : plain(liftIn(s.loadKg, unit) ?? 0),
    // Not a log. Nothing here is testimony about a set that happened, and the
    // component drawing a plan does not show the tick column at all.
    done: false,
  }));
}

/** A plan table, or the sentence saying why it cannot be saved as one. */
export type PlanRowsRead =
  | { ok: true; setRows: SetRow[] }
  | { ok: false; reason: string };

/**
 * Read the table as a PRESCRIPTION.
 *
 * Every row is read, ticked or not: a plan is not testimony and there is
 * nothing here for a tick to say. What each row may hold is wider than a log
 * allows, and deliberately — the reps column of a plan is a coach's column and
 * carries "8-10", "AMRAP" and "45 sec", none of which is a number.
 *
 * The load is the one thing that is checked, by `readLift`, because it is the
 * one thing this app ever converts. A blank load is NO TARGET and is written as
 * an explicit null: see src/lib/setRows.ts on why `null` and absent are
 * different answers, and why the two columns a person can see and edit are
 * always written out rather than left to inherit.
 */
export function ladderToPlanRows(rows: LadderRow[], unit: WeightUnit): PlanRowsRead {
  const out: SetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const load = readLift(rows[i].load, unit);
    if (!load.ok) return { ok: false, reason: `Set ${i + 1}: ${load.reason}` };
    out.push({ reps: String(rows[i].reps ?? '').trim(), loadKg: load.kg });
  }
  if (!out.length) return { ok: false, reason: 'Say how many sets this movement is.' };
  return { ok: true, setRows: out };
}
