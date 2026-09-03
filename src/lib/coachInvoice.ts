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
// Exactly five things, and it is careful to claim no sixth:
//
//   1. that a named coach issued it, on a stated date;
//   2. that it is number N in THAT COACH's own sequence inside this app;
//   3. that the charge was a stated amount, in a stated currency, for a stated
//      thing, to a stated person;
//   4. whether the coach says the money has been received or is being asked
//      for — labelled, both times, as the coach's own word;
//   5. where the coach has since recorded one, that they say it was settled on
//      a stated day — labelled, again, as their own word.
//
// The fifth is new (part 660) and it is an ADDITION rather than a change. It
// does not touch the fourth: a document issued as a request still says it was a
// request, because that is what it said, and `kind` is still on the immutable
// list. Before it existed a coach whose client actually paid had two options,
// and both were wrong — leave the invoice at "61+ days overdue" for ever, or
// void it and stamp THIS INVOICE HAS BEEN VOIDED across a document that had
// been paid in full.
//
// ── What it does NOT claim, and says so on its own face ────────────────────
//
// REPPLE CALCULATES NO TAX. There is no tax amount on it, no net/gross split
// and no subtotal — not blank fields, not zeros: those concepts are absent.
// Tax treatment turns on the coach's country, their registration status, where
// the client is and what was sold, none of which Repple knows or asks. A
// "VAT 0.00" line would be a statement about somebody's tax affairs, printed
// under their name, and it would be wrong for most of them.
//
// What the document CAN now carry, and could not before, is a tax rate and a
// registration number the COACH TYPED. Those are not calculations. They are
// stated facts about the issuer, exactly as `billTo` is a stated fact about the
// recipient and `description` is a stated fact about what was sold — the same
// person typed all four, this app checks none of them, and each is printed
// verbatim. Refusing to print them meant a VAT-registered coach had to keep a
// second invoicing system, which made the whole money side of this app a
// duplicate of their real books.
//
// So there are two tax sentences and exactly one is on any given document:
// `INVOICE_TAX` where the coach stated nothing, and `INVOICE_TAX_STATED` where
// they did. Both say Repple worked nothing out. The test asserts one of them is
// on every document this module can build, and that no document anywhere
// carries a tax AMOUNT.
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
import { minorMoney, readMinorAmount, sumTaken, type Taken, type TakenRow, type TypedAmount } from './coachMoney';
// The coach's own mark. `logoImgHtml` returns the empty string for anything it
// cannot validate, which is what makes "no logo" and "an unreadable logo"
// produce the same document rather than a broken image on somebody's invoice.
import { LOGO_CSS, logoImgHtml } from './coachLogo';

/* ── what the caller hands over ───────────────────────────────────────────── */

