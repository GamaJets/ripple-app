"use strict";
// Closing a month.
//
// Not a dashboard. A dashboard answers "how are we doing"; a close answers a
// narrower and much harder question — "is this month finished, and may I act on
// these numbers?" — and its most valuable output is the word *no*.
//
// Framework-free on purpose, and further than the reading modules go: there is
// not a Supabase client anywhere in here. Every function takes rows already
// fetched and returns a conclusion, so the same reasoning runs in the console,
// in the phone app, and in a test under plain node. The reads stay in the
// screen, because the reads are where the failure modes live and only the
// screen can render its own failures.
//
// ── The four rules this module exists to keep ──────────────────────────────
//
// 1. A month is not closed while sessions are unmarked. Payroll is computed
//    from delivered sessions, so a month with 12 unmarked sessions has a
//    payroll figure that is wrong by exactly those 12 — and wrong in the
//    direction that underpays a trainer, which is the direction that produces
//    a dispute. `closeBlockers` refuses the claim and says how many. It is not
//    a footnote under a green tick.
//
// 2. Money taken is reconciled against money the register says arrived, and a
//    gap is NAMED. `reconcile()` in finReconcile.ts already does this with a 2%
//    tolerance and is used here rather than reimplemented — one rule, one
//    tolerance, one place to change it.
//
// 3. Anything that could not be read does not become zero. Every part of the
//    close is a `Slice`, so "not read yet", "read and empty" and "the read
//    failed" stay three different answers all the way to the screen. A month
//    whose payments query failed is not a month with no income, and this module
//    will not let a caller present it as one.
//
// 4. Nothing is estimated, annualised or pro-rated. Note in particular what is
//    NOT here: there is no monthly-equivalent of an annual plan. `summarise` in
//    gymRecord.ts divides a yearly price by 12 to produce an MRR, which is the
//    right thing for a trend line and the wrong thing for a close — it invents
//    a figure for a month in which no such money moved. What the gym expected
//    to be paid comes from invoices it actually issued, or it comes from
//    nowhere and the answer is a dash.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_COST = exports.CLOSE_LABEL = exports.CLOSE_PARTS = exports.PURPOSE_LABEL = void 0;
exports.monthWindow = monthWindow;
exports.monthKeyOf = monthKeyOf;
exports.recentMonths = recentMonths;
exports.monthEnded = monthEnded;
exports.inMonth = inMonth;
exports.dayInMonth = dayInMonth;
exports.sliceMonth = sliceMonth;
exports.isOverdue = isOverdue;
exports.incomeOf = incomeOf;
exports.purposeOf = purposeOf;
exports.owedOf = owedOf;
exports.moneyCheck = moneyCheck;
exports.payrollOf = payrollOf;
exports.brokenCloseParts = brokenCloseParts;
exports.loadingCloseParts = loadingCloseParts;
exports.truncatedCloseParts = truncatedCloseParts;
exports.closeWarning = closeWarning;
exports.closeBlockers = closeBlockers;
exports.buildClose = buildClose;
exports.closeHeadline = closeHeadline;
const weekStart_1 = require("./weekStart");
const format_1 = require("./format");
// The one rule about what a set of rows is denominated in, and the one
// normalisation behind it. Imported rather than restated: this module used to
// group money by method alone and had no opinion about currency at all.
const gymRecord_1 = require("./gymRecord");
const gymSessions_1 = require("./gymSessions");
const gymPasses_1 = require("./gymPasses");
const memberView_1 = require("./memberView");
const finReconcile_1 = require("./finReconcile");
/**
 * The twelve months, written out, in the language of whoever is closing.
 *
 * Asked per call rather than held in a module constant: `monthNames()` reads
 * `appLocale()`, which is latched lazily — a constant built at import time
 * would pin every month label in the console to whatever the locale was before
 * the app had resolved one.
 */
const monthWords = () => (0, format_1.monthNames)();
/**
 * The window for a month key, or null when the key is not one.
 *
 * Built in local time deliberately, exactly as `gymVisits.visitsPerDay` counts
 * days: a gym's August is its own August. A gym in Dubai closing August must
 * not have the evening of the 31st fall into September because UTC says so.
 */
