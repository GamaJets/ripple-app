// The rent, typed out again every month.
//
// ── The seven this file exists to stop ────────────────────────────────────
//
//   1. A TEMPLATE THAT BECOMES A COST. `carryForward` is the whole of "carry
//      this forward" and it must return TEXT FOR A FORM and nothing else — no
//      row, no write, and no date the template did not state. A template that
//      silently posts writes money that never left the gym's account into a
//      ledger whose only remaining job is to be true, under a month that will
//      later be locked. Asserted as the shape of the return: where the template
//      names no day of the month, `paidOn` is null and the form keeps whatever
//      the owner already had.
//
//   2. A DATE READ AS AN INSTANT. `starts_on` and `ends_on` are DATE columns.
//      `new Date('2026-08-01')` is midnight UTC and therefore JULY west of
//      Greenwich, so a lease beginning on the first of the month would be
//      judged not to have begun for half the world — and the template for the
//      rent would silently stop being offered. `npm run test:zones` runs these
//      in six zones and they must answer identically in all of them.
//
//   3. A MINOR UNIT DIVIDED BY A HUNDRED. A ¥450,000 rent template read back as
//      `cents / 100` fills the amount box with 4,500 — and the owner presses
//      Record on it, because a template's whole promise is that the figure is
//      already right. A Kuwaiti template goes wrong in the other direction.
//
//   4. TWO CURRENCIES IN ONE BOX. A template holding EUR 900 against a gym that
//      records in GBP must leave the amount EMPTY and name both currencies.
//      Filling in "900" is nine hundred pounds, from a number that was euros,
//      through an exchange rate this product does not have.
//
//   5. A CLAIM MADE OVER A READ THAT DID NOT COME BACK WHOLE. A truncated month
//      makes every cost past the cap look missing, so "the landlord is not in
//      August" would be a false accusation built out of paging — on the screen
//      an owner closes the month from. 'partial' must answer 'unknown'.
//
//   6. A SUPPLIER THE GYM CANCELLED, OFFERED BACK FOREVER. An ended template is
//      not due, and its supplier is not an untemplated standing line. Without
//      that, the insurer the gym deliberately dropped is suggested every month
//      for six months.
//
//   7. THE 31st OF A MONTH THAT HAS THIRTY DAYS. A direct debit on the 31st is
//      real. February is real. The suggestion must walk back to the last day of
//      the month — and the leap rule must be the full one, because 2100 is not
//      a leap year and a template for the 29th would fill in 1 March.
//
// Compile with tsc, run with node.
import {
  templateBlockers, suggestedDay, reviewTemplates, standingNote,
  carryForward, untemplatedStanding, templatesEmptyLine,
  TEMPLATES_NEVER_POST, CARRIED_IS_NOT_INCURRED, TEMPLATE_NEEDS_A_PAYEE,
  type CostTemplate, type CostTemplateDraft,
} from './recurringCosts';
import type { CostLine, StandingCost } from './closeCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const tpl = (over: Partial<CostTemplate> = {}): CostTemplate => ({
  id: 't1',
  description: 'Monthly rent',
  supplier: 'Ruoni Property Ltd',
  category: 'rent',
  amountCents: 250_000,
  currency: 'GBP',
  dueDay: 1,
  startsOn: '2026-01-01',
  endsOn: null,
  note: null,
  createdAt: null,
  ...over,
});

const cost = (over: Partial<CostLine> & { paidOn: string }): CostLine => ({
  supplier: 'Ruoni Property Ltd', category: 'rent',
  amountCents: 250_000, currency: 'GBP',
  ...over,
});

const draft = (over: Partial<CostTemplateDraft> = {}): CostTemplateDraft => ({
  description: 'Monthly rent',
  supplier: 'Ruoni Property Ltd',
  category: 'rent',
  amountText: '2500.00',
  currency: 'GBP',
  dueDayText: '1',
  startsOn: '2026-01-01',
  ...over,
});

