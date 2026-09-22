// A shop starts empty unless it is this person's, this week's.
// Compile with tsc, run with node.
import { groceryTicksKey, isGroceryTicksKey, readGroceryTicks, GROCERY_TICKS_PREFIX } from './groceryTicks';
import { PERSONAL_DEVICE_KEYS, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the key carries both scopes ────────────────────────────────────────── */

const a = groceryTicksKey('user-a', '2026-08-30')!;
const b = groceryTicksKey('user-b', '2026-08-30')!;
const later = groceryTicksKey('user-a', '2026-09-06')!;
ok(a !== b, 'two members on one handset do not share a shop');
ok(a !== later, 'and this week is not last week — "Produce|Spinach" does not carry over');
ok(isGroceryTicksKey(a) && a.startsWith(GROCERY_TICKS_PREFIX), 'and it is recognisable as what it is');
ok(a.includes('user-a') && a.includes('2026-08-30'), 'both scopes really are in it');

// Two members' keys never collide, whatever week either is in.
const seen = new Set<string>();
for (const uid of ['u1', 'u2', 'u3']) {
  for (const wk of ['2026-08-30', '2026-09-06', '2026-09-13']) {
    const k = groceryTicksKey(uid, wk)!;
    ok(!seen.has(k), `no collision for ${uid} in ${wk}`);
    seen.add(k);
  }
}
eq(seen.size, 9, 'nine distinct shops');

/* ── no account, no persistence ─────────────────────────────────────────── */

eq(groceryTicksKey(null, '2026-08-30'), null, 'nobody signed in writes nothing');
eq(groceryTicksKey('', '2026-08-30'), null, 'nor does an empty id');
eq(groceryTicksKey('   ', '2026-08-30'), null, 'nor a blank one');
// The literal clientData settles on before the auth read lands. Using it as an
// account would give every signed-out session on the handset one shared shop.
eq(groceryTicksKey('unknown', '2026-08-30'), null, "'unknown' is not an account");
eq(groceryTicksKey('u1', ''), null, 'and no week is no key either');

/* ── it is account-scoped, so sign-out leaves it alone by construction ──── */

ok(!PERSONAL_DEVICE_KEYS.some((k) => isGroceryTicksKey(k)),
  'it is not on the device-key list — that list is only for keys with no account in them');
ok(!PERSONAL_DEVICE_KEYS.includes('repple.grocery.checked'),
  'and the old unqualified key is not on it either — it no longer exists');
ok(ACCOUNT_SCOPED_PREFIXES.every((p) => !GROCERY_TICKS_PREFIX.startsWith(p)),
  'it is its own prefix, not smuggled under another module’s');

/* ── reading back what was stored ───────────────────────────────────────── */

eq(Object.keys(readGroceryTicks(null)).length, 0, 'nothing stored is an empty trolley');
eq(Object.keys(readGroceryTicks('')).length, 0, 'so is an empty string');
eq(Object.keys(readGroceryTicks('not json')).length, 0, 'and so is a corrupt blob — never a throw');
eq(Object.keys(readGroceryTicks('[1,2,3]')).length, 0, 'an array is not a tick map');
{
  const back = readGroceryTicks(JSON.stringify({ 'Produce|Spinach': true, 'Dairy|Milk': false }));
  eq(back['Produce|Spinach'], true, 'a ticked item comes back ticked');
  ok(!('Dairy|Milk' in back), 'and an unticked one is simply absent rather than stored as false');
  eq(Object.keys(back).length, 1, 'only the ticks are kept');
}
{
  const junk = readGroceryTicks(JSON.stringify({ 'Produce|Spinach': 'yes', '': true }));
  eq(Object.keys(junk).length, 0, 'a value that is not a real tick is not one');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('groceryTicks: ok');
