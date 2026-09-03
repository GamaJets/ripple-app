// The spreadsheet a gym brings in, and the one it takes out, in three moneys.
//
// ── What this is pointed at ───────────────────────────────────────────────
//
// `parseMoneyCents` in src/lib/csvImport.ts and `minorToDecimal` in
// src/lib/gymExport.ts were both two decimal places, flat, for every currency
// there is. That is right for most of the world and silently wrong for
// twenty-one currencies:
//
//   · a Japanese gym's "50000" was read as FIVE MILLION YEN and written into
//     `gym_payments.amount_cents`, which is a permanent record of what members
//     paid, on the one import a gym does once at setup and never checks again;
//   · a Kuwaiti gym's perfectly ordinary "12.340" was REFUSED outright, with
//     the reason "money takes at most 2";
//   · and on the way out, ¥50,000 exported as "500.00" and KWD 12.340 as
//     "123.40" — into the file a gym hands an accountant.
//
// The two had to move together. An exporter at a flat two places and an
// importer that asks the currency would produce a bundle that does not
// re-import as the same figures, which is a worse failure than either alone: a
// gym leaving Repple with a folder of CSVs has nothing else to move on.
//
// ── Why a round trip is the assertion and not a table of examples ─────────
//
// Because the two functions can only be wrong together in a way a round trip
// misses if they are wrong by the same factor in the same direction — and that
// is exactly what they WERE. So the round trip is run in three currencies with
// three different numbers of decimal places, and the integer is compared
// against the integer that went in, not against a string somebody typed into
// this file. GBP has two places, JPY has none, KWD has three. If a factor of a
// hundred creeps back into either module, at most one of the three can pass.
//
// Compile with tsc, run with node.
import { parseSheet } from './csv';
import {
  parseMoneyCents, previewPayments, previewPlans, type PlanRow,
} from './csvImport';
import {
  minorToDecimal, buildGymExport, type GymExportInput,
} from './gymExport';
import type { MembershipPlan, GymPayment } from './gymRecord';
import type { Slice } from './memberView';

// A suite that dies half way through must not be read as a pass. Set red
// first, and only the last line of the file clears it.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ready = <T>(rows: T[]): Slice<T> => ({ state: 'ready', rows });

/* ── the three moneys ──────────────────────────────────────────────────────
 *
 * The figures are chosen so that a wrong factor cannot coincidentally agree:
 * each currency carries an amount smaller than one whole unit, which is where
 * a padding error shows up, and one with a thousands group in it.
 */
interface Money {
  code: string;
  places: number;
  /** Minor units, exactly as the database holds them. */
  amounts: number[];
  /** What `minorToDecimal` must write for each of them. */
  written: string[];
}

const MONEYS: Money[] = [
  {
    code: 'GBP',
    places: 2,
    amounts: [45000, 5, 0, 123456789],
    written: ['450.00', '0.05', '0.00', '1234567.89'],
  },
  {
    // Sixteen currencies have no minor unit at all. ¥50,000 IS 50000 minor
    // units, and the whole defect was a hundred applied to it anyway.
    code: 'JPY',
    places: 0,
    amounts: [50000, 5, 0, 123456789],
    written: ['50000', '5', '0', '123456789'],
  },
  {
    // And five have a THOUSAND. A dinar is the other end of the same mistake,
    // and it is the end that used to be refused rather than misread.
    code: 'KWD',
    places: 3,
    amounts: [12340, 5, 0, 123456789],
    written: ['12.340', '0.005', '0.000', '123456.789'],
  },
];

/* ── 1. the writer states the amount the money actually has ──────────────── */
for (const m of MONEYS) {
  m.amounts.forEach((minor, i) => {
    eq(minorToDecimal(minor, m.code), m.written[i],
      `${m.code}: ${minor} minor units is written as ${m.written[i]}`);
  });
  eq(minorToDecimal(-m.amounts[0], m.code), '-' + m.written[0],
    `${m.code}: a negative keeps its sign and its places`);
  eq(minorToDecimal(null, m.code), '', `${m.code}: an unrecorded amount is empty, never a zero`);
}
eq(minorToDecimal(45000, null), '',
  'an amount in no stated currency is empty — there is no default number of places to write it at');
eq(minorToDecimal(45000, ''), '', 'and a blank code is the same silence');

