// When a failed READ gets tried again. Compile with tsc, run with node.
//
// src/lib/offlineFlush.test.ts holds the same four registry hazards for the
// write side and they all apply here unchanged. What is additionally at stake
// in this file is the part the write side does not have — a policy about WHICH
// provider is asked and WHEN — and every one of those decisions is a way to
// make a member's phone worse rather than better:
//
//   1. RE-READING WHAT ALREADY WORKED. The point of this is recovery, not
//      refresh. A pass that asks the seven providers that are fine along with
//      the one that failed spends a member's data on a connection that has just
//      come back, and redraws seven screens that were correct.
//
//   2. RE-READING WHAT IS STILL IN FLIGHT. 'loading' means a request is out
//      there now. Starting a second one is a duplicate on the worst possible
//      connection, and on the providers that merge server rows with a device
//      queue it is a race over one list.
//
//   3. NEVER GIVING UP. An 'error' that is a row-level-security refusal is
//      permanent, and looks from here exactly like an 'error' that is a
//      basement. Without a ceiling the phone re-runs a doomed read for ever.
//
//   4. GIVING UP FOR EVER. The mirror of 3, and the worse one: a member who
//      exhausted the ceiling underground must get their attempts back the
//      moment there is signal, or the feature has made things worse than the
//      spinner it replaced.
//
//   5. READING BEFORE SENDING. A member's own logged sets are on the phone and
//      not on the server. A read that lands first shows them the server's view
//      without their work in it.
//
//   6. FIRING EVERYTHING AT ONCE. Eight cold requests into a connection that
//      has just been restored is how half of them time out, and each timeout is
//      thirty seconds (src/lib/requestTimeout.ts) before anything is on screen.
import {
  FOREGROUND_GAP_MS, MAX_ATTEMPTS, attemptsAllow, attemptsFor, mayRunNow, needsRefetch,
  noteEdge, refreshStale, refresherCount, registerRefresh, resetRefreshers,
  type RefreshPass,
} from './readRefresh';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** No reachability, no write queue, no timers. Every pass in this file is
 *  driven by injected parts so the assertions are about the policy and not
 *  about how fast node happens to be. */
const base = { canRead: () => true, flushFirst: () => undefined, pause: async () => { /* instant */ }, pauseMs: 0 };

const provider = (status: () => LoadStatus, onRefetch?: () => void) => ({
  status,
  refetch: () => { onRefetch?.(); },
});

