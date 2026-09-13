// The AI Coach health consent, once it lives on the account instead of the
// handset — and the rules for getting it there without losing an answer.
//
// ── What is wrong today ───────────────────────────────────────────────────
//
// src/ui/coachShare.tsx keeps the answer in AsyncStorage under
// `COACH_SHARE_KEY`, and its own header says what that costs and why it was
// accepted: "Following the account would need a column and a migration, and
// this change is not permitted to apply SQL. So it is device-local for now, and
// the cost is real and specific: a member who reinstalls, or who signs in on a
// second handset, is ASKED AGAIN."
//
// That was the right trade for a change that could not touch the database. It
// is still a health-related consent stored on a device:
//
//   · a reinstall loses it. The member is asked again about their medical data
//     by an app they already answered, which reads as the app having forgotten
//     — and the answer it forgot may have been NO;
//   · a second handset never had it, so somebody who declined on their phone is
//     asked afresh on their tablet, and a "yes" there applies to a thread the
//     phone will never show;
//   · there is no record. `storedConsent` writes `{"shareHealth":true}` and not
//     one word about when, so nothing in the product can say when somebody
//     agreed to send their injuries and their body composition to a model.
//
// supabase/parts/2820 is the account side. This module is the pure half: what a
// stored row means, and — the part that has to be right — what to do when the
// account and the handset disagree.
//
// ── A CONSENT IS A RECORD ─────────────────────────────────────────────────
//
// Three rules, and each one is a way this migration could go wrong.
//
//   1. NOBODY WHO HAS ANSWERED IS ASKED AGAIN. The whole point. A device
//      holding an answer and an account holding none is the reinstall case
//      inverted — the account is new, the answer is real, and putting the
//      question again would be the defect this change exists to remove.
//   2. AN EXISTING ANSWER IS NEVER RE-DATED. The device blob holds no date at
//      all, so a row carried up from one cannot claim a day. `answeredAt` is
//      null for it and the part's column comment says so: null means "this
//      person answered, on a device that did not record when". Stamping today
//      would manufacture a consent date, which is worse than having none.
//   3. AN ANSWER IS NEVER OVERWRITTEN BY A GUESS. Carrying up happens only
//      when the account read COMPLETED and found nothing. Under a failed read
//      we do not know what the account holds, so nothing is written — the
//      handset's answer is honoured for this session and left where it is.
//
// The fourth rule is the one the device version already had and it does not
// change: 'unknown' is a state. Nothing goes to the model on it. See
// `shareableContext` in src/lib/coachShare.ts, which refuses on 'unknown' and
// 'unasked' alike rather than trusting the caller to have checked.
import type { ShareConsent } from './coachShare';

/** One row of `ai_coach_health_consents` as the app reads it back. */
export interface AccountConsentRow {
  shareHealth: boolean;
  /** When the person answered, or null when the answer was carried up from a
   *  handset that never recorded a date. Never today's date standing in. */
  answeredAt: string | null;
  /** When the row reached the account. Always known, and never presented as
   *  the day somebody consented. */
  recordedAt: string;
}

/**
 * What the account's newest row says.
 *
 * 'unasked' for no row, and for a row we cannot read as one. The same direction
 * `consentFromStored` takes for a damaged blob in src/lib/coachShare.ts, and
 * for the same reason: a value that is not one of the two written answers is
 * not somebody's decision about their own medical data, and the only safe
 * reading of damage is that the question is still open.
 *
 * Never 'unknown'. This is only ever called on a read that completed; 'unknown'
 * describes the window before one does, which is a fact about time.
 */
export function consentFromAccountRow(row: unknown): 'yes' | 'no' | 'unasked' {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'unasked';
  const v = (row as Record<string, unknown>).shareHealth;
  if (typeof v !== 'boolean') return 'unasked';
  return v ? 'yes' : 'no';
}

/** What a resolved consent needs the caller to do about it. */
export interface ResolvedConsent {
  /** The answer this session acts on. Nothing is sent on 'unknown' or
   *  'unasked' — src/lib/coachShare.ts holds that lock, not this file. */
  consent: ShareConsent;
  /**
   * True when the handset holds an answer the account does not, and the account
   * read completed. The caller writes it up, with `carriedUpAnsweredAt` as the
   * date — which is null, because the handset never recorded one.
   *
   * False in every other case, including every case where the account read
   * failed: see rule 3 above.
   */
  carryUp: boolean;
}

/**
 * `answeredAt` for a row carried up off a handset. Null, always, and exported
 * as a named constant so that a caller cannot quietly pass `new Date()` and so
 * that the test can assert the absence rather than trusting a comment.
 *
 * The handset blob is `{"shareHealth":true}`. It has never held a date, so
 * there is no date to carry, and today is not one — it is the day of the
 * MIGRATION. A consent record that says somebody agreed today when they agreed
 * last March is a false record, and it is false in the direction that matters:
 * it makes an old answer look freshly given.
 */
export const CARRIED_UP_ANSWERED_AT: null = null;

/**
 * Reconcile what the account says with what this handset says.
 *
 * @param account the account's answer, or 'unknown' when that read has not
 *   landed or did not succeed.
 * @param device the handset's answer, from `consentFromStored`, or 'unknown'
 *   before AsyncStorage has come back.
 */
export function resolveConsent(account: ShareConsent, device: ShareConsent): ResolvedConsent {
  // The account has an answer. It is the record, and it wins over the handset
  // in both directions — including the case a naive merge gets wrong, where the
  // account says 'no' and this handset still holds an old 'yes'. Withdrawing on
  // one device and being re-consented by another is the worst outcome available
  // here, and it is the one an "any yes wins" merge produces.
  if (account === 'yes' || account === 'no') return { consent: account, carryUp: false };

  // The account read completed and this person has never answered ON THE
  // ACCOUNT. If the handset holds an answer, that IS their answer: honour it,
  // and write it up so the next device inherits it. Rule 1.
  if (account === 'unasked') {
    if (device === 'yes' || device === 'no') return { consent: device, carryUp: true };
    return { consent: 'unasked', carryUp: false };
  }

  // The account read has not landed, or failed. We do not know what is up
  // there, so nothing may be written — rule 3. The handset's own answer is
  // still this person's answer and is honoured for the session; a member who
  // declined does not start sending their injuries because a read timed out.
  if (device === 'yes' || device === 'no') return { consent: device, carryUp: false };
  // Nothing known anywhere yet. Not 'unasked': putting the question during a
  // read that may still be about to say "you answered this in March" is the
  // re-ask this whole change exists to stop.
  return { consent: 'unknown', carryUp: false };
}

/**
 * The sentence the member is shown once their answer follows the account.
 *
 * The device version's honest note said the opposite — that answering again on
 * a new phone was expected. Leaving that on screen after this change would
 * describe behaviour the product no longer has.
 */
export const CONSENT_FOLLOWS_ACCOUNT_NOTE =
  'Your answer is kept with your account, so you are asked once rather than again on every phone you sign '
  + 'in on. You can change it here whenever you like, and changing it here changes it everywhere.';

/**
 * What a member is told about a consent carried up off this handset.
 *
 * It exists because the alternative is silence about a record that now has a
 * date on it. "Recorded today" against an answer given months ago is the claim
 * `CARRIED_UP_ANSWERED_AT` refuses to let the database make; this is the same
 * refusal in the words the member reads.
 */
export const CONSENT_CARRIED_UP_NOTE =
  'The answer you gave on this phone has been kept with your account. We do not know the day you first '
  + 'gave it, so it is recorded as carried over rather than given today.';
