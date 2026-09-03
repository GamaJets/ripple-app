"use strict";
// The door log — who came in, when, and how long they stayed.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// Why this exists: attendance was only counted where a class was booked and
// ticked off, so every member who walks in, trains on the floor and leaves was
// invisible. That under-count reaches further than the headline figure —
// retention is inferred from attendance pattern breaks, so a member who moved
// from classes to the floor looked exactly like a member who stopped coming.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SWEEP_NOTE = exports.dropPending = exports.PENDING_HOURS = exports.PENDING_CAP = exports.pendingKey = exports.PENDING_PREFIX = exports.OVERRIDE_PREFIX = exports.AdmissionRefused = exports.RESCAN_MINUTES = exports.OPEN_VISIT_HOURS = exports.WEEKDAYS = void 0;
exports.dwellMinutes = dwellMinutes;
exports.averageDwellMinutes = averageDwellMinutes;
exports.currentlyInside = currentlyInside;
exports.duplicateOpenVisits = duplicateOpenVisits;
exports.visitsPerDay = visitsPerDay;
exports.visitsByHour = visitsByHour;
exports.peakHour = peakHour;
exports.visitsByWeekday = visitsByWeekday;
exports.busiestSlots = busiestSlots;
exports.uniqueMembers = uniqueMembers;
exports.summariseVisits = summariseVisits;
exports.lastSeenDays = lastSeenDays;
exports.admissionCheck = admissionCheck;
exports.fetchVisits = fetchVisits;
exports.doorAdmission = doorAdmission;
exports.checkIn = checkIn;
exports.readPending = readPending;
exports.addPending = addPending;
exports.partitionPending = partitionPending;
exports.pendingNote = pendingNote;
exports.wasOverridden = wasOverridden;
exports.checkOut = checkOut;
exports.wasSwept = wasSwept;
exports.isAccountedFor = isAccountedFor;
exports.sweepStaleVisits = sweepStaleVisits;
const rowCap_1 = require("./rowCap");
const wroteRows_1 = require("./wroteRows");
const weekStart_1 = require("./weekStart");
/* ── pure rules (no database, so they are testable and shared) ─────────────── */
/**
 * How long a visit lasted, in minutes. Null when there is no exit — the visitor
 * may still be inside, or the door may simply not record exits.
 *
 * Returns null rather than 0 for an unfinished visit, because a gym reading
 * "average stay: 4 minutes" caused by counting open visits as zero will draw a
 * conclusion about its layout that the data never supported.
 */
function dwellMinutes(v) {
    if (!v.exitedAt)
        return null;
    const a = Date.parse(v.enteredAt);
    const b = Date.parse(v.exitedAt);
    if (Number.isNaN(a) || Number.isNaN(b))
        return null;
    const mins = (b - a) / 60000;
    // The table forbids a negative dwell, but a clock-skewed terminal writing
    // directly could still produce one. Refuse it rather than average it in.
    return mins < 0 ? null : Math.round(mins);
}
/**
 * Mean dwell in minutes across the visits that actually recorded an exit.
 *
 * `closed` reports how many of `total` could be measured, so a screen can say
 * "48 min, from 210 of 380 visits" instead of implying it measured them all.
 */
function averageDwellMinutes(visits) {
    let sum = 0;
    let closed = 0;
    for (const v of visits) {
        const d = dwellMinutes(v);
        if (d == null)
            continue;
        sum += d;
        closed += 1;
    }
    return { minutes: closed === 0 ? null : Math.round(sum / closed), closed, total: visits.length };
}
/**
 * Visits that have no recorded exit — who the gym believes is inside now.
 *
 * ── One row per PERSON, not one row per scan ──────────────────────────────
 *
 * This was `visits.filter(v => !v.exitedAt)` and that is a headcount of open
 * ROWS. Nothing stopped the same member being checked in twice — the desk
 * scanning a card that was handed back down the queue, or two tablets each
 * recording the same arrival — so a member with two open visits was two people
 * standing in the building. That figure is read off the Door screen during a
 * fire evacuation, and a headcount that says eleven when ten are inside is the
 * one number on this screen somebody could be hurt by.
 *
 * So an identified member appears once: their most recent open visit, because
 * that is the one that describes when they are believed to have arrived. The
 * older duplicate is a row somebody has to reconcile, not a body in the room —
 * `duplicateOpenVisits` below is what surfaces it.
 *
 * Anonymous visits are NOT collapsed. A visit with no member id is a
 * deliberate head-count of somebody the desk could not name, and two of them
 * are two different people; folding them together would under-count the
 * evacuation list instead, which is the same fault pointing the other way.
 */
