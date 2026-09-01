// A bodyweight set must be worth what it was worth.
// Compile with tsc, run with node.
//
// The defect this suite is written against shipped and lasted the life of the
// product. `personalRecords` opened `if (!weight || !reps) continue;`, every
// tonnage in the app is reps × the second number of the pair, and both logging
// screens told the member in their own words that leaving the load box empty
// meant a bodyweight set. So the app invited people to log pull-ups and then
// discarded every one of them: no record, nothing on the Records board, nothing
// added to Trends or History. A member who trains on rings read their whole
// training history back as an empty one.
//
// Every block below is one way that failure could come back:
//
//   THE FLAG           an explicit mark, not an inferred zero
//   PRICING A SET      the person's weight on the day, and never any other day
//   NO INVENTED BODY   an unweighed member's set has no load and is SAID to
//   TONNAGE            what a total means when part of it cannot be weighed
//   RECORDS            reps at bodyweight is a record in its own right
//   ROUND TRIP         the flag survives the trip to a database row
import {
  isBodyweightSet, bodyweightAtKg, setLoadKg, entryTonnage, tonnage,
  tonnageNote, repRecords, bodyweightSetLabel, NO_TONNAGE,
  type BodyweightHistory,
} from './bodyweightSets';
import { personalRecords, isNewPR, weekStats, est1RM } from './streaks';
import { entryToRow, rowToEntry } from './workoutRow';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Local midday, so the assertions mean the same thing in every timezone the
// suite is run under (npm run test:zones runs it in three). A date built from
// an ISO string at midnight UTC lands on the previous day west of Greenwich,
// and this whole file is about which DAY a set and a weigh-in fall on.
const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};

const HISTORY: BodyweightHistory = [
  { t: at('2026-01-10'), v: 96 },
  { t: at('2026-05-04'), v: 92 },
  { t: at('2026-09-01'), v: 88 },
];

/* ── THE FLAG ─────────────────────────────────────────────────────────────
 *
 * A stored zero is not evidence. It is either a bodyweight set or a load
 * nobody typed, and the app's own live runner refuses a mistyped load
 * precisely because "a mistyped load silently becoming 0 records a bodyweight
 * set in the middle of a session". Inferring the flag from the zero would
 * relabel every one of those as a pull-up.
 */
{
  const guessed: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Bench Press', sets: [[8, 0]] };
  eq(isBodyweightSet(guessed, 0), false,
    'a set with a zero load and no flag is NOT bodyweight — it is a set nobody described');
  eq(setLoadKg(guessed, 0, guessed.sets![0], HISTORY, guessed.t), null,
    'and it has no load, rather than being priced at the member’s body');

  const said: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Pull-up', sets: [[8, 0]], bw: [true] };
  eq(isBodyweightSet(said, 0), true, 'a flagged set is bodyweight');

  const mixed: WorkoutEntry = {
    t: at('2026-06-01'), exercise: 'Dip', sets: [[10, 0], [8, 20], [6, 60]], bw: [true, true, false],
  };
  eq(isBodyweightSet(mixed, 1), true, 'the flags are per set, aligned to sets, exactly as feel is');
  eq(isBodyweightSet(mixed, 2), false, 'so one movement can hold both kinds of set in one entry');
  eq(isBodyweightSet(mixed, 9), false, 'and an index past the end is not bodyweight, it is nothing');
}

/* ── PRICING A SET ────────────────────────────────────────────────────────
 *
 * The member's weight on the day, taken from the reading on or before it.
 * Never a later one: a chart of the past that redraws itself whenever somebody
 * steps on a scale is not a record of anything.
 */
{
  eq(bodyweightAtKg(HISTORY, at('2026-02-14')), 96, 'January’s weigh-in prices a February set');
  eq(bodyweightAtKg(HISTORY, at('2026-06-20')), 92, 'and May’s prices a June one — the NEAREST at or before, not the first');
  eq(bodyweightAtKg(HISTORY, at('2026-09-01')), 88, 'a weigh-in prices a set done the same day');
  eq(bodyweightAtKg(HISTORY, at('2025-12-31')), null,
    'a set done before the first weigh-in has no weight — the future is not evidence about the past');
  eq(bodyweightAtKg([], at('2026-06-01')), null, 'and an empty history prices nothing');
  eq(bodyweightAtKg([{ t: at('2026-01-01'), v: 0 }], at('2026-06-01')), null,
    'a zero reading is not a body, it is a missing one');
  eq(bodyweightAtKg([{ t: 'not a date', v: 90 }], at('2026-06-01')), null,
    'and an unparseable reading is discarded rather than thrown');

  const e: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Pull-up', sets: [[8, 0], [6, 20]], bw: [true, true] };
  eq(setLoadKg(e, 0, e.sets![0], HISTORY, e.t), 92, 'a plain pull-up moved the person');
  eq(setLoadKg(e, 1, e.sets![1], HISTORY, e.t), 112, 'and a belted one moved the person plus the belt');

  const bar: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Back Squat', sets: [[5, 140]] };
  eq(setLoadKg(bar, 0, bar.sets![0], HISTORY, bar.t), 140,
    'an ordinary set is its own load and the body has nothing to do with it');
}

