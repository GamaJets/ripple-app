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
// ── A goal set with no signal used to be a goal that never existed ────────
//
// Every write below returned false on a throw and the screen said "your goal
// could not be saved just now, so it isn't stored". True, and the end of it:
// the words were gone, and a member who set a target in a basement gym set
// nothing. `src/lib/outbox.ts` had a durable queue for a message, a measurement
// and a session approval and its own closing rule admits this one — a goal is a
// write about the member's own record that says the same thing whenever it
// lands, nobody else can take it, and it carries no file. So a goal that cannot
// be sent is now kept, counted on the home screen, and sent on the reconnect.
//
// The row shown while it waits carries the OUTBOX's id, not a server key. That
// is the rule src/ui/outbox.tsx states for a queued message and it matters the
// same way here: the queued intent and the row on the goals screen are one
// goal, and giving them two identities is how the member ends up looking at it
// twice. `isPending` is what everything destructive checks — see `removeGoal`.
//
// This provider is also where the three record handlers are registered, and
// src/ui/recordOutbox.ts explains why they are together and where they would
// rather live.
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
import { classifyWrite } from '../lib/offlineQueue';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { sortGoals, type GoalKind, type GoalTarget, type MeasuredKind } from '../lib/goalTargets';
import { isPending } from '../lib/wellnessSync';
import { useOutbox } from './outbox';
import { useRecordOutboxHandlers } from './recordOutbox';
import { useRecoverRead } from './readRefresh';

const LEGACY_KEY = 'repple.goalTarget';
const MIGRATED_KEY = 'repple.goalTarget.migrated';

/**
 * What happened to a goal somebody set.
 *
 * Three answers rather than two, because the screen has three things to say.
 * `true` used to cover both "the server has it" and "this phone is holding it",
 * so app/(client)/goal.tsx said nothing at all about the second — the queued
 * row was drawn exactly like a stored one, and then `removeGoal` and
 * `setAchieved` both refused it (correctly: no server has ever seen that id)
 * and the screen blamed the member's connection for a goal that had simply not
 * been sent yet. Every other queued write in this app says "Saved on this
 * phone"; this is what lets this one say it too.
 */
export type GoalSaved = 'stored' | 'queued' | false;

