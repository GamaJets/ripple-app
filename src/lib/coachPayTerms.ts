// What a coach is told about their own pay terms — the standing rate their gym
// agreed with them, and which outcomes that gym actually pays for.
//
// ── Why this did not exist ────────────────────────────────────────────────
//
// `gym_trainer_pay` (supabase/parts/183) holds the rate one gym pays one coach,
// and its own SELECT policy — `gym_trainer_pay_self_r`, `trainer_id = (select
// auth.uid())` — was written so the coach can read it. Nothing in the coach app
// ever did: the table's only appearance in `app/(trainer)/**` was one sentence
// of prose at the top of my-register.tsx saying the amounts live somewhere else.
// The same is true of `tenants.session_pay_policy` (part 166): the token did not
// appear anywhere a coach's build could reach, while app/(trainer)/sessions.tsx
// told them the four outcomes are "different commercially … per the gym's
// PayPolicy" and never said which policy that was.
//
// So the coach could see `sessions.rate_cents` after the fact — what one session
// turned out to be worth — and could not see the standing figure it came from,
// or the rule that decides whether a no-show carries one at all. Both are facts
// about their own employment, both are readable by them, and neither was shown.
//
// ── The three layers, restated for the person being paid ──────────────────
//
// `rateForSession` in src/lib/gymPay.ts prices a session from, in order:
// `sessions.rate_cents`, then `gym_trainer_pay.session_rate_cents`, then
// `tenants.session_fee`. This module is the same order told forwards to the
// coach, which is why the "nothing agreed for you" answer still carries the
// gym's standing fee: that IS what a session with no snapshot of its own is
// priced at, and a screen that stopped at "no rate set" would leave the coach
// believing their sessions are worth nothing when payroll is about to pay them
// the gym figure. It is also why a null at every layer is reported as UNPRICED
// and never as zero — part 183 says so on the column itself.
//
// ── The empty answers this file exists to keep apart ──────────────────────
//
// Four different silences reach this module and they have four sentences:
//
//   · there is no gym on this account at all — a real answer, and the one this
//     product is mostly sold into. It must be SAID. A blank rate card in front
//     of a coach who works for themselves implies a gym that agreed to pay them
//     nothing;
//   · there is a gym and nobody has set a rate for this coach;
//   · a rate exists and states no currency, so there is no amount to print;
//   · the read failed, and NOTHING about their pay may be stated from it.
//
// Pure: no react, no supabase, no clock. `wholeMoney`/`minorMoney` are the
// currency-aware formatters from src/lib/coachMoney.ts and are pure themselves;
// both answer null where the currency is unknown, which is what keeps every
// sentence below from naming an amount in a money nobody chose.
import { minorMoney, wholeMoney } from './coachMoney';
import { CLASS_PAY_LABEL, type ClassPayKind } from './gymPay';
import { NO_PAY_POLICY_NOTE, PAY_POLICY_LABEL, type PayPolicyCode } from './gymPolicy';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/**
 * Whether this account is attached to a gym, and whether we know.
 *
 * 'none' is `profiles.tenant_id is null` under a read that SUCCEEDED — the same
 * fact `GymCurrencyRead.hasGym` carries in src/lib/currencySource.ts, and the
 * same one app/(trainer)/settings.tsx calls "this account is not attached to a
 * gym". 'unknown' is the failed or in-flight read, and it is deliberately not
 * 'none': that module's header spells out what treating one as the other costs.
 */
export type GymLink = 'gym' | 'none' | 'unknown';

/**
 * The money fields of a `gym_trainer_pay` row.
 *
 * Structural rather than `TrainerPay` from src/lib/gymPay.ts, for the reason
 * `RatedSession` in src/lib/gymRateCurrency.ts and `PayoutAccount` in
 * src/lib/payoutAccount.ts both give: the shape is what this module needs, and
 * a hand-built row in a test fits it without the reader half of that module.
 */
export interface AgreedPay {
  /** Minor units. Null is "this gym has not set a rate for this coach", which
   *  falls back to the gym's own session fee and is NOT zero. */
  sessionRateCents: number | null;
  classPayKind: ClassPayKind | null;
  classRateCents: number | null;
  /** What both amounts are in. Never the gym's current currency: part 183 keeps
   *  this column precisely so a gym changing currency cannot re-denominate what
   *  it agreed to pay somebody. */
  currency: string | null;
  updatedAt: string | null;
}

/** The gym's standing fee, as the third layer of `rateForSession` reads it:
 *  `tenants.session_fee` is WHOLE currency units, not minor ones. */
export interface StandingFee {
  /** Whole units. Null means the gym has not set one — every layer is then
   *  null and the session is unpriced. */
  fee: number | null;
  currency: string | null;
}

