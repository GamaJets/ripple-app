// Tests for ownerPayPolicy — the pay policy as the owner is shown it.
//
// Four things are being pinned, and three of them are refusals:
//
//   · an unset policy is never rendered as "delivered only". The column is
//     nullable on purpose and a guess here is a guess about somebody's wages;
//   · a failed read and an account with no gym produce NO outcome lines at all,
//     so neither can be mistaken for four decisions the owner has made;
//   · an unmarked session is unpaid under every one of the four policies — the
//     one line that must not move when the code does;
//   · and the heading note is a fact about the gym or nothing: 'Not set' is
//     said, "we could not ask" is not.
//
// Compile with tsc, run with node.
import {
  payOutcomeLines, policyHeadNote, WHERE_THE_POLICY_IS_SET,
} from './ownerPayPolicy';
import { policyView } from './coachPayTerms';
import { PAY_POLICY_LABEL, PAY_POLICY_CODES } from './gymPolicy';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const READY: LoadStatus = 'ready';
/** The owner's gym, read whole — the only state that describes a policy. */
const seen = (stored: string | null) => policyView('gym', READY, stored);
const answerFor = (stored: string | null, outcome: string) =>
  payOutcomeLines(seen(stored)).find((l) => l.outcome === outcome)?.answer ?? null;

/* ── the silences, kept apart from the answers ────────────────────────────── */
{
  eq(payOutcomeLines(policyView('gym', 'error', 'no_shows')).length, 0,
    'a refused read describes no policy at all, whatever string came back with it');
  eq(payOutcomeLines(policyView('gym', 'loading', null)).length, 0,
    'and neither does one still in flight');
  eq(payOutcomeLines(policyView('gym', 'partial', null)).length, 0,
    'a truncated read is not a whole one — isWhole, not "did not fail"');
  eq(payOutcomeLines(policyView('none', READY, null)).length, 0,
    'an account with no gym has no coaches and no policy');

  eq(policyHeadNote(policyView('gym', 'error', 'no_shows')), null,
    'no heading note over a failed read: it would read as a fact about the gym');
  eq(policyHeadNote(policyView('none', READY, null)), null, 'and none for an account with no gym');
}

/* ── the null is not delivered_only ───────────────────────────────────────── */
{
  eq(policyHeadNote(seen(null)), 'Not set', 'an unset policy is said out loud — it is the thing to act on');
  eq(answerFor(null, 'No-show'), 'unstated', 'an unset gym has not decided a no-show is unpaid');
  eq(answerFor(null, 'Late cancellation'), 'unstated', 'nor a late cancellation');
  eq(answerFor('delivered_only', 'No-show'), 'unpaid',
    'a gym that HAS decided gets the flat answer, and the two are different states');

  eq(answerFor('something_a_later_build_wrote', 'No-show'), 'unstated',
    'a code this build does not know is unstated rather than read as one of the four');
  eq(policyHeadNote(seen('something_a_later_build_wrote')), 'Not set',
    'and the heading says so rather than printing the raw column');
}

/* ── each of the four, answered in both directions ────────────────────────── */
{
  eq(answerFor('no_shows', 'No-show'), 'paid', 'no_shows pays a no-show');
  eq(answerFor('no_shows', 'Late cancellation'), 'unpaid', 'and not a late cancellation');
  eq(answerFor('late_cancellations', 'No-show'), 'unpaid', 'late_cancellations does not pay a no-show');
  eq(answerFor('late_cancellations', 'Late cancellation'), 'paid', 'and does pay a late cancellation');
  eq(answerFor('no_shows_and_late_cancellations', 'No-show'), 'paid', 'both pays a no-show');
  eq(answerFor('no_shows_and_late_cancellations', 'Late cancellation'), 'paid', 'and a late cancellation');

  for (const code of PAY_POLICY_CODES) {
    eq(policyHeadNote(seen(code)), PAY_POLICY_LABEL[code], `${code} is headed with its own label`);
    const lines = payOutcomeLines(seen(code));
    eq(lines.length, 4, `${code} answers all four outcomes`);
    eq(lines.find((l) => l.outcome === 'Delivered')?.answer, 'paid',
      `${code} pays a delivered session — the line no policy can switch off`);
    // THE invariant. `isPayable` returns false for a null outcome under every
    // policy, so this line may never become 'paid' or 'unstated' when somebody
    // adds a fifth code.
    eq(lines.find((l) => l.outcome === 'Nobody marked it')?.answer, 'unpaid',
      `${code} does not pay a session nobody has marked`);
  }

  const unmarked = payOutcomeLines(seen(null)).find((l) => l.outcome === 'Nobody marked it');
  eq(unmarked?.answer, 'unpaid', 'and an unset gym does not pay one either — it was never a policy question');
}

/* ── the sentence that says why there is no control here ──────────────────── */
{
  ok(WHERE_THE_POLICY_IS_SET.includes('not yet settled'),
    'the note says a change re-prices months already worked, which is why the phone only shows it');
}

if (errors.length) {
  console.error(`ownerPayPolicy: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('ownerPayPolicy ok');
