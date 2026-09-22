// ── A member's own record of turning up ────────────────────────────────────
//
// Two tables hold it and neither was ever read by the client app.
// `class_bookings.attended_at` is the register a coach ticks in
// app/(trainer)/class-checkin.tsx; `gym_visits` (supabase/parts/32-door-log.sql)
// is the door log, which exists precisely because register-only attendance
// under-counts — part 32's own words: "every member who walks in, trains on the
// floor and leaves is invisible". Both are about the member. Only the gym could
// see them.
//
// Both ends are read from here now. `fetchMyAttendance` is the member's own
// history (app/(client)/attendance.tsx) and `fetchClientAttendance` is their
// coach's read of the same record (app/(trainer)/client-attendance.tsx) — the
// same rules, the same refusals, and one extra caveat that belongs only to the
// coach's side, set out above that function.
//
// Framework-agnostic, the shape src/lib/memberRecord.ts and src/lib/gymVisits.ts
// already use: the Supabase client arrives as an argument, so every rule below
// is testable without a database.
//
// ── The four rules this file exists to keep ────────────────────────────────
//
// 1. AN UNTICKED REGISTER IS NOT AN ABSENCE. `attended_at` null on a class that
//    has already run means one of two things: they did not come, or nobody took
//    the register. `set_class_attendance` is a coach pressing a button on their
//    phone, and a coach who is teaching does not always press it. Printing
//    "missed" over that is the app inventing an absence and handing it to the
//    member and — because their coach reads the same record — to the person
//    having the retention conversation with them. The word for it is `unmarked`.
//
//    Part 3060 added the one column that can separate the two, and this file
//    now reads it: `gym_classes.register_taken_at`. There is exactly ONE path
//    to `missed`, and it requires that column to be set — a booked seat, no
//    tick, no door record, the class has run, and somebody recorded that they
//    took the register. With the column null, this file still says `unmarked`
//    and still has no way to say anything else. A build that guessed would be
//    manufacturing the absence, and a gym may charge on one.
//
// 2. ONE TURNING-UP IS ONE ROW ON SCREEN. `gym_visits.class_id` is set "when the
//    visit was attendance at a booked class, so the two records reconcile
//    instead of double counting the same person" — again part 32's own comment.
//    A member who booked a class, walked through a door that logged them and was
//    ticked off by the coach generates two rows about one hour of their life.
//    `mergeAttendance` folds them into one, and a frequency built on the
//    unfolded pair would report double the training that happened.
//
// 3. NO DATE, NO PLACE ON THE TIMELINE. A class row this member is no longer
//    allowed to read (they changed gyms — see part 136) leaves a booking with no
//    start time. Such an event is neither dropped nor guessed onto a day: it is
//    carried out separately as `undated` so the screen can say "we have this and
//    cannot say when", which is true, instead of either silence or a wrong day.
//    `created_at` is NOT used as the fallback — that is when the seat was
//    booked, which is routinely a different week from when the class ran.
//
// 4. NO RATE FROM A PARTIAL RECORD. `rhythm` refuses to divide unless the read
//    came back whole AND the weeks it averages over lie entirely inside the
//    record. A member who joined three weeks ago, averaged across twelve, reads
//    as somebody who comes once a fortnight. That is a grade computed from
//    weeks that had not happened yet, and it is exactly what this codebase means
//    by inventing a figure.
import { capLimit, capped } from './rowCap';
import { readByIds } from './idLookup';
import { dayIndexInWeek } from './weekStart';

type Queryable = { from: (table: string) => any };

/** As on gym_visits.source. */
export type VisitSource = 'desk' | 'qr' | 'door' | 'app' | 'manual';

/**
 * As on class_bookings.status — the FOUR words part 3060 widened the CHECK to,
 * plus one word this file adds for a value it cannot name.
 *
 * 'cancelled' and 'late_cancelled' are spelled exactly as `sessions.outcome`
 * spells them (part 33) and exactly as src/lib/classRegister.ts and
 * src/lib/classSeat.ts spell them. Part 3060's own header: "A second spelling
 * of the same fact is its own defect". They are not near-misses to be
 * normalised — nothing here accepts 'canceled', 'late-cancelled' or
 * 'cancelled_late', because a build that quietly repaired a misspelling would
 * hide a database writing past its own constraint.
 *
 * 'unknown' is NOT a column value. It is this module's reading of a status word
 * this build has never heard of — a row written by a part that postdates it —
 * and it exists for the reason `seatStanding` has the same member and
 * `countRegister` has `unknownStanding`: a value nobody anticipated must not be
 * silently classified as one of the four. Before part 3060 that is exactly what
 * happened here, and it is the defect this lane exists for.
 */
