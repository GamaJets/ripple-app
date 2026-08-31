// The coach's own numbers, and the three sentences that go with them.
// Compile with tsc, run with node.
//
// What is defended here is a set of figures that would all look perfectly
// ordinary on a coach's phone while being false about their pay:
//
// 1. A half-typed rate is not a rate of zero. The box saves as the coach types,
//    so "12." exists on its way to "12.50", and a parser that answered 0 for it
//    would replace a stored rate with nothing, silently, mid-keystroke.
//
// 2. An empty box IS an instruction — unset it — and has to be told apart from
//    the half-typed case, because one is saved and the other must not be.
//
// 3. A pay estimate with no check-in count is null, not 0. The screen used to
//    print "25 × 0 checked in = 0" when the roster could not be read: a payout
//    figure for a class it never managed to look at.
//
// 4. An empty goals section says something different when the read FAILED than
//    when there are genuinely no targets. The first version said "No targets
//    set" either way, which invites a coach to type their targets in again over
//    the top of the ones already stored.
//
// Nothing here formats a currency, and nothing here should ever start to. The
// rate is a bare number the coach types about a payment Repple does not make.
import {
  parseRate, rateText, payEstimate, parseGoal, goalText, goalPct,
  goalsEmptyLine, rateFieldNote,
} from './coachPrefs';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The parsed rate, or null for the two answers that are not a number. Written
 *  once rather than inline, because TypeScript will not narrow a union across
 *  two separate calls to the same function. */
const rateValue = (text: string): number | null => {
  const r = parseRate(text);
  return r.kind === 'value' ? r.value : null;
};

/* ── reading a typed rate ─────────────────────────────────────────────────── */

eq(parseRate('25').kind, 'value', 'a whole number is a rate');
eq(rateValue('25'), 25, 'and it is that number');
eq(rateValue('37.5'), 37.5, 'a decimal rate is kept');
eq(rateValue('  40  '), 40, 'surrounding space is trimmed');
eq(rateValue('0'), 0, 'zero is a rate somebody may deliberately set — an unpaid class');

// The comma keyboard. Number('12,5') is NaN, so without this a coach on a
// German keyboard has a rate the app calls invalid every time they type it.
eq(rateValue('12,5'), 12.5, 'one comma is a decimal point');
eq(parseRate('1,234,5').kind, 'invalid',
  'two commas are a thousands separator or a slip, and guessing which would invent a figure');

// The empty box is an instruction and is saved as NULL.
eq(parseRate('').kind, 'empty', 'an empty box means unset my rate');
eq(parseRate('   ').kind, 'empty', 'so does a box of spaces');

// The half-typed and the mistyped are NOT instructions. Every one of these is
// something parseFloat would have turned into a number.
eq(parseRate('12.').kind, 'invalid', 'a rate mid-keystroke is not yet a rate — parseFloat says 12');
eq(parseRate('.').kind, 'invalid', 'a lone decimal point is not a number');
eq(parseRate('12abc').kind, 'invalid', 'a typo is not a rate — parseFloat says 12');
eq(parseRate('abc').kind, 'invalid', 'nor is a word');
eq(parseRate('-5').kind, 'invalid', 'a negative rate is not a rate');
eq(parseRate('1e3').kind, 'invalid', 'exponent notation is a slip on a numeric keypad, not 1000');
eq(parseRate('Infinity').kind, 'invalid', 'Infinity is not a rate');
// All digits, so it passes the shape check — and Number() makes it Infinity.
eq(parseRate('9'.repeat(400)).kind, 'invalid', 'a rate too large to be a number is not a rate');
eq(parseRate('NaN').kind, 'invalid', 'nor is NaN');

/* ── a stored rate back into the box ──────────────────────────────────────── */

eq(rateText(37.5), '37.5', 'a stored rate fills the box');
eq(rateText(37.50), '37.5', 'the trailing zero numeric(12,2) adds back is dropped');
eq(rateText(0), '0', 'a deliberate zero rate is shown as zero');
eq(rateText(null), '', 'no rate set is an EMPTY box — not "0", which would read as a rate of nothing');
eq(rateText(undefined), '', 'and neither is it the word undefined');
eq(rateText(Number.NaN), '', 'a corrupt value shows as empty rather than as "NaN"');
// The round trip a coach performs every time they open the screen.
eq(rateValue(rateText(37.5)), 37.5, 'store → box → store does not drift');

/* ── the pay estimate ─────────────────────────────────────────────────────── */

