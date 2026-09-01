// A client's check-in as their coach reads it. Compile with tsc, run with node.
//
// The bugs these guard:
//
//   · a 1-5 self-rating rendered as a percentage — a client who rated
//     themselves 4/5 shown as "4%" and flagged at risk (src/ui/roster.tsx
//     carries the report);
//   · `Number(null) || 0` turning an unanswered field into "0/5", which is a
//     specific and damning claim about somebody's week;
//   · an empty list under 'error' printed as "they have not checked in", which
//     is an accusation about a person produced by a failed read.
import {
  RATING_MAX, adherencePercent, checkInAge, checkInGapLine,
  daysAgo, noteOf, rating, ratingLabel, ratingsLine, readCoachCheckIns, weightOf,
  type CheckInRow, type CoachCheckIn,
} from './coachCheckins';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── an unanswered rating is not a zero ─────────────────────────────────── */

eq(rating(0), null, 'zero is not a rating on a one-to-five scale');
eq(rating(null), null, 'a null is not a rating');
eq(rating(undefined), null, 'an absent field is not a rating');
eq(rating(''), null, 'an empty string is not a rating');
eq(rating(NaN), null, 'NaN is not a rating');
eq(rating(6), null, 'six is off the scale');
eq(rating(-1), null, 'a negative is off the scale');
eq(rating(3.5), null, 'a half is not one of the five points');
eq(rating(1), 1, 'one is the bottom of the scale');
eq(rating(RATING_MAX), RATING_MAX, 'five is the top of the scale');
// PostgREST hands some numeric columns back as strings; refusing those would
// blank a real answer the client gave.
eq(rating('4'), 4, 'a numeric string is the number it says');
eq(rating(' 4 '), 4, 'and surrounding whitespace does not blank it');

eq(ratingLabel(4), '4/5', 'a rating states its scale');
eq(ratingLabel(0), null, 'and there is no label for a non-answer');

/* ── THE bug: four out of five is not four per cent ─────────────────────── */

eq(adherencePercent(4), 80, 'four out of five is eighty per cent, not four');
eq(adherencePercent(5), 100, 'five out of five is everything');
eq(adherencePercent(1), 20, 'one out of five is twenty');
eq(adherencePercent(3), 60, 'three out of five is sixty, not 60.000000000000006');
eq(adherencePercent(0), null, 'a non-answer has no percentage');
eq(adherencePercent(null), null, 'a null has no percentage');
// atRiskClient() flags anything under 80. The whole point of the conversion is
// that a client rating themselves well does not land under that line.
ok((adherencePercent(4) ?? 0) >= 80, 'a client who rated themselves 4/5 is not flagged at risk');

/* ── a weight of zero is a coercion artefact, not a weigh-in ────────────── */

eq(weightOf(0), null, 'nobody weighs nothing');
eq(weightOf(null), null, 'a nullable column with no value is no weight');
eq(weightOf(72.4), 72.4, 'a weight is the weight');
eq(weightOf('72.4'), 72.4, 'including when it arrives as a string');
eq(weightOf(-5), null, 'a negative is not a weight');

/* ── an empty note and no note are one event ────────────────────────────── */

eq(noteOf(''), null, 'the empty string is not a note');
eq(noteOf('   '), null, 'three spaces is not a note');
eq(noteOf(null), null, 'a null is not a note');
eq(noteOf(42), null, 'a number is not a note');
eq(noteOf('  knee felt better  '), 'knee felt better', 'a note is trimmed, not blanked');
eq(noteOf('0'), '0', 'a note of "0" is still a note somebody wrote');

/* ── the rows, newest first, with the unusable ones dropped ─────────────── */

const rows: CheckInRow[] = [
  { id: 'a', at: '2026-08-10T09:00:00.000Z', weight_kg: 80, energy: 3, sleep: 2, mood: 3, adherence: 4, note: 'Long week.' },
  { id: 'c', at: '2026-08-24T09:00:00.000Z', weight_kg: 79, energy: 5, sleep: 4, mood: 5, adherence: 5, note: '' },
  { id: 'b', at: '2026-08-17T09:00:00.000Z', weight_kg: null, energy: 0, sleep: null, mood: 4, adherence: null, note: null },
  { id: 'x', at: null, energy: 5 },
  { id: 'y', at: 'not a date', energy: 5 },
];
const read = readCoachCheckIns(rows);
eq(read.length, 3, 'a check-in with no usable date is not put in front of a coach');
eq(read.map((c) => c.id).join(','), 'c,b,a', 'newest first');

