// When the coach is seeing this person next. Compile with tsc, run with node.
//
// One sentence in this module is dangerous and everything here is arranged
// around it. "Nothing booked" is what a coach reads before deciding not to ring
// somebody, and three different states arrive as an empty `upcoming` list
// without meaning it: a read still in flight, a read that was refused, and a
// client with no account for anything to have been read from. Each is asserted
// apart, and each is asserted NOT to produce the fourth's words.
//
// The second failure is quieter. `buildLedger` orders `upcoming` on
// `Date.parse(a) - Date.parse(b)`, which is NaN for an unreadable timestamp, so
// such a row can sit at position 0 of a list whose second row is a real
// Thursday. Trusting `upcoming[0]` would put an em dash back where the whole
// module exists to remove one.
import { nextUp, nextUpLine, nextUpUrgent } from './nextUp';
import type { Ledger, LedgerRow } from './sessionCredits';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (sessionId: string, startsAt: string): LedgerRow => ({
  sessionId, startsAt, state: 'expected', kind: null, drawnAt: null, entitlementId: null,
});
const led = (upcoming: LedgerRow[]): Ledger => ({ past: [], upcoming });
const read = (ledger: Ledger | null) =>
  nextUp({ ledger, loading: false, unread: false, unasked: false });

const WHO = 'Priya';

/* ── 1. four kinds of nothing, and only one of them is an empty diary ─────*/

{
  const states = {
    unasked: nextUp({ ledger: null, loading: false, unread: false, unasked: true }),
    loading: nextUp({ ledger: null, loading: true, unread: false, unasked: false }),
    unread: nextUp({ ledger: null, loading: false, unread: true, unasked: false }),
    none: read(led([])),
  };
  eq(states.unasked.state, 'unasked', 'a client with no account has no diary to read');
  eq(states.loading.state, 'loading', 'a read in flight is not an answer');
  eq(states.unread.state, 'unread', 'and a refused one is not an empty diary');
  eq(states.none.state, 'none', 'only a read that came back and found nothing is');

  // The sentence, per state. This is the assertion the module exists for.
  for (const s of ['unasked', 'loading', 'unread'] as const) {
    const line = nextUpLine(states[s], 3, WHO).toLowerCase();
    ok(!line.includes('nothing booked'),
      `a ${s} diary must never say "nothing booked" — a coach reads that and does not ring somebody`);
  }
  ok(nextUpLine(states.unread, null, WHO).includes('not a statement that nothing is booked'),
    'the refused read says so outright rather than showing a shorter list');
  ok(nextUpLine(states.none, null, WHO).includes('Nothing booked'),
    'and the one that means it says it');
}

{
  // The ledger being null under an otherwise clean read is the same failure:
  // `buildLedger` returns null for a read that did not answer.
  eq(read(null).state, 'unread', 'a null ledger is a read that did not answer, not an empty one');
}

/* ── 2. the earliest, found by scanning ──────────────────────────────────*/

{
  const n = read(led([
    row('bad', 'next Thursday-ish'),
    row('thu', '2026-09-10T07:00:00.000Z'),
    row('fri', '2026-09-11T07:00:00.000Z'),
  ]));
  eq(n.state, 'booked', 'there is something in the diary');
  eq(n.sessionId, 'thu',
    'and it is the earliest READABLE one — position 0 is whatever a NaN comparator left there');
  eq(n.startsAt, '2026-09-10T07:00:00.000Z',
    'handed back exactly as the row carried it, for the screen’s own formatter');
  eq(n.after, 2, 'and the unreadable one is still a booking — dropping it reports a lighter week');
}

{
  const n = read(led([
    row('c', '2026-09-20T07:00:00.000Z'),
    row('a', '2026-09-04T06:00:00.000Z'),
    row('b', '2026-09-12T07:00:00.000Z'),
  ]));
  eq(n.sessionId, 'a', 'the soonest wins whatever order the list arrived in');
  eq(n.after, 2, 'and the rest are counted');
  eq(nextUpLine(n, null, WHO), 'And 2 more after it.', 'said as a count, without a second date');
}