/**
 * What the coach's own rate card says.
 *
 *  'no_gym'      no gym is attached to this account. There is nobody to have
 *                agreed a rate, and that is a fact to state rather than an
 *                empty card to draw.
 *  'unread'      the read failed or has not landed. Nothing may be said.
 *  'unset'       there is a gym and no rate row for this coach. `standing` is
 *                what a session is actually priced at in that case.
 *  'unstated'    a rate exists and names no currency, so there is an amount on
 *                the record and no money to print it in. Part 183's
 *                `gym_trainer_pay_amount_has_currency` makes this unreachable
 *                for rows written under it; a row that predates the constraint
 *                is still a row, and a figure with no unit is not a figure.
 *  'agreed'      a rate exists in a currency. Either amount may still be null —
 *                a gym that priced classes and not one-to-ones is common — so
 *                `standing` rides along for the half that is not set.
 */
export type RateCard =
  | { kind: 'no_gym' }
  | { kind: 'unread' }
  | { kind: 'unset'; standing: StandingFee }
  | { kind: 'unstated' }
  | {
      kind: 'agreed';
      currency: string;
      sessionRateCents: number | null;
      classPayKind: ClassPayKind | null;
      classRateCents: number | null;
      /** `gym_trainer_pay.updated_at` — when the gym last wrote this rate. The
       *  backlog item asks for it by name: a rate with no date on it is one the
       *  coach cannot tell from the one they were quoted two years ago. */
      setOn: string | null;
      standing: StandingFee;
    };

const code = (c: string | null | undefined): string | null =>
  (c ?? '').trim().toUpperCase() || null;

/**
 * The rate card, from the three things that decide it.
 *
 * `status` covers the `gym_trainer_pay` read AND the gym row it is read
 * alongside — the caller folds them with `worstStatus` — because a card built
 * from half a read would state a fallback fee that may not be the gym's. A
 * single-row read cannot come back 'partial', and `isWhole` refuses it anyway:
 * the one thing this must never do is describe somebody's pay from a prefix.
 */
export function rateCard(
  link: GymLink,
  pay: AgreedPay | null | undefined,
  status: LoadStatus,
  standing: StandingFee,
): RateCard {
  // The failed read is checked FIRST and before the link, because 'unknown' is
  // what a failed profile read looks like and answering it with 'no_gym' is the
  // substitution src/lib/currencySource.ts exists to prevent.
  if (!isWhole(status) || link === 'unknown') return { kind: 'unread' };
  if (link === 'none') return { kind: 'no_gym' };
  const cur = code(pay?.currency);
  const hasAmount = pay != null && (pay.sessionRateCents != null || pay.classRateCents != null);
  if (!hasAmount) return { kind: 'unset', standing };
  if (!cur) return { kind: 'unstated' };
  return {
    kind: 'agreed',
    currency: cur,
    sessionRateCents: pay?.sessionRateCents ?? null,
    classPayKind: pay?.classPayKind ?? null,
    classRateCents: pay?.classRateCents ?? null,
    setOn: pay?.updatedAt ?? null,
    standing,
  };
}

/**
 * What one agreed session rate reads as, or null when there is none to print.
 *
 * Null rather than a dash string, so a caller interpolating it into a sentence
 * has to branch first — `${…}` over a missing amount renders the four
 * characters "null" into copy about somebody's wages.
 */
export function sessionRateLabel(c: RateCard): string | null {
  return c.kind === 'agreed' ? minorMoney(c.sessionRateCents, c.currency) : null;
}

/** The same for the class rate. Two columns, never one: part 183 keeps
 *  `class_pay_kind` beside the amount because "80 per class" and "8 per head"
 *  are the same digits and completely different money. */
export function classRateLabel(c: RateCard): string | null {
  return c.kind === 'agreed' ? minorMoney(c.classRateCents, c.currency) : null;
}

/** How the class amount is counted, in the words the owner's own screen uses.
 *  Null when no class rate is set — `gym_trainer_pay_class_pair` makes the kind
 *  and the amount null together, so one without the other is not a state. */
export function classPayLabel(c: RateCard): string | null {
  return c.kind === 'agreed' && c.classPayKind ? CLASS_PAY_LABEL[c.classPayKind] : null;
}

/**
 * What a session with no agreed rate of its own is actually worth, said out
 * loud — the third layer of `rateForSession`, which is the layer that pays.
 *
 * The unpriced sentence is the one that matters. A null at every layer is not a
 * free session and not a zero: `payrollTotal` in src/lib/gymSessions.ts refuses
 * to answer over unpriced work rather than adding a nought, and the coach is
 * told the same thing rather than being shown a blank.
 */
export function standingNote(s: StandingFee): string {
  const amount = wholeMoney(s.fee, s.currency);
  if (amount) {
    return `Sessions that carry no rate of their own are paid at your gym’s standing fee of ${amount}. `
      + 'A session keeps whatever rate was recorded when its outcome was marked, so a change to this '
      + 'figure never rewrites one that has already happened.';
  }
  if (s.fee != null && !code(s.currency)) {
    return 'Your gym has a standing session fee and has not set a currency, so there is no amount to '
      + 'show you — the figure is real and there is nothing that could say what money it is in.';
  }
  return 'Your gym has not set a standing session fee either, so a session with no rate of its own is '
    + 'UNPRICED. That is not the same as free: payroll refuses to total a period containing one rather '
    + 'than counting it as nothing.';
}

