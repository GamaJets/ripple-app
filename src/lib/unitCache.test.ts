// The unit cache, and the difference between a member's answer and the last
// person who held the phone.
//
// ── What these assertions are guarding ────────────────────────────────────
//
// `repple.settings` is a device-global blob. Two of its four fields are
// device-local by design and are cleared on sign-out; the other two are the
// cache of an ACCOUNT-scoped setting, and clearing THOSE would destroy the
// leaver's only pre-migration copy — so they were left, and inherited. Because
// src/ui/settings.tsx deliberately does not let a NULL column overwrite a
// device value, the next member kept the stranger's unit AND was told, by
// `resolveUnits`, that they had chosen it.
//
// So the assertions that matter most here are not about kilograms or pounds.
// They are:
//
//   · the key CONTAINS the uid, so two members on one handset cannot share one;
//   · the hydration flag is false again the instant the key changes, because a
//     flag that survives arms a write with a read that belongs to somebody else;
//   · a NULL column is not "prefers the default" — it keeps this account's
//     cached choice and writes nothing;
//   · a read that FAILED is not a NULL column, and neither is an account with
//     no row at all;
//   · and the legacy unqualified unit is never an input, in any path.
import {
  UNIT_CACHE_PREFIX, LEGACY_UNIT_BLOB_KEY, LEGACY_UNIT_FIELDS,
  unitCacheKey, unitCache, isUnitCacheKey,
  parseCachedUnits, cachedUnitsBlob, chooseUnit, mayRefreshCache,
  deviceSettingsBlob, legacyUnitRemnant, isWeightUnit, isLengthUnit,
  NO_CACHED_UNITS, type CachedUnits, type ColumnRead,
} from './unitCache';
import { cacheHydrated, mayWriteCache, type DeviceCache } from './deviceAccountCache';
import { resolveUnits } from './unitPreference';
import type { WeightUnit, LengthUnit } from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/* ── the key carries the account ─────────────────────────────────────────── */
{
  eq(unitCacheKey(A), `${UNIT_CACHE_PREFIX}${A}`, 'a key is the prefix and the account');
  ok((unitCacheKey(A) ?? '').includes(A), 'the account is IN the key, not merely known about');
  ok(unitCacheKey(A) !== unitCacheKey(B), 'two members on one handset do not share a key');

  eq(unitCacheKey(null), null, 'signed out there is no key, and no key means do not persist');
  eq(unitCacheKey(undefined), null, 'nor before the session has been restored');
  eq(unitCacheKey(''), null, 'an empty id is not an account');
  eq(unitCacheKey('   '), null, 'nor is whitespace');
  eq(unitCacheKey('unknown'), null,
    "'unknown' is the literal clientData settles on before the auth read lands — every signed-out session would otherwise share one key");

  ok(!isUnitCacheKey(LEGACY_UNIT_BLOB_KEY), 'the device-global blob is not one of the per-account family');
  ok(isUnitCacheKey(unitCacheKey(A)!), 'an account key is');
  ok(!isUnitCacheKey(UNIT_CACHE_PREFIX), 'and a bare prefix with no account after it is not');
}

/* ── what a stored blob reads as ─────────────────────────────────────────── */
{
  eq(parseCachedUnits(null).weightUnit, null, 'an absent key holds no unit');
  eq(parseCachedUnits(null).lengthUnit, null, 'in either dimension');
  eq(parseCachedUnits(undefined).weightUnit, null, 'and neither does nothing at all');
  eq(parseCachedUnits('{"weightUnit":"lb"}').weightUnit, 'lb', 'a stored pound is a pound');
  eq(parseCachedUnits('{"weightUnit":"lb"}').lengthUnit, null,
    'and says nothing about the height, which is a separate answer');
  eq(parseCachedUnits('{"weightUnit":"lb","lengthUnit":"in"}').lengthUnit, 'in', 'both when both are there');

  // Damage reads as nothing, never as a default. A blob that will not parse has
  // no unit in it, and answering 'kg' here would put the region guess's job
  // back where this whole file started.
  eq(parseCachedUnits('not json at all').weightUnit, null, 'an unreadable blob holds no unit');
  eq(parseCachedUnits('[]').weightUnit, null, 'nor does an array');
  eq(parseCachedUnits('"lb"').weightUnit, null, 'nor a bare string');
  eq(parseCachedUnits('{"weightUnit":"stone"}').weightUnit, null, 'a unit this app does not offer is not a unit');
  eq(parseCachedUnits('{"weightUnit":"kg","lengthUnit":"furlong"}').weightUnit, 'kg',
    'and one bad field does not discard the good one beside it');
}

