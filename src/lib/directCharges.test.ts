// The rules that decide which Stripe ledger a charge lands on, who carries a
// loss on it, and what Repple may take off it. Compile with tsc, run with node.
//
// Every assertion here is about live money on somebody else's account. The two
// that matter most, and the failures they stand for:
//
//   · `modelForAccount` defaulting to 'destination'. Coaches onboarded before
//     this change are on Express accounts whose controller Stripe will not
//     change. If an unrecognised or absent `charge_model` answered 'direct',
//     every one of them would start having Checkout Sessions created on an
//     account not configured for it, and their clients would meet the failure.
//   · `accountForObject` reading the OBJECT's account and not the coach's
//     current model. A subscription sold last month lives on the platform
//     whatever the coach sells under today, and a cancel sent to the wrong
//     ledger returns 404 — which the app renders as "subscription not found"
//     to somebody who is still being charged.
//   · `canTakeDirectCharges` refusing a direct charge on anything that is not a
//     STANDARD account. `charge_model` is a column somebody can write; the
//     account's type is what Stripe actually holds. Written onto an Express
//     account the column moves the refund debit to the coach and leaves Repple
//     carrying the fraud, the dispute and the negative balance — the exact
//     half-measure the move to Standard accounts exists to avoid, and one that
//     looks completely fine until a chargeback arrives.
//   · `liabilityFrom` defaulting to 'coach'. An account's type is fixed at
//     creation, so a mistyped secret that fell back to Express would put a new
//     coach permanently under an arrangement the owner rejected.
//
// The block at the bottom is a mutation check: it asserts that the obvious
// wrong versions of the fee arithmetic — clamping instead of refusing, sending
// a zero fee, trusting an unparseable percent — actually FAIL here, so a future
// simplification cannot pass this file.
import {
  modelForAccount, accountForObject, optionsForObject,
  platformFeePct, applicationFeeCents, DEFAULT_FEE_PCT,
  liabilityFrom, accountTypeFor, chargeModelFor, accountTypeOf, canTakeDirectCharges,
} from './directCharges';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ACCT = 'acct_1RepplE0000000';

// ── which model a coach sells under ─────────────────────────────────────────
eq(modelForAccount({ charge_model: 'direct' }), 'direct', 'the word direct selects direct charges');
eq(modelForAccount({ charge_model: 'destination' }), 'destination', 'the word destination selects destination charges');

// Everything else is destination, which is what every account did before today.
eq(modelForAccount({ charge_model: null }), 'destination', 'a null charge_model is the old model, not the new one');
eq(modelForAccount({}), 'destination', 'a row with no charge_model column is the old model');
eq(modelForAccount(null), 'destination', 'no account row at all is not a licence to use direct charges');
eq(modelForAccount(undefined), 'destination', 'an undefined account row is not a licence either');
eq(modelForAccount({ charge_model: 'Direct' }), 'destination', 'the match is exact — a capitalised word is not the flag');
eq(modelForAccount({ charge_model: ' direct ' }), 'destination', 'a padded word is not the flag either');
eq(modelForAccount({ charge_model: 'dir' }), 'destination', 'a truncated word is not the flag');
eq(modelForAccount({ charge_model: '' }), 'destination', 'an empty string is not the flag');

// ── which account an existing object lives on ───────────────────────────────
eq(accountForObject({ stripe_account_id: ACCT }), ACCT, 'an object stamped with an account lives on it');
eq(accountForObject({ stripe_account_id: null }), null, 'a null account means the platform, which is where every old row is');
eq(accountForObject({}), null, 'an unstamped row means the platform');
eq(accountForObject(null), null, 'no row is not an account');
eq(accountForObject({ stripe_account_id: '   ' }), null, 'whitespace is not an account id and must never become a Stripe-Account header');
eq(accountForObject({ stripe_account_id: ' ' + ACCT + ' ' }), ACCT, 'a padded id is trimmed rather than refused');

