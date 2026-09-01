// A statement of what this app recorded, for a period the coach chose.
//
// ── The thing that was asked for, and the thing that may honestly be built ──
//
// The roadmap line was "payout scheduling and tax export: Connect pays out;
// nothing summarises a year". Half of that cannot be built from this repo and
// the other half must not be called what it was called.
//
// PAYOUTS. Nothing in this app is ever told about one. `connect_accounts` holds
// four columns — `trainer_id`, `stripe_account_id`, `charges_enabled`,
// `details_submitted` — and the stripe-webhook subscribes to
// `customer.subscription.*`, `account.updated`, `checkout.session.completed`
// and `invoice.*`. There is no `payout.*` handler, no `balance.*`, no
// `transfer.*`, no `application_fee.*`, and no column anywhere that could hold
// a payout id, an arrival date, a fee or a balance. So a payout schedule cannot
// be rendered from this data, and a rendered one would be invented. What this
// file produces instead is `payoutFacts()`, which says what is actually known
// and says where the real answer lives.
//
// A TAX EXPORT. Tax treatment turns on the coach's country, their registration
// status, where their client is and what was sold — none of which this app
// knows or asks. supabase/parts/138 already settled the principle for a coach's
// invoice and this holds the identical line: no tax is calculated, the concepts
// are ABSENT rather than zeroed, and the document says so on its own face. What
// a coach at the end of a year actually needs is a statement of what this app
// recorded, clearly labelled as that, to hand to an accountant beside the
// Stripe records. That is what this builds.
//
// ── What the statement claims ──────────────────────────────────────────────
//
// Five sections, each with its period named and its source named:
//
//   sessions delivered      counted, never priced — see `SESSIONS_NOT_MONEY`
//   packs and memberships   what Stripe told this app it charged
//   subscription renewals   the same, one row per paid invoice
//   invoices issued         the coach's own documents, their own claim
//   late-cancellation fees  recorded here, charged by nobody here
//
// ── What it refuses to claim ───────────────────────────────────────────────
//
// * **No figure without a currency somebody chose.** Every amount goes through
//   coachMoney.ts, whose `moneyIn` returns null rather than guessing a unit.
//   `tenants.currency` is nullable on purpose and 35 of 54 live tenants have it
//   NULL today; part 150 removed the last database defaults. An amount that
//   cannot be denominated is WITHHELD and the reason is printed.
//
// * **Never a sum across currencies.** `sumTaken` produces one pot per
//   currency and this file never flattens them. AED 600 plus GBP 90 is not 690
//   of anything.
//
// * **Never a total over a read that was not whole.** `LoadStatus` is
//   `loading | ready | partial | error`, and a count or a total is stated only
//   under 'ready'. A confident zero over a failed read, in a financial summary,
//   is the worst version of this app's worst defect: it tells a self-employed
//   person they earned nothing.
//
// * **Never the same money twice.** Packs and renewals are disjoint by
//   construction — the stripe-webhook writes `client_purchases` only when
//   `sess.mode !== 'subscription'` — so those two may be combined, and only
//   those two. Invoices are NOT added to them: a coach who issues a document
//   for a pack Stripe already took would otherwise have it counted twice, and
//   this file says so rather than quietly picking one.
//
// * **Never a period this app chose.** `PERIOD_IS_YOURS` says outright that
//   the period is a calendar period the coach picked and that this app does not
//   know which period anybody's accountant works to.
//
// Pure, framework-free and asserted against under plain `node`. The reads live
// in src/ui/coachStatement.ts; nothing here touches Supabase.

import type { LoadStatus } from '../ui/loadStatus';
// One money formatter for the whole app. It refuses to print an amount whose
// currency it was not told, and it knows which currencies have no minor unit,
// so ¥50,000 does not print as ¥500. A statement is the last place that may
// hold a second opinion about how much money something is.
import { minorMoney, wholeMoney, sumTaken, combineTaken, ZERO_DECIMAL, type Taken, type TakenRow } from './coachMoney';
// The same five replacements the invoice uses, rather than a fifth private
// copy. Every value on this page that a person typed goes through it.
import { escapeHtml } from './coachInvoice';

/* ── the period ───────────────────────────────────────────────────────────── */

/**
 * A calendar period the coach picked.
 *
 * `from` and `to` are inclusive `YYYY-MM-DD`. There is deliberately no notion
 * of a fiscal or a tax year in this type: this app does not know which one
 * applies to the person reading it, and offering "2025/26" would be picking a
 * jurisdiction on their behalf.
 */
export interface StatementPeriod {
  from: string;
  to: string;
  /** What the coach sees. Sentence-free — it is a label, not prose. */
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, mIndex: number, d: number) => `${y}-${pad(mIndex + 1)}-${pad(d)}`;

/** Days in a month, honouring leap years. `new Date(y, m + 1, 0)` is the last
 *  day of month `m`, and it is built locally so no UTC rollover is involved. */
const lastDay = (y: number, mIndex: number) => new Date(y, mIndex + 1, 0).getDate();

/** 1 January to 31 December. Named `calendarYear` and never `taxYear`. */
export function calendarYear(y: number): StatementPeriod {
  return { from: iso(y, 0, 1), to: iso(y, 11, 31), label: String(y) };
}

/** A three-month calendar quarter, `q` from 1 to 4. */
export function calendarQuarter(y: number, q: number): StatementPeriod {
  const qq = Math.min(4, Math.max(1, Math.floor(q)));
  const first = (qq - 1) * 3;
  const last = first + 2;
  return { from: iso(y, first, 1), to: iso(y, last, lastDay(y, last)), label: `Q${qq} ${y}` };
}

/** One calendar month, `m` from 1 to 12. */
export function calendarMonth(y: number, m: number): StatementPeriod {
  const mi = Math.min(11, Math.max(0, Math.floor(m) - 1));
  return { from: iso(y, mi, 1), to: iso(y, mi, lastDay(y, mi)), label: `${MONTHS[mi]} ${y}` };
}

/** `YYYY-MM-DD` as a person reads it, without going through `new Date(s)` —
 *  which is UTC midnight, and so the day before for anybody west of Greenwich. */
