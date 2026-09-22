// Which unit a member reads in, cached on the handset under THEIR account.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `repple.settings` is a device-global blob with no account in it. It held four
// things, of two different kinds, and src/lib/personalSettings.ts sets out the
// difference: `notifPush` and `restSound` are device-local by design, and
// `weightUnit` / `lengthUnit` are the CACHE of an account-scoped setting that
// really lives in `clients.weight_unit` / `profiles.weight_unit` (parts 61 and
// 82).
//
// The consents are now stripped from that blob on sign-out. The unit cache was
// not, and could not be: `multiRemove` is all-or-nothing about a whole key, and
// sweeping it would destroy the leaver's only surviving copy of a unit they
// chose before those columns existed. So the unit cache went on being inherited.
//
// What that inheritance does is worse than showing the wrong unit. src/ui/
// settings.tsx deliberately does NOT overwrite the device value when the
// account's columns are NULL — "never chosen" must not erase a pre-migration
// choice — so a member whose columns are NULL keeps whatever the last person on
// the handset picked. `resolveUnits` is then handed a non-null unit and reports
// `weightSource: 'chosen'`. The stranger's unit is not merely used: it is
// LABELLED AS THE MEMBER'S OWN ANSWER. No `deviceUnitNote` is shown, Settings
// tints the pill as though they had picked it, and every weight in the app — a
// goal, a lift, a body-composition figure — is read in a unit nobody asked them
// about, with nothing on screen saying which unit it is.
//
// ── The repair, and why it is not a sweep ─────────────────────────────────
//
// The key gets the account in it: `repple.units:<uid>`. That is the same repair
// src/lib/availabilityRange.ts and src/lib/coachPrefs.ts made for a coach's week
// and a member's swaps, against the rule written once in
// src/lib/deviceAccountCache.ts, and both of that file's traps are closed here
// the same way — by construction (`unitCache` hands back `hydrated: false`, and
// there is no setter that leaves an old flag standing) rather than by
// remembering.
//
// A sweep is still refused, for the reason it always was. Nothing is removed
// from `repple.settings` by this change: the pre-migration unit fields are left
// on the device exactly as they are, unread. A correction is a second recorded
// fact, not an erasure — so the new key is the fact, and the old bytes stay.
//
// ── What happens to the pre-migration value: DROPPED, unread ──────────────
//
// This is the decision, and it is the one that costs somebody something.
//
// The unqualified blob names no account. A single-owner handset's `weightUnit`
// is that owner's genuine choice; a shared gym handset's is whoever used it
// last. Nothing on the device tells those apart — there is no uid beside it, no
// timestamp, nothing. Adopting it into the signed-in account is therefore a
// guess, and the output of guessing wrong is every figure on a stranger's
// screen in the wrong unit, presented as their own answer. That is the defect
// above, performed once more deliberately on the way out of it.
//
// So it is dropped. It is not read, not migrated, and not deleted either — see
// above; it is simply no longer anybody's input.
//
// THE COST, stated rather than waved at: a member who chose a unit before part
// 61 shipped, whose account column is still NULL because they have not tapped a
// unit since, and who is on the same handset they chose it on, re-picks that
// unit once. Until they do, they read in the unit their phone's region implies
// — which `resolveUnits` reports as 'device' and `deviceUnitNote` names out
// loud ("Not set yet — showing pounds, from your phone's region. Tap to
// choose."). Their RECORD does not change: weights are stored in kilograms and
// centimetres whatever anybody reads them in, so this is a rendering they can
// correct in one tap, not a figure that is wrong. Losing that is cheaper than
// telling a stranger their goal weight in the wrong unit and calling it their
// choice. It is not close.
//
// ── NULL still does not mean "prefers metric" ─────────────────────────────
//
// The property src/ui/settings.tsx was protecting survives, and `chooseUnit` is
// where it is written down. A NULL column means the account has never stated a
// preference — it is not a preference for the default — so it does not erase
// what this ACCOUNT's own cache holds. What has changed is only whose cache
// that is: a unit kept under `repple.units:<uid>` was put there by that uid, by
// a tap on that account or by a read of that account's row, so keeping it is no
// longer keeping a stranger's.
//
// Pure: strings, a small record and a three-way decision. No storage, no
// supabase, so `npm test` reaches all of it.
import {
  accountCacheKey, cacheForAccount, isAccountCacheKey, type DeviceCache,
} from './deviceAccountCache';
import type { WeightUnit, LengthUnit } from './units';

