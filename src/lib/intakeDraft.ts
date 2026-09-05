// The intake form, kept on the phone until it can be sent.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `app/(client)/intake.tsx` held the whole seven-section form in
// `useState<Intake | null>` and `src/ui/intake.ts` touched no storage at all.
// Two consequences, and the second is worse than the first:
//
//   · Typed and backed out is gone. A medical and training history is the
//     longest thing anybody types into this app, and nothing kept a word of it
//     between one visit to the screen and the next.
//   · Offline it could not be started. The read fails, `status` is 'error',
//     `canSave` is false, and the screen shows a Flag instead of a form. The
//     copy told them to "Check your connection and press Save again", which
//     `src/lib/reachability.ts` exists to replace — and the screen promises, a
//     few hundred lines further down, "You can save a half-finished form and
//     come back."
//
// A gym reception with no signal is exactly where somebody fills this in.
//
// ── What this does NOT change ──────────────────────────────────────────────
//
// The screen's own header states the rule that governs everything here:
//
//     "It must not save over a document it could not read. If the read failed,
//      what is on screen is an empty form standing in for one that may be full,
//      and saving it would replace a real disclosure with a blank."
//
// That stands, and nothing below softens it. Keeping a draft on the device is a
// different act from writing one to the server: a draft is never sent by
// itself, the Save control is still withheld until the read lands, and when it
// does land `draftDecision` refuses to let a draft silently replace answers it
// was not built from. What changes is only that the words survive.
//
// Pure and in src/lib because the decision is the delicate part. The
// AsyncStorage half is in src/ui/intake.ts.
import { INTAKE_VERSION, parseIntake, type Intake } from './intake';

/** Per account: two people sharing a phone must not inherit each other's
 *  half-finished medical history. Versioned, so a shape change cannot read old
 *  bytes as new ones. */
export const INTAKE_DRAFT_PREFIX = 'intake:draft:v1:';
export const intakeDraftKey = (uid: string | null): string => `${INTAKE_DRAFT_PREFIX}${uid ?? 'anon'}`;

export interface IntakeDraft {
  /** When this draft was last typed into. */
  at: string;
  /**
   * The `updatedAt` of the server document this draft was started from, or null
   * when it was started from a blank — which is what happens offline, where
   * there was no server document to start from.
   *
   * This one field is what makes the decision below possible. Without it a
   * draft and a server copy are two documents with no relationship, and the
   * only safe thing to do with them is nothing.
   */
  basedOn: string | null;
  intake: Intake;
}

/** Read one back. Null when the bytes are missing or unreadable — a draft that
 *  cannot be parsed is not a draft, and there is nothing here to preserve by
 *  distinguishing the two: the form is still on the server. */
export function parseIntakeDraft(raw: string | null | undefined): IntakeDraft | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return null;
    const at = typeof o.at === 'string' ? o.at : '';
    if (!at) return null;
    const intake = parseIntake(o.intake ?? null);
    if (!intake) return null;
    return { at, basedOn: typeof o.basedOn === 'string' ? o.basedOn : null, intake };
  } catch {
    return null;
  }
}

/** What goes to the disk. */
export function serialiseIntakeDraft(d: IntakeDraft): string {
  return JSON.stringify({ at: d.at, basedOn: d.basedOn, intake: { ...d.intake, version: INTAKE_VERSION } });
}

/**
 * What to do with a stored draft once the server's copy is known.
 *
 *   'none'    there is no draft. Nothing to decide.
 *   'restore' the draft may be put on screen without asking. Either there is no
 *             server document to lose, or the draft was built FROM this exact
 *             one and is simply the next few sentences of it.
 *   'ask'     the draft and the server document are two different accounts of
 *             the same person, and the app does not get to pick. This is the
 *             offline case: the draft was started from a blank because the read
 *             failed, and the server turns out to hold a real disclosure. The
 *             screen must offer both and let the member choose.
 *
 * Never 'discard'. A draft is somebody's own words about their own body and
 * this module does not throw those away on a comparison.
 */
export type DraftDecision = 'none' | 'restore' | 'ask';
export function draftDecision(draft: IntakeDraft | null, server: Intake | null): DraftDecision {
  if (!draft) return 'none';
  if (!server) return 'restore';
  if (draft.basedOn && draft.basedOn === server.updatedAt) return 'restore';
  return 'ask';
}

/**
 * Whether a draft still has anything in it worth keeping.
 *
 * Used to avoid writing an empty document to the disk on every keystroke that
 * clears the last field, and to avoid offering to "restore" a blank over a real
 * one. Deliberately shallow: any answered readiness question, any non-empty
 * string, any number, any chosen option. An intake with one sentence in it is
 * worth keeping, and so is one with a single tapped chip.
 *
 * ── The answer that did not count ──────────────────────────────────────────
 *
 * `history.years` was tested against the number list, and it is not a number:
 * `TrainingYears` in ./intake is the string union
 * 'none' | 'under1' | 'oneToThree' | 'threeToTen' | 'overTen'. So `typeof n ===
 * 'number'` was false for every value it can hold, and it was the only one of
 * the six choice fields not caught by another line — `readiness`, `kinds`,
 * `times`, `coachedBefore`, `place` and `work` all are.
 *
 * This is the early return on the ONLY write to disk (`keepDraft` in
 * src/ui/intake.ts), so a false answer here is not a missed optimisation, it is
 * a form that is never saved. Two shapes, and the second is the worse one:
 *
 *   · "How long have you been training" is the first question of the first
 *     section. A member with nothing else filled in who taps "3-10 years" and
 *     then backs out of the screen had their answer thrown away, on the screen
 *     whose whole promise is "you can save a half-finished form and come back".
 *   · A member who clears their free text and leaves that chip standing was
 *     also judged to have nothing — so the write was skipped and the PREVIOUS
 *     draft stayed on the disk, to be offered back later as their current
 *     answers. Deleting a sentence and being handed it again is worse than
 *     losing it.
 *
 * Both are the same missing line and both are covered in intakeDraft.test.ts.
 */
export function draftHasContent(intake: Intake | null | undefined): boolean {
  if (!intake) return false;
  if (Object.keys(intake.readiness ?? {}).length > 0) return true;
  const h = intake.history, w = intake.want, tr = intake.tried;
  const a = intake.availability, p = intake.practical, e = intake.emergency;
  const strs = [
    h?.doingNow, w?.headline, w?.by, w?.why, tr?.worked, tr?.didnt, tr?.wont,
    a?.equipment, p?.anythingElse, e?.name, e?.phone, e?.relation,
  ];
  if (strs.some((s) => typeof s === 'string' && s.trim().length > 0)) return true;
  const nums = [a?.daysPerWeek, a?.sessionMins, p?.sleepHours];
  if (nums.some((n) => typeof n === 'number')) return true;
  if ((h?.kinds?.length ?? 0) > 0 || (a?.times?.length ?? 0) > 0) return true;
  // Every chosen option, `years` among them. Six fields on one line rather than
  // one of them filed with the numbers it does not belong to.
  if (h?.years != null || h?.coachedBefore != null || a?.place != null || p?.work != null) return true;
  return false;
}
