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
//
// ── What was measured, 4 September 2026 ────────────────────────────────────
//
// Against the live database, because two screens on one account disagreed —
// the Clients tab said "12 days left in your free trial" and Billing said the
// start date could not be read:
//
//   · All 8 rows in `public.trainers` carry a `trial_started_at`. None is
//     null. The signed-in coach has a row like everybody else, so "a coach
//     with no trainers row" is not the state anybody was in.
//   · All 8 carry the SAME instant, 2026-09-01T19:38:29.737Z. `trainers` has
//     no `created_at` column, so part 191's backfill took its documented
//     `else` branch and stamped every existing coach with the moment the
//     migration ran. That is generous by construction and intended — but it
//     means the account's start date is the migration for every coach who
//     predates it, and the phone's is whenever that phone was first opened.
//     THE TWO WERE NEVER GOING TO MATCH, and neither screen said so.
//   · A `trainers` row is created by the sign-up trigger (parts 06 and 101),
//     by accepting an invitation (12, 1080) and by a desk assignment (711),
//     and `trial_started_at` has defaulted to `now()` since 191. So a coach
//     who can open this screen and has NO start date is not a normal cohort;
//     it is a profile that is not a coach.
//   · `trainers_self_rw` is `auth.uid() = id`, so the read is not refused.
//     What made Billing say "could not be read" is that
//     `src/ui/trialAccount.ts` needs `supabase.auth.getUser()`, which is a
//     round trip to `/auth/v1/user` — the account side is unavailable
//     offline and on any flaky moment, and the device counter can never
//     fail. That asymmetry is the whole of the divergence: the two screens
//     were not reading the same thing, and one of them was incapable of
//     admitting it did not know.
//
// The fix for that last point is not more careful wording on two screens. It
// is `src/ui/trialReading.ts` — ONE read, one `Date.now()`, both screens — so
// that they agree by construction rather than by both happening to be right.
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
 *
 * ── Four, because 'loading' is not 'failed' ────────────────────────────────
 *
 * This was three, and `readTrial` mapped every non-ready `LoadStatus` onto
 * 'unread' — so a screen one frame into its first read told the coach that
 * when their trial started COULD NOT BE READ. That is the house rule this
 * repo states everywhere else, broken in the file that states it: loading,
 * failed, empty and unknown are four different sentences. A read in flight is
 * now 'loading', says so, and no screen draws an apology for a request that
 * has not come back yet.
 */
export type TrialSource = 'account' | 'loading' | 'unread' | 'none';

export interface TrialReading {
  state: TrialState | null;
  source: TrialSource;
  /** Prose for the screen. Sentence case: it sits under a heading. */
  note: string;
}

