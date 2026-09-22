// One session's zones, collapsed out of a per-exercise log. Run under node.
//
// The failure being guarded is the one the feed would otherwise ship: a guided
// session writes the SAME zone seconds onto every exercise row it produces, so
// anything drawing them per row shows one forty-minute session five times over.
import { sessionZones, sessionZonesLine } from './sessionZones';
import type { ZoneSeconds } from './hr';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
const eq = (a: unknown, b: unknown, m: string) =>
  ok(Object.is(a, b), `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const Z = (z1: number, z2: number, z3: number, z4: number, z5: number): ZoneSeconds => ({ z1, z2, z3, z4, z5 });
const T1 = '2026-09-12T09:00:00.000Z';
const T2 = '2026-09-13T09:00:00.000Z';

/* ── THE test: five rows of one session are one session ──────────────────── */

{
  const zones = Z(120, 600, 900, 300, 60);
  // Exactly what the runner writes: one row per exercise, same zones on each.
  const log = ['Bench Press', 'Overhead Press', 'Incline', 'Lateral Raise', 'Triceps']
    .map((exercise) => ({ t: T1, exercise, zones }));
  const out = sessionZones(log);
  eq(out.length, 1, 'five exercise rows of one session collapse to ONE strip');
  eq(out[0].total, 1980, 'and the total is the session’s, not five times it');
}

// Two genuinely different sessions stay two.
{
  const out = sessionZones([
    { t: T1, zones: Z(60, 0, 0, 0, 0) },
    { t: T2, zones: Z(0, 120, 0, 0, 0) },
  ]);
  eq(out.length, 2, 'different timestamps are different sessions');
  eq(out[0].at, T2, 'and the newest is first');
}

/* ── nobody measured is not zero effort ──────────────────────────────────── */

eq(sessionZones([{ t: T1 }]).length, 0, 'an entry with no zones is not a session with empty zones');
eq(sessionZones([{ t: T1, zones: Z(0, 0, 0, 0, 0) }]).length, 0,
  'and neither is one whose zones are all zero — a strip of nothing is not a reading');
eq(sessionZones([{ t: '', zones: Z(60, 0, 0, 0, 0) }]).length, 0, 'no timestamp, no session to group it under');
eq(sessionZones([]).length, 0, 'an empty log produces nothing rather than throwing');

// Never summed. A member cannot train eighty minutes inside a forty-minute
// session, and two rows at one timestamp are copies rather than more training.
{
  const out = sessionZones([
    { t: T1, zones: Z(600, 0, 0, 0, 0) },
    { t: T1, zones: Z(600, 0, 0, 0, 0) },
  ]);
  eq(out[0].total, 600, 'two rows at one timestamp are not added together');
}

/* ── the line above the strip ────────────────────────────────────────────── */

ok(/33 min/.test(sessionZonesLine({ at: T1, seconds: Z(120, 600, 900, 300, 60), total: 1980 })),
  'the headline is minutes, which is how a strip is read');
ok(/5 zones/.test(sessionZonesLine({ at: T1, seconds: Z(120, 600, 900, 300, 60), total: 1980 })),
  'and says how many zones were touched');
ok(/1 zone\b/.test(sessionZonesLine({ at: T1, seconds: Z(60, 0, 0, 0, 0), total: 60 })), 'one zone is singular');

// 29 seconds is not "0 min", which reads as a bug rather than as a short session.
ok(/Under a minute/.test(sessionZonesLine({ at: T1, seconds: Z(29, 0, 0, 0, 0), total: 29 })),
  'a session under a minute says so rather than printing a zero');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionZones: ok (one session is one strip, and an unmeasured session is not an empty one)');
