// The gym's timetable, and who turned up to it.
//
// Attendance is the most valuable row in the whole database. Retention is
// visible in it long before a cancellation arrives, and none of the forecasting
// in Phase 7 can learn anything without it. Everything here exists to get that
// row recorded.
//
// Framework-agnostic, like gymTrainers and gymRecord: the Supabase client comes
// in as an argument so neither front end owns this.

import { assertWhole, capLimit, readAll } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any; rpc?: (fn: string, args?: any) => any };

/**
 * Whether a class is still on, or was called off.
 *
 * `cancelled` is a row that is KEPT. Until part 195 there was no such state and
 * `deleteClass` was the only verb the console had — and
 * `class_bookings.class_id` is `on delete cascade`, so
 * calling off a snowed-off Tuesday destroyed the twelve bookings that prove the
 * slot is wanted, every `attended_at` on them, and the waiting list. It also
 * flattered the month: the bad Tuesday stopped being in the average the moment
 * somebody acted on it.
 */
export type ClassStatus = 'scheduled' | 'cancelled';

export interface GymClass {
  id: string;
  title: string;
  room: string | null;
  /**
   * The place within the gym this class happens at — `gym_classes.branch`.
   *
   * Free text a trainer types (app/(trainer)/classes.tsx offers chips built
   * from the gym's own past values) and a client filters the timetable by. It
   * is a LABEL FOR A PLACE WITHIN ONE GYM and is not the multi-site key; the
   * argument for that is in supabase/parts/290, and the column carries a
   * comment saying so.
   *
   * Read here because a rate summed across two of these is not either place's
   * figure, and until this was selected no screen could tell. `branchSpan` in
   * src/lib/ownedSites.ts is what asks the question; nothing else reads it.
   *
   * Optional on the type for the same reason the four fields below are: rows
   * are built by hand in tests whose subject is rate arithmetic.
   */
  branch?: string | null;
  instructor: string | null;
  trainerId: string | null;
  startsAt: string;
  durationMin: number;
  capacity: number;
  /**
   * ── The four fields below are OPTIONAL, and that is deliberate ───────────
   *
   * They arrive from columns part 195 added, and `fetchClasses` always fills
   * them in. They are optional on the TYPE because `GymClass` is constructed by
   * hand in two test files that belong to nobody in particular
   * (`coverage.test.ts`, `gymClassFill.test.ts`), and making four new fields
   * required would break a suite over rows whose subject is rate arithmetic and
   * which have no opinion about cancellation at all.
   *
   * Every reader below therefore treats `undefined` as `'scheduled'` — see
   * `isCancelled`, which is the single place that decision is made.
   */
  status?: ClassStatus;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  /**
   * The weekly series this occurrence belongs to, or null for a one-off.
   *
   * `createSeries` materialises real rows so a single week can be moved,
   * re-roomed or dropped — the right call, argued on `weeklyOccurrences`. What
   * was missing is that the rows knew nothing about each other, so "the Tuesday
   * 6am Spin" could not be re-priced, re-staffed or called off as a thing.
   */
  seriesId?: string | null;
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

/**
 * Whether this class was called off.
 *
 * The one place `status: undefined` is interpreted, so every reader agrees. A
 * row read before part 195 landed, or a `GymClass` built by hand in a test, has
 * no status and is a class that is ON — which is what it was before the column
 * existed and is the only reading that cannot silently drop a real class out of
 * a figure.
 */
export function isCancelled(c: Pick<GymClass, 'status'>): boolean {
  return c.status === 'cancelled';
}

/** Only the classes that were actually on. */
export function classesThatRan<T extends Pick<GymClass, 'status'>>(classes: T[]): T[] {
  return classes.filter((c) => !isCancelled(c));
}

/**
 * Places still for sale, or null when the class never recorded a capacity.
 *
 * Null rather than 0, for the reason every rate in this file returns null: a
 * class nobody sized has an UNKNOWN number of free places, and 0 reads as sold
 * out — which is what the front desk turns somebody away on.
 */
export function placesLeft(c: Pick<GymClass, 'capacity' | 'booked'>): number | null {
  if (!c.capacity || c.capacity <= 0) return null;
  return Math.max(0, c.capacity - c.booked);
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
  opts: { includeCancelled?: boolean } = {},
): Promise<GymClass[]> {
  const rows = await readAll<any>(
    (from, to) => {
      let q = sb
        .from('gym_classes')
        .select('id, title, room, branch, instructor, trainer_id, starts_at, duration_min, capacity, status, cancelled_at, cancel_reason, series_id')
        .eq('tenant_id', tenantId)
        .gte('starts_at', fromISO)
        .lte('starts_at', toISO);
      // ── Cancelled classes are OUT by default, and that is the safe default ──
      //
      // Six screens call this and only two of them are about cancellation.
      // /analytics, the Overview, /equipment and /retention all turn these rows
      // into a rate, and a class that was called off still carries its capacity
      // — so left in, it puts twenty unsold places into the denominator of a
      // month in which the room was never opened. That is the silent-wrong-
      // number failure this codebase is written against, and it would arrive at
      // four screens whose authors never asked for a status column.
      //
      // Excluding by default means every existing caller keeps meaning what it
      // has always meant: the classes that are on. The two screens that need to
      // SHOW a cancellation — the board and the performance screen — ask for it
      // by name, and say so on screen.
      if (!opts.includeCancelled) q = q.neq('status', 'cancelled');
      return q
        .order('starts_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
    },
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
    branch: r.branch ?? null,
    instructor: r.instructor ?? null,
    trainerId: r.trainer_id ?? null,
    startsAt: r.starts_at,
    durationMin: r.duration_min,
    capacity: r.capacity,
    // `?? 'scheduled'` rather than `?? null`: the column is NOT NULL with a
    // default, so a null here can only mean a row read before part 195 landed,
    // and a class from before cancellation existed is a class that was on.
    status: (r.status ?? 'scheduled') as ClassStatus,
    cancelledAt: r.cancelled_at ?? null,
    cancelReason: r.cancel_reason ?? null,
    seriesId: r.series_id ?? null,
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
  /** Set by `createSeries` on every occurrence it writes. A single class made
   *  with `createClass` leaves it undefined, which is a real answer. */
  seriesId?: string | null;
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
export interface SeriesShape {
  /**
   * Weeks between occurrences. 1 is weekly; 2 is the fortnightly class every
   * gym with a small studio runs and this function could not express.
   */
  everyWeeks?: number;
  /**
   * Stop at this local date (yyyy-mm-dd), inclusive. `weeks` is still the hard
   * ceiling — an end date is the shape a gym thinks in ("until the end of
   * term"), and a count is the shape that cannot run away.
   */
  untilDate?: string | null;
  /** Stamped on every occurrence, so the rows know they are one thing. */
  seriesId?: string | null;
}

/**
 * The local calendar date of an instant, yyyy-mm-dd.
 *
 * LOCAL, and this is the whole of the skip-date fix. Skip dates were compared
 * against `iso.slice(0, 10)` — the UTC date — and this product sells in AED. A
 * class at 01:00 on the 25th in a UTC+4 gym is 21:00 on the 24th in UTC, so a
 * gym closing for Christmas typed 2026-12-25, watched the occurrence survive,
 * and found out on the day. The reverse case is worse and quieter: a late class
 * skipped a week nobody asked to skip.
 *
 * The gym's own wall clock is the only calendar a timetable is read against —
 * the same reasoning `localDate` in gymRota.ts and `dayOf` in gymVisits.ts make.
 */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function weeklyOccurrences(
  first: NewClass, weeks: number, skip: string[] = [], shape: SeriesShape = {},
): NewClass[] {
  const out: NewClass[] = [];
  const skipSet = new Set(skip.map((s) => s.trim()).filter(Boolean));
  const start = new Date(first.startsAt);
  if (Number.isNaN(start.getTime())) return out;
  // Floored at 1: a step of 0 would write the same instant `weeks` times, and a
  // negative one would walk backwards into the past. Both are typos, and both
  // are silent — the count comes back right and the timetable is wrong.
  const step = Math.max(1, Math.floor(shape.everyWeeks ?? 1));
  const until = (shape.untilDate ?? '').trim() || null;

  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime());
    // setDate rather than adding 7 * 86_400_000, so a clock change adds or
    // drops the right hour instead of moving a 6am class to 5am for the winter.
    d.setDate(d.getDate() + i * step * 7);
    const day = localDay(d);
    // Inclusive, and compared as strings: both sides are yyyy-mm-dd, which
    // sorts lexicographically the same way it sorts chronologically.
    if (until && day > until) break;
    if (skipSet.has(day)) continue;
    out.push({ ...first, startsAt: d.toISOString(), seriesId: shape.seriesId ?? first.seriesId ?? null });
  }
  return out;
}

/**
 * A fresh series id.
 *
 * `crypto.randomUUID` is present in every browser this console supports and in
 * Node 20, which package.json already requires. It is reached through
 * `globalThis` and checked rather than called blind: a series id that came back
 * `undefined` would be written as null on every row, and the whole series would
 * silently be a set of unrelated one-offs — which is the exact defect this
 * column exists to fix, arriving as a fix for it.
 */
function newSeriesId(): string {
  const c = (globalThis as any).crypto;
  const id = typeof c?.randomUUID === 'function' ? c.randomUUID() : null;
  if (typeof id !== 'string' || !id) {
    throw new Error(
      'This browser cannot generate a series id, so the weekly classes would be written as unrelated one-offs. Add them one at a time, or use a current browser.',
    );
  }
  return id;
}

/**
 * Write a series, and hand back the id that binds it.
 *
 * Returns the id as well as the count because the caller has to be able to say
 * "twelve added" AND to offer, immediately, the two verbs the id makes possible:
 * change the whole series, and call the whole series off.
 */
export async function createSeries(
  sb: Queryable, tenantId: string, first: NewClass, weeks: number, skip: string[] = [],
  shape: SeriesShape = {},
): Promise<{ seriesId: string; created: number }> {
  const seriesId = shape.seriesId ?? newSeriesId();
  const rows = weeklyOccurrences(first, weeks, skip, { ...shape, seriesId });
  if (!rows.length) return { seriesId, created: 0 };
  const { error } = await sb.from('gym_classes').insert(rows.map((c) => row(tenantId, c)));
  if (error) throw error;
  return { seriesId, created: rows.length };
}

/* ── changing a class that is already on the board ─────────────────────────── */

/** The fields an owner may correct after a class is up. Every one is optional:
 *  an absent key is "leave it alone", which is not the same as null. */
export interface ClassPatch {
  title?: string;
  room?: string | null;
  instructor?: string | null;
  trainerId?: string | null;
  durationMin?: number;
  capacity?: number;
  startsAt?: string;
}

/** The patch as database columns. Only the keys actually present are sent, so
 *  an empty patch is caught by the caller rather than blanking a row. */
function patchRow(p: ClassPatch): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (p.title !== undefined) r.title = p.title;
  if (p.room !== undefined) r.room = p.room;
  if (p.instructor !== undefined) r.instructor = p.instructor;
  if (p.trainerId !== undefined) r.trainer_id = p.trainerId;
  if (p.durationMin !== undefined) r.duration_min = p.durationMin;
  if (p.capacity !== undefined) r.capacity = p.capacity;
  if (p.startsAt !== undefined) r.starts_at = p.startsAt;
  return r;
}

/**
 * Correct one class.
 *
 * There was no edit-a-class path in the product at all: a class typed in with
 * the wrong capacity could only be deleted and retyped, which took its bookings
 * with it (see `deleteClass`). The count is checked, because the two policies on
 * `gym_classes` FILTER rather than refuse — a trainer editing a class that is not
 * theirs matches zero rows and gets no error, and the board redraws unchanged.
 */
export async function updateClass(sb: Queryable, classId: string, patch: ClassPatch): Promise<void> {
  const fields = patchRow(patch);
  if (!Object.keys(fields).length) return;
  const r = await sb.from('gym_classes').update(fields, { count: 'exact' }).eq('id', classId);
  if (r.error) throw r.error;
  assertWrote('That change to the class', r);
}

/**
 * Change every occurrence of a series from `fromISO` onward.
 *
 * FROM a point, never the whole series, and the distinction is the reason this
 * is safe to offer. The classes already run are the gym's attendance record: a
 * coach change applied backwards would re-attribute last month's classes to
 * somebody who did not teach them, and re-price the class hours on /staff for
 * two people at once. What is being edited is the arrangement going forward,
 * which is the only part of a series anybody can actually change.
 *
 * `startsAt` is deliberately NOT accepted here. Moving a whole series to a new
 * time means moving each occurrence by the same offset, which is a different
 * operation from setting them all to one instant — and setting them all to one
 * instant is what a naive `startsAt` in this patch would do: twelve classes
 * stacked on one Tuesday evening.
 */
export async function updateSeriesFrom(
  sb: Queryable, seriesId: string, fromISO: string, patch: Omit<ClassPatch, 'startsAt'>,
): Promise<number> {
  const fields = patchRow(patch);
  if (!Object.keys(fields).length) return 0;
  const { data, error } = await sb
    .from('gym_classes')
    .update(fields)
    .eq('series_id', seriesId)
    .gte('starts_at', fromISO)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Call a class off, keeping it and everything attached to it.
 *
 * The counterpart to `deleteClass`, and the two are not interchangeable. This
 * one is for a class that was on the timetable and did not happen: the bookings
 * stay, the register stays, and the row says why. `deleteClass` is for a class
 * that should never have been typed in.
 *
 * The reason is required and trimmed rather than optional, because a cancelled
 * class with no reason is the record saying the class was called off by nobody
 * for nothing — and "instructor off sick" against "nobody booked it" is the
 * whole value of keeping the row.
 */
export async function cancelClass(sb: Queryable, classId: string, reason: string): Promise<void> {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('Say why the class is off. A cancelled class with no reason tells the next reader nothing.');
  const r = await sb
    .from('gym_classes')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: why }, { count: 'exact' })
    .eq('id', classId)
    // Only a class that is currently on, so a second click cannot overwrite the
    // first reason with a later timestamp and a different sentence.
    .neq('status', 'cancelled');
  if (r.error) throw r.error;
  assertWrote('That cancellation', r);
}

