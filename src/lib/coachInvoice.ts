// The document a self-employed trainer hands to the person who paid them.
//
// ── What was there before, and why it was not this ─────────────────────────
//
// Stripe Connect takes the money (src/lib/connect.ts) and produces NOTHING a
// coach can give anybody. A `client_purchases` row is a line in this app's own
// ledger: it has no number, no name on it, no statement of what was sold, and
// no existence at all for the half of a working coach's book that pays in
// cash, by bank transfer, or through a gym's front desk. So the question "can
// you send me something for that?" had no answer, and the coach had no record
// of what they had already sent to whom.
//
// ── What this document CLAIMS ──────────────────────────────────────────────
//
// Exactly four things, and it is careful to claim no fifth:
//
//   1. that a named coach issued it, on a stated date;
//   2. that it is number N in THAT COACH's own sequence inside this app;
//   3. that the charge was a stated amount, in a stated currency, for a stated
//      thing, to a stated person;
//   4. whether the coach says the money has been received or is being asked
//      for — labelled, both times, as the coach's own word.
//
// ── What it does NOT claim, and says so on its own face ────────────────────
//
// IT IS NOT A TAX INVOICE. There is no tax rate on it, no tax amount, no
// net/gross split, and no VAT or GST registration number — not blank fields,
// not zeros: the concepts are absent. Tax treatment turns on the coach's
// country, their registration status, where the client is and what was sold,
// none of which Repple knows or asks. A "VAT 0.00" line would be a statement
// about somebody's tax affairs, printed under their name, and it would be
// wrong for most of them. `INVOICE_TAX` below says this in words on the page,
// and the test asserts it is on every document this module can build.
//
// IT IS NOT PROOF THAT MONEY MOVED. Repple does not reconcile this against
// Stripe, a bank, or anything else. Where Stripe did take the payment, Stripe's
// own receipt is the artefact that proves it, and this one says so.
//
// ITS NUMBER IS NOT A REGISTERED SEQUENCE. It is gapless per coach WITHIN this
// app (part 138 allocates it under an advisory lock behind a unique index), and
// it knows nothing whatever about invoices the same coach wrote in a
// spreadsheet last year. Many tax regimes want a single unbroken sequence
// across everything a business issues; this cannot promise that, so it says
// what it can promise instead of implying the rest.
//
// ── Read honesty ───────────────────────────────────────────────────────────
//
// The invoice row itself is one read, and the coach's own name and brand are
// another. Either can fail alone. A document that printed an empty "From" — or
// silently fell back to the platform's name — would put the wrong business on
// a financial document. So the builder takes a LoadStatus for the issuer and
// prints the failure where the name would have gone, the same discipline
// src/lib/clientReport.ts keeps for a clinician's copy.
//
// Pure, framework-free and asserted against under plain `node`.

import type { LoadStatus } from '../ui/loadStatus';
// The money formatter is NOT rewritten here. coachMoney.ts already refuses to
// print an amount whose currency it was not told — returning null rather than
// guessing — and already knows which currencies have no minor unit, so ¥50,000
// does not print as ¥500. An invoice is the last place in this app that may
// have a second opinion about how much money something is.
import { minorMoney, sumTaken, ZERO_DECIMAL, type Taken, type TakenRow } from './coachMoney';

/* ── what the caller hands over ───────────────────────────────────────────── */

/**
 * What the coach says about the money — and nothing more.
 *
 * 'received' is "I have been paid"; 'requested' is "I am asking". Repple checks
 * neither, and the document prints each as the coach's own statement rather
 * than as a fact the platform is standing behind. There is deliberately no
 * third value: 'overdue' would require a due date this app does not collect and
 * a clock it does not run, and 'paid' unqualified would read as verification.
 */
export type InvoiceKind = 'received' | 'requested';

/** One issued document, as part 138 stores it. */
export interface CoachInvoice {
  id: string;
  /** This coach's own number, from 1. Never reused, including after a void. */
  seq: number;
  billTo: string;
  description: string;
  /** Minor units, matching every other amount in this app. */
  amountCents: number | null;
  /** ISO 4217, uppercase. NULL should be impossible — the column is NOT NULL —
   *  but a null here prints a dash and a caveat rather than an amount in a
   *  currency nobody stated. An invoice with the wrong three letters on it is
   *  worse than no invoice: it reads as a considered figure and it is a
   *  different amount of money. */
  currency: string | null;
  kind: InvoiceKind;
  /** `YYYY-MM-DD`. */
  issuedOn: string;
  note?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  clientId?: string | null;
  createdAt?: string | null;
}

