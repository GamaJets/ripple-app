// The pull-to-refresh spinner, driven against a clock.
//
// ── The report ─────────────────────────────────────────────────────────────
//
// "I pull down to refresh and it keeps refreshing, wheel spinning."
//
// The version this replaces cleared the spinner in the last `.then()` of a
// promise chain — after the screen's reload had SETTLED, plus a floor. It has a
// `.catch()`, so a read that fails clears it; every branch it has is right. The
// case it has no branch for is a read that never comes back at all, and this
// app makes that case easy: `src/lib/supabase.ts` sends every request through
// `observedFetch`, which awaits `fetch` and re-throws, and there is no
// AbortController anywhere in this codebase. React Native's fetch has no
// default timeout, so a socket that is never answered is waited on for ever —
// which is precisely the gym wifi behind a captive portal and the hotel network
// that has stopped forwarding that src/lib/reachability.ts was written about.
//
// Two things follow, and the second is the worse one:
//
//   · `refreshing` is never set back to false, so the wheel spins until the app
//     is killed;
//   · the re-entry guard is cleared in that same final `.then()`, so it stays
//     set — and every later pull on that screen returns immediately and does
//     nothing. One hung read kills the gesture for the life of the screen.
//
// So the assertions below are about the two ends of the spin, not about the
// read: it starts, and it ALWAYS finishes. The clock is fake because the real
// one would make the ceiling case a twenty-second test.
//
// Compile with tsc, run with node.
import { makeRefresher, MAX_SPIN_MS, MIN_SPIN_MS } from './pullRefresh';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Every scheduled callback, fired only when the test says the time has come. */
function fakeClock() {
  let now = 0;
  let queue: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => { queue.push({ at: now + ms, fn }); },
    /** Move the clock, firing everything due on the way, in order. */
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        queue = queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

/** Let the promise chain run as far as it can on the current clock. */
const settle = () => new Promise<void>((r) => { setImmediate(r); });

/** A promise the test decides when to resolve — a read still on the wire. */
function held() {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

function rig(reload: () => void | Promise<unknown>) {
  const clock = fakeClock();
  const said: boolean[] = [];
  const r = makeRefresher({
    reload,
    setRefreshing: (on) => { said.push(on); },
    now: clock.now,
    schedule: clock.schedule,
  });
  /** What the RefreshControl would currently be showing. */
  const spinning = () => (said.length ? said[said.length - 1] : false);
  return { ...r, clock, said, spinning };
}

async function main() {
  /* ── the ordinary pull ─────────────────────────────────────────────────── */
  {
    let ran = 0;
    const t = rig(async () => { ran += 1; });
    t.onRefresh();
    eq(t.spinning(), true, 'the spinner comes up on the gesture');
    await settle();
    eq(ran, 1, 'the screen’s reload was run');
    eq(t.spinning(), true, 'a read that answered instantly does not snap the spinner away');
    t.clock.advance(MIN_SPIN_MS - 1);
    await settle();
    eq(t.spinning(), true, 'the floor is held');
    t.clock.advance(1);
    await settle();
    eq(t.spinning(), false, 'and then the spinner comes down');
    eq(t.busy(), false, 'and the gesture is handed back');
  }

  /* ── a read that failed still ends the spin ────────────────────────────── */
  {
    const t = rig(async () => { throw new Error('42501'); });
    t.onRefresh();
    await settle();
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'a rejected reload clears the refreshing state');
    eq(t.busy(), false, 'a rejected reload hands the gesture back');
  }
  {
    // Thrown synchronously rather than returned as a rejection — a reload built
    // out of `Promise.all([...])` throws before it has a promise if any one of
    // the calls it makes is not a function.
    const t = rig((() => { throw new Error('nope'); }) as () => void);
    t.onRefresh();
    await settle();
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'a reload that throws on the spot still clears the spinner');
  }

  /* ── a reload that returns nothing ─────────────────────────────────────── */
  {
    let ran = 0;
    const t = rig(() => { ran += 1; });
    t.onRefresh();
    await settle();
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(ran, 1, 'a void reload is still run');
    eq(t.spinning(), false, 'a void reload spins for the floor and no longer');
  }

  /* ── the report: a read that never comes back ──────────────────────────── */
  {
    const h = held();
    const t = rig(() => h.promise);
    t.onRefresh();
    await settle();
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), true, 'a read still on the wire keeps the spinner up, which is honest');
    t.clock.advance(MAX_SPIN_MS - MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'a read that never answers does not spin the wheel for ever');
    eq(t.busy(), false, 'and the gesture is handed back rather than left dead for the life of the screen');
  }

  /* ── and the gesture still works afterwards ────────────────────────────── */
  {
    const h = held();
    let ran = 0;
    const t = rig(() => { ran += 1; return ran === 1 ? h.promise : Promise.resolve(); });
    t.onRefresh();
    await settle();
    t.clock.advance(MAX_SPIN_MS);
    await settle();
    eq(ran, 1, 'the hung read ran once');
    t.onRefresh();
    await settle();
    eq(ran, 2, 'a second pull after a hang runs the reload again');
    eq(t.spinning(), true, 'and puts the spinner back up');
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'and that one finishes normally');
  }

  /* ── a pull that arrives mid-read is ignored, not queued ───────────────── */
  {
    const h = held();
    let ran = 0;
    const t = rig(() => { ran += 1; return h.promise; });
    t.onRefresh();
    await settle();
    t.onRefresh();
    t.onRefresh();
    await settle();
    eq(ran, 1, 'a second pull while the first read is in flight does not fire the read again');
    h.release();
    await settle();
    t.clock.advance(MIN_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'and the one spin still ends');
  }

  /* ── a hung read that answers LATE must not end somebody else's spin ───── */
  {
    const h = held();
    let ran = 0;
    const t = rig(() => { ran += 1; return ran === 1 ? h.promise : new Promise<void>(() => {}); });
    t.onRefresh();
    await settle();
    t.clock.advance(MAX_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'the first spin ended at the ceiling');
    // The coach pulls again, and only now does the first read come back.
    t.onRefresh();
    await settle();
    eq(t.spinning(), true, 'the second spin is up');
    h.release();
    await settle();
    t.clock.advance(0);
    await settle();
    eq(t.spinning(), true, 'the first read answering does not snap the second spinner away');
    eq(t.busy(), true, 'and does not hand the gesture back from under the second pull');
    t.clock.advance(MAX_SPIN_MS);
    await settle();
    eq(t.spinning(), false, 'the second spin ends on its own ceiling');
  }

  /* ── the two bounds ────────────────────────────────────────────────────── */
  {
    ok(MIN_SPIN_MS > 0 && MIN_SPIN_MS < 1000, 'the floor is long enough to be seen and short enough not to be waited on');
    ok(MAX_SPIN_MS > MIN_SPIN_MS * 10, 'the ceiling is far past any read that was going to answer');
  }

  if (errors.length) {
    console.error(`pullRefresh: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('pullRefresh: ok');
}

// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('pullRefresh — threw:', e); process.exit(1); });
