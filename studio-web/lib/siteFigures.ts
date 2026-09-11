// The figures behind the roll-up, asked of the database.
//
// One RPC, joined to `my_sites()`. `owner_site_figures()` (supabase/parts/2614)
// is SECURITY DEFINER and returns one row of AGGREGATES per gym this account is
// recorded as owning — never a member, a session or a payment, so nothing it
// hands back names a person.
//
// ── Why both reads and not one ────────────────────────────────────────────
//
// `owner_site_figures` knows the numbers. `my_sites()` knows which gym this
// SESSION can actually read, and that flag is not a number — it is the
// difference between "here are this gym's totals" and "you are looking at the
// gym every other screen in this console is already showing". src/lib/siteRollUp
// `drillInto` gives those two states different sentences, and it can only do
// that if `current` arrives.
//
// ── What `refused` means here, which is narrower than it used to ─────────
//
// Before part 2614 a second gym had NO figures at all: part 290 changed no
// policy, so an owner recorded against two gyms could read one. That is the
// state `SiteGap`'s 'refused' was written for.
//
// It is no longer the ordinary case. The figures now come back for every
// recorded gym, so `refused` is set only when `my_sites()` lists a gym that
// `owner_site_figures` returned no row for — which should not happen, and if it
// does, the honest reading is that this gym's totals are not on this sign-in
// rather than that the gym is empty. Keeping the flag is what stops a missing
// row rendering as a gym with nothing in it.
import { supabase } from '@/lib/supabase';
import { fetchOwnedSites } from '@/lib/sites';
import type { SiteFigures } from '@lib/siteRollUp';

/** The house load vocabulary, taken from the contract that already carries it
 *  rather than re-imported. `loadStatus` lives in `src/ui`, which the console's
 *  `@lib/*` alias (→ `src/lib`) does not reach, and widening that alias to
 *  smuggle one type across would put the phone app's UI folder on the console's
 *  import surface for the rest of time. */
type LoadStatus = SiteFigures['status'];

export interface SiteFiguresRead {
  status: LoadStatus;
  sites: SiteFigures[];
}

/** A row as the RPC returns it. Every figure nullable, because every one of
 *  them is a thing the record may not be able to say. */
interface Row {
  site_id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  active_members: number | null;
  coaches: number | null;
  taken_cents: number | null;
  taken_currencies: string[] | null;
  taken_unstated: boolean | null;
}

/**
 * Every owned gym's figures for a window.
 *
 * `since`/`until` are ISO and either may be null, which the function reads as
 * an open end. Null cents is NOT nought and is carried through as null: a till
 * nobody rang up and a till that took nothing are the same number and different
 * facts, and `gapOf` in siteRollUp is what tells them apart.
 */
export async function fetchSiteFigures(since: string | null, until: string | null): Promise<SiteFiguresRead> {
  const [scope, res] = await Promise.all([
    fetchOwnedSites(),
    supabase.rpc('owner_site_figures', { since, until }),
  ]);

  // A failed RPC is UNKNOWN, and an empty list under it would say this account
  // owns no gyms — which a failed read has established nothing about. The
  // status carries it and every caller branches on the status.
  if (res.error) return { status: 'error', sites: [] };

  const rows = (res.data ?? []) as Row[];
  const byId = new Map(rows.map((r) => [r.site_id, r]));

  // `my_sites()` is the roster. Driving the list from IT rather than from the
  // figures is what lets a gym with no row appear as one whose totals are
  // missing, instead of vanishing from a list of the owner's own business.
  const sites: SiteFigures[] = scope.sites.map((s) => {
    const r = byId.get(s.id);
    return {
      siteId: s.id,
      // The figures row's name and `my_sites()`'s name are the same column read
      // twice; preferring the roster's keeps one source for what a gym is called.
      name: s.name ?? r?.name ?? null,
      current: s.current,
      refused: !r,
      status: scope.status,
      currency: r?.currency ?? null,
      timezone: r?.timezone ?? null,
      activeMembers: r?.active_members ?? null,
      trainers: r?.coaches ?? null,
      taken: {
        cents: r?.taken_cents ?? null,
        currencies: r?.taken_currencies ?? [],
        unstated: Boolean(r?.taken_unstated),
      },
    };
  });

  return { status: scope.status, sites };
}
