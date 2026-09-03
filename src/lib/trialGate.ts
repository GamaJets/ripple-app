// Where a coach is in their free trial, decided from the ACCOUNT and not the
// device.
//
// ── The leak this closes ───────────────────────────────────────────────────
//
// `src/lib/trial.ts` keeps a start date under one AsyncStorage key. Delete the
// app and reinstall it, clear its storage, or sign in on a second phone, and
// the fourteen days start again from zero. There is no account-level expiry
// anywhere in the product.
//
// Nothing is lost by it TODAY, because nothing is gated — trial.ts says so
// itself, and no EXPO_PUBLIC_STRIPE_PRICE_* is set in any eas.json profile. It
// is a straightforward revenue leak on the day billing is switched on, and the
// record has to exist BEFORE that day: a gate added afterwards cannot tell a
// coach who has had six months of free trial from one who installed yesterday,
// because the device was the only thing that ever knew.
//
// Part 191 adds `trainers.trial_started_at`, immutable once set. This file is
// the arithmetic on top of it, kept pure so it runs under plain `node` — the
// read is in src/ui/trialAccount.ts.
//
// ── Why the length is not stored ───────────────────────────────────────────
//
// `TRIAL_DAYS` is a product decision and it lives here, as a constant, exactly
// as it does in trial.ts. Storing an end date per coach would freeze whatever
// the constant said on the day each of them signed up, so changing fourteen
// days to twenty-one would apply to nobody already on one — and the two cohorts
// would be indistinguishable afterwards. A start date plus a rule is one fact
// and one rule; an end date is the answer with the rule baked into it and lost.
//
// ── An unread trial is not an expired one ──────────────────────────────────
//
// The single most important line in this file. A coach whose `trial_started_at`
// could not be read has not run out of anything: the read failed. Reporting
// that as expired would put a paywall in front of somebody on their second day
// because a query was refused, and the version of that mistake this codebase
// keeps finding — an empty list read as "there are none" — is the same shape.
// `trialFrom` therefore returns null for an unread start, and every caller has
// to handle null rather than being handed a plausible number.
import type { LoadStatus } from '../ui/loadStatus';
import { isoDay } from './weekStart';

/** The length of the free trial, in days. One copy, and it is a constant rather
 *  than a column — see the header. Kept equal to `TRIAL_DAYS` in trial.ts by
 *  the test, so the local banner and the account-wide figure cannot drift. */
export const TRIAL_DAYS = 14;

export interface TrialState {
  /** `YYYY-MM-DD` of the day the trial began, as the account records it. */
  startedOn: string;
  /** Whole days remaining, floored at zero. */
  daysLeft: number;
  expired: boolean;
}

/**
 * Where the trial stands, or null when the account could not say.
 *
 * `now` is passed in rather than read from a clock inside this function, so the
 * arithmetic is testable and so a caller cannot get a different answer from the
 * one that was rendered a line earlier.
 *
 * Days are counted from the START INSTANT rather than between calendar days,
 * which matters at both ends: a coach who signed up at 11pm has a full first
 * day, not an hour of one, and a trial does not gain or lose a day when the
 * clocks change. `Math.floor` on the elapsed days is what trial.ts already
 * does, so the two agree about the number they show.
 */
export function trialFrom(startedAt: string | null | undefined, now: number): TrialState | null {
  const t = Date.parse(String(startedAt ?? ''));
  if (!Number.isFinite(t)) return null;
  if (!Number.isFinite(now)) return null;
  const elapsed = Math.floor((now - t) / 86_400_000);
  // A start date in the FUTURE is not a trial with more than the full length
  // left. It is a clock disagreement — the device's, the server's, or a row
  // written by hand — and the honest reading is the whole trial rather than
  // sixteen days of one. Clamped rather than refused, because a coach whose
  // phone is a day fast should not be shown an error about their account.
  const daysLeft = Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - elapsed));
  return {
    // The coach's own day, not UTC's. `daysLeft` above is counted from the
    // start INSTANT and is unaffected either way, but `startedOn` is the date
    // this is shown as — "your trial started on the 3rd" — and a coach who
    // signed up at 5pm in Los Angeles was told the 4th. They then read a
    // countdown that had already spent a day they could not account for, on the
    // one screen whose whole job is to say honestly how much time is left
    // before they are asked for money.
    startedOn: isoDay(new Date(t)),
    daysLeft,
    expired: daysLeft <= 0,
  };
}