function currentlyInside(visits) {
    const out = [];
    const latestByMember = new Map();
    for (const v of visits) {
        if (v.exitedAt)
            continue;
        if (!v.memberId) {
            out.push(v);
            continue;
        }
        const seen = latestByMember.get(v.memberId);
        if (!seen || Date.parse(v.enteredAt) > Date.parse(seen.enteredAt)) {
            latestByMember.set(v.memberId, v);
        }
    }
    for (const v of latestByMember.values())
        out.push(v);
    return out;
}
/**
 * Open visits that are a second (or third) row for a member who already had
 * one — the rows `currentlyInside` folds away.
 *
 * Said out loud rather than silently dropped. A gym whose door log is
 * accumulating these has a desk double-scanning or a terminal retrying, and a
 * headcount that quietly corrected itself would hide that.
 */
function duplicateOpenVisits(visits) {
    const kept = new Set(currentlyInside(visits).map((v) => v.id));
    return visits.filter((v) => !v.exitedAt && !kept.has(v.id));
}
/** ISO date (YYYY-MM-DD) of a visit, in the viewer's timezone. */
function dayOf(iso) {
    const d = new Date(iso);
    // Local, not UTC: a gym's "Tuesday" is its own Tuesday. A 22:00 visit in
    // Dubai belongs to that evening, not to the next UTC day.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
/** Visit counts per calendar day, oldest first. Days with no visits are absent. */
function visitsPerDay(visits) {
    const byDay = new Map();
    for (const v of visits)
        byDay.set(dayOf(v.enteredAt), (byDay.get(dayOf(v.enteredAt)) ?? 0) + 1);
    return [...byDay.entries()]
        .map(([day, n]) => ({ day, visits: n }))
        .sort((a, b) => a.day.localeCompare(b.day));
}
/**
 * Visit counts by hour of the day, 0–23, every hour present.
 *
 * Every hour is included even at zero, because the shape of a day is the point:
 * a gap at 14:00 is information, and omitting it would let a chart draw a line
 * straight through the quiet hours as though they were busy.
 */
function visitsByHour(visits) {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }));
    for (const v of visits) {
        const h = new Date(v.enteredAt).getHours();
        if (h >= 0 && h < 24)
            hours[h].visits += 1;
    }
    return hours;
}
/**
 * The busiest hour, or null when there is nothing to rank.
 *
 * Ties go to the earlier hour: told two slots are equally busy, a gym should
 * look at the one it reaches first in the day.
 */
function peakHour(visits) {
    if (visits.length === 0)
        return null;
    const byHour = visitsByHour(visits);
    let best = byHour[0];
    for (const h of byHour)
        if (h.visits > best.visits)
            best = h;
    return best.visits === 0 ? null : best;
}
/** Days of the week in the order the product draws one. The order itself is
 *  src/lib/weekStart.ts's decision — a busiest-days strip and the rota beside
 *  it reading two different weeks is the failure this re-export prevents. */
exports.WEEKDAYS = weekStart_1.WEEK_DAYS;
/**
 * Visit counts by day of the week, in `WEEKDAYS` order, every day present.
 *
 * Every day is included at zero for the same reason `visitsByHour` includes
 * every hour: the shape of the week is the answer. A gym that is dead on
 * Fridays needs to see the gap, and a chart that omits it draws a line straight
 * through.
 */
function visitsByWeekday(visits) {
    const out = exports.WEEKDAYS.map((day) => ({ day, visits: 0 }));
    for (const v of visits) {
        const d = new Date(v.enteredAt);
        if (Number.isNaN(d.getTime()))
            continue;
        out[(0, weekStart_1.weekIndexOf)(d)].visits += 1;
    }
    return out;
}
/**
 * The busiest weekday-and-hour slots across a window, busiest first.
 *
 * This is the staffing question, and neither `peakHour` nor `visitsByHour`
 * answers it: both flatten the week, so a gym whose Saturday mornings are
 * heaving and whose Tuesday mornings are empty reads as "busy at 09:00" and
 * gets somebody rostered on the wrong day. A rota is written per weekday, so
 * the figure it needs is per weekday.
 *
 * `days` is carried because the average matters more than the total when the
 * window does not divide evenly into weeks: 30 days holds five Mondays and four
 * Fridays, and a total alone would make Monday look 25% busier than it is.
 *
 * Ties break toward the earlier slot in the week, so a reader given two equal
 * answers is pointed at the one they reach first.
 */