/* ── NO INVENTED BODY ─────────────────────────────────────────────────────
 *
 * The provider that holds the member's weight is emphatic: "The old fallback
 * object handed out 70 kg and 20% body fat, and every downstream calculation
 * treated them as measurements." Nothing here may reintroduce that.
 */
{
  const e: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Press-up', sets: [[20, 0]], bw: [true] };
  eq(setLoadKg(e, 0, e.sets![0], [], e.t), null, 'an unweighed member’s set has NO load');
  const t = entryTonnage(e, []);
  eq(t.kg, 0, 'so it adds nothing to the tonnage');
  eq(t.unknownSets, 1, 'and the tonnage says how many sets it could not price');
  ok(tonnageNote(t) != null, 'and a screen is given a sentence to print under the figure');
  ok(!/70/.test(tonnageNote(t) ?? ''), 'which names no weight, because none was given');
}

/* ── TONNAGE ──────────────────────────────────────────────────────────────
 *
 * A total over a set known to be incomplete is not a smaller number, it is a
 * wrong one — the rule src/ui/loadStatus.ts and src/lib/rowCap.ts both turn on.
 * So the count of unpriced sets travels WITH the figure, not beside it.
 */
{
  const day = at('2026-06-01');
  const log: WorkoutEntry[] = [
    { t: day, exercise: 'Back Squat', sets: [[5, 100], [5, 100]] },
    { t: day, exercise: 'Pull-up', sets: [[8, 0], [8, 10]], bw: [true, true] },
  ];
  const whole = tonnage(log, HISTORY);
  eq(whole.kg, 5 * 100 + 5 * 100 + 8 * 92 + 8 * 102, 'every set counted, the bodyweight ones at body plus belt');
  eq(whole.unknownSets, 0, 'and nothing left out');

  const blind = tonnage(log, []);
  eq(blind.kg, 1000, 'with no weigh-in the barbell work still totals');
  eq(blind.unknownSets, 2, 'and the two pull-up sets are reported as missing rather than as zero');
  ok((tonnageNote(blind) ?? '').includes('2 bodyweight sets'),
    'the sentence counts them, so the member knows how much is not in the figure');
  eq(tonnageNote(whole), null, 'a whole tonnage carries no caveat');

  eq(entryTonnage({ t: day, exercise: 'Row', cardio: { mins: 20, dist: 5, unit: 'km' } }, HISTORY).kg,
    NO_TONNAGE.kg, 'an entry with no sets has no tonnage and no complaint');

  // The failure that started all this, stated as a regression test: the old
  // arithmetic was reps × set[1], which for a pull-up is reps × 0.
  const oldWay = log.reduce((a, e) => a + (e.sets ?? []).reduce((x, s) => x + s[0] * s[1], 0), 0);
  eq(oldWay, 1080, 'the old arithmetic saw 1,080 kg');
  ok(whole.kg > oldWay + 1000, 'and the honest one sees well over a tonne more of real work');

  const wk = weekStats(log, Date.parse(day) + 1000, HISTORY);
  eq(wk.volumeKg, whole.kg, 'the week total uses the same arithmetic');
  eq(wk.unpricedSets, 0, 'and reports nothing missing when the weigh-ins are there');
  eq(weekStats(log, Date.parse(day) + 1000, []).unpricedSets, 2,
    'and reports both sets missing when they are not');
}

