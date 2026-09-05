// The trainer rota — who is on the gym floor when, and whether that matches
// what the floor is doing.
//
// Framework-agnostic on purpose: the Supabase client comes in as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts and src/lib/gymEquipment.ts for the same shape.
//
// ── Why this is not a calendar ──────────────────────────────────────────────
//
// A rota on its own is a spreadsheet with a login. The gym already records
// demand — classes in `gym_classes`, one-to-ones in `sessions` — so the useful
// thing is not drawing the shifts, it is putting supply and demand on one
// timeline and reporting where they disagree:
//
//   · UNCOVERED — an hour with a class or a PT session booked and nobody
//     rostered. A member walks in to a class and there is no staff plan behind
//     it. This is the expensive one.
//   · IDLE — an hour with somebody rostered and nothing booked at all. Paid
//     floor time the gym is not selling.
//
// Neither question can be answered by the rota alone, and neither by the
// timetable alone.
//
// ── The rule that governs the whole module ──────────────────────────────────
//
// An empty rota is not an uncovered gym. If no shifts exist for the window,
// `coverage()` returns `uncovered: null` and `idle: null` with a reason, the
// same way `gymEquipment.capacityFor` refuses to report 0 against an empty
// register. Telling an owner "37 uncovered hours" on the strength of a form
// they have never filled in is a lie with a number attached.
//
// ── The gym's clock, and not the reader's ───────────────────────────────────
//
// "Who was on at 6pm" is a question about the GYM's wall clock. This module
// used to answer it with the device's — `localDate` off `getFullYear()`,
// `hoursSpanned` off `getHours()`, `shiftFromHours` off `setHours` — and the
// header said so as though it were the same thing. It is the same thing only
// while the reader is standing in the gym.
//
// It is not the same thing for a chain owner rostering a Dubai gym from London,
// and the way it failed was silent in both directions: the shift was STORED at
// the reader's hour, and `studio-web/app/staff` — which renders through
// `gymWhen` with `timeZone: zone` and has been right all along — then printed a
// different hour for the same row. Two screens, one database, two answers, and
// the only person who found out was the coach who turned up.
//
// So every day and every hour in this file now goes through
// `src/lib/rotaClock.ts`, which is the gym's clock where `tenants.timezone` is
// set and the reader's — SAID OUT LOUD, via `whoseClockNote` — where it is not.
// The `zone` argument is optional on every function purely so a test can build
// a grid without one; a SCREEN that omits it is drawing the reader's week and
// owes the reader that sentence.
//
// The label and the bucket move together. Fixing only the times would file a
// 23:00 gym-time shift under the next day's column with "23:00" beside it,
// which is worse than consistently wrong because it looks like a bug in the
// grid rather than a question about a zone.

import { assertWhole, capLimit } from './rowCap';
import { chunkIds, uniqueIds } from './idLookup';
import { assertWrote } from './wroteRows';
import { dayIndexInWeek } from './weekStart';
import { rotaDay, rotaCell, rotaInstant, rotaToday, addCalendarDays, calendarWeekday } from './rotaClock';
// One reader for a typed money box: it asks the currency how many decimal
// places it has, and refuses `1,234` rather than guessing which reading was
// meant. The same function /costs and the equipment log read their boxes with.
import { readMinorAmount } from './coachMoney';

type Queryable = { from: (table: string) => any };

/** What a trainer is rostered on for. */
export type ShiftRole = 'floor' | 'classes' | 'pt' | 'desk' | 'admin';

/** A pulled shift is kept, not deleted — see 43-trainer-rota.sql. */
export type ShiftStatus = 'scheduled' | 'cancelled';

export interface Shift {
  id: string;
  trainerId: string;
  /** Resolved from `profiles`. Null when the profile row could not be read. */
  trainerName: string | null;
  startsAt: string;
  endsAt: string;
  role: ShiftRole;
  status: ShiftStatus;
  note: string | null;
  /**
   * What this shift is worth, in minor units, for its WHOLE span — not per
   * hour. Null is "nobody priced it", which is not "free": every figure derived
   * from these keeps the two apart and says how many were unpriced.
   *
   * Added by 196-a-rota-that-cannot-be-costed.sql. Before it, neither surface
   * could answer what the floor costs to staff — the only money figure in the
   * product is `tenants.session_fee` times DELIVERED one-to-ones, and a trainer
   * on the desk from six until ten delivers nothing and is owed four hours.
   *
   * OPTIONAL on the type, and only for the reason `GymClass.status` is: `Shift`
   * is built by hand in `coverage.test.ts`, a file that belongs to no one lane,
   * and making two new fields required would break a suite whose subject is
   * hour arithmetic and which has no opinion about money. `fetchShifts` always
   * fills both in, and every reader below treats undefined exactly as null.
   */
  rateCents?: number | null;
  /**
   * The currency of `rateCents`. Null exactly when `rateCents` is null, which
   * the database enforces (`gym_shifts_priced_or_not`).
   *
   * There is no default currency in this product — part 150 removed all seven
   * of them and says why — so a rate whose currency did not read is a number
   * that cannot be written down, never a number in dirhams.
   */
  currency?: string | null;
}