function monthWindow(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m)
        return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12)
        return null;
    const from = new Date(y, mo - 1, 1, 0, 0, 0, 0);
    const to = new Date(y, mo, 1, 0, 0, 0, 0);
    // Day 0 of the following month is the last day of this one, leap years
    // included, without a table of month lengths to get wrong.
    const last = new Date(y, mo, 0).getDate();
    return {
        key,
        label: `${monthWords()[mo - 1]} ${y}`,
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
        firstDay: `${key}-01`,
        lastDay: `${key}-${String(last).padStart(2, '0')}`,
    };
}
/** The month a moment falls in, in local time. */
function monthKeyOf(at = Date.now()) {
    const d = at instanceof Date ? at : new Date(at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** The last `count` months, newest first, including the one running now. */
function recentMonths(count, now = Date.now()) {
    const d = new Date(now);
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1)));
    }
    return out;
}
/** Whether the month is over. A month still running cannot be closed. */
function monthEnded(w, now = Date.now()) {
    return now >= Date.parse(w.toIso);
}
/** Whether a timestamp falls inside the window. */
function inMonth(iso, w) {
    if (!iso)
        return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t))
        return false;
    return t >= Date.parse(w.fromIso) && t < Date.parse(w.toIso);
}
/** Whether a plain 'YYYY-MM-DD' date falls inside the window. */
function dayInMonth(day, w) {
    return !!day && day.slice(0, 7) === w.key;
}
/**
 * Narrow a slice to one month while keeping all three states.
 *
 * The reason this is a function rather than a `.filter()` at each call site:
 * `rows.filter(...)` on a failed read is a type error the first time and a
 * silently empty month the second, once somebody reaches for `?? []`.
 */
function sliceMonth(s, w, at) {
    if (s.state !== 'ready')
        return s;
    return { state: 'ready', rows: s.rows.filter((r) => inMonth(at(r), w)) };
}
/**
 * Whether an invoice is past its due date on `today`.
 *
 * An invoice due today is not late today. A missing due date is never overdue:
 * the gym did not say when it wanted the money, so it cannot claim lateness.
 */
function isOverdue(inv, today) {
    if (inv.status === 'overdue')
        return true;
    if (inv.status !== 'open')
        return false;
    return !!inv.dueOn && inv.dueOn < today;
}
const METHOD_LABEL = {
    card: 'Card',
    cash: 'Cash',
    transfer: 'Bank transfer',
    direct_debit: 'Direct debit',
    other: 'Other',
};
/**
 * What the gym took, and how. Rows must already be narrowed to the month.
 *
 * Grouped by method AND currency. See the note on `Line`: grouping by method
 * alone put dirhams and pounds in one figure, and both this screen and the
 * month-end CSV then printed a single currency over it.
 */
function incomeOf(payments) {
    const byMethod = new Map();
    const currencies = new Set();
    const unattributedRows = [];
    let cents = 0;
    let unattributedCents = 0;
    for (const p of payments) {
        currencies.add(p.currency);
        cents += p.amountCents;
        if (!p.memberId) {
            unattributedRows.push(p);
            unattributedCents += p.amountCents;
        }
        const id = p.method ?? 'other';
        const currency = (0, gymRecord_1.normaliseCurrency)(p.currency);
        const key = `${id}|${currency ?? ''}`;
        const l = byMethod.get(key)
            ?? { key, id, label: METHOD_LABEL[id] ?? id, currency, cents: 0, count: 0 };
        l.cents += p.amountCents;
        l.count += 1;
        byMethod.set(key, l);
    }
    const unattributed = unattributedRows.length;
    const mixed = currencies.size > 1;
    return {
        unattributedCurrency: (0, gymRecord_1.sharedCurrency)(unattributedRows),
        // No payments is not zero income — nobody recorded anything, which is a
        // different claim and renders as a dash.
        takenCents: payments.length === 0 || mixed ? null : cents,
        count: payments.length,
        byMethod: [...byMethod.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key)),
        currencies: [...currencies].sort(),
        unattributed,
        unattributedCents,
    };
}
exports.PURPOSE_LABEL = {
    membership: 'Against a membership',
    no_membership: 'From a member holding no membership',
    unattributed: 'Not attributed to anybody',
};
/**
 * What the money was for, as far as the record can actually say.
 *
 * Attribution, not categories — the payments table has no category column, so
 * inventing one would be exactly the fabrication this module exists to avoid.
 * What it can say is whether the payer held a membership covering the month.
 *
 * Returns null when the membership list was not read: with no roster, every
 * payment would fall into "holding no membership" and the screen would report a
 * gym whose members all pay for nothing.
 */
