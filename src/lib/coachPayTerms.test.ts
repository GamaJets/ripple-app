// What a coach is told about their own pay. Compile with tsc, run with node.
//
// The assertions this file exists for are the two empty answers. A coach with
// no gym must get a SENTENCE, never a blank card that reads as a rate of zero;
// and a failed read must never resolve to "nobody has set a rate for you",
// which is a statement about somebody's employment made from a timeout.
// Everything else here is the three-layer rule in src/lib/gymPay.ts told
// forwards to the person being paid.
import {
  rateCard, sessionRateLabel, classRateLabel, classPayLabel, standingNote,
  policyView, policyDetail,
  NO_GYM_PAY_NOTE, PAY_TERMS_UNREAD_NOTE, RATE_UNSTATED_NOTE, NO_AGREED_RATE_NOTE,
  type AgreedPay, type StandingFee,
} from './coachPayTerms';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NO_FEE: StandingFee = { fee: null, currency: null };
const GYM_FEE: StandingFee = { fee: 75, currency: 'GBP' };

const pay = (p: Partial<AgreedPay> = {}): AgreedPay => ({
  sessionRateCents: null, classPayKind: null, classRateCents: null,
  currency: null, updatedAt: null, ...p,
});

/* ── the read that did not come back ───────────────────────────────────────
 *
 * First, because every other assertion below is only safe once this one holds.
 */

eq(rateCard('gym', pay({ sessionRateCents: 4000, currency: 'GBP' }), 'error', GYM_FEE).kind, 'unread',
  'a failed read states nothing about a rate, even holding a row from before it');
eq(rateCard('gym', null, 'loading', GYM_FEE).kind, 'unread',
  'and neither does one still in flight');
eq(rateCard('gym', null, 'partial', GYM_FEE).kind, 'unread',
  'a prefix is not a pay agreement — isWhole, not !== error');
eq(rateCard('unknown', null, 'ready', GYM_FEE).kind, 'unread',
  'a gym we could not establish is not a gym that is absent');
eq(policyView('unknown', 'ready', 'no_shows').kind, 'unread',
  'and the same for the policy');
eq(policyView('gym', 'error', 'no_shows').kind, 'unread',
  'a refused tenant read does not publish the last policy we happened to hold');

/* ── the coach with no gym, which is most of them ──────────────────────── */

eq(rateCard('none', null, 'ready', NO_FEE).kind, 'no_gym',
  'no gym is an answer, not an empty rate card');
eq(policyView('none', 'ready', null).kind, 'no_gym',
  'and there is no pay policy where there is nobody to set one');
ok(NO_GYM_PAY_NOTE.includes('no gym attached to this account'),
  'and it is said in words rather than implied by a blank');
ok(!NO_GYM_PAY_NOTE.includes('ask your gym'),
  'and never sends a coach who works for themselves to an owner who does not exist');
ok(NO_GYM_PAY_NOTE.includes('no pay policy to be on'),
  'and the policy half is answered in the same sentence rather than repeated underneath it');
ok(policyDetail(policyView('none', 'ready', null)).includes('no gym attached'),
  'the policy line says the same thing rather than printing a default policy');

// A gym could be attached and still have a currency; nothing about the no-gym
// answer may depend on the fee, because there is no fee to depend on.
eq(rateCard('none', pay({ sessionRateCents: 4000, currency: 'GBP' }), 'ready', GYM_FEE).kind, 'no_gym',
  'no gym wins over a stale row, which cannot belong to a gym there is none of');

/* ── a gym that has set nothing for this coach ─────────────────────────── */

{
  const c = rateCard('gym', null, 'ready', GYM_FEE);
  eq(c.kind, 'unset', 'no row is "nobody has agreed a rate", not a rate of nothing');
  ok(c.kind === 'unset' && c.standing.fee === 75, 'and it carries what a session IS priced at');
}

// The row exists, with a currency on it, and no amounts. Part 183 allows that
// exactly — it is a coach the gym has not priced yet — and it must read the
// same as no row at all rather than as a rate of zero in that currency.
eq(rateCard('gym', pay({ currency: 'GBP' }), 'ready', GYM_FEE).kind, 'unset',
  'an empty row is an unpriced coach, not a priced one');

ok(NO_AGREED_RATE_NOTE.includes('not something you can enter'),
  'and the coach is not sent at a control only their gym has');

ok(standingNote(GYM_FEE).includes('GBP'),
  'the standing fee is named in the gym’s own money');
ok(standingNote(GYM_FEE).includes('never rewrites'),
  'and says a change does not reach a session already marked');
ok(standingNote(NO_FEE).includes('UNPRICED'),
  'no fee at any layer is unpriced and says so');
ok(!standingNote(NO_FEE).includes(' 0'),
  'and never anywhere near a zero');
ok(standingNote({ fee: 75, currency: null }).includes('no amount to show'),
  'a fee with no currency is withheld rather than printed bare');

/* ── an agreed rate ────────────────────────────────────────────────────── */

