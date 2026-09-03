// Member churn — joiners, leavers, and the rate between them.
//
// ── Why this is a module and not a screen ──────────────────────────────────
//
// The console's /analytics page worked this out and nothing else could. The
// owner's phone has a tab called Growth whose every figure counts TRAINERS,
// and it said so out loud rather than answering the question underneath it:
// "member churn is not on this screen and is not derived anywhere on this
// handset". That was true and it was the defect — the number a gym owner runs
// the business on could only be got at from a laptop.
//
// The arithmetic is the same arithmetic either way, so it is written once. A
// console and a handset that each derive churn from the same rows must not be
// able to land on two different figures, and the only way to guarantee that is
// for there to be one derivation. Framework-free — no React, no Supabase
// client, nothing that cannot run under plain node — so the tests exercise the
// exact code both surfaces render.
//
// ── The two dates the record actually holds ────────────────────────────────
//
// `memberships.started_on` and `memberships.ends_on`. There is no
// `cancelled_at`: `status` moves to 'cancelled' in place, so a member who left
// in March and one who left last week are the same row today unless somebody
// wrote an end date. That is a real limit and this module's job is to be
// honest about it rather than to route around it — see `undatedExit`, which is
// what withholds a month's rate instead of quietly reporting a smaller one.
//
// ── And one rate that was not a rate ───────────────────────────────────────
//
// The denominator can only count somebody it has a join date for — "on the
// books before the 1st" is a question about a date — while the numerator once
// counted every departure. So a member whose start was never recorded was
// counted LEAVING and never counted PRESENT: in the numerator, absent from the
// denominator, having arrived in no month at all. That is not a rate, it errs
// upward in both directions at once, and it errs most at the gyms with the
// messiest records. Both halves are drawn from the same population here.
import { monthWindow, recentMonths, monthEnded, type MonthWindow } from './monthEnd';
import { rateOf, pointsPerMember, monthOfDate } from './gymRetention';

/**
 * The one membership field set this module reads.
 *
 * Structural rather than `Membership` from gymRecord, so a caller holding rows
 * of its own shape — and a test holding three literals — can pass them without
 * inventing plan ids and invoice links that nothing here looks at.
 */
export interface MembershipLike {
  memberId: string;
  memberName?: string | null;
  startedOn?: string | null;
  endsOn?: string | null;
  status: string;
}

/** How many months of joiners and leavers to draw. Thirteen so the same month
 *  last year is on screen — a gym with a January is not churning in January. */
export const MONTHS_SHOWN = 13;

/* ── the member spine ─────────────────────────────────────────────────────── */

/**
 * One person's whole history with the gym, from every membership row they hold.
 *
 * Built per member rather than per membership on purpose. Somebody who
 * cancelled in March and rejoined in June has two rows, and counting rows would
 * report them as two joiners and file the second under June — a gym that
 * recruits well and keeps nobody, assembled entirely out of its own returning
 * members. Their join month is the earliest start they have ever had.
 */
export interface MemberSpan {
  memberId: string;
  name: string | null;
  /** Earliest `started_on`, or null when no row carried a usable one. */
  joinedOn: string | null;
  /** Latest `ends_on`, and only when every membership they hold has one. */
  leftOn: string | null;
  /** Holds a membership that has not been given an end date and has not been
   *  cancelled — i.e. still on the books. */
  open: boolean;
  /** Holds a membership marked `active`. */
  active: boolean;
  /** Holds a cancelled or expired membership with NO end date. Their leaving
   *  month is unknown, and no month may be given credit for it. */
  undatedExit: boolean;
}

export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}/.test(s);

