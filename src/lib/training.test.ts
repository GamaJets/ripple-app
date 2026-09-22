// A deload prompt that a clocks change can turn on or off.
//
// `deloadCheck` buckets training by LOCAL calendar week and used to walk back
// through those buckets in fixed 604,800,000 ms steps. Two weeks a year are not
// that long, and on both of them the cursor lands in the wrong bucket:
//
//   · autumn — into the CURRENT, partial week, which the loop exists to skip;
//     the walk breaks at once and months of hard training read as none.
//   · spring — past a whole week, which is then never visited; a deload
//     somebody has just taken is invisible and they are told to take another.
//
// The file's own comment on `weekKey` makes this argument and fixed only the
// key. These are the cursor.
//
// TZ is set before anything imports, because `weekStartIso` and `todayISO` read
// the ambient zone and the whole point is a zone that has a clocks change.
process.env.TZ = 'America/New_York';

import { deloadCheck } from './training';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/** `n` training days in the week that contains `anchor`, one per day. */
function week(anchor: Date, days: number): WorkoutEntry[] {
  const out: WorkoutEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    d.setHours(18, 0, 0, 0);
    out.push({ id: `${d.toISOString()}-${i}`, t: d.toISOString(), exercise: 'Back Squat', sets: [[5, 100]] } as unknown as WorkoutEntry);
  }
  return out;
}

/* ── 1. autumn: the fall-back must not hide months of training ───────────── */

{
  // Sat 7 Nov 2026 23:30 local. The clocks went back on Sun 1 Nov.
  const now = new Date(2026, 10, 7, 23, 30).getTime();
  const log: WorkoutEntry[] = [];
  // 13 solid weeks ending Sat 31 Oct, 5 days each.
  for (let w = 0; w < 13; w++) {
    const sat = new Date(2026, 9, 31); sat.setDate(sat.getDate() - w * 7);
    log.push(...week(sat, 5));
  }
  log.push(...week(new Date(2026, 10, 7), 2));   // this week, partial
  const d = deloadCheck(log, now);
  ok(d.hardWeeks >= 6, `13 solid weeks must not read as ${d.hardWeeks} across a fall-back`);
  eq(d.due, true, 'and a deload is due');
}

/* ── 2. spring: the week somebody deloaded must not be skipped ───────────── */

{
  // Sun 15 Mar 2026 00:30 local. The clocks went forward on Sun 8 Mar.
  const now = new Date(2026, 2, 15, 0, 30).getTime();
  const log: WorkoutEntry[] = [];
  for (let w = 0; w < 12; w++) {
    const sat = new Date(2026, 2, 7); sat.setDate(sat.getDate() - w * 7);
    log.push(...week(sat, 5));
  }
  log.push(...week(new Date(2026, 2, 14), 1));   // the deload week — ONE day
  const d = deloadCheck(log, now);
  eq(d.due, false, 'a deload week that was actually taken stops the count');
  eq(d.hardWeeks, 0, 'and the walk breaks on it rather than stepping over it');
}

/* ── 3. the ordinary case, away from any clocks change ───────────────────── */

{
  const now = new Date(2026, 5, 20, 12, 0).getTime();   // Sat 20 Jun
  const log: WorkoutEntry[] = [];
  for (let w = 0; w < 8; w++) {
    const sat = new Date(2026, 5, 13); sat.setDate(sat.getDate() - w * 7);
    log.push(...week(sat, 4));
  }
  const d = deloadCheck(log, now);
  ok(d.hardWeeks >= 6, 'eight solid weeks in midsummer still count');
  eq(d.due, true, 'and still suggest a deload');
}

/* ── 4. nothing logged is not a deload ──────────────────────────────────── */

eq(deloadCheck([], Date.now()).due, false, 'an empty log suggests nothing');
eq(deloadCheck([], Date.now()).hardWeeks, 0, 'and counts nothing');

if (errors.length) {
  console.error('training.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('training.test.ts — ok');
