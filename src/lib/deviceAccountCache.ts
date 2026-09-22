// A blob kept on the handset, and whose it is.
//
// ── The defect class ──────────────────────────────────────────────────────
//
// A provider reads and writes AsyncStorage under one key with no account in
// it:
//
//   const KEY = 'repple.trainer.availability';
//   const raw = await AsyncStorage.getItem(KEY);   // whoever used this phone last
//   …
//   .insert(local.map((sl) => ({ trainer_id: u, … })))   // signed in as somebody else
//
// A key with no account in it is a key the next account inherits, and a gym
// handset on the desk is signed in and out all day. src/lib/mealSwaps.ts and
// src/lib/handsetClips.ts ended that shape for a member's meal swaps and a
// coach's clips, where the cost is a stranger's record shown to the wrong
// person. The two callers of THIS file are worse than that, because the blob
// does not stop at the screen: it is pushed to the server under the account
// that happens to be signed in, so one coach's working week is inserted as
// another's — and `run_open_slot_extension` (supabase/parts/650, scheduled in
// part 1890) turns every `trainer_availability` row into `sessions` rows with
// status 'available'. Clients book them. A coach finds a stranger's Tuesday
// morning in their diary, sold.
//
// The rule is one rule, so it is written once here and the two features name
// their own prefix against it. src/lib/availabilityRange.ts and
// src/lib/coachPrefs.ts are those two.
//
// ── Why the old key is deleted rather than migrated ───────────────────────
//
// The unqualified blob carries no account. Nothing on the device says whether
// it is this coach's own week from last month or the previous coach's from
// this morning, so reading it into the signed-in account is a guess — and the
// output of guessing wrong is the defect performed once, deliberately, with
// bookable hours at the end of it. The cost of losing it is that a coach
// re-enters a week that never reached the server anyway (`addSlot` returns
// 'local' for exactly those, and the range sheet above it enters a whole day
// in one gesture). Losing that is cheaper than opening a stranger's hours for
// booking; it is not close. Each caller exports its own LEGACY_… constant and
// removes it UNREAD.
//
// ── The two traps, both found the hard way ────────────────────────────────
//
// · A hydration flag that survives a key change. The flag arms the write. If
//   it stays true across an account switch whose read then FAILS, the new
//   account's key is written with the old account's (or an empty) list — the
//   one way this class of bug destroys data rather than merely misplacing it.
//   `cacheForAccount` therefore returns the flag already false, and it is the
//   only way to build a cache for an account: there is no setter that leaves
//   the old flag standing.
// · A null or 'unknown' uid is not an account. 'unknown' is the literal
//   src/ui/clientData.tsx settles on before the auth read lands; composing a
//   key from it gives every signed-out session on the handset one shared key,
//   which is this file's whole subject. Both are refused, and a refusal means
//   DO NOT PERSIST — never a fallback to the shared key.
//
// Pure: strings, a small record and a decision. No storage, no supabase, so
// `npm test` reaches all of it.

/**
 * The literal src/ui/clientData.tsx settles on before the auth read lands. It
 * looks like an id and is not one.
 */
const NOT_AN_ACCOUNT = 'unknown';

/**
 * Where one account's blob lives, or null when there is no account to scope it
 * to.
 *
 * Null means DO NOT PERSIST. Falling back to the unqualified key is the defect
 * itself, and nothing is lost by not writing: work done before anybody is
 * signed in has no account behind it and cannot have reached the server
 * either.
 */
export function accountCacheKey(prefix: string, uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || id === NOT_AN_ACCOUNT) return null;
  // A prefix that does not end in its separator would compose
  // 'repple.trainer.goals' + '<uid>' into a key that still starts with the
  // legacy key's exact characters — and then `isAccountCacheKey` would answer
  // true for the legacy key itself. Stated as a refusal rather than a comment.
  if (!prefix.endsWith(':')) return null;
  return `${prefix}${id}`;
}

/** Whether a stored key belongs to this feature's per-account family. The
 *  legacy unqualified key does NOT, because the prefix carries the ':'. */
export const isAccountCacheKey = (prefix: string, k: string): boolean =>
  typeof k === 'string' && prefix.endsWith(':') && k.startsWith(prefix) && k.length > prefix.length;

