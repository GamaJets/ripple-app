"use strict";
// Staff — the gym's own people, and what the record can honestly say about each.
//
// The console could already see a trainer three ways and never as a person on a
// payroll: the Overview lists a roster with a health dot, /sessions prices the
// one-to-ones, /timetable draws the rota. An owner asking the ordinary Monday
// question — who works here, what did they deliver, what do I owe them, were
// they on the floor for the hours I rostered, and is anyone's book quietly
// emptying — had to hold four screens in their head and join them by name.
//
// Framework-free on purpose, and further than the reading modules go: there is
// not a Supabase client anywhere in here. Every function takes rows already
// fetched and returns a conclusion, so the same reasoning runs in the console,
// in the phone app, and in a test under plain node. The reads stay in the
// screen, because the reads are where the failure modes live and only the
// screen can render its own failures. Same shape as monthEnd.ts and
// memberView.ts.
//
// ── The trap this module exists to avoid ───────────────────────────────────
//
// A trainer with no data must NEVER rank as fine.
//
// This codebase has been bitten by it repeatedly. `atRiskClient` in
// trainerMock.ts returns false for a client it has never seen a data point
// from — reporting "not at risk" about somebody it knows nothing about.
// `clientDrift.ts` was written to end the same bug on the coach's book.
//
// On a staff screen it has a second, sharper form, and this is the one that
// costs money. `trainerHealth` in ownerAnalytics.ts scores on `sessions30` —
// bookings whose clock has passed, marked or not. A trainer with five clients
// and twenty sessions that NOBODY MARKED scores as healthy and reads
// "Carrying clients and delivering sessions", when the truthful statement is
// that there is no evidence any of the twenty happened. That trainer is also
// the one whose pay cannot be computed. Scoring them green is the exact
// inversion of what the owner needs to see.
//
// So `assess()` below puts an EVIDENCE GATE in front of ownerAnalytics rather
// than beside it. `trainerHealth` still owns the healthy / watch / at-risk
// judgement — its vocabulary is not forked and its reasons are printed
// verbatim — but it is only asked the question when the record can support an
// answer, and it is asked about CONFIRMED delivery rather than about bookings.
// Where the record cannot support an answer the result is UNKNOWN, which is a
// state of the evidence and not a grade of the person.
//
// Four ways a trainer ends up UNKNOWN, all of them named on screen:
//   · the read that would judge them failed or is still in flight;
//   · nothing at all on record — no clients, no sessions;
//   · sessions finished and not one has an outcome, so delivery is unknown
//     in both directions;
//   · they joined days ago and nothing is marked yet.
//
// ── No invented figures ────────────────────────────────────────────────────
//
// Every derived number is `number | null`, and null means "the record cannot
// say", never zero. A trainer whose rota was not read has `rosteredHours:
// null`; so does a trainer with no live shift. Both render as a dash with a
// sentence, and neither is reported as a trainer who worked no hours.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_STATUS_LABEL = exports.STAFF_RANK = exports.STAFF_COST = exports.STAFF_LABEL = exports.STAFF_PARTS = exports.NEW_TRAINER_DAYS = void 0;
exports.brokenStaffParts = brokenStaffParts;
exports.loadingStaffParts = loadingStaffParts;
exports.truncatedStaffParts = truncatedStaffParts;
exports.staffTruncationWarning = staffTruncationWarning;
exports.staffCompleteness = staffCompleteness;
exports.staffWarning = staffWarning;
exports.bandTitle = bandTitle;
exports.bandNote = bandNote;
exports.compareStaff = compareStaff;
exports.buildStaff = buildStaff;
exports.caveatOf = caveatOf;
const memberView_1 = require("./memberView");
const gymSessions_1 = require("./gymSessions");
const gymRota_1 = require("./gymRota");
const ownerAnalytics_1 = require("./ownerAnalytics");
const status_1 = require("./status");
const clientDrift_1 = require("./clientDrift");
const DAY = 86400000;
const HOUR_MIN = 60;
/** A trainer joined less recently than this has had a fair chance to appear in
 *  the record. Inside it, an empty record is newness rather than a problem. */
