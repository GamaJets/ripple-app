// The sentence under the hydration hero, and whether there is a figure to put
// above it.
//
// ── The defect this exists for ─────────────────────────────────────────────
//
// `app/(client)/recovery.tsx` had three arms and no fourth:
//
//     waterStatus === 'error' ? 'Counted on this phone only …'
//       : goalCups == null    ? 'No daily goal set — set one on Daily habits …'
//       : cups >= goalCups    ? 'Goal met today — nice.'
//                             : `${goalCups - cups} more to hit today's goal.`
//
// There is no 'loading' branch anywhere in it, and both halves start at their
// empty value: `src/ui/habits.tsx` starts `water` at 0 under a 'loading'
// status, and `src/ui/clientData.tsx` starts `waterGoalGlasses` at null. So on
// the first frame a member who has drunk six of eight glasses is told, in the
// largest type on the screen, that they have drunk none and have never set a
// target — and the hero is made a LINK to the habits screen, inviting them to
// go and set the goal they already have. If they take it they are editing a
// goal on the strength of a number that had not arrived.
//
// Loading, failed and empty are three different sentences. This hero had two of
// the three, and the one it was missing is the one that renders first.
//
// ── Two reads, not one ─────────────────────────────────────────────────────
//
// The count and the goal come from different places and fail independently: the
// count is `habits`, the goal is the `clients` row. A screen that reads only
// `waterStatus` will say "no daily goal set" about a goal it simply could not
// read, which is the same false-empty one level up.
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/**
 *   'loading'     one of the two reads is still in flight. No figure, no
 *                 congratulation, no invitation to set anything.
 *   'countUnread' the count read failed. The tally on this phone is REAL — the
 *                 member drank what they drank — but it may not be all of it.
 *   'goalUnread'  the goal read failed or came back truncated. There is no
 *                 basis for "no goal set" and none for a percentage.
 *   'noGoal'      both reads landed and there genuinely is no goal. This is the
 *                 only state that may offer the shortcut to set one.
 *   'met' | 'toGo' both landed, and the goal is a real number.
 */
export type HydrationNoteKind =
  'loading' | 'countUnread' | 'goalUnread' | 'noGoal' | 'met' | 'toGo';

export interface HydrationNote {
  kind: HydrationNoteKind;
  /** The sentence under the figure. */
  text: string;
  /** Whether the count may be printed as a number. False while it is unknown —
   *  a hero reading 0 is a claim, and `fig(null)` is the house dash. */
  showCount: boolean;
  /** Whether the ring may be filled. Needs both a known count and a known
   *  goal; a percentage of an unread goal is not a percentage. */
  showRing: boolean;
  /** Whether tapping the hero may send the member off to set a goal. Only when
   *  we know they have not got one. */
  offerGoal: boolean;
}

export function hydrationNote(
  countStatus: LoadStatus,
  goalStatus: LoadStatus,
  cups: number,
  goal: number | null,
): HydrationNote {
  if (countStatus === 'loading' || goalStatus === 'loading') {
    return {
      kind: 'loading',
      text: 'Reading today’s glasses and your daily goal.',
      showCount: false, showRing: false, offerGoal: false,
    };
  }
  if (!isWhole(countStatus)) {
    return {
      kind: 'countUnread',
      // The tally is this phone's and it is real; what failed is the check
      // against the account.
      text: 'Counted on this phone only — we couldn’t check it against your account.',
      showCount: true, showRing: false, offerGoal: false,
    };
  }
  if (!isWhole(goalStatus)) {
    return {
      kind: 'goalUnread',
      text: 'Your daily goal couldn’t be read, so this isn’t filling against one. That is not the same as not having set one.',
      showCount: true, showRing: false, offerGoal: false,
    };
  }
  if (goal == null) {
    return {
      kind: 'noGoal',
      text: 'No daily goal set — set one on Daily habits and this fills against it.',
      showCount: true, showRing: false, offerGoal: true,
    };
  }
  if (cups >= goal) {
    return { kind: 'met', text: 'Goal met today — nice.', showCount: true, showRing: true, offerGoal: false };
  }
  return {
    kind: 'toGo',
    text: `${goal - cups} more to hit today’s goal.`,
    showCount: true, showRing: true, offerGoal: false,
  };
}
