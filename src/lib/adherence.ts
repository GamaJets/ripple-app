// What a coach can honestly say about a client's ticks — and what they cannot.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `coach_checklist_items` (part 58) let a coach put a line on one client's
// daily list. The client ticks it and the tick becomes a row in `habit_logs`
// keyed (user_id, habit, done_on). Nothing on the coach side read that table —
// the permission has existed since 02-domain-schema.sql (`habit_logs_coach_read`,
// `for select using (is_my_client(user_id))`) and no query in the product used
// it. A coach set an item and it went silent.
//
// ── The window: 28 days ────────────────────────────────────────────────────
//
// Four whole weeks, ending YESTERDAY. Three decisions, each of which changes
// what the coach is looking at:
//
//   · Four weeks rather than one. A week contains exactly one Tuesday, so a
//     line the client keeps missing on Tuesdays is a one-in-seven sample and
//     the difference between 4/7 and 5/7 is a single day of noise. Four weeks
//     contains four of every weekday, so a day-of-week pattern shows up as a
//     pattern rather than as an accident.
//   · Four weeks rather than a quarter. The point of looking is to notice a
//     change while it is still worth a conversation. Ninety days of history
//     averages a fortnight of slipping into eleven weeks of doing fine, and
//     the figure a coach reads is at its most confident exactly when it is
//     least useful.
//   · Ending yesterday, not today. Today is not over. A line unticked at 9am
//     is not a line missed, and letting today into the denominator means the
//     figure is worst first thing in the morning and recovers by bedtime,
//     which is a property of the clock rather than of the client.
//
// The window is also small enough to be read whole: 28 days times a list of
// twenty coach items plus half a dozen derived ones is under 750 rows, inside
// PostgREST's 1000-row default. "Under it" is not "guaranteed under it", so
// the caller still reads with `capLimit()` and a truncated read produces NO
// figures at all rather than a fraction of one — see src/lib/rowCap.ts.
//
// ── The hard part: an unticked box is not a failure ────────────────────────
//
// Everything below exists to keep this module from making a claim the record
// cannot support. An empty (item, day) cell has at least four causes:
//
//   1. the client saw the line and did not do it — a genuine miss;
//   2. they did it and did not open the app to say so;
//   3. the line was not on their list that day (a coach adds an item on
//      Thursday; Monday to Wednesday were never theirs to miss);
//   4. the coach took the line off, and the days after that are not the
//      client's to answer for either.
//
// 3 and 4 are removable from the arithmetic, and are: `created_at` bounds how
// far back an item could possibly have been ticked, and `active = false` means
// the line is off the list. 1 and 2 are NOT separable in general — but they
// partly are, because a day on which the client ticked ANYTHING is a day they
// were in the app. So a day with other ticks and not this one is a real miss,
// and a day with no ticks at all is genuinely unknown. This module counts those
// two separately and never merges them, because merging them is precisely how a
// percentage comes to mean "this person let you down" when what it records is
// that their phone was in a drawer.
//
// ── Why the evidence of app use is ticks, and only ticks ───────────────────
//
// A coach can read more than this about their client: `workouts`,
// `measurements` and `check_ins` all carry the same `is_my_client` grant, and
// a workout logged on a silent day is also evidence the client had the app
// open. Widening the evidence was considered and rejected, because of which
// direction it moves the days. Every extra source can only take a day OUT of
// "nobody knows" and put it into "they saw the line and left it" — and the
// step from "they logged a workout that evening" to "they were looking at
// their checklist" is an inference, not a record. Ticks are not an inference:
// a tick against any line on the list is that person standing in front of the
// list. So the miss column is built from the one source that cannot be argued
// with, and the doubt stays in the unknown column where a coach can see it.
//
// ── Why a coach-set item and a derived item get different treatment ────────
//
// Both are on the client's list and both tick into the same table, but only one
// of them has a record of WHEN IT WAS ON THE LIST. A coach item has a row, with
// a created_at and an active flag. A derived item — 'water', 'protein',
// 'train' — has no row anywhere: the client's app rebuilds that list every
// morning out of targets, goals and the day their plan schedules, all of which
// change, and none of which is written down per day. 'train' is on the list
// only on training days. 'steps' did not exist before the client set a step
// goal. The coach's app cannot know which days those lines were even present,
// so there is no denominator to divide by and this module does not invent one:
// derived items come back as a COUNT of ticks and a last-ticked date, never a
// rate. That is also the honest description of the coach's relationship to
// them — they did not set those lines and are not owed a score against them.
import { dateParts } from './localDate';

