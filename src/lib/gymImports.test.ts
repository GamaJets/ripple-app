// Tests for the import key — the thing that decides whether pasting a
// spreadsheet twice doubles a month's revenue.
//
// The screen behind this writes the gym's money ledger in bulk and permanently.
// Before this module it did so with no dedupe of any kind, and its own failure
// message told the operator to fix the failed lines and paste back "only those,
// or the rest will be imported twice" — correctness discharged by asking a
// person to transcribe line numbers accurately, once, under pressure.
//
// The key has to hold two properties that pull against each other, and both are
// asserted here because getting either wrong loses money:
//
//   STABLE     the same line of the same file always produces the same key, so
//              a re-run recognises what it already wrote;
//   INJECTIVE  ENOUGH  two lines that are genuinely different payments produce
//              different keys, including two lines that are identical in every
//              field — a gym really can take two identical cash day-pass
//              payments on one day, and dropping the second loses money the gym
//              actually took.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import { paymentKeyContent, paymentImportKey, keyPaymentRows } from './gymImports';
import type { PaymentRow } from './csvImport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const pay = (o: Partial<PaymentRow> = {}): PaymentRow => ({
  memberName: 'Sara Ahmed',
  email: null,
  amountCents: 45000,
  takenOn: '2026-08-02',
  method: 'card',
  note: 'Renewal',
  ...o,
});

const lines = (rows: PaymentRow[]) => rows.map((payment, i) => ({ line: i + 2, payment }));

/* ── stable ───────────────────────────────────────────────────────────────── */

eq(paymentKeyContent(pay()), paymentKeyContent(pay()),
  'the same line produces the same key — without this a re-run recognises nothing and writes everything again');

// The same sheet re-exported with different padding and casing is the same
// sheet. An operator who fixes two rows in Excel and re-copies the whole thing
// must not have every line read as new.
eq(
  paymentKeyContent(pay({ memberName: '  SARA   AHMED ', note: '  renewal  ' })),
  paymentKeyContent(pay()),
  'whitespace and case are normalised, so a re-export of the same sheet still matches what was imported',
);

/* ── different payments must not collide ──────────────────────────────────── */

{
  const base = paymentKeyContent(pay());
  ok(paymentKeyContent(pay({ amountCents: 45001 })) !== base, 'a different amount is a different payment');
  ok(paymentKeyContent(pay({ takenOn: '2026-08-03' })) !== base, 'a different date is a different payment');
  ok(paymentKeyContent(pay({ method: 'cash' })) !== base, 'a different method is a different payment');
  ok(paymentKeyContent(pay({ memberName: 'Sara Ahmad' })) !== base, 'a different person is a different payment');
  ok(paymentKeyContent(pay({ note: 'Joining fee' })) !== base, 'a different note is a different payment');
}

// Field boundaries. Moving a character across the join must not produce the
// same key, or two unrelated lines silently become one payment.
ok(
  paymentKeyContent(pay({ memberName: 'ab', note: 'c' }))
  !== paymentKeyContent(pay({ memberName: 'a', note: 'bc' })),
  'the fields are separated, so shifting a character between two of them changes the key',
);

/* ── the case a content-only key gets wrong ───────────────────────────────── */
//
// Two identical cash day passes on the same day, no names, no notes. Every
// field is the same because the payments really are indistinguishable — and
// they are two payments. A key built from content alone would write one and
// silently drop the other, which is the same defect as double-importing seen
// from the other end.
{
  const twin = pay({ memberName: null, note: null, amountCents: 5000, method: 'cash' });
  const keyed = keyPaymentRows(lines([twin, twin]));
  eq(keyed.length, 2, 'both identical lines are kept');
  ok(keyed[0].key !== keyed[1].key,
    'AND THEY GET DIFFERENT KEYS — two genuinely identical payments both land; dropping the second loses money the gym took');
  eq(keyed[0].key, paymentImportKey(twin, 0), 'the first is occurrence 0');
  eq(keyed[1].key, paymentImportKey(twin, 1), 'the second is occurrence 1');
}

/* ── the property the whole design rests on ───────────────────────────────── */

// Running the same file again produces the same keys in the same order, so the
// unique index recognises every one of them and the upsert writes nothing.
{
  const file = [pay(), pay({ amountCents: 5000, memberName: null, note: null }), pay()];
  const first = keyPaymentRows(lines(file)).map((k) => k.key);
  const second = keyPaymentRows(lines(file)).map((k) => k.key);
  eq(first.join('\n'), second.join('\n'),
    'the same file run twice produces exactly the same keys — this is what makes re-running the whole file the SAFE move rather than the dangerous one');
  eq(new Set(first).size, 3, 'and the three lines are three distinct keys, including the two that repeat a person');
}

// Numbering is a function of the file alone and of file ORDER. If it depended
// on anything else — what is already stored, the order rows came back in — the
// same file would key differently on different days and the dedupe would
// evaporate without anything failing.
{
  const a = pay({ note: 'one' });
  const b = pay({ note: 'two' });
  const forward = keyPaymentRows(lines([a, b, a]));
  // This read `eq(forward[0].key, forward[0].key, 'sanity')`, which compares a
  // value to itself and is true of every possible implementation. The sanity it
  // was reaching for is that the numbering agrees with `paymentImportKey`, the
  // function the rest of the app keys by — if the two ever disagreed, a line
  // written by one and looked up by the other would import twice.
  eq(forward[0].key, paymentImportKey(a, 0), 'the first occurrence of a line is #0, by the same rule anything else computing a key would use');
  eq(forward[2].key, paymentImportKey(a, 1), 'and its repeat later in the file is #1');
  ok(forward[0].key !== forward[2].key, 'the repeat of the first line is a second occurrence, not the same key');
  eq(forward[1].key, paymentImportKey(b, 0), 'an unrelated line between two repeats does not disturb their numbering');
}

// A prefix of a file keys identically to the same prefix of the whole file.
// This is what makes "run the whole thing again after fixing three lines" safe:
// the lines that already landed are still keyed the way they were written.
{
  const file = [pay({ note: 'a' }), pay({ note: 'b' }), pay({ note: 'c' })];
  const whole = keyPaymentRows(lines(file)).map((k) => k.key);
  const prefix = keyPaymentRows(lines(file.slice(0, 2))).map((k) => k.key);
  eq(prefix.join('\n'), whole.slice(0, 2).join('\n'),
    'a prefix keys the same as the whole file, so a partial run and a full re-run agree about which lines are which');
}

/* ── the line number travels with the key ─────────────────────────────────── */
//
// The old code reported failures by position in a FILTERED array, so every
// reported line number was short by however many rows above had been rejected —
// and the message told the gym to re-paste those lines. Following it re-imported
// payments that had landed and left the broken ones missing.
{
  const keyed = keyPaymentRows([
    { line: 7, payment: pay({ note: 'seven' }) },
    { line: 19, payment: pay({ note: 'nineteen' }) },
  ]);
  eq(keyed[0].line, 7, 'the sheet line number is carried, not recomputed from an array index');
  eq(keyed[1].line, 19, 'including across a gap where rows were rejected in the preview');
}

/* ── the version marker ───────────────────────────────────────────────────── */

ok(paymentKeyContent(pay()).startsWith('p1|'),
  'the key carries a format version, so this rule can be changed later without silently making every stored key unmatchable');

if (errors.length) {
  console.error(`gymImports.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('gymImports.test.ts — ok');
