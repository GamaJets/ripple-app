// The questions asked before a gym's settings move, and the rule for which of
// them are asked at all.
//
// ── Why this is a module and not five `if`s in the form ───────────────────
//
// studio-web/app/settings/page.tsx writes six columns on one press of Save, and
// four of those columns reach BACKWARDS — they change what a screen says about
// something that has already happened:
//
//   currency    · nothing is re-denominated, by design, so the gym's ledger
//                 holds both from then on and every total spanning the two is
//                 withheld rather than added up, for good.
//   timezone    · no stored figure moves — every time in this database is an
//                 instant — but which DAY a screen files it under moves, for
//                 the past as well as the future.
//   pay policy  · `GymProfilePatch` in ./gymPolicy.ts says it in as many words:
//                 changes what Sessions, Staff, Close and every coach's own
//                 earnings screen count as payable, "INCLUDING for months
//                 already worked but not yet settled".
//   session fee · `rateForSession` in ./gymPay.ts prices a session by its own
//                 snapshot first, then the coach's own rate, then this. The
//                 third layer is not a historical fact: it is read fresh every
//                 time the figure is drawn, so it prices the past too.
//
// The warnings for the first two were beside the fields and correct, and the
// last two had none at all. A sentence beside a field is not the same act as a
// question in front of the write, and the difference is the whole of what this
// module is: `consequences()` is what Save asks, one at a time, before the row
// moves.
//
// ── The rule: a CHANGE, never a first set ─────────────────────────────────
//
// A gym setting its currency for the first time has no ledger to split, no
// reconciled week to move, no month worked against an old policy and no session
// priced at an old fee. Asking them to confirm the only value they have ever
// had teaches them to dismiss the dialog before reading it, which is how the
// one that matters gets dismissed too. So every question below is gated on
// there being a STORED value that this change would replace or remove.
//
// ── And never over a value this build cannot read ─────────────────────────
//
// A stored pay policy the constraint no longer permits is already being treated
// as "not decided" by every dependent screen — the figures over it are withheld
// rather than computed — so replacing it moves nothing backwards and is a first
// set in everything but the column. `payPolicyOf` is what decides that, which
// is the same function the screens themselves ask.
//
// Pure: no react, no supabase, no `window.confirm`. The page owns the asking;
// this owns what is asked, so the wording can be tested rather than read.
import { payPolicyOf, PAY_POLICY_LABEL, type PayPolicyCode, type CurrencyInput } from './gymPolicy';
import type { FeeInput } from './gymSettings';
import type { ZoneInput } from './gymZone';

/** The row as it is stored now, straight off `GymProfile`. */
export interface GymSettingsNow {
  /** ISO 4217 as the gym set it, or null because it has not. */
  currency: string | null;
  /** Whole currency units, as `tenants.session_fee` stores it. */
  sessionFee: number | null;
  /** The stored code, UNMAPPED — `payPolicyOf` is asked here, not by the
   *  caller, because "a code this build does not know" is one of the two
   *  answers this module's rule turns on. */
  payPolicy: string | null;
  timezone: string | null;
}

/** What the form is about to write, as the field parsers already answered it. */
export interface GymSettingsNext {
  currency: CurrencyInput;
  fee: FeeInput;
  /** The picker's value: a code, or '' for "not decided". */
  policy: PayPolicyCode | '';
  zone: ZoneInput;
}

/**
 * The questions to ask before this save, in the order the fields sit on the
 * page — or an empty array when nothing on this form reaches backwards.
 *
 * One question per consequence, never merged. Two consequences folded into one
 * dialog is a dialog somebody agrees to for the half they were thinking about.
 */
