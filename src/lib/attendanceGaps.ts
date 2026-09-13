// Coach · the two numbers a coach opens an attendance record to find.
//
// ── what the record answered, and what was actually being asked ────────────
//
// src/lib/attendance.ts folds the register and the door log into one honest
// timeline, and app/(trainer)/client-attendance.tsx draws it: every visit, in
// order, with which record proves each one. It also reports a rhythm — days a
// week over the finished weeks inside the record.
//
// None of that is the question a coach opens it with. A coach opens somebody's
// attendance because they are deciding whether to ring them, and the two facts
// that decide it are:
//
//   · HOW LONG IS IT SINCE THEY CAME IN. Nineteen days is a phone call.
//     Three days is nothing.
//   · AND IS THAT UNUSUAL FOR THEM. Nineteen days from somebody who has never
//     gone more than six is a person who has stopped. Nineteen days from
//     somebody who trains in four-week blocks and takes a fortnight off between
//     them is a person doing what they always do, and ringing them about it is
//     the call that makes a coach look like they are not paying attention.
//
// Both were computable from `attendedDays()` — a sorted list of the days the
// record proves — and neither was computed. A weekly average cannot answer
// either of them: two visits a week on average is the same figure for somebody
// who comes every Tuesday and Thursday and for somebody who came fourteen times
// in July and has not been seen since.
//
// ── why a truncated read may answer one of them and not the other ──────────
//
// `fetchClientAttendance` reads newest-first and stops at PostgREST's ceiling
// (src/lib/rowCap.ts), so a truncated record is a PREFIX OF THE RECENT END:
// the newest day is real and the oldest ones are missing.
//
// That asymmetry is the whole reason these are two functions and not one
// figure. The current gap is measured from the newest day and survives the cut.
// The longest gap is a maximum over the WHOLE set, and the days that are gone
// are exactly the ones that could contain a bigger one — so on a cut record it
// is not a smaller answer, it is a wrong one, and "their longest gap was 11
// days" said about somebody whose real answer is 40 would tell a coach that a
// person who vanishes every winter has never missed a week. `longestGap` takes
// `whole` and returns null without it, the same shape `rhythm()` already uses
// two files away.
//
// Framework-free, no clock: `today` arrives as a bare local day from the
// caller, because a module that reads the clock cannot be asserted against a
// gap that ends on a particular Tuesday.
import { daysBetween, dwellMinutes, type AttendanceEvent } from './attendance';

/** A stretch of days between two days the record proves they were in. */
export interface Gap {
  /** Whole days from one visit to the next. Two visits on consecutive days is
   *  1: the count is the distance, not the number of days missed. */
  days: number;
  /** The bare local day they were last in before the gap. */
  from: string;
  /** The bare local day they came back. */
  to: string;
}

/**
 * The longest they have ever gone between visits, out of the record we hold.
 *
 * Null in three cases, and they are three different sentences the caller has to
 * be able to tell apart by asking its own questions — this returns null for all
 * three because none of them supports a figure:
 *
 *   · `whole` is false. See the header: a cut record cannot answer a maximum.
 *   · fewer than two days on record. One visit is a point, and a gap needs two.
 *     A first-week client has no longest gap, and 0 would say they have never
 *     missed a day.
 *   · the days will not parse, which is a bug rather than a fact about anybody.
 *
 * `days` arrives newest-first from `attendedDays()` and is sorted here anyway
 * rather than trusted: a maximum over a list assumed to be ordered is the kind
 * of thing that keeps working until somebody changes the sort two files away.
 */
export function longestGap(days: string[], whole: boolean): Gap | null {
  if (!whole) return null;
  const sorted = [...new Set(days.filter(Boolean))].sort();
  if (sorted.length < 2) return null;
  let best: Gap | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const n = daysBetween(sorted[i - 1], sorted[i]);
    if (n == null) return null;
    if (!best || n > best.days) best = { days: n, from: sorted[i - 1], to: sorted[i] };
  }
  return best;
}

/** How long it has been since they were last in, and whether that is already
 *  longer than they have ever gone before. */
export interface CurrentGap {
  /** Whole days since the newest day on record. 0 means they were in today. */
  days: number;
  /** The day they were last in. */
  since: string;
  /**
   * True when this open stretch is already longer than the longest COMPLETED
   * one on record — the fact that turns "nineteen days" into "nineteen days,
   * and they have never gone more than six".
   *
   * Null, never false, when there is no longest gap to compare against: an
   * unanswerable comparison is not a reassuring answer, and a false here would
   * render as "normal for them" about a client we know nothing about.
   */
  aRecord: boolean | null;
}

