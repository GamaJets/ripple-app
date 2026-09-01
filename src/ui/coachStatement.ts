// The reads behind a coach's statement of record. The statement itself is
// src/lib/coachStatement.ts, which is pure and tested; nothing here decides
// what it says.
//
// ── Every read is paged to the end, or it is named as missing ──────────────
//
// PostgREST answers with at most 1000 rows and does not say so. A period read
// that stopped there would report a fraction of a coach's year with a tick
// beside it, and this is the one screen where that number gets copied into
// somebody else's spreadsheet. So every read here goes through `readAll` (see
// src/lib/rowCap.ts), which pages until a short page ends the set and throws
// rather than handing back a prefix.
//
// `readAll`'s contract is a TOTAL order — one that cannot tie — because each
// page is a separate HTTP request that Postgres may plan differently and
// promises no order between tied rows. Every page function below therefore
// orders on its date column AND on `id`.
//
// ── Six reads, six statuses ────────────────────────────────────────────────
//
// They fail independently and they are reported independently. One refused read
// must not blank the other five, and it must not be rendered as a zero: telling
// a self-employed person they took nothing, because a query was refused, is the
// worst version of this app's worst defect.
//
// ── supabase-js RESOLVES on an error ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. `readAll` throws on
// `error` for exactly this reason and every call here is wrapped.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { readAll } from '../lib/rowCap';
import { TruncatedRead } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import type { TakenRow } from '../lib/coachMoney';
import {
  periodBoundsIso,
  type PayoutKnowledge, type StatementCharge, type StatementInput,
  type StatementInvoice, type StatementPeriod, type StatementSession,
} from '../lib/coachStatement';
// The coach's own name, read once for the whole app. Reusing it rather than
// writing a second `profiles.full_name` read is what stops the statement and
// the invoice disagreeing about who issued them.
import { fetchInvoiceIssuer } from './coachInvoices';

/** Rows per request. Below PostgREST's own ceiling so a page is never itself
 *  truncated by the server before `readAll` can measure it. */
const PAGE = 500;

/**
 * A read that finished, and how far it can be trusted.
 *
 * A `TruncatedRead` is 'partial' rather than 'error' because the two are
 * different sentences to a coach: one says the record is bigger than this app
 * will read in one go, the other says the read was refused. Both withhold every
 * figure, which is the part that matters.
 */
async function paged<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ status: LoadStatus; rows: T[] }> {
  try {
    return { status: 'ready', rows: await readAll(page, what, { pageSize: PAGE }) };
  } catch (e) {
    reportError('coachStatement.' + what, e);
    return { status: e instanceof TruncatedRead ? 'partial' : 'error', rows: [] };
  }
}

/** The coach's Connect account, which is four columns and nothing about a
 *  payout. Its own read and its own status. */
export async function fetchPayoutKnowledge(uid: string): Promise<PayoutKnowledge> {
  const none: PayoutKnowledge = { status: 'error', hasAccount: false, chargesEnabled: false, detailsSubmitted: false };
  try {
    const { data, error } = await supabase
      .from('connect_accounts')
      .select('stripe_account_id, charges_enabled, details_submitted')
      .eq('trainer_id', uid)
      .limit(1);
    if (error) { reportError('coachStatement.payouts', error); return none; }
    const row = (data ?? [])[0] as { stripe_account_id: string | null; charges_enabled: boolean; details_submitted: boolean } | undefined;
    // No row is a real answer — a coach who has never onboarded has none — and
    // it is 'ready', not 'error'. "You have not connected an account" and "this
    // could not be read" are different sentences about somebody's money.
    return {
      status: 'ready',
      hasAccount: !!row?.stripe_account_id,
      chargesEnabled: !!row?.charges_enabled,
      detailsSubmitted: !!row?.details_submitted,
    };
  } catch (e) {
    reportError('coachStatement.payouts', e);
    return none;
  }
}

