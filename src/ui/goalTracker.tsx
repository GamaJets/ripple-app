// The client's goals, on the server.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One target weight and one date, held in AsyncStorage under
// 'repple.goalTarget' and written nowhere else. Two consequences, both
// reported:
//
//  · TF-28 — "the only goal you can set is a target weight". Body fat, muscle
//    and anything that is not a number at all had nowhere to go.
//  · The coach could not see it. In an app whose premise is that somebody is
//    watching, the single most important thing about a client — what they are
//    trying to do — never left their phone. A reinstall lost it silently.
//
// Goals live in `goal_targets` now (supabase/parts/59). The arithmetic is in
// src/lib/goalTargets.ts, which is pure and tested; this file is the store.
//
// ── The device key is a migration, not a fallback ──────────────────────────
//
// Clients who set a target before this shipped have it on their phone and
// nowhere else. `migrateLegacyTarget` below moves it up exactly once, and only
// when the server has no weight goal to contradict it. After that the row is
// the record and the key is never read again.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { sortGoals, type GoalTarget, type MeasuredKind } from '../lib/goalTargets';

const LEGACY_KEY = 'repple.goalTarget';
const MIGRATED_KEY = 'repple.goalTarget.migrated';

interface GoalValue {
  goals: GoalTarget[];
  /** Under 'error' an empty list means the goals could not be read, NOT that
   *  the client has none. The screen must not offer to set a first goal to
   *  somebody who already has three. */
  status: LoadStatus;
  /** One target per measured metric, so this replaces any existing goal of the
   *  same kind. Resolves true only once the row is on the server. */
  setMeasuredGoal: (kind: MeasuredKind, value: number, targetDateISO: string | null) => Promise<boolean>;
  addCustomGoal: (title: string, targetDateISO: string | null) => Promise<boolean>;
  removeGoal: (id: string) => Promise<boolean>;
  setAchieved: (id: string, achieved: boolean) => Promise<boolean>;
}

const Ctx = createContext<GoalValue | null>(null);

interface Row {
  id: string; kind: string; target_value: string | number | null; title: string | null;
  target_date: string | null; achieved_at: string | null; created_at: string;
}

function rowToGoal(r: Row): GoalTarget {
  return {
    id: r.id,
    kind: r.kind as GoalTarget['kind'],
    targetValue: r.target_value != null ? Number(r.target_value) : null,
    title: r.title,
    targetDateISO: r.target_date,
    achievedAtISO: r.achieved_at,
    createdAtISO: r.created_at,
  };
}

