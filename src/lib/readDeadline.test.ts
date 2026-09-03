// A first read that never answers gets an ending. Compile with tsc, run with node.
//
// The bug this guards: no request in this app carries a timeout, so a socket
// that accepts and then says nothing leaves a provider's LoadStatus at
// 'loading' for the life of the mount. Home then says "Reading your training
// log…" over dashes for ever, and the notice it already has written for a read
// that failed is unreachable. See src/lib/readDeadline.ts for the mechanism.
import { READ_DEADLINE_MS, stalled, escalate, withDeadline, type Deadlined } from './readDeadline';
import type { Timers } from './deadline';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the ceiling itself ────────────────────────────────────────────────── */

// Longer than the pull-to-refresh spinner's ceiling (MAX_SPIN_MS, 20s), and in
// that order on purpose: the wheel hands the gesture back first, and only then
// does the screen say the read failed. Reversed, "we couldn't read your log"
// would appear under a wheel still claiming to be reading it.
ok(READ_DEADLINE_MS > 20_000, 'the read ceiling is past the spinner ceiling');
// And far past any honest read on a mobile network — this must never cut off a
// request that was going to answer.
ok(READ_DEADLINE_MS >= 20_000 && READ_DEADLINE_MS <= 60_000, 'the read ceiling is a plausible wait, not a timeout in disguise');

/* ── stalled: only a read still in flight can be stalled ───────────────── */

ok(stalled('loading', READ_DEADLINE_MS), 'a read still in flight at the ceiling is stalled');
ok(stalled('loading', READ_DEADLINE_MS + 60_000), 'a read still in flight long past the ceiling is stalled');
ok(!stalled('loading', READ_DEADLINE_MS - 1), 'a read one millisecond short of the ceiling is not stalled');
ok(!stalled('loading', 0), 'a read that has just started is not stalled');

// The three settled statuses are facts about an answer that came back. How long
// it took is not one of them, and none of them may be turned into a failure by
// a clock.
for (const s of ['ready', 'partial', 'error'] as LoadStatus[]) {
  ok(!stalled(s, READ_DEADLINE_MS * 10), `'${s}' has settled and cannot be stalled`);
}

// A clock that jumped backwards — a manual change, an NTP correction, a phone
// carried across a date line with a user who fixes the time by hand — must not
// be read as evidence about a read that may have started a second ago.
ok(!stalled('loading', -1), 'a negative elapsed is not evidence of a stall');
ok(!stalled('loading', Number.NaN), 'an unreadable elapsed is not evidence of a stall');
// A missing or nonsensical ceiling means no ceiling, never an instant one.
ok(!stalled('loading', 1_000_000, 0), 'a zero ceiling does not fail every read at once');
ok(!stalled('loading', 1_000_000, Number.NaN), 'an unreadable ceiling does not fail every read at once');
// An explicit ceiling is honoured, so a caller with a different tolerance can
// state one.
ok(stalled('loading', 5_000, 5_000), 'an explicit ceiling is used when given');
ok(!stalled('loading', 4_999, 5_000), 'an explicit ceiling is not passed early');

/* ── escalate: what a screen publishes ─────────────────────────────────── */

eq(escalate('loading', true), 'error', 'a read past the ceiling is published as a failure');
eq(escalate('loading', false), 'loading', 'a read inside the ceiling is still loading');

// The point of the escalation stepping back on its own: a read that answers at
// thirty seconds publishes what it actually got, and the notice goes away
// without the member doing anything.
eq(escalate('ready', true), 'ready', 'a late answer that landed whole is ready, not an error');
eq(escalate('partial', true), 'partial', 'a late answer that was truncated is partial, not an error');
// 'partial' in particular must survive. It answered; the rows are real and the
// list may be shown. Escalating it would blank a list this app can show.
eq(escalate('partial', false), 'partial', 'a truncated read is never escalated');
eq(escalate('error', true), 'error', 'a read that already failed stays failed');
eq(escalate('error', false), 'error', 'a read that already failed stays failed inside the ceiling');

/* ── withDeadline ──────────────────────────────────────────────────────── */
//
// The timer and the DeadlineExceeded class live in src/lib/deadline.ts and are
// tested there. What is pinned here is the RETURN SHAPE this wrapper exists
// for: a client screen branching on a value rather than catching an exception,
// and the one kind of throw that must still reach it.

