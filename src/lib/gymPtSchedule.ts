// One-to-ones on the gym's own timetable.
//
// The gym had two calendars. `gym_classes` was the gym's, on the board at
// studio-web/timetable; one-to-ones were the trainer's, in `sessions`, and the
// gym only ever met them afterwards as payroll (src/lib/gymSessions.ts). So an
// owner asking "is the floor covered at six?" was reading one of the two lists
// and guessing at the other.
//
// This module does not model a second kind of appointment. A one-to-one is
// already a `sessions` row — see supabase/parts/44-gym-pt-schedule.sql for why
// extending that table beat inventing a parallel one. What is here is the
// reading of those rows as *timetable* rather than as payroll, and the merge
// that puts them on one board with the classes.
//
// Framework-agnostic like its neighbours: the Supabase client comes in as an
// argument, so the console and the phone app can both use it and neither owns
// it.

import type { SessionOutcome } from './gymSessions';
import type { GymClass } from './gymSchedule';

type Queryable = { from: (table: string) => any };

/* ── the one-to-one, as the timetable needs it ─────────────────────────────── */

export interface PtSlot {
  id: string;
  trainerId: string;
  /** From `profiles`, not from `trainers` — that table has no name column. */
  trainerName: string | null;
  clientId: string | null;
  clientName: string | null;
  startsAt: string;
  durationMin: number;
  /** Where in the building. Null when nobody said. */
  room: string | null;
  /** Slot state: available, booked or blocked. Not the delivery result. */
  status: string;
  /** Null until somebody records what happened (33-session-outcomes.sql). */
  outcome: SessionOutcome | null;
  /** Set once a payroll run has paid for it. Blocks removal. */
  settlementId: string | null;
}

/**
 * The gym's one-to-ones in a window.
 *
 * Names come from `profiles` in a second query rather than from a PostgREST
 * embed: `trainers` and `clients` are both keyed on profiles.id and neither
 * carries full_name, so there is no name to embed. An owner may read their own
 * tenant's profiles (profiles_owner_r, 38-tenant-isolation.sql §8).
 */
export async function fetchPtSlots(
  sb: Queryable, tenantId: string, fromISO: string, toISO: string,
): Promise<PtSlot[]> {
  const { data, error } = await sb
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, room, status, outcome, settlement_id')
    .eq('tenant_id', tenantId)
    .gte('starts_at', fromISO)
    .lte('starts_at', toISO)
    .order('starts_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const ids = [...new Set(
    rows.flatMap((r: any) => [r.trainer_id, r.client_id]).filter(Boolean),
  )] as string[];

  // A failure to read the names must not be reported as "the sessions have no
  // names" — that is the difference between not loaded and loaded-and-empty,
  // one level down. So it throws like everything else.
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs, error: nameErr } = await sb
      .from('profiles').select('id, full_name').in('id', ids);
    if (nameErr) throw nameErr;
    (profs ?? []).forEach((p: any) => {
      const n = (p.full_name || '').trim();
      if (n) names.set(p.id, n);
    });
  }

  return rows.map((r: any): PtSlot => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: names.get(r.trainer_id) ?? null,
    clientId: r.client_id ?? null,
    clientName: r.client_id ? (names.get(r.client_id) ?? null) : null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    room: r.room ?? null,
    status: r.status,
    outcome: r.outcome ?? null,
    settlementId: r.settlement_id ?? null,
  }));
}

/* ── one board ─────────────────────────────────────────────────────────────── */

export type TimetableKind = 'class' | 'one_to_one';

/**
 * A single thing happening on the floor, whichever table it came from.
 *
 * Every nullable field here is null because the row genuinely cannot say, not
 * as a stand-in for zero. `booked === null` on a blocked slot means nobody can
 * book it; `booked === 0` on an open one means nobody has.
 */
export interface TimetableEntry {
  /** Unique across both sources — the two id spaces are separate. */
  key: string;
  sourceId: string;
  kind: TimetableKind;
  title: string;
  startsAt: string;
  /** Derived from startsAt + durationMin. Invalid dates give ''. */
  endsAt: string;
  durationMin: number;
  room: string | null;
  /** The trainer's user id, where the row names one. A class's free-text
   *  `instructor` is a label, not an identity, so it never lands here. */
  staffId: string | null;
  staffName: string | null;
  /** Places held. Null where the row cannot report a number. */
  booked: number | null;
  /** Places available. Null where there is no meaningful denominator. */
  capacity: number | null;
  /** available / booked / blocked, for a one-to-one. Null for a class. */
  slotStatus: string | null;
  outcome: SessionOutcome | null;
  /** The member, on a one-to-one. Null for a class or an unbooked slot. */
  withName: string | null;
}

