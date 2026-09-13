// The register against the bank statement. Compile with tsc, run with node.
//
// The assertions that matter are the refusals. A reconciliation panel is read
// as a verdict — "my books match my bank" — so the two sentences it must never
// produce over an unknown are 'agrees' and a variance figure. Everything below
// is one of those two, approached from a different direction: a truncated read,
// a currency on one side only, a payment row that states no currency at all,
// and a subtraction across two moneys.
import {
  bankLines, unstatedTakings, bankedBlockers, bankLineNote,
  BANK_IS_TYPED_NOTE, BANK_DIFFERENCE_IS_ORDINARY, BANK_CHANGES_NOTHING_NOTE,
  type BankedMonth, type TakenLine, type BankLine,
} from './gymBanked';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const took = (currency: string | null, cents: number, count = 1): TakenLine => ({ currency, cents, count });

const banked = (currency: string, landedCents: number, o: Partial<BankedMonth> = {}): BankedMonth => ({
  id: `b-${currency}`,
  monthKey: '2026-08',
  currency,
  landedCents,
  statementRef: null,
  note: null,
  recordedBy: 'u1',
  recordedByName: 'Dana Okafor',
  recordedAt: '2026-09-05T09:00:00.000Z',
  updatedAt: null,
  ...o,
});

const by = (lines: BankLine[], currency: string): BankLine => {
  const hit = lines.find((l) => l.currency === currency);
  if (!hit) { errors.push(`no line for ${currency}`); throw new Error(currency); }
  return hit;
};

/* ── the ordinary case, and the one figure that is allowed to be computed ─── */
{
  const lines = bankLines([took('GBP', 420000, 14)], [banked('GBP', 408500)], true);
  eq(lines.length, 1, 'one currency, one line');
  const l = by(lines, 'GBP');
  eq(l.state, 'differs', 'a register of 4,200 against a bank of 4,085 differs');
  eq(l.deltaCents, -11500, 'the variance is landed − register, in minor units of this line’s own money');
  ok(/LESS than the register/.test(bankLineNote(l, () => '115.00')),
    'and is said in a direction rather than as a negative amount of money');

  const same = by(bankLines([took('GBP', 420000, 14)], [banked('GBP', 420000)], true), 'GBP');
  eq(same.state, 'agrees', 'an exact match agrees');
  eq(same.deltaCents, 0, 'and its variance is nought, which is a figure rather than an absence');

  const more = by(bankLines([took('GBP', 400000)], [banked('GBP', 410000)], true), 'GBP');
  ok(/MORE than the register/.test(bankLineNote(more, () => '100.00')),
    'a bank that received more says so — an acquirer settling last month’s tail is not a shortfall');
}

/* ── a truncated or failed read is never a match, and never a variance ─────── */
{
  /*
   * The single worst sentence this file could produce.
   *
   * `assertWhole` on the payments read is what stops a thousand-row prefix
   * being totalled, and a panel that compared a prefix against a real bank
   * statement would tell a busy gym its books were short by the tail of its own
   * month — or, worse, that they matched.
   */
  const lines = bankLines([took('GBP', 420000, 14)], [banked('GBP', 420000)], false);
  const l = by(lines, 'GBP');
  eq(l.state, 'register_unknown', 'a read that did not come back whole is unknown, not a match');
  eq(l.registerCents, null, 'the register figure is withheld rather than shown as a subtotal');
  eq(l.deltaCents, null, 'and no variance is offered against it');
  eq(l.landedCents, 420000, 'what the owner typed is still theirs and is still shown');
  ok(/unknown, not nil/i.test(bankLineNote(l, () => '')), 'and the sentence says which silence this is');
}

/* ── a currency on one side only is its own answer, not a variance ─────────── */
{
  const lines = bankLines(
    [took('GBP', 420000, 14), took('EUR', 60000, 4)],
    [banked('GBP', 420000)],
    true,
  );
  eq(lines.length, 2, 'two currencies are two lines');
  eq(by(lines, 'EUR').state, 'not_banked', 'a currency taken and not yet banked is unanswered');
  eq(by(lines, 'EUR').deltaCents, null,
    'and carries NO variance — a register figure against a bank figure nobody has given is not a shortfall');
  ok(/unreconciled rather than reconciled/i.test(bankLineNote(by(lines, 'EUR'), () => '')),
    'the sentence refuses to call an unanswered month reconciled');

  const other = bankLines([took('GBP', 420000, 14)], [banked('AED', 150000)], true);
  eq(by(other, 'AED').state, 'not_taken', 'money banked in a currency the register never saw is its own state');
  eq(by(other, 'AED').registerCents, null, 'with no register figure invented for it');
  eq(by(other, 'AED').deltaCents, null,
    'and no variance against a zero that was never a figure — that would read as the whole lot lost');
  eq(by(other, 'GBP').state, 'not_banked', 'the currency that WAS taken is still asked about');
}

