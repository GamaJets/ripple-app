'use client';

// Accounting — the month in the shape somebody outside this building has to file.
//
// Every other money screen in the console is for the owner: what came in, who
// is behind, whether payroll is safe to run. This one is for the accountant,
// and that changes what it is allowed to do. An owner reading a slightly wrong
// figure makes a slightly wrong decision. An accountant reading a slightly
// wrong figure signs it, and the gym owns that signature for seven years.
//
// So three things are true of this page that are not true of the others:
//
//   1. It is cash-basis and says so. Money in is payments somebody recorded in
//      the month; money out is payroll somebody settled in the month. Neither
//      is accrual and neither pretends to be.
//   2. It never subtracts one from the other and calls the answer profit. The
//      difference is cash Repple has a record of, and Repple has never seen
//      rent, stock, utilities, insurance, tax, equipment or the owner's own
//      drawings. That sentence is on the screen, not in this comment.
//   3. Where two records should agree and do not, the disagreement is the
//      output. The reconciliation lists at the bottom — invoices marked paid
//      with no payment behind them, payments with no invoice in front of them —
//      are the reason an accountant opens this screen at all. A tidy page with
//      those lists hidden would be worse than no page.
//
// The reads are the dangerous part, as everywhere: supabase-js RESOLVES on a
// database error, so a missing `.error` check turns a refused query into an
// empty month, and an empty month here is a filed return that says the gym
// took nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { type Unread, type Read, reading, landed, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { settledLanded } from '@lib/readLanded';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchPayments, money, type GymPayment } from '@lib/gymRecord';
import {
  monthWindow, recentMonths, monthKeyOf, monthEnded, inMonth,
  type MonthWindow,
} from '@lib/monthEnd';
import { isoDate } from '@lib/format';
import { monthTickStart } from '@lib/pickerMonth';
import { useMonthTick } from '@/lib/monthTick';
import { assertWhole, capLimit, readAll } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';
import { gymLink, noGymNote } from '@lib/gymLink';
// The month's instants on the GYM'S clock, and the caption that says whose
// clock they are. `fetchGymZone` keeps "not set" apart from "could not ask".
import { cutAtGym, type AtGym } from '@lib/gymWindow';
// Which month is the last FINISHED one, and which months to offer — both facts
// about the gym, both answered here on the device's calendar until now.
//
// `cutAtGym` below already moves this page's bounds onto the gym's clock, and
// that is the half of the defect that moved money between months. This is the
// other half, which `cutAtGym` cannot reach because it takes a key rather than
// deriving one: for the four hours after a Gulf gym's month ends and before a
// London reader's does, `recentMonths(2)[1]` named the month BEFORE the one
// that had just finished, and the picker did not offer the finished one at all.
import { gymRecentMonths } from '@lib/gymMonth';
// The reader's locale, the GYM's zone. Every date below was `toLocaleDateString()`
// — the reader's zone — on the one document in this console where the month
// boundary is the whole point: a payment taken at 01:00 on 1 September in Dubai
// printed as 31 August for a bookkeeper in London, on a page headed September.
import { gymDateText } from '@lib/gymWhen';
import { fetchGymZone, gymDay } from '@lib/gymZone';
import { fetchMemberships, matchPayment, fetchOnlineOrders, type Membership, type OnlineOrder } from '@lib/gymRecord';
import { onlineOrderProblem } from '@lib/gymOrderPayment';
import { fetchGymCosts, gymCostsTaken, gymCostCategoryLabel, type GymCost } from '@lib/gymCosts';
// The paper behind a cost. `gym_documents` could say a file was about a member
// or about a machine and had no way to say it was about a COST, so the amount
// and the supplier's invoice sat in one database unable to point at each other
// — and `TAX_UNKNOWNS` prints that gap to the owner at a filing deadline.
// Everything this module exports is careful about the size of the claim:
// attaching a file does not check the figure, and the note below says so.
import {
  fetchCostReceipts, recordCostReceipt, openCostReceipt, byCost, costEvidence,
  evidenceNote, receiptBlocker, receiptTitle, RECEIPT_KINDS, RECEIPT_KIND_LABEL,
  RECEIPT_IS_NOT_A_CHECK_NOTE, type CostReceipt,
} from '@lib/costReceipts';
import { documentPath, discardUnfiledObject, type DocumentKind } from '@lib/gymDocs';
// Why the gym decided not to collect an invoice. `owedOf` has always taken
// 'void' and 'written_off' out of the receivables and the row said nothing
// about who decided that, when, or on what grounds — see supabase/parts/2642.
import {
  dropInvoice, writeOffHistory, unexplainedDrops, isDropStatus,
  DROP_STATUSES, DROP_MEANS, WRITE_OFF_PROMPT, writeOffBlocker, MAX_REASON_CHARS,
  type DropStatus, type DropRecord,
} from '@lib/invoiceWriteOff';
// What this gym said about its tax registration DURING the month, which is not
// the same question as what it says now. `tenants.tax_registered` is a
// current-state boolean and /tax prints it above whichever period is on screen,
// so a gym that registered in April reads "this gym is registered" over its
// January figures. See supabase/parts/2641.
import {
  fetchTaxStandings, recordTaxStanding, endTaxStanding, registrationDuring,
  standingLine, standingBlockers, STANDING_LABEL, CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE,
  type TaxStanding, type TaxStandingDraft, type TaxStandingStatus,
} from '@lib/gymTaxHistory';
import {
  createInvoice, setInvoiceStatus, settleInvoice, invoiceBlocker, parseAmount,
  dueAfter, isoDay, SETTABLE_INVOICE_STATUSES, INVOICE_STATUS_LABEL,
  type InvoiceDraft,
} from '@lib/gymInvoices';
import {
  fetchMarks, markException, clearMark, markBlocker, partitionByMark, markKey,
  type MarkIndex, type MarkState, type ReconcileMark,
} from '@lib/gymReconcile';
import { toCsv } from '@lib/gymExport';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { saveText } from '@/lib/save';
import { Banner, Announce } from '@/components/Banner';

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

const DAY = 86400000;

/**
 * How far either side of an invoice a payment may sit and still be treated as
 * that invoice's payment.
 *
 * There is no invoice_id on `gym_payments`, so nothing in the database links
 * the two. Matching is therefore a guess with a stated rule, and a stated rule
 * needs a stated window: a payment more than six weeks from the invoice date is
 * not evidence about that invoice.
 */
const MATCH_DAYS = 45;

/**
 * What a piece of state is when it holds no rows: a read still in flight, or
 * one that came back refused. Null means the read returned.
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No payments this month" are both lies about a query that errored, and on
 * this screen the second one becomes a number on a tax return.
 */


/* ── rows ──────────────────────────────────────────────────────────────────── */

/**
 * A row of `gym_invoices`.
 *
 * Declared here rather than borrowed from monthEnd.ts because that one types
 * `amountCents` as a number and defaults a null to 0. On the close screen that
 * is survivable. Here it is not: an invoice with no amount recorded is money of
 * unknown size, and a set containing one cannot be totalled at all. Same for
 * `status` — an unrecognised or missing status is reported under its own name
 * rather than quietly filed as "open".
 */
interface Invoice {
  id: string;
  /** The number the gym gave this bill, from supabase/parts/180. Null on rows
   *  raised before that part existed — they were never numbered, and inventing
   *  numbers for them now would put a sequence into the record that nobody ever
   *  quoted on a bank transfer. */
  number: number | null;
  memberId: string | null;
  memberName: string | null;
  membershipId: string | null;
  amountCents: number | null;
  currency: string | null;
  issuedOn: string;
  /** Null means no due date was set — which is not the same as due today, and
   *  is why such an invoice cannot be aged. */
  dueOn: string | null;
  status: string | null;
  note: string | null;
}

/**
 * One invoice's decision not to collect, from supabase/parts/2642.
 *
 * Keyed by the invoice's own id, and only rows that HAVE a decision are read —
 * a gym's dropped invoices are a small fraction of its register and there is
 * nothing to say about the rest.
 */
interface DropRow extends DropRecord { id: string }

/** A row of `payroll_settlements` — money that has actually left the account. */
interface Settled {
  id: string;
  trainerId: string | null;
  trainerName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Null when the run did not record how many sessions it paid for. Not 0 —
   *  a settlement for no sessions and a settlement that forgot to say are
   *  different rows, and only one of them is worth asking about. */
  sessionsCount: number | null;
  method: string | null;
  settledAt: string;
  /** How much of `amountCents` was money the coach spent and got back rather
   *  than pay (supabase/parts/482). NULL means the run did not say, which is
   *  every settlement recorded before that column existed — and is deliberately
   *  not read as zero, because zero is the claim that none of it was. */
  reimbursementCents: number | null;
}

interface Books {
  invoices: Read<Invoice>;
  payments: Read<GymPayment>;
  settled: Read<Settled>;
  /**
   * What the gym paid for that is not payroll — rent, power, the cleaner, the
   * engineer, the music licence, insurance, stock, the accountant.
   *
   * Its own read, and its own failure, because it is a different table from a
   * different screen (part 700, recorded on /costs). A month whose costs will
   * not load must still be able to report what was taken and what was settled;
   * the alternative is a month-end that reports nothing because one of four
   * queries was refused.
   */
  costs: Read<GymCost>;
  /**
   * The documents filed against this month's costs (supabase/parts/2640).
   *
   * Its own read and its own failure, like the costs above it. A refused one
   * must never draw as "nothing attached": on this page that sentence is what
   * sends an owner hunting for a receipt they filed in March, and it is the
   * exact shape src/ui/loadStatus.ts was written about.
   */
  receipts: Read<CostReceipt>;
  /**
   * The decision behind every invoice this gym has taken off its receivables
   * (supabase/parts/2642) — `dropped_at`, `drop_reason`, `dropped_by`.
   *
   * ── Why a SEPARATE read and not three more columns on the invoice one ─────
   *
   * Because `fetchInvoices` is the read this whole page is built on, and
   * PostgREST answers a select naming a column that does not exist by refusing
   * the WHOLE query. A gym whose database has not had part 2642 applied — which
   * is every gym until somebody runs it — would open this screen to a month in
   * which it billed nothing, has nothing to reconcile, and is owed nothing.
   * That is the worst sentence this page can produce, and it would be produced
   * by the feature meant to explain a bad debt.
   *
   * Read on its own, it fails on its own: the register still draws, and the
   * reason column says the decision could not be read rather than that none was
   * given.
   */
  drops: Read<DropRow>;
  /**
   * Whether that read was the WHOLE set.
   *
   * `false` is a prefix, and the receipts that fell off the end belong to costs
   * this screen would otherwise print as bare. `costEvidence` turns it into
   * 'unknown' rather than 'none'.
   */
  receiptsWhole: boolean;
  /**
   * What this gym has said about its own tax registration, as dated statements
   * (supabase/parts/2641).
   *
   * Its own read and its own failure, for the same two reasons `drops` is: it
   * is a table a gym's database may not have yet, and a period nobody has
   * answered for must read as unanswered rather than as "not registered" —
   * which is what a refusal folded into the register query would produce,
   * silently, on the page an accountant files from.
   */
  standings: Read<TaxStanding>;
  /** The answers already given on this gym's reconciliation. Not scoped to the
   *  month: an exception raised in June is still an exception in September, and
   *  an answer keyed to a month would have to be given again each time. */
  marks: MarkIndex;
  /** Paid and failed online orders in the month. A read of its own because it
   *  answers a question no other read on this page can: what Stripe took. */
  online: Read<OnlineOrder>;
  /** Whether the marks read succeeded. A failed one shows every exception as
   *  unanswered, which re-asks questions somebody has already answered — bad,
   *  but not as bad as hiding a real one, so the page says so and carries on. */
  marksErr: string | null;
}

const EMPTY: Books = {
  invoices: reading(), payments: reading(), settled: reading(), costs: reading(),
  receipts: reading(), receiptsWhole: true, drops: reading(), standings: reading(),
  marks: new Map(), marksErr: null, online: reading(),
};

/* ── totals that refuse ────────────────────────────────────────────────────── */

/**
 * The sum of a set of amounts, or the reason there isn't one.
 *
 * Three ways a set has no total, and all three are ordinary in a real gym's
 * data: nobody recorded anything, a row carries no amount, or the rows are in
 * more than one currency. Adding dirhams to pounds is not a sum, and treating a
 * missing amount as nothing shrinks the figure by exactly the row somebody
 * forgot to fill in.
 */
type Sum =
  | { known: true; cents: number; currency: string }
  | { known: false; why: string };

function sumOf(
  rows: Array<{ amountCents: number | null; currency: string | null }>,
  whenEmpty: string,
): Sum {
  if (!rows.length) return { known: false, why: whenEmpty };

  const missing = rows.filter((r) => !Number.isFinite(r.amountCents as number)).length;
  if (missing) {
    return {
      known: false,
      why: `${missing} of ${rows.length} rows carry no amount, so this set cannot be totalled — the sum would be short by exactly ${missing === 1 ? 'that row' : 'those rows'}`,
    };
  }

  // A row that states no currency is not a row that agrees with the others —
  // it is a row that cannot be added to them. It refuses the total in its own
  // words rather than being quietly folded into whatever the neighbours say,
  // which is what a `?? 'AED'` up in the mapper used to do for it.
  if (rows.some((r) => !r.currency)) {
    const n = rows.filter((r) => !r.currency).length;
    return {
      known: false,
      why: `${n} of ${rows.length} rows do not say what currency they are in, so this set cannot be totalled`,
    };
  }

  const currencies = [...new Set(rows.map((r) => r.currency as string))].sort();
  if (currencies.length > 1) {
    return { known: false, why: `${currencies.join(' and ')} in one set — not summed` };
  }

  return {
    known: true,
    cents: rows.reduce((a, r) => a + (r.amountCents as number), 0),
    currency: currencies[0],
  };
}