export function dayLabel(isoDay: string | null | undefined): string {
  const s = String(isoDay ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '—';
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return '—';
  return `${Number(m[3])} ${MONTHS[mi]} ${m[1]}`;
}

/** The period spelled out, both ends, for the face of the document. */
export function periodSentence(p: StatementPeriod): string {
  return `${dayLabel(p.from)} to ${dayLabel(p.to)} inclusive`;
}

/**
 * The half-open instant range a period covers, in the reader's own zone.
 *
 * A calendar day is a day where the coach is standing. `new Date(y, m, d)` is
 * local midnight; `Date.parse('2026-01-01')` is UTC midnight, which is 31
 * December in Los Angeles — so a January statement built the naive way opens
 * with the last evening of the previous year's takings in it.
 *
 * Half-open by design: `[from, dayAfterTo)`. A closing bound of "local midnight
 * on the `to` day" would silently drop everything sold on the last day of the
 * period, which for a December statement is the busiest day in it.
 */
export interface PeriodRange { fromMs: number; toMs: number }

export function periodRange(p: StatementPeriod): PeriodRange | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.from ?? ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.to ?? ''));
  if (!a || !b) return null;
  const from = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 0, 0, 0, 0).getTime();
  // The day AFTER `to`, at local midnight. Date normalises an overflowing day
  // number, so the 32nd of January is the 1st of February without a branch.
  const to = new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]) + 1, 0, 0, 0, 0).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { fromMs: from, toMs: to };
}

/**
 * The ISO instants a PostgREST `.gte()` / `.lt()` pair needs for this period.
 *
 * The bounds are computed once, here, so the rows the server returns and the
 * rows this module would have accepted cannot disagree. A screen that filtered
 * again in JavaScript with a different rule would either drop rows it had
 * already been given or, worse, keep rows outside the period it printed.
 */
export function periodBoundsIso(p: StatementPeriod): { fromIso: string; toIso: string } | null {
  const r = periodRange(p);
  if (!r) return null;
  return { fromIso: new Date(r.fromMs).toISOString(), toIso: new Date(r.toMs).toISOString() };
}

/** A row with a timestamp on it, and how it was split against a period. */
export interface PeriodSplit<T> {
  /** Rows whose instant falls inside the period. */
  inside: T[];
  /**
   * Rows whose date would not parse at all. Kept OUT of the period rather than
   * swept into it — a payment this app cannot date is not evidence about this
   * year — and counted, because a row silently dropped from a financial summary
   * is exactly the quiet subtraction this codebase keeps banning.
   */
  undated: number;
}

export function splitByPeriod<T>(rows: readonly T[], at: (row: T) => string | null | undefined, range: PeriodRange | null): PeriodSplit<T> {
  const inside: T[] = [];
  let undated = 0;
  for (const r of rows) {
    const t = Date.parse(String(at(r) ?? ''));
    if (!Number.isFinite(t)) { undated += 1; continue; }
    if (range && t >= range.fromMs && t < range.toMs) inside.push(r);
  }
  return { inside, undated };
}

/**
 * The same split for a DATE-ONLY column, compared as calendar days.
 *
 * `coach_invoices.issued_on` is a Postgres `date` and comes back as a bare
 * `YYYY-MM-DD`. It means a day, not an instant, and it must not go through
 * `splitByPeriod`: `Date.parse('2026-01-01')` is UTC midnight, which is
 * 08:00 BEFORE local midnight in Los Angeles — so an invoice issued on the
 * first day of the period would fall outside the period that names it, for
 * every coach in the Americas and for nobody in Dubai, where this was written.
 *
 * ISO dates sort lexicographically, so the comparison is the string one and no
 * Date is constructed at all. A value that is not a bare date is undated: it is
 * in no period rather than swept into this one.
 */
export function splitByDay<T>(rows: readonly T[], on: (row: T) => string | null | undefined, p: StatementPeriod): PeriodSplit<T> {
  const inside: T[] = [];
  let undated = 0;
  const from = String(p.from ?? '');
  const to = String(p.to ?? '');
  const readable = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of rows) {
    const d = String(on(r) ?? '').slice(0, 10);
    if (!readable.test(d)) { undated += 1; continue; }
    if (readable.test(from) && readable.test(to) && d >= from && d <= to) inside.push(r);
  }
  return { inside, undated };
}

/* ── amounts as plain digits, for a spreadsheet ───────────────────────────── */

/**
 * Minor units as an exact decimal string, or null when it cannot be stated.
 *
 * Deliberately string arithmetic: this is a ledger, and `(cents / 100)
 * .toFixed(2)` is a float division. The answer is the same digits the database
 * holds with a point pushed two places left, which is a text operation.
 *
 * CURRENCY-AWARE, and that is the whole reason this is not
 * `minorToDecimal` from gymExport.ts. That one always divides by a hundred.
 * There are no sen in a yen: ¥50,000 is stored as 50000 minor units, and
 * writing "500.00" into an accountant's spreadsheet understates a coach's
 * takings by a factor of a hundred in sixteen currencies.
 *
 * Null — not "0.00" — when either half is missing, so the CSV cell is empty and
 * nobody reads a hole as a sale for nothing.
 */
export function minorToPlain(minorUnits: number | null | undefined, currency: string | null | undefined): string | null {
  if (minorUnits == null || !Number.isFinite(minorUnits) || !Number.isInteger(minorUnits)) return null;
  const cur = (currency || '').trim().toLowerCase();
  if (!cur) return null;
  if (ZERO_DECIMAL.has(cur)) return String(minorUnits);
  const neg = minorUnits < 0;
  const digits = String(Math.abs(minorUnits)).padStart(3, '0');
  return (neg ? '-' : '') + digits.slice(0, -2) + '.' + digits.slice(-2);
}

/**
 * A whole-unit amount as a plain string, or null when it cannot be stated.
 *
 * `charges.amount` is `numeric` and holds MAJOR units — 25 means twenty-five
 * pounds, not twenty-five pence. Everything else on this statement is minor
 * units. Mixing the two is a hundred-fold error in a money column, so the two
 * conversions are separate functions with separate names and the sections that
 * use them are never added together.
 */
export function majorToPlain(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const cur = (currency || '').trim().toLowerCase();
  if (!cur) return null;
  return ZERO_DECIMAL.has(cur) ? String(Math.round(amount)) : amount.toFixed(2);
}

/* ── what the caller hands over ───────────────────────────────────────────── */