// The request options handed to the Stripe SDK.
eq(JSON.stringify(optionsForObject({ stripe_account_id: ACCT })), JSON.stringify({ stripeAccount: ACCT }), 'a connected object is called with its account');
eq(optionsForObject({ stripe_account_id: null }), undefined, 'a platform object is called with no account context');
eq(optionsForObject({}), undefined, 'an unstamped object is called on the platform');

// ── the platform fee percent ────────────────────────────────────────────────
const pctOf = (raw: string | null | undefined) => { const r = platformFeePct(raw); return r.ok ? r.pct : null; };
eq(pctOf(undefined), DEFAULT_FEE_PCT, 'an unset secret keeps the default the function has always used');
eq(pctOf(null), DEFAULT_FEE_PCT, 'a null secret keeps the default');
eq(pctOf(''), DEFAULT_FEE_PCT, 'an empty secret keeps the default');
eq(pctOf('   '), DEFAULT_FEE_PCT, 'a whitespace-only secret keeps the default');
eq(pctOf('10'), 10, 'ten percent reads as ten');
eq(pctOf(' 12.5 '), 12.5, 'a padded fractional percent is read');
eq(pctOf('0'), 0, 'zero percent is a legitimate setting — Repple takes nothing');

// NaN was the live bug: Number('ten') is NaN, and NaN reached Stripe as both
// application_fee_amount and application_fee_percent. Nobody could buy anything.
eq(pctOf('ten'), null, 'an unparseable percent is refused rather than passed on as NaN');
eq(pctOf('abc'), null, 'a word is not a percent');
eq(pctOf('Infinity'), null, 'an infinite percent is refused');
eq(pctOf('-5'), null, 'a negative percent would pay the coach more than the client paid');
eq(pctOf('100'), null, 'a hundred percent would take the whole charge, which Stripe refuses');
eq(pctOf('150'), null, 'more than the whole charge is refused');
ok(!platformFeePct('ten').ok && platformFeePct('ten').ok === false, 'a refusal is a refusal, not a silent default');

// ── the fee amount on a one-off ─────────────────────────────────────────────
const feeOf = (price: unknown, pct: number) => { const r = applicationFeeCents(price, pct); return r.ok ? r.fee : 'refused'; };
eq(feeOf(10000, 10), 1000, 'ten percent of 10000 minor units is 1000');
eq(feeOf(9999, 10), 1000, 'the fee is rounded, not truncated');
eq(feeOf(60000, 12.5), 7500, 'a fractional percent still lands on a whole minor unit');
eq(feeOf(10000, 0), null, 'a zero percent fee is omitted, never sent as a literal zero');

// The rounding hole. Stripe refuses application_fee_amount: 0, so a cheap
// package with a small percent must OMIT the field — sending the zero would
// take the whole Checkout Session down and the client would see nothing but a
// failure on a correctly priced package.
eq(feeOf(4, 10), null, 'a fee that rounds to zero is omitted rather than sent');
eq(feeOf(5, 10), 1, 'a fee of exactly half a minor unit rounds up, so it survives');
eq(feeOf(1, 10), null, 'a one-unit package yields no fee, and that is not an error');
eq(feeOf(0, 10), null, 'a free package yields no fee');
eq(feeOf(10, 10), 1, 'the smallest fee that survives rounding is taken');

// Stripe requires the fee to be strictly LESS than the charge.
eq(feeOf(1, 99), 'refused', 'a fee equal to the whole charge is refused, not clamped down to fit');
eq(feeOf(-100, 10), 'refused', 'a negative price is refused');
eq(feeOf(10.5, 10), 'refused', 'a fractional price is not a whole number of minor units');
eq(feeOf('10000', 10), 'refused', 'a price that arrived as a string is refused rather than coerced');
eq(feeOf(null, 10), 'refused', 'a null price is refused');
eq(feeOf(undefined, 10), 'refused', 'a missing price is refused');
eq(feeOf(NaN, 10), 'refused', 'a NaN price is refused');
eq(feeOf(10000, NaN), 'refused', 'a NaN percent never reaches Stripe');
eq(feeOf(10000, 100), 'refused', 'a hundred percent is refused at the amount too, not only at the percent');
eq(feeOf(10000, -1), 'refused', 'a negative percent is refused at the amount too');