/**
 * Who is issuing it.
 *
 * `status` is the honesty of the read that produced the name. A financial
 * document with the wrong business on the "From" line is a worse artefact than
 * one that says the name could not be read, so the failure is printed rather
 * than papered over with the platform's own name.
 */
export interface InvoiceIssuer {
  status: LoadStatus;
  /** The coach's own name, as their profile has it. */
  name: string | null;
  /** The white-label brand this copy of the app runs under. A customer's typed
   *  string — hence every value on this page goes through escapeHtml. */
  brand: string | null;
}

export interface CoachInvoiceInput {
  invoice: CoachInvoice;
  issuer: InvoiceIssuer;
}

export interface CoachInvoiceDoc {
  html: string;
  text: string;
  /** True only when everything the document states could be read. The screen
   *  uses it to word the share sheet before the file leaves the phone. */
  complete: boolean;
  /** One sentence per thing that could not be read. Printed ON the document as
   *  well as returned, because the caveat has to travel with the file. */
  caveats: string[];
}

/* ── the standing statements ──────────────────────────────────────────────── */

/**
 * What this document is. Printed on it, every time.
 *
 * Constants rather than inline strings so they cannot be softened on one screen
 * and left alone on another, and so the test can assert each is present in
 * every document this module builds — including a voided one.
 */
export const INVOICE_PROVENANCE = [
  'This document was created by the person named as the issuer, in their own app, from figures they entered themselves.',
  'The number on it is that person’s own sequence inside this app, counting from one. It is unbroken within this app and it does not cover anything they issued anywhere else.',
];

/**
 * The tax sentence. The single most important line on the page.
 *
 * An invoice is the artefact somebody would be most tempted to "finish" with a
 * VAT box. Nothing in this app knows a coach's country, their registration
 * status, where their client is, or what tax the thing sold attracts — so any
 * tax figure it printed would be invented, and invented under somebody's name
 * on a document they hand to a customer.
 */
export const INVOICE_TAX =
  'No tax has been calculated, added or withheld. The amount shown is the amount charged, flat. This is not a tax invoice, no tax registration number is stated on it, and it should not be used as a tax document without your own accountant confirming what it needs to say.';

/**
 * That the platform is not standing behind the payment.
 *
 * `kind` is the coach's own claim. Where Stripe actually took the money, the
 * receipt Stripe sent is the artefact that proves it, and a client comparing
 * the two is entitled to know which one is which.
 */
export const INVOICE_NOT_A_RECEIPT =
  'Whether this says the money was received or is being requested is the issuer’s own statement. It has not been checked against a bank or a card processor, and it is not a payment receipt from one.';

/** Said on a voided document, because a void that is not shouted is a void
 *  nobody notices on a page they have already read once. */
export const INVOICE_VOID_NOTICE =
  'THIS INVOICE HAS BEEN VOIDED BY THE ISSUER. It is not payable and it is not a record of a charge that stands. Its number has not been reused.';

/* ── read honesty ─────────────────────────────────────────────────────────── */

/**
 * The sentence a failed issuer read puts on the page, or null when it landed.
 *
 * 'loading' collapses into a caveat for the same reason it does in
 * clientReport.ts: a document is built and handed over in one gesture, so a
 * read still in flight is a read that did not answer.
 */
export function issuerCaveat(status: LoadStatus): string | null {
  if (status === 'ready') return null;
  if (status === 'partial') {
    return 'Issuer details: more was on record than could be read in one request. What is printed is real and it may not be all of it.';
  }
  return 'Issuer details: the name of the person issuing this could not be read when the document was made. The From line is EMPTY BECAUSE OF A FAILED READ — do not treat the missing name as the name being absent from the record.';
}