/**
 * What the coach says about the money — and nothing more.
 *
 * 'received' is "I have been paid"; 'requested' is "I am asking". Repple checks
 * neither, and the document prints each as the coach's own statement rather
 * than as a fact the platform is standing behind.
 *
 * There is STILL deliberately no third value, and the reason has changed. It
 * used to be that 'overdue' would need a due date this app did not collect and
 * a clock it did not run. Part 168 collects the date — as a field the coach
 * TYPES, which is not the same as this app inventing a payment term — and the
 * clock is the device's own. But lateness is a DERIVED reading of two facts
 * that are already here, and putting it in this union would make it a stored
 * one: a row written 'overdue' on Tuesday is still 'overdue' after the client
 * pays on Wednesday, and nothing in this app is told when they pay. So the
 * union stays two words the coach chose, and `invoiceAge()` below computes the
 * rest from the due date every time it is asked.
 *
 * ── And a third value would not have fixed the invoice that got paid ──────
 *
 * There was no way to settle a 'requested' invoice, and the union is the reason
 * it looked like there was nothing to be done: the only place a payment could
 * be recorded appeared to be this field, and this field is on the document and
 * cannot move. So an invoice a client actually paid sat at "61+ days overdue"
 * for ever, was counted in the outstanding figure, and was named by part 613's
 * nightly pass four times over two months — or the coach voided it, and stamped
 * THIS INVOICE HAS BEEN VOIDED across a document that had been paid in full.
 *
 * The settlement is not in this union and never will be. It is `settledOn`
 * below: a NEW FACT, recorded after issue, beside a `kind` that still says
 * exactly what the issued document said. Part 660 has the argument in full.
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
  /**
   * `YYYY-MM-DD` the coach typed as the day they expect to be paid by, or null
   * because they did not state one.
   *
   * NULL IS NOT "NOT DUE". It is the absence of a statement, and `invoiceAge()`
   * reports it as its own state rather than folding it in with the invoices
   * that are inside their terms. An invoice with no due date on it cannot be
   * late and cannot be on time; the only true thing to say about it is that
   * nobody said when it was for.
   *
   * Optional on the type rather than `string | null` so that every existing
   * construction of a CoachInvoice — the tests, the statement, the notification
   * copy — keeps compiling and means exactly what it meant before.
   */
  dueOn?: string | null;
  /**
   * `YYYY-MM-DD` the coach says the money arrived, or null because it has not
   * (part 660).
   *
   * The coach's own word, checked against nothing, in exactly the voice `kind`
   * is — and, like `kind`, printed on the document labelled as their statement
   * rather than as a fact this app is standing behind.
   *
   * WRITTEN ONCE. There is no un-settle, for the reason there is no un-void:
   * money that came in and then went back out is a refund or a chargeback,
   * which happened on its own day and belongs in its own record. A column that
   * could flip back would lose that day.
   *
   * NULL IS NOT "UNPAID". Nothing tells this app when a client pays, which is
   * what `AGEING_IS_YOUR_OWN_RECORD` says on the screen: null here means the
   * coach has not written it down, and a coach paid in cash on Friday who did
   * not is exactly the case that produces a wrong-looking chase list.
   */
  settledOn?: string | null;
  /** When the coach recorded the settlement, ISO, as distinct from the day they
   *  say the money arrived. Both matter: a quarter of payments written up in
   *  one evening must not all be dated that evening. */
  settledAt?: string | null;
  /** How the coach says it arrived, in their own words, or null. Printed
   *  verbatim on the reprinted document and parsed for nothing. */
  settleNote?: string | null;
  /**
   * The day the COACH decided to start chasing this one, or null (part 660).
   *
   * NOT A DUE DATE, and the difference is the whole reason this column is
   * allowed to exist beside an immutable `dueOn`. It is written after the fact,
   * by the person doing the chasing, about their own working list. It is never
   * printed on the document, was never shown to the client, and `invoiceAge()`
   * words it differently every time it appears — "you set" rather than "you
   * stated", because nobody agreed to it.
   *
   * It exists because every invoice issued before part 188 carries no due date
   * and can never be given one, so it was in no outstanding figure and on no
   * chase list, permanently. `dueOn` wins wherever both are present, and part
   * 660 refuses to set this on an invoice that has one — an invoice with two
   * answers to "when is this late" has none.
   */
  chaseFrom?: string | null;
  /** When the coach last chased it, ISO, or null because they never have.
   *  The coach's own record of an act they performed — this app does not send
   *  the chase anywhere the coach did not send the document. */
  remindedAt?: string | null;
  /** How many times they have chased. Zero and null are the same fact here and
   *  both read as "not yet chased". */
  reminderCount?: number | null;
  note?: string | null;
  /**
   * A tax rate the COACH typed, as a percentage, or null because they stated
   * none (part 451).
   *
   * Printed verbatim and used for nothing else. Repple works no amount out from
   * it: there is no tax figure on this document, no net/gross split and no
   * subtotal, because what a rate means for a particular supply depends on a
   * margin scheme, a flat-rate scheme, a reverse charge and half a dozen other
   * things this app is not told about.
   *
   * ZERO IS NOT NULL. A zero-rated supply is something a registered business
   * states on purpose, and collapsing it into "stated nothing" would take a
   * deliberate statement off the page.
   */
  taxRatePct?: number | null;
  /** A tax registration number the COACH typed, or null. Never checked against
   *  any register, and never inferred from a country or a currency. */
  taxRegistration?: string | null;
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
  /**
   * The coach's own logo as a data URI, or null.
   *
   * Theirs, on their own document, so there is no gate on it beyond being able
   * to read it. Optional on the type so every existing construction of an
   * issuer keeps compiling and keeps meaning what it meant.
   *
   * NOT put through `escapeHtml`: escaping base64 would break the picture. It
   * goes through `safeLogoDataUri` in src/lib/coachLogo.ts instead, which
   * admits nothing but base64 after one of two literal prefixes — so there is
   * no value of this field that can end the attribute it is written into. Null,
   * unreadable and invalid all produce the same document: the one this module
   * produced before logos existed.
   */
  logoDataUri?: string | null;
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
 * The other tax sentence: the one for a document whose issuer stated something.
 *
 * `INVOICE_TAX` survives verbatim above and is still the sentence on the great
 * majority of documents this builds. This is what replaces it when the coach
 * typed a rate, a registration number, or both — and every clause of it is a
 * narrowing rather than a softening.
 *
 * It still says Repple calculated nothing, because Repple calculated nothing:
 * the rate and the number were typed by the issuer, are printed exactly as they
 * typed them, and no amount anywhere on the page was derived from either. What
 * it stops claiming is the two things that would now be false — that no
 * registration number is stated, and that no rate appears — because a document
 * that carried a rate and denied carrying one would be worse than either.
 *
 * It still refuses to say the document is sufficient. Whether a rate and a
 * number are all a particular tax authority wants on an invoice is a question
 * about the issuer's country and trade, and the accountant is still the person
 * who answers it.
 */
export const INVOICE_TAX_STATED =
  'The tax rate and registration number on this document were typed by the issuer and are printed exactly as they typed them. Nothing has been calculated from either: there is no tax amount anywhere on this document, no split between a net and a gross figure, and no subtotal. The amount shown is the amount charged, flat. Whether this is everything an invoice has to state where the issuer trades is for their own accountant to confirm.';

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

/* ── how late it is, which is never a stored fact ─────────────────────────── */

/**
 * The one thing a due date is, and the several things it is not.
 *
 * Printed on the document, because a date the coach typed that the client never
 * sees is a term nobody agreed to. It is the coach's own statement of when they
 * expect the money, in the same voice as `kind` — Repple does not enforce it,
 * does not charge interest on it, does not apply a statutory late fee, and is
 * never told whether the money arrived. "Overdue" on this screen means "past a
 * date you typed and you have not marked it settled", and nothing more.
 */
export const INVOICE_DUE_NOT_A_TERM =
  'Any date shown as due is the issuer’s own statement of when they expect to be paid. It is not a payment term this app enforces, no interest or late fee is calculated anywhere on it, and this app is never told whether the money arrived.';

/**
 * What a coach's ageing list may and may not say.
 *
 * The list is built from ONE fact — a date the coach typed — against ONE clock,
 * the device's. It is not a statement that a client has failed to pay: Repple
 * is not told when a bank transfer lands, and a coach who was paid in cash on
 * Friday marks it by issuing a 'received' invoice, not by this app noticing.
 */
