"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What one square of the consistency heatmap says.
// Compile with tsc, run with node.
//
// The assertion that matters most: an unread log never reads as "no sessions".
// A member shown "you did not train" for a month they trained every day of has
// no way to tell the fault is ours.
const heatmap_1 = require("./heatmap");
const locale_1 = require("./locale");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const TODAY = new Date(2026, 8, 2);
TODAY.setHours(0, 0, 0, 0); // Wed 2 Sep 2026
const day = (y, m, d) => { const x = new Date(y, m, d); x.setHours(0, 0, 0, 0); return x; };
(0, locale_1.setAppLocale)('en-GB');
/* ── one square ────────────────────────────────────────────────────────── */
const two = (0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), 2, TODAY);
ok(/14/.test(two), `the square says which day it is — got ${two}`);
ok(/Aug/.test(two), `and which month — got ${two}`);
ok(/2 sessions/.test(two), `and how many sessions — got ${two}`);
ok(/1 session\b/.test((0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), 1, TODAY)), 'one session is singular');
ok(/no sessions/.test((0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), 0, TODAY)), 'and none is none');
// The one that must never collapse into the one above it.
const unread = (0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), null, TODAY);
ok(/not read/.test(unread), `an unread log says so — got ${unread}`);
ok(!/no sessions/.test(unread), 'and is never softened into "no sessions"');
const future = (0, heatmap_1.heatmapDayLabel)(day(2026, 8, 30), 0, TODAY);
ok(/still to come/.test(future), `a day that has not happened is not a day you missed — got ${future}`);
ok(!/no sessions/.test(future), 'and does not accuse anybody of missing it');
// Today itself is a day that has happened.
ok(/no sessions/.test((0, heatmap_1.heatmapDayLabel)(TODAY, 0, TODAY)), 'today counts as a day, not as the future');
// Every square is named, whatever it holds. Eighty-four unnamed views is the
// defect; an empty string would be the same defect with extra steps.
for (const c of [null, 0, 1, 5]) {
    const s = (0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), c, TODAY);
    ok(s.trim().length > 6, `a square with ${String(c)} sessions still has a name — got ${JSON.stringify(s)}`);
}
/* ── the column axis that did not exist ────────────────────────────────── */
const week = (start) => Array.from({ length: 7 }, (_, i) => day(start.getFullYear(), start.getMonth(), start.getDate() + i));
const wJul27 = week(day(2026, 6, 27)); // Mon 27 Jul — contains 1 Aug
const wJul20 = week(day(2026, 6, 20)); // wholly inside July
const wAug03 = week(day(2026, 7, 3)); // wholly inside August
eq((0, heatmap_1.heatmapColumnLabel)(wJul20, null), 'Jul', 'the first column always carries a label, so the axis has an anchor');
ok((0, heatmap_1.heatmapColumnLabel)(wJul27, wJul20) === 'Aug', 'a column containing the 1st is labelled with the month it enters');
eq((0, heatmap_1.heatmapColumnLabel)(wAug03, wJul27), null, 'and a column wholly inside one month repeats nothing');
// Twelve labels reading "Jul Jul Jul Aug Aug…" is not an axis. Over a quarter
// there should be about three.
let cursor = day(2026, 5, 1);
const cols = [];
for (let i = 0; i < 12; i++) {
    cols.push(week(cursor));
    cursor = day(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
}
const labels = cols.map((c, i) => (0, heatmap_1.heatmapColumnLabel)(c, i === 0 ? null : cols[i - 1])).filter(Boolean);
ok(labels.length >= 2 && labels.length <= 5, `twelve weeks carry a handful of month labels — got ${JSON.stringify(labels)}`);
/* ── the frame around the whole thing ──────────────────────────────────── */
ok(/12 weeks/.test((0, heatmap_1.heatmapSummary)(12, true)), 'the grid says how much time it covers');
ok(/oldest week first/.test((0, heatmap_1.heatmapSummary)(12, true)), 'and which way round it runs');
ok(/not been read/.test((0, heatmap_1.heatmapSummary)(12, false)), 'an unread log says so here too');
ok(!/oldest week first/.test((0, heatmap_1.heatmapSummary)(12, false)), 'and does not describe an arrangement of squares that mean nothing yet');
/* ── the reader's own language ─────────────────────────────────────────── */
(0, locale_1.setAppLocale)('fr-FR');
const fr = (0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), 1, TODAY);
ok(!/\b(Fri|Aug)\b/.test(fr), `no English weekday or month is glued into a French label — got ${fr}`);
(0, locale_1.setAppLocale)('en-GB');
const gb = (0, heatmap_1.heatmapDayLabel)(day(2026, 7, 14), 1, TODAY);
ok(gb.indexOf('14') < gb.search(/Aug/), `and a British reader still gets the day first — got ${gb}`);
(0, locale_1.setAppLocale)(null);
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('heatmap.test.ts — ok');
