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
  /** When the coach last chased it, ISO, or null because they never have.
   *  The coach's own record of an act they performed — this app does not send
   *  the chase anywhere the coach did not send the document. */
  remindedAt?: string | null;
  /** How many times they have chased. Zero and null are the same fact here and
   *  both read as "not yet chased". */
  reminderCount?: number | null;
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
 * the reason. A settled invoice ('received' — the coach's own claim that the
 * money came in) and a voided one are not late and never will be; an invoice
 * with NO due date is neither late nor on time, and reporting it as "not due"
 * would put every invoice a coach issued before part 168 into the reassuring
 * bucket. That is the same class of mistake as an empty list under 'error'.
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
    return { state: 'voided', daysOverdue: null, bucket: null, line: 'Voided, so it is not owed and it is not late.' };
  }
  if (inv.kind === 'received') {
    return { state: 'settled', daysOverdue: null, bucket: null, line: 'You stated this one was received, so it is not outstanding.' };
  }
  const due = String(inv.dueOn ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return {
      state: 'undated',
      daysOverdue: null,
      bucket: null,
      // Never "not due". The absence of a date is the absence of a statement,
      // and an invoice from before part 168 must not be reported as being
      // comfortably within terms nobody ever wrote down.
      line: 'No due date was stated on this one, so nothing here says whether it is late.',
    };
  }
  const days = daysBetween(due, today);
  if (days == null) {
    return { state: 'undated', daysOverdue: null, bucket: null, line: 'The due date on this one could not be read, so nothing here says whether it is late.' };
  }
  if (days < 0) {
    const n = -days;
    return { state: 'not-due', daysOverdue: null, bucket: null, line: `Due in ${n} ${n === 1 ? 'day' : 'days'}, on ${invoiceDayLabel(due)}.` };
  }
  if (days === 0) {
    return { state: 'due-today', daysOverdue: null, bucket: null, line: 'Due today.' };
  }
  return {
    state: 'overdue',
    daysOverdue: days,
    bucket: ageBucket(days),
    line: `${days} ${days === 1 ? 'day' : 'days'} past the ${invoiceDayLabel(due)} you stated.`,
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

  const undatedNote = status === 'ready' && undated.length
    ? `${undated.length} invoice${undated.length === 1 ? '' : 's'} you are still asking for ${undated.length === 1 ? 'has' : 'have'} no due date on ${undated.length === 1 ? 'it' : 'them'}, so ${undated.length === 1 ? 'it is' : 'they are'} in no figure above and on no list of what is late. A due date is stated when the invoice is issued and cannot be added afterwards.`
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
  if (inv.kind === 'received') return 'You stated this one was received, so there is nothing outstanding to chase.';
  if (!inv.clientId) return 'This one is not tied to an account, so there is nobody here to notify. Send it to them the way you sent it the first time.';
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
