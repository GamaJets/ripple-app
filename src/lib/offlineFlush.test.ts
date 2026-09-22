// When a queued write actually gets sent. Compile with tsc, run with node.
//
// The registry in src/lib/offlineQueue.ts is four lines of state and every one
// of them is a way to lose or duplicate somebody's session:
//
//   1. TWO FLUSHES AT ONCE. Coming back to the foreground and the first
//      successful request usually happen within the same second, and both fire
//      a flush. Two concurrent passes over one queue is how a workout that was
//      logged once ends up on the server twice, a day apart, with no way to
//      tell which row is real.
//
//   2. A TRIGGER SWALLOWED BY THE ONE IN FLIGHT. The opposite failure. A
//      reconnect that arrives while a pass is halfway through must not be
//      dropped — the provider it would have helped may already have read its
//      queue and moved on.
//
//   3. ONE PROVIDER TAKING THE REST DOWN. A flusher that throws must not stop
//      the queues after it in the list from being sent.
//
//   4. A STALE REGISTRATION SENDING THE WRONG ACCOUNT'S QUEUE. Providers
//      register from an effect that re-runs on every auth revision. Registering
//      by key has to REPLACE, and an unregister from a later unmount must not
//      delete a registration that has already been taken over.
import {
  MAX_FLUSH_PASSES, flushAll, flushAllOrJoin, flusherCount, isFlushing, registerFlush, resetFlushers,
} from './offlineQueue';

// Failed until it is proved otherwise. Every assertion here is about a promise
// that may never settle, and a suite that starts at 0 reports a hang as a pass:
// node exits quietly the moment the loop drains, with nothing printed and
// nothing checked. Cleared on the last line of `run`.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function run() {
  /* ── 4 · registration ────────────────────────────────────────────────── */
  {
    resetFlushers();
    eq(flusherCount(), 0, 'nothing is registered to begin with');
    let which = '';
    const offFirst = registerFlush('workouts', () => { which = 'first'; });
    registerFlush('workouts', () => { which = 'second'; });
    eq(flusherCount(), 1, 'the same key replaces rather than accumulating');
    await flushAll();
    eq(which, 'second', 'and it is the latest registration that runs, not the closure over the previous account');
    offFirst();
    eq(flusherCount(), 1, 'an unregister from the superseded effect must not delete the live one');
  }

  /* ── 3 · one bad provider ────────────────────────────────────────────── */
  {
    resetFlushers();
    const ran: string[] = [];
    registerFlush('a', () => { ran.push('a'); throw new Error('no signal'); });
    registerFlush('b', async () => { ran.push('b'); return Promise.reject(new Error('refused')); });
    registerFlush('c', () => { ran.push('c'); });
    const n = await flushAll();
    eq(ran.join(','), 'a,b,c', 'a throwing flusher does not stop the queues behind it');
    eq(n, 3, 'and all three are reported as run');
  }

  /* ── 1 + 2 · single flight ───────────────────────────────────────────── */
  {
    resetFlushers();
    let passes = 0;
    let release: () => void = () => {};
    registerFlush('slow', () => {
      passes += 1;
      return new Promise<void>((res) => { release = res; });
    });

    const first = flushAll();
    await tick();
    ok(isFlushing(), 'a pass is in flight');
    eq(passes, 1, 'and it has started the provider once');

    // The foreground trigger arriving on top of the reconnect trigger.
    const second = flushAll();
    ok(first === second, 'a second call while one is in flight does not start a second pass');
    eq(passes, 1, 'and specifically does not call the provider again concurrently');

    release();
    await tick(); await tick();
    eq(passes, 2, 'but it is not dropped either: one more pass runs once the first finishes');
    release();
    await first;
    await tick();
    ok(!isFlushing(), 'and then it settles');

    // Three calls stacked on one in-flight pass still produce exactly one
    // follow-up, not three.
    resetFlushers();
    passes = 0;
    registerFlush('slow', () => { passes += 1; return new Promise<void>((res) => { release = res; }); });
    const p = flushAll();
    await tick();
    flushAll(); flushAll(); flushAll();
    release(); await tick(); await tick();
    release(); await p; await tick();
    eq(passes, 2, 'three overlapping triggers collapse to one follow-up pass, not three');
  }

  /* ── 5 · the pass that asks for itself ───────────────────────────────── *
   *
   * `askedAgain` had no ceiling, and there is a path from inside a flusher
   * straight back into `flushAll`: a provider's write SUCCEEDS, `noteReached`
   * flips the app from offline to online, the reconnect edge fires, and
   * src/ui/offlineFlush.tsx's subscriber flushes. On a connection that keeps
   * flipping — a stairwell out of a basement — that is a loop with no exit,
   * re-offering every unsent write on every turn of it. Each re-offer of a
   * write that timed out is a chance at a second copy of somebody's session.  */
  {
    resetFlushers();
    let passes = 0;
    registerFlush('workouts', () => {
      passes += 1;
      // The reconnect edge, raised by this flusher's own successful write.
      if (passes < 50) void flushAll();
    });
    await flushAll();
    eq(passes, MAX_FLUSH_PASSES, 'a flusher that re-enters the flush cannot make it run for ever');
    ok(!isFlushing(), 'and the flight ends rather than holding the latch open');
  }

  /* ── 6 · two subscribers to one event are one flush ──────────────────── *
   *
   * src/ui/offlineFlush.tsx and src/lib/readRefresh.ts are BOTH wired to the
   * reconnect edge and both to AppState, and `refreshStale` flushes before it
   * re-reads. With `flushAll` on both sides every one of those events ran every
   * provider's queue twice, back to back, on the connection least able to
   * afford it — and offering an ambiguous write twice is how one logged session
   * becomes two rows nobody can tell apart. The second caller is not news; it
   * is the same event, and it joins.                                          */
  {
    resetFlushers();
    let passes = 0;
    let release: () => void = () => {};
    registerFlush('workouts', () => {
      passes += 1;
      return new Promise<void>((res) => { release = res; });
    });

    const fromOfflineFlush = flushAll();          // the root component's subscriber
    await tick();
    const fromRefreshStale = flushAllOrJoin();    // refreshStale, on the same edge
    ok(fromOfflineFlush === fromRefreshStale, 'the second subscriber joins the pass in flight');
    release();
    // Driven with ticks rather than by awaiting the flight, so that a build in
    // which the join books a second pass FAILS here rather than hanging: the
    // second pass would replace `release` with a promise nobody resolves.
    await tick(); await tick(); await tick();
    eq(passes, 1, 'one reconnect edge offers each queue once, not twice');
    release();
    await fromOfflineFlush;
  }

  {
    resetFlushers();
    let passes = 0;
    registerFlush('workouts', () => { passes += 1; });
    await flushAllOrJoin();
    eq(passes, 1, 'and with nothing in flight it is an ordinary flush');
  }

  /* ── a flush with nothing registered is not an error ─────────────────── */
  {
    resetFlushers();
    eq(await flushAll(), 0, 'an app with no queues flushes nothing and says so');
  }

  resetFlushers();
  if (errors.length) {
    console.error(`offlineFlush: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('offlineFlush: ok');
  process.exitCode = 0;
}

void run().catch((e) => { console.error(e); process.exit(1); });
