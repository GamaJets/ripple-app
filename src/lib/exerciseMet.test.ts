// The catalogue's MET, and the calorie figure that may or may not follow.
//
// Most of these assertions are about refusals. The module's whole reason for
// existing is that 601 of 608 catalogue rows carry a real MET and seven do not,
// and the seven must come out as a dash rather than as somebody else's number.
//
// Compile with tsc, then run under plain node.
import {
  catalogueMet, metKcal, metKcalGap, MET_FLOOR, MET_CEILING,
} from './exerciseMet';
import { activityMet, HIIT_ACTIVITIES, MOBILITY_ACTIVITIES } from './workoutKind';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1 · reading the column ───────────────────────────────────────────────── */

eq(catalogueMet(7.5), 7.5, 'a number is taken as it is');
// numeric(4,1) reaches some deployments as a string. Both shapes are the same
// figure and the module must not care which arrived.
eq(catalogueMet('7.5'), 7.5, 'and the string PostgREST hands back for a numeric');
eq(catalogueMet('6'), 6, 'including one with no decimal point in it');

eq(catalogueMet(null), null, 'an absent MET is null');
eq(catalogueMet(undefined), null, 'so is an undefined one');
eq(catalogueMet(''), null, 'an empty string is not a zero');
eq(catalogueMet('  '), null, 'nor is whitespace');
eq(catalogueMet('not a number'), null, 'unparseable is null');
eq(catalogueMet(NaN), null, 'NaN is null');
eq(catalogueMet(Infinity), null, 'and so is an infinity');
// `Number(true)` is 1, which sits inside the range. Without the explicit type
// guard this would come back as a resting-metabolic movement.
eq(catalogueMet(true), null, 'a boolean is never a MET');
eq(catalogueMet([7.5]), null, 'and neither is an array that would Number() cleanly');

// Zero is the one that matters: the column allows it, `Number(null)` and
// `Number('')` both produce it, and 0 × a body weight × an hour is a confident
// "0 kcal" printed over an hour of training.
eq(catalogueMet(0), null, 'zero is not a low MET, it is an absent one');
eq(catalogueMet(-3), null, 'a negative figure is refused');
ok(catalogueMet(MET_FLOOR) === MET_FLOOR, 'the floor itself is allowed');
ok(catalogueMet(MET_CEILING) === MET_CEILING, 'and so is the ceiling');
// A decimal point lost in an import turns 7.5 into 75. Refused, and NOT
// clamped: clamping would keep the calorie figure and discard the evidence.
eq(catalogueMet(75), null, 'a MET ten times too large is refused rather than clamped');
eq(catalogueMet(120), null, 'a heart rate written into the column is refused');

/* ── 2 · the figure, when every input is real ─────────────────────────────── */

// A 74 kg member, 30 minutes, MET 7.5 — 7.5 × 74 × 0.5 = 277.5.
const RIDE = { met: 7.5, weightKg: 74, minutes: 30 };

{
  const k = metKcal(RIDE);
  ok(k != null, 'a complete input produces a figure');
  eq(k, 278, 'and it is MET x kilograms x hours, rounded');
  eq(metKcalGap(RIDE), null, 'with no gap to report');
}

// Direction, so a mistyped expression cannot pass. Each of the three inputs is
// a multiplier, so more of any of them is more kilocalories.
{
  const base = metKcal(RIDE)!;
  ok(metKcal({ ...RIDE, minutes: 60 })! > base, 'twice as long burns more');
  ok(metKcal({ ...RIDE, weightKg: 95 })! > base, 'a heavier member burns more');
  ok(metKcal({ ...RIDE, met: 10 })! > base, 'a harder movement burns more');
  // Linear in the time, checked BEFORE the rounding rather than after it:
  // 7.5 x 74 x 0.5 is 277.5 and prints as 278, so twice the minutes is 555 and
  // not 556. Asserting `base * 2` would be asserting that a rounded figure
  // scales, which is a property this module does not have and must not be
  // written into a test as though it did.
  eq(metKcal({ ...RIDE, minutes: 60 }), 555, 'twice the minutes is twice the raw figure, rounded once');
  eq(metKcal({ ...RIDE, minutes: 20 }), 185, 'and a third of an hour is a third of it');
}

