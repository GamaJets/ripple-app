"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The fourth state of a console read: it came back, and it came back short.
// Compile with tsc, run with node.
//
// ── What is actually being pinned ─────────────────────────────────────────
//
// `Slice<T>` had three states, and the missing one was not a gap in the type so
// much as a decision the type was HOLDING rather than stating: the console's
// answer to a capped read was `assertWhole`, which throws, so a truncated read
// arrived dressed as a failure and the fourth state was never needed. That is
// fine for a figure and wrong for a list, and it left nowhere for the prefix
// flag to live the moment any of the six screens built on `Slice` bounded a
// read — which /coach/earnings has done all along, with the fact surviving only
// in a comment.
//
// So the assertions below are mostly about what 'partial' must NOT do:
//
//   1. it must not be `rowsOf`. Every derived figure in `buildDossier` reads
//      its rows through that function, and a sum over a prefix is not a smaller
//      number, it is a wrong one. `paidCents` over a truncated payments read is
//      null — a dash the screen explains — and never a subtotal;
//   2. it must not be 'ready'. Every gate in the console and its screens is
//      written `state === 'ready'`, and that is what makes the fourth state
//      safe to add to a 37,000-line console at all: a truncated read fails all
//      of them by itself;
//   3. it must not be invisible. `sliceNote` and `sliceDash` have four arms
//      each, because the two-armed versions every screen had written by hand
//      dropped a truncated read into the "reading…" arm — a finished read
//      claiming to still be in flight, for ever;
//   4. the probe row must not survive. `capLimit()` asks for one row past the
//      cap in order to COUNT it, not to show it, and rendering it as data is
//      the mistake src/lib/rowCap.ts names outright.
const memberView_1 = require("./memberView");
const rowCap_1 = require("./rowCap");
const monthEnd_1 = require("./monthEnd");
const staffView_1 = require("./staffView");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the constructors ──────────────────────────────────────────────────── */
const nums = (n) => Array.from({ length: n }, (_, i) => i);
{
    const s = (0, memberView_1.slicePartial)(nums(5), 3);
    eq(s.state, 'partial', 'slicePartial makes a partial slice');
    eq(s.state === 'partial' ? s.rows.length : -1, 3, 'and trims to the cap it was given');
    eq(s.state === 'partial' ? s.cap : -1, 3, 'and keeps the cap, so the screen can say how many');
}
{
    // The read that fits. `capLimit(3)` asks for four; three came back, so the
    // set ended before the ceiling and this is genuinely all of it.
    const whole = (0, memberView_1.sliceCapped)(nums(3), 3);
    eq(whole.state, 'ready', 'a read that came back under its ceiling is ready');
    eq(whole.state === 'ready' ? whole.rows.length : -1, 3, 'with all of its rows');
    // The read that did not. Four rows for a cap of three is the probe row
    // arriving, which is the only signal there is.
    const cut = (0, memberView_1.sliceCapped)(nums((0, rowCap_1.capLimit)(3)), 3);
    eq(cut.state, 'partial', 'a read that came back at cap + 1 is partial');
    eq(cut.state === 'partial' ? cut.rows.length : -1, 3, 'and the probe row is trimmed off — it was asked for to be counted, not shown');
    eq(cut.state === 'partial' ? cut.rows[cut.rows.length - 1] : -1, 2, 'so the last row on the page is the last row of the cap, not the probe');
}
eq((0, memberView_1.sliceCapped)(null, 3).state, 'ready', 'a null read is an empty one, not a truncated one');
eq((0, memberView_1.sliceCapped)(undefined, 3).state, 'ready', 'and so is an absent one');
// Exactly at the cap is NOT truncated: the ceiling says how many rows may be
// accepted, and refusing a complete set for being exactly that size would be a
// false alarm the caller could not tell from a real one. Same rule as `capped`.
eq((0, memberView_1.sliceCapped)(nums(rowCap_1.ROW_CAP), rowCap_1.ROW_CAP).state, 'ready', 'a set exactly the size of the cap is whole');
eq((0, memberView_1.sliceCapped)(nums(rowCap_1.ROW_CAP + 1), rowCap_1.ROW_CAP).state, 'partial', 'one past it is not');
// And it agrees with rowCap's own splitter, which is the function the phone
// providers use. Two implementations of "was this cut off" is how one of them
// ends up off by one.
for (const n of [0, 1, 2, 3, 4, 10]) {
    const viaCapped = (0, rowCap_1.capped)(nums(n), 3);
    const viaSlice = (0, memberView_1.sliceCapped)(nums(n), 3);
    eq(viaSlice.state === 'partial', viaCapped.truncated, `${n} rows: sliceCapped agrees with capped()`);
    eq(JSON.stringify((0, memberView_1.rowsToShow)(viaSlice)), JSON.stringify(viaCapped.rows), `${n} rows: and hands back the same rows`);
}
/* ── the two accessors, and why there are two ──────────────────────────── */
const part = (0, memberView_1.slicePartial)(nums(5), 3);
eq((0, memberView_1.rowsOf)(part), null, 'rowsOf REFUSES a prefix — a figure over part of a set is a wrong figure');
eq((0, memberView_1.rowsOf)((0, memberView_1.sliceLoading)()), null, 'and refuses a read still in flight');
eq((0, memberView_1.rowsOf)((0, memberView_1.sliceFailed)('no')), null, 'and refuses a read that failed');
eq((0, memberView_1.rowsOf)((0, memberView_1.sliceReady)(nums(2)))?.length, 2, 'and hands over a whole read');
eq((0, memberView_1.rowsToShow)(part)?.length, 3, 'rowsToShow hands over the prefix, because a list of real rows is useful');
eq((0, memberView_1.rowsToShow)((0, memberView_1.sliceReady)(nums(2)))?.length, 2, 'and a whole read too');
eq((0, memberView_1.rowsToShow)((0, memberView_1.sliceLoading)()), null, 'but not a read still in flight');
eq((0, memberView_1.rowsToShow)((0, memberView_1.sliceFailed)('no')), null, 'and not a failure — an empty table under a failure is the lie');
ok((0, memberView_1.isWholeSlice)((0, memberView_1.sliceReady)([])), 'an empty read that succeeded is whole');
ok(!(0, memberView_1.isWholeSlice)(part), 'a prefix is not whole, which is what every `=== ready` gate already asks');
ok(!(0, memberView_1.isWholeSlice)((0, memberView_1.sliceLoading)()), 'nor is a read in flight');
ok(!(0, memberView_1.isWholeSlice)((0, memberView_1.sliceFailed)('no')), 'nor is a failure');
/* ── four sentences, never three ───────────────────────────────────────── */
eq((0, memberView_1.sliceNote)((0, memberView_1.sliceReady)([]), 'the door log'), null, 'a whole read needs no excuse');
eq((0, memberView_1.sliceNote)((0, memberView_1.sliceLoading)(), 'the door log'), 'reading the door log…', 'loading says loading');
eq((0, memberView_1.sliceNote)((0, memberView_1.sliceFailed)('boom'), 'the door log'), 'the door log could not be read', 'failed says failed');
{
    const note = (0, memberView_1.sliceNote)(part, 'the door log');
    ok(note != null, 'a truncated read has a sentence of its own');
    ok(!/^reading /.test(note ?? ''), 'and it is NOT the loading sentence — the read has finished');
    ok((note ?? '').includes('3'), 'and it names how many rows were read');
}
eq((0, memberView_1.sliceDash)((0, memberView_1.sliceReady)([])), null, 'a whole read has a figure, not a dash');
eq((0, memberView_1.sliceDash)((0, memberView_1.sliceLoading)()), '…', 'loading is an ellipsis');
eq((0, memberView_1.sliceDash)((0, memberView_1.sliceFailed)('boom')), 'not read', 'a failure is "not read"');
eq((0, memberView_1.sliceDash)(part), 'part read', 'a prefix is "part read" — the rows exist, which is a different errand');
ok((0, memberView_1.sliceDash)(part) !== (0, memberView_1.sliceDash)((0, memberView_1.sliceFailed)('boom')), 'and the two are never the same words, or the reader cannot tell a fault from a ceiling');
{
    const n = (0, memberView_1.truncationNote)('the payment runs', 100);
    ok(n.includes('100'), 'the shared truncation sentence names the cap');
    ok(/subtotal/i.test(n), 'and says why nothing over it may be totalled');
}
/* ── a member record with a truncated part ─────────────────────────────── */
const MEMBER = 'm1';
const membership = (id) => ({
    id: `ms-${id}`,
    memberId: id,
    planId: 'p1',
    planName: 'Standard',
    status: 'active',
    startedAt: '2026-01-01T00:00:00Z',
    endsAt: null,
});
const payment = (n) => ({
    id: `pay-${n}`,
    memberId: MEMBER,
    amountCents: 1000,
    currency: 'AED',
    takenAt: `2026-0${(n % 9) + 1}-01T00:00:00Z`,
});
const record = (payments) => ({
    memberships: (0, memberView_1.sliceReady)([membership(MEMBER)]),
    payments,
    visits: (0, memberView_1.sliceReady)([]),
    bookings: (0, memberView_1.sliceReady)([]),
    sessions: (0, memberView_1.sliceReady)([]),
    passes: (0, memberView_1.sliceReady)([]),
    invites: (0, memberView_1.sliceReady)([]),
});
{
    const whole = record((0, memberView_1.sliceReady)([payment(1), payment(2)]));
    eq((0, memberView_1.buildDossier)(MEMBER, whole).paidCents, 2000, 'a whole payments read totals');
    eq((0, memberView_1.completeness)(whole), 'whole', 'and the page is whole');
    eq((0, memberView_1.truncationWarning)(whole), null, 'with nothing to warn about');
    eq((0, memberView_1.truncatedParts)(whole).length, 0, 'and no truncated parts');
}
{
    const cut = record((0, memberView_1.slicePartial)([payment(1), payment(2), payment(3)], 3));
    const d = (0, memberView_1.buildDossier)(MEMBER, cut);
    // The assertion this whole file exists for. Three real payments are in hand
    // and the total over them is 3000 — which is the wrong number, because there
    // are more. It is withheld instead.
    eq(d.paidCents, null, 'a TRUNCATED payments read produces no total, not a subtotal');
    eq(d.lastPaidAt, null, 'and no "last paid" date, which would be the last of a prefix');
    eq(d.payments, null, 'and the dossier carries no payment rows for a figure to be taken over');
    // But the rest of the record is untouched. A truncated read is one part being
    // short, not the page failing.
    eq(d.planName, 'Standard', 'while the parts that came back whole are unaffected');
    eq((0, memberView_1.memberIds)(cut)?.length, 1, 'and the roster still names the member');
    eq((0, memberView_1.completeness)(cut), 'truncated', 'the page says it is a prefix');
    eq((0, memberView_1.truncatedParts)(cut).join(','), 'payments', 'and names the part that was cut off');
    eq((0, memberView_1.brokenParts)(cut).length, 0, 'nothing is BROKEN — the read succeeded');
    eq((0, memberView_1.partialWarning)(cut), null, 'so the failure banner stays silent');
    const w = (0, memberView_1.truncationWarning)(cut);
    ok(w != null, 'and the truncation banner speaks instead');
    ok((w ?? '').includes('payments'), 'naming the part');
    ok(/prefix/i.test(w ?? ''), 'and saying the word that means "there are more"');
    ok(w !== (0, memberView_1.partialWarning)(record((0, memberView_1.sliceFailed)('boom'))), 'the two banners are never the same sentence — one is a fault to chase, one is a figure to stop quoting');
}
/* ── the ranking, which is the part that is easy to get backwards ──────── */
{
    // 'broken' still outranks everything: once something has definitively failed
    // the page is incomplete whatever else is true of it.
    const brokenAndCut = {
        ...record((0, memberView_1.slicePartial)([payment(1)], 1)),
        visits: (0, memberView_1.sliceFailed)('boom'),
    };
    eq((0, memberView_1.completeness)(brokenAndCut), 'broken', 'a failure outranks a truncation');
    // 'loading' outranks 'truncated', for the reason worstStatus gives on the
    // phone: a part still in flight is not yet known to be anything, and calling
    // the page a prefix while it lands lets a screen draw a set that is about to
    // change.
    const loadingAndCut = {
        ...record((0, memberView_1.slicePartial)([payment(1)], 1)),
        visits: (0, memberView_1.sliceLoading)(),
    };
    eq((0, memberView_1.completeness)(loadingAndCut), 'loading', 'a read still in flight outranks a truncation');
    eq((0, memberView_1.pendingParts)(loadingAndCut).join(','), 'visits', 'and is named as pending');
    eq((0, memberView_1.truncatedParts)(loadingAndCut).join(','), 'payments', 'while the truncation is still recorded');
}
/* ── the places a fourth state could have slipped through ─────────────── */
// Three modules built on `Slice` computed "is this page whole" from two states
// and would have answered 'whole' over a prefix. They are the answer a screen
// prints, a bundle claims, and a month is signed on, so each is pinned here.
{
    // A month must not be CLOSEABLE over a prefix. Every gate on /close is
    // written `state === 'ready'`, which withholds the figures and does not stop
    // the sign-off — so the blocker is what stands between a truncated payments
    // read and a signed month that is quietly short.
    const rec = {
        payments: (0, memberView_1.slicePartial)([], 1000),
        invoices: (0, memberView_1.sliceReady)([]),
        sessions: (0, memberView_1.sliceReady)([]),
        memberships: (0, memberView_1.sliceReady)([]),
        passes: (0, memberView_1.sliceReady)([]),
    };
    eq((0, monthEnd_1.truncatedCloseParts)(rec).join(','), 'payments', 'a truncated close part is named');
    const w = { key: '2026-01', label: 'January 2026', firstDay: '2026-01-01', lastDay: '2026-01-31',
        fromIso: '2026-01-01T00:00:00.000Z', toIso: '2026-02-01T00:00:00.000Z' };
    const blockers = (0, monthEnd_1.closeBlockers)(rec, w, null, null, null, null, Date.parse('2026-03-01T00:00:00Z'));
    ok(blockers.some((b) => b.kind === 'read_truncated'), 'and a month cannot be closed over it — got ' + blockers.map((b) => b.kind).join(','));
    ok(!blockers.some((b) => b.kind === 'read_failed'), 'and it is NOT reported as a failure: the read succeeded, which is what makes it dangerous');
}
{
    // The staff page reported itself a whole picture over a prefix, because
    // `staffCompleteness` had three arms and the fourth state fell through the
    // last of them.
    const rec = {
        trainers: (0, memberView_1.slicePartial)([], 1000),
        sessions: (0, memberView_1.sliceReady)([]),
        shifts: (0, memberView_1.sliceReady)([]),
        clients: (0, memberView_1.sliceReady)([]),
        activity: (0, memberView_1.sliceReady)([]),
        classes: (0, memberView_1.sliceReady)([]),
    };
    eq((0, staffView_1.staffCompleteness)(rec), 'truncated', 'a staff page over a prefix is not a whole picture');
    eq((0, staffView_1.truncatedStaffParts)(rec).join(','), 'trainers', 'and it names the part');
    ok((0, staffView_1.staffTruncationWarning)(rec) != null, 'and it has a sentence of its own');
    ok((0, staffView_1.staffWarning)(rec) == null, 'while the failure banner stays silent — nothing failed');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('sliceTruncated: ok');