/**
 * Everything the statement is built from, for one period.
 *
 * The period bounds come from `periodBoundsIso` so the rows the server returns
 * and the rows the pure module would have accepted cannot disagree — a second
 * filter with a different rule would either drop rows already handed over or,
 * worse, keep rows outside the period it prints at the top.
 */
export async function fetchStatementInput(period: StatementPeriod, brand: string | null): Promise<StatementInput> {
  const generatedAt = new Date().toISOString();
  const bounds = periodBoundsIso(period);

  const nothing = (status: LoadStatus): StatementInput => ({
    period,
    issuer: { status, name: null, brand },
    sessions: { status, rows: [] },
    packs: { status, rows: [] },
    subscriptions: { status, rows: [] },
    invoices: { status, rows: [] },
    lateCancellations: { status, rows: [] },
    payouts: { status, hasAccount: false, chargesEnabled: false, detailsSubmitted: false },
    generatedAt,
  });

  // A build with no server is not a coach whose record is empty. It is a build
  // that cannot answer, and it says so through the same statuses.
  if (!USE_SUPABASE || !bounds) return nothing('error');

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return nothing('error');

  const [issuer, sessions, packs, subs, invoices, fees, payouts] = await Promise.all([
    fetchInvoiceIssuer(),

    // Sessions. Counted, never priced — `rate_cents` is a gym payroll rate and
    // is deliberately not selected, so nothing downstream can be tempted by it.
    paged<StatementSession>('your sessions in this period', (f, t) => supabase
      .from('sessions')
      .select('starts_at, outcome')
      .eq('trainer_id', uid)
      .gte('starts_at', bounds.fromIso)
      .lt('starts_at', bounds.toIso)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: StatementSession[] | null; error: unknown }>),

    // One-off sales. `client_purchases.currency` is the SESSION's own currency
    // since part 132; older rows carry whatever the backfill could recover, and
    // null where the package it came from is gone. A null stays null — it is
    // counted out of the total by `sumTaken` and named, never guessed at.
    paged<TakenRow>('your pack and membership sales in this period', (f, t) => supabase
      .from('client_purchases')
      .select('amount_cents, currency, created_at')
      .eq('trainer_id', uid)
      .gte('created_at', bounds.fromIso)
      .lt('created_at', bounds.toIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: TakenRow[] | null; error: unknown }>),

    fetchRenewals(uid, bounds.fromIso, bounds.toIso),

    // `issued_on` is a Postgres `date` and is compared as a calendar day, both
    // here and in `splitByDay`. Comparing it as an instant would put an invoice
    // issued on the first of the period outside the period, for every coach
    // west of Greenwich.
    paged<unknown>('your invoices in this period', (f, t) => supabase
      .from('coach_invoices')
      .select('seq, bill_to, description, amount_cents, currency, kind, issued_on, voided_at')
      .gte('issued_on', period.from)
      .lte('issued_on', period.to)
      .order('issued_on', { ascending: true })
      .order('seq', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: unknown[] | null; error: unknown }>)
      .then((r) => ({ status: r.status, rows: (r.rows as any[]).map(toInvoice) })),

    // `charges_trainer_rw` already scopes these to the coach's own clients, so
    // there is no trainer column to filter on and none exists. `amount` is
    // numeric and holds MAJOR units — the one place on this statement that does.
    paged<unknown>('the late-cancellation fees recorded for your clients', (f, t) => supabase
      .from('charges')
      .select('amount, currency, created_at, waived_at')
      .eq('reason', 'late_cancellation')
      .gte('created_at', bounds.fromIso)
      .lt('created_at', bounds.toIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: unknown[] | null; error: unknown }>)
      .then((r) => ({ status: r.status, rows: (r.rows as any[]).map(toCharge) })),

    fetchPayoutKnowledge(uid),
  ]);

  return {
    period,
    issuer: { status: issuer.status, name: issuer.name, brand },
    sessions,
    packs,
    subscriptions: subs,
    invoices,
    lateCancellations: fees,
    payouts,
    generatedAt,
  };
}

