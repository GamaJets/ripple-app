// Re-reading a read that worked, because somebody else changed the answer.
//
// The assertions that matter are the refusals: never over a read in flight,
// never over one that failed, and not on every flick between apps. A refresh
// runs on top of a list the member is looking at, so each of those is a way of
// making a correct screen worse.
//
// Compile with tsc, then run under plain node.
import {
  landed, mayRefreshNow, shouldRefresh, registerLive, refreshLive, liveCount,
  resetLive, resetLiveClock, FOREGROUND_GAP_MS, CHANGE_DEBOUNCE_MS, NEVER,
} from './liveRead';
import { FOREGROUND_GAP_MS as RECOVER_GAP } from './readRefresh';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const stub = (status: LoadStatus) => {
  let calls = 0;
  return { r: { status: () => status, refetch: () => { calls += 1; } }, calls: () => calls };
};

/* ── 1. which reads are refreshed, and which are somebody else's job ──────── */

ok(landed('ready'), 'a read that worked has landed');
ok(landed('partial'), 'and so has a truncated one — the newest page is exactly what a coach changes');
ok(!landed('loading'), 'a read in flight has not landed');
ok(!landed('error'), 'and a failed one has not');

// `shouldRefresh` and `landed` must not be able to disagree; the screen and the
// pass both ask, and two answers is how one of them starts lying.
for (const s of ['ready', 'partial', 'loading', 'error'] as const) {
  eq(shouldRefresh(s), landed(s), `shouldRefresh agrees with landed on '${s}'`);
}

/* ── 2. the floor, and the one constant it must share ─────────────────────── */

// Imported from readRefresh rather than re-chosen. Two floors that drift apart
// is two different answers to "is a foreground transition worth a read".
eq(FOREGROUND_GAP_MS, RECOVER_GAP, 'the foreground floor is the same one the recover path uses');

ok(!mayRefreshNow('foreground', 1_000, 1_000 + FOREGROUND_GAP_MS - 1), 'a second foreground inside the floor is declined');
ok(mayRefreshNow('foreground', 1_000, 1_000 + FOREGROUND_GAP_MS), 'and allowed once the floor has passed');
ok(mayRefreshNow('foreground', NEVER, 5), 'nothing has run yet, so the first foreground is allowed');
ok(NEVER < 0, 'and "never" is a sentinel no clock can produce, not a small number');
ok(!mayRefreshNow('foreground', 0, 5), 'a run AT zero is an ordinary instant and is floored like any other');

// The three that carry news, or a person, are never floored.
for (const t of ['reconnect', 'changed', 'manual'] as const) {
  ok(mayRefreshNow(t, 1_000, 1_001), `'${t}' is not rate-limited`);
}

ok(CHANGE_DEBOUNCE_MS > 0, 'a burst of change events is gathered rather than run per event');

/* ── 3. the pass ──────────────────────────────────────────────────────────── */

{
  resetLive(); resetLiveClock();
  const a = stub('ready');
  const b = stub('partial');
  registerLive('a', a.r);
  registerLive('b', b.r);
  const pass = refreshLive('manual');
  eq(pass.ran.length, 2, 'both landed providers read again');
  eq(a.calls(), 1, 'the ready one was asked');
  eq(b.calls(), 1, 'and the truncated one');
  eq(pass.declined, false, 'and the pass was not declined');
}

// In flight and failed are skipped, and skipped for DIFFERENT stated reasons —
// the second is not a problem, it is src/lib/readRefresh.ts's problem.
{
  resetLive(); resetLiveClock();
  const flying = stub('loading');
  const broken = stub('error');
  registerLive('flying', flying.r);
  registerLive('broken', broken.r);
  const pass = refreshLive('manual');
  eq(pass.ran.length, 0, 'neither is refreshed');
  eq(flying.calls(), 0, 'a read in flight is never restarted — two hydrates race over one list');
  eq(broken.calls(), 0, 'and a failed read is not double-requested from here');
  eq(pass.skipped.find((s) => s.key === 'flying')?.why, 'in-flight', 'and the reason is stated');
  eq(pass.skipped.find((s) => s.key === 'broken')?.why, 'failed', 'separately for the failed one');
}

/* ── 4. one key, for a change event that names one provider ───────────────── */

{
  resetLive(); resetLiveClock();
  const a = stub('ready');
  const b = stub('ready');
  registerLive('a', a.r);
  registerLive('b', b.r);
  refreshLive('changed', { only: 'a' });
  eq(a.calls(), 1, 'the named provider reads again');
  eq(b.calls(), 0, 'and nothing else is disturbed by somebody else’s row');
}

{
  resetLive(); resetLiveClock();
  const pass = refreshLive('changed', { only: 'nobody' });
  eq(pass.ran.length, 0, 'a change naming an unregistered provider does nothing');
  eq(pass.declined, false, 'and is not reported as a floor refusal, which it is not');
}

/* ── 5. registration by key replaces, and cleanup checks identity ─────────── */

{
  resetLive(); resetLiveClock();
  const first = stub('ready');
  const second = stub('ready');
  const offFirst = registerLive('k', first.r);
  registerLive('k', second.r);
  eq(liveCount(), 1, 'registering the same key twice leaves one registration');
  // The first cleanup must NOT remove the second registration — that is the
  // effect-re-run case, and losing it would silently stop refreshing.
  offFirst();
  eq(liveCount(), 1, 'the stale cleanup does not remove the live registration');
  refreshLive('manual');
  eq(second.calls(), 1, 'and it is the newest one that reads');
  eq(first.calls(), 0, 'not the one that was replaced');
}

/* ── 6. one provider throwing does not stop the rest ──────────────────────── */

{
  resetLive(); resetLiveClock();
  const good = stub('ready');
  registerLive('bad', { status: () => 'ready', refetch: () => { throw new Error('nope'); } });
  registerLive('good', good.r);
  const pass = refreshLive('manual');
  eq(good.calls(), 1, 'a provider that throws does not take the others down');
  ok(pass.ran.includes('good'), 'and the pass reports the one that ran');
}

// A status() that throws is skipped rather than crashing the pass.
{
  resetLive(); resetLiveClock();
  const good = stub('ready');
  registerLive('rude', { status: () => { throw new Error('nope'); }, refetch: () => {} });
  registerLive('good', good.r);
  refreshLive('manual');
  eq(good.calls(), 1, 'a provider whose status throws is stepped over');
}

/* ── 7. the floor applies to the PASS, not to each provider ───────────────── */

{
  resetLive(); resetLiveClock();
  const a = stub('ready');
  registerLive('a', a.r);
  const now = 100_000;
  refreshLive('foreground', { now: () => now });
  eq(a.calls(), 1, 'the first foreground reads');
  const second = refreshLive('foreground', { now: () => now + 1 });
  eq(second.declined, true, 'a foreground a millisecond later is declined');
  eq(a.calls(), 1, 'and nothing was read');
  refreshLive('foreground', { now: () => now + FOREGROUND_GAP_MS });
  eq(a.calls(), 2, 'and once the floor passes it reads again');
}

// A declined pass must not move the clock, or a stream of flicks would push the
// next allowed refresh further away for ever.
{
  resetLive(); resetLiveClock();
  const a = stub('ready');
  registerLive('a', a.r);
  refreshLive('foreground', { now: () => 0 });
  refreshLive('foreground', { now: () => 1 });
  refreshLive('foreground', { now: () => 2 });
  refreshLive('foreground', { now: () => FOREGROUND_GAP_MS });
  eq(a.calls(), 2, 'declined passes do not push the window along');
}

if (errors.length) {
  console.error(`liveRead.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('liveRead.test.ts — ok');
