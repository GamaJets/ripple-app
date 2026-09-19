// Spending something single-use, and the three answers that must not collapse.
//
// ── the shape this exists to replace ──────────────────────────────────────
//
// Two call sites in src/ui spend a thing that only works once — a coach's join
// code, and a coaching invitation — and both read their RPC the same way:
//
//     const { error } = await supabase.rpc('accept_invite', { p_invite: id });
//     linked = !error;                                     // src/ui/invites.tsx
//
//     if (error) return { ok: false, reason: joinErrorMessage(error.message) };
//                                                          // src/ui/joinCode.ts
//
// `!error` is two facts wearing one boolean, and the second line is worse: it
// hands the SERVER'S OWN WORDS to a person whose phone never reached a server,
// under a dialog titled "That code didn't work". The code worked. The lift did
// not. A member reading that goes back to their coach to argue about six
// characters neither of them has mistyped, and the remedy on offer — check the
// code — is the one thing that cannot help.
//
// The three outcomes, and what each one costs when it is read as another:
//
//   · the server REFUSED it. A real answer, identical tomorrow. Retrying is
//     wasted; the code may be thrown away.
//   · the server COULD NOT BE REACHED. Nothing was established. The code is
//     still good, still unspent, and must survive — src/lib/referralFate.ts
//     records what happened the last time a stashed code was deleted on one of
//     these: an unreachable RPC cleared it anyway and nobody was ever credited.
//   · it SUCCEEDED.
//
// ── what this module adds, and what it refuses to add ────────────────────
//
// It adds the SENTENCE and nothing else. Which results mean refused and which
// mean unreached is decided once, in src/lib/referralFate.ts, against the
// installed `@supabase/postgrest-js` — status 0 for a dead fetch, a 4xx
// carrying a SQLSTATE for the database ruling, a body that would not parse as
// PostgREST's JSON for a gateway page — and a second copy of that
// discrimination here would be a second thing to keep true. Every path below
// ends in `referralFate`, and `settled` is `referralSettled` and not a
// re-derivation of it.
//
// That module is named for the referral flush because that is where the defect
// was found. The classification is about a resolved PostgREST result and
// nothing about a referral, which is why it is imported rather than copied.
import { referralFate, referralSettled, type ReferralFate, type RpcResultLike } from './referralFate';

/**
 * What one attempt to spend a single-use thing established, and what a person
 * may be told about it.
 */
export interface CodeAttempt {
  /** Classified by `referralFate`. Never re-decided here. */
  readonly fate: ReferralFate;
  /**
   * Whether the question has been SETTLED — asked and answered, or ruled on.
   *
   * `referralSettled`, unchanged. It is the ceiling on what a caller may throw
   * away and not an instruction to throw anything away: an invitation is
   * somebody's only route to their coach, so src/ui/invites.tsx keeps a REFUSED
   * one on screen where they can ask about it, which is its own decision to
   * make and narrower than this permits.
   */
  readonly settled: boolean;
  /** What the person reads. Null when it worked, and there is nothing to say. */
  readonly message: string | null;
  /**
   * True when nothing was established — our end, not their code.
   *
   * The field a screen branches on when it is choosing between "check it with
   * your coach" and "try again in a moment". Read this rather than `!settled`
   * at a call site that is about to word a failure, because the two differ on
   * exactly the case this file exists for.
   */
  readonly unreached: boolean;
}

/**
 * What somebody is told when the request never landed.
 *
 * Three clauses, and each is load-bearing. It could not be reached — so this is
 * not about them. Nothing was sent — so no coach has a request they will not
 * recognise. It has not been used up — because the fear a single-use code
 * creates is that the failed attempt spent it, and a person who believes that
 * stops trying.
 *
 * It deliberately does NOT carry the server's own words. On this path those
 * words are a fetch failure — "TypeError: Network request failed" — and the
 * sentence they used to be pasted into ended "Nothing was sent", which is the
 * only true half of it.
 */
export const CODE_UNREACHED_MESSAGE =
  'We could not reach Repple, so nothing was sent and your code has not been used up. '
  + 'This is our end rather than the code — try again in a moment.';

/**
 * The fallback when a refusal arrives with nothing quotable on it.
 *
 * Says that the server answered, which is the fact that separates this from the
 * sentence above, and offers the remedy that matches it.
 */
export const CODE_REFUSED_MESSAGE =
  'Repple would not accept that, and it gave no reason we can pass on. Check it with whoever sent it to you.';

/**
 * Classify one resolved `supabase.rpc(...)` for a single-use code or invitation.
 *
 * Pass the WHOLE result — `const res = await supabase.rpc(…)` — not just
 * `error`. `status` is what tells a dead fetch (0) from the database ruling
 * (a 4xx with a SQLSTATE), and a result with no status at all is never read as
 * success by omission.
 *
 * `refusal` is what to say when the server DID rule: the caller's own
 * translation of the server's words, because only the caller knows which
 * refusals its RPC raises. It is used on no other path, so a network failure
 * can never be dressed in a sentence about the code.
 */
export function codeAttempt(res: RpcResultLike | null | undefined, refusal: string): CodeAttempt {
  const fate = referralFate(res);
  // 'not-asked' is a caller's own state — no backend, or no code to spend — and
  // `referralFate` does not produce it from a result. It is folded in with
  // 'unreached' anyway rather than left to fall through a default, because both
  // mean nothing was established and both keep the code, which is the side to
  // be wrong on.
  const ruled = fate === 'refused';
  return {
    fate,
    settled: referralSettled(fate),
    message: fate === 'recorded' ? null : ruled ? (refusal.trim() || CODE_REFUSED_MESSAGE) : CODE_UNREACHED_MESSAGE,
    unreached: fate !== 'recorded' && !ruled,
  };
}
