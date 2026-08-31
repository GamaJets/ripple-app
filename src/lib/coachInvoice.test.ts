// The invoice a coach hands over. Compile with tsc, then run under plain node.
//
// An invoice is a legal-ish artefact and most of what follows asserts what it
// must NOT do. The versions of it that would do harm all look fine on a screen:
//
//   · a tax line — any tax line, including a zero one — on a document Repple
//     knows nothing about the tax treatment of;
//   · a figure printed without the currency it is denominated in, or with a
//     currency nobody stated;
//   · a number reused after a void, or a sequence that claims more than it is;
//   · a total across two currencies;
//   · a typed name or description that breaks the markup and takes the amount
//     off the page with it.
import {
  coachInvoiceDoc,
  invoiceCaveats,
  issuerCaveat,
  invoiceNumber,
  invoiceDayLabel,
  invoiceBlockers,
  draftMinorUnits,
  invoiceBook,
  invoiceShareBlurb,
  escapeHtml,
  money,
  kindLabel,
  INVOICE_TAX,
  INVOICE_NOT_A_RECEIPT,
  INVOICE_PROVENANCE,
  INVOICE_VOID_NOTICE,
  type CoachInvoice,
  type CoachInvoiceInput,
  type InvoiceDraft,
} from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

/* ── fixtures ──────────────────────────────────────────────────────────── */

const INV: CoachInvoice = {
  id: 'i1',
  seq: 7,
  billTo: 'Dana Okafor',
  description: '8 personal training sessions',
  amountCents: 48000,
  currency: 'GBP',
  kind: 'requested',
  issuedOn: '2026-08-31',
  note: 'Block booked, to be used within 12 weeks.',
  voidedAt: null,
  voidReason: null,
};

const base = (over: Partial<CoachInvoiceInput> = {}): CoachInvoiceInput => ({
  invoice: INV,
  issuer: { status: 'ready', name: 'Sam Whitfield', brand: 'Ironhaus Strength' },
  ...over,
});

const withInv = (over: Partial<CoachInvoice>): CoachInvoiceInput =>
  base({ invoice: { ...INV, ...over } });

/* ── 1. no tax, anywhere, ever ─────────────────────────────────────────────
   The single most important assertion in this file. Nothing in this app knows
   a coach's country, their registration status, where their client is, or what
   the thing sold attracts — so ANY tax figure would be invented, and invented
   under somebody's name on a document they hand to a customer. */

{
  const d = coachInvoiceDoc(base());
  // The standing statements are cut out before the scan: INVOICE_TAX uses the
  // word "tax" precisely in order to deny it, and scanning it would make the
  // rule fail on its own disclaimer.
  let prose = (d.html + '\n' + d.text).toLowerCase();
  for (const stated of [INVOICE_TAX, INVOICE_NOT_A_RECEIPT, ...INVOICE_PROVENANCE]) {
    prose = prose.split(stated.toLowerCase()).join(' ').split(escapeHtml(stated).toLowerCase()).join(' ');
  }
  const forbidden = [
    'vat', 'gst', 'sales tax', 'tax rate', 'taxable', 'net of', 'gross of',
    'subtotal', 'ex. tax', 'incl. tax', 'withholding', 'tax number', 'tin',
    'reverse charge', 'zero-rated', 'exempt',
  ];
  for (const f of forbidden) {
    ok(!prose.includes(f), `an invoice from this app states no tax of any kind — found "${f}"`);
  }
  ok(d.html.includes(escapeHtml(INVOICE_TAX).slice(0, 60)), 'and it says outright that no tax has been calculated');
  ok(d.text.includes(INVOICE_TAX), 'in the text fallback as well as the HTML');
  ok(d.text.includes(INVOICE_NOT_A_RECEIPT), 'and that it is not a payment receipt');
}