/* ── two currencies are never subtracted from each other ───────────────────── */
{
  const lines = bankLines(
    [took('EUR', 60000, 4), took('GBP', 360000, 10)],
    [banked('EUR', 59500), banked('GBP', 360000)],
    true,
  );
  eq(lines.length, 2, 'still two lines');
  eq(by(lines, 'EUR').deltaCents, -500, 'the euro line is measured against the euro statement');
  eq(by(lines, 'GBP').state, 'agrees', 'and the pound line against the pound one');
  ok(lines.every((l) => l.deltaCents == null || Number.isFinite(l.deltaCents)),
    'every variance belongs to exactly one currency');
  // The shape of the defect this excludes: 60000 + 360000 = 420000 against
  // 59500 + 360000 = 419500, a tidy "short by 500" in no currency at all.
  eq(lines.map((l) => l.currency).join(','), 'EUR,GBP', 'sorted by code so the list cannot reorder under a reader');
}

/* ── a payment row that states no currency is counted, never folded ────────── */
{
  const taken = [took('GBP', 420000, 14), took(null, 9900, 3), took('', 500, 1)];
  const lines = bankLines(taken, [banked('GBP', 420000)], true);
  eq(lines.length, 1, 'a row stating no currency produces no line — there is no statement it belongs to');
  eq(by(lines, 'GBP').registerCents, 420000,
    'and is NOT folded into the nearest code: the GBP figure is the GBP payments and nothing else');
  eq(unstatedTakings(taken), 4, 'the payments are counted so the owner knows they exist');
  eq(unstatedTakings([took('GBP', 1, 1)]), 0, 'and a healthy month reports none');
}

/* ── no takings and no knowledge of the takings are different facts ────────── */
{
  eq(bankLines([], [], true).length, 0, 'a month with nothing in it and nothing said about it has no lines');
  const onlyBank = bankLines([], [banked('GBP', 420000)], true);
  eq(by(onlyBank, 'GBP').state, 'not_taken',
    'a whole read of an empty register against a real statement is not a match and not a variance');
  const unread = bankLines([], [banked('GBP', 420000)], false);
  eq(by(unread, 'GBP').state, 'register_unknown',
    'and the same pair over a failed read is unknown rather than an empty register');
}

/* ── what cannot be recorded, and why ──────────────────────────────────────── */
{
  eq(bankedBlockers({ monthKey: '2026-08', currency: 'GBP', amountText: '4085.00', statementRef: '', note: '' }).length, 0,
    'a month, a currency and an amount is all it takes');
  ok(bankedBlockers({ monthKey: '2026-08', currency: null, amountText: '4085.00', statementRef: '', note: '' })
    .some((b) => /no default/i.test(b)),
    'no currency is refused, and the refusal says there is no default rather than picking one');
  ok(bankedBlockers({ monthKey: '2026-08', currency: '  ', amountText: '1', statementRef: '', note: '' }).length > 0,
    'and a currency of spaces is the same fact as none');
  ok(bankedBlockers({ monthKey: '2026-8', currency: 'GBP', amountText: '1', statementRef: '', note: '' })
    .some((b) => /month/i.test(b)),
    'a month key that is not YYYY-MM is refused rather than stored against a month that does not exist');
  ok(bankedBlockers({ monthKey: '2026-08', currency: 'GBP', amountText: '   ', statementRef: '', note: '' })
    .some((b) => /reached the bank/i.test(b)),
    'and an empty box is not a nought');
}

/* ── the three things the panel must say out loud ──────────────────────────── */
{
  ok(/spoken to a bank/i.test(BANK_IS_TYPED_NOTE),
    'the panel says this app has never spoken to a bank');
  ok(/not a mistake/i.test(BANK_DIFFERENCE_IS_ORDINARY),
    'that a difference is usually not a mistake');
  ok(/never recomputed/i.test(BANK_CHANGES_NOTHING_NOTE) && /stays filed/i.test(BANK_CHANGES_NOTHING_NOTE),
    'and that the filed figure is untouched by anything recorded here');
}

if (errors.length) {
  console.error(`gymBanked: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymBanked ok');