interface GoalValue {
  goals: GoalTarget[];
  /** Under 'error' an empty list means the goals could not be read, NOT that
   *  the client has none. The screen must not offer to set a first goal to
   *  somebody who already has three. */
  status: LoadStatus;
  /**
   * Read the goals again.
   *
   * A real re-read: it bumps the same `rev` a settled queued goal bumps, which
   * the load effect is keyed on, so the server's own rows come back. Pending
   * rows waiting in the outbox are preserved by that effect exactly as they are
   * on any other pass, so a refresh never drops a goal the member set offline.
   */
  reload: () => void;
  /**
   * One target per measured metric, so this replaces any existing goal of the
   * same kind.
   *
   * True once the row is on the server OR once the write has been kept on this
   * phone to be sent later — and the goal appears on the list either way, so the
   * two are the same answer to the screen: the member set a goal and it was not
   * lost. What tells them apart is the home screen's "waiting to send" line and
   * `isPending` on the row's id, which is what the destructive calls below check.
   *
   * False is what it has always been: nothing was written and nothing was kept.
   */
  setMeasuredGoal: (kind: MeasuredKind, value: number, targetDateISO: string | null) => Promise<GoalSaved>;
  addCustomGoal: (title: string, targetDateISO: string | null) => Promise<GoalSaved>;
  /** Refuses a goal that has not reached the server yet — see the note on the
   *  implementation. */
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
  const outbox = useOutbox();
  // Bumped when a queued goal finally lands, so the optimistic row keyed on the
  // outbox's id is replaced by the server's own. Without it the member would go
  // on looking at a goal that says the right thing under an id nothing can act
  // on until the next launch.
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev((n) => n + 1), []);
  // The three record handlers live here. See src/ui/recordOutbox.ts for why they
  // are registered together and why this provider is the mount.
  useRecordOutboxHandlers({
    onGoalSettled: (id) => {
      // The waiting row has stopped being the truth — it either reached the
      // server or was declined by it. Off the list either way, and then a
      // re-read, which is what puts the server's own row (and its own id) in
      // front of the member.
      setGoals((p) => p.filter((g) => g.id !== id));
      setRev((n) => n + 1);
    },
  });

  // Returns null for a read that failed and `truncated` for one that came back
  // at its ceiling. Two different answers, because the screen owes the client a
  // different sentence for each: one is "we could not read your goals", the
  // other is "these are your goals, and there are more of them".
  const load = useCallback(async (who: string): Promise<{ goals: GoalTarget[]; truncated: boolean } | null> => {
    // Newest-first, so a client who has set and achieved goals for years keeps
    // the live ones. sortGoals puts the next due first regardless; the order
    // here decides only which goals survive the cap, and the achieved ones from
    // three years ago are not the ones worth keeping.
    const { data, error } = await supabase
      .from('goal_targets')
      .select('id, kind, target_value, title, target_date, achieved_at, created_at')
      .eq('client_id', who)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('goalTracker.load', error); return null; }
    const page = capped(data as unknown as Row[]);
    return { goals: sortGoals(page.rows.map(rowToGoal)), truncated: page.truncated };
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
      const after = await migrateLegacyTarget(who, mine.goals);
      if (cancelled) return;
      // Anything still on this phone is kept in front of the server's answer.
      // A re-read that dropped it would take a goal off the member's list while
      // the outbox is still holding it, and the home screen would go on counting
      // a goal the goals screen says they never set.
      setGoals((p) => sortGoals([...after, ...p.filter((g) => isPending(g.id))]));
      setStatus(mine.truncated ? 'partial' : 'ready');
    })();
    return () => { cancelled = true; };
  }, [authRev, load, rev]);

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

  /**
   * Keep this goal on the phone and show it while it waits.
   *
   * The row is keyed on the OUTBOX's id so the waiting intent and the row on the
   * goals screen are one goal rather than two — the rule src/ui/outbox.tsx
   * states for a queued message, for the same reason. `isPending` is how
   * everything downstream can tell it apart from a row the server has.
   *
   * False when nothing was kept: no outbox above this provider, a phone already
   * holding as much as it will hold, or a device outbox that could not be read.
   * The caller's screen then says what it has always said, which is true.
   */
  const queueGoal = async (
    kind: GoalKind, value: number | null, title: string | null, date: string | null,
  ): Promise<GoalSaved> => {
    if (!outbox) return false;
    const { result, id } = await outbox.enqueue('goal', { kind, value, title, targetDate: date });
    if (result !== 'queued' || !id) return false;
    setGoals((p) => sortGoals([
      // One target per measured metric — the rule the partial index enforces —
      // so a second offline mark of the same kind replaces the first rather
      // than showing the member two answers for one decision. Any SERVER row of
      // that kind goes off the list too: the queued intent will replace it when
      // it lands, and until then the old number is not what they just set. The
      // re-read on `onGoalSettled` is what puts the truth back either way.
      ...p.filter((g) => kind === 'custom' || g.kind !== kind),
      {
        id,
        kind,
        targetValue: kind === 'custom' ? null : value,
        title: kind === 'custom' ? title : null,
        targetDateISO: date,
        achievedAtISO: null,
        createdAtISO: new Date().toISOString(),
      },
    ]));
    return 'queued';
  };

  const setMeasuredGoal = async (kind: MeasuredKind, value: number, targetDateISO: string | null): Promise<GoalSaved> => {
    // No backend, or nobody signed in. There is no outbox to key by either, so
    // this is the same refusal it has always been rather than a queue.
    if (!USE_SUPABASE || !uid) return false;
    const date = targetDateISO ? targetDateISO.slice(0, 10) : null;
    // Replace rather than upsert. The uniqueness of a measured goal is enforced
    // by a PARTIAL index (kind <> 'custom'), which PostgREST cannot name in an
    // on_conflict, so the existing row is found here and updated by id.
    const existing = goals.find((g) => g.kind === kind);
    // A goal that is still waiting to send cannot be updated by id, because the
    // id is this device's and no server has ever seen it. Changing your mind
    // twice offline queues the second intent and drops the first row.
    if (existing && isPending(existing.id)) return queueGoal(kind, value, null, date);
    try {
      if (existing) {
        const { data, error } = await supabase.from('goal_targets')
          .update({ target_value: value, target_date: date, achieved_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
        // Three answers, not two. 'refused' is the server having read the row
        // and declined it — RLS, a CHECK, a row that is not there — and offering
        // the same bytes again gets the same answer, so it is NOT queued. Only
        // 'unsent', where nobody answered at all, is worth keeping.
        const out = classifyWrite(error as any, data ? 1 : 0);
        if (out === 'stored' && data) {
          setGoals((p) => sortGoals(p.map((g) => (g.id === existing.id ? rowToGoal(data as unknown as Row) : g))));
          return 'stored';
        }
        reportError('goalTracker.update', error);
        return out === 'refused' ? false : queueGoal(kind, value, null, date);
      }
      const { data, error } = await supabase.from('goal_targets')
        .insert({ client_id: uid, kind, target_value: value, target_date: date })
        .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      const out = classifyWrite(error as any, data ? 1 : 0);
      if (out === 'stored' && data) {
        setGoals((p) => sortGoals([...p, rowToGoal(data as unknown as Row)]));
        return 'stored';
      }
      reportError('goalTracker.insert', error);
      return out === 'refused' ? false : queueGoal(kind, value, null, date);
    } catch (e) {
      // A throw is a request that never completed — the offline case, and the
      // one this queue exists for.
      reportError('goalTracker.setMeasuredGoal', e);
      return queueGoal(kind, value, null, date);
    }
  };

  const addCustomGoal = async (title: string, targetDateISO: string | null): Promise<GoalSaved> => {
    if (!USE_SUPABASE || !uid) return false;
    const t = title.trim();
    if (!t) return false;
    const date = targetDateISO ? targetDateISO.slice(0, 10) : null;
    try {
      const { data, error } = await supabase.from('goal_targets')
        .insert({ client_id: uid, kind: 'custom', title: t, target_date: date })
        .select('id, kind, target_value, title, target_date, achieved_at, created_at').single();
      const out = classifyWrite(error as any, data ? 1 : 0);
      if (out === 'stored' && data) {
        setGoals((p) => sortGoals([...p, rowToGoal(data as unknown as Row)]));
        return 'stored';
      }
      reportError('goalTracker.addCustom', error);
      return out === 'refused' ? false : queueGoal('custom', null, t, date);
    } catch (e) { reportError('goalTracker.addCustom', e); return queueGoal('custom', null, t, date); }
  };

  const removeGoal = async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    // A goal the server has never seen. There is nothing to delete and the id
    // would 400, so this is honestly false and the screen says the goal is still
    // there — which it is, on this phone, waiting to go up.
    if (isPending(id)) return false;
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
    // Same as `removeGoal`: an id this device made names no row anywhere.
    if (isPending(id)) return false;
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

  // Re-run this read when the signal comes back, without the member having
  // to know the app is stuck and think to pull down. src/lib/readRefresh.ts.
  useRecoverRead('goalTracker', status, reload);
  return (
    <Ctx.Provider value={{ goals, status, setMeasuredGoal, addCustomGoal, removeGoal, setAchieved, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGoalTracker(): GoalValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGoalTracker must be used inside <GoalTrackerProvider>');
  return v;
}
