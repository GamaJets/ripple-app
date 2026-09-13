// One session's time in heart-rate zones, collapsed out of a log that records
// it once per exercise.
//
// ── The duplication this exists to collapse ───────────────────────────────
//
// A guided session writes ONE ROW PER EXERCISE, and every one of those rows
// carries the SAME `zoneSecs` — see the write in app/(client)/workouts.tsx,
// where `zones` is attached to each entry the session produces. That is right
// for the row (each row is a complete record of the session it belongs to) and
// it is a trap for anything that draws them: a feed showing a zone strip per
// workout entry shows one forty-minute session five times over, once under
// each lift, and reads as if the member spent forty minutes in zone 4 on the
// bench and another forty on the squat.
//
// So the grouping key is the SESSION, which in this log is the timestamp: one
// session writes all of its exercises with the same `performed_at`, which is
// the same fact src/lib/mockData.ts relies on when it explains why edits and
// deletes match on `id` rather than on time and name.
//
// ── What is deliberately not merged ───────────────────────────────────────
//
// Two entries at one timestamp that disagree about their zones are NOT added
// together. Adding them would double a session's minutes, and a member cannot
// spend eighty minutes training in a forty-minute session. The first reading
// at that timestamp is taken and the rest are dropped as the copies they are.
// Where they genuinely differ — which no current write path produces — the
// first is still the honest answer for one session, and inventing a sum would
// be worse than picking one.
import { zoneSecondsTotal, type ZoneSeconds } from './hr';

/** One session that has heart-rate zones on it. */
export interface SessionZones {
  /** The session's timestamp, which is its identity in this log. */
  at: string;
  seconds: ZoneSeconds;
  /** Total recorded seconds across all five zones. Always > 0 — a session with
   *  none is not returned at all, because "no watch" and "no effort" are
   *  different things and neither is a strip of nothing. */
  total: number;
}

/** An entry as this module needs to see it. Structural on purpose: every
 *  caller has a `WorkoutEntry`, and nothing here needs the rest of it. */
interface Entry { t: string; zones?: ZoneSeconds }

/**
 * The sessions in this log that recorded zones, one entry each, newest first.
 *
 * @param log every workout entry, in any order.
 */
export function sessionZones(log: readonly Entry[]): SessionZones[] {
  const byTime = new Map<string, SessionZones>();
  for (const e of log) {
    // A timestamp is the key, so an entry without one cannot be grouped and is
    // not guessed at.
    if (!e.t || !e.zones) continue;
    const total = zoneSecondsTotal(e.zones);
    // Absent and zero are the same answer here — nobody measured — and both
    // are refused. The write path already omits `zones` rather than
    // zero-filling it for exactly this reason.
    if (!(total > 0)) continue;
    // First wins. See the header: the later rows are copies, not more training.
    if (!byTime.has(e.t)) byTime.set(e.t, { at: e.t, seconds: e.zones, total });
  }
  return [...byTime.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * The one line above the strip: how long, across how many zones.
 *
 * Minutes, because a strip is read at a glance and nobody reads seconds at a
 * glance — and rounded rather than floored, so a 29-second session is "under a
 * minute" rather than "0 min", which reads as a bug.
 */
export function sessionZonesLine(s: SessionZones): string {
  const zones = ([s.seconds.z1, s.seconds.z2, s.seconds.z3, s.seconds.z4, s.seconds.z5]
    .filter((v) => v > 0)).length;
  const mins = Math.round(s.total / 60);
  const time = mins < 1 ? 'Under a minute' : `${mins} min`;
  return `${time} recorded across ${zones} zone${zones === 1 ? '' : 's'}`;
}
