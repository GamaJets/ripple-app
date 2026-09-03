// A hung request, driven against a clock that only moves when the test says so.
//
// ── Why the tests are the deliverable here ─────────────────────────────────
//
// This is the one thing in the codebase whose bug is invisible until somebody
// is standing in a basement. Nothing about a request with no timeout looks
// wrong in the source, nothing about it fails a type check, and the failure it
// produces — a screen that says "loading" for ever on a network that is
// associated but dead — cannot be reproduced at a desk. So the assertions below
// are the only place the behaviour is actually pinned, and they are written to
// fail loudly if any of the four pieces is taken back out:
//
//   1. the ceiling exists and fires;
//   2. it does NOT fire on a slow-but-real response, which is the mistake that
//      would break every user on a working connection at once;
//   3. the abort it fires is read as a TRANSPORT failure, so the app marks
//      itself unreachable — a 4xx must not, because those two sentences send a
//      person to two different places;
//   4. the timer is cleared on the way out, on every path.
//
// The clock is fake for the obvious reason — the ceiling case would otherwise
// be a thirty-second test — and for a less obvious one: a real timer makes
// "was this cancelled?" a race, and the whole point of assertion 4 is that it
// is not.
//
// Compile with tsc, run with node.
import {
  CALL_CEILING_MS, TRANSFER_CEILING_MS, ceilingFor, isRequestTimeout, kindForUrl,
  maxAttempts, methodOf, requestTimeoutError, retryOnTimeout, urlOf, withRequestTimeout,
} from './requestTimeout';
import type { Ceilings } from './requestTimeout';
import { MAX_SPIN_MS } from './pullRefresh';
import { classifyWrite } from './offlineQueue';
import {
  currentReach, isTransportFailure, observedFetch, reachState, resetReach, retryLine,
} from './reachability';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

/**
 * The suite must never pass by disappearing.
 *
 * Found by mutating: with the retry rule broken so a POST is sent again, block
 * 11d awaits a request that is never going to settle. Node then has an empty
 * event loop, exits 0, and prints NOTHING — not the report, not the eleven
 * assertions that had already failed. A broken timeout made the test that
 * exists to catch it go quiet, which is the same shape of bug as the one under
 * test and would have hidden three of the twelve mutations below.
 *
 * So: the report is the only thing allowed to end this process happily.
 */
let reported = false;
process.on('exit', (code: number) => {
  if (!reported && code === 0) {
    console.error('requestTimeout: the suite never reached its report — something below never settled, so node was about to exit 0 with every assertion unreported.');
    process.exitCode = 1;
  }
});
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the fakes ─────────────────────────────────────────────────────────── */

/**
 * Timers that only fire when the test advances. `live()` is the leak detector:
 * a timer that was scheduled and never cleared is still counted, so assertion 4
 * is a number rather than a hope.
 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const armed = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++seq;
      armed.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => { armed.delete(h as number); },
    /** How many timers are still armed. Zero is the only right answer at rest. */
    live: () => armed.size,
    scheduled: () => seq,
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        let nextId = -1; let nextAt = Infinity;
        armed.forEach((t, id) => { if (t.at < nextAt) { nextAt = t.at; nextId = id; } });
        if (nextId < 0 || nextAt > target) break;
        const t = armed.get(nextId)!;
        armed.delete(nextId);
        now = t.at;
        t.fn();
      }
      now = target;
    },
  };
}

/** Let every already-resolved promise run its continuations. */
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

/** A response that is not one of ours, so identity assertions mean something. */
const responseWith = (status: number) => ({ status, ok: status < 400 } as unknown as Response);

/**
 * A fetch that behaves like the real one on a dead network: it goes out, and it
 * never comes back — unless something aborts the signal, at which point it
 * rejects the way a transport does.
 */
function neverAnswers() {
  const calls: any[] = [];
  const fn = (input: any, init?: any): Promise<Response> => {
    calls.push({ input, init });
    return new Promise<Response>((_res, rej) => {
      const sig = init && init.signal;
      const bail = () => { const e = new Error('Aborted'); e.name = 'AbortError'; rej(e); };
      // Real fetch rejects straight away on a signal that is already aborted,
      // rather than waiting for an event that has already been and gone.
      if (sig && sig.aborted) { bail(); return; }
      if (sig && typeof sig.addEventListener === 'function') {
        sig.addEventListener('abort', () => {
          const e = new Error('Aborted'); e.name = 'AbortError'; rej(e);
        });
      }
    });
  };
  return { fn, calls, count: () => calls.length };
}

