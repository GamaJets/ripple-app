// A heart rate that stopped moving must not look like a heart that did.
//
// The assertion this file is really for is section 2: that a sample old enough
// to explain "nothing is being updated" is reported as stale WITH its age, and
// that the sentence it produces never tells the member to reconnect the watch
// — which is the thing they already tried, which cannot work, and which is why
// the fault survived three attempts to fix it from the outside.
import { hrFreshness, hrAgeLabel, staleHrNote, HR_LIVE_WINDOW_MS } from './hrFreshness';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/* ── 1. a streaming watch reads as live ───────────────────────────────────── */

eq(hrFreshness(ago(0), NOW).state, 'live', 'a sample taken now is live');
eq(hrFreshness(ago(5_000), NOW).state, 'live', 'five seconds is what a watch workout actually writes');
eq(hrFreshness(ago(HR_LIVE_WINDOW_MS - 1), NOW).state, 'live', 'just inside the window is live');

/* ── 2. THE REPORT: a sample that stopped moving ──────────────────────────── */

{
  const f = hrFreshness(ago(10 * 60_000), NOW);
  eq(f.state, 'stale', 'ten minutes old is not a live heart rate');
  eq(f.ageMs, 10 * 60_000, 'and its age is carried, because the age IS the explanation');
  const note = staleHrNote(f.ageMs);
  ok(note.includes('10 min ago'), 'the sentence says how old');
  ok(/on the watch/i.test(note), 'and names the one thing that makes it stream');
  // The member tried this. It did nothing. Telling them to do it again is worse
  // than saying nothing at all.
  ok(!/reconnect|disconnect|re-?pair/i.test(note), 'and never tells them to reconnect the watch');
}

eq(hrFreshness(ago(HR_LIVE_WINDOW_MS + 1), NOW).state, 'stale', 'just outside the window is stale');

/* ── 3. no time is not an old time, and not a fresh one ───────────────────── */

eq(hrFreshness(null, NOW).state, 'unknown', 'no timestamp is unknown');
eq(hrFreshness(undefined, NOW).state, 'unknown', 'undefined reads the same');
eq(hrFreshness('not a date', NOW).state, 'unknown', 'and so does nonsense');
eq(hrFreshness(null, NOW).ageMs, null, 'with no age invented for it');

/* ── 4. a clock that disagrees is not a reading from the future ───────────── */

{
  const f = hrFreshness(new Date(NOW + 30_000).toISOString(), NOW);
  eq(f.state, 'live', 'a sample stamped ahead of us is treated as live');
  eq(f.ageMs, 0, 'with no negative age');
  eq(hrAgeLabel(-5), null, 'and a negative age has no wording at all');
}

/* ── 5. the wording ───────────────────────────────────────────────────────── */

eq(hrAgeLabel(0), '0s ago', 'seconds while it is seconds');
eq(hrAgeLabel(45_000), '45s ago', 'still seconds under a minute');
eq(hrAgeLabel(90_000), '2 min ago', 'minutes once it is minutes');
eq(hrAgeLabel(10 * 60_000), '10 min ago', 'and plainly');
eq(hrAgeLabel(60 * 60_000), 'over an hour ago', 'an hour is not "60 min"');
eq(hrAgeLabel(3 * 60 * 60_000), 'over 3 hours ago', 'and beyond that, hours');
eq(hrAgeLabel(null), null, 'nothing to say about no age');

/* ── 6. nothing here claims a number is wrong ─────────────────────────────── */

// A stale reading is a true reading of an earlier moment. The copy must not
// call it inaccurate, only old — the member's watch did not malfunction.
{
  const note = staleHrNote(5 * 60_000);
  ok(!/wrong|incorrect|inaccurate|error|fault/i.test(note), 'an old reading is old, not wrong');
}

if (errors.length) {
  console.error('hrFreshness.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('hrFreshness.test.ts — ok');