export type BookingStatus =
  | 'booked'
  | 'waitlist'
  | 'cancelled'
  | 'late_cancelled'
  | 'unknown';

/** The four words the column may hold, spelled once. */
const BOOKED = 'booked';
const WAITLIST = 'waitlist';
const CANCELLED = 'cancelled';
const LATE_CANCELLED = 'late_cancelled';

/**
 * One `class_bookings.status` value → what this module will call it.
 *
 * Exported because it is the line this whole lane is about. Until part 3060 the
 * read said
 *
 *     status: r.status === 'waitlist' ? 'waitlist' : 'booked'
 *
 * which was correct for a two-value column and became a false statement the
 * moment the CHECK admitted two more: every cancellation arrived here as a
 * booking, and `classOutcome` then told the member their cancelled class was
 * either "still to come" or "not recorded either way". A late cancellation is
 * BILLABLE at a gym with a notice window (part 2615), so that second sentence
 * was the app losing the member's own evidence of a charge.
 *
 * Null, undefined and a blank string are 'unknown' and NOT 'booked'. The column
 * is `not null default 'booked'` so none of them should arrive — and a read
 * that produced one anyway is a read this module cannot interpret, which is not
 * the same fact as a member holding a seat.
 */
export function bookingStatus(raw: unknown): BookingStatus {
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.trim()) {
    case BOOKED: return 'booked';
    case WAITLIST: return 'waitlist';
    case CANCELLED: return 'cancelled';
    case LATE_CANCELLED: return 'late_cancelled';
    default: return 'unknown';
  }
}

/** The readable half of a gym_classes row. Null on an event means the row did
 *  not come back — never that the class does not exist. */
export interface ClassDetail {
  id: string;
  title: string;
  kind: string | null;
  instructor: string | null;
  branch: string | null;
  room: string | null;
  /** timestamptz — when the class ran. */
  startsAt: string;
  durationMin: number | null;
  tenantId: string | null;
  /**
   * `gym_classes.register_taken_at` (part 3060). NULL MEANS NOBODY TOOK THE
   * REGISTER — it does not mean nobody attended, and it is the column that
   * stops `attended_at is null` meaning two things at once.
   *
   * Nothing on the member's side read this before now: `classOutcome` had no
   * way to tell a no-show from a class whose register was never opened, so it
   * called both of them `unmarked`. That was the honest answer while the column
   * was unreadable and it is an under-statement now.
   *
   * OPTIONAL, and it means the same thing absent as it does null: nobody took
   * the register, or we did not find out — the two collapse here because both
   * produce `unmarked` and neither may produce `missed`. Optional rather than
   * required so that a `ClassDetail` assembled by something that predates part
   * 3060 keeps compiling and keeps the safe answer; the one construction site
   * that matters, `readAttendance` below, sets it explicitly from the column.
   */
  registerTakenAt?: string | null;
}

export interface MyBooking {
  id: string;
  classId: string;
  status: BookingStatus;
  /** When a coach or the desk marked them present. Null is rule 1. */
  attendedAt: string | null;
  /** When the seat was taken. Never used as the date of the class — rule 3. */
  bookedAt: string;
}

export interface MyVisit {
  id: string;
  tenantId: string;
  /** Set when the door entry was attendance at a class. Rule 2. */
  classId: string | null;
  enteredAt: string;
  /** Null means still inside, or the door records no exits. Not zero minutes. */
  exitedAt: string | null;
  source: VisitSource;
}

/** A read that either landed or did not. Same shape as memberRecord.ts, and for
 *  the same reason: `{ ok: false }` must not be reachable as an empty array. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/**
 * The local calendar day a timestamp falls on, as YYYY-MM-DD, or null.
 *
 * Local and not UTC, the same choice src/lib/gymVisits.ts made: a gym's Tuesday
 * is its own Tuesday, and a 22:00 session in Dubai belongs to that evening
 * rather than to the next UTC day. `npm run test:zones` runs the suite in three
 * zones so this cannot be right only in London.
 */
export function localDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days between two bare ISO dates, in UTC from the parsed components.
 *  Constructing local Dates and subtracting is 23 or 25 hours across a DST
 *  boundary, which is how a week silently becomes six days or eight. */
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from).trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to).trim());
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}