{
  // The statements survive the emptiest document this can build — a voided one
  // for an unnamed issuer, where there is least to say and most temptation to
  // fill the page.
  const d = coachInvoiceDoc(base({
    invoice: { ...INV, note: null, voidedAt: '2026-08-31T09:00:00Z', voidReason: 'issued twice' },
    issuer: { status: 'error', name: null, brand: null },
  }));
  ok(d.text.includes(INVOICE_TAX), 'a voided invoice with an unreadable issuer still carries the tax statement');
  ok(d.text.includes(INVOICE_NOT_A_RECEIPT), 'and still says it is not a receipt');
}

/* ── 2. no figure without its currency ─────────────────────────────────────
   Repple is white-labelled: tenants.currency is nullable on purpose and null
   means "nobody has told us". A bare number on an invoice is not an amount of
   money, and a number in a currency we picked is a different amount of money
   from the one that was charged. */

{
  const d = coachInvoiceDoc(base());
  ok(d.html.includes('GBP&nbsp;480.00') || d.html.includes('GBP 480.00'), 'the amount is printed with its currency code');
  ok(!/>\s*480\.00\s*</.test(d.html), 'and never as a bare figure in a cell of its own');
  ok(d.complete, 'a whole read with a currency is a complete document');
}

{
  // The column is NOT NULL in part 138, so this should be unreachable — which
  // is exactly why it is asserted: an unreachable branch that prints a blank
  // total is a blank total nobody will ever see coming.
  const d = coachInvoiceDoc(withInv({ currency: null }));
  eq(money({ ...INV, currency: null }), null, 'no currency means no printable amount');
  ok(!d.complete, 'and the document does not call itself complete');
  ok(d.caveats.some((c) => c.includes('not print')) || d.caveats.some((c) => c.toLowerCase().includes('currency')),
    'the missing currency is named in the caveats');
  ok(d.text.includes('Do not read the missing figure as nothing being charged'),
    'and the page says so where the total would be — a blank total reads as nothing owed');
}

{
  // A currency with no minor unit is not divided by a hundred. Getting this
  // backwards bills ¥500 for a ¥50,000 session.
  eq(money({ ...INV, amountCents: 50000, currency: 'JPY' }), 'JPY 50,000', 'a zero-decimal currency is not divided by 100');
  eq(money({ ...INV, amountCents: 50000, currency: 'GBP' }), 'GBP 500.00', 'and a two-decimal one is');
}

/* ── 3. the typed amount, in minor units ──────────────────────────────────
   Where a hundredfold error would enter. */

{
  eq(draftMinorUnits('45.50', 'GBP'), 4550, 'a decimal amount becomes minor units');
  eq(draftMinorUnits('45,50', 'GBP'), 4550, 'a comma decimal is accepted — half the world types it that way');
  eq(draftMinorUnits('45', 'GBP'), 4500, 'a whole amount too');
  eq(draftMinorUnits('50000', 'JPY'), 50000, 'a zero-decimal currency is not multiplied by 100');
  eq(draftMinorUnits('500.50', 'JPY'), null, 'and a decimal in one is refused rather than silently rounded');
  eq(draftMinorUnits('0', 'GBP'), null, 'zero is not an amount to invoice');
  eq(draftMinorUnits('-40', 'GBP'), null, 'nor is a negative one');
  eq(draftMinorUnits('45.505', 'GBP'), null, 'three decimal places is not money');
  eq(draftMinorUnits('1,234', 'GBP'), null, 'a thousands separator is refused, not guessed at — "1,234" is two different amounts in two countries');
  eq(draftMinorUnits('45.50', null), null, 'and nothing at all is computed without a currency');
  eq(draftMinorUnits('', 'GBP'), null, 'an empty box is not zero');
}

/* ── 4. what stops an invoice being issued ────────────────────────────────
   Every blocker is a sentence the coach can act on, and they arrive together
   rather than one press at a time. */