// ── who carries a loss ──────────────────────────────────────────────────────
//
// The default is the assertion that matters here. It is 'coach', and it is not
// a convenience: an unset or mistyped secret must not put a new coach on an
// EXPRESS account, because Stripe fixes an account's type at creation, Express
// puts fraud and dispute liability on the PLATFORM for every charge type, and
// Repple would then be carrying that coach's chargebacks for the life of their
// business with nothing in the app looking wrong.
eq(liabilityFrom(undefined), 'coach', 'an unset secret onboards the coach under the arrangement the owner chose');
eq(liabilityFrom(''), 'coach', 'an empty secret does not fall back to the platform carrying losses');
eq(liabilityFrom('   '), 'coach', 'a whitespace-only secret does not either');
eq(liabilityFrom(null), 'coach', 'a null secret does not either');
eq(liabilityFrom('coach'), 'coach', 'the coach carries it when the secret says so');
eq(liabilityFrom(' COACH '), 'coach', 'the secret is read case- and space-insensitively');
eq(liabilityFrom('platform'), 'platform', 'the legacy arrangement is still reachable by name');
eq(liabilityFrom(' Platform '), 'platform', 'and it is read case- and space-insensitively too');
eq(liabilityFrom('platfrom'), 'coach', 'a typo does not silently put Repple back on the hook for a new coach');
eq(liabilityFrom('express'), 'coach', 'the account type is not the name of the setting');
eq(liabilityFrom('true'), 'coach', 'only the word platform means the platform');

// The type and the model are one decision with two names. Standard's supported
// charge types are "Direct only", so a destination charge on a Standard account
// is a request Stripe refuses; and a direct charge on a legacy Express account
// is the liability half-measure the whole change exists to avoid.
eq(accountTypeFor('coach'), 'standard', 'a new coach is onboarded onto a Standard account');
eq(accountTypeFor('platform'), 'express', 'the legacy arrangement is still an Express account');
eq(chargeModelFor('coach'), 'direct', 'a Standard account sells under direct charges');
eq(chargeModelFor('platform'), 'destination', 'an Express account sells under destination charges');

// Paired, not merely equal today: a Standard account may never be marked
// destination and an Express account may never be marked direct.
for (const l of ['coach', 'platform'] as const) {
  const pairedRight = (accountTypeFor(l) === 'standard') === (chargeModelFor(l) === 'direct');
  ok(pairedRight, `the account type and the charge model must agree for ${l}`);
}

// ── what Stripe says the account is ─────────────────────────────────────────
eq(accountTypeOf({ account_type: 'standard' }), 'standard', 'Stripe’s word is read back');
eq(accountTypeOf({ account_type: 'express' }), 'express', 'an Express account says so');
eq(accountTypeOf({ account_type: 'custom' }), 'custom', 'a Custom account is recorded as itself rather than rounded');
eq(accountTypeOf({ account_type: 'none' }), 'none', 'an account created from controller properties is recorded as itself');
eq(accountTypeOf({ account_type: ' Standard ' }), 'standard', 'padding and case do not change what the account is');
eq(accountTypeOf({ account_type: null }), null, 'a null type means nobody has asked Stripe yet');
eq(accountTypeOf({}), null, 'a row without the column means nobody has asked Stripe yet');
eq(accountTypeOf(null), null, 'no row at all is not an account type');
eq(accountTypeOf({ account_type: 'STANDARD_ACCOUNT' }), null, 'a word Stripe does not use is not silently accepted');

// ── can this account take a direct charge ───────────────────────────────────
const why = (a: Parameters<typeof canTakeDirectCharges>[0]) => { const r = canTakeDirectCharges(a); return r.ok ? 'ok' : 'refused'; };
const STD = { stripe_account_id: ACCT, account_type: 'standard' };
eq(why({ ...STD, charges_enabled: true, card_payments_status: 'active' }), 'ok', 'a verified Standard account with active card payments may take a direct charge');