/**
 * Paid renewals, plus the ones this app cannot date.
 *
 * `paid_at` is when the money moved and is what a period must be measured on —
 * a webhook retried three days late must not land somebody's payment in the
 * wrong month. It is also NULLABLE, and a server filter on a range silently
 * excludes every null: a renewal this app was told about but never given a date
 * for would vanish from every statement of every period, and from every count
 * of what is missing.
 *
 * So the undated rows are read too and handed to the pure module with their
 * empty date intact. `splitByPeriod` puts them in no period and counts them,
 * and the statement says how many there were.
 */
async function fetchRenewals(uid: string, fromIso: string, toIso: string): Promise<{ status: LoadStatus; rows: TakenRow[] }> {
  const what = 'your subscription renewals in this period';
  const [inRange, undated] = await Promise.all([
    paged<{ amount_cents: number | null; currency: string | null; paid_at: string | null }>(what, (f, t) => supabase
      .from('client_subscription_payments')
      .select('amount_cents, currency, paid_at')
      .eq('trainer_id', uid)
      .gte('paid_at', fromIso)
      .lt('paid_at', toIso)
      .order('paid_at', { ascending: true })
      .order('id', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>),
    paged<{ amount_cents: number | null; currency: string | null; paid_at: string | null }>(what, (f, t) => supabase
      .from('client_subscription_payments')
      .select('amount_cents, currency, paid_at')
      .eq('trainer_id', uid)
      .is('paid_at', null)
      .order('id', { ascending: true })
      .range(f, t) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>),
  ]);

  // Either half failing means no figure. A total over the dated rows alone,
  // with the undated ones unread and therefore uncounted, is a total that
  // looks whole and is short by an unknown amount.
  const status: LoadStatus = inRange.status === 'ready' && undated.status === 'ready'
    ? 'ready'
    : (inRange.status === 'error' || undated.status === 'error') ? 'error' : 'partial';

  const rows: TakenRow[] = [...inRange.rows, ...undated.rows].map((r) => ({
    amount_cents: toInt(r.amount_cents),
    currency: (r.currency || '').trim() || null,
    // An empty string will not parse, which is what keeps an undated renewal
    // out of every period rather than sweeping it into this one.
    created_at: r.paid_at ?? '',
  }));
  return { status, rows };
}

/** PostgREST hands a bigint back as a STRING, so a value above 2^53 could
 *  survive JSON. Left alone, `"48000"` fails `Number.isFinite` downstream and
 *  an invoice with an amount prints as a hole. */
function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInvoice(r: any): StatementInvoice {
  return {
    seq: Number(r.seq) || 0,
    billTo: r.bill_to ?? '',
    description: r.description ?? '',
    amountCents: toInt(r.amount_cents),
    currency: (r.currency || '').trim() || null,
    // Anything that is not one of the two stored values is read as 'requested',
    // which is the claim that asserts less. The column has a CHECK on it so this
    // is unreachable; if a later migration widens it, the safe reading is the
    // one that does not report money as received.
    kind: r.kind === 'received' ? 'received' : 'requested',
    issuedOn: String(r.issued_on ?? '').slice(0, 10),
    voidedAt: r.voided_at ?? null,
  };
}

function toCharge(r: any): StatementCharge {
  return {
    // `charges.amount` is numeric and arrives as a string for the same reason a
    // bigint does. MAJOR units — 25 means twenty-five pounds, not twenty-five
    // pence — and it is never mixed with the minor-unit amounts elsewhere.
    amount: r.amount == null ? null : (Number.isFinite(Number(r.amount)) ? Number(r.amount) : null),
    currency: (r.currency || '').trim() || null,
    createdAt: r.created_at ?? '',
    waivedAt: r.waived_at ?? null,
  };
}
