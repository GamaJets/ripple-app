// What a mounted screen should do when the account under it changes.
//
// ── Why this is one rule and not one per screen ───────────────────────────
//
// Several screens in this app now keep something under an account-scoped
// AsyncStorage key: a coach's unsaved program (src/lib/builderDraft.ts), a
// member's changes to their own plan (src/lib/planEdits.ts), their meal swaps,
// a coach's handset clips. Every one of them has the same three-way decision to
// make when the signed-in account changes, and every one of them has the same
// two ways to get it wrong.
//
// Writing that rule out once per screen is how the copies drift, and the drift
// is silent: a screen that gets the third answer wrong looks identical to one
// that gets it right until somebody signs out on a shared handset.
//
// ── The two mistakes this exists to stop ──────────────────────────────────
//
// 1. A NULL UID IS NOT A SIGN-OUT. auth-js emits a null session whenever
//    `getSession()` errors — an expired access token that could not be
//    refreshed on a dead gym wifi, a captive portal, the basement weights room.
//    The refresh token is still on the handset, the person is still signed in,
//    and auth-js restores them on the next tick. src/ui/clientData.tsx sets out
//    at length what treating that as a sign-out costs. So a screen holding work
//    that is NOT yet on the device holds onto it.
//
// 2. A DIFFERENT ACCOUNT IS NOT A RE-READ. Fixing the KEY alone leaves the
//    previous account's data in React state, and on this project that is not a
//    transient: `expo-router`'s `Tabs` keeps tab screens MOUNTED, and a screen
//    registered `href: null` mounts once and is never torn down — not even by
//    backgrounding the app. So the departing account's state survives the
//    session that made it, and a read for the new account that is slow, that
//    fails, or that is refused leaves it on screen under the new person's name.
//    The wipe therefore happens on the way IN, before the read lands, and never
//    depends on the read succeeding.
//
// Pure: a key and two facts in, one of three words out.

/**
 * What to do about the state a screen is holding.
 *
 *   · `load`  — there is an account. Read `key`. `forget` is true when the
 *               state on screen belongs to a DIFFERENT account and must be
 *               dropped first, before the read lands and whatever it decides.
 *   · `forget` — the account is gone and the device already has a copy of what
 *               is on screen under that account's own key. Drop it from memory.
 *               Never from storage: that is the departing person's work, it is
 *               unreadable to whoever signs in next, and destroying it is the
 *               loss src/lib/outbox.ts refuses to take.
 *   · `hold`  — the account is gone and what is on screen is NOT on the device.
 *               Read nothing, write nothing, change nothing. See mistake 1.
 */
export type AccountStateStep =
  | { do: 'hold' }
  | { do: 'forget' }
  | { do: 'load'; key: string; forget: boolean };

/**
 * @param key          the account-scoped key for the account signed in NOW, or
 *                     null when there is no account to scope one to. Composed
 *                     by the owning module, which is also where 'unknown' and
 *                     a blank id are refused.
 * @param onScreenKey  the key of the account whose data is in React state right
 *                     now — null when the screen holds nobody's.
 * @param onScreenSaved whether the screen's writes were ARMED for that account —
 *                     whether what is on screen has somewhere to have gone. It
 *                     is deliberately the same flag that gates the write, so
 *                     that "can I afford to forget this?" is answered by the
 *                     fact the writer already acts on rather than by a second
 *                     guess that can disagree with it. Where that copy lives —
 *                     the device, the server, or both — is the owning module's
 *                     business; what matters here is that an unarmed screen is
 *                     holding the only copy, and the only copy is never dropped
 *                     on a session that merely went quiet.
 */
export function accountStateStep(args: {
  key: string | null;
  onScreenKey: string | null;
  onScreenSaved: boolean;
}): AccountStateStep {
  if (args.key) {
    return { do: 'load', key: args.key, forget: !!args.onScreenKey && args.onScreenKey !== args.key };
  }
  if (args.onScreenKey && args.onScreenSaved) return { do: 'forget' };
  return { do: 'hold' };
}
