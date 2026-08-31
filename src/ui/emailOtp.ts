// What a six-digit email confirmation can fail with, said in sentences.
//
// ── Why a code and not a link ──────────────────────────────────────────────
//
// Email confirmation was turned off on 26 Aug 2026 (docs/LAUNCH-CHECKLIST.md,
// item 1) because the confirmation LINK was being spent before the person read
// it. `{{ .ConfirmationURL }}` routes through /auth/v1/verify, which redeems the
// one-time token on a bare GET, and a corporate mail scanner — Microsoft 365 in
// the case that surfaced it — fetches every URL in a message before delivering
// it. Three of the first twelve signups never completed. web/confirmed.html
// works around it by holding a `token_hash` until somebody presses a button.
//
// A code removes the problem rather than working around it: there is no URL for
// a scanner to fetch, and nothing a machine can press. That is the whole reason
// this file exists.
//
// ── Why the mapping is here and not inlined ────────────────────────────────
//
// The same failure has to read the same way whether it came back from the first
// verify, a resend, or a sign-in that turned out to be unconfirmed. Three call
// sites writing their own wording is how "Invalid login credentials" ends up in
// front of somebody whose password was never the problem.
//
// Written against `error.code` first and the message only as a fallback: the
// codes are a documented, stable surface (@supabase/auth-js error-codes.d.ts),
// the prose is not, and matching prose alone is how a wording change on
// Supabase's side silently turns every mapped case into the generic one.

/**
 * The shape every OTP step answers with.
 *
 * `ok: false` carries a sentence rather than a flag for the reason given in
 * auth.tsx's SessionOutcome: each caller shows it differently, and a boolean
 * would have each of them inventing wording for a failure they know less about
 * than the code that caught it.
 */
export type OtpOutcome = { ok: true } | { ok: false; reason: string };

/** How many digits Supabase issues. Its own default, and not ours to choose. */
export const EMAIL_OTP_LENGTH = 6;

interface Failure { code: string; message: string; status: number | null }

/** Pull the three things worth branching on out of whatever was thrown. */
function failure(e: unknown): Failure {
  const any = e as { code?: unknown; message?: unknown; status?: unknown } | null;
  return {
    code: typeof any?.code === 'string' ? any.code : '',
    message: typeof any?.message === 'string' ? any.message : '',
    status: typeof any?.status === 'number' ? any.status : null,
  };
}

/** Supabase's own words, when we have some and have nothing better to say. */
function verbatim(f: Failure, fallback: string): string {
  const m = f.message.trim();
  return m ? m : fallback;
}

/**
 * Whether a sign-in failed only because the address was never confirmed.
 *
 * Worth its own question because it is the one sign-in failure with a way
 * forward that is not "try your password again": the account exists, the
 * password was right, and what is missing is a code we can send.
 */
export function isUnconfirmedEmailError(e: unknown): boolean {
  const f = failure(e);
  return f.code === 'email_not_confirmed' || /email not confirmed/i.test(f.message);
}

/**
 * A code that was typed in and refused.
 *
 * ── On expired versus already used ────────────────────────────────────────
 *
 * They are the same sentence here, and that is not laziness. GoTrue deletes a
 * one-time token when it is spent, so a code used twice and a code left too
 * long come back identically — `otp_expired`, "Token has expired or is
 * invalid". Splitting them would mean guessing which happened, and the guess is
 * load-bearing: told only "expired", somebody who already confirmed on another
 * device goes looking for a newer email that will never arrive. So the sentence
 * covers both and the action — ask for a new one — is the same either way.
 *
 * A WRONG code is genuinely different and is genuinely distinguishable, so it
 * gets its own sentence, and one that says what to check.
 */
export function emailCodeError(e: unknown): string {
  const f = failure(e);

  if (f.code === 'otp_expired' || /expired/i.test(f.message)) {
    return 'That code has expired, or it has already been used. Ask for a new one below.';
  }
  if (f.code === 'over_request_rate_limit' || f.status === 429 || /rate limit|too many/i.test(f.message)) {
    return 'Too many tries. Wait a moment, then enter the code again.';
  }
  if (f.code === 'invalid_credentials' || f.code === 'validation_failed' || /invalid|incorrect|token/i.test(f.message)) {
    return 'That code was not right. Check the newest email — the code is six digits, and a new one replaces the old.';
  }
  if (f.code === 'user_not_found') {
    return 'There is no account waiting on that address. Check the address, or create the account again.';
  }
  if (f.code === 'otp_disabled') {
    return 'Codes are not switched on for this account. Sign in with your email and password instead.';
  }
  if (f.code === 'user_banned') {
    return 'That account has been suspended. Contact your gym.';
  }
  return verbatim(f, 'The code could not be checked. Check your connection and try again.');
}

/**
 * A request for another code that did not go out.
 *
 * Supabase throttles confirmation email per address AND per hour globally, and
 * a throttled send returns an error — nothing is sent. Reporting "sent" for it
 * leaves somebody watching an inbox that is not going to fill, which is exactly
 * the failure this whole flow exists to end.
 */
export function emailResendError(e: unknown): string {
  const f = failure(e);

  if (f.code === 'over_email_send_rate_limit' || f.code === 'over_request_rate_limit' || f.status === 429
    || /rate limit|too many|security purposes|after \d+ seconds/i.test(f.message)) {
    return 'No code was sent — too many have been requested. Wait a moment, then ask again.';
  }
  // GoTrue answers a resend for an already-confirmed address with a 422 whose
  // code is the catch-all `validation_failed`, so this one is matched on prose.
  if (/already (been )?confirmed|already registered/i.test(f.message)) {
    return 'That address is already confirmed, so there is no code to send. Go back and sign in with your password.';
  }
  if (f.code === 'user_not_found') {
    return 'No code was sent — there is no account waiting on that address. Go back and create it.';
  }
  if (f.code === 'email_address_invalid' || f.code === 'validation_failed') {
    return 'No code was sent — that address was not accepted. Go back and check it.';
  }
  if (f.code === 'email_address_not_authorized') {
    return 'No code was sent — that address is not allowed to receive mail from us yet.';
  }
  if (f.code === 'email_provider_disabled' || f.code === 'signup_disabled') {
    return 'No code was sent — email sign-up is switched off right now.';
  }
  if (f.code === 'user_banned') {
    return 'No code was sent — that account has been suspended. Contact your gym.';
  }
  return verbatim(f, 'The code could not be sent. Check your connection and try again.');
}