// The null status is the whole compatibility question: the column does not
// exist on any row written before part 161, and refusing on it would stop
// every coach selling the moment this deploys.
eq(why({ ...STD, charges_enabled: true, card_payments_status: null }), 'ok', 'an account from before the column existed falls back to charges_enabled');
eq(why({ ...STD, charges_enabled: true }), 'ok', 'a row with no status column at all falls back to charges_enabled');
eq(why({ ...STD, charges_enabled: true, card_payments_status: '' }), 'ok', 'an empty status is an absence, not a refusal');

// A status Stripe HAS stated and that is not active is a refusal — there is
// nothing left to infer, and a charge would be rejected at Stripe anyway.
eq(why({ ...STD, charges_enabled: true, card_payments_status: 'pending' }), 'refused', 'a pending capability is refused even when charges_enabled is stale-true');
eq(why({ ...STD, charges_enabled: true, card_payments_status: 'inactive' }), 'refused', 'an inactive capability is refused');
eq(why({ ...STD, charges_enabled: true, card_payments_status: 'unrequested' }), 'refused', 'a capability never requested is refused');
eq(why({ ...STD, charges_enabled: false, card_payments_status: 'active' }), 'refused', 'an account Stripe has disabled charges on is refused whatever the capability says');
eq(why({ stripe_account_id: null, account_type: 'standard', charges_enabled: true, card_payments_status: 'active' }), 'refused', 'no account id is no account');
eq(why({ stripe_account_id: '  ', account_type: 'standard', charges_enabled: true }), 'refused', 'whitespace is not an account id');
eq(why(null), 'refused', 'no row at all is refused');

// THE LIABILITY GATE. `charge_model` is a column somebody can write, and part
// 161 describes the owner writing it one coach at a time. Written onto an
// EXPRESS account it does not deliver what it says: the charge really would be
// created on the coach's ledger, and Repple would still be the party Stripe
// holds for the fraud, the dispute and any balance the coach cannot repay.
// Nothing would look wrong until a chargeback arrived, which is why this is
// asserted here rather than trusted to a comment.
eq(why({ stripe_account_id: ACCT, account_type: 'express', charges_enabled: true, card_payments_status: 'active' }), 'refused',
  'a legacy Express account may never take a direct charge, however its charge_model was written');
eq(why({ stripe_account_id: ACCT, account_type: 'custom', charges_enabled: true, card_payments_status: 'active' }), 'refused', 'nor may a Custom account');
eq(why({ stripe_account_id: ACCT, account_type: 'none', charges_enabled: true, card_payments_status: 'active' }), 'refused', 'nor may an account whose type Stripe does not name');
eq(why({ stripe_account_id: ACCT, account_type: null, charges_enabled: true, card_payments_status: 'active' }), 'refused',
  'nor may an account nobody has asked Stripe about — a row that is both direct and untyped was edited by hand');
eq(why({ stripe_account_id: ACCT, charges_enabled: true, card_payments_status: 'active' }), 'refused', 'nor may a row with no type column at all');

// A refusal says something the coach can act on, rather than shrugging.
const pending = canTakeDirectCharges({ ...STD, charges_enabled: true, card_payments_status: 'pending' });
ok(!pending.ok && /verif/i.test(pending.reason), 'a capability refusal tells the reader what is missing');
const wrongKind = canTakeDirectCharges({ stripe_account_id: ACCT, account_type: 'express', charges_enabled: true, card_payments_status: 'active' });
ok(!wrongKind.ok && /nothing has been charged/i.test(wrongKind.reason), 'a mismatch refusal says plainly that no money moved');

