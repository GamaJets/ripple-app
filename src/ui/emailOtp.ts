// What an email confirmation code can fail with, said in sentences.
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

/**
 * How many digits the EMAIL code has.
 *
 * This said 6, and called it "Supabase's own default, and not ours to choose".
 * Both halves were wrong, and together they made signing in by email
 * impossible: 6 IS the default, but the length is configurable (Auth → Sign In
 * / Providers → Email → Email OTP length), the project had been set to 8, and
 * the screen drew six boxes for a code that arrives with eight digits in it.
 * There was no way to finish typing it. Reported from a real inbox.
 *
 * The project setting has since been put back to 6 and verified by reading it
 * off the dashboard, so this is 6 again — but for a different reason than
 * before. It is not "what Supabase issues". It is what THIS project is
 * configured to issue, it can be changed by somebody who never opens this
 * repository, and everything the app SAYS about the code is derived from it so
 * the sentence and the boxes cannot disagree again.
 *
 * MIN_OTP_SUBMIT below is the belt to this braces: if the setting moves again,
 * the screen still lets the member try.
 */
export const EMAIL_OTP_LENGTH = 6;

/**
 * The shortest code the screen will accept a submission of.
 *
 * The boxes are drawn at EMAIL_OTP_LENGTH, but the input no longer REFUSES a
 * shorter one, and that is deliberate. The length is a dashboard setting on a
 * server nobody has to redeploy: the moment it moves from 8 to 6, an app that
 * only submits at exactly 8 is broken in the other direction, and the member
 * sees six digits typed into eight boxes with nothing happening.
 *
 * So the boxes describe what to EXPECT and the Confirm button decides when to
 * TRY. Supabase's verifyOtp is the only thing that can say whether a code is
 * right, and it does not need our help guessing the length first.
 */
export const MIN_OTP_SUBMIT = 4;

/**
 * The length as a WORD, for prose.
 *
 * The defect this exists to prevent is not the number, it is the number
 * written twice. "the six digits we just emailed you" sat three lines above
 * `length={EMAIL_OTP_LENGTH}`, so the boxes followed the constant and the
 * sentence did not. Anything that tells a member how long the code is reads
 * this, never a literal.
 */
export const spellDigits = (n: number): string =>
  ({ 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' } as Record<number, string>)[n]
  ?? String(n);

// ── Why this file reads `currentReach()` and not `useReachability()` ───────
//
// The two generic fallbacks below used to end "Check your connection and try
// again" — the sentence src/lib/reachability.ts exists to replace, because half
// of what lands on them is the server having read the request and declined it.
//
// This is not a screen, so it cannot call `useReachability`. It does not need
// to. The hook exists to RE-RENDER a component when the answer changes; these
// functions are called once, in a catch, and produce a sentence that is stored
// and shown as it stood at that moment. `currentReach()` is the same store read
// imperatively, which is what src/lib/readRefresh.ts and src/ui/offlineFlush.tsx
// already do from outside React.
//
// Reading it here is in fact the BETTER instrument, and the ordering is why:
// `observedFetch` is installed on the Supabase client itself
// (src/lib/supabase.ts), so the very request that produced this error has
// already filed its own verdict — `noteThrown` on a transport failure,
// `noteReached` on a 4xx, which is the server talking — before supabase-js
// hands the error back to `src/ui/auth.tsx` and it reaches us. A hook value
// captured at the last render would be older than that.
//
// And on the sign-in path specifically, where nobody is signed in: none of this
// needs a session. The store is a module singleton, `ReachabilityProbe` is
// mounted in app/_layout.tsx above every gate, and the probe deliberately
// carries no key — see the note on `knock` in src/ui/reachability.tsx. So the
// answer is as good here as anywhere in the app.
import { currentReach, retryLine } from '../lib/reachability';

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
    return `That code was not right. Check the newest email — the code is ${spellDigits(EMAIL_OTP_LENGTH)} digits, and a new one replaces the old.`;
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
  // Reached only when the failure carries no code we know AND no words of its
  // own, so there is nothing specific left to say about the code itself.
  // `retryLine` is then the whole of what is knowable: whether this phone
  // reached us at all.
  return verbatim(f, `The code could not be checked. ${retryLine(currentReach())}`);
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
  // As above: no code, no message, so the only honest second half is the one
  // that says whether the request left the phone.
  return verbatim(f, `No code was sent. ${retryLine(currentReach())}`);
}
