// A missing currency says which of four things happened. Compile with tsc, run
// with node.
//
// The bug these guard: a refused read and an unset setting both arrive as a
// null currency, and both screens printed "your gym has not set a currency" for
// either — sending a coach to chase their gym owner over a query that failed.
import { currencyGapLine, currencyGapOf, currencyGapOfStatus } from './currencyGap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a currency that IS available has no gap ───────────────────────────── */

eq(currencyGapOf({ currency: 'AED', error: null, loading: false }), null, 'a read currency has nothing to explain');
eq(currencyGapOf({ currency: 'GBP', error: 'something went wrong', loading: false }), null,
  'a currency we have is a currency we have, whatever else failed');
eq(currencyGapOfStatus({ currency: 'AED', status: 'ready' }), null, 'same from the status-carrying provider');
eq(currencyGapOfStatus({ currency: 'AED', status: 'partial' }), null, 'a code from a partial read is still a code');

/* ── the four causes, kept apart ───────────────────────────────────────── */

eq(currencyGapOf({ currency: null, error: null, loading: true }), 'reading', 'in flight is not an answer');
eq(currencyGapOf({ currency: null, error: null, loading: false }), 'unset', 'read, and nobody has set one');

// THE bug. `myTenantCurrency` returns `{ currency: null, error }` on a refused
// profiles or tenants read, and the caller that looks at the currency first
// cannot tell this from the line above it.
eq(currencyGapOf({ currency: null, error: 'permission denied for table profiles', loading: false }), 'unreadable',
  'a refused read is unreadable, never unset');
eq(currencyGapOf({ currency: null, error: 'Not signed in.', loading: false }), 'unreadable',
  'no session is a read we could not make, not a gym with no currency');

eq(currencyGapOfStatus({ currency: null, status: 'loading' }), 'reading', 'loading is in flight');
eq(currencyGapOfStatus({ currency: null, status: 'error' }), 'unreadable', 'error is unknown');
// The half of the invoices bug that fell through: 'partial' means one of the
// two reads behind the currency failed, so an absent code is not established.
eq(currencyGapOfStatus({ currency: null, status: 'partial' }), 'incomplete', 'partial is not "none set"');
eq(currencyGapOfStatus({ currency: null, status: 'ready' }), 'unset', 'ready and empty is genuinely unset');

/* ── only one of the four sends the coach to their gym owner ───────────── */

const CONSEQUENCE = 'there is no unit to price these sessions in';
const lines = (['reading', 'unreadable', 'incomplete', 'unset'] as const)
  .map((g) => [g, currencyGapLine(g, CONSEQUENCE)] as const);

for (const [gap, line] of lines) {
  ok(line.includes(CONSEQUENCE), `${gap} states what is lost`);
  ok(line.trim().endsWith('.'), `${gap} is a finished sentence`);
  const blamesOwner = /gym settings/.test(line);
  eq(blamesOwner, gap === 'unset', `${gap} names the gym owner only when it is their setting`);
  const saysRetry = /try again/.test(line);
  eq(saysRetry, gap === 'unreadable' || gap === 'incomplete', `${gap} says to try again only when that would help`);
}

// The four are actually four. A refactor that collapsed two of them back onto
// one wording is the regression this whole file exists to catch.
eq(new Set(lines.map(([, l]) => l)).size, 4, 'the four causes read as four different sentences');

// The one sentence that must not be said about a read that failed.
for (const [gap, line] of lines) {
  eq(/has not set a currency/.test(line), gap === 'unset', `${gap} claims nobody set one only when that is known`);
}

/* ── the fragment is joined cleanly ────────────────────────────────────── */

// Callers write the clause the way it reads in place; a stray full stop from
// one of them must not produce "in.." in the middle of a sentence.
ok(!/\.\./.test(currencyGapLine('unset', 'this target cannot be shown as an amount.')),
  'a trailing stop on the fragment is absorbed, not doubled');
ok(currencyGapLine('unset', '  a new client cannot be priced  ').includes('so a new client cannot be priced.'),
  'surrounding whitespace is trimmed');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('currencyGap: ok');