const REST = 'https://p.supabase.co/rest/v1/workouts?select=*&client_id=eq.abc';

/* ── 1 · which ceiling, and is the number defensible ───────────────────── */

{
  eq(kindForUrl(REST), 'call', 'a row read is a call');
  eq(kindForUrl('https://p.supabase.co/auth/v1/token?grant_type=refresh_token'), 'call', 'a token refresh is a call');
  eq(kindForUrl('https://p.supabase.co/functions/v1/ocr-scan'), 'transfer', 'an edge function may be a model thinking');
  eq(kindForUrl('https://p.supabase.co/storage/v1/object/exercise-videos/a/b.mp4'), 'transfer', 'an object body is bytes on the wire');
  eq(kindForUrl('https://p.supabase.co/storage/v1/object/sign/docs/a.pdf'), 'call',
    'a signed-URL request is a few hundred bytes of JSON wearing a storage path');
  eq(kindForUrl('https://p.supabase.co/storage/v1/object/list/photos'), 'call', 'and so is a listing');
  eq(kindForUrl('https://world.openfoodfacts.org/api/v2/search?q=oats'), 'call',
    'an unrecognised host gets the SHORTER ceiling, because unknown is not evidence of slowness');
  eq(kindForUrl('not a url at all'), 'call', 'and so does something that is not a URL');

  eq(ceilingFor(REST), CALL_CEILING_MS, 'a call gets the call ceiling');
  eq(ceilingFor('https://p.supabase.co/functions/v1/vision-analyze'), TRANSFER_CEILING_MS, 'a transfer gets the long one');

  // The number itself, pinned at both ends so a later edit has to argue with
  // the header rather than quietly slide it.
  ok(CALL_CEILING_MS >= 20_000,
    'under twenty seconds starts cutting off honest EDGE reads, and ONE false verdict flips the whole app to offline');
  ok(CALL_CEILING_MS <= 60_000, 'over a minute the wait has stopped being information');
  ok(CALL_CEILING_MS > MAX_SPIN_MS,
    'the spinner ceiling must fire FIRST — the gesture comes back, then the truth lands');
  ok(TRANSFER_CEILING_MS > CALL_CEILING_MS, 'a video is allowed longer than a row read');
  ok(TRANSFER_CEILING_MS < 150_000, "and less than Supabase's own 150s edge-function wall clock");
}

/* ── 2 · the error is the right SHAPE ──────────────────────────────────── */

{
  const e = requestTimeoutError(REST, 'get', CALL_CEILING_MS);
  ok(isRequestTimeout(e), 'our ceiling is recognisable as ours');
  ok(!isRequestTimeout(new Error('Network request failed')), 'a plain transport failure is not a timeout');
  const abort = new Error('The operation was aborted'); abort.name = 'AbortError';
  ok(!isRequestTimeout(abort), "and neither is somebody else's abort");
  ok(!isRequestTimeout(null), 'nothing is not a timeout');

  // The reason this matters: reachability's own classifier discards aborts, and
  // an unlabelled timeout would be discarded with them — the app would wait
  // thirty seconds for nothing and still believe it was online.
  ok(isTransportFailure(e), 'a timeout IS evidence of a network that did not carry the request');
  ok(!isTransportFailure(abort), 'while a real abort still is not');

  // The marker, not the wording, is what makes that true — pinned because
  // mutating the explicit check out of reachability.ts did NOT fail this suite:
  // the error happens to pass the name-and-message sniffing anyway, so the
  // check reads as redundant right up until somebody rewords the message and
  // silently reopens the defect. Disguise a timeout as an abort and it must
  // still count.
  const disguised = requestTimeoutError(REST, 'GET', CALL_CEILING_MS);
  disguised.name = 'AbortError';
  disguised.message = 'The operation was aborted';
  ok(isTransportFailure(disguised),
    'the timeout marker outranks the name and the wording — reachability must not fall back to sniffing');
  ok(!/abort/i.test(e.message), "the message must not say 'abort', which reachability reads as ours-and-therefore-nothing");
  ok(/timed out/i.test(e.message), 'it says what happened');
  ok(e.message.includes('/rest/v1/workouts'), 'and which endpoint, which is the diagnostic value');
  ok(!e.message.includes('client_id'), 'but not the query string: an error message ends up in a crash report');
  eq(e.ceilingMs, CALL_CEILING_MS, 'and it records which ceiling was in force');

  // ── the marker the layer ABOVE this one reads ─────────────────────────
  //
  // `retryOnTimeout` argues the number: a timed-out GET goes ONCE more, "not
  // until it works". That was true of this file and false of the app. Every
  // `.select()` goes through postgrest-js, which has its own retry loop around
  // the fetch it is handed: on a THROWN error it retries GET/HEAD/OPTIONS three
  // times with 1s/2s/4s backoff, and the only thing that makes it rethrow at
  // once is `name === 'AbortError'` or `code === 'ABORT_ERR'`. A 'TimeoutError'
  // with no code was neither — so one read on a dead network made four trips
  // through this wrapper and `observedFetch` doubled each of them: eight
  // fetches, and at the real ceiling about four minutes for one read to give
  // up. Measured against the installed library, not inferred.
  //
  // The name stays honest for the human reading a crash report; the code is the
  // machine-readable half and says the true thing — we cut this off on purpose.
  eq((e as unknown as { code: string }).code, 'ABORT_ERR',
    'a transport that retries by itself must read our ceiling as a deliberate cancel, not a flaky socket');
  ok(isRequestTimeout(e), 'and the code does not displace the marker every caller in this app actually uses');
  ok(isTransportFailure(e), 'nor does it make reachability discard the one abort that IS evidence');
  eq(classifyWrite({ code: 'ABORT_ERR', status: null, message: e.message }, null), 'unsent',
    'and a write cut off by the ceiling is still kept, not read as a refusal by the server');
}

