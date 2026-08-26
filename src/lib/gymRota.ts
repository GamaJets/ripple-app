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
// ── Local time, deliberately ────────────────────────────────────────────────
//
// The grid is bucketed by the device's local hour, matching
// `gymVisits.visitsByHour`. "Who was on at 6pm" is a question about the gym's
// wall clock; storage is timestamptz precisely so this conversion happens once,
// here, rather than in every screen.

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

/** The local calendar date of an instant, as yyyy-mm-dd. */
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
  /** Local calendar date, yyyy-mm-dd. */
  date: string;
  /** Local hour, 0..23. */
  hour: number;
}

/**
 * Every local hour a span touches, from the hour it starts in to the hour it
 * ends in. A 17:30–18:15 class occupies 17 and 18 — it needs somebody on the
 * floor for both, so both count.
 *
 * Steps with `setHours(+1)` rather than adding 3,600,000ms so that a clock
 * change adds or drops the right hour instead of shifting the rest of the day.
 */
export function hoursSpanned(startIso: string, endIso: string): HourCell[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const cur = new Date(start);
  cur.setMinutes(0, 0, 0);
  const out: HourCell[] = [];
  while (cur.getTime() < end && out.length < MAX_SPAN_HOURS) {
    out.push({ date: localDate(cur), hour: cur.getHours() });
    cur.setHours(cur.getHours() + 1);
  }
  return out;
}

/** The hours a demand block occupies, from its start and duration. */
export function demandHoursSpanned(d: DemandBlock): HourCell[] {
  const start = Date.parse(d.startsAt);
  if (!Number.isFinite(start) || !(d.durationMin > 0)) return [];
  return hoursSpanned(d.startsAt, new Date(start + d.durationMin * 60_000).toISOString());
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
 * The Monday that opens the week containing `at`, as a local ISO date.
 *
 * Local, unlike the private `mondayOf` in gymSchedule, which buckets attendance
 * in UTC. A rota is read against the gym's wall clock.
 */
export function weekStartOf(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? new Date(at.getTime()) : new Date(at);
  d.setHours(0, 0, 0, 0);
  // getDay: 0 = Sunday, so Sunday belongs to the week that began six days ago.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}

/** The seven local dates of the week opening on `mondayIso`. */
export function weekDays(mondayIso: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = dayStart(mondayIso);
    if (!d) return out;
    d.setDate(d.getDate() + i);
    out.push(localDate(d));
  }
  return out;
}

/** Shift a week ISO date by whole weeks — the screen's back/forward control. */
export function shiftWeek(mondayIso: string, weeks: number): string {
  const d = dayStart(mondayIso);
  if (!d) return mondayIso;
  d.setDate(d.getDate() + weeks * 7);
  return localDate(d);
}

/**
 * The query window for a week, as instants. Half-open at the end: `toISO` is
 * local midnight opening the *next* Monday, so a Sunday 23:30 class is inside
 * and a Monday 00:00 one is not counted twice.
 */
export function weekWindow(mondayIso: string): { fromISO: string; toISO: string } | null {
  const from = dayStart(mondayIso);
  if (!from) return null;
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 7);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

function dayStart(dateIso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
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
export function buildRota(days: string[], shifts: Shift[], demand: DemandBlock[]): RotaHour[] {
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
    for (const c of hoursSpanned(s.startsAt, s.endsAt)) {
      const r = cell(c);
      if (!r) continue;
      const bucket = isLive(s) ? r.rostered : r.cancelled;
      if (!bucket.includes(s.trainerId)) bucket.push(s.trainerId);
    }
  }

  for (const d of demand) {
    for (const c of demandHoursSpanned(d)) {
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
export function coverage(days: string[], shifts: Shift[], demand: DemandBlock[]): CoverageReport {
  const hours = buildRota(days, shifts, demand);

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

/** Shifts grouped by the local day they start on, in the order `days` gives. */
export function shiftsByDay(days: string[], shifts: Shift[]): RotaDay[] {
  const index = new Map<string, Shift[]>(days.map((d) => [d, []]));
  for (const s of shifts) {
    const t = Date.parse(s.startsAt);
    if (!Number.isFinite(t)) continue;
    index.get(localDate(new Date(t)))?.push(s);
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
    .select('id, trainer_id, starts_at, ends_at, role, status, note')
    .eq('tenant_id', tenantId)
    // A shift that started before the window but runs into it still covers
    // hours inside it, so the window is opened on `ends_at`.
    .lt('starts_at', toISO)
    .gt('ends_at', fromISO)
    .order('starts_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  // Names live on `profiles`, not `trainers` — the trainers table carries the
  // gym-facing profile (bio, tagline, fee) and no name column.
  const ids = [...new Set(rows.map((r: any) => r.trainer_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs, error: pe } = await sb.from('profiles').select('id, full_name').in('id', ids);
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
    .order('starts_at', { ascending: true });
  if (ce) throw ce;

  const { data: sessions, error: se } = await sb
    .from('sessions')
    .select('trainer_id, starts_at, duration_min, status, outcome')
    .eq('tenant_id', tenantId)
    .eq('status', 'booked')
    .gte('starts_at', fromISO)
    .lt('starts_at', toISO)
    .order('starts_at', { ascending: true });
  if (se) throw se;

  const out: DemandBlock[] = (classes ?? []).map((r: any) => ({
    kind: 'class' as const,
    label: r.title || 'Class',
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 45,
    trainerId: r.trainer_id ?? null,
  }));

  for (const r of sessions ?? []) {
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
}

/**
 * Build a shift from a local date and two wall-clock hours — the shape the
 * screen collects. Returns null rather than a guess when the hours do not make
 * a span, which the caller renders as a disabled button rather than saving a
 * shift that covers nothing.
 */
export function shiftFromHours(
  trainerId: string, dateIso: string, startHour: number, endHour: number, role: ShiftRole = 'floor',
): NewShift | null {
  const day = dayStart(dateIso);
  if (!day || !trainerId) return null;
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return null;
  if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24) return null;
  if (endHour <= startHour) return null;

  const start = new Date(day.getTime());
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(day.getTime());
  end.setHours(endHour, 0, 0, 0);
  return { trainerId, startsAt: start.toISOString(), endsAt: end.toISOString(), role };
}

export async function addShift(sb: Queryable, tenantId: string, s: NewShift): Promise<void> {
  const { error } = await sb.from('gym_shifts').insert({
    tenant_id: tenantId,
    trainer_id: s.trainerId,
    starts_at: s.startsAt,
    ends_at: s.endsAt,
    role: s.role ?? 'floor',
    note: s.note ?? null,
  });
  if (error) throw error;
}

/**
 * Pull a shift, or put it back.
 *
 * Not a delete: the rota needs to distinguish an hour somebody dropped out of
 * from one nobody was ever booked for, and only a kept row can do that.
 */
export async function setShiftStatus(sb: Queryable, id: string, status: ShiftStatus): Promise<void> {
  const { error } = await sb.from('gym_shifts').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Remove a shift that should never have been written. */
export async function deleteShift(sb: Queryable, id: string): Promise<void> {
  const { error } = await sb.from('gym_shifts').delete().eq('id', id);
  if (error) throw error;
}