/* ── 1. a template is filled in, never posted ───────────────────────────── */
{
  const filled = carryForward(tpl(), '2026-08', 'GBP');
  ok(filled.ok, 'a running template in the gym’s own currency fills the form');
  if (filled.ok) {
    eq(filled.filled.description, 'Monthly rent', 'the description is carried');
    eq(filled.filled.supplier, 'Ruoni Property Ltd', 'and the payee');
    eq(filled.filled.category, 'rent', 'and the category');
    eq(filled.filled.amountText, '2500.00', 'and the amount, as the box wants it');
    eq(filled.filled.paidOn, '2026-08-01', 'and the day, inside the month on screen');
    eq(filled.filled.withheld, null, 'with nothing withheld');
  }

  // The one that matters: a template that does not state a day must not hand
  // one over. A date nobody chose on a permanent ledger row is how a cost ends
  // up in the wrong month past a lock.
  const noDay = carryForward(tpl({ dueDay: null }), '2026-08', 'GBP');
  ok(noDay.ok, 'a template with no due day still fills the rest of the form');
  if (noDay.ok) {
    eq(noDay.filled.paidOn, null, 'but it offers no day at all — not the 1st');
    eq(noDay.filled.amountText, '2500.00', 'while still carrying what it does know');
  }

  // And the sentence that stops an owner assuming Repple did it for them.
  ok(/never|by itself|on its own/i.test(TEMPLATES_NEVER_POST),
     'the screen says out loud that nothing posts by itself');
  ok(TEMPLATES_NEVER_POST.length > 120, 'and says why, rather than asserting it');
  ok(/check it|actually charged/i.test(CARRIED_IS_NOT_INCURRED),
     'and the amount carries a sentence telling somebody to check it');
}

/* ── 2. a DATE is not an instant ────────────────────────────────────────── */
{
  // The first of the month is that month in every zone. Parsed as UTC it is the
  // previous month west of Greenwich, and the rent template stops appearing.
  const startsFirst = tpl({ startsOn: '2026-08-01' });
  const r = reviewTemplates([startsFirst], [], '2026-08', 'ready');
  eq(r[0].standing, 'due', 'a lease starting on the 1st is running that month, in every zone');

  const startsNext = tpl({ startsOn: '2026-09-01' });
  eq(reviewTemplates([startsNext], [], '2026-08', 'ready')[0].standing, 'not-yet',
     'and one starting the month after has not started');

  // The last day of a month is that month too, both ends.
  const endsLast = tpl({ endsOn: '2026-08-31' });
  eq(reviewTemplates([endsLast], [], '2026-08', 'ready')[0].standing, 'due',
     'an arrangement ending on the 31st was running in that month');
  eq(reviewTemplates([endsLast], [], '2026-09', 'ready')[0].standing, 'ended',
     'and is over by the next one');

  // Mid-month endings count for the whole month: the bill for the part-month is
  // real and somebody has to be able to record it.
  const endsMid = tpl({ endsOn: '2026-08-12' });
  eq(reviewTemplates([endsMid], [], '2026-08', 'ready')[0].standing, 'due',
     'an arrangement that ended on the 12th still has an August bill');

  // A year boundary, which is where a month key built by subtraction goes wrong.
  eq(reviewTemplates([tpl({ startsOn: '2027-01-01' })], [], '2026-12', 'ready')[0].standing,
     'not-yet', 'January is after December of the year before');
  eq(reviewTemplates([tpl({ endsOn: '2025-12-31' })], [], '2026-01', 'ready')[0].standing,
     'ended', 'and December is before the January after it');
}

/* ── 3. the factor is 1, 100 or 1000 — never a hundred ──────────────────── */
{
  // A ¥450,000 rent is stored as the integer 450000, because a yen has no sen.
  const yen = carryForward(tpl({ amountCents: 450_000, currency: 'JPY' }), '2026-08', 'JPY');
  ok(yen.ok, 'a yen template fills in');
  if (yen.ok) eq(yen.filled.amountText, '450000', 'and a yen is not divided by a hundred');

  // A Kuwaiti dinar has 1000 fils. 82505 fils is KWD 82.505, not 825.05.
  const kwd = carryForward(tpl({ amountCents: 82_505, currency: 'KWD' }), '2026-08', 'KWD');
  ok(kwd.ok, 'a dinar template fills in');
  if (kwd.ok) eq(kwd.filled.amountText, '82.505', 'and a dinar keeps its third place');

  // And the ordinary case, to prove the above are not a special path.
  const gbp = carryForward(tpl({ amountCents: 4_999 }), '2026-08', 'GBP');
  if (gbp.ok) eq(gbp.filled.amountText, '49.99', 'a hundredth currency reads back exactly');
}