function busiestSlots(visits, limit = 5) {
    const counts = new Map();
    for (const v of visits) {
        const d = new Date(v.enteredAt);
        if (Number.isNaN(d.getTime()))
            continue;
        const weekday = (0, weekStart_1.weekIndexOf)(d);
        const hour = d.getHours();
        const key = `${weekday}:${hour}`;
        let cell = counts.get(key);
        if (!cell) {
            cell = { weekday, hour, visits: 0, days: new Set() };
            counts.set(key, cell);
        }
        cell.visits += 1;
        cell.days.add(dayOf(v.enteredAt));
    }
    return [...counts.values()]
        .map((c) => ({ weekday: c.weekday, hour: c.hour, visits: c.visits, days: c.days.size }))
        .sort((a, b) => b.visits - a.visits
        || a.weekday - b.weekday
        || a.hour - b.hour)
        .slice(0, Math.max(0, limit));
}
/** Distinct identified members. Anonymous head-counts are excluded by design. */
function uniqueMembers(visits) {
    const seen = new Set();
    for (const v of visits)
        if (v.memberId)
            seen.add(v.memberId);
    return seen.size;
}
/** The door-log picture for a period. */
function summariseVisits(visits) {
    const members = uniqueMembers(visits);
    const anonymous = visits.filter((v) => !v.memberId).length;
    const dwell = averageDwellMinutes(visits);
    return {
        visits: visits.length,
        anonymous,
        uniqueMembers: members,
        // Averaging over zero members would be a divide-by-zero dressed as insight.
        visitsPerMember: members === 0 ? null : Math.round(((visits.length - anonymous) / members) * 10) / 10,
        averageDwell: dwell.minutes,
        dwellFrom: dwell.closed,
        peak: peakHour(visits),
        inside: currentlyInside(visits).length,
    };
}
/**
 * Days since each member was last seen, for the retention view.
 *
 * Members absent from `visits` are absent here too — this reports on the log,
 * not on the membership list. Joining the two is the caller's job, and it is
 * the caller who knows which members are frozen or cancelled.
 */
function lastSeenDays(visits, today = Date.now()) {
    const latest = new Map();
    for (const v of visits) {
        if (!v.memberId)
            continue;
        const t = Date.parse(v.enteredAt);
        if (Number.isNaN(t))
            continue;
        if (!latest.has(v.memberId) || t > latest.get(v.memberId))
            latest.set(v.memberId, t);
    }
    return [...latest.entries()]
        .map(([memberId, t]) => ({ memberId, days: Math.max(0, Math.floor((today - t) / 86400000)) }))
        .sort((a, b) => b.days - a.days || a.memberId.localeCompare(b.memberId));
}
/**
 * How long an open visit is treated as somebody who is actually in the
 * building. The same twelve hours `sweepStaleVisits` uses, and for the same
 * reason: nobody trains for twelve hours, and a 6am regular is not back until
 * 6am tomorrow.
 *
 * Past that an open visit is a row nobody closed, and refusing today's arrival
 * because of it would lock a member out over last Tuesday's paperwork.
 */
exports.OPEN_VISIT_HOURS = 12;
/**
 * How close together two scans have to be to be the same arrival typed twice.
 *
 * Two minutes. Long enough to catch the double press and the card handed back
 * down the queue, short enough that somebody who genuinely left and came
 * straight back for their bag is not accused of anything.
 */
exports.RESCAN_MINUTES = 2;
const dayOfIso = (iso) => iso.slice(0, 10);
/**
 * Whether this person may be admitted, and what to say if not.
 *
 * `memberships` is null when the read did not come back. That is UNKNOWN and
 * gets its own verdict: a query that failed is not a member who has not paid,
 * and admitting on a hunch is as wrong as refusing on one. The desk decides,
 * with the situation named.
 *
 * `recent` is this member's visits — the open ones and anything from the last
 * few minutes. Everything else in it is ignored.
 */