/** Every per-account unit cache key starts with this. */
export const UNIT_CACHE_PREFIX = 'repple.units:';

/**
 * The device-global blob the unit fields used to live in, and the two fields.
 *
 * Named so this file's decision about them is greppable from the blob's side.
 * Nothing here reads or writes it — src/ui/settings.tsx still owns that key for
 * `notifPush` and `restSound`, which are device-local BY DESIGN and are not
 * moving. The unit fields inside it are left untouched and unread.
 */
export const LEGACY_UNIT_BLOB_KEY = 'repple.settings';
export const LEGACY_UNIT_FIELDS: readonly string[] = ['weightUnit', 'lengthUnit'];

/** Where this account's cached units live, or null when there is no account to
 *  scope them to — which means DO NOT PERSIST. A null or 'unknown' uid is
 *  refused by `accountCacheKey`, never fallen back to a shared key. */
export const unitCacheKey = (uid: string | null | undefined): string | null =>
  accountCacheKey(UNIT_CACHE_PREFIX, uid);

/** The cache record for an account, `hydrated: false`, as the provider must set
 *  it synchronously BEFORE the read it is about to start. A flag that survives
 *  the key changing is what writes an empty blob over the new account's data. */
export const unitCache = (uid: string | null | undefined): DeviceCache =>
  cacheForAccount(UNIT_CACHE_PREFIX, uid);

/** Whether a stored key holds somebody's units. The legacy unqualified blob is
 *  deliberately not one of these. */
export const isUnitCacheKey = (k: string): boolean =>
  isAccountCacheKey(UNIT_CACHE_PREFIX, k);

// unit-ok: these two are the membership test for the WeightUnit / LengthUnit
// unions themselves, not a default standing in for a missing preference.
// Nothing here picks a unit; they only decide whether a string read off the
// device is one at all.
export const isWeightUnit = (v: unknown): v is WeightUnit => v === 'kg' || v === 'lb';
export const isLengthUnit = (v: unknown): v is LengthUnit => v === 'cm' || v === 'in';

/**
 * What the cache holds. Both nullable, and independently: somebody who has
 * chosen pounds and never touched the height row has one and not the other, and
 * collapsing that would take one answer as consent to the other.
 */
export interface CachedUnits { weightUnit: WeightUnit | null; lengthUnit: LengthUnit | null }

/** Nothing cached. Not "prefers metric" — nothing. */
export const NO_CACHED_UNITS: CachedUnits = { weightUnit: null, lengthUnit: null };

/**
 * A completed read of the cache key, turned into two units or two nulls.
 *
 * `raw` is what the store handed back on a read that COMPLETED — null when
 * nothing has ever been written under this account's key. A read that THREW is
 * not this function's input: the caller does not call it, which leaves the
 * cache un-hydrated and the bytes untouched, because "we could not read it" is
 * not "there is nothing there".
 *
 * Anything unreadable — not JSON, not an object, a unit that is not one of the
 * four — reads as nothing cached rather than as a default. The member is then
 * shown the region guess, labelled as a guess, which is the honest state.
 */
export function parseCachedUnits(raw: string | null | undefined): CachedUnits {
  if (raw == null) return NO_CACHED_UNITS;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return NO_CACHED_UNITS; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NO_CACHED_UNITS;
  const o = parsed as Record<string, unknown>;
  return {
    weightUnit: isWeightUnit(o.weightUnit) ? o.weightUnit : null,
    lengthUnit: isLengthUnit(o.lengthUnit) ? o.lengthUnit : null,
  };
}

/**
 * The bytes to store, or null meaning REMOVE THE KEY.
 *
 * Null when neither unit is known: a key holding `{"weightUnit":null}` is a
 * file that says nothing, and on the next read it is indistinguishable from an
 * absent key anyway. Removing it is the same answer, said once.
 *
 * A null is never written into an existing pair either — the fields are emitted
 * only when they hold a unit, so a member who has chosen a weight and not a
 * height gets a blob with one field in it rather than an explicit "no height",
 * which would be this device recording an un-choice nobody made.
 */
export function cachedUnitsBlob(u: CachedUnits): string | null {
  const out: Record<string, string> = {};
  if (u.weightUnit) out.weightUnit = u.weightUnit;
  if (u.lengthUnit) out.lengthUnit = u.lengthUnit;
  if (!Object.keys(out).length) return null;
  return JSON.stringify(out);
}