function purposeOf(payments, memberships, w) {
    if (memberships == null)
        return null;
    const held = new Set();
    for (const m of memberships) {
        // Overlapping the month, not merely current today: a membership that
        // cancelled on the 20th was still a membership for the month being closed.
        if (m.startedOn > w.lastDay)
            continue;
        if (m.endsOn && m.endsOn < w.firstDay)
            continue;
        held.add(m.memberId);
    }
    // By attribution AND currency, for the same reason `incomeOf` is. This table
    // sits directly under that one on /close and was rendered with the same
    // single `currency` prop over it, so a gym holding two currencies read one
    // "Against a membership" figure that was two sums added together.
    const lines = new Map();
    const ORDER = ['membership', 'no_membership', 'unattributed'];
    for (const p of payments) {
        const id = !p.memberId ? 'unattributed' : held.has(p.memberId) ? 'membership' : 'no_membership';
        const currency = (0, gymRecord_1.normaliseCurrency)(p.currency);
        const key = `${id}|${currency ?? ''}`;
        const l = lines.get(key)
            ?? { key, id, label: exports.PURPOSE_LABEL[id], currency, cents: 0, count: 0 };
        l.cents += p.amountCents;
        l.count += 1;
        lines.set(key, l);
    }
    // The three attributions keep their fixed order — it is an argument, read top
    // to bottom — and the currencies within one of them sort by size.
    return [...lines.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)
        || b.cents - a.cents
        || a.key.localeCompare(b.key));
}
/** The receivables picture for a month. Rows must already be narrowed to it. */
function owedOf(invoices, today) {
    const currencies = new Set();
    let settled = 0, settledCents = 0;
    let outstanding = 0, outstandingCents = 0;
    let overdue = 0, overdueCents = 0;
    let dropped = 0, droppedCents = 0;
    for (const inv of invoices) {
        currencies.add(inv.currency);
        if (inv.status === 'paid') {
            settled += 1;
            settledCents += inv.amountCents;
        }
        else if (inv.status === 'void' || inv.status === 'written_off') {
            dropped += 1;
            droppedCents += inv.amountCents;
        }
        else if (inv.status === 'open' || inv.status === 'overdue') {
            outstanding += 1;
            outstandingCents += inv.amountCents;
            if (isOverdue(inv, today)) {
                overdue += 1;
                overdueCents += inv.amountCents;
            }
        }
        // 'draft' is deliberately in none of them: an invoice nobody sent is not
        // owed by anybody.
    }
    const mixed = currencies.size > 1;
    const total = (n, c) => (n === 0 || mixed ? null : c);
    return {
        issued: invoices.length,
        settledCents: total(settled, settledCents), settled,
        outstandingCents: total(outstanding, outstandingCents), outstanding,
        overdueCents: total(overdue, overdueCents), overdue,
        droppedCents: total(dropped, droppedCents), dropped,
        currencies: [...currencies].sort(),
    };
}
/**
 * Money taken against money the invoice register says arrived.
 *
 * Returns null when either side could not be read. That is not a hedge — a
 * reconciliation computed against a failed read is worse than no
 * reconciliation, because it looks like a finding.
 *
 * `reconcile()` is called, not reimplemented. Its 2% tolerance is the gym's one
 * tolerance and this screen has no business holding a second one.
 */