{
  const c = rateCard('gym', pay({
    sessionRateCents: 4000, classPayKind: 'per_attendee', classRateCents: 800,
    currency: 'GBP', updatedAt: '2026-03-04T09:00:00Z',
  }), 'ready', GYM_FEE);
  eq(c.kind, 'agreed', 'a priced coach has an agreed card');
  eq(sessionRateLabel(c), 'GBP 40.00', 'and the session rate is minor units in its own currency');
  eq(classRateLabel(c), 'GBP 8.00', 'and so is the class rate');
  eq(classPayLabel(c), 'An amount for each person who turned up',
    'and the class rate is never an amount on its own — per head and per class are different money');
  ok(c.kind === 'agreed' && c.setOn === '2026-03-04T09:00:00Z',
    'and the date it was set comes with it, or a coach cannot tell it from the one they were quoted years ago');
}

// The currency is the ROW's, never the gym's. A gym that has changed currency
// must not re-denominate what it agreed to pay somebody.
eq(sessionRateLabel(rateCard('gym', pay({ sessionRateCents: 600000, currency: 'JPY' }), 'ready', GYM_FEE)),
  'JPY 600,000',
  'a zero-decimal currency is not divided by a hundred');
eq(sessionRateLabel(rateCard('gym', pay({ sessionRateCents: 40000, currency: 'KWD' }), 'ready', GYM_FEE)),
  'KWD 40.000',
  'and a three-decimal one is not divided by a hundred either');

{
  // Classes priced, one-to-ones not. Common, and the half that is not set still
  // falls back to the gym's fee — so the card carries it.
  const c = rateCard('gym', pay({ classPayKind: 'per_class', classRateCents: 8000, currency: 'GBP' }), 'ready', GYM_FEE);
  eq(c.kind, 'agreed', 'a class-only rate is still an agreed rate');
  eq(sessionRateLabel(c), null, 'with no session amount to print');
  eq(classRateLabel(c), 'GBP 80.00', 'and the class amount printed');
  ok(c.kind === 'agreed' && c.standing.fee === 75, 'and the fallback for the half nobody set');
}

/* ── an amount with no money to state it in ────────────────────────────── */

eq(rateCard('gym', pay({ sessionRateCents: 4000, currency: null }), 'ready', GYM_FEE).kind, 'unstated',
  'an amount whose currency nobody recorded has no figure to print');
eq(sessionRateLabel(rateCard('gym', pay({ sessionRateCents: 4000, currency: null }), 'ready', GYM_FEE)), null,
  'and it is withheld rather than labelled with the gym’s currency');
ok(RATE_UNSTATED_NOTE.includes('will not put a currency on a figure nobody chose'),
  'and the reason is the reason, not a prompt to go and fix something');

eq(rateCard('gym', pay({ sessionRateCents: 4000, currency: '  gbp ' }), 'ready', GYM_FEE).kind, 'agreed',
  'a code is trimmed and folded, so one currency spelled two ways is one currency');

/* ── which outcomes the gym pays for ───────────────────────────────────── */

eq(policyView('gym', 'ready', null).kind, 'unset',
  'a gym that has not decided has not decided — never delivered_only by default');
eq(policyView('gym', 'ready', 'quarterly_vibes').kind, 'unset',
  'and a value this build does not know is not one of the four');

{
  const v = policyView('gym', 'ready', 'no_shows_and_late_cancellations');
  eq(v.kind, 'stated', 'a stored policy is stated');
  eq(v.kind === 'stated' ? v.label : null,
    'Delivered sessions, no-shows and late cancellations',
    'in the same words the owner’s own screen uses');
  const d = policyDetail(v);
  ok(d.includes('A no-show is paid'), 'and the no-show is answered');
  ok(d.includes('late cancellation is paid'), 'and the late cancellation is answered');
}

{
  const d = policyDetail(policyView('gym', 'ready', 'delivered_only'));
  ok(d.includes('A no-show is not paid') && d.includes('late cancellation is not paid'),
    'delivered-only answers both the other way');
}

{
  const d = policyDetail(policyView('gym', 'ready', 'no_shows'));
  ok(d.includes('A no-show is paid'), 'no_shows pays the no-show');
  ok(d.includes('late cancellation is not paid'), 'and not the late cancellation');
}

{
  const d = policyDetail(policyView('gym', 'ready', 'late_cancellations'));
  ok(d.includes('A no-show is not paid'), 'late_cancellations does not pay the no-show');
  ok(d.includes('late cancellation is paid'), 'and does pay the late cancellation');
}

// The one answer that is the same under all four, and the reason it is here.
for (const code of ['delivered_only', 'no_shows', 'late_cancellations', 'no_shows_and_late_cancellations']) {
  ok(policyDetail(policyView('gym', 'ready', code)).includes('never paid under any policy'),
    `an unmarked session is unpaid under ${code} because nobody recorded what happened`);
}

ok(policyDetail(policyView('gym', 'ready', null)).includes('has not said what it pays for'),
  'and the unset case quotes the one wording the owner app already uses for it');
ok(policyDetail(policyView('gym', 'error', null)) === PAY_TERMS_UNREAD_NOTE,
  'a failed read gets the failed-read sentence and no policy at all');

if (errors.length) { for (const e of errors) console.error('FAIL', e); process.exit(1); }
console.log('coachPayTerms: ok');