/* ── 4. two currencies are never one box ────────────────────────────────── */
{
  const euro = carryForward(tpl({ amountCents: 90_000, currency: 'EUR' }), '2026-08', 'GBP');
  ok(euro.ok, 'a euro template against a pound gym still fills in the words');
  if (euro.ok) {
    eq(euro.filled.amountText, '', 'but the amount box is left EMPTY rather than converted');
    eq(euro.filled.description, 'Monthly rent', 'while the description is still carried');
    ok(euro.filled.withheld != null, 'and the refusal is stated rather than silent');
    ok(/EUR/.test(String(euro.filled.withheld)), 'naming the currency it came from');
    ok(/GBP/.test(String(euro.filled.withheld)), 'and the one it would have to be in');
  }

  // A gym with no currency at all cannot read any amount, and says so.
  const noCcy = carryForward(tpl(), '2026-08', null);
  ok(noCcy.ok, 'a gym with no currency can still have the words filled in');
  if (noCcy.ok) {
    eq(noCcy.filled.amountText, '', 'with no amount');
    ok(/currency/i.test(String(noCcy.filled.withheld)), 'and the reason names the currency');
  }

  // A template that holds no amount is not a failure and gets no warning: most
  // utility arrangements are "this supplier, every month, a different number".
  const varies = carryForward(tpl({ amountCents: null, currency: null }), '2026-08', 'GBP');
  ok(varies.ok, 'a template with no usual amount fills in');
  if (varies.ok) {
    eq(varies.filled.amountText, '', 'leaving the amount blank');
    eq(varies.filled.withheld, null, 'and saying nothing, because nothing was withheld');
  }
}

/* ── 5. a partial read claims nothing ───────────────────────────────────── */
{
  const t = [tpl()];
  eq(reviewTemplates(t, [], '2026-08', 'partial')[0].standing, 'unknown',
     'a truncated month cannot say the landlord is missing');
  eq(reviewTemplates(t, [], '2026-08', 'error')[0].standing, 'unknown',
     'nor can a refused one');
  eq(reviewTemplates(t, [], '2026-08', 'loading')[0].standing, 'unknown',
     'nor can one still in flight');
  eq(reviewTemplates(t, [], '2026-08', 'ready')[0].standing, 'due',
     'and a whole read that found nothing says so');

  // Even where rows ARE present, a partial read must not be used to say
  // "recorded" — the rows it holds are a prefix and prove nothing about the
  // rest, so the honest answer stays 'unknown' in both directions.
  const withRow = reviewTemplates(t, [cost({ paidOn: '2026-08-01' })], '2026-08', 'partial');
  eq(withRow[0].standing, 'unknown', 'a prefix does not become a verdict in either direction');

  ok(/unknown/i.test(standingNote(withRow[0], 'August')),
     'and the sentence beside it says unknown rather than no');
  ok(/could not be read/.test(templatesEmptyLine('error')),
     'an empty list over a failed read says the read failed');
  ok(!/could not be read/.test(templatesEmptyLine('ready')),
     'and over a good one it does not');
}

/* ── 6. recorded, due, and the supplier spelled differently ─────────────── */
{
  const t = [tpl()];
  const done = reviewTemplates(t, [cost({ paidOn: '2026-08-01' })], '2026-08', 'ready');
  eq(done[0].standing, 'recorded', 'a matching cost in the month marks it recorded');
  eq(done[0].matched, 1, 'and counts it');

  // The same key the close screen matches on, so the two screens cannot
  // disagree about whether this is the same line.
  const sloppy = reviewTemplates(
    t, [cost({ paidOn: '2026-08-01', supplier: '  ruoni  PROPERTY   ltd ' })], '2026-08', 'ready');
  eq(sloppy[0].standing, 'recorded', 'case and spacing are one supplier, not two');

  // A different payee in the same category is a different arrangement.
  const other = reviewTemplates(
    t, [cost({ paidOn: '2026-08-01', supplier: 'Someone Else Ltd' })], '2026-08', 'ready');
  eq(other[0].standing, 'due', 'another landlord is not this landlord');

  // A cost outside the month must not mark the month recorded. A caller passing
  // a wider window would otherwise close August with no rent in it.
  const july = reviewTemplates(t, [cost({ paidOn: '2026-07-01' })], '2026-08', 'ready');
  eq(july[0].standing, 'due', 'July’s rent is not August’s');

  // Twice in a month is not an error and is not hidden.
  const twice = reviewTemplates(
    t, [cost({ paidOn: '2026-08-01' }), cost({ paidOn: '2026-08-28' })], '2026-08', 'ready');
  eq(twice[0].matched, 2, 'two payments to one supplier are counted as two');
  ok(/2 costs/.test(standingNote(twice[0], 'August')), 'and the sentence says two');

  // A template with no payee cannot be judged either way, and says so rather
  // than sitting in the list as permanently due.
  const anon = reviewTemplates([tpl({ supplier: null })], [], '2026-08', 'ready');
  eq(anon[0].standing, 'unmatchable', 'no payee is not "due"');
  ok(/payee/.test(standingNote(anon[0], 'August')), 'and the sentence says what to fix');
}