{
  const only = read(led([row('a', '2026-09-04T06:00:00.000Z')]));
  eq(only.after, 0, 'one booking has nothing after it');
  eq(nextUpLine(only, null, WHO), 'The only one in the diary.',
    'and the line says that rather than "and 0 more"');
  const two = read(led([row('a', '2026-09-04T06:00:00.000Z'), row('b', '2026-09-05T06:00:00.000Z')]));
  eq(nextUpLine(two, null, WHO), 'And one more after it.', 'one more is not "1 more"');
}

/* ── 3. bookings whose dates cannot be read are bookings ─────────────────*/

{
  const n = read(led([row('x', ''), row('y', 'soon')]));
  eq(n.state, 'booked', 'two sessions with unreadable dates are still two sessions');
  eq(n.startsAt, null, 'with no date to show');
  eq(n.after, 1, 'and the second one counted');
  const line = nextUpLine(n, null, WHO);
  eq(line, '2 sessions are booked and none of their dates could be read.',
    'the line counts them and says the dates are what is missing');
  ok(!line.toLowerCase().includes('nothing'),
    'and never that nothing is booked — that is the whole failure this branch prevents');
  eq(nextUpLine(read(led([row('x', '')])), null, WHO),
    'One session is booked and its date could not be read.', 'one of them is singular');
}

/* ── 4. hours paid for and nothing to use them on ────────────────────────*/

{
  const none = read(led([]));
  eq(nextUpUrgent(none, 4), true,
    'nothing booked and four sessions paid for is a fact worth a mark — it is what a refund starts as');
  eq(nextUpLine(none, 4, WHO), 'Nothing booked, and Priya has 4 sessions left to use.',
    'and the line names the number, because that is what makes the call worth making');
  eq(nextUpLine(none, 1, WHO), 'Nothing booked, and Priya has 1 session left to use.',
    'one session is singular');
}

{
  const none = read(led([]));
  eq(nextUpUrgent(none, 0), false,
    'nothing booked and nothing paid for is an ordinary week for an online client, not an alarm');
  eq(nextUpUrgent(none, null), false,
    'and a balance that could not be read is not evidence of anything — a mark there reads as a finding');
  eq(nextUpLine(none, 0, WHO), 'Nothing booked ahead.', 'and the line drops the clause it cannot fill');
  eq(nextUpLine(none, null, WHO), 'Nothing booked ahead.', 'the same when the balance is unknown');
}

{
  eq(nextUpUrgent(read(led([row('a', '2026-09-04T06:00:00.000Z')])), 4), false,
    'a client with sessions left AND something booked is using them — no mark');
  for (const s of [
    nextUp({ ledger: null, loading: true, unread: false, unasked: false }),
    nextUp({ ledger: null, loading: false, unread: true, unasked: false }),
    nextUp({ ledger: null, loading: false, unread: false, unasked: true }),
  ]) {
    eq(nextUpUrgent(s, 9), false,
      'and nothing that is merely unknown wears a mark — an orange dot beside "we could not check" reads as a finding');
  }
}

/* ── 5. no date is formatted here ────────────────────────────────────────*/

{
  // A month name written in this file would be in this file's language, on a
  // line a coach in Munich reads. The screen formats; this decides.
  const src = nextUpLine(read(led([row('a', '2026-09-04T06:00:00.000Z')])), null, WHO)
    + nextUpLine(read(led([])), 3, 'Ana');
  ok(!/Sep|September|2026|09-04/.test(src), 'no date, month or year appears in any sentence here');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'NEXT UP FAILURES:\n' + errors.join('\n') : 'nextUp: ok — no diary that could not be read is reported as an empty one, and no booking is lost to an unreadable date');
if (errors.length) process.exit(1);
