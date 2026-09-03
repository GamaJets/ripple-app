// "Same again next term". Compile with tsc, run with node.
//
// Three things these hold shut, and the first two are the ones that put a coach
// in an empty room:
//
//   1. the run is counted from the LAST occurrence of the series, not from
//      today — which is both what "next term" means and what makes a repeat
//      unable to land on a slot the timetable already holds. Counted from
//      today, a coach opening this in week eleven of a twelve-week term gets a
//      class on top of next Tuesday's and a term one week short at the far end;
//   2. an occurrence behind today is skipped rather than written. A class
//      scheduled for three weeks ago is on nobody's timetable and cannot be
//      booked, and it would make the count of what was added disagree with what
//      a member can see;
//   3. a week is added in WALL-CLOCK time. `+ 7 * 86400000` moves a 6pm class
//      to 5pm or 7pm across a daylight-saving boundary, and the members who
//      booked the old one turn up an hour out. `test:zones` runs this suite
//      under three timezones for lines like that one.
import {
  atTimeOfDay, daysLater, seriesKey, seriesOf, weeksLater, duplicatePlan, duplicateBrief,
  duplicateBlocker, duplicateOutcome,
  type SeriesClass,
} from './classSeries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A class at a LOCAL wall-clock time, which is what a timetable is written in.
 *  Built through the Date constructor rather than from an ISO string so the
 *  fixture means the same thing in every timezone the suite runs under. */
const at = (y: number, m: number, d: number, h: number): string =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const base = (over: Partial<SeriesClass> = {}): SeriesClass => ({
  id: 'c1', title: 'Reformer', kind: 'Reformer', instructor: 'Sam', branch: 'Al Quoz',
  room: 'Studio 2', durationMin: 45, capacity: 12, startsAt: at(2026, 3, 3, 18), ...over,
});

/* ── what makes two rows one series ────────────────────────────────────── */

const tue6 = base();
eq(seriesKey(base({ id: 'c2', startsAt: at(2026, 3, 10, 18) })), seriesKey(tue6),
  'the same class a week later is the same series — the date is not in the key');
ok(seriesKey(base({ id: 'c3', startsAt: at(2026, 3, 5, 18) })) !== seriesKey(tue6),
  'Thursday 6pm is a different class from Tuesday 6pm, not the same one recorded twice');
ok(seriesKey(base({ id: 'c4', startsAt: at(2026, 3, 10, 19) })) !== seriesKey(tue6),
  'and so is 7pm');
ok(seriesKey(base({ id: 'c5', durationMin: 60 })) !== seriesKey(tue6),
  'a 60-minute class is a different product from a 45-minute one with the same name');
ok(seriesKey(base({ id: 'c6', capacity: 20 })) !== seriesKey(tue6),
  'and so is one with a different capacity');

// Branch is free text, so two spellings of one branch must not split a series
// into two series of one.
eq(seriesKey(base({ id: 'c7', branch: ' al quoz ' })), seriesKey(tue6),
  'branch is matched case- and space-insensitively, because it is typed by hand');

/* ── the weekly step keeps the wall clock ──────────────────────────────── */

// 29 March 2026 is the European DST switch. A 6pm class the week before must
// still be a 6pm class the week after, whatever the offset did.
const beforeDst = at(2026, 3, 24, 18);
const after = weeksLater(beforeDst, 1);
ok(after != null, 'a readable date steps forward');
eq(new Date(after as string).getHours(), 18, 'a week later is the same hour on the clock, not the same number of milliseconds');
eq(new Date(after as string).getDay(), new Date(beforeDst).getDay(), 'and the same weekday');
eq(weeksLater('not a date', 1), null, 'a date that will not parse steps nowhere rather than to NaN');

/* ── the run starts after the LAST class ───────────────────────────────── */

const term: SeriesClass[] = [0, 1, 2].map((w) => base({ id: `t${w}`, startsAt: at(2026, 3, 3 + w * 7, 18) }));
// "Today" is inside the term, in week two — the case that matters.
const now = new Date(2026, 2, 12, 9, 0, 0, 0);
const plan = duplicatePlan(term[0], term, 4, now);

eq(plan.toWrite.length, 4, 'four more weeks means four more classes');
eq(new Date(plan.lastAt as string).getTime(), new Date(at(2026, 3, 17, 18)).getTime(),
  'the run counts forward from the last class on the timetable');
eq(new Date(plan.toWrite[0].startsAt).getTime(), new Date(at(2026, 3, 24, 18)).getTime(),
  'so the first new one is the week AFTER the last, not the week after today');