export function memberSpans(rows: MembershipLike[]): MemberSpan[] {
  const by = new Map<string, MemberSpan>();
  for (const m of rows) {
    const cur: MemberSpan = by.get(m.memberId) ?? {
      // `?? null` because `memberName` is optional on the input shape and
      // `undefined` is not one of the two states a span's name has. A name that
      // was never supplied and a name the record does not hold are the same
      // absence to every reader of this, and letting one of them through as
      // `undefined` is how a `name == null` check quietly stops matching.
      memberId: m.memberId, name: m.memberName ?? null, joinedOn: null, leftOn: null,
      open: false, active: false, undatedExit: false,
    };
    if (m.memberName && !cur.name) cur.name = m.memberName;

    // String comparison, not Date.parse. 'YYYY-MM-DD' compares correctly as
    // text, and parsing it produces UTC midnight — which read back as a local
    // month puts every member who joined on the 1st into the previous month
    // west of Greenwich. A whole cohort moved by a timezone.
    if (isDay(m.startedOn) && (cur.joinedOn == null || m.startedOn < cur.joinedOn)) {
      cur.joinedOn = m.startedOn.slice(0, 10);
    }

    if (m.status === 'active') cur.active = true;

    const ended = m.status === 'cancelled' || m.status === 'expired';
    if (!ended && !isDay(m.endsOn)) cur.open = true;
    if (ended && !isDay(m.endsOn)) cur.undatedExit = true;
    if (isDay(m.endsOn)) {
      const d = m.endsOn.slice(0, 10);
      if (cur.leftOn == null || d > cur.leftOn) cur.leftOn = d;
    }

    by.set(m.memberId, cur);
  }

  // Somebody with any membership still running has not left, whatever end date
  // an older row of theirs carries. Otherwise their leaving day is the last end
  // date they hold — unless one of their ended memberships has no date at all,
  // in which case the gym does not know when they went and this page will not
  // pick a month for them.
  return [...by.values()].map((s) => ({
    ...s,
    leftOn: s.open || s.undatedExit ? null : s.leftOn,
  }));
}

/* ── months ────────────────────────────────────────────────────────────────── */

export interface ChurnMonth {
  key: string;
  label: string;
  w: MonthWindow;
  running: boolean;
  joined: number;
  left: number;
  /** On the books on the first day of the month — the churn denominator. */
  opening: number;
  /**
   * Departures this month by members with NO usable join date.
   *
   * They are inside `left` — a person who leaves has left, whatever the record
   * says about their arrival — and they are the reason this month can have no
   * churn rate. See the ladder below.
   */
  undatedLeavers: number;
  /** joined − left, or null when the leavers are known to be incomplete. */
  net: number | null;
  churn: number | null;
  /** Why there is no churn rate. Empty when there is one. */
  churnNote: string;
}

export function churnMonths(
  spans: MemberSpan[], undatedExits: number, now: number, monthsShown: number = MONTHS_SHOWN,
): ChurnMonth[] {
  const keys = recentMonths(monthsShown, now);
  const out: ChurnMonth[] = [];

  for (const key of keys) {
    const w = monthWindow(key);
    if (!w) continue;
    const running = !monthEnded(w, now);

    const joined = spans.filter((s) => monthOfDate(s.joinedOn) === key).length;
    const left = spans.filter((s) => monthOfDate(s.leftOn) === key).length;

    /**
     * ── The two populations, which used to be different ────────────────────
     *
     * `left` above counts everybody who left this month. `opening` below counts
     * everybody on the books when it began — and it can only count somebody it
     * has a join date for, because "joined before the 1st" is a question about
     * a date. So a member whose start was never recorded was counted LEAVING
     * and never counted PRESENT: in the numerator, absent from the denominator,
     * having arrived in no month at all.
     *
     * That is not a rate. It is one population over another, it errs upward in
     * both directions at once, and it errs most at the gyms with the messiest
     * records — the ones whose churn figure is least likely to be checked
     * against anything.
     *
     * Both halves are fixed here. The numerator is restricted to the same
     * population as the denominator, so `churnable / opening` is a rate over
     * one set of people; and where that restriction actually dropped somebody,
     * the month withholds the rate rather than printing the smaller number,
     * because those departures happened and a figure that quietly leaves them
     * out understates churn exactly where the record is worst. The count is
     * carried out to the table so the owner is told which months, and how many.
     */
    const undatedLeavers = spans.filter(
      (s) => !isDay(s.joinedOn) && monthOfDate(s.leftOn) === key,
    ).length;
    const churnable = left - undatedLeavers;

    // On the books at the START of the month: joined before it began, and had
    // not left before it began. Somebody who joined and left inside the same
    // month is in neither the denominator nor the opening roster, which is the
    // standard treatment and is why the two counts are shown beside the rate.
    const opening = spans.filter(
      (s) => isDay(s.joinedOn) && s.joinedOn < w.firstDay && (s.leftOn == null || s.leftOn >= w.firstDay),
    ).length;

    // The churn rate, in the order the reasons disqualify it.
    let churn: number | null = null;
    let churnNote = '';
    if (running) {
      churnNote = 'still running — a partial month is not a low churn month';
    } else if (undatedExits > 0) {
      churnNote = `${undatedExits} ended membership${undatedExits === 1 ? ' has' : 's have'} no end date, so the leavers are incomplete`;
    } else if (undatedLeavers > 0) {
      // Above the size floor deliberately. This is not "too few to say"; it is
      // "the two halves are drawn from different people", and no denominator is
      // large enough to make that a rate.
      churnNote = `${undatedLeavers} left this month with no start date recorded, so they are in no opening roster to be a share of`;
    } else if (opening === 0) {
      churnNote = 'nobody was on the books when the month began';
    } else {
      // rateOf withholds anything under the shared floor, so this screen and
      // the Retention screen cannot disagree about "too small to say".
      churn = rateOf(churnable, opening);
      if (churn == null) {
        const p = pointsPerMember(opening);
        churnNote = `${opening} on the books — one leaver would move it ${p == null ? '—' : p.toFixed(1)} points`;
      }
    }

    out.push({
      key, label: w.label, w, running, joined, left, opening, undatedLeavers,
      // A net over an incomplete leaver count is a claim about the direction of
      // the roster made from half the evidence, and it always errs upward.
      //
      // `undatedLeavers` withholds it for the mirror-image reason, downward: a
      // member with no start date was in no month's joiner count and is in this
      // month's leaver count, so the net subtracts an arrival it never added.
      // The roster reads as shrinking by somebody who, on this page, never came.
      net: undatedExits > 0 || undatedLeavers > 0 ? null : joined - left,
      churn, churnNote,
    });
  }
  return out;
}