/** Said where a rate card would be, for a coach who works for themselves. It
 *  names the absence rather than leaving an empty card to imply a rate of zero,
 *  and it does not send them looking for a setting nobody can make. */
export const NO_GYM_PAY_NOTE =
  'There is no gym attached to this account, so there is no agreed rate to show you, no pay policy to '
  + 'be on, and nobody to have set either. What you charge your own clients is the Session Rate above, '
  + 'and it is yours.';

/** Said when the read did not come back. Deliberately not "no rate is set" —
 *  that is a statement about the coach's employment made from a failure. */
export const PAY_TERMS_UNREAD_NOTE =
  'Your pay terms could not be read, so nothing about them is shown here. This is not a statement that '
  + 'none are set — whatever your gym has agreed with you is unchanged and still what payroll uses.';

/** Said when a rate exists and no currency does. */
export const RATE_UNSTATED_NOTE =
  'Your gym has recorded a rate for you and has not recorded what money it is in, so there is no amount '
  + 'to print. Nothing is missing from what they agreed; Repple will not put a currency on a figure '
  + 'nobody chose.';

/** Said when there is a gym and no rate row. Not an accusation and not a
 *  prompt: the coach cannot write this row — `gym_trainer_pay_owner` is the
 *  only policy that may — so telling them to go and set it would send them at a
 *  control that does not exist on their side of the app. */
export const NO_AGREED_RATE_NOTE =
  'No rate has been agreed for you on this account. Your gym sets this on their side; it is not '
  + 'something you can enter, and the app will not invent one.';

/* ── which outcomes the gym pays for ───────────────────────────────────────── */

/**
 * What the coach is told about `tenants.session_pay_policy`.
 *
 * 'unset' is the gym that has not decided, and it is NOT `delivered_only`.
 * `payPolicyOf` in src/lib/gymPolicy.ts refuses that substitution for the
 * owner's screens with a paragraph explaining what it cost when four screens
 * each kept their own unsaved copy; the coach gets the same refusal, because
 * being told "your gym pays for delivered sessions only" by an app that is
 * guessing is worse than being told nobody has said.
 */
export type PolicyView =
  | { kind: 'no_gym' }
  | { kind: 'unread' }
  | { kind: 'unset' }
  | { kind: 'stated'; code: PayPolicyCode; label: string };

const POLICY_CODES: PayPolicyCode[] = [
  'delivered_only',
  'no_shows',
  'late_cancellations',
  'no_shows_and_late_cancellations',
];

/**
 * The stored code → what to put on screen.
 *
 * An unrecognised value is 'unset' rather than a guess, matching `payPolicyOf`:
 * a policy this build does not know is a policy nobody here understands, and
 * naming it as one of the four would be a claim about whether somebody's
 * no-show is paid.
 */
export function policyView(link: GymLink, status: LoadStatus, stored: string | null | undefined): PolicyView {
  if (!isWhole(status) || link === 'unknown') return { kind: 'unread' };
  if (link === 'none') return { kind: 'no_gym' };
  const c = (stored ?? '').trim().toLowerCase();
  const known = POLICY_CODES.find((k) => k === c);
  return known ? { kind: 'stated', code: known, label: PAY_POLICY_LABEL[known] } : { kind: 'unset' };
}

/**
 * The sentence under the policy line — the three outcomes the backlog item
 * names, answered for the policy that is actually stored.
 *
 * The unmarked session is answered the same way whatever the policy says, and
 * that is the point of including it: `isPayable` in src/lib/gymSessions.ts
 * returns false for a null outcome under every one of the four, so an unmarked
 * session is unpaid because nobody recorded what happened and not because the
 * gym decided anything. A coach reading only the policy label would have no way
 * to know that, and app/(trainer)/sessions.tsx is the queue that clears it.
 */
export function policyDetail(v: PolicyView): string {
  if (v.kind === 'no_gym') {
    return 'There is no gym attached to this account, so there is no pay policy — nobody else decides '
      + 'what a cancelled session is worth to you.';
  }
  if (v.kind === 'unread') return PAY_TERMS_UNREAD_NOTE;
  if (v.kind === 'unset') {
    return `A delivered session is paid. Beyond that, ${NO_PAY_POLICY_NOTE} — so no-shows and late `
      + 'cancellations are not something this app can tell you the answer for. Ask your gym rather than '
      + 'reading the conservative case into the silence.';
  }
  const noShow = v.code === 'no_shows' || v.code === 'no_shows_and_late_cancellations';
  const lateCancel = v.code === 'late_cancellations' || v.code === 'no_shows_and_late_cancellations';
  return `A delivered session is paid. A no-show ${noShow ? 'is paid' : 'is not paid'}, and a late `
    + `cancellation ${lateCancel ? 'is paid' : 'is not paid'}. A session nobody has marked is never paid `
    + 'under any policy — that is not your gym’s decision, it is the outcome still being unrecorded, and '
    + 'marking it is what makes it count.';
}