// A fake clock, so nothing here waits on a real timer and a twenty-five second
// ceiling can be crossed on demand.
type Timer = { fn: () => void; ms: number; cancelled: boolean };
const makeClock = () => {
  const armed: Timer[] = [];
  const timers: Timers = {
    setTimeout: (fn: () => void, ms: number) => { const t: Timer = { fn, ms, cancelled: false }; armed.push(t); return t; },
    clearTimeout: (h: unknown) => { (h as Timer).cancelled = true; },
  };
  return {
    timers,
    fire: () => { for (const t of armed) if (!t.cancelled) t.fn(); },
    live: () => armed.filter((t) => !t.cancelled).length,
    armedAt: () => armed.map((t) => t.ms),
  };
};

const settle = () => new Promise<void>((r) => { setImmediate(() => r()); });

(async () => {
  /* the answer arrives in time */
  {
    const clock = makeClock();
    const got = await withDeadline(Promise.resolve(7), { ms: 25_000, timers: clock.timers });
    eq(got.answered, true, 'a read that answers is answered');
    eq(got.answered ? got.value : null, 7, 'the value comes back untouched');
    eq(clock.live(), 0, 'the ceiling is cancelled once the read lands, so nothing fires later');
  }

  /* the read never answers — the captive-portal socket, exactly */
  {
    const clock = makeClock();
    const forever = new Promise<number>(() => {});
    const p = withDeadline(forever, { ms: 25_000, timers: clock.timers });
    eq(clock.armedAt()[0], 25_000, 'the ceiling is armed at the number it was given');
    let done = false;
    p.then(() => { done = true; });
    await settle();
    ok(!done, 'nothing resolves before the ceiling passes');
    clock.fire();
    const got = await p;
    eq(got.answered, false, 'a read that never answers comes back unanswered rather than hanging');
  }

  /* the default ceiling is the shared one */
  {
    const clock = makeClock();
    const p = withDeadline(new Promise<number>(() => {}), { timers: clock.timers });
    eq(clock.armedAt()[0], READ_DEADLINE_MS, 'a caller that names no ceiling gets the shared one');
    clock.fire();
    eq((await p).answered, false, 'and it fires');
  }

  /* a refusal is not a silence */
  {
    const clock = makeClock();
    const refused = new Error('row-level security');
    let threw: unknown = null;
    try {
      await withDeadline(Promise.reject(refused), { ms: 25_000, timers: clock.timers });
    } catch (e) { threw = e; }
    eq(threw, refused, 'a rejection that is not a deadline passes straight through, so a refusal stays distinguishable from a silence');
    eq(clock.live(), 0, 'the ceiling is cancelled by a rejection too');
  }

  /* a late answer after the ceiling has already won */
  {
    const clock = makeClock();
    let land: (v: number) => void = () => {};
    const late = new Promise<number>((r) => { land = r; });
    const p = withDeadline(late, { ms: 25_000, timers: clock.timers });
    clock.fire();
    const got = await p;
    eq(got.answered, false, 'the ceiling won');
    land(99);
    await settle();
    eq(got.answered, false, 'a late answer does not re-resolve a promise that already came back');
  }

  /* a late REJECTION after the ceiling has already won must not crash the app */
  {
    const clock = makeClock();
    let fail: (e: unknown) => void = () => {};
    const late = new Promise<number>((_r, j) => { fail = j; });
    const p = withDeadline(late, { ms: 25_000, timers: clock.timers });
    clock.fire();
    const got = await p;
    eq(got.answered, false, 'the ceiling won before the failure');
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    fail(new Error('too late'));
    await settle();
    await settle();
    process.off('unhandledRejection', onUnhandled);
    eq(unhandled, null, 'a read that fails after the ceiling does not crash the app with an unhandled rejection');
  }

  /* the shape a caller actually writes */
  {
    // Three reads in parallel, one of which never comes back — the ordinary
    // shape of a screen's `load()`. Promise.all on its own would never settle,
    // which is what left Session Credits on "Reading what pays for your
    // sessions…" with its own Try Again button gated behind `!loading`.
    const clock = makeClock();
    const both = withDeadline(Promise.all([Promise.resolve(1), new Promise<number>(() => {})]),
      { ms: 25_000, timers: clock.timers });
    clock.fire();
    const got: Deadlined<number[]> = await both;
    eq(got.answered, false, 'one read that never answers no longer holds the whole screen open');
  }

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`readDeadline: ok (ceiling ${READ_DEADLINE_MS}ms)`);
})();