/** Four whole weeks. See the header for why not seven days and not ninety. */
export const WINDOW_DAYS = 28;

/** Coach items are namespaced in the tick id space. Mirrors COACH_ID_PREFIX in
 *  src/lib/checklist.ts, which is what the client's app writes. */
export const COACH_TICK_PREFIX = 'coach:';

/** A run of complete calendar days, inclusive at both ends, as YYYY-MM-DD. */
export interface DayWindow { start: string; end: string; days: number }

/** One row of `habit_logs` as the coach reads it. */
export interface TickRow { habit: string; done_on: string }

/** One row of `coach_checklist_items`, as the coach's own screen holds it. */
export interface ChecklistRow {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  created_at: string;
  /** Stamped by a trigger on EVERY update — a rename and a reorder move it too,
   *  so it is not the day an item was retired. See `noRate: 'retired'`. */
  updated_at: string;
}

/** Why an item has no denominator. Null when it has one. */
export type NoRate =
  /** Off the list, and the record cannot date when it came off. */
  | 'retired'
  /** Added after the last complete day, so no day has passed under it yet. */
  | 'too-new'
  /** No readable created_at, so how far back it could have been ticked is not
   *  known. The column is `not null default now()`, so this should be
   *  unreachable — and a denominator assumed rather than read is exactly the
   *  kind of thing that stays wrong quietly, so it is named instead. */
  | 'undated';

export interface SetItemAdherence {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  /** Days in the window this line was on their list. Null when unknowable. */
  eligibleDays: number | null;
  /** Ticks on those days. A true count in every case, including under a null
   *  denominator — a count of ticks is a fact even when a rate is not. */
  ticked: number;
  /** Eligible days with no tick of ANYTHING: the client may not have opened the
   *  app. Null alongside a null denominator. */
  silentDays: number | null;
  /** Eligible days on which they ticked something else and not this. The only
   *  bucket this module is willing to call a miss. */
  skippedDays: number | null;
  /** First day of the window this item was on their list, or null. */
  from: string | null;
  /** Most recent day in the window it was ticked, or null for none. */
  lastTicked: string | null;
  noRate: NoRate | null;
}

export interface DerivedAdherence {
  /** The tick id — 'water', 'protein'. Not a row id; nothing stores these. */
  id: string;
  label: string;
  /** Days in the window it was ticked. Deliberately not out of anything. */
  ticked: number;
  lastTicked: string | null;
}

export interface AdherenceSummary {
  window: DayWindow;
  /** The coach's own items, in the order they were handed in. */
  set: SetItemAdherence[];
  /** Everything ticked that is not a coach item, most-ticked first. Discovered
   *  from the ticks, because the coach's app has no other sight of them. */
  derived: DerivedAdherence[];
  /** Days in the window with at least one tick of anything: hard evidence the
   *  client was in the app. */
  seenDays: number;
  /** Days in the window with no tick of anything at all. Not "days they did
   *  nothing" — days the record is silent about. */
  silentDays: number;
  /** Ticks against 'coach:' ids with no row behind them any more. A deleted
   *  item takes the meaning of its history with it, which is why the app's own
   *  remove path deactivates instead (part 58). */
  deletedLineTicks: number;
}

/** Local YYYY-MM-DD for a Date. Local, because `done_on` is a calendar day in
 *  the client's own life and toISOString() would shift it west of Greenwich —
 *  the whole subject of src/lib/localDate.ts. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The calendar day a timestamptz falls on, read locally, or null. */
export function dayOf(iso: string | null | undefined): string | null {
  const p = dateParts(iso);
  return p ? dayKey(new Date(p[0], p[1], p[2])) : null;
}

