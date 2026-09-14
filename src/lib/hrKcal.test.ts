// Energy from a heart rate.
//
// The request behind this was to take a cardio machine's calorie figure and
// correct it for the rider's heart rate, age, height and weight. The module
// declines to do that and offers a second, independent figure instead, and the
// assertions here are mostly about the ways it refuses.
//
// Compile with tsc, then run under plain node.
import {
  hrKcal, hrKcalConfidence, hrKcalNote, HR_MODEL_FLOOR, HR_MODEL_CEILING,
  hrKcalUnknown, hrKcalUnknownNote, sexFromColumn,
} from './hrKcal';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

// The reported session: 44-year-old man, 74 kg, 49 minutes, averaging around
// zone 3. Every figure is off the InBody sheet and the session on screen.
const RIDE = { avgBpm: 134, minutes: 49, age: 44, weightKg: 74, sex: 'male' } as const;

/* ── 1. a figure, and one that is the right size ──────────────────────────── */

{
  const k = hrKcal(RIDE);
  ok(k != null, 'a complete session produces a figure');
  // Sanity rather than a golden number: 49 minutes of zone-3 cycling for a
  // 74 kg man is several hundred kilocalories. Pinning the exact output would
  // be pinning the arithmetic to itself; this pins it to reality.
  ok(k != null && k > 250 && k < 900, `and it is a plausible size for the ride — got ${k}`);
}

// Longer is more, heavier is more, harder is more. If any of these ever
// inverted, the equation has been mistyped.
{
  const base = hrKcal(RIDE)!;
  ok(hrKcal({ ...RIDE, minutes: 98 })! > base, 'twice as long burns more');
  ok(hrKcal({ ...RIDE, weightKg: 95 })! > base, 'a heavier rider burns more');
  ok(hrKcal({ ...RIDE, avgBpm: 150 })! > base, 'a harder effort burns more');
}

// Doubling the time doubles the figure, because the model is per-minute.
{
  const a = hrKcal({ ...RIDE, minutes: 30 })!;
  const b = hrKcal({ ...RIDE, minutes: 60 })!;
  ok(Math.abs(b - a * 2) <= 1, 'the figure is linear in time, give or take rounding');
}

/* ── 2. the refusals, which are most of the point ─────────────────────────── */

// No default sex. The equations are genuinely different — the weight term even
// changes sign — so guessing would not be a small error.
eq(hrKcal({ ...RIDE, sex: undefined as any }), null, 'no sex, no figure');
eq(hrKcal({ ...RIDE, sex: 'other' as any }), null, 'and not a value the equations do not have');
ok(hrKcal({ ...RIDE, sex: 'female' }) !== hrKcal(RIDE), 'the two equations do not agree, which is why one is not assumed');

// No default anything else either.
eq(hrKcal({ ...RIDE, weightKg: undefined as any }), null, 'no weight, no figure');
eq(hrKcal({ ...RIDE, age: undefined as any }), null, 'no age, no figure');
eq(hrKcal({ ...RIDE, avgBpm: undefined as any }), null, 'no heart rate, no figure');
eq(hrKcal({ ...RIDE, minutes: undefined as any }), null, 'no duration, no figure');
eq(hrKcal(null), null, 'and nothing at all is nothing');

// Values that are present but cannot be true of a person.
eq(hrKcal({ ...RIDE, weightKg: 0 }), null, 'a weight of zero is not a light person');
eq(hrKcal({ ...RIDE, minutes: -5 }), null, 'and a negative duration is not a short session');
eq(hrKcal({ ...RIDE, avgBpm: Number.NaN }), null, 'an unreadable heart rate is not a heart rate');

// The male equation goes negative at a low heart rate for a light person. That
// is not a small burn — it is the model being asked about work nobody did.
eq(hrKcal({ avgBpm: 50, minutes: 30, age: 25, weightKg: 55, sex: 'male' }), null,
  'a resting heart rate produces no figure rather than a negative one');

/* ── 3. saying how much to trust it ───────────────────────────────────────── */

eq(hrKcalConfidence(134), 'in-range', 'zone 3 is inside the fitted range');
eq(hrKcalConfidence(HR_MODEL_FLOOR - 1), 'below-range', 'below the floor is named');
eq(hrKcalConfidence(HR_MODEL_CEILING + 1), 'above-range', 'and above the ceiling');
ok(HR_MODEL_FLOOR < HR_MODEL_CEILING, 'the range is a range');

/* ── 4. the sentence ──────────────────────────────────────────────────────── */

{
  const note = hrKcalNote(hrKcal(RIDE), RIDE.avgBpm)!;
  ok(note != null, 'a figure comes with a sentence');
  ok(/estimate/i.test(note), 'which calls it an estimate');
  ok(!/measured|measurement of/i.test(note.replace(/not a measurement/i, '')),
    'and never claims it was measured');
  ok(note.includes('134'), 'and says what heart rate it came from');
}