/** An hour of work the gym has actually committed to: a class, or a booked PT. */
export interface DemandBlock {
  kind: 'class' | 'pt';
  label: string;
  startsAt: string;
  durationMin: number;
  /** Who the work is assigned to, when the row says. Null when it does not. */
  trainerId: string | null;
}

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

const HOUR_MS = 3_600_000;
/** A guard, not a policy: a corrupt row must not spin the hour walk forever. */
const MAX_SPAN_HOURS = 24 * 14;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The READER's calendar date of an instant, as yyyy-mm-dd.
 *
 * Kept, named for whose day it actually is, and no longer what the grid buckets
 * by — `rotaDay(at, zone)` is. It survives because it is exactly the fallback
 * `rotaClock` uses when a gym has no zone, and having the two spellings agree by
 * being the same three getters is cheaper than having them agree by accident.
 */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** A stable key for one cell of the grid. */
export function cellKey(date: string, hour: number): string {
  return `${date}T${pad2(hour)}`;
}

/** A wall-clock label for an hour, e.g. 6 -> "06:00". */
export function hourLabel(hour: number): string {
  return `${pad2(hour)}:00`;
}

export interface HourCell {
  /** Calendar date on the rota's clock, yyyy-mm-dd. */
  date: string;
  /** Hour on the rota's clock, 0..23. */
  hour: number;
}

/**
 * Every hour a span touches ON THE ROTA'S CLOCK, from the hour it starts in to
 * the hour it ends in. A 17:30–18:15 class occupies 17 and 18 — it needs
 * somebody on the floor for both, so both count.
 *
 * The walk starts from the TOP of the hour the span opens in, found by asking
 * `rotaInstant` for the instant that hour names rather than by calling
 * `setMinutes(0)` — which is the reader's hour and, for a gym on a half-hour
 * offset, not the top of anything. From there it steps a plain hour at a time
 * and re-reads the day and hour at each step, so a clock change adds or drops
 * exactly the hour it should: a spring-forward morning reports 01, 03, 04, and
 * a fall-back morning reports 01 twice, which the grid folds into one cell
 * because one cell is what it is.
 */
export function hoursSpanned(startIso: string, endIso: string, zone?: string | null): HourCell[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const first = rotaCell(start, zone);
  if (!first) return [];
  const topIso = rotaInstant(first.date, first.hour, zone);
  const top = topIso == null ? NaN : Date.parse(topIso);
  // A wall-clock hour the zone skipped — the one that does not exist on a
  // spring-forward morning. The span itself is still real, so it is walked from
  // where it actually starts rather than dropped.
  let at = Number.isFinite(top) && top <= start ? top : start;

  const out: HourCell[] = [];
  while (at < end && out.length < MAX_SPAN_HOURS) {
    const c = rotaCell(at, zone);
    if (c) out.push(c);
    at += HOUR_MS;
  }
  return out;
}

/** The hours a demand block occupies, from its start and duration. */
export function demandHoursSpanned(d: DemandBlock, zone?: string | null): HourCell[] {
  const start = Date.parse(d.startsAt);
  if (!Number.isFinite(start) || !(d.durationMin > 0)) return [];
  return hoursSpanned(d.startsAt, new Date(start + d.durationMin * 60_000).toISOString(), zone);
}

/**
 * How long a shift is, in hours. Null when the row cannot be read as a span —
 * never 0, which would read as "a shift of no length" rather than "unreadable".
 */
export function shiftHours(s: Pick<Shift, 'startsAt' | 'endsAt'>): number | null {
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / HOUR_MS;
}

/** A live shift is one that has not been pulled. Only these count as cover. */
export function isLive(s: Pick<Shift, 'status'>): boolean {
  return s.status === 'scheduled';
}

/**
 * The day that opens the week containing `at`, as an ISO date on the rota's
 * clock.
 *
 * WHICH day is src/lib/weekStart.ts's decision, not this file's — a rota week
 * and a member's training week are the same week, and they were only ever the
 * same by two files agreeing about a `% 7`.
 *
 * The GYM's week where the gym has a zone. An owner in London opening a Sydney
 * gym's rota at nine on a Saturday evening is looking at a gym where it is
 * already Sunday, and `startOfWeek` on the reader's clock would open last week
 * for them and this week for the front desk — the same disagreement this file
 * exists to end, one level up.
 */
export function weekStartOf(at: number | Date = Date.now(), zone?: string | null): string {
  const today = rotaToday(zone, at);
  if (today == null) return localDate(at instanceof Date ? at : new Date(at));
  return weekOpeningOn(today) ?? today;
}

