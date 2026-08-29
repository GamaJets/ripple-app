// Marking a day AHEAD of time, and never letting that read as a record.
//
// TF-20: the calendar could only be told what had already happened. A client
// who knows they are flying on Thursday and lifting on Friday had nowhere to
// put either, so the plan they were actually following lived in their head and
// their coach could not see it.
//
// ── The vocabulary is inherited, not invented ───────────────────────────────
//
// The app already had three day types, and they already had definitions. They
// are the buttons on `app/(client)/nutrition.tsx` — training / off / rest — and
// the wording of each blurb was written for a tester who asked what the buttons
// meant. That file's own comment says why they are phrased as "the day" and not
// "today":
//
//     the same three definitions have to keep reading correctly when day types
//     can be planned a week ahead, which is the direction this is going
//
// This is that week ahead, so the blurbs below are those blurbs, word for word.
// A second vocabulary would have been the real bug: "Rest day" on the calendar
// meaning something other than "Rest day" on Nutrition is how a client ends up
// eating to a target for a day they planned as something else.
//
// One type is added, and only one: 'deload'. It is not new either — the app has
// held the concept since `deloadCheck` in src/lib/training.ts, which tells a
// client when a deload week is due, and `src/lib/progression.ts` returns
// 'deload' as one of four actions on a lift. There is a whole screen about it
// (`app/(client)/restday.tsx`). Planning one was the only part missing.
//
// ── What was deliberately NOT added ────────────────────────────────────────
//
// The report also asked about refeed / high-carb days and travel days. Neither
// is in the app anywhere: the macro engine has no refeed adjustment to apply
// (`src/lib/nutrition.ts` cycles on training/rest only) and nothing in the
// product knows what a travel day changes. A day type that no other screen can
// act on is a sticker — it looks like it did something. So they are not types;
// they are what the optional note on a planned day is for, and the picker says
// so. When the macro engine grows a refeed, 'refeed' becomes a type here and
// the note stops being the place for it.
//
// ── The rule this file exists to hold ──────────────────────────────────────
//
// A plan is an intention. It is never evidence. `planOutcome` below is written
// so there is no path — none — from "this day was planned" to "this day was
// done": a planned day that has passed with nothing logged comes back as
// 'nothing-logged' for every type, including a rest day, where an empty log is
// exactly what you would expect. Expecting it is not the same as knowing it.
//
// Pure and dependency-free apart from localDate, so the date arithmetic that
// decides whether a day is still ahead can be tested under the three zones the
// repo runs its tests in. Date-only values go through `dateParts`; see the
// header of src/lib/localDate.ts for the two shipped bugs that rule comes from.
import { dateParts } from './localDate';

/** The day types a client can mark a date as. `off` is Nutrition's key for
 *  Standard — kept rather than renamed, because the two screens have to be
 *  storing and reading the same word. */
export type PlannedDayType = 'training' | 'off' | 'rest' | 'deload';

/** Picker order: the two ends of the week's effort, then the baseline between
 *  them, then the one that is a whole week's decision rather than a day's. */
export const PLANNED_DAY_TYPES: readonly PlannedDayType[] = ['training', 'off', 'rest', 'deload'];

export const DAY_TYPE_LABEL: Record<PlannedDayType, string> = {
  training: 'Training day',
  off: 'Standard',
  rest: 'Rest day',
  deload: 'Deload day',
};

/** The first three are `DAY_TYPES` in app/(client)/nutrition.tsx, unchanged.
 *  The fourth is the guidance already on the Rest & deload screen. */
export const DAY_TYPE_BLURB: Record<PlannedDayType, string> = {
  training: 'A day you train — a gym session or a hard effort. Fuel goes up so there is something to train on.',
  off: 'A normal day with no session: work, walking, ordinary movement. This is the baseline target.',
  rest: 'A full day off training. Fuel comes down, because there is no session to feed.',
  deload: 'A day inside a deload: you still train, at about 60% of the volume and well shy of failure, so fatigue clears.',
};

/** A row of `planned_days`, as the client's app holds it. */
export interface PlannedDay {
  /** Bare `YYYY-MM-DD`. A calendar day, not an instant. */
  dateISO: string;
  type: PlannedDayType;
  /** The client's own words — where a travel day or a refeed goes until the
   *  app can act on either. Null when they wrote none. */
  note: string | null;
}