/** One session, reduced to the two things a count depends on. */
export interface StatementSession {
  startsAt: string;
  /** 'completed' | 'no_show' | 'cancelled' | 'late_cancelled', or null when
   *  nobody has said yet. Null is its own answer and is reported as one. */
  outcome: string | null;
}

/** One document the coach issued. */
export interface StatementInvoice {
  seq: number;
  billTo: string;
  description: string;
  amountCents: number | null;
  currency: string | null;
  /** The coach's own word: 'received' or 'requested'. Never verified here. */
  kind: string;
  issuedOn: string;
  voidedAt: string | null;
}

/** One late-cancellation fee recorded against a client. MAJOR units. */
export interface StatementCharge {
  amount: number | null;
  currency: string | null;
  createdAt: string;
  /** When the coach forgave it. The row stays either way — a waived fee is a
   *  fact about what happened, not an absence. */
  waivedAt: string | null;
}

/** Everything this app knows about a coach's Connect account. Four columns. */
export interface PayoutKnowledge {
  status: LoadStatus;
  hasAccount: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** One read, and how far it can be trusted. */
export interface Read<T> { status: LoadStatus; rows: readonly T[] }

export interface StatementInput {
  period: StatementPeriod;
  /**
   * Who the statement is about. Its own read and its own status, for the reason
   * coachInvoice.ts gives: a financial document with the wrong business at the
   * top is a worse artefact than one saying the name could not be read.
   */
  issuer: { status: LoadStatus; name: string | null; brand: string | null };
  sessions: Read<StatementSession>;
  packs: Read<TakenRow>;
  subscriptions: Read<TakenRow>;
  invoices: Read<StatementInvoice>;
  lateCancellations: Read<StatementCharge>;
  payouts: PayoutKnowledge;
  /** When it was built, ISO. Printed, because a statement of a period is only
   *  ever "as this app held it at" a moment. */
  generatedAt: string;
}

/* ── the standing statements ──────────────────────────────────────────────── */

/**
 * What this document is NOT. The single most important text on the page.
 *
 * A constant rather than an inline string so it cannot be softened on one
 * surface and left alone on another, and so the test can assert it appears on
 * every artefact this module builds — the readable statement and the CSV both.
 */
export const STATEMENT_NOT =
  'THIS IS NOT A TAX DOCUMENT AND IT IS NOT A STATEMENT OF EARNINGS. No tax of any kind has been calculated, added, withheld or deducted anywhere on it — those concepts are absent from it, not set to zero. Nothing has been taken off any figure here: no processing fee, no platform fee, no cost of any kind. Every amount is the gross a client was charged. It is not proof that money moved and it is not a statement of what reached a bank account. Give it to your accountant alongside your records from Stripe and your bank; it is something for them to work from, not a return.';

/** What it IS, said in the same breath so the two are never separated. */
export const STATEMENT_IS =
  'This is a list of what this app recorded between the two dates named above, and nothing else. Each section says where its figures came from.';

/**
 * That this app is not the whole of a coach's book.
 *
 * The half of a working trainer's income that arrives in cash, by bank
 * transfer, or through a gym's front desk was never in this app to be listed,
 * and a statement that did not say so would read as a complete year.
 */
export const STATEMENT_NOT_THE_WHOLE_BOOK =
  'This covers what went through this app. Anything a client paid you in cash, by bank transfer, or through a gym is not recorded here and is therefore not on this statement. If you were paid outside this app in this period, this is short by that amount and only you know by how much.';

/** That Stripe, not this app, is the authority on money that moved. */
export const STATEMENT_STRIPE_IS_THE_RECORD =
  'Where Stripe took the payment, Stripe’s own record is the artefact. The amounts here are what this app was told at the time; they have never been reconciled against Stripe, against a bank, or against each other. What Stripe charged in fees, what the platform took, and whether the money has reached your bank are not recorded in this app at all.';

/** That the period was the coach's choice and not this app's. */
export const PERIOD_IS_YOURS =
  'The period above is a calendar period you chose. This app does not know which period your accountant or your authority works to and has not assumed one.';

/**
 * Why sessions are counted and never priced.
 *
 * A session's `rate_cents` is a GYM payroll rate, snapshotted for settling with
 * an employed trainer — it is not a self-employed coach's income. And a session
 * delivered against a pack was already paid for in the pack sale above, so
 * pricing the sessions as well would count the same money twice. Both of those
 * would look perfectly reasonable on a screen, which is why the reason is
 * printed rather than left to a code comment.
 */
export const SESSIONS_NOT_MONEY =
  'Sessions are counted here and deliberately not priced. A session paid for out of a pack was already paid for in the sales above, and pricing it again would count the same money twice.';

/** Why invoices are listed apart and never added to the sales. */
export const INVOICES_NOT_ADDED =
  'These are documents you issued. They may describe the same money as the sales above — an invoice you wrote for a pack Stripe had already taken — so they are listed separately and are deliberately not added to anything else on this statement.';

/** Why late-cancellation fees are their own section. */
export const LATE_FEES_NOT_TAKINGS =
  'These are fees recorded in this app against your clients. This app does not charge them, is not told whether they were paid, and does not add them to anything above.';

/* ── late-cancellation fees, in whole units ───────────────────────────────── */

/** Fees recorded in one currency. Never merged with another, and never merged
 *  with the minor-unit pots above — see `majorToPlain`. */
export interface ChargePot { currency: string; wholeUnits: number; count: number }

export interface ChargeTotals {
  pots: ChargePot[];
  /** Forgiven by the coach. Left out of the pots, and said out loud. */
  waived: number;
  /** An amount with no currency on it. Counted, never summed, never dropped. */
  unlabelled: number;
  /** No amount recorded at all. */
  unpriced: number;
}

/**
 * Add up recorded fees, per currency, in whole units.
 *
 * A waived fee is excluded from the pots and counted separately, the same
 * discipline `invoiceBook` keeps for a voided invoice: an omitted row a coach
 * cannot see is worse than one they can.
 */
export function sumCharges(rows: readonly StatementCharge[]): ChargeTotals {
  const by = new Map<string, ChargePot>();
  let waived = 0;
  let unlabelled = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.waivedAt) { waived += 1; continue; }
    if (r.amount == null || !Number.isFinite(r.amount)) { unpriced += 1; continue; }
    const cur = (r.currency || '').trim().toUpperCase();
    if (!cur) { unlabelled += 1; continue; }
    const pot = by.get(cur);
    if (pot) { pot.wholeUnits += r.amount; pot.count += 1; }
    else by.set(cur, { currency: cur, wholeUnits: r.amount, count: 1 });
  }
  const pots = [...by.values()].sort((a, b) => (b.wholeUnits - a.wholeUnits) || a.currency.localeCompare(b.currency));
  return { pots, waived, unlabelled, unpriced };
}