/* ── the counts a screen has to say out loud ───────────────────────────────── */

/**
 * Members whose LEAVING month the record does not hold.
 *
 * A cancelled or expired membership with no `ends_on`. They left; nothing says
 * when. Every month's rate is withheld while there is one of these, because the
 * leaver counts underneath the rate are known to be short and a rate over a
 * short numerator understates churn — the direction an owner is least likely to
 * question.
 */
export function undatedExitCount(spans: MemberSpan[]): number {
  return spans.filter((s) => s.undatedExit).length;
}

/**
 * Members with no usable JOIN date — they are in no opening roster and no
 * cohort. Counted so a screen can say how many, rather than silently drawing a
 * roster smaller than the gym.
 */
export function undatedJoinCount(spans: MemberSpan[]): number {
  return spans.filter((s) => !isDay(s.joinedOn)).length;
}

/** Members on the books today: holding something open, or marked active. */
export function onBooksCount(spans: MemberSpan[]): number {
  return spans.filter((s) => s.open || s.active).length;
}

/**
 * The most recent month that has actually FINISHED, or null when none of the
 * months on offer has.
 *
 * A partial month is not a low-churn month: the leavers it has not had yet have
 * not happened, and a rate over a fraction of a month always looks like good
 * news. `churnMonths` already refuses the running month a rate; this is the
 * same refusal at the level of "which month does a single headline figure
 * describe", so a handset with room for one number does not put the running one
 * there.
 */
export function lastClosedMonth(months: ChurnMonth[]): ChurnMonth | null {
  // `recentMonths` returns NEWEST first, and `churnMonths` preserves that
  // order, so the most recent finished month is the FIRST entry that is not
  // running. Walking from the other end would find the OLDEST month on screen
  // — thirteen months ago — and a headline labelled "September 2025" beside a
  // gym's current churn is a wrong number rather than an old one.
  for (const m of months) if (!m.running) return m;
  return null;
}

/**
 * One month's churn as a percentage figure and the sentence under it, in the
 * shape a hero tile takes: `figure` is null wherever the rate is withheld, and
 * `note` then says which of the reasons it was.
 *
 * The note is never empty and never optimistic. "—" over "still running" and
 * "—" over "4 left with no start date recorded" are different facts and an
 * owner acts differently on each.
 */
export interface ChurnHeadline {
  /** Percent, 0–100, or null when this month cannot carry a rate. */
  pct: number | null;
  /** Why there is no percentage, or what the percentage is over. */
  note: string;
  /** The month it describes, e.g. 'August 2026'. Null when there is no month. */
  label: string | null;
}

export function churnHeadline(m: ChurnMonth | null): ChurnHeadline {
  if (!m) {
    return {
      pct: null,
      label: null,
      // Not "0%". A gym whose months have not been read, or whose first month
      // has not finished, has no churn rate — and 0% is the best number on the
      // scale to show somebody who has no number at all.
      note: 'no finished month to measure yet',
    };
  }
  if (m.churn == null) return { pct: null, label: m.label, note: m.churnNote };
  return {
    pct: Math.round(m.churn * 100),
    label: m.label,
    note: `${m.left} of ${m.opening} on the books when ${m.label} began`,
  };
}
