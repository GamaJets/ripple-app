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
import { readAll } from './rowCap';

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
  /** The standing description of the machine. `recordService` CLEARS it, which
   *  is why the reason a machine is out of action does NOT live here. */
  note: string | null;
  /** Why it is out of action, in the words of whoever took it out. Null on a
   *  machine in service. */
  outOfServiceReason: string | null;
  /** When it went out. "How long has that rower been broken" is the question an
   *  owner actually asks, and a status column alone cannot answer it. */
  outOfServiceSince: string | null;
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

/* ── the same fifteen rowers, promised to two classes ──────────────────────── */

/** What this rule needs to know about a class. Deliberately not `GymClass`:
 *  the arithmetic has no business importing the timetable. */
export interface KitClass {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  /** Places the class is sold as holding. */
  capacity: number;
  /** Places actually sold. Confirmed seats only — never waitlisters. */
  booked: number;
}

/** A set of classes that are on at the same time, and what they need at once. */
export interface ConcurrentDemand {
  /** The overlapping classes, earliest first. Always two or more. */
  classes: KitClass[];
  /** When the overlap starts and ends, so a screen can name the hour. */
  from: string;
  to: string;
  /** Units the group needs if every class fills. */
  unitsIfFull: number;
  /** Units the group needs for the people who have actually booked. */
  unitsBooked: number;
  /** Usable units of the category, across the gym. */
  usable: number;
  /**
   * People already booked who would have no kit, or null when the register
   * holds nothing of this category and so cannot answer.
   *
   * Computed on `booked` rather than on capacity, because this is the number
   * somebody has to ring: a shortfall against stated capacity is a seat that
   * may never be sold, and a shortfall against bookings is a person who has
   * paid and will be turned away.
   */
  shortBooked: number | null;
  /** The same figure if both classes fill. A planning number, not a call list. */
  shortIfFull: number | null;
}

const endOf = (c: KitClass): number =>
  Date.parse(c.startsAt) + Math.max(0, c.durationMin) * 60_000;

/**
 * Classes that are on at the same time, and whether the gym owns enough kit for
 * all of them at once.
 *
 * ── Why checking one class at a time was not a check ──────────────────────
 *
 * `capacityFor` answers "does this class fit the gym's stock", and /equipment
 * ran it against every class independently. Fifteen rowers therefore came back
 * green for the 6am and green for the other 6am, because each question was
 * asked as though the other class did not exist. The second one turns up to a
 * room with no rowers in it, and the screen that exists to prevent exactly that
 * had said the week was fine.
 *
 * ── How a group is formed ────────────────────────────────────────────────
 *
 * By overlap, transitively: a 06:00–07:00 and a 06:30–07:30 are one group, and
 * a 07:15 class joins it through the second even though it does not touch the
 * first. That is right for kit, which is carried out of one room and into the
 * next — the constraint is how many units are in use at once, and a chain of
 * overlaps is a period where all of them are.
 *
 * Adjacency is NOT overlap: a class ending at 07:00 and one starting at 07:00
 * are consecutive, and treating them as concurrent would report a shortfall at
 * every gym that runs classes back to back, which is every gym.
 *
 * ── What is left alone ───────────────────────────────────────────────────
 *
 * A single class on its own never appears here. `capacityFor` already answers
 * that question and answers it better, and repeating it as a group of one would
 * put the whole timetable in a table headed "at the same time".
 *
 * A cancelled class must be filtered out by the CALLER. This module cannot see
 * `status` and a called-off class holds no kit — see `isCancelled` in
 * src/lib/gymSchedule.ts, which is the single place that decision is made.
 */