function admissionCheck(input) {
    const now = input.now ?? Date.now();
    if (!input.memberId) {
        return {
            verdict: 'ok', code: 'anonymous',
            reason: 'Nobody is named on this visit, so it counts toward the day and reaches no member’s record.',
        };
    }
    // A double scan is checked before anything about the membership, because it
    // is true whatever the membership says and because it is the one a busy desk
    // produces by accident. Order matters here: told "cancelled" on the second
    // scan of a member who is already inside, the desk fixes the wrong problem.
    const recent = input.recent ?? [];
    const openMs = exports.OPEN_VISIT_HOURS * 3600000;
    let freshestOpen = null;
    let stalestOpen = null;
    let lastClosedEntry = null;
    for (const v of recent) {
        const t = Date.parse(v.enteredAt);
        if (Number.isNaN(t))
            continue;
        if (!v.exitedAt) {
            if (now - t <= openMs)
                freshestOpen = freshestOpen == null ? t : Math.max(freshestOpen, t);
            else
                stalestOpen = stalestOpen == null ? t : Math.max(stalestOpen, t);
        }
        else {
            lastClosedEntry = lastClosedEntry == null ? t : Math.max(lastClosedEntry, t);
        }
    }
    if (freshestOpen != null) {
        const mins = Math.max(0, Math.round((now - freshestOpen) / 60000));
        return {
            verdict: 'refuse', code: 'already-inside',
            reason: `They are already checked in — ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago, with no check-out. A second row would put the same person in the evacuation headcount twice.`,
        };
    }
    if (lastClosedEntry != null && now - lastClosedEntry <= exports.RESCAN_MINUTES * 60000) {
        return {
            verdict: 'refuse', code: 'just-scanned',
            reason: `They were checked in and out again within the last ${exports.RESCAN_MINUTES} minutes. That is the same arrival being recorded twice rather than a second visit.`,
        };
    }
    if (input.memberships === null) {
        return {
            verdict: 'refuse', code: 'unknown',
            reason: 'Their membership could not be read, so nothing here knows whether it is live. That is a failed query rather than a member who has not paid — record the visit anyway if you can see they are in good standing.',
        };
    }
    // A pass IS the entitlement. Somebody paying at the desk for a drop-in has no
    // membership to check and never will, and refusing them would refuse the
    // gym's own cash.
    if (input.passId) {
        return { verdict: 'ok', code: 'on-a-pass', reason: null };
    }
    const held = input.memberships;
    if (held.length === 0) {
        return {
            verdict: 'refuse', code: 'no-membership',
            reason: 'This gym holds no membership for them at all. Sell a pass at the desk, or open a membership on the Money screen, so the visit is paid for.',
        };
    }
    const live = held.filter((m) => m.status === 'active' && (m.endsOn == null || m.endsOn >= input.today));
    if (live.length > 0) {
        if (stalestOpen != null) {
            return {
                verdict: 'warn', code: 'stale-open',
                reason: `Their membership is live. They also have a visit from ${dayOfIso(new Date(stalestOpen).toISOString())} that nobody closed — it is not a person in the building and it is counted nowhere.`,
            };
        }
        return { verdict: 'ok', code: 'active', reason: null };
    }
    // The kindest true statement wins. Somebody holding a frozen membership and
    // a cancelled one from two years ago is frozen, not cancelled, and the desk
    // needs the one they can do something about.
    const ended = held.filter((m) => m.status === 'active' && m.endsOn != null && m.endsOn < input.today);
    if (held.some((m) => m.status === 'frozen')) {
        return {
            verdict: 'refuse', code: 'frozen',
            reason: 'Their membership is frozen. Unfreeze it on the Money screen, or sell a pass for today.',
        };
    }
    if (ended.length > 0) {
        const last = ended.map((m) => m.endsOn).sort().slice(-1)[0];
        return {
            verdict: 'refuse', code: 'expired',
            reason: `Their membership ran to ${last} and has not been renewed.`,
        };
    }
    if (held.some((m) => m.status === 'expired')) {
        return {
            verdict: 'refuse', code: 'expired',
            reason: 'Their membership has expired and has not been renewed.',
        };
    }
    return {
        verdict: 'refuse', code: 'cancelled',
        reason: 'Their membership was cancelled. Reopen it on the Money screen, or sell a pass for today.',
    };
}
/** Refused at the door, with the reason the desk needs to read. */
class AdmissionRefused extends Error {
    constructor(admission) {
        super(admission.reason ?? 'That check-in was refused.');
        this.name = 'AdmissionRefused';
        this.admission = admission;
    }
}
exports.AdmissionRefused = AdmissionRefused;
/* ── reads ─────────────────────────────────────────────────────────────────── */
/**
 * The door log for a gym, newest first.
 *
 * Capped through src/lib/rowCap.ts, and this is the read that most needed it.
 * Every caller is in the web console and every one of them turns these rows
 * into a figure somebody acts on: "Inside now" and "Visits today" on the
 * Overview, the conversion rate on Passes, the visits-per-month series on
 * Analytics, and — worst of the four — `lastSeenDays` on Retention, which names
 * a member and says how long it has been since they came in.
 *
 * PostgREST stops at 1000 rows and says nothing, and the order here is
 * `entered_at desc`, so a truncated read keeps the most RECENT thousand visits
 * and drops the older ones. Every member whose last visit fell off the end then
 * looks like a member who has never been through the door: the retention board
 * bands them as lost and the owner rings somebody who trained on Tuesday. That
 * is not a smaller number, it is a false statement about a named person, so the
 * read refuses rather than reporting it.
 *
 * An explicit `limit` is the caller deliberately asking for a prefix — a "last
 * ten arrivals" strip — and is left alone: a set you asked to be cut off is not
 * a set that was cut off behind your back.
 *
 * ── Why a DATED read is finished rather than refused ──────────────────────
 *
 * Refusing was right for the unbounded read and wrong for the bounded one, and
 * the Door screen is what proved it. `/door` asks for thirty days of the log.
 * Thirty days at 34 scans a day is 1020 rows — a busy front desk, not a large
 * gym — and `assertWhole` threw, so the whole screen went to a permanent error:
 * no Inside now, no arrivals, no check-in bar, no pass desk. Staff could not
 * check anybody in from the console at all, and there was no date filter on the
 * screen to work around it with.
 *
 * A window the caller has already bounded is finite by construction and the
 * screen genuinely needs all of it, which is exactly the shape `readAll` exists
 * for (see src/lib/rowCap.ts). The unbounded read — the gym's whole history,
 * with no window at all — still refuses: dragging years of door log into a
 * browser tab to compute one number is not an improvement on saying no.
 *
 * `readAll` orders on `id` after `entered_at` because paging needs a TOTAL
 * order and two people scanning in the same second are two rows Postgres may
 * hand back in either order.
 *
 * ── `whole`, and the one caller that has to have everything ───────────────
 *
 * /export is not computing a figure. Its stated purpose is that leaving with
 * the record must be possible, and it asked for the door log with no window at
 * all — so it landed on the branch that refuses, and the bundle came out
 * carrying a stub file under a banner saying "this bundle is complete".
 *
 * Refusing an UNBOUNDED read is still right for every screen: those are the
 * ones computing a number, and none of them needs the gym's whole history to do
 * it. So the export says what it is doing instead. `whole: true` is a caller
 * stating that it wants every row and will wait for them, which is a different
 * request from "give me the log" and now looks like one in the source.
 * `PAGE_CEILING` refuses past fifty thousand visits either way.
 */