/** `day` shifted by n days, as a bare ISO date. UTC arithmetic, same reason. */
export function addDays(day: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The first day of the week `day` falls in — a Sunday, per src/lib/weekStart.ts,
 *  which is the one place in this product that decides. */
export function weekStart(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
  if (!m) return null;
  // UTC arithmetic on a bare date, like `addDays` above and for the same reason:
  // these strings are calendar days with no instant in them, and reading them
  // through a local zone would move half of them.
  const back = dayIndexInWeek(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay());
  return addDays(day, -back);
}

/**
 * What actually happened at one class, as states a screen must word differently.
 *
 * Rule 1 lives here. `unmarked` is the state that has no register tick and no
 * door record for a class that has already run, and the ONLY honest sentence
 * for it is that the gym did not record it — which is why it carries no
 * "attended" boolean a caller could accidentally read as false.
 */
export type ClassOutcome =
  /** They were there. `register` and `door` say which record proves it. */
  | { kind: 'attended'; register: boolean; door: boolean }
  /** The class has run and nothing was recorded either way. NOT an absence.
   *  Reached when the register was never taken, when this build could not find
   *  out whether it was, and when the booking's standing is a word this build
   *  cannot read — every case in which the honest answer is that a human has to
   *  look. */
  | { kind: 'unmarked' }
  /**
   * The class ran, they held the seat, nobody ticked them in, AND SOMEBODY TOOK
   * THE REGISTER. Only then.
   *
   * 'missed' is `PastState`'s word for a no-show (src/lib/sessionHistory.ts,
   * where `pastVerdict` maps `sessions.outcome = 'no_show'` onto it) and
   * `bookingVerdict`'s answer for the same row on the coach's side. A third
   * spelling here would be the defect part 3060's header names.
   */
  | { kind: 'missed' }
  /** They gave the seat up outside the gym's notice period. */
  | { kind: 'cancelled' }
  /** They gave it up inside it. The one a gym may charge a fee for, and the one
   *  that did not exist as a recordable fact until part 3060. */
  | { kind: 'late_cancelled' }
  /** Still to come. */
  | { kind: 'upcoming' }
  /** Never got a seat, so there was nothing to turn up to. */
  | { kind: 'waitlisted' }
  /** We cannot read when the class was, so we cannot say whether it has run. */
  | { kind: 'unknown' };

/**
 * Whether somebody took the register for this class.
 *
 * The FACT is the column being set, not the timestamp being parseable: a
 * `timestamptz` that arrived as a string this module cannot parse is still a
 * register somebody took, and reading it as "not taken" would throw away the
 * evidence. Trimmed, because the empty string is PostgREST rendering nothing
 * and is not a time.
 */
function registerWasTaken(registerTakenAt: string | null | undefined): boolean {
  return typeof registerTakenAt === 'string' && registerTakenAt.trim() !== '';
}

/**
 * `registerTakenAt` defaults to null, and that default is load-bearing.
 *
 * A caller that has not been taught to read `gym_classes.register_taken_at`
 * gets exactly the behaviour this function has always had — everything
 * un-ticked reported as `unmarked`, never as `missed`. The same tri-state
 * discipline `countRegister` and `bookingVerdict` keep in
 * src/lib/classRegister.ts, and for the same reason: a build that guessed "the
 * register was taken" when it did not know would manufacture a no-show, and a
 * no-show is a thing gyms bill for.
 */
export function classOutcome(
  b: Pick<MyBooking, 'status' | 'attendedAt'>,
  startsAt: string | null,
  hasDoorRecord: boolean,
  now: Date,
  registerTakenAt: string | null = null,
): ClassOutcome {
  const register = !!b.attendedAt;
  // Evidence first: a member marked present, or logged through the door, was
  // there — whatever the class row says about the time, and whether or not the
  // seat was ever converted off the waitlist.
  //
  // This stays ahead of the cancellation test, and the two modules DIVERGE
  // here: `bookingVerdict` reads a cancelled booking that is also ticked in as
  // 'unmarked', because a coach may bill on its answer and two recorded facts
  // that disagree must not have a winner picked for them. This function feeds
  // `attendedDays`, and a member who cancelled their 6pm class, came to the gym
  // anyway and was logged through the door DID come that day — dropping the
  // event would delete a day of their own record on the strength of a status
  // word. Different questions, and the divergence is stated rather than left to
  // be discovered.
  if (register || hasDoorRecord) return { kind: 'attended', register, door: hasDoorRecord };

  // The cancellation outranks the clock, both ways round. A cancelled class
  // that has not run yet is NOT "still to come" — that sentence tells a member
  // they hold a seat they gave up, which is how somebody arranges their evening
  // around a class the gym is not expecting them at. One that HAS run is not
  // "nobody marked it either way": the member marked it themselves, and on a
  // late cancellation that record is the evidence behind a fee.
  if (b.status === 'cancelled') return { kind: 'cancelled' };
  if (b.status === 'late_cancelled') return { kind: 'late_cancelled' };

  if (b.status === 'waitlist') return { kind: 'waitlisted' };
  // A standing this build cannot name. `bookingVerdict` answers 'unmarked' for
  // the same row and says why: a vocabulary this file extends on its own is a
  // vocabulary the rest of the product cannot read. `unmarked` is the state
  // that asks a human to look, which is the correct answer to a word nobody
  // here can interpret — and, unlike every other branch below, it is reached
  // without consulting the clock, because "we cannot read your standing" is
  // true whether or not the class has run.
  if (b.status === 'unknown') return { kind: 'unmarked' };
  if (!startsAt) return { kind: 'unknown' };
  const t = Date.parse(startsAt);
  if (Number.isNaN(t)) return { kind: 'unknown' };
  if (t > now.getTime()) return { kind: 'upcoming' };
  // The class has run, the seat was held, and nobody ticked them off. Rule 1
  // says which of the two this is, and part 3060 added the column that decides:
  // with a register taken, an un-ticked booked member is a NO-SHOW; without
  // one, nobody has said anything and the only honest word is `unmarked`.
  return registerWasTaken(registerTakenAt) ? { kind: 'missed' } : { kind: 'unmarked' };
}

/** One occasion this member was at the gym, however it came to be recorded. */
export interface AttendanceEvent {
  /** Stable across reloads: the class id, or the visit id for a floor visit. */
  key: string;
  source: 'class' | 'floor';
  /** When it happened. Null only on a class whose row we could not read. */
  at: string | null;
  /** Local day of `at`, or null. Rule 3: a null here keeps the event off every
   *  count in this file rather than putting it on a guessed day. */
  day: string | null;
  /** Which gym, when we can tell. Read off the row, never assumed. */
  tenantId: string | null;
  /** Present for a class event. Null means the class row did not come back. */
  klass: ClassDetail | null;
  /** Present for a class event, so a screen can say "you booked this". */
  booking: MyBooking | null;
  outcome: ClassOutcome;
  /** The door record, when there is one — for the floor visit it IS the event,
   *  and for a class it is the second proof folded in under rule 2. */
  visit: MyVisit | null;
}

/** Minutes inside, or null when there is no exit. Never 0 for an open visit —
 *  the same refusal src/lib/gymVisits.ts makes, for the same reason. */
export function dwellMinutes(v: Pick<MyVisit, 'enteredAt' | 'exitedAt'> | null): number | null {
  if (!v || !v.exitedAt) return null;
  const a = Date.parse(v.enteredAt);
  const b = Date.parse(v.exitedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const mins = (b - a) / 60000;
  return mins < 0 ? null : Math.round(mins);
}

/**
 * The two records, folded into one timeline, newest first.
 *
 * Rule 2 is the whole job. A visit carrying a class_id is the SAME occasion as
 * the booking for that class, so it is attached to that event rather than
 * emitted beside it. A visit carrying a class_id we hold no booking for is
 * still one occasion — the desk logged them into a class they never booked —
 * and becomes a class event on its own.
 *
 * `undated` is separate rather than sorted to the end: those events cannot be
 * placed in time at all, and a screen that mixes them into the list implies an
 * ordering that does not exist.
 */
export function mergeAttendance(
  bookings: MyBooking[],
  visits: MyVisit[],
  classes: Map<string, ClassDetail>,
  now: Date,
): { events: AttendanceEvent[]; undated: AttendanceEvent[] } {
  // The door record for each class, if any. First one wins: a member logged in
  // and out twice around one class attended it once.
  const doorByClass = new Map<string, MyVisit>();
  for (const v of visits) {
    if (v.classId && !doorByClass.has(v.classId)) doorByClass.set(v.classId, v);
  }

  const out: AttendanceEvent[] = [];
  const seenClass = new Set<string>();

  const classEvent = (classId: string, booking: MyBooking | null): AttendanceEvent => {
    const klass = classes.get(classId) ?? null;
    const visit = doorByClass.get(classId) ?? null;
    // The class's own start time is the occasion. `attendedAt` and the door
    // entry are when somebody pressed something, which is close enough to stand
    // in when the class row is unreadable — and `bookedAt` is not, so it is not
    // in this chain. Rule 3.
    const at = klass?.startsAt ?? booking?.attendedAt ?? visit?.enteredAt ?? null;
    const b = booking ?? { id: `visit:${classId}`, classId, status: 'booked' as BookingStatus, attendedAt: null, bookedAt: at ?? '' };
    return {
      key: `class:${classId}`,
      source: 'class',
      at,
      day: localDay(at),
      tenantId: klass?.tenantId ?? visit?.tenantId ?? null,
      klass,
      booking,
      // `?? null` and not `klass?.registerTakenAt`: a class row we could not
      // read has no register fact, and `undefined` must reach `classOutcome` as
      // the same "we do not know" that null is rather than as a third thing.
      outcome: classOutcome(b, klass?.startsAt ?? null, !!visit, now, klass?.registerTakenAt ?? null),
      visit,
    };
  };

  for (const b of bookings) {
    if (seenClass.has(b.classId)) continue;
    seenClass.add(b.classId);
    out.push(classEvent(b.classId, b));
  }
  for (const v of visits) {
    if (v.classId) {
      if (seenClass.has(v.classId)) continue;
      seenClass.add(v.classId);
      out.push(classEvent(v.classId, null));
      continue;
    }
    out.push({
      key: `visit:${v.id}`,
      source: 'floor',
      at: v.enteredAt,
      day: localDay(v.enteredAt),
      tenantId: v.tenantId,
      klass: null,
      booking: null,
      // A door log IS the gym's record that they came in. There is no register
      // to be untaken on the floor, so this never reaches `unmarked`.
      outcome: { kind: 'attended', register: false, door: true },
      visit: v,
    });
  }

  const dated = out.filter((e) => e.day !== null);
  const undated = out.filter((e) => e.day === null);
  dated.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key));
  undated.sort((a, b) => a.key.localeCompare(b.key));
  return { events: dated, undated };
}