/* ── 6b. an ended arrangement is not offered back ───────────────────────── */
{
  const ended = tpl({ id: 't-ins', supplier: 'Grantley Brokers', category: 'insurance', endsOn: '2026-06-30' });
  const r = reviewTemplates([ended], [], '2026-08', 'ready');
  eq(r[0].standing, 'ended', 'a cancelled arrangement is not due in August');
  ok(/ended/.test(standingNote(r[0], 'August')), 'and the sentence says it ended');

  // Carrying it forward into a month it did not run in is refused outright,
  // with the date it ended named — the owner can still type the cost by hand if
  // the gym really did pay it, and the template is not the record of that.
  const carried = carryForward(ended, '2026-08', 'GBP');
  eq(carried.ok, false, 'and it cannot be carried into a month it did not run in');
  if (!carried.ok) ok(/2026-06-30/.test(carried.why), 'the refusal names the day it ended');

  const early = carryForward(tpl({ startsOn: '2026-09-01' }), '2026-08', 'GBP');
  eq(early.ok, false, 'nor can one be carried into a month before it started');
  if (!early.ok) ok(/2026-09-01/.test(early.why), 'and that refusal names the start');

  // The history detector must not offer a supplier the gym deliberately
  // stopped. An ENDED template still counts as having one.
  const standing: StandingCost[] = [
    { key: 'insurance\u0000grantley brokers', supplier: 'Grantley Brokers', category: 'insurance',
      monthsSeen: 4, lookback: 6, lastSeen: '2026-06', usual: null },
    { key: 'utilities\u0000dunmarrow power', supplier: 'Dunmarrow Power', category: 'utilities',
      monthsSeen: 5, lookback: 6, lastSeen: '2026-07', usual: { cents: 41_200, currency: 'GBP' } },
  ];
  const offered = untemplatedStanding(standing, [ended]);
  eq(offered.length, 1, 'the ended insurer is not offered back');
  eq(offered[0].supplier, 'Dunmarrow Power', 'and the one with no template at all is');
  eq(untemplatedStanding(standing, []).length, 2, 'with no templates, both are offered');
  eq(untemplatedStanding([], [ended]).length, 0, 'and with no history there is nothing to offer');
}

/* ── 7. the 31st of a thirty-day month ──────────────────────────────────── */
{
  eq(suggestedDay(tpl({ dueDay: 31 }), '2026-01'), '2026-01-31', 'the 31st exists in January');
  eq(suggestedDay(tpl({ dueDay: 31 }), '2026-04'), '2026-04-30', 'and is the 30th in April');
  eq(suggestedDay(tpl({ dueDay: 31 }), '2026-02'), '2026-02-28', 'and the 28th in a plain February');
  eq(suggestedDay(tpl({ dueDay: 29 }), '2028-02'), '2028-02-29', 'a leap year has a 29th');
  eq(suggestedDay(tpl({ dueDay: 29 }), '2027-02'), '2027-02-28', 'and the year before does not');
  // The full rule, not `% 4`. A template for the 29th in a century that is not a
  // leap year must not be filled in as 1 March.
  eq(suggestedDay(tpl({ dueDay: 29 }), '2100-02'), '2100-02-28', '2100 is not a leap year');
  eq(suggestedDay(tpl({ dueDay: 29 }), '2000-02'), '2000-02-29', 'and 2000 was');

  eq(suggestedDay(tpl({ dueDay: 5 }), '2026-08'), '2026-08-05', 'a single digit day is padded');
  eq(suggestedDay(tpl({ dueDay: null }), '2026-08'), null, 'no stated day offers no day');
  eq(suggestedDay(tpl({ dueDay: 0 }), '2026-08'), null, 'a zero is not a day of the month');
  eq(suggestedDay(tpl({ dueDay: 32 }), '2026-08'), null, 'and neither is a 32');
  eq(suggestedDay(tpl({ dueDay: 1 }), '2026-13'), null, 'there is no thirteenth month');
  eq(suggestedDay(tpl({ dueDay: 1 }), 'not-a-month'), null, 'and a non-month is answered, not thrown at');

  eq(carryForward(tpl(), 'nonsense', 'GBP').ok, false, 'nor can a non-month be filled in for');
}