/**
 * The `days` complete days ending yesterday.
 *
 * Built by stepping a Date rather than by subtracting milliseconds, so the two
 * days a year that are 23 or 25 hours long do not shorten or lengthen the
 * window under the coach's feet.
 */
export function recentWindow(now: Date = new Date(), days: number = WINDOW_DAYS): DayWindow {
  const n = Math.max(1, Math.floor(days));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (n - 1));
  return { start: dayKey(start), end: dayKey(end), days: n };
}

/** Every day in the window, ascending. Cheap at 28 and it keeps the day
 *  arithmetic in one place rather than in three counting loops. */
function daysOf(w: DayWindow): string[] {
  const p = dateParts(w.start);
  if (!p) return [];
  const out: string[] = [];
  for (let i = 0; i < w.days; i++) out.push(dayKey(new Date(p[0], p[1], p[2] + i)));
  return out;
}

/** Ids the client's app derives rather than the coach setting them. Kept as a
 *  lookup rather than a whitelist: an id this map does not know still appears,
 *  under its own id, because a line the coach cannot name is better than a line
 *  they cannot see. The ids are buildChecklist's, in src/lib/checklist.ts. */
const DERIVED_LABEL: Record<string, string> = {
  train: 'Train — the session their plan schedules',
  kcal: 'Their calorie target',
  protein: 'Their protein target',
  water: 'Water',
  steps: 'Their step goal',
  sleep: 'Their sleep goal',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A window's end date as "29 Aug", for a section heading.
 *
 * Built from the parts rather than through toLocaleDateString for the reason
 * src/lib/localDate.ts exists: `new Date('2026-08-29')` is UTC midnight, and
 * every local getter reads it back a day earlier west of Greenwich — so a coach
 * in New York would be told the window ends the day before the one it was
 * actually counted over. Deterministic for the same reason `thousands()` in
 * checklist.ts is: the string is asserted in tests and rendered in every locale
 * the app ships to.
 */
export function dayLabel(day: string): string {
  const p = dateParts(day);
  return p ? `${p[2]} ${MONTHS[p[1]]}` : '—';
}

export interface AdherenceInput {
  window: DayWindow;
  /** `habit_logs` rows for this client. Rows outside the window are ignored
   *  here rather than trusted to have been filtered by the query. */
  ticks: readonly TickRow[];
  /** The coach's own list for this client, active and inactive both. */
  items: readonly ChecklistRow[];
}

/**
 * What the record supports about one client's list over one window.
 *
 * Pure. Every hole in the data comes out as a null or a named reason rather
 * than as a zero, because a zero here is a specific and damaging claim: that
 * somebody did nothing.
 */
export function summariseAdherence(input: AdherenceInput): AdherenceSummary {
  const w = input.window;
  const all = daysOf(w);
  const inWindow = (d: string) => d >= w.start && d <= w.end;

  // Deduped: the unique constraint on (user_id, habit, done_on) should make
  // this impossible, but a count that double-counts a repeated row is a count
  // that can exceed its own denominator, and "impossible" is not a guarantee
  // this function gets to rely on when it is handed an array.
  const byHabit = new Map<string, Set<string>>();
  const anyTickDays = new Set<string>();
  for (const r of input.ticks) {
    const habit = String(r?.habit ?? '');
    const day = String(r?.done_on ?? '').slice(0, 10);
    if (!habit || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !inWindow(day)) continue;
    let s = byHabit.get(habit);
    if (!s) { s = new Set(); byHabit.set(habit, s); }
    s.add(day);
    anyTickDays.add(day);
  }

  const seenDays = anyTickDays.size;
  const silentDays = all.length - seenDays;

  const set: SetItemAdherence[] = input.items.map((it) => {
    const id = String(it?.id ?? '');
    const ticks = byHabit.get(COACH_TICK_PREFIX + id) ?? new Set<string>();
    const born = dayOf(it?.created_at);
    // The item's own birthday bounds the denominator. Without this a coach who
    // added a line on Thursday reads "2 of 28" on Saturday, which is a sentence
    // about their client that is mostly a sentence about the calendar.
    const from = born && born > w.start ? born : w.start;
    const eligible = born == null || born > w.end
      // Created after the last complete day: no day has passed under it yet.
      // Zero eligible days is not a rate of zero, it is the absence of one.
      ? null
      : all.filter((d) => d >= from).length;

    // An inactive item is off the list, and the day it came off is not
    // recorded. `updated_at` is stamped by a trigger on every update — a
    // rename or a reorder moves it too — so using it as the retirement date
    // would silently invent days the client is charged with missing. There is
    // no denominator here that the record can stand behind, so there is none.
    const noRate: NoRate | null = !it?.active
      ? 'retired'
      : born == null ? 'undated' : eligible === null ? 'too-new' : null;

    const counted = noRate ? [...ticks] : [...ticks].filter((d) => d >= from);
    const lastTicked = counted.length ? counted.sort()[counted.length - 1] : null;
    const silent = noRate || eligible === null
      ? null
      : all.filter((d) => d >= from && !anyTickDays.has(d)).length;

    return {
      id,
      label: String(it?.label ?? ''),
      icon: String(it?.icon ?? ''),
      active: Boolean(it?.active),
      eligibleDays: noRate ? null : eligible,
      ticked: counted.length,
      silentDays: silent,
      // What is left once the days they were absent are set aside: days they
      // were demonstrably in the app, ticking other things, and not this.
      skippedDays: noRate || eligible === null || silent === null
        ? null
        : Math.max(0, eligible - counted.length - silent),
      from: noRate ? null : from,
      lastTicked,
      noRate,
    };
  });

  const known = new Set(input.items.map((it) => COACH_TICK_PREFIX + String(it?.id ?? '')));
  let deletedLineTicks = 0;
  const derived: DerivedAdherence[] = [];
  for (const [habit, days] of byHabit) {
    if (habit.startsWith(COACH_TICK_PREFIX)) {
      // A coach line whose row is gone. Its ticks are real and its meaning is
      // not: 'coach:8f3e…' with no row behind it cannot be labelled by anybody.
      // Counted, so the coach knows the ticks exist, and never labelled.
      if (!known.has(habit)) deletedLineTicks += days.size;
      continue;
    }
    const sorted = [...days].sort();
    derived.push({
      id: habit,
      label: DERIVED_LABEL[habit] ?? habit,
      ticked: days.size,
      lastTicked: sorted[sorted.length - 1] ?? null,
    });
  }
  derived.sort((a, b) => b.ticked - a.ticked || a.id.localeCompare(b.id));

  return { window: w, set, derived, seenDays, silentDays, deletedLineTicks };
}

/**
 * The sentence a coach reads under one of their own lines.
 *
 * Written here rather than in the screen so it can be tested, and because the
 * wording is the load-bearing part of this feature: the same two numbers can be
 * put in front of a coach as a fraction of days on the list, which is what they
 * are, or as a score out of a hundred, which invites reading a person's
 * character off a table of ticks. It says what was ticked and over what, in the
 * voice of a coach's own notes, and it never says "0%" or "failed".
 */
export function setItemLine(a: SetItemAdherence): string {
  if (a.noRate === 'too-new') {
    return 'Added just now — no complete day has passed under it yet, so there is nothing to look at.';
  }
  if (a.noRate === 'undated') {
    return `No date on this line, so how far back it could have been ticked is unknown. ${a.ticked} ${a.ticked === 1 ? 'tick' : 'ticks'} on the record in the last four weeks, out of a number of days this screen cannot work out.`;
  }
  if (a.noRate === 'retired') {
    return a.ticked > 0
      ? `Off their list. ${a.ticked} ${a.ticked === 1 ? 'tick is' : 'ticks are'} on the record from when it was on; the table dates the last change to the line, not the day you took it off, so there is no run of days to count them against.`
      : 'Off their list, and no tick on the record from the last four weeks.';
  }
  const n = a.eligibleDays ?? 0;
  const head = `Ticked ${a.ticked} of the ${n} ${n === 1 ? 'day' : 'days'} it has been on their list.`;
  if (!a.silentDays) return head;
  return `${head} ${a.silentDays} of those ${a.silentDays === 1 ? 'is a day' : 'are days'} with nothing logged at all — a miss and a day they never opened the app look the same from here.`;
}
