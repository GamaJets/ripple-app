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
  const ids = rows.map((r: any) => r.id);
  const { data: bookings } = await sb
    .from('class_bookings')
    .select('class_id, status, attended_at')
    .in('class_id', ids);

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