export function consequences(now: GymSettingsNow, next: GymSettingsNext): string[] {
  const out: string[] = [];

  const nextCcy = next.currency.kind === 'currency' ? next.currency.currency : null;
  if (now.currency && nextCcy && nextCcy !== now.currency) {
    out.push(
      `Change this gym’s currency from ${now.currency} to ${nextCcy}?\n\n`
      + 'Nothing already recorded is re-denominated. Every payment, plan and pass keeps the '
      + `currency it was written in, so this gym’s ledger will hold both, and any total that `
      + 'spans the two is withheld rather than added up, for good.',
    );
  }
  if (now.currency && next.currency.kind === 'clear') {
    out.push(
      `Clear this gym’s currency? It is ${now.currency} now.\n\n`
      + 'Until one is set again a plan cannot be priced, a payment cannot be recorded and a '
      + 'price book cannot be imported. What is already recorded keeps its own currency.',
    );
  }

  /**
   * The fee, named in the money it is in.
   *
   * A bare "40 to 45" in a dialog about payroll is the one shape this codebase
   * does not print: a session fee has no currency of its own — it is in
   * whatever the gym charges in — and where the gym has not said what that is,
   * the sentence says so rather than letting the reader supply a currency out
   * of their own head.
   */
  const feeLabel = (n: number): string =>
    now.currency ? `${now.currency} ${n}` : `${n}, in a currency this gym has not set`;
  const nextFee = next.fee.kind === 'fee' ? next.fee.fee : null;
  if (now.sessionFee != null && nextFee != null && nextFee !== now.sessionFee) {
    out.push(
      `Change this gym’s session fee from ${feeLabel(now.sessionFee)} to ${feeLabel(nextFee)}?\n\n`
      + 'A session that was priced when it was marked keeps that price, and so does a coach on a '
      + 'rate of their own. Everything else is priced at whatever this says at the moment the '
      + 'figure is read, so months already worked and not yet settled will be worth a different '
      + 'amount afterwards. Settlements already written hold their own figure.',
    );
  }
  if (now.sessionFee != null && next.fee.kind === 'clear') {
    out.push(
      `Clear this gym’s session fee? It is ${feeLabel(now.sessionFee)} now.\n\n`
      + 'A session with no price of its own and a coach with no rate of their own then have no '
      + 'rate at all, and payroll withholds the figure rather than pricing the session at '
      + 'nothing. Sessions that carry their own rate are unaffected.',
    );
  }

  const nextZone = next.zone.kind === 'zone' ? next.zone.zone : null;
  if (now.timezone && nextZone && nextZone !== now.timezone) {
    out.push(
      `Change this gym’s timezone from ${now.timezone} to ${nextZone}?\n\n`
      + 'No stored figure changes: every time in this database is an instant. What moves is '
      + 'which day and which hour a screen files it under, for what has already happened as '
      + 'well as for what has not. A week you have already reconciled may come out to a '
      + 'different total.',
    );
  }
  if (now.timezone && next.zone.kind === 'clear') {
    out.push(
      `Clear this gym’s timezone? It is ${now.timezone} now.\n\n`
      + 'The dates do not go blank. They go back to whichever device is reading them, with '
      + 'nothing on any screen saying so. Two people in two countries would then see this '
      + 'gym’s Saturday differently and neither would be told.',
    );
  }

  const stored = storedPolicy(now);
  if (stored && next.policy !== '' && next.policy !== stored) {
    out.push(
      `Change what this gym pays a coach for?\n\n`
      + `It is “${PAY_POLICY_LABEL[stored]}” now, and this would make it `
      + `“${PAY_POLICY_LABEL[next.policy]}”.\n\n`
      + 'This is not only about sessions from here on. Every month that has been worked and not '
      + 'yet settled is recounted against the new answer the next time anybody opens Payroll, '
      + 'Close or their own earnings. A coach reading what they are owed for last month may '
      + 'see a different figure afterwards. Settlements already written hold theirs.',
    );
  }
  if (stored && next.policy === '') {
    out.push(
      `Clear what this gym pays a coach for? It is “${PAY_POLICY_LABEL[stored]}” now.\n\n`
      + 'No screen then states a policy: the payroll figures that depend on it are withheld '
      + 'rather than computed against a guess, and every coach’s earnings screen says the gym '
      + 'has not decided instead of showing a number.',
    );
  }

  return out;
}

/**
 * The stored pay policy, but only when this build can read it.
 *
 * Exported because the FIELD asks the same question the dialog does — a warning
 * printed beside a control and the question asked in front of the write must
 * not be able to disagree about whether this is a change.
 */
export function storedPolicy(now: Pick<GymSettingsNow, 'payPolicy'>): PayPolicyCode | null {
  return payPolicyOf(now.payPolicy) ? (now.payPolicy as PayPolicyCode) : null;
}