function endOf(startsAt: string, durationMin: number): string {
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return '';
  return new Date(t + durationMin * 60_000).toISOString();
}

export function classEntry(c: GymClass): TimetableEntry {
  return {
    key: `class:${c.id}`,
    sourceId: c.id,
    kind: 'class',
    title: c.title,
    startsAt: c.startsAt,
    endsAt: endOf(c.startsAt, c.durationMin),
    durationMin: c.durationMin,
    room: c.room ?? null,
    staffId: c.trainerId ?? null,
    staffName: c.instructor ?? null,
    booked: c.booked,
    // A class recorded with no capacity has no fill figure; 0 would read as
    // "no room left" rather than "nobody set one".
    capacity: c.capacity > 0 ? c.capacity : null,
    slotStatus: null,
    outcome: null,
    withName: null,
  };
}

export function ptEntry(s: PtSlot): TimetableEntry {
  // A one-to-one holds exactly one place, because `sessions` holds exactly one
  // client_id. A blocked slot holds none that anyone could take, so it reports
  // neither a numerator nor a denominator.
  const blocked = s.status === 'blocked';
  return {
    key: `pt:${s.id}`,
    sourceId: s.id,
    kind: 'one_to_one',
    title: 'One-to-one',
    startsAt: s.startsAt,
    endsAt: endOf(s.startsAt, s.durationMin),
    durationMin: s.durationMin,
    room: s.room ?? null,
    staffId: s.trainerId ?? null,
    staffName: s.trainerName ?? null,
    booked: blocked ? null : (s.status === 'booked' ? 1 : 0),
    capacity: blocked ? null : 1,
    slotStatus: s.status,
    outcome: s.outcome,
    withName: s.clientName ?? null,
  };
}

/** Classes and one-to-ones, in the order they happen. */
export function mergeTimetable(classes: GymClass[], slots: PtSlot[]): TimetableEntry[] {
  const all = [...classes.map(classEntry), ...slots.map(ptEntry)];
  return all.sort((a, b) => {
    const d = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (d) return d;
    // Classes first at the same minute: they are the fixed points a gym plans
    // one-to-ones around, and a stable order keeps the board from shuffling.
    if (a.kind !== b.kind) return a.kind === 'class' ? -1 : 1;
    return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  });
}

/* ── is the floor covered at six? ──────────────────────────────────────────── */

/** Whether two entries are on the floor at the same time at any point. */
export function overlapping(a: TimetableEntry, b: TimetableEntry): boolean {
  const as = Date.parse(a.startsAt), bs = Date.parse(b.startsAt);
  const ae = Date.parse(a.endsAt), be = Date.parse(b.endsAt);
  if (![as, bs, ae, be].every(Number.isFinite)) return false;
  // Touching is not overlapping: a class ending at 18:00 and one starting at
  // 18:00 share a room quite happily.
  return as < be && bs < ae;
}

/** Everything running at one instant. Half-open: something starting exactly
 *  then is on, something ending exactly then is not. */
export function entriesAt(entries: TimetableEntry[], atMs: number): TimetableEntry[] {
  return entries.filter((e) => {
    const s = Date.parse(e.startsAt), x = Date.parse(e.endsAt);
    return Number.isFinite(s) && Number.isFinite(x) && s <= atMs && atMs < x;
  });
}

export interface FloorSlice {
  /** The instant asked about. */
  at: string;
  classes: number;
  oneToOnes: number;
  /** Distinct staff running something, by display name. Someone appearing on
   *  two entries at once is one person on the floor, and one clash. */
  staff: string[];
  /** On the floor but with nobody named against them. Not zero staff — an
   *  unknown, which is why it is counted separately rather than folded in. */
  unstaffed: number;
  /** Heads expected in the building. Null when nothing running can report a
   *  number at all — an empty floor has no headcount, which is not 0 people
   *  who failed to turn up. */
  heads: number | null;
  entries: TimetableEntry[];
}