const sumText = (s: Sum): string | null => (s.known ? money(s.cents, s.currency) : null);
const sumNote = (s: Sum): string | undefined => (s.known ? undefined : s.why);

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function Accounting() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);
  // `tenants.currency`. An invoice raised from this screen is denominated in
  // it, and there is no fallback: an invoice is what somebody is asked to pay.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  // The roster, for the invoice form. Null is a read that failed or has not
  // returned; the form says which rather than offering an empty picker that
  // reads as a gym with no members.
  const [members, setMembers] = useState<Membership[] | null>(null);

  // Opens on the month that has finished, not the one running. A part-month is
  // not something anybody files, and offering it first invites a figure to be
  // copied out of here before the month has stopped moving.
  // Null means "the owner has not chosen", the same shape /costs and /close
  // hold it in: the default then follows the gym's own month as soon as the
  // zone read lands rather than being frozen at mount by a value the page could
  // not yet know. A month the owner has picked stays picked.
  const [picked, setPicked] = useState<string | null>(null);
  const setKey = setPicked;
  /**
   * `tenants.timezone`, and the failure to read it, kept apart.
   *
   * The month's bounds are cut on this. Until it lands they are the device's
   * and the caption says so — the page used to assert "in the gym’s own
   * timezone" over `new Date(y, mo - 1, 1)`, so a Gulf gym's 1 October takings
   * were August's month-end read from London and September's read at the desk.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [zoneErr, setZoneErr] = useState<string | null>(null);

  // The month that has just finished AT THE GYM, until the owner picks another.
  // Read in the render body rather than latched in a memo, which is the shape
  // /costs already uses for the same decision: the answer is a short string, so
  // re-deriving it costs nothing and it cannot go stale in a tab left open
  // across a month boundary, and no clock ends up in a dependency list.
  const key = picked ?? gymRecentMonths(2, zone, Date.now()).keys[1] ?? monthKeyOf();

  const at: AtGym<MonthWindow> | null = useMemo(() => {
    const base = monthWindow(key);
    return base ? cutAtGym(base, zone) : null;
  }, [key, zone]);
  const w = at?.window ?? null;

  // Stored WITH the month it was read for, and used only when the two agree.
  // Without that, switching from June to July paints one frame of June's
  // invoices under a July heading — and on the page somebody files from, a
  // figure that was briefly the wrong month's is a figure that can be copied.
  const [loaded, setLoaded] = useState<{ key: string; books: Books }>({ key: '', books: EMPTY });

  const load = useCallback(async (tenantId: string, mw: MonthWindow): Promise<boolean> => {
    setLoaded({ key: '', books: EMPTY });

    // Payments are read wider than the month on purpose. The month's own
    // takings come from the window; the reconciliation needs the shoulders,
    // because an invoice issued on the 30th is often paid on the 3rd and a
    // match rule that could not see across the month boundary would report
    // that as a paid invoice nobody paid.
    const since = new Date(Date.parse(mw.fromIso) - MATCH_DAYS * DAY).toISOString();
    // And an UPPER bound, which this read did not have. It computed a start
    // date and no end, so opening a month from a year ago read every payment
    // from that month up to TODAY — a set that grows without bound and that the
    // month's own figures then filter back down. `fetchPayments` pages now, so
    // that no longer takes the screen away; it would still drag a year of
    // payments across the wire to reconcile one month. The shoulder is
    // symmetrical for the same reason it exists on the near side: an invoice
    // issued on the 30th is often paid on the 3rd.
    const until = new Date(Date.parse(mw.toIso) + MATCH_DAYS * DAY).toISOString();

    // allSettled, never all. Under a single catch a refused invoice query also
    // empties the payments — and this screen would then report a month in which
    // the gym both billed nothing and took nothing, two wrong facts that agree
    // with each other and so look like a quiet month rather than a broken read.
    const [iRes, pRes, sRes, mRes, oRes, cRes, dRes, tRes] = await Promise.allSettled([
      fetchInvoices(tenantId, mw.lastDay),
      fetchPayments(supabase, tenantId, since, until),
      fetchSettled(tenantId, mw.fromIso, mw.toIso),
      fetchMarks(supabase, tenantId),
      // What the gym sold online in the month, and whether each sale reached
      // the ledger. `gym_orders` was read by one file in the whole product —
      // the member's own purchase history — so a sale that took the money and
      // failed to grant anything existed in a server log and on no screen.
      fetchOnlineOrders(supabase, tenantId, mw.fromIso, mw.toIso),
      // What the gym paid for that is not payroll. Bounded by the month's own
      // days rather than by the payment shoulders above: a cost is dated by the
      // day the money went out and nothing here reconciles it against anything,
      // so there is no invoice on the other side of a boundary to reach for.
      fetchGymCosts(supabase, tenantId, mw.firstDay, mw.lastDay),
      // Why this gym has not collected on some of its invoices. Its own read
      // and its own failure — see the field comment on `Books.drops`: naming
      // three columns a gym's database may not have yet inside the invoice
      // query would refuse the invoice query.
      fetchDrops(tenantId),
      // What this gym says it was registered as, with dates on it. Read here
      // rather than only on /tax because this is the month an accountant files
      // from, and "was this business registered in September" is a question
      // that document has to be able to answer for itself.
      fetchTaxStandings(supabase, tenantId),
    ]);

    // The receipts, after the costs and only because of them: this read is
    // keyed on the ids the costs read returned, so it cannot go in the batch
    // above. It is skipped entirely when there are no costs to ask about —
    // a second round trip to learn that nothing is attached to nothing.
    //
    // A failed COSTS read leaves this unasked, and the receipts slice then
    // carries the costs' own failure rather than an empty success. Without
    // that, a month whose costs would not load would report every cost it is
    // not showing as having nothing behind it.
    const costIds = cRes.status === 'fulfilled' ? cRes.value.map((c) => c.id) : null;
    const recRes = costIds && costIds.length
      ? (await Promise.allSettled([fetchCostReceipts(supabase, tenantId, costIds)]))[0]
      : null;

    setLoaded({
      key: mw.key,
      books: {
        invoices: landed(iRes, 'the invoice register'),
        payments: landed(pRes, 'the payments taken'),
        settled: landed(sRes, 'the payroll settlements'),
        // A failed marks read is NOT allowed to hide anything. It falls back to
        // an empty index, which shows every exception as unanswered — noisy,
        // and the only direction that is safe. The opposite failure would take
        // a real exception off an accountant's page because a lookup 500'd.
        marks: mRes.status === 'fulfilled' ? mRes.value : new Map(),
        marksErr: mRes.status === 'fulfilled' ? null : failure(mRes, 'the answers already given on this reconciliation'),
        online: landed(oRes, 'the online sales'),
        costs: landed(cRes, 'the recorded costs'),
        receipts: recRes
          ? (recRes.status === 'fulfilled'
            ? { rows: recRes.value.receipts, state: null, why: null }
            : landed(recRes as PromiseSettledResult<CostReceipt[]>, 'the documents filed against those costs'))
          // No costs to ask about, or the costs themselves did not come back.
          // The first is a real empty answer; the second is inherited, so the
          // Receipt column says "unknown" beside a table that is not drawn.
          : (cRes.status === 'fulfilled'
            ? { rows: [], state: null, why: null }
            : landed(cRes as PromiseSettledResult<CostReceipt[]>, 'the documents filed against those costs')),
        receiptsWhole: recRes ? (recRes.status === 'fulfilled' && recRes.value.whole) : true,
        drops: landed(dRes, 'why this gym has not collected on some of its invoices'),
        standings: landed(tRes, 'what this gym has said about its tax registration'),
      },
    });

    // Whole means all eight came back. `useFetched` stamps only on a whole read,
    // so a month whose settlements would not load leaves the stamp where it was
    // rather than dating a reconciliation that is missing one of the two
    // records it reconciles.
    return settledLanded([iRes, pRes, sRes, mRes, oRes, cRes, dRes, tRes, ...(recRes ? [recRes] : [])]);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      // An account with no gym is NOT a month in which the gym did nothing.
      //
      // Every slice here used to be written as `{ rows: [], state: null, why:
      // null }` — a read that ran and found nothing — so this screen printed
      // "No payment is recorded in August. That is a statement about the
      // record, not about the till.", an empty register and a reconciliation
      // saying both sides agree, to a member of staff whose profile had simply
      // lost its tenant link. The render below now stops before any of it; the
      // slices stay 'loading' and are never reached.
      const link = gymLink(who?.tenantId, 'payments, invoices or settlements');
      if (!link.linked) return;
      // The currency is read here as well as the name, because this screen now
      // WRITES invoices and an invoice with no currency on it is not a bill.
      // `readTenant` keeps the error apart from the values, so a refused read
      // is "we could not ask" rather than "the gym has not set one".
      const tRes = await readTenant(supabase, link.tenantId);
      if (!live) return;
      setGymName(tRes.name);
      setCcy(tRes.currency);
      setGymNameErr(tRes.error);

      const z = await fetchGymZone(supabase, link.tenantId);
      if (!live) return;
      setZone(z.zone);
      setZoneErr(z.error);
      // The roster, for the invoice form. Its own read and its own failure: an
      // invoice register that will not load must not also empty the picker that
      // would let somebody raise the invoice they came here to raise.
      // eslint-disable-next-line -- no-error-ok: fetchMemberships throws on a refusal; null is the failed state the form renders
      fetchMemberships(supabase, link.tenantId).then((r) => { if (live) setMembers(r); }).catch(() => { if (live) setMembers(null); });
    })();
    return () => { live = false; };
    // Identity, the gym record, the zone and the roster — read once. The books
    // are read by the effect below, through `refresh`. They shared one effect
    // keyed on the month, so choosing a different month re-read the gym's name,
    // currency, timezone AND the whole membership list: four round trips for
    // facts that cannot have changed, on the slowest screen in the console.
  }, []);

  /**
   * The chosen month's books, kept current and dated.
   *
   * This is the page an accountant copies figures out of, and it never said
   * when it read them. A month left open on a Friday and worked through on the
   * Monday reconciles a payment register that stops on Friday against invoices
   * that stop on Friday — and the two agreeing is exactly what this screen
   * reports as a clean month.
   *
   * `loaded.key` is what drops a superseded read; `useFetched` coalesces a
   * month change made while the previous month is in flight rather than
   * dropping it, so the month on screen is always the month that was asked for.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId && w ? load(me.tenantId, w) : Promise.resolve(false)),
  );

  /**
   * The calendar month it is NOW — which is not the same question as when this
   * screen last read.
   *
   * The picker below is keyed on this and on nothing else. It has to gain
   * October at midnight on the 1st whether or not anything has been read since,
   * and it must not be rebuilt by anything else: the read is fired by an effect
   * keyed on the chosen period, so a picker rebuilt by every read would be a
   * loop rather than a refresh. `useMonthTick` re-renders this screen exactly
   * once a month and never otherwise — see studio-web/lib/monthTick.ts.
   */
  const tick = useMonthTick();

  /**
   * The periods this screen offers — built once a MONTH, not once a mount.
   *
   * This was keyed on `[]`, and neither clock gate could see it:
   * `check-frozen-day` looks for a clock read on the line, and the clock is a
   * `now = Date.now()` default one file away; `check-frozen-hook` follows
   * exactly those defaults but skips empty dependency lists, which are the other
   * gate's rule. So the newest period this picker offered was the one the tab
   * was OPENED in. The console has no router — the rail is a plain `<a href>` —
   * so that tab is a document that lives for days, and on the 1st the period
   * that had just ended was not in the list at all. The only repair was the full
   * page reload this console spent a wave learning not to need.
   */
  const months = useMemo(() => gymRecentMonths(MONTHS_OFFERED, zone, monthTickStart(tick).getTime()).keys, [tick, zone]);

  useEffect(() => {
    if (me?.tenantId && w) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId, key]);

  const books = loaded.key === key ? loaded.books : EMPTY;

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymNameErr} current="/accounting">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymNameErr} current="/accounting">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This is the gym&rsquo;s books — every payment, every invoice and every
          trainer&rsquo;s settlement in one month. It is owner-only.
        </p>
      </Shell>
    );
  }

  // Said before any figure, because every figure below would be a claim about
  // the gym's trading built out of a fact about the reader's profile.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymNameErr} current="/accounting">
        <h1>Accounting</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('payments, invoices or settlements')}
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymNameErr} current="/accounting">
      <h1>Accounting</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        One month, cash basis, in the form you hand to whoever files it: what was
        banked, what went out in payroll, what was invoiced against what was
        collected, how old the debt is, and what the two records disagree about.
      </p>

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="this month’s books" style={{ margin: '2px 0 14px' }} />

      {gymNameErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s name could not be read:{' '}
          {gymNameErr}. Nothing below depends on that lookup — the figures are scoped
          by tenant id, not by name.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        {/* Named. A <select> has no placeholder to fall back on, so with no
            label this was announced as a bare combo box and its current value
            — on the screen whose entire subject is WHICH MONTH. */}
        <select aria-label="Which month" value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}>
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
      </div>

      {!w
        ? <Banner tone="crit">{key} is not a month this console can open.</Banner>
        : <Month at={at!} zone={zone} zoneErr={zoneErr} books={books} gymName={gymName} ccy={ccy} members={members}
                 tenantId={me.tenantId} me={me}
                 /* The hook's `refresh`: raising an invoice here is the one
                    moment these books are provably current, and re-reading
                    without moving the stamp left the line under them ageing
                    from before the write. */
                 onChange={refresh} />}
    </Shell>
  );
}

/* ── one month, worked out ─────────────────────────────────────────────────── */

function Month({ at, zone, zoneErr, books, gymName, ccy, members, tenantId, me, onChange }: {
  at: AtGym<MonthWindow>;
  /** `tenants.timezone`. The window is already cut on it by `cutAtGym`; this is
   *  the same zone for the DATES the rows are drawn with, which were being
   *  drawn on the reader's clock while the totals above them were cut on the
   *  gym's. One page, two calendars, and the difference is a day either side of
   *  every month boundary. */
  zone: string | null;
  zoneErr: string | null;
  books: Books; gymName: string | null; ccy: TenantCurrency;
  members: Membership[] | null; tenantId: string; me: Me; onChange: () => void;
}) {
  const w = at.window;
  const ended = monthEnded(w);

  // Ageing has to be as at a date, and the honest one differs by month. For a
  // finished month it is the last day of it — that is the balance an accountant
  // is reconciling to. For the month still running it is today, because ageing
  // a debt to a date that has not arrived would show invoices as overdue before
  // they are.
  //
  // And "today" is the GYM's today. It was `isoDate(new Date())` — the
  // reader's calendar — sitting four lines under a prop comment that says
  // "One page, two calendars, and the difference is a day either side of every
  // month boundary". `check:console-when` cannot see it, because nothing on
  // this line formats a Date; the calendars only meet at the `<=` below, where
  // `asAt` is compared against `issuedOn`, a `date` column holding a bare gym
  // day. A London bookkeeper opening an Auckland gym's ledger at 22:00 ages the
  // debt to yesterday and drops every invoice the gym raised today out of
  // "owed" — on the one page whose figures get filed. The sentence beside the
  // total says "as at {asAt}", so it names the wrong day out loud as well.
  const asAt = ended ? w.lastDay : (gymDay(Date.now(), zone) ?? isoDate(new Date()));

  const paymentsAll = books.payments.rows;
  const inMonthPayments = useMemo(
    () => (paymentsAll ?? []).filter((p) => inMonth(p.takenAt, w)),
    [paymentsAll, w],
  );

  const invoicesAll = books.invoices.rows;
  const raised = useMemo(
    () => (invoicesAll ?? []).filter((i) => i.issuedOn >= w.firstDay && i.issuedOn <= w.lastDay),
    [invoicesAll, w],
  );

  // Everything still unpaid as at the reporting date, including invoices raised
  // in earlier months — those are still money the gym is owed on that date, and
  // scoping the ageing to the month would report a gym owed nothing.
  const outstanding = useMemo(
    () => (invoicesAll ?? []).filter((i) => i.issuedOn <= asAt && isOutstanding(i.status)),
    [invoicesAll, asAt],
  );

  const settledRows = books.settled.rows ?? [];
  const costRows = books.costs.rows ?? [];

  const cashIn = sumOf(inMonthPayments, `no payment is recorded in ${w.label} — which is not the same as none being taken`);
  const cashOut = sumOf(settledRows, `no payroll settlement is recorded in ${w.label}`);
  // The same refusing sum as everything else on this page, so a month holding
  // two currencies of cost gets the reason rather than a number.
  const costsOut = sumOf(costRows, `no cost is recorded in ${w.label} — which is not the same as none being paid`);
  const raisedSum = sumOf(raised.filter((i) => isRaised(i.status)), `no invoice was raised in ${w.label}`);
  const owedSum = sumOf(outstanding, `nothing was outstanding as at ${asAt}`);

  const net = netOf(cashIn, cashOut, books);

  return (
    <>
      {books.invoices.why ? <Banner tone="crit">{books.invoices.why}</Banner> : null}
      {books.payments.why ? <Banner tone="crit">{books.payments.why}</Banner> : null}
      {books.settled.why ? <Banner tone="crit">{books.settled.why}</Banner> : null}

      {/* The caption comes out of `cutAtGym` with the bounds, so it cannot
          claim the gym's clock over the device's. */}
      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '10px 0 0' }}>
        {at.note}{' '}
        Receivables are aged as at <span className="mono">{asAt}</span>
        {ended ? ' — the month end.' : ' — today, because this month has not finished.'}
      </p>

      {zoneErr ? (
        <Banner tone="crit">
          The gym&rsquo;s timezone could not be read: {zoneErr}. The month below is
          therefore cut on your own device&rsquo;s clock. This is not a gym that has
          not set one &mdash; it is a setting nobody could ask for.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '16px 0 26px',
        }}
      >
        {/* A read that has not returned shows a dash whatever the sum says —
            `sumOf([])` over rows nobody has yet is "nothing recorded", which is
            a claim about the month, and the month has not been read. */}
        <Kpi
          label="Money in"
          text={books.payments.state ? null : sumText(cashIn)}
          note={note(books.payments, 'the payments') ?? (cashIn.known ? `${inMonthPayments.length} payment${inMonthPayments.length === 1 ? '' : 's'} banked` : cashIn.why)}
        />
        <Kpi
          label="Money out (payroll)"
          text={books.settled.state ? null : sumText(cashOut)}
          note={note(books.settled, 'the settlements') ?? (cashOut.known ? `${settledRows.length} settlement${settledRows.length === 1 ? '' : 's'}` : cashOut.why)}
        />
        <Kpi
          label="Money out (costs)"
          text={books.costs.state ? null : sumText(costsOut)}
          note={note(books.costs, 'the recorded costs') ?? (costsOut.known ? `${costRows.length} cost${costRows.length === 1 ? '' : 's'} recorded` : costsOut.why)}
        />
        {/* Deliberately still payments less PAYROLL, with the costs beside it
            rather than inside it. Folding them in would produce a figure over
            two sides of different completeness — see the paragraph under it. */}
        <Kpi
          label="Cash recorded in Repple"
          text={net.known ? sumText(net) : null}
          note={net.known ? 'not profit, and costs are not in it — see below' : net.why}
        />
        <Kpi
          label="Invoiced"
          text={books.invoices.state ? null : sumText(raisedSum)}
          note={note(books.invoices, 'the invoices') ?? (raisedSum.known ? `${raised.length} raised in ${w.label}` : raisedSum.why)}
        />
        <Kpi
          label="Outstanding"
          text={books.invoices.state ? null : sumText(owedSum)}
          note={note(books.invoices, 'the invoices') ?? (owedSum.known ? `${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'} unpaid at ${asAt}` : owedSum.why)}
        />
      </div>

      <Handoff
        w={w} gymName={gymName} asAt={asAt}
        payments={inMonthPayments} settled={settledRows}
        raised={raised} outstanding={outstanding} books={books}
      />
      <MoneyIn read={books.payments} rows={inMonthPayments} w={w} total={cashIn} />
      <MoneyOut read={books.settled} rows={settledRows} total={cashOut} zone={zone} />
      <CostsOut read={books.costs} rows={costRows} w={w} total={costsOut}
                receipts={books.receipts} receiptsWhole={books.receiptsWhole}
                tenantId={tenantId} me={me} onChange={onChange} />
      <Registration read={books.standings} rows={books.standings.rows ?? []} w={w}
                    tenantId={tenantId} me={me} onChange={onChange} />
      <NetCash net={net} w={w} costs={books.costs} />
      <Register
        drops={books.drops} me={me}
        read={books.invoices} raised={raised} w={w} ccy={ccy} zone={zone}
        members={members} tenantId={tenantId} onChange={onChange}
      />
      <Invoiced read={books.invoices} raised={raised} w={w} />
      <Ageing read={books.invoices} rows={outstanding} asAt={asAt} total={owedSum} />
      <OnlineSales read={books.online} w={w} zone={zone} />
      <Reconcile
        books={books} w={w} inMonthPayments={inMonthPayments}
        tenantId={tenantId} me={me} zone={zone} onChange={onChange}
      />
    </>
  );
}

