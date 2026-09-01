// The one read behind what actually landed in a coach's bank. What the rows
// MEAN is src/lib/coachPayouts.ts, which is pure and tested.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. It matters here for the
// usual reason and one extra: an empty list on this screen is ALREADY ambiguous
// — it may mean the Connect webhook destination has not been subscribed to
// `payout.*` — so collapsing a failed read into it would stack a second unknown
// on top of a first, and the coach would be told something confident about
// their own bank account that nothing behind it supports.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import type { CoachPayout } from '../lib/coachPayouts';

const PAYOUT_COLS = 'id, amount_cents, currency, status, arrival_on, failure_message';

interface PayoutRow {
  id: string;
  amount_cents: number | string | null;
  currency: string | null;
  status: string | null;
  arrival_on: string | null;
  failure_message: string | null;
}

/**
 * Payouts Stripe has told this app about, newest arrival first.
 *
 * No `.eq('coach_id', uid)`: `coach_payouts_owner_read` is `coach_id =
 * auth.uid()` and there is no other read policy on the table, so a filter would
 * be a second copy of a rule that already holds.
 *
 * Ordered on `arrival_on` AND `id`, because two payouts can share an arrival
 * date and a tie is not an order a page boundary can be drawn on.
 */
export async function fetchMyPayouts(): Promise<{ rows: CoachPayout[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('coach_payouts')
      .select(PAYOUT_COLS)
      .order('arrival_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('coachPayouts.list', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as unknown as PayoutRow[]);
    const rows: CoachPayout[] = page.rows.map((r) => {
      // PostgREST hands a bigint back as a STRING so a value above 2^53 can
      // survive JSON. Left alone, `"428100"` fails `Number.isFinite` inside
      // `sumTaken` and a real payout is counted as one with no amount on it —
      // which on this screen means a coach's bank total silently shrinks.
      const raw = r.amount_cents;
      const amount = raw == null ? null : Number(raw);
      return {
        id: r.id,
        amountCents: amount != null && Number.isFinite(amount) ? amount : null,
        currency: (r.currency || '').trim() || null,
        // Stripe's word, verbatim. Never coerced here and never coerced in the
        // pure module either — a status this app does not recognise reads as
        // "not stated" rather than as "paid".
        status: String(r.status ?? ''),
        // A `date` column arrives as a bare `YYYY-MM-DD` and stays one.
        arrivalOn: (r.arrival_on || '').slice(0, 10) || null,
        failureMessage: r.failure_message ?? null,
      };
    });
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('coachPayouts.list', e);
    return { rows: [], status: 'error' };
  }
}