export function floorAt(entries: TimetableEntry[], atMs: number): FloorSlice {
  const on = entriesAt(entries, atMs);
  const staff = new Set<string>();
  let unstaffed = 0, heads: number | null = null;

  for (const e of on) {
    const who = e.staffName?.trim();
    if (who) staff.add(who);
    else if (e.staffId) staff.add(e.staffId);
    else unstaffed += 1;
    if (e.booked != null) heads = (heads ?? 0) + e.booked;
  }

  return {
    at: new Date(atMs).toISOString(),
    classes: on.filter((e) => e.kind === 'class').length,
    oneToOnes: on.filter((e) => e.kind === 'one_to_one').length,
    staff: [...staff].sort(),
    unstaffed,
    heads,
    entries: on,
  };
}

/**
 * The day hour by hour, so a gap in cover is visible as a gap.
 *
 * Takes the day's start as an epoch instant rather than a date string on
 * purpose: "6am" depends on the reader's timezone, and the caller is the one
 * who knows theirs. Every hour in the range is returned, including the empty
 * ones — a quiet 14:00 is the answer, not a row to omit.
 */
export function floorByHour(
  entries: TimetableEntry[], dayStartMs: number, fromHour = 6, toHour = 22,
): FloorSlice[] {
  const out: FloorSlice[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    out.push(floorAt(entries, dayStartMs + h * 3_600_000));
  }
  return out;
}

/* ── what only a merged board can see ──────────────────────────────────────── */

export interface Clash {
  reason: 'room' | 'trainer';
  /** The room, or the trainer's name, that the two share. */
  what: string;
  a: TimetableEntry;
  b: TimetableEntry;
}

const roomKey = (r: string | null) => (r ?? '').trim().toLowerCase();

/**
 * Double-bookings across both calendars — the thing that was invisible while
 * classes and one-to-ones lived in separate lists.
 *
 * TWO RULES, AND ONE DELIBERATE OMISSION:
 *
 *   * A trainer running two things at once is always a clash, and is matched
 *     on trainer id only. A class's `instructor` is free text — two gyms'
 *     worth of "Sam" would collide, and one person typed two ways would not —
 *     so a name is never treated as an identity here.
 *
 *   * A room is a clash only when at least one side is a class. A class takes
 *     the room; anything else in it at the same time is displaced. Two
 *     one-to-ones sharing a room is normal — the main floor holds several at
 *     once — and `sessions` records no room capacity, so calling that a clash
 *     would be inventing a limit the data does not know.
 */
export function clashes(entries: TimetableEntry[]): Clash[] {
  const out: Clash[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (!overlapping(a, b)) continue;

      if (a.staffId && a.staffId === b.staffId) {
        out.push({ reason: 'trainer', what: a.staffName ?? b.staffName ?? a.staffId, a, b });
      }

      const ra = roomKey(a.room);
      if (ra && ra === roomKey(b.room) && (a.kind === 'class' || b.kind === 'class')) {
        out.push({ reason: 'room', what: (a.room ?? b.room)!.trim(), a, b });
      }
    }
  }
  return out;
}

export interface BoardSummary {
  entries: number;
  classes: number;
  oneToOnes: number;
  /** One-to-one slots nobody has taken yet — the gym's spare PT capacity. */
  openSlots: number;
  /** Places held across everything on the board. Null when nothing on it can
   *  report a number. */
  booked: number | null;
  clashes: number;
}

export function summariseBoard(entries: TimetableEntry[]): BoardSummary {
  let booked: number | null = null;
  for (const e of entries) if (e.booked != null) booked = (booked ?? 0) + e.booked;
  return {
    entries: entries.length,
    classes: entries.filter((e) => e.kind === 'class').length,
    oneToOnes: entries.filter((e) => e.kind === 'one_to_one').length,
    openSlots: entries.filter((e) => e.kind === 'one_to_one' && e.slotStatus === 'available').length,
    booked,
    clashes: clashes(entries).length,
  };
}

/* ── writes ────────────────────────────────────────────────────────────────── */

export interface NewPtSlot {
  trainerId: string;
  /** ISO instant. */
  startsAt: string;
  durationMin: number;
  room?: string | null;
  /** Hold the hour without offering it — the trainer is on the floor but not
   *  bookable. */
  blocked?: boolean;
}