/* ── 3 · readers ───────────────────────────────────────────────────────── */

{
  eq(urlOf('https://x.test/a'), 'https://x.test/a', 'a string URL');
  eq(urlOf({ url: 'https://x.test/b', method: 'POST' }), 'https://x.test/b', 'a Request object');
  eq(methodOf(REST, { method: 'post' }), 'POST', 'the init wins and is upper-cased');
  eq(methodOf({ url: REST, method: 'DELETE' }), 'DELETE', 'a Request carries its own');
  eq(methodOf(REST), 'GET', 'and fetch defaults to GET, so we do');
}

/* ── 4 · the retry rule, pinned in BOTH directions ─────────────────────── */

{
  ok(retryOnTimeout('GET'), 'a read has no effect to duplicate, so it may go again');
  ok(retryOnTimeout('head'), 'nor has a HEAD, whatever case it arrives in');
  ok(!retryOnTimeout('POST'), 'a POST may have committed before its reply was lost — sending it twice books the class twice');
  ok(!retryOnTimeout('PATCH'), 'and a PATCH the same');
  ok(!retryOnTimeout('PUT'), "PostgREST's PUT is an upsert, so HTTP's idempotence is not the app's");
  ok(!retryOnTimeout('DELETE'), 'and offlineQueue already refuses to repeat an ambiguous destructive write');
  eq(maxAttempts('GET'), 2, 'once more, not until it works: after thirty seconds of silence TCP has already retried throughout');
  eq(maxAttempts('POST'), 1, 'a write is sent exactly once');
}

/* ── everything below needs a clock and an await ───────────────────────── */

