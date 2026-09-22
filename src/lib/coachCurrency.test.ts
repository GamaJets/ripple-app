// A coach naming their own currency. Compile with tsc, run with node.
//
// The bugs these guard, in the order they would reach somebody:
//
//   · an unapplied migration reported to a coach as their currency being
//     refused, which sends them to support over a deploy step;
//   · a refusal reported as being offline, which they answer by tapping again
//     forever;
//   · a currency that is already set being overwritten, which reprices every
//     package a client is already paying for;
//   · a reply whose shape has drifted being read as success, which is this
//     screen telling a coach their gym is priced when it is not.
import {
  CURRENCY_CHOICES, WHY_NOT_A_REPRICE, isCurrencyCode, isMissingFunction, isMissingColumn,
  classifySetCoachCurrencyError, readSetCurrency, setCurrencyLine, type SetCurrencyOutcome,
} from './coachCurrency';
import { ZERO_DECIMAL, THREE_DECIMAL, currencyDecimals } from './coachMoney';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the codes offered are codes the column will accept ────────────────── */

// `tenants_currency_is_iso` (part 99) is `currency ~ '^[A-Z]{3}$'`. A picker
// offering anything that constraint refuses is a button that always fails.
for (const c of CURRENCY_CHOICES) {
  ok(isCurrencyCode(c), `${c} satisfies the ISO check the column enforces`);
}
eq(new Set(CURRENCY_CHOICES).size, CURRENCY_CHOICES.length, 'the picker offers no duplicates');

// Alphabetical. Any other order nominates a favourite, and there is no default
// currency in this product for the first pill to be.
eq(CURRENCY_CHOICES.join(','), [...CURRENCY_CHOICES].sort().join(','), 'the picker implies no preference by order');

/* ── and the picker is not a claim that all money has two places ────────── */

// The N2 defect. The list was eight codes, every one of them a hundredth, so a
// coach in Tokyo or Kuwait could not choose the currency they charge in — and
// the only alternatives were to pick one they do not take or to stay unpriced
// for ever. `ZERO_DECIMAL` and `THREE_DECIMAL` in coachMoney.ts are this
// codebase's authority on what a currency's minor unit is, and these assert
// against them directly rather than against a copied list.
const offered = new Set<string>(CURRENCY_CHOICES);

// Every thousandth-unit currency, because there are only five of them and each
// is somebody's entire market. KWD is the one `majorFromMinor` was written for.
for (const c of THREE_DECIMAL) {
  ok(offered.has(c.toUpperCase()), `${c.toUpperCase()} is offered — a coach charging in thousandths can choose it`);
}
// Not all sixteen zero-decimal currencies: several are not markets this is sold
// into. These are, and a picker without them is the defect.
for (const c of ['JPY', 'KRW', 'VND', 'CLP']) {
  ok(offered.has(c), `${c} is offered — a currency with no minor unit at all`);
  eq(ZERO_DECIMAL.has(c.toLowerCase()), true, `${c} really is zero-decimal, per coachMoney`);
}

// The point of the two above, stated as the thing that was wrong: the picker
// covers all three shapes of money, not one.
const places = new Set(CURRENCY_CHOICES.map((c) => currencyDecimals(c)));
eq(places.has(0), true, 'the picker contains money with no decimal places');
eq(places.has(2), true, 'money with two');
eq(places.has(3), true, 'and money with three');

eq(isCurrencyCode('gbp'), false, 'lower case is not what the column stores');
eq(isCurrencyCode('GBPX'), false, 'four letters is not a code');
eq(isCurrencyCode('GB'), false, 'two letters is not a code');
eq(isCurrencyCode(''), false, 'the empty string is not a code');
eq(isCurrencyCode(null), false, 'a null is not a code');
eq(isCurrencyCode('£'), false, 'a symbol is not a code');

/* ── an unapplied migration is not a refusal ───────────────────────────── */

