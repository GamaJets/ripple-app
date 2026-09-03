// The registers a coach never took, in the order they can still do something
// about them.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `gapNote` in src/lib/coachRegister.ts already tells a coach the true and
// useful half of this:
//
//     "4 classes had bookings and no register taken. They are left out of the
//      rate rather than counted as nobody turning up."
//
// And then stops. The sentence names a number and no classes; the screen it
// sits on (app/(trainer)/my-register.tsx) draws those same classes further down
// as flat text with a warn dot beside them; and the only control on the page is
// a Ghost that opens the whole timetable. So a coach who reads that sentence,
// agrees with it, and wants to fix it has to remember four dates, open Classes,
// scroll back through the term to each one, and open its check-in by hand — for
// a screen whose entire subject is that those four registers are missing.
//
// Nothing about the taking is blocked. `set_class_attendance`
// (supabase/parts/460) carries no time bound at all — its only test is that the
// class is one the caller may register — so a register taken on Thursday for
// Tuesday's class is written exactly like one taken at the door. The coach was
// simply never handed the tap.
//
// ── Why this matters more than a missing tick ─────────────────────────────
//
// An unregistered class is not a cosmetic hole in a rate. app/(trainer)/
// class-checkin.tsx opens with what those ticks ARE — "the checked-in count is
// what the owner's payroll and class analytics are built from" — and
// `paidHeadcount` in coachRegister.ts is the coach's own copy of the figure
// `classPayAmount` prices a per-attendee class on. A class taught to eleven
// people with nobody marked reaches the gym as a class with nobody in it. The
// coach is the only person who can still say otherwise, and until now the app
// told them the number of times that had happened and not which times.
//
// ── Pure, and why ─────────────────────────────────────────────────────────
//
// Same reason coachRegister.ts and classRegister.ts are pure: classAttendance.ts
// builds a Supabase client at import time and cannot be loaded under node, and
// every rule below is one that has to be asserted on rather than eyeballed.
//
// ── THE RULES ─────────────────────────────────────────────────────────────
//
// 1. NOTHING MARKED, AND SOMEBODY BOOKED. This is `splitTaught`'s
//    `unregistered` arm and it is deliberately the same test, not a second
//    opinion: a class nobody booked had no register to take, and a class with a
//    single walk-in ticked had one taken. Two functions disagreeing about which
//    classes are missing a register is how a screen comes to say "4" in a
//    sentence and list three.
//
// 2. A CLASS THAT HAS NOT STARTED IS NOT A REGISTER YOU FAILED TO TAKE. The
//    window `my-register.tsx` reads ends at `now`, so this should never fire —
//    which is exactly why it is written down. `rollingWindow`'s upper bound is
//    an argument passed to an RPC, and the day somebody widens that window to
//    "this month" to make the chips nicer, every class booked for next week
//    appears on a coach's screen as paperwork they have neglected. The rule is
//    cheap, it is testable, and the failure it prevents is one a coach would
//    act on by opening a register for a class that has not happened.
//
// 3. A CLASS WHOSE START CANNOT BE READ IS STILL A GAP. It is sorted last and
//    it is never dropped. The bookings on it are real whatever the column says,
//    and a list that quietly loses a class the coach taught is the one failure
//    this module must not have — it would read as "you have taken every
//    register", which is a claim, and a false one.
//
// 4. NEWEST FIRST, AND THE ORDER IS TOTAL. Recall decays, so the class a coach
//    can still register honestly is the most recent one. Ties break on
//    `classId` rather than being left to the sort's own stability, because two
//    classes at 6am is the ordinary case in a gym and a list that reshuffles
//    between two renders is one a thumb lands on the wrong row of.
//
// 5. THE FIGURE AT STAKE IS ALL-OR-NOTHING. `peopleWaiting` returns null the
//    moment any row's `booked` is not a number it can stand behind, for
//    `paidHeadcountTotal`'s stated reason: a partial total looks exactly like a
//    whole one and understates what the coach delivered, which is the direction
//    this figure must never be wrong in.
import type { ClassSummaryRow } from './classRates';
import { splitTaught } from './coachRegister';

/** One class the coach can still put a register against. */
export interface RegisterGap {
  classId: string;
  title: string;
  branch: string;
  /** As the row carried it. Passed straight to the check-in route and rendered
   *  by the screen's own date formatter — never reformatted here. */
  startsAt: string;
  /** How many people held a place. The thing that is missing from the gym's
   *  record, and the reason to bother. */
  booked: number;
}