/**
 * The distinct local days this member was recorded at a gym, newest first.
 *
 * Days rather than events, because two classes on one Saturday is one day of
 * training and a screen counting "times you came" should not say two. Only
 * events that PROVE attendance count: an upcoming class is not a visit, and an
 * unmarked one is not evidence of anything (rule 1).
 */
export function attendedDays(events: AttendanceEvent[]): string[] {
  const days = new Set<string>();
  for (const e of events) {
    if (e.outcome.kind !== 'attended') continue;
    if (e.day) days.add(e.day);
  }
  return [...days].sort((a, b) => b.localeCompare(a));
}

export interface RhythmWeek {
  /** The day the week opened, as a bare ISO date. See src/lib/weekStart.ts. */
  start: string;
  /** True once the week has finished, so it can be compared with the others. */
  complete: boolean;
  /** True when the whole week lies at or after the first day on record. */
  covered: boolean;
  /** Days in this week the member was recorded at a gym. */
  days: number;
}

export interface Rhythm {
  /** Most recent week first. Always `weeks` long — a week with nothing in it is
   *  a real answer once it is `covered`, and a gap otherwise. */
  weeks: RhythmWeek[];
  /** The earliest day on record. Before it, this app knows nothing. */
  firstDay: string | null;
  /** Weeks that are both complete and covered — the ones the mean is over. */
  countedWeeks: number;
  /**
   * Mean days-attended per week, or NULL.
   *
   * Null whenever it would be a grade rather than a measurement: the read did
   * not come back whole, or there is not one finished week wholly inside the
   * record to average. Rule 4. Callers render null as a dash; nothing in this
   * codebase may substitute a zero for it.
   */
  perWeek: number | null;
}