{
  const d: InvoiceDraft = { billTo: '', description: '', amountText: '', currency: null, kind: 'requested', issuedOn: '2026-08-31' };
  const b = invoiceBlockers(d);
  eq(b.length, 3, 'three empty fields produce three reasons at once, not the first one');
  ok(b.some((s) => s.includes('who')), 'one of them is the missing name');
  ok(b.some((s) => s.includes('what it is for')), 'one is the missing description');
  ok(b.some((s) => s.includes('white-labelled')), 'and the missing currency says why there is no default rather than inventing one');
}

{
  const good: InvoiceDraft = { billTo: 'Dana', description: '8 sessions', amountText: '480', currency: 'GBP', kind: 'requested', issuedOn: '2026-08-31' };
  eq(invoiceBlockers(good).length, 0, 'a complete draft has nothing stopping it');
  eq(invoiceBlockers({ ...good, currency: 'GB' }).length, 1, 'a currency that is not three letters cannot be printed');
  eq(invoiceBlockers({ ...good, issuedOn: '31/08/2026' }).length, 1, 'a date that will not read is a blocker, not a silent today');
  ok(invoiceBlockers({ ...good, currency: 'JPY', amountText: '500.50' })[0].includes('whole number'),
    'a decimal in a zero-decimal currency is explained in terms of that currency');
}

/* ── 5. the number, and what it does not promise ──────────────────────────
   Gapless per coach inside this app; it knows nothing about the spreadsheet
   the same coach kept last year. */

{
  eq(invoiceNumber(7), '0007', 'zero-padded so a book reads as a sequence');
  eq(invoiceNumber(1), '0001', 'from one');
  eq(invoiceNumber(12345), '12345', 'and nothing is truncated past four digits');
  eq(invoiceNumber(0), '—', 'a number below one is not a number this issued');
  eq(invoiceNumber(Number.NaN), '—', 'nor is one that will not read');
  const d = coachInvoiceDoc(base());
  ok(d.html.includes('Invoice 0007'), 'the number heads the document');
  ok(d.text.includes('INVOICE 0007'), 'and the text fallback');
  ok(/own sequence inside this app/i.test(d.text), 'and the page says whose sequence it is');
  ok(!/20\d\d-0007/.test(d.html), 'the number carries no year prefix — that would imply a reset that does not happen');
}

/* ── 6. a void is loud, and the number stays spent ────────────────────────
   A void nobody notices is worse than no void: the client has already read the
   page once and will not read it again. */

{
  const d = coachInvoiceDoc(withInv({ voidedAt: '2026-08-31T09:00:00Z', voidReason: 'issued twice by mistake' }));
  ok(d.html.includes(escapeHtml(INVOICE_VOID_NOTICE).slice(0, 40)), 'a voided invoice says so on its face');
  ok(d.text.includes('*** VOIDED ***'), 'and in the text fallback, at the top');
  ok(d.text.includes('issued twice by mistake'), 'with the reason the issuer gave');
  ok(d.html.indexOf('Voided') < d.html.indexOf('Charge'), 'and it says it BEFORE the amount, not in a footnote below it');
  ok(d.text.includes('Its number has not been reused'), 'and states that the number is not reused');
  ok(invoiceShareBlurb(d, { ...INV, voidedAt: '2026-08-31T09:00:00Z' }).includes('VOIDED'),
    'the share sheet warns before a voided document leaves the phone');
}

/* ── 7. read honesty: a document built from a failed read says so ─────────
   'loading' collapses into unreadable for the same reason it does in
   clientReport.ts: a document is built and sent in one gesture, so a read still
   in flight will never be filled in. */

{
  eq(issuerCaveat('ready'), null, 'a landed read needs no caveat');
  ok(issuerCaveat('error') !== null, 'a refused one does');
  ok(issuerCaveat('loading') !== null, 'and so does one still in flight — it is not treated as read');
  ok(issuerCaveat('partial') !== null, 'and a truncated one');
  eq(invoiceCaveats(base()).length, 0, 'a whole read produces no caveats');
}

