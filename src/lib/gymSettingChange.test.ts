// The questions asked before a gym's settings move.
// Compile with tsc, run with node.
//
// The defect: studio-web/app/settings/page.tsx asked before changing the
// currency and the timezone, and asked nothing at all before changing the two
// settings either side of them — the pay policy and the session fee — which
// reach just as far backwards. `GymProfilePatch` in ./gymPolicy.ts says of the
// policy, in as many words, that it changes what is payable "INCLUDING for
// months already worked but not yet settled"; `rateForSession` in ./gymPay.ts
// prices any session with no snapshot and no coach rate at whatever the fee
// says AT THE MOMENT THE FIGURE IS READ. Both were one press of Save.
//
//   THE FOUR       every backward-reaching setting is asked about
//   FIRST SET      a value nobody has ever set is never confirmed
//   UNREADABLE     a stored policy this build cannot read is a first set
//   THE MONEY      a fee is never named without the money it is in
//   ONE EACH       two consequences are two questions, never one dialog
//   NO CHANGE      pressing Save over an untouched form asks nothing
import { consequences, storedPolicy, type GymSettingsNow, type GymSettingsNext } from './gymSettingChange';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A gym that has set all six. */
const set: GymSettingsNow = {
  currency: 'GBP',
  sessionFee: 40,
  payPolicy: 'delivered_only',
  timezone: 'Europe/London',
};

/** A gym that has set none of them — a new project, on its first visit here. */
const unset: GymSettingsNow = {
  currency: null, sessionFee: null, payPolicy: null, timezone: null,
};

/** The form, seeded from a row and untouched. */
const same = (now: GymSettingsNow): GymSettingsNext => ({
  currency: now.currency ? { kind: 'currency', currency: now.currency } : { kind: 'clear' },
  fee: now.sessionFee != null ? { kind: 'fee', fee: now.sessionFee } : { kind: 'clear' },
  policy: (now.payPolicy ?? '') as GymSettingsNext['policy'],
  zone: now.timezone ? { kind: 'zone', zone: now.timezone } : { kind: 'clear' },
});

const next = (now: GymSettingsNow, over: Partial<GymSettingsNext>): GymSettingsNext =>
  ({ ...same(now), ...over });

/* ── NO CHANGE ────────────────────────────────────────────────────────────
 * The commonest press of Save on this screen changes the gym's NAME. Every
 * question below has to stay out of that one's way, or the person who renames
 * their gym learns to click through four dialogs and stops reading them.
 */
{
  eq(consequences(set, same(set)).length, 0, 'an untouched form asks nothing');
  eq(consequences(unset, same(unset)).length, 0, 'and neither does an empty one');
}

/* ── THE FOUR ─────────────────────────────────────────────────────────────
 * Each of the backward-reaching settings, changed on its own.
 */
{
  const ccy = consequences(set, next(set, { currency: { kind: 'currency', currency: 'EUR' } }));
  eq(ccy.length, 1, 'a currency change asks one question');
  ok(ccy[0].includes('GBP') && ccy[0].includes('EUR'), 'naming both codes');
  ok(ccy[0].includes('withheld'), 'and what becomes of a total that spans the two');

  const zone = consequences(set, next(set, { zone: { kind: 'zone', zone: 'Asia/Dubai' } }));
  eq(zone.length, 1, 'a timezone change asks one question');
  ok(zone[0].includes('Europe/London') && zone[0].includes('Asia/Dubai'), 'naming both zones');
  ok(zone[0].includes('already reconciled'), 'and that a reconciled week may move');

  const pol = consequences(set, next(set, { policy: 'no_shows' }));
  eq(pol.length, 1, 'a pay-policy change asks one question');
  ok(pol[0].includes('not yet settled'),
    'and says the part nothing on the screen said: it reaches months already worked');
  ok(pol[0].includes('Only sessions that were delivered')
     && pol[0].includes('Delivered sessions and no-shows'),
    'in the words the picker uses, not the stored codes');
  ok(!pol[0].includes('no_shows'), 'never the code itself — an owner has never seen it');

  const fee = consequences(set, next(set, { fee: { kind: 'fee', fee: 45 } }));
  eq(fee.length, 1, 'a session-fee change asks one question');
  ok(fee[0].includes('not yet settled'),
    'and says that a month already worked will be worth a different amount');
  ok(fee[0].includes('keeps that price'),
    'while naming what it CANNOT touch — a session priced when it was marked');
}

/* ── FIRST SET ────────────────────────────────────────────────────────────
 * The rule the whole module turns on. A gym setting a value for the first time
 * has no ledger to split, no reconciled week to move, no month worked against
 * an old policy and no session priced at an old fee. Confirming the only value
 * somebody has ever had is how a dialog becomes a thing people click through.
 */
{
  const first = consequences(unset, {
    currency: { kind: 'currency', currency: 'GBP' },
    fee: { kind: 'fee', fee: 40 },
    policy: 'no_shows',
    zone: { kind: 'zone', zone: 'Europe/London' },
  });
  eq(first.length, 0, 'setting all four for the first time asks nothing at all');

  // And one at a time, against a gym that has the other three.
  eq(consequences({ ...set, currency: null }, next(set, { currency: { kind: 'currency', currency: 'GBP' } }))
    .filter((q) => q.includes('currency')).length, 0, 'a first currency is not a change');
  eq(consequences({ ...set, sessionFee: null }, next(set, { fee: { kind: 'fee', fee: 40 } }))
    .filter((q) => q.includes('session fee')).length, 0, 'a first fee is not a change');
  eq(consequences({ ...set, timezone: null }, next(set, { zone: { kind: 'zone', zone: 'Europe/London' } }))
    .filter((q) => q.includes('timezone')).length, 0, 'a first timezone is not a change');
  eq(consequences({ ...set, payPolicy: null }, next(set, { policy: 'no_shows' })).length, 0,
    'a first pay policy is not a change');
}