/** Put a cancelled class back on. The reason and the timestamp are cleared —
 *  a class that ran was not cancelled, and a stale reason on a live class would
 *  be read as one. */
export async function restoreClass(sb: Queryable, classId: string): Promise<void> {
  const r = await sb
    .from('gym_classes')
    .update({ status: 'scheduled', cancelled_at: null, cancel_reason: null }, { count: 'exact' })
    .eq('id', classId)
    .eq('status', 'cancelled');
  if (r.error) throw r.error;
  assertWrote('Putting that class back on', r);
}

/**
 * Call off every occurrence of a series from `fromISO` onward.
 *
 * The count comes back so the screen can say "nine cancelled" rather than
 * "done" — a bulk write whose scale is not reported is one nobody can check.
 * Classes already cancelled are skipped rather than restamped, for the same
 * reason `cancelClass` guards: the first reason is the true one.
 */
export async function cancelSeriesFrom(
  sb: Queryable, seriesId: string, fromISO: string, reason: string,
): Promise<number> {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('Say why the series is off. A cancelled class with no reason tells the next reader nothing.');
  const { data, error } = await sb
    .from('gym_classes')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: why })
    .eq('series_id', seriesId)
    .gte('starts_at', fromISO)
    .neq('status', 'cancelled')
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Erase a class that should never have existed.
 *
 * NOT the way to call one off — `cancelClass` is. `class_bookings.class_id` is
 * `on delete cascade`, so this destroys every booking, every `attended_at` and
 * the whole waiting list along with the row, and the month's fill rate quietly
 * improves because the class that went badly is no longer in the average. That
 * is the right behaviour for a class typed in wrong five minutes ago and the
 * wrong behaviour for every other case, which is why the console now offers the
 * two as different verbs with different words and reserves this one for classes
 * nobody has booked.
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

