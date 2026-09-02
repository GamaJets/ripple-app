// The door log, narrowed to the visits a PASS paid for.
//
// ── Why this is a read of its own ──────────────────────────────────────────
//
// /passes asks one question of the door log and only one: when was each pass
// first used? `buildHolders` in src/lib/passConversion.ts indexes visits by
// `passId` to find the first entry per pass, and `redemptionVisits` counts the
// visits whose `passId` is one of this gym's passes. Every visit without a
// `pass_id` on it is read, held in memory and then discarded.
//
// The screen was reading the WHOLE log to do that — `fetchVisits(supabase,
// tenantId)` with no window at all — which is the one shape src/lib/gymVisits.ts
// still refuses outright, and rightly: dragging years of turnstile scans into a
// browser tab is not an improvement on saying no. So /passes threw for every
// gym past a thousand visits, which for a busy front desk is about a month, and
// the whole screen — pass income, the call list, the conversion figures — was
// permanently an error message.
//
// A date window was not the fix, and the page's own comment says why: a pass
// issued eighteen months ago and redeemed the week after is exactly the case
// this screen exists to find, and a rolling window would silently drop it and
// report the pass as never used. That is the failure mode this codebase treats
// as worse than refusing.
//
// The honest bound was in the question all along. `pass_id is not null` is a
// filter the database can apply, it loses nothing the screen was going to use,
// and it bounds the set by the number of pass REDEMPTIONS rather than by the
// number of people who walked through the door — a set that is smaller than the
// pass book itself, which /passes already reads whole through `fetchPasses`.
// Finished with `readAll` on top of that, so a gym whose passes are its main
// trade still gets the complete answer.
//
// ── The duplicated row mapping ─────────────────────────────────────────────
//
// `rowToVisit` is private to src/lib/gymVisits.ts, so the shape is built here
// instead. That is a real cost: a column added to `Visit` has to be added in
// two places. It is paid deliberately rather than by widening `fetchVisits`'s
// options, because the two reads answer different questions — that one is "who
// came in", this one is "which passes were spent" — and a `Visit` this file
// failed to keep up with would be caught by the compiler at the `Visit` return
// type rather than shipping as a silently missing field.

import { readAll } from './rowCap';
import type { Visit } from './gymVisits';

type Queryable = { from: (table: string) => any };

/**
 * Every visit this gym recorded that was paid for with a pass, oldest last.
 *
 * `readAll` requires a TOTAL order — one that cannot tie — because each page is
 * a separate HTTP request and Postgres promises nothing about the order of tied
 * rows. `entered_at` ties whenever two people scan in during the same second,
 * which at a front desk is most mornings, so `id` is ordered alongside it.
 *
 * Throws on a refused read and on a set past `PAGE_CEILING`, as every paged
 * read in this codebase does. /passes renders a thrown read as a stated failure
 * on the door-log section and leaves the rest of the page standing, which is
 * the point of it being a separate read.
 */
export async function fetchPassVisits(sb: Queryable, tenantId: string): Promise<Visit[]> {
  const rows = await readAll<any>(
    (from, to) => sb
      .from('gym_visits')
      .select('id, member_id, pass_id, class_id, entered_at, exited_at, source, note, profiles(full_name)')
      .eq('tenant_id', tenantId)
      // The whole reason this read is affordable. PostgREST spells "is not
      // null" as a negated `is` filter.
      .not('pass_id', 'is', null)
      .order('entered_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the pass redemptions in this gym’s door log',
  );
  return rows.map((r: any): Visit => {
    // PostgREST returns an embedded one-to-one as an object or a single-element
    // array depending on how it resolved the relationship, and both have been
    // seen from this table. Neither is an error; guessing one of them is.
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      id: r.id,
      memberId: r.member_id ?? null,
      memberName: p?.full_name ?? null,
      passId: r.pass_id ?? null,
      classId: r.class_id ?? null,
      enteredAt: r.entered_at,
      exitedAt: r.exited_at ?? null,
      source: r.source ?? 'desk',
      note: r.note ?? null,
    };
  });
}
