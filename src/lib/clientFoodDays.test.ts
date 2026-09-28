// What a client ate, as their coach reads it.
//
// The assertions are mostly about what this module REFUSES to say: a day with
// no rows is not a day somebody ate nothing, a target nobody set is not a
// target of zero, and a truncated read cannot be counted.
//
// Compile with tsc, then run under plain node.
import { foodDays, loggedOf, loggedLine, localDayOf } from './clientFoodDays';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── a day is the day the person was living in ────────────────────────────── */

{
  // Built as a local instant, so the assertion holds in every zone the suite
  // runs in. A meal at 11pm belongs to that evening, not to tomorrow in UTC.
  const late = new Date(2026, 8, 20, 23, 30).toISOString();
  eq(localDayOf(late), '2026-09-20', 'a late meal belongs to the evening it was eaten');
  eq(localDayOf('not a date'), null, 'an unreadable timestamp is not a day');
  eq(localDayOf(null), null, 'and neither is nothing');
}

/* ── totals, and what is not totalled ─────────────────────────────────────── */

{
  const at = (h: number) => new Date(2026, 8, 20, h, 0).toISOString();
  const days = foodDays([
    { logged_at: at(8), kcal: 400, protein: 30, carbs: 40, fat: 10, via: 'search' },
    { logged_at: at(13), kcal: 650, protein: 45, carbs: 60, fat: 20, via: 'photo' },
    { logged_at: new Date(2026, 8, 19, 12, 0).toISOString(), kcal: 500, protein: 20, carbs: 50, fat: 15, via: 'barcode' },
    // Dropped rather than bucketed into today: a meal with no readable date is
    // not evidence about any day.
    { logged_at: 'rubbish', kcal: 9999, protein: 1, carbs: 1, fat: 1, via: 'manual' },
  ]);
  eq(days.length, 2, 'rows group into the days they were eaten on');
  eq(days[0].day, '2026-09-20', 'and the newest day is first');
  eq(days[0].entries, 2, 'the count is of entries, not of grams');
  eq(days[0].kcal, 1050, 'calories add up');
  eq(days[0].protein, 75, 'and so do macros');
  ok(days[0].anyFromPhoto, 'a day holding a photo estimate says so');
  ok(!days[1].anyFromPhoto, 'and one that does not, does not');
  eq(days.reduce((s, d) => s + d.kcal, 0), 1550, 'the unreadable row is in no total anywhere');
}

// PostgREST returns numerics as strings on some columns. A figure that arrives
// as "45.5" is a figure.
{
  const days = foodDays([{ logged_at: new Date(2026, 8, 20, 9, 0).toISOString(), kcal: '400', protein: '30.4', carbs: '0', fat: null }]);
  eq(days[0].kcal, 400, 'a numeric that arrived as a string still counts');
  eq(days[0].protein, 30, 'and is rounded once, at the end');
  eq(days[0].fat, 0, 'a null column is nothing, not NaN');
}

eq(foodDays([]).length, 0, 'no rows, no days');
eq(foodDays(null).length, 0, 'and a failed read hands back no days rather than throwing');

/* ── how much of the week is even there ───────────────────────────────────── */

{
  const day = (d: number, entries: number): { day: string; entries: number; kcal: number; protein: number; carbs: number; fat: number; anyFromPhoto: boolean } =>
    ({ day: `2026-09-${String(d).padStart(2, '0')}`, entries, kcal: 0, protein: 0, carbs: 0, fat: 0, anyFromPhoto: false });
  const some = [day(20, 3), day(19, 2), day(18, 0), day(17, 1)];
  eq(loggedOf(some, 7).logged, 3, 'a day with no entries is not a logged day');
  eq(loggedOf(some, 7).span, 7, 'and the span is what was asked for');
  eq(loggedOf(some, 2).logged, 2, 'the span caps what is counted');
}

/* ── the sentence, and the four readings it keeps apart ───────────────────── */

{
  const truncated = loggedLine({ logged: 3, span: 7, whole: false, who: 'Sam' })!;
  ok(/cannot be counted/.test(truncated), 'a truncated read refuses to count days at all');
  ok(!/3 of/.test(truncated), 'and never states a count it does not have');

  const none = loggedLine({ logged: 0, span: 7, whole: true, who: 'Sam' })!;
  ok(/Nothing logged/.test(none), 'nothing logged is said');
  ok(/not the same as what they ate/.test(none),
    'and is said about the record rather than about the person');

  const all = loggedLine({ logged: 7, span: 7, whole: true, who: 'Sam' })!;
  ok(/all 7/.test(all), 'a full week says so, because it is the one case the averages mean what they look like');

  const some = loggedLine({ logged: 4, span: 7, whole: true, who: 'Sam' })!;
  ok(/4 of the last 7/.test(some), 'a part week says how much of it there is');
  ok(/averaged over those 4/.test(some), 'and says what that does to an average');
}

if (errors.length) {
  console.error(`clientFoodDays.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('clientFoodDays: ok (an unlogged day is not a day nobody ate, a target nobody set is not zero, and a truncated read counts nothing)');