/* ── what gets written, and what gets removed instead ────────────────────── */
{
  eq(cachedUnitsBlob({ weightUnit: 'lb', lengthUnit: 'in' }), '{"weightUnit":"lb","lengthUnit":"in"}',
    'both units go in');
  eq(cachedUnitsBlob({ weightUnit: 'lb', lengthUnit: null }), '{"weightUnit":"lb"}',
    'a height nobody has chosen is ABSENT, not written down as null — a stored null would be this device recording an un-choice');
  eq(cachedUnitsBlob(NO_CACHED_UNITS), null,
    'nothing chosen means REMOVE THE KEY, because a file saying nothing reads the same as no file');

  // The round trip is the property that matters: what is written must come back
  // as the same two answers.
  const back = parseCachedUnits(cachedUnitsBlob({ weightUnit: 'kg', lengthUnit: null }));
  eq(back.weightUnit, 'kg', 'a written unit reads back');
  eq(back.lengthUnit, null, 'and an unwritten one reads back as unchosen');
}

/* ── the three-way choose-a-unit decision ────────────────────────────────── */
{
  const said: ColumnRead<WeightUnit> = { read: 'said', unit: 'kg' };
  const never: ColumnRead<WeightUnit> = { read: 'never' };
  const failed: ColumnRead<WeightUnit> = { read: 'failed' };

  // The account is the record and follows the member to a second handset.
  eq(chooseUnit(said, null).chosen, 'kg', "the account's stated unit is the answer");
  eq(chooseUnit(said, null).from, 'account', 'and it is named as coming from the account');
  eq(chooseUnit(said, 'lb').chosen, 'kg', 'and it wins over a cached unit, because it is the record');

  // THE PROPERTY LANE 121 QUOTED. A NULL column is "nobody has asked", and it
  // must not erase what this account itself put on the handset.
  eq(chooseUnit(never, 'lb').chosen, 'lb', 'a NULL column does not erase this account’s own cached choice');
  eq(chooseUnit(never, 'lb').from, 'device-cache', 'and the origin says where that came from');
  // The other half of the same property: NULL is not a vote for metric either.
  eq(chooseUnit(never, null).chosen, null, 'a NULL column with nothing cached is NOT a preference for the default');
  eq(chooseUnit(never, null).from, 'never-chosen', 'it is "nobody has asked", and it is named that');

  // A failed read is not an empty column.
  eq(chooseUnit(failed, 'lb').chosen, 'lb', 'a read that failed keeps the cached unit');
  eq(chooseUnit(failed, 'lb').from, 'device-cache', 'from the cache, not from the account');
  eq(chooseUnit(failed, null).chosen, null, 'a failed read with nothing cached knows nothing');
  eq(chooseUnit(failed, null).from, 'unread',
    'and it is UNREAD, not "never chosen" — the two render alike and only one of them may be written down');

  // The length column decides independently. Somebody who chose pounds and
  // never touched the height row must not have that taken as consent.
  const lNever: ColumnRead<LengthUnit> = { read: 'never' };
  eq(chooseUnit(lNever, null).chosen, null, 'a chosen weight is not a chosen height');

  // Only the account may be written back to the handset. This is the gate that
  // stops a read nobody completed becoming bytes on the device.
  ok(mayRefreshCache('account'), "the account's own column may refresh the cache");
  ok(!mayRefreshCache('device-cache'), 'what the cache already holds is not written back over itself');
  ok(!mayRefreshCache('never-chosen'), 'and an unchosen unit writes nothing');
  ok(!mayRefreshCache('unread'),
    'above all: a read that did not complete never writes — that is the path that destroys a member’s choice');
}