/* ── 3 · the refusals, which are the point ────────────────────────────────── */

// The seven catalogue rows with no MET. This is the case the item was about:
// the answer stays null rather than borrowing a literal about something else.
eq(metKcal({ met: null, weightKg: 74, minutes: 30 }), null, 'no MET, no figure');
eq(metKcalGap({ met: null, weightKg: 74, minutes: 30 }), 'no-met', 'and the gap says which input is missing');
eq(metKcal({ met: 0, weightKg: 74, minutes: 30 }), null, 'a zero MET is a gap, not a zero burn');
eq(metKcal({ met: 75, weightKg: 74, minutes: 30 }), null, 'an out-of-range MET is a gap too');

// The 70 kg default that used to stand in for every body.
eq(metKcal({ met: 7.5, weightKg: null, minutes: 30 }), null, 'no body weight, no figure');
eq(metKcalGap({ met: 7.5, weightKg: null, minutes: 30 }), 'no-weight', 'named as the weight');
eq(metKcal({ met: 7.5, weightKg: 0, minutes: 30 }), null, 'a zero weight is nobody');

eq(metKcal({ met: 7.5, weightKg: 74, minutes: null }), null, 'no minutes, no figure');
eq(metKcalGap({ met: 7.5, weightKg: 74, minutes: null }), 'no-minutes', 'named as the minutes');
eq(metKcal({ met: 7.5, weightKg: 74, minutes: 0 }), null, 'zero minutes is not a session');
eq(metKcal({ met: 7.5, weightKg: 74, minutes: -30 }), null, 'and neither is a negative one');

eq(metKcal(null), null, 'nothing at all is null and not a throw');
eq(metKcalGap(null), 'no-met', 'and reports the first gap rather than nothing');

// A burn that rounds to nothing renders as a dash, never as 0. "0 kcal" beside
// a movement is a measurement claim this model cannot make.
eq(metKcal({ met: 0.5, weightKg: 40, minutes: 0.1 }), null, 'a burn that rounds to zero is a dash, not a zero');

// The MET is asked about first: a movement the catalogue does not rate has no
// figure however complete the rest of the record is, and that is the sentence
// worth putting in front of the member.
eq(metKcalGap({ met: null, weightKg: null, minutes: null }), 'no-met', 'the MET is the first gap named');

/* ── 4 · the two MET tables stay apart ────────────────────────────────────── */

// `activityMet` answers for Train's picker and for nothing else. A catalogue
// movement passed to it must come back null rather than borrowing the nearest
// sounding session.
eq(activityMet('Yoga'), 3.0, "the picker's own activity has the picker's MET");
eq(activityMet('  tabata '), 10.0, 'trimmed and case-insensitive, like a logged name');
eq(activityMet('Hamstring Stretching'), null, 'a catalogue movement is not the picker Stretching session');
eq(activityMet('Barbell Row'), null, 'and a barbell row is not a rowing machine');
eq(activityMet('Back Squat'), null, 'a movement the picker has never heard of gets null, not a default');
eq(activityMet(''), null, 'an empty name is null');
eq(activityMet(null), null, 'so is no name at all');
eq(activityMet('Sauna'), null, 'a recovery modality has no MET here — it is not exercise expenditure');

// Every name in the two lists resolves, so a list entry cannot silently lose
// its MET to a rename. This is the drift the KindActivity note is about.
for (const a of [...HIIT_ACTIVITIES, ...MOBILITY_ACTIVITIES]) {
  eq(activityMet(a.name), a.met, `${a.name} resolves to its own MET`);
  // And every one of them is a figure this module would accept, so the two
  // tables cannot disagree about what counts as a MET at all.
  eq(catalogueMet(a.met), a.met, `${a.name}'s MET is inside the range catalogueMet allows`);
}

if (errors.length) {
  console.error(`exerciseMet.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('exerciseMet.test.ts — ok');
