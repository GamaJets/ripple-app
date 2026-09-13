// Tests for passTypeSales — what each pass type actually sold.
//
// The load-bearing assertions are all refusals, because every figure this
// module produces is one an owner would use to withdraw a product:
//
//   · two currencies are never added, and never ranked against each other;
//   · a pass with no recorded price is never counted as a free one;
//   · a type nobody has bought still gets a row, and a book that could not be
//     read cannot produce those rows and says so;
//   · a sale whose type could not be read is kept, named as unattributable, and
//     never folded into somebody else's product.
//
// Compile with tsc, run with node.
import {
  passTypeSales, salesTotals, PASS_KIND_LABEL,
  BOOK_UNREAD_NOTE, LOST_TYPE_NOTE, PRICE_MOVED_NOTE,
} from './passTypeSales';
import type { GymPass, PassKind, PassType } from './gymPasses';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

function type(over: Partial<PassType> & { id: string }): PassType {
  return {
    name: `type ${over.id}`, kind: 'pack', priceCents: 50000, currency: 'AED',
    uses: 10, validDays: 90, covers: 'visit', active: true,
    ...over,
  };
}

let n = 0;
function pass(over: Partial<GymPass> = {}): GymPass {
  n += 1;
  return {
    id: `p${n}`, passTypeId: 't1', passTypeName: 'type t1', kind: 'pack', covers: 'visit',
    holderId: null, holderName: null, hostMemberId: null,
    issuedOn: '2026-08-12', expiresOn: null,
    usesTotal: 10, usesSpent: 0, paidCents: 50000, currency: 'AED', note: null,
    ...over,
  };
}

/* ── a pack that sold, and one that did not ───────────────────────────────── */
{
  const rows = passTypeSales(
    [type({ id: 't1', name: 'Ten pack' }), type({ id: 't2', name: 'Five pack', uses: 5 })],
    [pass(), pass(), pass()],
  );
  eq(rows.length, 2, 'every type in the book gets a row, sold or not');
  eq(rows[0].name, 'Ten pack', 'the one that sold is first');
  eq(rows[0].sold, 3, 'three sales counted');
  eq(rows[0].priced, 3, 'and all three carried a price');
  eq(rows[0].take.length, 1, 'one currency, one amount');
  eq(rows[0].take[0].cents, 150000, 'which is the sum of the three sales');
  eq(rows[0].take[0].currency, 'AED', 'denominated in what the rows said, not what the book says');
  eq(rows[0].creditsSold, 30, 'credits sold is the sum of what was put on the cards');

  eq(rows[1].sold, 0, 'the pack nobody bought is on the table reading zero');
  eq(rows[1].take.length, 0, 'with no takings at all rather than a zero amount');
  eq(rows[1].uses, 5, 'and the session count it is defined with, which is the other half of the question');

  const tot = salesTotals(rows);
  eq(tot.neverSold, 1, 'the never-sold count is the point of listing them');
  eq(tot.sold, 3, 'and the totals add the counts');
  eq(tot.take.length, 1, 'one currency across the whole table');
  eq(tot.take[0].cents, 150000, 'totalling to the same figure');
}

/* ── two currencies are two figures, forever ──────────────────────────────── */
{
  const rows = passTypeSales(
    [type({ id: 't1', name: 'Ten pack' })],
    [
      pass({ paidCents: 50000, currency: 'AED' }),
      pass({ paidCents: 36000, currency: 'aed' }),
      pass({ paidCents: 24000, currency: 'GBP' }),
    ],
  );
  eq(rows[0].take.length, 2, 'two moneys, two entries — never one sum');
  ok(rows[0].mixedCurrency, 'and the row says so, so a screen cannot print one figure over it');
  const aed = rows[0].take.find((t) => t.currency === 'AED');
  const gbp = rows[0].take.find((t) => t.currency === 'GBP');
  eq(aed?.cents, 86000, "' aed ' and 'AED' are one currency, not two");
  eq(gbp?.cents, 24000, 'and the pounds stay pounds');
  eq(rows[0].take[0].currency, 'AED', 'ordered by CODE, never by amount — 86000 fils does not outrank 24000 pence');

  const tot = salesTotals(rows);
  eq(tot.take.length, 2, 'the bottom line does not resolve what the rows could not');
  eq(tot.take.reduce((a, t) => a + t.cents, 0), 110000,
    'the test may add them because it is checking the parts; the module never does');
}

