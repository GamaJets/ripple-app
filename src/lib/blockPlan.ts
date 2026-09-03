// The shape of a block, and the two edits a coach could not make to one.
//
// ── What the builder could do to a week, and what it could not ─────────────
//
// app/(trainer)/builder.tsx has held a week strip since blocks landed. A coach
// can select a week, mark it a deload, remove it, and add one — where "add"
// copies THE LAST WEEK, for the stated reason that nobody adds week five in
// order to leave it empty.
//
// Two things that a coach writing a twelve-week block does constantly were
// missing from that list, and both had the same workaround: retype the session.
//
//   · DUPLICATE THE WEEK I AM LOOKING AT. Add Week copies the last one, so a
//     coach on week two who wants week six to be week two again has to add a
//     week — getting a copy of week five — and then rewrite every day of it by
//     hand. A twelve-week block written as 3 × (heavy, heavy, deload) is the
//     ordinary shape of a sold block and it was four weeks of retyping.
//
//   · MOVE A WEEK. Periodisation is decided by where the light week falls, and
//     a coach who wants the deload at four rather than three had no way to say
//     so: the strip is positional and there is no drag, no cut, no paste. The
//     only route was to retype two weeks into each other.
//
// Both are pure list edits and they are here rather than in the screen for the
// reason src/lib/setRows.ts gives for the same shape: an off-by-one in the
// index that comes back leaves the coach editing a week they are not looking
// at, which is silent, and a screen is not where that gets asserted.
//
// ── Why these do NOT go through src/lib/programBlock.ts ────────────────────
//
// `addWeek` and `removeWeek` there work on a stored `Program` and hold the
// invariant that `weeks[0].days` IS `days`. The builder does not hold a
// `Program` while it is being edited — it holds its own week list whose
// exercises carry a draft key and the unit the coach typed in — and
// round-tripping that through `composeProgram` to move a week would apply
// every one of its rewritings to a week the coach had not touched.
//
// So these are generic over the element type and know nothing about it. What
// they DO know is the one thing a screen must not get wrong: which index the
// coach should be looking at afterwards, and whether the edit changed WEEK ONE,
// which is the week the client is actually training.
//
// ── The overview ──────────────────────────────────────────────────────────
//
// A twelve-week block is twelve taps and twelve scrolls away from being read.
// `blockOverview` is the whole block as one list — how many days, how many
// movements, which are deloads, and which are byte-identical to the week before
// them. That last flag is the one worth having: Add Week copies the previous
// week, so a coach who added six and edited two has four duplicates in a block
// they are about to sell, and nothing on the screen said so.
//
// Pure and framework-free. Nothing here reads a clock, a locale or a currency.
import { weekLabel } from './programBlock';

/** The little of an exercise that changes the shape of a week. */
export interface PlanExercise { name: string; sets: number; reps: string }

/** One training day, as both the builder and a stored programme have one. */
export interface PlanDay {
  day: string;
  focus?: string;
  cardio?: string;
  exercises: readonly PlanExercise[];
}

/** One week of a block. Structural on purpose: the builder's own week carries
 *  draft keys and a typed unit, and neither is any of this file's business. */
export interface PlanWeek {
  days: readonly PlanDay[];
  label?: string;
  deload?: boolean;
}

/** One line of the block overview. */
export interface WeekLine {
  /** 1-based, because it is the number a person reads. */
  n: number;
  /** The coach's own label, or the position, via `weekLabel`. */
  label: string;
  deload: boolean;
  days: number;
  exercises: number;
  /** No training days at all. Its own flag: a client on this block trains
   *  nothing that week, and it is invisible from the week strip. */
  empty: boolean;
  /**
   * Identical to the week before it, day for day and movement for movement.
   *
   * Not a fault. Add Week copies the previous week on purpose, and a block that
   * repeats a week is a block a coach wrote. It is here because it is the one
   * thing about a twelve-week block that cannot be seen without opening every
   * week, and a coach who meant to edit week seven wants to know they did not.
   *
   * Always false for week one, which has nothing before it.
   */
  sameAsPrevious: boolean;
  /** The line under the label. Sentence-shaped, never a bare number. */
  detail: string;
}

/**
 * What a week contains, reduced to the things that make two weeks different.
 *
 * The same fields `daySignature` in src/lib/groupProgram.ts compares, and for
 * the same reason: two weeks with the same sessions and different prose are the
 * same week's training. The label and the deload flag are deliberately OUT of
 * it — a coach who marks week four a deload and changes nothing else has not
 * written a different week, they have named the one they wrote.
 */
