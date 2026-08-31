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
//    having the retention conversation with them. The word for it is `unmarked`
//    and there is no code path in this file that turns it into `missed`.
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

type Queryable = { from: (table: string) => any };

/** As on gym_visits.source. */
export type VisitSource = 'desk' | 'qr' | 'door' | 'app' | 'manual';

/** As on class_bookings.status. */
export type BookingStatus = 'booked' | 'waitlist';

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

/** The Monday of the week `day` falls in. Monday because a gym's week is a
 *  training week, and nobody plans "three sessions, Sunday to Saturday". */
export function weekStart(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
  if (!m) return null;
  // getUTCDay: 0 Sunday … 6 Saturday. Monday is 0 days back, Sunday is 6.
  const back = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
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
  /** The class has run and nothing was recorded either way. NOT an absence. */
  | { kind: 'unmarked' }
  /** Still to come. */
  | { kind: 'upcoming' }
  /** Never got a seat, so there was nothing to turn up to. */
  | { kind: 'waitlisted' }
  /** We cannot read when the class was, so we cannot say whether it has run. */
  | { kind: 'unknown' };

export function classOutcome(
  b: Pick<MyBooking, 'status' | 'attendedAt'>,
  startsAt: string | null,
  hasDoorRecord: boolean,
  now: Date,
): ClassOutcome {
  const register = !!b.attendedAt;
  // Evidence first: a member marked present, or logged through the door, was
  // there — whatever the class row says about the time, and whether or not the
  // seat was ever converted off the waitlist.
  if (register || hasDoorRecord) return { kind: 'attended', register, door: hasDoorRecord };
  if (b.status === 'waitlist') return { kind: 'waitlisted' };
  if (!startsAt) return { kind: 'unknown' };
  const t = Date.parse(startsAt);
  if (Number.isNaN(t)) return { kind: 'unknown' };
  return t > now.getTime() ? { kind: 'upcoming' } : { kind: 'unmarked' };
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
      outcome: classOutcome(b, klass?.startsAt ?? null, !!visit, now),
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
  /** Monday, as a bare ISO date. */
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

/* ── the reads ────────────────────────────────────────────────────────────── */

const BOOKING_COLUMNS = 'id, class_id, status, attended_at, created_at';
const VISIT_COLUMNS = 'id, tenant_id, class_id, entered_at, exited_at, source';
const CLASS_COLUMNS = 'id, tenant_id, title, kind, instructor, branch, room, starts_at, duration_min';

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
      status: r.status === 'waitlist' ? 'waitlist' : 'booked',
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
      const { data: rows, error } = await sb.from('gym_classes')
        .select(CLASS_COLUMNS).in('id', classIds).limit(capLimit());
      if (error) classesComplete = false;
      else {
        for (const r of capped((rows as any[]) ?? []).rows) {
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
          });
        }
        // Not an error and not a silence: a class id with no row came back is a
        // class this member is no longer allowed to read, and the screen has a
        // sentence for it.
        if (classes.size < classIds.length) classesComplete = false;
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
