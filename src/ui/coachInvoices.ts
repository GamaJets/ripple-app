// The reads and writes behind a coach's invoices. The document itself is
// src/lib/coachInvoice.ts, which is pure and tested; nothing here decides what
// an invoice says.
//
// ── Everything goes through part 138's two functions ───────────────────────
//
// `coach_invoices` grants SELECT and nothing else: no INSERT, no UPDATE, no
// DELETE, and no policy for any of them. The number has to be allocated under
// a lock to stay gapless per coach, and an issued document cannot be edited
// once somebody is holding a copy of it — neither of which a client-side write
// could promise. So there are exactly two writes in this file and both are
// `rpc`, and the read below is the only place the table is touched directly.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Every call here reads
// `.error`, and every one of them matters more than usual: an invoice list that
// silently comes back empty tells a self-employed trainer they have issued
// nothing, which is a statement about their own business records.
//
// ── Zero rows is not an error, and not a success either ────────────────────
//
// PostgREST reports no error for a WHERE that matched nothing. Both writes are
// therefore functions that RAISE rather than updates that return a count — see
// void_coach_invoice() in part 138, which raises when it updates no row. What
// reaches this file is an error message a coach can read.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { draftMinorUnits, type CoachInvoice, type InvoiceDraft, type InvoiceKind } from '../lib/coachInvoice';

/** Every column the document needs and nothing else. */
const INVOICE_COLS =
  'id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, note, voided_at, void_reason, created_at';

interface InvoiceRow {
  id: string;
  seq: number;
  client_id: string | null;
  bill_to: string;
  description: string;
  amount_cents: number | string | null;
  currency: string | null;
  kind: string;
  issued_on: string;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string | null;
}

/**
 * A row as the document builder wants it.
 *
 * `amount_cents` is a bigint, and PostgREST hands bigints back as STRINGS
 * rather than numbers — a value above 2^53 could not survive JSON otherwise.
 * Left alone, `"48000"` would flow into `minorMoney`, fail `Number.isFinite`,
 * and print a dash on an invoice that has an amount. It is converted here, once
 * — and a value that will not convert becomes null rather than NaN, so the
 * document takes its "no amount could be stated" branch and says so out loud.
 */
function toInvoice(r: InvoiceRow): CoachInvoice {
  const raw = r.amount_cents;
  const amount = raw == null ? null : Number(raw);
  return {
    id: r.id,
    seq: Number(r.seq),
    billTo: r.bill_to ?? '',
    description: r.description ?? '',
    amountCents: amount != null && Number.isFinite(amount) ? amount : null,
    currency: (r.currency || '').trim() || null,
    // Anything that is not one of the two stored values is treated as
    // 'requested', which is the claim that asserts less. The column has a CHECK
    // on it so this is unreachable; if a later migration widens it, the safe
    // reading is the one that does not tell a client they have already paid.
    kind: (r.kind === 'received' ? 'received' : 'requested') as InvoiceKind,
    issuedOn: String(r.issued_on ?? '').slice(0, 10),
    note: r.note ?? null,
    voidedAt: r.voided_at ?? null,
    voidReason: r.void_reason ?? null,
    clientId: r.client_id ?? null,
    createdAt: r.created_at ?? null,
  };
}

/* ── the book ─────────────────────────────────────────────────────────────── */

/**
 * Every invoice this coach has issued, newest number first.
 *
 * `status` is what stops an empty list being read two ways. Under 'error' the
 * list is UNKNOWN, and the screen says so rather than "you have not issued any
 * invoices" to somebody who has issued forty.
 */