// ── mutation check ──────────────────────────────────────────────────────────
//
// Each block below is a WRONG version of a rule above. If any of them would
// satisfy the assertions in this file, the assertions are not doing their job.
{
  // Wrong: default to direct charges when the column is absent.
  const wrong = (a: { charge_model?: string | null } | null | undefined) => (a?.charge_model === 'destination' ? 'destination' : 'direct');
  ok(wrong(null) !== modelForAccount(null), 'defaulting an unknown account to direct charges must fail this file');
  ok(wrong({}) !== modelForAccount({}), 'defaulting a column-less row to direct charges must fail this file');
}
{
  // Wrong: send a zero fee instead of omitting the field.
  const wrong = (price: number, pct: number) => Math.round((price * pct) / 100);
  ok(wrong(4, 10) !== (feeOf(4, 10) as number | null), 'sending a zero application fee must fail this file');
  ok(wrong(10000, 0) !== (feeOf(10000, 0) as number | null), 'sending a zero fee for a zero percent must fail this file');
}
{
  // Wrong: clamp an over-large fee to fit instead of refusing it.
  const wrong = (price: number, pct: number) => Math.min(Math.round((price * pct) / 100), price - 1);
  ok(String(wrong(1, 99)) !== String(feeOf(1, 99)), 'clamping a fee that exceeds the charge must fail this file');
}
{
  // Wrong: the original unchecked percent parse.
  const wrong = (raw: string | undefined) => Number(raw ?? '10');
  ok(!Object.is(wrong('ten'), pctOf('ten')), 'letting NaN through as a percent must fail this file');
  ok(!Object.is(wrong('150'), pctOf('150')), 'letting a percent over 100 through must fail this file');
}
{
  // Wrong: ask the coach's CURRENT model which account an old object is on.
  const wrong = (_row: { stripe_account_id?: string | null }, coach: { charge_model?: string | null }) =>
    coach.charge_model === 'direct' ? ACCT : null;
  ok(wrong({ stripe_account_id: null }, { charge_model: 'direct' }) !== accountForObject({ stripe_account_id: null }),
    'resolving an old subscription through the coach’s new model must fail this file');
}
{
  // Wrong: refuse an account whose capability status has not been recorded yet.
  const wrong = (a: { card_payments_status?: string | null }) => (a.card_payments_status === 'active' ? 'ok' : 'refused');
  ok(wrong({ card_payments_status: null }) !== why({ ...STD, charges_enabled: true, card_payments_status: null }),
    'refusing every account that predates the capability column must fail this file');
}
{
  // Wrong: trust `charge_model` alone and let any account take a direct charge.
  // This is the shape the file had before the owner moved to Standard accounts,
  // and it is the one that puts Repple back on the hook without saying so.
  const wrong = (a: { charges_enabled?: boolean }) => (a.charges_enabled ? 'ok' : 'refused');
  ok(wrong({ charges_enabled: true }) !== why({ stripe_account_id: ACCT, account_type: 'express', charges_enabled: true }),
    'letting a legacy Express account take a direct charge must fail this file');
}
{
  // Wrong: fall back to the platform carrying losses when the secret is unset
  // or mistyped. That was the default until the owner chose Standard accounts,
  // and keeping it would onboard new coaches onto accounts nobody can convert.
  const wrong = (raw: string | null | undefined) => ((typeof raw === 'string' ? raw.trim().toLowerCase() : '') === 'coach' ? 'coach' : 'platform');
  ok(wrong(undefined) !== liabilityFrom(undefined), 'defaulting an unset secret to the platform must fail this file');
  ok(wrong('platfrom') !== liabilityFrom('platfrom'), 'defaulting a typo to the platform must fail this file');
}
{
  // Wrong: let the account type and the charge model be chosen separately.
  // Stripe supports "Direct only" on Standard, so a Standard account marked
  // destination cannot sell at all — and an Express account marked direct is
  // the liability half-measure.
  const wrongModel = (l: 'coach' | 'platform') => (l === 'coach' ? 'destination' : 'direct');
  ok(wrongModel('coach') !== chargeModelFor('coach'), 'selling a Standard account under destination charges must fail this file');
  ok(wrongModel('platform') !== chargeModelFor('platform'), 'selling an Express account under direct charges must fail this file');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('directCharges: ok');