// THE bug this pair exists for. Both of these ARE the server answering, so
// every rule in offlineQueue.ts calls them refusals — correctly, for a row.
// For this call they mean part 164 has not been run, and telling a coach their
// currency was declined sends the wrong person to look at it.
ok(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.set_my_tenant_currency' }),
  'PostgREST cannot find the function: the migration is not applied');
ok(isMissingFunction({ code: '42883', message: 'function does not exist' }),
  'undefined_function is the same fact from Postgres');
ok(isMissingFunction({ status: 404, message: 'Could not find the function in the schema cache' }),
  'recognised from the message when the code does not arrive');

ok(!isMissingFunction({ code: '42501', message: 'permission denied' }), 'RLS is a refusal, not a missing function');
ok(!isMissingFunction({ code: '23514', message: 'violates check constraint' }), 'a CHECK is a refusal');
ok(!isMissingFunction({ message: 'Network request failed' }), 'no answer at all is not a missing function');
ok(!isMissingFunction(null), 'no error is not a missing function');
ok(!isMissingFunction(undefined), 'no error is not a missing function');

/* ── the reply is read strictly ────────────────────────────────────────── */

eq(readSetCurrency({ ok: true, currency: 'GBP' }), 'set', 'the server said it wrote it');
eq(readSetCurrency({ ok: false, reason: 'no_tenant' }), 'no-tenant', 'no gym to price');
eq(readSetCurrency({ ok: false, reason: 'shared_tenant' }), 'shared', 'a gym with staff has an owner to decide');
eq(readSetCurrency({ ok: false, reason: 'already_set' }), 'already-set', 'this route does not reprice');
eq(readSetCurrency({ ok: false, reason: 'bad_code' }), 'bad-code', 'the column refused the shape');

// The coach's own route, part 940. `has_tenant` is the precedence rule coming
// back from the server: a coach in a gym is priced by that gym and this write
// will not put a second answer beside it.
eq(readSetCurrency({ ok: false, reason: 'has_tenant' }), 'has-tenant', 'a coach in a gym is priced by the gym');
eq(readSetCurrency({ ok: false, reason: 'no_coach_row' }), 'no-record', 'nowhere to keep a currency');
eq(readSetCurrency({ ok: false, reason: 'no_profile' }), 'no-record', 'and no account record is the same sentence');

// A reply that has lost its shape must land anywhere except 'set'. This screen
// exists to tell a coach whether their gym is priced, and "probably" is not one
// of the answers it may give.
eq(readSetCurrency({}), 'refused', 'an empty object is not a success');
eq(readSetCurrency(null), 'refused', 'a null reply is not a success');
eq(readSetCurrency(undefined), 'refused', 'a missing reply is not a success');
eq(readSetCurrency({ ok: 'true' }), 'refused', 'the string "true" is not true');
eq(readSetCurrency({ ok: 1 }), 'refused', 'a truthy 1 is not true');
eq(readSetCurrency({ ok: false, reason: 'something new' }), 'refused', 'an unknown reason is not a success');

/* ── every outcome has a sentence, and each says the right thing ───────── */

const ALL: SetCurrencyOutcome[] = [
  'set', 'no-tenant', 'shared', 'already-set', 'bad-code', 'unavailable', 'refused', 'unsent',
  'has-tenant', 'no-record', 'no-column',
];
const lines = ALL.map((o) => [o, setCurrencyLine(o, 'GBP')] as const);

for (const [o, line] of lines) {
  ok(line.trim().length > 0, `${o} has a sentence`);
  ok(line.trim().endsWith('.'), `${o} is a finished sentence`);
  // "Nothing has changed" is the reassurance a coach needs from every outcome
  // that is not a success, and it is exactly the claim that must NOT be made
  // when the write landed.
  eq(/[Nn]othing has changed/.test(line), o !== 'set' && o !== 'already-set',
    `${o} says whether anything changed`);
}

