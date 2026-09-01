// The gym's timetable, and who turned up to it.
//
// Attendance is the most valuable row in the whole database. Retention is
// visible in it long before a cancellation arrives, and none of the forecasting
// in Phase 7 can learn anything without it. Everything here exists to get that
// row recorded.
//
// Framework-agnostic, like gymTrainers and gymRecord: the Supabase client comes
// in as an argument so neither front end owns this.

import { readAll } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any; rpc?: (fn: string, args?: any) => any };

export interface GymClass {
  id: string;
  title: string;
  room: string | null;
  instructor: string | null;
  trainerId: string | null;
  startsAt: string;
  durationMin: number;
  capacity: number;
  /**
   * PLACES SOLD — bookings whose status is `booked`, filled in by
   * `fetchClasses`. Waitlisters are not in here and never were meant to be.
   *
   * This counted every booking row that was not `'cancelled'`, and
   * `class_bookings.status` is `check (status in ('booked','waitlist'))` — the
   * constraint FORBIDS the value the filter was looking for, so the filter
   * matched nothing and every waitlister was counted as a place sold. On a
   * class of 12 with 5 people waiting, fill read 17/12 = 142% and show read
   * attended ÷ 17, both wrong, both in the direction that flatters the fill and
   * damns the coach. /classes then printed a banner over the top asserting "it
   * is a real over-sell, not a rounding artefact" about a number that was
   * neither.
   */
  booked: number;
  /** Of the places sold, how many were marked present. */
  attended: number;
  /**
   * People waiting for a place, counted separately because they are a
   * different fact: demand the gym did not sell. It belongs nowhere near
   * fill's numerator and everywhere near a decision to put another class on.
   */
  waitlisted: number;
  /**
   * Waitlisters somebody marked present. The register lists every booking
   * whatever its status and the tick is one button, so this happens — a place
   * came free at the door and the coach ticked the row in front of them.
   *
   * Kept out of `attended` on purpose: `attended ÷ booked` is "of the places we
   * sold, how many walked in", and a number that can exceed its own
   * denominator is not a rate. Counted rather than discarded, because these are
   * real people who really trained.
   */
  waitlistAttended: number;
}

/**
 * How full a class is, for the mark beside it.
 *
 * The words keep the exact number — `capacity - booked` is a real subtraction
 * of two real rows and there is no reason to blur it into "Nearly Full" the
 * way a chain does when it would rather not publish its capacity. What the
 * number cannot do is carry urgency at a glance: "12 spots left" and "2 spots
 * left" were the same grey dot, so a class about to go was indistinguishable
 * from an empty one.
 *
 * The threshold is proportional with a floor, because neither alone works: 3
 * spots is nearly full in a class of 8 and half empty in a class of 60.
 */
export type ClassFill = 'open' | 'nearly' | 'full';

export function classFillState(capacity: number, booked: number): ClassFill {
  const cap = Math.max(0, Math.floor(capacity));
  const left = Math.max(0, cap - Math.max(0, Math.floor(booked)));
  if (cap <= 0 || left === 0) return 'full';
  return left <= Math.max(2, Math.ceil(cap * 0.15)) ? 'nearly' : 'open';
}

export interface RosterEntry {
  bookingId: string;
  userId: string;
  name: string | null;
  status: string;
  attendedAt: string | null;
}

/* ── timetable ─────────────────────────────────────────────────────────────── */

/**
 * How many class ids go into one `.in(...)` filter.
 *
 * PostgREST takes the filter in the query string, so a thousand uuids is a URL
 * of roughly forty kilobytes and the gateway in front of it rejects the request
 * outright. That failure is at least loud — it throws — but it takes the whole
 * timetable with it, and the number is not worth discovering in production.
 * 150 matches studio-web/app/export/page.tsx, which met this first.
 */
const ID_CHUNK = 150;

/**
 * The timetable in a window, and what was booked against it.
 *
 * ── Why both reads are paginated rather than capped ────────────────────────
 *
 * PostgREST stops at 1000 rows and says nothing (src/lib/rowCap.ts). The house
 * answer to that is usually `assertWhole`: refuse to report a figure computed
 * from part of a set. It is the wrong answer for these two, for two different
 * reasons.
 *
 * The BOOKINGS read is the sharper one. Bookings are counted PER CLASS, so
 * truncation does not make a figure smaller — every class whose rows fell off
 * the end reports `booked: 0` and `attended: 0`. That is the same false-figure
 * shape the `.error` check below already guards against, arriving by a
 * different door: a false statement about a named class on a named evening,
 * which an owner reads as a class nobody wants and cancels. And it is not rare
 * — 150 classes at a dozen bookings each is past the cap inside three weeks.
 *
 * The CLASSES read is ordered ascending, so truncation would drop the LATEST
 * classes: the timetable would simply stop partway through the month, and the
 * screen showing it has no way to know. Refusing instead would be defensible,
 * but every caller has already bounded this read to a window it chose, so the
 * set is finite by construction and there is nothing to protect by refusing.
 * /export is the one caller that asks for all of time, and it is the one that
 * most needs the answer: a gym that cannot take its timetable with it does not
 * have its record.
 *
 * Both orders are TOTAL — `id` breaks the tie. Postgres promises no order
 * between rows that tie, each page is a separate request that may be planned
 * differently, and a row written between two pages shifts every offset after
 * it. Two classes at 6am is not a hypothetical; a page boundary landing between
 * them silently is.
 */
