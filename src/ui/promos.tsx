// Promo codes a gym offers, and who has actually used one.
//
// ── What was here before ───────────────────────────────────────────────────
//
// `useState`. Nothing else. A code created on the Growth screen lived in React
// memory for the life of the process: close the app and it was gone, and no
// other device — including the owner's own second phone — ever saw it. The
// header said "Swap for a Supabase promo_codes table in the migration"; the
// table (`promos`) had existed since part 02 the whole time, unread and
// unwritten by anything.
//
// It also carried a `redeemed` number that no code path anywhere incremented.
// The screens print it again now, from rows rather than from that column —
// what was missing was never the number but the EVENT: nothing recorded that a person had used a code, so the one
// question an owner runs a promotion to answer — did it bring anybody in —
// could not be asked.
//
// ── What it does now ───────────────────────────────────────────────────────
//
// Codes persist to `promos`, scoped to the gym by `is_owner_of(tenant_id)`.
// Redemptions are ROWS in `promo_redemptions`, one per member per code, so the
// count is derived and the owner can see who and when. The count is never
// maintained by `update … set n = n + 1`: that loses writes under concurrency,
// and it is exactly the shape this codebase has a standing rule against.
//
// LoadStatus applies. An empty list means "this gym has no codes" only under
// 'ready'; under 'error' it means the read did not answer, and the Growth
// screen must not offer to create the first code to somebody who may already
// have six.
//
// ── The duplicate check, which was checking the wrong list the wrong way ───
//
// `addPromo` refused a code already present in `promos` and reported that as
// "this code is free" when it found nothing. It is the same LoadStatus mistake
// one level in: under 'error' that array is the last successful read or
// nothing, under 'partial' it is the first page, so a miss meant "not in the
// part we hold" and was returned as though it meant "not in use". It also
// compared raw stored text against an upper-cased input, so a stored `Summer`
// did not match a typed `SUMMER` — while `redeem_promo` (part 104) matches a
// member's typing on `upper(btrim(code))` and hands those two rows to the same
// person.
//
// Both are fixed below, and the return type now carries `duplicatesChecked` so
// a caller cannot mistake "we looked and it is free" for "we could not look".
// Creating is still allowed when the check could not run: a gym that cannot
// read its codes is not thereby forbidden from making one.
//
// The half that could not be fixed from here is the half that matters most,
// and it is not in TypeScript. `promos` had no unique constraint on the code at
// all, so two rows could hold one code and `redeem_promo`'s `limit 1` — with no
// `order by` — picked between them arbitrarily. supabase/parts/3190 adds
// `promos_code_per_tenant`, unique on `(tenant_id, upper(btrim(code)))`, which
// is the same key this file and `redeem_promo` compare on. Until that part is
// applied, the 23505 branch in `addPromo` is unreachable and the check above is
// the only one there is.
import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { readCappedByIds } from '../lib/cappedByIds';
import { useAuthRevision } from './authRevision';
import { useTenant } from './tenant';
import type { LoadStatus } from './loadStatus';

export interface Promo {
  id: string;
  code: string;
  discountPct: number;
  /** Rows in promo_redemptions. Derived, never a stored counter. */
  redeemed: number;
  active: boolean;
}

/**
 * What `addPromo` answers, and the reason it is no longer just `{ ok, reason }`.
 *
 * The duplicate check `addPromo` runs is a check against `promos` — the array
 * THIS PROVIDER holds. Under 'error' that is whatever the last successful read
 * left behind, or nothing at all; under 'partial' it is the first `capLimit()`
 * page of a longer list. On both, a MISS means "not in the part we have", which
 * is not the same sentence as "not in use" — and the old signature had no way
 * to say which of the two it had established, so it said neither and the caller
 * was left to assume the stronger one.
 *
 * `duplicatesChecked` is that missing fact. `ok: true, duplicatesChecked: false`
 * is a code that was saved without anything having been able to look.
 */
export interface AddPromoResult {
  ok: boolean;
  /** Why not, when `ok` is false. */
  reason?: string;
  /**
   * True only when the answer above rests on the gym's WHOLE list of codes —
   * either because `status` was 'ready' when the check ran, or because the
   * database itself refused the insert as a duplicate. False means the code may
   * or may not already exist and nothing here knows which.
   */
  duplicatesChecked: boolean;
  /**
   * Set exactly when `duplicatesChecked` is false: one sentence naming the
   * check that did not happen, safe to show a gym owner verbatim.
   */
  caveat?: string;
}

