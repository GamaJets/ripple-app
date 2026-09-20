// The intent that has to survive a tab switch. Compile with tsc, run with node.
//
// The failure being guarded is not a wrong URL. It is two presses producing the
// SAME url — because the receiving screen reacts to the param changing, and a
// param that does not change is a Start Workout that does nothing, which is the
// report this module was written for.
import { trainIntent, isTrainRoute } from './trainIntent';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
const eq = (a: unknown, b: unknown, m: string) =>
  ok(Object.is(a, b), `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TRAIN = '/(client)/workouts';

/* ── the intent is attached, and is reachable by the receiving screen ────── */

{
  const u = trainIntent(TRAIN);
  ok(u.startsWith(TRAIN + '?'), 'the path is unchanged and the intent is a query param');
  ok(/[?&]start=[a-z0-9]+/.test(u), 'and the param the Train screen reads is named start');
}

/* ── two presses are two arrivals ───────────────────────────────────────── */

// THE test. `?start=1` would pass every other assertion in this file and still
// leave the second press of Start Workout doing nothing at all.
{
  const seen = new Set<string>();
  for (let i = 0; i < 50; i += 1) seen.add(trainIntent(TRAIN));
  eq(seen.size, 50, 'fifty presses produce fifty distinct urls, so none of them is a no-op');
}

/* ── a more specific intent is carried, not overwritten ─────────────────── */

{
  const u = trainIntent(TRAIN, 'recovery');
  ok(/[?&]mode=recovery/.test(u), 'a named mode rides along, so ?mode=recovery still means recovery');
  ok(/[?&]start=/.test(u), 'and it is still an arrival');
}
ok(!/mode=/.test(trainIntent(TRAIN)), 'no mode named, no mode param — the screen falls back to the program itself');

/* ── everything that is not Train is left exactly alone ─────────────────── */

// The Home card is adaptive: the same control goes to Recovery or to Meals on
// other days. A start param on those is meaningless and would end up in a deep
// link somebody pastes.
eq(trainIntent('/(client)/nutrition'), '/(client)/nutrition', 'the Meals route is untouched');
eq(trainIntent('/(client)/recovery'), '/(client)/recovery', 'and so is Recovery');

ok(isTrainRoute(TRAIN), 'the Train route is the Train route');
ok(isTrainRoute(TRAIN + '?mode=cardio'), 'and still is with params already on it');
ok(!isTrainRoute('/(client)/workouts-archive'), 'a route that merely starts with it is NOT — this is a path check, not a substring one');
ok(!isTrainRoute('/(client)/nutrition'), 'and Meals is not Train');

// A route already carrying params keeps them.
{
  const u = trainIntent(TRAIN + '?mode=cardio');
  ok(/mode=cardio/.test(u), 'existing params survive');
  ok(/\?mode=cardio&start=/.test(u), 'and the intent is appended with & rather than a second ?');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('trainIntent: ok (every press is its own arrival, and only the Train route is touched)');