export async function fetchClasses(
  sb: Queryable, tenantId: string, fromISO: string, toISO: string,
): Promise<GymClass[]> {
  const rows = await readAll<any>(
    (from, to) => sb
      .from('gym_classes')
      .select('id, title, room, instructor, trainer_id, starts_at, duration_min, capacity')
      .eq('tenant_id', tenantId)
      .gte('starts_at', fromISO)
      .lte('starts_at', toISO)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'the classes in this window',
  );
  if (!rows.length) return [];

  // One query for every booking in the window rather than one per class.
  //
  // The `.error` check inside readAll is not decoration. supabase-js RESOLVES
  // on a database error, so without it a failed read arrives as `data === null`,
  // falls through `?? []`, and every class in the window reports 0 booked and
  // 0 attended. That is a FALSE FIGURE, not a blank: a gym opens the timetable,
  // sees an empty week, and concludes nobody is coming. The classes query above
  // has always thrown; this one silently did not.
  const ids = rows.map((r: any) => r.id);
  const bookings: any[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const slice = ids.slice(i, i + ID_CHUNK);
    const page = await readAll<any>(
      (from, to) => sb
        .from('class_bookings')
        .select('class_id, status, attended_at, id')
        .in('class_id', slice)
        .order('id', { ascending: true })
        .range(from, to),
      'the bookings for the classes in this window',
    );
    // Appended one at a time rather than spread. `push(...page)` passes every
    // row as an argument, and a chunk of tens of thousands overflows the call
    // stack — a crash that would only ever happen at the busiest gym.
    for (const b of page) bookings.push(b);
  }

  // ── Counted by the status the constraint actually permits ────────────────
  //
  // This was `if (b.status === 'cancelled') return;` — a filter for a value
  // `class_bookings` has never been able to hold. The column is
  // `check (status in ('booked','waitlist'))`, cancelling is a DELETE
  // (`cancel_class` in part 02 deletes the row and promotes the next
  // waitlister), and so the guard matched nothing on every row of every class
  // and waitlisters were added to `booked` as though they were places sold.
  //
  // Testing for the value that IS there rather than the one that is not also
  // fails in the safe direction if the constraint is ever widened: an
  // unrecognised status stops being a place sold rather than silently becoming
  // one. That is the whole difference between the two spellings.
  const tally = tallyBookings(bookings);

  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    room: r.room ?? null,
    instructor: r.instructor ?? null,
    trainerId: r.trainer_id ?? null,
    startsAt: r.starts_at,
    durationMin: r.duration_min,
    capacity: r.capacity,
    booked: tally.booked.get(r.id) ?? 0,
    attended: tally.attended.get(r.id) ?? 0,
    waitlisted: tally.waitlisted.get(r.id) ?? 0,
    waitlistAttended: tally.waitlistAttended.get(r.id) ?? 0,
  }));
}

/** One booking row, as far as the tally is concerned. */
export interface BookingRow {
  class_id: string;
  status: string;
  attended_at?: string | null;
}

/** The four per-class counts a booking set yields, keyed by class id. */
export interface BookingTally {
  booked: Map<string, number>;
  attended: Map<string, number>;
  waitlisted: Map<string, number>;
  waitlistAttended: Map<string, number>;
}

/**
 * Split booking rows into places sold and people waiting.
 *
 * Pulled out of `fetchClasses` and exported so it can be asserted on without a
 * database, because the bug it replaces was a one-line filter that no test
 * could reach and no reader questioned:
 *
 *     if (b.status === 'cancelled') return;
 *
 * `class_bookings.status` is `check (status in ('booked','waitlist'))`. There
 * has never been a cancelled row — cancelling DELETES the booking and promotes
 * the next person waiting — so that line matched nothing, ever, and every
 * waitlister was counted as a place sold. Fill rate and show rate were both
 * wrong on exactly the classes a gym cares most about: the oversubscribed ones.
 *
 * Statuses are matched positively. An unrecognised value counts as neither a
 * place sold nor a person waiting, which is the safe direction: a status added
 * to the constraint later stops being silently sold rather than silently
 * becoming a booking.
 */
