// What this gym pays a coach for, said to the person who decides it.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// `tenants.session_pay_policy` (src/lib/gymPolicy.ts) is the four-way answer to
// "beyond a delivered session, what does this gym pay for" — a no-show, a late
// cancellation, both, or neither. Everything downstream turns on it:
// `payrollOf` in src/lib/monthEnd.ts counts payable sessions through
// `isPayable`, the month close files the figure it produces, and every coach's
// own earnings screen reads the same column through `policyView`.
//
// The one person who sets it could not see it. It is written from the web
// console and from nowhere else — `GymProfilePatch` says so field by field,
// "the owner, from this console only" — and `useTenant` on the phone does not
// even read the column, so the owner's app had no sight of the setting whose
// answer every payroll figure in the product is computed from. A coach could
// read their gym's policy on their phone (src/ui/coachPayTerms.ts, built for
// exactly that); the owner could not.
//
// ── Why this is a view and not a control ──────────────────────────────────
//
// Changing this is not like changing the session fee. `GymProfilePatch`
// records what a change does: it moves what Sessions, Staff, Close and every
// coach's earnings screen count as payable, INCLUDING for months already worked
// and not yet settled. That is a decision taken over a payroll run with the run
// in front of you, not a toggle pressed on a train — and it is the same
// argument the month close makes about itself. So this module produces
// sentences and no patch, and `WHERE_THE_POLICY_IS_SET` says where the change
// is made and what pressing it would move.
//
// ── The null, again ───────────────────────────────────────────────────────
//
// Null is "this gym has not decided", NOT `delivered_only`. `payPolicyOf`
// refuses that substitution with a paragraph about the four screens that each
// kept their own unsaved copy, and `policyView` refuses it for the coach. The
// owner gets the same refusal for a reason of their own: an owner shown "you
// pay for delivered sessions only" by an app that is guessing will not go and
// set the field, and the field being unset is what withholds their payroll
// figure on every other screen.
//
// ── Why the mapping is imported rather than written again ─────────────────
//
// `policyView` in src/lib/coachPayTerms.ts already turns a stored string into
// one of four answers, refuses an unrecognised code, and carries the 'unread'
// and 'no_gym' cases. It takes a link, a status and a string and holds no coach
// in it; only the SENTENCES around it are the coach's. A second copy of that
// mapping here is a second place to forget a policy code — the exact drift
// gymPolicy.ts's header describes when four screens each held their own — so
// what lives here is the owner's half of the words and nothing else.
//
// Pure: no react, no supabase, no clock.
import type { PolicyView } from './coachPayTerms';
import { NO_PAY_POLICY_NOTE } from './gymPolicy';

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * Where the policy is changed, and what changing it moves.
 *
 * Printed under the policy on the phone, including when it is unset. Without
 * the second half an owner reads "set it in the console" as a routine errand,
 * and the errand re-prices months that have been worked and not yet settled.
 */
export const WHERE_THE_POLICY_IS_SET =
  'This is set on the web console, on the Sessions screen, and it is shown here rather than changed here on purpose: '
  + 'it decides what Payroll, Staff and the month close count as payable, including for months already worked and not '
  + 'yet settled. Changing it moves those figures under a settlement you may be halfway through.';

/** A tenant read that has not landed. Never rendered as a gym with no policy. */
export const POLICY_UNREAD_NOTE =
  'Your gym’s row could not be read, so what it pays for is not known. That is not a statement that nothing is set, '
  + 'and nothing about your payroll has changed.';

/** An account with no gym behind it. */
export const POLICY_NO_GYM_NOTE =
  'This account is not attached to a gym, so there is no session pay policy. There are no coaches to pay for one.';

/**
 * What being unset costs, in the owner's own terms.
 *
 * Not "pick one when you get a moment". A null here is what makes `payPolicyOf`
 * answer null, and a null policy is what makes Payroll, Staff and the close
 * WITHHOLD their figures rather than guess — so the sentence names the screens
 * that are currently blank because of it.
 */