async function fetchVisits(sb, tenantId, opts = {}) {
    const columns = 'id, member_id, pass_id, class_id, entered_at, exited_at, source, note, profiles(full_name)';
    if ((opts.sinceIso || opts.whole) && !opts.limit) {
        const rows = await (0, rowCap_1.readAll)((from, to) => sb
            .from('gym_visits')
            .select(columns)
            .eq('tenant_id', tenantId)
            // Applied only where there is one. `.gte(col, undefined)` is not a
            // no-op in PostgREST — it is a malformed filter — so the whole-log
            // branch must not send it.
            .gte('entered_at', opts.sinceIso ?? '1970-01-01T00:00:00.000Z')
            .order('entered_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to), opts.sinceIso ? 'visits in this period' : "this gym's door log");
        return rows.map(rowToVisit);
    }
    let q = sb
        .from('gym_visits')
        .select(columns)
        .eq('tenant_id', tenantId)
        .order('entered_at', { ascending: false });
    if (opts.sinceIso)
        q = q.gte('entered_at', opts.sinceIso);
    q = q.limit(opts.limit ?? (0, rowCap_1.capLimit)());
    const { data, error } = await q;
    if (error)
        throw error;
    const rows = opts.limit
        ? (data ?? [])
        : (0, rowCap_1.assertWhole)(data, "this gym's door log");
    return rows.map(rowToVisit);
}
function rowToVisit(r) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
        id: r.id,
        memberId: r.member_id ?? null,
        memberName: p?.full_name ?? null,
        passId: r.pass_id ?? null,
        classId: r.class_id ?? null,
        enteredAt: r.entered_at,
        exitedAt: r.exited_at ?? null,
        source: r.source ?? 'desk',
        note: r.note ?? null,
    };
}
/**
 * The prefix an overridden visit's note carries.
 *
 * Exported because three parties depend on the exact string: this function
 * writes it, the Door screen reads it back to mark the row, and
 * supabase/parts/490 matches it so the database's own duplicate guard lets a
 * deliberate override through while still stopping an accidental double scan.
 */
exports.OVERRIDE_PREFIX = 'admitted anyway: ';
/** How far back `checkIn` looks for a scan that is really this same arrival. */
const RESCAN_LOOKBACK_MS = 30 * 60000;
/**
 * What the door knows about this person, read at the moment they are admitted.
 *
 * Two small queries rather than one `or`: PostgREST splits an `or` on commas,
 * an ISO timestamp is full of colons and the quoting rules around that are the
 * kind of thing that silently stops filtering (see `sweepStaleVisits`). Two
 * obviously-correct reads at a desk cost nothing.
 *
 * A refused or broken read throws rather than defaulting. `admissionCheck`
 * distinguishes "no membership" from "unknown", and it can only do that if it
 * is never handed an empty array for a query that failed.
 */
async function doorFacts(sb, tenantId, memberId) {
    const [mem, open, fresh] = await Promise.all([
        sb.from('memberships').select('status, ends_on')
            .eq('tenant_id', tenantId).eq('member_id', memberId).limit((0, rowCap_1.capLimit)()),
        sb.from('gym_visits').select('entered_at, exited_at')
            .eq('tenant_id', tenantId).eq('member_id', memberId).is('exited_at', null)
            .limit((0, rowCap_1.capLimit)()),
        sb.from('gym_visits').select('entered_at, exited_at')
            .eq('tenant_id', tenantId).eq('member_id', memberId)
            .gte('entered_at', new Date(Date.now() - RESCAN_LOOKBACK_MS).toISOString())
            .limit((0, rowCap_1.capLimit)()),
    ]);
    if (mem.error)
        throw mem.error;
    if (open.error)
        throw open.error;
    if (fresh.error)
        throw fresh.error;
    const recent = [...(open.data ?? []), ...(fresh.data ?? [])].map((r) => ({
        enteredAt: r.entered_at, exitedAt: r.exited_at ?? null,
    }));
    return {
        memberships: (0, rowCap_1.assertWhole)(mem.data, 'this member’s memberships')
            .map((r) => ({ status: r.status, endsOn: r.ends_on ?? null })),
        recent,
    };
}
/** The gym's own calendar day for an instant, which is what every admission
 *  rule and every pass expiry is compared against. Local, never UTC: this
 *  product sells in AED and the UTC date does not turn over until 04:00 there. */