export function tallyBookings(rows: BookingRow[]): BookingTally {
  const t: BookingTally = {
    booked: new Map(), attended: new Map(),
    waitlisted: new Map(), waitlistAttended: new Map(),
  };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const b of rows) {
    if (b.status === 'booked') {
      bump(t.booked, b.class_id);
      if (b.attended_at) bump(t.attended, b.class_id);
    } else if (b.status === 'waitlist') {
      bump(t.waitlisted, b.class_id);
      if (b.attended_at) bump(t.waitlistAttended, b.class_id);
    }
  }
  return t;
}

export interface NewClass {
  title: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
  room?: string | null;
  instructor?: string | null;
  trainerId?: string | null;
}

export async function createClass(sb: Queryable, tenantId: string, c: NewClass): Promise<void> {
  const { error } = await sb.from('gym_classes').insert(row(tenantId, c));
  if (error) throw error;
}

/**
 * A weekly series, as real rows.
 *
 * Deliberately not a virtual recurrence rule. A gym cancels one week, moves
 * another to a different room and drops the week of a public holiday — all of
 * which are edits to a single occurrence. Materialised rows can be edited one
 * at a time; a rule cannot, without growing an exceptions table that is just
 * these rows by another name.
 *
 * `skip` takes yyyy-mm-dd dates to leave out, which is how a holiday is handled.
 */
export function weeklyOccurrences(
  first: NewClass, weeks: number, skip: string[] = [],
): NewClass[] {
  const out: NewClass[] = [];
  const skipSet = new Set(skip);
  const start = new Date(first.startsAt);
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + i * 7);
    const iso = d.toISOString();
    if (skipSet.has(iso.slice(0, 10))) continue;
    out.push({ ...first, startsAt: iso });
  }
  return out;
}

export async function createSeries(
  sb: Queryable, tenantId: string, first: NewClass, weeks: number, skip: string[] = [],
): Promise<number> {
  const rows = weeklyOccurrences(first, weeks, skip);
  if (!rows.length) return 0;
  const { error } = await sb.from('gym_classes').insert(rows.map((c) => row(tenantId, c)));
  if (error) throw error;
  return rows.length;
}

/**
 * Take a class off the timetable.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts. A DELETE
 * that matches nothing is a 204 with a null error, and the two policies on
 * gym_classes (`is_owner_of(tenant_id)`, or `trainer_id = auth.uid()`) filter
 * rather than refuse: an owner working from a board left open while somebody
 * else deleted the same class saw the confirmation close, the week reload, and
 * — because the timetable is merged from two sources and redrawn wholesale —
 * had no way to tell "removed" from "was never removed".
 */
export async function deleteClass(sb: Queryable, classId: string): Promise<void> {
  const r = await sb.from('gym_classes').delete({ count: 'exact' }).eq('id', classId);
  assertWrote('That class', r);
}

/* ── the roster ────────────────────────────────────────────────────────────── */

export async function fetchRoster(sb: Queryable, classId: string): Promise<RosterEntry[]> {
  const { data, error } = await sb
    .from('class_bookings')
    .select('id, user_id, status, attended_at')
    .eq('class_id', classId);
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r: any) => r.user_id))];
  // Deliberately NOT checked, unlike the bookings read in fetchClasses above,
  // and the difference is worth stating so nobody makes these consistent in the
  // wrong direction. A failed name lookup costs a LABEL: the roster still shows
  // the right number of people and each renders unnamed. A failed count would
  // cost a FIGURE — 0 booked reads as a fact about the class. Losing a name is
  // visible to whoever is looking at it; losing a count is not.
  // no-error-ok: an unreadable name leaves the shift labelled by id; the shift itself is unaffected
  const { data: profs } = await sb.from('profiles').select('id, full_name').in('id', ids);
  const names = new Map((profs ?? []).map((p: any) => [p.id, (p.full_name || '').trim()]));

  const entries: RosterEntry[] = rows.map((r: any) => ({
    bookingId: r.id,
    userId: r.user_id,
    name: names.get(r.user_id) || null,
    status: r.status,
    attendedAt: r.attended_at ?? null,
  }));
  return entries.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * Mark someone present or not. Writes the booking row directly, which the
 * owner may now do — previously only the class's own trainer could.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts.
 * `class_bookings_owner_w` is `is_owner_of(gc.tenant_id)` and is the ONLY
 * policy granting UPDATE on this table, so a trainer's tick, or a tick against
 * a booking the member cancelled while the register was open, matches zero rows
 * and returns no error. The register is what the show rate is computed from and
 * what the door log is reconciled against, so a tick that did not store is a
 * class that reads as half-attended for good.
 */