eq(plan.inPast, 0, 'and none of them falls before today');
eq(plan.shape.title, 'Reformer', 'the fields a coach would re-type are carried across');
eq(plan.shape.capacity, 12, 'including the ones nobody thinks about until a class is oversold');

/* ── a re-run starts after whatever is already there ───────────────────── */

// A coach who repeats a series twice does not get the same Tuesday twice: the
// run counts from the LAST occurrence, and after the first repeat that is the
// last of the classes it just added. This is what makes a per-date collision
// check unreachable, which is why there is not one — see the note on
// `PlannedClass.write`.
const half = [...term, base({ id: 'x1', startsAt: at(2026, 3, 24, 18) }), base({ id: 'x2', startsAt: at(2026, 3, 31, 18) })];
const rerun = duplicatePlan(term[0], half, 4, now);
eq(rerun.toWrite.length, 4, 'a second run adds four more');
ok(rerun.toWrite.every((p) => Date.parse(p.startsAt) > new Date(at(2026, 3, 31, 18)).getTime()),
  'and every one of them is past everything already on the timetable, so nothing is ever doubled');
eq(new Date(rerun.toWrite[0].startsAt).getTime(), new Date(at(2026, 4, 7, 18)).getTime(),
  'the first of them is the week after the last existing class');

/* ── a series that ended months ago ────────────────────────────────────── */

// The ordinary case: the coach notices in February that the Tuesday class
// stopped in January. The run still starts after the last class, so the first
// occurrences fall in the past — and a class scheduled for three weeks ago is
// on nobody's timetable and cannot be booked.
const lapsed = [base({ id: 'l1', startsAt: at(2026, 1, 6, 18) })];
const nowLater = new Date(2026, 1, 20, 9, 0, 0, 0);
const late = duplicatePlan(lapsed[0], lapsed, 4, nowLater);
ok(late.toWrite.every((p) => Date.parse(p.startsAt) > nowLater.getTime()),
  'nothing in the past is written, because a dead row is on nobody’s timetable');
ok(late.inPast > 0, 'and the ones skipped for being in the past are counted rather than hidden');
eq(late.planned.length, 4, 'all four are still considered, so the counts add up');
eq(late.toWrite.length + late.inPast, 4, 'and every one of them is either written or accounted for');

/* ── nothing to count forward from ─────────────────────────────────────── */

const broken = base({ startsAt: 'not a date' });
const noPlan = duplicatePlan(broken, [broken], 4, now);
eq(noPlan.lastAt, null, 'a class with no readable date has no last occurrence');
eq(noPlan.toWrite.length, 0, 'so nothing is proposed');
eq(duplicateBrief(noPlan).canWrite, false, 'and the brief says so rather than offering a confirm');

eq(duplicatePlan(term[0], term, 0, now).toWrite.length, 0, 'zero weeks writes nothing');
eq(duplicatePlan(term[0], term, -3, now).toWrite.length, 0, 'and neither does a negative one');

/* ── the read has to be whole ──────────────────────────────────────────── */

eq(duplicateBlocker('ready'), null, 'a whole timetable may be repeated');
ok(duplicateBlocker('partial') != null, 'a truncated one may not — the missing rows are the LATER ones, which is exactly what a repeat lands on');
ok(duplicateBlocker('error') != null, 'and neither may one that did not come back');
ok(duplicateBlocker('loading') != null, 'nor one still arriving');
ok(/row limit/i.test(duplicateBlocker('partial') as string), 'and the partial refusal says why rather than saying "try again"');
ok(/furthest ahead|later/i.test(duplicateBlocker('partial') as string),
  'naming the rows that are missing, because those are the ones the run counts from');
ok(!/no classes|nothing scheduled/i.test(duplicateBlocker('error') as string),
  'a failed read is never worded as an empty week');

/* ── what the coach reads ──────────────────────────────────────────────── */

const brief = duplicateBrief(plan);
eq(brief.canWrite, true, 'four to write is something to confirm');
ok(brief.title.includes('4'), 'the count is in the heading');
ok(brief.confirmLabel.includes('4'), 'and on the button, which is the sentence a coach remembers afterwards');
ok(brief.body.includes('Reformer'), 'the brief is about a named class rather than about the button that opened it');
ok(/book/i.test(brief.body), 'and says nothing is booked for anybody by adding them');

const lateBrief = duplicateBrief(late);
ok(lateBrief.body.includes(String(late.inPast)), 'a run with dates behind today says how many were skipped');
ok(/past|before today/i.test(lateBrief.body), 'and why');

