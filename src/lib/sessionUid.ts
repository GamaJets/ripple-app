// The `getSession()` twin of src/lib/signedInUid.ts, and a file of its own for
// the same two reasons that one gives.
//
// ── one, so the classification stays testable ────────────────────────────
//
// `./supabase` and `./reportError` both reach react-native, so anything that
// imports them is unreachable from `node .tmp/lib/*.test.js`. Everything here
// that could be got wrong — which error means signed out, what a present
// session with an unreadable user means, which sentence a person reads, what is
// reported and what is not — lives in src/lib/sessionUidRead.ts,
// src/lib/authedUid.ts and src/lib/authReadFate.ts, all three of which are pure
// and all three of which are tested. What is left here is the call itself.
//
// ── two, so `check:reads` keeps seeing the shape ─────────────────────────
//
// RULE TWO in scripts/check-reads.mjs matches a line that destructures `data`
// out of an `await` on a `.auth.` call with no `error` beside it. Every src/ui
// provider that fronted its reads with `const { data: sess } = await
// supabase.auth.getSession()` was one such line. Routed through here they
// become none, and the rule has a single line to look at for all of them — the
// one below, which names `error` and passes it on.
import { supabase } from './supabase';
import { reportError } from './reportError';
import { uidFromSession } from './sessionUidRead';
import { authGateFault, type UidRead } from './authedUid';

/**
 * Ask who is signed in from the session already on this device, and say which
 * of the two answers came back.
 *
 * Storage-first, which is the point: `getSession()` answers offline, and this
 * app is used in basement gyms. It goes to the network only to refresh an
 * access token that has actually expired — and that is precisely the case
 * where an outage used to arrive as `session: null` and read as a sign-out.
 *
 * `context` is the calling hook's own `reportError` key — 'sessions.hydrate',
 * 'foodLog.today' and so on — so an outage is recorded under the read it broke
 * rather than under this file, which would group every one of them into a
 * single uninformative row.
 *
 * Never throws. `__loadSession` has a `try/finally` and no `catch`, so a
 * rejection is possible where `_callRefreshToken` did not convert the failure
 * into a returned `error` — a bug rather than a network. It is caught and
 * answered 'unreadable', because that is what it is: the question was asked and
 * nothing came back.
 */
export async function sessionUid(context: string): Promise<UidRead> {
  let who: UidRead;
  try {
    const { data, error } = await supabase.auth.getSession();
    who = uidFromSession({ data, error });
  } catch (e) {
    reportError(context, e);
    return { uid: null, fate: 'unreadable' };
  }
  // Narrowed on `fate`, not on `!who.uid` — see the note in signedInUid.ts and
  // the guard in uidFromSession: `string` includes '', so `!who.uid` does not
  // discriminate the union and the compiler is right to refuse it.
  if (who.fate !== null) {
    const fault = authGateFault(who.fate);
    if (fault) reportError(context, fault);
  }
  return who;
}
