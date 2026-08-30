// A coach reads what a client cannot do before writing what they will do.
// Compile with tsc, run with node.
//
// Asked for as: "the coach needs to acknowledge this before their workout
// program is built." These assertions pin the two ways that goes wrong — a
// gate that never opens, and a gate that opens once and stays open past the
// next disclosure.
import { guardInjuries, injuryKey } from './injuryGate';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const inj = (area: string, severity: Injury['severity'], note?: string): Injury =>
  ({ id: area + severity, area, severity, status: 'active', note, at: '2026-01-01T00:00:00Z' });

const knee = inj('knee', 'mild');
const shoulder = inj('shoulder', 'severe');

/* ── nothing to acknowledge ────────────────────────────────────────────── */

// The overwhelming case, and it must not put a wall in front of it.
ok(guardInjuries('ready', [], null, 'Priya').allowed, 'a client with no injuries is not gated');
ok(guardInjuries('error', [], null, 'Priya').allowed,
  'and a failed read of acknowledgements does not gate a client who has nothing to acknowledge');
ok(guardInjuries('loading', [], null, 'Priya').allowed, 'nor does a read still in flight');

/* ── the gate itself ───────────────────────────────────────────────────── */

const first = guardInjuries('ready', [knee], null, 'Priya');
ok(!first.allowed, 'an unacknowledged injury holds the assign control');
ok(first.label !== null && first.reason !== null, 'with a label and a sentence for the coach');
ok(first.reason!.includes('Priya'), 'addressed to this client by name');
ok(first.reason!.includes('an injury'), 'and singular for one');
ok(guardInjuries('ready', [knee, shoulder], null, 'Priya').reason!.includes('2 injuries'),
  'counted for more than one');

// Acknowledged: the same list opens the gate.
ok(guardInjuries('ready', [knee], [injuryKey(knee)], 'Priya').allowed,
  'acknowledging the disclosure opens the gate');

/* ── a new disclosure closes it again ──────────────────────────────────── */
//
// The whole reason the acknowledgement stores WHICH injuries. A bare
// timestamp would be satisfied forever by the first tap, and a shoulder
// disclosed later would be assigned around by a coach who never saw it.
const later = guardInjuries('ready', [knee, shoulder], [injuryKey(knee)], 'Priya');
ok(!later.allowed, 'a new disclosure closes the gate again');
ok(later.reason!.includes('since you last confirmed'), 'and says it is a change, not a first read');
eq(later.outstanding.length, 2,
  'confirming records the whole current list, not just the new part — a delta would drop the old one');

// A severity change is news. A client whose mild knee became severe has told
// the coach something, and the same area is not the same disclosure.
const worse = guardInjuries('ready', [inj('knee', 'severe')], [injuryKey(knee)], 'Priya');
ok(!worse.allowed, 'a disclosure that got worse is a new disclosure');

// Editing the NOTE is not news — it would otherwise re-gate the coach every
// time a client fixed a typo.
ok(guardInjuries('ready', [inj('knee', 'mild', 'reworded')], [injuryKey(knee)], 'Priya').allowed,
  'rewording a note does not re-gate the coach');

// Recovering from one does not. A shorter list is still covered, and the coach
// should be stopped by news rather than by good news.
ok(guardInjuries('ready', [knee], [injuryKey(knee), injuryKey(shoulder)], 'Priya').allowed,
  'recovering from an injury does not re-gate the coach');

/* ── unknown is refused, not assumed ───────────────────────────────────── */
//
// Same rule as the overwrite guard: a programme built without seeing an injury
// is not undone by finding out afterwards.
for (const status of ['loading', 'error', 'partial'] as const) {
  const g = guardInjuries(status, [knee], null, 'Priya');
  ok(!g.allowed, `an injury with a ${status} acknowledgement read is refused, not assumed acknowledged`);
  ok(g.outstanding.length === 0, `and ${status} offers nothing to confirm — there is nothing to confirm against`);
}
// Even a list that WOULD cover it: under error we do not know that list is
// complete.
ok(!guardInjuries('error', [knee], [injuryKey(knee)], 'Priya').allowed,
  'a matching list read under error is still not a confirmation');

/* ── the key ───────────────────────────────────────────────────────────── */

eq(injuryKey(knee), 'knee:mild', 'the key is area and severity');
ok(injuryKey(knee) !== injuryKey(inj('knee', 'severe')), 'severity is part of the identity');
ok(injuryKey(knee) === injuryKey(inj('knee', 'mild', 'a different note')), 'the note is not');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('injuryGate: ok');
