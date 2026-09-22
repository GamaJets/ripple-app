// Editing a package a coach already sells. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a price is what somebody else's
// card is charged. A coach who raises their rate and is told nothing believes
// they have put their existing clients up and has not; a coach whose edit is
// silently refused sells at the old rate for a year; and a coach whose typing
// slip is silently rounded or trimmed is shown a number they did not enter.
import {
  MAX_PRICE_CENTS, PACKAGE_NOT_SAVED, RENAME_RELABELS_HISTORY, isRename, isReprice,
  packageEditBlocker, packageUpdateRow, repriceNote,
} from './packageEdit';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── what may be edited ─────────────────────────────────────────────────── */

eq(packageEditBlocker({ name: 'Gold Pack' }), null, 'a name may be changed');
eq(packageEditBlocker({ price_cents: 7500 }), null, 'a price may be changed');
eq(packageEditBlocker({ name: 'Gold Pack', price_cents: 7500 }), null, 'or both at once');

// An empty patch is refused rather than written as a no-op that reports success.
ok(!!packageEditBlocker({}), 'an empty patch changes nothing and says so');

/* ── a name is what the client sees on the payment page ─────────────────── */

ok(!!packageEditBlocker({ name: '' }), 'a package cannot be nameless');
ok(!!packageEditBlocker({ name: '   ' }), 'nor named three spaces');
ok(!!packageEditBlocker({ name: 'x'.repeat(121) }), 'nor given a name no payment page can show');
eq(packageEditBlocker({ name: 'x'.repeat(120) }), null, 'the limit itself is allowed');

/* ── a price is refused, never corrected ────────────────────────────────── */

ok(!!packageEditBlocker({ price_cents: 0 }), 'zero is not a price — withdrawing is a different action');
ok(!!packageEditBlocker({ price_cents: -100 }), 'a negative is not a price');
ok(!!packageEditBlocker({ price_cents: 75.5 }), 'minor units are whole — half a penny is a slip, not a price');
ok(!!packageEditBlocker({ price_cents: NaN }), 'NaN is not a price');
ok(!!packageEditBlocker({ price_cents: Infinity }), 'nor is infinity');
ok(!!packageEditBlocker({ price_cents: MAX_PRICE_CENTS + 1 }), 'an extra zero is caught before it reaches a client');
eq(packageEditBlocker({ price_cents: MAX_PRICE_CENTS }), null, 'the ceiling itself is allowed');
eq(packageEditBlocker({ price_cents: 1 }), null, 'and the smallest real amount is');

// Refused, not rounded. This is the screen where the number the coach types is
// the number somebody else pays, and a silent correction is that person being
// charged something nobody chose.
eq(packageUpdateRow({ price_cents: 75.5 }), null, 'a refused edit produces no row at all');
eq(packageUpdateRow({ name: '  ' }), null, 'and neither does a refused name');

/* ── the row that reaches the database carries only what was asked ──────── */

const row = packageUpdateRow({ name: '  Gold Pack  ' })!;
eq(row.name, 'Gold Pack', 'the name is trimmed');
eq('price_cents' in row, false, 'a name edit does not touch the price');

const priceRow = packageUpdateRow({ price_cents: 9000 })!;
eq(priceRow.price_cents, 9000, 'the price is the price');
eq('name' in priceRow, false, 'a price edit does not touch the name');

// THE fields this deliberately cannot write. Currency, because
// `client_purchases.currency` is null on rows written before part 132 and those
// sales fall back to the package's — editing it redenominates a coach's own
// history. Sessions and billing_interval, because a live subscription's cadence
// is held in Stripe and part 97 forbids the two together anyway.
for (const forbidden of ['currency', 'sessions', 'billing_interval', 'active', 'trainer_id', 'id']) {
  eq(forbidden in packageUpdateRow({ name: 'Gold Pack', price_cents: 1 })!, false,
    `a package edit never writes ${forbidden}`);
}

/* ── a typo fix is not a reprice ────────────────────────────────────────── */