/* ── the sections ─────────────────────────────────────────────────────────── */

export type SectionKey = 'sessions' | 'packs' | 'subscriptions' | 'invoices' | 'lateCancellations';

/** One line of money, ready to print. */
export interface MoneyLine { label: string; amount: string }

export interface StatementSection {
  key: SectionKey;
  /** Title Case, because it is a heading. */
  title: string;
  /** Where these figures came from, in the words the coach reads. */
  source: string;
  status: LoadStatus;
  /** Stated only under a whole read. Null means unknown, never zero. */
  count: number | null;
  /** What the count is a count OF, singular/plural resolved. */
  countLabel: string;
  /** One line per currency. Empty under a whole read means nothing recorded. */
  lines: MoneyLine[];
  /** Why there is no figure, or null when there is one. */
  withheld: string | null;
  /** Rows left out of the figures, and anything else that has to be said. */
  notes: string[];
}

/** The sentence a read that did not land puts where the figures would have
 *  gone. 'loading' collapses into a withholding for the same reason it does on
 *  an invoice: a document is built and handed over in one gesture, so a read
 *  still in flight is a read that did not answer. */
export function withheldReason(status: LoadStatus, what: string): string | null {
  if (status === 'ready') return null;
  if (status === 'partial') {
    return `More ${what} are on record than this app was able to read in one go, so no figure is stated. What is listed is real and it is not all of it.`;
  }
  if (status === 'loading') {
    return `Your ${what} had not finished loading when this was built, so no figure is stated. Nothing here says there were none.`;
  }
  return `Your ${what} could not be read, so no figure is stated. An empty section here does NOT mean there were none — it means this app could not tell you.`;
}

/** Money lines from a `Taken`, or an empty list when nothing was recorded. */
function takenLines(t: Taken): MoneyLine[] {
  return t.pots.map((p) => ({
    label: `${p.count} ${p.count === 1 ? 'payment' : 'payments'} in ${p.currency}`,
    // Never a bare number. `minorMoney` returns null if it was not told a
    // currency, and a null here would be a bug in `sumTaken`, which cannot
    // build a pot without one — so the dash is unreachable rather than tolerated.
    amount: minorMoney(p.minorUnits, p.currency) ?? '—',
  }));
}

/** What a `Taken` has to admit to. */
function takenNotes(t: Taken, noun: string): string[] {
  const out: string[] = [];
  if (t.pots.length > 1) {
    out.push('These are separate amounts of money in different currencies and are deliberately not added together.');
  }
  if (t.unlabelled > 0) {
    out.push(`${t.unlabelled} ${t.unlabelled === 1 ? `${noun} has` : `${noun}s have`} an amount with no currency on it, so ${t.unlabelled === 1 ? 'it is' : 'they are'} not in any figure above. Do not read the shorter total as the whole of it.`);
  }
  if (t.unpriced > 0) {
    out.push(`${t.unpriced} ${t.unpriced === 1 ? `${noun} has` : `${noun}s have`} no amount recorded at all, so ${t.unpriced === 1 ? 'it is' : 'they are'} counted and not summed.`);
  }
  return out;
}

/* ── the statement ────────────────────────────────────────────────────────── */

export interface Statement {
  period: StatementPeriod;
  issuerName: string | null;
  issuerStatus: LoadStatus;
  brand: string | null;
  generatedAt: string;
  sections: StatementSection[];
  /**
   * Packs and renewals added together, per currency — the one combination this
   * statement makes, and only when BOTH reads were whole. The two are disjoint
   * by construction: the stripe-webhook writes a `client_purchases` row only
   * when `sess.mode !== 'subscription'`, and a renewal is one row per paid
   * invoice, so nothing can be in both.
   */
  salesTotal: { lines: MoneyLine[]; notes: string[] } | null;
  /** Why there is no combined figure, or null when there is one. */
  salesWithheld: string | null;
  payouts: { title: string; lines: string[] };
  /** One sentence per part that could not be read. Empty means everything was. */
  caveats: string[];
  /** True only when every read landed whole. */
  complete: boolean;
}

/** Every part that could not be read, named. */
export function statementCaveats(input: StatementInput): string[] {
  const out: string[] = [];
  const say = (status: LoadStatus, what: string, cost: string) => {
    if (status === 'ready') return;
    const how = status === 'partial'
      ? 'came back with more rows than one request returns'
      : status === 'loading'
        ? 'had not finished loading when this was built'
        : 'could not be read';
    out.push(`${what}: this read ${how}, so ${cost} is MISSING from this statement rather than absent from your record. Fix the read and take it again before treating this as a complete list.`);
  };
  if (input.issuer.status !== 'ready') {
    out.push('Your name: it could not be read when this was built, so the top of this statement is blank. That is a failed read, not a record with no name in it.');
  }
  say(input.sessions.status, 'Sessions', 'the number of sessions you delivered');
  say(input.packs.status, 'Packs and memberships sold', 'what clients paid you for packs and memberships');
  say(input.subscriptions.status, 'Subscription renewals', 'what clients paid you in renewals');
  say(input.invoices.status, 'Invoices issued', 'the documents you issued');
  say(input.lateCancellations.status, 'Late-cancellation fees', 'the fees recorded against your clients');
  if (input.payouts.status !== 'ready') {
    out.push('Your payout account: its state could not be read, so this statement says nothing about whether you are set up to be paid.');
  }
  return out;
}

/**
 * What this app knows about payouts. Four columns, and it says so.
 *
 * This is the honest deliverable in place of a payout schedule. No `payout.*`
 * event reaches this app, so there is no date, no amount, no fee and no arrival
 * to show — and a timetable rendered from nothing would be read as a promise
 * about when somebody's rent money lands.
 */