/* ── an unpriced pass is not a free pass ──────────────────────────────────── */
{
  const rows = passTypeSales(
    [type({ id: 't1' })],
    [pass({ paidCents: null, currency: null }), pass({ paidCents: 50000 })],
  );
  eq(rows[0].sold, 2, 'both are sales');
  eq(rows[0].priced, 1, 'one of them recorded a price');
  eq(rows[0].take.length, 1, 'and the unpriced one adds no currency to the take');
  eq(rows[0].take[0].cents, 50000, 'nor a zero to the amount');
  ok(!rows[0].mixedCurrency,
    'a pass carrying no price cannot make the take mixed — it contributed nothing to it');
}

/* ── a priced sale that states no currency is its own bucket ──────────────── */
{
  const rows = passTypeSales(
    [type({ id: 't1' })],
    [pass({ paidCents: 50000, currency: 'AED' }), pass({ paidCents: 24000, currency: null })],
  );
  eq(rows[0].take.length, 2, 'GBP-plus-unstated is a disagreement, not a single currency');
  ok(rows[0].mixedCurrency, 'so the row is mixed and no single figure may be printed');
  eq(rows[0].take[1].currency, null, 'and the unstated bucket sorts last, where it reads as a question');
  eq(rows[0].take[1].cents, 24000, 'carrying its own amount rather than being dropped');
}

/* ── a sale whose type could not be read ──────────────────────────────────── */
{
  const rows = passTypeSales(
    [type({ id: 't1', name: 'Ten pack' })],
    [pass(), pass({ passTypeId: null, passTypeName: null, kind: null, paidCents: 9900 })],
  );
  eq(rows.length, 2, 'the unattributable sale is a row of its own');
  const lost = rows.find((r) => r.typeId === null);
  ok(!!lost, 'and it is keyed on null rather than dropped');
  eq(lost?.name, null, 'it has no name to print');
  eq(lost?.inBook, false, 'and it is not in the book');
  eq(lost?.take[0].cents, 9900, 'its money is still counted');
  eq(rows.find((r) => r.typeId === 't1')?.sold, 1,
    'and none of it lands on a named product, which would be somebody else’s takings under a name');

  const tot = salesTotals(rows);
  eq(tot.neverSold, 0, 'a row that exists because something sold on it can never be a never-sold');
}

/* ── two unattributable sales are ONE row, not two ────────────────────────── */
{
  const rows = passTypeSales(null, [
    pass({ passTypeId: null, passTypeName: null }),
    pass({ passTypeId: null, passTypeName: null }),
  ]);
  eq(rows.length, 1, 'they are the same fact — a sale nobody can attribute');
  eq(rows[0].sold, 2, 'counted together');
}

/* ── a type withdrawn from the book still reports its sales ───────────────── */
{
  const rows = passTypeSales([], [pass({ passTypeId: 'gone', passTypeName: 'Summer pack' })]);
  eq(rows.length, 1, 'a type no longer in the book is still a row');
  eq(rows[0].name, 'Summer pack', 'named from what was snapshotted onto the pass');
  eq(rows[0].inBook, false, 'and marked as not in the book');
  eq(rows[0].listPriceCents, null, 'with no list price invented for it');
  eq(rows[0].uses, null, 'and no session count invented either');
  eq(rows[0].active, null, 'null is "not in the book", which is not the same as withdrawn');
}

