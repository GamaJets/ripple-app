// A number that changes whenever the signed-in user changes.
//
// ── The bug this exists to end ─────────────────────────────────────────────
//
// Seventeen providers in this app loaded their data like this:
//
//   useEffect(() => {
//     (async () => {
//       const { data, error } = await supabase.auth.getUser();
//       if (error) { setStatus('error'); return; }
//       …read this user's rows…
//     })();
//   }, []);            ← runs ONCE, when the provider mounts
//
// The providers mount with the app, which is BEFORE anybody has signed in — the
// welcome screen is what you are looking at. `getUser()` REJECTS when there is
// no session (AuthSessionMissingError), so every one of them set status to
// 'error' on the first tick and, with an empty dependency array, was never
// asked again. Signing in did not re-run them.
//
// What that looked like: a member who had genuinely been invited by a coach saw
// no invitation on their home screen, permanently. The edge logs showed
// coach_invites was never requested at all after a successful sign-in. Reported
// four times across two apps as "the coach is not listed here" and "client
// doesn't get the request to join".
//
// It only ever LOOKED fine when the app was launched with a session already in
// storage, because then the providers mounted after it was restored and their
// single run happened to succeed. The sign-in path — the one a new member takes
// — failed every time.
//
// ── Why a module-level subscription ────────────────────────────────────────
//
// One listener on `onAuthStateChange`, shared by every provider, rather than
// seventeen. The revision is a plain counter: providers put it in their
// dependency array and re-run when it moves. Nothing about the user is exposed
// here — a provider that needs the user asks Supabase for it, as before.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

let revision = 0;
const listeners = new Set<(n: number) => void>();
let started = false;

function ensureStarted() {
  if (started || !USE_SUPABASE) return;
  started = true;
  try {
    supabase.auth.onAuthStateChange((event) => {
      // TOKEN_REFRESHED is deliberately absent: the user has not changed, and
      // re-reading every provider on each silent refresh would be a needless
      // burst of queries roughly once an hour.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT'
          || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        revision += 1;
        listeners.forEach((notify) => notify(revision));
      }
    });
  } catch {
    // A provider that cannot subscribe still works exactly as it did before —
    // one load on mount. Failing to observe auth must not break the app.
    started = false;
  }
}

/** Put this in a data-loading effect's dependency array. */
export function useAuthRevision(): number {
  const [rev, setRev] = useState(revision);
  useEffect(() => {
    ensureStarted();
    listeners.add(setRev);
    // A revision may have landed between render and this effect running.
    setRev(revision);
    return () => { listeners.delete(setRev); };
  }, []);
  return rev;
}