/**
 * Money in minus money out, or the reason there is no such figure.
 *
 * Deliberately not computed from `?? 0` on either side. If the payments read
 * failed and the payroll read did not, "money out" alone is not a net position,
 * and rendering it as one would tell an accountant the gym spent more than it
 * earned in a month whose income simply did not load.
 */
function netOf(cashIn: Sum, cashOut: Sum, books: Books): Sum {
  if (books.payments.state === 'loading' || books.settled.state === 'loading') {
    return { known: false, why: 'still reading both sides' };
  }
  if (books.payments.state === 'failed') return { known: false, why: 'the payments could not be read, so there is no in to subtract from' };
  if (books.settled.state === 'failed') return { known: false, why: 'the settlements could not be read, so there is no out to subtract' };
  if (!cashIn.known) return { known: false, why: `money in has no total — ${cashIn.why}` };
  if (!cashOut.known) return { known: false, why: `money out has no total — ${cashOut.why}` };
  if (cashIn.currency !== cashOut.currency) {
    return { known: false, why: `money in is in ${cashIn.currency} and money out in ${cashOut.currency} — not subtracted` };
  }
  return { known: true, cents: cashIn.cents - cashOut.cents, currency: cashIn.currency };
}

/* ── money in ──────────────────────────────────────────────────────────────── */

interface MethodLine {
  key: string;
  method: string;
  currency: string | null;
  count: number;
  cents: number;
}

/**
 * Payments grouped by method AND currency.
 *
 * `incomeOf` in monthEnd.ts groups by method alone and sums across currencies
 * into one figure per line. That is right for the close screen, which shows the
 * currency list beside it and refuses the headline total. It is not right here:
 * a line reading "Card 4,200" over two currencies is a number an accountant
 * would copy. Splitting the key means every line on this page is a sum of like
 * things, and a gym with one currency — which is almost all of them — sees
 * exactly the same table it would have seen.
 */
function byMethod(payments: GymPayment[]): MethodLine[] {
  const out = new Map<string, MethodLine>();
  for (const p of payments) {
    if (!Number.isFinite(p.amountCents)) continue;
    const method = p.method ?? 'unrecorded';
    const k = `${method}|${p.currency}`;
    const line = out.get(k) ?? { key: k, method, currency: p.currency, count: 0, cents: 0 };
    line.count += 1;
    line.cents += p.amountCents;
    out.set(k, line);
  }
  return [...out.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key));
}

function MoneyIn({ read, rows, w, total }: {
  read: Read<GymPayment>; rows: GymPayment[]; w: MonthWindow; total: Sum;
}) {
  const lines = useMemo(() => byMethod(rows), [rows]);
  const unpriced = rows.filter((p) => !Number.isFinite(p.amountCents));
  const unattributed = rows.filter((p) => !p.memberId);

  const cols: Column<MethodLine>[] = [
    { key: 'method', header: 'Method', value: (l) => l.method.replace('_', ' ') },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="Money in"
      sub={`Payments recorded as taken in ${w.label}, by how they arrived. Cash basis: a payment counts on the day it was banked, whatever period it was for.`}
    >
      <Part read={read} what="the payments taken"
            cost="money in is unknown for this month, and so is everything computed from it">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} across {rows.length} payment{rows.length === 1 ? '' : 's'}.</>
              : <>No total: {total.why}.</>}
            {unpriced.length
              ? ` ${unpriced.length} payment${unpriced.length === 1 ? '' : 's'} carr${unpriced.length === 1 ? 'ies' : 'y'} no amount and ${unpriced.length === 1 ? 'is' : 'are'} left out of the table below entirely rather than counted as nothing.`
              : null}
            {unattributed.length
              ? ` ${unattributed.length} payment${unattributed.length === 1 ? '' : 's'} carr${unattributed.length === 1 ? 'ies' : 'y'} nobody's name — counted in the total, and unmatchable against any invoice.`
              : null}
          </p>
          <DataTable noun="payment methods"
            rows={lines} columns={cols} rowKey={(l) => l.key}
            empty={`No payment is recorded as taken in ${w.label}. That is a statement about the record, not about the till.`}
          />
        </>
      </Part>
    </Section>
  );
}

/* ── what was sold online ──────────────────────────────────────────────────── */

/**
 * Online sales that need a person, and only those.
 *
 * Two states reach this table and both used to be invisible.
 *
 *   · An order the webhook marked FAILED. The card was charged and the
 *     entitlement could not be written. `supabase/functions/stripe-webhook`
 *     records the reason on the row and then writes a `console.error`, and
 *     `gym_orders` was read by exactly one file in the product: the member's
 *     own purchase history. So the only person who could see it was whoever
 *     tails the edge-function logs, and the gym learned about it when the
 *     member turned up and was refused at the door.
 *
 *   · An order marked PAID with no `gym_payments` row against it. Before part
 *     480 that was EVERY online sale, and it is the reason this page's
 *     reconciliation against the bank was short by all of them. It is now
 *     narrow — the closed-month lock refusing the write is the ordinary cause —
 *     and it is listed rather than left silent, because the alternative is a
 *     figure on this page that is quietly wrong by whatever it comes to.
 *
 * A paid order that reached the ledger is not listed at all. It is an ordinary
 * payment and appears in Money in like any other.
 */
function OnlineSales({ read, w, zone }: { read: Read<OnlineOrder>; w: MonthWindow; zone: string | null }) {
  const problems = (read.rows ?? [])
    .map((o) => ({ o, problem: onlineOrderProblem(o) }))
    .filter((x): x is { o: OnlineOrder; problem: string } => x.problem !== null);

  const cols: Column<{ o: OnlineOrder; problem: string }>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.o.paidAt ?? '',
      render: (r) => gymDateText(r.o.paidAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'member', header: 'Member', value: (r) => r.o.memberName,
      render: (r) => r.o.memberName ?? <span className="dash">nobody named</span> },
    { key: 'what', header: 'Bought', value: (r) => r.o.kind },
    { key: 'amount', header: 'Amount', value: (r) => r.o.amountCents, numeric: true,
      render: (r) => money(r.o.amountCents, r.o.currency) ?? <span className="dash">not stated</span> },
    { key: 'problem', header: 'What is wrong', value: (r) => r.problem,
      render: (r) => <span style={{ color: 'var(--crit)', whiteSpace: 'normal' }}>{r.problem}</span> },
  ];

  return (
    <Section
      title="Online sales that need a person"
      sub={`Card purchases in ${w.label} where Stripe took the money and something did not follow. A sale that granted what it should and reached the payment record is not here — it is an ordinary payment, in Money in.`}
    >
      <Part read={read} what="the online sales"
            cost="whether anybody paid online and got nothing is unknown for this month">
        <DataTable noun="online sales needing a person"
          rows={problems} columns={cols} rowKey={(r) => r.o.id}
          empty={`Every online sale in ${w.label} granted what it should and is in the payment record.`}
        />
      </Part>
    </Section>
  );
}

/* ── money out ─────────────────────────────────────────────────────────────── */

function MoneyOut({ read, rows, total, zone }: { read: Read<Settled>; rows: Settled[]; total: Sum; zone: string | null }) {
  const cols: Column<Settled>[] = [
    { key: 'settled', header: 'Settled', value: (s) => s.settledAt,
      render: (s) => gymDateText(s.settledAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName },
    { key: 'period', header: 'For the period', value: (s) => s.periodFrom,
      render: (s) => (s.periodFrom && s.periodTo
        ? <>{s.periodFrom} → {s.periodTo}</>
        : <span className="dash">period not recorded</span>) },
    { key: 'sessions', header: 'Sessions', value: (s) => s.sessionsCount, numeric: true,
      render: (s) => (s.sessionsCount == null
        ? <span className="dash">not recorded</span>
        : <>{s.sessionsCount}</>) },
    { key: 'amount', header: 'Amount', value: (s) => s.amountCents, numeric: true,
      render: (s) => (s.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(s.amountCents, s.currency)}</>) },
    // "Per session, rounded" and not "Per session".
    //
    // The header said "Per session" and the cell rendered `money(c, s.currency)`
    // — an exact, currency-denominated amount, indistinguishable from every
    // other figure in a table printed for an accountant. The caveat that it is
    // a sanity check rather than a figure to pay anybody from lived only in a
    // comment on `perSession`. A settlement of £500.00 over 12 sessions prints
    // £41.67, which multiplies back to £500.04: the one column on this page
    // that does not reconcile, on the page whose whole job is reconciling.
    { key: 'per', header: 'Per session, rounded', value: (s) => perSession(s), numeric: true,
      // A division, so the denominator is checked before it is used. A
      // settlement that paid for no sessions, or never said how many, has no
      // per-session figure — not a zero, and certainly not the whole amount.
      render: (s) => {
        const c = perSession(s);
        if (c == null) {
          return (
            <span className="dash">
              {s.amountCents == null ? 'no amount' : s.sessionsCount == null ? 'session count not recorded' : 'no sessions on this run'}
            </span>
          );
        }
        return <>{money(c, s.currency)}</>;
      } },
    // Pay and a reimbursement are not the same money, and whoever files the
    // payroll needs them apart. The run recorded one figure until
    // supabase/parts/482; a settlement from before that says so rather than
    // being reported as wholly pay.
    { key: 'reimbursed', header: 'Of which reimbursed', value: (s) => s.reimbursementCents, numeric: true,
      render: (s) => (s.reimbursementCents == null
        ? <span className="dash">the run did not say</span>
        : <>{money(s.reimbursementCents, s.currency)}</>) },
    { key: 'method', header: 'Method', value: (s) => s.method },
  ];

  return (
    <Section
      title="Money out (payroll)"
      sub="Settlements recorded as paid in this month. Cash basis again, and the period column is why it matters: a settlement paid on the 3rd of August is August's cash and July's work. The per-session column is the amount divided by the count and rounded to the nearest unit — the remainder is dropped rather than distributed, so it is a sanity check and will not multiply back to the settlement exactly."
    >
      <Part read={read} what="the payroll settlements"
            cost="money out is unknown for this month, so no net position is offered">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} across {rows.length} settlement{rows.length === 1 ? '' : 's'}.</>
              : <>No total: {total.why}.</>}
            {' '}This is payroll only. It is not everything the gym paid out — it is
            everything the gym paid out <em>through Repple</em>.
          </p>
          <DataTable noun="payroll settlements"
            rows={rows} columns={cols} rowKey={(s) => s.id}
            empty="No payroll settlement was recorded in this month. If trainers were paid outside Repple, this is what that looks like — and money out below is short by whatever that was."
          />
        </>
      </Part>
    </Section>
  );
}

/** Amount per session, or null when the division has no meaning. */
function perSession(s: Settled): number | null {
  if (s.amountCents == null || !Number.isFinite(s.amountCents)) return null;
  if (s.sessionsCount == null || s.sessionsCount <= 0) return null;
  // Integer cents throughout; never a float on currency. The remainder is
  // dropped rather than distributed, which is why this column is a sanity
  // check and not a figure to pay anybody from.
  return Math.round(s.amountCents / s.sessionsCount);
}

/* ── money out that is not payroll ─────────────────────────────────────────── */

/**
 * What the gym paid for, other than its trainers.
 *
 * Until part 700 this table did not exist, and neither did this section: the
 * whole outgoing side of a gym's month was `payroll_settlements`, so the
 * accountant's page reported a business whose only cost was session pay. Rent,
 * power, the cleaner, the engineer, the music licence, insurance, stock and the
 * accountant's own fee all reached this app through nothing at all.
 *
 * It is listed here and it is NOT added to payroll. Two reads of two tables
 * that can fail independently do not make one "money out" figure, and the one
 * on the KPI strip above is each read's own.
 */