// No figure, no sentence — so a caller cannot narrate a number that is not there.
eq(hrKcalNote(null, 134), null, 'no figure, no sentence');
eq(hrKcalNote(300, null), null, 'and no heart rate, no sentence');

// Outside the range the sentence says so rather than reading the same.
ok(hrKcalNote(300, 60) !== hrKcalNote(300, 134), 'a figure outside the range is described differently');
ok(/low side|rough/i.test(hrKcalNote(300, 60)!), 'and a low heart rate is called out as rough');

/* ── 6. the blank has a reason, and the reason is said out loud ───────────── */

// The contract between the two functions: no figure if and only if there are
// reasons. If these ever disagree, a screen shows a blank with nothing under it
// or a sentence under a number.
{
  // `Record<string, unknown>`, not `Partial<typeof RIDE>`: RIDE is `as const`,
  // so its members are literal types and a different duration would not fit.
  const cases: Array<Record<string, unknown>> = [
    { ...RIDE },
    { ...RIDE, sex: undefined },
    { ...RIDE, weightKg: undefined },
    { ...RIDE, avgBpm: undefined, age: undefined },
    { ...RIDE, minutes: 0 },
    { avgBpm: 50, minutes: 30, age: 25, weightKg: 55, sex: 'male' },
    {},
  ];
  for (const c of cases) {
    const figure = hrKcal(c as any) != null;
    const reasons = hrKcalUnknown(c as any).length > 0;
    ok(figure !== reasons, `a figure and a reason are exclusive — ${JSON.stringify(c)}`);
  }
}

eq(hrKcalUnknown(RIDE).length, 0, 'a complete session has nothing to explain');
eq(hrKcalUnknownNote(hrKcalUnknown(RIDE)), null, 'and no sentence to show under it');

// Every missing input is named, not just the first. A member told about their
// weight, who fixes it and finds the blank still blank, has been sent round
// twice for one answer.
{
  const why = hrKcalUnknown({ ...RIDE, weightKg: undefined as any, sex: undefined as any });
  ok(why.includes('no-weight') && why.includes('no-sex'), 'both missing inputs are named');
  eq(why.length, 2, 'and only those two');
  const note = hrKcalUnknownNote(why)!;
  ok(/your weight/.test(note) && /your sex/.test(note), 'and the sentence says both');
}

// Three at once, in the order they are declared in — the order the sentence
// reads in, so it is pinned rather than incidental.
{
  const why = hrKcalUnknown({ minutes: 49, sex: 'male' });
  eq(why.join(','), 'no-heart-rate,no-age,no-weight', 'every missing input, in a fixed order');
  const note = hrKcalUnknownNote(why)!;
  ok(/heart rate.*date of birth.*weight/s.test(note), 'and the sentence lists all three in that order');
  ok(/, /.test(note) && / and /.test(note), 'joined as a list a person would say aloud');
}

// The reason that is true of everybody today.
{
  const why = hrKcalUnknown({ ...RIDE, sex: undefined as any });
  eq(why.join(','), 'no-sex', 'a session missing only a sex says only that');
  const note = hrKcalUnknownNote(why)!;
  ok(/sex/.test(note), 'the sentence names it');
  // It must not send them looking for a setting that does not exist. Nothing
  // in the product writes `clients.sex`; if that ever changes, this assertion
  // is the reminder that the sentence changes with it.
  ok(!/profile/i.test(note), 'and does not point at a screen that cannot record it');
}

// A figure the equations decline to produce is not a missing input.
{
  const why = hrKcalUnknown({ avgBpm: 50, minutes: 30, age: 25, weightKg: 55, sex: 'male' });
  eq(why.join(','), 'below-model', 'every input present, and still no figure');
  ok(/too low/.test(hrKcalUnknownNote(why)!), 'and the sentence says why rather than listing inputs');
}

// A sentence is never produced for nothing.
eq(hrKcalUnknownNote([]), null, 'no reasons, no sentence');

/* ── 7. the column and the union ──────────────────────────────────────────── */

// `clients.sex` is checked `in ('f','m')`. The union here is two words. The
// translation is the whole reason the column read as null for every member.
eq(sexFromColumn('f'), 'female', "the column's 'f'");
eq(sexFromColumn('m'), 'male', "and its 'm'");
eq(sexFromColumn(null), null, 'an unset column is not a body');
eq(sexFromColumn(''), null, 'nor is an empty string');
eq(sexFromColumn('male'), null, 'and the spelling this module uses is not what the column holds');
ok(hrKcal({ ...RIDE, sex: sexFromColumn('m')! }) === hrKcal(RIDE), "and 'm' selects the equation the module calls male");

if (errors.length) {
  console.error(`hrKcal.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('hrKcal.test.ts — ok');