export const AGEING_IS_YOUR_OWN_RECORD =
  'This list is built from the due dates you typed and this phone’s clock. Nothing here has been checked against a bank or a card processor, and nobody tells this app when a client pays you — an invoice stays on this list until you say otherwise.';

/**
 * Where one invoice stands against its own due date.
 *
 * Six states rather than a boolean, and the two that are not about lateness are
 * the reason. A settled invoice and a voided one are not late and never will
 * be; an invoice with NO date of any kind is neither late nor on time, and
 * reporting it as "not due" would put every invoice a coach issued before part
 * 188 into the reassuring bucket. That is the same class of mistake as an empty
 * list under 'error'.
 *
 * 'settled' now has TWO doors into it and they say different things. One is
 * `kind === 'received'`, the coach's claim at the moment of issue that the
 * money had already come in. The other is `settledOn`, recorded afterwards on
 * an invoice that was issued as a request and then paid — which had no door at
 * all before part 660, and left a paid invoice permanently overdue.
 */
export type InvoiceAgeState =
  | 'settled'
  | 'voided'
  | 'undated'
  | 'not-due'
  | 'due-today'
  | 'overdue';

/** How late, in the bands a person chases in. Null unless 'overdue'. */
export type AgeBucket = '1-7' | '8-30' | '31-60' | '61+';

export interface InvoiceAge {
  state: InvoiceAgeState;
  /** Whole calendar days past the due date. Only ever positive, and only under
   *  'overdue'. Null everywhere else, including 'due-today' — nought days late
   *  and not late are different readings and a zero here would blur them. */
  daysOverdue: number | null;
  bucket: AgeBucket | null;
  /** The sentence for a list row. Sentence case: it is prose beside a number,
   *  not a label. */
  line: string;
  /**
   * True when the lateness above was measured against `chaseFrom` — the coach's
   * own working note — rather than against a due date the client was shown.
   *
   * It is on the type rather than left to the wording because a screen may need
   * to badge it, and because the two must never be summed into one "overdue"
   * figure without the difference being sayable. A document with a due date on
   * it is a term somebody was given; a chase date is a plan the coach made, and
   * only one of those is something to put in a demand.
   */
  fromChaseDate: boolean;
}

/**
 * Whole calendar days from `a` to `b`, both `YYYY-MM-DD`, or null.
 *
 * Through `Date.UTC` on the PARTS rather than `Date.parse` on the strings, and
 * never through a local Date. Two calendar days are a fixed number of days
 * apart; a local-midnight subtraction is 23 or 25 hours across a DST boundary,
 * and `(b - a) / 86400000` then floors to one day fewer than it should. In
 * March that would show a seven-day-old invoice as six days old, which is the
 * wrong side of a chasing decision.
 */
function daysBetween(a: string, b: string): number | null {
  const ma = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a ?? ''));
  const mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b ?? ''));
  if (!ma || !mb) return null;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * `n` days after an ISO day, as an ISO day.
 *
 * Through `Date.UTC` on the parts and back out through the UTC getters, never
 * through a local Date. A local `new Date(y, m, d + 7)` is seven days later by
 * the calendar but the arithmetic runs through a DST boundary twice a year, and
 * the round trip back to a `YYYY-MM-DD` can land a day out. On a due date that
 * is a deadline printed on somebody's invoice.
 *
 * Returns '' for anything that is not an ISO day, so a caller cannot get a
 * plausible-looking wrong date out of a broken one.
 */
export function plusDays(isoDay: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay ?? ''));
  if (!m || !Number.isFinite(n)) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(n)));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Which band a number of days late falls in. */
export function ageBucket(days: number): AgeBucket {
  if (days <= 7) return '1-7';
  if (days <= 30) return '8-30';
  if (days <= 60) return '31-60';
  return '61+';
}

/** The band's own heading. Title Case, because it heads a group. */
export const BUCKET_TITLE: Readonly<Record<AgeBucket, string>> = {
  '1-7': 'Up to a Week Late',
  '8-30': 'One to Four Weeks Late',
  '31-60': 'One to Two Months Late',
  '61+': 'Over Two Months Late',
};

/**
 * Where this invoice stands, as of the day the caller says it is.
 *
 * `today` is passed in rather than read from a clock inside this function, for
 * the reason every date function in this file is written that way: `new Date()`
 * here would be UTC-shaped and untestable, and the caller already knows which
 * day the DEVICE is on — which is the only day that matters to the person
 * holding it. `isoToday()` in src/lib/dayPlan.ts is what produces it.
 */
