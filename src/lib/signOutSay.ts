// What a person holding a PHONE is told when the sign-out could not be
// confirmed.
//
// ── why this is here and not in ./signOutFate ─────────────────────────────
//
// The discrimination is not repeated. `signOutOutcome` in ./signOutFate is the
// one place that decides whether a failed `supabase.auth.signOut()` ended the
// session, and every caller in this repo — the console's rail and now the three
// phone apps — asks it. What cannot be shared is the SENTENCE: its
// `SIGN_OUT_UNCONFIRMED` says "this browser may still be signed in", and the
// screens that need this one are a lock screen on a handset somebody may have
// picked up by mistake and a liability gate on a member's own phone. Telling
// either of them about a browser reads as a message meant for somebody else.
//
// ── what the failure leaves behind on a handset ───────────────────────────
//
// Same two exits as the console's, from `_signOut` in `@supabase/auth-js`
// (v2.110.2, the copy installed at the repo root) and written up in
// ./signOutFate: a failed session read returns the error WITHOUT clearing
// storage, and a failed POST to /logout clears storage first and then returns
// the error. Nothing in the resolved value separates them.
//
// On a phone the first of those is the one that bites, and it bites later:
// `src/ui/auth.tsx` has already dropped `user` to null, so the portal gates
// send the person to /welcome and the app looks signed out — while the stored
// session is still on the device and the NEXT LAUNCH restores it. Somebody who
// was told they had signed out hands on a phone that signs itself back in.
//
// ── what the sentence may and may not say ─────────────────────────────────
//
// The same three things its console sibling says, and nothing beyond them. It
// says the sign-out was not confirmed, which is the only fact available. It
// states the consequence — this phone MAY still be signed in — without claiming
// that it is. And it gives the action that follows from not knowing: look
// again, and do not pass the phone on until it is clear.
//
// What it deliberately does not say: "you are signed out" (unestablished, and
// the dangerous direction), "you are still signed in" (equally unestablished),
// and anything about wifi — a 502 from the auth host arrives here identically,
// and sending somebody to their network settings over a server fault sends them
// to fix the wrong thing.

/** The heading over it. Short, and a fact rather than an apology. */
export const SIGN_OUT_UNCONFIRMED_TITLE = 'Sign out not confirmed';

/** The body. See the header for every clause in it. */
export const SIGN_OUT_UNCONFIRMED_HANDSET =
  'The sign-in service could not be reached, so this phone may still be signed in. Open the app '
  + 'again and sign out once more if the account is still there — and do not hand this phone to '
  + 'anybody until it is gone.';
