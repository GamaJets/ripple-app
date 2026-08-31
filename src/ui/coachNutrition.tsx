// Coach nutrition adjustments — a trainer's tweak to a client's macro targets
// (calorie + protein deltas + note). Persists to Supabase `coach_nutrition`
// (coach writes; client reads own) with a defensive in-memory fallback.
//
// `get()` returning null means "no coach adjustment", and the client's macro
// targets are then computed from the generic formula. When the read below failed
// it returned null for the same reason it returns null for an unadjusted client,
// so a client whose coach had cut them 400 kcal was quietly handed the
// uncorrected targets and ate to them. `status` is how a screen tells the two
// apart before presenting a number as their coach's instruction.
//
// The write was worse than fire-and-forget: it was a nested pair of writes where
// the SECOND (carbs, fat, meal override) only ran inside the first's success
// handler, and neither read `error`. A coach could adjust a client's macros,
// watch the screen confirm it, and have nothing reach the client at all.
//
// ── The plan ────────────────────────────────────────────────────────────────
//
// `plan` (part 133) is the week of meals the coach composed, on the same row as
// the deltas it is composed against. It supersedes `mealOverride`, which said
// the same thing for a single day with no weekday attached to it, and which is
// still read here so that a plan written by an older build is not lost — see
// the note on setPlan.
//
// It is PARSED on the way in rather than handed on as raw jsonb, so that no
// screen has to remember to validate it and no two screens can validate it
// differently. `parsePlan` returning null means the column held nothing this
// build understands; `status` is still what says whether it was read at all.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CoachAdjust } from '../lib/nutrition';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { parsePlan, type CoachMealPlan } from '../lib/mealPlan';
import { reportError } from '../lib/reportError';
import { writeFailure } from '../lib/wroteRows';

export interface NutritionAdjust extends CoachAdjust {
  note?: string;
  /** SUPERSEDED by `plan`. One day's meals, position → catalogue index, with no
   *  weekday attached. Kept because a coach may have written one before part
   *  133, and a client following it should not lose it. */
  mealOverride?: Record<number, number>;
  /** The week the coach composed, already parsed. Undefined means the row was
   *  never read; null means it was read and holds no plan this build knows. */
  plan?: CoachMealPlan | null;
}

interface CoachNutritionValue {
  get: (clientId: string) => NutritionAdjust | null;
  /** Whether the adjustments were read from the server. Under 'error' a null
   *  from get() means unknown, and the generic targets must not be presented
   *  as the coach's plan. */
  status: LoadStatus;
  /** Resolves true only when the adjustment reached the server, where the
   *  client's app will read it. False means the coach changed nothing for them. */
  setAdjust: (clientId: string, patch: Partial<NutritionAdjust>) => Promise<boolean>;
  /** Resolves true only when the adjustment was actually removed server-side. */
  clear: (clientId: string) => Promise<boolean>;
  /** Send a composed week to the client. Resolves true only when the server
   *  confirmed a row — a PostgREST write that matched nothing resolves with no
   *  error at all, so the returned row is the only proof it landed. */
  setPlan: (clientId: string, plan: CoachMealPlan) => Promise<boolean>;
}

const Ctx = createContext<CoachNutritionValue | null>(null);