export function concurrentKitDemand(
  items: Equipment[],
  category: string,
  classes: KitClass[],
  perAttendee = 1,
): ConcurrentDemand[] {
  if (!(perAttendee > 0)) return [];
  const of = items.filter((e) => sameCategory(e.category, category) && e.status !== 'retired');
  // Null rather than 0 when nothing of the category is registered: an empty
  // register is a form nobody filled in, not a gym that owns no rowers.
  const known = of.length > 0;
  const usable = usableUnits(of);

  const sorted = [...classes]
    .filter((c) => !Number.isNaN(Date.parse(c.startsAt)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));

  const out: ConcurrentDemand[] = [];
  let group: KitClass[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    if (group.length < 2) { group = []; return; }
    const unitsIfFull = group.reduce((n, c) => n + Math.max(0, c.capacity) * perAttendee, 0);
    const unitsBooked = group.reduce((n, c) => n + Math.max(0, c.booked) * perAttendee, 0);
    out.push({
      classes: group,
      from: group[0].startsAt,
      to: new Date(Math.max(...group.map(endOf))).toISOString(),
      unitsIfFull,
      unitsBooked,
      usable,
      // Ceiling, not floor: half a rower short is a person short.
      shortBooked: known ? Math.max(0, Math.ceil((unitsBooked - usable) / perAttendee)) : null,
      shortIfFull: known ? Math.max(0, Math.ceil((unitsIfFull - usable) / perAttendee)) : null,
    });
    group = [];
  };

  for (const c of sorted) {
    const start = Date.parse(c.startsAt);
    // Strictly less than: a class starting exactly when another ends is the
    // next class, not a competing one.
    if (group.length && start < groupEnd) {
      group.push(c);
      groupEnd = Math.max(groupEnd, endOf(c));
    } else {
      flush();
      group = [c];
      groupEnd = endOf(c);
    }
  }
  flush();
  return out;
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

/**
 * Every piece of kit this gym holds.
 *
 * Paged, and it was not bounded at all — no `capLimit()`, no `assertWhole`, no
 * `readAll`. PostgREST answers an unbounded request with a thousand rows and
 * says nothing, and these rows are not only a list: /equipment pairs them
 * against the timetable on capacity, so a gym past a thousand items would have
 * been told a class it can seat is oversubscribed, and told it in a red banner.
 * A silent prefix feeding a capacity figure is the exact case src/lib/rowCap.ts
 * calls strictly worse than a failed read.
 *
 * `category` and `name` both tie freely — a rack of twenty identical dumbbells
 * is twenty rows with the same two values — so `id` supplies the total order
 * `readAll` requires.
 */
export async function fetchEquipment(sb: Queryable, tenantId: string): Promise<Equipment[]> {
  const rows = await readAll<any>(
    (from, to) => sb
      .from('gym_equipment')
      .select('id, name, category, identifier, quantity, status, purchased_on, service_interval_days, last_serviced_on, note, out_of_service_reason, out_of_service_since')
      .eq('tenant_id', tenantId)
      .order('category', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's equipment",
  );
  return rows.map((r: any) => ({
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
    outOfServiceReason: r.out_of_service_reason ?? null,
    outOfServiceSince: r.out_of_service_since ?? null,
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

/**
 * Take a machine out of action, or put it back.
 *
 * Staff can do this; it is why they are standing there.
 *
 * ── `reason` is a different column from `note`, and it has to be ──────────
 *
 * `note` is the standing description of the machine — "bought second hand,
 * serial plate missing" — and `recordService` CLEARS it, on the grounds that
 * whatever it said is presumably done. So a reason stored there disappears the
 * first time anybody records a service, taking the description with it. Neither
 * surface ever passed a note at all, and both then rendered "no reason
 * recorded" about a column nothing could write.
 *
 * `out_of_service_reason` and `out_of_service_since` (supabase/parts/186) are
 * where the reason lives now. `since` is what answers the question an owner
 * actually asks — how long has that rower been broken — which a status column
 * alone never could.
 */
export async function setStatus(
  sb: Queryable,
  id: string,
  status: EquipmentStatus,
  note?: string | null,
  reason?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (note !== undefined) patch.note = note;
  if (status === 'out_of_service') {
    if (reason !== undefined) patch.out_of_service_reason = reason;
    // Stamped only on the way OUT, and only when it is not already out: a
    // machine reported again by a second member of staff must not have its
    // clock reset to today, because the number this column exists to produce is
    // how long it has been broken.
    patch.out_of_service_since = new Date().toISOString().slice(0, 10);
  } else {
    // Back in service, or retired. Both clear the reason and the clock —
    // leaving them would make a working machine read as out of action on every
    // screen that renders the reason.
    patch.out_of_service_reason = null;
    patch.out_of_service_since = null;
  }
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

/**
 * Record a service, and keep a record OF it.
 *
 * This used to be the whole of a gym's maintenance record: one date,
 * overwritten, and the note deleted. Six services in three years left one date
 * and no engineer, no cost, no findings and nothing about the five before it —
 * so "when was this last looked at, and how often has it needed looking at"
 * was unanswerable, which is precisely the question that tells a broken machine
 * from a machine that keeps breaking.
 *
 * The log row is written FIRST and the cached date second. If the second write
 * fails the history has an entry the machine's own `last_serviced_on` does not
 * reflect — visible, wrong, and fixable. The other order would leave the
 * machine looking serviced with nothing recording what was done, which is the
 * state this function is being fixed out of.
 *
 * `last_serviced_on` is deliberately NOT dropped in favour of the log. It is
 * what `serviceState` computes the due date from and it is read on two screens
 * that list two hundred machines; turning it into a join against the newest log
 * row would cost that on every render. It is the cached answer and the log is
 * the evidence — the same relationship `payroll_settlements` has with the
 * sessions it stamped.
 */
export async function recordService(
  sb: Queryable,
  id: string,
  onIso?: string,
  entry?: {
    tenantId: string;
    equipmentLabel: string | null;
    kind?: LogKind;
    performedBy?: string | null;
    findings?: string | null;
    costCents?: number | null;
    currency?: string | null;
    recordedBy?: string | null;
  },
): Promise<void> {
  const day = onIso ?? new Date().toISOString().slice(0, 10);

  if (entry) {
    await addLogEntry(sb, entry.tenantId, {
      equipmentId: id,
      equipmentLabel: entry.equipmentLabel,
      kind: entry.kind ?? 'service',
      happenedOn: day,
      performedBy: entry.performedBy ?? null,
      findings: entry.findings ?? null,
      costCents: entry.costCents ?? null,
      currency: entry.currency ?? null,
      recordedBy: entry.recordedBy ?? null,
    });
  }

  // Counted for the same reason, and with a maintenance record's own edge: a
  // service that was never written leaves the machine on the due list, so the
  // next person to look reads it as overdue and services it twice — or, having
  // been told it was recorded, trusts the date that is not there.
  const r = await sb
    .from('gym_equipment')
    .update({ last_serviced_on: day, note: null }, { count: 'exact' })
    .eq('id', id);
  if (r.error) throw r.error;
  assertWrote('That service', r);
}

/* ── the history a register did not have ───────────────────────────────────── */

export type LogKind = 'service' | 'repair' | 'inspection' | 'clean' | 'incident';

export const LOG_KINDS: readonly LogKind[] =
  ['service', 'repair', 'inspection', 'clean', 'incident'] as const;

/**
 * Five kinds in one table, because the answer to "what has happened to this
 * rower" is all five interleaved.
 *
 * `incident` earns its place beyond maintenance: an accident book is a
 * statutory requirement in most jurisdictions this product is sold into, and
 * the place a gym looks for one is the machine it happened on. An incident with
 * no machine — somebody slipping on a wet floor — is recorded with a null
 * `equipment_id`, which is why that column is nullable.
 */
export const LOG_LABEL: Record<LogKind, string> = {
  service: 'Service',
  repair: 'Repair',
  inspection: 'Inspection',
  clean: 'Deep clean',
  incident: 'Incident or accident',
};

export interface LogEntry {
  id: string;
  equipmentId: string | null;
  equipmentLabel: string | null;
  kind: LogKind;
  happenedOn: string;
  performedBy: string | null;
  findings: string | null;
  costCents: number | null;
  currency: string | null;
  reportedTo: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** Why an entry cannot be recorded, or null when it can. */
export function logBlocker(
  kind: LogKind, equipmentId: string | null, findings: string, cost: string, currency: string | null,
): string | null {
  if (!equipmentId && !findings.trim()) {
    return 'An entry has to be about something. With no machine chosen, say what happened — otherwise this is a blank row in an accident book.';
  }
  if (kind === 'incident' && !findings.trim()) {
    return 'An incident with no account of it is not a record of anything. Write what happened while it is fresh.';
  }
  if (cost.trim()) {
    if (!/^\d+(\.\d{1,2})?$/.test(cost.trim().replace(/[,\s]/g, ''))) {
      return 'Enter the cost as a number — 240, or 87.50. Leave it empty where there was none to record.';
    }
    if (!currency) {
      return 'This gym has not set its currency, so a cost cannot say what money it is in. Record the entry without one, or set the currency first.';
    }
  }
  return null;
}

/**
 * The gym's maintenance and incident log.
 *
 * ── Why this pages rather than refusing ────────────────────────────────────
 *
 * It was `.limit(capLimit())` plus `assertWhole` over the gym's WHOLE history,
 * on the one list in this product that only ever grows. Nothing here is ever
 * deleted — it is the accident book — so at a thousand entries the entire
 * Maintenance and incidents section went behind an error and stayed there, for
 * a statutory record, at a gym whose only fault was having been open a while.
 *
 * `assertWhole` was the right instinct and the wrong shape. src/lib/rowCap.ts
 * sets out where throwing is wrong: it is for a read that feeds a FIGURE, and
 * this one feeds a list. Nothing computes an average or a total off these rows;
 * refusing them protects no number and takes away a screen somebody needs in
 * front of an inspector.
 *
 * And what a truncated read would have dropped is the OLDEST entries, which are
 * the ones the log exists to answer for — so a silent prefix was never
 * acceptable either. `readAll` is the third answer: the read is simply
 * finished, and `PAGE_CEILING` still refuses past fifty thousand entries, which
 * is a sentence about the size of the read rather than about the gym.
 *
 * `happened_on` is a DATE and `created_at` alone can tie on a bulk import, so
 * `id` closes the total order `readAll` requires. Without it, pages of a tied
 * ordering drop and repeat rows silently — which in an accident book is an
 * incident that stops being in it.
 */
export async function fetchLog(
  sb: Queryable, tenantId: string, equipmentId?: string,
): Promise<LogEntry[]> {
  const rows = await readAll<any>(
    (from, to) => {
      let q = sb
        .from('gym_equipment_log')
        .select('id, equipment_id, equipment_label, kind, happened_on, performed_by, findings, cost_cents, currency, reported_to, recorded_by, created_at')
        .eq('tenant_id', tenantId);
      if (equipmentId) q = q.eq('equipment_id', equipmentId);
      return q
        .order('happened_on', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
    },
    "this gym's maintenance and incident log",
  );
  return rows.map((r: any) => ({
    id: r.id,
    equipmentId: r.equipment_id ?? null,
    equipmentLabel: r.equipment_label ?? null,
    kind: (LOG_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'service',
    happenedOn: r.happened_on,
    performedBy: r.performed_by ?? null,
    findings: r.findings ?? null,
    costCents: Number.isFinite(r.cost_cents) ? r.cost_cents : null,
    currency: r.currency ?? null,
    reportedTo: r.reported_to ?? null,
    recordedBy: r.recorded_by ?? null,
    createdAt: r.created_at,
  }));
}

export async function addLogEntry(
  sb: Queryable,
  tenantId: string,
  e: {
    equipmentId: string | null;
    /** What the machine was called at the time. Kept because the reference is
     *  `on delete set null` — retiring a machine must not turn its accident
     *  record into "somebody was hurt by something". */
    equipmentLabel: string | null;
    kind: LogKind;
    happenedOn: string;
    performedBy: string | null;
    findings: string | null;
    costCents: number | null;
    currency: string | null;
    reportedTo?: string | null;
    recordedBy: string | null;
  },
): Promise<void> {
  const { error } = await sb.from('gym_equipment_log').insert({
    tenant_id: tenantId,
    equipment_id: e.equipmentId,
    equipment_label: e.equipmentLabel,
    kind: e.kind,
    happened_on: e.happenedOn,
    performed_by: e.performedBy?.trim() || null,
    findings: e.findings?.trim() || null,
    // Both together or neither. An amount with no unit is not an amount, and
    // the CHECK in supabase/parts/186 refuses the pair coming apart.
    cost_cents: e.costCents ?? null,
    currency: e.costCents == null ? null : e.currency,
    reported_to: e.reportedTo?.trim() || null,
    recorded_by: e.recordedBy,
  });
  if (error) throw error;
}
