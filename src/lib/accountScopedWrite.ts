// Which account a server write is made AS, and what a store does when it is
// not told.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// src/lib/deviceAccountCache.ts ended the half of the cross-account class that
// lives on the handset: a blob under a key with no account in it. This is the
// other half, and it survived that fix.
//
// A store resolved its own idea of who was signed in, at write time:
//
//   // the screen decides, using useAuth()'s uid …
//   const verdict = pushUpDecision({ cache, writeUid: uid, … });
//   if (verdict === 'push') {
//     // … and the store resolves its OWN, one await later
//     void saveCoachPrefs({ goalRevenue, goalClients });   // getUser() inside
//   }
//
// Two independent answers to "who is signed in", one DECIDING and one WRITING,
// with at least one await between them. On a gym handset that is signed in and
// out all day they can disagree, and when they do the guard has vouched for a
// write it did not describe: `pushUpDecision` checked the blob against account
// A, said 'push', and the row went in as account B — one coach's revenue and
// client targets filed permanently under another's name, rendered under "Your
// goals" with a progress arc as though B had set them.
//
// Note what makes it invisible: nothing errors. `getUser()` answers correctly
// for the session it is asked about. The write succeeds. Every check the code
// performs passes. The only thing wrong is that the check and the write were
// about different people.
//
// ── The fix is a signature, not a check ───────────────────────────────────
//
// The store STOPS RESOLVING. It takes the uid the caller decided with, and the
// decision and the write are then the same account by construction — there is
// no second resolution left to disagree with the first. A store that returned
// the uid it used instead would only let the caller notice afterwards, which is
// a correction after a wrong row, not a prevention.
//
// The safety net underneath is RLS: `with check (user_id = auth.uid())`. Handed
// A's uid while the session has moved to B, the write is REFUSED rather than
// silently retargeted — which is the outcome we want, and the opposite of what
// a fresh `getUser()` produces.
//
// ── And being handed nothing is a refusal, not a fallback ─────────────────
//
// A null, blank or 'unknown' uid is not an account. 'unknown' is the literal
// src/ui/clientData.tsx settles on before the auth read lands: it looks like an
// id and is not one. A store handed one of those must REFUSE and say so — it
// must not fall back to `getUser()`, because falling back is exactly the
// behaviour being removed, and it reintroduces it on the one path where the
// caller has already admitted it does not know.
//
// The predicate is not restated here. `accountCacheKey` in
// src/lib/deviceAccountCache.ts already encodes it for the device half, and one
// rule with two copies is a rule that drifts — silently, and in the direction
// of the defect. This composes a throwaway key from the uid and reads the uid
// back out, so a literal added there is refused here on the same day.
//
// Pure: a string in, a string or a refusal out. No storage, no supabase, so
// `npm test` reaches all of it.
import { accountCacheKey } from './deviceAccountCache';

/**
 * A prefix used for nothing but running `accountCacheKey`'s refusal.
 *
 * It ends in ':' because that function refuses a prefix that does not, and the
 * uid is recovered by length rather than by splitting on ':' — a uuid contains
 * no colon today, but a key format that grew one would turn a split into a
 * truncated id, which is a worse failure than the one being fixed.
 */
const UID_PROBE = 'uid:';

/**
 * The account this uid names, or null when it does not name one.
 *
 * Null means DO NOT WRITE. It never means "look it up yourself".
 */
export function accountUid(uid: string | null | undefined): string | null {
  const probed = accountCacheKey(UID_PROBE, uid);
  return probed ? probed.slice(UID_PROBE.length) : null;
}

/**
 * Whether a store may write, and as whom.
 *
 * A discriminated pair rather than `string | null`, so a caller cannot reach
 * the uid without having gone past the refusal — and so the refusal has
 * somewhere to carry its reason as the reasons multiply.
 */
export type WriteTarget =
  | { readonly write: true; readonly uid: string }
  /** No account was supplied. The caller did not know who it was writing as,
   *  and neither may the store. */
  | { readonly write: false; readonly why: 'no-account' };

export function writeTargetFor(uid: string | null | undefined): WriteTarget {
  const id = accountUid(uid);
  return id ? { write: true, uid: id } : { write: false, why: 'no-account' };
}

/**
 * What a refused write is reported as.
 *
 * Reported, not swallowed: a store that quietly returns "did not write" for a
 * caller that thought it had an account is a bug in the caller, and the whole
 * point of this file is that this class of bug leaves no other trace.
 */
export const NO_ACCOUNT_TO_WRITE_AS = 'refused: no account to write as';