function localDayOf(iso) {
    const d = iso ? new Date(iso) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/**
 * Ask the gym's own record whether this person may come in, without writing
 * anything.
 *
 * `checkIn` asks this and refuses on it. It is exported because the Door screen
 * has a SECOND way in — the Take-a-visit button on the pass table — which
 * writes through `redeemPass` and so never reached `checkIn`'s guard at all. A
 * double scan, somebody already inside, and a rescan seconds apart were caught
 * on the top form and on nothing else, and the figure they corrupt is the
 * headcount somebody reads out in an evacuation.
 *
 * The read throws rather than defaulting, exactly as it does inside `checkIn`:
 * `admissionCheck` can only tell "no membership" from "we could not ask" if it
 * is never handed an empty array for a query that failed.
 */
async function doorAdmission(sb, tenantId, input) {
    const facts = await doorFacts(sb, tenantId, input.memberId);
    return admissionCheck({
        memberId: input.memberId,
        passId: input.passId ?? null,
        memberships: facts.memberships,
        recent: facts.recent,
        today: localDayOf(input.enteredAtIso),
    });
}
/**
 * Record an arrival, having first asked whether this person may come in.
 *
 * ── What this used to be ──────────────────────────────────────────────────
 *
 * A bare insert. It never read `memberships`, so a membership cancelled in
 * March admitted its holder with one click in June; and it never read
 * `gym_visits`, so one card could badge in an unlimited queue behind it and put
 * the same person into the evacuation headcount as many times as it was
 * scanned. The rule lives in `admissionCheck` above, where it can be asserted
 * without a database; this is the part that makes it unavoidable, because a
 * guard the caller has to remember to call is a guard the next caller will not.
 *
 * ── The failure mode this deliberately keeps ──────────────────────────────
 *
 * A refusal here is not the end of it. `overrideReason` admits them anyway and
 * writes the reason onto the visit — a desk that cannot record a member it can
 * plainly see standing there stops recording visits altogether, and the door
 * log is what attendance, fill rate and retention are all built on.
 *
 * An anonymous check-in still asks nothing and is still allowed: there is no
 * person to ask about, and an unattributable head-count is a real answer.
 */
async function checkIn(sb, tenantId, v = {}) {
    const override = (v.overrideReason ?? '').trim();
    let admission = { verdict: 'ok', code: 'anonymous', reason: null };
    if (v.memberId) {
        if (override) {
            // The read is skipped rather than made and ignored. Staff have already
            // decided, the answer would change nothing, and the one thing a desk with
            // somebody standing at it does not need is a query it is not going to act
            // on — including one that fails.
            admission = { verdict: 'warn', code: 'unknown', reason: null };
        }
        else {
            admission = await doorAdmission(sb, tenantId, {
                memberId: v.memberId,
                passId: v.passId ?? null,
                enteredAtIso: v.enteredAtIso,
            });
            if (admission.verdict === 'refuse')
                throw new AdmissionRefused(admission);
        }
    }
    // The override reason and any desk note both belong on the row, and the
    // override goes first: it is the reason the row exists at all.
    const noteParts = [
        override ? `${exports.OVERRIDE_PREFIX}${override}` : null,
        (v.note ?? '').trim() || null,
    ].filter((s) => s !== null);
    const { error } = await sb.from('gym_visits').insert({
        tenant_id: tenantId,
        member_id: v.memberId ?? null,
        pass_id: v.passId ?? null,
        class_id: v.classId ?? null,
        entered_at: v.enteredAtIso ?? new Date().toISOString(),
        source: v.source ?? 'desk',
        note: noteParts.length ? noteParts.join(' · ') : null,
    });
    if (error)
        throw error;
}
/** The browser key the desk's queue lives under. One per gym, because a
 *  shared machine can be signed into more than one over its life and one
 *  gym's arrivals must never flush into another's log.
 *
 *  Still v1 after departures joined it: `readPending` fills `kind` in as 'in'
 *  for a row written by the older build, which is what those rows are. Bumping
 *  the key would have thrown away the arrivals a desk was holding at the moment
 *  it reloaded, which is the one thing this queue exists to stop. */
exports.PENDING_PREFIX = 'door-queue:v1:';
const pendingKey = (tenantId) => `${exports.PENDING_PREFIX}${tenantId}`;
exports.pendingKey = pendingKey;
/**
 * How many arrivals the queue will hold.
 *
 * A front desk during an outage, not a data store. Two hundred is more than a
 * gym takes in a morning and small enough that the whole thing is one cheap
 * read on every render.
 */
exports.PENDING_CAP = 200;
/**
 * How long a queued arrival stays worth writing.
 *
 * Twelve hours, the same figure the sweep uses, and for a related reason:
 * beyond that it is not today's arrival any more. Writing a visit from
 * yesterday evening into this morning's log at 09:00 would put a stranger into
 * "Inside now" and a phantom into the busiest-hour count. A lapsed item is not
 * silently dropped — `partitionPending` hands it back so the screen can say
 * what was lost, which is the difference between a queue and a bin.
 */
exports.PENDING_HOURS = 12;
/** Read a queue back off the browser, without ever throwing at a front desk. */
function readPending(raw) {
    if (raw == null)
        return { items: [], read: true };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return { items: [], read: false };
        const items = parsed.filter((x) => {
            // `enteredAtIso` is what the build before departures wrote. Read as well
            // as `atIso` so a desk that reloads mid-outage keeps what it is holding.
            const at = typeof x?.atIso === 'string' ? x.atIso : x?.enteredAtIso;
            return x && typeof x.id === 'string' && typeof x.tenantId === 'string'
                && typeof at === 'string' && !Number.isNaN(Date.parse(at))
                // A departure with no visit to close is not a departure. It would flush
                // for ever against nothing, so it is not admitted to the queue at all.
                && (x.kind !== 'out' || typeof x.visitId === 'string');
        }).map((x) => {
            const at = typeof x.atIso === 'string' ? x.atIso : x.enteredAtIso;
            return {
                id: x.id,
                tenantId: x.tenantId,
                kind: x.kind === 'out' ? 'out' : 'in',
                memberId: x.memberId ?? null,
                memberName: x.memberName ?? null,
                passId: x.passId ?? null,
                classId: x.classId ?? null,
                atIso: at,
                visitId: typeof x.visitId === 'string' ? x.visitId : null,
                queuedAt: Number.isFinite(x.queuedAt) ? x.queuedAt : Date.parse(at),
                tries: Number.isFinite(x.tries) ? x.tries : 0,
                refusedWhy: typeof x.refusedWhy === 'string' ? x.refusedWhy : null,
            };
        });
        return { items, read: true };
    }
    catch {
        // `read: false` rather than an empty queue, for the same reason every read
        // in this codebase separates the two: a store that could not be parsed is
        // not a desk with nothing waiting, and a screen told the second would stop
        // looking.
        return { items: [], read: false };
    }
}
/** Add one, oldest first, dropping the oldest if the queue is at its cap. */
function addPending(list, item) {
    const next = [...list.filter((i) => i.id !== item.id), item]
        .sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso) || a.id.localeCompare(b.id));
    // From the FRONT: at the cap the oldest arrival is the one least likely still
    // to be worth writing, and dropping the newest would lose the person standing
    // at the desk right now.
    return next.length > exports.PENDING_CAP ? next.slice(next.length - exports.PENDING_CAP) : next;
}
const dropPending = (list, id) => list.filter((i) => i.id !== id);
exports.dropPending = dropPending;
/** Split into what is still worth writing and what has gone stale. */
function partitionPending(list, now = Date.now()) {
    const cutoff = now - exports.PENDING_HOURS * 3600000;
    const live = [];
    const lapsed = [];
    for (const i of list)
        (Date.parse(i.atIso) >= cutoff ? live : lapsed).push(i);
    return { live, lapsed };
}
/** The sentence the desk reads while writes are waiting. Null when none are. */
function pendingNote(list) {
    if (list.length === 0)
        return null;
    const stuck = list.filter((i) => i.refusedWhy !== null).length;
    const held = list.filter((i) => i.refusedWhy === null);
    const waiting = held.filter((i) => i.kind === 'in').length;
    const leaving = held.filter((i) => i.kind === 'out').length;
    const parts = [];
    if (waiting > 0) {
        parts.push(`${waiting} ${waiting === 1 ? 'arrival is' : 'arrivals are'} held on this machine and not yet on the record — they go up on their own as soon as the connection is back, stamped with the minute the person actually came in.`);
    }
    // Said separately from the arrivals, because the cost is the other way round
    // and it is the one on this screen somebody could be hurt by: until a held
    // departure lands, the gym believes that person is still in the building and
    // Inside now counts them.
    if (leaving > 0) {
        parts.push(`${leaving} ${leaving === 1 ? 'check-out is' : 'check-outs are'} held here too, with the minute they left on ${leaving === 1 ? 'it' : 'them'}. Until ${leaving === 1 ? 'it lands' : 'they land'} the gym still has ${leaving === 1 ? 'that person' : 'those people'} inside, so Inside now is over-counting by ${leaving}.`);
    }
    if (stuck > 0) {
        parts.push(`${stuck} ${stuck === 1 ? 'was' : 'were'} refused by the gym's own record rather than by the network, so ${stuck === 1 ? 'it needs' : 'they need'} a decision below.`);
    }
    return parts.join(' ');
}
/** True when this visit was recorded against the gym's own answer. */
function wasOverridden(v) {
    return !!v.note && v.note.startsWith(exports.OVERRIDE_PREFIX);
}
/**
 * Record a departure against an open visit.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts. This
 * update has TWO ways to match zero rows and neither of them is an error:
 * `gym_visits_staff_u` is `tenant_id = my_tenant() AND my_role() in (trainer,
 * owner)`, so anyone else's click is filtered away silently; and the
 * `exited_at is null` guard below means a visit somebody already closed at the
 * other desk matches nothing either. Without the count the desk saw the row
 * reload unchanged, clicked Check out again, and read the gym as slow rather
 * than as refusing.
 */