interface PromosValue {
  promos: Promo[];
  /** Whether `promos` is what the server holds. An empty list under 'error'
   *  means unknown, not "no codes". */
  status: LoadStatus;
  /** Resolves once the code is on the server. `ok: false` carries the reason,
   *  and either answer carries whether the duplicate check actually ran. */
  addPromo: (code: string, discountPct: number) => Promise<AddPromoResult>;
  toggleActive: (id: string) => Promise<boolean>;
  removePromo: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PromosValue | null>(null);

export function PromosProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const { tenant, status: tenantStatus } = useTenant();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const tenantId = tenant?.id ?? null;

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    // `!tenantId` is three different things: still loading, no gym, and a
    // tenant read that FAILED. Returning early left `status` on 'loading'
    // forever for all three, so the Promotions screen span rather than
    // reporting — and this provider used to be in-memory, so the state never
    // existed to get wrong before tonight.
    //
    // The tenant provider already tells them apart. Inherit its answer instead
    // of inventing one.
    if (!tenantId) {
      setPromos([]);
      setStatus(tenantStatus === 'loading' ? 'loading' : tenantStatus === 'error' ? 'error' : 'ready');
      return;
    }
    const { data, error } = await supabase
      .from('promos')
      .select('id, code, discount, active')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(capLimit());
    if (error) { setStatus('error'); return; }
    const page = capped(data);
    const rows = page.rows as { id: string; code: string; discount: number; active: boolean | null }[];

    // Counted from rows, in one request rather than one per code. A code with
    // no redemptions simply has no rows, which is a 0 we can stand behind.
    let counts = new Map<string, number>();
    let countsKnown = true;
    if (rows.length) {
      // CHUNKED, and the limit is the REQUEST LINE rather than the row ceiling.
      // Promo codes accumulate per tenant and nothing deletes them, so `rows`
      // reaches the `capLimit()` ceiling of a thousand on a gym that has been
      // running a few years. At ~39 bytes per uuid inside a PostgREST
      // `in.("…","…")` list that is a ~39KB query string against the 8KB
      // request line nginx and most CDNs enforce by default, refused past
      // roughly two hundred ids with a 414 that supabase-js does not reject on
      // and that arrives as `data: null`.
      //
      // Which is why `rErr` was not enough on its own: a 414 leaves it null, so
      // the else branch ran over an empty set and every code rendered
      // `redeemed: 0` with `countsKnown` still true — the app stating, as fact,
      // that nobody has ever used any of this gym's codes. That is a number an
      // owner decides an ad budget on.
      //
      // `readCappedByIds`, because `countsKnown` is exactly the truncation flag
      // and a count off part of the rows must go to a dash rather than to a
      // smaller number.
      const red = await readCappedByIds<{ promo_id: string }>(
        rows.map((r) => r.id),
        (chunk) => supabase.from('promo_redemptions').select('promo_id')
          .in('promo_id', chunk).limit(capLimit()),
      );
      if (red.error) {
        // The codes are real and readable; only the counts are not. Reported
        // as 'partial' so the list shows and the figures render as a dash —
        // a 0 here would say "nobody used it", which is the opposite of
        // "we could not count".
        countsKnown = false;
      } else {
        if (red.truncated) countsKnown = false;
        for (const r of red.rows) {
          counts.set(r.promo_id, (counts.get(r.promo_id) ?? 0) + 1);
        }
      }
    }

