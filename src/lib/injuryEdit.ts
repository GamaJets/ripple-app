// Correcting a disclosure, and deleting one on purpose.
//
// ── What was here ────────────────────────────────────────────────────────
//
// app/(client)/injuries.tsx offered Mark Recovered, Reactivate and Delete, and
// nothing else — though `updateInjury` has always accepted any patch. So fixing
// a wrong severity or a typo in the note meant Delete and re-add, and that is
// not a wash: `newInjuryId()` mints a NEW id, and re-adding is a new disclosure
// with a new key. Nothing about the member's body changed and their coach's
// acknowledgement was thrown away anyway.
//
// And Delete was a bare button with no confirm in front of it, unlike every
// other destructive action in the client app. On a screen where the rows are a
// few pixels apart and one of them is the record that stops a coach programming
// through a torn shoulder.
//
// ── What an edit does to the coach's acknowledgement ─────────────────────
//
// `injuryKey` (src/lib/injuryGate.ts) is `area:severity`, and an
// acknowledgement covers the keys it was made against. That rule is not
// restated here — this module CALLS it — because the whole point of it living
// in one place is that the coach's gate and the client's screen cannot come to
// disagree about what "read" means.
//
// So the two kinds of edit are genuinely different and the screen must say so:
//
//   THE NOTE, or the STATUS       the key is unchanged. The coach's
//                                 confirmation still covers this disclosure and
//                                 is not disturbed. Fixing a typo does not
//                                 re-gate anybody, which is exactly the
//                                 behaviour injuryGate.test.ts already pins.
//
//   THE AREA, or the SEVERITY     the key changes, so the acknowledgement no
//                                 longer covers it and the coach is asked to
//                                 read it again before they can assign
//                                 anything. That is not a cost of editing. It
//                                 is the correct outcome: a mild knee that is
//                                 now severe is news, and the member should be
//                                 told their coach will see it as such.
//
// ── What this module deliberately does not touch ─────────────────────────
//
// The document. An injury may have been READ OFF a physiotherapy report
// (src/lib/injuryExtract.ts), and that report is private to the client by
// design: own-folder storage policies with no trainer branch
// (supabase/parts/91), an allowlist that keeps the note out of the model
// (src/lib/coachShare.ts), and a viewer that never hands the file to another
// app (src/lib/injuryDocView.ts). Editing the injury the report produced
// changes the injury and nothing else. There is no function here that reaches a
// bucket, a path or a document, and there must not be one.

import { areaLabel, type Injury, type InjurySeverity } from './injuries';
import { injuryKey } from './injuryGate';
import { localDate } from './localDate';

/** The fields a member may correct. Status is not among them: Mark Recovered
 *  and Reactivate are their own controls and read as what they are. */
export interface InjuryEdit {
  area: string;
  severity: InjurySeverity;
  /** Trimmed. An empty note is `undefined` rather than '' so a cleared note
   *  reads the same as one that was never written. */
  note?: string;
}

/** What to hand `updateInjury`. The id and the disclosure date are deliberately
 *  absent: an edit is a correction of an existing disclosure, so it keeps both.
 *  Re-stamping `at` would date a torn shoulder to the day somebody fixed a
 *  spelling. */
export function injuryPatch(edit: InjuryEdit): Partial<Injury> {
  const note = (edit.note ?? '').trim();
  return { area: edit.area, severity: edit.severity, note: note || undefined };
}

/**
 * Whether this edit changes what the coach acknowledged.
 *
 * Asked through `injuryKey`, not by comparing fields here — there is one
 * definition of what a disclosure IS, and the coach's assign gate uses it.
 */
export function editResetsAck(before: Pick<Injury, 'area' | 'severity'>, edit: InjuryEdit): boolean {
  return injuryKey(before) !== injuryKey({ area: edit.area, severity: edit.severity });
}

/**
 * What to tell the member before they save, or null when there is nothing to
 * say.
 *
 * Only ever shown for an ACTIVE disclosure. A recovered injury is not gating
 * anybody, so warning that a coach will be asked to read it again would be
 * describing something that is not going to happen.
 */
export function editAckWarning(
  before: Pick<Injury, 'area' | 'severity' | 'status'>,
  edit: InjuryEdit,
): string | null {
  if (before.status !== 'active') return null;
  if (!editResetsAck(before, edit)) return null;
  const changedArea = before.area !== edit.area;
  return changedArea
    ? 'You have changed which part of your body this is about, so your coach will be asked to read your injuries again before they can assign you anything.'
    : 'You have changed how bad this is, so your coach will be asked to read your injuries again before they can assign you anything.';
}

/**
 * The confirm in front of Delete.
 *
 * Names the injury, because "Delete, are you sure?" over a list of five rows
 * does not say which one. Says what is lost, and says the alternative out loud:
 * most people reaching for Delete on a healed injury want Mark Recovered, which
 * keeps the history and stops it affecting their program just the same.
 */
export function deleteInjuryConfirm(injury: Pick<Injury, 'area' | 'status'>): { title: string; body: string } {
  const what = areaLabel(injury.area).toLowerCase();
  const alternative = injury.status === 'active'
    ? `\n\nIf it has healed, use Mark Recovered instead. That keeps the record and stops it affecting your program.`
    : '';
  return {
    title: `Delete your ${what} injury?`,
    body: `This removes it from your list for good, and your coach stops seeing it. `
      + `Anything already written around it, like a program, is not changed.${alternative}`,
  };
}

/** The sheet's own title, so an edit and a first disclosure are never mistaken
 *  for one another. Title Case: it heads the sheet. */