{
  const d = coachInvoiceDoc(base({ issuer: { status: 'error', name: null, brand: 'Ironhaus Strength' } }));
  ok(!d.complete, 'an unreadable issuer means the document is not complete');
  ok(d.html.includes('Not read.'), 'and the From line says NOT READ where the name would go');
  ok(d.text.includes('This is not a statement that the record has no name in it'),
    'and refuses to let a failed read be read as an absent name');
  ok(!d.html.includes('Repple'), 'a failed issuer read never falls back to the platform’s own name on a financial document');
  ok(d.text.includes('PARTS OF THIS COULD NOT BE READ'), 'the caveat is repeated at the top where it cannot be scrolled past');
}

{
  // An issuer who simply has no name recorded is a different sentence from one
  // whose name could not be read, and the two must not collapse.
  const d = coachInvoiceDoc(base({ issuer: { status: 'ready', name: null, brand: 'Ironhaus Strength' } }));
  ok(d.complete, 'a read that landed and found no name is complete — the record genuinely has none');
  ok(d.text.includes('has not recorded a name'), 'and says that, rather than "could not be read"');
  ok(!d.text.includes('NOT READ'), 'the two are not collapsed into one sentence');
}

/* ── 8. every typed value is escaped ──────────────────────────────────────
   Four values on this page were typed by a person, and the brand is a
   white-label customer's own string. A description that closes the table takes
   the amount off the page with it — on a document about money. */