// Only ONE outcome sends the coach to their gym owner, and it is the only one
// where there demonstrably is one. The six screens that withhold money already
// say "an owner sets one in the gym settings" to every coach including the ones
// who have no owner, and that sentence is the reason this whole item exists.
for (const [o, line] of lines) {
  // 'has-tenant' joins the two: the server answered it BY reading the tenant on
  // this coach's profile, so a gym demonstrably exists and pointing at its
  // settings is the true thing to say. Every other outcome — including the two
  // that mean part 940 or 164 has not been applied to a coach with no gym at
  // all — must not, because there is nobody there.
  eq(/gym settings/.test(line), o === 'shared' || o === 'unavailable' || o === 'has-tenant',
    `${o} names the gym owner only where there is one to name`);
}

// The two "not deployed yet" sentences are kept apart because they are read by
// different people: 'unavailable' is a coach in a personal tenant, who still
// has the owner route; 'no-column' is a coach with no gym at all, who has
// nobody to be sent to.
ok(!/gym settings/.test(setCurrencyLine('no-column', 'GBP')),
  'an independent coach is not sent to a gym owner who does not exist');
ok(/waiting to be applied/.test(setCurrencyLine('no-column', 'GBP')),
  'and is told it is a deploy step rather than something they did');

// Only the outcome that a retry can fix says to retry.
for (const [o, line] of lines) {
  eq(/[Tt]ry again/.test(line), o === 'unsent', `${o} says to try again only when that would help`);
}

// The success names the code back. A coach who taps GBP and is told something
// generic has no way to know whether the tap landed on the one they meant.
ok(setCurrencyLine('set', 'GBP').includes('GBP'), 'the success names the currency it set');
ok(setCurrencyLine('set', 'SAR').includes('SAR'), 'and it is the one that was passed, not a literal');

// The already-set sentence IS the shared explanation, not a paraphrase of it:
// two wordings of why a currency is not editable would drift, and the one that
// drifts is the one nobody reads.
eq(setCurrencyLine('already-set', 'GBP'), WHY_NOT_A_REPRICE, 'the reprice refusal is stated once');
ok(/reprice/.test(WHY_NOT_A_REPRICE), 'and it names what changing it would do to a client already paying');

// Eleven outcomes, eleven sentences. A refactor that collapsed two of these
// back onto one wording is what this whole file is here to catch.
eq(new Set(lines.map(([, l]) => l)).size, ALL.length, 'each outcome reads differently');

/* ── a column the database has not got is not a refusal either ─────────── */

// The read-side twin of `isMissingFunction`, and the same bug: `select
// currency from trainers` against a database without part 940 errors, and
// every rule in offlineQueue.ts calls that a refusal. Reported as one it
// becomes "try again in a moment" for a state that will never resolve.
ok(isMissingColumn({ code: '42703', message: 'column trainers.currency does not exist' }),
  'undefined_column is the migration, not a refusal');
ok(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'currency' column" }),
  'PostgREST says the same thing with its own code');
ok(isMissingColumn({ message: 'column "currency" does not exist' }),
  'recognised from the message when no code arrives');
ok(!isMissingColumn({ code: '42501', message: 'permission denied for table trainers' }),
  'RLS is a refusal, not a missing column');
ok(!isMissingColumn({ message: 'Network request failed' }), 'no answer at all is not a missing column');
ok(!isMissingColumn(null), 'no error is not a missing column');

/* ── and the coach's own route names the deploy step differently ────────── */

eq(classifySetCoachCurrencyError({ code: 'PGRST202', message: 'Could not find the function' }), 'no-column',
  'part 940 unapplied is its own outcome, not the gym-owner one');
eq(classifySetCoachCurrencyError({ code: '42501', message: 'permission denied' }), 'refused',
  'a refusal is still a refusal');
eq(classifySetCoachCurrencyError({ message: 'Network request failed' }), 'unsent',
  'and nothing answering is still nothing answering');
eq(classifySetCoachCurrencyError(null), 'refused', 'no error object is not a success');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachCurrency: ok');
