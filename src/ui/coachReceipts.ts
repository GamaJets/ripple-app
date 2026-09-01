// The reads and writes behind the payments a coach takes outside this app.
// What one MEANS is src/lib/coachReceipts.ts, which is pure and tested; nothing
// here decides that.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Every call here reads
// `.error`, and it matters more than usual: this list IS the half of a coach's
// income Stripe never saw, so an empty one rendered confidently tells a
// self-employed person that the cash they took last week is not on record.
//
// ── Zero rows written is not an error, and not a success either ────────────
//
// PostgREST reports no error for an INSERT that RLS refused — it comes back 201
// with an empty body. `writeFailure` is what turns that into a sentence, the
// same discipline `deactivatePackage` and `updatePackage` keep in
// src/lib/connect.ts, and it is why the insert asks for the row back.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { draftMinorUnits } from '../lib/coachInvoice';
import { receiptBlockers, type CoachReceipt, type ReceiptDraft } from '../lib/coachReceipts';

const RECEIPT_COLS = 'id, client_id, paid_by, amount_cents, currency, method, received_on, note, created_at';

interface ReceiptRow {
  id: string;
  client_id: string | null;
  paid_by: string;
  amount_cents: number | string | null;
  currency: string | null;
  method: string;
  received_on: string;
  note: string | null;
  created_at: string | null;
}

/**
 * A row as the rest of the app wants it.
 *
 * `amount_cents` is a bigint and PostgREST hands bigints back as STRINGS, so a
 * value above 2^53 could survive JSON. Left alone, `"48000"` fails
 * `Number.isFinite` inside `sumTaken` and a real payment is counted as an
 * amount that could not be read — which on this screen means a coach's cash
 * book silently shrinks.
 */
function toReceipt(r: ReceiptRow): CoachReceipt {
  const raw = r.amount_cents;
  const amount = raw == null ? null : Number(raw);
  return {
    id: r.id,
    clientId: r.client_id ?? null,
    paidBy: r.paid_by ?? '',
    amountCents: amount != null && Number.isFinite(amount) ? amount : null,
    currency: (r.currency || '').trim() || null,
    method: String(r.method ?? ''),
    // A `date` column arrives as a bare `YYYY-MM-DD` and stays one. It means a
    // DAY; turning it into a Date here would move a Monday payment to Sunday
    // for every coach west of Greenwich.
    receivedOn: String(r.received_on ?? '').slice(0, 10),
    note: r.note ?? null,
    createdAt: r.created_at ?? null,
  };
}

/**
 * Every payment this coach has recorded by hand, newest first.
 *
 * `status` is what stops an empty list being read two ways. Under 'error' the
 * list is UNKNOWN, and the screen says so rather than telling a coach they have
 * recorded nothing when the read was refused.
 *
 * No `.eq('coach_id', uid)`: `coach_receipts_owner_read` is `coach_id =
 * auth.uid()` and there is no other read policy on the table, so the filter
 * would be a second copy of a rule that already holds. Ordered on
 * `received_on` AND `id`, because two payments recorded for the same day tie
 * otherwise and a tie is not an order a page boundary can be drawn on.
 */
export async function fetchMyReceipts(): Promise<{ rows: CoachReceipt[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('coach_receipts')
      .select(RECEIPT_COLS)
      .order('received_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('coachReceipts.list', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as unknown as ReceiptRow[]);
    return { rows: page.rows.map(toReceipt), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachReceipts.list', e);
    return { rows: [], status: 'error' };
  }
}

export interface RecordResult { ok: boolean; receipt?: CoachReceipt; error?: string }

/**
 * Record one.
 *
 * The blockers are re-checked HERE and not only on the screen, so the figure
 * that was validated and the figure that is sent cannot differ — and so a
 * caller added later cannot skip the payroll guard by not rendering the button
 * that carries it. `receiptBlockers` refuses a payment from the coach to
 * themselves; part 190 refuses the same row with a CHECK constraint. Both, on
 * purpose: the screen explains it, the database enforces it.
 *
 * The amount is converted to minor units by the same tested function the
 * invoice sheet uses. A coach typing "45,50" into two money fields in this app
 * must not get two different amounts out.
 */
export async function recordReceipt(draft: ReceiptDraft): Promise<RecordResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server, so nothing can be recorded.' };
  const problems = receiptBlockers(draft);
  if (problems.length) return { ok: false, error: problems[0] };
  const currency = (draft.currency || '').trim().toUpperCase();
  const minor = draftMinorUnits(draft.amountText, currency);
  if (minor == null) return { ok: false, error: 'That amount could not be read as money.' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ok: false, error: 'Not signed in.' };
    const { data, error } = await supabase
      .from('coach_receipts')
      .insert({
        coach_id: uid,
        client_id: draft.clientId ?? null,
        paid_by: draft.paidBy.trim(),
        amount_cents: minor,
        currency,
        method: draft.method,
        received_on: draft.receivedOn,
        note: (draft.note || '').trim() || null,
      })
      .select(RECEIPT_COLS);
    if (error) {
      reportError('coachReceipts.record', error);
      return { ok: false, error: error.message || 'That payment was not recorded.' };
    }
    // Nothing back means nothing was written, whatever the absence of an error
    // suggests — a policy that refused the row comes back 201 with an empty
    // body, and a coach told their cash is on record when it is not will not
    // record it again.
    const row = ((data ?? []) as unknown as ReceiptRow[])[0];
    if (!row?.id) return { ok: false, error: 'That payment was not recorded — nothing came back from the server.' };
    return { ok: true, receipt: toReceipt(row) };
  } catch (e) {
    reportError('coachReceipts.record', e);
    return { ok: false, error: 'That payment was not recorded.' };
  }
}

/**
 * Remove one, and say whether it actually went.
 *
 * Counted rather than trusted. A DELETE that matched no row comes back with
 * `error` null and no body — the same PostgREST behaviour `deactivatePackage`
 * documents — so a stale id would be reported as a successful removal and the
 * line would still be in the coach's totals after the list refreshed.
 *
 * Delete rather than edit, and delete rather than void, for the reason part 190
 * gives: nothing was ever handed to anybody, so a mistyped private ledger line
 * is a mistake to remove rather than a document to cancel.
 */
export async function deleteReceipt(id: string): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const r = await supabase.from('coach_receipts').delete({ count: 'exact' }).eq('id', id);
    if (r.error) { reportError('coachReceipts.delete', r.error); return false; }
    return (r.count ?? 0) > 0;
  } catch (e) {
    reportError('coachReceipts.delete', e);
    return false;
  }
}
