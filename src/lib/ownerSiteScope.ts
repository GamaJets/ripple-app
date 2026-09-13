// Which of an owner's gyms the PHONE is showing — and whether there are others.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `supabase/parts/290` added `owner_sites` and `my_sites()`, and
// src/lib/ownedSites.ts is the tested vocabulary for reading them. Both shipped
// wired into studio-web only: `studio-web/components/Shell.tsx` calls
// `my_sites()` once per page load and the console's rail says "1 of 3 sites".
//
// The owner's PHONE said nothing. `src/ui/tenant.tsx` reads exactly one row
// (`.eq('id', tid).maybeSingle()`), every figure on Financials, Revenue, Growth,
// Ops and Rota is that one gym's, and nothing on any of those screens
// distinguished an owner of one gym from an owner of four looking at one of
// them. That is the precise sentence ownedSites.ts's own header objects to: "a
// console that quietly showed one gym's numbers to somebody who owns two would
// be telling them their business is smaller than it is." It was true of the web
// console once. It stayed true of the phone.
//
// ── Why this is a read and not a picker ────────────────────────────────────
//
// Part 290 changed no policy. An owner recorded against two gyms can READ one
// of them — the one `current` marks — and can see the other's name and nothing
// else. So there is nothing to switch TO, and a picker would be a control that
// cannot work. What is missing is not navigation, it is the sentence saying
// what the figures on screen do and do not cover. `siteNotice` is that
// sentence, it already exists, and it is already tested.
//
// ── What renders for whom ──────────────────────────────────────────────────
//
// Nothing, for almost everybody. `owner_sites` ships empty and `my_sites()`
// returns the profile's own tenant either way, so an ordinary owner gets a
// one-element list and `siteNotice` returns null — asserted in
// ownedSites.test.ts. The screens below render nothing at all in that case, so
// a single-site owner's phone is unchanged.
//
// A failed read is the case worth having. It returns status 'error', and
// `siteNotice` then says so rather than going quiet, because a multi-site owner
// and a single-site owner are indistinguishable under a failed read and the
// difference is what every figure on the screen means.

import { sitesFrom, type SiteScope } from './ownedSites';

/** The minimum of the supabase client this needs, so a test can hand it one. */
export interface SitesRpc {
  rpc(fn: 'my_sites', params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/**
 * `my_sites()` → the scope vocabulary, with a failed read kept as a failed read.
 *
 * Deliberately the same three lines as `fetchOwnedSites` in
 * studio-web/lib/sites.ts. Duplicated rather than shared because the two
 * runtimes hold different supabase clients and the shared half — the part with
 * every judgement in it — is `sitesFrom`, which both call and neither copies.
 *
 * There is no catch that turns a refusal into an empty list. `sitesFrom(null,
 * 'error')` is a scope whose site count is NULL, not zero, and every consumer
 * of it branches on null. An empty list here would be this app telling somebody
 * their business is one gym on the strength of an RPC that did not answer.
 */
export async function fetchOwnerSites(sb: SitesRpc): Promise<SiteScope> {
  try {
    const { data, error } = await sb.rpc('my_sites');
    if (error) return sitesFrom(null, 'error');
    return sitesFrom(data, 'ready');
  } catch {
    // A thrown client (offline, an aborted fetch) is the same fact as a
    // returned error: the question was not answered.
    return sitesFrom(null, 'error');
  }
}

/** The scope a screen holds before the read comes back. Not an empty list of
 *  sites — a list that has not been read. */
export const SITES_LOADING: SiteScope = { status: 'loading', sites: [] };