/**
 * A provider's device cache: which account's blob it is reading and writing,
 * and whether a read of THAT key has come back.
 *
 * `uid` is kept beside the key rather than parsed back out of it, so a write
 * can be checked against the account it would be written AS without any string
 * surgery. See `pushUpDecision`.
 */
export interface DeviceCache {
  readonly key: string | null;
  readonly uid: string | null;
  /** True only after a read of `key` returned. Arms every write. */
  readonly hydrated: boolean;
}

/**
 * The cache state the instant the account changes — including a sign-out,
 * which is an account change to nobody.
 *
 * `hydrated` is false here and there is no way to build one of these with it
 * true: that is the first trap closed by construction rather than by
 * remembering to clear a flag. A provider calls this synchronously, before the
 * read it is about to start.
 */
export function cacheForAccount(prefix: string, uid: string | null | undefined): DeviceCache {
  const key = accountCacheKey(prefix, uid);
  return { key, uid: key ? String(uid).trim() : null, hydrated: false };
}

/**
 * The same cache, with a read of its key behind it.
 *
 * A null key is never hydrated: there was no key, so nothing was read, and
 * arming a write against nothing is how the unqualified key got written in the
 * first place.
 *
 * Note what this is NOT told: what came back. An empty store and a store
 * holding a week are both a read that landed. A read that THREW is not — the
 * caller simply does not call this, which leaves the flag false and the bytes
 * on the device untouched.
 */
export function cacheHydrated(cache: DeviceCache): DeviceCache {
  if (!cache.key) return cache;
  return { key: cache.key, uid: cache.uid, hydrated: true };
}

/**
 * Whether this provider may write the device blob right now.
 *
 * Two conditions and neither is an "ignore": no key means nobody is signed in,
 * and not hydrated means the read of this key has not come back or came back
 * refused. In both cases the work is on screen for this session and is not
 * kept — which is a smaller loss than writing this session's list on top of
 * bytes nobody managed to read.
 */
export function mayWriteCache(cache: DeviceCache): cache is DeviceCache & { key: string } {
  return !!cache.key && cache.hydrated;
}

/**
 * Whether the device copy may be published to the account, and when not, why.
 *
 * Every caller of this is a "the server has none, this phone has some, push
 * them up" branch — the branch that turned a shared handset into a stranger's
 * bookable hours. Each answer other than 'push' is a real situation with a
 * different sentence behind it, so they are named rather than collapsed into a
 * boolean.
 */
export type PushUpDecision =
  /** The blob was read under this very account's key, and the account has none. */
  | 'push'
  /** Nobody is signed in, or the id is not an account. */
  | 'no-account'
  /** The read of this key has not come back. What is in memory is not known to
   *  be this account's. */
  | 'not-hydrated'
  /** The blob belongs to a DIFFERENT account from the one the rows would be
   *  written as. This is the defect, caught. */
  | 'other-account'
  /** This account's store is empty; there is nothing to publish. */
  | 'nothing-cached'
  /** The account already has its own. The server wins; nothing is pushed. */
  | 'server-has-rows'
  /** The server was not read. An unread account is not an empty one, and this
   *  refuses rather than backfilling over rows nobody looked at. */
  | 'server-unknown';

export function pushUpDecision(o: {
  cache: DeviceCache;
  /** The account the rows would be written AS — the id the write itself will
   *  carry, not the one the screen assumes. */
  writeUid: string | null | undefined;
  /** Whether the device copy actually holds anything. */
  hasCached: boolean;
  /** Whether the account already has its own. NULL means the read did not come
   *  back, which is never folded into false. */
  serverHas: boolean | null;
}): PushUpDecision {
  const write = typeof o.writeUid === 'string' ? o.writeUid.trim() : '';
  if (!write || write === NOT_AN_ACCOUNT) return 'no-account';
  if (!o.cache.key || !o.cache.uid) return 'no-account';
  // Before hydration, because a mismatch is a worse fact than a missing read
  // and the two are reported to different people: this one is a bug.
  if (o.cache.uid !== write) return 'other-account';
  if (!o.cache.hydrated) return 'not-hydrated';
  if (o.serverHas == null) return 'server-unknown';
  if (o.serverHas) return 'server-has-rows';
  if (!o.hasCached) return 'nothing-cached';
  return 'push';
}