export function readTrial(startedAt: string | null | undefined, status: LoadStatus, now: number): TrialReading {
  if (status === 'loading') {
    return {
      state: null,
      source: 'loading',
      // Present tense and no apology. Nothing has failed; a request is out.
      note: 'Checking your account for when your trial started…',
    };
  }
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
 * ── The branch that switched it off where it was needed ────────────────────
 *
 * This took a `TrialState | null` and opened with `if (!account) return null`.
 * Two unrelated things arrive at this function as a null account, and only one
 * of them is an unknown:
 *
 *   'unread'  the account did not answer. Nothing is established, so nothing
 *             can be said to disagree with anything. Silence is right.
 *   'none'    the account ANSWERED, and it has no start date on it. That is a
 *             fact, and it is in flat contradiction with a phone counting down
 *             from twelve. It is the exact case this function exists for.
 *
 * Folding them together meant the one mechanism built to reconcile the two
 * figures was switched off in the state where they diverge hardest — the phone
 * asserting a countdown and the account holding nothing to count from. It now
 * takes the whole `TrialReading`, so the two nulls cannot be confused by a
 * caller and there is no way to pass a bare null and be answered with silence.
 *
 * Null when they agree, while either is still loading, while the account is
 * unread, when the phone has no figure, or when the difference is under a day.
 */
export function trialDisagreement(reading: TrialReading, localDaysLeft: number | null): string | null {
  if (localDaysLeft == null || !Number.isFinite(localDaysLeft)) return null;
  // Nothing established yet, or nothing established at all. Neither is a
  // disagreement — a disagreement needs two answers.
  if (reading.source === 'loading' || reading.source === 'unread') return null;
  if (reading.source === 'none') {
    // The account answered and holds nothing. Said even at zero days on the
    // phone, because the point is not the size of the gap: it is that the
    // number on this screen is about an INSTALLATION and the account has no
    // opinion at all.
    return `This phone is counting from the day the app was first opened on it and has ${localDaysLeft} ${localDaysLeft === 1 ? 'day' : 'days'} left by that reckoning. Your account holds no trial start date, so that figure is about this installation and not about your account, and nothing is decided on it.`;
  }
  const account = reading.state;
  if (!account) return null;
  if (Math.abs(localDaysLeft - account.daysLeft) < 1) return null;
  return `This phone has ${localDaysLeft} ${localDaysLeft === 1 ? 'day' : 'days'} recorded and your account has ${account.daysLeft}. Your account is the one that counts — the figure on a phone starts again whenever the app is reinstalled, which is why it is no longer what anything is decided on.`;
}

/**
 * The trial card on the coach's Clients tab, or nothing.
 *
 * ── The screen this replaces, and the decision in it ───────────────────────
 *
 * app/(trainer)/dashboard.tsx rendered `trialInfo()` from src/lib/trial.ts —
 * an AsyncStorage counter whose own header says in capitals that it is no
 * longer the authority on anything, and which starts again on reinstall. It
 * was printed as a flat fact ("12 days left in your free trial") on the first
 * screen a coach opens, while Billing, one tap away and on the same account,
 * said the start date could not be read.
 *
 * Three things could go there instead, and this is the argument for the one
 * that is here:
 *
 *   Print the phone's figure.   No. It is not a fact about the account, it
 *                               resets on reinstall, nothing is decided on it,
 *                               and printing it is the whole defect.
 *
 *   Always say something.       An "we could not check how long is left" card
 *                               on the Clients tab spends the coach's busiest
 *                               screen apologising for a number that changes
 *                               nothing they can do today — NOTHING IS GATED
 *                               on the trial (see TRIAL_NOT_YET_ENFORCED). A
 *                               card that appears whenever the network hiccups
 *                               is a card that gets ignored, and then it is
 *                               ignored on the day it means something.
 *
 *   Say it only when it is a    Yes. The countdown appears when the ACCOUNT
 *   fact.                       produced it and is silent otherwise, and
 *                               Billing — the screen whose subject is the
 *                               trial — carries all four states in full, with
 *                               the disagreement line above. One tap, and the
 *                               tap is the one the coach makes when they want
 *                               the answer.
 *
 * Returning null rather than leaving the policy in a `.tsx` ternary is what
 * makes the two screens agree by construction: there is one place that decides
 * a countdown is printable, it is pure, and it is under test.
 */
export interface TrialCard {
  /** The headline. Only ever a figure the account produced. */
  title: string;
  /** The line under it. */
  note: string;
  expired: boolean;
}

export function trialCard(reading: TrialReading, billingOpen: boolean): TrialCard | null {
  const s = reading.state;
  if (reading.source !== 'account' || !s) return null;
  return {
    title: s.expired
      ? 'Your free trial has ended'
      : `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left in your free trial`,
    // Neither half claims a consequence. `PLANS` features ("Up to 3 clients")
    // are checked nowhere, and no screen refuses anything on an expired trial,
    // so "upgrade to keep coaching" would be a false statement about what the
    // money buys — the sort a store reviewer opens the paid screen to check.
    note: billingOpen
      ? (s.expired ? 'Nothing has been switched off. Subscribe when you are ready.' : 'Subscribe any time — see what each plan includes.')
      : 'Subscriptions are not open yet — keep coaching, and we will be in touch before anything changes.',
    expired: s.expired,
  };
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
