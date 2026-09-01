// The caller `supabase/functions/owner-metrics` never had.
//
// ── What was wrong ────────────────────────────────────────────────────────
//
// The function is deployed, runs with the service role, is tenant-scoped by
// hand in every query (part 39 closed a cross-gym leak in it that had let any
// owner account read every other gym's member names, trainer roster, billing
// revenue and named activity feed), and was invoked by NOTHING. Not by the
// console, not by the phone apps, not by a script. docs/OWNER-PORTAL.md names
// it under "two things not to repeat": "A deployed function nobody calls is a
// trap for the next person reading the code."
//
// A trap in two directions, in fact. Somebody maintaining the schema has no way
// to know the function depends on a column; somebody adding a feature has no
// way to know a correct implementation of it is already deployed.
//
// ── What it is used for here, and what it is deliberately not ─────────────
//
// The Overview page computes almost everything from its own queries, through
// the same row-level policies as the phone app, and that is right: a figure
// traceable to a row a person can go and look at beats a figure from an
// aggregate endpoint every time.
//
// The exceptions are the engagement counts — how many members trained at all in
// thirty days, how many workouts, how many scans. Each needs a paged read
// across `workouts` or `scans` joined through the person's profile, and a
// browser doing that hits PostgREST's 1000-row ceiling and silently reports a
// fraction. The function pages properly with `.range()`, and — the reason it is
// worth calling rather than reimplementing — it DROPS a metric it could not
// compute whole rather than returning a short one.
//
// Everything else the function returns (its cohort matrix, its named recent
// activity, its at-risk list) is deliberately not used. The console answers
// those questions from its own reads on /analytics and /retention, over
// `memberships` and the door log rather than over `workouts`, and two screens
// answering "who is at risk" from two different definitions is how a product
// ends up with two retention numbers.
//
// ── `live` is the contract ────────────────────────────────────────────────
//
// The function returns `{ ok, metrics, series, live }` and `live` is the list of
// keys that came from real data. A metric absent from it is UNKNOWN, and the
// caller's job is to render a dash. Reading `metrics[key] ?? 0` would undo the
// whole design — the function's own header records that the portal used to fall
// back to SAMPLE data for class fill and showed an owner invented attendance
// for their own timetable with nothing marking it as invented.
import { supabase } from './supabase';

export interface OwnerMetrics {
  ok: boolean;
  /** Every metric the function computed. A key here is only trustworthy if it
   *  also appears in `live` — see the header. */
  metrics: Record<string, number | null>;
  /** The keys that came from real data. The whole contract. */
  live: string[];
  /** The function's own words when it refused. Null on success. */
  error: string | null;
}

/**
 * Ask the function.
 *
 * `null` for a call that did not complete — never `{ ok: true }` with empty
 * metrics, which would render as a gym where nobody has trained in a month.
 *
 * The Authorization header is added by supabase-js from the current session, so
 * the function identifies the caller from their own JWT and authorises them
 * against `profiles.role` and their tenant. Nothing here passes a tenant id and
 * nothing could: the function reads it from the caller's own profile, which is
 * what makes "does this caller own THIS gym" answerable at all.
 */
export async function fetchOwnerMetrics(): Promise<OwnerMetrics | null> {
  try {
    const { data, error } = await supabase.functions.invoke('owner-metrics');
    if (error) return null;
    const d = data as any;
    if (!d || typeof d !== 'object') return null;
    if (d.ok !== true) {
      // The function's refusals are readable sentences — "Owner access only",
      // "This owner account is not attached to a gym" — and they are worth more
      // to the person reading the screen than "could not load". Carried through
      // rather than flattened.
      return { ok: false, metrics: {}, live: [], error: typeof d.error === 'string' ? d.error : null };
    }
    const metrics: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(d.metrics ?? {})) {
      metrics[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return {
      ok: true,
      metrics,
      live: Array.isArray(d.live) ? d.live.filter((x: unknown): x is string => typeof x === 'string') : [],
      error: null,
    };
  } catch {
    return null;
  }
}