/**
 * Everybody on one class, booked and waiting.
 *
 * Capped through src/lib/rowCap.ts. One class cannot honestly hold a thousand
 * bookings, so this cap will never fire on real data — which is exactly why it
 * is here: if it ever does, the cause is a query that lost its `class_id`
 * filter in an edit, and the failure mode without the guard is a register
 * showing the first thousand people in the gym as attendees of a spin class.
 * A read that refuses is recoverable; a register that quietly lists strangers
 * gets ticked.
 */
export async function fetchRoster(sb: Queryable, classId: string): Promise<RosterEntry[]> {
  const { data, error } = await sb
    .from('class_bookings')
    .select('id, user_id, status, attended_at')
    .eq('class_id', classId)
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data as any[] | null, 'the bookings on this class');
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
  // Typed explicitly. `assertWhole` now hands back `any[]` rather than `any`,
  // which is stricter and better — and it made TypeScript infer this Map's
  // value as `{}`, so `names.get(...)` no longer satisfied `name: string | null`.
  const names = new Map<string, string>(
    (profs ?? []).map((p: any) => [String(p.id), (p.full_name || '').trim()] as [string, string]),
  );

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

/* ── the waiting list ──────────────────────────────────────────────────────── */

/** How many of a roster hold a place, and how many are waiting for one. */
export function splitRoster(rows: RosterEntry[]): { booked: RosterEntry[]; waiting: RosterEntry[] } {
  return {
    booked: rows.filter((r) => r.status === 'booked'),
    // Matched positively, the same way `tallyBookings` is and for the same
    // reason: an unrecognised status is neither a place sold nor a person
    // waiting, so widening the constraint later cannot silently promote
    // somebody by accident.
    waiting: rows.filter((r) => r.status === 'waitlist'),
  };
}

