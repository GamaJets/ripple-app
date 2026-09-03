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
  INVOICE_TAX_STATED,
  readTaxRate,
  statesTax,
  INVOICE_NOT_A_RECEIPT,
  INVOICE_SETTLEMENT_IS_YOUR_WORD,
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

/* ── 1b. what the COACH states about tax ──────────────────────────────────
   Part 451. A rate and a registration number the coach typed are stated facts
   about the issuer, exactly as `billTo` is a stated fact about the recipient —
   printed verbatim, checked by nothing. What must NOT appear is anything
   Repple worked out: no tax amount, no net figure, no subtotal. */

{
  // The reader, on its own. THREE outcomes and not two.
  const r = (s: string | null | undefined) => readTaxRate(s);
  eq(r('').ok && r('').ok === true ? (r('') as { ok: true; pct: number | null }).pct : 'x', null,
    'an empty box means the coach stated no rate');
  eq((r('20') as { ok: true; pct: number }).pct, 20, 'a whole rate is read as one');
  eq((r('12.5') as { ok: true; pct: number }).pct, 12.5, 'and a fractional one keeps its half');
  eq((r('12,5') as { ok: true; pct: number }).pct, 12.5, 'a comma decimal is accepted — half the world types it');
  eq((r('20%') as { ok: true; pct: number }).pct, 20, 'and a typed per-cent sign is not a refusal');
  // A stated zero is NOT the same as an empty box. A registered business
  // stating a zero rate has said something deliberate.
  eq((r('0') as { ok: true; pct: number }).pct, 0, 'a stated zero is a statement, not an absence');
  ok(!r('120').ok, 'a rate above a hundred is refused rather than clamped to it');
  ok(!r('-5').ok, 'and so is a negative one');
  ok(!r('twenty').ok, 'and a word');
  ok(!r('20.0005').ok, 'and more places than the column can hold');

  eq(statesTax(INV), false, 'an invoice with neither field states nothing about tax');
  eq(statesTax({ ...INV, taxRatePct: 0 }), true, 'a stated zero rate IS a statement');
  eq(statesTax({ ...INV, taxRatePct: null, taxRegistration: 'GB123456789' }), true, 'and so is a number on its own');
  eq(statesTax({ ...INV, taxRegistration: '   ' }), false, 'a blank registration number is not one');

  // The document. Both fields print verbatim and NOTHING is derived from them.
  const d = coachInvoiceDoc(withInv({ taxRatePct: 20, taxRegistration: 'GB123456789', amountCents: 48000, currency: 'GBP' }));
  ok(d.text.includes('20%'), 'the stated rate is on the document');
  ok(d.text.includes('GB123456789'), 'and so is the registration number');
  ok(d.html.includes('GB123456789'), 'in the HTML as well as the text');
  ok(d.text.includes(INVOICE_TAX_STATED), 'and the tax sentence is the one for a document that states something');
  ok(!d.text.includes(INVOICE_TAX),
    'never both: the old sentence denies that a registration number is stated, and this document states one');
  ok(INVOICE_TAX_STATED.includes('no tax amount anywhere on this document'),
    'and it still says Repple calculated nothing, because Repple calculated nothing');

  // THE assertion. 20% of GBP 480.00 is GBP 96.00 and the net would be GBP
  // 400.00. Neither figure may appear anywhere, in either rendering, ever.
  // The standing statement is cut out before the scan, for the reason section 1
  // cuts INVOICE_TAX out of its own: `INVOICE_TAX_STATED` uses the word
  // "subtotal" precisely in order to deny there is one, and scanning it would
  // make the rule fail on its own disclaimer.
  let derivedProse = d.text + '\n' + d.html;
  for (const stated of [INVOICE_TAX_STATED, INVOICE_NOT_A_RECEIPT, ...INVOICE_PROVENANCE]) {
    derivedProse = derivedProse.split(stated).join(' ').split(escapeHtml(stated)).join(' ');
  }
  for (const derived of ['96.00', '400.00', '384.00', 'Subtotal', 'subtotal', 'Net', 'VAT']) {
    ok(!derivedProse.includes(derived),
      `nothing is derived from the stated rate — found "${derived}"`);
  }
  // The only money on the page is still the flat amount charged, twice: once
  // against the description and once as the total.
  eq(d.text.split('GBP 480.00').length - 1, 2, 'the amount charged appears as the line and as the total, and nowhere else');

  // A rate on its own, and a number on its own, are each enough to switch the
  // sentence — and a stated zero rate prints as a zero rather than vanishing.
  ok(coachInvoiceDoc(withInv({ taxRatePct: 0 })).text.includes('0%'), 'a stated zero rate is printed');
  ok(coachInvoiceDoc(withInv({ taxRatePct: 0 })).text.includes(INVOICE_TAX_STATED), 'and carries the stated sentence');
  ok(!coachInvoiceDoc(withInv({})).text.includes('Rate stated by the issuer'),
    'an invoice stating no rate prints no rate line rather than "none" or "0%"');
  ok(!coachInvoiceDoc(withInv({})).text.includes('registration number:'),
    'and no registration line either');

  // A typed registration number is a person's typed string and goes through
  // escaping like every other one. Without it a number containing an angle
  // bracket takes the rest of the document with it.
  const nasty = coachInvoiceDoc(withInv({ taxRegistration: 'GB<script>1</script>' }));
  ok(!nasty.html.includes('<script>'), 'a typed registration number cannot break the markup');
  ok(nasty.html.includes('&lt;script&gt;'), 'it is escaped rather than stripped');

  // And the blockers refuse a rate rather than correcting one.
  const good: InvoiceDraft = { billTo: 'Dana', description: '8 sessions', amountText: '480', currency: 'GBP', kind: 'requested', issuedOn: '2026-08-31' };
  eq(invoiceBlockers({ ...good, taxRateText: '20' }).length, 0, 'a stated rate does not block an invoice');
  eq(invoiceBlockers({ ...good, taxRateText: '' }).length, 0, 'nor does an empty one — both fields are optional');
  eq(invoiceBlockers({ ...good, taxRateText: '120' }).length, 1, 'a rate above a hundred is refused');
  eq(invoiceBlockers({ ...good, taxRegistration: 'X'.repeat(61) }).length, 1, 'and a registration number longer than the column');
  eq(invoiceBlockers({ ...good, taxRegistration: 'X'.repeat(60) }).length, 0, 'but not one that fits');
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

  // The other end of the same mistake, and the half this function used to get
  // wrong. A Kuwaiti dinar has a THOUSAND fils in it, so 12.500 is 12500 minor
  // units. Multiplied by a hundred it was 1250 — KWD 1.250, a tenth of the
  // amount, printed on a document under the coach's own name.
  eq(draftMinorUnits('12.500', 'KWD'), 12500, 'a three-decimal currency is multiplied by a THOUSAND, not a hundred');
  eq(draftMinorUnits('12.500', 'kwd'), 12500, 'and the code is read case-insensitively');
  eq(draftMinorUnits('12.5', 'KWD'), 12500, 'a short fraction is padded to the currency’s own places, not read as hundredths');
  eq(draftMinorUnits('12', 'BHD'), 12000, 'and a whole dinar is a thousand fils');
  eq(draftMinorUnits('12.345', 'KWD'), null, 'Stripe charges thousandths in tens, so a fils in the last place is refused rather than rounded');
  eq(draftMinorUnits('12.5000', 'KWD'), null, 'four places is not an amount in a three-place currency');
  eq(draftMinorUnits('40.00', 'OMR'), 40000, 'and the same holds for every one of the five');
  eq(draftMinorUnits('0.000', 'KWD'), null, 'a nought is still not an amount to invoice, whatever the currency');
}

