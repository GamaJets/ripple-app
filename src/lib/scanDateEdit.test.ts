// Correcting a scan's date. Compile with tsc, run with node.
//
// The date was not editable at all, and the reason given was a real one: the
// highest-dated scan is the one the meal plan follows, so moving a date can
// hand somebody's calorie and protein targets to a different reading without
// anything on screen saying so. The answer is not to refuse the edit — deleting
// and re-adding, which was the only route, destroys the photograph and the
// thirteen-key breakdown with it — but to be able to say what the move does
// BEFORE it happens. That is what `planDateMove` is, and this is what proves it.
//
// The other half is the wheel. src/lib/scanYears.ts records what happened the
// last time a date the wheel could not represent met a wheel that saved
// whatever it was showing, so the seeding is asserted here too: the position or
// nothing, never a silent fallback to today.
import {
  daysInMonth, scanDay, wheelPosition, isoFromWheel, planDateMove,
  type DatedScan,
} from './scanDateEdit';
import { yearsAround } from './scanYears';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${String(a)}, wanted ${String(b)})`);

// ── the calendar ───────────────────────────────────────────────────────────

eq(daysInMonth(1, 2026), 28, 'February 2026 has 28 days');
eq(daysInMonth(1, 2024), 29, 'and February 2024 has 29 — which is why this is not a lookup table');
eq(daysInMonth(0, 2026), 31, 'January has 31');
eq(daysInMonth(3, 2026), 30, 'April has 30');

// ── the day part, and nothing else ─────────────────────────────────────────

eq(scanDay('2026-08-14'), '2026-08-14', 'a bare date is its own day');
eq(scanDay('2026-08-14T23:30:00Z'), '2026-08-14', 'and a timestamp is cut to one, never parsed');
eq(scanDay(null), '', 'nothing is not a day');
eq(scanDay(undefined), '', 'and neither is undefined');

// ── seeding the wheel ──────────────────────────────────────────────────────

const now = new Date(2026, 8, 13);
const years = yearsAround(now);

const pos = wheelPosition(years, '2026-08-14');
ok(pos != null, 'a stored date the wheel can show comes back as a position');
eq(pos?.month, 7, 'August is month index 7');
eq(pos?.day, 13, 'and the 14th is day index 13');
eq(pos != null ? years[pos.yearIndex] : null, 2026, 'pointing at the stored year');

// A year outside the ordinary window. The caller widens FIRST and hands the
// widened list in, which is the order src/lib/scanYears.ts argues for: a stored
// date the wheel cannot show is a date the app would silently rewrite.
const wide = yearsAround(now, 2011);
const old = wheelPosition(wide, '2011-03-02');
ok(old != null, 'a scan dated outside the window still opens, on a widened list');
eq(old != null ? wide[old.yearIndex] : null, 2011, 'showing the year it was actually taken in');
eq(wheelPosition(years, '2011-03-02'), null,
  'while an unwidened list refuses rather than landing on the wrong year');

eq(wheelPosition(years, ''), null, 'an empty date is not a position');
eq(wheelPosition(years, 'yesterday'), null, 'and neither is something that is not a date');
eq(wheelPosition(years, '2026-02-30'), null,
  'a day that month does not have is refused rather than rolled into March');
eq(wheelPosition(years, '2026-13-01'), null, 'and so is a month that does not exist');

// ── reading the wheel back ─────────────────────────────────────────────────

eq(isoFromWheel(2026, 7, 13), '2026-08-14', 'three positions are one date');
eq(isoFromWheel(2026, 0, 0), '2026-01-01', 'zero-padded, because postgres takes a DATE not a guess');
// The day wheel keeps its position while the month wheel turns, so this is the
// ordinary case and not an edge one: the 31st with February selected.
eq(isoFromWheel(2026, 1, 30), '2026-02-28',
  'a day past the end of the month is clamped, not overflowed into the next one');
eq(isoFromWheel(2024, 1, 30), '2024-02-29', 'and the clamp knows about leap years');
eq(isoFromWheel(2026, 7, -1), '2026-08-01', 'a position below the first day is still a day');

// Round trip: every position the wheel can hold reads back to the date it was
// seeded from.
const roundTrip = ['2026-08-14', '2020-01-01', '2024-02-29', '2026-12-31'];
for (const iso of roundTrip) {
  const ys = yearsAround(now, parseInt(iso.slice(0, 4), 10));
  const p = wheelPosition(ys, iso);
  eq(p != null ? isoFromWheel(ys[p.yearIndex], p.month, p.day) : null, iso,
    `${iso} survives the trip through the wheel unchanged`);
}

// ── what the move costs ────────────────────────────────────────────────────

const history: DatedScan[] = [
  { id: 'a', takenAt: '2026-06-01' },
  { id: 'b', takenAt: '2026-07-01' },
  { id: 'c', takenAt: '2026-08-01' },
];

const still = planDateMove(history, 'b', '2026-07-01');
eq(still.changed, false, 'a date put back where it started is not a change');
eq(still.collidesWith, null, 'and a scan does not collide with itself');

const moved = planDateMove(history, 'b', '2026-07-15');
eq(moved.changed, true, 'a different day is a change');
eq(moved.wasNewest, false, 'the middle scan was not the newest');
eq(moved.becomesNewest, false, 'and moving it within the middle does not make it so');
eq(moved.handsOverNewest, false, 'so nobody’s targets move');

// THE ONE THAT MATTERS. Correcting the newest scan's date backwards hands the
// title — and with it the weight, the body fat and the daily calorie and
// protein targets the whole app is built on — to the scan before it.
const demoted = planDateMove(history, 'c', '2026-05-01');
eq(demoted.wasNewest, true, 'this was the scan every current figure came from');
eq(demoted.becomesNewest, false, 'and after the move it is the oldest');
eq(demoted.handsOverNewest, true, 'which is the sentence the member has to see before they save');

// The other direction is a change too, and a smaller one: it was the newest and
// it still is, so nothing is handed anywhere.
const promoted = planDateMove(history, 'c', '2026-09-01');
eq(promoted.wasNewest, true, 'it was the newest');
eq(promoted.becomesNewest, true, 'and still is');
eq(promoted.handsOverNewest, false, 'so no targets change hands');

// An older scan dragged past the newest takes the title, which moves the
// targets just as surely — in the other direction.
const overtakes = planDateMove(history, 'a', '2026-09-01');
eq(overtakes.wasNewest, false, 'it was not the newest');
eq(overtakes.becomesNewest, true, 'and now it is');
eq(overtakes.handsOverNewest, false, 'handsOverNewest is about LOSING the title, which this did not');

// A day another scan already occupies. The history folds by day, so the member
// would end up with two readings on one date and one of them quietly winning.
const clash = planDateMove(history, 'b', '2026-08-01');
eq(clash.collidesWith, 'c', 'the scan already on that day is named');
eq(clash.changed, true, 'and it is still a change');

// One scan on its own is the newest wherever it is put.
const only: DatedScan[] = [{ id: 'a', takenAt: '2026-06-01' }];
eq(planDateMove(only, 'a', '2020-01-01').wasNewest, true, 'the only scan is the newest');
eq(planDateMove(only, 'a', '2020-01-01').becomesNewest, true, 'and stays the newest wherever it goes');
eq(planDateMove(only, 'a', '2020-01-01').handsOverNewest, false, 'with nobody to hand anything to');

// A scan that is not in the list at all — deleted underneath the sheet, or a
// read that did not land. Nothing is claimed about it.
const gone = planDateMove(history, 'zzz', '2026-09-01');
eq(gone.changed, false, 'a scan that is not there cannot be moved');
eq(gone.wasNewest, false, 'and nothing is asserted about where it stood');
eq(gone.becomesNewest, false, 'in either direction');

// An empty history. Under a failed read this is what the caller holds, which is
// why the screen may not present any of this as an answer — but the function
// itself still has to be total.
eq(planDateMove([], 'a', '2026-09-01').changed, false, 'no history is no move');

// Dates are compared as strings, never parsed. A timestamp shaped value and its
// bare day are the same day.
const mixed: DatedScan[] = [{ id: 'a', takenAt: '2026-08-01T00:00:00Z' }, { id: 'b', takenAt: '2026-06-01' }];
eq(planDateMove(mixed, 'b', '2026-08-01').collidesWith, 'a',
  'a stored timestamp collides on its own calendar day, with no timezone in it');

if (errors.length) {
  console.error(`scanDateEdit: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`scanDateEdit ok — ${checks} checks (a date can be corrected, and what it costs is said before it is)`);