/** Every caveat this document has to carry. Empty means everything read. */
export function invoiceCaveats(input: CoachInvoiceInput): string[] {
  const out: string[] = [];
  const iss = issuerCaveat(input.issuer.status);
  if (iss) out.push(iss);
  // An amount that cannot be printed with its unit is a hole in the one figure
  // the document exists for. It is said out loud rather than rendered as a
  // dash somebody might read as "nothing owed".
  if (money(input.invoice) === null) {
    out.push('Amount: this document could not state the amount in a currency. A figure with no currency on it is not an amount of money, so no figure is printed. Do not read the missing amount as nothing being charged.');
  }
  return out;
}

/* ── plumbing ─────────────────────────────────────────────────────────────── */

/**
 * Text into HTML.
 *
 * Not decoration, and not optional. Four values on this page were typed by a
 * person: the client's name, the description of what was sold, the coach's
 * note, and the white-label brand — which in this app IS a customer's typed
 * string. "Ann & Bob" renders as "Ann Bob" without this, and a description
 * reading "8 x 1hr <PT> sessions" takes the rest of the invoice with it. On a
 * document about money, a line that silently vanishes is the whole failure.
 *
 * Deliberately the same five replacements as src/lib/clientReport.ts and the
 * `esc` in src/lib/exportShare.ts rather than a fourth private variant.
 */
export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The number as it is printed: zero-padded to four so a book of invoices sorts
 * and reads as a sequence rather than as a list of unrelated integers.
 *
 * No year prefix and no coach initials. A `2026-0007` implies the count resets
 * each year, which this sequence does not do, and a reader who assumes it does
 * will read a January invoice numbered 0412 as a year's worth of missing
 * paperwork. Above 9999 it simply grows; nothing is truncated.
 */
export function invoiceNumber(seq: number): string {
  if (!Number.isFinite(seq) || seq < 1) return '—';
  return String(Math.floor(seq)).padStart(4, '0');
}

/** The amount with its currency, or null when either half is missing. Never a
 *  bare number: a figure on an invoice with no currency beside it is the exact
 *  mistake this app refuses to make anywhere else. */
export const money = (i: CoachInvoice): string | null => minorMoney(i.amountCents, i.currency);

/** What the coach said about the money, worded as their claim rather than as a
 *  verified state. */
export const kindLine = (kind: InvoiceKind): string =>
  kind === 'received'
    ? 'The issuer states this amount has been received.'
    : 'The issuer states this amount is being requested.';

/** The short form, for a list row. Same two words, same hedge. */
export const kindLabel = (kind: InvoiceKind): string =>
  kind === 'received' ? 'Stated received' : 'Stated requested';

/**
 * `YYYY-MM-DD` as a person reads it, without going through `new Date(s)`.
 *
 * `new Date('2026-08-01')` is UTC midnight, which is 31 July for anybody west
 * of Greenwich — so a naive format dates an invoice the day before it was
 * issued for a third of the world. The parts are formatted from the string.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function invoiceDayLabel(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '—';
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return '—';
  return `${Number(m[3])} ${MONTHS[mi]} ${m[1]}`;
}

/* ── issuing: what stops one being issued ─────────────────────────────────── */

/** What the coach typed, before it is anything. */
export interface InvoiceDraft {
  billTo: string;
  description: string;
  /** What was typed in MAJOR units — "45.50" — because that is what a person
   *  types. Converted once, here, so no screen does it twice. */
  amountText: string;
  currency: string | null;
  kind: InvoiceKind;
  issuedOn: string;
  note?: string | null;
}

/**
 * The typed amount in minor units, or null when it is not an amount.
 *
 * `zeroDecimal` says the currency has no subdivision — there are no fils in a
 * yen — so 50000 JPY is 50000 minor units and not 5,000,000. Getting this
 * backwards on an invoice charges somebody a hundred times too much, which is
 * why it is decided here and asserted rather than done inline on a screen.
 *
 * A comma decimal separator is accepted: half the world types "45,50", and
 * `Number('45,50')` is NaN, which would have refused the invoice rather than
 * mispricing it — but refusing a perfectly ordinary amount is still a coach
 * who cannot bill their client.
 */