// Every occurrence behind today: there is nothing to write and nothing to
// confirm, and the sentence has to say what to do instead rather than reading
// as a failure.
const allPast = duplicatePlan(lapsed[0], lapsed, 2, new Date(2026, 5, 1, 9));
const none = duplicateBrief(allPast);
eq(none.canWrite, false, 'a run entirely behind today offers no confirm');
ok(/past|before today/i.test(none.body), 'and says why there is nothing to do');
ok(/more weeks|form above/i.test(none.body), 'and what to do instead');

/* ── and what actually landed ──────────────────────────────────────────── */

eq(duplicateOutcome('Reformer', 4, 4).title, 'Added To Your Timetable', 'four of four is added');
ok(/book/i.test(duplicateOutcome('Reformer', 4, 4).body), 'and says members can book them');
eq(duplicateOutcome('Reformer', 4, 0).title, 'Not On The Timetable', 'none of four is not "added"');
ok(/this phone only/i.test(duplicateOutcome('Reformer', 4, 0).body),
  'and says where they actually are, because a class on one handset is on nobody’s timetable');
eq(duplicateOutcome('Reformer', 4, 2).title, 'Partly Added', 'two of four is neither');
ok(/2 of 4/.test(duplicateOutcome('Reformer', 4, 2).body), 'and names both halves');
ok(/counts forward from the last class that actually landed/i.test(duplicateOutcome('Reformer', 4, 2).body),
  'and tells the coach that trying again is safe, which is the thing they need to know');

/* ── the series filter ─────────────────────────────────────────────────── */

const mixed: SeriesClass[] = [
  ...term,
  base({ id: 'other', title: 'Spin', kind: 'Cycle', startsAt: at(2026, 3, 3, 18) }),
];
eq(seriesOf(term[0], mixed).length, 3, 'a different class at the same hour is not part of this series');
eq(seriesOf(term[0], mixed)[0].id, 't0', 'and the series comes back oldest first');

/* ── correcting a class that was typed in at the wrong time ────────────── */

// The Manage sheet on app/(trainer)/classes.tsx builds a corrected start out of
// these two, in this order. Neither may move the clock by accident: a class
// nudged a day and landing an hour out is a room full of people at the wrong
// time, which is the same failure the Repeat loop had.
const sixPm = at(2026, 3, 3, 18);

eq(new Date(daysLater(sixPm, 1)!).getHours(), 18, 'a day later is the same hour');
eq(new Date(daysLater(sixPm, -1)!).getHours(), 18, 'and so is a day earlier');
eq(new Date(daysLater(sixPm, 1)!).getDate(), 4, 'the date moves forward');
eq(new Date(daysLater(sixPm, -1)!).getDate(), 2, 'and back');
eq(daysLater(sixPm, 0), sixPm, 'no nudge is no change at all');
eq(daysLater('not a date', 1), null, 'an unreadable start moves nowhere');
eq(daysLater(sixPm, Number.NaN), null, 'and neither does a nudge that is not a number');

// The whole point of `setDate`. Every zone that has a clocks change has one of
// these fortnights in it, and the suite runs under six.
for (const around of [at(2026, 3, 28, 18), at(2026, 10, 30, 18), at(2026, 11, 6, 18)]) {
  for (const n of [-7, -1, 1, 7]) {
    eq(new Date(daysLater(around, n)!).getHours(), 18,
      `a 6pm class nudged ${n} days around a clocks change is still at 6pm`);
  }
}

const moved = atTimeOfDay(sixPm, 6, 30);
eq(new Date(moved!).getHours(), 6, 'the hour is set');
eq(new Date(moved!).getMinutes(), 30, 'and the minute');
eq(new Date(moved!).getDate(), 3, 'and the day is left alone');
eq(new Date(moved!).getSeconds(), 0, 'a class starts on the minute');

// A stepper that wraps must not roll a class into tomorrow, which is a class
// the members who booked it cannot find.
eq(new Date(atTimeOfDay(sixPm, 24, 0)!).getDate(), 3, 'hour 24 stays on the same day');
eq(new Date(atTimeOfDay(sixPm, 24, 0)!).getHours(), 0, 'as midnight');
eq(new Date(atTimeOfDay(sixPm, -1, 0)!).getHours(), 23, 'and a negative hour wraps within the day');
eq(new Date(atTimeOfDay(sixPm, 18, 60)!).getMinutes(), 0, 'minute 60 is the top of the hour');
eq(atTimeOfDay('not a date', 6, 30), null, 'an unreadable start has no time of day to set');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`classSeries: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('classSeries: ok (no double booking, counted from the last class, and a week is a week on the clock)');