/**
 * Give a waiting member the place that just came free.
 *
 * ── Why the desk needs this, given `book_class` already promotes ───────────
 *
 * It does not, for anybody the desk is talking to. `cancel_class`
 * (02-domain-schema.sql, re-issued tenant-scoped in part 38) promotes the first
 * waitlister automatically — but only when the MEMBER cancels from their own
 * app, because it deletes `where user_id = auth.uid()`. Neither RPC is callable
 * on somebody else's behalf, and neither is called anywhere in this console.
 *
 * So the whole of the front desk's half of the queue is manual: the member who
 * rings up to drop out, the coach who says there is room for one more, the
 * no-show at 06:05 whose bike is now free. Until this existed the waiting list
 * was a set of rows nothing in the gym's own console could read or act on, and
 * `web/client.html` was already selling the feature to members.
 *
 * ── Why it is a plain UPDATE and not an RPC ───────────────────────────────
 *
 * `class_bookings_staff_u` (165-a-coach-cannot-take-their-own-register.sql)
 * grants staff UPDATE on the bookings of their own gym's classes, and that
 * file's own comment names this exact use: "a staff member could promote a
 * waitlister by hand. That is a thing a front desk does anyway." So the
 * permission is deliberate and already in place.
 *
 * The count is checked, because that policy FILTERS: a row somebody else
 * promoted a second earlier, or a booking on another gym's class, matches
 * nothing and returns no error — and the desk would watch the list reload with
 * the same person still waiting and tell them the system is slow.
 *
 * Capacity is NOT enforced here. It is checked by the caller, which is the only
 * place that knows how many places the class has and how many are already sold,
 * and which has to be able to over-fill deliberately — a coach who says one
 * more can squeeze in is making a decision the database has no business
 * refusing. Over-sell is visible on /classes and is reported there as real.
 */