/* ── CLEARING ─────────────────────────────────────────────────────────────
 * The other direction, which is not the same sentence: an emptied setting is a
 * state every screen knows how to render, and each of them renders it
 * differently.
 */
{
  const cleared = consequences(set, {
    currency: { kind: 'clear' }, fee: { kind: 'clear' }, policy: '', zone: { kind: 'clear' },
  });
  eq(cleared.length, 4, 'clearing all four asks four questions');
  ok(cleared.some((q) => q.includes('cannot be priced')), 'the currency says what stops working');
  ok(cleared.some((q) => q.includes('no rate at all')),
    'the fee says payroll withholds rather than pricing a session at nothing');
  ok(cleared.some((q) => q.includes('whichever device is reading them')),
    'the zone says the dates go back to the reader, not blank');
  ok(cleared.some((q) => q.includes('withheld')), 'the policy says its figures are withheld');
  // Never asked of a gym that had nothing there to lose.
  eq(consequences(unset, { currency: { kind: 'clear' }, fee: { kind: 'clear' }, policy: '', zone: { kind: 'clear' } }).length,
    0, 'clearing what was already empty asks nothing');
}

/* ── UNREADABLE ───────────────────────────────────────────────────────────
 * A stored pay policy the constraint no longer permits is ALREADY being
 * treated as "not decided" by every dependent screen — those figures are
 * withheld rather than computed — so replacing it moves no figure backwards.
 * Asking about it would be asking somebody to confirm the loss of an answer
 * nothing was using.
 */
{
  const odd: GymSettingsNow = { ...set, payPolicy: 'pay_everything_always' };
  eq(storedPolicy(odd), null, 'a code this build cannot read is not a stored policy');
  eq(consequences(odd, next(odd, { policy: 'no_shows' })).length, 0,
    'so replacing it is a first set and asks nothing');
  eq(storedPolicy(set), 'delivered_only', 'a code it can read is');
}

/* ── THE MONEY ────────────────────────────────────────────────────────────
 * A session fee has no currency of its own: it is in whatever the gym charges
 * in. "40 to 45" in a dialog about payroll invites the reader to supply the
 * currency out of their own head, and a gym that has not set one is exactly the
 * gym whose reader would get it wrong.
 */
{
  const priced = consequences(set, next(set, { fee: { kind: 'fee', fee: 45 } }))[0];
  ok(priced.includes('GBP 40') && priced.includes('GBP 45'), 'the fee is named in the gym’s money');

  const noCcy: GymSettingsNow = { ...set, currency: null };
  const bare = consequences(noCcy, next(noCcy, { fee: { kind: 'fee', fee: 45 } }))[0];
  ok(bare.includes('in a currency this gym has not set'),
    'and where there is none the sentence says so rather than printing a bare number');
  ok(!/from 40 to 45/.test(bare), 'never a bare "from 40 to 45"');
}

/* ── ONE EACH ─────────────────────────────────────────────────────────────
 * Two consequences folded into one dialog is a dialog somebody agrees to for
 * the half they were thinking about. They are also asked in the order the
 * fields sit on the page, so the reader can follow their own form down.
 */
{
  const both = consequences(set, next(set, {
    currency: { kind: 'currency', currency: 'EUR' },
    fee: { kind: 'fee', fee: 45 },
    zone: { kind: 'zone', zone: 'Asia/Dubai' },
    policy: 'no_shows',
  }));
  eq(both.length, 4, 'four changes are four questions');
  ok(both[0].includes('currency') && both[1].includes('session fee')
     && both[2].includes('timezone') && both[3].includes('pays a coach for'),
    'in the order the fields are on the page');
}

/* ── A BAD FIELD ──────────────────────────────────────────────────────────
 * The form refuses to save at all while a field is unparseable, but the dialog
 * must not be built out of one either: a rejected value is not a value, and
 * "change the currency from GBP to undefined?" is the shape that would print.
 */
{
  eq(consequences(set, next(set, { currency: { kind: 'bad', reason: 'no' } })).length, 0,
    'an unparseable currency asks nothing');
  eq(consequences(set, next(set, { fee: { kind: 'bad', reason: 'no' } })).length, 0,
    'an unparseable fee asks nothing');
  eq(consequences(set, next(set, { zone: { kind: 'bad', reason: 'no' } })).length, 0,
    'an unparseable zone asks nothing');
}

if (errors.length) {
  console.error(`gymSettingChange: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('gymSettingChange: all assertions passed');
