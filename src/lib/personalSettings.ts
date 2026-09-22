// The answers inside `repple.settings` that belong to a person, not a handset.
//
// ── The finding, and the direction it actually runs ───────────────────────
//
// A sweep of every AsyncStorage key in the tree flagged `notifPush` — the push
// toggle inside the 'repple.settings' blob — as a CONSENT filed as a preference,
// and prescribed moving it onto `PERSONAL_DEVICE_KEYS` in src/lib/signOutState.ts.
//
// That list's semantics were checked before anything moved, because the two
// plausible readings are opposites and the wrong one achieves the reverse of the
// intent. `PERSONAL_DEVICE_KEYS` is the CLEARED list: src/ui/signOutState.ts
// does `AsyncStorage.multiRemove([...PERSONAL_DEVICE_KEYS])`, and the list that
// is PRESERVED across a sign-out is the separate `KEPT_ON_SIGN_OUT`. So the
// prescription points the right way — a consent on that list is taken off the
// handset when its owner leaves.
//
// ── Why the key itself is not on that list ────────────────────────────────
//
// `PERSONAL_DEVICE_KEYS` is consumed by `multiRemove`, so an entry is all-or-
// nothing about a whole key. 'repple.settings' is not a whole answer; it is four
// fields of two different kinds:
//
//   · `notifPush` and `restSound` are DEVICE-LOCAL BY DESIGN. src/ui/settings.tsx
//     says so of push ("push permission genuinely is a property of this
//     handset") and there is no server column for either. They hold one person's
//     answer under a key with no account in it, which is exactly the test
//     src/lib/signOutState.ts states for its list.
//   · `weightUnit` and `lengthUnit` are the CACHE of an account-scoped setting.
//     The answer lives in clients.weight_unit / profiles.weight_unit (parts 61
//     and 82). Clearing them at sign-out would destroy the one surviving copy
//     of a choice made before those columns existed and never yet written up —
//     the loss TF-37 is about, applied to the member who is leaving. They no
//     longer make anybody's first paint right either: that cache is now keyed
//     by account (src/lib/unitCache.ts) and these two are the pre-migration
//     bytes it deliberately does not read. Left where they are, all the same.
//
// So the consents are stripped OUT of the blob and the unit cache is left where
// it is. That is the same distinction signOutState.ts already draws between
// clearing an answer and destroying a record; this key simply holds one of each.
//
// ── What the inheritance actually was ─────────────────────────────────────
//
// Member A turns Push Notifications off and signs out. Nothing removed the blob,
// so member B signs in on the same handset and the settings screen shows the
// switch already off — B's answer, given by A, to a question B was never asked.
// Worse than the switch: src/lib/pushConsent.ts is seeded from this same blob
// and `registerForPush()` refuses while it says 'no', so B receives no
// notification from their coach at all and nothing on screen says why. The same
// runs for `restSound` through src/lib/restTimer.ts and src/ui/sounds.ts.
//
// An inherited 'yes' is indistinguishable from the product default (DEFAULTS
// says push is on), so the harm is one-directional — but it is the direction
// that silently removes a member's notifications, which is the half a member
// cannot diagnose.
//
// Clearing returns the next person to the default, which is the true state: they
// have not answered. That is the whole cost, and it is the cost of asking a
// question instead of assuming somebody else's answer to it.
//
// ── What is NOT done here, and what was done instead ──────────────────────
//
// The unit cache inherited too, and it is left alone by THIS file deliberately
// rather than overlooked. src/ui/settings.tsx does not overwrite the device
// value when the account's columns are NULL — "never chosen" must not erase a
// pre-migration choice — so a member who has never picked a unit inherited
// whatever the last person on the handset picked, and every weight on screen
// changed meaning. Worse: `resolveUnits` was then handed a non-null unit and
// reported it as `'chosen'`, so the stranger's unit was labelled as the
// member's own answer, with no note under it.
//
// The repair for that is an account-scoped cache, not a sign-out sweep — a
// sweep destroys the leaver's only copy, which is the mistake signOutState.ts's
// rule exists to prevent. That cache is now built: src/lib/unitCache.ts and the
// units effect in src/ui/settings.tsx. The units live under
// `repple.units:<uid>`, the two fields in this blob are read by nothing, and
// they are still written back untouched on every write of it. So the sentence
// below still holds and is still why this file strips two fields rather than
// removing a key: what survives in `repple.settings` is the leaver's
// pre-migration unit, and it is theirs.
//
// Pure: a field list and a string transform. src/ui/signOutState.ts does the
// storage, and src/lib/pushConsent.ts / src/lib/restTimer.ts hold the in-process
// latches that have to be forgotten in the same breath.

/** The blob these fields live in (src/ui/settings.tsx). */
export const SETTINGS_KEY = 'repple.settings';

/**
 * The fields inside it that belong to the person signing out.
 *
 * Named rather than inlined so that a field added to `Settings` has a place to
 * be considered, and so the test can assert that nothing account-shaped — a
 * unit, above all — has quietly joined them.
 */
export const PERSONAL_SETTING_FIELDS: readonly string[] = ['notifPush', 'restSound'];

/**
 * The blob as it should be left behind, with this person's answers taken out.
 *
 * `raw` is exactly what AsyncStorage handed back for `SETTINGS_KEY` on a read
 * that COMPLETED — null when nothing has ever been written. A read that threw is
 * not this function's input: the caller must not write anything at all in that
 * case, because "we could not read the blob" is not "the blob is empty", and
 * writing a stripped blob computed from nothing would erase the unit cache of
 * whoever is leaving.
 *
 * Returns:
 *   · a JSON string — the blob with the personal fields removed, when something
 *     worth keeping survives;
 *   · null — meaning REMOVE THE KEY, when nothing does: nothing was stored, the
 *     blob is not an object, it will not parse at all, or every field in it was
 *     one of this person's.
 *
 * A blob that will not parse is removed rather than preserved. It is damage, it
 * holds no readable unit either, and both `consentFromStored` and
 * `soundFromStored` already treat it as a fresh install — so leaving it would
 * leave a corrupt blob that could only ever be read as somebody's default.
 */
export function stripPersonalSettings(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (PERSONAL_SETTING_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  // An empty object is not worth writing back, and leaving `{}` on the device
  // would be a key that exists for no reason. Removing it is the same answer.
  if (!Object.keys(out).length) return null;
  return JSON.stringify(out);
}

/**
 * Whether a completed read holds any of this person's answers.
 *
 * Exported so a caller can tell "nothing to do" apart from "something was taken
 * out", and so the assertion can state the property rather than infer it from a
 * string comparison.
 */
export function hasPersonalSettings(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return PERSONAL_SETTING_FIELDS.some((f) => f in (parsed as Record<string, unknown>));
}
