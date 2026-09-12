// Somebody with a connected watch must never be told to connect a watch.
//
// That is the whole of section 2, and it is the defect this module exists for:
// two screens held one fact and gave two answers, and the one the member was
// reading told them to do something they had already done.
import { watchReach, zonesNote } from './watchReach';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1. a reading that is arriving ────────────────────────────────────────── */

eq(watchReach(true, true, 'live'), 'live', 'a current reading is live');
eq(zonesNote('live'), null, 'and there is nothing to explain');

/* ── 2. THE REPORT: connected, and told to connect ────────────────────────── */

{
  const reach = watchReach(true, false, 'unknown');
  eq(reach, 'connected-silent', 'a connected source with no reading is not "no watch"');
  const note = zonesNote(reach)!;
  ok(!/^Connect a watch/.test(note), 'it does NOT open by telling them to connect a watch');
  ok(/on the watch/i.test(note), 'it names what actually makes an Apple Watch stream');
  ok(/Health app/i.test(note), 'and where to check permission, since HealthKit will not report it');
}

/* ── 3. nothing connected still gets the original sentence ────────────────── */

{
  const reach = watchReach(false, false, 'unknown');
  eq(reach, 'none', 'no local source is none');
  ok(/^Connect a watch/.test(zonesNote(reach)!), 'and that sentence is right for them');
}

/* ── 4. a cloud vendor is not a watch ─────────────────────────────────────── */

// WHOOP, Oura and Fitbit return day aggregates. Counting one as "connected"
// would promise live zones that cannot arrive, which is the same lie in the
// other direction.
eq(watchReach(false, false, 'unknown'), 'none',
  'a connected cloud vendor does not make localConnected true — the caller decides that, and this asserts the shape');

/* ── 5. a stale reading defers to the sentence beside the bpm ─────────────── */

{
  const reach = watchReach(true, true, 'stale');
  eq(reach, 'stale', 'a reading that stopped moving is stale, not silent');
  eq(zonesNote(reach), null, 'and the zones panel says nothing — staleHrNote already said it once');
}

// Stale beats connected-silent: there IS a reading, it is just old.
eq(watchReach(true, true, 'unknown'), 'stale',
  'a sample whose age is unknown is still a sample, and is not silence');

/* ── 6. no sentence blames the member or the device ───────────────────────── */

for (const r of ['connected-silent', 'none'] as const) {
  const note = zonesNote(r)!;
  ok(!/fail|error|broken|wrong|denied|refus/i.test(note), `${r}: nothing here calls anything broken`);
}

if (errors.length) {
  console.error('watchReach.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('watchReach.test.ts — ok');