/* ── the guess is still a guess, and still says so ───────────────────────── */
{
  // The whole severity of the defect was that the inherited unit arrived as a
  // non-null `chosen`, so resolveUnits reported 'chosen' and no note was shown.
  // Dropping it puts the member back on the region guess, LABELLED.
  const inherited = resolveUnits(chooseUnit<WeightUnit>({ read: 'never' }, 'lb').chosen, null, 'AE');
  eq(inherited.weightSource, 'chosen',
    'a unit kept from THIS account’s cache is reported as chosen, because that account chose it');

  const dropped = resolveUnits(chooseUnit<WeightUnit>({ read: 'never' }, null).chosen, null, 'AE');
  eq(dropped.weightUnit, 'kg', 'with nothing chosen the region decides what is rendered');
  eq(dropped.weightSource, 'device', 'and it is reported as the guess it is, which is what puts the note on screen');
  eq(dropped.weightChosen, null, 'and nothing is recorded as having been chosen');
}

/* ── the legacy blob: preserved, never read ──────────────────────────────── */
{
  eq(LEGACY_UNIT_FIELDS.join(','), 'weightUnit,lengthUnit', 'the two fields that are left behind are named');

  const legacy = '{"notifPush":false,"restSound":true,"weightUnit":"lb","notifEmail":true}';
  const remnant = legacyUnitRemnant(legacy);
  eq(remnant.weightUnit, 'lb', 'the pre-migration unit is held so it can be written back');
  eq(remnant.notifPush as unknown, undefined, 'and nothing else is — the consents are not this file’s business');
  eq(remnant.notifEmail as unknown, undefined, 'nor is a field the app no longer has');

  const written = deviceSettingsBlob({ notifPush: true, restSound: false }, remnant);
  const parsedBack = JSON.parse(written) as Record<string, unknown>;
  eq(parsedBack.notifPush, true, 'the blob carries the two device-local answers');
  eq(parsedBack.restSound, false, 'both of them');
  eq(parsedBack.weightUnit, 'lb',
    'AND the pre-migration unit survives the write — flipping a notification switch must not delete somebody’s only copy');
  eq(parsedBack.notifEmail as unknown, undefined, 'a setting the app no longer has is not carried back');

  // The remnant may never displace the answers this blob is actually about.
  const hostile = deviceSettingsBlob({ notifPush: true, restSound: true }, { notifPush: 'false' } as Record<string, string>);
  eq((JSON.parse(hostile) as Record<string, unknown>).notifPush, true,
    'a remnant cannot overwrite a device-local answer');

  eq(Object.keys(legacyUnitRemnant('not json')).length, 0, 'damage yields nothing to preserve');
  eq(Object.keys(legacyUnitRemnant(null)).length, 0, 'and so does an absent blob');
  eq(deviceSettingsBlob({ notifPush: false, restSound: false }), '{"notifPush":false,"restSound":false}',
    'with no remnant the blob is just the two answers');
}

/* ── one provider, across sign-in → sign-out → sign-in ───────────────────── */

