// Logging a meal to a day that is not today — and the day's meal slots.
//
// Two things the food log has never been able to say. They are in one file
// because they are the same sentence from two directions: WHEN did you eat it,
// and WHICH MEAL was it. Neither is derivable from the other and neither is
// derivable from the clock.
//
// ── 1. THE MEAL YOU FORGOT TO LOG ─────────────────────────────────────────
//
// `logFood` in src/ui/foodLog.tsx stamped every row `new Date().toISOString()`
// and had no other option, so a member who forgot to log dinner had no way to
// add it in the morning. The correction sheet in app/(client)/foodlog.tsx says
// so out loud — "It stays on today" — which is the right sentence about an
// EDIT and was, until this file, also the whole truth about an insert.
//
// `food_logs.logged_at` is a `timestamptz` and always has been (part 01), so
// nothing in the database was ever in the way. What was in the way is the two
// decisions below, both of which had to be made before a back-dated row could
// be written safely.
//
// ══ THE DECISION: a back-dated row NEVER LAPSES ════════════════════════════
//
// src/lib/outbox.ts holds the opposite rule for a different thing, and the
// difference is the whole point of writing this down.
//
// An outbox item may carry `expiresAt`. `partitionLapsed` takes those items OUT
// of the queue rather than sending them, and `lapsedNote` tells the member: "A
// planned day was waiting to send for too long, so it was not sent." The kind
// that actually uses it is `day-plan`. That is correct, and the reason is that
// a day plan is an INTENT ABOUT A FUTURE DAY. A member marks next Tuesday as a
// rest day; Tuesday passes unsent; sending it on Wednesday would write a plan
// for a day nobody can now live differently, and would show the member a plan
// they would read as having been in force. Its truth decayed. It is dropped,
// and they are told, because the alternative is a silent lie about Tuesday.
//
// A back-dated food row is the OPPOSITE KIND OF THING, and takes the opposite
// rule: it never expires, it is queued for as long as it takes, and it is sent
// however late it arrives.
//
//   · It is a RECORD, not an intent. "I ate a chicken wrap at lunch on
//     Tuesday" was true on Tuesday and is exactly as true a fortnight later.
//     Nothing about it is contingent on arriving in time, because there is
//     nothing left for anyone to do about it. Lateness changes an intent's
//     meaning; it cannot touch a record's.
//
//   · It carries its own day. `food_logs.logged_at` is written from the entry,
//     never from the clock at send time — `FoodEntry.at` in src/ui/foodLog.tsx
//     exists for precisely this and its docstring says so. A day plan queued
//     past its date has nowhere honest to land. A food row queued past its date
//     lands exactly where it always meant to.
//
//   · The rule already exists here, in the other direction. `staleForDay` in
//     src/lib/offlineQueue.ts finds the unsent entries from OTHER days and
//     returns them so they can be sent, with the docstring "dropping them is
//     the work loss this whole file exists to prevent". A back-dated row is
//     born into exactly that state. Giving it an expiry would mean the food log
//     dropped rows that `staleForDay` was written to save, which is one file
//     contradicting its neighbour about the same row.
//
//   · And the decisive one: applying the day-plan rule here does not make the
//     feature strict, it makes it IMPOSSIBLE. A day-plan's expiry is derived
//     from the date it is FOR, and a back-dated row's date is in the past by
//     construction. Every back-dated row would be born already lapsed and
//     dropped at the first `partitionLapsed`, having never been offered to the
//     server once. A rule that refuses one hundred per cent of the cases it is
//     applied to is not a policy, it is a deletion.
//
// So: no `expiresAt`, no `OutboxKind`, and no route through `outbox.ts` at all.
// A back-dated row goes into the same `owedRef` queue the food log already
// keeps for yesterday's unsent dinner, and it is retried on every launch,
// reconnect and foreground until the server either takes it or REFUSES it.
// Refusal is still the one outcome that drops the row — see `classifyWrite`;
// a row the constraint declines will be declined identically forever, and
// retrying it until the heat death of the phone is the bug this queue already
// fixed once.
//
// What a member is told is the part that has to match. A lapsed day plan gets
// `lapsedNote`: it did not happen, do it again. A queued back-dated meal gets
// `unsentNote`: it is saved, it is going, nobody needs to do anything. Those
// are different sentences because they are different facts, and the failure
// mode this codebase keeps recording is one being said where the other is true.
//
// ══ THE SECOND DECISION: noon, and never a boundary ════════════════════════
//
// A member picks a DAY. They are not asked for a time and must not be given
// one they did not state — the same refusal this file makes about meal slots
// below. So a back-dated row is stamped at 12:00 LOCAL on the chosen day.
//
// Noon rather than midnight or 23:59, and the reason is the one this lane is
// full of. Every reader of this row recomputes its day with `dayOf`, on a
// device whose zone, DST offset and clock may all differ from the device that
// wrote it. Midnight is zero minutes from the boundary and 23:59 is one; an
// hour of DST, a stale zone database or a phone clock a few minutes out tips
// either of them into the neighbouring day, and the meal lands in a day the
// member did not choose and eats calories out of it. Noon is twelve hours from
// either boundary. No offset this app will ever meet can move it.
//
// Today is NOT stamped at noon. Picking today means "now", `logFood` writes the
// actual instant exactly as it always has, and nothing about the ordinary path
// changes — which is deliberate: the overwhelmingly common case must not start
// behaving differently because a rarely used control exists beside it.
//
// ── 2. BREAKFAST, LUNCH, DINNER — AND THE ONES WE WERE NEVER TOLD ─────────
//
// The day is a flat list under "Logged Today". Every food app a member has
// used before this one groups it into meals with a subtotal each.
//
// A slot is a fact about the member's day and `food_logs` has never held one,
// so it is being ADDED as a nullable column (see the part file that accompanies
// this file) and NULL means WE WERE NOT TOLD. Every row written before that
// column existed is NULL, and every one of them renders under "Not sorted".
//
// It would be one line to derive a slot from `logged_at` — under 11:00 is
// breakfast, and so on. That line would be the app inventing a fact about
// somebody's life. A night-shift nurse eating her main meal at 04:00, a member
// fasting until two, anyone in a country that eats at ten: the derivation is
// wrong about all of them and wrong silently, under a heading that says the
// member told us. `groupMeals` below therefore has no clock in it at all.
//
// ── What this file does NOT do ────────────────────────────────────────────
//
// It does not write anything and it holds no `meal` value into a query. The
// part file is deliberately unapplied, and naming a column that does not exist
// in a PostgREST select or insert is a 42703 — which `serverRows` reads as a
// failed read and `classifyWrite` reads as a refusal, i.e. it would take out
// the whole food log for every member to add a heading. The reading side here
// is written, tested and ready; the query is one line and is not written yet.
import { dayOf, todayKey } from './offlineQueue';