/**
 * How often this member actually comes, over the last `weeks` weeks.
 *
 * `whole` is the caller's LoadStatus reduced to one question — did we get all
 * the rows. It is a parameter rather than a thing this function infers, because
 * the only place that knows is the read, and a mean over a truncated read is
 * the silent-wrong-number failure src/lib/rowCap.ts exists to stop.
 *
 * The current week is listed and NOT averaged: a Tuesday cannot be compared
 * with seven finished days, and including it drags every mean down for four
 * days out of every seven.
 */
export function rhythm(
  days: string[], today: string, weeks: number, whole: boolean,
): Rhythm {
  const thisWeek = weekStart(today);
  const sorted = [...days].filter((d) => weekStart(d) !== null).sort();
  const firstDay = sorted.length ? sorted[0] : null;
  if (!thisWeek || weeks <= 0) {
    return { weeks: [], firstDay, countedWeeks: 0, perWeek: null };
  }

  const byWeek = new Map<string, Set<string>>();
  for (const d of sorted) {
    const w = weekStart(d);
    if (!w) continue;
    if (!byWeek.has(w)) byWeek.set(w, new Set());
    byWeek.get(w)!.add(d);
  }

  const out: RhythmWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(thisWeek, -7 * i);
    if (!start) continue;
    const end = addDays(start, 6)!;
    out.push({
      start,
      complete: end < today,
      // A week beginning before the member's first record is a week we have no
      // information about, not a week they did not come.
      covered: firstDay != null && start >= firstDay,
      days: byWeek.get(start)?.size ?? 0,
    });
  }

  const counted = out.filter((w) => w.complete && w.covered);
  const perWeek = whole && counted.length
    ? Math.round((counted.reduce((s, w) => s + w.days, 0) / counted.length) * 10) / 10
    : null;
  return { weeks: out, firstDay, countedWeeks: counted.length, perWeek };
}