function CostsOut({ read, rows, w, total, receipts, receiptsWhole, tenantId, me, onChange }: {
  read: Read<GymCost>; rows: GymCost[]; w: MonthWindow; total: Sum;
  /** The documents filed against these costs (supabase/parts/2640). */
  receipts: Read<CostReceipt>;
  receiptsWhole: boolean;
  tenantId: string; me: Me; onChange: () => void;
}) {
  /** Which cost the attach form below is for, or null when it is closed.
   *
   *  One form at a time and off by default, for the reason `MatchPicker` on
   *  this page is: a file input on every row of a forty-row table is forty
   *  chances to file September's rent against August's electricity, and this
   *  write is the one that puts a document under somebody's books. */
  const [attachTo, setAttachTo] = useState<GymCost | null>(null);
  const [kind, setKind] = useState<DocumentKind>('other');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /**
   * Which of the four states the receipts read is in, in the vocabulary
   * src/ui/loadStatus.ts settled.
   *
   * 'partial' is not 'ready' and never has been. A truncated read of the
   * documents table drops receipts belonging to real costs, and every one of
   * those costs would then be printed as having nothing behind it — which on
   * this page is the sentence an owner acts on.
   */
  const receiptStatus: 'loading' | 'ready' | 'partial' | 'error' =
    receipts.state === 'loading' ? 'loading'
      : receipts.state === 'failed' ? 'error'
      : receiptsWhole ? 'ready' : 'partial';

  const index = useMemo(
    () => (receipts.rows ? byCost(receipts.rows) : null),
    [receipts.rows],
  );

  const open = async (r: CostReceipt) => {
    try {
      const url = await openCostReceipt(supabase, r.storagePath);
      setErr(null);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      setErr(e?.message ?? 'That file could not be opened.');
    }
  };

  const blocker = attachTo
    ? receiptBlocker(attachTo.id, kind, file, title.trim() || receiptTitle(attachTo))
    : null;

  const startAttach = (c: GymCost) => {
    setAttachTo(c);
    setKind('other');
    // Pre-filled from the cost rather than from the file, because the file is
    // called scan0042.pdf and the cost is called "Rent". An owner may type over
    // it; what they may not do is file an untitled document, which is what
    // makes the cabinet a folder again (part 185).
    setTitle(receiptTitle(c));
    setFile(null);
    setErr(null); setSaved(null);
  };

  const attach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attachTo || !file) { setErr(blocker ?? 'Choose the file.'); return; }
    if (blocker) { setErr(blocker); return; }
    setBusy(true); setErr(null); setSaved(null);
    const path = documentPath(tenantId, file.name);
    try {
      // The OBJECT first, the row second — `recordDocument`'s ordering in
      // src/lib/gymDocs.ts and its reasoning unchanged: a row pointing at a
      // file that does not exist is a document the books say the gym holds and
      // cannot produce, and that is the more expensive of the two orphans.
      const up = await supabase.storage.from('gym-docs').upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (up.error) throw up.error;
      try {
        await recordCostReceipt(supabase, tenantId, {
          costId: attachTo.id,
          kind,
          title: title.trim() || receiptTitle(attachTo),
          storagePath: path,
          mime: file.type || null,
          sizeBytes: file.size,
          uploadedBy: me.id,
        });
      } catch (rowErr) {
        // The object landed and the row did not. Take it back out: an object
        // with nothing indexing it is invisible to the only screen that could
        // remove it. Best effort, and the sentence below is the same either way.
        await discardUnfiledObject(supabase, path);
        throw rowErr;
      }
      setSaved(`Filed against ${attachTo.description}. ${RECEIPT_IS_NOT_A_CHECK_NOTE}`);
      setAttachTo(null); setFile(null); setTitle('');
      onChange();
    } catch (e: any) {
      setErr(writeFailedText(e, {
        what: 'That file',
        unchanged: 'nothing is attached to that cost and the cost itself is untouched',
        howToCheck: 'Reload this page and look at the Receipt column on that row before attaching it again.',
      }));
    } finally { setBusy(false); }
  };

  const cols: Column<GymCost>[] = [
    { key: 'paid', header: 'Paid', value: (c) => c.paidOn },
    { key: 'what', header: 'What for', value: (c) => c.description },
    { key: 'supplier', header: 'Paid to', value: (c) => c.supplier,
      render: (c) => c.supplier ?? <span className="dash">not stated</span> },
    { key: 'category', header: 'Category', value: (c) => gymCostCategoryLabel(c.category) },
    { key: 'amount', header: 'Amount', value: (c) => c.amountCents, numeric: true,
      render: (c) => (c.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(c.amountCents, c.currency)}</>) },
    { key: 'note', header: 'Note', value: (c) => c.note },
    // The paper. Three answers and never two: "nothing is filed" and "we could
    // not ask" are different facts about a cost an accountant is about to be
    // asked for evidence of.
    { key: 'receipt', header: 'Receipt', align: 'right',
      value: (c) => {
        const e = costEvidence(c.id, index, receiptStatus);
        return e.state === 'attached' ? e.count : e.state === 'none' ? 0 : null;
      },
      render: (c) => {
        const e = costEvidence(c.id, index, receiptStatus);
        if (e.state === 'unknown') return <span className="dash" title={e.why}>not known</span>;
        const filed = index?.get(c.id) ?? [];
        return (
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {filed.map((r) => (
              <button key={r.id} type="button" className="no-print" style={linkBtn}
                      onClick={() => void open(r)}
                      aria-label={`Open ${r.title}, filed against ${c.description}`}>
                {r.title}
              </button>
            ))}
            {e.state === 'none' ? <span className="dash">{evidenceNote(e)}</span> : null}
            <button type="button" className="no-print" style={{ ...linkBtn, color: 'var(--ink3)' }}
                    onClick={() => startAttach(c)}
                    aria-label={`Attach a document to ${c.description}, paid ${c.paidOn}`}>
              {e.state === 'none' ? 'Attach' : 'Add another'}
            </button>
          </span>
        );
      } },
  ];

  // Per currency, because a month holding two of them has two amounts of money
  // and not a sum — and the KPI above has already refused to state one.
  const pots = gymCostsTaken(rows).pots;

  return (
    <Section
      title="Money out (costs)"
      sub={`What the gym paid for in ${w.label} other than its trainers, dated the day the money went out. Recorded on the Costs screen; nothing infers a cost from anything.`}
    >
      <Part read={read} what="the recorded costs"
            cost="what this gym spent outside payroll is unknown for this month, not nil">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} across {rows.length} cost{rows.length === 1 ? '' : 's'}.</>
              : <>No single total: {total.why}.</>}
            {!total.known && pots.length > 1
              ? ` ${pots.map((p) => money(p.minorUnits, p.currency)).join(' and ')} — kept apart, because this app holds no rate between them.`
              : null}
          </p>
          <DataTable noun="costs"
            rows={rows} columns={cols} rowKey={(c) => c.id}
            empty={`No cost is recorded in ${w.label}. That is a statement about the record, not about the gym — rent, power and everything else reach this app only when somebody enters them on the Costs screen.`}
          />
          {receipts.why ? <Banner tone="crit">{receipts.why}</Banner> : null}
          {err ? <Banner tone="crit">{err}</Banner> : null}
          {saved ? <Banner>{saved}</Banner> : null}
          {/* Open only when a row asked for it. The form is under the table
              rather than inside a row so the file picker, the kind and the
              title are one thought, and so the row being filed against is
              named in the heading — a document filed against the wrong cost
              reads as evidence, which is worse than none. */}
          {attachTo ? (
            <form onSubmit={attach} className="no-print"
                  style={{ borderTop: '1px solid var(--ring)', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 9px', fontSize: 13, color: 'var(--ink2)', maxWidth: '80ch' }}>
                <strong style={{ color: 'var(--ink)' }}>{attachTo.description}</strong>
                {attachTo.supplier ? <>, paid to {attachTo.supplier}</> : null}
                {' '}on {attachTo.paidOn}
                {attachTo.amountCents == null ? null : <>, {money(attachTo.amountCents, attachTo.currency)}</>}.
              </p>
              <div style={formRow}>
                <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}
                        style={{ ...field, flex: 1, minWidth: 170 }} aria-label="What kind of document this is">
                  {RECEIPT_KINDS.map((k) => (
                    <option key={k} value={k}>{RECEIPT_KIND_LABEL[k]}</option>
                  ))}
                </select>
                <input value={title} onChange={(e) => setTitle(e.target.value)}
                       placeholder="What it is" style={{ ...field, flex: 2, minWidth: 200 }}
                       aria-label="What this document is, as it will appear in the filing cabinet" />
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                       onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                       style={{ ...field, flex: 2, minWidth: 200 }}
                       aria-label="The file" />
                <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>
                  {busy ? 'Filing…' : 'Attach'}
                </button>
                <button type="button" style={linkBtn} onClick={() => { setAttachTo(null); setErr(null); }}>
                  Leave it
                </button>
              </div>
              {blocker && file ? (
                <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>{blocker}</p>
              ) : null}
              <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
                {RECEIPT_IS_NOT_A_CHECK_NOTE} Only the two kinds above are offered, because what
                this gym pays in rent and to whom is the owner&rsquo;s record &mdash; the four kinds
                a trainer may read are not on this list.
              </p>
            </form>
          ) : null}
          <p className="no-print" style={{ margin: 0, padding: '10px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
            Costs are entered on <a href="/costs" style={{ color: 'var(--brand)' }}>Costs</a>, and
            what this gym has said about its own tax registration is on{' '}
            <a href="/tax" style={{ color: 'var(--brand)' }}>Tax</a>, which states no tax figure and
            says why.
          </p>
        </>
      </Part>
    </Section>
  );
}

/* ── what the gym said about itself, in the month it said it about ─────────── */

/**
 * Whether this gym was registered for a tax on its sales DURING this month —
 * which is not the same question as whether it is now.
 *
 * ── Why this is on the accountant's page and not only on /tax ─────────────
 *
 * /tax renders `tenants.tax_registered`, a CURRENT-STATE boolean with no date
 * on it, above the figures for whichever period its picker is on. A gym that
 * registered in April therefore reads "This gym says it is registered, under
 * the number below" over its Q1 figures, under a number that did not exist in
 * January; a gym that deregistered in June reads the denial over every quarter
 * it was registered in. Neither is a tax figure, which is the only reason it is
 * not worse, and both are statements about a business's legal standing made
 * about a stretch of time the stored fact says nothing about.
 *
 * supabase/parts/2641 makes the statement DATED. This section is where an owner
 * records one and where the month's own answer is printed — on the page the
 * month leaves the building from, so the document can answer for itself.
 *
 * NO TAX FIGURE IS PRODUCED HERE, and none is anywhere in this product. The
 * whole argument is in the header of src/lib/gymTax.ts; this section states one
 * fact somebody typed and computes nothing from it.
 */
function Registration({ read, rows, w, tenantId, me, onChange }: {
  read: Read<TaxStanding>; rows: TaxStanding[]; w: MonthWindow;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [status, setStatus] = useState<TaxStandingStatus>('registered');
  const [registration, setRegistration] = useState('');
  const [fromOn, setFromOn] = useState('');
  const [toOn, setToOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const during = registrationDuring(
    read.rows, w.firstDay, w.lastDay,
    read.state === 'loading' ? 'loading' : read.state === 'failed' ? 'error' : 'ready',
  );

  const draft: TaxStandingDraft = { status, registration, fromOn, toOn };
  const blockers = standingBlockers(draft, rows);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blockers.length) { setErr(blockers[0]); return; }
    setBusy(true); setErr(null); setSaved(null);
    try {
      await recordTaxStanding(supabase, tenantId, { ...draft, createdBy: me.id });
      setSaved('Recorded. Every period this covers now carries that answer, and the ones it does not are still unanswered rather than denied.');
      setRegistration(''); setFromOn(''); setToOn(''); setOpen(false);
      onChange();
    } catch (e: any) {
      setErr(writeFailedText(e, {
        what: 'That registration',
        unchanged: 'nothing has been recorded and every period reads exactly as it did',
        howToCheck: 'Reload this page and read the list below before entering it again.',
      }));
    } finally { setBusy(false); }
  };

  /**
   * Giving an open period an end.
   *
   * An inline date box rather than `window.prompt`, which appears nowhere else
   * in this console: a browser prompt is unstyled, unlabelled for a screen
   * reader, and returns a string nobody validated. The day is typed into a
   * `type="date"` field the same way every other date on this page is.
   *
   * Seeded with the last day of the month being looked at, which is a
   * SUGGESTION and not an assumption — an owner who deregistered on the 14th
   * types the 14th, and `standingBlockers` is not consulted here because
   * closing a period cannot overlap anything: it only shortens one.
   */
  const [ending, setEnding] = useState<{ st: TaxStanding; day: string } | null>(null);

  const close = () => {
    if (!ending?.day) return;
    endTaxStanding(supabase, ending.st.id, ending.day)
      .then(() => { setErr(null); setSaved(`That period now ends on ${ending.day}, inclusive.`); setEnding(null); onChange(); })
      .catch((e: any) => setErr(writeFailedText(e, {
        what: 'That registration period',
        unchanged: 'it still has no end date on it',
        howToCheck: 'Reload this page: the list carries whichever dates are actually stored.',
      })));
  };

  const cols: Column<TaxStanding>[] = [
    { key: 'from', header: 'From', value: (r) => r.fromOn },
    { key: 'to', header: 'Until', value: (r) => r.toOn,
      render: (r) => r.toOn ?? <span className="dash">and still</span> },
    { key: 'status', header: 'Said to be', value: (r) => STANDING_LABEL[r.status] },
    { key: 'number', header: 'Number', value: (r) => r.registration,
      render: (r) => r.registration ?? <span className="dash">none stated</span> },
    { key: 'note', header: 'Note', value: (r) => r.note },
    { key: 'end', header: '', align: 'right',
      value: () => null,
      render: (r) => (r.toOn ? null : (
        <button type="button" className="no-print" style={linkBtn}
                onClick={() => { setEnding({ st: r, day: w.lastDay }); setErr(null); setSaved(null); }}
                aria-label={`Set the last day the period from ${r.fromOn} was true`}>
          Give it an end date
        </button>
      )) },
  ];

  return (
    <Section
      title="What this gym says it was registered as"
      sub={`For ${w.label}, from the dated statements this gym has recorded. No tax figure is produced here or anywhere in Repple — this is one fact somebody typed, held against the days it was true of.`}
    >
      <Part read={read} what="what this gym has said about its tax registration"
            cost="whether this business was registered during this month is unknown, which is not the same as it not having been">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13, maxWidth: '86ch' }}>
            {standingLine(during, w.label)}
          </p>
          <DataTable noun="registration statements"
            rows={rows} columns={cols} rowKey={(r) => r.id}
            empty="Nothing recorded. Until a statement is entered, every month on this screen reads as one nobody has answered for — which is what it is, and is deliberately not the same as a month this gym was not registered in."
          />
        </>
      </Part>
      {err ? <Banner tone="crit">{err}</Banner> : null}
      {saved ? <Banner>{saved}</Banner> : null}
      {ending ? (
        <div className="no-print" style={{ ...formRow, borderTop: '1px solid var(--ring)', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink2)', maxWidth: '52ch' }}>
            The last day the period from {ending.st.fromOn} was true. Stored inclusive, so a
            registration that ran to the 31st ends on the 31st.
          </span>
          <input type="date" value={ending.day}
                 onChange={(e) => setEnding({ st: ending.st, day: e.target.value })}
                 style={{ ...field, width: 148 }}
                 aria-label={`The last day the period from ${ending.st.fromOn} was true`} />
          <button type="button" style={primaryBtn} disabled={!ending.day} onClick={close}>End it</button>
          <button type="button" style={linkBtn} onClick={() => setEnding(null)}>Leave it</button>
        </div>
      ) : null}
      {open ? (
        <form onSubmit={save} className="no-print" style={{ borderTop: '1px solid var(--ring)' }}>
          <div style={formRow}>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaxStandingStatus)}
                    style={{ ...field, flex: 1, minWidth: 180 }} aria-label="What this gym is saying about that stretch of time">
              <option value="registered">{STANDING_LABEL.registered}</option>
              <option value="not_registered">{STANDING_LABEL.not_registered}</option>
            </select>
            <input value={registration} onChange={(e) => setRegistration(e.target.value)}
                   placeholder="Registration number" disabled={status === 'not_registered'}
                   style={{ ...field, flex: 2, minWidth: 180 }}
                   aria-label="The registration number, as it is written on the certificate" />
            <label style={dateLabel}>
              from
              <input type="date" value={fromOn} onChange={(e) => setFromOn(e.target.value)}
                     style={{ ...field, width: 148 }} aria-label="The first day this was true" />
            </label>
            <label style={dateLabel}>
              until
              <input type="date" value={toOn} onChange={(e) => setToOn(e.target.value)}
                     style={{ ...field, width: 148 }} aria-label="The last day this was true, or empty if it still is" />
            </label>
            <button type="submit" disabled={busy || blockers.length > 0} style={primaryBtn}>
              {busy ? 'Recording…' : 'Record it'}
            </button>
            <button type="button" style={linkBtn} onClick={() => { setOpen(false); setErr(null); }}>Leave it</button>
          </div>
          {/* Every reason at once rather than the first one, so somebody who
              has left three fields wrong is not corrected three times. */}
          {(fromOn || registration) && blockers.length ? (
            <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '76ch' }}>
              {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
            </ul>
          ) : null}
          <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '82ch' }}>
            Leaving the end date empty means &ldquo;and still&rdquo;. Repple has not checked this
            against any register &mdash; there is none it could check &mdash; and has not inferred it
            from a country, a currency or a price. {CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE}
          </p>
        </form>
      ) : (
        <p className="no-print" style={{ margin: 0, padding: '10px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '84ch' }}>
          <button type="button" style={linkBtn} onClick={() => { setOpen(true); setSaved(null); }}>
            Record a registration period
          </button>
          {' · '}A stretch of days and what was true of them. {CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE}
        </p>
      )}
    </Section>
  );
}

/* ── the net, named honestly ───────────────────────────────────────────────── */