/** Whether a value off the wire is a day type this build understands. A row
 *  written by a newer build is dropped rather than coerced to a default, which
 *  would silently retype somebody's day. */
export function isPlannedDayType(v: unknown): v is PlannedDayType {
  return typeof v === 'string' && (PLANNED_DAY_TYPES as readonly string[]).includes(v);
}

const pad = (n: number) => (n < 10 ? '0' + n : String(n));

/** `YYYY-MM-DD` from the parts a month grid already holds (month is 0-11). */
export function isoFromParts(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/**
 * Today, as a bare date, in the reader's own zone.
 *
 * Deliberately built from the local getters rather than `toISOString().slice(0, 10)`,
 * which is UTC: in Auckland that spelling is tomorrow's date for most of the
 * working day, and every "is this day still ahead" question below would answer
 * off by one for half the planet.
 */
export function isoToday(now: Date): string {
  return isoFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The key the month grid uses for a cell (`${year}-${monthIndex}-${day}`), or
 *  null when the value is not a readable date. */
export function cellKeyFromIso(iso: string): string | null {
  const p = dateParts(iso);
  return p ? `${p[0]}-${p[1]}-${p[2]}` : null;
}

/** 0 Sun … 6 Sat, for feeding `scheduledFocus`. Null when unreadable. */
export function weekdayOfIso(iso: string): number | null {
  const p = dateParts(iso);
  // Local midnight, so the weekday is the one the client would name. Parsing
  // the string as UTC hands back the previous day west of Greenwich, which
  // would ask the program for Monday's session on a Tuesday.
  return p ? new Date(p[0], p[1], p[2]).getDay() : null;
}

/** −1, 0 or 1 comparing two calendar days; null when either is unreadable. */
export function compareIsoDays(a: string, b: string): number | null {
  const pa = dateParts(a), pb = dateParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether this day can still be PLANNED.
 *
 * Today and forward, and that boundary is the honest part rather than a
 * limitation. Marking last Tuesday as a rest day is not a plan, it is a claim
 * about what happened, and this table is not the place a claim about the past
 * gets to live — the workout log is. Days already gone still show what was
 * planned for them; they just cannot be given a plan retrospectively.
 */
export function canPlan(dateISO: string, todayISO: string): boolean {
  const c = compareIsoDays(dateISO, todayISO);
  return c != null && c >= 0;
}

/**
 * What can be said about a planned day, given the log.
 *
 * 'not-yet'        the day has not arrived.
 * 'today'          it is today; the day is still running.
 * 'log-agrees'     the day has passed and the log is consistent with the plan.
 * 'log-disagrees'  the day has passed and the log contradicts the plan.
 * 'nothing-logged' the day has passed with nothing logged against it.
 * 'log-unknown'    the day has passed and the log could not be read.
 *
 * There is no 'done' and there must not be one. The value TF-20 is really
 * asking for is the fourth: a planned rest day that passes with an empty log
 * looks exactly like a rest day that was taken, and it also looks exactly like
 * a client who trained and forgot to log it, and like a client who spent the
 * day in bed with flu. 'nothing-logged' is returned for EVERY type in that
 * case, rest included, because absence of a workout is not evidence of rest —
 * it is absence of evidence, which is the mistake `src/ui/loadStatus.ts` exists
 * to stop this app making.
 *
 * `logged` is tri-state on purpose: false means the log answered and held
 * nothing for the day, null means it did not answer at all.
 */
export type PlanOutcome = 'not-yet' | 'today' | 'log-agrees' | 'log-disagrees' | 'nothing-logged' | 'log-unknown';

export function planOutcome(
  type: PlannedDayType,
  dateISO: string,
  todayISO: string,
  logged: boolean | null,
): PlanOutcome | null {
  const c = compareIsoDays(dateISO, todayISO);
  if (c == null) return null;
  if (c > 0) return 'not-yet';
  if (c === 0) return 'today';
  if (logged == null) return 'log-unknown';
  if (!logged) return 'nothing-logged';
  // Training was logged. A deload day is a training day with the volume cut —
  // the Rest & deload screen's own instruction is "keep training, but cut
  // volume to ~60%" — so a session on one is the plan being followed, not
  // broken. The other three all said, in their own words, that there would be
  // no session.
  return type === 'training' || type === 'deload' ? 'log-agrees' : 'log-disagrees';
}

/** The sentence to put under a planned day. Never claims the plan was kept. */
export function outcomeNote(type: PlannedDayType, outcome: PlanOutcome): string {
  const label = DAY_TYPE_LABEL[type].toLowerCase();
  switch (outcome) {
    case 'not-yet':
      return `Planned as a ${label}. This day hasn’t happened yet — nothing here is a record.`;
    case 'today':
      return `Planned as a ${label} for today. Anything you log today is listed separately below.`;
    case 'log-agrees':
      return `Planned as a ${label}, and there is training logged on it. The log below is what actually happened.`;
    case 'log-disagrees':
      return `Planned as a ${label}, but there is training logged on it. Both are shown — neither has been changed to match the other.`;
    case 'nothing-logged':
      return `Planned as a ${label}. Nothing was logged on this day, so it stays a plan: an unlogged session and a day that went differently look the same from here.`;
    case 'log-unknown':
      return `Planned as a ${label}. Your training log couldn’t be read, so we can’t say what was logged against it.`;
  }
}

/**
 * Where a client's mark and their program disagree.
 *
 * TF-20 is explicit that this is to be SHOWN and not resolved: the program does
 * not overwrite the mark, and the mark does not edit the program. Either one
 * silently winning is the same failure — the client is left looking at a plan
 * that is not the one they made, or a coach is left looking at a week the
 * client never agreed to.
 *
 * `scheduled` is the focus the program puts on that weekday, from
 * `scheduledFocus` in src/lib/checklist.ts — the exact-weekday match, never the
 * nearest-day one, for the reason written on it. `undefined` means the program
 * could not be read, and no conflict is claimed on an unknown: telling somebody
 * their program has nothing on Tuesday when we simply failed to fetch it is the
 * fabricated-empty-answer bug in a new hat.
 */
export type PlanConflictKind = 'plan-schedules-a-session' | 'plan-schedules-nothing';

export interface PlanConflict {
  kind: PlanConflictKind;
  /** The program's focus for that day ('Push'), or null when it schedules none. */
  focus: string | null;
  note: string;
}

export function planConflict(
  marked: PlannedDayType | null,
  scheduled: string | null | undefined,
): PlanConflict | null {
  if (!marked || scheduled === undefined) return null;
  const focus = scheduled ? scheduled.trim() : '';
  if (focus) {
    // A deload day is not a conflict with a scheduled session — it is an
    // instruction about how to do that session. See planOutcome.
    if (marked === 'training' || marked === 'deload') return null;
    return {
      kind: 'plan-schedules-a-session',
      focus,
      note: `Your program schedules ${focus} on this day and you’ve marked it as a ${DAY_TYPE_LABEL[marked].toLowerCase()}. Neither has been changed — this is here so you can decide, or tell your coach.`,
    };
  }
  if (marked === 'training') {
    return {
      kind: 'plan-schedules-nothing',
      focus: null,
      note: 'Your program has no session on this day. Marking it a training day doesn’t add one to the program — it records what you intend to do.',
    };
  }
  return null;
}

/** Planned days keyed by the month grid's cell key, for one lookup per cell.
 *  A row whose date will not parse is dropped rather than filed under ''. */
export function byCellKey(days: readonly PlannedDay[]): Map<string, PlannedDay> {
  const m = new Map<string, PlannedDay>();
  for (const d of days) {
    const k = cellKeyFromIso(d.dateISO);
    if (k) m.set(k, d);
  }
  return m;
}

/**
 * The plans still to come, soonest first — what "seeing what is already marked"
 * means on a screen that can only show one day's detail at a time.
 *
 * Today counts as upcoming: a day you are standing in is still ahead of you.
 */
export function upcomingPlans(days: readonly PlannedDay[], todayISO: string): PlannedDay[] {
  return days
    .filter((d) => canPlan(d.dateISO, todayISO))
    .sort((a, b) => compareIsoDays(a.dateISO, b.dateISO) ?? 0);
}
