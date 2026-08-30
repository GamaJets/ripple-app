// Whether a screen may write over a record it may never have read.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The recurring bug in this codebase is a screen stating a failed read as a
// fact. The expensive version of it is not a wrong sentence, it is a wrong
// SAVE. The dashboard's meal-plan chips were the first one caught: a client's
// calorie adjustment could not be read, the chip rendered "no adjustment"
// because that is what an unread value looks like, and tapping the chip wrote
// that guess back over the real figures. The read failure lasted a second; the
// write it invited was permanent.
//
// The same shape sits under every "assign" button in the coach app, and there
// it is somebody's training. `useAssignedPrograms` returns null from
// `getProgram` both for a client who has never been assigned anything and for a
// client whose row could not be read. A builder that cannot tell those apart
// loads the generic auto-generated plan, presents it as the client's programme,
// and offers a button that replaces the bespoke programme it never saw. The
// coach has no way to know: the screen looked normal.
//
// ── Why a guard rather than a banner ───────────────────────────────────────
//
// A banner is the right answer when the only cost is a misreading — the coach
// reads it, discounts what is on screen, and nothing is lost. It is the wrong
// answer here, because a banner does not stop a thumb. An overwrite of a
// training programme has no undo, no history table and no notification to the
// client, so the only honest response to "we do not know what is currently
// saved" is to withhold the control until we do.
//
// ── Why 'partial' is refused too ───────────────────────────────────────────
//
// A truncated read of `assigned_programs` returns real programmes for the
// clients whose rows arrived and nothing at all for the rest — and "nothing at
// all" is indistinguishable from "never assigned" at every call site. So under
// 'partial' a specific client's programme is exactly as unknown as it is under
// 'error'. The status is gentler; what it licenses is not.
import type { LoadStatus } from '../ui/loadStatus';

export interface OverwriteGuard {
  /** True only when what is about to be replaced was actually read. */
  allowed: boolean;
  /** Why the control is withheld, addressed to the coach. Null when allowed. */
  reason: string | null;
  /** What to put on the withheld control in place of its usual label. Null
   *  when allowed, so a caller can write `guard.label ?? 'Assign'`. */
  label: string | null;
}

const ALLOWED: OverwriteGuard = { allowed: true, reason: null, label: null };

/**
 * May this screen save over `subject`, given how the read of it went?
 *
 * `subject` is a plain-English noun phrase naming the thing that would be
 * replaced — "Priya's current programme", "the programmes these clients are
 * on" — because the sentence this returns is rendered to a coach, and a coach
 * needs to know what they are being stopped from overwriting rather than which
 * provider was unhappy.
 */
export function guardOverwrite(status: LoadStatus, subject: string): OverwriteGuard {
  switch (status) {
    case 'ready':
      return ALLOWED;
    case 'loading':
      return {
        allowed: false,
        label: 'Checking what is saved…',
        reason: `Still reading ${subject}. Saving now could replace something this screen has not seen yet — this takes a moment.`,
      };
    case 'partial':
      return {
        allowed: false,
        label: 'Cannot save over an unread plan',
        reason: `Only part of ${subject} came back, so this screen cannot tell whether there is already something there. Saving would replace it with what is on this screen and there is no undo, so the save is held until the whole thing has been read.`,
      };
    case 'error':
      return {
        allowed: false,
        label: 'Cannot save over an unread plan',
        reason: `${subject} could not be read, so this screen does not know what is currently saved. Saving would replace it with what is on this screen and there is no undo — try again once you have signal.`,
      };
  }
}
