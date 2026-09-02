// What the three new outbox kinds carry, and the one expiry among them.
//
// ── Why these three, and why they are not the exclusions ──────────────────
//
// `src/lib/outbox.ts` names four kinds of write that are deliberately left to
// fail immediately — a booking, a cancellation, spending money, and anything
// carrying a file — and closes with the rule that admits the rest:
//
//     "Everything left is a write about the member's own record that says the
//      same thing whenever it lands."
//
// A goal, a planned day and a typed blood sugar reading all pass it, and all
// three had no queue. None is scarce: nobody else can take the member's goal.
// None is priced. None carries a file. And none of the three means anything
// different for having waited — a goal set on Tuesday is the same goal on
// Thursday, and a reading carries the moment it was taken rather than the
// moment it was sent, exactly as a measurement does.
//
// `src/lib/crashQueue.ts` is the other side of the same argument and worth
// reading beside this: a crash report is deliberately NOT an outbox kind
// because it is a write about US rather than about the member, so the member-
// facing sentences the outbox draws are wrong for it. These three are the
// opposite case in every particular — they are the member's own record, they
// belong in the member's own sentence, and "1 goal saved on this phone and not
// sent yet" is exactly the right thing to put in front of the person who typed
// it.
//
// ── The one that expires, and why it is the only one ──────────────────────
//
// `src/lib/dayPlan.ts` · `canPlan` refuses to mark a date that has already
// gone, and states why: "Marking last Tuesday as a rest day is not a plan, it
// is a claim about what happened, and this table is not the place a claim about
// the past gets to live." An intent to mark Tuesday that surfaces on Wednesday
// is exactly that claim, arriving through the back door. So a day-plan intent
// carries an expiry of its own day and `partitionLapsed` takes it out rather
// than sending it — and `lapsedNote('day-plan')` tells the member their planned
// day did not go, which is the one outcome they cannot see for themselves.
//
// A goal and a reading have no such moment. A goal is about a future the member
// still wants; a reading carries its own `taken_at` and is filed on the day it
// was taken however late it lands. Giving either an expiry would be discarding
// somebody's own record on a timer for no reason.
//
// Pure, so every shape here is assertable under `npm test` with no device and
// no network. The writes themselves are in src/ui/recordOutbox.ts, and each
// screen's enqueue is in the provider that owns its rows.
import { isPlannedDayType, type PlannedDayType } from './dayPlan';
import { dateParts } from './localDate';

/* ── the goal ──────────────────────────────────────────────────────────── */

/**
 * A goal the member set with no signal.
 *
 * `kind` is deliberately the string off `GoalKind` rather than the type: this
 * payload has been through JSON and a build that does not recognise the kind
 * must be able to say so rather than assert it. `asGoalIntent` is where that
 * check happens.
 *
 * There is no `id`. That is the shape of the thing and not an omission — an
 * intent that named a row would be an intent that could only be replayed while
 * that row still existed, and the member queued this offline precisely because
 * nothing on the server had been reached. The handler resolves "my goal of this
 * kind" against the server at the moment it lands, which is also what makes the
 * write idempotent: replaying "my weight goal is 78" twice leaves one goal.
 */
export interface GoalIntent {
  kind: string;
  /** The number aimed at, in the metric's own unit. Null for a custom goal. */
  value: number | null;
  /** The member's own words. Null for a measured goal. */
  title: string | null;
  /** Bare `YYYY-MM-DD`, or null for a goal with no date on it. */
  targetDate: string | null;
}

const asDate = (v: unknown): string | null =>
  typeof v === 'string' && dateParts(v.slice(0, 10)) ? v.slice(0, 10) : null;

/**
 * A stored goal intent, or null.
 *
 * Null is what makes the handler answer 'refused' and take the item OUT, rather
 * than retrying a payload nothing can ever send on every reconnect for the life
 * of the install. So the checks here are the difference between a queue that
 * drains and one that shows "1 goal waiting" for ever.
 */
export function asGoalIntent(p: unknown): GoalIntent | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const kind = typeof o.kind === 'string' ? o.kind : '';
  if (!kind) return null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
  const value = typeof o.value === 'number' && Number.isFinite(o.value) && o.value > 0 ? o.value : null;
  // A custom goal is its words and a measured goal is its number. Neither can be
  // written without the half that makes it a goal, and an insert of the empty
  // one would be a row on the member's list saying nothing.
  if (kind === 'custom' ? !title : value == null) return null;
  return { kind, value, title, targetDate: asDate(o.targetDate) };
}

/* ── the planned day ───────────────────────────────────────────────────── */

/**
 * A day the member marked, or unmarked, with no signal.
 *
 * `type` null means "take the mark off this day". Carried as one kind rather
 * than two because they are one thing to the member and one row to the server —
 * and because two kinds would mean two lines on the dashboard for a member who
 * marked a day and changed their mind about it.
 */
