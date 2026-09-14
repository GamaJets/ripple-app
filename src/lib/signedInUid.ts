// The one place in the money path that asks Supabase who is signed in.
//
// Four lines of glue, and it is a file of its own for two reasons.
//
// ── one, so the classification stays testable ────────────────────────────
//
// `./supabase` and `./reportError` both reach react-native, so anything that
// imports them is unreachable from `node .tmp/lib/*.test.js`. Everything here
// that could be got wrong — which error means signed out, which sentence a
// person reads, what is reported and what is not — lives in
// src/lib/authedUid.ts and src/lib/authReadFate.ts, both of which are pure and
// both of which are tested. What is left in this file is the call itself.
//
// ── two, so `check:reads` keeps seeing the shape ─────────────────────────
//
// scripts/check-reads.mjs's second rule matches a line that destructures `data`
// out of an `await` on a `.auth.` call and has no `error` beside it. Fourteen
// such lines in src/lib/connect.ts and src/lib/subscriptions.ts were on its
// ratchet. They are gone, and the rule now has exactly ONE line to look at for
// both files — the one below, which names `error` and passes it on. Centralising
// is the case that rule's own comment anticipates when it declines to put a
// floor under `studio-web/`.
import { supabase } from './supabase';
import { reportError } from './reportError';
import { uidFromAuth, authGateFault, type UidRead } from './authedUid';

/**
 * Ask who is signed in, and say which of the two answers came back.
 *
 * `context` is the calling function's own `reportError` key — 'connect.fetchMyConnect'
 * and so on — so an outage is recorded under the read it broke rather than
 * under this file, which would group every one of them into a single
 * uninformative row.
 *
 * Never throws. A rejection from `getUser()` — which, per authReadFate.ts, only
 * a NON-AuthError produces, so in practice a bug rather than a network — is
 * caught and answered 'unreadable', because that is what it is: the question
 * was asked and nothing came back.
 */
export async function signedInUid(context: string): Promise<UidRead> {
  let who: UidRead;
  try {
    const { data, error } = await supabase.auth.getUser();
    who = uidFromAuth({ data, error });
  } catch (e) {
    reportError(context, e);
    return { uid: null, fate: 'unreadable' };
  }
  // Narrowed on `fate`, not on `!who.uid`. UidRead's two members are told apart
  // by fate being null or not; `uid` cannot do it, because its non-null member
  // is `string`, which includes '' — so `!who.uid` leaves `fate` as
  // `AuthReadFate | null` and the compiler is right to refuse it. The union
  // already forbids a blank uid (uidFromAuth answers 'unreadable' for one), and
  // this is the guard that says so in a way the type system can check.
  if (who.fate !== null) {
    const fault = authGateFault(who.fate);
    if (fault) reportError(context, fault);
  }
  return who;
}
