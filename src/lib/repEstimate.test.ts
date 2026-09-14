// The rep box that fed the 1RM hero, and where Epley stops being an estimator.
//
// The assertions here are in two families.
//
// The first pins the REFUSALS that did not exist. `parseInt(r, 10) || 0` gave a
// figure for a negative rep count, a decimal one, and a rep count of 999 — the
// last of which printed a 3,430 kg one-rep max as the screen's hero, in the
// member's own unit, under the words "Estimated 1RM". Each is refused here with
// a sentence, because a refusal a member can act on beats a wrong number.
//
// The second pins that the caveat and the refusal are DIFFERENT answers. A set
// of fifteen is a real set and the member gets their figure with a warning; a
// set of thirty-one is not an input to this formula at all. Collapsing the two
// either withholds a number somebody legitimately wants or prints one nobody
// should act on.
import { readReps, epleyCaveat, EPLEY_CLEAN_REPS, EPLEY_MAX_REPS } from './repEstimate';

let failures = 0;
function ok(cond: boolean, what: string) {
  if (!cond) { failures++; console.error('FAIL:', what); } else { console.log('ok  -', what); }
}
const eq = (a: unknown, b: unknown, what: string) =>
  ok(Object.is(a, b), `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

// ── reading the box ────────────────────────────────────────────────────────

{
  const r = readReps('5');
  ok(r.ok, '5 reps is accepted');
  eq(r.ok ? r.reps : null, 5, '5 reads as 5');
}
{
  const r = readReps('');
  ok(r.ok, 'an empty box is not a refusal');
  eq(r.ok ? r.reps : 'x', null, 'an empty box is null, never zero');
  ok(readReps(null).ok && readReps(undefined).ok && readReps('  ').ok, 'null, undefined and whitespace are empty boxes');
}
{
  // The old reader gave 83 kg from 100 kg and this.
  const r = readReps('-5');
  ok(!r.ok, 'a negative rep count is refused');
}
{
  // `kg && reps` treated a deliberate 0 as "nothing typed", so it and an empty
  // box said the same thing and neither said it was wrong.
  const r = readReps('0');
  ok(!r.ok, 'zero reps is refused, and is not the same answer as an empty box');
  ok(!readReps('0').ok && readReps('').ok, 'zero and empty are different answers');
}
{
  const r = readReps('5.5');
  ok(!r.ok, 'a decimal rep count is refused rather than silently truncated');
  ok(!r.ok && r.reason.toLowerCase().includes('whole'), 'the refusal says reps are whole numbers');
}
{
  ok(!readReps('abc').ok, 'a word is refused rather than becoming 0');
}
{
  // The case the screen printed a 3,430 kg hero from.
  const r = readReps('999');
  ok(!r.ok, '999 reps is refused');
  ok(!r.ok && r.reason.includes(String(EPLEY_MAX_REPS)), 'the refusal names the ceiling it is refusing against');
}
{
  ok(readReps(String(EPLEY_MAX_REPS)).ok, 'the maximum itself is accepted');
  ok(!readReps(String(EPLEY_MAX_REPS + 1)).ok, 'one past the maximum is refused');
  ok(readReps('1').ok, 'a single rep is a set');
}

// ── the caveat, which is a different answer from a refusal ────────────────

{
  eq(epleyCaveat(5), null, 'nothing is said about a set of five');
  eq(epleyCaveat(EPLEY_CLEAN_REPS), null, 'nothing is said at the last clean rep');
  eq(epleyCaveat(null), null, 'nothing is said when no rep count was given');
  eq(epleyCaveat(undefined), null, 'nothing is said for undefined');
}
{
  const c = epleyCaveat(EPLEY_CLEAN_REPS + 1);
  ok(c != null, 'something is said one past the last clean rep');
  ok(c != null && c.includes('ceiling'), 'the caveat says the figure is a ceiling');
  ok(c != null && c.includes(String(EPLEY_CLEAN_REPS + 1)), 'the caveat names the rep count it is about');
}
{
  // The boundary that matters most: 15 is answered WITH a caveat, 31 is not
  // answered at all. A caveat is not a refusal and must not stand in for one.
  const fifteen = readReps('15');
  ok(fifteen.ok, 'fifteen reps still gets an answer');
  ok(epleyCaveat(15) != null, 'and gets the caveat with it');
  ok(!readReps('31').ok, 'thirty-one reps gets no answer at all');
}

console.log(failures === 0 ? '\nrepEstimate: all assertions passed' : `\nrepEstimate: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
