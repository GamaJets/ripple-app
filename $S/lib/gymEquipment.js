"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_LABEL = exports.LOG_KINDS = void 0;
exports.nextServiceDue = nextServiceDue;
exports.serviceState = serviceState;
exports.usableUnits = usableUnits;
exports.outOfServiceUnits = outOfServiceUnits;
exports.capacityFor = capacityFor;
exports.concurrentKitDemand = concurrentKitDemand;
exports.summariseRegister = summariseRegister;
exports.needsAttention = needsAttention;
exports.fetchEquipment = fetchEquipment;
exports.addEquipment = addEquipment;
exports.setStatus = setStatus;
exports.recordService = recordService;
exports.logCost = logCost;
exports.logBlocker = logBlocker;
exports.fetchLog = fetchLog;
exports.addLogEntry = addLogEntry;
const wroteRows_1 = require("./wroteRows");
const weekStart_1 = require("./weekStart");
const rowCap_1 = require("./rowCap");
// One reader for a typed money box, which asks the currency how many decimal
// places it has and refuses `12,50` rather than guessing which side of the
// Channel typed it. /costs reads its own box through the same function.
const coachMoney_1 = require("./coachMoney");
/** Add whole days to an ISO date in UTC, so a timezone cannot shift a due date. */
function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime()))
        return null;
    d.setUTCDate(d.getUTCDate() + days);
    // utc-day-ok: nobody's calendar day is being read out of an instant here.
    // A day string goes in at UTC midnight, the shift is `setUTCDate`, and the
    // same day string comes back out — UTC is the carrier and it cancels, which
    // is the property the line above wants and the reason it says so. Using a
    // local day at either end would reintroduce the shift this exists to avoid:
    // "ninety days after the last service" must be the same date for the owner
    // reading it in Sydney and the technician reading it in Denver.
    return d.toISOString().slice(0, 10);
}
/**
 * When the next service falls due, or null when that cannot be known.
 *
 * Null covers both "no schedule" and "schedule set but never serviced" — use
 * `serviceState` to tell those apart. A date is only ever returned when it was
 * actually derived from a recorded service.
 */
function nextServiceDue(e) {
    if (e.serviceIntervalDays == null || !e.lastServicedOn)
        return null;
    return addDays(e.lastServicedOn, e.serviceIntervalDays);
}
/**
 * Service standing on `today` (an ISO date).
 *
 * `due` is the grace window — the service is owed within the next week — so a
 * gym can book an engineer before the machine is overdue rather than after.
 */
