// Whether this app has heard from Stripe. Compile with tsc, then run under
// plain node.
//
// The harmful versions of this feature all look reasonable:
//
//   · "Stripe has never reached this app" printed over a read that failed —
//     which would send a coach to check a webhook that is fine, or worse, make
//     them doubt payments that did arrive;
//   · "Stripe has not been heard from in 9 days" dressed up as a fault, on a
//     deployment where nobody happened to sell anything for nine days;
//   · a negative age, from a phone whose clock is ahead of the server's;
//   · the whole deployment's heartbeat read as this coach's own sales.
import {
  stripePulse, stripePulseLine, stripeEventsLine,
  STRIPE_PULSE_IS_NOT_YOUR_SALES, STRIPE_PULSE_IS_NOT_A_HEALTH_CHECK,
  type StripeHeard,
} from './stripeHeartbeat';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const heard = (o: Partial<StripeHeard> = {}): StripeHeard => ({
  at: '2026-09-13T08:00:00.000Z', events: 3, ...o,
});

/* ── 1. a read that did not land says nothing ─────────────────────────────
   The whole point of the feature is telling two silences apart, so a third
   silence must not be folded into either of them. */

{
  eq(stripePulse(heard(), 'loading', NOW).kind, 'unread', 'a read still in flight is not an answer');
  eq(stripePulse(heard(), 'error', NOW).kind, 'unread', 'and neither is a refused one');
  eq(stripePulse(heard(), 'partial', NOW).kind, 'unread', 'nor a truncated one, even though an aggregate cannot be truncated');
  eq(stripePulse(null, 'ready', NOW).kind, 'unread', 'a successful call with nothing in it is not a fact either');

  const line = stripePulseLine(stripePulse(null, 'error', NOW));
  ok(!line.includes('never'), 'a failed read is never reported as "never heard from Stripe"');
  ok(line.includes('could not be read'), 'it says the read failed, which is the true sentence');
}

/* ── 2. never heard is the one state worth acting on ──────────────────── */

{
  const p = stripePulse({ at: null, events: 0 }, 'ready', NOW);
  eq(p.kind, 'silent', 'an empty ledger under a whole read is "never heard"');
  eq(stripePulse({ at: '   ', events: 0 }, 'ready', NOW).kind, 'silent', 'a blank instant is the same fact');

  const line = stripePulseLine(p);
  ok(line.includes('never heard from Stripe'), 'and it is said in those words');
  // The sentence has to carry WHY an empty sales list is not evidence of a
  // quiet month, because that is the misreading the whole feature exists to
  // stop.
  ok(line.includes('quiet month'), 'it names the misreading it is there to prevent');
  eq(stripeEventsLine(p), null, 'a count of nothing is not a sentence — it is the absence of one');
}

/* ── 3. an age, rounded down, and never negative ──────────────────────── */

{
  const p = stripePulse(heard(), 'ready', NOW);
  eq(p.kind, 'heard', 'a dated event under a whole read is a heartbeat');
  if (p.kind === 'heard') eq(p.ageMs, 4 * 60 * 60 * 1000, 'four hours between the event and now');
  eq(stripePulseLine(p), 'Last heard from Stripe 4 hours ago.', 'which is the line the backlog item asked for');

  // A phone whose clock is ahead of the server's. 'just now' is the only honest
  // answer available and it keeps "-2 minutes ago" off the screen.
  const ahead = stripePulse(heard({ at: '2026-09-13T12:05:00.000Z' }), 'ready', NOW);
  eq(stripePulseLine(ahead), 'Last heard from Stripe just now.', 'a clock that moved backwards does not print a negative age');

  const old = stripePulse(heard({ at: '2026-09-04T12:00:00.000Z' }), 'ready', NOW);
  const oldLine = stripePulseLine(old);
  eq(oldLine, 'Last heard from Stripe 9 days ago.', 'an old heartbeat is reported as an age');
  // NOT a diagnosis. Stripe calls only when something happens, so nine quiet
  // days is nine quiet days and this module has no threshold past which it
  // calls anything broken.
  ok(!/broken|fault|down|problem|wrong/i.test(oldLine), 'and never as a fault, because an old heartbeat is not one');
}

/* ── 4. a date on record that will not parse ──────────────────────────── */

{
  const p = stripePulse(heard({ at: 'the fourteenth' }), 'ready', NOW);
  eq(p.kind, 'unreadable', 'an event whose date will not parse is its own state');
  const line = stripePulseLine(p);
  ok(line.includes('has heard from Stripe'), 'something IS on record and that much is still said');
  ok(!line.includes('never'), 'so it is not reported as never');
  ok(!/\d/.test(line), 'and no age is invented to fill the hole');
}

/* ── 5. the count, where there is an honest one ───────────────────────── */

{
  eq(stripeEventsLine(stripePulse(heard({ events: 1 }), 'ready', NOW)),
    '1 event has been handled since this app was connected.', 'one event is singular');
  eq(stripeEventsLine(stripePulse(heard({ events: 3 }), 'ready', NOW)),
    '3 events have been handled since this app was connected.', 'three are plural');
  eq(stripeEventsLine(stripePulse(heard({ events: null }), 'ready', NOW)), null,
    'a count that did not come back is no sentence rather than a nought');
  eq(stripeEventsLine(stripePulse(heard({ events: 0 }), 'ready', NOW)), null,
    'and a heartbeat with a zero count beside it states the heartbeat only — the two disagree, and the dated fact is the one that stands');
  eq(stripeEventsLine(stripePulse(heard(), 'error', NOW)), null, 'a failed read counts nothing');
}

/* ── 6. the sentences that keep it honest ─────────────────────────────── */

{
  ok(STRIPE_PULSE_IS_NOT_YOUR_SALES.includes('not about your own sales'),
    'the screen says the heartbeat is not the coach’s own sales');
  ok(STRIPE_PULSE_IS_NOT_A_HEALTH_CHECK.includes('quiet stretch'),
    'and that a date a while back is a quiet stretch rather than a fault');
}

if (errors.length) {
  console.error(`stripeHeartbeat.test.ts — ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('stripeHeartbeat.test.ts — all assertions passed');