/* ── the day something was logged to ──────────────────────────────────── */

/** A bare local calendar day, `YYYY-MM-DD`. Fixed width, which is what makes
 *  `<` and `>` on two of them a correct calendar comparison — see `readLogDay`.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far back the picker goes.
 *
 * Fourteen because that is the window `useFoodHistory` reads and the "Recent
 * Days" section draws. A member can only back-date to a day they can still
 * open and check, which means a mistake is visible to the person who made it.
 * Offering a day the screen cannot show would put a row somewhere the member
 * has no way to look at, and this file's whole argument is that a row nobody
 * can see is the failure, not the fix.
 *
 * A product limit on the CONTROL, not a rule about the data. `food_logs` will
 * take any instant, an older row synced from another device is read back and
 * counted normally, and nothing here deletes anything for being old.
 */
export const MAX_BACKDATE_DAYS = 14;

/** Local noon. See the header: twelve hours from either day boundary, so no
 *  offset, DST shift or clock skew can move the row into the wrong day. */
export const BACKDATE_HOUR = 12;

/**
 * The days the picker offers, newest first, today at index 0.
 *
 * Rolled with `setDate`, which is calendar arithmetic rather than millisecond
 * arithmetic: subtracting 24 hours per step lands an hour out on the far side
 * of a DST change and eventually skips or repeats a day. `setDate(n - 1)` is
 * correct across every transition because the platform does the calendar.
 */