/**
 * One bar of the rhythm strip, said in words.
 *
 * ── Why this is a function and not a `title` on the bar ───────────────────
 *
 * The strip draws four different facts and draws every one of them as a shape:
 * a filled bar is a week with days in it, a flat grey bar is a covered week
 * with none, a dashed outline is a week this app knows nothing about, and
 * reduced opacity is the current week, which is not over. The number underneath
 * is printed as `w.days || ''`, so a covered week with ZERO days and an
 * uncovered week are both blank — the two are told apart by a border style and
 * nothing else.
 *
 * That distinction is not decorative. This screen's own header refuses to
 * compute an absence, and says the strip "marks the weeks it knows nothing
 * about as exactly that". A dashed border is not "exactly that" to somebody
 * using a screen reader, in bright sun, or with any of the colour vision the
 * rest of this file's palette is contrast-tested for — and "you did not come
 * that week" is the one sentence this screen was written not to say by
 * accident.
 *
 * `weekOf` is the week's start already formatted by the caller, for the reason
 * every prose module here takes its dates that way: a bare `getDate()` is
 * "9/12", which is 9 December in London and 12 September in New York, and there
 * is no locale in a pure module (scripts/check-hand-dates.mjs).
 */
export function rhythmWeekLabel(w: RhythmWeek, weekOf: string): string {
  const when = weekOf.trim();
  const head = when ? `Week of ${when}` : 'That week';
  // Checked before the count, and that order is the whole of it: `days` is 0
  // for an uncovered week too, and reading the zero first is exactly how "we
  // have no record" becomes "you did not come".
  if (!w.covered) {
    return `${head}: nothing on record. Your gym's record of you starts later than this, so this is not a week you stayed away.`;
  }
  const n = w.days;
  const dayWord = n === 1 ? '1 day' : `${n} days`;
  if (!w.complete) {
    // The current week. Never phrased as a total: four days by Thursday is not
    // four days in a week, and the caption under the strip already says the
    // last bar is unfinished.
    return n === 0
      ? `${head}: nothing recorded yet. This week is not over.`
      : `${head}: ${dayWord} so far. This week is not over.`;
  }
  return n === 0
    ? `${head}: no days recorded.`
    : `${head}: ${dayWord} recorded.`;
}

/* ── the reads ────────────────────────────────────────────────────────────── */

const BOOKING_COLUMNS = 'id, class_id, status, attended_at, created_at';
const VISIT_COLUMNS = 'id, tenant_id, class_id, entered_at, exited_at, source';
// `register_taken_at` is part 3060's column and is APPLIED — verified in that
// part's header against the live project on 13 Sep 2026. Naming it here means
// this build requires 3060: against a database without the column PostgREST
// answers 42703 and the class read fails, which lands on `classesComplete:
// false` and the sentence the screen already has for unlabelled rows. That is
// the correct failure. Leaving the column out instead would have been a build
// that reads every no-show as unmarked with nothing anywhere saying so.
const CLASS_COLUMNS = 'id, tenant_id, title, kind, instructor, branch, room, starts_at, duration_min, register_taken_at';

// `gym_visits.note` is in neither list, deliberately. It is free text the DESK
// writes, in a row the member can read, and RLS cannot help — staff authenticate
// as `authenticated` too, so a column revoke would take it from the console as
// well. Part 125 made the same note about memberships.note. Not selecting it is
// the part this app controls.

const asSource = (v: unknown): VisitSource =>
  (v === 'qr' || v === 'door' || v === 'app' || v === 'manual') ? v : 'desk';

export interface AttendanceRecord {
  bookings: MyBooking[];
  visits: MyVisit[];
  classes: Map<string, ClassDetail>;
  /** True when either list came back at its row cap, so it is a prefix of the
   *  real one. A screen may LIST these and must not compute a rate from them. */
  truncated: boolean;
  /** True when the class rows for every id we hold came back. False means at
   *  least one event will be unlabelled — the screen says so rather than
   *  showing a blank where a class name goes. */
  classesComplete: boolean;
}