function NetCash({ net, w, costs }: { net: Sum; w: MonthWindow; costs: Read<GymCost> }) {
  return (
    <Section
      title="Cash recorded in Repple"
      sub="Money in, less payroll out. Read the paragraph before you copy the number."
    >
      <div style={{ padding: 14 }}>
        <div
          className="mono"
          style={{ fontSize: 25, letterSpacing: '-0.02em', color: net.known ? 'var(--ink)' : 'var(--ink3)' }}
        >
          {net.known ? sumText(net) : '—'}
        </div>
        {!net.known ? (
          <p style={{ margin: '6px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{net.why}</p>
        ) : null}

        <p style={{ margin: '12px 0 0', color: 'var(--ink2)', fontSize: 13.5, maxWidth: 760 }}>
          <strong>This is not profit, and it is not a P&amp;L line.</strong> It is the
          difference between two things Repple happens to hold records of: payments
          somebody entered, and payroll somebody settled here. It omits tax of every
          kind and the owner&rsquo;s own drawings, which this database has never seen —
          and it omits the costs section above, deliberately. A gym with a healthy
          figure on this line can be losing money every month of {w.label}&rsquo;s year.
        </p>
        {/* This paragraph used to end "none of which this database has ever
            seen", listing rent, utilities, stock, equipment, insurance,
            licences, marketing, software and bank fees. Part 700 gave the gym a
            place to record every one of them, so the sentence became false the
            day /costs shipped — and a false sentence on the page an accountant
            works from is worse than the omission it was describing. What is
            still true is the REFUSAL, which is a different claim and is the one
            worth making. */}
        <p style={{ margin: '9px 0 0', color: 'var(--ink2)', fontSize: 13, maxWidth: 760 }}>
          <strong>Why the costs are not subtracted here.</strong> The two sides are not
          the same kind of record. What came in is gross of the card processor&rsquo;s
          fee and is only what somebody entered at the desk; what went out in costs is
          only what somebody typed, is unevidenced, and in a gym&rsquo;s first months
          will be missing most of itself; and either side can be in a currency the
          other is not. Subtracting them would produce a plausible number about none
          of that, on the page it would most likely be filed from.
          {costs.state === 'failed'
            ? ' The costs read failed for this month, so what is missing from that side is unknown as well.'
            : null}
        </p>
        <p style={{ margin: '9px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: 760 }}>
          It is here for one job: to be reconciled against the bank. If the bank moved
          by something other than this, the difference is a cost, a payment nobody
          recorded, or something this app was never told about.
        </p>
      </div>
    </Section>
  );
}

/* ── invoiced vs collected ─────────────────────────────────────────────────── */

interface StatusLine {
  key: string;
  label: string;
  currency: string | null;
  count: number;
  cents: number | null;
  /** Rows in this group that carry no amount — why `cents` may be null. */
  unpriced: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft — not yet raised',
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  written_off: 'Written off',
};

/** An invoice the gym actually raised — a draft is not a claim on anybody. */
function isRaised(status: string | null): boolean {
  return status !== null && status !== 'draft';
}

/** Still money owed. Void and written off are decisions, not debts; paid is
 *  collected; draft was never raised. */
function isOutstanding(status: string | null): boolean {
  return status === 'open' || status === 'overdue';
}

function Invoiced({ read, raised, w }: { read: Read<Invoice>; raised: Invoice[]; w: MonthWindow }) {
  const lines = useMemo(() => {
    const out = new Map<string, StatusLine>();
    for (const i of raised) {
      const status = i.status ?? '(no status recorded)';
      const k = `${status}|${i.currency}`;
      const line = out.get(k) ?? {
        key: k,
        label: STATUS_LABEL[status] ?? status,
        currency: i.currency,
        count: 0,
        cents: 0,
        unpriced: 0,
      };
      line.count += 1;
      if (Number.isFinite(i.amountCents as number)) {
        if (line.cents != null) line.cents += i.amountCents as number;
      } else {
        line.unpriced += 1;
        line.cents = null;
      }
      out.set(k, line);
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [raised]);

  const raisedRows = raised.filter((i) => isRaised(i.status));
  const paidRows = raised.filter((i) => i.status === 'paid');
  const raisedSum = sumOf(raisedRows, 'nothing was raised');
  const paidSum = sumOf(paidRows, 'none of this month’s invoices is marked paid');

  // A collection rate, and the denominator is the whole reason this is written
  // out rather than inlined. Zero invoices raised does not mean 0% collected —
  // it means the question has no answer, and 0% on an accountant's page reads
  // as a gym that collected nothing.
  const rate: string | null =
    raisedSum.known && paidSum.known && raisedSum.currency === paidSum.currency && raisedSum.cents > 0
      ? `${Math.round((paidSum.cents * 100) / raisedSum.cents)}%`
      : null;
  const rateWhy =
    !raisedSum.known ? raisedSum.why
      : raisedSum.cents === 0 ? 'the invoices raised total nothing, so there is no proportion to take'
      : !paidSum.known ? paidSum.why
      : raisedSum.currency !== paidSum.currency ? 'raised and paid are in different currencies'
      : null;

  const cols: Column<StatusLine>[] = [
    { key: 'label', header: 'Status', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Invoices', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => (l.cents == null
        ? <span className="dash">{l.unpriced} of {l.count} carry no amount</span>
        : <>{money(l.cents, l.currency)}</>) },
  ];

  return (
    <Section
      title="Invoices raised, and what was collected"
      sub={`Invoices dated inside ${w.label}, by the status the register holds today. A draft was never raised and is shown apart from the ones that were.`}
    >
      <Part read={read} what="the invoice register"
            cost="what the gym billed this month is unknown, and so is what it collected">
        <>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
            <Figure label="Raised" text={sumText(raisedSum)} note={sumNote(raisedSum) ?? `${raisedRows.length} invoice${raisedRows.length === 1 ? '' : 's'}`} />
            <Figure label="Marked paid" text={sumText(paidSum)} note={sumNote(paidSum) ?? `${paidRows.length} invoice${paidRows.length === 1 ? '' : 's'}`} />
            <Figure label="Collected" text={rate} note={rate ? 'of what was raised this month, by value' : rateWhy ?? undefined} />
          </div>
          <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            &ldquo;Marked paid&rdquo; is the register&rsquo;s claim, not the bank&rsquo;s.
            Whether a payment stands behind each one is the next section but one.
          </p>
          <DataTable noun="invoice collection lines"
            rows={lines} columns={cols} rowKey={(l) => l.key}
            empty={`No invoice is dated in ${w.label}. If this gym takes money without invoicing, that is what this looks like — and there is then no second record to check the takings against.`}
          />
        </>
      </Part>
    </Section>
  );
}

/* ── the invoice register, and the writer it never had ─────────────────────── */

/**
 * Raise an invoice, and change the status of one already raised.
 *
 * `gym_invoices` has existed since supabase/parts/29 and had NO WRITER anywhere
 * in this repository — two reads and nothing else. So the four sections above
 * and below this one report on a lifecycle the product could not produce, in
 * copy that reads as a factual claim about the gym: a Repple gym's invoice
 * register is empty because it is unreachable, its ageing table is empty for
 * the same reason, and its month-end says it is owed nothing.
 *
 * It sits on THIS screen rather than on /money for one reason. /money is the
 * capture screen — what was sold, what was taken — and everything on it is a
 * fact that has already happened. An invoice is a claim about the future, and
 * the questions it raises (is it overdue, was it collected, does it reconcile)
 * are the questions this page is built out of. Splitting them would mean
 * raising a bill on one screen and finding out what happened to it on another.
 */
function Register({ read, raised, w, ccy, zone, members, tenantId, drops, me, onChange }: {
  read: Read<Invoice>; raised: Invoice[]; w: MonthWindow; ccy: TenantCurrency;
  /** `tenants.timezone`. An invoice's issue date is the gym's day, not the
   *  day it happens to be wherever the person raising it is sitting. */
  zone: string | null;
  members: Membership[] | null; tenantId: string;
  /** Why this gym decided not to collect, per invoice (supabase/parts/2642). */
  drops: Read<DropRow>;
  me: Me;
  onChange: () => void;
}) {
  // The GYM's day, seeding both date boxes below. It was `isoDate(new Date())`,
  // and lib/currency.ts names this exact failure in as many words: "a cost
  // entered at 09:00 on 1 September in Auckland was offered August by default".
  // An invoice carries its issue date into the ageing table, the month it is
  // counted in and the number it is allocated — `next_gym_invoice_number` takes
  // the YEAR from it — so a day out at a year boundary is an invoice numbered
  // into the wrong year's sequence. The reader's day stays the fallback for a
  // gym that has not set a zone.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
  const [memberId, setMemberId] = useState('');
  const [membershipId, setMembershipId] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedOn, setIssuedOn] = useState(today);
  // Thirty days after the issue date, which is the commonest term and is a
  // SUGGESTION rather than a stored default — an owner who clears it gets an
  // invoice with no due date, which is never overdue and is correct for a
  // receipt. `dueAfter` computes in UTC so it cannot land a day out.
  const [dueOn, setDueOn] = useState(() => dueAfter(today, 30));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** The invoice somebody is about to take off the receivables, and which of
   *  the two decisions it is. Null when nobody is. */
  const [dropping, setDropping] = useState<{ inv: Invoice; status: DropStatus } | null>(null);
  const [reason, setReason] = useState('');

  /** The decision on each invoice, by invoice id. Null when that read did not
   *  come back — which is NOT the same as no decision having been made, and is
   *  why `writeOffHistory` is handed the read's state rather than a map with
   *  holes in it. */
  const dropIndex = useMemo(
    () => (drops.rows ? new Map(drops.rows.map((d) => [d.id, d])) : null),
    [drops.rows],
  );
  const dropStatus: 'loading' | 'ready' | 'error' =
    drops.state === 'loading' ? 'loading' : drops.state === 'failed' ? 'error' : 'ready';
  const NO_DROP: DropRecord = { droppedAt: null, dropReason: null, droppedBy: null, droppedByName: null };

  const draft: InvoiceDraft = { memberId, membershipId: membershipId || null, amount, issuedOn, dueOn, note };
  const blocker = invoiceBlocker(draft, ccy);

  const raise = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if (blocker) { setWriteErr(blocker); return; }
    const amt = parseAmount(amount, ccy);
    if (amt.kind !== 'amount' || !ccy) return;
    setBusy(true); setWriteErr(null);
    try {
      const { number } = await createInvoice(supabase, tenantId, {
        memberId,
        membershipId: membershipId || null,
        amountCents: amt.minorUnits,
        currency: ccy,
        issuedOn,
        dueOn: dueOn || null,
        note: note.trim() || null,
        status: 'open',
      });
      // The number is reported rather than assumed. It comes from the database
      // under an advisory lock, and a gym whose database has not had
      // supabase/parts/180 applied gets a null — the invoice is still raised,
      // because refusing to bill anybody over an outstanding migration is the
      // worse of the two failures, and the owner is told it is unnumbered.
      setSaved(number == null
        ? 'Raised, with no invoice number — this gym’s database has not had the numbering migration applied, so nothing could allocate one.'
        : `Raised as invoice ${number}.`);
      setAmount(''); setNote('');
      onChange();
    } catch (e: any) {
      // An invoice raised twice is a member billed twice, which is the failure
      // "Nothing has been billed" invites when it is said about a request nobody
      // answered.
      setWriteErr(writeFailedText(e, {
        what: 'That invoice',
        unchanged: 'nothing has been billed and nobody has been asked for anything',
        howToCheck: 'Reload this page and look for it in the invoice list below before raising it again.',
      }));
    } finally { setBusy(false); }
  };

  /**
   * The status change that cannot be made from a dropdown.
   *
   * Everything else on this list is a state an invoice passes THROUGH. 'void'
   * and 'written_off' are the two that take money off what the gym is owed —
   * `owedOf` in src/lib/monthEnd.ts counts them into a bucket it calls
   * `dropped` — and until supabase/parts/2642 that happened on one click with
   * nothing anywhere recording why. So those two open the box below instead of
   * writing, and nothing is written until a reason has been typed.
   */
  const setStatus = (inv: Invoice, next: string) => {
    if (isDropStatus(next)) {
      setWriteErr(null); setSaved(null);
      setDropping({ inv, status: next });
      setReason('');
      return;
    }
    setInvoiceStatus(supabase, inv.id, next as any)
      .then(() => { setWriteErr(null); setSaved(null); onChange(); })
      .catch((err: any) => setWriteErr(writeFailedText(err, {
        what: 'That change to the invoice',
        unchanged: `it is still ${inv.status ?? 'in whatever state it was'}`,
        howToCheck: 'Reload this page: the invoice list carries whichever state is actually stored.',
      })));
  };

  const dropIt = async () => {
    if (!dropping) return;
    setBusy(true); setWriteErr(null);
    try {
      await dropInvoice(supabase, dropping.inv.id, dropping.status, reason, me.id);
      setSaved(dropping.status === 'void'
        ? 'Voided, with your reason on the invoice. It is off what the gym is owed and the reason stays on the row.'
        : 'Written off, with your reason on the invoice. It is off what the gym is owed and the reason stays on the row — including if it is ever put back.');
      setDropping(null); setReason('');
      onChange();
    } catch (e: any) {
      setWriteErr(writeFailedText(e, {
        what: 'That invoice',
        unchanged: `it is still ${dropping.inv.status ?? 'in whatever state it was'} and nothing has come off what the gym is owed`,
        howToCheck: 'Reload this page and read the invoice’s status before doing it again.',
      }));
    } finally { setBusy(false); }
  };

  const cols: Column<Invoice>[] = [
    { key: 'number', header: 'No.', value: (i) => i.number, numeric: true,
      render: (i) => i.number == null ? <span className="dash">unnumbered</span> : String(i.number) },
    { key: 'member', header: 'Billed to', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'due', header: 'Due', value: (i) => i.dueOn,
      render: (i) => i.dueOn ?? <span className="dash">no due date</span> },
    { key: 'amount', header: 'Amount', value: (i) => i.amountCents, numeric: true,
      render: (i) => i.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(i.amountCents, i.currency)}</> },
    { key: 'note', header: 'Note', value: (i) => i.note },
    // Why the gym is not collecting it, where it is not. Blank on a live
    // invoice by design: a column with a sentence in every row is one nobody
    // reads, and the rows that matter here are the few.
    { key: 'why', header: 'Not collected because',
      value: (i) => {
        const h = writeOffHistory(i.status, dropIndex?.get(i.id) ?? NO_DROP,
          gymDateText(dropIndex?.get(i.id)?.droppedAt ?? null, zone), dropStatus);
        return h.state === 'live' ? null : h.line;
      },
      render: (i) => {
        const rec = dropIndex?.get(i.id) ?? NO_DROP;
        const h = writeOffHistory(i.status, rec, gymDateText(rec.droppedAt, zone), dropStatus);
        if (h.state === 'live') return null;
        const tone = h.state === 'dropped' ? 'var(--ink2)'
          : h.state === 'reopened' ? 'var(--ink3)'
          : 'var(--warn)';
        return <span style={{ color: tone }}>{h.line}</span>;
      } },
    { key: 'status', header: 'Status', value: (i) => i.status, align: 'right',
      render: (i) => (
        <select
          className="no-print"
          value={SETTABLE_INVOICE_STATUSES.includes(i.status as any) ? (i.status as string) : ''}
          onChange={(e) => setStatus(i, e.target.value)}
          style={{ ...field, padding: '4px 6px', fontSize: 12 }}
          aria-label={`The status of invoice ${i.number ?? ''}`}
        >
          {/* An unrecognised stored status is offered as its own option rather
              than silently rewritten by the first change of anything else. A
              register holding 'overdue' — which the CHECK permits and this
              screen computes rather than stores — must not have it quietly
              replaced by whatever sorted first in the list. */}
          {SETTABLE_INVOICE_STATUSES.includes(i.status as any) ? null : (
            <option value="">{i.status ?? 'no status recorded'}</option>
          )}
          {SETTABLE_INVOICE_STATUSES.map((st) => (
            <option key={st} value={st}>{INVOICE_STATUS_LABEL[st]}</option>
          ))}
        </select>
      ) },
  ];

  /** This month's dropped invoices with nothing on the row saying why. Only
   *  computed against a WHOLE read of both halves — a failed decision read
   *  would otherwise report every one of them as unexplained. */
  const unexplained = useMemo(
    () => (drops.state !== null
      ? []
      : unexplainedDrops(raised.map((i) => ({
        ...i, ...(dropIndex?.get(i.id) ?? NO_DROP),
      })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- NO_DROP is a constant shape rebuilt per render; including it would recompute this on every one
    [raised, dropIndex, drops.state],
  );

  const roster = [...new Map((members ?? []).filter((m) => m.memberName).map((m) => [m.memberId, m.memberName!])).entries()];
  const theirMemberships = (members ?? []).filter((m) => m.memberId === memberId);

  return (
    <Section
      title="The invoice register"
      sub={`Every invoice dated in ${w.label}, and the form that raises one. Nothing else in this product can write to this table — which is why the three sections below it have always been empty.`}
    >
      <form onSubmit={raise} style={formRow} className="no-print">
        <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setMembershipId(''); }}
                style={{ ...field, flex: 2, minWidth: 190 }} aria-label="Who this invoice is to">
          <option value="">
            {members === null ? 'The roster could not be read' : 'Who is this to?'}
          </option>
          {roster.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={membershipId} onChange={(e) => setMembershipId(e.target.value)}
                style={{ ...field, flex: 2, minWidth: 170 }} aria-label="The membership this invoice bills for"
                disabled={!memberId}>
          <option value="">Not against a membership</option>
          {theirMemberships.map((m) => (
            <option key={m.id} value={m.id}>{m.planName ?? 'no plan'} (from {m.startedOn})</option>
          ))}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Amount (${ccy})` : 'Amount'} style={{ ...field, width: 140 }}
               aria-label="What is being billed" />
        <label style={dateLabel}>
          issued
          <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day this invoice is dated" />
        </label>
        <label style={dateLabel}>
          due
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day it falls due, if it does" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it is for"
               style={{ ...field, flex: 2, minWidth: 160 }} aria-label="What this invoice is for" />
        <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>Raise</button>
      </form>
      <p className="no-print" style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)' }}>
        Clearing the due date raises an invoice that is never overdue &mdash; correct for a receipt,
        and the reason the ageing table below has an &ldquo;undated&rdquo; band. The invoice number
        is allocated by the database rather than by this page, so two invoices raised in two tabs
        cannot take the same one.
      </p>
      {!ccy ? (
        <Banner>
          Invoices cannot be raised until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. A
          bill is what somebody is asked to pay, and there is no default here that would be right
          for half the gyms running Repple. Set it on{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
        </Banner>
      ) : null}
      {blocker && !writeErr && (memberId || amount) ? (
        <p className="no-print" style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '72ch' }}>{blocker}</p>
      ) : null}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {saved ? <Banner>{saved}</Banner> : null}
      {/* The decision read failing takes nothing else down. Said once, here,
          rather than as a sentence repeated down a column. */}
      {drops.why ? <Banner tone="crit">{drops.why}</Banner> : null}

      {/* Taking money off what the gym is owed, with the reason on the row.
          Not a dropdown: 'void' and 'written_off' are the two statuses that
          remove a receivable, `owedOf` counts them into a bucket it calls
          `dropped`, and until supabase/parts/2642 both happened on one click
          with nothing anywhere recording why. */}
      {dropping ? (
        <div className="no-print" style={{
          margin: '0 14px 14px', padding: '12px 14px', background: 'var(--surface2)',
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)', maxWidth: '78ch' }}>
            <strong style={{ color: 'var(--ink)' }}>
              Invoice {dropping.inv.number ?? '(unnumbered)'} to {dropping.inv.memberName ?? 'somebody this console cannot name'}
              {dropping.inv.amountCents == null ? null : <>, {money(dropping.inv.amountCents, dropping.inv.currency)}</>}.
            </strong>{' '}
            {DROP_MEANS[dropping.status]}
          </p>
          <p style={{ margin: '8px 0 9px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>
            This comes off what the gym is owed and lands in the month-end as money it decided not
            to collect. What you type is written onto the invoice and stays there &mdash; including if
            the invoice is ever put back, because a decision that was made and then changed is two
            facts and erasing the first leaves neither.
          </p>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <input
              value={reason} onChange={(e) => setReason(e.target.value)}
              maxLength={MAX_REASON_CHARS}
              placeholder={WRITE_OFF_PROMPT[dropping.status]}
              aria-label={WRITE_OFF_PROMPT[dropping.status]}
              style={{ ...field, flex: 2, minWidth: 260 }}
            />
            <button type="button" disabled={busy || !!writeOffBlocker(dropping.status, reason)}
                    onClick={() => void dropIt()}
                    style={{ ...primaryBtn, opacity: writeOffBlocker(dropping.status, reason) ? 0.5 : 1 }}>
              {busy ? 'Recording…' : dropping.status === 'void' ? 'Void it' : 'Write it off'}
            </button>
            <button type="button" style={linkBtn}
                    onClick={() => { setDropping(null); setReason(''); }}>
              Leave it
            </button>
          </div>
          {reason.trim() && writeOffBlocker(dropping.status, reason) ? (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>
              {writeOffBlocker(dropping.status, reason)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The rows an accountant will ask about first, named rather than
          counted. They are the invoices dropped before this console could hold
          a reason; nothing here knows why and nothing will invent one, so the
          only repair is somebody who remembers writing it in the note. */}
      {read.state === null && drops.state === null && unexplained.length > 0 ? (
        <p className="no-print" style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '82ch' }}>
          {unexplained.length === 1 ? 'One invoice' : `${unexplained.length} invoices`} dated in {w.label}
          {' '}{unexplained.length === 1 ? 'was' : 'were'} taken off what the gym is owed with no reason
          recorded &mdash; {unexplained.map((i) => `no. ${i.number ?? '(unnumbered)'}`).join(', ')}. That happened
          before this console could hold one. Nothing here knows why and nothing will invent it.
        </p>
      ) : null}
      <Part read={read} what="the invoice register" cost="what the gym billed this month is unknown">
        <DataTable noun="invoices"
          rows={raised} columns={cols} rowKey={(i) => i.id}
          empty={`No invoice is dated in ${w.label}. Raise one above — until this wave there was no way to, from any screen in this product.`}
        />
      </Part>
    </Section>
  );
}

/* ── getting the month out of the browser ──────────────────────────────────── */

/**
 * The month, as a file and as a printed page.
 *
 * /accounting and /close are the two screens written for month-end and neither
 * had an export, a print, a PDF or an email. There was no `@media print` rule
 * anywhere in this console. So every figure on the page an accountant is meant
 * to work from lived only in the owner's browser, and the way it left was a
 * screenshot or a retyped column.
 *
 * ONE file, not five. A month is a document — takings, payroll, invoices,
 * ageing and the exceptions are read together and separating them into five
 * downloads is how the exception list ends up in Downloads on its own with
 * nothing saying which month it belongs to. Section headers inside one CSV are
 * not tidy, and they are what makes the file readable by the person who opens
 * it in a spreadsheet with no other context.
 *
 * The file states what could NOT be read, by name. A month whose invoice query
 * failed exports with the invoice section replaced by that sentence rather than
 * with an empty section — which would be indistinguishable from a gym that
 * billed nothing, permanently, in a file somebody keeps.
 */
function Handoff({ w, gymName, asAt, payments, settled, raised, outstanding, books }: {
  w: MonthWindow; gymName: string | null; asAt: string;
  payments: GymPayment[]; settled: Settled[];
  raised: Invoice[]; outstanding: Invoice[]; books: Books;
}) {
  const loading = books.payments.state === 'loading' || books.settled.state === 'loading'
    || books.costs.state === 'loading' || books.invoices.state === 'loading';

  const download = () => {
    const parts: string[] = [];
    const head = (title: string) => `\n${title}\n`;

    parts.push(toCsv(
      ['Report', 'Gym', 'Month', 'From', 'To', 'Receivables as at', 'Basis', 'Generated'],
      [[
        'Month-end accounting', gymName ?? '(gym name unread)', w.label, w.firstDay, w.lastDay,
        asAt, 'Cash basis for money in and out; invoices are accrual and shown separately',
        new Date().toISOString(),
      ]],
    ));

    parts.push(head('MONEY IN — payments recorded in the month'));
    parts.push(books.payments.state !== null
      ? unreadable('the payments taken', books.payments.state, books.payments.why)
      : toCsv(
          ['Taken at', 'Member', 'Amount (minor units)', 'Currency', 'Method', 'Kind', 'Note'],
          payments.map((p) => [
            p.takenAt, p.memberName, p.amountCents, p.currency,
            (p.method ?? '').replace('_', ' '), p.kind, p.note,
          ]),
          false));

    parts.push(head('MONEY OUT — payroll settled in the month'));
    parts.push(books.settled.state !== null
      ? unreadable('the payroll settlements', books.settled.state, books.settled.why)
      : toCsv(
          ['Settled at', 'Trainer', 'Period from', 'Period to', 'Amount (minor units)', 'Currency', 'Sessions', 'Method'],
          settled.map((r) => [
            r.settledAt, r.trainerName, r.periodFrom, r.periodTo,
            r.amountCents, r.currency, r.sessionsCount, r.method,
          ]),
          false));

    // What the gym said it was registered as DURING this month, not what it
    // says today. `tenants.tax_registered` has no date on it and would be the
    // wrong answer for every month before the gym registered — which is the
    // whole of supabase/parts/2641, and it matters most in a file somebody
    // keeps and files from.
    parts.push(head('TAX REGISTRATION — as stated for this month'));
    parts.push(toCsv(
      ['Month', 'What this gym says it was'],
      [[w.label, standingLine(
        registrationDuring(
          books.standings.rows, w.firstDay, w.lastDay,
          books.standings.state === 'loading' ? 'loading' : books.standings.state === 'failed' ? 'error' : 'ready',
        ),
        w.label,
      )]],
    ));

    parts.push(head('MONEY OUT — costs recorded in the month'));
    // The receipt column carries the same three answers the screen does, and
    // the middle one is why it is a WORD rather than a count. A file somebody
    // keeps must not encode "the documents query was refused" as 0, which in a
    // spreadsheet sorts and sums exactly like "nothing was ever filed".
    // Why an invoice is not being collected, for the file. A word rather than
    // a blank in each of the three cases: "the decision could not be read" and
    // "no reason was ever given" are different, and an empty cell in a
    // spreadsheet somebody keeps is indistinguishable from either.
    const droppedIx = books.drops.rows ? new Map(books.drops.rows.map((d) => [d.id, d])) : null;
    const whyNotCollected = (id: string, status: string | null): string => {
      const rec = droppedIx?.get(id) ?? { droppedAt: null, dropReason: null, droppedBy: null, droppedByName: null };
      const h = writeOffHistory(
        status, rec, rec.droppedAt,
        books.drops.state === 'loading' ? 'loading' : books.drops.state === 'failed' ? 'error' : 'ready',
      );
      return h.state === 'live' ? '' : h.line;
    };

    const filed = books.receipts.rows ? byCost(books.receipts.rows) : null;
    const receiptCell = (id: string): string => {
      const e = costEvidence(
        id, filed,
        books.receipts.state === 'loading' ? 'loading'
          : books.receipts.state === 'failed' ? 'error'
          : books.receiptsWhole ? 'ready' : 'partial',
      );
      return e.state === 'attached' ? `${e.count} filed` : e.state === 'none' ? 'none' : 'not known';
    };
    parts.push(books.costs.state !== null
      ? unreadable('the recorded costs', books.costs.state, books.costs.why)
      : toCsv(
          ['Paid on', 'What for', 'Paid to', 'Category', 'Amount (minor units)', 'Currency', 'Note', 'Receipt on file'],
          (books.costs.rows ?? []).map((c) => [
            c.paidOn, c.description, c.supplier, gymCostCategoryLabel(c.category),
            c.amountCents, c.currency, c.note, receiptCell(c.id),
          ]),
          false));
    parts.push(`\n${RECEIPT_IS_NOT_A_CHECK_NOTE}\n`);

    parts.push(head(`INVOICES RAISED IN ${w.label.toUpperCase()}`));
    parts.push(books.invoices.state !== null
      ? unreadable('the invoice register', books.invoices.state, books.invoices.why)
      : toCsv(
          // The reason travels with the status, because in this file they are
          // one fact: a row reading `written_off` with an empty cell beside it
          // is a figure an accountant has to come back and ask about, and the
          // point of supabase/parts/2642 is that the answer is on the row.
          ['Number', 'Issued', 'Due', 'Billed to', 'Amount (minor units)', 'Currency', 'Status', 'Note', 'Not collected because'],
          raised.map((i) => [
            i.number, i.issuedOn, i.dueOn, i.memberName,
            i.amountCents, i.currency, i.status, i.note,
            whyNotCollected(i.id, i.status),
          ]),
          false));

    parts.push(head(`OUTSTANDING AS AT ${asAt}`));
    parts.push(books.invoices.state !== null
      ? unreadable('the invoice register', books.invoices.state, books.invoices.why)
      : toCsv(
          ['Number', 'Issued', 'Due', 'Days past due', 'Billed to', 'Amount (minor units)', 'Currency', 'Status'],
          outstanding.map((i) => [
            i.number, i.issuedOn, i.dueOn,
            i.dueOn ? daysPast(i.dueOn, asAt) : null,
            i.memberName, i.amountCents, i.currency, i.status,
          ]),
          false));

    // The reason the whole file carries a BOM: `toCsv` writes one on the first
    // section and the rest are appended, so Excel reads the whole document as
    // UTF-8 and a member called Müller survives the trip.
    saveText(parts.join(''), `${slugOf(gymName)}-${w.key}-accounting.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 20px' }}>
      {/* Disabled while any slice is still in flight. The refusal travels in
          the file either way, but a button that cannot produce a whole month
          should not look like one that can. */}
      <button onClick={download} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1 }} disabled={loading}>
        {loading ? 'Still reading the month…' : 'Export this month (CSV)'}
      </button>
      <button onClick={() => window.print()} style={{ ...primaryBtn, background: 'transparent', color: 'var(--ink2)', border: '1px solid var(--ring)' }}>
        Print / save as PDF
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '58ch' }}>
        Both take what is on this page. A section whose read failed &mdash; or had not
        finished &mdash; is exported as the sentence saying so, never as an empty section:
        an empty one in a file somebody keeps is indistinguishable, forever, from a month
        in which nothing happened.
      </span>
    </div>
  );
}

