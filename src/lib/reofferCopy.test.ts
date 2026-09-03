// The sentence a coach reads after offering a freed slot round the roster.
//
// What is under test is one rule: the number in the sentence is the server's
// number, and it can never be silently substituted with the size of the list
// the screen sent. Everything below is an assertion about that substitution
// being impossible to make by accident.
//
// Compile with tsc, run with node.
import { reofferConfirmation } from './reofferCopy';
import { PUSH_PARTIAL_NOTE } from './notifyCopy';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// `eq` is used below on the exact wording of the two singular forms, which are
// the two this file has already got wrong once.

const WHEN = '18:00 on Tue';

/* ── everybody the screen asked for ────────────────────────────────────────── */

{
  const s = reofferConfirmation({ offered: 12, recorded: 12 }, WHEN);
  ok(s.includes('All 12 of your clients were sent'), 'the whole roster confirmed reads as all of them');
  ok(s.includes(WHEN), 'and the slot is named, because the alert is dismissed and the slot is not');
  ok(s.includes('Delivery depends on their notification settings.'),
    'with the caveat that a recorded notification is still not a delivered one');
}

{
  const s = reofferConfirmation({ offered: 1, recorded: 1 }, WHEN);
  eq(s.startsWith('All 1 of your client was sent a notification'), true,
    'one client is singular on both the noun and the verb');
  ok(!s.includes('clients'), 'and never plural anywhere in that sentence');
}

/* ── the substitution this module exists to stop ───────────────────────────── */

{
  // Twelve asked for, eight written. `ok` was true, the old screen said "all
  // twelve", and four people never heard the slot was free.
  const s = reofferConfirmation({ offered: 12, recorded: 8 }, WHEN);
  ok(s.includes('8 of your 12 clients'), 'a short count is stated as a short count');
  ok(s.includes('the other 4'), 'and the remainder is named, because it is the four the coach has to message');
  ok(!s.toLowerCase().includes('all '), 'the word "all" never appears over a partial send');
  ok(s.includes('message them yourself'), 'and the coach is told what to do about it');
}

{
  const s = reofferConfirmation({ offered: 2, recorded: 1 }, WHEN);
  ok(s.includes('1 of your 2 clients was sent'), 'one of two is singular on the verb and plural on the roster');
  ok(s.includes('the other 1'), 'and the one who missed it is counted');
}

/* ── nobody ────────────────────────────────────────────────────────────────── */

{
  // `ok: true` with `recorded: 0` is a real outcome — the push call was
  // accepted and the inbox write matched nothing. Reporting it as a success
  // is a coach waiting on a slot nobody has been told about.
  const s = reofferConfirmation({ offered: 12, recorded: 0 }, WHEN);
  ok(s.includes('recorded the notification for nobody'), 'nought recorded is stated plainly');
  ok(s.includes('still open'), 'and the slot is reported as still open, which it is');
  ok(!s.includes('All 12'), 'never as twelve');
  ok(!s.includes('0 of your 12'), 'and not as a count of nought either — that reads like a statistic');
}

/* ── no count at all is a third sentence, not a quiet nought and not a quiet all */

{
  const s = reofferConfirmation({ offered: 12, recorded: null }, WHEN);
  ok(s.includes('did not say how many'), 'an absent count says the count is absent');
  ok(s.includes('this is not a count'), 'in as many words');
  ok(!s.includes('All 12'), 'it is not read as everybody');
  ok(!s.includes('nobody'), 'and it is not read as nobody');
}

/* ── numbers that are not numbers ──────────────────────────────────────────── */

{
  // A server that answers with more rows than we asked about is a server we
  // have misunderstood. The honest reading is still "everybody we asked for" —
  // the alternative is a sentence containing a negative remainder.
  const s = reofferConfirmation({ offered: 3, recorded: 5 }, WHEN);
  ok(s.includes('All 3 of your clients'), 'more recorded than offered still reads as all of them');
  ok(!s.includes('-'), 'and never produces a negative remainder');
}