/**
 * Everything the gym has recorded about this member turning up.
 *
 * Three plain queries and no embedded select. `class_bookings` and `gym_visits`
 * BOTH carry a foreign key to `gym_classes`, so asking PostgREST to embed it
 * produces the PGRST201 ambiguity documented in src/lib/gymSessions.ts — and
 * separately, an embed that RLS refused arrives as `gym_classes: null`, which
 * is indistinguishable from no class at all. Fetching by the ids we already
 * hold keeps "the gym recorded no class" and "we were not allowed to read it"
 * apart, which is rule 3 and the same argument part 125 made about plans.
 *
 * A failed CLASS read does not fail the call: the attendance is real and worth
 * showing without its label. A failed BOOKING or VISIT read does, because the
 * alternative is an empty list that reads as "you have never been in".
 */
export async function fetchMyAttendance(sb: Queryable, uid: string): Promise<Read<AttendanceRecord>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  return readAttendance(sb, uid);
}

/**
 * The same three queries, for whoever's record is being read.
 *
 * One body rather than two, because the honesty of this module is in the
 * BRANCHES — a failed class read that does not fail the call, a class id with
 * no row that lands on `classesComplete: false` — and two copies of that is two
 * places for one of those branches to be dropped. Which rows come back is
 * decided by RLS from the caller's own session, never by an argument here: the
 * member arm is `class_bookings_self_r` / `gym_visits_own_r`, the coach's is
 * `class_bookings_staff_r` / `gym_visits_staff_rw` (parts 165 and 32), and this
 * function is the same three selects under both.
 */
