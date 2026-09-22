// The two reads behind the coach's view of their gym's kit register.
//
// The impure half of src/lib/coachKit.ts, which holds every decision about what
// an empty answer means. Same split as coachPayTerms: that file imports nothing
// and is run by `npm test`; this one reaches Supabase and therefore cannot be.
//
// ── What is read ──────────────────────────────────────────────────────────
//
//   · `gym_equipment`, through `fetchEquipment` in src/lib/gymEquipment.ts.
//     Readable by this coach since supabase/parts/34 — `gym_equipment_staff_r`
//     is `tenant_id = my_tenant() and my_role() in ('trainer', 'owner')` — and
//     nothing in the coach app had ever selected it. The `.eq('tenant_id', …)`
//     inside that reader restates the policy rather than trusting it, which is
//     the house form: a read scoped only by RLS is a read whose correctness
//     lives in another file.
//
//     It pages through `readAll` and THROWS on a page that failed, so there is
//     no shape in which a prefix of the register reaches the view believing it
//     is the whole thing. That is why this hook has no 'partial': the register
//     either arrives complete or it does not arrive.
//
//   · the gym's timezone, through `fetchGymZone`. Every service date on
//     `gym_equipment` is a `date` column somebody entered as the GYM's day, so
//     comparing it against the phone's day marks a rower overdue a day early —
//     or, worse, still in service on the morning it was due. This product sells
//     into UTC+4, where that window is four hours wide twice a day.
//     studio-web/app/equipment/page.tsx carries the same fix and the same
//     reasoning; this is that decision, made the same way, on the phone.
//
// ── Why the zone failing does not take the register down ──────────────────
//
// A gym with no zone set, and a zone read that failed, both fall back to the
// reader's own day — which is what every screen in this app did before the zone
// existed at all, and what the owner's console still does. The alternative is
// withholding a register that arrived intact over a question about a service
// deadline being a day out, and a coach who cannot see that four rowers are
// broken is worse off than one who sees a due date shifted by a day. The
// fallback is visible rather than silent: `gymDayKnown` says which day this is,
// so the screen can name it rather than implying the gym's calendar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fetchEquipment, type Equipment } from '../lib/gymEquipment';
import { fetchGymZone, gymDay } from '../lib/gymZone';
import { coachKitView, type CoachKitView } from '../lib/coachKit';
import type { GymLink } from '../lib/coachPayTerms';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useToday } from './today';
import { useAuthRevision } from './authRevision';

export interface MyGymKit {
  /** The worse of the register read and the tenant read it hangs off. */
  status: LoadStatus;
  /** The whole section, already decided. Never rows a caller has to interpret. */
  view: CoachKitView;
  /** The day every service deadline here was compared against. */
  today: string;
  /** Whether `today` is the GYM's calendar day. False means it is the reader's,
   *  because the gym has set no zone or the zone could not be read — and a
   *  screen naming a due date should say so rather than imply the gym's. */
  gymDayKnown: boolean;
  refresh: () => void;
}

/**
 * The gym's equipment register, read-only, as the coach programming around it
 * needs to see it.
 *
 * Costs no reads at all for the account with no gym, which is every coach live
 * on this product today: there is no tenant to scope a register to, and
 * `coachKitView` answers 'no_gym' from the link before it looks at a row.
 */
export function useMyGymKit(): MyGymKit {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  const readerToday = useToday();
  const [items, setItems] = useState<Equipment[] | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown', which is what stops "your account is not linked to a
  // gym" being said to an employed coach whose profile read timed out — and,
  // just as bad on this screen, stops the gym-less sentence standing in for a
  // register nobody has managed to read yet.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  const load = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE) { setReadStatus('ready'); return; }
    // Nothing to read and nothing unknown: with no gym there is no register
    // that could exist. 'ready' is the honest status for a question that has an
    // answer without asking — and the view it produces is a sentence, not an
    // empty list.
    if (!tenantId) {
      setItems(null); setZone(null);
      setReadStatus(tenantStatus === 'ready' ? 'ready' : 'loading');
      return;
    }
    setReadStatus('loading');
    try {
      const [kit, z] = await Promise.all([
        fetchEquipment(supabase, tenantId),
        fetchGymZone(supabase, tenantId),
      ]);
      if (cancelled()) return;
      // `fetchGymZone` reports its failure in `error` and its "no zone set" as a
      // null with no error, and those must not collapse: both end in the
      // reader's day here, but only one of them is worth reporting, and a
      // screen that told an owner to go and set a timezone they had already set
      // is the defect that function's header is about.
      if (z.error) reportError('coachKit.zone', z.error);
      setZone(z.zone);
      setItems(kit);
      setReadStatus('ready');
    } catch (e) {
      // `fetchEquipment` throws on a refused page and on a register past the
      // page ceiling. Either way nothing about this gym's kit may be stated,
      // and an empty register is emphatically not what happened.
      reportError('coachKit.load', e);
      if (!cancelled()) { setItems(null); setReadStatus('error'); }
    }
  }, [tenantId, tenantStatus]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The register is only as trustworthy as the tenant read that decided whether
  // there is a gym at all — the same fold `useMyPayTerms` performs and for the
  // same reason.
  const status = worstStatus(tenantStatus, readStatus);
  const gymToday = gymDay(Date.now(), zone);
  const today = gymToday ?? readerToday;

  return useMemo<MyGymKit>(() => ({
    status,
    view: coachKitView(link, status, items, today),
    today,
    gymDayKnown: gymToday != null,
    refresh,
  }), [status, link, items, today, gymToday, refresh]);
}