/**
 * Days since the last visit on record.
 *
 * Deliberately NOT gated on a whole read. The cut falls at the old end, the
 * newest day survives it, and withholding this figure from a coach because the
 * record is long is the opposite of the caution `longestGap` needs. A stale
 * read is a different matter and is the caller's to say — under 'error' the
 * events on screen are whatever was there before the failure, and nothing here
 * can tell.
 *
 * Null when there is nothing on record, which is the one case a zero would be a
 * lie about: 0 means they were in today.
 */
export function currentGap(days: string[], today: string, longest: Gap | null): CurrentGap | null {
  const sorted = [...new Set(days.filter(Boolean))].sort();
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const n = daysBetween(last, today);
  // A last visit in the future is a clock or a back-dated row, not a negative
  // gap. Nothing honest can be said about it, so nothing is.
  if (n == null || n < 0) return null;
  return { days: n, since: last, aRecord: longest ? n > longest.days : null };
}

/** One kind of session and how many times the record proves they did it. */
export interface MixRow { label: string; times: number }

/** What their attendance is actually made of. */
export interface ClassMix {
  /** Named kinds of class, commonest first, then alphabetically so two kinds on
   *  the same count hold a stable order between renders. */
  rows: MixRow[];
  /** Attendances at a class whose row this app could not read — rule 3 in
   *  src/lib/attendance.ts. Counted separately and NEVER folded into a named
   *  row or dropped: a coach reading "8 Reformer" when four of the eight are
   *  classes nobody could open is being told something we do not know. */
  unreadable: number;
  /** Times they came in and trained on the floor rather than at a class. Its
   *  own figure because it is its own fact, and because a gym that does not
   *  scan the door will always show 0 here — which is why the caller may not
   *  word it as time they did not spend training. */
  floor: number;
}

/**
 * Which classes this client actually goes to.
 *
 * Only `attended` events are counted. A booking is an intention and a waitlist
 * place is not even that, and an unmarked class is the register nobody ticked —
 * counting any of them here would answer "what do they turn up to" with what
 * they signed up for, which is the exact substitution src/lib/attendance.ts
 * exists to prevent.
 *
 * Grouped on the class's KIND where it has one and its title otherwise: kind is
 * the thing a coach means by "what do they do" — Pilates, Spin — and a title is
 * often a time of day, which would split one habit across five rows.
 */
export function classMix(events: AttendanceEvent[]): ClassMix {
  const counts = new Map<string, number>();
  let unreadable = 0;
  let floor = 0;
  for (const e of events) {
    if (e.outcome.kind !== 'attended') continue;
    if (e.source === 'floor') { floor++; continue; }
    const label = (e.klass?.kind ?? '').trim() || (e.klass?.title ?? '').trim();
    if (!label) { unreadable++; continue; }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([label, times]) => ({ label, times }))
    .sort((a, b) => b.times - a.times || a.label.localeCompare(b.label));
  return { rows, unreadable, floor };
}

/** An average, and how much of the record it was taken over. */
export interface Dwell {
  /** Whole minutes, averaged. */
  minutes: number;
  /** How many visits carried both an entry and an exit. */
  over: number;
  /** How many attendances did not, and are therefore not in the average. */
  without: number;
}

/**
 * How long they typically stay, over the visits that recorded both ends.
 *
 * `dwellMinutes` was already computed per row and printed per row, and never
 * averaged — so a coach could see that one Tuesday in March was 47 minutes and
 * could not see that this person's sessions have been getting shorter all year.
 *
 * The subset is reported beside the figure rather than hidden inside it, and
 * that is not decoration: `gym_visits.exited_at` is null for anybody still
 * inside AND for every gym whose door records entries only, so the average can
 * legitimately be over three visits out of forty. `without` is what lets the
 * caller say so. Null when nothing recorded both ends, because an average of no
 * measurements is not zero minutes.
 *
 * Gated on `whole` by the caller, not here, for the same reason `longestGap` is
 * gated at all: this one IS a mean over the set, and a mean over a prefix is a
 * figure about part of somebody's year presented as a figure about their year.
 */
export function averageDwell(events: AttendanceEvent[]): Dwell | null {
  let total = 0;
  let over = 0;
  let without = 0;
  for (const e of events) {
    if (e.outcome.kind !== 'attended') continue;
    const m = dwellMinutes(e.visit);
    if (m == null) { without++; continue; }
    total += m;
    over++;
  }
  return over ? { minutes: Math.round(total / over), over, without } : null;
}