/* ── 2. the reader reads back exactly what the writer wrote ──────────────── */
for (const m of MONEYS) {
  m.amounts.forEach((minor) => {
    const written = minorToDecimal(minor, m.code);
    const back = parseMoneyCents(written, m.code);
    ok(back.ok, `${m.code}: "${written}" is readable at all`);
    eq(back.ok ? back.value : null, minor,
      `${m.code}: ${minor} minor units survives being written and read back`);
  });
}

/* ── 3. and the whole file does, through buildGymExport ──────────────────── */
//
// Not `minorToDecimal` handed straight to `parseMoneyCents` — that would prove
// the two agree about a string and nothing about the CSV between them. This
// builds the actual bundle, pulls payments.csv and plans.csv out of it by
// name, and imports them with the previewers the import screen calls.
function bundleFor(m: Money) {
  const plans: MembershipPlan[] = m.amounts.map((cents, i) => ({
    id: `pl${i}`,
    // A comma and a quote in the name, because a shifted column is the other
    // way a round trip silently changes an amount.
    name: `Plan ${i}, "full" access`,
    priceCents: cents,
    currency: m.code,
    interval: i === 0 ? 'month' : i === 1 ? 'year' : 'once',
    active: i % 2 === 0,
  }));
  const payments: GymPayment[] = m.amounts.map((cents, i) => ({
    id: `pay${i}`,
    memberId: `u${i}`,
    memberName: `Member ${i}`,
    amountCents: cents,
    currency: m.code,
    method: 'card',
    takenAt: `2026-0${i + 1}-1${i}T09:14:00.000Z`,
    note: null,
    kind: 'payment',
    reversesPaymentId: null,
    invoiceId: null,
    membershipId: null,
  }));
  const input: GymExportInput = {
    gymName: `Gym ${m.code}`, tenantId: 'T', generatedAt: '2026-08-26T08:00:00.000Z',
    from: null, to: null,
    plans: ready(plans), memberships: ready([]), payments: ready(payments),
    classes: ready([]), attendance: ready([]), sessions: ready([]),
    passTypes: ready([]), passes: ready([]), visits: ready([]), invites: ready([]),
    invoices: ready([]), settlements: ready([]), equipment: ready([]),
    shifts: ready([]), interventions: ready([]), promos: ready([]),
    events: ready([]), purchases: ready([]),
    memberRecords: ready([]), agreements: ready([]),
    signatures: ready([]), documents: ready([]),
    orders: ready([]), closes: ready([]), adjustments: ready([]),
    equipmentLog: ready([]), reconciles: ready([]),
  };
  return { input, plans, payments, bundle: buildGymExport(input) };
}

for (const m of MONEYS) {
  const { plans, payments, bundle } = bundleFor(m);
  const fileFor = (base: string) => bundle.files.find((f) => f.name.endsWith(base));

  ok(bundle.complete, `${m.code}: the fixture bundle is complete, so nothing below is testing a stub`);

  // ── payments.csv ──
  const payCsv = fileFor('payments.csv');
  ok(payCsv !== undefined, `${m.code}: the bundle contains payments.csv`);
  const pp = previewPayments(payCsv?.text ?? '', undefined, m.code);
  eq(pp.missingRequired.length, 0, `${m.code}: payments.csv carries the columns the importer requires`);
  eq(pp.rejected.length, 0,
    `${m.code}: nothing in the exported payments file is refused on the way back in — ${pp.rejected.map((r) => r.errors.join('; ')).join(' | ')}`);
  eq(pp.ready.length, payments.length, `${m.code}: every payment row comes back`);
  payments.forEach((p, i) => {
    eq(pp.ready[i]?.amountCents, p.amountCents,
      `${m.code}: payment ${i} comes back as the same integer minor units`);
    eq(pp.ready[i]?.takenOn, p.takenAt.slice(0, 10),
      `${m.code}: payment ${i} comes back on the same calendar day`);
  });
  // The authoritative column is the stored integer, and it must agree with the
  // decimal beside it — the two disagreeing is precisely what a factor error
  // looks like in a file somebody opens.
  const paySheet = parseSheet(payCsv?.text ?? '');
  const centsAt = paySheet.header.indexOf('amount_cents');
  payments.forEach((p, i) => {
    eq(paySheet.rows[i]?.[centsAt], String(p.amountCents),
      `${m.code}: payments.csv still carries the stored integer unchanged`);
  });

  // ── plans.csv ──
  const planCsv = fileFor('plans.csv');
  ok(planCsv !== undefined, `${m.code}: the bundle contains plans.csv`);
  // Deliberately given NO fallback currency: plans.csv carries its own currency
  // column, and the file has to be self-sufficient. A gym importing another
  // gym's price book has not necessarily set its own currency yet.
  const pl = previewPlans(planCsv?.text ?? '');
  eq(pl.missingRequired.length, 0, `${m.code}: plans.csv carries the columns the importer requires`);
  eq(pl.rejected.length, 0,
    `${m.code}: nothing in the exported price book is refused on the way back in — ${pl.rejected.map((r) => r.errors.join('; ')).join(' | ')}`);
  plans.forEach((p, i) => {
    const got = pl.ready[i] as PlanRow | undefined;
    eq(got?.priceCents, p.priceCents, `${m.code}: plan ${i} comes back at the same price in minor units`);
    eq(got?.currency, p.currency, `${m.code}: plan ${i} comes back in the same currency`);
    eq(got?.name, p.name, `${m.code}: plan ${i} keeps the comma and the quotes in its name`);
    eq(got?.interval, p.interval, `${m.code}: plan ${i} keeps its billing period`);
    eq(got?.active, p.active, `${m.code}: a retired plan does not come back on sale`);
  });
}