/**
 * The line a read that has not landed exports as. Not an empty section.
 *
 * Two states, because `Unread` has three values and only one of them is null.
 * Every one of these gates tested `=== 'failed'`, so a slice still IN FLIGHT
 * fell through to its rows and exported an empty section — and a CSV headed
 * "MONEY IN — payments recorded in the month" with nothing under it, filed, is
 * indistinguishable from a month in which the gym banked nothing. The header on
 * this Handoff already promised the opposite behaviour.
 */
function unreadable(what: string, state: 'loading' | 'failed', why: string | null): string {
  return state === 'loading'
    ? `NOT EXPORTED — ${what} had not finished loading when this file was made. Export the month again. This is unknown, not nil.\n`
    : `NOT EXPORTED — ${what} could not be read${why ? `: ${why}` : ''}. This is unknown, not nil.\n`;
}

/** A filename fragment from the gym's name. Falls back rather than producing a
 *  file called "-2026-08-accounting.csv" that sorts before everything. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── receivables ageing ────────────────────────────────────────────────────── */

type Band = 'current' | 'd1' | 'd31' | 'd61' | 'undated';

const BAND_LABEL: Record<Band, string> = {
  current: 'Current — not yet due',
  d1: '1–30 days past due',
  d31: '31–60 days past due',
  d61: 'More than 60 days past due',
  undated: 'No due date set',
};

const BAND_ORDER: Band[] = ['current', 'd1', 'd31', 'd61', 'undated'];

const BAND_TONE: Record<Band, string> = {
  current: 'var(--ink2)',
  d1: 'var(--warn)',
  d31: 'var(--serious)',
  d61: 'var(--crit)',
  undated: 'var(--ink3)',
};

/** Whole days between two YYYY-MM-DD dates, both read as UTC midnight so the
 *  arithmetic is exact and no daylight-saving hour can shift a bucket. */