export function invoiceAge(inv: CoachInvoice, today: string): InvoiceAge {
  if (inv.voidedAt) {
    return { state: 'voided', daysOverdue: null, bucket: null, line: 'Voided, so it is not owed and it is not late.', fromChaseDate: false };
  }
  // A settlement the coach recorded, which is a fact about an event AFTER the
  // document was issued and is the only door out of this list that does not
  // stamp VOIDED across a paid invoice. It is asked BEFORE `kind`, so that an
  // invoice which was requested and then paid reads as settled rather than as
  // 61 days overdue — which is the entire point of part 660.
  const settledOn = String(inv.settledOn ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(settledOn)) {
    return {
      state: 'settled',
      daysOverdue: null,
      bucket: null,
      // "You recorded", not "it was paid". Nothing checked it, exactly as
      // nothing checks `kind`, and the sentence has to keep saying whose word
      // it is on a list the coach makes chasing decisions from.
      line: `You recorded this one as settled on ${invoiceDayLabel(settledOn)}, so it is not outstanding.`,
      fromChaseDate: false,
    };
  }
  if (inv.kind === 'received') {
    return { state: 'settled', daysOverdue: null, bucket: null, line: 'You stated this one was received, so it is not outstanding.', fromChaseDate: false };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const due = String(inv.dueOn ?? '').slice(0, 10);
  const chase = String(inv.chaseFrom ?? '').slice(0, 10);
  // The DOCUMENT's date wins wherever there is one. `chaseFrom` is a private
  // note and a due date is a term the client was shown, so an invoice carrying
  // both would have two answers to "when is this late" and only one of them is
  // something to put in a demand. Part 660 refuses to write the second where
  // the first exists; this is the same rule stated where it is read.
  const against = day.test(due) ? due : day.test(chase) ? chase : '';
  const fromChaseDate = !day.test(due) && day.test(chase);
  if (!against) {
    return {
      state: 'undated',
      daysOverdue: null,
      bucket: null,
      // Never "not due". The absence of a date is the absence of a statement,
      // and an invoice from before part 188 must not be reported as being
      // comfortably within terms nobody ever wrote down. It now names the way
      // out, which it could not before: the coach can set a day to start
      // chasing from, which is their own note and goes on no document.
      line: 'No due date was stated on this one, so nothing here says whether it is late. Set a day to chase it from and it joins the lists below.',
      fromChaseDate: false,
    };
  }
  const days = daysBetween(against, today);
  if (days == null) {
    return {
      state: 'undated',
      daysOverdue: null,
      bucket: null,
      line: fromChaseDate
        ? 'The day you set to chase this one from could not be read, so nothing here says whether it is late.'
        : 'The due date on this one could not be read, so nothing here says whether it is late.',
      fromChaseDate: false,
    };
  }
  if (days < 0) {
    const n = -days;
    return {
      state: 'not-due',
      daysOverdue: null,
      bucket: null,
      line: fromChaseDate
        ? `You set ${invoiceDayLabel(against)} as the day to start chasing this one, in ${n} ${n === 1 ? 'day' : 'days'}. No due date is on the document.`
        : `Due in ${n} ${n === 1 ? 'day' : 'days'}, on ${invoiceDayLabel(against)}.`,
      fromChaseDate,
    };
  }
  if (days === 0) {
    return {
      state: 'due-today',
      daysOverdue: null,
      bucket: null,
      line: fromChaseDate
        ? `Today is the day you set to start chasing this one. No due date is on the document.`
        : 'Due today.',
      fromChaseDate,
    };
  }
  return {
    state: 'overdue',
    daysOverdue: days,
    bucket: ageBucket(days),
    // "you set" and not "you stated", every time this comes off `chaseFrom`.
    // The client never agreed to it and in most cases has never been shown a
    // date at all, so a coach reading this row has to be able to tell which of
    // the two kinds of lateness they are looking at before they send anything.
    line: fromChaseDate
      ? `${days} ${days === 1 ? 'day' : 'days'} past the ${invoiceDayLabel(against)} you set to chase it from. No due date is on the document.`
      : `${days} ${days === 1 ? 'day' : 'days'} past the ${invoiceDayLabel(against)} you stated.`,
    fromChaseDate,
  };
}

/** One invoice and where it stands, so a screen sorts and groups without
 *  recomputing the age per render. */
export interface AgedInvoice { invoice: CoachInvoice; age: InvoiceAge }

export interface AgeingBook {
  /** Overdue invoices, longest overdue first — the order a person chases in. */
  overdue: AgedInvoice[];
  /** Due today or later, soonest first. */
  upcoming: AgedInvoice[];
  /** Live, requested, and carrying no due date at all. Its own list because it
   *  is its own answer: these are neither chased nor safe. */
  undated: AgedInvoice[];
  /**
   * What is outstanding, per currency, over the OVERDUE and UPCOMING sets
   * together — every live requested invoice with a date on it.
   *
   * Null under anything but a whole read. A coach asking "who owes me money"
   * and being handed a figure over the first page of their book is being handed
   * a wrong number, not a small one, and it is the number they would chase on.
   * The undated ones are deliberately NOT in it, and `undatedNote` says so.
   */
  outstanding: Taken | null;
  /** Why there is no figure, or null when there is one. */
  withheld: string | null;
  /** What the figure leaves out, or null when it leaves nothing out. */
  undatedNote: string | null;
}

/**
 * The coach's unpaid book, aged.
 *
 * "Who owes me money" is the most common unanswered question in this app, and
 * every part of the answer here is derived from what the coach themselves
 * recorded: a kind they chose, a date they typed, and a void they performed.
 * Nothing is inferred from a payment processor, because nothing about a payment
 * processor reaches this table.
 */
export function ageingBook(rows: readonly CoachInvoice[], status: LoadStatus, today: string): AgeingBook {
  const overdue: AgedInvoice[] = [];
  const upcoming: AgedInvoice[] = [];
  const undated: AgedInvoice[] = [];
  for (const invoice of rows) {
    const age = invoiceAge(invoice, today);
    if (age.state === 'overdue') overdue.push({ invoice, age });
    else if (age.state === 'due-today' || age.state === 'not-due') upcoming.push({ invoice, age });
    else if (age.state === 'undated') undated.push({ invoice, age });
    // 'settled' and 'voided' are on no list. They are not outstanding and the
    // screen that lists everything already shows them.
  }
  // Longest overdue first, then by number so the order cannot flap between two
  // invoices that are equally late.
  overdue.sort((a, b) => (b.age.daysOverdue ?? 0) - (a.age.daysOverdue ?? 0) || a.invoice.seq - b.invoice.seq);
  upcoming.sort((a, b) => String(a.invoice.dueOn ?? '').localeCompare(String(b.invoice.dueOn ?? '')) || a.invoice.seq - b.invoice.seq);
  undated.sort((a, b) => b.invoice.seq - a.invoice.seq);

  const withheld = status === 'ready'
    ? null
    : status === 'partial'
      ? 'More invoices are on record than could be read in one request, so no outstanding figure is stated. What is listed is real; it is not all of it.'
      : status === 'loading'
        ? 'Still reading your invoices, so no outstanding figure is stated yet.'
        : 'Your invoices could not be read, so no outstanding figure is stated. An empty list here is not a statement that nobody owes you anything.';

  const outstanding = status === 'ready'
    ? sumTaken([...overdue, ...upcoming].map(({ invoice }): TakenRow => ({
      amount_cents: invoice.amountCents,
      currency: invoice.currency,
      created_at: invoice.issuedOn,
    })))
    : null;

  // Names the way out, which it could not before part 660. The old sentence
  // ended "A due date is stated when the invoice is issued and cannot be added
  // afterwards" — which is still true, and which told a coach with a year of
  // back catalogue that those invoices were outside every figure and every
  // chase list permanently, with nothing to do about it. The due date still
  // cannot move; what the coach can now set is their own note of when to start
  // chasing, which goes on no document and is worded as theirs everywhere it
  // appears. See `CHASE_FROM_IS_NOT_A_DUE_DATE`.
  const undatedNote = status === 'ready' && undated.length
    ? `${undated.length} invoice${undated.length === 1 ? '' : 's'} you are still asking for ${undated.length === 1 ? 'has' : 'have'} no due date on ${undated.length === 1 ? 'it' : 'them'}, so ${undated.length === 1 ? 'it is' : 'they are'} in no figure above and on no list of what is late. The due date on a document cannot be changed after it is issued — but you can set a day to start chasing each of these from, which is your own note and appears on nothing you send.`
    : null;

  return { overdue, upcoming, undated, outstanding, withheld, undatedNote };
}

/* ── chasing one ──────────────────────────────────────────────────────────── */

/**
 * Whether this invoice can be chased, and the reason when it cannot.
 *
 * Null means it can go. A sentence means it cannot, and the sentence is what
 * the coach reads — never a dead button.
 *
 * There is no cooldown here on purpose. The rate at which a self-employed
 * person chases their own customer is their decision and not this app's, and
 * the nudge machinery's thirty-day floor (src/lib/nudge.ts) exists to stop the
 * app nagging a CLIENT on the coach's behalf. This is the coach performing an
 * act, once, each time they tap. What the screen does instead is SAY how many
 * times and when, so a coach who has already sent four can see that they have.
 */
export function chaseBlocker(inv: CoachInvoice): string | null {
  if (inv.voidedAt) return 'This one is voided, so there is nothing to chase.';
  if (inv.settledOn) return `You recorded this one as settled on ${invoiceDayLabel(inv.settledOn)}, so there is nothing outstanding to chase.`;
  if (inv.kind === 'received') return 'You stated this one was received, so there is nothing outstanding to chase.';
  if (!inv.clientId) return 'This one is not tied to an account, so there is nobody here to notify. Send it to them the way you sent it the first time.';
  return null;
}

/* ── recording that one was paid ──────────────────────────────────────────── */

/**
 * What a settlement claims, printed on the reprinted document.
 *
 * The same hedge `kindLine` puts on the original claim, and it belongs here
 * more sharply: a client who has paid and is handed the document again is
 * looking at a statement about their own payment, made by the person they paid,
 * and neither this app nor anything else has checked it.
 */
export const INVOICE_SETTLEMENT_IS_YOUR_WORD =
  'The settlement above is the issuer’s own statement that this was paid, recorded by them after this document was issued. It has not been checked against a bank or a card processor and it is not a payment receipt from one. What the document said when it was issued has not been changed.';

/**
 * Whether this invoice can be recorded as settled, and the reason when it
 * cannot. Null means it can go.
 *
 * Every refusal here is one part 660's function raises too, in the same order,
 * so the screen and the server cannot disagree about what is allowed — the
 * screen's copy is a convenience so a coach is not sent to the server to be
 * told no, and the server's copy is the rule.
 */
export function settleBlocker(inv: CoachInvoice): string | null {
  if (inv.voidedAt) return 'This one is voided, so there is nothing to settle. A voided document is not a charge that stands.';
  if (inv.settledOn) return `You already recorded this one as settled on ${invoiceDayLabel(inv.settledOn)}. A settlement is written once — if the money went back out, that is a refund or a chargeback and it happened on its own day.`;
  if (inv.kind === 'received') return 'This one already states the money was received, so there is nothing to record. Settling it as well would put the same payment on one document twice, on two dates.';
  return null;
}

/**
 * Whether the day the coach typed can be recorded as the day it was settled.
 *
 * `today` is the DEVICE's own day, passed in for the reason every date function
 * in this file takes it: `new Date()` here would be UTC-shaped and untestable,
 * and the day that matters is the one the person holding the phone is on.
 *
 * Both ends are refused rather than corrected. A date before the invoice is a
 * typo that would sort to the top of a ledger; a date after today is money
 * recorded as having arrived on a day that has not happened.
 */
export function settleDayBlocker(inv: CoachInvoice, settledOn: string, today: string): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const on = String(settledOn ?? '').trim();
  if (!day.test(on)) return 'Say which day the money arrived. Write it as a date.';
  if (day.test(String(inv.issuedOn)) && on < String(inv.issuedOn)) {
    return `Money cannot have arrived before the invoice was written. This one was issued on ${invoiceDayLabel(inv.issuedOn)}.`;
  }
  if (day.test(today) && on > today) {
    return 'That day has not happened yet. Record it when the money is actually there.';
  }
  return null;
}