/** The day that opens the week a bare calendar date falls in. Pure calendar
 *  arithmetic: a date has no zone, so neither does its week. */
function weekOpeningOn(dateIso: string): string | null {
  const jsDay = calendarWeekday(dateIso);
  if (jsDay == null) return null;
  return addCalendarDays(dateIso, -dayIndexInWeek(jsDay));
}

/**
 * The seven dates of the week opening on `weekIso`.
 *
 * Calendar arithmetic on the date string rather than seven local midnights.
 * A local midnight is a thing some zones do not have — Brazil used to skip it
 * outright on the spring-forward Sunday — and `new Date(y, m, d)` then hands
 * back 01:00, which `localDate` reads correctly and `setDate` walks from
 * unpredictably. The days of a week are three integers plus one, and this does
 * that.
 */
export function weekDays(weekIso: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addCalendarDays(weekIso, i);
    if (d == null) return out;
    out.push(d);
  }
  return out;
}

/** Shift a week ISO date by whole weeks — the screen's back/forward control. */
export function shiftWeek(weekIso: string, weeks: number): string {
  return addCalendarDays(weekIso, weeks * 7) ?? weekIso;
}

/**
 * The query window for a week, as instants. Half-open at the end: `toISO` is
 * the midnight opening the *next* week, so a class in the last half-hour of the
 * final day is inside and the next week's first midnight is not counted twice.
 *
 * The gym's midnights where the gym has a zone. This is the bound the database
 * is asked for, so a window built on the reader's midnight reads six hours of
 * the wrong days for a gym six hours away — the grid would then be missing an
 * evening at one end and carrying somebody else's at the other, and `coverage`
 * would report the hole as uncovered.
 */
export function weekWindow(weekIso: string, zone?: string | null): { fromISO: string; toISO: string } | null {
  const next = addCalendarDays(weekIso, 7);
  if (next == null) return null;
  const fromISO = rotaInstant(weekIso, 0, zone);
  const toISO = rotaInstant(next, 0, zone);
  if (fromISO == null || toISO == null) return null;
  return { fromISO, toISO };
}

/* ── the grid ──────────────────────────────────────────────────────────────── */

export interface RotaHour {
  date: string;
  hour: number;
  /** Trainers with a live shift covering this hour. This is the cover. */
  rostered: string[];
  /** Trainers whose shift here was pulled. Kept separate: a hole somebody
   *  dropped out of is a different problem from one nobody ever filled. */
  cancelled: string[];
  /** Classes running in this hour. */
  classes: number;
  /** Booked one-to-ones running in this hour. */
  ptSessions: number;
  /** Trainers the work in this hour is assigned to, per the class or session
   *  row. Being assigned is not the same as being rostered — that difference
   *  is the most common reason an hour reads as uncovered. */
  assigned: string[];
}

/**
 * Supply and demand on one hour grid, for the given local dates.
 *
 * Only hours with something in them are returned — an empty cell is the absence
 * of a fact, not a fact, and 168 mostly-blank rows per week would bury the ones
 * that matter. Sorted by date then hour.
 */