export function CoachNutritionProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [map, setMap] = useState<Record<string, NutritionAdjust>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // `const { data } = …` — `error` was not even named, so a refused read
        // was indistinguishable from a client with no adjustment.
        // One row per client for a coach, so this is the roster read wearing a
        // different table, and it needs the same ceiling. A client whose
        // adjustment falls off the end is not shown as unadjusted-and-unknown;
        // `get()` returns null and every macro screen quietly serves them the
        // unmodified target their coach deliberately changed.
        const { data, error } = await supabase.from('coach_nutrition').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          .order('client_id', { ascending: true }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        const m: Record<string, NutritionAdjust> = {};
        for (const r of page.rows as any[]) m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined, mealOverride: r.meal_override ?? undefined, plan: parsePlan(r.plan) };
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); /* stay in-memory, but say so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const get = (clientId: string) => map[clientId] ?? null;
  const setAdjust = async (clientId: string, patch: Partial<NutritionAdjust>): Promise<boolean> => {
    const merged: NutritionAdjust = { kcalDelta: 0, proteinDelta: 0, carbDelta: 0, fatDelta: 0, ...(map[clientId] ?? {}), ...patch };
    setMap((m) => ({ ...m, [clientId]: merged }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('coach_nutrition').upsert({ client_id: clientId, coach_id: uid, kcal_delta: merged.kcalDelta, protein_delta: merged.proteinDelta, note: merged.note ?? null }, { onConflict: 'client_id' });
      if (error) return false;
      // The second write is still separate (these columns were added out of
      // band), but it is now awaited and checked rather than fired from inside
      // the first one's success callback. A half-applied adjustment — calories
      // cut but the carb split unchanged — is not something to report as done.
      // Counted, like the delete above and for the same reason: this half of
      // the adjustment is a bare `.eq('client_id', …)` with no coach_id on it,
      // so it is the policy alone that decides, and a refusal is 204 with no
      // error. Reporting it done is precisely the half-applied adjustment the
      // paragraph above refuses to report.
      const mr = await supabase.from('coach_nutrition')
        .update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0, meal_override: merged.mealOverride ?? null }, { count: 'exact' })
        .eq('client_id', clientId);
      const why = writeFailure('That adjustment', mr);
      if (why) { reportError('coachNutrition.setAdjust', new Error(why), { clientId }); return false; }
      return true;
    } catch { return false; }
  };
  /**
   * Take the adjustment off entirely.
   *
   * The count, not `error`, for the reason `setPlan` below already gives — and
   * this one decides what somebody EATS. `coach_nutrition_coach_rw` is
   * `coach_id = auth.uid() AND is_my_client(client_id)`, and there is one row
   * per client, so a client who has changed coach carries the previous coach's
   * row: their new coach cannot delete it and, on `!error`, was told they had.
   * The client goes on eating to a 400 kcal cut that no coach believes is still
   * set. Proved live against phgfwzpkkwdysftlgkoq — 0 rows, no error, for the
   * new coach; 1 row for the coach who wrote it.
   */
  const clear = async (clientId: string): Promise<boolean> => {
    setMap((m) => { const n = { ...m }; delete n[clientId]; return n; });
    if (!USE_SUPABASE || !uid) return false;
    try {
      const r = await supabase.from('coach_nutrition').delete({ count: 'exact' }).eq('client_id', clientId);
      const why = writeFailure('That adjustment', r);
      if (why) { reportError('coachNutrition.clear', new Error(why), { clientId }); return false; }
      return true;
    } catch { return false; }
  };

  /**
   * Send the week.
   *
   * `meal_override` is cleared in the SAME statement, and that is deliberate
   * rather than tidy-minded. It says the same thing as the plan for a single
   * day with no weekday on it, and leaving both would give the client's Meals
   * tab two coach-authored answers for the same slot with nothing to arbitrate
   * between them. Nothing is lost by clearing it: the coach screen seeds the
   * week it is about to send FROM the client's current plan, overrides
   * included, so any meal the coach had pinned is already inside `plan` by the
   * time this runs.
   *
   * The row is asked for back. `.upsert().eq()`-shaped writes in PostgREST
   * resolve with `error: null` and no rows when a policy matched nothing, so a
   * coach whose relationship had ended would otherwise watch this succeed and
   * send nothing.
   */
  const setPlan = async (clientId: string, plan: CoachMealPlan): Promise<boolean> => {
    setMap((m) => ({ ...m, [clientId]: { kcalDelta: 0, proteinDelta: 0, carbDelta: 0, fatDelta: 0, ...(m[clientId] ?? {}), plan, mealOverride: undefined } }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('coach_nutrition')
        .upsert({ client_id: clientId, coach_id: uid, plan, meal_override: null }, { onConflict: 'client_id' })
        .select('client_id');
      if (error) { reportError('coachNutrition.setPlan', error, { clientId }); return false; }
      if (!data || data.length === 0) {
        reportError('coachNutrition.setPlan', new Error('plan upsert returned no row'), { clientId });
        return false;
      }
      return true;
    } catch (e) { reportError('coachNutrition.setPlan', e, { clientId }); return false; }
  };

  return <Ctx.Provider value={{ get, status, setAdjust, clear, setPlan }}>{children}</Ctx.Provider>;
}

export function useCoachNutrition(): CoachNutritionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachNutrition must be used inside <CoachNutritionProvider>');
  return v;
}