/* ── RECORDS ──────────────────────────────────────────────────────────────
 *
 * Two boards, deliberately. An estimated 1RM needs a load; reps at bodyweight
 * needs nothing the log does not already hold. A member who has never been
 * weighed gets the second one, which is the whole point — it is that member
 * whose Records screen said "No records yet" over a year of pull-ups.
 */
{
  const log: WorkoutEntry[] = [
    { t: at('2026-06-01'), exercise: 'Pull-up', sets: [[8, 0]], bw: [true] },
    { t: at('2026-07-01'), exercise: 'Pull-up', sets: [[12, 0]], bw: [true] },
    { t: at('2026-07-15'), exercise: 'Pull-up', sets: [[12, 10]], bw: [true] },
    { t: at('2026-06-02'), exercise: 'Back Squat', sets: [[5, 120]] },
  ];

  const blind = personalRecords(log, []);
  eq(blind.length, 1, 'with no weigh-in only the barbell lift can be estimated from');
  eq(blind[0].exercise, 'Back Squat', 'and it is the barbell lift');

  const known = personalRecords(log, HISTORY);
  const pu = known.find((p) => p.exercise === 'Pull-up');
  ok(pu != null, 'once the member has been weighed the pull-up reaches the board');
  eq(pu!.bodyweight, true, 'flagged, so the row can say "at bodyweight" rather than print a bar load');
  eq(pu!.addedKg, 10, 'and the belt is carried separately from the body');
  eq(pu!.weight, 102, 'the record load is the person plus the belt, not the belt alone');
  eq(pu!.est1RM, est1RM(102, 12), 'estimated through the app’s one 1RM formula');

  const reps = repRecords(log);
  eq(reps.length, 1, 'the reps board holds one movement');
  eq(reps[0].reps, 12, 'at its best rep count');
  eq(reps[0].addedKg, 10, 'and the belted twelve beats the plain twelve on the tie');
  eq(repRecords([{ t: at('2026-06-01'), exercise: 'Back Squat', sets: [[5, 120]] }]).length, 0,
    'a barbell lift is not a bodyweight record');

  eq(bodyweightSetLabel(12, 0, null), '12 reps at bodyweight', 'a plain set reads plainly');
  eq(bodyweightSetLabel(12, 10, '10 kg'), '12 reps at bodyweight +10 kg', 'and a belted one names the belt');

  // isNewPR has to read both sides the same way or the first pull-up session
  // logged after this change would be a "record" against a history it had been
  // ignoring.
  // Against the first two sessions only. `isNewPR` compares an entry with every
  // OTHER entry in the log it is handed, so passing the whole log here would
  // measure July against a belted set done a fortnight later.
  const second = log[1];
  eq(isNewPR(log.slice(0, 2), second, HISTORY), true, 'twelve beats eight');
  eq(isNewPR(log, log[0], HISTORY), false,
    'and eight does not beat twelve — the prior best is read with the same arithmetic as the new one');
  eq(isNewPR(log.slice(0, 2), second, []), false, 'with no weigh-in there is no load, so no claim is made either way');
}

/* ── ROUND TRIP ───────────────────────────────────────────────────────────
 *
 * `entryToRow` silently omitted `feel` and `zones` for months, because both were
 * read back on the way in and the pair looked symmetrical. This is the third
 * array in that alignment and it goes the same way if nobody checks.
 */
{
  const e: WorkoutEntry = {
    t: at('2026-06-01'), exercise: 'Dip', sets: [[10, 0], [8, 20]], bw: [true, false], feel: ['ok', 'hard'],
  };
  const row = entryToRow('user-1', e) as unknown as Record<string, unknown>;
  ok('bw' in row, 'the row carries a bw column');
  eq(JSON.stringify(rowToEntry(entryToRow('user-1', e)).bw), JSON.stringify(e.bw),
    'and the flags survive the trip out and back');

  const plain: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Walk' };
  eq((entryToRow('user-1', plain) as unknown as Record<string, unknown>).bw, null,
    'an entry with no flags sends null rather than omitting the column, so an edit can clear it');
  eq(rowToEntry({ performed_at: e.t, exercise: 'Dip', sets: [[10, 0]] }).bw, undefined,
    'and a row written before the column existed reads back as "nobody was asked"');
  eq(isBodyweightSet(rowToEntry({ performed_at: e.t, exercise: 'Dip', sets: [[10, 0]] }), 0), false,
    'which is read as an ordinary set — the same answer the app gave before, so no old row changes meaning');
}

if (errors.length) {
  console.error(`bodyweightSets: ${errors.length} failure(s)\n`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('bodyweightSets ok — a pull-up is worth the person who did it, and where nobody weighed them it is said rather than guessed');
