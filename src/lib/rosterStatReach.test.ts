// The roster's two "may this figure be spoken" rules.
//
// The assertion that matters is the negative one: under a read that FAILED, no
// input may produce the words "no activity yet". That sentence is what a coach
// acts on by chasing a client who has done nothing wrong, and it was being
// printed on every card whenever the scans, workouts or check-ins read was
// refused — because only truncation was being carried and a refusal was not.
//
// Starts at exit code 1 and only clears it on the last line, so a hang or an
// early return cannot pass silently.
//
// Compile with tsc, run with node.
process.exitCode = 1;

import {
  lastActiveCell, weightDeltaCell, reachIsWhole, STAT_UNKNOWN, NO_ACTIVITY_YET,
  type StatReach,
} from './rosterStatReach';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const WHOLE: StatReach = { truncated: false, failed: false };
const CUT: StatReach = { truncated: true, failed: false };
const BROKEN: StatReach = { truncated: false, failed: true };
/* A chunked read stops at the first chunk that fails, so rows from the earlier
 * chunks are in hand AND the rest were never asked for. Both at once is an
 * ordinary state, not a contradiction. */
const BOTH: StatReach = { truncated: true, failed: true };
const SHORT = [CUT, BROKEN, BOTH];

/* ── whole means whole ─────────────────────────────────────────────────── */
ok(reachIsWhole(WHOLE), 'a read that neither failed nor truncated is whole');
for (const r of SHORT) {
  ok(!reachIsWhole(r), `and nothing else is — ${JSON.stringify(r)}`);
}

/* ── the negative assertion, stated over every input ───────────────────────
 *
 * Not "the failed case returns a dash" but "no short read can produce that
 * sentence", so a future branch added to lastActiveCell has to clear this too.
 */
for (const r of SHORT) {
  for (const v of [null, undefined, '', '   ']) {
    eq(lastActiveCell(v, r), STAT_UNKNOWN,
      `a client absent from a short read is unknown, not quiet — ${JSON.stringify(v)} under ${JSON.stringify(r)}`);
    ok(lastActiveCell(v, r) !== NO_ACTIVITY_YET,
      `and never says "${NO_ACTIVITY_YET}" — ${JSON.stringify(v)} under ${JSON.stringify(r)}`);
  }
}

/* ── and the positive one, which is what stops the dash swallowing the lot ── */
eq(lastActiveCell(null, WHOLE), NO_ACTIVITY_YET,
  'under a whole read, absent from the page IS a fact about the client');
eq(lastActiveCell('', WHOLE), NO_ACTIVITY_YET,
  'a blank phrase is the same absence');

/* ── a figure in hand is always the answer ────────────────────────────────
 *
 * A client who appears in a capped page at all appears with their NEWEST row,
 * because the read is ordered newest-first. So the elapsed time is exact
 * however much of the set was missed, and suppressing it would throw away a
 * true figure.
 */
for (const r of [WHOLE, ...SHORT]) {
  eq(lastActiveCell('3d ago', r), '3d ago',
    `a phrase in hand survives every reach — ${JSON.stringify(r)}`);
}
eq(lastActiveCell('  45m ago  ', WHOLE), '45m ago', 'and is trimmed on the way out');

/* ── the weight delta forfeits on EITHER kind of short read ────────────────
 *
 * Its subtrahend is the client's FIRST scan, which is the row a newest-first
 * cap drops first. A delta computed from the tail is not a smaller number, it
 * is a wrong one, and often the wrong sign.
 */
for (const r of SHORT) {
  eq(weightDeltaCell(-4.2, r), null,
    `a short scans read forfeits the delta rather than reporting a partial one — ${JSON.stringify(r)}`);
  eq(weightDeltaCell(0, r), null,
    `including one that happens to be zero — ${JSON.stringify(r)}`);
}
eq(weightDeltaCell(-4.2, WHOLE), -4.2, 'a whole read reports the figure');

/* ── null is not zero ──────────────────────────────────────────────────────
 *
 * A client with one scan has no delta yet. The roster renders null as "no
 * change recorded" and 0 as a client who has held their weight exactly, and
 * those are two different things to say to a coach.
 */
eq(weightDeltaCell(null, WHOLE), null, 'one scan is no delta, not a delta of zero');
eq(weightDeltaCell(undefined, WHOLE), null, 'and neither is a missing entry');
eq(weightDeltaCell(0, WHOLE), 0, 'a real zero under a whole read is kept as a zero');

/* ── the character the downstream sentence matches on ────────────────────── */
eq(STAT_UNKNOWN, '—', 'the unknown marker is an em dash, which is what lastActiveLine matches');

if (errors.length) {
  for (const e of errors) console.error('FAIL: ' + e);
  console.error(`rosterStatReach.test — ${errors.length} failed`);
} else {
  console.log('rosterStatReach.test — ok');
  process.exitCode = 0;
}