/* ── deciding when to chase one that carries no due date ──────────────────── */

/**
 * What a chase date is, said on the screen wherever one can be set.
 *
 * The single most important sentence about this feature, and the reason it is
 * allowed to exist beside an immutable due date at all. A coach who believes
 * this is "adding a due date" will chase against it as though the client agreed
 * to it, and the client never saw it.
 */
export const CHASE_FROM_IS_NOT_A_DUE_DATE =
  'A day you set to chase from is your own note about your own list. It is not printed on the invoice, it was never sent to anybody, and nothing about it is a term your client has agreed to — this app has not told them a date and cannot. It exists so an invoice with no due date on it can be on a list at all, instead of sitting outside every figure for ever.';

/**
 * Whether a chase date can be set on this invoice, and the reason when it
 * cannot. Null means it can go.
 *
 * The refusal that matters is the last one. An invoice that already carries a
 * due date is chased against the term the client was actually shown, and a
 * second private date beside it would give one invoice two answers to "when is
 * this late". Part 660's function raises on the same condition.
 */
export function chaseFromBlocker(inv: CoachInvoice): string | null {
  if (inv.voidedAt) return 'This one is voided, so there is nothing to chase.';
  if (inv.settledOn) return `You recorded this one as settled on ${invoiceDayLabel(inv.settledOn)}, so there is nothing to chase.`;
  if (inv.kind === 'received') return 'This one states the money was received, so there is nothing to chase.';
  if (inv.dueOn) return `This one carries a due date of ${invoiceDayLabel(inv.dueOn)}, which is what it is already chased against. That date is on the document and cannot be moved.`;
  return null;
}

