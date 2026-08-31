// Blood glucose: reading it, importing it, and who is allowed to see it.
//
// Two callers, one hook. The client app passes no `personId` and gets their
// own readings plus the controls that go with owning them (import, type one
// in, delete, and the consent switch). The coach app passes a client's id and
// gets a read-only view that returns NOTHING unless that client has turned
// sharing on — which is enforced in the database, not here (see
// supabase/parts/102-glucose.sql). This hook cannot grant itself access it does
// not have; at most it can fail to ask.
//
// LoadStatus discipline applies with unusual force here. An empty list means
// "no readings" only under 'ready'. Under 'error' it means the read did not
// answer, and a screen that renders those the same way tells somebody wearing a
// CGM that their sensor recorded nothing — which is the one thing they would
// actually act on.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { worstStatus, type LoadStatus } from './loadStatus';
import {
  pairMeals, summarise, unsaved,
  type GlucoseReading, type GlucoseSummary, type MealGlucose, type MealRef,
} from '../lib/glucose';

/** How far back the screens look, and how far back the import reads. */
export const WINDOW_DAYS = 14;

/** PostgREST stops at 1000 rows without saying so — see src/lib/rowCap.ts. */
const ROW_CAP = 1000;

export interface GlucoseData {
  status: LoadStatus;
  readings: GlucoseReading[];
  summary: GlucoseSummary;
  /** Whether this person's coach may see these. Null while unknown. */
  sharedWithCoach: boolean | null;
  /**
   * Each meal in the window with the readings around it.
   *
   * Only as trustworthy as BOTH reads — a meal list that failed would show
   * readings with nothing to attribute them to, which reads as "you ate
   * nothing and spiked anyway". `pairedStatus` is the worse of the two.
   */
  paired: MealGlucose[];
  pairedStatus: LoadStatus;
  /** Re-read from the server. */
  refresh: () => Promise<void>;
  /** Pull anything new out of Apple Health and store it. Own readings only. */
  importFromHealth: () => Promise<{ added: number; reason?: string }>;
  /** Store one reading somebody typed. mmol/L. */
  addManual: (mmol: number, at?: string) => Promise<boolean>;
  /** Remove one. Only the owner can, and the database agrees. */
  remove: (id: string) => Promise<boolean>;
  /** Turn coach visibility on or off. Owner only; a coach calling this is refused. */
  setShared: (on: boolean) => Promise<boolean>;
  /** True when this hook is looking at somebody else's readings. */
  readOnly: boolean;
}

interface Row {
  id: string;
  taken_at: string;
  mmol_l: number | string;
  external_id: string | null;
  source: string;
}

function toReading(r: Row): GlucoseReading {
  return {
    at: r.taken_at,
    mmol: Number(r.mmol_l),
    externalId: r.external_id,
    // The writing app's name is not stored — it is HealthKit's, not ours to
    // keep — so a stored reading says only whether it came from Health.
    sourceName: r.source === 'health' ? 'Apple Health' : null,
  };
}

/**
 * @param personId whose readings to read. Undefined means the signed-in
 *   account's own — which is the only case that may write.
 */
