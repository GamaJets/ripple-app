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
 * keeps the history and stops it affecting their programme just the same.
 */
export function deleteInjuryConfirm(injury: Pick<Injury, 'area' | 'status'>): { title: string; body: string } {
  const what = areaLabel(injury.area).toLowerCase();
  const alternative = injury.status === 'active'
    ? `\n\nIf it has healed, use Mark Recovered instead. That keeps the record and stops it affecting your programme.`
    : '';
  return {
    title: `Delete your ${what} injury?`,
    body: `This removes it from your list for good, and your coach stops seeing it. `
      + `Anything already written around it, like a programme, is not changed.${alternative}`,
  };
}

/** The sheet's own title, so an edit and a first disclosure are never mistaken
 *  for one another. Title Case: it heads the sheet. */
export const editSheetTitle = (editing: boolean): string =>
  (editing ? 'Edit This Injury' : 'Disclose an Injury');