class FakeStore {
  private m = new Map<string, string>();
  refuse = false;
  get(k: string): string | null {
    if (this.refuse) { this.refuse = false; throw new Error('storage refused'); }
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
  keys(): string[] { return [...this.m.keys()].sort(); }
}

/** The provider as a value: the store, the cache record its ref holds, the two
 *  units in React state, and the legacy blob sitting on the handset. */
interface Provider {
  store: FakeStore;
  cache: DeviceCache;
  weight: WeightUnit | null;
  length: LengthUnit | null;
  cached: CachedUnits;
}

/** The head of the units effect, run synchronously on every account change —
 *  including a sign-out, which is an account change to nobody. */
const account = (p: Provider, uid: string | null) => {
  p.cache = unitCache(uid);
  p.cached = NO_CACHED_UNITS;
  // The units leave the screen with the key. Dropped on the way IN, before the
  // read lands and whatever it decides.
  p.weight = null;
  p.length = null;
};

/** The cached read. `throws` is a refused store, after which the flag must stay
 *  false and nothing may be written. */
const readCache = (p: Provider, o: { throws?: boolean } = {}) => {
  if (!p.cache.key) return;
  p.store.refuse = !!o.throws;
  try {
    p.cached = parseCachedUnits(p.store.get(p.cache.key));
    p.cache = cacheHydrated(p.cache);
  } catch { /* not hydrated: nothing may be written over bytes nobody read */ }
  p.weight = p.weight ?? p.cached.weightUnit;
  p.length = p.length ?? p.cached.lengthUnit;
};

/** The row read, applied — the provider's `apply`, to the letter. */
const applyRow = (p: Provider, w: ColumnRead<WeightUnit>, l: ColumnRead<LengthUnit>, uid: string) => {
  const wc = chooseUnit(w, p.cached.weightUnit);
  const lc = chooseUnit(l, p.cached.lengthUnit);
  p.weight = wc.from === 'account' ? wc.chosen : (p.weight ?? wc.chosen);
  p.length = lc.from === 'account' ? lc.chosen : (p.length ?? lc.chosen);
  if (!mayRefreshCache(wc.from) && !mayRefreshCache(lc.from)) return;
  if (!mayWriteCache(p.cache) || p.cache.uid !== uid) return;
  const blob = cachedUnitsBlob({ weightUnit: wc.chosen, lengthUnit: lc.chosen });
  if (blob == null) p.store.remove(p.cache.key); else p.store.set(p.cache.key, blob);
};

/** A tap on a unit pill. On screen always, kept only where this device may keep
 *  it — and kept whatever the server write does with it. */
const tap = (p: Provider, unit: WeightUnit) => {
  p.weight = unit;
  if (!mayWriteCache(p.cache)) return;
  const blob = cachedUnitsBlob({ weightUnit: p.weight, lengthUnit: p.length });
  if (blob != null) p.store.set(p.cache.key, blob);
};

{
  const p: Provider = {
    store: new FakeStore(), cache: unitCache(null), weight: null, length: null, cached: NO_CACHED_UNITS,
  };
  // The handset arrives with a pre-migration blob under the unqualified key —
  // somebody's pounds, and nothing anywhere saying whose.
  p.store.set(LEGACY_UNIT_BLOB_KEY, '{"notifPush":true,"restSound":true,"weightUnit":"lb"}');

  // ── member A signs in, has chosen pounds on their account ──
  account(p, A);
  readCache(p);
  ok(mayWriteCache(p.cache), 'a read that landed on an empty store still arms the write');
  applyRow(p, { read: 'said', unit: 'lb' }, { read: 'never' }, A);
  eq(p.weight, 'lb', "A reads in the unit A's account holds");
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb"}',
    "and the account's answer is cached under A's own key");
  ok(!p.store.keys().includes(`${UNIT_CACHE_PREFIX}${B}`), 'and under nobody else’s');