/**
 * What the account's row said about one unit column. Three answers, not two,
 * and the third is the one that gets collapsed:
 *
 *   · `said`   — the column holds a unit. The member answered, on this or
 *                another handset, and that answer is the record.
 *   · `never`  — the row was read and the column is NULL. NOBODY HAS ASKED
 *                THEM. It is not a preference for the default, and it is not
 *                permission to overwrite anything.
 *   · `failed` — the row was not read: the request was refused, it threw, or
 *                the account has no row in either table. An unread column is
 *                not an empty one.
 */
export type ColumnRead<U> =
  | { read: 'said'; unit: U }
  | { read: 'never' }
  | { read: 'failed' };

/** Where the unit the provider is about to hold came from. Not the same thing
 *  as `UnitSource` in src/lib/unitPreference.ts, which is about what the SCREEN
 *  should say; this is about what the STORE may be told. */
export type UnitOrigin =
  /** The account's own column. This is the record, and the only origin that may
   *  be written back to the device cache. */
  | 'account'
  /** This account's cached choice, kept because the column says nobody has
   *  asked — or because nobody could read the column. */
  | 'device-cache'
  /** The column was read and is NULL, and this account has nothing cached.
   *  Genuinely unchosen: `resolveUnits` will guess from the region and say so. */
  | 'never-chosen'
  /** The column could not be read and there is nothing cached. The preference
   *  is UNKNOWN, which is a different fact from unchosen even though both
   *  render the same way — and it is the one that must not be written down. */
  | 'unread';

export interface UnitChoice<U> {
  /** What the member chose, as far as anybody can tell. Null means nobody knows
   *  of a choice — never a unit standing in for one. */
  chosen: U | null;
  from: UnitOrigin;
}

/**
 * The three-way decision, per unit, for one account.
 *
 * @param account what that account's column said — see `ColumnRead`.
 * @param cached  what THIS account's own cache key held, or null for nothing.
 *                Never another account's: the key it came out of has this uid
 *                in it, which is the whole of this module.
 *
 * The account's stated answer always wins, because it is the record and it
 * follows the member to a second handset. Everything else keeps the cache,
 * because a NULL column and a refused read are both "we have not been told
 * otherwise" and neither is a reason to drop a choice.
 */
export function chooseUnit<U>(
  account: ColumnRead<U>,
  cached: U | null | undefined,
): UnitChoice<U> {
  if (account.read === 'said') return { chosen: account.unit, from: 'account' };
  if (cached != null) return { chosen: cached, from: 'device-cache' };
  if (account.read === 'never') return { chosen: null, from: 'never-chosen' };
  return { chosen: null, from: 'unread' };
}

/**
 * Whether this origin may be written back to the device cache.
 *
 * Only `account`. The other three are, in order: what the cache already holds
 * (writing it back is a no-op that can only go wrong), a nothing that would
 * write an empty blob, and a nothing that came from a read NOBODY COMPLETED —
 * the last being the one that destroys data, because it is exactly the moment
 * the provider knows least and the flag that arms it is easiest to leave true.
 */
export const mayRefreshCache = (from: UnitOrigin): boolean => from === 'account';

/**
 * The device-local blob to write back to `repple.settings`.
 *
 * `remnant` is whatever unit fields the blob already held when this launch read
 * it — carried through untouched so that writing a notification toggle does not
 * quietly delete a pre-migration unit on the way past. Those fields are read by
 * nothing (see the header): they are bytes being preserved, not a value being
 * used, which is why they are spread FIRST and cannot displace the two answers
 * this function is actually about.
 */
export function deviceSettingsBlob(
  device: { notifPush: boolean; restSound: boolean },
  remnant: Record<string, string> = {},
): string {
  return JSON.stringify({ ...remnant, notifPush: device.notifPush, restSound: device.restSound });
}

/**
 * The unit fields a legacy blob is carrying, so they can be written back
 * unchanged. NOT a migration and not a read of anybody's preference — the
 * values are never handed to a screen, and the header says why.
 *
 * A blob that will not parse yields nothing, which is correct in both
 * directions: there is nothing recoverable in it, and re-emitting bytes nobody
 * could read would preserve damage rather than a choice.
 */
export function legacyUnitRemnant(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  const o = parsed as Record<string, unknown>;
  for (const f of LEGACY_UNIT_FIELDS) {
    const v = o[f];
    if (typeof v === 'string' && v) out[f] = v;
  }
  return out;
}
