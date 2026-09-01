// What the app is allowed to believe about the signal, and what it is allowed
// to say about it. Compile with tsc, run with node.
//
// Four failures are guarded here and every one of them is a sentence somebody
// reads at the moment something has gone wrong:
//
//   1. AN ABORT READ AS A DEAD RADIO. The probe times itself out and screens
//      abort reads when they unmount. If those count as evidence, the app
//      declares itself offline every time somebody navigates, and the offline
//      banner becomes noise people learn to ignore before the one time it is
//      true.
//
//   2. "CHECK YOUR CONNECTION" OVER A REFUSAL. The state that must never
//      produce that sentence is 'online': the server answered and said no, and
//      pointing at the router hides the actual answer. Equally, 'unknown' must
//      not produce a claim in either direction.
//
//   3. A RECONNECT THAT NOBODY HEARS. `onReconnect` is what src/lib/offlineQueue
//      hangs its flush on. It has to fire on unknown → online (a cold launch
//      with a queue from last night is exactly that edge) and it must NOT fire
//      again on a second success, or every response re-runs the whole flush.
//
//   4. A PROBE THAT NEVER SLOWS DOWN, OR NEVER SPEEDS BACK UP. The delay has to
//      grow while it keeps missing and collapse the moment one lands.
import {
  canAssertEmpty, currentReach, initialReach, isTransportFailure, noteReached, noteThrown,
  noteUnreachable, offlineBanner, onReconnect, probeDelayMs, reachAfter, reachState,
  resetReach, retryLine, subscribeReach, observedFetch,
} from './reachability';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1 · what counts as evidence ───────────────────────────────────────── */

{
  const abort = new Error('The operation was aborted'); abort.name = 'AbortError';
  ok(!isTransportFailure(abort), 'our own abort is not evidence of no signal');
  ok(!isTransportFailure({ name: 'CanceledError' }), 'a cancelled request is not evidence either');
  ok(!isTransportFailure(new Error('Request aborted by the caller')), 'an abort that only says so in the message is still ours');
  ok(isTransportFailure(new Error('Network request failed')), "React Native's transport failure counts");
  ok(isTransportFailure(new TypeError('Failed to fetch')), "the browser's transport failure counts");
  ok(!isTransportFailure(null), 'nothing thrown is nothing learnt');

  resetReach();
  noteThrown(abort);
  eq(currentReach(), 'unknown', 'an abort must not move the state at all');
  noteThrown(new Error('Network request failed'));
  eq(currentReach(), 'offline', 'a real transport failure does');
}

/* ── 2 · the sentences ─────────────────────────────────────────────────── */

{
  ok(!/check your connection/i.test(retryLine('online')), 'a refusal must never send somebody to their router');
  ok(/did not accept/.test(retryLine('online')), 'a refusal says the server answered');
  ok(/signal/.test(retryLine('offline')), 'no signal says so');
  ok(!/nothing was sent/.test(retryLine('online')), 'the online sentence must not claim the write never left');
  eq(retryLine('unknown'), 'Check your connection and try again.', 'knowing nothing keeps the sentence that claims nothing');

  eq(offlineBanner('online'), null, 'no banner when things work');
  eq(offlineBanner('unknown'), null, 'and none before we know anything — a cold launch must not accuse the network');
  ok((offlineBanner('offline') ?? '').length > 0, 'offline says so once');

  ok(canAssertEmpty('online'), 'a screen that reached the server may state an empty list');
  ok(canAssertEmpty('unknown'), 'and so may one that has not tried yet: the read itself says which');
  ok(!canAssertEmpty('offline'), 'offline may not: what is on screen is from some earlier moment');
}

/* ── 3 · folding verdicts, and the reconnect edge ──────────────────────── */

{
  const s0 = initialReach();
  const s1 = reachAfter(s0, 'unreachable', 1000);
  eq(s1.reach, 'offline', 'one miss is enough');
  eq(s1.since, 1000, 'and it stamps when');
  const s2 = reachAfter(s1, 'unreachable', 5000);
  eq(s2.since, 1000, 'still the same outage, so the stamp does not move');
  eq(s2.failures, 2, 'but the miss is counted');
  const s3 = reachAfter(s2, 'reached', 9000);
  eq(s3.reach, 'online', 'one answer is enough to come back');
  eq(s3.failures, 0, 'and the failure count collapses');
  eq(reachAfter(s3, 'reached', 12000).since, 9000, 'a second success does not restamp');

  let big = initialReach();
  for (let i = 0; i < 100; i++) big = reachAfter(big, 'unreachable', 1);
  ok(big.failures <= 32, 'a phone in a drawer overnight must not run the counter away');
}

{
  resetReach();
  let fired = 0;
  const off = onReconnect(() => { fired += 1; });
  noteReached();
  eq(fired, 1, 'unknown to online is a reconnect: the queue from last night has been waiting for it');
  noteReached();
  eq(fired, 1, 'every subsequent response must not re-run the flush');
  noteUnreachable();
  noteReached();
  eq(fired, 2, 'and a genuine round trip fires it again');
  off();
  noteUnreachable(); noteReached();
  eq(fired, 2, 'unsubscribed means unsubscribed');
}

{
  resetReach();
  const seen: string[] = [];
  const off = subscribeReach((s) => seen.push(s.reach));
  noteUnreachable(1); noteUnreachable(2); noteReached(3);
  eq(seen.length, 3, 'a second miss still notifies, because the probe schedules off the failure count');
  eq(seen[2], 'online', 'and the last thing heard is the truth');
  off();
}

/* ── 4 · the probe schedule ────────────────────────────────────────────── */

{
  eq(probeDelayMs(0), 30_000, 'when things work the probe is only a safety net');
  ok(probeDelayMs(1) < probeDelayMs(2), 'it backs off');
  ok(probeDelayMs(2) < probeDelayMs(4), 'and keeps backing off');
  eq(probeDelayMs(1), 2_000, 'the first retry is quick: a lift door opening is seconds');
  eq(probeDelayMs(99), 60_000, 'and it caps, so the app is never dead for longer than a minute after signal returns');
}

/* ── the fetch wrapper is transparent ──────────────────────────────────── */

// The last block is async, so the exit lives inside it — and the rejection
// handler below is not ceremony: without it a throw in here would leave the
// process exiting 0 with every assertion above unreported.
void (async () => {
  resetReach();
  const okRes = { status: 500 } as any as Response;
  const wrapped = observedFetch((async () => okRes) as any);
  const got = await wrapped('https://example.test');
  ok(got === okRes, 'the response is handed back untouched');
  eq(currentReach(), 'online', 'a 500 is the server talking, which is all this file measures');

  const boom = new Error('Network request failed');
  const failing = observedFetch((async () => { throw boom; }) as any);
  let threw: unknown = null;
  try { await failing('https://example.test'); } catch (e) { threw = e; }
  ok(threw === boom, 'and the error is re-thrown unchanged, so no caller can tell the wrapper is there');
  eq(currentReach(), 'offline', 'having learnt from it');
  eq(reachState().failures, 1, 'once');

  if (errors.length) {
    console.error(`reachability: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('reachability: ok');
})().catch((e) => { console.error(e); process.exit(1); });