export async function promoteFromWaitlist(sb: Queryable, bookingId: string): Promise<void> {
  const r = await sb
    .from('class_bookings')
    .update({ status: 'booked' }, { count: 'exact' })
    .eq('id', bookingId)
    // Only somebody actually waiting. Without this a double click re-writes a
    // booked row to booked and reports success twice for one promotion.
    .eq('status', 'waitlist');
  if (r.error) throw r.error;
  assertWrote('That promotion off the waiting list', r);
}

/**
 * Put a booked member back on the waiting list.
 *
 * The undo for the button above, and it is needed rather than tidy: a promotion
 * onto the wrong person's row is a place given away, and without this the only
 * correction available is to ask the member to cancel from their own phone.
 */
export async function returnToWaitlist(sb: Queryable, bookingId: string): Promise<void> {
  const r = await sb
    .from('class_bookings')
    .update({ status: 'waitlist' }, { count: 'exact' })
    .eq('id', bookingId)
    .eq('status', 'booked');
  if (r.error) throw r.error;
  assertWrote('Putting that booking back on the waiting list', r);
}

/** What the desk is told after putting somebody on a class. */
export type DeskBooking = 'booked' | 'waitlist';

/**
 * Put a member on a class at the desk — a walk-in, or someone who phoned.
 *
 * ── Why this is an RPC and was a direct insert ───────────────────────────
 *
 * The insert never worked. `class_bookings` has no INSERT policy for staff —
 * `class_bookings_owner_w` is UPDATE only — so this function had no caller
 * anywhere in the repository and would have been refused by RLS if it had one.
 * The console could promote somebody off a waiting list it had no way of
 * putting them on, and every walk-in and phone booking was invisible to fill
 * rate, show rate and class pay.
 *
 * Adding the missing INSERT policy would have been the smaller change and the
 * wrong one. Capacity is enforced in exactly one place in this product — inside
 * `book_class`, which counts confirmed seats under a row lock and writes
 * `waitlist` when the class is full. Nothing else does: there is no constraint
 * and no trigger. An insert from the console would therefore have written
 * `status: 'booked'` straight past capacity, so the first walk-in booked at the
 * desk would silently over-sell a full class and step over the waiting list
 * that the same screen exists to work.
 *
 * `book_class_for` (supabase/parts/492) is `book_class` with the member named
 * by the desk rather than taken from `auth.uid()`, and the same lock and count
 * around it.
 *
 * ── What it returns, and why the caller has to look ──────────────────────
 *
 * 'booked' or 'waitlist'. A desk that assumes the first has told somebody they
 * have a place on a class that was already full, which is worse than not being
 * able to book them at all — they will turn up.
 */