exports.NEW_TRAINER_DAYS = 14;
const round1 = (n) => Math.round(n * 10) / 10;
const s = (n) => (n === 1 ? '' : 's');
exports.STAFF_PARTS = [
    'trainers', 'sessions', 'shifts', 'clients', 'activity', 'classes',
];
exports.STAFF_LABEL = {
    trainers: 'the staff roster',
    sessions: 'the one-to-ones',
    shifts: 'the rota',
    clients: 'the client book',
    activity: 'the training record',
    classes: 'the timetable',
};
/** What the screen loses when a part cannot be read — named as the missing
 *  ANSWER, not the missing table. "shifts failed" tells an owner nothing;
 *  "rostered hours are unknown, not nil" tells them everything. */
exports.STAFF_COST = {
    trainers: 'there is no roster, so this page cannot name anybody',
    sessions: 'what was delivered and what is owed are unknown, and nobody can be judged on delivery',
    shifts: 'rostered hours are unknown, not nil — no trainer can be shown against the hours they were booked for',
    clients: 'nobody\'s book can be counted, so client load is unknown rather than empty',
    activity: 'no client can be assessed for drift, so a silent book looks the same as a steady one',
    classes: 'class hours are missing, so a trainer who teaches will look under-used',
};
function brokenStaffParts(rec) {
    return exports.STAFF_PARTS
        .filter((p) => rec[p].state === 'failed')
        .map((p) => ({
        part: p,
        label: exports.STAFF_LABEL[p],
        cost: exports.STAFF_COST[p],
        reason: rec[p].reason,
    }));
}
function loadingStaffParts(rec) {
    return exports.STAFF_PARTS.filter((p) => rec[p].state === 'loading');
}
/** The parts that came back, and came back short. */
function truncatedStaffParts(rec) {
    return exports.STAFF_PARTS.filter((p) => rec[p].state === 'partial');
}
/**
 * The sentence to put above a staff page whose reads came back SHORT, or null
 * when nothing was truncated.
 *
 * Its own sentence, not folded into `staffWarning`. On this page in particular
 * the two are acted on differently: a failed roster read is a fault to chase,
 * and a truncated one is a set of named people who are simply not on a payroll
 * screen — which reads as a gym with fewer coaches rather than as a read that
 * ran short.
 */
function staffTruncationWarning(rec) {
    const cut = truncatedStaffParts(rec);
    if (!cut.length)
        return null;
    const names = cut.map((p) => exports.STAFF_LABEL[p]);
    const one = cut.length === 1;
    const list = one
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const costs = cut.map((p) => exports.STAFF_COST[p]).join('; ');
    return (`Read the first rows of ${list} and there are more. ${one ? 'That part is' : 'Those parts are'} ` +
        `a PREFIX, not the whole record — ${costs}. Every figure over ${one ? 'it' : 'them'} is withheld ` +
        `rather than shown as a subtotal.`);
}
/**
 * Whether this page is entitled to present itself as a whole picture.
 *
 * 'broken' outranks 'loading', as in memberView: once something has definitively
 * failed the screen is incomplete no matter what else is still arriving, and
 * saying "loading" would promise a completeness that is not coming.
 */
function staffCompleteness(rec) {
    if (brokenStaffParts(rec).length)
        return 'broken';
    if (loadingStaffParts(rec).length)
        return 'loading';
    // 'truncated' rather than 'whole', which is what this returned before the
    // fourth state existed: a page built on a prefix was reporting itself as a
    // whole picture, which is the one answer it must never give.
    return truncatedStaffParts(rec).length ? 'truncated' : 'whole';
}
/**
 * The sentence above a half-loaded staff page, or null when every part is in.
 *
 * Same rule as `memberView.partialWarning` and `monthEnd.closeWarning`: name the
 * half that failed AND what the reader is therefore not seeing. A staff page is
 * read to decide who to talk to and what to pay them; a partial one presented
 * as whole gets somebody the wrong conversation or the wrong money.
 */
