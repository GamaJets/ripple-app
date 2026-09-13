// Tests for nightlyPasses — what a coach may be told about five jobs that run
// while they are asleep.
//
// The assertion that matters is the one about SILENCE. Five quiet lines is the
// shape of a good week and also the shape of the day and night in September
// when all five passes raised on every run and nobody found out for twenty-four
// hours. A screen that lets those two read the same is the defect; these tests
// hold the sentence that keeps them apart, and the rule that a count over a
// truncated read is a floor rather than a total.
//
// Compile with tsc then run with node, like bulkActions.test.ts.
import {
  NIGHTLY_PASSES, passOf, tallyPasses, passCountLine, handedLine,
  SILENCE_IS_NOT_PROOF, HANDED_NOT_ARRIVED, PASSES_WINDOW_DAYS,
  type PassNotice,
} from './nightlyPasses';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const notice = (title: string, at: string, pushedAt: string | null = null): PassNotice =>
  ({ id: `${title}-${at}`, title, at, pushedAt });

/* ── the catalogue matches the titles the passes actually write ───────────── */

eq(NIGHTLY_PASSES.length, 5, 'five passes, matching the five cron jobs part 2560 names');
for (const p of NIGHTLY_PASSES) {
  ok(p.titles.length > 0, `${p.key} names at least one notification title, or it can never match a row`);
  ok(p.what.trim().length > 0, `${p.key} says what it looks for — a pass named and not explained is furniture`);
  for (const title of p.titles) {
    eq(passOf(title), p.key, `"${title}" is classified as ${p.key}`);
  }
}
{
  const packs = NIGHTLY_PASSES.find((p) => p.key === 'packs');
  ok(!!packs && !!packs.alsoDoes && /bookable/i.test(packs.alsoDoes),
    'PACK EXPIRY IS NOT ONLY A NOTICE — it closes expired packs, and a night it does not run leaves paid-for sessions bookable that nobody is entitled to');
  eq(NIGHTLY_PASSES.filter((p) => p.alsoDoes).length, 1,
    'and it is the only one that claims to change anything, because it is the only one that does');
}

/* ── rows that are not these passes are not counted as them ───────────────── */

eq(passOf('A new message from your coach'), null, 'a chat notification belongs to no pass');
eq(passOf(''), null, 'an empty title is not a match');
eq(passOf(null), null, 'and neither is a missing one');
eq(passOf('a client is past their usual gap'), null,
  'matching is exact — a near-miss is left uncounted rather than guessed at, so the screen under-reports rather than reassuring');

/* ── the tally: every pass appears, especially the empty ones ─────────────── */

{
  const t = tallyPasses([]);
  eq(t.length, 5, 'EVERY PASS HAS A ROW even with nothing to show — a pass that has failed on every run since Tuesday appears as an absence, and an absence that is not drawn cannot be read');
  ok(t.every((x) => x.seen === 0 && x.latestAt === null && x.handed === 0), 'and all of them read as nothing');
}
{
  const rows = [
    notice('A client is past their usual gap', '2026-09-10T07:12:00Z', '2026-09-10T07:12:04Z'),
    notice('A client is past their usual gap', '2026-09-12T07:12:00Z'),
    notice('An invoice is still unpaid', '2026-09-11T07:40:00Z', '2026-09-11T07:40:02Z'),
    notice('A new message from your coach', '2026-09-12T09:00:00Z', '2026-09-12T09:00:01Z'),
  ];
  const by = new Map(tallyPasses(rows).map((x) => [x.key, x]));
  eq(by.get('overdue-clients')?.seen, 2, 'two overdue notices are counted as two');
  eq(by.get('overdue-clients')?.latestAt, '2026-09-12T07:12:00Z', 'and the newest of them is the latest');
  eq(by.get('overdue-clients')?.handed, 1, 'only the one with a pushed_at is counted as handed to the sender');
  eq(by.get('invoices')?.seen, 1, 'the invoice notice lands under invoices');
  eq(by.get('credentials')?.seen, 0, 'and a pass with nothing stays at nothing rather than borrowing from its neighbours');
  eq(tallyPasses(rows).reduce((n, x) => n + x.seen, 0), 3,
    'the chat notification is not counted as a pass, so the totals are over the passes and nothing else');
}

/* ── a count under a truncated read is a floor ────────────────────────────── */

{
  const t = tallyPasses([notice('A block has run out', '2026-09-11T07:26:00Z')])[2];
  eq(t.key, 'blocks', 'catalogue order is stable, which is what makes this screen readable twice');
  ok(/at least/i.test(passCountLine(t, false)),
    'A TRUNCATED READ SAYS "AT LEAST" — printing a subtotal in the shape of a total is the most repeated defect in this codebase and has a gate of its own');
  ok(!/at least/i.test(passCountLine(t, true)), 'a whole read states the count plainly');
}
{
  const empty = tallyPasses([])[0];
  const short = passCountLine(empty, false);
  ok(/not the same as nothing/i.test(short),
    'NOTHING UNDER A FAILED OR SHORT READ IS UNKNOWN, not "the pass found nothing" — an empty list under a read that did not come back whole asserts something it does not know');
  const whole = passCountLine(empty, true);
  ok(/[Nn]othing written/.test(whole),
    'and under a whole read it says what it actually knows: nothing was written to the inbox');
  ok(!/ran|no problems|all clear/i.test(whole),
    'and never that the pass ran, which this app cannot see');
}

/* ── handed to a sender is not arrived ────────────────────────────────────── */

{
  const t = tallyPasses([
    notice('A session pack has run out of time', '2026-09-11T07:33:00Z', '2026-09-11T07:33:01Z'),
    notice('A session pack has run out of time', '2026-09-12T07:33:00Z'),
  ]).find((x) => x.key === 'packs');
  const line = t ? handedLine(t) : null;
  ok(!!line && line.includes('1'), 'one of the two went to the sender and the line says one');
  ok(!!line && !/\bdelivered\b|\barrived\b|\breceived\b/i.test(line),
    'and never says delivered, arrived or received — the post to send-push is the last event this product observes');
  eq(handedLine(tallyPasses([])[0]), null, 'nothing dispatched is nothing to say, not a zero');
}

/* ── the two standing sentences ───────────────────────────────────────────── */

ok(/not that the check ran|cannot show you that these ran/i.test(SILENCE_IS_NOT_PROOF),
  'THE SILENCE SENTENCE REFUSES THE INFERENCE a coach would otherwise make from five quiet lines');
ok(/failed on every run|whole day/i.test(SILENCE_IS_NOT_PROOF),
  'and it cites the outage rather than describing the risk in the abstract, because the abstract version does not change what anybody does');
ok(/folded into a single banner|one banner is not one notice/i.test(HANDED_NOT_ARRIVED),
  'the push sentence names the digest — four rows can go out as one line saying "and 3 more", so a banner count is not a notice count');
eq(PASSES_WINDOW_DAYS, 7, 'a week — these run nightly, and a coach is asking about last night and the few before it');

if (errors.length) {
  console.error(`nightlyPasses.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('nightlyPasses.test.ts — ok');
