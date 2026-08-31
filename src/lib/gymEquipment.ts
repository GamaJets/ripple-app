// The equipment register — what the gym owns, what is out of action, and what
// that does to the capacity it advertises.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// Why this is not just an inventory list: Studio reports class fill rate
// against stated capacity. A capacity of 14 is a claim about the room, and it
// stops being true the moment six of the rowers break. Without a register the
// gym measures itself against a number that quietly became fiction.
//
// The rule that governs the whole module: an empty register is not an empty
// gym. If nothing of a kind is recorded, the capacity check returns null and
// says why — it never reports 0, which would tell a gym its class cannot run.

import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

export type EquipmentStatus = 'in_service' | 'out_of_service' | 'retired';

export interface Equipment {
  id: string;
  name: string;
  /** The gym's own word for the kind of kit. Matched loosely by the capacity check. */
  category: string | null;
  identifier: string | null;
  quantity: number;
  status: EquipmentStatus;
  purchasedOn: string | null;
  /** Null means no service schedule — a decision, not a gap. */
  serviceIntervalDays: number | null;
  /** Null with an interval set means the schedule exists but nothing was recorded. */
  lastServicedOn: string | null;
  note: string | null;
}

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/**
 * Where an item stands against its service schedule.
 *
 * `unscheduled` and `unrecorded` are deliberately different. The first means
 * the gym decided this kit needs no schedule; the second means it set one and
 * never logged a service. Collapsing them would hide the second, which is the
 * one that matters.
 */
export type ServiceState = 'unscheduled' | 'unrecorded' | 'ok' | 'due' | 'overdue';

/** Add whole days to an ISO date in UTC, so a timezone cannot shift a due date. */
function addDays(iso: string, days: number): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * When the next service falls due, or null when that cannot be known.
 *
 * Null covers both "no schedule" and "schedule set but never serviced" — use
 * `serviceState` to tell those apart. A date is only ever returned when it was
 * actually derived from a recorded service.
 */
export function nextServiceDue(e: Pick<Equipment, 'serviceIntervalDays' | 'lastServicedOn'>): string | null {
  if (e.serviceIntervalDays == null || !e.lastServicedOn) return null;
  return addDays(e.lastServicedOn, e.serviceIntervalDays);
}

/**
 * Service standing on `today` (an ISO date).
 *
 * `due` is the grace window — the service is owed within the next week — so a
 * gym can book an engineer before the machine is overdue rather than after.
 */
export function serviceState(
  e: Pick<Equipment, 'serviceIntervalDays' | 'lastServicedOn'>,
  today: string,
  dueWithinDays = 7,
): ServiceState {
  if (e.serviceIntervalDays == null) return 'unscheduled';
  if (!e.lastServicedOn) return 'unrecorded';
  const due = nextServiceDue(e);
  if (!due) return 'unrecorded';
  if (due < today) return 'overdue';
  const soon = addDays(today, dueWithinDays);
  return soon && due <= soon ? 'due' : 'ok';
}

/** Units actually usable: in service only, summed across quantity. */
export function usableUnits(items: Pick<Equipment, 'status' | 'quantity'>[]): number {
  return items.reduce((n, e) => (e.status === 'in_service' ? n + e.quantity : n), 0);
}

/** Units the gym owns but cannot use right now. Retired kit is not counted — it is gone. */
export function outOfServiceUnits(items: Pick<Equipment, 'status' | 'quantity'>[]): number {
  return items.reduce((n, e) => (e.status === 'out_of_service' ? n + e.quantity : n), 0);
}

/** Case- and space-insensitive category match, so "Rowers" finds "rower". */
function sameCategory(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  return norm(a) === norm(b);
}

export interface CapacityCheck {
  /** How many people the kit supports, or null when that cannot be known. */
  limit: number | null;
  /** Usable units of the category. */
  usable: number;
  /** Units of the category out of action right now. */
  down: number;
  /**
   * Whether the stated capacity is actually supported. Null when unknown —
   * never false, because "we have no record" is not the same as "no".
   */
  supported: boolean | null;
  /** Plain-English reason, for the screen. Null when everything checks out. */
  note: string | null;
}

/**
 * Whether a class's stated capacity is supported by the kit it needs.
 *
 * `perAttendee` is how many units one person occupies — one rower each is 1;
 * a rig two people share is 0.5.
 *
 * Returns `limit: null` when nothing of that category is registered at all.
 * That is the important case: an empty register means nobody filled it in, not
 * that the gym owns no rowers, and reporting 0 would tell an owner their class
 * cannot run on the strength of a form they never completed.
 */
export function capacityFor(
  items: Equipment[],
  category: string,
  statedCapacity: number,
  perAttendee = 1,
): CapacityCheck {
  const of = items.filter((e) => sameCategory(e.category, category) && e.status !== 'retired');
  const usable = usableUnits(of);
  const down = outOfServiceUnits(of);

  if (of.length === 0) {
    return {
      limit: null, usable: 0, down: 0, supported: null,
      note: `No ${category} recorded in the register, so this capacity cannot be checked.`,
    };
  }
  if (perAttendee <= 0) {
    return { limit: null, usable, down, supported: null, note: 'Units per attendee must be above zero.' };
  }

  const limit = Math.floor(usable / perAttendee);
  if (limit >= statedCapacity) {
    return { limit, usable, down, supported: true, note: null };
  }
  return {
    limit, usable, down, supported: false,
    note: down > 0
      ? `${down} of ${usable + down} ${category} out of action — this class seats ${limit}, not ${statedCapacity}.`
      : `Only ${usable} ${category} registered — this class seats ${limit}, not ${statedCapacity}.`,
  };
}