function serviceState(e, today, dueWithinDays = 7) {
    if (e.serviceIntervalDays == null)
        return 'unscheduled';
    if (!e.lastServicedOn)
        return 'unrecorded';
    const due = nextServiceDue(e);
    if (!due)
        return 'unrecorded';
    if (due < today)
        return 'overdue';
    const soon = addDays(today, dueWithinDays);
    return soon && due <= soon ? 'due' : 'ok';
}
/** Units actually usable: in service only, summed across quantity. */
function usableUnits(items) {
    return items.reduce((n, e) => (e.status === 'in_service' ? n + e.quantity : n), 0);
}
/** Units the gym owns but cannot use right now. Retired kit is not counted — it is gone. */
function outOfServiceUnits(items) {
    return items.reduce((n, e) => (e.status === 'out_of_service' ? n + e.quantity : n), 0);
}
/** Case- and space-insensitive category match, so "Rowers" finds "rower". */
function sameCategory(a, b) {
    if (!a)
        return false;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
    return norm(a) === norm(b);
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
function capacityFor(items, category, statedCapacity, perAttendee = 1) {
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
const endOf = (c) => Date.parse(c.startsAt) + Math.max(0, c.durationMin) * 60000;
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
function concurrentKitDemand(items, category, classes, perAttendee = 1) {
    if (!(perAttendee > 0))
        return [];
    const of = items.filter((e) => sameCategory(e.category, category) && e.status !== 'retired');
    // Null rather than 0 when nothing of the category is registered: an empty
    // register is a form nobody filled in, not a gym that owns no rowers.
    const known = of.length > 0;
    const usable = usableUnits(of);
    const sorted = [...classes]
        .filter((c) => !Number.isNaN(Date.parse(c.startsAt)))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
    const out = [];
    let group = [];
    let groupEnd = -Infinity;
    const flush = () => {
        if (group.length < 2) {
            group = [];
            return;
        }
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
        }
        else {
            flush();
            group = [c];
            groupEnd = endOf(c);
        }
    }
    flush();
    return out;
}
/** The register at a glance. */
function summariseRegister(items, today) {
    let overdue = 0, due = 0, unrecorded = 0;
    for (const e of items) {
        if (e.status === 'retired')
            continue;
        const s = serviceState(e, today);
        if (s === 'overdue')
            overdue += 1;
        else if (s === 'due')
            due += 1;
        else if (s === 'unrecorded')
            unrecorded += 1;
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
function needsAttention(items, today) {
    const rank = { overdue: 0, due: 1, unrecorded: 2 };
    return items
        .filter((e) => e.status !== 'retired')
        .map((item) => ({ item, state: serviceState(item, today) }))
        .filter((r) => r.state === 'overdue' || r.state === 'due' || r.state === 'unrecorded')
        .sort((a, b) => (rank[a.state] - rank[b.state]) ||
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
async function fetchEquipment(sb, tenantId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_equipment')
        .select('id, name, category, identifier, quantity, status, purchased_on, service_interval_days, last_serviced_on, note, out_of_service_reason, out_of_service_since')
        .eq('tenant_id', tenantId)
        .order('category', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to), "this gym's equipment");
    return rows.map((r) => ({
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
async function addEquipment(sb, tenantId, e) {
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
    if (error)
        throw error;
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
async function setStatus(sb, id, status, note, reason) {
    const patch = { status };
    if (note !== undefined)
        patch.note = note;
    if (status === 'out_of_service') {
        if (reason !== undefined)
            patch.out_of_service_reason = reason;
        // Stamped only on the way OUT, and only when it is not already out: a
        // machine reported again by a second member of staff must not have its
        // clock reset to today, because the number this column exists to produce is
        // how long it has been broken.
        // The reader's own day, not UTC's. This was
        // `new Date().toISOString().slice(0, 10)`, which is the same defect
        // app/(owner)/equipment.tsx carries a written note about having removed
        // from ITS half — a machine taken out of service at 5pm in Los Angeles was
        // stamped tomorrow, and the number this column exists to produce is how
        // many days a machine has been out. Reported on the evening of the 3rd it
        // read as broken since the 4th, so "out of service 2 days" was 1 the
        // morning after, and the register the gym answers an injury claim with
        // disagreed with the day the staff member remembers standing there. The
        // service date written a few lines down goes in as the local day too, and
        // two columns of one row in two different calendars is its own bug.
        patch.out_of_service_since = (0, weekStart_1.isoDay)(new Date());
    }
    else {
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
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)(status === 'out_of_service' ? 'Taking that out of service' : 'That equipment', r);
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
async function recordService(sb, id, onIso, entry) {
    // The same correction as `setStatus` above, on the default. Callers that know
    // the day pass `onIso` — app/(owner)/equipment.tsx passes its own `todayIso`,
    // which is local for the reasons its header sets out — and this is what a
    // caller that does not gets. It was UTC's day, so a service logged on a
    // weekday evening west of Greenwich was filed on the following day and the
    // next-due date derived from it came out a day late on every screen.
    const day = onIso ?? (0, weekStart_1.isoDay)(new Date());
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
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That service', r);
}
exports.LOG_KINDS = ['service', 'repair', 'inspection', 'clean', 'incident'];
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
exports.LOG_LABEL = {
    service: 'Service',
    repair: 'Repair',
    inspection: 'Inspection',
    clean: 'Deep clean',
    incident: 'Incident or accident',
};
/**
 * The cost box read once, by the reader the blocker and the write both use.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The screen stripped commas and spaces out of the box — `cost.trim()
 * .replace(/[,\s]/g, '')` — and then multiplied by a hardcoded hundred, and
 * `logBlocker` tested the SAME stripped string against `/^\d+(\.\d{1,2})?$/`.
 * So a front desk in Europe typing `12,50` for a repair produced `1250`, which
 * passed the guard cleanly and was written as 125,000 minor units: a
 * hundredfold overstatement in the gym's maintenance and incident record,
 * entered by a receptionist doing nothing unusual, with the only check on the
 * screen agreeing with it.
 *
 * The hundred was the second half of the same bug. A yen has no minor unit and
 * a Kuwaiti dinar has a thousand of them, so ×100 is wrong in both directions
 * before any comma is typed.
 *
 * `readMinorAmount` refuses the ambiguity instead of resolving it: in a
 * two-place currency `12,50` is either twelve and a half or one thousand two
 * hundred and fifty depending on where the person typing it grew up, and
 * neither reading may be chosen on their behalf. It also asks the currency how
 * many places it has. /costs reads its own money box through the same function.
 *
 * ONE reader, called by the blocker and by the write, because two readers over
 * one box is exactly how the screen came to agree with a figure it was about to
 * get wrong.
 */
function logCost(cost, currency) {
    if (!cost.trim())
        return { ok: true, minorUnits: null };
    if (!currency) {
        return { ok: false, reason: 'This gym has not set its currency, so a cost cannot say what money it is in. Record the entry without one, or set the currency first.' };
    }
    return (0, coachMoney_1.readMinorAmount)(cost, currency);
}
/** Why an entry cannot be recorded, or null when it can. */
function logBlocker(kind, equipmentId, findings, cost, currency) {
    if (!equipmentId && !findings.trim()) {
        return 'An entry has to be about something. With no machine chosen, say what happened — otherwise this is a blank row in an accident book.';
    }
    if (kind === 'incident' && !findings.trim()) {
        return 'An incident with no account of it is not a record of anything. Write what happened while it is fresh.';
    }
    const money = logCost(cost, currency);
    if (!money.ok)
        return money.reason;
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
async function fetchLog(sb, tenantId, equipmentId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => {
        let q = sb
            .from('gym_equipment_log')
            .select('id, equipment_id, equipment_label, kind, happened_on, performed_by, findings, cost_cents, currency, reported_to, recorded_by, created_at')
            .eq('tenant_id', tenantId);
        if (equipmentId)
            q = q.eq('equipment_id', equipmentId);
        return q
            .order('happened_on', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to);
    }, "this gym's maintenance and incident log");
    return rows.map((r) => ({
        id: r.id,
        equipmentId: r.equipment_id ?? null,
        equipmentLabel: r.equipment_label ?? null,
        kind: exports.LOG_KINDS.includes(r.kind) ? r.kind : 'service',
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
async function addLogEntry(sb, tenantId, e) {
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
    if (error)
        throw error;
}