function moneyCheck(income, owed, fmt = String) {
    if (!income || !owed)
        return null;
    const derived = owed.settledCents;
    const taken = income.takenCents;
    // Both sides silent: no invoices marked paid and no payments recorded. There
    // is nothing to reconcile and nothing wrong; say so rather than manufacturing
    // a zero-against-zero agreement.
    if (derived == null && taken == null)
        return null;
    const r = (0, finReconcile_1.reconcile)(taken ?? 0, derived);
    const gapCents = r.delta;
    return { r, gapCents, note: gapNote(r, taken, fmt) };
}
function gapNote(r, taken, fmt) {
    switch (r.state) {
        case 'no_record':
            return `${fmt(r.typed)} was taken, but no invoice in this month is marked paid, so there is nothing to check it against.`;
        case 'not_entered':
            // reconcile() reaches this when the taken side is zero or absent.
            return taken == null
                ? `Invoices mark ${fmt(r.derived)} as paid this month, and not one payment was recorded against them.`
                : `Invoices mark ${fmt(r.derived)} as paid this month, and the payments recorded come to nothing.`;
        case 'differs': {
            const d = r.delta;
            return `${fmt(r.typed)} was taken; invoices mark ${fmt(r.derived)} as paid. ${fmt(Math.abs(d))} ${d > 0 ? 'that the register expected has not arrived' : 'arrived that no invoice accounts for'}. Name it before the month closes.`;
        }
        case 'agrees':
        default:
            return null;
    }
}
/** Payroll for the month's sessions, and whether it may be acted on. */
function payrollOf(sessions, policy, fallbackRateCents, now = Date.now()) {
    const lines = (0, gymSessions_1.payrollByTrainer)(sessions, policy, fallbackRateCents, now);
    const total = (0, gymSessions_1.payrollTotal)(lines);
    return { lines, total, blocker: (0, gymSessions_1.settlementBlocker)(total) };
}
exports.CLOSE_PARTS = ['payments', 'invoices', 'sessions', 'memberships', 'passes'];
exports.CLOSE_LABEL = {
    payments: 'the payments taken',
    invoices: 'the invoice register',
    sessions: 'the one-to-ones',
    memberships: 'the membership roster',
    passes: 'passes sold',
};
/** What the close loses when a part cannot be read — named as the missing
 *  *answer*, not the missing table. "payments failed" tells an owner nothing;
 *  "this month's income is unknown, not zero" tells them everything. */
exports.CLOSE_COST = {
    payments: 'what came in is unknown, not zero',
    invoices: 'what was billed and what is still owed are unknown',
    sessions: 'payroll cannot be computed and no month can be closed over it',
    memberships: 'what the money was for cannot be attributed',
    passes: 'pass sales are missing from the picture',
};
function brokenCloseParts(rec) {
    return exports.CLOSE_PARTS
        .filter((p) => rec[p].state === 'failed')
        .map((p) => ({
        part: p,
        label: exports.CLOSE_LABEL[p],
        cost: exports.CLOSE_COST[p],
        reason: rec[p].reason,
    }));
}
function loadingCloseParts(rec) {
    return exports.CLOSE_PARTS.filter((p) => rec[p].state === 'loading');
}
/** The parts that came back, and came back short. */
function truncatedCloseParts(rec) {
    return exports.CLOSE_PARTS.filter((p) => rec[p].state === 'partial');
}
/**
 * The sentence above a half-loaded close, or null when every part is in.
 *
 * Same rule as `memberView.partialWarning`: name the half that failed AND what
 * the reader is therefore not seeing. A close is the one screen where a partial
 * picture presented as a whole one gets somebody paid the wrong amount.
 */