export const POLICY_UNSET_NOTE =
  'Your gym has not said what it pays for beyond delivered sessions. Nothing is assumed in its place: Payroll, Staff '
  + 'and the month close withhold what a no-show or a late cancellation is worth rather than counting it as nothing, '
  + 'and every coach reading their own terms is told the same thing you are.';

/* ── the three outcomes, answered ─────────────────────────────────────────── */

/**
 * One thing that can happen to a booked session, and what this gym pays for it.
 *
 * 'unstated' is a third answer and not a dressed-up 'unpaid'. The whole point of
 * the nullable column is that a gym which has decided to pay nothing for a
 * no-show and a gym which has never been asked are different gyms, and only one
 * of them has told its coaches anything.
 */
export interface PayOutcomeLine {
  /** What happened to the session. */
  outcome: string;
  answer: 'paid' | 'unpaid' | 'unstated';
  /** Why that is the answer, in one clause the owner can act on. */
  note: string;
}

/**
 * The four lines under the policy label.
 *
 * Empty for 'unread' and 'no_gym' — there is no policy to describe and the
 * screen prints the matching note instead. A list of "not known" rows would
 * read as four decisions nobody has made, which is a claim about the gym rather
 * than about the read.
 *
 * The fourth line is the one that is NOT a policy question and is here because
 * of that. `isPayable` in src/lib/gymSessions.ts returns false for a null
 * outcome under every one of the four policies, so an unmarked session is
 * unpaid whatever this gym has decided — and it is simultaneously the thing
 * `closeBlockers` refuses to close a month over. An owner reading only the
 * label would take the missing money for a policy they had chosen.
 */
export function payOutcomeLines(v: PolicyView): PayOutcomeLine[] {
  if (v.kind === 'no_gym' || v.kind === 'unread') return [];

  const stated = v.kind === 'stated';
  const noShow = stated && (v.code === 'no_shows' || v.code === 'no_shows_and_late_cancellations');
  const lateCancel = stated && (v.code === 'late_cancellations' || v.code === 'no_shows_and_late_cancellations');

  return [
    {
      outcome: 'Delivered',
      answer: 'paid',
      note: 'A session that happened is paid under every policy. This is the one line you cannot switch off.',
    },
    {
      outcome: 'No-show',
      answer: stated ? (noShow ? 'paid' : 'unpaid') : 'unstated',
      note: stated
        ? (noShow
          ? 'The coach held the hour, so this gym pays it. Payroll counts it exactly as it counts a delivered session.'
          : 'Your gym pays nothing for an hour the member did not turn up to. Payroll leaves it out of the total.')
        : `Nobody has said, and ${NO_PAY_POLICY_NOTE}, so Payroll leaves it out and says the figure is incomplete rather than counting it as nothing.`,
    },
    {
      outcome: 'Late cancellation',
      answer: stated ? (lateCancel ? 'paid' : 'unpaid') : 'unstated',
      note: stated
        ? (lateCancel
          ? 'A cancellation inside your notice window is paid to the coach, whatever the member was charged. The two are separate records and neither settles the other.'
          : 'Your gym pays nothing for a session cancelled late. What the MEMBER is charged for one is a different setting, on Ops.')
        : 'Nobody has said, so this is withheld in the same way a no-show is. It is not the same question as what you charge the member for one, which is set on Ops.',
    },
    {
      // Never conditional on the code, and that is the assertion this line
      // exists to make on screen.
      outcome: 'Nobody marked it',
      answer: 'unpaid',
      note: 'A session with no outcome recorded is unpaid under all four policies. That is not a decision you have taken; '
        + 'it is the outcome still being unrecorded. It is also what stops the month closing, and marking it is what makes it count.',
    },
  ];
}

/**
 * The short answer beside the heading, or null.
 *
 * Null under 'unread' and 'no_gym': a heading note is read as a fact about the
 * gym, and neither of those is one. 'Not set' IS a fact about the gym and is
 * said, because the absence is the thing the owner has to act on.
 */
export function policyHeadNote(v: PolicyView): string | null {
  if (v.kind === 'stated') return v.label;
  if (v.kind === 'unset') return 'Not set';
  return null;
}