function weekFingerprint(w: PlanWeek | null | undefined): string {
  return (w?.days ?? []).map((d) => [
    String(d?.day ?? ''),
    String(d?.focus ?? '').trim().toLowerCase(),
    String(d?.cardio ?? '').trim().toLowerCase(),
    (d?.exercises ?? []).map((e) =>
      `${String(e?.name ?? '').trim().toLowerCase()}|${e?.sets}|${String(e?.reps ?? '').trim().toLowerCase()}`,
    ).join(','),
  ].join('~')).join('//');
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The whole block, one line per week.
 *
 * An empty list in gives an empty list out rather than a line about a week that
 * is not there — a builder that has been cleared has no block, and a row
 * reading "Week 1 · no training days" over a screen the coach has only just
 * opened is a complaint about work they have not started.
 */
export function blockOverview(weeks: readonly PlanWeek[] | null | undefined): WeekLine[] {
  const list = Array.isArray(weeks) ? weeks : [];
  let prev: string | null = null;
  return list.map((w, i) => {
    const days = (w?.days ?? []).length;
    const exercises = (w?.days ?? []).reduce((a: number, d: PlanDay) => a + (d?.exercises ?? []).length, 0);
    const sig = weekFingerprint(w);
    const sameAsPrevious = i > 0 && prev !== null && sig === prev && days > 0;
    prev = sig;
    return {
      n: i + 1,
      label: weekLabel(w, i + 1),
      deload: !!w?.deload,
      days,
      exercises,
      empty: days === 0,
      sameAsPrevious,
      detail: days === 0
        ? 'No training days in it yet.'
        : `${plural(days, 'day', 'days')} · ${plural(exercises, 'movement', 'movements')}`,
    };
  });
}

/**
 * What is wrong with this block, in the coach's own words, or an empty list.
 *
 * ONE thing is reported and it is the one that is invisible: a week with no
 * training days in it. It reaches a client as a week of nothing, it cannot be
 * seen from the week strip, and it is what a coach gets by adding a week onto
 * an empty week one and then filling week one in.
 *
 * A one-week programme is never reported on. A coach who has just opened the
 * builder has an empty week one, and telling them their block has a hole in it
 * before they have written anything is a screen shouting at somebody for not
 * having started.
 */
export function blockWarnings(weeks: readonly PlanWeek[] | null | undefined): string[] {
  const list = Array.isArray(weeks) ? weeks : [];
  if (list.length < 2) return [];
  const empties = blockOverview(list).filter((w) => w.empty);
  if (!empties.length) return [];
  const names = empties.map((w) => w.label);
  const which = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return [
    names.length === 1
      ? `${which} has no training days in it. Anybody on this block trains nothing that week.`
      : `${which} have no training days in them. Anybody on this block trains nothing in those weeks.`,
  ];
}

/** Where a week edit leaves the coach, and what it did to week one. */
export interface WeekEdit<T> {
  weeks: T[];
  /** The week the screen should select afterwards, 0-based. */
  index: number;
  /**
   * Whether this edit changed WEEK ONE — the week the client is training.
   *
   * A screen has to be able to say so before it happens. Every other week in a
   * block is stored and edited; week one is the one that goes onto somebody's
   * phone the next time the programme is assigned, and moving a week into or
   * out of position one is a different act from reordering weeks five and six.
   */
  movedWeekOne: boolean;
}

/**
 * Move the week at `from` to position `to`.
 *
 * Null when nothing would change — out of range, the same position, or a list
 * too short to reorder. A caller that got a new array back for a no-op would
 * redraw the strip and re-fold every day for nothing, and a `null` is the
 * honest answer to "did this do anything".
 *
 * The coach follows the week they moved, which is what makes this usable: they
 * moved it in order to look at it where it now is.
 */
export function moveWeek<T>(weeks: readonly T[], from: number, to: number): WeekEdit<T> | null {
  const list = Array.isArray(weeks) ? weeks : [];
  if (list.length < 2) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from >= list.length) return null;
  if (to < 0 || to >= list.length) return null;
  if (from === to) return null;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { weeks: next, index: to, movedWeekOne: from === 0 || to === 0 };
}

/**
 * Copy the week at `at`, and put the copy directly after it.
 *
 * `clone` is the caller's, and it is not optional. The builder's exercises are
 * matched by a draft key that every list, every drag handler and every
 * per-field draft on that screen keys off — two weeks sharing one would make
 * typing into the copy edit the original — and this file has no business
 * knowing that. The same reasoning the builder's own Add Week writes out.
 *
 * Directly AFTER rather than at the end, because the copy is a copy of THAT
 * week: a coach duplicating week two to make week three is describing an order,
 * and appending it to the end of an eight-week block would be a different edit
 * that they would then have to undo by moving it seven places.
 *
 * Null when the block is already at `max`. Refused rather than silently
 * dropping the last week: a ceiling that ate a week would be a coach's work
 * disappearing to make room for a copy of another week.
 */
export function duplicateWeek<T>(
  weeks: readonly T[],
  at: number,
  clone: (week: T) => T,
  max: number,
): WeekEdit<T> | null {
  const list = Array.isArray(weeks) ? weeks : [];
  if (!Number.isInteger(at) || at < 0 || at >= list.length) return null;
  if (!Number.isFinite(max) || list.length >= max) return null;
  const next = list.slice();
  next.splice(at + 1, 0, clone(list[at]));
  // Never week one. The copy lands at `at + 1` and everything before it keeps
  // its position, so what the client trains is untouched by construction.
  return { weeks: next, index: at + 1, movedWeekOne: false };
}

/**
 * The sentence to put in front of a coach before a week edit lands, or null
 * when there is nothing to warn about.
 *
 * Only for the edit that reaches somebody else. Moving weeks five and six past
 * each other changes a stored plan and nothing a client can see; moving a week
 * into or out of position one changes what they will be given the next time
 * this programme is assigned, and the builder's own Remove This Week already
 * makes exactly that distinction in exactly this voice.
 */
export function weekEditWarning(edit: WeekEdit<unknown> | null): string | null {
  if (!edit || !edit.movedWeekOne) return null;
  return 'Week one is the week a client trains. This moves a different week into that position, and it is what they will see the next time you assign this — nothing changes for anybody already on it until you do.';
}