async function readAttendance(sb: Queryable, uid: string): Promise<Read<AttendanceRecord>> {
  try {
    const [bookingRes, visitRes] = await Promise.all([
      sb.from('class_bookings').select(BOOKING_COLUMNS)
        .eq('user_id', uid)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      sb.from('gym_visits').select(VISIT_COLUMNS)
        .eq('member_id', uid)
        .order('entered_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
    ]);
    if (bookingRes.error) return { ok: false, reason: bookingRes.error.message || 'The read was refused.' };
    if (visitRes.error) return { ok: false, reason: visitRes.error.message || 'The read was refused.' };

    const bookingPage = capped((bookingRes.data as any[]) ?? []);
    const visitPage = capped((visitRes.data as any[]) ?? []);

    const bookings: MyBooking[] = bookingPage.rows.map((r) => ({
      id: String(r.id),
      classId: String(r.class_id),
      status: bookingStatus(r.status),
      attendedAt: r.attended_at ?? null,
      bookedAt: r.created_at,
    }));
    const visits: MyVisit[] = visitPage.rows.map((r) => ({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      classId: r.class_id ? String(r.class_id) : null,
      enteredAt: r.entered_at,
      exitedAt: r.exited_at ?? null,
      source: asSource(r.source),
    }));

    const classIds = [...new Set([
      ...bookings.map((b) => b.classId),
      ...visits.map((v) => v.classId).filter(Boolean) as string[],
    ])];

    const classes = new Map<string, ClassDetail>();
    let classesComplete = true;
    if (classIds.length) {
      // CHUNKED, about the REQUEST LINE and not the row ceiling. `classIds` is
      // the union of two `capLimit()` reads, so up to two thousand uuids; at
      // ~39 bytes each inside a PostgREST `in.("…","…")` list that is a ~78KB
      // query string against the 8KB request line nginx and most CDNs enforce.
      // Refused past roughly two hundred with a **414**, which supabase-js does
      // not reject on and which arrives as `data: null`.
      //
      // Two hundred distinct classes is not a stress case: a member doing four
      // classes a week crosses it inside a year, and this read is unwindowed.
      // The consequence is a member's whole attendance history rendered as
      // untitled, undated, uninstructed rows — `classesComplete` would not even
      // have said so, because a 414 sets `error` to null.
      try {
        const rows = await readByIds<any>(
          classIds,
          // `.order('id')` on a primary-key lookup is total, which is the
          // contract `readAll` requires of every page it is handed.
          (chunk, from, to) => sb.from('gym_classes').select(CLASS_COLUMNS)
            .in('id', chunk).order('id', { ascending: true }).range(from, to),
          'the classes behind this attendance history',
        );
        for (const r of rows) {
          classes.set(String(r.id), {
            id: String(r.id),
            title: typeof r.title === 'string' ? r.title : '',
            kind: r.kind || null,
            instructor: r.instructor || null,
            branch: r.branch || null,
            room: r.room || null,
            startsAt: r.starts_at,
            durationMin: Number.isFinite(Number(r.duration_min)) ? Number(r.duration_min) : null,
            tenantId: r.tenant_id ?? null,
            // Read as a string or as nothing. Not coerced, not dated, not
            // defaulted — an absent column on a row from a database that has
            // not had part 3060 applied arrives as `undefined`, and the one
            // thing it must never become is a timestamp, because that would
            // turn every un-ticked booked member into a recorded no-show.
            registerTakenAt: typeof r.register_taken_at === 'string' ? r.register_taken_at : null,
          });
        }
        // Not an error and not a silence: a class id with no row came back is a
        // class this member is no longer allowed to read, and the screen has a
        // sentence for it.
        if (classes.size < classIds.length) classesComplete = false;
      } catch {
        // `readByIds` throws a refused chunk rather than returning a short set,
        // which is the point of it — a history assembled from the chunks that
        // happened to work is one whose gaps are invisible. Caught here rather
        // than allowed out, because the bookings and visits themselves READ
        // fine and are worth showing; `classesComplete: false` is the sentence
        // the screen already has for "these rows are real but unlabelled".
        classesComplete = false;
      }
    }

    return { ok: true, value: {
      bookings, visits, classes,
      truncated: bookingPage.truncated || visitPage.truncated,
      classesComplete,
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/* ── the coach's side of the same record ──────────────────────────────────── */

/**
 * One client's attendance, read by their coach.
 *
 * The rules above do not change because the reader did. Rule 1 is the reason
 * this exists: the header names the person "having the retention conversation"
 * as the one an invented absence gets handed to, and that person is the coach.
 * A coach reading `unmarked` as "missed" rings a client to ask why they have
 * stopped coming, about a class they were at.
 *
 * ── What the coach's read is scoped by, and why it is not the roster ───────
 *
 * Nothing here filters by coaching relationship, because RLS already decides
 * this and the app must not appear to decide it a second time. A coach reaches
 * these rows as GYM STAFF: `class_bookings_staff_r` (part 165) admits bookings
 * on classes whose `gym_classes.tenant_id = my_tenant()`, and
 * `gym_visits_staff_rw` (part 32) admits visits with the same tenant. Both are
 * the door-log line part 165 states in full — working the door is staff work.
 *
 * The consequence is the one thing a screen over this must carry, and it is why
 * `staffScopeNote` below exists rather than being prose in a component:
 *
 *   · A coach with NO gym (`my_tenant()` null — an independent coach, which
 *     this product has plenty of) matches neither policy and gets ZERO ROWS AND
 *     NO ERROR. RLS filters; it does not refuse. That empty result is
 *     byte-identical to a client who has genuinely never been recorded.
 *   · A client who also trains at another gym has rows this coach cannot see,
 *     so even a full read is this gym's record and not the client's life.
 *
 * `{ ok: true }` with an empty list therefore does NOT mean "they have not been
 * in", and the only honest screen is one that says which of the two it is
 * looking at. It cannot work that out from the rows, so it is told.
 */
export async function fetchClientAttendance(sb: Queryable, clientId: string): Promise<Read<AttendanceRecord>> {
  if (!clientId) return { ok: false, reason: 'No client to read.' };
  return readAttendance(sb, clientId);
}

/**
 * Whether an empty coach-side read is an answer at all — and the sentence for
 * it when it is not.
 *
 * `hasGym` is the coach's own tenant as their profile has it: true, false, or
 * NULL for "we could not find out", which is `useTenant`'s 'error' and is a
 * third state rather than a falsy second one.
 *
 * Returns null when an empty list is a real answer the screen may state, and a
 * sentence otherwise. The sentence never contains a number and never contains
 * the word "no" about the client — it is about the read, because that is the
 * only thing that is known.
 */
export function staffScopeNote(hasGym: boolean | null): string | null {
  if (hasGym === null) {
    return 'We could not tell which gym your account belongs to, so we cannot say whether this is '
      + 'their whole record or none of it.';
  }
  if (!hasGym) {
    return 'Your account is not attached to a gym, so this app can read neither a class register nor '
      + 'a door log for anybody. Nothing below is a record of them staying away. There is no record '
      + 'here to read.';
  }
  return null;
}

/** What a coach is looking at even on a whole read, said once. A client trains
 *  where they like, and one gym's record is one gym's record. */
export const STAFF_RECORD_NOTE =
  'This is your gym’s own record of them. Classes and visits at anywhere else are not in it.';