export function buildRota(days: string[], shifts: Shift[], demand: DemandBlock[], zone?: string | null): RotaHour[] {
  const wanted = new Set(days);
  const cells = new Map<string, RotaHour>();

  const cell = (c: HourCell): RotaHour | null => {
    if (!wanted.has(c.date)) return null;
    const k = cellKey(c.date, c.hour);
    let r = cells.get(k);
    if (!r) {
      r = { date: c.date, hour: c.hour, rostered: [], cancelled: [], classes: 0, ptSessions: 0, assigned: [] };
      cells.set(k, r);
    }
    return r;
  };

  for (const s of shifts) {
    for (const c of hoursSpanned(s.startsAt, s.endsAt, zone)) {
      const r = cell(c);
      if (!r) continue;
      const bucket = isLive(s) ? r.rostered : r.cancelled;
      if (!bucket.includes(s.trainerId)) bucket.push(s.trainerId);
    }
  }

  for (const d of demand) {
    for (const c of demandHoursSpanned(d, zone)) {
      const r = cell(c);
      if (!r) continue;
      if (d.kind === 'class') r.classes += 1;
      else r.ptSessions += 1;
      if (d.trainerId && !r.assigned.includes(d.trainerId)) r.assigned.push(d.trainerId);
    }
  }

  return [...cells.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

/* ── where the rota and the timetable disagree ─────────────────────────────── */

export type GapKind = 'uncovered' | 'idle';

export interface RotaGap extends RotaHour {
  kind: GapKind;
  /** Plain English, for the screen. Names the assigned trainer where there is
   *  one, because "the class has an instructor who is not on the rota" is a
   *  paperwork problem and "nobody at all" is a staffing one. */
  note: string;
}

export interface CoverageReport {
  hours: RotaHour[];
  /**
   * Hours with work booked and nobody rostered.
   *
   * NULL, not an empty list, when the window holds no shifts at all. An empty
   * rota means nobody filled it in, not that the gym is unstaffed, and every
   * hour of the week would otherwise be reported as a failure.
   */
  uncovered: RotaGap[] | null;
  /** Hours with somebody rostered and nothing booked. Null on an empty rota,
   *  where the question does not arise. */
  idle: RotaGap[] | null;
  /** Live shift hours in the window. Null when nothing is rostered. */
  rosteredHours: number | null;
  /** Distinct hours holding a class or a booked one-to-one. */
  demandHours: number;
  /** Demand hours with somebody rostered, over demand hours. Null when either
   *  side of the fraction is missing — a week with no classes has no cover
   *  rate, which is not the same as 0%. */
  coverRate: number | null;
  /** Why the comparison could not be made, in words an owner can act on.
   *  Null when it was made. */
  blocker: string | null;
}

/**
 * Compare the rota against what the gym has booked.
 *
 * `idle` is judged gym-wide rather than per trainer: somebody on the floor
 * while a colleague teaches is covering the floor, which is the job. Only an
 * hour where nothing at all is booked counts as idle, which is the
 * conservative reading and the one an owner can act on without arguing.
 */
export function coverage(days: string[], shifts: Shift[], demand: DemandBlock[], zone?: string | null): CoverageReport {
  const hours = buildRota(days, shifts, demand, zone);

  const live = shifts.filter(isLive);
  const rosteredHours = live.reduce<number | null>((total, s) => {
    const h = shiftHours(s);
    return h == null ? total : (total ?? 0) + h;
  }, null);

  const demandHours = hours.filter((h) => h.classes > 0 || h.ptSessions > 0).length;

  if (live.length === 0) {
    return {
      hours,
      uncovered: null,
      idle: null,
      rosteredHours,
      demandHours,
      coverRate: null,
      blocker: 'No shifts on the rota for this week, so cover cannot be checked.',
    };
  }

  const uncovered: RotaGap[] = [];
  const idle: RotaGap[] = [];
  let covered = 0;

  for (const h of hours) {
    const booked = h.classes > 0 || h.ptSessions > 0;
    if (booked && h.rostered.length === 0) {
      uncovered.push({ ...h, kind: 'uncovered', note: uncoveredNote(h) });
    } else if (booked) {
      covered += 1;
    } else if (h.rostered.length > 0) {
      idle.push({ ...h, kind: 'idle', note: idleNote(h) });
    }
  }

  return {
    hours,
    uncovered,
    idle,
    rosteredHours,
    demandHours,
    coverRate: demandHours > 0 ? covered / demandHours : null,
    blocker: null,
  };
}

function bookedPhrase(h: RotaHour): string {
  const bits: string[] = [];
  if (h.classes > 0) bits.push(`${h.classes} class${h.classes === 1 ? '' : 'es'}`);
  if (h.ptSessions > 0) bits.push(`${h.ptSessions} one-to-one${h.ptSessions === 1 ? '' : 's'}`);
  return bits.join(' and ');
}

function uncoveredNote(h: RotaHour): string {
  const what = bookedPhrase(h);
  if (h.cancelled.length > 0) {
    return `${what} booked, and the shift covering this hour was pulled.`;
  }
  if (h.assigned.length > 0) {
    return `${what} booked and assigned, but nobody is on the rota for this hour.`;
  }
  return `${what} booked and nobody rostered.`;
}

function idleNote(h: RotaHour): string {
  const n = h.rostered.length;
  return `${n} trainer${n === 1 ? '' : 's'} rostered with no class and no one-to-one booked.`;
}

/* ── the week, as the screen reads it ──────────────────────────────────────── */

export interface RotaDay {
  date: string;
  shifts: Shift[];
}

/**
 * Shifts grouped by the day they start on ON THE ROTA'S CLOCK, in the order
 * `days` gives.
 *
 * The same clock `hoursSpanned` walks and the same clock the times are labelled
 * on. That is not a tidiness point: a 23:00 gym-time shift bucketed on a
 * reader's day sits under tomorrow's heading with "23:00" printed beside it,
 * which is the visibly-inconsistent state that made fixing the labels alone
 * worse than leaving them.
 */
export function shiftsByDay(days: string[], shifts: Shift[], zone?: string | null): RotaDay[] {
  const index = new Map<string, Shift[]>(days.map((d) => [d, []]));
  for (const s of shifts) {
    const day = rotaDay(s.startsAt, zone);
    if (day == null) continue;
    index.get(day)?.push(s);
  }
  for (const list of index.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return days.map((date) => ({ date, shifts: index.get(date) ?? [] }));
}

export interface TrainerRota {
  trainerId: string;
  trainerName: string | null;
  shifts: Shift[];
  /** Live shift hours. Null when nothing of theirs in this window is live —
   *  a trainer whose only shift was pulled has no hours, not zero hours. */
  hours: number | null;
}

/** Each trainer's week, busiest first. */
export function rosterByTrainer(shifts: Shift[]): TrainerRota[] {
  const index = new Map<string, TrainerRota>();
  for (const s of shifts) {
    let r = index.get(s.trainerId);
    if (!r) {
      r = { trainerId: s.trainerId, trainerName: s.trainerName, shifts: [], hours: null };
      index.set(s.trainerId, r);
    }
    if (!r.trainerName) r.trainerName = s.trainerName;
    r.shifts.push(s);
    if (isLive(s)) {
      const h = shiftHours(s);
      if (h != null) r.hours = (r.hours ?? 0) + h;
    }
  }
  for (const r of index.values()) r.shifts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return [...index.values()].sort(
    (a, b) => (b.hours ?? -1) - (a.hours ?? -1) || (a.trainerName ?? '').localeCompare(b.trainerName ?? ''),
  );
}

export interface RotaSummary {
  /** Shifts on the rota, pulled ones included — they are still a fact. */
  shifts: number;
  cancelled: number;
  /** Trainers with at least one live shift. */
  trainers: number;
  /** Live rostered hours, or null when nothing is rostered. */
  hours: number | null;
}

/**
 * What a set of shifts costs, and how much of it is unknown.
 *
 * ── Why this returns four numbers rather than one ─────────────────────────
 *
 * Because a single total would be a lie in three separate ways, and each of
 * them flatters the gym:
 *
 *  · a shift nobody priced contributes nothing, so an owner who has costed two
 *    of nine shifts reads a week that costs almost nothing. `unpriced` is what
 *    makes the total legible — "1,400 across 2 of 9 shifts" is a figure; "1,400"
 *    on its own is a wrong one;
 *  · a PULLED shift is not a cost. It is kept on the rota deliberately so an
 *    hour somebody dropped out of stays distinguishable from one nobody was
 *    booked for, and `isLive` is the same filter every other figure here uses;
 *  · two currencies cannot be added. This product is white-label and a chain
 *    can hold gyms in two countries; adding 40 GBP to 40 AED gives 80 of
 *    nothing. `currency` comes back null and `mixedCurrency` true, and the
 *    screen prints the reason rather than a number.
 */
export interface RotaCost {
  /** Minor units, across the live shifts that carry a rate. Null when none do
   *  — which is not zero, and is the state every gym starts in. */
  cents: number | null;
  /** The one currency every rated shift agreed on, or null. */
  currency: string | null;
  /** True when the rated shifts do not agree, which is why `cents` is null. */
  mixedCurrency: boolean;
  /** Live shifts carrying a rate, and live shifts carrying none. */
  priced: number;
  unpriced: number;
}

export function rotaCost(shifts: Shift[]): RotaCost {
  const live = shifts.filter(isLive);
  let cents: number | null = null;
  let currency: string | null = null;
  let mixed = false;
  let priced = 0;

  for (const s of live) {
    if (s.rateCents == null || !s.currency) continue;
    const cur = s.currency.trim().toUpperCase();
    if (!cur) continue;
    priced += 1;
    if (currency == null) currency = cur;
    else if (currency !== cur) mixed = true;
    cents = (cents ?? 0) + s.rateCents;
  }

  // Mixed currencies leave the amount unstated rather than summed. The count of
  // priced shifts survives, because "9 shifts are costed and they are in two
  // currencies" is exactly the sentence the owner needs.
  if (mixed) return { cents: null, currency: null, mixedCurrency: true, priced, unpriced: live.length - priced };
  return { cents, currency, mixedCurrency: false, priced, unpriced: live.length - priced };
}

/** The week at a glance. */
export function summariseRota(shifts: Shift[]): RotaSummary {
  const live = shifts.filter(isLive);
  const hours = live.reduce<number | null>((total, s) => {
    const h = shiftHours(s);
    return h == null ? total : (total ?? 0) + h;
  }, null);
  return {
    shifts: shifts.length,
    cancelled: shifts.length - live.length,
    trainers: new Set(live.map((s) => s.trainerId)).size,
    hours,
  };
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export async function fetchShifts(
  sb: Queryable, tenantId: string, fromISO: string, toISO: string,
): Promise<Shift[]> {
  const { data, error } = await sb
    .from('gym_shifts')
    .select('id, trainer_id, starts_at, ends_at, role, status, note, rate_cents, currency')
    .eq('tenant_id', tenantId)
    // A shift that started before the window but runs into it still covers
    // hours inside it, so the window is opened on `ends_at`.
    .lt('starts_at', toISO)
    .gt('ends_at', fromISO)
    .order('starts_at', { ascending: true })
    .limit(capLimit());
  if (error) throw error;

  // Capped through src/lib/rowCap.ts. A week of one gym's shifts will not reach
  // a thousand, which is why the guard is worth having: if it ever does, the
  // window bound or the tenant filter has been lost in an edit, and the rota
  // would silently render another gym's cover as this one's — with names on it.
  const rows = assertWhole(data as any[] | null, 'the shifts in this week');
  if (!rows.length) return [];

  // Names live on `profiles`, not `trainers` — the trainers table carries the
  // gym-facing profile (bio, tagline, fee) and no name column.
  // Chunked at 150. `rows` is a `capLimit()` read, so the shift list can be a
  // thousand rows and — a gym chain running one tenant across several sites, or
  // any gym whose window bound was widened — a thousand distinct trainers with
  // it. A thousand uuids is a 39KB request line and the proxy answers 414 well
  // before that; supabase-js reports the 414 as `data: null`, which this code
  // would read as "no shift on this rota belongs to anybody we can name".
  const ids = [...new Set(rows.map((r: any) => r.trainer_id).filter(Boolean))];
  const names = new Map<string, string>();
  for (const chunk of chunkIds(uniqueIds(ids))) {
    const { data: profs, error: pe } = await sb.from('profiles').select('id, full_name').in('id', chunk);
    if (pe) throw pe;
    (profs ?? []).forEach((p: any) => {
      const n = (p.full_name || '').trim();
      if (n) names.set(p.id, n);
    });
  }

  return rows.map((r: any) => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: names.get(r.trainer_id) ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    role: r.role ?? 'floor',
    status: r.status ?? 'scheduled',
    note: r.note ?? null,
    rateCents: typeof r.rate_cents === 'number' ? r.rate_cents : null,
    // Trimmed and upper-cased on the way in, so 'gbp' and ' GBP ' cannot be
    // read as two currencies by `rotaCost` and trip its mixed-currency guard.
    currency: (r.currency ?? '').toString().trim().toUpperCase() || null,
  }));
}

/**
 * What the gym has actually committed to in the window: classes, and booked
 * one-to-ones.
 *
 * Queried here rather than through gymSchedule/gymSessions because those two
 * pull bookings, outcomes, rates and settlements that this has no use for —
 * three extra round trips to compute an hour grid.
 *
 * A session counts as demand while it is `booked` and has not been cancelled.
 * A late cancellation still counts: the hour was held, and the rota question is
 * whether somebody needed to be there for it.
 *
 * ── Why both reads are capped, and why it matters more here than above ─────
 *
 * `fetchShifts` has been capped since it was written and says why. These two
 * were not, and the asymmetry is the defect: `coverage()` compares SUPPLY
 * against DEMAND, so a truncated demand read does not make the report smaller,
 * it makes it WRONG IN THE REASSURING DIRECTION. Every demand block that fell
 * off the end is an hour with work booked that the grid never hears about —
 * uncovered goes down, idle goes up, and app/(owner)/rota.tsx prints "Every
 * booked hour this week has somebody on the rota" over a week that has nobody
 * on it at all. That sentence is the reason the screen exists, and the one
 * failure it must never produce is a false version of it.
 *
 * A week of one gym will not reach a thousand classes or a thousand booked
 * one-to-ones, which is exactly the argument `fetchShifts` makes for its own
 * cap: if it ever does, the window bound or the tenant filter has been lost in
 * an edit, and the honest answer is a refused read rather than a comforting
 * grid computed over whatever fitted.
 */
export async function fetchDemand(
  sb: Queryable, tenantId: string, fromISO: string, toISO: string,
): Promise<DemandBlock[]> {
  const { data: classes, error: ce } = await sb
    .from('gym_classes')
    .select('title, trainer_id, starts_at, duration_min')
    .eq('tenant_id', tenantId)
    .gte('starts_at', fromISO)
    .lt('starts_at', toISO)
    .order('starts_at', { ascending: true })
    .limit(capLimit());
  if (ce) throw ce;

  const { data: sessions, error: se } = await sb
    .from('sessions')
    .select('trainer_id, starts_at, duration_min, status, outcome')
    .eq('tenant_id', tenantId)
    .eq('status', 'booked')
    .gte('starts_at', fromISO)
    .lt('starts_at', toISO)
    .order('starts_at', { ascending: true })
    .limit(capLimit());
  if (se) throw se;

  // Asserted BEFORE either is mapped, so a truncated week cannot reach the
  // grid at all. Two separate noun phrases because the two reads truncate
  // independently and an owner should be told which half of the week's work
  // could not be read whole.
  const classRows = assertWhole(classes as any[] | null, 'the classes booked this week');
  const sessionRows = assertWhole(sessions as any[] | null, 'the one-to-ones booked this week');

  const out: DemandBlock[] = classRows.map((r: any) => ({
    kind: 'class' as const,
    label: r.title || 'Class',
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 45,
    trainerId: r.trainer_id ?? null,
  }));

  for (const r of sessionRows) {
    if (r.outcome === 'cancelled') continue;
    out.push({
      kind: 'pt',
      label: 'One-to-one',
      startsAt: r.starts_at,
      durationMin: r.duration_min ?? 60,
      trainerId: r.trainer_id ?? null,
    });
  }
  return out;
}

/* ── writes ────────────────────────────────────────────────────────────────── */

export interface NewShift {
  trainerId: string;
  startsAt: string;
  endsAt: string;
  role?: ShiftRole;
  note?: string | null;
  /** Both or neither — `gym_shifts_priced_or_not` refuses one without the
   *  other, because an amount with no currency is not an amount. */
  rateCents?: number | null;
  currency?: string | null;
}

/** The fields an owner may correct on a shift that is already on the rota. An
 *  absent key is "leave it alone"; null is "clear it". */
export interface ShiftPatch {
  startsAt?: string;
  endsAt?: string;
  role?: ShiftRole;
  note?: string | null;
  rateCents?: number | null;
  currency?: string | null;
}

/**
 * Why this shift cannot be saved, in the owner's words, or null.
 *
 * Pure, so the sentence is assertable without a database and is shown while the
 * form is still being filled in rather than after a refused round trip. Each of
 * the three is a constraint the database also enforces — `gym_shifts_span`,
 * `gym_shifts_rate_nonneg`, `gym_shifts_priced_or_not` — said in advance and in
 * English instead of arriving as a Postgres error code.
 */
export function shiftBlocker(s: {
  trainerId?: string | null; startsAt?: string | null; endsAt?: string | null;
  rateCents?: number | null; currency?: string | null;
}): string | null {
  if (!s.trainerId) return 'Say who is on.';
  const a = Date.parse(s.startsAt ?? '');
  const b = Date.parse(s.endsAt ?? '');
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Give the shift a start and an end.';
  if (b <= a) return 'A shift has to end after it starts — otherwise it covers no hours at all while looking like cover on the rota.';
  if (s.rateCents != null && s.rateCents < 0) return 'A negative rate is a typo, and it would subtract from the week’s cost.';
  // The pairing, said in the direction the form is actually filled in: somebody
  // types an amount and the currency is what they forget.
  if (s.rateCents != null && !(s.currency ?? '').trim()) {
    return 'Say what money that is in. An amount with no currency is read in whatever the reader happens to be thinking in — and this product has no default currency.';
  }
  if (s.rateCents == null && (s.currency ?? '').trim()) {
    return 'A currency with no amount is a setting pretending to be a cost. Give it a figure or clear the currency.';
  }
  return null;
}

/**
 * What somebody typed in a shift's rate box, in minor units — or why it is not
 * an amount. An EMPTY box is a real answer and means no rate, which is a shift
 * genuinely covered for free.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The rota screen read its box as
 * `rate.trim() === '' ? null : Math.round((parseFloat(rate) || 0) * 100)`, in
 * two places. `parseFloat('1,234')` is 1 and `parseFloat('abc') || 0` is 0, and
 * `shiftBlocker` only ever rejected a NEGATIVE rate — so a mistyped amount was
 * saved as one, or as nothing, and the Costs column then drew that 0.00
 * identically to a shift the gym had genuinely covered for free. Nothing on the
 * screen separated the typo from the policy.
 *
 * The hundred was the other half. A yen has no minor unit and a Kuwaiti dinar
 * has a thousand of them, so the factor is a question for the currency.
 *
 * `readMinorAmount` refuses rather than resolving: in a two-place currency
 * `1,234` is either one thousand two hundred and thirty-four or one and a bit,
 * depending on where the person typing it grew up, and neither reading may be
 * picked on their behalf. Compare `parseRate` in src/lib/gymPay.ts, which
 * already refuses an unparseable amount by name.
 */
export function shiftRate(
  rate: string, currency: string | null,
): { ok: true; minorUnits: number | null } | { ok: false; reason: string } {
  if (!rate.trim()) return { ok: true, minorUnits: null };
  if (!(currency ?? '').trim()) {
    return { ok: false, reason: 'Say what money that is in. An amount with no currency is read in whatever the reader happens to be thinking in — and this product has no default currency.' };
  }
  // NOT a charge — a shift rate is payroll, paid out rather than billed, so
  // Stripe's whole-ten rule for the thousandth-unit currencies is off. Every
  // other refusal above and inside the reader still stands.
  return readMinorAmount(rate, currency, false);
}

/**
 * Build a shift from a date and two wall-clock hours — the shape both screens
 * collect. Returns null rather than a guess when the hours do not make a span,
 * which the caller renders as a disabled button rather than saving a shift that
 * covers nothing.
 *
 * ── The hours are the GYM's ────────────────────────────────────────────────
 *
 * This is the write half of the defect, and it is the half that moves somebody.
 * It was `setHours` on the reader's device: an owner in London rostering a
 * Dubai gym for "06 to 14" wrote 10:00–18:00 gym time, and `studio-web/app/staff`
 * — which has always rendered in `timeZone: zone` — then displayed 10:00 beside
 * a form that had just been told 06. The coach was rostered four hours late and
 * neither screen was lying about what it held.
 *
 * `rotaInstant` solves the offset at the instant being named, so a shift typed
 * across a clock change is the hours that were typed rather than the hours plus
 * one. With no zone on the gym it is the reader's own clock, unchanged, and the
 * screen says so.
 */
export function shiftFromHours(
  trainerId: string, dateIso: string, startHour: number, endHour: number, role: ShiftRole = 'floor',
  zone?: string | null,
): NewShift | null {
  if (!trainerId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso ?? '').trim())) return null;
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return null;
  if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24) return null;
  if (endHour <= startHour) return null;

  const startsAt = rotaInstant(dateIso, startHour, zone);
  const endsAt = rotaInstant(dateIso, endHour, zone);
  if (startsAt == null || endsAt == null) return null;
  // A shift that ends no later than it starts. Unreachable through the hour
  // guards above on an ordinary day, and reachable on a fall-back morning where
  // the same wall clock names two instants — refused rather than stored as a
  // span the grid would read as covering nothing.
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  return { trainerId, startsAt, endsAt, role };
}