export async function bookOnto(sb: Queryable, classId: string, userId: string): Promise<DeskBooking> {
  // `rpc` is optional on `Queryable` because most of this module only reads
  // tables, and a client that cannot call functions cannot do this at all —
  // said rather than crashed on a property access.
  if (typeof sb.rpc !== 'function') {
    throw new Error('This client cannot call database functions, so nobody was put on that class.');
  }
  const { data, error } = await sb.rpc('book_class_for', { p_class: classId, p_user: userId });
  if (error) throw error;
  if (data === 'booked' || data === 'waitlist') return data;
  // 'notfound' is a class that is gone or unscoped, and anything else is a
  // shape this function does not recognise. Both are refusals and neither is a
  // booking, so neither may be reported as one.
  throw new Error(
    data === 'notfound'
      ? 'That class could not be found, so nobody was put on it.'
      : 'The gym did not say whether that booking was taken, so it is not being reported as one.',
  );
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

export function summariseAttendance(all: GymClass[]): AttendanceSummary {
  // A class that was called off is not a class with empty places: its capacity
  // was never on sale. `fetchClasses` already excludes cancelled rows unless a
  // caller asks for them, and this second filter is what makes that opt-in safe
  // — the two screens that DO ask for them pass the same list to this function.
  const classes = classesThatRan(all);
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
  all: GymClass[],
  weeks = 12,
  now: number = Date.now(),
): AttendanceWeek[] {
  // Same exclusion, same reason, as `summariseAttendance` above: a cancelled
  // class puts its capacity into the week's denominator and nothing into the
  // numerator, so a week the gym closed would read as a week nobody came.
  const classes = classesThatRan(all);
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
    // Null for a one-off, and null is the answer rather than a gap: a class
    // that belongs to no series must not be given a private series of one, or
    // "this class" and "this and every later one" become the same button.
    series_id: c.seriesId ?? null,
  };
}