function staffWarning(rec) {
    const broken = brokenStaffParts(rec);
    if (!broken.length)
        return null;
    const names = broken.map((b) => b.label);
    const list = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Could not read ${list}. This page is partial, not empty — ${broken.map((b) => b.cost).join('; ')}.`;
}
/**
 * The staff page's ordering. Built from `STATUS_RANK` and differing from it in
 * exactly one place, deliberately: `idle` — this module's UNKNOWN — moves from
 * last to second.
 *
 * This is the same deviation `DRIFT_RANK` makes in clientDrift.ts, for the same
 * reason and with the same care. STATUS_RANK sinks `idle` because on the
 * Overview's glance-roster "nothing to assess" is not a call to action and
 * floating it would bury the rows that are. On THIS page it is the opposite: a
 * trainer the record cannot judge is a trainer whose pay cannot be computed and
 * whose delivery nobody has confirmed, and burying them under the healthy rows
 * is precisely how a gym pays the wrong amount. Never last, and never mixed in
 * among the fine.
 */
exports.STAFF_RANK = {
    ...status_1.STATUS_RANK,
    at_risk: 0,
    idle: 1,
    watch: 2,
    on_track: 3,
};
/**
 * The staff page's labels. STATUS_LABEL's three concern levels are reused
 * verbatim; only `idle` is re-worded, exactly as DRIFT_LABEL does — "Idle"
 * printed beside an employee's name on their employer's dashboard reads as a
 * verdict on them, when what is actually true is that we do not know.
 */
exports.STAFF_STATUS_LABEL = {
    ...status_1.STATUS_LABEL,
    idle: 'Unknown',
};
/** The heading a band gets on the staff list. */
function bandTitle(status) {
    switch (status) {
        case 'at_risk': return 'Needs attention';
        case 'idle': return 'Nothing the record can judge';
        case 'watch': return 'Worth a look';
        default: return 'Delivering';
    }
}
/** What a band means, said once under its heading rather than on every row. */
function bandNote(status) {
    switch (status) {
        case 'at_risk': return 'Carrying clients and not delivering, on the record as it stands.';
        case 'idle': return 'No evidence either way. Not the same as fine — find out which.';
        case 'watch': return 'Delivering, but something about the pattern is off.';
        default: return 'Clients on the book and confirmed sessions behind them.';
    }
}
/** Worst first, unknown directly beneath. Within a band, the bigger book leads
 *  — of two equally flagged trainers, the one carrying more clients is the
 *  larger exposure and the call to make first. */
function compareStaff(a, b) {
    const r = exports.STAFF_RANK[a.status] - exports.STAFF_RANK[b.status];
    if (r !== 0)
        return r;
    const ca = a.clients ?? -1, cb = b.clients ?? -1;
    if (ca !== cb)
        return cb - ca;
    const ua = a.unmarked ?? -1, ub = b.unmarked ?? -1;
    if (ua !== ub)
        return ub - ua;
    return (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.trainerId.localeCompare(b.trainerId);
}
/**
 * The whole staff picture.
 *
 * Every input arrives as a slice and every output that depends on a slice which
 * is not ready is null. There is no branch anywhere in here that substitutes an
 * empty array for a failed read, and no branch that lets a trainer with no
 * evidence come out on_track.
 */
function buildStaff(rec, opts) {
    const now = opts.now ?? Date.now();
    const windows = opts.windows ?? clientDrift_1.DEFAULT_WINDOWS;
    const fallback = opts.fallbackRateCents ?? null;
    const trainerRows = (0, memberView_1.rowsOf)(rec.trainers);
    const sessionRows = (0, memberView_1.rowsOf)(rec.sessions);
    const shiftRows = (0, memberView_1.rowsOf)(rec.shifts);
    const clientRows = (0, memberView_1.rowsOf)(rec.clients);
    const activityRows = (0, memberView_1.rowsOf)(rec.activity);
    const classRows = (0, memberView_1.rowsOf)(rec.classes);
    // Payroll is computed ONCE over the whole window, by the same function
    // /sessions and /close use. Recomputing per trainer here would be a second
    // opinion about the same money.
    const lines = sessionRows ? (0, gymSessions_1.payrollByTrainer)(sessionRows, opts.policy, fallback, now) : null;
    const lineOf = new Map((lines ?? []).map((l) => [l.trainerId, l]));
    // What a settlement would actually cover: unsettled, marked, priced, payable.
    // Same fallback the payroll lines above were priced with. Without it this
    // drops every session carried by the gym's standard fee, and the staff view
    // reports a trainer as owed money that the settle path would not pay.
    const settleable = sessionRows ? (0, gymSessions_1.settleableSessions)(sessionRows, opts.policy, now, fallback) : null;
    const settleableOf = new Map();
    for (const x of settleable ?? []) {
        const list = settleableOf.get(x.trainerId) ?? [];
        list.push(x);
        settleableOf.set(x.trainerId, list);
    }
    const activityOf = new Map((activityRows ?? []).map((a) => [a.clientId, a.events]));
    const members = trainerRows
        ? trainerRows
            .map((t) => assess(t, {
            rec, now, windows, windowDays: opts.windowDays,
            sessions: sessionRows, shifts: shiftRows, clients: clientRows,
            classes: classRows, activityOf,
            line: lineOf.get(t.trainerId) ?? null,
            settleableRows: settleableOf.get(t.trainerId) ?? null,
        }))
            .sort(compareStaff)
        : null;
    // Money owed to somebody who is not on the roster. Only claimable when the
    // roster itself was read — without it every line looks off-roster.
    const known = new Set((trainerRows ?? []).map((t) => t.trainerId));
    const offRoster = trainerRows && lines
        ? lines.filter((l) => !known.has(l.trainerId))
        : null;
    return {
        members,
        rollup: rollupOf(members, clientRows, sessionRows, classRows),
        offRoster,
        warning: staffWarning(rec),
        truncated: staffTruncationWarning(rec),
        caveat: caveatOf(members),
    };
}
function assess(t, x) {
    const { now, windowDays } = x;
    const sinceMs = t.since ? Date.parse(t.since) : NaN;
    const observedDays = Number.isFinite(sinceMs)
        ? Math.max(0, Math.floor((now - sinceMs) / DAY))
        : null;
    /* ── delivery ─────────────────────────────────────────────────────────── */
    const mine = x.sessions == null
        ? null
        : x.sessions.filter((s) => s.trainerId === t.trainerId && s.status === 'booked');
    let delivered = null;
    let noShows = null;
    let cancelled = null;
    let unmarked = null;
    let upcoming = null;
    let deliveredMin = 0;
    let unmarkedMin = 0;
    if (mine) {
        delivered = 0;
        noShows = 0;
        cancelled = 0;
        unmarked = 0;
        upcoming = 0;
        for (const sn of mine) {
            if (sn.outcome === 'completed') {
                delivered++;
                deliveredMin += sn.durationMin;
            }
            else if (sn.outcome === 'no_show')
                noShows++;
            else if (sn.outcome === 'cancelled' || sn.outcome === 'late_cancelled')
                cancelled++;
            else if ((0, gymSessions_1.isAwaitingOutcome)(sn, now)) {
                unmarked++;
                unmarkedMin += sn.durationMin;
            }
            // Booked, unmarked, and not finished yet. Nothing has happened, so it is
            // neither delivery nor an outcome anybody is late recording.
            else
                upcoming++;
        }
    }
    const sessions = mine ? mine.length : null;
    const marked = mine ? delivered + noShows + cancelled : null;
    /* ── money ────────────────────────────────────────────────────────────── */
    const outstandingRows = x.sessions == null ? null : (x.settleableRows ?? []);
    const outstandingSessions = outstandingRows ? outstandingRows.length : null;
    const outstandingCents = outstandingRows && outstandingRows.length
        ? (0, gymSessions_1.settlementAmount)(outstandingRows)
        : null;
    // `settleBlocker` answers "is there anything to hand over, and is it safe" —
    // a different question from `settlementBlocker`, which asks whether a figure
    // on screen is final. Only asked when the sessions were actually read.
    const blocker = outstandingRows ? (0, gymSessions_1.settleBlocker)(outstandingRows, unmarked ?? 0) : null;
    /* ── hours ────────────────────────────────────────────────────────────── */
    const theirShifts = x.shifts == null
        ? null
        : x.shifts.filter((sh) => sh.trainerId === t.trainerId);
    let rosteredHours = null;
    let pulledShifts = null;
    if (theirShifts) {
        pulledShifts = theirShifts.filter((sh) => !(0, gymRota_1.isLive)(sh)).length;
        for (const sh of theirShifts) {
            if (!(0, gymRota_1.isLive)(sh))
                continue;
            const h = (0, gymRota_1.shiftHours)(sh);
            if (h == null)
                continue; // an unreadable span is not a shift of no length
            rosteredHours = (rosteredHours ?? 0) + h;
        }
        if (rosteredHours != null)
            rosteredHours = round1(rosteredHours);
    }
    // Null while nothing of theirs is marked: with no outcome recorded anywhere,
    // "0 hours delivered" is a claim the record cannot make.
    const deliveredHours = marked && marked > 0 ? round1(deliveredMin / HOUR_MIN) : null;
    const unmarkedHours = sessions ? round1(unmarkedMin / HOUR_MIN) : null;
    const classHours = x.classes == null
        ? null
        : round1(x.classes
            .filter((c) => c.kind === 'class' && c.trainerId === t.trainerId)
            .reduce((a, c) => a + c.durationMin, 0) / HOUR_MIN);
    const floorUse = deliveredHours != null && rosteredHours != null && rosteredHours > 0
        ? deliveredHours / rosteredHours
        : null;
    /* ── the book ─────────────────────────────────────────────────────────── */
    const theirClients = x.clients == null
        ? null
        : x.clients.filter((c) => c.trainerId === t.trainerId);
    const clients = theirClients ? theirClients.length : null;
    // Both halves or nothing. Drift over an unread activity table would report
    // every client as silent, which on this page reads as a trainer who has lost
    // their whole book.
    const book = theirClients && x.rec.activity.state === 'ready'
        ? (0, clientDrift_1.sortByDrift)(theirClients.map((c) => (0, clientDrift_1.assessDrift)({ clientId: c.clientId, events: x.activityOf.get(c.clientId) ?? [], since: c.since }, now, x.windows)))
        : null;
    const bands = (0, clientDrift_1.summariseDrift)(book);
    /* ── the verdict, or the refusal ──────────────────────────────────────── */
    const v = verdict({
        rec: x.rec, windowDays, name: t.name,
        clients, sessions, marked, delivered, unmarked, observedDays,
    });
    return {
        trainerId: t.trainerId,
        name: t.name,
        since: t.since,
        observedDays,
        clients,
        sessions, delivered, noShows, cancelled, unmarked, upcoming, marked,
        owedCents: x.line?.cents ?? null,
        payable: x.line?.payable ?? null,
        priced: x.line?.priced ?? null,
        outstandingCents,
        outstandingSessions,
        settleBlocker: blocker,
        settleable: outstandingRows != null && outstandingRows.length > 0 && blocker == null,
        rosteredHours,
        shifts: theirShifts ? theirShifts.length : null,
        pulledShifts,
        deliveredHours,
        unmarkedHours,
        classHours,
        floorUse,
        hoursNote: hoursNote({ rosteredHours, deliveredHours, unmarkedHours, classHours, rec: x.rec }),
        book,
        drifting: bands?.drifting ?? null,
        watchClients: bands?.watch ?? null,
        unknownClients: bands?.unknown ?? null,
        steadyClients: bands?.steady ?? null,
        status: v.status,
        unknown: v.unknown,
        reason: v.reason,
    };
}
/**
 * The evidence gate, and then `trainerHealth`.
 *
 * Nothing below invents a grade. Every branch that cannot demonstrate delivery
 * returns `idle` — UNKNOWN — with a sentence saying which kind of nothing it
 * is looking at. Only the last branch reaches ownerAnalytics, and it reaches it
 * with CONFIRMED sessions rather than bookings.
 */
function verdict(v) {
    const unknown = (reason) => ({ status: (0, status_1.statusFromRisk)('idle'), unknown: true, reason });
    // 1. The reads that would judge them. A verdict computed over a failed read is
    //    not a verdict; a verdict computed over a read still in flight is a guess
    //    that will be contradicted in a second.
    if (v.sessions == null) {
        return unknown(v.rec.sessions.state === 'failed'
            ? 'The one-to-ones could not be read, so there is no record of delivery to judge — this is unknown, not nil.'
            : 'Still reading the one-to-ones. Nothing is claimed about delivery yet.');
    }
    if (v.clients == null) {
        return unknown(v.rec.clients.state === 'failed'
            ? 'The client book could not be read, so how much this trainer is carrying is unknown — and a trainer with no clients reads very differently from one whose clients did not load.'
            : 'Still reading the client book.');
    }
    // 2. Nothing at all on record. Same fact `trainerHealth` calls idle, said in
    //    this page's words.
    if (v.clients === 0 && v.sessions === 0) {
        return unknown(`No client on their book and no one-to-one on record in the last ${v.windowDays} days. Nothing to assess — which is not the same as nothing wrong.`);
    }
    // 3. THE one this module exists for. Sessions ran and not one carries an
    //    outcome, so delivery is unknown in BOTH directions. `trainerHealth`
    //    would score these as sessions and call the trainer healthy; they are
    //    also exactly the sessions that stop their pay being computed.
    //
    //    Counted on the FINISHED sessions, not on every booked slot: a session
    //    next Tuesday is not one anybody is late marking.
    const finished = (v.marked ?? 0) + (v.unmarked ?? 0);
    if (v.marked === 0 && finished > 0) {
        return unknown(`${finished} one-to-one${s(finished)} finished and not one has an outcome recorded. There is no evidence of delivery either way, and no pay can be computed over ${finished === 1 ? 'it' : 'them'}.`);
    }
    // 4. Too new to have a record. A trainer who joined on Tuesday with three
    //    clients and nothing marked is not failing to deliver.
    if (v.marked === 0 && v.observedDays != null && v.observedDays < exports.NEW_TRAINER_DAYS) {
        const d = v.observedDays;
        return unknown(`On the books ${d} day${s(d)} with nothing marked yet — too little record to say anything.`);
    }
    // 5. There is evidence. `trainerHealth` owns the judgement from here, and its
    //    reason is printed verbatim so this page and the Overview cannot be read
    //    as holding two opinions.
    //
    //    `sessions30` is fed the DELIVERED count, not the booked one. Its own
    //    doc-comment says the booked figure "is not the same as what was
    //    confirmed delivered — use `delivered30` for anything that costs money",
    //    and a staff page is entirely about what costs money. A trainer with
    //    twenty no-shows and nothing delivered comes back "clients but no
    //    sessions delivered in 30 days", which is the true and useful sentence.
    const like = {
        id: '', name: v.name ?? '',
        clients: v.clients,
        sessions30: v.delivered ?? 0,
        delivered30: v.delivered ?? 0,
        unmarked30: v.unmarked ?? 0,
    };
    const h = (0, ownerAnalytics_1.trainerHealth)(like);
    const status = (0, status_1.statusFromRisk)(h.risk);
    // trainerHealth's own idle branch (no clients, no delivered sessions) is an
    // absence of evidence too, and must not be allowed to read as a grade.
    return { status, unknown: status === 'idle', reason: h.reason };
}
function hoursNote(x) {
    if (x.rosteredHours == null) {
        if (x.rec.shifts.state === 'failed')
            return 'The rota could not be read, so there is nothing to measure delivery against.';
        if (x.rec.shifts.state === 'loading')
            return null;
        return 'No live shift on the rota in this window, so there are no rostered hours to measure against — which is not the same as a trainer who worked none.';
    }
    if (x.deliveredHours == null) {
        return 'No outcome is recorded against any of their one-to-ones, so no hours can be counted as delivered.';
    }
    const missing = [];
    if (x.classHours != null && x.classHours > 0) {
        missing.push(`${x.classHours} class hour${s(x.classHours)} they are down to teach`);
    }
    if (x.classHours == null && x.rec.classes.state === 'failed') {
        missing.push('class hours, which could not be read at all');
    }
    if (x.unmarkedHours != null && x.unmarkedHours > 0) {
        missing.push(`${x.unmarkedHours} hour${s(x.unmarkedHours)} of one-to-ones nobody has marked`);
    }
    if (!missing.length)
        return null;
    return `Confirmed one-to-ones only — ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in that figure.`;
}
/* ── the gym-wide picture ──────────────────────────────────────────────────── */
function rollupOf(members, clientRows, sessionRows, classRows) {
    if (!members) {
        return {
            trainers: null, atRisk: null, watch: null, onTrack: null, unknown: null,
            flagged: null, flaggedClients: null,
            clients: clientRows ? clientRows.length : null,
            unassignedClients: clientRows ? clientRows.filter((c) => !c.trainerId).length : null,
            delivered: null, noShows: null, unmarked: null,
            owedCents: null, outstandingCents: null,
            rosteredHours: null, deliveredHours: null, classHours: null,
        };
    }
    let atRisk = 0, watch = 0, onTrack = 0, unknown = 0, flaggedClients = 0;
    for (const m of members) {
        if (m.status === 'at_risk')
            atRisk++;
        else if (m.status === 'watch')
            watch++;
        else if (m.status === 'idle')
            unknown++;
        else
            onTrack++;
        if (m.status !== 'on_track')
            flaggedClients += m.clients ?? 0;
    }
    // Sums only where the underlying read succeeded. `sum` returns null the moment
    // any contributing figure is unknown, because a partial total on a payroll
    // page is worse than no total.
    const sum = (pick) => {
        let total = null;
        for (const m of members) {
            const v = pick(m);
            if (v == null)
                continue;
            total = (total ?? 0) + v;
        }
        return total;
    };
    const deliveredHours = sum((m) => m.deliveredHours);
    const rosteredHours = sum((m) => m.rosteredHours);
    const classHours = sum((m) => m.classHours);
    return {
        trainers: members.length,
        atRisk, watch, onTrack, unknown,
        flagged: atRisk + watch + unknown,
        flaggedClients,
        clients: clientRows ? clientRows.length : null,
        unassignedClients: clientRows ? clientRows.filter((c) => !c.trainerId).length : null,
        delivered: sessionRows ? sum((m) => m.delivered) : null,
        noShows: sessionRows ? sum((m) => m.noShows) : null,
        unmarked: sessionRows ? sum((m) => m.unmarked) : null,
        owedCents: sum((m) => m.owedCents),
        // Summed over the ROSTER, so the headline equals the rows underneath it.
        // Sessions run by somebody who is no longer on the roster are money too,
        // and they get their own section rather than swelling a total nothing on
        // screen adds up to.
        outstandingCents: sum((m) => m.outstandingCents),
        rosteredHours: rosteredHours == null ? null : round1(rosteredHours),
        deliveredHours: deliveredHours == null ? null : round1(deliveredHours),
        classHours: classRows == null || classHours == null ? null : round1(classHours),
    };
}
/**
 * The one line under the headline that says how much of the roster this page is
 * actually able to judge, or null when it can judge all of it.
 *
 * Deliberately separate from `staffWarning`, which names failed reads. This one
 * fires even when every read succeeded: a gym where nobody marks outcomes has a
 * complete, working staff page that cannot assess a single person, and that is
 * the finding rather than a footnote.
 */
function caveatOf(members) {
    if (!members || !members.length)
        return null;
    const unknown = members.filter((m) => m.unknown);
    if (!unknown.length)
        return null;
    if (unknown.length === members.length) {
        return `Not one of the ${members.length} people on this roster can be assessed from the record as it stands. Every row below says which kind of nothing it is looking at; none of them is a clean bill of health.`;
    }
    const names = unknown.map((m) => m.name ?? 'an unnamed account');
    const list = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${unknown.length} of ${members.length} cannot be assessed: ${list}. They are shown as Unknown, which is not a grade and is not the same as fine.`;
}