export function useGlucose(personId?: string): GlucoseData {
  const [uid, setUid] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [shared, setShared] = useState<boolean | null>(null);
  const [meals, setMeals] = useState<MealRef[]>([]);
  const [mealsStatus, setMealsStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const readOnly = !!personId;

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setUid(data?.user?.id ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const target = personId ?? uid;

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);
    const { data, error } = await supabase
      .from('glucose_readings')
      .select('id, taken_at, mmol_l, external_id, source')
      .eq('client_id', target)
      .gte('taken_at', since.toISOString())
      .order('taken_at', { ascending: false })
      .limit(ROW_CAP);

    if (error) {
      // The rows we already had are kept — they were real — but the status says
      // they are no longer confirmed current. It does NOT become an empty list.
      setStatus('error');
      return;
    }
    setRows((data ?? []) as Row[]);
    // A full page is indistinguishable from a truncated one, so it is reported
    // as partial: the list may be shown, an average over it may not.
    setStatus((data ?? []).length >= ROW_CAP ? 'partial' : 'ready');
  }, [target]);

  // The consent flag. Read for both callers, because the coach screen needs to
  // say "they have not shared this" rather than "there are no readings" — two
  // sentences that would otherwise be the same empty list.
  const refreshShared = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const { data, error } = await supabase
      .from('clients')
      .select('glucose_shared')
      .eq('id', target)
      .maybeSingle();
    // maybeSingle, not single: a coach reading their own row has none, and
    // PGRST116 on a missing row is what put the whole coach app into 'error'
    // once already.
    if (error) { setShared(null); return; }
    setShared(data ? !!data.glucose_shared : null);
  }, [target]);

  // The meals the readings are lined up against. The coach's copy of this read
  // is governed by `food_trainer_read`, which is NOT conditional on the glucose
  // consent — a coach has always been able to see their client's food log. The
  // consent gates the readings, and without readings the pairing shows meals
  // with nothing beside them, which is the correct outcome rather than a leak.
  const refreshMeals = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);
    const { data, error } = await supabase
      .from('food_logs')
      .select('id, name, logged_at, carbs')
      .eq('client_id', target)
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false })
      .limit(ROW_CAP);
    if (error) { setMealsStatus('error'); return; }
    setMeals((data ?? []).map((m: any) => ({
      id: String(m.id), name: String(m.name), loggedAt: String(m.logged_at),
      carbs: m.carbs == null ? null : Number(m.carbs),
    })));
    setMealsStatus((data ?? []).length >= ROW_CAP ? 'partial' : 'ready');
  }, [target]);

  useEffect(() => { void refresh(); void refreshShared(); void refreshMeals(); }, [refresh, refreshShared, refreshMeals]);

  const readings = useMemo(() => rows.map(toReading), [rows]);
  const summary = useMemo(() => summarise(readings), [readings]);
  const paired = useMemo(() => pairMeals(meals, readings), [meals, readings]);
  const pairedStatus = useMemo(() => worstStatus(status, mealsStatus), [status, mealsStatus]);

  const importFromHealth = useCallback(async (): Promise<{ added: number; reason?: string }> => {
    if (readOnly) return { added: 0, reason: 'These are not your readings to import.' };
    if (!target) return { added: 0, reason: 'Not signed in.' };
    if (Platform.OS !== 'ios') {
      // Said plainly rather than shown as a failure. Android reads glucose out
      // of Health Connect, which this build has no native module for — see
      // src/lib/wearables/cloudProvider.ts, where connect() says the same.
      return { added: 0, reason: 'Reading glucose from Health Connect needs an Android build that includes it. Not in this one yet.' };
    }
    let mod: typeof import('../lib/wearables/appleHealth');
    try {
      mod = require('../lib/wearables/appleHealth');
    } catch {
      return { added: 0, reason: 'Apple Health is not available in this build.' };
    }
    const read = await mod.fetchGlucose(WINDOW_DAYS);
    if (read.status !== 'ready') return { added: 0, reason: read.reason };

    const fresh = unsaved(read.readings, rows.map((r) => r.external_id).filter((x): x is string => !!x));
    if (fresh.length === 0) return { added: 0 };

    // `{ count: 'exact' }`, and the count is what is reported.
    //
    // This used to return `fresh.length` — the number of rows it TRIED to write
    // — and treat a 23505 as a partial success, on the reasoning that "the
    // colliding rows are already stored". That reasoning is wrong about
    // Postgres: an insert of many rows is ONE statement, so a single collision
    // with `glucose_external_once` aborts the whole batch and NOTHING lands.
    // The member was then shown "Imported — 40 readings added." over a table
    // that had gained nothing, and with `glucose_readings` empty an import is
    // the only way anything ever reaches this screen, so that alert was the
    // entire evidence they had. `remove` and `setSharedFlag` twenty lines below
    // have counted their rows since they were written; this was the one write
    // in the file that asked the server nothing.
    const { error, count } = await supabase.from('glucose_readings').insert(
      fresh.map((r) => ({ client_id: target, taken_at: r.at, mmol_l: r.mmol, external_id: r.externalId, source: 'health' })),
      { count: 'exact' },
    );
    if (error) {
      // A collision means these readings are already here — which is a fine
      // outcome and not a fault, but it is not "added" either, and saying so is
      // what stops somebody importing again and again to fix a number that was
      // never going to move.
      if (error.code === '23505') {
        await refresh();
        return { added: 0, reason: 'Those readings are already in Repple, so nothing new was added.' };
      }
      return { added: 0, reason: 'Those readings could not be saved. Try again in a moment.' };
    }
    await refresh();
    // A null count is "nobody counted", not "none" — the same rule
    // src/lib/wroteRows.ts states for updates and deletes.
    if (count == null) {
      return { added: 0, reason: 'They were sent, but the server did not say how many it stored. Pull down to refresh and check before importing again.' };
    }
    return { added: count };
  }, [readOnly, target, rows, refresh]);

  const addManual = useCallback(async (mmol: number, at?: string): Promise<boolean> => {
    if (readOnly || !target) return false;
    const { error } = await supabase.from('glucose_readings').insert({
      client_id: target, taken_at: at ?? new Date().toISOString(), mmol_l: mmol, external_id: null, source: 'manual',
    });
    if (error) return false;
    await refresh();
    return true;
  }, [readOnly, target, refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (readOnly || !target) return false;
    // An UPDATE or DELETE that matches zero rows is not an error in PostgREST,
    // so the count is checked rather than the absence of an error object —
    // this is the bug class that has bitten every write in this codebase.
    const { error, count } = await supabase
      .from('glucose_readings').delete({ count: 'exact' })
      .eq('id', id).eq('client_id', target);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [readOnly, target, refresh]);

  const setSharedFlag = useCallback(async (on: boolean): Promise<boolean> => {
    if (readOnly || !target) return false;
    const { error, count } = await supabase
      .from('clients').update({ glucose_shared: on }, { count: 'exact' })
      .eq('id', target);
    if (error || !count) return false;
    setShared(on);
    return true;
  }, [readOnly, target]);

  return {
    status, readings, summary, sharedWithCoach: shared, paired, pairedStatus,
    refresh, importFromHealth, addManual, remove, setShared: setSharedFlag, readOnly,
  };
}
