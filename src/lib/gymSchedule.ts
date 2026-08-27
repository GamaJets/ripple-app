// The gym's timetable, and who turned up to it.
//
// Attendance is the most valuable row in the whole database. Retention is
// visible in it long before a cancellation arrives, and none of the forecasting
// in Phase 7 can learn anything without it. Everything here exists to get that
// row recorded.
//
// Framework-agnostic, like gymTrainers and gymRecord: the Supabase client comes
// in as an argument so neither front end owns this.

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
  /** Bookings held, filled in by `fetchClasses`. */
  booked: number;
  /** Of those, how many were marked present. */
  attended: number;
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

export async function fetchClasses(
  sb: Queryable, tenantId: string, fromISO: string, toISO: string,
): Promise<GymClass[]> {
  const { data, error } = await sb
    .from('gym_classes')
    .select('id, title, room, instructor, trainer_id, starts_at, duration_min, capacity')
    .eq('tenant_id', tenantId)
    .gte('starts_at', fromISO)
    .lte('starts_at', toISO)
    .order('starts_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  // One query for every booking in the window rather than one per class.
  //
  // The `.error` check is not decoration. supabase-js RESOLVES on a database
  // error, so without it a failed read arrives as `bookings === null`, falls
  // through `?? []` below, and every class in the window reports 0 booked and
  // 0 attended. That is a FALSE FIGURE, not a blank: a gym opens the timetable,
  // sees an empty week, and concludes nobody is coming. The classes query above
  // has always thrown; this one silently did not.
  const ids = rows.map((r: any) => r.id);
  const { data: bookings, error: bookingsError } = await sb
    .from('class_bookings')
    .select('class_id, status, attended_at')
    .in('class_id', ids);
  if (bookingsError) throw bookingsError;

  const booked = new Map<string, number>();
  const attended = new Map<string, number>();
  (bookings ?? []).forEach((b: any) => {
    if (b.status === 'cancelled') return;
    booked.set(b.class_id, (booked.get(b.class_id) ?? 0) + 1);
    if (b.attended_at) attended.set(b.class_id, (attended.get(b.class_id) ?? 0) + 1);
  });

  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    room: r.room ?? null,
    instructor: r.instructor ?? null,
    trainerId: r.trainer_id ?? null,
    startsAt: r.starts_at,
    durationMin: r.duration_min,
    capacity: r.capacity,
    booked: booked.get(r.id) ?? 0,
    attended: attended.get(r.id) ?? 0,
  }));
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

export async function deleteClass(sb: Queryable, classId: string): Promise<void> {
  const { error } = await sb.from('gym_classes').delete().eq('id', classId);
  if (error) throw error;
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

/** Mark someone present or not. Writes the booking row directly, which the
 *  owner may now do — previously only the class's own trainer could. */
export async function setAttendance(
  sb: Queryable, bookingId: string, present: boolean,
): Promise<void> {
  const { error } = await sb
    .from('class_bookings')
    .update({ attended_at: present ? new Date().toISOString() : null })
    .eq('id', bookingId);
  if (error) throw error;
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