/**
 * Which of the two answers to believe, and what to say when they disagree.
 *
 * The account is the authority whenever it answered. The device's own copy is
 * kept only as something to SAY — "this phone thinks eleven, your account says
 * three" — because the gap between them is the leak itself, and a coach who has
 * reinstalled twice is entitled to see that the app noticed.
 *
 * When the account could not be read the answer is `null` and the reason is
 * 'unread'. It is deliberately NOT the device's figure: a local number
 * presented as the account's would be exactly the thing that made the leak
 * invisible, and this app's rule everywhere else is that an unread value is
 * unknown rather than whatever was lying around.
 */
export type TrialSource = 'account' | 'unread' | 'none';

export interface TrialReading {
  state: TrialState | null;
  source: TrialSource;
  /** Prose for the screen. Sentence case: it sits under a heading. */
  note: string;
}

export function readTrial(startedAt: string | null | undefined, status: LoadStatus, now: number): TrialReading {
  if (status !== 'ready') {
    return {
      state: null,
      source: 'unread',
      // Never "your trial has ended". A read that failed is not a trial that
      // ran out, and a paywall raised on a refused query is the worst version
      // of this app's worst defect wearing a billing hat.
      note: 'When your trial started could not be read, so nothing here says how long is left. This is not a statement that it has ended, and nothing has been withdrawn.',
    };
  }
  const state = trialFrom(startedAt, now);
  if (!state) {
    return {
      state: null,
      source: 'none',
      note: 'Your account has no trial start date on it. That is not an expired trial — it is a record with nothing in that field, and nothing is gated on it.',
    };
  }
  return {
    state,
    source: 'account',
    note: state.expired
      ? `Your free trial started on ${state.startedOn} and the ${TRIAL_DAYS} days are up. It is recorded on your account rather than on this phone, so reinstalling the app does not start it again.`
      : `${state.daysLeft} of your ${TRIAL_DAYS} free days ${state.daysLeft === 1 ? 'is' : 'are'} left, counted from ${state.startedOn}. It is recorded on your account rather than on this phone.`,
  };
}

/**
 * The sentence for a coach whose phone and account disagree.
 *
 * Null when they agree, when either is unknown, or when the difference is under
 * a day. Shown rather than swallowed, because the disagreement is the whole
 * point of part 191: a device that thinks there are eleven days left of a trial
 * the account says ended a month ago is a device that has been reinstalled, and
 * the coach should see which figure is the real one before they plan around it.
 */
export function trialDisagreement(account: TrialState | null, localDaysLeft: number | null): string | null {
  if (!account || localDaysLeft == null || !Number.isFinite(localDaysLeft)) return null;
  if (Math.abs(localDaysLeft - account.daysLeft) < 1) return null;
  return `This phone has ${localDaysLeft} ${localDaysLeft === 1 ? 'day' : 'days'} recorded and your account has ${account.daysLeft}. Your account is the one that counts — the figure on a phone starts again whenever the app is reinstalled, which is why it is no longer what anything is decided on.`;
}

/**
 * That nothing is gated on this yet, said where a coach can read it.
 *
 * Honest about the current state rather than implying a lock that does not
 * exist. The day prices are configured this sentence changes, and until then a
 * coach reading "your trial has ended" beside a fully working app would
 * reasonably conclude the app was lying to them about one or the other.
 */
export const TRIAL_NOT_YET_ENFORCED =
  'Nothing is switched off when a trial ends today. This is a record of when yours started, kept on your account so it survives a reinstall, and it will be what the paid plans are counted from once they can be bought.';
