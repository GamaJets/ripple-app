// The one honest conversion figure, and the six refusals. Compile with tsc, run
// with node.
//
// The failures this asserts against are all the same failure wearing different
// clothes: a number that looks like a verdict on a coach's marketing, computed
// over a set the app does not have.
//
//   · a figure printed over a read that was not whole. The denominator is a
//     prefix of the real one and the numerator is a prefix of a different
//     prefix. It is not a worse estimate; it is not an estimate.
//   · a ZERO where the question was never asked. On a database without part
//     211's columns every `joined` is null, and a build that counts an unasked
//     question as a "no" tells every coach on an older schema that none of
//     their enquiries ever became a client.
//   · a numerator without its denominator in the same sentence. The denominator
//     is the entire content of this figure, and a number that can be quoted
//     without it will be.
//   · a percentage. Asserted against by name, because it is the single thing
//     somebody will add to this module and it is the reason the module exists.
import {
  CONVERSION_TITLE, CONVERSION_DENOMINATOR_NOTE, CONVERSION_NUMERATOR_NOTE,
  WITHHELD_CONVERSIONS, conversionFigureLine, enquiryConversion,
} from './leadConversion';
import type { LeadRow, LeadState } from './leads';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

function lead(p: Partial<LeadRow> & { id: string }): LeadRow {
  return {
    name: 'Dev Patel', contact: 'dev@example.com', contactKind: 'email', note: null,
    viaCode: 'FLYER7', campaign: 'Gym flyer', at: '2026-09-01T09:00:00.000Z',
    state: 'new' as LeadState, joined: false, joinedAt: null,
    ...p,
  };
}

/** n enquiries, of which `matched` carry part 204's match. */
function book(total: number, matched: number): LeadRow[] {
  return Array.from({ length: total }, (_, i) =>
    lead({ id: `lead-${i}`, joined: i < matched }));
}

/* ── 1. the figure, and its denominator ───────────────────────────────────*/

{
  const read = enquiryConversion(book(18, 3), 'ready');
  eq(read.kind, 'figure', 'a whole read of real enquiries produces the figure');
  if (read.kind === 'figure') {
    eq(read.matched, 3, 'the numerator is the matched joins');
    eq(read.checked, 18, 'the denominator is the enquiries that could be checked');
  }
  const line = conversionFigureLine(read);
  ok(line.includes('3 of the 18'), 'and both numbers are in the same sentence');
  ok(line.includes('join link'), 'which names the route, because that route is the denominator');
  ok(line.includes('the email address and the code'),
    'and names what a match IS — an exact match on two columns, not an inference');
}

{
  // Singular and plural, because "1 of the 1 enquiries" is the sort of thing a
  // coach reads as a screen that is not paying attention.
  const line = conversionFigureLine(enquiryConversion(book(1, 1), 'ready'));
  ok(line.includes('1 of the 1 enquiry'), 'one enquiry is an enquiry');
  ok(line.includes('has an account'), 'and one of them has, not have');
}

{
  // The honest zero: the read was whole, the columns were there, and none
  // matched. It is allowed, and it is still shown with its denominator.
  const line = conversionFigureLine(enquiryConversion(book(9, 0), 'ready'));
  ok(line.includes('0 of the 9'), 'a genuine zero over a known denominator is a fact and is printed');
}

/* ── 2. never over a read that was not whole ──────────────────────────────*/

{
  for (const s of ['loading', 'partial', 'error'] as const) {
    const read = enquiryConversion(book(18, 3), s);
    eq(read.kind, 'withheld', `no figure over a ${s} read — isWhole, not "did not fail"`);
  }
  const partial = enquiryConversion(book(18, 3), 'partial');
  if (partial.kind === 'withheld') {
    ok(partial.why.includes('unknown fraction'),
      'and the truncated read says what is wrong with the figure it is not showing');
  }
  const failed = enquiryConversion(book(18, 3), 'error');
  if (failed.kind === 'withheld') {
    ok(failed.why.includes('not a zero'),
      'a failed read says outright that this is not a zero — that is the sentence the whole house rule is for');
  }
}

/* ── 3. the unasked question is never a no ────────────────────────────────*/