export function payoutFacts(k: PayoutKnowledge): { title: string; lines: string[] } {
  const lines: string[] = [];
  if (k.status !== 'ready') {
    lines.push('Whether you have a payout account set up could not be read just now. Nothing below is a statement about your account.');
  } else if (!k.hasAccount) {
    lines.push('You have not connected a payout account, so nothing has been paid out to you through this app.');
  } else if (!k.chargesEnabled) {
    lines.push(k.detailsSubmitted
      ? 'You have started setting up a payout account and Stripe has not finished verifying it. Until it does, clients cannot check out.'
      : 'A payout account exists but the setup was never finished, so clients cannot check out yet.');
  } else {
    lines.push('Your payout account is connected and clients can check out.');
  }
  // The part that never changes, and the reason this section exists.
  lines.push('This app is never told about a payout. It does not receive the schedule, the amount, the fee that came off it, or whether it arrived — none of that is sent here and none of it is stored here. There is no payout timetable on this screen because there is no data behind one, and an invented one would be a promise about when your money lands.');
  lines.push('Your payouts live with Stripe. Stripe emails the address you signed up with each time one is sent, and the Express dashboard set up for you when you onboarded is where the schedule and the arrival dates are. This app cannot open it for you — it holds no link to your account, and inventing one would send you somewhere that is not it.');
  return { title: 'Payouts', lines };
}