{
  const d = coachInvoiceDoc(base({
    invoice: { ...INV, billTo: 'Ann & Bob <script>', description: '8 x 1hr "PT" <sessions> & travel', note: "R&D's block" },
    issuer: { status: 'ready', name: 'S & M Coaching', brand: 'Ann & Bob <b>Fit</b>' },
  }));
  ok(!/<script>/.test(d.html), 'a typed tag never reaches the markup');
  ok(!/<b>Fit<\/b>/.test(d.html), 'nor does one typed into the white-label brand');
  ok(d.html.includes('Ann &amp; Bob'), 'an ampersand survives as an entity rather than eating the next word');
  ok(d.html.includes('&lt;sessions&gt;'), 'and angle brackets in a description are shown, not obeyed');
  ok(d.html.includes('GBP 480.00'), 'and the amount is still on the page after all of it');
  eq(escapeHtml(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&#39;f', 'all five replacements');
  eq(escapeHtml(null), '', 'and null is an empty string, never the word null');
}

/* ── 9. the kind is the coach's claim, never a verified state ─────────────*/

{
  eq(kindLabel('received'), 'Stated received', 'the list hedges it');
  eq(kindLabel('requested'), 'Stated requested', 'both ways');
  const d = coachInvoiceDoc(withInv({ kind: 'received' }));
  ok(d.text.includes('The issuer states this amount has been received'), 'the document attributes the claim to the issuer');
  ok(!/\bPAID\b/.test(d.html), 'and never stamps the document PAID, which would read as verification');
  ok(!/\boverdue\b/i.test(d.html), 'nor overdue, which would need a due date this app does not collect');
}

/* ── 10. dates are read off the string, never through new Date() ──────────
   `new Date('2026-08-01')` is UTC midnight, which is 31 July west of
   Greenwich — an invoice dated the day before it was issued for a third of the
   world. The suite runs under three timezones (test:zones) and this is the
   assertion that would fail in one of them. */

{
  eq(invoiceDayLabel('2026-01-01'), '1 Jan 2026', 'the first of January stays the first of January');
  eq(invoiceDayLabel('2026-12-31'), '31 Dec 2026', 'and the last of December');
  eq(invoiceDayLabel('2026-08-31T22:30:00Z'), '31 Aug 2026', 'a timestamp is cut to its calendar day, not shifted by one');
  eq(invoiceDayLabel(''), '—', 'an empty date is a dash');
  eq(invoiceDayLabel('31/08/2026'), '—', 'and an unparseable one is a dash rather than a guess');
  eq(invoiceDayLabel('2026-13-01'), '—', 'a month that does not exist is a dash');
}

/* ── 11. the book: currencies are never added, voids are never hidden ─────*/

{
  const rows: CoachInvoice[] = [
    { ...INV, id: 'a', seq: 1, amountCents: 48000, currency: 'GBP' },
    { ...INV, id: 'b', seq: 2, amountCents: 6000, currency: 'GBP' },
    { ...INV, id: 'c', seq: 3, amountCents: 9000, currency: 'EUR' },
    { ...INV, id: 'd', seq: 4, amountCents: 100000, currency: 'GBP', voidedAt: '2026-08-30T00:00:00Z', voidReason: 'duplicate' },
    { ...INV, id: 'e', seq: 5, amountCents: 5000, currency: null },
  ];
  const b = invoiceBook(rows, 'ready');
  eq(b.totals?.pots.length, 2, 'two currencies stay two pots, never one number');
  eq(b.totals?.pots[0].currency, 'GBP', 'the biggest pot first');
  eq(b.totals?.pots[0].minorUnits, 54000, 'and the voided invoice is NOT in it');
  eq(b.totals?.pots[1].minorUnits, 9000, 'the euro one stands alone');
  eq(b.totals?.unlabelled, 1, 'an amount with no currency is counted, never dropped and never added');
  eq(b.voided, 1, 'the voided one is reported rather than silently subtracted');
  eq(b.live, 4, 'and the count that stands is stated beside it');
  eq(b.reason, null, 'a whole read has no reason to withhold a total');
}

{
  const rows: CoachInvoice[] = [{ ...INV }];
  eq(invoiceBook(rows, 'partial').totals, null, 'a truncated read states no total — a sum over a prefix is not a smaller total, it is a wrong one');
  ok((invoiceBook(rows, 'partial').reason ?? '').includes('not all of them'), 'and says why');
  eq(invoiceBook(rows, 'error').totals, null, 'nor does a failed one');
  ok((invoiceBook(rows, 'error').reason ?? '').includes('does not mean you have issued none'),
    'and an empty list under error is not "you have issued none"');
  eq(invoiceBook([], 'ready').totals?.pots.length, 0, 'a coach who has issued nothing gets an honest empty book');
  eq(invoiceBook([], 'ready').reason, null, 'which is a real answer, not a withheld one');
}

/* ── 12. nothing leaves this file that could carry a photo or a link ──────
   An invoice is a file: it gets mailed, forwarded, printed, and sits in
   somebody's downloads folder for years. Nothing in this module takes an image
   or a URL, and the assertion is what keeps it that way. */

{
  const d = coachInvoiceDoc(base());
  ok(!/<img/i.test(d.html), 'no image tag anywhere in the document');
  ok(!/https?:\/\//i.test(d.html), 'no http(s) URL — a signed URL would arrive as one');
  ok(!/https?:\/\//i.test(d.text), 'nor in the text fallback');
  ok(!/file:|blob:|data:image/i.test(d.html), 'and no local, blob or embedded-image reference either');
}

/* ── 13. the white-label brand, and the platform name that is not it ──────*/

{
  const d = coachInvoiceDoc(base());
  ok(d.html.includes('Ironhaus Strength'), 'the tenant brand reaches the document');
  ok(!d.html.includes('Repple'), 'and the platform name appears nowhere on a coach’s invoice');
  const noBrand = coachInvoiceDoc(base({ issuer: { status: 'ready', name: 'Sam Whitfield', brand: null } }));
  ok(!noBrand.html.includes('Repple'), 'a missing brand prints no brand rather than substituting the platform');
  ok(!noBrand.html.includes('undefined') && !noBrand.html.includes('null'), 'and never prints the word undefined or null');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH INVOICE FAILURES:\n' + errors.join('\n') : 'ALL COACH INVOICE TESTS PASSED');
if (errors.length) process.exit(1);