async function run() {
  /* ── 1 + 2 · which providers are asked ───────────────────────────────── */
  {
    resetRefreshers();
    const asked: string[] = [];
    registerRefresh('failed', provider(() => 'error', () => asked.push('failed')));
    registerRefresh('working', provider(() => 'ready', () => asked.push('working')));
    registerRefresh('inflight', provider(() => 'loading', () => asked.push('inflight')));
    registerRefresh('truncated', provider(() => 'partial', () => asked.push('truncated')));
    const p = await refreshStale('reconnect', base);
    eq(asked.join(','), 'failed', 'only the provider that actually failed is read again');
    eq(p.skipped.sort().join(','), 'inflight,truncated,working', 'the other three are recorded as skipped, not silently ignored');
    eq(p.declined, false, 'and the pass itself ran');
  }

  /* ── the four statuses, stated on their own ──────────────────────────── */
  {
    eq(needsRefetch('error'), true, "'error' is the only status worth asking again");
    eq(needsRefetch('loading'), false, "'loading' is a read already in flight");
    eq(needsRefetch('ready'), false, "'ready' worked; re-reading it is a refresh, not a recovery");
    eq(needsRefetch('partial'), false, "'partial' is a truncation the same query will reproduce");
  }

  /* ── 5 · writes go before reads ──────────────────────────────────────── */
  {
    resetRefreshers();
    const order: string[] = [];
    registerRefresh('log', provider(() => 'error', () => order.push('read')));
    await refreshStale('reconnect', { ...base, flushFirst: () => { order.push('write'); } });
    eq(order.join(','), 'write,read', "the member's queued sets are sent before the read that would show a server view without them");
  }
  {
    resetRefreshers();
    let read = false;
    registerRefresh('log', provider(() => 'error', () => { read = true; }));
    await refreshStale('reconnect', { ...base, flushFirst: () => Promise.reject(new Error('still refused')) });
    eq(read, true, 'a queue that will not send does not stop a read that would');
  }

  /* ── 3 · the ceiling ─────────────────────────────────────────────────── */
  {
    resetRefreshers();
    let reads = 0;
    // A provider that is permanently refused: it never leaves 'error'.
    registerRefresh('rls', provider(() => 'error', () => { reads += 1; }));
    for (let i = 0; i < 8; i += 1) await refreshStale('manual', base);
    eq(reads, 8, "a person asking is never told no — 'manual' has no ceiling");

    resetRefreshers();
    reads = 0;
    registerRefresh('rls', provider(() => 'error', () => { reads += 1; }));
    // Foreground passes, spaced far enough apart that the gap is not what stops them.
    let clock = 0;
    for (let i = 0; i < 8; i += 1) {
      clock += FOREGROUND_GAP_MS * 2;
      await refreshStale('foreground', { ...base, now: () => clock });
    }
    eq(reads, MAX_ATTEMPTS, 'a read that is permanently refused stops being re-run after the ceiling');
    const last = await refreshStale('foreground', { ...base, now: () => clock + FOREGROUND_GAP_MS * 2 });
    eq(last.givenUp.join(','), 'rls', 'and the pass says which provider it has given up on rather than pretending it was fine');
  }

  /* ── 4 · and gets its attempts back on a real edge ───────────────────── */
  {
    resetRefreshers();
    let reads = 0;
    registerRefresh('basement', provider(() => 'error', () => { reads += 1; }));
    let clock = 0;
    for (let i = 0; i < 5; i += 1) {
      clock += FOREGROUND_GAP_MS * 2;
      await refreshStale('foreground', { ...base, now: () => clock });
    }
    eq(reads, MAX_ATTEMPTS, 'the ceiling held while nothing had changed');
    await refreshStale('reconnect', { ...base, now: () => clock });
    eq(reads, MAX_ATTEMPTS + 1, 'the signal coming back is new information, and buys the read its attempts again');
    eq(attemptsFor('basement'), 1, 'counted from zero after the edge, not carried over');
  }

  /* ── an attempt is spent even when the refetch throws ────────────────── */
  {
    resetRefreshers();
    let reads = 0;
    registerRefresh('throws', {
      status: () => 'error',
      refetch: () => { reads += 1; throw new Error('reload blew up'); },
    });
    registerRefresh('after', provider(() => 'error'));
    let clock = 0;
    for (let i = 0; i < 6; i += 1) {
      clock += FOREGROUND_GAP_MS * 2;
      const p = await refreshStale('foreground', { ...base, now: () => clock });
      if (i === 0) eq(p.ran.join(','), 'throws,after', 'a refetch that throws does not stop the providers behind it');
    }
    eq(reads, MAX_ATTEMPTS, 'a refetch that throws still burns an attempt, or the ceiling only bounds the polite failures');
  }

  /* ── a provider that recovers starts counting from zero again ────────── */
  {
    resetRefreshers();
    let st: LoadStatus = 'error';
    let reads = 0;
    registerRefresh('flaky', provider(() => st, () => { reads += 1; }));
    let clock = 0;
    const fg = async (): Promise<RefreshPass> => {
      clock += FOREGROUND_GAP_MS * 2;
      return refreshStale('foreground', { ...base, now: () => clock });
    };
    await fg(); await fg();
    eq(attemptsFor('flaky'), 2, 'two failures counted');
    st = 'ready';
    await fg();
    eq(attemptsFor('flaky'), 0, 'seeing it work clears the count');
    st = 'error';
    await fg(); await fg(); await fg();
    eq(reads, 5, 'so the next failure gets a full ceiling of its own rather than inheriting the old one');
  }

  /* ── the foreground floor ────────────────────────────────────────────── */
  {
    eq(mayRunNow('foreground', 0, FOREGROUND_GAP_MS - 1), false, 'flicking back to the app twice in a second does not re-read twice');
    eq(mayRunNow('foreground', 0, FOREGROUND_GAP_MS), true, 'and does once the floor has passed');
    eq(mayRunNow('reconnect', 0, 0), true, 'the reconnect edge is never rate limited — it is the one carrying news');
    eq(mayRunNow('manual', 0, 0), true, 'nor is a person asking');
    eq(attemptsAllow('manual', 99), true, 'a person asking is never given up on');
    eq(attemptsAllow('foreground', MAX_ATTEMPTS - 1), true, 'under the ceiling');
    eq(attemptsAllow('foreground', MAX_ATTEMPTS), false, 'at the ceiling');
  }

  {
    resetRefreshers();
    let reads = 0;
    registerRefresh('a', provider(() => 'error', () => { reads += 1; }));
    let clock = 1_000_000;
    await refreshStale('foreground', { ...base, now: () => clock });
    const second = await refreshStale('foreground', { ...base, now: () => clock + 1_000 });
    eq(reads, 1, 'a second foreground a second later does not run');
    eq(second.declined, true, 'and says so rather than reporting an empty pass as a successful one');
  }

  /* ── nothing is attempted while we know we cannot reach the server ───── */
  {
    resetRefreshers();
    let reads = 0;
    registerRefresh('a', provider(() => 'error', () => { reads += 1; }));
    const p = await refreshStale('reconnect', { ...base, canRead: () => false });
    eq(reads, 0, 'under a known-offline phone every refetch would fail and cost an attempt for nothing');
    eq(p.declined, true, 'and the pass reports that it declined');
    eq(attemptsFor('a'), 0, 'a pass that never ran must not spend the ceiling');
  }

  /* ── 6 · staggered, not fired all at once ────────────────────────────── */
  {
    resetRefreshers();
    const paused: number[] = [];
    for (const k of ['a', 'b', 'c']) registerRefresh(k, provider(() => 'error'));
    await refreshStale('reconnect', {
      ...base, pauseMs: 250, pause: async (ms) => { paused.push(ms); },
    });
    eq(paused.length, 2, 'three providers are separated by two pauses — the first goes immediately');
    eq(paused.every((m) => m === 250), true, 'and each pause is the interval asked for');
  }

  /* ── single flight, and the trigger that arrives mid-pass ────────────── */
  {
    resetRefreshers();
    let reads = 0;
    let release: () => void = () => { /* replaced */ };
    const gate = new Promise<void>((r) => { release = r; });
    registerRefresh('slow', {
      status: () => 'error',
      refetch: async () => { reads += 1; await gate; },
    });
    const first = refreshStale('manual', base);
    await Promise.resolve();
    const second = refreshStale('manual', base);
    eq(first === second, true, 'a trigger during a pass joins it rather than starting a second over the same providers');
    release();
    await first;
    eq(reads, 2, 'and is not dropped either: one more pass runs, because a provider may have failed after this one read its status');
  }

  /* ── registration, the four hazards the write side already states ───── */
  {
    resetRefreshers();
    eq(refresherCount(), 0, 'nothing is registered to begin with');
    let which = '';
    const offFirst = registerRefresh('log', provider(() => 'error', () => { which = 'first'; }));
    registerRefresh('log', provider(() => 'error', () => { which = 'second'; }));
    eq(refresherCount(), 1, 'the same key replaces rather than accumulating');
    await refreshStale('manual', base);
    eq(which, 'second', 'and it is the latest registration that runs, not the closure over the previous account');
    offFirst();
    eq(refresherCount(), 1, "an unregister from the superseded effect must not delete the registration that took it over");
  }
  {
    resetRefreshers();
    let reads = 0;
    const off = registerRefresh('gone', provider(() => 'error', () => { reads += 1; }));
    off();
    await refreshStale('manual', base);
    eq(reads, 0, 'an unmounted provider is not asked to set state on a tree that is gone');
  }

  /* ── noteEdge on its own, for the sign-out path ──────────────────────── */
  {
    resetRefreshers();
    registerRefresh('a', provider(() => 'error'));
    await refreshStale('manual', base);
    eq(attemptsFor('a'), 1, 'one attempt spent');
    noteEdge();
    eq(attemptsFor('a'), 0, 'and clearing the counters does not need a pass to be run');
  }

  resetRefreshers();

  if (errors.length) {
    console.error(`readRefresh: ${errors.length} failure(s)`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('readRefresh: ok');
}

void run();