export interface RegisterSummary {
  items: number;
  usableUnits: number;
  downUnits: number;
  /** Items whose service is overdue. */
  overdue: number;
  /** Items due a service inside the grace window. */
  due: number;
  /** Items with a schedule but no service ever recorded. */
  unrecorded: number;
}

/** The register at a glance. */
export function summariseRegister(items: Equipment[], today: string): RegisterSummary {
  let overdue = 0, due = 0, unrecorded = 0;
  for (const e of items) {
    if (e.status === 'retired') continue;
    const s = serviceState(e, today);
    if (s === 'overdue') overdue += 1;
    else if (s === 'due') due += 1;
    else if (s === 'unrecorded') unrecorded += 1;
  }
  const live = items.filter((e) => e.status !== 'retired');
  return {
    items: live.length,
    usableUnits: usableUnits(live),
    downUnits: outOfServiceUnits(live),
    overdue, due, unrecorded,
  };
}

/** Everything needing attention, worst first, for the maintenance list. */
export function needsAttention(items: Equipment[], today: string): { item: Equipment; state: ServiceState }[] {
  const rank: Record<string, number> = { overdue: 0, due: 1, unrecorded: 2 };
  return items
    .filter((e) => e.status !== 'retired')
    .map((item) => ({ item, state: serviceState(item, today) }))
    .filter((r) => r.state === 'overdue' || r.state === 'due' || r.state === 'unrecorded')
    .sort((a, b) =>
      (rank[a.state] - rank[b.state]) ||
      (nextServiceDue(a.item) ?? '9999-12-31').localeCompare(nextServiceDue(b.item) ?? '9999-12-31') ||
      a.item.name.localeCompare(b.item.name));
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export async function fetchEquipment(sb: Queryable, tenantId: string): Promise<Equipment[]> {
  const { data, error } = await sb
    .from('gym_equipment')
    .select('id, name, category, identifier, quantity, status, purchased_on, service_interval_days, last_serviced_on, note')
    .eq('tenant_id', tenantId)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? null,
    identifier: r.identifier ?? null,
    quantity: r.quantity ?? 1,
    status: r.status,
    purchasedOn: r.purchased_on ?? null,
    serviceIntervalDays: r.service_interval_days ?? null,
    lastServicedOn: r.last_serviced_on ?? null,
    note: r.note ?? null,
  }));
}

/* ── writes ────────────────────────────────────────────────────────────────── */

export interface NewEquipment {
  name: string;
  category?: string | null;
  identifier?: string | null;
  quantity?: number;
  purchasedOn?: string | null;
  serviceIntervalDays?: number | null;
  lastServicedOn?: string | null;
  note?: string | null;
}

export async function addEquipment(sb: Queryable, tenantId: string, e: NewEquipment): Promise<void> {
  const { error } = await sb.from('gym_equipment').insert({
    tenant_id: tenantId,
    name: e.name,
    category: e.category ?? null,
    identifier: e.identifier ?? null,
    quantity: e.quantity ?? 1,
    purchased_on: e.purchasedOn ?? null,
    service_interval_days: e.serviceIntervalDays ?? null,
    last_serviced_on: e.lastServicedOn ?? null,
    note: e.note ?? null,
  });
  if (error) throw error;
}

/** Take a machine out of action, or put it back. Staff can do this; it is why they are standing there. */
export async function setStatus(
  sb: Queryable,
  id: string,
  status: EquipmentStatus,
  note?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (note !== undefined) patch.note = note;
  // Counted, because an UPDATE matching zero rows is not an error — see
  // src/lib/wroteRows.ts. This is the write on the register with the most
  // physical consequence: a machine taken out of service is a machine nobody is
  // supposed to stand on, and an owner or trainer whose update matched nothing
  // watched the list reload with it still marked in service and reasonably read
  // that as the tap not having registered rather than as the save having been
  // refused.
  const r = await sb.from('gym_equipment').update(patch, { count: 'exact' }).eq('id', id);
  if (r.error) throw r.error;
  assertWrote(status === 'out_of_service' ? 'Taking that out of service' : 'That equipment', r);
}

/** Record a service. Clears the note, since whatever it said is presumably done. */
export async function recordService(sb: Queryable, id: string, onIso?: string): Promise<void> {
  // Counted for the same reason, and with a maintenance record's own edge: a
  // service that was never written leaves the machine on the due list, so the
  // next person to look reads it as overdue and services it twice — or, having
  // been told it was recorded, trusts the date that is not there.
  const r = await sb
    .from('gym_equipment')
    .update({ last_serviced_on: onIso ?? new Date().toISOString().slice(0, 10), note: null }, { count: 'exact' })
    .eq('id', id);
  if (r.error) throw r.error;
  assertWrote('That service', r);
}