async function checkOut(sb, visitId, exitedAtIso) {
    const r = await sb
        .from('gym_visits')
        .update({ exited_at: exitedAtIso ?? new Date().toISOString() }, { count: 'exact' })
        .eq('id', visitId)
        // Only close a visit that is actually open, so a re-scan at the door cannot
        // overwrite a departure already recorded.
        .is('exited_at', null);
    (0, wroteRows_1.assertWrote)('That check-out', r);
}
/**
 * The exact note a sweep writes, and the marker that stops it running twice.
 *
 * Exported because two callers depend on the exact string: the sweep itself, to
 * skip rows it has already marked, and the Door screen, to tell a visit nobody
 * ever closed from one the sweep has already accounted for.
 */
exports.SWEEP_NOTE = 'auto-closed: no exit recorded';
/** True when this visit has already been through a sweep. */
function wasSwept(v) {
    return v.note === exports.SWEEP_NOTE;
}
/**
 * True when nobody needs to look at this open visit again.
 *
 * Two ways that can be so, and they are different facts: a sweep has marked it,
 * or it carries a staff override, which the sweep deliberately will not
 * overwrite. Without this second case the Door screen would offer to sweep the
 * same overridden rows for ever and report a number it could never bring down.
 */
function isAccountedFor(v) {
    return wasSwept(v) || wasOverridden(v);
}
/**
 * Mark the visits nobody closed — the ones where somebody left without scanning
 * out.
 *
 * ── What it does NOT do, deliberately ─────────────────────────────────────
 *
 * It does not write `exited_at`. The visit stays open forever and
 * `averageDwellMinutes` continues to ignore it, because stamping a plausible
 * exit would quietly corrupt every dwell figure computed afterwards — and a
 * twenty-hour stay in the average is not a rounding error, it is the reason the
 * average exists. What the sweep records is that somebody has LOOKED at the row
 * and it is not a person standing in the building.
 *
 * ── Why the note is also a guard ──────────────────────────────────────────
 *
 * This used to match on `exited_at is null and entered_at < cutoff` alone, so
 * every run re-updated every stale visit the gym had ever accumulated and
 * returned the same growing count each time. Nightly that is wasted writes; from
 * a button on the Door screen it is a lie — "12 swept" every single press, for
 * the same twelve rows, when eleven of them were swept last Tuesday.
 *
 * The `or` is how PostgREST expresses "not already swept" over a nullable
 * column: a plain `.neq('note', …)` drops rows whose note IS null, which is the
 * majority of them and exactly the set that most needs sweeping. Rows carrying
 * a note the DESK wrote are still swept — theirs is overwritten, which is a
 * real cost and the smaller one: a desk note on a visit nobody closed is worth
 * less than an accurate count of what remains open.
 *
 * Returns how many rows this run actually marked. Zero is a real answer and
 * means the building is tidy, not that the sweep failed.
 */
async function sweepStaleVisits(sb, tenantId, hours = 12) {
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const { data, error } = await sb
        .from('gym_visits')
        .update({ note: exports.SWEEP_NOTE })
        .eq('tenant_id', tenantId)
        .is('exited_at', null)
        .lt('entered_at', cutoff)
        // Double-quoted: PostgREST splits an `or` on commas and dots, and the note
        // contains a space and a colon. Unquoted, the filter is parsed as a
        // different clause and the guard silently stops guarding.
        .or(`note.is.null,note.neq."${exports.SWEEP_NOTE}"`)
        // An override note is the ONE desk note the sweep may not overwrite. It is
        // the gym recording that it admitted somebody against its own record, with
        // the member of staff's reason on it, and it is the row an audit comes
        // looking for. Everything else the desk types is worth less than an
        // accurate count of what is still open; this is not.
        .not('note', 'like', `${exports.OVERRIDE_PREFIX}%`)
        .select('id');
    if (error)
        throw error;
    return (data ?? []).length;
}