{
  const s = reofferConfirmation({ offered: Number.NaN, recorded: 0 }, WHEN);
  ok(!s.includes('NaN'), 'a count that is not a number never reaches the screen as the letters NaN');
}

{
  const s = reofferConfirmation({ offered: 12, recorded: 8.7 }, WHEN);
  ok(!s.includes('8.7'), 'and a fractional count is not printed as a fraction of a person');
  ok(s.includes('8 of your 12'), 'it is floored, which is the direction that cannot overstate');
}

/* ── the zero that was policy, not a measurement ───────────────────────────
 *
 * This send's title is 'A slot just opened', and `EXPIRING` in
 * src/lib/notifyInbox.ts refuses to keep a row for it on purpose. So
 * `recorded` came back 0 on EVERY re-offer this product has ever sent, and the
 * sentence below told the coach that none of their clients had been told —
 * over a send that had gone out perfectly.
 */

{
  const s = reofferConfirmation({ offered: 12, recorded: 0, inboxKept: false }, WHEN);
  ok(!/recorded the notification for nobody/i.test(s),
    'a row that was never going to be written is not reported as a row that failed');
  ok(!/still open/i.test(s), 'and the slot is not described as one nobody has been asked about');
  ok(s.includes('All 12 of your clients'), 'the people who WERE sent it are still stated');
  ok(/not kept in their notifications/i.test(s),
    'and the consequence a coach can act on — nothing is waiting in the app — is said out loud');
  // The distinction is the whole point: a real zero still reads as a real zero.
  const failed = reofferConfirmation({ offered: 12, recorded: 0, inboxKept: true }, WHEN);
  ok(/recorded the notification for nobody/i.test(failed),
    'a kind the inbox DOES keep, recorded for nobody, still says so');
  ok(s !== failed, 'the two zeroes do not share a sentence');
  // An older caller that has not been taught the difference keeps its meaning.
  ok(reofferConfirmation({ offered: 12, recorded: 0 }, WHEN) === failed,
    'an absent flag changes nothing');
}

/* ── a handset list that was only partly read ──────────────────────────────
 *
 * send-push reports `partial` when it could not page all of `push_tokens`.
 * Nothing here read it, so however many phones lit up was being stated as all
 * of them.
 */

{
  for (const out of [
    { offered: 12, recorded: 12 },
    { offered: 12, recorded: 8 },
    { offered: 12, recorded: 0, inboxKept: false },
    { offered: 12, recorded: null },
  ]) {
    const plain = reofferConfirmation(out, WHEN);
    const hedged = reofferConfirmation({ ...out, partial: true }, WHEN);
    ok(hedged !== plain, 'every branch can say that the handset list was short');
    ok(hedged.includes(PUSH_PARTIAL_NOTE),
      'and says it in the one wording this product has for it');
    ok(!plain.includes(PUSH_PARTIAL_NOTE),
      'while a send with nothing wrong carries no warning');
  }
  // It is a fact about how far the push got, never about the slot or about how
  // many people were asked.
  const hedged = reofferConfirmation({ offered: 12, recorded: 12, partial: true }, WHEN);
  ok(hedged.includes('All 12 of your clients'), 'the number asked is unchanged by it');
  ok(hedged.includes(WHEN), 'and the slot is still named');
}

/* ── the whole point, stated once ──────────────────────────────────────────── */

{
  // The regression this file is here to catch: if somebody ever passes the
  // size of the list as both halves, every partial send silently becomes "all".
  const short = reofferConfirmation({ offered: 12, recorded: 8 }, WHEN);
  const whole = reofferConfirmation({ offered: 12, recorded: 12 }, WHEN);
  ok(short !== whole, 'a partial send and a whole one do not produce the same sentence');
}

if (errors.length) {
  console.error(`reofferCopy: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('reofferCopy ok — the count in the sentence is the server’s, never the size of the list we sent');
