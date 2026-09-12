// Group-class attendance: the trainer checks members into a class so they get paid
// per attendee. Backed by the class_roster / set_class_attendance RPCs.
//
// No demo fallback. This screen decides who gets paid for what — showing invented
// attendees on it was worse than showing nothing, and setAttendance silently
// no-opped for those fake ids, so the trainer ticked six strangers present and
// the owner's payroll recorded zero.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { capLimit, isTruncated } from './rowCap';

export interface RosterMember { userId: string; name: string; status: string; attended: boolean }


/**
 * The id the check-in screen stands in with when it was routed to without one.
 *
 * It exists so both functions below can refuse it by name. A screen that does
 * not know which class it is looking at must not read a roster and must not
 * write attendance — the reads would answer about nothing and the writes would
 * be silently discarded while the trainer watched ticks land.
 */
export const UNLINKED_CLASS = 'unlinked';

/**
 * Load a class's booked members with their attendance.
 *
 * `[]` means nobody booked. **`null` means we could not find out** — and the two
 * must not be shown the same way, because this screen renders an empty roster
 * under "No one has booked this class yet", which is a confident statement
 * about a class made by code that never managed to read it. A trainer who
 * believes it stops checking anybody in, and nobody gets paid for the class.
 */
export async function classRoster(classId: string): Promise<RosterMember[] | null> {
  if (!USE_SUPABASE || !classId || classId === UNLINKED_CLASS) return null;
  try {
    const { data, error } = await supabase.rpc('class_roster', { p_class: classId });
    // The RPC resolves with { data, error } rather than throwing, so the old
    // `const { data }` could not tell a refusal from an empty class.
    if (error || !Array.isArray(data)) return null;
    return data.map((r: any) => ({ userId: String(r.user_id), name: String(r.name || 'Member'), status: String(r.status || 'booked'), attended: !!r.attended }));
  } catch { return null; }
}

// ── `setAttendance` lived here, and is gone ──────────────────────────────
//
// It called `set_class_attendance` directly and returned a boolean, and the
// boolean was the defect: it collapsed the two answers that matter in a gym
// basement into one. A refusal the server MADE and a request that never reached
// it both came back `false`, the screen said "that change did not save" for
// both, and a coach with no signal was right to believe it and wrong about what
// to do next. Attendance is what a trainer is paid on.
//
// `app/(trainer)/class-checkin.tsx` now ticks through the floor queue
// (`{ kind: 'class-attendance' }`), which keeps them apart: a refusal leaves the
// row where it was, and a request nobody answered is kept on the phone and goes
// up on the next launch with signal — with a banner saying plainly that the gym
// cannot see it yet, because a trainer who believes the gym has the attendance
// does not check it.
//
// The dead-export ratchet carried this as "either the register saves through
// this or it goes". It is the second half: the register already saves through
// something better, and wiring this would route the one write the queue exists
// for straight past it. `UNLINKED_CLASS` is still refused by name — the queue's
// sender does it, on the same argument this function made.

// ── Owner analytics + payroll ──────────────────────────────────────────────
// The row shape and the rate maths live in classRates.ts, which imports
// nothing — see the note at the top of that file.
export { summariseClassRows, type ClassSummaryRow, type ClassRates } from './classRates';
import type { ClassSummaryRow } from './classRates';

/**
 * Class attendance over a date range for payroll + analytics (owner-wide).
 *
 * `[]` means no classes ran in that range. **`null` means the range could not
 * be read** — and the payroll hero on class-analytics is computed from this, so
 * the difference is the difference between "nobody is owed anything this week"
 * and "we do not know what anybody is owed".
 *
 * ── Why the RPC is capped, and why a truncated range is also null ──────────
 *
 * This was a bare `.rpc(...)` with no bound of any kind, and PostgREST answers
 * an unbounded request with at most 1000 rows while saying nothing about it
 * (see src/lib/rowCap.ts). One row here is one CLASS, and the two callers
 * aggregate: `summariseClassRows` prices the whole set into the Trainer Payroll
 * hero on app/(owner)/class-analytics.tsx, and app/(trainer)/my-register.tsx
 * counts a coach's own teaching from it. A busy timetable crosses a thousand
 * classes inside a 90-day range — five studios, ten classes a day, is 900 in a
 * quarter before anything unusual happens — and the read came back at exactly
 * that, cleanly, as a subtotal presented in the type used when it is whole. The
 * owner pays it.
 *
 * `class_attendance_summary` was checked for a `limit` of its own, because a
 * ceiling written INSIDE a `create function` body is invisible to everything in
 * rowCap.ts — the server can never answer with cap + 1 no matter what the
 * client asks — and `scripts/check-sql-caps.mjs` exists for exactly that pair.
 * Its effective definition (supabase/parts/460, the highest-numbered one) ends
 * `order by gc.starts_at desc` and carries no `limit`, so there is no server
 * ceiling to mirror and no constant to pair: the cap is PostgREST's own, and
 * the probe row is the right instrument.
 *
 * A truncated read joins `null` rather than becoming a fifth answer, and that
 * is a deliberate limit on this change rather than an oversight. Both callers
 * are built on `ClassSummaryRow[] | null` and both already render null as "this
 * could not be read", which is a true sentence about a truncated range — the
 * rows are real, but the SET is a prefix, and every figure either screen draws
 * from it is a total. A 'partial' answer would need somewhere on both screens
 * to say what a partial payroll total means, and there is no honest sentence
 * for "this is some of what you owe" on a screen an owner pays from.
 */
export async function classSummary(fromISO: string, toISO: string): Promise<ClassSummaryRow[] | null> {
  if (USE_SUPABASE) {
    try {
      const { data, error } = await supabase
        .rpc('class_attendance_summary', { p_from: fromISO, p_to: toISO })
        .limit(capLimit());
      // The RPC resolves with { data, error }; the old `const { data }` could
      // not tell a refusal from a quiet week, and both became [].
      if (error) return null;
      // One row more than we are willing to accept came back, so the range is
      // larger than the read. Refused, not trimmed: a prefix of a payroll range
      // is not a smaller payroll figure, it is a wrong one.
      if (isTruncated(data as unknown[] | null)) return null;
      if (Array.isArray(data)) return data.map((r: any) => ({
        classId: String(r.class_id), title: String(r.title || 'Class'), kind: String(r.kind || ''),
        branch: String(r.branch || '—'), trainerId: String(r.trainer_id || ''), trainerName: String(r.trainer_name || 'Trainer'),
        startsAt: String(r.starts_at || ''), capacity: Number(r.capacity || 0),
          booked: Number(r.booked || 0), attended: Number(r.attended || 0),
          // Part 460's column. Left UNDEFINED rather than coerced to zero on a
          // database that does not have it yet: "nobody walked in" is a claim,
          // and `summariseClassRows` withholds the total rather than making it.
          waitlistAttended: typeof r.waitlist_attended === 'number' ? r.waitlist_attended : undefined,
      }));
      // No error and no array. `class_attendance_summary` returns SETOF, so this
      // should not happen — but the previous version fell through this branch to
      // the `return []` below, which is the offline path's honest "no classes"
      // and is a fabricated one here. Unknown is null, as everywhere else.
      return null;
    } catch { return null; }
  }
  // No rows means no classes in range. Return that honestly rather than
  // falling back to DEMO_SUMMARY, which rendered invented attendance figures.
  return [];
}
