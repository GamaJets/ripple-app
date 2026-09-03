"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Closing a month, and keeping it closed. Compile with tsc, run with node.
//
// The assertions that matter here are about the SNAPSHOT. A close stores four
// figures and a count, and each of them has to be the figure the screen was
// showing when somebody pressed the button — a snapshot that read
// `owed.settledCents` where the tile renders `arrears.outstandingCents` would
// store a plausible number against the wrong label, permanently, and the screen
// it came from would still look right.
const gymClose_1 = require("./gymClose");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── a close, as it would arrive from buildClose ───────────────────────────── */
const closeOf = (o = {}) => ({
    window: {
        key: '2026-08', label: 'August 2026',
        firstDay: '2026-08-01', lastDay: '2026-08-31',
        fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-09-01T00:00:00.000Z',
    },
    ended: true,
    income: {
        takenCents: 420000, count: 14, byMethod: [], currencies: ['GBP'],
        unattributed: 1, unattributedCents: 2500, unattributedCurrency: 'GBP',
    },
    purpose: [],
    owed: {
        issued: 6, settledCents: 300000, settled: 4,
        outstandingCents: 90000, outstanding: 2,
        overdueCents: 45000, overdue: 1,
        droppedCents: null, dropped: 0, currencies: ['GBP'],
    },
    arrears: {
        issued: 9, settledCents: 300000, settled: 4,
        outstandingCents: 155000, outstanding: 5,
        overdueCents: 60000, overdue: 2,
        droppedCents: null, dropped: 0, currencies: ['GBP'],
    },
    check: null,
    payroll: {
        lines: [],
        total: { cents: 180000, delivered: 40, payable: 40, priced: 40, unmarked: 0, settleable: true },
        blocker: null,
    },
    passes: null,
    blockers: [],
    state: 'closeable',
    warning: null,
    ...o,
});
/* ── the snapshot is the tiles, and only the tiles ─────────────────────────── */
{
    const s = (0, gymClose_1.snapshotOf)(closeOf(), 'GBP');
    eq(s.takenCents, 420000, 'Taken is the income figure the first tile renders');
    // "Billed this month" is settled PLUS outstanding, which is what /close's own
    // sumOrNull produces. Storing `owed.outstandingCents` alone here would be a
    // smaller, entirely plausible number under the same label.
    eq(s.invoicedCents, 390000, 'Billed is settled plus outstanding, exactly as the tile computes it');
    // "Still owed" is ARREARS, not this month's invoices: everything unpaid at
    // the month end, whatever month it was raised in. The two differ by every
    // invoice from an earlier month that is still open, and confusing them is the
    // difference between a gym owed 90,000 and one owed 155,000.
    eq(s.outstandingCents, 155000, 'Still owed is the arrears figure, not the month’s own invoices');
    eq(s.payrollCents, 180000, 'Payroll is the total, in minor units');
    eq(s.unmarkedSessions, 0, 'and the unmarked count travels with it');
    eq(s.currency, 'GBP', 'the currency is stored so the figures can be read back');
    eq(s.blockersAtClose, null, 'a clean month records nothing in the way');
}
{
    // Every one of these is nullable ON SCREEN, so every one is nullable here. A
    // close that turned an unread month into zeros would store the exact lie the
    // whole screen is built to refuse.
    const s = (0, gymClose_1.snapshotOf)(closeOf({ income: null, owed: null, arrears: null, payroll: null }), null);
    eq(s.takenCents, null, 'an unread payments month stores no figure, not a zero');
    eq(s.invoicedCents, null, 'nor an unread invoice register');
    eq(s.outstandingCents, null, 'nor the arrears');
    eq(s.payrollCents, null, 'nor the payroll');
    eq(s.unmarkedSessions, null, 'nor the unmarked count');
    eq(s.currency, null, 'and a gym with no currency stores none rather than a guess');
}
{
    // A mixed-currency month has no total ON SCREEN, and acquires none by being
    // closed.
    const c = closeOf();
    const mixed = closeOf({ income: { ...c.income, takenCents: null, currencies: ['GBP', 'AED'] } });
    eq((0, gymClose_1.snapshotOf)(mixed, 'GBP').takenCents, null, 'a month whose payments are in two currencies is closed with no takings figure, not with one of them');
}
{
    // Closing over a stated blocker is allowed, and the reasons are stored word
    // for word — "closed over 3 blockers" is nothing anybody can act on in March.
    const blocked = closeOf({
        state: 'blocked',
        blockers: [
            { kind: 'unmarked_sessions', text: '12 sessions still need an outcome.' },
            { kind: 'money_gap', text: 'Two invoices marked paid have no payment behind them.' },
        ],
        payroll: { lines: [], total: { cents: 180000, delivered: 40, payable: 52, priced: 40, unmarked: 12, settleable: false }, blocker: 'unmarked' },
    });
    const s = (0, gymClose_1.snapshotOf)(blocked, 'GBP');
    ok((s.blockersAtClose ?? '').includes('12 sessions'), 'the blockers are stored verbatim, so a month signed off over a known problem reads as a decision');
    ok((s.blockersAtClose ?? '').includes('no payment behind them'), 'and all of them, not the first');
    eq(s.unmarkedSessions, 12, 'the unmarked count is what says the payroll figure is a floor rather than a total');
}
/* ── when a month may be closed ────────────────────────────────────────────── */
const row = (o = {}) => ({
    id: 'c1', monthKey: '2026-08', closedAt: '2026-09-01T09:00:00Z',
    closedBy: 'o1', closedByName: 'Owner', note: null,
    takenCents: 420000, invoicedCents: 390000, outstandingCents: 155000,
    payrollCents: 180000, currency: 'GBP', unmarkedSessions: 0, blockersAtClose: null,
    reopenedAt: null, reopenedBy: null, reopenedByName: null, reopenReason: null, ...o,
});
eq((0, gymClose_1.closeBlocker)('2026-08', true, null), null, 'a finished month that is not closed may be closed');
ok((0, gymClose_1.closeBlocker)('2026-08', true, row()) != null, 'a month already closed is refused rather than closed twice');
eq((0, gymClose_1.closeBlocker)('2026-08', true, row({ reopenedAt: '2026-09-05T00:00:00Z', reopenReason: 'late cash' })), null, 'a REOPENED month may be closed again — the reopen is what put it back on the table');
// Not advisory. Closing a month that is still running locks the desk out of
// recording payments for the rest of it, through the trigger in
// supabase/parts/182, and the error would name a month that has not ended.
ok((0, gymClose_1.closeBlocker)('2026-09', false, null) != null, 'a month still running cannot be closed');
ok((0, gymClose_1.reopenBlocker)('') != null, 'a reopen with no reason is refused');
ok((0, gymClose_1.reopenBlocker)('   ') != null, 'and whitespace is not a reason');
eq((0, gymClose_1.reopenBlocker)('Late cash from the 31st'), null, 'a reason is a reason');
{
    const rows = [
        row({ id: 'a', monthKey: '2026-08', reopenedAt: '2026-09-05T00:00:00Z', reopenReason: 'late cash' }),
        row({ id: 'b', monthKey: '2026-08' }),
        row({ id: 'c', monthKey: '2026-07' }),
    ];
    eq((0, gymClose_1.liveCloseFor)('2026-08', rows)?.id, 'b', 'the live close is the one that has not been reopened');
    eq((0, gymClose_1.liveCloseFor)('2026-06', rows), null, 'a month with no close row is open');
    eq((0, gymClose_1.liveCloseFor)('2026-08', null), null, 'and an unread history offers no close at all');
}
/* ── the record moving after a close ───────────────────────────────────────── */
{
    const fmt = (c) => (c == null ? '—' : `GBP ${(c / 100).toFixed(2)}`);
    const stored = row();
    const same = {
        takenCents: 420000, invoicedCents: 390000, outstandingCents: 155000,
        payrollCents: 180000, currency: 'GBP', unmarkedSessions: 0, blockersAtClose: null,
    };
    eq((0, gymClose_1.driftSince)(stored, same, fmt).length, 0, 'a month that has not moved reports nothing');
    const moved = { ...same, takenCents: 415000 };
    const d = (0, gymClose_1.driftSince)(stored, moved, fmt);
    eq(d.length, 1, 'one figure moved, one line');
    ok(d[0].includes('4,200.00') || d[0].includes('4200.00'), 'the line names what it was');
    ok(d[0].includes('4,150.00') || d[0].includes('4150.00'), 'and what it is now');
    // One side unknown is still a difference worth naming, and naming it needs
    // words: "was 4,200.00, is now not known" is a sentence and "4,200.00 → —"
    // is a puzzle.
    const unread = { ...same, payrollCents: null };
    ok((0, gymClose_1.driftSince)(stored, unread, fmt)[0].includes('not known'), 'a figure that has become unreadable is reported in words, not as a dash');
    const unmarkedNow = { ...same, unmarkedSessions: 3 };
    eq((0, gymClose_1.driftSince)(stored, unmarkedNow, fmt).length, 1, 'the unmarked count is watched too');
}
/* ── a closed month refuses money dated into it ───────────────────────────
 *
 * Part 182 locked payments and invoices and nothing else, and /payroll never
 * read this table at all — so a settlement could land in a month that had been
 * signed off, and /accounting's "Money out" for a filed month moved underneath
 * the accountant. Part 481 makes the database refuse it; this is the rule that
 * refuses it with the run still on screen.
 */
{
    const closed = (monthKey, reopenedAt = null) => ({
        id: 'c-' + monthKey, monthKey, closedAt: '2026-09-02T09:00:00.000Z',
        closedBy: null, closedByName: null, note: null,
        takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null,
        currency: null, unmarkedSessions: null, blockersAtClose: null,
        reopenedAt, reopenedBy: null, reopenedByName: null,
        reopenReason: reopenedAt ? 'a late payment' : null,
    });
    ok((0, gymClose_1.closedMonthBlocker)('2026-08-01', [closed('2026-08')]) != null, 'a payroll run dated into a closed August is refused');
    ok(((0, gymClose_1.closedMonthBlocker)('2026-08-01', [closed('2026-08')]) ?? '').includes('2026-08'), 'and the refusal names the month, because the way out is reopening that one');
    eq((0, gymClose_1.closedMonthBlocker)('2026-09-01', [closed('2026-08')]), null, 'a run for an open month is not refused by a neighbouring close');
    eq((0, gymClose_1.closedMonthBlocker)('2026-08-01', [closed('2026-08', '2026-09-03T10:00:00.000Z')]), null, 'a month that was reopened is open again — the row stays as history, not as a lock');
    eq((0, gymClose_1.closedMonthBlocker)('2026-08-01', []), null, 'a gym that has closed nothing blocks nothing');
    eq((0, gymClose_1.closedMonthBlocker)('2026-08-01', null), null, 'and a close record that could not be READ does not block: part 481 makes the database the backstop');
    eq((0, gymClose_1.closedMonthBlocker)('', [closed('2026-08')]), null, 'a date nobody stated cannot be placed in a month');
}
if (errors.length) {
    console.error(`gymClose: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
}
console.log('gymClose ok');