function daysPast(dueOn: string, asAt: string): number | null {
  const d = Date.parse(`${dueOn}T00:00:00Z`);
  const a = Date.parse(`${asAt}T00:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(a)) return null;
  return Math.round((a - d) / DAY);
}

/**
 * Which band an invoice falls in as at a date.
 *
 * An invoice due today is not late today. An invoice with no due date is not
 * current either — the gym never said when it wanted the money, so it cannot be
 * aged at all, and it gets its own band instead of being quietly filed as the
 * healthiest one.
 */
function bandOf(inv: Invoice, asAt: string): Band {
  if (!inv.dueOn) return 'undated';
  const n = daysPast(inv.dueOn, asAt);
  if (n == null) return 'undated';
  if (n <= 0) return 'current';
  if (n <= 30) return 'd1';
  if (n <= 60) return 'd31';
  return 'd61';
}

interface BandLine {
  key: Band;
  label: string;
  count: number;
  sum: Sum;
}

function Ageing({ read, rows, asAt, total }: {
  read: Read<Invoice>; rows: Invoice[]; asAt: string; total: Sum;
}) {
  const lines: BandLine[] = useMemo(() => {
    const groups = new Map<Band, Invoice[]>();
    for (const i of rows) {
      const b = bandOf(i, asAt);
      groups.set(b, [...(groups.get(b) ?? []), i]);
    }
    return BAND_ORDER.map((b) => {
      const g = groups.get(b) ?? [];
      return {
        key: b,
        label: BAND_LABEL[b],
        count: g.length,
        sum: sumOf(g, 'no invoice sits in this band'),
      };
    });
  }, [rows, asAt]);

  const detailCols: Column<Invoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'due', header: 'Due', value: (i) => i.dueOn,
      render: (i) => (i.dueOn
        ? <span style={{ color: BAND_TONE[bandOf(i, asAt)] }}>{i.dueOn}</span>
        : <span className="dash">none set</span>) },
    { key: 'age', header: 'Days past due', value: (i) => (i.dueOn ? daysPast(i.dueOn, asAt) : null), numeric: true,
      render: (i) => {
        if (!i.dueOn) return <span className="dash">cannot be aged</span>;
        const n = daysPast(i.dueOn, asAt);
        if (n == null) return <span className="dash">due date unreadable</span>;
        return n <= 0 ? <span className="dash">not yet due</span> : <>{n}</>;
      } },
    { key: 'amount', header: 'Amount', value: (i) => i.amountCents, numeric: true,
      render: (i) => (i.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(i.amountCents, i.currency)}</>) },
    { key: 'status', header: 'Status', value: (i) => i.status },
    { key: 'note', header: 'Note', value: (i) => i.note },
  ];

  const bandCols: Column<BandLine>[] = [
    { key: 'label', header: 'Band', value: (l) => l.label,
      render: (l) => <span style={{ color: BAND_TONE[l.key] }}>{l.label}</span> },
    { key: 'count', header: 'Invoices', value: (l) => l.count, numeric: true },
    { key: 'amount', header: 'Amount', value: (l) => (l.sum.known ? l.sum.cents : null), numeric: true,
      render: (l) => (l.sum.known
        ? <>{money(l.sum.cents, l.sum.currency)}</>
        : <span className="dash">{l.sum.why}</span>) },
  ];

  return (
    <Section
      title="Accounts receivable, aged"
      sub={`Every invoice still marked open or overdue as at ${asAt}, whichever month it was raised in, bucketed by how far past its due date it is.`}
    >
      <Part read={read} what="the invoice register"
            cost="the debt is unknown — no ageing is shown rather than an empty one, which would read as a gym owed nothing">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} outstanding across {rows.length} invoice{rows.length === 1 ? '' : 's'}.</>
              : <>No outstanding total: {total.why}.</>}
            {' '}Void and written-off invoices are money the gym has decided not to
            collect and are counted in neither this nor what came in.
          </p>
          <DataTable noun="ageing bands" rows={lines} columns={bandCols} rowKey={(l) => l.key}
                     empty="No band to show." />
          {rows.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>The invoices behind those bands</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Named, because an ageing summary an accountant cannot drill into is
                  a number they have to take on trust.
                </p>
              </div>
              <DataTable noun="aged invoices" rows={rows} columns={detailCols} rowKey={(i) => i.id} empty="—" />
            </div>
          ) : null}
        </>
      </Part>
    </Section>
  );
}

/* ── reconciliation ────────────────────────────────────────────────────────── */

interface Recon {
  /** Invoices this month marked paid that no payment in the window explains. */
  invoicesWithoutPayment: Invoice[];
  /** Payments this month that no invoice in the register explains. */
  paymentsWithoutInvoice: GymPayment[];
  /** Payments carrying no member — unmatchable by construction, held apart so
   *  they do not swell the list above with rows nobody can act on. */
  unattributed: GymPayment[];
}

/**
 * Match payments to invoices — using the link where somebody has recorded one,
 * and the old stated guess everywhere else.
 *
 * `gym_payments.invoice_id` exists as of supabase/parts/180 and is written when
 * the payment is matched by hand or recorded against a membership. A payment
 * that names its invoice is a FACT and consumes that invoice outright, whatever
 * the amount and whatever the date — a part payment recorded against the right
 * bill is still the right bill, and the heuristic below would have rejected it
 * for being the wrong amount.
 *
 * For everything unlinked the rule is unchanged, stated and crude on purpose:
 * same member, same currency, exactly the same amount in cents, within
 * MATCH_DAYS of the invoice date, and each payment may satisfy at most one
 * invoice. Every paid invoice the register holds gets a chance to consume a
 * payment — not only this month's — otherwise a payment settling July's invoice
 * would surface in August's list as money nobody billed for.
 *
 * What this cannot see, and what the screen therefore says out loud: part
 * payments, one payment covering two invoices, a family paying under one name,
 * and cash banked in a lump. Both lists are questions for a human, never
 * findings.
 */
function reconcile(invoices: Invoice[], payments: GymPayment[], w: MonthWindow): Recon {
  const paid = [...invoices.filter((i) => i.status === 'paid')]
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));

  const used = new Set<string>();
  const invoicesWithoutPayment: Invoice[] = [];

  for (const inv of paid) {
    // The hard link first. A payment naming this invoice settles it; nothing
    // about amount, currency or date gets to overrule what somebody recorded.
    const stated = payments.find((p) => p.invoiceId === inv.id && !used.has(p.id));
    if (stated) { used.add(stated.id); continue; }
    const hit = inv.memberId != null && Number.isFinite(inv.amountCents as number)
      ? payments.find((p) =>
          !used.has(p.id)
          && p.memberId === inv.memberId
          && p.currency === inv.currency
          && Number.isFinite(p.amountCents)
          && p.amountCents === inv.amountCents
          && withinDays(p.takenAt, inv.issuedOn, MATCH_DAYS))
      : undefined;

    if (hit) used.add(hit.id);
    // Only this month's paid invoices are reported. An unmatched paid invoice
    // from March is real, but it is March's problem and listing it here would
    // bury the month somebody is actually filing.
    else if (inv.issuedOn >= w.firstDay && inv.issuedOn <= w.lastDay) invoicesWithoutPayment.push(inv);
  }

  const inWindow = payments.filter((p) => inMonth(p.takenAt, w));
  return {
    invoicesWithoutPayment,
    paymentsWithoutInvoice: inWindow.filter((p) => p.memberId != null && !used.has(p.id)),
    unattributed: inWindow.filter((p) => p.memberId == null),
  };
}

/** Whether a timestamp falls within n days of a date, either side. */
function withinDays(iso: string, day: string, n: number): boolean {
  const t = Date.parse(iso);
  const d = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(d)) return false;
  return Math.abs(t - d) <= n * DAY;
}

function Reconcile({ books, w, inMonthPayments, tenantId, me, zone, onChange }: {
  books: Books; w: MonthWindow; inMonthPayments: GymPayment[];
  tenantId: string; me: Me; zone: string | null; onChange: () => void;
}) {
  const bothRead = books.invoices.state === null && books.payments.state === null;
  const r = useMemo(
    () => (bothRead ? reconcile(books.invoices.rows ?? [], books.payments.rows ?? [], w) : null),
    [bothRead, books.invoices.rows, books.payments.rows, w],
  );

  // Which exception has its answer box open, as `kind:id`. One at a time: an
  // input on every row of a two-hundred-row exception list is two hundred
  // uncommitted notes, and the first reload throws all of them away.
  const [answering, setAnswering] = useState<string | null>(null);
  const [markErr, setMarkErr] = useState<string | null>(null);

  const marks = books.marks;
  // Every list is split the same way. A flagged row stays in `open` — flagging
  // is a bookmark, not an answer — and an explained one moves to its own
  // section rather than disappearing, because a reconciliation that silently
  // shrank would be a reconciliation nobody could check.
  const invSplit = r ? partitionByMark(r.invoicesWithoutPayment, 'invoice', marks) : null;
  const paySplit = r ? partitionByMark(r.paymentsWithoutInvoice, 'payment', marks) : null;
  const unattSplit = r ? partitionByMark(r.unattributed, 'payment', marks) : null;

  /** The Answer / Explained pair a row carries in its last column. */
  const answerCell = (kind: 'invoice' | 'payment', id: string, label: string) => {
    const k = markKey(kind, id);
    const mark = marks.get(k);
    if (answering === k) {
      return (
        <Answer
          kind={kind} subjectId={id} tenantId={tenantId} me={me} existing={mark ?? null}
          onDone={() => { setAnswering(null); setMarkErr(null); onChange(); }}
          onCancel={() => setAnswering(null)}
          onErr={setMarkErr}
        />
      );
    }
    if (mark) {
      return (
        <span style={{ fontSize: 12, color: mark.state === 'accepted' ? 'var(--good)' : 'var(--warn)' }}>
          {mark.state === 'accepted' ? 'explained' : 'flagged'}
          <button className="no-print" style={{ ...linkBtn, marginLeft: 8 }} onClick={() => setAnswering(k)}>change</button>
        </span>
      );
    }
    return <button className="no-print" style={linkBtn} onClick={() => setAnswering(k)}>{label}</button>;
  };

  /* ── recording a match, which nothing could do ────────────────────────────
   *
   * `matchPayment` and `settleInvoice` were both imported by this file and
   * called by nothing anywhere in the repository. So `gym_payments.invoice_id`
   * — the column supabase/parts/180 added precisely to be the hard link — was
   * never written by any code path, the `p.invoiceId === inv.id` test in
   * `reconcile` above never fired, and every invoice fell through to the
   * 45-day exact-amount guess. The copy under this section told the accountant
   * the column is "written when somebody records the payment against a
   * membership or matches it here", and there was no here.
   *
   * A part payment, a lump cash banking, or two members paying the same amount
   * therefore reappeared as an exception every month for ever, and the only
   * action available was "explain or flag" — which records a note and leaves
   * the ledger unlinked.
   *
   * Which of the two writes is used follows from the invoice's status, and the
   * distinction is not cosmetic:
   *
   *   · An invoice already marked PAID needs the link alone. `matchPayment`.
   *   · An invoice still OPEN is being settled by this payment, so it needs the
   *     link and the status, in that order. `settleInvoice` does both and its
   *     own doc comment explains why the order is not free.
   *
   * Nothing here infers a match. The rule stays as the way the screen GROUPS
   * unmatched rows; this is a person recording that they looked and it is
   * right, which is the difference the note on `matchPayment` insists on.
   */
  const [matching, setMatching] = useState<string | null>(null);

  const recordMatch = async (invoice: Invoice, paymentId: string) => {
    setMarkErr(null);
    try {
      if ((invoice.status ?? '') === 'paid') await matchPayment(supabase, paymentId, invoice.id);
      else await settleInvoice(supabase, invoice.id, paymentId);
      setMatching(null);
      onChange();
    } catch (e: any) {
      setMarkErr(`That match was NOT recorded: ${e?.message ?? 'the write was refused'}. The payment and the invoice are still unlinked.`);
    }
  };

  /** The payments that could settle this invoice: same member, not already
   *  linked to something else. Deliberately NOT filtered by amount or by date —
   *  a part payment and a lump banking are the two cases the heuristic cannot
   *  see, and they are the reason this control exists. */
  const candidatePayments = (inv: Invoice): GymPayment[] =>
    (books.payments.rows ?? []).filter((p) =>
      p.invoiceId == null && p.kind === 'payment' && p.memberId != null && p.memberId === inv.memberId);

  /** The invoices this payment could settle: same member, not already settled by
   *  another payment. An invoice in any status is offered — an open one is
   *  settled by the match, a paid one is merely linked. */
  const candidateInvoices = (p: GymPayment): Invoice[] => {
    const taken = new Set((books.payments.rows ?? [])
      .filter((x) => x.invoiceId != null && x.id !== p.id)
      .map((x) => x.invoiceId as string));
    return (books.invoices.rows ?? []).filter((i) =>
      i.memberId != null && i.memberId === p.memberId
      && !taken.has(i.id)
      && i.status !== 'void' && i.status !== 'draft');
  };

  const invCols: Column<Invoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'amount', header: 'Invoiced', value: (i) => i.amountCents, numeric: true,
      render: (i) => (i.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(i.amountCents, i.currency)}</>) },
    { key: 'why', header: 'Why it is here', value: (i) => (i.memberId == null ? 'no member' : 'no payment matches'),
      render: (i) => (
        <span style={{ color: 'var(--ink3)' }}>
          {i.memberId == null
            ? 'the invoice names no member, so nothing can be matched to it'
            : i.amountCents == null
              ? 'the invoice carries no amount, so nothing can be matched to it'
              : `no payment of this amount from this member within ${MATCH_DAYS} days`}
        </span>
      ) },
    { key: 'note', header: 'Note', value: (i) => i.note },
    { key: 'match', header: 'The payment', value: () => '', align: 'right',
      render: (i) => (
        <MatchPicker
          open={matching === `invoice:${i.id}`}
          onOpen={() => { setMarkErr(null); setMatching(`invoice:${i.id}`); }}
          onCancel={() => setMatching(null)}
          label="Match a payment"
          empty="No unmatched payment from this member is in the window. Reach further back on Money, or explain the row."
          options={candidatePayments(i).map((p) => ({
            id: p.id,
            label: `${gymDateText(p.takenAt, zone) ?? 'no date'} — ${money(p.amountCents, p.currency) ?? 'no amount'}${p.note ? ` (${p.note})` : ''}`,
          }))}
          onPick={(paymentId) => recordMatch(i, paymentId)}
        />
      ) },
    { key: 'answer', header: 'Answer', value: (i) => marks.get(markKey('invoice', i.id))?.state ?? '', align: 'right',
      render: (i) => answerCell('invoice', i.id, 'Explain or flag') },
  ];

  const payCols: Column<GymPayment>[] = [
    { key: 'taken', header: 'Taken', value: (p) => p.takenAt,
      render: (p) => gymDateText(p.takenAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'member', header: 'Member', value: (p) => p.memberName },
    { key: 'amount', header: 'Amount', value: (p) => p.amountCents, numeric: true,
      render: (p) => money(p.amountCents, p.currency) },
    { key: 'method', header: 'Method', value: (p) => (p.method ?? '').replace('_', ' ') },
    { key: 'note', header: 'Note', value: (p) => p.note },
    { key: 'match', header: 'The invoice', value: () => '', align: 'right',
      render: (p) => (
        <MatchPicker
          open={matching === `payment:${p.id}`}
          onOpen={() => { setMarkErr(null); setMatching(`payment:${p.id}`); }}
          onCancel={() => setMatching(null)}
          label="Match an invoice"
          empty="This member has no invoice left for this to settle. That is what the row is saying, and explaining it is the honest answer."
          options={candidateInvoices(p).map((i) => ({
            id: i.id,
            label: `${i.number != null ? `#${i.number} ` : ''}${i.issuedOn} — ${money(i.amountCents, i.currency) ?? 'no amount'} (${i.status ?? 'no status'})`,
          }))}
          onPick={(invoiceId) => {
            const inv = (books.invoices.rows ?? []).find((x) => x.id === invoiceId);
            if (inv) void recordMatch(inv, p.id);
          }}
        />
      ) },
    { key: 'answer', header: 'Answer', value: (p) => marks.get(markKey('payment', p.id))?.state ?? '', align: 'right',
      render: (p) => answerCell('payment', p.id, 'Explain or flag') },
  ];

  /** The explained rows of one list, under their own heading with the reason
   *  and who gave it. Never hidden — an accountant has to be able to see what
   *  was taken off the list and why. */
  const explained = <T extends { id: string }>(
    rows: Array<{ row: T; mark: ReconcileMark }>,
    label: (row: T) => React.ReactNode,
    kind: 'invoice' | 'payment',
  ) => (rows.length ? (
    <div style={{ borderTop: '1px solid var(--ring)', padding: '11px 14px' }}>
      <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>
        Explained &mdash; {rows.length}
      </h3>
      <p style={{ margin: '4px 0 8px', color: 'var(--ink3)', fontSize: 12 }}>
        Answered once and taken off the list above, with the answer beside it. This is not an
        approval and this console has no second role to give one &mdash; it says who pressed the
        button and when.
      </p>
      <ul style={{ margin: 0, padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
        {rows.map(({ row, mark }) => (
          <li key={row.id} style={{ marginBottom: 4 }}>
            {label(row)} &mdash; &ldquo;{mark.note}&rdquo;{' '}
            <span style={{ color: 'var(--ink3)' }}>
              ({mark.markedByName ?? 'somebody'}, {gymDateText(mark.markedAt, zone) ?? 'no date'})
            </span>
            <button
              className="no-print"
              style={{ ...linkBtn, marginLeft: 8, color: 'var(--ink3)' }}
              onClick={() => clearMark(supabase, tenantId, kind, row.id)
                .then(() => { setMarkErr(null); onChange(); })
                .catch((e: any) => setMarkErr(`That answer was not withdrawn: ${e?.message ?? 'the write was refused'}. It is still explained.`))}
            >
              put it back
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null);

  return (
    <Section
      title="What does not reconcile"
      sub="The two lists an accountant came for. Neither is a finding — each row is a question with a name on it."
    >
      {/* Mounted for as long as this section is on screen, so a later refusal
          is a CHANGE to an existing region rather than a node inserted at the
          same instant as its text — which no screen reader reliably announces.
          `markErr` says "That match was NOT recorded… The payment and the
          invoice are still unlinked", and it lived in a plain <div>: a member
          of staff pressed the button, heard nothing, and read the refusal as
          success on a reconciliation. /staff has used `<Announce>` for this
          since it was written. */}
      <Announce say={markErr} tone="crit" />
      {!bothRead ? (
        <div style={{ padding: 14, color: 'var(--ink2)', fontSize: 13.5 }}>
          {books.invoices.state === 'loading' || books.payments.state === 'loading'
            ? 'Still reading both sides.'
            : 'One side could not be read, so no comparison is offered. A reconciliation run against a failed read produces findings that look exactly like real ones, which is worse than no reconciliation.'}
        </div>
      ) : r ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            A payment can now SAY which invoice it settles &mdash;{' '}
            <span className="mono">gym_payments.invoice_id</span>, written when somebody records
            the payment against a membership or matches it here. Anything that has not been said is
            matched the old way: member, exact amount, currency and a payment within {MATCH_DAYS}{' '}
            days of the invoice date, one payment per invoice. Part payments, one payment settling
            two invoices, a partner paying under their own name and cash banked in a lump will all
            appear below and all be fine. Say so once, in the Answer column, and the row stops being
            asked about &mdash; it moves to &ldquo;Explained&rdquo; with your reason on it rather
            than reappearing every month for ever.
          </p>
          {books.marksErr ? (
            <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--warn)', fontSize: 12.5 }}>
              The answers already given could not be read: {books.marksErr}. Every exception below is
              therefore shown as unanswered. That is the safe direction &mdash; the other one would
              take a real exception off this page because a lookup failed &mdash; but do not read the
              length of these lists as work outstanding until it loads.
            </div>
          ) : null}
          {markErr ? (
            <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--crit)', fontSize: 12.5 }}>
              {markErr}
            </div>
          ) : null}

          <div style={{ padding: '11px 14px' }}>
            <h3 style={{ fontSize: 13, margin: 0, color: (invSplit?.open.length ?? 0) ? 'var(--crit)' : 'var(--ink2)' }}>
              Marked paid, no payment behind it — {invSplit?.open.length ?? 0}
            </h3>
            <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
              The register says this money arrived in {w.label}. The payments record
              does not show it. Either it was banked and never entered, or the
              invoice was marked paid before the money moved.
            </p>
          </div>
          <DataTable noun="unreconciled invoices"
            rows={invSplit?.open ?? []} columns={invCols} rowKey={(i) => i.id}
            empty={`Every invoice raised in ${w.label} and marked paid has a payment of the same amount from the same member behind it.`}
          />
          {explained(invSplit?.explained ?? [], (i) => <>{i.memberName ?? 'nobody named'}, {i.issuedOn}</>, 'invoice')}

          <div style={{ padding: '11px 14px', borderTop: '1px solid var(--ring)' }}>
            <h3 style={{ fontSize: 13, margin: 0, color: (paySplit?.open.length ?? 0) ? 'var(--warn)' : 'var(--ink2)' }}>
              Banked, no invoice in front of it — {paySplit?.open.length ?? 0}
            </h3>
            <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
              Real money, recorded, with nothing in the invoice register that explains
              what it was for. Perfectly normal at a gym that takes cash at the desk —
              and exactly where unbilled income hides at one that does not.
            </p>
          </div>
          <DataTable noun="unreconciled payments"
            rows={paySplit?.open ?? []} columns={payCols} rowKey={(p) => p.id}
            empty={`Every attributed payment banked in ${w.label} lines up with an invoice.`}
          />
          {explained(paySplit?.explained ?? [], (p) => <>{p.memberName ?? 'nobody named'}, {gymDateText(p.takenAt, zone) ?? 'no date'}</>, 'payment')}

          {r.unattributed.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>
                  Banked against nobody — {r.unattributed.length}
                </h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Held apart from the list above because these cannot be matched by
                  construction, not because they failed a check. They are counted in
                  money in, and they cannot be chased, refunded or explained later.
                </p>
              </div>
              <DataTable noun="unattributed payments" rows={unattSplit?.open ?? []} columns={payCols} rowKey={(p) => p.id} empty="—" />
              {explained(unattSplit?.explained ?? [], (p) => <>{money(p.amountCents, p.currency) ?? 'an unreadable amount'}, {gymDateText(p.takenAt, zone) ?? 'no date'}</>, 'payment')}
            </div>
          ) : null}

          <p style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            {inMonthPayments.length} payment{inMonthPayments.length === 1 ? '' : 's'} banked in {w.label} went into this
            comparison, against every invoice the register holds up to {w.lastDay}.
          </p>
        </>
      ) : null}
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Invoices issued on or before the end of the month.
 *
 * Deliberately not scoped to the month: an invoice raised in June and still
 * unpaid in August is money owed at the August close, and a query scoped to
 * August would report that gym as owed nothing. The ageing and the
 * reconciliation both need the history.
 *
 * `.error` is checked on both queries here. supabase-js resolves on a database
 * error, so without it a refused read arrives as `data: null`, falls through
 * `?? []`, and this page reports a gym that billed nothing, is owed nothing and
 * reconciles perfectly.
 *
 * PAGED through src/lib/rowCap.ts. PostgREST stops at 1000 rows and says
 * nothing; a gym billing monthly to two hundred members crosses that in five
 * months, and the order is `issued_on desc`, so the rows that fell away were
 * the OLDEST — precisely the long-unpaid ones the ageing table exists to
 * surface, and the ones a reconciliation needs to match this month's payments
 * against. A truncated read would not merely make "owed" smaller: it would make
 * the month appear to reconcile, which is the sentence somebody files accounts
 * on.
 *
 * Refusing was the honest answer to that and not a durable one. The set only
 * grows, so a gym that crossed the line stayed the wrong side of it and this
 * screen was gone for good. `readAll` finishes the read instead; `PAGE_CEILING`
 * still refuses past fifty thousand invoices, which is a statement about a read
 * too large to total in a browser rather than a figure.
 *
 * `issued_on` is a DATE and a gym raising its book on the first of the month
 * ties hundreds of rows on it, so `id` — the primary key — supplies the total
 * order `readAll` requires. Paging a tied order loses and repeats rows without
 * saying so, and here that is an invoice missing from a reconciliation.
 */
async function fetchInvoices(tenantId: string, upToDay: string): Promise<Invoice[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_invoices')
      .select('id, number, member_id, membership_id, amount_cents, currency, issued_on, due_on, status, note, billed_name')
      .eq('tenant_id', tenantId)
      .lte('issued_on', upToDay)
      .order('issued_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the invoices up to the end of this month',
  );
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.member_id));
  return rows.map((r: any) => ({
    id: r.id,
    number: Number.isFinite(r.number) ? r.number : null,
    memberId: r.member_id ?? null,
    // `billed_name` is the snapshot supabase/parts/184 leaves behind when an
    // account is erased, and it is the only thing that keeps a RETAINED invoice
    // legible. The live name wins while there is one, because a member who has
    // changed their name should read as their current one on an open bill.
    memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? r.billed_name ?? null,
    membershipId: r.membership_id ?? null,
    // Not `?? 0`. An invoice with no amount is money of unknown size, and every
    // total on this page refuses rather than absorbs it.
    amountCents: r.amount_cents ?? null,
    // Not `?? 'AED'`. The column is NOT NULL and — since supabase/parts/150 —
    // has NO DEFAULT, so a write that omits the currency is rejected outright
    // and a read always finds one; this branch does not fire in practice. "In
    // practice" is what every currency bug in this repo was made of, so it is
    // still written: null reaches money(), which withholds the figure, and
    // sumOf() below refuses to total a set containing one.
    currency: r.currency ?? null,
    issuedOn: r.issued_on,
    dueOn: r.due_on ?? null,
    status: r.status ?? null,
    note: r.note ?? null,
  }));
}

/**
 * Every invoice this gym has decided not to collect, and why.
 *
 * `dropped_at is not null` is the filter, so this is the small table: a gym's
 * bad debts and voided bills, not its register. It is unbounded in time on
 * purpose — the Ageing section below reaches back over every invoice ever
 * issued, so an invoice written off in June has to be explainable in September.
 *
 * Capped and REFUSING. A truncated read here would drop the oldest decisions,
 * and `writeOffHistory` would then describe those invoices as having no reason
 * recorded — which is the exact false sentence this read exists to make
 * impossible. A gym with more than a thousand written-off invoices has a
 * problem this screen cannot help with, and saying so is better than quietly
 * explaining nine hundred of them.
 */
async function fetchDrops(tenantId: string): Promise<DropRow[]> {
  const { data, error } = await supabase
    .from('gym_invoices')
    .select('id, dropped_at, drop_reason, dropped_by')
    .eq('tenant_id', tenantId)
    .not('dropped_at', 'is', null)
    .order('dropped_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data, 'why this gym has not collected on some of its invoices');
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r: any) => r.dropped_by));
  return rows.map((r: any) => ({
    id: r.id,
    droppedAt: r.dropped_at ?? null,
    dropReason: r.drop_reason ?? null,
    droppedBy: r.dropped_by ?? null,
    droppedByName: r.dropped_by ? names.get(r.dropped_by) ?? null : null,
  }));
}

/**
 * Payroll settled inside the month, by the date it was settled.
 *
 * Capped, and refusing. This read is already bounded to one month, so a
 * thousand settlement rows would mean a gym paying its coaches more than thirty
 * times a day — it will not truncate. It is capped anyway because the cost if
 * it ever did is a payroll total that is short by an unknown amount, printed
 * beside the month's takings as the wage bill. The check costs one character in
 * the query and removes the only way that figure could be wrong without saying
 * so.
 */
async function fetchSettled(tenantId: string, fromIso: string, toIso: string): Promise<Settled[]> {
  const { data, error } = await supabase
    .from('payroll_settlements')
    .select('id, trainer_id, period_from, period_to, amount_cents, reimbursement_cents, currency, sessions_count, method, settled_at')
    .eq('tenant_id', tenantId)
    .gte('settled_at', fromIso)
    .lt('settled_at', toIso)
    .order('settled_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data, 'the payroll settled in this month');
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.trainer_id));
  return rows.map((r: any) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    periodFrom: r.period_from ?? null,
    periodTo: r.period_to ?? null,
    amountCents: r.amount_cents ?? null,
    // Same as the invoice mapper above. A settlement is what a coach was
    // actually paid; if the row does not say in what, nothing here may decide.
    currency: r.currency ?? null,
    sessionsCount: r.sessions_count ?? null,
    method: r.method ?? null,
    settledAt: r.settled_at,
    reimbursementCents: Number.isFinite(r.reimbursement_cents) ? r.reimbursement_cents : null,
  }));
}

/**
 * Names from `profiles`, where they live. Throws rather than returning an empty
 * map: an unnamed row on a page somebody files from is not cosmetic.
 *
 * Capped for the same reason it is chunked nowhere: `unique` is bounded by the
 * invoice and settlement reads above, both of which now refuse past 1000 rows,
 * so this cannot legitimately ask for more than that. Which means a read that
 * comes back at the ceiling is a symptom of something else having gone wrong,
 * and the honest response to that is to stop rather than to name half the
 * people and leave the rest as dashes.
 *
 * Fewer names than ids is NOT truncation and is not treated as it — verified
 * against the live database: `profiles_owner_tenant_r` is `is_owner_of(
 * tenant_id)`, so an owner reading three ids gets back only the ones inside
 * their own gym. A missing name is a person this console may not name.
 */
/**
 * Names for the ids on a set of rows.
 *
 * CHUNKED through src/lib/idLookup.ts, which stopped being optional when the
 * reads above it started paging. One `.in()` was safe only while those reads
 * refused past a thousand rows and so carried at most a thousand distinct ids;
 * finished, they can hand this five thousand, and a bare `.in()` would answer
 * with the first thousand names and no complaint — leaving two thirds of a
 * reconciliation unnamed, which reads as a gym that never recorded who it
 * billed rather than as a broken lookup. That many uuids is also a query string
 * no proxy will forward.
 *
 * Throwing rather than swallowing, as before: an unnamed invoice register on
 * the screen somebody files accounts from is not a cosmetic problem.
 */
async function namesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await readByIds<any>(
    ids,
    (chunk, from, to) => supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
    'the names on those rows',
  );
  return new Map(rows
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]) => !!n));
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** The note under a figure whose read has not returned — which of the two
 *  states it is missing for, never a shrug. */
/**
 * The answer box on one exception row.
 *
 * Two states, and the asymmetry between them is the whole design.
 * `accepted` REMOVES the row from what an accountant is looking at, so the
 * reason is required — supabase/parts/181 enforces that at the database as
 * well, because an exception silently taken off a reconciliation with nothing
 * recorded is exactly the row somebody asks about later. `flagged` removes
 * nothing; it is a bookmark, so a bare one is a complete thought.
 *
 * There is deliberately no "dismiss". It and "explain" would be two words for
 * one action with different implications about whether anybody actually looked,
 * and a month later nothing on screen could tell them apart.
 */
/**
 * Pick the other half of a match, and record it.
 *
 * Closed by default and one at a time, for the same reason `Answer` is: a
 * dropdown on every row of a two-hundred-row exception list is two hundred
 * chances to link the wrong pair, and this write is the one that tells the
 * reconciliation an answer is a FACT rather than a guess.
 *
 * The empty case is a sentence rather than an empty select. "There is nothing
 * to match this to" is itself the answer to the exception, and an owner staring
 * at a control with no options in it would read it as broken.
 */
function MatchPicker({ open, onOpen, onCancel, onPick, options, label, empty }: {
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onPick: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  label: string;
  empty: string;
}) {
  const [chosen, setChosen] = useState('');
  if (!open) {
    return <button className="no-print" style={linkBtn} onClick={onOpen}>{label}</button>;
  }
  if (!options.length) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {empty}{' '}
        <button className="no-print" style={{ ...linkBtn, marginLeft: 6 }} onClick={onCancel}>close</button>
      </span>
    );
  }
  return (
    <span className="no-print" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select aria-label="Which branch" value={chosen} onChange={(e) => setChosen(e.target.value)} style={{ ...field, maxWidth: 320 }}>
        <option value="">Choose one…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button style={linkBtn} disabled={!chosen} onClick={() => chosen && onPick(chosen)}>Record it</button>
      <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={onCancel}>cancel</button>
    </span>
  );
}

function Answer({ kind, subjectId, tenantId, me, existing, onDone, onCancel, onErr }: {
  kind: 'invoice' | 'payment'; subjectId: string; tenantId: string; me: Me;
  existing: ReconcileMark | null;
  onDone: () => void; onCancel: () => void; onErr: (s: string | null) => void;
}) {
  const [state, setState] = useState<MarkState>(existing?.state ?? 'accepted');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const blocker = markBlocker(state, note);

  const go = async () => {
    if (blocker) { onErr(blocker); return; }
    setBusy(true);
    try {
      await markException(supabase, tenantId, {
        subjectKind: kind, subjectId, state, note, markedBy: me.id,
      });
      onErr(null);
      onDone();
    } catch (e: any) {
      onErr(`That answer was NOT recorded: ${e?.message ?? 'the write was refused'}. The row is still an open question.`);
    } finally { setBusy(false); }
  };

  return (
    <span className="no-print" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'normal' }}>
      <select value={state} onChange={(e) => setState(e.target.value as MarkState)}
              style={{ ...field, padding: '3px 5px', fontSize: 12, width: 130 }}
              aria-label="What this row is">
        <option value="accepted">Expected</option>
        <option value="flagged">Wrong</option>
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)}
             placeholder={state === 'accepted' ? 'Why this is fine' : 'What is wrong (optional)'}
             style={{ ...field, padding: '3px 5px', fontSize: 12, width: 210 }}
             aria-label="The reason" />
      <button style={linkBtn} disabled={busy || !!blocker} onClick={go}>Save</button>
      <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={onCancel}>Cancel</button>
    </span>
  );
}

function note<T>(r: Read<T>, what: string): string | undefined {
  if (r.state === 'loading') return `reading ${what}…`;
  if (r.state === 'failed') return `${what} could not be read`;
  return undefined;
}

/**
 * A section body that cannot lie about which of the three states it is in:
 * loading says loading, failed says what broke and what is therefore unknown,
 * returned hands over to the table.
 */
function Part<T>({ read, what, cost, children }: {
  read: Read<T>; what: string; cost?: string; children: React.ReactNode;
}) {
  if (read.state === 'loading') return <Loading />;
  if (read.state === 'failed') {
    return (
      <div style={{
        padding: '16px 14px', margin: 14, borderRadius: 0,
        border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
      }}>
        Could not read {what}. This section is <strong>unknown</strong>, not empty
        {cost ? <> — {cost}</> : null}. Nothing here may be filed.
        {read.why ? (
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{read.why}</div>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

/** A date field with its own word beside it. `<input type="date">` renders an
 *  empty box with a picker icon and nothing saying which date it wants, and two
 *  of them in one row is a coin toss. */
const dateLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--ink3)', fontSize: 12.5,
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The same idea as a Kpi, inline inside a section header strip. */
function Figure({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 16.5, marginTop: 3, color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 2, maxWidth: 300 }}>{note}</div> : null}
    </div>
  );
}