export async function addShift(sb: Queryable, tenantId: string, s: NewShift): Promise<void> {
  const { error } = await sb.from('gym_shifts').insert({
    tenant_id: tenantId,
    trainer_id: s.trainerId,
    starts_at: s.startsAt,
    ends_at: s.endsAt,
    role: s.role ?? 'floor',
    note: s.note ?? null,
    rate_cents: s.rateCents ?? null,
    // Normalised here as well as on the read, so the row itself never holds two
    // spellings of one currency.
    currency: (s.currency ?? '').trim().toUpperCase() || null,
  });
  if (error) throw error;
}

/**
 * Correct a shift that is already on the rota.
 *
 * `setShiftStatus` could pull one and `deleteShift` could remove one; neither
 * could change a time, a role, a note or — once part 196 landed — a rate. So a
 * shift entered an hour out could only be deleted and retyped, which is fine
 * for a rota and would not be for anything with history attached.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts.
 * `gym_shifts_owner` is `is_owner_of(tenant_id)` and is the only policy granting
 * UPDATE (`gym_shifts_staff_r` is SELECT only), so a trainer's edit matches zero
 * rows, returns no error, and leaves them watching a rota redraw unchanged.
 */
export async function updateShift(sb: Queryable, id: string, patch: ShiftPatch): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (patch.startsAt !== undefined) fields.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) fields.ends_at = patch.endsAt;
  if (patch.role !== undefined) fields.role = patch.role;
  if (patch.note !== undefined) fields.note = patch.note;
  // The two money columns move TOGETHER, always. Sending one without the other
  // is how a row ends up with an amount and no currency — which the database
  // would refuse outright, but as a constraint violation rather than as the
  // sentence `shiftBlocker` already wrote.
  if (patch.rateCents !== undefined || patch.currency !== undefined) {
    const cents = patch.rateCents ?? null;
    const cur = (patch.currency ?? '').trim().toUpperCase() || null;
    fields.rate_cents = cents;
    fields.currency = cents == null ? null : cur;
  }
  if (!Object.keys(fields).length) return;

  const r = await sb.from('gym_shifts').update(fields, { count: 'exact' }).eq('id', id);
  if (r.error) throw r.error;
  assertWrote('That change to the shift', r);
}

