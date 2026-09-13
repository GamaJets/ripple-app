// The read behind "last heard from Stripe". What the answer MEANS is
// src/lib/stripeHeartbeat.ts, which is pure and tested; nothing here decides it.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.rpc(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. `.error` is read here,
// and on this particular read it matters more than most: the whole feature is
// telling "Stripe has never reached this app" apart from "nobody has bought
// anything", and a failed call silently treated as an empty answer would
// manufacture a third wrong sentence out of the two it exists to separate.
//
// ── A row that did not come back is not a row of noughts ───────────────────
//
// `stripe_last_heard()` aggregates, so it answers exactly one row even over an
// empty ledger: `{ last_at: null, events: 0 }`. That row IS the "never heard"
// fact. No row at all is a different thing entirely — a function that is not
// deployed, or a grant that refused — and it comes back as 'error' rather than
// being read as a silent webhook.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import type { StripeHeard } from '../lib/stripeHeartbeat';

interface HeardRow {
  last_at: string | null;
  /** `count(*)` is a bigint and PostgREST hands bigints back as STRINGS. Left
   *  as `number | string | null` here and coerced once below, because
   *  `Number.isFinite('3')` is false and a perfectly good count of three would
   *  have been reported as one that could not be read. */
  events: number | string | null;
}

/**
 * When this deployment last completed a Stripe webhook, and how many it has
 * completed in all.
 *
 * `status` is what stops a missing answer being read as a fact. Under 'error'
 * the heartbeat is UNKNOWN and `stripePulse` refuses to say anything about it;
 * under 'ready' a null instant is the real, actionable answer.
 *
 * A build with no server behind it is 'error' and not 'ready': USE_SUPABASE
 * false means there is no webhook, no Stripe and nothing that could have been
 * heard from, so 'ready' there would put "this app has never heard from Stripe"
 * on a screen where the sentence is meaningless rather than alarming.
 */
export async function fetchStripeHeard(): Promise<{ heard: StripeHeard | null; status: LoadStatus }> {
  if (!USE_SUPABASE) return { heard: null, status: 'error' };
  try {
    const { data, error } = await supabase.rpc('stripe_last_heard');
    if (error) { reportError('stripeHeartbeat.read', error); return { heard: null, status: 'error' }; }
    // `returns table` comes back as an array of rows. One row is the contract;
    // none of them means the call answered nothing, which is not the same as
    // answering "nothing has happened".
    const row = (Array.isArray(data) ? data : [data])[0] as HeardRow | undefined;
    if (!row) return { heard: null, status: 'error' };
    const n = row.events == null ? null : Number(row.events);
    return {
      heard: {
        at: (row.last_at || '').trim() || null,
        events: n != null && Number.isFinite(n) ? n : null,
      },
      status: 'ready',
    };
  } catch (e) {
    reportError('stripeHeartbeat.read', e);
    return { heard: null, status: 'error' };
  }
}