export function draftMinorUnits(amountText: string, currency: string | null): number | null {
  const raw = String(amountText ?? '').trim().replace(/\s/g, '');
  if (!raw) return null;
  // One separator only, and it is the decimal point. A thousands separator is
  // not accepted rather than guessed at: "1,234" is one thousand in London and
  // one and a bit in Berlin, and an invoice is not the place to pick one.
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cur = (currency || '').trim().toLowerCase();
  if (!cur) return null;
  const zero = ZERO_DECIMAL_LOWER.has(cur);
  if (zero) {
    // No subdivision to hold a fraction. A typed "500.50" in yen is a typo, not
    // an amount, and rounding it silently would bill a number nobody chose.
    if (/[.,]/.test(raw)) return null;
    return Math.round(n);
  }
  return Math.round(n * 100);
}

/** coachMoney.ts's own list, aliased rather than copied. A second hand-written
 *  set of the currencies with no minor unit is a second thing to get wrong, and
 *  getting it wrong here charges somebody a hundred times too much. */
const ZERO_DECIMAL_LOWER: ReadonlySet<string> = ZERO_DECIMAL;

/**
 * Every reason this draft cannot be issued, in the words the coach reads.
 *
 * A list rather than the first failure: somebody who has left three fields
 * empty should be told all three at once, not made to press Issue three times.
 * An empty list means it can go.
 */
export function invoiceBlockers(d: InvoiceDraft): string[] {
  const out: string[] = [];
  if (!String(d.billTo ?? '').trim()) out.push('Say who this invoice is for. The name you type is the name printed on it.');
  if (!String(d.description ?? '').trim()) out.push('Say what it is for. A charge with no description is not something a client can check against anything.');
  // The currency check comes BEFORE the amount, because without one the amount
  // cannot be interpreted at all — and because "your gym has not set a
  // currency" is a different problem with a different fix.
  const cur = (d.currency || '').trim();
  if (!cur) {
    out.push('No currency has been set, so there is nothing to price this in. Repple is white-labelled and there is no default that is right for every gym — an owner sets it in the gym settings, or you set one on a package.');
  } else if (!/^[A-Za-z]{3}$/.test(cur)) {
    out.push('The currency on record is not a three-letter code, so it cannot be printed on an invoice.');
  } else if (draftMinorUnits(d.amountText, cur) === null) {
    out.push(
      ZERO_DECIMAL_LOWER.has(cur.toLowerCase())
        ? `Enter the amount as a whole number. ${cur.toUpperCase()} has no smaller unit, so there are no decimals to type.`
        : 'Enter the amount as a number greater than zero, with at most two decimal places. An invoice for nothing is not an invoice.',
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.issuedOn ?? ''))) out.push('The date this is issued on could not be read.');
  return out;
}

/* ── the document ─────────────────────────────────────────────────────────── */

const STYLE = `
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:26px;margin:0;font-size:14px;line-height:1.45}
  .h{background:#0f172a;color:#fff;padding:18px 22px;border-radius:14px}
  .h h1{margin:0;font-size:21px} .h p{margin:4px 0 0;opacity:.85;font-size:12px}
  h2{font-size:14px;margin:24px 0 6px;padding-bottom:5px;border-bottom:2px solid #0f172a}
  p{margin:6px 0}
  .lede{color:#475569;font-size:12px}
  .warn{border:2px solid #b45309;border-radius:10px;padding:12px 14px;margin-top:16px}
  .warn h3{margin:0 0 6px;font-size:13px;color:#b45309;text-transform:uppercase;letter-spacing:.5px}
  .warn li{margin-bottom:5px}
  .void{border:3px solid #b91c1c;border-radius:10px;padding:14px 16px;margin-top:16px;color:#b91c1c}
  .void h3{margin:0 0 4px;font-size:15px;text-transform:uppercase;letter-spacing:1px}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .r{text-align:right}
  .tot td{font-weight:800;border-top:2px solid #0f172a;font-size:15px}
  .none{color:#64748b}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px}
`;

/**
 * The whole document, in HTML and in plain text.
 *
 * Both are built from the same values in the same order, so the text a coach
 * sends from a build with no expo-print says exactly what the PDF would have
 * said — including the tax sentence and every caveat. A text fallback that
 * dropped those would be the same failure arriving through the back door.
 */