/** Whether the day typed can be a chase date. Only one end is refused: a day
 *  before the invoice existed is a typo that would sort to the top of the
 *  ageing list as the most urgent thing the coach owns. There is deliberately
 *  NO upper bound — a coach who has agreed to wait until March sets March, and
 *  that is a plan about their own book. */
export function chaseFromDayBlocker(inv: CoachInvoice, from: string): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const on = String(from ?? '').trim();
  if (!day.test(on)) return 'Write the day to start chasing from as a date, or clear it and this one goes back on the undated list.';
  if (day.test(String(inv.issuedOn)) && on < String(inv.issuedOn)) {
    return `That is before the invoice was written, on ${invoiceDayLabel(inv.issuedOn)}.`;
  }
  return null;
}

/** How often this one has been chased, said in words, or null the first time.
 *  Sentence case: it sits under a row as prose. */
export function chaseHistoryLine(inv: CoachInvoice): string | null {
  const n = Number(inv.reminderCount ?? 0);
  if (!Number.isFinite(n) || n < 1) return null;
  const when = String(inv.remindedAt ?? '').slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(when) ? invoiceDayLabel(when) : null;
  return `Chased ${n} ${n === 1 ? 'time' : 'times'}${day ? `, last on ${day}` : ''}.`;
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
  /**
   * `YYYY-MM-DD`, or null/'' because the coach did not state one.
   *
   * Optional to type AND optional to leave out. A required due date would be a
   * payment term this app had invented on the coach's behalf, and a defaulted
   * one — "thirty days" — would be worse, because it would be printed on a
   * document under their name as though they had chosen it.
   */
  dueOn?: string | null;
  note?: string | null;
  /**
   * A tax rate the coach typed, as a percentage string — "20", "12.5", "0".
   *
   * Optional to type and optional to leave out, exactly as `dueOn` is. An empty
   * box means the coach stated no rate, which is the ordinary case and is a
   * DIFFERENT document from one stating zero. There is no default: a rate this
   * app filled in would be a statement about somebody's tax affairs that they
   * did not make.
   */
  taxRateText?: string | null;
  /** A tax registration number the coach typed, or empty because they stated
   *  none. Printed verbatim; never validated against a register, because there
   *  is no register this app could check and a format check would refuse valid
   *  numbers from countries nobody thought of. */
  taxRegistration?: string | null;
}

/** A tax rate as a number, or why what was typed is not one. */
export type TypedRate = { ok: true; pct: number | null } | { ok: false; reason: string };

/**
 * The rate the coach typed, as a percentage — or null because they typed
 * nothing, or a refusal because what they typed is not a rate.
 *
 * THREE outcomes and not two, and the middle one is the point: an empty box is
 * `{ ok: true, pct: null }`, meaning the coach stated no rate. It is not zero.
 * A registered business stating a zero rate has said something deliberate, and
 * a business that said nothing has not — collapsing the two would put a "0%"
 * on the documents of every coach who left the box alone.
 *
 * Refused rather than clamped or rounded, like every other money-adjacent
 * reader in this file: clamping 120 to 100, or rounding 12.55 to 12.6, prints a
 * rate the coach did not type onto a document about their tax affairs. Three
 * decimal places, matching the column, which is more than any real rate needs
 * and is the point at which a typo stops looking like a rate.
 */
export function readTaxRate(text: string | null | undefined): TypedRate {
  const raw = String(text ?? '').trim().replace(/\s/g, '').replace(/%$/, '');
  if (!raw) return { ok: true, pct: null };
  if (!/^\d{1,3}([.,]\d{1,3})?$/.test(raw)) {
    return { ok: false, reason: 'A tax rate is a percentage — 20, or 12.5. Type the number on its own, with no per-cent sign and no currency.' };
  }
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'That tax rate could not be read as a number.' };
  }
  if (n < 0 || n > 100) {
    return { ok: false, reason: 'A tax rate is a percentage between 0 and 100.' };
  }
  return { ok: true, pct: n };
}