/**
 * Pull a shift, or put it back.
 *
 * Not a delete: the rota needs to distinguish an hour somebody dropped out of
 * from one nobody was ever booked for, and only a kept row can do that.
 */
export async function setShiftStatus(sb: Queryable, id: string, status: ShiftStatus): Promise<void> {
  // Counted, because an UPDATE matching zero rows is not an error — see
  // src/lib/wroteRows.ts. `gym_shifts_owner` is `is_owner_of(tenant_id)` and is
  // the only policy granting UPDATE (`gym_shifts_staff_r` is SELECT only), so a
  // trainer pulling their own shift changes nothing and, without this, watches
  // the rota reload with the shift still standing. The screen's own words are
  // the reason it matters: a pulled shift is meant to leave a visible hole, and
  // a pull that silently did not happen leaves an invisible one.
  const r = await sb.from('gym_shifts').update({ status }, { count: 'exact' }).eq('id', id);
  if (r.error) throw r.error;
  assertWrote(status === 'cancelled' ? 'Pulling that shift' : 'Putting that shift back', r);
}

/** Remove a shift that should never have been written. */
export async function deleteShift(sb: Queryable, id: string): Promise<void> {
  // A DELETE matching zero rows is the same silence as an UPDATE matching zero
  // rows, and reads worse: the caller believes the row is gone.
  const r = await sb.from('gym_shifts').delete({ count: 'exact' }).eq('id', id);
  if (r.error) throw r.error;
  assertWrote('That shift', r);
}
