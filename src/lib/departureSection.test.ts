// The merge, asserted as "nothing true was dropped". Compile with tsc, run with
// node.
//
// ── The rule this suite is written to ─────────────────────────────────────
//
// Two sections were collapsed into one, and the only interesting way for that
// to be wrong is quietly: a branch of the sentence that no longer says how
// many, or no longer says over what period, or that drops the deadline that is
// the whole reason a coach acts today rather than in March. So every branch is
// checked for the SAME set of claims rather than compared against a copy of the
// string — a test that pinned the wording would pass a rewrite that lost half
// of it, as long as somebody updated the test with it.
//
// The one thing pinned by wording is the distinction between nothing recorded
// and "they did not say", because that distinction IS a wording.
import { departureSectionNote } from './departureSection';
import { departureTally, type EndedRelationship } from './endCoaching';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ended = (reason: unknown): EndedRelationship => ({ reason, endedAt: '2026-07-01T09:00:00Z' });
const WINDOW = 90;

/** The claims that must survive, whichever branch the sentence takes. */
const saysHowMany = (s: string, n: number) => s.includes(String(n));
const saysThePeriod = (s: string) => s.includes(`${WINDOW} days`);
const saysWhatItIsWorth = (s: string) => /cheapest thing you will ever learn/.test(s);
const saysWhyNow = (s: string) => /in March/.test(s);

/* ── nothing to say ───────────────────────────────────────────────────────── */
//
// An unread book is not a coach nobody has left. This is the sentence that must
// NOT appear over a failed read, and null is how the section knows not to draw.

eq(departureSectionNote(null, WINDOW), null,
  'an unread book says nothing at all, rather than "nobody has left you"');
eq(departureSectionNote(departureTally([]), WINDOW), null,
  'and an empty window says nothing either — "0 people have left" reads as a compliment');

/* ── nothing recorded at all ──────────────────────────────────────────────── */
//
// The branch that produced the duplicate: this is exactly the state the coach
// on the simulator was in, and it had two paragraphs saying it.
{
  const s = departureSectionNote(departureTally([ended(null)]), WINDOW);
  ok(s != null, 'one unexplained ending has something to say');
  const line = s ?? '';
  ok(saysHowMany(line, 1), `it says how many — ${JSON.stringify(line)}`);
  ok(saysThePeriod(line), `it says over what period — ${JSON.stringify(line)}`);
  ok(saysWhatItIsWorth(line), `it says what the answer is worth — ${JSON.stringify(line)}`);
  ok(saysWhyNow(line), `it says why today rather than later — ${JSON.stringify(line)}`);
  ok(/person has/.test(line), 'one person is a person, not "1 people"');

  // And it says it ONCE. The defect being fixed is a screen that made the same
  // claim twice in two voices, so the merged sentence may not do it either.
  eq(line.split('cheapest').length - 1, 1, 'the value of the answer is stated once');
  eq(line.split('in March').length - 1, 1, 'and so is the deadline');
}

{
  const s = departureSectionNote(departureTally([ended(null), ended(null), ended('nonsense')]), WINDOW) ?? '';
  ok(saysHowMany(s, 3), `three endings, none of them readable as a reason — ${JSON.stringify(s)}`);
  ok(/people have/.test(s), 'more than one person is people');
  ok(saysWhatItIsWorth(s) && saysWhyNow(s), 'and the same two claims survive at three');
  // A reason this build does not recognise is unrecorded, not a tenth category.
  // It must not appear as a counted reason, which would put a made-up label on
  // the coach's screen.
  ok(!/nonsense/.test(s), 'an unreadable reason is never printed as a reason');
}

/* ── every ending explained ───────────────────────────────────────────────── */
//
// Nothing left to ask, so no deadline applies — and inventing urgency over a
// complete record is the sort of nagging that gets a card ignored when it
// matters.
{
  const s = departureSectionNote(departureTally([ended('cost'), ended('cost'), ended('moved')]), WINDOW) ?? '';
  ok(saysHowMany(s, 3), `it still says how many — ${JSON.stringify(s)}`);
  ok(saysThePeriod(s), 'and over what period');
  ok(!saysWhyNow(s), `a complete record carries no deadline — ${JSON.stringify(s)}`);
  ok(!saysWhatItIsWorth(s), 'and no prompt to go and get what is already got');
  ok(/commonest reason recorded is the cost/i.test(s), 'the commonest reason is named');
}

/* ── some explained, some not ─────────────────────────────────────────────── */
//
// The branch nobody looked at, because the coach on the simulator was not in
// it. Both merged sections had something true to say here and the sentence has
// to carry all of it.
{
  const s = departureSectionNote(
    departureTally([ended('cost'), ended('cost'), ended(null), ended(null), ended(null)]), WINDOW,
  ) ?? '';
  ok(saysHowMany(s, 5), `the total is the whole window, not just the explained ones — ${JSON.stringify(s)}`);
  ok(saysThePeriod(s), 'over the stated period');
  ok(/3 have nothing recorded at all/.test(s), `the unexplained are counted separately — ${JSON.stringify(s)}`);
  ok(/not the same as/.test(s), 'and are distinguished from a client who declined to say');
  ok(saysWhatItIsWorth(s), 'the reason to bother survives into this branch too');
  ok(saysWhyNow(s), 'and so does the deadline');
  eq(s.split('in March').length - 1, 1, 'once each, still');
  eq(s.split('cheapest').length - 1, 1, 'once each, still');
}

/* ── the singular, in the branch that has two numbers in it ───────────────── */
{
  const s = departureSectionNote(departureTally([ended('cost'), ended(null)]), WINDOW) ?? '';
  ok(/1 has nothing recorded at all/.test(s), `one unexplained ending is "has", not "have" — ${JSON.stringify(s)}`);
}

/* ── the window is the caller's, and it is always stated ──────────────────── */
//
// Two sections said "the last three months" and "the last 90 days" about the
// same period. One caller now owns the number, and the sentence must print
// whatever it is given rather than a figure of its own.
{
  const rows = [ended(null)];
  ok((departureSectionNote(departureTally(rows), 30) ?? '').includes('30 days'),
    'a thirty-day window says thirty days');
  ok((departureSectionNote(departureTally(rows), 365) ?? '').includes('365 days'),
    'and a year says a year — nothing here has a window baked into it');
}

/* ── zone independence ────────────────────────────────────────────────────── */
//
// Nothing here constructs a Date and nothing reads `endedAt`, so this file
// means the same thing in Kiritimati and in Midway — which is what
// `npm run test:zones` proves by running it in both.
{
  const a = departureSectionNote(departureTally([{ reason: null, endedAt: null }]), WINDOW);
  const b = departureSectionNote(departureTally([{ reason: null, endedAt: '2026-01-01T00:00:00Z' }]), WINDOW);
  eq(a, b, 'an ending with no readable date is counted the same as one with a date, in every zone');
}

if (errors.length) {
  console.error(`departureSection.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('departureSection.test: ok');