/** Milliseconds since the epoch for an ISO instant, or null when it is not one. */
function instant(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * The classes with bookings and no register, newest first.
 *
 * `now` is the coach's own instant — the same one the screen's window is built
 * from — and is only ever used to drop classes that have not happened yet
 * (rule 2). It never decides that a register is too old to take: nothing in the
 * database thinks so, and a screen that hid a three-month-old gap would be
 * hiding the one the coach most needs to be told about.
 */
export function missingRegisters(
  rows: readonly ClassSummaryRow[],
  now: Date,
): RegisterGap[] {
  const nowMs = now.getTime();
  const cutoff = Number.isFinite(nowMs) ? nowMs : null;
  const out: { gap: RegisterGap; at: number | null }[] = [];
  for (const r of splitTaught(rows).unregistered) {
    const at = instant(r.startsAt);
    // Rule 2. An unreadable start is NOT excluded here — see rule 3; only a
    // start we can read AND that is in the future is.
    if (at != null && cutoff != null && at > cutoff) continue;
    out.push({
      at,
      gap: {
        classId: r.classId,
        title: r.title,
        branch: r.branch,
        startsAt: r.startsAt,
        booked: r.booked,
      },
    });
  }
  // Rule 4, and rule 3's "sorted last": a null start sorts after every readable
  // one, whichever side of the comparison it is on.
  out.sort((a, b) => {
    if (a.at == null && b.at == null) return a.gap.classId.localeCompare(b.gap.classId);
    if (a.at == null) return 1;
    if (b.at == null) return -1;
    return (b.at - a.at) || a.gap.classId.localeCompare(b.gap.classId);
  });
  return out.map((x) => x.gap);
}

/**
 * How many people are sitting in those classes unaccounted for, or null when
 * one of the rows cannot say.
 *
 * Rule 5. `booked` arrives through `Number(r.booked || 0)` in
 * src/lib/classAttendance.ts, so a column that came back as text or absent
 * lands here as NaN or 0 — and 0 is a real answer while NaN is not.
 */
export function peopleWaiting(gaps: readonly RegisterGap[]): number | null {
  let sum = 0;
  for (const g of gaps) {
    if (!Number.isFinite(g.booked) || g.booked < 0) return null;
    sum += g.booked;
  }
  return sum;
}

/**
 * The heading over the list, or null when there is nothing to head.
 *
 * Null and not "0 registers outstanding": a coach who has taken every register
 * should not be shown a section congratulating them on it every time they open
 * the screen. The absence IS the message.
 */
export function gapsHeading(gaps: readonly RegisterGap[]): string | null {
  const n = gaps.length;
  if (n === 0) return null;
  return n === 1 ? '1 register still open' : `${n} registers still open`;
}

/**
 * What those open registers cost, said once, above the list.
 *
 * Two claims and both are load-bearing:
 *
 *   · the gym reads these classes as nobody having attended. That is what
 *     `class_attendance_summary` returns for a class with no `attended_at`
 *     anywhere on it, and it is what `classPayAmount` prices a per-attendee
 *     class on.
 *   · it can still be fixed. `set_class_attendance` has no time bound.
 *
 * What it deliberately does NOT say is that taking the register will get the
 * coach paid. Whether a gym has already run its payroll for that period is a
 * fact this screen has not read and must not imply — `payroll_settlements` is
 * readable by the coach but it settles SESSIONS, and whether a gym folds class
 * pay into the same run is a thing each gym decides. So the sentence stops at
 * the record, which is the part this app can stand behind.
 */
export function gapsNote(gaps: readonly RegisterGap[]): string | null {
  if (gaps.length === 0) return null;
  const people = peopleWaiting(gaps);
  const who = people == null
    ? 'The people who booked them'
    : people === 1
      ? 'The 1 person who booked'
      : `The ${people} people who booked them`;
  return `${who} reach your gym's record as nobody having attended. A register has no closing time — open one and mark it now, and the class counts.`;
}

/**
 * The line under one open register.
 *
 * `booked` and nothing else. The screen already prints the date and the class's
 * own title above it, and the number of places held is the only fact here that
 * says how much is missing.
 */
export function gapLine(gap: RegisterGap): string {
  if (!Number.isFinite(gap.booked) || gap.booked < 0) {
    return 'Nobody was marked on this one, and how many booked could not be read.';
  }
  if (gap.booked === 1) return '1 person booked and nobody was marked.';
  return `${gap.booked} people booked and nobody was marked.`;
}
