// A night is filed, or it is refused with a sentence. Never neither.
// Compile with tsc, run with node.
import { isFilableNight, sleepRefusal, MAX_SLEEP_HOURS, MAX_QUALITY } from './sleepEntry';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the range ──────────────────────────────────────────────────────────── */

ok(isFilableNight(7.5, 4), 'seven and a half hours at quality four is an ordinary night');
ok(isFilableNight(0.5, 1), 'so is half an hour with a bad mark on it');
ok(isFilableNight(MAX_SLEEP_HOURS, MAX_QUALITY), 'and the bounds themselves are inside the range');
ok(!isFilableNight(0, 3), 'no hours is not a night');
ok(!isFilableNight(-2, 3), 'nor is a negative one');
ok(!isFilableNight(75, 3), 'and 75 hours is the typo this whole module exists for');
ok(!isFilableNight(7.5, 0), 'a night with no quality mark is not filable');
ok(!isFilableNight(7.5, 6), 'nor one marked past the scale');
ok(!isFilableNight(7.5, 2.5), 'nor one marked half way between two marks');
ok(!isFilableNight(Number.NaN, 3), 'and NaN is not a duration');

/* ── every refusal has a sentence, and it is not the same sentence ──────── */

eq(sleepRefusal(7.5, 4), null, 'a good night is not refused, so there is nothing to say');
for (const [h, q] of [[0, 3], [75, 3], [7.5, 0]] as [number, number][]) {
  const why = sleepRefusal(h, q);
  ok(typeof why === 'string' && why.length > 10, `a refused night says why: ${h}h at ${q}`);
}
const reasons = new Set([sleepRefusal(0, 3), sleepRefusal(75, 3), sleepRefusal(7.5, 0)]);
eq(reasons.size, 3, 'and the three refusals are three different sentences');

// The one that matters: the member typed 75 meaning 7.5, and is told so rather
// than being shown two cleared boxes and no night.
const tooLong = sleepRefusal(75, 3)!;
ok(/7\.5/.test(tooLong), `the sentence offers the reading it almost certainly was, got: ${tooLong}`);
ok(/nothing has been logged/i.test(tooLong), 'and says plainly that nothing was filed');
ok(/24/.test(tooLong), 'and names the bound');

// The quality one names the scale rather than a rule.
ok(/1 to 5/.test(sleepRefusal(7.5, 0)!), 'the quality sentence names the scale');

// Nothing that is filable is ever given a refusal, and nothing that is refused
// is ever given none. The two functions cannot disagree.
for (const h of [0, 0.1, 1, 7.5, 24, 24.1, 75, -1]) {
  for (const q of [0, 1, 3, 5, 6]) {
    eq(sleepRefusal(h, q) === null, isFilableNight(h, q),
      `refusal and rule agree for ${h}h at ${q}`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sleepEntry: ok');
