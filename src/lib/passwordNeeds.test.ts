// The spoken password summary, pinned. Compile with tsc, run with node.
//
// Three of these assertions are worth more than the rest.
//
// The first is the symbol rule. It is the only label in `passwordRules()` that
// carries a legend, it is the reason this module exists, and it is the one that
// cannot be checked by looking at a screen — the parenthesis renders correctly
// and is nine words of punctuation out loud.
//
// The second is the EMPTY list. An empty rule set is not a satisfied one, and
// the difference between those two sentences is the difference between "you are
// done" and "we cannot tell you". Nothing in the app can produce an empty list
// today, which is exactly why it needs a test rather than a comment.
//
// The third is that a mid-sentence parenthesis survives. The strip is by shape,
// so the shape has to have an edge, and this is where it is.
import {
  NEEDS_UNKNOWN, NOTHING_FURTHER, forTheEar, joinAnd, passwordNeedsSpoken,
  type SpokenRule,
} from './passwordNeeds';
import { passwordRules } from './passwordRules';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── forTheEar: the legend comes off, and only the legend ───────────────── */

eq(forTheEar('a symbol (! ? @ # $ … )'), 'a symbol',
  'the trailing legend is dropped for the ear');
eq(forTheEar('8 characters or more'), '8 characters or more',
  'a label with no legend is untouched');
eq(forTheEar('an uppercase letter'), 'an uppercase letter',
  'and so is a plain one');

// The edge of the shape. A parenthesis that is part of the sentence is not a
// legend appended to it, and removing it would change what the rule says.
eq(forTheEar('a letter (not a digit) somewhere'), 'a letter (not a digit) somewhere',
  'a mid-sentence parenthesis is part of the label and stays');
// An unclosed bracket is not a legend. Guessing at a malformed label is how a
// requirement quietly loses a word.
eq(forTheEar('a symbol (! ? @'), 'a symbol (! ? @',
  'an unclosed parenthesis is left exactly as written');
// Nested brackets are not matched by [^()]*, deliberately — the same argument.
eq(forTheEar('a symbol (see (this))'), 'a symbol (see (this))',
  'a nested parenthetical is left alone rather than half-stripped');
// If the parenthesis IS the label there is nothing else to say, so it is said.
eq(forTheEar('(! ? @ #)'), '(! ? @ #)',
  'a label that is nothing but a legend is spoken rather than swallowed');
eq(forTheEar('  a number  '), 'a number', 'surrounding space is trimmed');

/* ── joinAnd: a list a person can hear the end of ───────────────────────── */

eq(joinAnd([]), '', 'nothing joins to nothing');
eq(joinAnd(['a number']), 'a number', 'one item is itself, with no "and"');
eq(joinAnd(['a number', 'a symbol']), 'a number and a symbol',
  'two items take "and" and no comma');
eq(joinAnd(['8 characters or more', 'a number', 'a symbol']),
  '8 characters or more, a number and a symbol',
  'three items take commas and a final "and"');
// Blanks are dropped rather than producing ", and" or a leading comma.
eq(joinAnd(['a number', '', '  ', 'a symbol']), 'a number and a symbol',
  'blank entries do not become empty slots in the list');
eq(joinAnd(['', '']), '', 'a list of blanks is an empty list');

/* ── the summary ───────────────────────────────────────────────────────── */

const rule = (label: string, met: boolean): SpokenRule => ({ label, met });

eq(passwordNeedsSpoken([rule('a number', false), rule('a symbol', false)]),
  'Password needs a number and a symbol',
  'unmet rules are listed');
eq(passwordNeedsSpoken([rule('a number', true), rule('a symbol', false)]),
  'Password needs a symbol',
  'met rules are not listed — the reader is told what is still missing');
eq(passwordNeedsSpoken([rule('a number', true), rule('a symbol', true)]),
  NOTHING_FURTHER,
  'every rule met reads as nothing further');

// THE one that cannot be seen on a screen.
eq(passwordNeedsSpoken([rule('a symbol (! ? @ # $ … )', false)]),
  'Password needs a symbol',
  'the symbol legend never reaches the ear');

/* ── an absence is not a clearance ──────────────────────────────────────── */

eq(passwordNeedsSpoken([]), NEEDS_UNKNOWN,
  'no rules is a named unknown, NOT "nothing further"');
eq(passwordNeedsSpoken(null), NEEDS_UNKNOWN, 'null is a named unknown too');
eq(passwordNeedsSpoken(undefined), NEEDS_UNKNOWN, 'and so is undefined');
ok(NEEDS_UNKNOWN !== NOTHING_FURTHER,
  'the two sentences are different, which is the whole point of having both');
ok(!/nothing further/i.test(NEEDS_UNKNOWN),
  'the unknown sentence must not read as a clearance');

/* ── against the real rules, so the two cannot drift apart ──────────────── */

// An empty password meets none of them, so all five are announced — and the
// announcement must contain no bracket at all.
const emptySaid = passwordNeedsSpoken(passwordRules(''));
ok(!emptySaid.includes('('), `no legend survives into the real summary — got "${emptySaid}"`);
ok(emptySaid.includes(' and '), 'the real summary ends with "and", not a bare comma');
eq(emptySaid.split(',').length, passwordRules('').length - 1,
  'five rules are announced as four commas and an "and"');

// A password that satisfies every local rule reads as complete.
eq(passwordNeedsSpoken(passwordRules('Abcdef1!')), NOTHING_FURTHER,
  'a locally-valid password needs nothing further');

// And one that is only short names exactly the one thing wrong with it.
eq(passwordNeedsSpoken(passwordRules('Abc1!')), 'Password needs 8 characters or more',
  'a short but otherwise complete password names only its length');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`passwordNeeds: ok (${passwordRules('').length} real rules walked, legend stripped)`);