/* ── 4. and it is not a round trip that agrees about the wrong number ────── */
//
// The three currencies must actually DISAGREE about the same digits. If they
// did not, every assertion above would pass against a flat hundred.
eq(parseMoneyCents('50000', 'JPY').ok && (parseMoneyCents('50000', 'JPY') as any).value, 50000,
  'a Japanese 50000 is fifty thousand yen');
eq(parseMoneyCents('50000', 'GBP').ok && (parseMoneyCents('50000', 'GBP') as any).value, 5000000,
  'the same digits in sterling are five million pence, and the two must not be the same integer');
eq(parseMoneyCents('12.340', 'KWD').ok && (parseMoneyCents('12.340', 'KWD') as any).value, 12340,
  'a Kuwaiti 12.340 is twelve thousand three hundred and forty fils, and is no longer refused outright');
eq(parseMoneyCents('12.34', 'GBP').ok && (parseMoneyCents('12.34', 'GBP') as any).value, 1234,
  'while the sterling reading of nearly the same figure is a tenth of it');

/* ── 5. no currency is a refusal, never two places ───────────────────────── */
{
  ok(parseMoneyCents('45.00').ok === false, 'with no currency there is no figure at all');
  ok(parseMoneyCents('45.00', null).ok === false, 'an explicitly unknown currency is the same refusal');
  ok(parseMoneyCents('45.00', '   ').ok === false,
    'and so is a blank one, which is how an unset tenants.currency arrives after a trim');
  const why = parseMoneyCents('45.00', null);
  ok(!why.ok && /currency/i.test(why.reason), 'and the reason says the word currency, so the fix is findable');

  const noCcy = previewPayments('member,amount,date\nAmy,45.00,2026-01-05\n');
  eq(noCcy.ready.length, 0, 'a payments import with no currency writes nothing');
  eq(noCcy.currency, null, 'and the preview says so rather than implying one');
  ok(noCcy.rejected[0]?.errors.some((e) => /currency/i.test(e)),
    'every row says why, on the row, rather than only in a banner');

  const noCcyPlans = previewPlans('name,price\nGold,200\n');
  eq(noCcyPlans.ready.length, 0, 'and a price book with no currency anywhere writes nothing either');

  // But a price book that names its own currency needs no gym behind it.
  const stated = previewPlans('name,price,currency\nGold,12.340,KWD\n');
  eq(stated.ready[0]?.priceCents, 12340, "a sheet's own currency column is enough on its own");
  eq(stated.ready[0]?.currency, 'KWD', 'and is kept as what the sheet said');
}