eq(isReprice({ name: 'Gold Pack' }, 6000), false, 'correcting a name is not a reprice');
eq(isReprice({ price_cents: 6000 }, 6000), false, 're-saving the same price is not a reprice');
eq(isReprice({ price_cents: 7500 }, 6000), true, 'changing the number is');
eq(isReprice({ price_cents: 7500 }, null), true,
  'and a price arriving where none was known counts, because the warning is the safe side');

/* ── what the coach is told, and the answer that must not be guessed ────── */

const none = repriceNote(0);
const one = repriceNote(1);
const many = repriceNote(4);
const unknown = repriceNote(null);

for (const [label, line] of [['none', none], ['one', one], ['many', many], ['unknown', unknown]] as const) {
  ok(line.trim().endsWith('.'), `${label} is a finished sentence`);
  // The claim every branch must make, because it is the one thing a coach
  // raising their rate will otherwise get wrong: this is forward-looking.
  ok(/new sales only/.test(line), `${label} says the change applies to new sales only`);
}

// "Nobody is subscribed" is a fact about somebody's income and must come from a
// read that actually answered. A failed count reported as zero tells a coach
// they can reprice freely when four people are on the old rate.
ok(/[Nn]obody is currently subscribed/.test(none), 'a read that answered zero says so plainly');
ok(!/[Nn]obody is currently subscribed/.test(unknown),
  'a read that did not answer must not be reported as nobody');
ok(/could not be read/.test(unknown), 'it names the failed read instead');
ok(/not a statement that nobody is/.test(unknown), 'and refuses the collapse in as many words');

// Singular and plural, because "1 people are subscribed" reads as a screen that
// does not know what it is talking about — on the screen about money.
ok(/1 person is/.test(one), 'one subscriber is a person');
ok(/4 people are/.test(many), 'four subscribers are people');
ok(/stays on it/.test(one) && /stay on it/.test(many), 'and the verb agrees with them');

eq(new Set([none, one, many, unknown]).size, 4, 'the four answers read as four sentences');

/* ── and the refusal, which is the one that costs a year of income ──────── */

ok(/still on sale/.test(PACKAGE_NOT_SAVED),
  'a refused edit says the package is unchanged rather than implying it saved');
ok(/[Nn]othing has changed/.test(PACKAGE_NOT_SAVED), 'and says so in the words the rest of the app uses');

/* ── the rename, which is the edit that reaches BACKWARDS ───────────────
 *
 * The whole of this module's header argues that an edit cannot touch a sale
 * already made, and that argument holds for the price and not for the name:
 * neither `client_purchases` nor `client_subscriptions` has a name column, so
 * every list resolves one with a live `trainer_packages` lookup. A coach
 * renaming a pack relabels their own sales history, their client's, and the
 * refund sheet they are about to give money back from.
 */

ok(!isRename({ price_cents: 9900 }, 'Gold Pack'), 'a price edit alone is not a rename');
ok(!isRename({ name: 'Gold Pack' }, 'Gold Pack'), 'the same name is not a rename');
ok(!isRename({ name: '  Gold Pack  ' }, 'Gold Pack'), 'and neither is the same name with whitespace round it');
ok(isRename({ name: 'Platinum Pack' }, 'Gold Pack'), 'a different name is a rename');
ok(isRename({ name: 'Gold Pack' }, null), 'a name where there was none is a rename');
ok(!isRename({}, 'Gold Pack'), 'an empty patch changes no name');

// The warning has to say the thing a coach would otherwise be wrong about, and
// it has to say the thing they would otherwise fear. Both, or it is not usable:
// "your history is relabelled" without "the money is not" reads as though a
// rename moved somebody's price.
ok(/relabelled/.test(RENAME_RELABELS_HISTORY), 'the rename warning says past sales are relabelled');
ok(/refund/.test(RENAME_RELABELS_HISTORY), 'and names the refund screen, where it costs the most');
ok(/price/.test(RENAME_RELABELS_HISTORY) && /do not move/.test(RENAME_RELABELS_HISTORY),
  'and says the amounts on those sales do not move');
ok(RENAME_RELABELS_HISTORY !== repriceNote(0) && RENAME_RELABELS_HISTORY !== repriceNote(null),
  'and it is not the reprice note wearing a different hat');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('packageEdit: ok');
