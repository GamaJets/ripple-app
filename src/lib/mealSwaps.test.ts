// A swapped meal belongs to the member who swapped it, and to nobody else.
// Compile with tsc, run with node.
import {
  MEAL_SWAPS_PREFIX, LEGACY_MEAL_SWAPS_KEY,
  mealSwapsKey, isMealSwapsKey, readMealSwaps, writeMealSwaps,
} from './mealSwaps';
import { PERSONAL_DEVICE_KEYS, KEPT_ON_SIGN_OUT, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the account is in the key ──────────────────────────────────────────── */

const a = mealSwapsKey('user-a')!;
const b = mealSwapsKey('user-b')!;
ok(a !== b, 'two members on one handset do not share a set of swaps');
ok(a.includes('user-a'), 'the account really is in it');
ok(isMealSwapsKey(a) && a.startsWith(MEAL_SWAPS_PREFIX), 'and it is recognisable as what it is');
ok(!isMealSwapsKey(LEGACY_MEAL_SWAPS_KEY), 'the unqualified key it replaces is not one of these');

// Distinct for every account, with no collisions.
const seen = new Set<string>();
for (const uid of ['u1', 'u2', 'u3', 'u10', 'u1 ']) seen.add(mealSwapsKey(uid)!);
eq(seen.size, 4, "four distinct keys — 'u1 ' is 'u1' trimmed, not a fifth member");

/* ── no account, no persistence ─────────────────────────────────────────── */

eq(mealSwapsKey(null), null, 'nobody signed in writes nothing');
eq(mealSwapsKey(undefined), null, 'nor does an absent id');
eq(mealSwapsKey(''), null, 'nor an empty one');
eq(mealSwapsKey('   '), null, 'nor a blank one');
// The literal clientData settles on before the auth read lands. Using it as an
// account would give every signed-out session on the handset one shared plan.
eq(mealSwapsKey('unknown'), null, "'unknown' is not an account");

/* ── the key needs no sign-out entry, and must not have got one ─────────── */

ok(!PERSONAL_DEVICE_KEYS.some(isMealSwapsKey), 'an account-scoped key is not on the device-key list');
ok(!KEPT_ON_SIGN_OUT.some(isMealSwapsKey), 'nor on the keep list');
ok(!ACCOUNT_SCOPED_PREFIXES.includes(MEAL_SWAPS_PREFIX), 'and it is not an outbox prefix');

/* ── what comes back off the store ──────────────────────────────────────── */

same(readMealSwaps(null), {}, 'nothing stored is no swaps');
same(readMealSwaps(''), {}, 'and so is an empty string');
same(readMealSwaps('{'), {}, 'a blob that will not parse is no swaps, not a throw');
same(readMealSwaps('[1,2,3]'), {}, 'an array is not a swap map');
same(readMealSwaps('"3"'), {}, 'nor is a bare string');
same(readMealSwaps('null'), {}, 'nor null');
same(readMealSwaps('{"0":5,"2":11}'), { 0: 5, 2: 11 }, 'two real swaps survive the round trip');

// Both halves are arithmetic downstream — `buildPlan` reads the key as a slot
// position and the value as a catalogue index it resolves with `idx % size`.
// A non-number on either side comes out as a meal nobody chose.
same(readMealSwaps('{"0":"5"}'), {}, 'a string index is dropped, not coerced');
same(readMealSwaps('{"0":null}'), {}, 'a null index is dropped — null is not a meal');
same(readMealSwaps('{"0":1.5}'), {}, 'a fractional index is dropped');
same(readMealSwaps('{"0":-2}'), {}, 'a negative index is dropped');
same(readMealSwaps('{"first":4}'), {}, 'a position that is not a number is dropped');
same(readMealSwaps('{"-1":4}'), {}, 'and a negative position with it');
same(readMealSwaps('{"0":4,"nope":9}'), { 0: 4 }, 'one bad pair does not take the good one with it');

/* ── and what goes back in ──────────────────────────────────────────────── */

eq(writeMealSwaps({ 0: 5, 2: 11 }), JSON.stringify({ 0: 5, 2: 11 }), 'swaps go to the store as they came off it');
same(readMealSwaps(writeMealSwaps({ 0: 5, 2: 11 })), { 0: 5, 2: 11 }, 'the round trip is the identity');
same(readMealSwaps(writeMealSwaps({} as Record<number, number>)), {}, 'no swaps round-trips as no swaps');
// Nothing the reader would refuse is ever written, so a stored blob cannot be
// worse than what a reader will accept back.
same(readMealSwaps(writeMealSwaps({ 0: 5, 1: NaN } as unknown as Record<number, number>)), { 0: 5 },
  'a NaN index is not written out to be read back as a meal');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`mealSwaps.test.ts — ok`);