function closeWarning(rec) {
    const broken = brokenCloseParts(rec);
    if (!broken.length)
        return null;
    const names = broken.map((b) => b.label);
    const list = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Could not read ${list}. This is a partial close, not a quiet one — ${broken.map((b) => b.cost).join('; ')}.`;
}
const s = (n) => (n === 1 ? '' : 's');
/**
 * Why this month may not be presented as closed. Empty means it may.
 *
 * Order is deliberate — a reader acts on the first line, so the first line is
 * the one that most invalidates the rest. A failed read outranks everything
 * because a figure computed over it is not a figure at all.
 */
function closeBlockers(rec, w, payroll, check, income, owed, now = Date.now()) {
    const out = [];
    for (const b of brokenCloseParts(rec)) {
        out.push({
            kind: 'read_failed',
            text: `Could not read ${b.label} — ${b.cost}. Nothing can be closed over a read that failed.`,
        });
    }
    // A read that SUCCEEDED and came back short. Its own blocker, and not folded
    // into `read_failed`, because it is the one that would otherwise get through:
    // every gate on this screen is written `state === 'ready'`, which withholds
    // the FIGURES, and none of them stops the month being signed off. A month
    // closed over a prefix of its payments is a smaller month, signed, with
    // nothing on the document saying so.
    const cut = truncatedCloseParts(rec);
    for (const p of cut) {
        out.push({
            kind: 'read_truncated',
            text: `Only the first rows of ${exports.CLOSE_LABEL[p]} were read, and there are more — ${exports.CLOSE_COST[p]}. ` +
                `A month cannot be closed over part of a set: the figure would be a subtotal with a ` +
                `signature under it.`,
        });
    }
    const loading = loadingCloseParts(rec);
    if (loading.length) {
        out.push({
            kind: 'still_loading',
            text: `Still reading ${loading.map((p) => exports.CLOSE_LABEL[p]).join(', ')}.`,
        });
    }
    if (!monthEnded(w, now)) {
        out.push({
            kind: 'month_running',
            text: `${w.label} is still running. A month in progress has takings and sessions still to come.`,
        });
    }
    // THE rule. Payroll is computed from delivered sessions, so an unmarked
    // session is not a rounding difference — it is a session somebody worked that
    // this figure does not pay for. Note that `payrollTotal.settleable` is NOT
    // used as the test: it is also false when a gym simply has no PT sessions at
    // all, and a gym that does no personal training has nothing blocking its
    // month. The two conditions below are the ones that mean the number is wrong.
    if (payroll) {
        const t = payroll.total;
        if (t.unmarked > 0) {
            out.push({
                kind: 'unmarked_sessions',
                text: `${t.unmarked} session${s(t.unmarked)} finished in ${w.label} with no outcome recorded. Payroll counts delivered sessions, so this month's figure is wrong by exactly ${t.unmarked === 1 ? 'that one' : `those ${t.unmarked}`} until somebody marks ${t.unmarked === 1 ? 'it' : 'them'}.`,
            });
        }
        if (t.payable > t.priced) {
            const missing = t.payable - t.priced;
            out.push({
                kind: 'unpriced_sessions',
                text: `${missing} payable session${s(missing)} carr${missing === 1 ? 'ies' : 'y'} no rate, so ${missing === 1 ? 'it is' : 'they are'} missing from the payroll total rather than costing nothing. Set a session fee.`,
            });
        }
    }
    // A named gap blocks; the absence of a second source does not.
    //
    // 'differs' is a real contradiction between two records and 'not_entered' is
    // the register claiming money arrived that no payment row shows — both are
    // gaps and both stop the month. 'no_record' is a gym that does not invoice
    // through Repple at all: there is nothing contradicting anything, so it is
    // said out loud in the panel and in the headline, and it does not pretend to
    // be an error. A cash-only gym must still be able to close its month.
    if (check?.note && (check.r.state === 'differs' || check.r.state === 'not_entered')) {
        out.push({ kind: 'money_gap', text: check.note });
    }
    if (income && income.currencies.length > 1) {
        out.push({
            kind: 'mixed_currency',
            text: `Payments in ${w.label} are recorded in ${income.currencies.join(' and ')}. They are not added together here, because that would not be a total.`,
        });
    }
    if (owed && owed.currencies.length > 1) {
        out.push({
            kind: 'mixed_currency',
            text: `Invoices in ${w.label} are issued in ${owed.currencies.join(' and ')}, so no single figure is offered for what is owed.`,
        });
    }
    return out;
}
/**
 * The whole close for one month.
 *
 * Every input arrives as a slice and every output that depends on a slice that
 * is not ready is null. There is no branch anywhere in here that substitutes an
 * empty array for a failed read.
 *
 * Pass sales sit in their own field and are never added into `income`. The
 * payments table and the passes table are two independent records with no link
 * column between them: a desk that sold a pass for cash may or may not also
 * have recorded a payment for it, and neither adding them (double counting) nor
 * ignoring one (silently dropping income) can be justified from the rows. So
 * both are shown, and the screen says they are two records rather than one sum.
 */
