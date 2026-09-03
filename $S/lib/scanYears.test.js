"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The year wheel on the scan sheet, and the dated fault it used to carry.
//
// `YEARS` was `Array.from({ length: 8 }, (_, i) => 2019 + i)` — a literal
// 2019-2026. On 1 January 2027 `indexOf(2027)` becomes -1, and the
// `Math.max(0, ...)` around it turns that into index 0, so every scan anybody
// added would have opened on 2019 with no way to scroll to the right year:
// it was not on the wheel.
//
// These assertions are written against a SUPPLIED `now` rather than the real
// clock, so the failure can be reproduced on demand instead of waiting four
// months for it. Compile with tsc, run with node.
const scanYears_1 = require("./scanYears");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the fault itself, at the date it would have arrived ─────────────────── */
for (const y of [2026, 2027, 2031, 2040]) {
    const ys = (0, scanYears_1.yearsAround)(new Date(y, 0, 1));
    ok(ys.includes(y), `the wheel contains the current year in ${y}`);
    ok(ys.indexOf(y) >= 0, `and indexOf finds it, so nothing falls back to the first entry in ${y}`);
}
// The specific regression: 1 January 2027, the day the old array ran out.
{
    const ys = (0, scanYears_1.yearsAround)(new Date(2027, 0, 1));
    const i = ys.indexOf(2027);
    ok(i >= 0, 'on 1 Jan 2027 the current year is on the wheel');
    eq(ys[i], 2027, 'and the selected index is that year, not 2019');
    ok(!ys.includes(2019) || ys[0] !== 2019 || ys.indexOf(2027) !== 0, 'the first entry is never silently the answer');
}
/* ── it reaches back far enough, and one year forward ────────────────────── */
{
    const ys = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1));
    eq(ys[0], 2016, 'ten years back');
    eq(ys[ys.length - 1], 2027, 'and one year forward, for a phone an hour ahead of UTC on New Year’s Eve');
    eq(ys.length, 12, 'no gaps');
    ok(ys.every((y, k) => k === 0 || y === ys[k - 1] + 1), 'strictly consecutive');
}
/* ── a stored date outside the window widens it, never refuses it ────────── */
{
    const old = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1), 2004);
    ok(old.includes(2004), 'a scan dated 2004 puts 2004 on the wheel');
    ok(old.includes(2026), 'and today is still on it');
    ok(old.indexOf(2004) === 0, 'the widened end is the start of the list');
    const ahead = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1), 2030);
    ok(ahead.includes(2030), 'a date ahead of the window widens forward too');
    eq(ahead[ahead.length - 1], 2030, 'to exactly that year and no further');
}
// The old code skipped the whole date when the year was not on the wheel,
// leaving whatever was already showing. Widening is what stops that.
{
    const ys = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1), 2011);
    ok(ys.indexOf(2011) >= 0, 'a 2011 scan can be indexed rather than skipped');
}
/* ── nothing is asked of it that it cannot answer ────────────────────────── */
{
    const a = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1), null);
    const b = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1));
    eq(a, b, 'a null year to include is the same as none');
    const inRange = (0, scanYears_1.yearsAround)(new Date(2026, 5, 1), 2020);
    eq(inRange, b, 'a year already inside the window widens nothing');
}
if (errors.length) {
    errors.forEach((e) => console.error(e));
    console.error(`scanYears: ${errors.length} failure(s)`);
    process.exit(1);
}
console.log('scanYears: ok — the wheel always contains today, and widens for a date outside its window');