{
  // A build talking to a database without part 211's columns. `shapeLeads`
  // gives every row `joined: null`, and the wrong answer here is "0 of 12".
  const older = Array.from({ length: 12 }, (_, i) => lead({ id: `l-${i}`, joined: null }));
  const read = enquiryConversion(older, 'ready');
  eq(read.kind, 'withheld', 'a database that cannot answer the question produces no figure');
  if (read.kind === 'withheld') {
    ok(!read.why.includes('0'), 'and does not mention a zero it has not measured');
    ok(read.why.includes('listed above'),
      'and says the enquiries themselves are fine, so a coach does not read this as a broken list');
  }
}

{
  // A mixed book cannot happen through `shapeLeads` today — the columns are
  // there or they are not — but the denominator is defined as the rows that
  // could be CHECKED, and that definition is what keeps it honest if it ever
  // can. An unanswerable row must not be in the bottom of the fraction.
  const mixed = [
    lead({ id: 'a', joined: true }),
    lead({ id: 'b', joined: false }),
    lead({ id: 'c', joined: null }),
  ];
  const read = enquiryConversion(mixed, 'ready');
  if (read.kind === 'figure') {
    eq(read.checked, 2, 'a row the question was never put to is not part of the denominator');
    eq(read.matched, 1, 'nor does it change the numerator');
  } else {
    errors.push('a book with two checkable rows should produce a figure');
  }
}

{
  const read = enquiryConversion([], 'ready');
  eq(read.kind, 'withheld', 'no enquiries is no denominator, and no denominator is no figure');
  if (read.kind === 'withheld') {
    ok(read.why.includes('nothing to count it against'),
      'and it says that it is the denominator that is missing, not the result that is zero');
  }
}

/* ── 4. the two sentences that make the figure a figure ───────────────────*/

{
  ok(CONVERSION_DENOMINATOR_NOTE.includes('not everybody who asked about you'),
    'the denominator note says the one thing the house rule requires: what the bottom number is NOT');
  ok(CONVERSION_DENOMINATOR_NOTE.includes('gym floor'),
    'and names the enquiries the app cannot see, rather than gesturing at them');
  ok(CONVERSION_NUMERATOR_NOTE.includes('floor, not a total'),
    'the numerator note says the top number is a floor');
  ok(CONVERSION_NUMERATOR_NOTE.includes('different code'),
    'and names how a real client goes missing from it');
}

/* ── 5. the refusals, which are half the item ─────────────────────────────*/

{
  ok(WITHHELD_CONVERSIONS.length >= 6, 'every figure somebody would build is named');
  for (const w of WITHHELD_CONVERSIONS) {
    ok(w.figure.length > 0 && w.why.length > 0, `${w.figure} has both halves`);
    ok(w.why.trim().endsWith('.'), `${w.figure} — the reason is a sentence, not a fragment`);
  }
  const figures = WITHHELD_CONVERSIONS.map((w) => w.figure.toLowerCase()).join(' | ');
  ok(figures.includes('percentage'), 'the percentage is refused by name');
  ok(figures.includes('did not convert'), 'so is the complement, which is unknown and not lost');
  ok(figures.includes('this month'), 'so is the windowed rate, whose denominator closes before its numerator does');
  ok(figures.includes('join code'), 'so is the one taken off a count that is itself sound');
  const whys = WITHHELD_CONVERSIONS.map((w) => w.why).join(' ');
  ok(whys.includes('no view, no click and no open'),
    'and the click-through refusal names the three things that are not recorded anywhere');
}

/* ── 6. the words the screen is not allowed to use ────────────────────────*/

{
  const everything = [
    CONVERSION_TITLE, CONVERSION_DENOMINATOR_NOTE, CONVERSION_NUMERATOR_NOTE,
    conversionFigureLine(enquiryConversion(book(18, 3), 'ready')),
  ].join(' ');
  ok(!everything.includes('%'), 'no percent sign anywhere near the figure');
  ok(!/\brate\b/i.test(everything),
    'and the word "rate" appears on none of it — a ratio with a stated denominator is not a rate');
  eq(CONVERSION_TITLE, 'Enquiries That Became Clients',
    'the title says what is counted, in the Title Case its siblings on that screen are in');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'LEAD CONVERSION FAILURES:\n' + errors.join('\n') : 'leadConversion: ok — one figure, always with its denominator, never over half a read, and six refusals stated out loud');
if (errors.length) process.exit(1);