/** The rate as it is printed: the digits the coach typed, with a per-cent sign
 *  and no trailing noughts added. Null where they stated none — never "0%",
 *  which is a statement they did not make. */
export function taxRateLabel(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return `${Number(pct.toFixed(3))}%`;
}

/** Whether this document carries anything the coach stated about tax, and so
 *  which of the two tax sentences belongs on it. A rate of zero counts: it is a
 *  statement, and `pct != null` is the test rather than truthiness. */
export function statesTax(i: CoachInvoice): boolean {
  return (i.taxRatePct != null && Number.isFinite(i.taxRatePct))
    || !!String(i.taxRegistration ?? '').trim();
}

/**
 * The typed amount, in minor units — or the reason what was typed is not one.
 *
 * ── The factor is not a hundred, and this used to assume it was ───────────
 *
 * This function held its own conversion: a zero-decimal branch for the yen, and
 * `Math.round(n * 100)` for everything else. The yen half was right and the
 * everything-else half was wrong in five currencies. A Kuwaiti dinar has a
 * THOUSAND fils in it, so a coach in Kuwait invoicing 12.500 issued a document
 * for 1250 fils — KWD 1.250, a tenth of what they typed — and the amount
 * printed on the page agreed with the wrong figure, so nothing on the document
 * contradicted it. The regex made it worse rather than catching it: it admitted
 * at most two decimal places, so the third digit of a perfectly ordinary dinar
 * amount was refused as "not money".
 *
 * `readMinorAmount` in coachMoney.ts already answers this correctly for all
 * three families — no minor unit, hundredths, thousandths — and does the
 * conversion on the DIGITS rather than by multiplying a float, so nothing is
 * rounded into an amount nobody typed. It also carries Stripe's own rule that a
 * thousandth-unit amount must end in a nought. There is one place in this app
 * that decides how many decimal places a currency has, and this is not it.
 *
 * A comma decimal separator is still accepted: half the world types "45,50",
 * and `Number('45,50')` is NaN, which would refuse a perfectly ordinary amount
 * rather than mispricing it. A thousands separator is still refused rather than
 * guessed at — "1,234" is one thousand in London and one and a bit in Berlin,
 * and an invoice is not the place to pick one.
 */
export function draftAmount(amountText: string, currency: string | null): TypedAmount {
  const read = readMinorAmount(amountText, currency);
  if (!read.ok) return read;
  // Zero is a valid minor-unit figure and is not a valid invoice. An invoice
  // for nothing is not an invoice, and a receipt for nothing is not a payment —
  // so the refusal lives here rather than in the shared reader, which is also
  // used by the refund box where a nought is simply a nought.
  if (read.minorUnits <= 0) {
    return { ok: false, reason: 'Enter an amount greater than zero. A charge of nothing is not a charge.' };
  }
  return read;
}

/** The same answer as a number, for the callers that only need the figure.
 *  Null means "not an amount" and never means zero. */