export function coachStatement(input: StatementInput): Statement {
  const range = periodRange(input.period);

  /* ── sessions: counted, never priced ───────────────────────────────────── */
  const sess = splitByPeriod(input.sessions.rows, (r) => r.startsAt, range);
  const delivered = sess.inside.filter((s) => s.outcome === 'completed').length;
  const noShow = sess.inside.filter((s) => s.outcome === 'no_show').length;
  const lateCancelled = sess.inside.filter((s) => s.outcome === 'late_cancelled').length;
  const cancelled = sess.inside.filter((s) => s.outcome === 'cancelled').length;
  const unmarked = sess.inside.filter((s) => !s.outcome).length;
  const sessionsReady = input.sessions.status === 'ready';
  const sessionNotes: string[] = [SESSIONS_NOT_MONEY];
  if (sessionsReady) {
    sessionNotes.push(`Marked completed: ${delivered}. No-show: ${noShow}. Late-cancelled: ${lateCancelled}. Cancelled: ${cancelled}.`);
    if (unmarked > 0) {
      sessionNotes.push(`${unmarked} session${unmarked === 1 ? '' : 's'} in this period ${unmarked === 1 ? 'has' : 'have'} no outcome recorded, so ${unmarked === 1 ? 'it is' : 'they are'} in the total below and in none of the four lines above.`);
    }
    if (sess.undated > 0) {
      sessionNotes.push(`${sess.undated} session${sess.undated === 1 ? '' : 's'} could not be dated and ${sess.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
    }
  }

  const sessionsSection: StatementSection = {
    key: 'sessions',
    title: 'Sessions in This Period',
    source: 'This app’s own record — sessions booked here and marked here, by you or by your client.',
    status: input.sessions.status,
    count: sessionsReady ? sess.inside.length : null,
    countLabel: sess.inside.length === 1 ? 'session' : 'sessions',
    lines: [],
    withheld: withheldReason(input.sessions.status, 'sessions'),
    notes: sessionNotes,
  };

  /* ── packs and memberships ─────────────────────────────────────────────── */
  const packSplit = splitByPeriod(input.packs.rows, (r) => r.created_at, range);
  const packTaken = sumTaken(packSplit.inside);
  const packsReady = input.packs.status === 'ready';
  const packNotes = packsReady ? takenNotes(packTaken, 'sale') : [];
  if (packsReady && packSplit.undated > 0) {
    packNotes.push(`${packSplit.undated} sale${packSplit.undated === 1 ? '' : 's'} could not be dated and ${packSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
  }
  const packsSection: StatementSection = {
    key: 'packs',
    title: 'Packs and Memberships Sold',
    source: 'Stripe took these payments and told this app what it had charged. Stripe’s own record is the authority; this is what this app was told at the time.',
    status: input.packs.status,
    count: packsReady ? packSplit.inside.length : null,
    countLabel: packSplit.inside.length === 1 ? 'sale' : 'sales',
    lines: packsReady ? takenLines(packTaken) : [],
    withheld: withheldReason(input.packs.status, 'sales'),
    notes: packNotes,
  };

  /* ── subscription renewals ─────────────────────────────────────────────── */
  const subSplit = splitByPeriod(input.subscriptions.rows, (r) => r.created_at, range);
  const subTaken = sumTaken(subSplit.inside);
  const subsReady = input.subscriptions.status === 'ready';
  const subNotes = subsReady ? takenNotes(subTaken, 'renewal') : [];
  if (subsReady && subSplit.undated > 0) {
    subNotes.push(`${subSplit.undated} renewal${subSplit.undated === 1 ? '' : 's'} could not be dated and ${subSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
  }
  const subsSection: StatementSection = {
    key: 'subscriptions',
    title: 'Subscription Renewals Paid',
    source: 'One row per renewal invoice Stripe reported as paid. Stripe’s own record is the authority; this is what this app was told at the time.',
    status: input.subscriptions.status,
    count: subsReady ? subSplit.inside.length : null,
    countLabel: subSplit.inside.length === 1 ? 'renewal' : 'renewals',
    lines: subsReady ? takenLines(subTaken) : [],
    withheld: withheldReason(input.subscriptions.status, 'renewals'),
    notes: subNotes,
  };

  /* ── invoices issued ───────────────────────────────────────────────────── */
  // By DAY, not by instant: `issued_on` is a Postgres `date` and means a
  // calendar day. See `splitByDay` for what going through the instant range
  // costs a coach in Los Angeles on the first of the month.
  const invSplit = splitByDay(input.invoices.rows, (r) => r.issuedOn, input.period);
  const voided = invSplit.inside.filter((i) => !!i.voidedAt);
  const live = invSplit.inside.filter((i) => !i.voidedAt);
  const received = live.filter((i) => i.kind === 'received').length;
  const invTaken = sumTaken(live.map((i): TakenRow => ({ amount_cents: i.amountCents, currency: i.currency, created_at: i.issuedOn })));
  const invReady = input.invoices.status === 'ready';
  const invNotes = [INVOICES_NOT_ADDED];
  if (invReady) {
    invNotes.push(`${received} of ${live.length} state the money was received; the rest state it was being requested. Both are your own word and neither has been checked against a bank or a card processor.`);
    if (voided.length > 0) {
      invNotes.push(`${voided.length} voided invoice${voided.length === 1 ? ' is' : 's are'} left out of the figures above. ${voided.length === 1 ? 'Its number is' : 'Their numbers are'} not reused.`);
    }
    for (const n of takenNotes(invTaken, 'invoice')) invNotes.push(n);
    if (invSplit.undated > 0) {
      invNotes.push(`${invSplit.undated} invoice${invSplit.undated === 1 ? '' : 's'} could not be dated and ${invSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
    }
  }
  const invoicesSection: StatementSection = {
    key: 'invoices',
    title: 'Invoices You Issued',
    source: 'Your own documents, numbered in your own sequence inside this app. What each says about the money is your statement, not a verified fact.',
    status: input.invoices.status,
    count: invReady ? live.length : null,
    countLabel: live.length === 1 ? 'invoice that stands' : 'invoices that stand',
    lines: invReady ? takenLines(invTaken) : [],
    withheld: withheldReason(input.invoices.status, 'invoices'),
    notes: invNotes,
  };

  /* ── late-cancellation fees ────────────────────────────────────────────── */
  const feeSplit = splitByPeriod(input.lateCancellations.rows, (r) => r.createdAt, range);
  const fees = sumCharges(feeSplit.inside);
  const feesReady = input.lateCancellations.status === 'ready';
  const feeNotes = [LATE_FEES_NOT_TAKINGS];
  if (feesReady) {
    if (fees.pots.length > 1) feeNotes.push('These are separate amounts of money in different currencies and are deliberately not added together.');
    if (fees.waived > 0) feeNotes.push(`${fees.waived} fee${fees.waived === 1 ? ' was' : 's were'} waived by you and ${fees.waived === 1 ? 'is' : 'are'} left out of the figures above.`);
    if (fees.unlabelled > 0) feeNotes.push(`${fees.unlabelled} fee${fees.unlabelled === 1 ? ' has' : 's have'} an amount with no currency on it, so ${fees.unlabelled === 1 ? 'it is' : 'they are'} not in any figure above.`);
    if (fees.unpriced > 0) feeNotes.push(`${fees.unpriced} fee${fees.unpriced === 1 ? ' has' : 's have'} no amount recorded at all.`);
    if (feeSplit.undated > 0) feeNotes.push(`${feeSplit.undated} fee${feeSplit.undated === 1 ? '' : 's'} could not be dated and ${feeSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
  }
  const feesSection: StatementSection = {
    key: 'lateCancellations',
    title: 'Late-Cancellation Fees Recorded',
    source: 'Recorded in this app against your own clients, under your own late-cancellation policy.',
    status: input.lateCancellations.status,
    count: feesReady ? feeSplit.inside.length - fees.waived : null,
    countLabel: feeSplit.inside.length - fees.waived === 1 ? 'fee that stands' : 'fees that stand',
    lines: feesReady
      ? fees.pots.map((p) => ({
        label: `${p.count} ${p.count === 1 ? 'fee' : 'fees'} in ${p.currency}`,
        amount: wholeMoney(p.wholeUnits, p.currency) ?? '—',
      }))
      : [],
    withheld: withheldReason(input.lateCancellations.status, 'late-cancellation fees'),
    notes: feeNotes,
  };

  /* ── the one combination this statement makes ──────────────────────────── */
  //
  // Only when BOTH halves came back whole. A sum over a page of a longer list
  // is not a smaller total, it is a wrong one — and this is the figure a coach
  // is most likely to copy straight into something else.
  const bothWhole = packsReady && subsReady;
  const combined = bothWhole ? combineTaken(packTaken, subTaken) : null;
  const salesTotal = combined
    ? {
      lines: combined.pots.map((p) => ({
        label: `${p.count} ${p.count === 1 ? 'payment' : 'payments'} in ${p.currency}`,
        amount: minorMoney(p.minorUnits, p.currency) ?? '—',
      })),
      notes: takenNotes(combined, 'payment'),
    }
    : null;
  const salesWithheld = bothWhole
    ? null
    : 'No combined figure is stated, because one of the two reads behind it did not come back whole. Adding a complete half to an incomplete one produces a number that is wrong rather than small.';

  const caveats = statementCaveats(input);

  return {
    period: input.period,
    issuerName: (input.issuer.name || '').trim() || null,
    issuerStatus: input.issuer.status,
    brand: (input.issuer.brand || '').trim() || null,
    generatedAt: input.generatedAt,
    sections: [sessionsSection, packsSection, subsSection, invoicesSection, feesSection],
    salesTotal,
    salesWithheld,
    payouts: payoutFacts(input.payouts),
    caveats,
    complete: caveats.length === 0,
  };
}

/* ── the document a coach hands over ──────────────────────────────────────── */

export interface StatementDoc {
  html: string;
  text: string;
  complete: boolean;
  caveats: string[];
}

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
  .not{border:3px solid #b91c1c;border-radius:10px;padding:14px 16px;margin-top:16px;color:#b91c1c}
  .not h3{margin:0 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:1px}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .r{text-align:right}
  .none{color:#64748b}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px}
`;

/**
 * The statement, in HTML and in plain text.
 *
 * Both are built from the same values in the same order, so the text a coach
 * sends from a build with no expo-print says exactly what the PDF would have
 * said — including every standing statement and every caveat. A text fallback
 * that dropped those would be the same failure arriving through the back door.
 */
export function statementDoc(s: Statement): StatementDoc {
  const H: string[] = [];
  const T: string[] = [];
  const readIssuer = s.issuerStatus === 'ready' || s.issuerStatus === 'partial';

  H.push(`<div class="h"><h1>Statement of Record</h1><p>${escapeHtml(periodSentence(s.period))}${s.brand ? ' · ' + escapeHtml(s.brand) : ''}</p></div>`);
  T.push('STATEMENT OF RECORD');
  T.push(periodSentence(s.period) + (s.brand ? ' · ' + s.brand : ''));

  /* ── what it is not, before anything a reader could mistake for a figure ─ */
  H.push(`<div class="not"><h3>Read this first</h3><p>${escapeHtml(STATEMENT_NOT)}</p></div>`);
  T.push('', '*** READ THIS FIRST ***', STATEMENT_NOT);

  /* ── the caveats, where they cannot be scrolled past ────────────────────── */
  if (!s.complete) {
    H.push('<div class="warn"><h3>Parts of this could not be read</h3><ul>');
    T.push('', '*** PARTS OF THIS COULD NOT BE READ ***');
    for (const c of s.caveats) { H.push(`<li>${escapeHtml(c)}</li>`); T.push('- ' + c); }
    H.push('</ul></div>');
  }

  /* ── whose it is ───────────────────────────────────────────────────────── */
  H.push('<h2>Whose record this is</h2>');
  T.push('', 'WHOSE RECORD THIS IS');
  if (!readIssuer) {
    H.push('<p class="none"><b>Not read.</b> The name on this account could not be read when this statement was made, so nothing is printed here. This is not a statement that the record has no name in it.</p>');
    T.push('Name: NOT READ — the name on this account could not be read. This is not a statement that the record has no name in it.');
  } else if (!s.issuerName) {
    H.push('<p class="none">No name has been recorded on this account.</p>');
    T.push('Name: no name has been recorded on this account.');
  } else {
    H.push(`<p><b>${escapeHtml(s.issuerName)}</b></p>`);
    T.push(s.issuerName);
  }
  H.push(`<p class="lede">Period: ${escapeHtml(periodSentence(s.period))}. Built ${escapeHtml(String(s.generatedAt))}.</p>`);
  T.push(`Period: ${periodSentence(s.period)}. Built ${s.generatedAt}.`);
  H.push(`<p class="lede">${escapeHtml(PERIOD_IS_YOURS)}</p>`);
  T.push(PERIOD_IS_YOURS);

  /* ── the sections ──────────────────────────────────────────────────────── */
  for (const sec of s.sections) {
    H.push(`<h2>${escapeHtml(sec.title)}</h2>`);
    T.push('', sec.title.toUpperCase());
    H.push(`<p class="lede">Source: ${escapeHtml(sec.source)}</p>`);
    T.push(`Source: ${sec.source}`);
    if (sec.withheld) {
      H.push(`<p class="none"><b>No figure.</b> ${escapeHtml(sec.withheld)}</p>`);
      T.push(`NO FIGURE: ${sec.withheld}`);
    } else {
      H.push(`<p><b>${sec.count} ${escapeHtml(sec.countLabel)}</b> in this period.</p>`);
      T.push(`${sec.count} ${sec.countLabel} in this period.`);
      if (sec.lines.length) {
        H.push('<table><tr><th>Recorded</th><th class="r">Amount</th></tr>'
          + sec.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td class="r">${escapeHtml(l.amount)}</td></tr>`).join('')
          + '</table>');
        for (const l of sec.lines) T.push(`  ${l.label}   ${l.amount}`);
      }
    }
    for (const n of sec.notes) { H.push(`<p class="lede">${escapeHtml(n)}</p>`); T.push(n); }
  }

  /* ── the one combined figure ───────────────────────────────────────────── */
  H.push('<h2>Packs and Renewals Together</h2>');
  T.push('', 'PACKS AND RENEWALS TOGETHER');
  if (s.salesTotal) {
    H.push('<p class="lede">The two sections above are the only two figures on this statement that may be added, and they are added one currency at a time.</p>');
    T.push('The two sections above are the only two figures on this statement that may be added, and they are added one currency at a time.');
    if (s.salesTotal.lines.length) {
      H.push('<table><tr><th>Recorded</th><th class="r">Amount</th></tr>'
        + s.salesTotal.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td class="r">${escapeHtml(l.amount)}</td></tr>`).join('')
        + '</table>');
      for (const l of s.salesTotal.lines) T.push(`  ${l.label}   ${l.amount}`);
    } else {
      H.push('<p class="none">Nothing was recorded in either section in this period.</p>');
      T.push('Nothing was recorded in either section in this period.');
    }
    for (const n of s.salesTotal.notes) { H.push(`<p class="lede">${escapeHtml(n)}</p>`); T.push(n); }
  } else {
    H.push(`<p class="none"><b>No figure.</b> ${escapeHtml(s.salesWithheld ?? '')}</p>`);
    T.push(`NO FIGURE: ${s.salesWithheld ?? ''}`);
  }

  /* ── payouts ───────────────────────────────────────────────────────────── */
  H.push(`<h2>${escapeHtml(s.payouts.title)}</h2>`);
  T.push('', s.payouts.title.toUpperCase());
  for (const l of s.payouts.lines) { H.push(`<p class="lede">${escapeHtml(l)}</p>`); T.push(l); }

  /* ── what this document is, and is not ─────────────────────────────────── */
  H.push('<h2>About this statement</h2>');
  T.push('', 'ABOUT THIS STATEMENT');
  for (const line of [STATEMENT_IS, STATEMENT_NOT, STATEMENT_NOT_THE_WHOLE_BOOK, STATEMENT_STRIPE_IS_THE_RECORD]) {
    H.push(`<p class="lede">${escapeHtml(line)}</p>`);
    T.push(line);
  }

  const foot = s.complete
    ? `Statement of record for ${periodSentence(s.period)}${s.brand ? ', from ' + s.brand : ''}. Not a tax document.`
    : `Statement of record for ${periodSentence(s.period)} — PARTS OF THIS COULD NOT BE READ, see above${s.brand ? '. From ' + s.brand : ''}. Not a tax document.`;
  H.push(`<p class="foot">${escapeHtml(foot)}</p>`);
  T.push('', foot);

  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body>${H.join('')}</body></html>`;
  return { html, text: T.join('\n'), complete: s.complete, caveats: s.caveats };
}

/* ── the line-item file ───────────────────────────────────────────────────── */

/**
 * Everything that must force a CSV field to be quoted.
 *
 * Wider than RFC 4180, and the same set gymExport.ts uses, for the same reason:
 * `sniffDelimiter` in src/lib/csv.ts will happily decide a file is semicolon-
 * or tab-separated, and so will a spreadsheet in a comma-decimal locale. A
 * client called "Smith, Jr." or a description reading "8 sessions; paid cash"
 * must not become an extra column, because every column after it shifts and the
 * amount lands under the wrong heading.
 */
const NEEDS_QUOTES = /[",\r\n;\t|]/;

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  if (s === '') return '';
  return NEEDS_QUOTES.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CSV_HEADER = ['part', 'date', 'who', 'what', 'currency', 'amount', 'status', 'note'];

/**
 * The line items, as a file an accountant opens.
 *
 * The first rows are not data. They are the same standing statements the
 * readable document carries, one per row under `part = about`, so the file says
 * what it is and what it is not on its own face — a CSV that arrives in
 * somebody's inbox with a covering note gets separated from the note.
 *
 * Every part that could not be read gets its own row under `part = not read`,
 * BEFORE the items, so a short file cannot be mistaken for a quiet year. This
 * is the lesson from the console's export: "every part was read successfully"
 * is a sentence a truncating read also satisfies, so what is written here is
 * the failure by name rather than a claim of success.
 *
 * The `amount` column is a plain decimal in the currency beside it, through
 * `minorToPlain` / `majorToPlain` — currency-aware, so a yen figure is not
 * divided by a hundred, and empty rather than zero when the amount cannot be
 * denominated.
 */
export function statementCsv(s: Statement): string {
  const rows: (string | number | null)[][] = [];

  rows.push(['about', '', '', 'What this is', '', '', '', STATEMENT_IS]);
  rows.push(['about', '', '', 'What this is NOT', '', '', '', STATEMENT_NOT]);
  rows.push(['about', '', '', 'What is missing from it', '', '', '', STATEMENT_NOT_THE_WHOLE_BOOK]);
  rows.push(['about', '', '', 'Who holds the real record', '', '', '', STATEMENT_STRIPE_IS_THE_RECORD]);
  rows.push(['about', '', '', 'The period', '', '', '', `${periodSentence(s.period)}. ${PERIOD_IS_YOURS}`]);
  rows.push(['about', '', '', 'Whose record', '', '', '',
    s.issuerStatus === 'ready' || s.issuerStatus === 'partial'
      ? (s.issuerName ?? 'No name has been recorded on this account.')
      : 'NOT READ — the name on this account could not be read when this file was made.']);
  rows.push(['about', '', '', 'Built', '', '', '', String(s.generatedAt)]);

  if (s.caveats.length) {
    for (const c of s.caveats) rows.push(['not read', '', '', 'A part of this record is missing from this file', '', '', '', c]);
  } else {
    // Deliberately not "everything was read successfully". Every read this file
    // is built from returned whole and none of them hit its row cap — which is a
    // narrower claim than completeness, and it is the one that is true.
    rows.push(['about', '', '', 'Reads', '', '', '', 'Every read behind this file returned in full and none of them stopped at a row limit. That is a statement about the reads, not about your whole book — see the row above about what is missing from it.']);
  }

  for (const sec of s.sections) {
    if (sec.withheld) {
      rows.push([sec.key, '', '', sec.title, '', '', 'no figure', sec.withheld]);
      continue;
    }
    rows.push([sec.key, '', '', sec.title, '', '', 'read in full', `${sec.count} ${sec.countLabel}. Source: ${sec.source}`]);
    for (const l of sec.lines) rows.push([sec.key, '', '', l.label, '', '', 'total', l.amount]);
    for (const n of sec.notes) rows.push([sec.key, '', '', sec.title, '', '', 'note', n]);
  }

  return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The line items themselves, one row per invoice and per fee.
 *
 * Kept apart from `statementCsv` because the two answer different questions and
 * a caller may want only one. Sales and renewals are NOT itemised here: they are
 * Stripe's rows, Stripe's record is the artefact, and re-typing them into a
 * spreadsheet under this app's name would invite somebody to reconcile against
 * a copy rather than against the original.
 */
export function statementItemsCsv(s: Statement, invoices: readonly StatementInvoice[], fees: readonly StatementCharge[]): string {
  const rows: (string | number | null)[][] = [];
  rows.push(['about', '', '', 'What this is NOT', '', '', '', STATEMENT_NOT]);
  rows.push(['about', '', '', 'The period', '', '', '', periodSentence(s.period)]);
  for (const c of s.caveats) rows.push(['not read', '', '', 'A part of this record is missing from this file', '', '', '', c]);

  for (const i of invoices) {
    rows.push([
      'invoice',
      i.issuedOn,
      i.billTo,
      i.description,
      i.currency ?? '',
      minorToPlain(i.amountCents, i.currency) ?? '',
      i.voidedAt ? 'voided' : (i.kind === 'received' ? 'stated received' : 'stated requested'),
      i.currency ? '' : 'No currency is recorded on this one, so no amount is written. Do not read the empty cell as nothing charged.',
    ]);
  }
  for (const f of fees) {
    rows.push([
      'late cancellation',
      String(f.createdAt ?? '').slice(0, 10),
      '',
      'Late-cancellation fee',
      f.currency ?? '',
      majorToPlain(f.amount, f.currency) ?? '',
      f.waivedAt ? 'waived' : 'recorded',
      f.currency ? '' : 'No currency is recorded on this one, so no amount is written. Do not read the empty cell as nothing charged.',
    ]);
  }
  return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * A filename that carries its own warning.
 *
 * An incomplete file is named INCOMPLETE, the way gymExport.ts names one, so
 * the fact survives being saved to a desktop and opened three weeks later by
 * somebody who never read the covering note.
 */
export function statementFileStem(s: Statement): string {
  const slug = (s.brand ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const base = ['statement-of-record', slug, s.period.from, 'to', s.period.to].filter(Boolean).join('-');
  return s.complete ? base : base + '-INCOMPLETE';
}

/**
 * What the share sheet says before the file leaves the phone.
 *
 * A coach about to send an accountant a document with figures on it is entitled
 * to know, in advance, that a part of it is missing. Afterwards is too late,
 * because it is already in somebody else's inbox and it is being worked from.
 */
export function statementShareBlurb(s: Statement): string {
  const parts = [
    `Statement of record for ${periodSentence(s.period)}. It says on its own face that it is not a tax document, that no tax has been calculated on it, and that nothing has been taken off the figures.`,
  ];
  if (!s.complete) {
    parts.push(`BEFORE YOU SEND IT: ${s.caveats.length} part${s.caveats.length === 1 ? '' : 's'} of your record could not be read just now, so the file names ${s.caveats.length === 1 ? 'it' : 'them'} rather than looking complete, and its filename says INCOMPLETE. You can send it as it is, or close this and try again in a moment.`);
  }
  return parts.join('\n\n');
}