export function GoalTrackerProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [goals, setGoals] = useState<GoalTarget[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);

  const load = useCallback(async (who: string): Promise<GoalTarget[] | null> => {
    const { data, error } = await supabase
      .from('goal_targets')
      .select('id, kind, target_value, title, target_date, achieved_at, created_at')
      .eq('client_id', who);
    if (error) { reportError('goalTracker.load', error); return null; }
    return sortGoals(((data ?? []) as unknown as Row[]).map(rowToGoal));
  }, []);

  // Keyed on authRev, not []. Read the header of src/ui/authRevision.tsx: with
  // an empty dependency array this ran once, before anybody had signed in,
  // failed, and was never asked again.
  useEffect(() => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      let who: string | null = null;
      try {
        const { data } = await supabase.auth.getUser();
        who = data?.user?.id ?? null;
      } catch { who = null; }
      if (cancelled) return;
      setUid(who);
      if (!who) {
        // Signed out is a true answer: nobody has goals, and saying so is not
        // the same as failing to look.
        setGoals([]); setStatus('ready'); return;
      }
      const mine = await load(who);
      if (cancelled) return;
      if (mine == null) { setStatus('error'); return; }
      const after = await migrateLegacyTarget(who, mine);
      if (cancelled) return;
      setGoals(after);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [authRev, load]);

  // Move a pre-server target weight up, once. Deliberately conservative: if the
  // server already holds a weight goal it wins, because it is the one the coach
  // can see and the one another device may have written more recently.
  const migrateLegacyTarget = async (who: string, current: GoalTarget[]): Promise<GoalTarget[]> => {
    try {
      if (await AsyncStorage.getItem(MIGRATED_KEY)) return current;
      const raw = await AsyncStorage.getItem(LEGACY_KEY);
      if (!raw) { await AsyncStorage.setItem(MIGRATED_KEY, '1'); return current; }
      const old = JSON.parse(raw) as { targetWeightKg?: number; targetDateISO?: string };
      const kg = Number(old?.targetWeightKg);
      // 0 was the provider's "not set" sentinel, so it migrates to nothing.
      if (!Number.isFinite(kg) || kg <= 0 || current.some((g) => g.kind === 'weight')) {
        await AsyncStorage.setItem(MIGRATED_KEY, '1');
        return current;
      }
      const { data, error } = await supabase.from('goal_targets').insert({
        client_id: who, kind: 'weight', target_value: kg,
        target_date: old.targetDateISO ? String(old.targetDateISO).slice(0, 10) : null,
      }).select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      // A failed migration is retried on the next launch rather than marked
      // done — the key is the only copy, and losing it loses the goal.
      if (error || !data) { reportError('goalTracker.migrate', error); return current; }
      await AsyncStorage.setItem(MIGRATED_KEY, '1');
      return sortGoals([...current, rowToGoal(data as unknown as Row)]);
    } catch (e) {
      reportError('goalTracker.migrate', e);
      return current;
    }
  };

  const setMeasuredGoal = async (kind: MeasuredKind, value: number, targetDateISO: string | null): Promise<boolean> => {
    if (!USE_SUPABASE || !uid) return false;
    const date = targetDateISO ? targetDateISO.slice(0, 10) : null;
    // Replace rather than upsert. The uniqueness of a measured goal is enforced
    // by a PARTIAL index (kind <> 'custom'), which PostgREST cannot name in an
    // on_conflict, so the existing row is found here and updated by id.
    const existing = goals.find((g) => g.kind === kind);
    try {
      if (existing) {
        const { data, error } = await supabase.from('goal_targets')
          .update({ target_value: value, target_date: date, achieved_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
        if (error || !data) { reportError('goalTracker.update', error); return false; }
        setGoals((p) => sortGoals(p.map((g) => (g.id === existing.id ? rowToGoal(data as unknown as Row) : g))));
        return true;
      }
      const { data, error } = await supabase.from('goal_targets')
        .insert({ client_id: uid, kind, target_value: value, target_date: date })
        .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      if (error || !data) { reportError('goalTracker.insert', error); return false; }
      setGoals((p) => sortGoals([...p, rowToGoal(data as unknown as Row)]));
      return true;
    } catch (e) { reportError('goalTracker.setMeasuredGoal', e); return false; }
  };

  const addCustomGoal = async (title: string, targetDateISO: string | null): Promise<boolean> => {
    if (!USE_SUPABASE || !uid) return false;
    const t = title.trim();
    if (!t) return false;
    try {
      const { data, error } = await supabase.from('goal_targets')
        .insert({ client_id: uid, kind: 'custom', title: t, target_date: targetDateISO ? targetDateISO.slice(0, 10) : null })
        .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      if (error || !data) { reportError('goalTracker.addCustom', error); return false; }
      setGoals((p) => sortGoals([...p, rowToGoal(data as unknown as Row)]));
      return true;
    } catch (e) { reportError('goalTracker.addCustom', e); return false; }
  };

  const removeGoal = async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    try {
      // Counting the rows: a delete that matched nothing is not an error in
      // PostgREST, so without this a goal RLS refused to delete would vanish
      // from the screen and be back at the next launch.
      const { data, error } = await supabase.from('goal_targets').delete().eq('id', id).select('id');
      if (error || !data || !data.length) { reportError('goalTracker.remove', error); return false; }
      setGoals((p) => p.filter((g) => g.id !== id));
      return true;
    } catch (e) { reportError('goalTracker.remove', e); return false; }
  };

  const setAchieved = async (id: string, achieved: boolean): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    const at = achieved ? new Date().toISOString() : null;
    try {
      const { data, error } = await supabase.from('goal_targets')
        .update({ achieved_at: at, updated_at: new Date().toISOString() }).eq('id', id)
        .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      if (error || !data) { reportError('goalTracker.setAchieved', error); return false; }
      setGoals((p) => sortGoals(p.map((g) => (g.id === id ? rowToGoal(data as unknown as Row) : g))));
      return true;
    } catch (e) { reportError('goalTracker.setAchieved', e); return false; }
  };

  return (
    <Ctx.Provider value={{ goals, status, setMeasuredGoal, addCustomGoal, removeGoal, setAchieved }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGoalTracker(): GoalValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGoalTracker must be used inside <GoalTrackerProvider>');
  return v;
}
