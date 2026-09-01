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
  CURRENCY_CHOICES, WHY_NOT_A_REPRICE, isCurrencyCode, isMissingFunction,
  readSetCurrency, setCurrencyLine, type SetCurrencyOutcome,
} from './coachCurrency';

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

const ALL: SetCurrencyOutcome[] = ['set', 'no-tenant', 'shared', 'already-set', 'bad-code', 'unavailable', 'refused', 'unsent'];
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
  eq(/gym settings/.test(line), o === 'shared' || o === 'unavailable',
    `${o} names the gym owner only where there is one to name`);
}

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

// Eight outcomes, eight sentences. A refactor that collapsed two of these back
// onto one wording is what this whole file is here to catch.
eq(new Set(lines.map(([, l]) => l)).size, ALL.length, 'each outcome reads differently');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachCurrency: ok');