/**
 * Why this slot cannot go on the board, or null when it can.
 *
 * Pure, so the form can say it before the round trip and the test can prove it
 * without a database. It refuses rather than repairs: a duration typed as 0 is
 * an unfinished form, and defaulting it to 60 would put an hour on the gym's
 * timetable that nobody asked for.
 */
export function slotBlocker(s: NewPtSlot): string | null {
  if (!s.trainerId) return 'Choose which trainer is taking it.';
  if (!s.startsAt || !Number.isFinite(Date.parse(s.startsAt))) {
    return 'Give it a date and time.';
  }
  if (!Number.isFinite(s.durationMin) || s.durationMin <= 0) {
    return 'How long is it? A slot needs a length in minutes.';
  }
  if (s.durationMin > 8 * 60) return 'That is longer than eight hours — check the minutes.';
  return null;
}

/**
 * Put a one-to-one on the gym's timetable.
 *
 * Returns the new id. `.select()` is not decoration: an insert that RLS
 * refuses can come back without an error under some PostgREST configurations,
 * and a create that reports success while writing nothing is worse than one
 * that fails. If the row does not come back, this throws.
 *
 * tenant_id is sent explicitly as well as being filled by
 * trg_sessions_fill_tenant, so the row is right even if the trigger is missing
 * from a database that has not run part 33.
 */
export async function createPtSlot(
  sb: Queryable, tenantId: string, s: NewPtSlot,
): Promise<string> {
  const blocker = slotBlocker(s);
  if (blocker) throw new Error(blocker);

  const { data, error } = await sb.from('sessions').insert({
    tenant_id: tenantId,
    trainer_id: s.trainerId,
    starts_at: s.startsAt,
    duration_min: s.durationMin,
    room: s.room?.trim() ? s.room.trim() : null,
    status: s.blocked ? 'blocked' : 'available',
  }).select('id').single();
  if (error) throw error;

  const id = (data as any)?.id as string | undefined;
  if (!id) throw new Error('The slot was not written — nothing came back from the insert.');
  return id;
}

/**
 * Take a slot off the board.
 *
 * The delete is asked to return what it removed. A delete filtered away by RLS
 * reports no error and no rows, so checking `.error` alone would tell the owner
 * a session had been removed while it was still on the timetable. The database
 * also refuses outright (trg_sessions_block_delete_of_record) to delete a
 * session that has an outcome or has been paid; that arrives here as a real
 * error with the reason in it.
 */
export async function removePtSlot(sb: Queryable, sessionId: string): Promise<void> {
  const { data, error } = await sb.from('sessions').delete().eq('id', sessionId).select('id');
  if (error) throw error;
  if (!data || (data as any[]).length === 0) {
    throw new Error('Nothing was removed. That slot may already be gone, or it may not be yours to remove.');
  }
}

/** Move a slot, or put it in a room. Only the fields given are touched. */
export async function updatePtSlot(
  sb: Queryable, sessionId: string,
  patch: { startsAt?: string; durationMin?: number; room?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.durationMin !== undefined) row.duration_min = patch.durationMin;
  if (patch.room !== undefined) row.room = patch.room?.trim() ? patch.room.trim() : null;
  if (!Object.keys(row).length) return;

  const { data, error } = await sb.from('sessions').update(row).eq('id', sessionId).select('id');
  if (error) throw error;
  if (!data || (data as any[]).length === 0) {
    throw new Error('Nothing was changed — that slot may no longer exist.');
  }
}

/** The gym's trainers, for the "who is taking it" picker. Names come from
 *  profiles for the same reason they do in fetchPtSlots. */
export async function fetchTrainerOptions(
  sb: Queryable, tenantId: string,
): Promise<{ id: string; name: string | null }[]> {
  const { data, error } = await sb.from('trainers').select('id').eq('tenant_id', tenantId);
  if (error) throw error;
  const ids: string[] = (data ?? []).map((r: any) => r.id as string);
  if (!ids.length) return [];

  const { data: profs, error: nameErr } = await sb
    .from('profiles').select('id, full_name').in('id', ids);
  if (nameErr) throw nameErr;
  const names = new Map<string, string>(
    (profs ?? []).map((p: any) => [p.id as string, (p.full_name || '').trim()]),
  );

  return ids
    .map((id) => ({ id, name: names.get(id) || null }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}
