"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const csv_1 = require("./csv");
const csvImport_1 = require("./csvImport");
const gymExport_1 = require("./gymExport");
// A suite that dies half way through must not be read as a pass. Set red
// first, and only the last line of the file clears it.
process.exitCode = 1;
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ready = (rows) => ({ state: 'ready', rows });
const MONEYS = [
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
        eq((0, gymExport_1.minorToDecimal)(minor, m.code), m.written[i], `${m.code}: ${minor} minor units is written as ${m.written[i]}`);
    });
    eq((0, gymExport_1.minorToDecimal)(-m.amounts[0], m.code), '-' + m.written[0], `${m.code}: a negative keeps its sign and its places`);
    eq((0, gymExport_1.minorToDecimal)(null, m.code), '', `${m.code}: an unrecorded amount is empty, never a zero`);
}
eq((0, gymExport_1.minorToDecimal)(45000, null), '', 'an amount in no stated currency is empty — there is no default number of places to write it at');
eq((0, gymExport_1.minorToDecimal)(45000, ''), '', 'and a blank code is the same silence');
/* ── 2. the reader reads back exactly what the writer wrote ──────────────── */
for (const m of MONEYS) {
    m.amounts.forEach((minor) => {
        const written = (0, gymExport_1.minorToDecimal)(minor, m.code);
        const back = (0, csvImport_1.parseMoneyCents)(written, m.code);
        ok(back.ok, `${m.code}: "${written}" is readable at all`);
        eq(back.ok ? back.value : null, minor, `${m.code}: ${minor} minor units survives being written and read back`);
    });
}
/* ── 3. and the whole file does, through buildGymExport ──────────────────── */
//
// Not `minorToDecimal` handed straight to `parseMoneyCents` — that would prove
// the two agree about a string and nothing about the CSV between them. This
// builds the actual bundle, pulls payments.csv and plans.csv out of it by
// name, and imports them with the previewers the import screen calls.
function bundleFor(m, timezone = null) {
    const plans = m.amounts.map((cents, i) => ({
        id: `pl${i}`,
        // A comma and a quote in the name, because a shifted column is the other
        // way a round trip silently changes an amount.
        name: `Plan ${i}, "full" access`,
        priceCents: cents,
        currency: m.code,
        interval: i === 0 ? 'month' : i === 1 ? 'year' : 'once',
        active: i % 2 === 0,
    }));
    const payments = m.amounts.map((cents, i) => ({
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
    const input = {
        gymName: `Gym ${m.code}`, tenantId: 'T', generatedAt: '2026-08-26T08:00:00.000Z',
        timezone,
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
    return { input, plans, payments, bundle: (0, gymExport_1.buildGymExport)(input) };
}
for (const m of MONEYS) {
    const { plans, payments, bundle } = bundleFor(m);
    const fileFor = (base) => bundle.files.find((f) => f.name.endsWith(base));
    ok(bundle.complete, `${m.code}: the fixture bundle is complete, so nothing below is testing a stub`);
    // ── payments.csv ──
    const payCsv = fileFor('payments.csv');
    ok(payCsv !== undefined, `${m.code}: the bundle contains payments.csv`);
    const pp = (0, csvImport_1.previewPayments)(payCsv?.text ?? '', undefined, m.code);
    eq(pp.missingRequired.length, 0, `${m.code}: payments.csv carries the columns the importer requires`);
    eq(pp.rejected.length, 0, `${m.code}: nothing in the exported payments file is refused on the way back in — ${pp.rejected.map((r) => r.errors.join('; ')).join(' | ')}`);
    eq(pp.ready.length, payments.length, `${m.code}: every payment row comes back`);
    payments.forEach((p, i) => {
        eq(pp.ready[i]?.amountCents, p.amountCents, `${m.code}: payment ${i} comes back as the same integer minor units`);
        eq(pp.ready[i]?.takenOn, p.takenAt.slice(0, 10), `${m.code}: payment ${i} comes back on the same calendar day`);
    });
    // The authoritative column is the stored integer, and it must agree with the
    // decimal beside it — the two disagreeing is precisely what a factor error
    // looks like in a file somebody opens.
    const paySheet = (0, csv_1.parseSheet)(payCsv?.text ?? '');
    const centsAt = paySheet.header.indexOf('amount_cents');
    payments.forEach((p, i) => {
        eq(paySheet.rows[i]?.[centsAt], String(p.amountCents), `${m.code}: payments.csv still carries the stored integer unchanged`);
    });
    // ── plans.csv ──
    const planCsv = fileFor('plans.csv');
    ok(planCsv !== undefined, `${m.code}: the bundle contains plans.csv`);
    // Deliberately given NO fallback currency: plans.csv carries its own currency
    // column, and the file has to be self-sufficient. A gym importing another
    // gym's price book has not necessarily set its own currency yet.
    const pl = (0, csvImport_1.previewPlans)(planCsv?.text ?? '');
    eq(pl.missingRequired.length, 0, `${m.code}: plans.csv carries the columns the importer requires`);
    eq(pl.rejected.length, 0, `${m.code}: nothing in the exported price book is refused on the way back in — ${pl.rejected.map((r) => r.errors.join('; ')).join(' | ')}`);
    plans.forEach((p, i) => {
        const got = pl.ready[i];
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
eq((0, csvImport_1.parseMoneyCents)('50000', 'JPY').ok && (0, csvImport_1.parseMoneyCents)('50000', 'JPY').value, 50000, 'a Japanese 50000 is fifty thousand yen');
eq((0, csvImport_1.parseMoneyCents)('50000', 'GBP').ok && (0, csvImport_1.parseMoneyCents)('50000', 'GBP').value, 5000000, 'the same digits in sterling are five million pence, and the two must not be the same integer');
eq((0, csvImport_1.parseMoneyCents)('12.340', 'KWD').ok && (0, csvImport_1.parseMoneyCents)('12.340', 'KWD').value, 12340, 'a Kuwaiti 12.340 is twelve thousand three hundred and forty fils, and is no longer refused outright');
eq((0, csvImport_1.parseMoneyCents)('12.34', 'GBP').ok && (0, csvImport_1.parseMoneyCents)('12.34', 'GBP').value, 1234, 'while the sterling reading of nearly the same figure is a tenth of it');
/* ── 5. no currency is a refusal, never two places ───────────────────────── */
{
    ok((0, csvImport_1.parseMoneyCents)('45.00').ok === false, 'with no currency there is no figure at all');
    ok((0, csvImport_1.parseMoneyCents)('45.00', null).ok === false, 'an explicitly unknown currency is the same refusal');
    ok((0, csvImport_1.parseMoneyCents)('45.00', '   ').ok === false, 'and so is a blank one, which is how an unset tenants.currency arrives after a trim');
    const why = (0, csvImport_1.parseMoneyCents)('45.00', null);
    ok(!why.ok && /currency/i.test(why.reason), 'and the reason says the word currency, so the fix is findable');
    const noCcy = (0, csvImport_1.previewPayments)('member,amount,date\nAmy,45.00,2026-01-05\n');
    eq(noCcy.ready.length, 0, 'a payments import with no currency writes nothing');
    eq(noCcy.currency, null, 'and the preview says so rather than implying one');
    ok(noCcy.rejected[0]?.errors.some((e) => /currency/i.test(e)), 'every row says why, on the row, rather than only in a banner');
    const noCcyPlans = (0, csvImport_1.previewPlans)('name,price\nGold,200\n');
    eq(noCcyPlans.ready.length, 0, 'and a price book with no currency anywhere writes nothing either');
    // But a price book that names its own currency needs no gym behind it.
    const stated = (0, csvImport_1.previewPlans)('name,price,currency\nGold,12.340,KWD\n');
    eq(stated.ready[0]?.priceCents, 12340, "a sheet's own currency column is enough on its own");
    eq(stated.ready[0]?.currency, 'KWD', 'and is kept as what the sheet said');
}
/* ── 6. the shapes a person under time pressure actually types ───────────── */
{
    // A thousands group is a thousands group in a two-place currency.
    eq((0, csvImport_1.parseMoneyCents)('1,234', 'GBP').value, 123400, 'a lone separator before three digits is thousands');
    eq((0, csvImport_1.parseMoneyCents)('1,234,567.89', 'GBP').value, 123456789, 'and so is every group in a long figure');
    eq((0, csvImport_1.parseMoneyCents)('1.234,56', 'GBP').value, 123456, 'the European convention is read the European way');
    eq((0, csvImport_1.parseMoneyCents)('£ 1,234.56', 'GBP').value, 123456, 'a symbol and a space are not part of the figure');
    eq((0, csvImport_1.parseMoneyCents)('AED 45', 'AED').value, 4500, 'nor is a three-letter code written in front of it');
    // A yen has no decimal point available to it, so a group is unambiguous.
    eq((0, csvImport_1.parseMoneyCents)('50,000', 'JPY').value, 50000, 'a grouped yen figure is fifty thousand yen');
    ok((0, csvImport_1.parseMoneyCents)('500.50', 'JPY').ok === false, 'and a fraction a yen does not have is refused rather than rounded into one');
    eq((0, csvImport_1.parseMoneyCents)('1234.00', 'JPY').value, 1234, 'while trailing noughts lose nothing and are accepted — a system that writes every figure to two places is not stating a sen');
    eq((0, csvImport_1.parseMoneyCents)('12.3400', 'KWD').value, 12340, 'the same allowance in a three-place currency');
    ok((0, csvImport_1.parseMoneyCents)('12.3456', 'KWD').ok === false, 'and a fourth place that carries a digit is still refused');
    // The one genuinely 50/50 case, refused rather than guessed — the same rule
    // parseDate applies to 03/04/2026.
    const amb = (0, csvImport_1.parseMoneyCents)('1,250', 'KWD');
    ok(amb.ok === false, 'a lone comma before three digits in a three-place currency is ambiguous and is refused');
    ok(!amb.ok && /decimal places/.test(amb.reason), 'and the refusal says how to write it unambiguously');
    eq((0, csvImport_1.parseMoneyCents)('1,250.000', 'KWD').value, 1250000, 'written that way, it reads as a thousand two hundred and fifty dinars');
    // A trailing minus is a minus. SAP, DATEV and most German ledgers write a
    // credit this way, and reading it as income is how a refund gets imported as
    // a payment.
    eq((0, csvImport_1.parseMoneyCents)('50.00-', 'GBP').value, -5000, 'a trailing minus is a negative');
    eq((0, csvImport_1.parseMoneyCents)('50.00−', 'GBP').value, -5000, 'including the one a spreadsheet writes, U+2212');
    eq((0, csvImport_1.parseMoneyCents)('(50.00)', 'GBP').value, -5000, 'and so are accounting parentheses');
    ok((0, csvImport_1.parseMoneyCents)('50-00', 'GBP').ok === false, 'a minus in the middle of a figure is refused, not stripped');
    // And the importer still refuses a negative payment outright, which is the
    // point of noticing the trailing one at all.
    const credit = (0, csvImport_1.previewPayments)('member,amount,date\nAmy,50.00-,2026-01-05\n', undefined, 'GBP');
    eq(credit.ready.length, 0, 'a credit written with a trailing minus is refused as a refund');
    ok(credit.rejected[0]?.errors.some((e) => /negative/.test(e)), 'and is named as one rather than imported as fifty pounds of income');
}
/* ── 7. a file in the wrong money says so ────────────────────────────────── */
{
    // payments.csv carries a currency column. It does not SET the currency —
    // `gym_payments.currency` is filled from the gym for the whole run — but a
    // sheet that names a different one is a sheet from somewhere else, and
    // importing it at par silently restates a sterling ledger as dirhams.
    const wrong = (0, csvImport_1.previewPayments)('member,amount,date,currency\nAmy,45.00,2026-01-05,GBP\nBen,20.00,2026-01-06,AED\n', undefined, 'AED');
    eq(wrong.ready.length, 1, 'the row in the gym’s own currency imports');
    eq(wrong.rejected.length, 1, 'and the row in another one is refused rather than converted at par');
    ok(wrong.rejected[0]?.errors.some((e) => /GBP/.test(e) && /AED/.test(e)), 'the refusal names both moneys, because that is the whole fact');
    eq(wrong.unmatchedColumns.length, 0, 'and the currency column is read rather than reported as unrecognised');
}
/* ── 8. and the DAY survives the round trip, not just the amount ─────────── */
//
// The second half of the same failure, and it took the same shape: the exporter
// read UTC's day off the stored instant and the importer re-stamped whatever it
// was given at midday, so an export and a re-import agreed perfectly about a
// day that was not the gym's.
//
// It only ever showed on a payment recorded NATIVELY at the desk. Everything
// this product imported is stamped `T12:00:00Z` by src/lib/gymImports.ts, which
// no zone on earth can move off its day — which is exactly why nobody saw it,
// and why the fixtures above (all at 09:14Z) could not have caught it either.
// A payment written by the money screen with no date picked carries the real
// instant, and a gym four hours east of UTC then exported and re-imported half
// of every night onto the previous day.
//
// So the fixtures here are deliberately the awkward ones: instants within two
// hours of midnight, in a gym east of UTC and a gym west of it, where the
// gym's day and UTC's day are different dates. If `gymDatePart` regresses to a
// slice of the timestamp, every assertion in this block fails at once.
{
    const payAt = (id, takenAt) => ({
        id, memberId: 'u1', memberName: 'Amy', amountCents: 4500, currency: 'GBP',
        method: 'card', takenAt, note: null, kind: 'payment',
        reversesPaymentId: null, invoiceId: null, membershipId: null,
    });
    const withZone = (zone, rows) => {
        const { input } = bundleFor(MONEYS[0], zone);
        const bundle = (0, gymExport_1.buildGymExport)({ ...input, payments: ready(rows) });
        const csv = bundle.files.find((f) => f.name.endsWith('payments.csv'));
        ok(csv !== undefined, `${zone ?? 'no zone'}: the bundle contains payments.csv`);
        return { bundle, text: csv?.text ?? '' };
    };
    // Dubai is UTC+4 and does not observe daylight saving, so 22:30Z on the 31st
    // is 02:30 on the 1st at the desk — the next day, and the next MONTH, which
    // is the boundary an accountant's file turns on.
    const dubai = withZone('Asia/Dubai', [payAt('p1', '2026-08-31T22:30:00.000Z')]);
    const dubaiRead = (0, csvImport_1.previewPayments)(dubai.text, undefined, 'GBP');
    eq(dubaiRead.rejected.length, 0, 'Asia/Dubai: the exported row is readable on the way back in');
    eq(dubaiRead.ready[0]?.takenOn, '2026-09-01', 'a payment taken at 02:30 on 1 September in Dubai re-imports on 1 September, not on 31 August');
    eq(dubai.bundle.manifest.daysAt, 'gym', 'and the manifest says the days are the gym’s');
    eq(dubai.bundle.manifest.timezone, 'Asia/Dubai', 'and names which gym’s');
    ok(/Asia\/Dubai/.test(dubai.bundle.manifest.parts.find((p) => p.part === 'payments')?.note ?? ''), 'the note on payments.csv names the calendar its date column is on');
    // And the other direction. Los Angeles is UTC-7 in September, so 03:00Z on
    // the 1st is 20:00 on the 31st at the desk — the previous day, and the
    // previous month.
    const la = withZone('America/Los_Angeles', [payAt('p2', '2026-09-01T03:00:00.000Z')]);
    const laRead = (0, csvImport_1.previewPayments)(la.text, undefined, 'GBP');
    eq(laRead.ready[0]?.takenOn, '2026-08-31', 'a payment taken at 20:00 on 31 August in Los Angeles re-imports on 31 August, not on 1 September');
    // The two gyms disagree about the same instant, which is the whole point: if
    // they agreed, both could be passing against a slice of the timestamp.
    const sameInstant = '2026-08-31T22:30:00.000Z';
    const east = (0, csvImport_1.previewPayments)(withZone('Asia/Dubai', [payAt('p3', sameInstant)]).text, undefined, 'GBP');
    const west = (0, csvImport_1.previewPayments)(withZone('America/Los_Angeles', [payAt('p4', sameInstant)]).text, undefined, 'GBP');
    ok(east.ready[0]?.takenOn !== west.ready[0]?.takenOn, 'one instant is two different days in two different gyms, and the file says the gym’s');
    eq(east.ready[0]?.takenOn, '2026-09-01', 'the eastern gym files it on the 1st');
    eq(west.ready[0]?.takenOn, '2026-08-31', 'the western gym files it on the 31st');
    // A gym that has not set a timezone still gets a usable file. Blanking the
    // column would be the honest-looking answer and it would break the round trip
    // outright for every such gym, which is a larger failure than the one this
    // closes — so it falls back to UTC's day and the bundle says so three times.
    const none = withZone(null, [payAt('p5', '2026-08-31T22:30:00.000Z')]);
    const noneRead = (0, csvImport_1.previewPayments)(none.text, undefined, 'GBP');
    eq(noneRead.rejected.length, 0, 'no zone: the row still re-imports rather than being refused');
    eq(noneRead.ready[0]?.takenOn, '2026-08-31', 'and falls back to UTC’s day, as it always did');
    eq(none.bundle.manifest.daysAt, 'utc', 'the manifest says which calendar it used');
    eq(none.bundle.manifest.timezone, null, 'and does not invent a zone the gym never set');
    ok(/not set a timezone/.test(none.bundle.manifest.conventions.dates ?? ''), 'the conventions tell the reader why, and what to do about it');
    const readme = none.bundle.files.find((f) => f.name.endsWith('README.txt'))?.text ?? '';
    ok(/Days:\s+UTC/.test(readme), 'and the README says it in the block a reader actually reads');
    // A zone this runtime cannot resolve is not a zone. It must not silently
    // become one, and it must not blank the column either.
    const bogus = withZone('Mars/Olympus', [payAt('p6', '2026-08-31T22:30:00.000Z')]);
    eq(bogus.bundle.manifest.daysAt, 'utc', 'an unresolvable zone is treated as no zone, not asserted as the gym’s');
    eq((0, csvImport_1.previewPayments)(bogus.text, undefined, 'GBP').ready[0]?.takenOn, '2026-08-31', 'and the day falls back rather than going empty');
    // The stored instant is untouched by all of this. `date` is a re-import
    // convenience; `taken_at` is the record, and a fix that moved the record
    // would be a worse bug than the one it fixed.
    const sheet = (0, csv_1.parseSheet)(dubai.text);
    eq(sheet.rows[0]?.[sheet.header.indexOf('taken_at')], '2026-08-31T22:30:00.000Z', 'taken_at is still the stored instant, unchanged, beside the gym’s day');
    // And the filename carries the gym's day too, for the same reason: a bundle
    // taken at 02:30 on 1 September in Dubai is a September export, and a folder
    // of these is read by its name long before anybody opens the README.
    const stamped = (0, gymExport_1.buildGymExport)({
        ...bundleFor(MONEYS[0], 'Asia/Dubai').input,
        generatedAt: '2026-08-31T22:30:00.000Z',
    });
    ok(/2026-09-01/.test(stamped.prefix), `the filename is stamped with the gym's day, not UTC's — got ${stamped.prefix}`);
}
if (errors.length) {
    for (const e of errors)
        console.error('FAIL ' + e);
    process.exit(1);
}
process.exitCode = 0;
console.log(`importRoundTrip: ok — export and re-import agree in ${MONEYS.map((m) => m.code).join(', ')}, and on the gym's own day`);