void (async () => {
  /* ── 5 · a request that never settles is cut off AT the ceiling ─────── */
  {
    const t = fakeTimers();
    const net = neverAnswers();
    const f = withRequestTimeout(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });

    let outcome: unknown = 'pending';
    void f(REST).then((r) => { outcome = r; }, (e) => { outcome = e; });
    await settle();
    eq(outcome, 'pending', 'nothing has happened yet');

    t.advance(CALL_CEILING_MS - 1);
    await settle();
    eq(outcome, 'pending', 'and nothing happens one millisecond early — the ceiling is a ceiling, not a hint');

    t.advance(1);
    await settle();
    ok(isRequestTimeout(outcome), 'at the ceiling it fails, as a timeout');
    eq(t.live(), 0, 'and the timer is gone');

    const sig = net.calls[0].init.signal;
    ok(sig && sig.aborted === true, 'the socket is released too, not just the caller');
  }

  /* ── 6 · a slow-but-REAL response is not touched ────────────────────── */
  {
    // The mistake this guards is the expensive one. A ceiling that clips a
    // working connection does not fail one read: reachability flips the whole
    // app to 'offline' on a single verdict, so every screen changes its
    // sentences for somebody whose network is fine.
    const t = fakeTimers();
    const res = responseWith(200);
    let release: (() => void) | null = null;
    const slow = (_i: any, init?: any): Promise<Response> =>
      new Promise<Response>((resolve) => { release = () => resolve(res); void init; });
    const f = withRequestTimeout(slow, { setTimer: t.setTimer, clearTimer: t.clearTimer });

    let got: unknown = 'pending';
    const p = f(REST).then((r) => { got = r; }, (e) => { got = e; });

    t.advance(CALL_CEILING_MS - 1);
    await settle();
    eq(got, 'pending', 'still in flight, and still allowed to be');
    release!();
    await p;
    ok(got === res, 'a response that arrives inside the ceiling is handed back, the same object');
    eq(t.live(), 0, 'and the ceiling timer is cleared on the SUCCESS path — a leaked timer per request is its own bug');
    eq(t.scheduled(), 1, 'exactly one timer was ever armed');
  }

  /* ── 7 · a transfer gets the longer ceiling, in practice ────────────── */
  {
    const t = fakeTimers();
    const net = neverAnswers();
    const f = withRequestTimeout(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    let out: unknown = 'pending';
    void f('https://p.supabase.co/storage/v1/object/exercise-videos/a.mp4', { method: 'POST' })
      .then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    t.advance(CALL_CEILING_MS + 1);
    await settle();
    eq(out, 'pending', 'an upload is not failed at the row-read ceiling — that would break every video away from home broadband');
    t.advance(TRANSFER_CEILING_MS);
    await settle();
    ok(isRequestTimeout(out), 'but it does end');
  }

  /* ── 8 · the caller's own signal still works, and is not ours ───────── */
  {
    const t = fakeTimers();
    const net = neverAnswers();
    const f = withRequestTimeout(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    const outer = new AbortController();
    let out: unknown = 'pending';
    void f(REST, { signal: outer.signal }).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    ok(net.calls[0].init.signal !== outer.signal, 'the request carries our controller');
    outer.abort();
    await settle();
    ok(out !== 'pending', "a screen unmounting still cancels its read — the caller's signal is chained, not dropped");
    ok(!isRequestTimeout(out), 'and what it produces is NOT a timeout');
    ok(!isTransportFailure(out), 'so the app learns nothing about the network from somebody navigating away');
    eq(t.live(), 0, 'the ceiling timer is cleared on the abort path too');
  }

  /* ── 9 · a signal already aborted never opens a socket ──────────────── */
  {
    const t = fakeTimers();
    const net = neverAnswers();
    const f = withRequestTimeout(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
    const dead = new AbortController();
    dead.abort();
    let out: unknown = 'pending';
    void f(REST, { signal: dead.signal }).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    ok(out !== 'pending', 'a caller who has already given up is not made to wait thirty seconds');
    eq(t.live(), 0, 'and nothing is left armed');
  }

  /* ── 10 · the caller is freed even with no AbortController at all ───── */
  {
    // Belt is the controller; braces is the race. A runtime whose fetch ignores
    // the signal — or has no AbortController, which is why src/ui/reachability
    // guards for it — must still stop waiting, because waiting for ever is the
    // entire defect.
    const g = globalThis as any;
    const saved = g.AbortController;
    delete g.AbortController;
    try {
      const t = fakeTimers();
      const net = neverAnswers();
      const f = withRequestTimeout(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
      let out: unknown = 'pending';
      void f(REST).then((r) => { out = r; }, (e) => { out = e; });
      await settle();
      ok(net.calls[0].init === undefined, 'with no controller, the init is passed through untouched');
      t.advance(CALL_CEILING_MS);
      await settle();
      ok(isRequestTimeout(out), 'and the caller is STILL freed at the ceiling');
      eq(t.live(), 0, 'timer cleared');
    } finally {
      g.AbortController = saved;
    }
  }

  /* ── 11 · what the app believes, which is the point of all of it ───── */

  const fast: Ceilings = { call: 1_000, transfer: 4_000 };

  // 11a — a hung read marks the app unreachable, and does it at the FIRST
  // ceiling rather than after the retry.
  {
    resetReach();
    const t = fakeTimers();
    const net = neverAnswers();
    const f = observedFetch(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    let out: unknown = 'pending';
    void f(REST).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    eq(currentReach(), 'unknown', 'before the ceiling the app claims nothing, which is right');

    t.advance(fast.call);
    await settle();
    eq(currentReach(), 'offline',
      'the FIRST timeout marks the app unreachable — the banner does not wait for a retry to finish');
    eq(net.count(), 2, 'and the read goes again, because a GET has nothing to duplicate');
    eq(out, 'pending', 'while the caller is still waiting on the second attempt');

    t.advance(fast.call);
    await settle();
    ok(isRequestTimeout(out), 'which also ends');
    eq(net.count(), 2, 'once more, not until it works');
    eq(reachState().failures, 2, 'both attempts filed their own verdict');
    eq(t.live(), 0, 'no timer survives either attempt');
    ok(/signal/.test(retryLine(currentReach())),
      'and the sentence a person reads points at their signal, which is where the problem is');
  }

  // 11b — a write is sent exactly once, however long it hangs.
  {
    resetReach();
    const t = fakeTimers();
    const net = neverAnswers();
    const f = observedFetch(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    let out: unknown = 'pending';
    void f(REST, { method: 'POST', body: '{}' }).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    t.advance(fast.call);
    await settle();
    ok(isRequestTimeout(out), 'the write gives up at the ceiling');
    eq(net.count(), 1, 'and is NOT sent again: it may already have committed, and nothing here carries an idempotency key');
    eq(currentReach(), 'offline', 'the app has still learnt from it');
  }

  // 11c — a refusal is not a dead network, and never has been.
  {
    resetReach();
    const t = fakeTimers();
    const denied = responseWith(403);
    let n = 0;
    const f = observedFetch(async () => { n += 1; return denied; },
      { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    const got = await f(REST);
    ok(got === denied, 'the response comes back untouched — no caller can tell the wrapper is there');
    eq(currentReach(), 'online', 'a 4xx is the server TALKING, so the app is reachable');
    eq(n, 1, 'and a refusal is emphatically not retried');
    ok(!/check your connection/i.test(retryLine(currentReach())),
      'nobody is sent to their router over a policy the server applied');
    ok(/did not accept/.test(retryLine(currentReach())), 'they are told the server answered');
    eq(t.live(), 0, 'timer cleared on the ordinary success path, which is every request the app makes');
  }

  // 11d — a timeout and a refusal are distinguishable at every layer.
  {
    resetReach();
    const t = fakeTimers();
    const net = neverAnswers();
    const f = observedFetch(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    let timeoutErr: unknown = null;
    const p = f(REST, { method: 'POST' }).catch((e) => { timeoutErr = e; });
    await settle();
    t.advance(fast.call);
    await p;
    const offlineLine = retryLine(currentReach());

    resetReach();
    const g = observedFetch(async () => responseWith(409),
      { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    await g(REST, { method: 'POST' });
    const onlineLine = retryLine(currentReach());

    ok(isRequestTimeout(timeoutErr), 'layer 1 · the thrown value says which it was');
    ok(isTransportFailure(timeoutErr), 'layer 2 · the classifier agrees it is the network');
    ok(offlineLine !== onlineLine, 'layer 3 · and the two produce different sentences');
    ok(/nothing was sent/.test(offlineLine), 'a timed-out write says nothing was sent');
    ok(!/nothing was sent/.test(onlineLine), 'a refused one must never claim that — it WAS sent, and declined');
  }

  // 11e — the retry earns its keep: a read that gets through second time.
  {
    resetReach();
    const t = fakeTimers();
    const good = responseWith(200);
    let n = 0;
    const flaky = (_i: any, init?: any): Promise<Response> => {
      n += 1;
      if (n === 1) {
        return new Promise<Response>((_r, rej) => {
          const s = init && init.signal;
          if (s && typeof s.addEventListener === 'function') {
            s.addEventListener('abort', () => { const e = new Error('Aborted'); e.name = 'AbortError'; rej(e); });
          }
        });
      }
      return Promise.resolve(good);
    };
    const f = observedFetch(flaky, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    let out: unknown = 'pending';
    const p = f(REST).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    t.advance(fast.call);
    await p;
    ok(out === good, 'the second connection got through, and the caller never knew');
    eq(currentReach(), 'online', 'and the app is back to believing the truth');
    eq(t.live(), 0, 'with nothing left armed');
  }

  // 11f — a screen that unmounts mid-read teaches the app nothing, and is not
  // chased with a second request.
  {
    resetReach();
    const t = fakeTimers();
    const net = neverAnswers();
    const f = observedFetch(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
    const outer = new AbortController();
    let out: unknown = 'pending';
    const p = f(REST, { signal: outer.signal }).then((r) => { out = r; }, (e) => { out = e; });
    await settle();
    outer.abort();
    await p;
    ok(out !== 'pending', 'the read ends');
    eq(currentReach(), 'unknown', 'and the app has learnt nothing about the network from somebody navigating');
    eq(net.count(), 1, 'a cancelled read is not retried — it was not a timeout');
    eq(t.live(), 0, 'timer cleared');
  }

  resetReach();

  reported = true;
  if (errors.length) {
    console.error(`requestTimeout: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('requestTimeout: ok');
})().catch((e) => { console.error(e); process.exit(1); });