  // ── A signs out ──
  account(p, null);
  eq(p.weight, null, "the departing member's unit leaves the screen with their key");
  ok(!mayWriteCache(p.cache), 'and nothing may be written with nobody signed in');
  tap(p, 'kg');
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb"}',
    'a tap with nobody signed in reaches no key at all — least of all the last account’s');

  // ── member B signs in on the same handset. NEVER chosen a unit. ──
  // This is the defect, and this is the assertion that would have caught it.
  account(p, B);
  ok(!p.cache.hydrated, 'the hydration flag is false again the instant the key changes');
  readCache(p);
  applyRow(p, { read: 'never' }, { read: 'never' }, B);
  eq(p.weight, null,
    'B has never chosen a unit and inherits NOTHING — not A’s cache, and not the unqualified blob on the handset');
  eq(resolveUnits(p.weight, p.length, 'AE').weightSource, 'device',
    'so the unit B reads in is reported as the phone’s guess, which is what puts the note on screen');
  eq(p.store.keys().filter((k) => isUnitCacheKey(k)).join(','), `${UNIT_CACHE_PREFIX}${A}`,
    'and a NULL column writes no key for B: an unchosen unit is not a stored one');

  // B picks kilograms. Their own key, and A's is untouched.
  tap(p, 'kg');
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${B}`), '{"weightUnit":"kg"}', "B's choice is stored under B's key");
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb"}', "and A's is exactly as A left it");

  // The server has not caught up — B's column is still NULL on the next launch.
  // The cached choice must survive that, or the tap was for nothing.
  account(p, B);
  readCache(p);
  applyRow(p, { read: 'never' }, { read: 'never' }, B);
  eq(p.weight, 'kg', 'a NULL column does not erase the choice B made on this handset');
  eq(resolveUnits(p.weight, p.length, 'US').weightSource, 'chosen',
    'and it is reported as chosen, because B chose it');

  // ── and the legacy blob is still sitting there, untouched ──
  eq(p.store.get(LEGACY_UNIT_BLOB_KEY), '{"notifPush":true,"restSound":true,"weightUnit":"lb"}',
    'nothing in this repair deletes the pre-migration blob — a correction is a second recorded fact, not an erasure');
}

/* ── a refused cache read writes nothing ─────────────────────────────────── */
{
  const p: Provider = {
    store: new FakeStore(), cache: unitCache(null), weight: null, length: null, cached: NO_CACHED_UNITS,
  };
  p.store.set(`${UNIT_CACHE_PREFIX}${A}`, '{"weightUnit":"lb"}');

  account(p, A);
  readCache(p, { throws: true });
  ok(!p.cache.hydrated, 'a read that threw does not hydrate — "we could not read it" is not "there is nothing there"');
  applyRow(p, { read: 'said', unit: 'kg' }, { read: 'never' }, A);
  eq(p.weight, 'kg', "the account's own column is still believed, because it came back");
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb"}',
    'but nothing is written over bytes this launch never managed to read');

  // And the row read failing on top of it leaves the member with no answer
  // rather than a fabricated one.
  account(p, A);
  readCache(p, { throws: true });
  applyRow(p, { read: 'failed' }, { read: 'failed' }, A);
  eq(p.weight, null, 'two failed reads know nothing, and say so');
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb"}', 'and still write nothing');
}

/* ── a tap before the read lands is on screen and is not kept ────────────── */
//
// The window is short and the loss is real, so it is stated rather than left to
// be inferred from the gate. What makes it the cheaper side is the SECOND
// answer: `set` computes the blob from the whole of its state, so a tap on the
// weight before this key has been read would write a blob with no length in it
// over a key that holds one — a choice destroyed in order to store another.
{
  const p: Provider = {
    store: new FakeStore(), cache: unitCache(null), weight: null, length: null, cached: NO_CACHED_UNITS,
  };
  p.store.set(`${UNIT_CACHE_PREFIX}${A}`, '{"weightUnit":"lb","lengthUnit":"in"}');

  // A signs in. The read of their key has been started and has not come back.
  account(p, A);
  ok(!mayWriteCache(p.cache), 'before the read lands this handset may not be written to');
  tap(p, 'kg');
  eq(p.weight, 'kg',
    'the tap moves the control at once — a unit that does not change when it is tapped is a control nobody trusts');
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb","lengthUnit":"in"}',
    'and NOTHING is written: the blob `set` would compute names no length, so keeping the tap would erase a height this launch has not read');

  // The read lands. The tap survives it, and so does the unread length.
  readCache(p);
  eq(p.weight, 'kg', 'the tap survives the read that overtakes it');
  eq(p.length, 'in', 'and the length A chose on an earlier launch comes back off their own key');
  tap(p, 'lb');
  eq(p.store.get(`${UNIT_CACHE_PREFIX}${A}`), '{"weightUnit":"lb","lengthUnit":"in"}',
    'and the next tap keeps BOTH answers, because by now both are known');
}

/* ── a write for the wrong account is refused ────────────────────────────── */
{
  const p: Provider = {
    store: new FakeStore(), cache: unitCache(null), weight: null, length: null, cached: NO_CACHED_UNITS,
  };
  account(p, A);
  readCache(p);
  // The row read began under A and came back after B signed in. The uid check
  // is what stops A's answer landing in B's key.
  applyRow(p, { read: 'said', unit: 'lb' }, { read: 'never' }, B);
  eq(p.store.keys().length, 0, 'a row read for a different account than the cache holds writes nothing');
}

/* ── the two unions ──────────────────────────────────────────────────────── */
{
  ok(isWeightUnit('kg') && isWeightUnit('lb'), 'both weight units are weight units');
  ok(!isWeightUnit('cm') && !isWeightUnit('') && !isWeightUnit(null) && !isWeightUnit(2),
    'and nothing else is, including a length and a number');
  ok(isLengthUnit('cm') && isLengthUnit('in'), 'both length units are length units');
  ok(!isLengthUnit('kg') && !isLengthUnit(undefined), 'and nothing else is');
}

if (errors.length) {
  console.error(`unitCache.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('unitCache.test.ts — ok');
