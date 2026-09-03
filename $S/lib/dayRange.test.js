"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The days a field will not take, asserted as arithmetic rather than as a copy
// of the implementation. Compile with tsc, run with node.
//
// ── The rule this suite is written to ─────────────────────────────────────
//
// `monthHasAllowedDay` is a shortcut: it tests the 1st and the last day of a
// month and says nothing about the twenty-nine in between. A test that stated
// its answer for three hand-picked months would pass for the shortcut and pass
// equally for a shortcut that was wrong about a month it was not given. So the
// shortcut is asserted against the FULL SWEEP — every day of the month, tested
// one at a time — over a couple of thousand month-and-range pairs. That is the
// property the shortcut is claiming, stated in the only form that can catch it
// being false.
//
// The rest follows the same rule. The bounds are inclusive, which is asserted
// by walking off both ends rather than by naming a day; an unreadable bound is
// ignored, which is asserted by showing the range behaves identically to no
// range at all rather than by checking one date against it.
//
// ── The formatter is injected, so this asserts wording and not Intl ───────
//
// `dayRefusal` takes the day formatter. The screens pass `fmtFullDay`, which
// asks the handset for a language and an order; this passes one that returns
// the ISO string back, so the sentence can be asserted without the assertion
// being about what Intl does on whichever machine runs it — and so it holds
// under all six zones of `npm run test:zones`.
const dayRange_1 = require("./dayRange");
const monthGrid_1 = require("./monthGrid");
const programStart_1 = require("./programStart");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** The injected formatter: the day, back. See the header. */
const plain = (iso) => iso;
/* ── no range at all ──────────────────────────────────────────────────────── */
ok((0, dayRange_1.dayAllowed)('2026-09-07', undefined), 'with no range an ordinary day is allowed');
ok((0, dayRange_1.dayAllowed)('2026-09-07', null), 'a null range is no range');
ok((0, dayRange_1.dayAllowed)('2026-09-07', {}), 'an empty range object is no range');
ok((0, dayRange_1.dayAllowed)('2024-02-29', {}), 'a leap day that exists is allowed');
/* ── what is not a day is never allowed, range or no range ────────────────── */
for (const bad of ['', '   ', 'next friday', '2026-9-7', '2026-02-30', '2023-02-29', '2026-13-01', '2026-00-10', '2026-09-07T00:00:00Z', null, undefined]) {
    ok(!(0, dayRange_1.dayAllowed)(bad, {}), `"${String(bad)}" is not a day and cannot be allowed`);
    ok(!(0, dayRange_1.dayAllowed)(bad, { min: '2000-01-01', max: '2099-12-31' }), `"${String(bad)}" is not a day even inside a wide range`);
    // And the refusal for it is the SHAPE one, not the range one — a coach who
    // typed words needs to be told the shape before they are told the ends.
    const why = (0, dayRange_1.dayRefusal)(bad, { min: '2026-01-01' }, plain);
    ok(why != null && why.includes('not a day this app can read'), `"${String(bad)}" is refused for its shape first`);
}
// 30 February is the one that matters, and it is the one a regex alone lets
// through. `isStartDate` round-trips it; if this ever passes, every field in
// the app can store a day that does not exist.
ok(!(0, programStart_1.isStartDate)('2026-02-30'), 'the underlying reader refuses 30 February');
ok(!(0, dayRange_1.dayAllowed)('2026-02-30', null), '30 February is not a day a range can allow');
/* ── both ends are INCLUSIVE, asserted by walking off them ────────────────── */
const span = { min: '2026-09-03', max: '2026-09-07' };
eq((0, dayRange_1.dayAllowed)('2026-09-02', span), false, 'the day before the floor is out');
eq((0, dayRange_1.dayAllowed)('2026-09-03', span), true, 'the floor itself is in');
eq((0, dayRange_1.dayAllowed)('2026-09-05', span), true, 'the middle is in');
eq((0, dayRange_1.dayAllowed)('2026-09-07', span), true, 'the ceiling itself is in');
eq((0, dayRange_1.dayAllowed)('2026-09-08', span), false, 'the day after the ceiling is out');
// A single-day range is a range: floor and ceiling on the same day allow that
// day and nothing else. This is the shape the settle field takes on an invoice
// issued today.
const oneDay = { min: '2026-09-03', max: '2026-09-03' };
eq((0, dayRange_1.dayAllowed)('2026-09-03', oneDay), true, 'a one-day range allows its day');
eq((0, dayRange_1.dayAllowed)('2026-09-02', oneDay), false, 'and nothing before it');
eq((0, dayRange_1.dayAllowed)('2026-09-04', oneDay), false, 'and nothing after it');
// A range whose ends are the wrong way round allows nothing, and says so
// rather than quietly swapping them. Nothing in the app builds one — but a
// silent swap would be a calendar offering days a caller had ruled out.
const backwards = { min: '2026-09-07', max: '2026-09-03' };
for (let d = 1; d <= 30; d++) {
    ok(!(0, dayRange_1.dayAllowed)((0, monthGrid_1.isoFromParts)(2026, 8, d), backwards), `a backwards range allows no day, including the ${d}th`);
}
/* ── one end only ─────────────────────────────────────────────────────────── */
const floorOnly = { min: '2026-09-03' };
ok(!(0, dayRange_1.dayAllowed)('2026-09-02', floorOnly), 'a floor refuses below it');
ok((0, dayRange_1.dayAllowed)('2099-12-31', floorOnly), 'and has no ceiling — a coach who agreed to wait until December sets December');
const ceilOnly = { max: '2026-09-03' };
ok((0, dayRange_1.dayAllowed)('1999-01-01', ceilOnly), 'a ceiling refuses nothing below it');
ok(!(0, dayRange_1.dayAllowed)('2026-09-04', ceilOnly), 'and refuses above it');
/* ── an unreadable bound is IGNORED, not treated as blocking ──────────────── */
//
// The failure this guards against is a calendar with every cell greyed out
// because one row came back empty. Asserted as an equivalence: a range whose
// ends cannot be read behaves EXACTLY as no range does, on every day of a year.
const junkRanges = [
    { min: '', max: '' },
    { min: null, max: null },
    { min: 'soon', max: 'later' },
    { min: '2026-02-30', max: '2026-13-40' },
    { min: undefined, max: undefined },
];
for (const r of junkRanges) {
    for (let m = 0; m < 12; m++) {
        for (let d = 1; d <= (0, monthGrid_1.daysInMonth)(2026, m); d++) {
            const iso = (0, monthGrid_1.isoFromParts)(2026, m, d);
            eq((0, dayRange_1.dayAllowed)(iso, r), (0, dayRange_1.dayAllowed)(iso, null), `an unreadable range must behave as no range on ${iso}`);
        }
        ok((0, dayRange_1.monthHasAllowedDay)(2026, m, r), `and must leave every month reachable — ${m}`);
    }
    eq((0, dayRange_1.dayRefusal)('2026-06-15', r, plain), null, 'and must refuse nothing readable');
}
// Half unreadable is half a range: the readable end still bites.
const halfJunk = { min: '2026-09-03', max: 'whenever' };
ok(!(0, dayRange_1.dayAllowed)('2026-09-02', halfJunk), 'a readable floor still holds when the ceiling is junk');
ok((0, dayRange_1.dayAllowed)('2030-01-01', halfJunk), 'and the junk ceiling stops nothing');
/* ── the month shortcut, against the full sweep ───────────────────────────── */
//
// The property `monthHasAllowedDay` claims: an interval test answers the same
// question as testing every day. Swept over every month of three years against
// a set of ranges chosen to land floors and ceilings inside months, on their
// first day, on their last day and outside them entirely.
//
// This is the assertion that earned the suite. The first implementation tested
// the month's 1st and last day and returned false for a range sitting wholly
// inside a month — which is every invoice issued and settled in the same month,
// the commonest case there is. The sweep failed on it before the sheet was ever
// rendered.
const sweepRanges = [
    null,
    {},
    { min: '2026-01-01' },
    { min: '2026-02-01' },
    { min: '2026-02-28' },
    { min: '2024-02-29' },
    { min: '2026-06-15' },
    { max: '2026-06-15' },
    { max: '2026-01-31' },
    { max: '2026-12-31' },
    { min: '2026-03-10', max: '2026-03-10' },
    { min: '2026-03-10', max: '2026-03-11' },
    { min: '2025-11-30', max: '2026-02-01' },
    { min: '2026-06-15', max: '2026-06-14' },
    { min: '2024-01-01', max: '2027-12-31' },
];
let sweepPairs = 0;
for (const r of sweepRanges) {
    for (let y = 2025; y <= 2027; y++) {
        for (let m = 0; m < 12; m++) {
            let any = false;
            for (let d = 1; d <= (0, monthGrid_1.daysInMonth)(y, m); d++) {
                if ((0, dayRange_1.dayAllowed)((0, monthGrid_1.isoFromParts)(y, m, d), r)) {
                    any = true;
                    break;
                }
            }
            sweepPairs++;
            eq((0, dayRange_1.monthHasAllowedDay)(y, m, r), any, `the two-end shortcut must agree with the full sweep for ${y}-${m + 1} under ${JSON.stringify(r)}`);
        }
    }
}
ok(sweepPairs === sweepRanges.length * 36, `the sweep covered every month of every range — ${sweepPairs}`);
// February is the month a shortcut gets wrong, because its last day moves. A
// floor on 29 February 2024 leaves that month reachable by exactly one day —
// its last — which is the case a shortcut testing only the 1st would miss.
ok((0, dayRange_1.monthHasAllowedDay)(2024, 1, { min: '2024-02-29' }), 'a leap February is reachable by its 29th alone');
ok(!(0, dayRange_1.monthHasAllowedDay)(2026, 1, { min: '2026-03-01' }), 'a February wholly below a March floor has nothing in it');
ok(!(0, dayRange_1.monthHasAllowedDay)(2026, 1, { max: '2026-01-31' }), 'and one wholly above a January ceiling has nothing either');
// And 29 February 2026 does not exist, so a bound naming it is a bound this
// build cannot read — which is ignored rather than blocking the month. See the
// header: an unreadable bound must never empty a calendar.
ok((0, dayRange_1.monthHasAllowedDay)(2026, 1, { min: '2026-02-29' }), 'a floor on a day that does not exist blocks nothing');
// Out-of-range month indices are normalised rather than being an error, so a
// caller can ask about the month after December without arithmetic of its own.
eq((0, dayRange_1.monthHasAllowedDay)(2026, 12, { min: '2027-01-01', max: '2027-01-31' }), (0, dayRange_1.monthHasAllowedDay)(2027, 0, { min: '2027-01-01', max: '2027-01-31' }), 'month 12 of 2026 is January 2027');
/* ── the refusal, and that it is exactly the negation of the permission ───── */
const refusalRanges = sweepRanges;
for (const r of refusalRanges) {
    for (let m = 0; m < 12; m++) {
        for (let d = 1; d <= (0, monthGrid_1.daysInMonth)(2026, m); d++) {
            const iso = (0, monthGrid_1.isoFromParts)(2026, m, d);
            const allowed = (0, dayRange_1.dayAllowed)(iso, r);
            const why = (0, dayRange_1.dayRefusal)(iso, r, plain);
            eq(why == null, allowed, `a refusal exists for exactly the days that are not allowed — ${iso}`);
        }
    }
}
// It names the bound it is refusing against, through the formatter it was
// given. Both halves matter: the wrong end named is a sentence that sends a
// coach looking in the wrong direction.
const low = (0, dayRange_1.dayRefusal)('2026-09-02', { min: '2026-09-03', max: '2026-09-30' }, plain);
ok(low != null && low.includes('2026-09-03'), 'a day under the floor names the floor');
ok(low != null && !low.includes('2026-09-30'), 'and does not name the ceiling');
ok(low != null && low.includes('earlier'), 'and says which way it is wrong');
const high = (0, dayRange_1.dayRefusal)('2026-10-01', { min: '2026-09-03', max: '2026-09-30' }, plain);
ok(high != null && high.includes('2026-09-30'), 'a day over the ceiling names the ceiling');
ok(high != null && !high.includes('2026-09-03'), 'and does not name the floor');
ok(high != null && high.includes('later'), 'and says which way it is wrong');
// The formatter is actually used, rather than the ISO being interpolated
// directly. If it is not, a coach in Tokyo reads a bound in a format the rest
// of the sheet does not use.
const shouty = (0, dayRange_1.dayRefusal)('2026-09-02', { min: '2026-09-03' }, (iso) => `<<${iso}>>`);
ok(shouty != null && shouty.includes('<<2026-09-03>>'), 'the bound is passed through the formatter it was given');
// A bound that cannot be read is never named in a sentence, because there is
// nothing to name and "nothing earlier than —" is the hole check:prose exists
// for.
eq((0, dayRange_1.dayRefusal)('2026-09-02', { min: 'soon' }, plain), null, 'an unreadable floor refuses nothing and names nothing');
/* ── zone independence ────────────────────────────────────────────────────── */
//
// Nothing here constructs a Date, so nothing here can move with the runner's
// zone. Stated as an assertion so `npm run test:zones` is what proves it: this
// same file runs in Kiritimati and in Midway, which are 26 hours apart, and
// both must produce these answers.
eq((0, dayRange_1.dayAllowed)('2026-01-01', { min: '2026-01-01', max: '2026-01-01' }), true, 'the boundary day is in, in every zone this suite runs under');
eq((0, dayRange_1.dayAllowed)('2025-12-31', { min: '2026-01-01' }), false, "and new year's eve is out of a range that starts on new year's day, in every zone");
if (errors.length) {
    console.error(`dayRange.test: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log('dayRange.test: ok');