export function draftMinorUnits(amountText: string, currency: string | null): number | null {
  const read = draftAmount(amountText, currency);
  return read.ok ? read.minorUnits : null;
}

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
  } else {
    // The refusal carries the READER's own reason rather than a sentence
    // written here, because the reason depends on the currency and there are
    // three families of it: "JPY has no smaller unit", "KWD has 3 decimal
    // places and that has 2", "KWD is charged in thousandths and the last place
    // must be a nought". A single generic line about two decimal places was
    // wrong for twenty-one currencies and told a coach in Kuwait that a real
    // amount was not one.
    const read = draftAmount(d.amountText, cur);
    if (!read.ok) out.push(read.reason);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.issuedOn ?? ''))) out.push('The date this is issued on could not be read.');
  // A due date is optional and is refused rather than corrected when it is
  // wrong. Part 168 has the same CHECK on the column, so a date this accepts
  // and the database refuses cannot exist — and a date BEFORE the issue date is
  // refused here rather than silently swapped, because a document that says it
  // was due before it was written is not a document anybody can act on.
  const due = String(d.dueOn ?? '').trim();
  if (due) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      out.push('The due date could not be read. Write it as a date, or leave it empty and no due date is stated on the document at all.');
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.issuedOn ?? '')) && due < String(d.issuedOn)) {
      out.push('The due date is before the date this is issued on. An invoice cannot fall due before it exists.');
    }
  }
  // What the coach stated about tax, if anything. Both fields are optional and
  // both are refused rather than corrected when they are wrong — a clamped rate
  // is a figure the coach did not type, printed on a document about their tax
  // affairs.
  const rate = readTaxRate(d.taxRateText);
  if (!rate.ok) out.push(rate.reason);
  if (String(d.taxRegistration ?? '').trim().length > 60) {
    out.push('That tax registration number is longer than any this can print. Check it, or leave the box empty and none is stated on the document.');
  }
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
  // The coach's mark goes ABOVE the heading block rather than inside it: `.h`
  // is a dark panel, and a logo drawn with dark ink on a transparent ground —
  // which is what most of them are — would disappear into it. On the page's own
  // white it looks like the letterhead it is.
  H.push(logoImgHtml(input.issuer.logoDataUri));
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
  // The due date goes on the DOCUMENT, not only on the coach's own list. A date
  // the coach types into their phone and chases against, that the person being
  // chased has never been shown, is a term nobody agreed to — and the first
  // that client would hear of it is a reminder about a deadline they were never
  // given. Printed only where one was stated: an absent due date prints nothing
  // rather than "none", which would read as a term of its own.
  {
    const due = String(inv.dueOn ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      H.push(`<p><b>Due:</b> ${escapeHtml(invoiceDayLabel(due))}</p>`);
      T.push(`Due: ${invoiceDayLabel(due)}`);
    }
  }
  // The settlement, where the coach has recorded one (part 660).
  //
  // This is NOT an edit of what the document said. `kind` is untouched and the
  // line above still reports it: the document said the money was being
  // requested and it still says so, and it now also says the issuer states it
  // arrived on a day. Both are true and both are the issuer's word.
  //
  // Printed because the alternative is worse in both directions. A client who
  // has paid and asks for the document again would otherwise be handed one
  // still demanding money, which reads as a second request; and a coach's own
  // copy of a paid invoice would carry nothing to say it was paid.
  //
  // The DEVICE'S date is never used here. `settledOn` is a `date` column and is
  // printed through `invoiceDayLabel`, which formats the parts of the string —
  // `new Date('2026-08-01')` is UTC midnight, and would date a settlement the
  // day before it happened for a third of the world.
  //
  // `chaseFrom` is deliberately NOT printed, on this document or any other. It
  // is the coach's own working note about their own list, the client never
  // agreed to it, and putting it on the page would turn it into the term
  // `CHASE_FROM_IS_NOT_A_DUE_DATE` says it is not.
  {
    const settled = String(inv.settledOn ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(settled)) {
      H.push(`<p><b>Settled:</b> the issuer states this was paid on ${escapeHtml(invoiceDayLabel(settled))}.</p>`);
      T.push(`Settled: the issuer states this was paid on ${invoiceDayLabel(settled)}.`);
      const how = String(inv.settleNote ?? '').trim();
      if (how) {
        H.push(`<p class="lede">How the issuer says it arrived: ${escapeHtml(how)}</p>`);
        T.push(`How the issuer says it arrived: ${how}`);
      }
    }
  }
  // What the coach stated about tax, if anything, printed exactly as they typed
  // it and used for nothing else. NOTHING is derived from it — no amount, no
  // net figure, no subtotal — and the "About this document" section below says
  // so in the sentence that replaces `INVOICE_TAX` when either field is here.
  //
  // Each is printed only where it was stated. An absent rate prints nothing
  // rather than "none" or "0%", both of which would be statements the coach did
  // not make; `statesTax` is what decides which of the two tax sentences the
  // document carries and it treats a stated zero as a statement.
  {
    const rate = taxRateLabel(inv.taxRatePct);
    if (rate) {
      H.push(`<p><b>Rate stated by the issuer:</b> ${escapeHtml(rate)}</p>`);
      T.push(`Rate stated by the issuer: ${rate}`);
    }
    const reg = String(inv.taxRegistration ?? '').trim();
    if (reg) {
      H.push(`<p><b>Issuer’s registration number:</b> ${escapeHtml(reg)}</p>`);
      T.push(`Issuer’s registration number: ${reg}`);
    }
  }
  if (inv.note) {
    H.push(`<p class="lede">Note from the issuer: ${escapeHtml(inv.note)}</p>`);
    T.push(`Note from the issuer: ${inv.note}`);
  }

  /* ── what this document is, and is not ─────────────────────────────────── */
  H.push('<h2>About this document</h2>');
  T.push('', 'ABOUT THIS DOCUMENT');
  for (const line of INVOICE_PROVENANCE) { H.push(`<p class="lede">${escapeHtml(line)}</p>`); T.push(line); }
  // One of the two, never both and never neither. `INVOICE_TAX` denies that a
  // registration number is stated, which is true of nearly every document this
  // builds and false of one carrying the coach's own — and a document that
  // printed a rate and then denied carrying one would be worse than either
  // sentence on its own. Both say Repple calculated nothing, because it did.
  {
    const taxLine = statesTax(inv) ? INVOICE_TAX_STATED : INVOICE_TAX;
    H.push(`<p class="lede">${escapeHtml(taxLine)}</p>`);
    T.push(taxLine);
  }
  H.push(`<p class="lede">${escapeHtml(INVOICE_NOT_A_RECEIPT)}</p>`);
  T.push(INVOICE_NOT_A_RECEIPT);
  // Only where a settlement is on the page. Said on every document would be a
  // paragraph about a claim the document does not make, which is how the tax
  // sentences got two versions rather than one hedged one.
  if (inv.settledOn) {
    H.push(`<p class="lede">${escapeHtml(INVOICE_SETTLEMENT_IS_YOUR_WORD)}</p>`);
    T.push(INVOICE_SETTLEMENT_IS_YOUR_WORD);
  }
  // Said on EVERY document, including the ones with no due date on them. A
  // reader who has one needs to know what it is and is not; a reader who has
  // none is entitled to know that this app never adds interest or a late fee to
  // anything, which is the question a missing due date raises.
  H.push(`<p class="lede">${escapeHtml(INVOICE_DUE_NOT_A_TERM)}</p>`);
  T.push(INVOICE_DUE_NOT_A_TERM);

  /* ── foot ──────────────────────────────────────────────────────────────── */
  const foot = voided
    ? `VOIDED. Invoice ${no}, issued ${invoiceDayLabel(inv.issuedOn)}${brand ? ' through ' + brand : ''}.`
    : complete
      ? `Invoice ${no}, issued ${invoiceDayLabel(inv.issuedOn)}${brand ? ' through ' + brand : ''}.`
      : `Invoice ${no} — PARTS OF THIS DOCUMENT COULD NOT BE READ, see above${brand ? '. Issued through ' + brand : ''}.`;
  H.push(`<p class="foot">${escapeHtml(foot)}</p>`);
  T.push('', foot);

  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}${LOGO_CSS}</style></head><body>${H.join('')}</body></html>`;
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