/* ── an unread book cannot produce a zero row, and says so ────────────────── */
{
  const rows = passTypeSales(null, [pass()]);
  eq(rows.length, 1, 'only the types that actually sold can be known');
  eq(salesTotals(rows).neverSold, 0,
    'and nothing may be reported as never sold, because no list of types was read');
  ok(BOOK_UNREAD_NOTE.length > 80 && /sold/i.test(BOOK_UNREAD_NOTE),
    'so the screen has a sentence saying this is not the gym’s product list');

  const noTypes = passTypeSales([], [pass()]);
  eq(noTypes.length, 1, 'an EMPTY book is a different fact and is not the same as an unread one');
}

/* ── nothing at all ───────────────────────────────────────────────────────── */
{
  const none = salesTotals(passTypeSales([], []));
  eq(none.types, 0, 'no types and no passes is an empty table');
  eq(none.sold, 0, 'nothing sold');
  eq(none.take.length, 0, 'and no amount, rather than a zero in a currency nobody named');
}

/* ── the list price is never multiplied out ───────────────────────────────── */
{
  // Repriced from 500.00 to 600.00 after two sales at the old price. The book
  // says 600.00; the take must still be 1,000.00.
  const rows = passTypeSales(
    [type({ id: 't1', priceCents: 60000 })],
    [pass({ paidCents: 50000 }), pass({ paidCents: 50000 })],
  );
  eq(rows[0].listPriceCents, 60000, 'the book price is what the book says');
  eq(rows[0].take[0].cents, 100000, 'and the take is what the sales said, not price times count');
  ok(PRICE_MOVED_NOTE.includes('not what came in'),
    'with a sentence on screen saying why the two do not multiply out');
}

/* ── every kind has words, and the refusals have sentences ────────────────── */
{
  for (const k of ['drop_in', 'guest', 'pack'] as PassKind[]) {
    ok(!!PASS_KIND_LABEL[k] && PASS_KIND_LABEL[k].length > 2,
      `${k} is named in words the desk uses, not left as a column value`);
  }
  ok(LOST_TYPE_NOTE.includes('never added'),
    'the unattributable row states the rule it is keeping');
  ok(BOOK_UNREAD_NOTE !== LOST_TYPE_NOTE && LOST_TYPE_NOTE !== PRICE_MOVED_NOTE,
    'three different silences, three different sentences');
}

/* ── the unattributable bucket is a row and is not a pass type ────────────── */
{
  // Three types in the book, two of which sold, plus two passes whose
  // `pass_type_id` is null — the shape /passes draws as the unattributable row.
  const rows = passTypeSales(
    [type({ id: 't1' }), type({ id: 't2' }), type({ id: 't3' })],
    [pass({ passTypeId: 't1' }), pass({ passTypeId: 't2' }),
      pass({ passTypeId: null, passTypeName: null }), pass({ passTypeId: null, passTypeName: null })],
  );
  const t = salesTotals(rows);
  eq(rows.length, 4, 'three types plus the unattributable bucket is four rows');
  eq(t.types, 4, '`types` counts ROWS, which is what the table is that long');
  eq(t.namedTypes, 3,
    'but the gym sells three types — the bucket is not a fourth product, and the '
    + 'sentence on /passes reading "sold across N types" must not count it');
  eq(t.sold, 4, 'every pass is still counted as sold, bucket included');
  eq(t.neverSold, 1, 'and the one type in the book nobody bought is still named');
}

/* ── a type that left the book is still a type ────────────────────────────── */
{
  const t = salesTotals(passTypeSales([], [pass({ passTypeId: 'gone', passTypeName: 'Summer pack' })]));
  eq(t.namedTypes, 1,
    'a type no longer in the price book was sold on and is a product, unlike the bucket');
  const none = salesTotals(passTypeSales([], []));
  eq(none.namedTypes, 0, 'and nothing at all is nought types, not one');
}

if (errors.length) {
  console.error(`passTypeSales: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('passTypeSales ok');