export function backdateDays(today: string, n: number = MAX_BACKDATE_DAYS): string[] {
  if (!DAY.test(today)) return [];
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, n); i++) {
    const at = new Date(y, m - 1, d);
    at.setDate(at.getDate() - i);
    out.push(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/**
 * What to call a day on a button.
 *
 * "Today" and "Yesterday" by name because that is what a person calls them and
 * a date beside the word "Today" is noise. Everything else gets a weekday and a
 * date, in the reader's own locale: "Tue 9 Sep" tells somebody which day they
 * are about to write to in the terms they remember eating in.
 *
 * The Date is built from the PARTS, never from `new Date('2026-09-09')` — that
 * literal is UTC midnight and reads as the previous day for every member west
 * of Greenwich, which is the defect scripts/check-utc-day.mjs exists to stop.
 */
export function dayLabel(day: string, today: string): string {
  if (!DAY.test(day)) return '';
  if (day === today) return 'Today';
  const back = backdateDays(today, 2);
  if (day === back[1]) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The long form, for a sentence rather than a button. */
export function dayLongLabel(day: string, today: string): string {
  if (!DAY.test(day)) return '';
  if (day === today) return 'today';
  const back = backdateDays(today, 2);
  if (day === back[1]) return 'yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export type LogDayRead =
  | { ok: true; at: string; backdated: boolean }
  | { ok: false; reason: string };

/**
 * The instant to stamp a row with, given the day the member picked.
 *
 * Refused rather than corrected in all four failure cases, because every
 * correction available here invents something. A day in the future cannot be
 * shifted to today without logging a meal against a day the member did not
 * choose; an unreadable day string cannot be guessed at.
 *
 * ── the comparisons are STRING comparisons, deliberately ──────────────────
 *
 * `day > today` and `day < oldest` compare two fixed-width `YYYY-MM-DD`
 * strings, which orders them exactly as calendar days and involves no Date at
 * all. The alternative — parsing each side — is where `new Date('2026-09-09')`
 * gets written, and that is UTC midnight, which is the previous day for most of
 * the world. src/lib/localDate.ts and scripts/check-utc-day.mjs both carry the
 * receipts for what that has already cost this codebase.
 *
 * `now` is a parameter with a default rather than a captured constant, so a
 * screen re-validates against the real clock at the moment of the tap. A member
 * who opened this screen at 23:58, picked "Today" and tapped Log at 00:01 must
 * not write yesterday's row under today's heading.
 */
export function readLogDay(day: string, now: Date = new Date()): LogDayRead {
  if (!DAY.test(day)) {
    return { ok: false, reason: 'We could not read that date, so nothing was logged. Pick a day from the list.' };
  }
  const today = todayKey(now);
  if (day > today) {
    return { ok: false, reason: 'You can’t log food to a day that hasn’t happened yet.' };
  }
  if (day === today) {
    // Unchanged behaviour, on purpose. Today means now.
    return { ok: true, at: now.toISOString(), backdated: false };
  }
  const window = backdateDays(today, MAX_BACKDATE_DAYS);
  const oldest = window[window.length - 1];
  if (day < oldest) {
    return {
      ok: false,
      reason: `You can log back as far as ${MAX_BACKDATE_DAYS} days, which is as far back as this screen can show you. ${dayLabel(day, today)} is further back than that.`,
    };
  }
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y, m - 1, d, BACKDATE_HOUR, 0, 0, 0);
  // Round-tripped rather than trusted. `new Date(2026, 1, 31)` is the 3rd of
  // March and reports no error whatsoever, so the only way to know the parts
  // named a real day is to read the day back off the instant they produced.
  if (!Number.isFinite(at.getTime()) || dayOf(at.toISOString(), now) !== day) {
    return { ok: false, reason: 'That isn’t a real date, so nothing was logged.' };
  }
  return { ok: true, at: at.toISOString(), backdated: true };
}

/** Whether an entry already in hand belongs to a day other than today. */
export function isBackdated(at: string, now: Date = new Date()): boolean {
  return dayOf(at, now) !== todayKey(now);
}

/**
 * What the member is told BEFORE they log, under the day picker.
 *
 * Null for today, so the ordinary case draws nothing. The sentence names the
 * day and states the consequence they would otherwise discover by looking at a
 * total that did not move: a back-dated meal does not touch today's figures.
 */
export function backdateNote(day: string, today: string): string | null {
  if (!DAY.test(day) || day === today) return null;
  return `This goes into ${dayLongLabel(day, today)}, not today. It won’t change today’s totals or the calories you have left.`;
}

/**
 * What the member is told AFTER a back-dated row has been accepted.
 *
 * Its own sentence because the one thing that can genuinely confuse somebody
 * here is a successful log that visibly changes nothing on the screen they are
 * looking at. "Nothing happened" and "it went somewhere else" look identical
 * from today's list.
 */
export function backdatedStoredNote(day: string, today: string): string {
  return `Added to ${dayLongLabel(day, today)}. Today’s list and today’s totals are unchanged. Look under Recent Days to see it.`;
}

/**
 * What the member is told when a back-dated row is on the phone and not yet
 * sent.
 *
 * This is the sentence the whole queue decision above is for, and it is the
 * NOT-LAPSED one: the meal is kept, it is going, and there is nothing to do
 * again. Compare `lapsedNote` in src/lib/outbox.ts, which says the opposite
 * about a day plan, for the reasons this file's header sets out.
 */
export function backdatedUnsentNote(day: string, today: string): string {
  return `Saved on this phone against ${dayLongLabel(day, today)}. No connection just now, so it isn’t in your food log on the server yet. It goes up on its own next time you have signal, and it keeps its own day when it does.`;
}

/* ── which meal it was ─────────────────────────────────────────────────── */

/** The four slots, in the order a day is eaten in. The same four, spelled the
 *  same way, as the CHECK constraint in the accompanying part file — a value
 *  here that is not there is a 23514, and a value there that is not here
 *  renders as its own raw code. */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * A slot off a row, or null.
 *
 * Null for absent, null for null, and null for anything unrecognised. All three
 * mean the same thing and it is a true thing: nobody told us which meal this
 * was. The unrecognised case matters most — a row written by a newer build, or
 * a column read back before the part is applied, must land in "Not sorted"
 * rather than being coerced into 'breakfast' by a default.
 */
export function readMealSlot(v: unknown): MealSlot | null {
  return typeof v === 'string' && (MEAL_SLOTS as readonly string[]).includes(v) ? (v as MealSlot) : null;
}

/** What a slot is called on a heading. NULL is "Not sorted", which says what is
 *  true — nobody said — rather than "Other", which sounds like a fifth meal. */
export function mealSlotLabel(slot: MealSlot | null): string {
  switch (slot) {
    case 'breakfast': return 'Breakfast';
    case 'lunch': return 'Lunch';
    case 'dinner': return 'Dinner';
    case 'snack': return 'Snacks';
    default: return 'Not sorted';
  }
}

/** The sentence under a "Not sorted" heading. It has to be clear that this is
 *  an absence of information and not a judgement about the food. */
export const UNSORTED_NOTE =
  'These were logged before meals were split up, or without a meal chosen. They still count toward the day in full.';

export interface MealTotals { kcal: number; protein: number; carbs: number; fat: number }
export interface MealGroup<T> extends MealTotals {
  slot: MealSlot | null;
  label: string;
  entries: T[];
}

/** The least a row needs to be grouped and subtotalled. `meal` optional, so a
 *  `FoodEntry` read back from a database without the column satisfies it. */
export interface Slotted extends MealTotals { meal?: MealSlot | null }

/**
 * The day split into meals, with a subtotal each.
 *
 * `grouped` is false when NOT ONE row carries a slot, and a caller that draws
 * the flat list in that case is doing the right thing: four headings over an
 * empty breakfast, an empty lunch and every meal of the day under "Not sorted"
 * is strictly worse than the list it replaced. It is what every existing row in
 * the table will produce, and what every row produces until the part is applied.
 *
 * Empty slots are ABSENT rather than present with zeros, for the reason
 * `FoodHistory.days` gives about empty days: a zero subtotal under "Lunch"
 * reads as "you ate nothing at lunch", and the true statement is that nothing
 * was logged under it. The one exception is that the slots that DO have rows
 * come back in `MEAL_SLOTS` order rather than in the order they happen to
 * appear, so the day reads in the order it was eaten in, with "Not sorted"
 * last — it is the group that is missing an answer, not the day's late meal.
 *
 * No clock anywhere in here. See the header.
 */
export function groupMeals<T extends Slotted>(entries: readonly T[]): { grouped: boolean; groups: MealGroup<T>[] } {
  const by = new Map<MealSlot | null, T[]>();
  let grouped = false;
  for (const e of entries) {
    const slot = readMealSlot(e.meal);
    if (slot) grouped = true;
    const held = by.get(slot);
    if (held) held.push(e); else by.set(slot, [e]);
  }
  const order: (MealSlot | null)[] = [...MEAL_SLOTS, null];
  const groups = order
    .filter((s) => by.has(s))
    .map((slot) => {
      const list = by.get(slot)!;
      return {
        slot,
        label: mealSlotLabel(slot),
        entries: list,
        kcal: list.reduce((a, e) => a + e.kcal, 0),
        protein: list.reduce((a, e) => a + e.protein, 0),
        carbs: list.reduce((a, e) => a + e.carbs, 0),
        fat: list.reduce((a, e) => a + e.fat, 0),
      };
    });
  return { grouped, groups };
}

/* ── the column this file has been bitten by twice ────────────────────── */

/** The four values `food_logs.via` will accept. */
export const LOG_VIA: readonly ['search', 'barcode', 'photo', 'manual'] = ['search', 'barcode', 'photo', 'manual'];
export type LogViaValue = (typeof LOG_VIA)[number];

/**
 * Whether a value is one `food_logs.via` will take.
 *
 * Exported because this exact column has been violated twice — an AI-described
 * meal sent as 'ai', refused by the CHECK, and shown to the member as logged
 * both times (src/ui/foodLog.tsx and app/(client)/foodlog.tsx each record it).
 * A guard is not a fix for that on its own; what stops it is that a caller with
 * a guard available has no reason left to write `via: x as any`, which is the
 * cast that silenced the compiler on exactly this column.
 */
export function isLogVia(v: unknown): v is LogViaValue {
  return typeof v === 'string' && (LOG_VIA as readonly string[]).includes(v);
}
