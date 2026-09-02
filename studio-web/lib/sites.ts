// Which gyms this account owns, asked of the database.
//
// One RPC and nothing else. `my_sites()` (supabase/parts/290) is SECURITY
// DEFINER and returns `[{ id, name, current }]` — the ids and names of the gyms
// the caller is recorded as owning, with `current` marking the one this session
// can actually READ.
//
// ── Why not select from `owner_sites` directly ────────────────────────────
//
// Because the table holds uuids and the console needs names, and the names are
// behind `tenants_read`, which is `id = my_tenant()` (part 38) and correctly
// scoped to one gym. The fix for a name behind a policy is a function that
// returns the name, not a policy that returns the row: a permissive policy on
// `tenants` wide enough for this would hand over brand, plan, session fee and
// currency as well, for a question that needs two fields.
//
// ── What this read does NOT mean ──────────────────────────────────────────
//
// A second entry in the list is NOT a second gym this console can open. Part
// 290 changed no policy, so every read on every screen is still scoped to the
// one tenant on the profile. The whole point of the `current` flag is that the
// console can say which one it is showing rather than implying it can show any
// of them. The copy for all of that is in src/lib/ownedSites.ts.
import { supabase } from './supabase';
import { sitesFrom, type SiteScope } from '@lib/ownedSites';

/**
 * The site list, with a status on it.
 *
 * 'error' carries an EMPTY list and that means UNKNOWN — never "this account
 * owns no gyms". Everything downstream branches on the status rather than on
 * the length, which is what stops a refused RPC from telling a two-site
 * operator that their business is one gym.
 *
 * There is no 'partial': `my_sites()` returns a single jsonb value, so there is
 * no row cap to hit. `sitesFrom` still handles it, because a future caller that
 * folds this into a paginated read should not be the one to discover that.
 */
export async function fetchOwnedSites(): Promise<SiteScope> {
  const { data, error } = await supabase.rpc('my_sites');
  if (error) return sitesFrom(null, 'error');
  return sitesFrom(data, 'ready');
}