/* ── what the form refuses ──────────────────────────────────────────────── */
{
  eq(templateBlockers(draft()).length, 0, 'a complete draft has nothing wrong with it');

  ok(templateBlockers(draft({ description: '   ' })).some((b) => /what this is for/i.test(b)),
     'a template with no description is refused');

  // Required here, optional on the cost form one section above, and the
  // difference is the whole reason a template can be checked at all.
  const noPayee = templateBlockers(draft({ supplier: '' }));
  ok(noPayee.includes(TEMPLATE_NEEDS_A_PAYEE), 'a template with no payee is refused, in the words the screen uses');

  // Blank is a real answer and the commonest one.
  eq(templateBlockers(draft({ amountText: '' })).length, 0, 'a bill that varies needs no amount');
  eq(templateBlockers(draft({ amountText: '', currency: null })).length, 0,
     'and a gym with no currency can still set one up, without an amount');

  ok(templateBlockers(draft({ currency: null })).some((b) => /currency/i.test(b)),
     'but an amount with no currency to read it in is refused');
  ok(templateBlockers(draft({ amountText: '0' })).some((b) => /not an amount/i.test(b)),
     'a usual amount of nothing is refused, and told what blank means');
  ok(templateBlockers(draft({ amountText: '12.5' , currency: 'JPY' })).length > 0,
     'a yen with a decimal place is refused by the currency’s own reader');
  ok(templateBlockers(draft({ amountText: '1,234.50' })).length > 0,
     'and a thousands separator is refused rather than guessed at');

  ok(templateBlockers(draft({ dueDayText: '0' })).some((b) => /1 to 31/.test(b)),
     'a due day of 0 is refused');
  ok(templateBlockers(draft({ dueDayText: '32' })).some((b) => /1 to 31/.test(b)),
     'and so is 32');
  eq(templateBlockers(draft({ dueDayText: '' })).length, 0, 'and blank is fine');
  eq(templateBlockers(draft({ dueDayText: '31' })).length, 0, 'and the 31st is a real direct-debit date');

  ok(templateBlockers(draft({ startsOn: '' })).some((b) => /started/i.test(b)),
     'a template with no start day is refused');
  ok(templateBlockers(draft({ category: 'not-a-category' as never })).some((b) => /kind of cost/i.test(b)),
     'and a category the cost table would refuse is caught here rather than at the insert');

  // All at once, not the first one: somebody who left three boxes empty should
  // not have to press the button three times.
  ok(templateBlockers(draft({ description: '', supplier: '', startsOn: '' })).length >= 3,
     'every reason is listed at once');
}

/* ── a category a newer build wrote ─────────────────────────────────────── */
{
  // The words and the payee are still right, so the owner re-picks one box
  // instead of retyping five. Refusing outright would make an unknown category
  // lose the whole template.
  const odd = carryForward(tpl({ category: 'zeppelin-hire' }), '2026-08', 'GBP');
  ok(odd.ok, 'a category this build does not know still fills the form in');
  if (odd.ok) {
    eq(odd.filled.category, 'other', 'falling back to the escape hatch');
    eq(odd.filled.description, 'Monthly rent', 'with everything else intact');
  }
}

if (errors.length) {
  console.error(`recurringCosts: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('recurringCosts: ok');