    setPromos(rows.map((r) => ({
      id: String(r.id),
      code: r.code,
      discountPct: Number(r.discount) || 0,
      redeemed: countsKnown ? (counts.get(String(r.id)) ?? 0) : -1,
      active: !!r.active,
    })));
    setStatus(page.truncated || !countsKnown ? 'partial' : 'ready');
  }, [tenantId, tenantStatus]);

  useEffect(() => { void refresh(); }, [refresh, authRev]);

  const addPromo: PromosValue['addPromo'] = useCallback(async (code, discountPct) => {
    const c = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!c) return { ok: false, reason: 'Enter a code', duplicatesChecked: false };

    // ── the key, and why it is not `===` ─────────────────────────────────────
    //
    // This used to compare a stored `code` against `c` directly. `c` is already
    // upper-cased; the stored value is whatever was written. So a gym holding
    // `Summer` was told `SUMMER` was free — while `redeem_promo` (part 104)
    // matches a member's typing with `upper(btrim(code)) = upper(btrim($1))`
    // and considers those two THE SAME CODE. The one comparison in the product
    // that could have caught the collision was the only one not using the
    // collision's own definition of what a collision is.
    //
    // `trim().toUpperCase()` is `upper(btrim())`. Same rule, same three places:
    // here, in `redeem_promo`, and in the unique index added by
    // supabase/parts/3190 — which is what finally makes it true.
    const key = (s: string) => s.trim().toUpperCase();

    // A HIT is worth something under every status: these are rows the server
    // really sent, so a match is a code this gym really has — the list may be a
    // prefix or stale, but it is not invented. A MISS is the half that is only
    // worth something under 'ready'.
    if (promos.some((p) => key(p.code) === c)) {
      return {
        ok: false,
        duplicatesChecked: status === 'ready',
        reason: status === 'ready'
          ? `“${c}” is already one of this gym’s codes.`
          : `“${c}” is in the list of codes this screen last read. That list may be out of date. Pull down to read them again if you think this code was removed.`,
      };
    }

    // ── what the miss above did and did not establish ────────────────────────
    //
    // 'ready' is the only status under which `promos` is the gym's whole list.
    // Creating is still allowed on the others: a gym past the read ceiling
    // cannot make itself smaller, and a gym whose read failed is not thereby
    // forbidden from running a promotion. What changes is that the answer now
    // says so instead of implying a check it could not run.
    const duplicatesChecked = status === 'ready';
    const caveat = duplicatesChecked ? undefined
      : status === 'error'
        ? 'Your existing codes could not be read, so nothing checked whether this code was already in use.'
        : status === 'partial'
          ? 'Your existing codes did not all come back, so nothing could check the ones further down the list.'
          : 'Your existing codes had not finished loading, so nothing checked whether this code was already in use.';

    if (!USE_SUPABASE || !tenantId) return { ok: false, reason: 'No gym to attach this code to.', duplicatesChecked, caveat };
    const { error } = await supabase.from('promos').insert({
      tenant_id: tenantId, code: c, discount: Math.round(discountPct), active: true,
    });
    if (error) {
      // A code that exists at ANOTHER gym is fine — the index is per tenant.
      // One that exists at THIS one raises 23505 against
      // `promos_code_per_tenant` (supabase/parts/3190), and that is the only
      // duplicate check in this function that is true regardless of what the
      // provider managed to read. Reported as checked, because the database did
      // the checking.
      //
      // It says nothing until part 3190 is applied. Until then a duplicate
      // inserts successfully and `duplicatesChecked: false` above is the whole
      // of the honest answer.
      if ((error as { code?: string }).code === '23505') {
        return {
          ok: false,
          duplicatesChecked: true,
          reason: `“${c}” is already one of this gym’s codes. Codes match however they are typed, so this is the same code as an existing one even if the capitals differ.`,
        };
      }
      return { ok: false, reason: 'That code could not be saved. Try again in a moment.', duplicatesChecked, caveat };
    }
    await refresh();
    return { ok: true, duplicatesChecked, caveat };
  }, [promos, status, tenantId, refresh]);

  const toggleActive = useCallback(async (id: string): Promise<boolean> => {
    const cur = promos.find((p) => p.id === id);
    if (!cur || !USE_SUPABASE) return false;
    // An UPDATE matching zero rows is not an error in PostgREST, so the count
    // is what is checked — the recurring bug class in this codebase.
    const { error, count } = await supabase
      .from('promos').update({ active: !cur.active }, { count: 'exact' }).eq('id', id);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [promos, refresh]);

  const removePromo = useCallback(async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    const { error, count } = await supabase
      .from('promos').delete({ count: 'exact' }).eq('id', id);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [refresh]);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<PromosValue>(() => ({ promos, status, addPromo, toggleActive, removePromo, refresh }), [promos, status, addPromo, toggleActive, removePromo, refresh]);
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function usePromos(): PromosValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePromos must be used inside <PromosProvider>');
  return v;
}