export interface DayPlanIntent {
  /** Bare `YYYY-MM-DD`. A calendar day, not an instant. */
  dateISO: string;
  type: PlannedDayType | null;
  note: string | null;
  /** True when the intent is to remove the mark rather than to set one. Explicit
   *  rather than inferred from a null `type`, so a payload that lost its type in
   *  transit cannot silently become a deletion of the member's plan. */
  remove: boolean;
}

export function asDayPlanIntent(p: unknown): DayPlanIntent | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const dateISO = asDate(o.dateISO);
  if (!dateISO) return null;
  const remove = o.remove === true;
  if (remove) return { dateISO, type: null, note: null, remove: true };
  // A type this build does not recognise is refused rather than defaulted.
  // Coercing it to 'off' would write a Standard day where the member marked
  // something else — the app inventing somebody's plan, which is the rule
  // src/lib/plannedDays.ts already keeps on the way in.
  if (!isPlannedDayType(o.type)) return null;
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null;
  return { dateISO, type: (o.type as PlannedDayType), note, remove: false };
}

/**
 * When a day-plan intent stops meaning anything: the end of the day it is about.
 *
 * Local, and built from the parts rather than from `Date.parse`, for the reason
 * src/lib/dayPlan.ts gives at length — a bare date parsed as UTC is the previous
 * day west of Greenwich and the next one in Auckland, and this value decides
 * whether somebody's plan is sent or discarded.
 *
 * The boundary is the END of the day rather than its start, so an intent queued
 * on Tuesday morning and flushed on Tuesday evening still lands: the plan is
 * about a day that is still running, and `canPlan` would still accept it.
 *
 * Null when the date will not parse. Null means "no expiry", which is
 * `partitionLapsed`'s tolerant reading — and it is the right one here too: the
 * intent will be refused by `asDayPlanIntent` on the way out and dropped
 * cleanly, rather than being quietly discarded on the strength of a string this
 * function failed to read.
 */
export function planExpiry(dateISO: string): string | null {
  const p = dateParts(dateISO);
  if (!p) return null;
  // 00:00 the following day, local. Constructing the next day by adding one to
  // the day-of-month is safe: Date normalises 32 January into 1 February, and
  // month ends and leap years come out of that for free.
  return new Date(p[0], p[1], p[2] + 1, 0, 0, 0, 0).toISOString();
}

/* ── the blood sugar reading ───────────────────────────────────────────── */

/**
 * One reading the member typed with no signal. mmol/L.
 *
 * `at` is when the reading was TAKEN, not when it is sent — the same rule the
 * measurement queue keeps, and it matters more here: these go on a chart against
 * meals, and a reading that slides to its send time is a spike attributed to the
 * wrong lunch.
 *
 * Only a typed reading is ever queued. An import off the phone's health store is
 * not in here and does not need to be: `importFromHealth` re-reads the store and
 * drops anything already saved by `external_id`, so the honest retry for a
 * failed import is to run it again, not to replay a batch assembled from a
 * window that has since moved.
 */
export interface GlucoseIntent {
  mmol: number;
  at: string;
}

export function asGlucoseIntent(p: unknown): GlucoseIntent | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const mmol = typeof o.mmol === 'number' && Number.isFinite(o.mmol) && o.mmol > 0 ? o.mmol : null;
  const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? o.at : null;
  if (mmol == null || at == null) return null;
  return { mmol, at };
}

/* ── what the member is told when one of these is kept ─────────────────── */

/**
 * The line a screen says at the moment it queues one of these.
 *
 * Deliberately the same promise as `outboxNote` and `unsentNote`, in the same
 * shape, because a member should not have to learn a third vocabulary for the
 * same situation — and because the delicate part is identical: the work is NOT
 * lost, it has NOT been stored, and the screen it belongs on will not show it
 * until it has.
 */
export function keptOnPhoneNote(noun: string): string {
  return `Your ${noun} is saved on this phone and not sent yet — it goes up next time you have signal, and it won’t show up here until it has.`;
}

/**
 * The line for a write that could not even be kept.
 *
 * `enqueue` answers 'full' when the device is holding as much as it will hold
 * and 'unavailable' when there is no account to key an outbox by or this
 * device's outbox could not be read. Two different situations, one thing the
 * member needs to know: nothing was kept, so nothing is coming.
 */
export function notKeptNote(noun: string, why: 'full' | 'unavailable'): string {
  return why === 'full'
    ? `Your ${noun} was not saved. This phone is already holding as much unsent work as it will hold — get some signal so what is waiting can go up, then try again.`
    : `Your ${noun} was not saved and is not waiting to send. Nothing was kept, so try again once you have signal.`;
}