/* ── 6. the shapes a person under time pressure actually types ───────────── */
{
  // A thousands group is a thousands group in a two-place currency.
  eq((parseMoneyCents('1,234', 'GBP') as any).value, 123400, 'a lone separator before three digits is thousands');
  eq((parseMoneyCents('1,234,567.89', 'GBP') as any).value, 123456789, 'and so is every group in a long figure');
  eq((parseMoneyCents('1.234,56', 'GBP') as any).value, 123456, 'the European convention is read the European way');
  eq((parseMoneyCents('£ 1,234.56', 'GBP') as any).value, 123456, 'a symbol and a space are not part of the figure');
  eq((parseMoneyCents('AED 45', 'AED') as any).value, 4500, 'nor is a three-letter code written in front of it');

  // A yen has no decimal point available to it, so a group is unambiguous.
  eq((parseMoneyCents('50,000', 'JPY') as any).value, 50000, 'a grouped yen figure is fifty thousand yen');
  ok(parseMoneyCents('500.50', 'JPY').ok === false,
    'and a fraction a yen does not have is refused rather than rounded into one');
  eq((parseMoneyCents('1234.00', 'JPY') as any).value, 1234,
    'while trailing noughts lose nothing and are accepted — a system that writes every figure to two places is not stating a sen');
  eq((parseMoneyCents('12.3400', 'KWD') as any).value, 12340, 'the same allowance in a three-place currency');
  ok(parseMoneyCents('12.3456', 'KWD').ok === false, 'and a fourth place that carries a digit is still refused');

  // The one genuinely 50/50 case, refused rather than guessed — the same rule
  // parseDate applies to 03/04/2026.
  const amb = parseMoneyCents('1,250', 'KWD');
  ok(amb.ok === false, 'a lone comma before three digits in a three-place currency is ambiguous and is refused');
  ok(!amb.ok && /decimal places/.test(amb.reason), 'and the refusal says how to write it unambiguously');
  eq((parseMoneyCents('1,250.000', 'KWD') as any).value, 1250000, 'written that way, it reads as a thousand two hundred and fifty dinars');

  // A trailing minus is a minus. SAP, DATEV and most German ledgers write a
  // credit this way, and reading it as income is how a refund gets imported as
  // a payment.
  eq((parseMoneyCents('50.00-', 'GBP') as any).value, -5000, 'a trailing minus is a negative');
  eq((parseMoneyCents('50.00−', 'GBP') as any).value, -5000, 'including the one a spreadsheet writes, U+2212');
  eq((parseMoneyCents('(50.00)', 'GBP') as any).value, -5000, 'and so are accounting parentheses');
  ok(parseMoneyCents('50-00', 'GBP').ok === false, 'a minus in the middle of a figure is refused, not stripped');

  // And the importer still refuses a negative payment outright, which is the
  // point of noticing the trailing one at all.
  const credit = previewPayments('member,amount,date\nAmy,50.00-,2026-01-05\n', undefined, 'GBP');
  eq(credit.ready.length, 0, 'a credit written with a trailing minus is refused as a refund');
  ok(credit.rejected[0]?.errors.some((e) => /negative/.test(e)),
    'and is named as one rather than imported as fifty pounds of income');
}

/* ── 7. a file in the wrong money says so ────────────────────────────────── */
{
  // payments.csv carries a currency column. It does not SET the currency —
  // `gym_payments.currency` is filled from the gym for the whole run — but a
  // sheet that names a different one is a sheet from somewhere else, and
  // importing it at par silently restates a sterling ledger as dirhams.
  const wrong = previewPayments(
    'member,amount,date,currency\nAmy,45.00,2026-01-05,GBP\nBen,20.00,2026-01-06,AED\n',
    undefined, 'AED',
  );
  eq(wrong.ready.length, 1, 'the row in the gym’s own currency imports');
  eq(wrong.rejected.length, 1, 'and the row in another one is refused rather than converted at par');
  ok(wrong.rejected[0]?.errors.some((e) => /GBP/.test(e) && /AED/.test(e)),
    'the refusal names both moneys, because that is the whole fact');
  eq(wrong.unmatchedColumns.length, 0,
    'and the currency column is read rather than reported as unrecognised');
}

if (errors.length) { for (const e of errors) console.error('FAIL ' + e); process.exit(1); }
process.exitCode = 0;
console.log(`importRoundTrip: ok — export and re-import agree in ${MONEYS.map((m) => m.code).join(', ')}`);
