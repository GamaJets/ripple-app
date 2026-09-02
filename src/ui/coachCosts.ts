// The reads and writes behind what a coach's own business costs them. What a
// row MEANS is src/lib/coachCosts.ts, which is pure and tested; nothing here
// decides that, and nothing anywhere subtracts it from anything.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Every call here reads
// `.error`, and it matters for the same reason it does on the way in: an empty
// list rendered confidently tells a coach that the rent they paid last week is
// not on record, when what happened is that the query was refused.
//
// ── Zero rows written is not an error, and not a success either ────────────
//
// PostgREST reports no error for an INSERT that RLS refused — it comes back 201
// with an empty body. The insert therefore asks for the row back and treats an
// empty answer as a failure, the same discipline `recordReceipt` keeps.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { draftMinorUnits } from '../lib/coachInvoice';
import { costBlockers, type CoachCost, type CostDraft } from '../lib/coachCosts';

const COST_COLS = 'id, description, category, amount_cents, currency, paid_on, note, created_at';

interface CostRow {
  id: string;
  description: string;
  category: string;
  amount_cents: number | string | null;
  currency: string | null;
  paid_on: string;
  note: string | null;
  created_at: string | null;
}

/**
 * A row as the rest of the app wants it.
 *
 * `amount_cents` is a bigint and PostgREST hands bigints back as STRINGS, so a
 * value above 2^53 could survive JSON. Left alone, `"48000"` fails
 * `Number.isFinite` inside `sumTaken` and a real cost is counted as an amount
 * that could not be read.
 */
function toCost(r: CostRow): CoachCost {
  const raw = r.amount_cents;
  const amount = raw == null ? null : Number(raw);
  return {
    id: r.id,
    description: r.description ?? '',
    category: String(r.category ?? ''),
    amountCents: amount != null && Number.isFinite(amount) ? amount : null,
    currency: (r.currency || '').trim() || null,
    // A `date` column arrives as a bare `YYYY-MM-DD` and stays one. It means a
    // DAY; turning it into a Date here would move a Monday payment to Sunday
    // for every coach west of Greenwich.
    paidOn: String(r.paid_on ?? '').slice(0, 10),
    note: r.note ?? null,
    createdAt: r.created_at ?? null,
  };
}

/**
 * Every cost this coach has recorded, newest first.
 *
 * `status` is what stops an empty list being read two ways. Under 'error' the
 * list is UNKNOWN, and the screen says so rather than telling a coach they have
 * recorded nothing when the read was refused.
 *
 * No `.eq('coach_id', uid)`: `coach_costs_owner_read` is `coach_id =
 * auth.uid()` and there is no other read policy on the table, so the filter
 * would be a second copy of a rule that already holds. Ordered on `paid_on` AND
 * `id`, because two costs recorded for the same day tie otherwise and a tie is
 * not an order a page boundary can be drawn on.
 */
export async function fetchMyCosts(): Promise<{ rows: CoachCost[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('coach_costs')
      .select(COST_COLS)
      .order('paid_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('coachCosts.list', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as unknown as CostRow[]);
    return { rows: page.rows.map(toCost), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachCosts.list', e);
    return { rows: [], status: 'error' };
  }
}

export interface RecordCostResult { ok: boolean; cost?: CoachCost; error?: string }

/**
 * Record one.
 *
 * The blockers are re-checked HERE and not only on the screen, so the figure
 * that was validated and the figure that is sent cannot differ, and so a caller
 * added later cannot skip them by not rendering the sheet that carries them.
 *
 * The amount goes through the same tested reader the invoice and receipt sheets
 * use. A coach typing "12.500" into two money fields in this app must not get
 * two different amounts out, and it is that reader which knows a dinar has a
 * thousand fils in it rather than a hundred.
 */
export async function recordCost(draft: CostDraft): Promise<RecordCostResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build is not connected to a server, so nothing can be recorded.' };
  const problems = costBlockers(draft);
  if (problems.length) return { ok: false, error: problems[0] };
  const currency = (draft.currency || '').trim().toUpperCase();
  const minor = draftMinorUnits(draft.amountText, currency);
  if (minor == null) return { ok: false, error: 'That amount could not be read as money.' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ok: false, error: 'Not signed in.' };
    const { data, error } = await supabase
      .from('coach_costs')
      .insert({
        coach_id: uid,
        description: draft.description.trim(),
        category: draft.category,
        amount_cents: minor,
        currency,
        paid_on: draft.paidOn,
        note: (draft.note || '').trim() || null,
      })
      .select(COST_COLS);
    if (error) {
      reportError('coachCosts.record', error);
      return { ok: false, error: error.message || 'That cost was not recorded.' };
    }
    // Nothing back means nothing was written, whatever the absence of an error
    // suggests — a policy that refused the row comes back 201 with an empty
    // body, and a coach told their rent is on record when it is not will not
    // record it again.
    const row = ((data ?? []) as unknown as CostRow[])[0];
    if (!row?.id) return { ok: false, error: 'That cost was not recorded — nothing came back from the server.' };
    return { ok: true, cost: toCost(row) };
  } catch (e) {
    reportError('coachCosts.record', e);
    return { ok: false, error: 'That cost was not recorded.' };
  }
}

/**
 * Remove one, and say whether it actually went.
 *
 * Counted rather than trusted. A DELETE that matched no row comes back with
 * `error` null and no body, so a stale id would be reported as a successful
 * removal and the line would still be in the coach's figures after the list
 * refreshed.
 *
 * Delete rather than edit, for the reason part 450 gives: nothing was handed to
 * anybody and no document was made, so a mistyped private ledger line is a
 * mistake to remove rather than a record to amend.
 */
export async function deleteCost(id: string): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const r = await supabase.from('coach_costs').delete({ count: 'exact' }).eq('id', id);
    if (r.error) { reportError('coachCosts.delete', r.error); return false; }
    return (r.count ?? 0) > 0;
  } catch (e) {
    reportError('coachCosts.delete', e);
    return false;
  }
}