const [newest, middle] = read;
eq(newest.note, null, 'an empty note comes back as no note');
eq(newest.adherence, 5, 'the rating is carried as the rating it is');
eq(middle.energy, null, 'a zero energy is not shown as 0/5');
eq(middle.sleep, null, 'an unanswered sleep is unknown');
eq(middle.mood, 4, 'and the one they DID answer survives beside them');
eq(middle.weightKg, null, 'a check-in with no weigh-in has no weight');

eq(readCoachCheckIns(null).length, 0, 'a null read is no rows');
eq(readCoachCheckIns([]).length, 0, 'an empty read is no rows');

// Two rows sharing an instant must not reorder themselves between renders.
const tied = readCoachCheckIns([
  { id: 'aaa', at: '2026-08-24T09:00:00.000Z' },
  { id: 'bbb', at: '2026-08-24T09:00:00.000Z' },
]);
eq(tied.map((c) => c.id).join(','), 'bbb,aaa', 'a tie on the instant is settled by the id');

/* ── how long ago ───────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
eq(daysAgo('2026-09-01T09:00:00.000Z', NOW), 0, 'this morning is today');
eq(daysAgo('2026-08-28T12:00:00.000Z', NOW), 4, 'four days is four days');
eq(daysAgo('nonsense', NOW), null, 'an unreadable timestamp has no age');
// A row stamped in the future is a clock disagreement, not a negative age.
eq(daysAgo('2026-09-05T12:00:00.000Z', NOW), 0, 'a future timestamp is not a negative number of days');

eq(checkInAge('2026-09-01T09:00:00.000Z', NOW), 'Today', 'today reads as today');
eq(checkInAge('2026-08-31T09:00:00.000Z', NOW), 'Yesterday', 'yesterday reads as yesterday');
eq(checkInAge('2026-08-28T12:00:00.000Z', NOW), '4 days ago', 'and beyond that it counts');
eq(checkInAge('nonsense', NOW), null, 'an unreadable timestamp prints nothing rather than a dash in a sentence');

/* ── THE accusation, and the three answers that are not it ──────────────── */

eq(checkInGapLine('ready', 3, 'Sam'), null, 'with check-ins to show there is nothing to explain');
eq(checkInGapLine('error', 2, 'Sam'), null, 'and rows that came back are rows, whatever else failed');

const gaps = (['loading', 'error', 'partial', 'ready'] as const)
  .map((s) => [s, checkInGapLine(s, 0, 'Sam') as string] as const);

for (const [s, line] of gaps) {
  ok(!!line && line.trim().length > 0, `${s} has a sentence`);
}

// Only ONE of the four may say the client has not written. The other three are
// statements about a read.
for (const [s, line] of gaps) {
  eq(/has not sent a check-in/.test(line), s === 'ready',
    `${s} accuses the client only when that is actually known`);
}
// And the three that are not about the client say so plainly.
for (const [s, line] of gaps) {
  eq(/not known|not established|Reading/.test(line), s !== 'ready',
    `${s} names the read rather than the person`);
}
ok(gaps.find(([s]) => s === 'error')![1].includes('try again'),
  'a failed read tells the coach the thing that would actually help');
ok(gaps.find(([s]) => s === 'ready')![1].includes('Sam'),
  'the client is named rather than described as a dash');
eq(new Set(gaps.map(([, l]) => l)).size, 4, 'the four answers read as four sentences');

/* ── the four siblings are capitalised the same way ─────────────────────── */

const full: CoachCheckIn = {
  id: 'a', at: '2026-08-24T09:00:00.000Z', weightKg: 79,
  energy: 5, sleep: 4, mood: 5, adherence: 3, note: null,
};
eq(ratingsLine(full), 'Energy 5/5 · Sleep 4/5 · Mood 5/5 · Adherence 3/5',
  'four siblings, capitalised alike — this exact line shipped once as "Energy 4/5 · sleep 3/5"');
// Matches app/(client)/report.tsx character for character, so the client and
// their coach are reading the same four words about the same row.
for (const w of ['Energy', 'Sleep', 'Mood', 'Adherence']) {
  ok(ratingsLine(full)!.includes(w), `${w} is Title Case like its siblings`);
}

eq(ratingsLine({ ...full, sleep: null, adherence: null }), 'Energy 5/5 · Mood 5/5',
  'an unanswered rating is left out rather than drawn as a dash');
eq(ratingsLine({ ...full, energy: null, sleep: null, mood: null, adherence: null }), null,
  'a check-in with no ratings has no ratings line, so the caller can withhold the row');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachCheckins: ok');