function buildClose(rec, w, opts) {
    const now = opts.now ?? Date.now();
    // The reader's own day where the caller has not said which day it is. Not
    // UTC's, which is what this was and which belongs to nobody in the building;
    // see `today` on CloseOptions for what it cost. The gym's day is the true
    // answer and it is one argument away.
    const today = opts.today ?? (0, weekStart_1.isoDay)(new Date(now));
    const paidRows = (0, memberView_1.rowsOf)(sliceMonth(rec.payments, w, (p) => p.takenAt));
    const invRows = (0, memberView_1.rowsOf)(rec.invoices);
    const sessRows = (0, memberView_1.rowsOf)(sliceMonth(rec.sessions, w, (x) => x.startsAt));
    const passRows = (0, memberView_1.rowsOf)(rec.passes);
    const income = paidRows ? incomeOf(paidRows) : null;
    const purpose = paidRows ? purposeOf(paidRows, (0, memberView_1.rowsOf)(rec.memberships), w) : null;
    // Invoices carry dates, not timestamps, so they are filtered on the day
    // rather than the instant.
    const owed = invRows ? owedOf(invRows.filter((i) => dayInMonth(i.issuedOn, w)), today) : null;
    // Arrears reach back: an invoice issued in June and still unpaid in August is
    // money the gym is owed at the August close. Scoped to invoices issued on or
    // before the month end so that closing an old month is not polluted by
    // billing that happened after it.
    const arrears = invRows ? owedOf(invRows.filter((i) => i.issuedOn <= w.lastDay), today) : null;
    const check = moneyCheck(income, owed, opts.fmt);
    const payroll = sessRows
        ? payrollOf(sessRows, opts.policy, opts.fallbackRateCents ?? null, now)
        : null;
    const passesInMonth = passRows ? passRows.filter((p) => dayInMonth(p.issuedOn, w)) : null;
    const passes = passesInMonth
        ? (() => {
            const r = (0, gymPasses_1.passRevenueCents)(passesInMonth);
            return { cents: r.cents, priced: r.priced, sold: r.total };
        })()
        : null;
    const blockers = closeBlockers(rec, w, payroll, check, income, owed, now);
    return {
        window: w,
        ended: monthEnded(w, now),
        income,
        purpose,
        owed,
        arrears,
        check,
        payroll,
        passes,
        blockers,
        state: blockers.length ? 'blocked' : 'closeable',
        warning: closeWarning(rec),
    };
}
/**
 * The headline sentence for the close, in the gym's own words.
 *
 * Never "closed ✓" when anything is blocking, and never a figure in the same
 * breath as a refusal — a payroll total printed beside "12 unmarked" is read as
 * the payroll total.
 */
function closeHeadline(c) {
    if (c.state === 'blocked') {
        const n = c.blockers.length;
        return `${c.window.label} is not closed. ${n} thing${s(n)} ${n === 1 ? 'is' : 'are'} in the way.`;
    }
    // Closeable, but the headline must not claim a check that never ran. A gym
    // that issues no invoices has nothing for its takings to be reconciled
    // against, and saying "reconciles" there would be the screen inventing
    // assurance it does not have.
    return c.check?.r.state === 'agrees'
        ? `${c.window.label} reconciles against the invoice register and nothing is unmarked. This month can be closed.`
        : `${c.window.label} has nothing unmarked and nothing unexplained. No invoice in the month was marked paid, so what came in stands on the payment record alone — it was not checked against a second source.`;
}