export async function fetchMyInvoices(): Promise<{ rows: CoachInvoice[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('coach_invoices')
      .select(INVOICE_COLS)
      // The sequence, not the date. Two invoices issued on the same day have
      // the same `issued_on`, and a coach looking for "the one after 0031"
      // needs them in the order they were numbered.
      .order('seq', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('coachInvoices.list', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as unknown as InvoiceRow[]);
    return { rows: page.rows.map(toInvoice), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachInvoices.list', e);
    return { rows: [], status: 'error' };
  }
}

/* ── who is issuing ───────────────────────────────────────────────────────── */

/**
 * The coach's own name, for the From line.
 *
 * Its own read and its own status because it fails independently of the
 * invoices, and because printing the platform's name where a business name
 * should be would put the wrong entity on a financial document. The document
 * builder takes this status and prints the failure.
 */
export async function fetchInvoiceIssuer(): Promise<{ name: string | null; status: LoadStatus }> {
  if (!USE_SUPABASE) return { name: null, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { name: null, status: 'error' };
    const { data, error } = await supabase.from('profiles').select('full_name').eq('id', uid).limit(1);
    if (error) { reportError('coachInvoices.issuer', error); return { name: null, status: 'error' }; }
    const rows = (data ?? []) as { full_name: string | null }[];
    // No row is a real answer — an account with no profile has no name — and it
    // is 'ready', not 'error'. The document then says "has not recorded a name"
    // rather than "could not be read", which are different sentences.
    return { name: (rows[0]?.full_name || '').trim() || null, status: 'ready' };
  } catch (e) {
    reportError('coachInvoices.issuer', e);
    return { name: null, status: 'error' };
  }
}

/* ── the currency, which is never assumed ─────────────────────────────────── */

/** Where a currency came from, so the screen can say. */
export type CurrencySource = 'packages' | 'gym';

export interface InvoiceCurrency {
  /** ISO 4217 uppercase, or null when nobody has stated one. Null is NOT a
   *  reason to fall back — it is the reason the Issue button is disabled and
   *  the coach is asked. */
  currency: string | null;
  source: CurrencySource | null;
  status: LoadStatus;
}

/**
 * The currency this coach's invoices are denominated in.
 *
 * Resolved in the same order as `issue_coach_invoice()` resolves it in part
 * 138 — the coach's own packages when they unanimously agree on one, else the
 * gym's `tenants.currency` — so the screen shows the coach exactly what the
 * server will use, rather than a second opinion that could differ from it.
 *
 * Packages first, deliberately. A coach who sells in sterling inside a gym
 * denominated in dirhams is selling in sterling; the gym's setting is the
 * fallback for a coach who has priced nothing yet.
 *
 * There is NO literal fallback anywhere in this function. tenants.currency is
 * nullable on purpose (part 99) and null means "this gym has not told us" — and
 * an invoice with the wrong three letters on it is worse than no invoice,
 * because it reads as a considered figure and it is a different amount of
 * money.
 */
export async function fetchInvoiceCurrency(): Promise<InvoiceCurrency> {
  if (!USE_SUPABASE) return { currency: null, source: null, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { currency: null, source: null, status: 'error' };

    const [pkgRes, gymRes] = await Promise.all([
      supabase.from('trainer_packages').select('currency').eq('trainer_id', uid).limit(capLimit()),
      supabase.from('trainers').select('tenant_id, tenants(currency)').eq('id', uid).limit(1),
    ]);

    if (pkgRes.error) reportError('coachInvoices.currency.packages', pkgRes.error);
    if (gymRes.error) reportError('coachInvoices.currency.gym', gymRes.error);
    // Both halves failing is genuinely unknown. One failing still leaves the
    // other able to answer, and an answer from one is a real answer.
    if (pkgRes.error && gymRes.error) return { currency: null, source: null, status: 'error' };

    if (!pkgRes.error) {
      const codes = new Set(
        ((pkgRes.data ?? []) as { currency: string | null }[])
          .map((p) => (p.currency || '').trim().toUpperCase())
          .filter((c) => c.length >= 3),
      );
      // Unanimous or nothing. A coach with packages in two currencies has not
      // told us which one this invoice is in, and picking the commoner of the
      // two would be a guess wearing a statistic.
      if (codes.size === 1) return { currency: [...codes][0], source: 'packages', status: 'ready' };
    }

    if (!gymRes.error) {
      const rows = (gymRes.data ?? []) as { tenants?: { currency: string | null } | { currency: string | null }[] | null }[];
      const t = rows[0]?.tenants;
      const cur = (Array.isArray(t) ? t[0]?.currency : t?.currency) || '';
      const code = cur.trim().toUpperCase();
      if (code.length >= 3) return { currency: code, source: 'gym', status: 'ready' };
    }

    // Read fine, and nobody has set one. That is an answer, and it is the
    // answer the screen turns into "ask your gym owner to set a currency".
    return { currency: null, source: null, status: pkgRes.error || gymRes.error ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachInvoices.currency', e);
    return { currency: null, source: null, status: 'error' };
  }
}

/* ── issuing ──────────────────────────────────────────────────────────────── */

export interface IssueResult { ok: boolean; invoice?: CoachInvoice; error?: string }

/**
 * Issue one, through the function that allocates the number.
 *
 * The amount is converted to minor units HERE, once, by the same tested
 * function the screen uses to decide whether the Issue button is live — so the
 * figure that is checked and the figure that is sent cannot differ.
 *
 * `clientId` is passed only for a client with a real account. A person the
 * coach typed into their book by hand has no `clients` row, and part 138
 * refuses an id that is not one of the coach's own — so sending one would turn
 * a perfectly ordinary invoice into a refusal.
 */
export async function issueInvoice(draft: InvoiceDraft, clientId?: string | null): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server, so nothing can be issued.' };
  const minor = draftMinorUnits(draft.amountText, draft.currency);
  if (minor == null) return { ok: false, error: 'That amount could not be read as money.' };
  const currency = (draft.currency || '').trim().toUpperCase();
  if (!currency) {
    return { ok: false, error: 'No currency has been set, so there is nothing to price this in. An owner sets it in the gym settings.' };
  }
  try {
    const { data, error } = await supabase.rpc('issue_coach_invoice', {
      p_bill_to: draft.billTo.trim(),
      p_description: draft.description.trim(),
      p_amount_cents: minor,
      p_issued_on: draft.issuedOn,
      p_kind: draft.kind,
      p_client_id: clientId ?? null,
      p_currency: currency,
      p_note: (draft.note || '').trim() || null,
    });
    if (error) {
      reportError('coachInvoices.issue', error);
      return { ok: false, error: error.message || 'That invoice was not issued.' };
    }
    // The function returns the row it inserted. Nothing came back means nothing
    // was written, whatever the absence of an error suggests.
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That invoice was not issued — nothing came back from the server.' };
    return { ok: true, invoice: toInvoice(row) };
  } catch (e) {
    reportError('coachInvoices.issue', e);
    return { ok: false, error: 'That invoice was not issued.' };
  }
}

/**
 * Void one, once, with a reason.
 *
 * The row stays and the number stays spent — a deleted invoice leaves a hole in
 * a sequence the coach will one day have to explain, and a voided one explains
 * itself. Part 138 raises rather than updating nothing, so "that is not yours"
 * and "it was already voided" arrive here as messages rather than as a silent
 * success over zero rows.
 */
export async function voidInvoice(id: string, reason: string): Promise<IssueResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server.' };
  if (!reason.trim()) return { ok: false, error: 'Say why it is being voided.' };
  try {
    const { data, error } = await supabase.rpc('void_coach_invoice', { p_id: id, p_reason: reason.trim() });
    if (error) {
      reportError('coachInvoices.void', error);
      return { ok: false, error: error.message || 'That invoice was not voided.' };
    }
    const row = (Array.isArray(data) ? data[0] : data) as InvoiceRow | null;
    if (!row?.id) return { ok: false, error: 'That invoice was not voided — nothing came back from the server.' };
    return { ok: true, invoice: toInvoice(row) };
  } catch (e) {
    reportError('coachInvoices.void', e);
    return { ok: false, error: 'That invoice was not voided.' };
  }
}