/* ── 3b. the refusal carries the reason, and the reason names the currency ─
   A coach in Kuwait told "at most two decimal places" about a three-place
   currency goes back to the box with no idea what is wrong with what they
   typed. The blocker quotes the reader rather than a sentence written here. */

{
  const kw: InvoiceDraft = { billTo: 'Nasser', description: 'Ten pack', amountText: '12.345', currency: 'KWD', kind: 'requested', issuedOn: '2026-08-31' };
  const b = invoiceBlockers(kw);
  eq(b.length, 1, 'one blocker, about the amount');
  ok(/KWD/.test(b[0]), 'and it names the currency it is talking about');
  ok(!/two decimal/i.test(b[0]), 'and never says "two decimal places" about a three-place currency');
  eq(invoiceBlockers({ ...kw, amountText: '12.500' }).length, 0, 'a real dinar amount is not blocked');

  const jp = invoiceBlockers({ ...kw, currency: 'JPY', amountText: '500.50' });
  eq(jp.length, 1, 'a decimal in yen is one blocker');
  ok(/JPY/.test(jp[0]), 'and it says which currency has no smaller unit');
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

/* ── 14. THE FIFTH CLAIM, WHICH IS AN ADDITION AND NOT AN EDIT ────────────
   Part 660 lets a coach record that a 'requested' invoice was paid. The header
   of coachInvoice.ts lists exactly five things this document claims and is
   careful to claim no sixth; the whole risk of the fifth is that it looks like
   a change to the fourth.

   It is not. `kind` is untouched, on the row and on the page, and the
   settlement is printed beside it as a separate statement with its own date and
   its own hedge. Every assertion here is aimed at somebody "simplifying" this
   later by flipping `kind` to 'received' instead. */

{
  const paid = withInv({ kind: 'requested', settledOn: '2026-08-20', settledAt: '2026-08-20T09:00:00.000Z', settleNote: 'Bank transfer' });
  const d = coachInvoiceDoc(paid);

  ok(d.text.includes('The issuer states this amount is being requested.'),
    'the claim the document was issued with survives a settlement, word for word');
  ok(d.text.includes('the issuer states this was paid on 20 Aug 2026'),
    'and the settlement is printed beside it, dated');
  ok(d.text.includes('How the issuer says it arrived: Bank transfer'),
    'with the coach’s own words about how, where they gave any');
  ok(d.text.includes(INVOICE_SETTLEMENT_IS_YOUR_WORD),
    'and the hedge that says nothing checked it, exactly as `kind` carries one');
  ok(d.html.includes('Settled:'), 'and it is on the HTML document as well as in the text');

  // Not on a document that does not carry one. A paragraph about a claim the
  // document does not make is how the tax sentence came to need two versions.
  const unsettled = coachInvoiceDoc(withInv({ kind: 'requested' }));
  ok(!unsettled.text.includes(INVOICE_SETTLEMENT_IS_YOUR_WORD),
    'and appears on no document that has not been settled');
  ok(!unsettled.text.includes('Settled:'), 'which prints no settlement line either');

  // A note with no settlement behind it prints nothing — the column has a CHECK
  // saying the same thing, and this is the reader agreeing with it.
  const orphan = coachInvoiceDoc(withInv({ kind: 'requested', settleNote: 'Bank transfer' }));
  ok(!orphan.text.includes('Bank transfer'), 'a settle note with no settlement behind it prints nothing');

  // The escaping still holds. `settle_note` is a fifth value a person typed, so
  // it goes through the same five replacements as the other four — a note
  // reading "cash <in hand>" must not take the rest of the invoice with it.
  const nasty = coachInvoiceDoc(withInv({
    kind: 'requested', settledOn: '2026-08-20', settledAt: '2026-08-20T09:00:00.000Z',
    settleNote: 'cash <in hand> & counted',
  }));
  ok(nasty.html.includes('cash &lt;in hand&gt; &amp; counted'), 'a typed settle note is escaped like every other typed value');
  ok(!nasty.html.includes('<in hand>'), 'and reaches the page as text rather than as markup');

  // And a chase date reaches no document at all. It is the coach's own working
  // note, the client never agreed to it, and printing it would turn it into the
  // term `CHASE_FROM_IS_NOT_A_DUE_DATE` says it is not.
  const planned = coachInvoiceDoc(withInv({ kind: 'requested', dueOn: null, chaseFrom: '2026-09-15' }));
  ok(!planned.text.includes('15 Sep 2026'), 'a chase date is on no document');
  ok(!planned.html.includes('15 Sep 2026'), 'in either form');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH INVOICE FAILURES:\n' + errors.join('\n') : 'ALL COACH INVOICE TESTS PASSED');
if (errors.length) process.exit(1);