export const editSheetTitle = (editing: boolean): string =>
  (editing ? 'Edit This Injury' : 'Disclose an Injury');

/* ══════════════════════════════════════════════════════════════════════════
 * HOW LONG IT HAS BEEN SITTING THERE
 *
 * ── the gap ───────────────────────────────────────────────────────────────
 *
 * Every `Injury` has carried an `at` since the day the type was written, and
 * nothing in the client app has ever printed it. So an injury disclosed
 * yesterday and one disclosed fourteen months ago are the same row, in the
 * same order, saying the same thing — "Knee · moderate" — and the plan trains
 * around both with equal confidence.
 *
 * Physitrack's whole model is that an assessment has a review date: the
 * clinician is asked, on a cadence, whether the thing is still true. Repple
 * has the opposite shape. A disclosure here is a fact that is entered once and
 * then never questioned by anybody, and the two ways out of it — Mark
 * Recovered and Edit — are both controls the MEMBER has to think to press.
 * Nothing ever asks.
 *
 * That is not a cosmetic gap. A mild ankle from a walk-in clinic two years ago
 * is still hiding movements from somebody's program, still gating their
 * coach, and still being trained around. The member has forgotten it is there;
 * their coach cannot tell it from this morning's.
 *
 * ── what is built, and what is deliberately not ──────────────────────────
 *
 * No new table, no new field, no new dependency: this reads `at`, which is
 * already written and already read back. It produces a sentence and a flag,
 * and the SCREEN does the asking — the member's own two existing controls are
 * the answer, so there is nothing new to store and nothing new to consent to.
 *
 * What it does NOT do is act. It does not expire a disclosure, it does not
 * mark anything recovered, and it does not tell the coach anything new. An
 * injury nobody has revisited is still an injury: "we have not heard about
 * this in a while" and "this has healed" are different sentences and only the
 * member can turn the first into the second. That is the same rule
 * app/(client)/injury-doc.tsx keeps about a document — propose, never apply.
 */

/** How long a disclosure has stood, in whole days, or null when it cannot be
 *  read. Null is not zero: a row with no `at`, or one whose `at` is not a date,
 *  is a disclosure of unknown age and must not render as "disclosed today".
 *
 *  Counted on the CALENDAR — both ends reduced to local midnight and the days
 *  between them counted — rather than by dividing a millisecond difference by
 *  86,400,000. Two days a year are 23 and 25 hours long, and the same
 *  arithmetic is why src/lib/goalDeadline.ts uses `setDate`.
 *
 *  `localDate` reads a bare `YYYY-MM-DD` as LOCAL midnight and a timestamp as
 *  its own instant. `at` is written here as a full ISO timestamp, so the
 *  second branch is the ordinary one; the first exists because an imported row
 *  is not obliged to agree with us about that, and reading a bare date as UTC
 *  is the trap src/lib/localDate.ts was written for. */
export function injuryOpenDays(atISO: string | null | undefined, nowMs: number): number | null {
  const d = localDate(atISO);
  if (!d || !Number.isFinite(nowMs)) return null;
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date(nowMs);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  // A disclosure dated in the future is not a negative age. It is a row we
  // cannot describe the age of, and saying "disclosed in 3 days" about a knee
  // is worse than saying nothing.
  const days = Math.round((to - from) / 86400000);
  return days < 0 ? null : days;
}

/**
 * The point at which a standing disclosure is worth asking about again.
 *
 * Ninety days, and the number is a judgement rather than a measurement, so it
 * is here where it can be read and argued with rather than inline in a screen.
 * Three months is long enough that a sprain has either healed or become
 * something else, and short enough that somebody still remembers disclosing
 * it. Nothing expires at it — see the header.
 */
export const INJURY_RECHECK_DAYS = 90;

/** What this screen may say about one disclosure's age. `null` everywhere the
 *  age is not known or not relevant, so a caller renders nothing rather than a
 *  hedge. */
export interface InjuryStanding {
  /** Whole days since it was disclosed, or null when `at` cannot be read. */
  days: number | null;
  /** The sentence for the row, or null when there is nothing honest to say. */
  line: string | null;
  /** Whether to put the question. False for a recovered injury, for one whose
   *  age is unknown, and for one that is simply recent. */
  recheck: boolean;
}

/**
 * How one disclosure stands, from its own date and the clock the caller is
 * holding.
 *
 * `nowMs` is passed in rather than read here, for the reason every dated
 * function in this codebase takes its instant: so the answer can be asserted
 * across a clocks change and six timezones without a device — and so the
 * screen is the thing that decides whether its clock is live. The screen uses
 * `useNow()`, which re-settles at local midnight; a `Date.now()` in a render
 * body would be right only at the moment something else happened to redraw.
 *
 * A RECOVERED injury gets no line at all. Its age is the age of a healed
 * thing, nothing follows from it, and putting "disclosed 400 days ago" under a
 * row marked recovered invites somebody to act on a number that means nothing.
 */
export function injuryStanding(
  injury: Pick<Injury, 'status' | 'at'>,
  nowMs: number,
): InjuryStanding {
  const days = injuryOpenDays(injury.at, nowMs);
  if (injury.status !== 'active' || days == null) {
    return { days, line: null, recheck: false };
  }
  const recheck = days >= INJURY_RECHECK_DAYS;
  const since = days === 0 ? 'today'
    : days === 1 ? 'yesterday'
    : `${days} days ago`;
  return {
    days,
    line: recheck
      ? `You disclosed this ${since} and nothing has changed on it since. Your coach and your plan are still training around it — if it has healed, mark it recovered.`
      : `Disclosed ${since}.`,
    recheck,
  };
}