export function coachInvoiceDoc(input: CoachInvoiceInput): CoachInvoiceDoc {
  const inv = input.invoice;
  const caveats = invoiceCaveats(input);
  const complete = caveats.length === 0;
  const voided = !!inv.voidedAt;
  const brand = (input.issuer.brand || '').trim();
  const issuerName = (input.issuer.name || '').trim();
  const readIssuer = input.issuer.status === 'ready' || input.issuer.status === 'partial';
  const amount = money(inv);
  const no = invoiceNumber(inv.seq);

  const H: string[] = [];
  const T: string[] = [];

  /* ── heading ───────────────────────────────────────────────────────────── */
  H.push(`<div class="h"><h1>Invoice ${escapeHtml(no)}</h1><p>Issued ${escapeHtml(invoiceDayLabel(inv.issuedOn))}${brand ? ' · ' + escapeHtml(brand) : ''}</p></div>`);
  T.push(`INVOICE ${no}`);
  T.push(`Issued ${invoiceDayLabel(inv.issuedOn)}${brand ? ' · ' + brand : ''}`);

  /* ── voided, loudly, before anything else on the page ──────────────────── */
  if (voided) {
    H.push(`<div class="void"><h3>Voided</h3><p>${escapeHtml(INVOICE_VOID_NOTICE)}</p>${inv.voidReason ? `<p>Reason given: ${escapeHtml(inv.voidReason)}</p>` : ''}</div>`);
    T.push('', '*** VOIDED ***', INVOICE_VOID_NOTICE);
    if (inv.voidReason) T.push('Reason given: ' + inv.voidReason);
  }

  /* ── the caveats, at the top, where they cannot be scrolled past ───────── */
  if (!complete) {
    H.push('<div class="warn"><h3>Parts of this could not be read</h3><ul>');
    T.push('', '*** PARTS OF THIS COULD NOT BE READ ***');
    for (const c of caveats) { H.push(`<li>${escapeHtml(c)}</li>`); T.push('- ' + c); }
    H.push('</ul></div>');
  }

  /* ── from and to ───────────────────────────────────────────────────────── */
  H.push('<h2>From and to</h2>');
  T.push('', 'FROM AND TO');
  if (!readIssuer) {
    H.push('<p class="none"><b>Not read.</b> The issuer’s name could not be read from the server when this document was made, so nothing is printed here. This is not a statement that the record has no name in it.</p>');
    T.push('From: NOT READ — the issuer’s name could not be read. This is not a statement that the record has no name in it.');
  } else if (!issuerName) {
    H.push('<p class="none">The issuer has not recorded a name on their account.</p>');
    T.push('From: the issuer has not recorded a name on their account.');
  } else {
    H.push(`<p><b>From:</b> ${escapeHtml(issuerName)}</p>`);
    T.push(`From: ${issuerName}`);
  }
  H.push(`<p><b>To:</b> ${escapeHtml(inv.billTo)}</p>`);
  T.push(`To: ${inv.billTo}`);

  /* ── the charge ────────────────────────────────────────────────────────── */
  H.push('<h2>Charge</h2>');
  T.push('', 'CHARGE');
  const shown = amount ?? '—';
  H.push(`<table><tr><th>Description</th><th class="r">Amount</th></tr>`
    + `<tr><td>${escapeHtml(inv.description)}</td><td class="r">${escapeHtml(shown)}</td></tr>`
    + `<tr class="tot"><td>Total</td><td class="r">${escapeHtml(shown)}</td></tr></table>`);
  T.push(`  ${inv.description}   ${shown}`);
  T.push(`  TOTAL   ${shown}`);
  if (!amount) {
    // Never silently a dash. A blank total on an invoice reads as nothing owed.
    H.push('<p class="none">No amount is printed because this document could not state one in a currency. Do not read the missing figure as nothing being charged.</p>');
    T.push('No amount is printed because this document could not state one in a currency. Do not read the missing figure as nothing being charged.');
  }
  H.push(`<p>${escapeHtml(kindLine(inv.kind))}</p>`);
  T.push(kindLine(inv.kind));
  if (inv.note) {
    H.push(`<p class="lede">Note from the issuer: ${escapeHtml(inv.note)}</p>`);
    T.push(`Note from the issuer: ${inv.note}`);
  }

  /* ── what this document is, and is not ─────────────────────────────────── */
  H.push('<h2>About this document</h2>');
  T.push('', 'ABOUT THIS DOCUMENT');
  for (const line of INVOICE_PROVENANCE) { H.push(`<p class="lede">${escapeHtml(line)}</p>`); T.push(line); }
  H.push(`<p class="lede">${escapeHtml(INVOICE_TAX)}</p>`);
  T.push(INVOICE_TAX);
  H.push(`<p class="lede">${escapeHtml(INVOICE_NOT_A_RECEIPT)}</p>`);
  T.push(INVOICE_NOT_A_RECEIPT);

  /* ── foot ──────────────────────────────────────────────────────────────── */
  const foot = voided
    ? `VOIDED. Invoice ${no}, issued ${invoiceDayLabel(inv.issuedOn)}${brand ? ' through ' + brand : ''}.`
    : complete
      ? `Invoice ${no}, issued ${invoiceDayLabel(inv.issuedOn)}${brand ? ' through ' + brand : ''}.`
      : `Invoice ${no} — PARTS OF THIS DOCUMENT COULD NOT BE READ, see above${brand ? '. Issued through ' + brand : ''}.`;
  H.push(`<p class="foot">${escapeHtml(foot)}</p>`);
  T.push('', foot);

  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body>${H.join('')}</body></html>`;
  return { html, text: T.join('\n'), complete, caveats };
}

/**
 * The sentence the share sheet says before the document leaves the phone.
 *
 * A coach about to send a client a document with a number on it is entitled to
 * know, in advance, that a part of it is missing — afterwards is too late,
 * because it is already in somebody else's inbox.
 */
export function invoiceShareBlurb(doc: CoachInvoiceDoc, inv: CoachInvoice): string {
  const base = `Invoice ${invoiceNumber(inv.seq)} for ${inv.billTo}. It states no tax and it is not a payment receipt — both are said on the document itself.`;
  const parts = [base];
  if (inv.voidedAt) {
    parts.push('THIS ONE IS VOIDED. The document says so across its top. Send it only if you mean to tell them it was cancelled.');
  }
  if (!doc.complete) {
    parts.push(`BEFORE YOU SEND IT: ${doc.caveats.length} part${doc.caveats.length === 1 ? '' : 's'} of it could not be read just now, so the document says so on its own face rather than looking complete. You can send it as it is, or close this and try again in a moment.`);
  }
  return parts.join('\n\n');
}

/* ── the book, as a whole ─────────────────────────────────────────────────── */

/**
 * What a coach has issued, per currency.
 *
 * Delegates to `sumTaken` rather than adding the amounts here, for its two
 * rules: currencies are never added together, and an amount with no unit on it
 * is counted rather than dropped. A coach who trains a visitor from London and
 * bills them in sterling must not be shown "690" as a total.
 *
 * VOIDED INVOICES ARE EXCLUDED — they are not charges that stand — and the
 * count of them comes back separately, because an omitted row a coach cannot
 * see is exactly the kind of quiet subtraction this codebase keeps banning.
 *
 * Callable only when the read was whole. `status` decides that here rather than
 * at the call site: a sum over a page of a longer list is not a smaller total,
 * it is a wrong one.
 */
export interface InvoiceBook {
  /** Null when the read was not whole. Never a subtotal presented as a total. */
  totals: Taken | null;
  /** Voided rows left out of `totals`, said out loud. */
  voided: number;
  /** Rows that stand and are counted. */
  live: number;
  /** Why there is no total, or null when there is one. */
  reason: string | null;
}

export function invoiceBook(rows: readonly CoachInvoice[], status: LoadStatus): InvoiceBook {
  const voided = rows.filter((r) => !!r.voidedAt).length;
  const live = rows.length - voided;
  if (status !== 'ready') {
    return {
      totals: null,
      voided,
      live,
      reason: status === 'partial'
        ? 'More invoices are on record than could be read in one request, so no total is stated. The ones listed are real; they are not all of them.'
        : 'Your invoices could not be read just now, so no total is stated. An empty list here does not mean you have issued none.',
    };
  }
  const taken: TakenRow[] = rows
    .filter((r) => !r.voidedAt)
    .map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: r.issuedOn }));
  return { totals: sumTaken(taken), voided, live, reason: null };
}