eq(payEstimate(25, 8), 200, 'rate times heads through the door');
eq(payEstimate(37.5, 3), 113, 'the estimate is rounded to a whole unit');
eq(payEstimate(25, 0), 0, 'a class nobody came to really is zero, and may be said');
// The line the screen used to print over an unread roster.
eq(payEstimate(25, null), null,
  'no check-in count means NO estimate — "25 × 0 = 0" is a payout for a class nobody looked at');
eq(payEstimate(null, 8), null, 'no rate means no estimate either');
eq(payEstimate(null, null), null, 'neither half known is certainly no estimate');
eq(payEstimate(Number.NaN, 8), null, 'a NaN rate produces nothing rather than "NaN"');

/* ── goals ────────────────────────────────────────────────────────────────── */

eq(parseGoal('4000'), 4000, 'a typed target is that number');
eq(parseGoal(''), 0, 'an empty target box is no target');
eq(parseGoal('abc'), 0, 'so is a word');
eq(parseGoal('40.5'), 0, 'a fractional client target is not a target');
eq(parseGoal('-12'), 0, 'a negative target is not a target — parseInt would have said -12');
eq(parseGoal('12abc'), 0, 'a typo is not a target — parseInt would have said 12');
eq(parseGoal('0'), 0, 'zero is how "no target" is stored');
eq(parseGoal('1'), 1, 'a target of one client is a target');
// Twenty digits is past Number.MAX_SAFE_INTEGER: the last digits are gone by
// the time it is a float, so it is not the number that was typed.
eq(parseGoal('99999999999999999999'), 0, 'a target too large to represent exactly is refused, not rounded');

eq(goalText(4000), '4000', 'a set target fills its box');
eq(goalText(1), '1', 'a target of one is set, and shows');
eq(goalText(0), '', 'an unset target is an EMPTY box — String(0) would read as a target of nothing');

eq(goalPct(2000, 4000), 0.5, 'halfway is a half');
eq(goalPct(4000, 4000), 1, 'reaching it is one');
eq(goalPct(9000, 4000), 1, 'beating it is clamped to one — the bar cannot overflow its track');
eq(goalPct(-5, 4000), 0, 'a negative figure is clamped to zero rather than drawn backwards');
eq(goalPct(2000, 0), 0, 'no target is no progress — never a division by zero');
eq(goalPct(1, 1), 1, 'a target of one is a real target and is divided by');

/* ── the two sentences that must not be the same ──────────────────────────── */

// A read that failed and a coach with no targets both arrive as {0, 0}.
const errLine = goalsEmptyLine('error', 0, 0);
const readyLine = goalsEmptyLine('ready', 0, 0);
const loadingLine = goalsEmptyLine('loading', 0, 0);
ok(typeof errLine === 'string' && typeof readyLine === 'string', 'both states say something');
ok(errLine !== readyLine,
  'a failed read must NOT say "No targets set" — that is the app telling a coach something false about themselves');
ok(loadingLine !== readyLine, 'and a read still in flight is a third thing again');
ok(!/no targets set/i.test(String(errLine)),
  'the error sentence does not claim there are no targets');
ok(/could not be read/i.test(String(errLine)),
  'it says the read failed, which is the only thing that is known');
ok(/no targets set/i.test(String(readyLine)),
  'and a genuine empty under ready does say so plainly');
// With a target set there is nothing to explain — the bars speak.
eq(goalsEmptyLine('ready', 4000, 0), null, 'a revenue target set means no empty-state line');
eq(goalsEmptyLine('ready', 0, 12), null, 'a client target set means the same');
eq(goalsEmptyLine('ready', 1, 0), null, 'a revenue target of one is still a target set');
eq(goalsEmptyLine('ready', 0, 1), null, 'and so is a single-client target');
eq(goalsEmptyLine('error', 4000, 0), null,
  'a target that DID come back is drawn, and the empty-state line stays out of its way');

// Same rule for the rate box.
const rateErr = rateFieldNote('error');
eq(rateFieldNote('ready'), null, 'a clean read needs no explanation under the box');
ok(typeof rateErr === 'string' && /could not be read/i.test(rateErr),
  'an empty box after a failed read says why it is empty');
ok(rateFieldNote('loading') !== rateErr, 'still reading is not the same as could not read');
for (const s of ['loading', 'error'] as LoadStatus[]) {
  ok(rateFieldNote(s) !== null, `${s} gets a sentence rather than a bare empty box`);
}

if (errors.length) {
  console.error(`coachPrefs.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('coachPrefs.test.ts — all assertions passed.');