export async function setAttendance(
  sb: Queryable, bookingId: string, present: boolean,
): Promise<void> {
  const r = await sb
    .from('class_bookings')
    .update({ attended_at: present ? new Date().toISOString() : null }, { count: 'exact' })
    .eq('id', bookingId);
  assertWrote(present ? 'That attendance tick' : 'Clearing that attendance tick', r);
}

/** Put a member on a class at the desk — a walk-in, or someone who phoned. */
export async function bookOnto(sb: Queryable, classId: string, userId: string): Promise<void> {
  const { error } = await sb
    .from('class_bookings')
    .insert({ class_id: classId, user_id: userId, status: 'booked' });
  if (error) throw error;
}

/* ── derived ───────────────────────────────────────────────────────────────── */

export interface AttendanceSummary {
  classes: number;
  /** Places held across the window. */
  booked: number;
  /** Of those, how many turned up. */
  attended: number;
  /** attended / booked, or null when nothing was booked — a gym with no
   *  bookings has no attendance rate, which is not the same as 0%. */
  showRate: number | null;
  /** booked / capacity, or null when no class has capacity recorded. */
  fillRate: number | null;
  /** People who wanted a place and did not get one, across the window. Demand
   *  the gym did not sell — never part of fill, which is what it sold. */
  waitlisted: number;
  /** Of those, how many were let in and marked present anyway. */
  waitlistAttended: number;
}

export function summariseAttendance(classes: GymClass[]): AttendanceSummary {
  const booked = classes.reduce((a, c) => a + c.booked, 0);
  const attended = classes.reduce((a, c) => a + c.attended, 0);
  const capacity = classes.reduce((a, c) => a + (c.capacity || 0), 0);
  return {
    classes: classes.length,
    booked,
    attended,
    showRate: booked > 0 ? attended / booked : null,
    fillRate: capacity > 0 ? booked / capacity : null,
    waitlisted: classes.reduce((a, c) => a + c.waitlisted, 0),
    waitlistAttended: classes.reduce((a, c) => a + c.waitlistAttended, 0),
  };
}

export interface AttendanceWeek {
  /** ISO date of the Monday that opens the week. */
  weekOf: string;
  classes: number;
  capacity: number;
  booked: number;
  attended: number;
  /** booked / capacity, or null when no class that week recorded a capacity. */
  fillRate: number | null;
  /** attended / booked, or null when nothing was booked that week. */
  showRate: number | null;
}

/** The Monday that opens the week containing `d`, as an ISO date. */
function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0 = Sunday, so Sunday belongs to the week that began 6 days ago.
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  return x.toISOString().slice(0, 10);
}

/**
 * Attendance week by week, oldest first — the series behind a trend chart.
 *
 * Returns exactly `weeks` entries, **including the empty ones**. A week with no
 * classes is information: it is the gap a chart should show as a gap, not a
 * point the line skips over on its way to the next busy week.
 *
 * Both rates stay null rather than 0 when their denominator is missing, for the
 * same reason `summariseAttendance` does it — a week nobody booked has no show
 * rate, which is not the same as everybody failing to turn up.
 */
export function weeklyAttendance(
  classes: GymClass[],
  weeks = 12,
  now: number = Date.now(),
): AttendanceWeek[] {
  const thisMonday = mondayOf(new Date(now));

  // Seed every week first, so quiet weeks survive into the series.
  const out: AttendanceWeek[] = [];
  const index = new Map<string, AttendanceWeek>();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${thisMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const weekOf = d.toISOString().slice(0, 10);
    const w: AttendanceWeek = {
      weekOf, classes: 0, capacity: 0, booked: 0, attended: 0,
      fillRate: null, showRate: null,
    };
    out.push(w);
    index.set(weekOf, w);
  }

  for (const c of classes) {
    const t = Date.parse(c.startsAt);
    if (Number.isNaN(t)) continue;
    const w = index.get(mondayOf(new Date(t)));
    if (!w) continue; // outside the window
    w.classes += 1;
    w.capacity += c.capacity || 0;
    w.booked += c.booked;
    w.attended += c.attended;
  }

  for (const w of out) {
    w.fillRate = w.capacity > 0 ? w.booked / w.capacity : null;
    w.showRate = w.booked > 0 ? w.attended / w.booked : null;
  }
  return out;
}

/** A percentage, or null passed straight through so a caller cannot render
 *  "0%" for something that was never measured. */
export function pct(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `${Math.round(v * 100)}%`;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function row(tenantId: string, c: NewClass) {
  return {
    tenant_id: tenantId,
    title: c.title,
    starts_at: c.startsAt,
    duration_min: c.durationMin,
    capacity: c.capacity,
    room: c.room ?? null,
    instructor: c.instructor ?? null,
    trainer_id: c.trainerId ?? null,
  };
}
