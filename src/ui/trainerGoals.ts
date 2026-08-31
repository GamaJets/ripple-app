// Trainer goals — a monthly revenue target and a client-count target the coach
// sets and tracks toward.
//
// Zero means "not set". These used to default to $4,000 and 12 clients and
// render under the heading "Your goals", with a progress arc on the hero, as
// though the trainer had chosen them.
//
// ── They used to live only on this handset ─────────────────────────────────
//
// AsyncStorage under 'repple.trainer.goals' and nowhere else. A coach who set a
// target, reinstalled the app and opened Analytics was told "No targets set" —
// a sentence about them, produced by a wiped keychain — and a coach with two
// phones was working toward a different number on each. They now follow the
// account (`coach_prefs`, part 129), which is where a person's own targets
// belong: nobody else can read them, and they survive the device.
//
// AsyncStorage is kept, doing what it should always have been doing: the cache
// that makes the first paint right, the whole store when the backend is off or
// nobody is signed in, and — on the launch this ships — the source of the
// targets a coach set before there was anywhere to put them. Those are
// backfilled to the account on the first successful read.
//
// ── Nothing is written until the account has been read ─────────────────────
//
// The bug documented at length in src/ui/clientData.tsx: a provider that
// pushes its state to the server before it has read the server's state
// overwrites the user's real answer with a constructed default, on every
// launch, for ever. Here the constructed default is {0, 0} — "no targets" —
// published over the targets the coach set on their other phone. So `writable`
// stays false until a read has actually landed, and a read that FAILS never
// sets it: a failed read is not permission to assume the account is empty.
//
// ── And the screen has to be able to say which ─────────────────────────────
//
// {0, 0} arrives from two completely different situations: a coach who has set
// no targets, and a read that was refused. `status` is what lets Analytics say
// "could not be read" instead of "No targets set" — the second being both false
// and an invitation to type the targets in again over the top of the stored
// ones. `goalsEmptyLine` in src/lib/coachPrefs.ts writes that sentence and is
// tested.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';
import { fetchCoachPrefs, saveCoachPrefs } from '../lib/coachPrefsStore';

export interface TrainerGoals { revenue: number; clients: number }
const KEY = 'repple.trainer.goals';
// Zero means "not set" — see the header.
const DEFAULT: TrainerGoals = { revenue: 0, clients: 0 };

/** A stored column back into the app's vocabulary. NULL on the row and 0 in the
 *  app say the same thing ("no target"); anything that is not a non-negative
 *  finite number is treated as unset rather than plotted. */
const asGoal = (v: number | null): number => (v != null && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function useTrainerGoals() {
  const [goals, setGoals] = useState<TrainerGoals>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const rev = useAuthRevision();

  // Whether this session may write to the account. False until a read has
  // landed; never set by a read that failed. See the header.
  const writable = useRef(false);
  // `save` is called from a modal's onPress and must see the current value, not
  // the one captured by the render that created it.
  const latest = useRef<TrainerGoals>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    writable.current = false;
    (async () => {
      // ── the cache, first, so the section is not empty for a round trip ────
      let cached: TrainerGoals | null = null;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const c = JSON.parse(raw) as Record<string, unknown>;
          // Key by key rather than a spread of the parsed blob: an older build's
          // extra fields would otherwise be carried into state and written
          // straight back to storage, for good.
          cached = {
            revenue: typeof c.revenue === 'number' ? asGoal(c.revenue) : 0,
            clients: typeof c.clients === 'number' ? asGoal(c.clients) : 0,
          };
        }
      } catch { /* an unreadable cache is an empty cache, not an error */ }
      if (cancelled) return;
      if (cached) { latest.current = cached; setGoals(cached); }

      // ── the account, which wins where it has an answer ───────────────────
      const { prefs, status: st } = await fetchCoachPrefs();
      if (cancelled) return;
      if (st !== 'ready') {
        // Nothing is published for the rest of this session. The coach may well
        // have targets set on another device, and writing this handset's cache
        // over them is precisely what the guard exists for.
        setStatus('error');
        setLoaded(true);
        return;
      }

      const fromServer: TrainerGoals = {
        revenue: asGoal(prefs.goalRevenue),
        clients: asGoal(prefs.goalClients),
      };
      // A row with no targets on it does NOT overwrite what this device already
      // had — that is a coach who set targets before part 129 shipped, and their
      // numbers are backfilled rather than discarded. Same rule the unit
      // preference uses for a NULL column in src/ui/settings.tsx.
      const hasServer = fromServer.revenue > 0 || fromServer.clients > 0;
      const effective = hasServer ? fromServer : (cached ?? DEFAULT);
      latest.current = effective;
      setGoals(effective);
      writable.current = true;
      setStatus('ready');
      setLoaded(true);

      // The backfill: targets this device holds that the account does not.
      if (!hasServer && (effective.revenue > 0 || effective.clients > 0)) {
        void saveCoachPrefs({ goalRevenue: effective.revenue, goalClients: effective.clients });
      }
    })();
    return () => { cancelled = true; };
  }, [rev]);

  /**
   * Set one or both targets.
   *
   * The answer is recorded in state and in the cache FIRST and
   * unconditionally — it belongs to the coach, not to the network, and the
   * screen must not sit still while a round trip decides whether their tap
   * happened. The account write follows and is skipped only where writing would
   * be publishing a guess (see `writable`).
   *
   * 0 is sent as NULL rather than as 0: on the row, "no target" is the absence
   * of one, and storing a literal zero would make a cleared target
   * indistinguishable from a target of nothing.
   */
  const save = useCallback((next: Partial<TrainerGoals>) => {
    const merged: TrainerGoals = {
      revenue: asGoal(next.revenue ?? latest.current.revenue),
      clients: asGoal(next.clients ?? latest.current.clients),
    };
    latest.current = merged;
    setGoals(merged);
    AsyncStorage.setItem(KEY, JSON.stringify(merged)).catch(() => { /* best-effort */ });
    if (!writable.current) return;
    void saveCoachPrefs({
      goalRevenue: merged.revenue > 0 ? merged.revenue : null,
      goalClients: merged.clients > 0 ? merged.clients : null,
    });
  }, []);

  return { goals, setGoals: save, loaded, status };
}

// Re-exported rather than moved out from under its callers: the clamp is pure
// arithmetic and now lives in src/lib/coachPrefs.ts where `npm test` can reach
// it, and app/(trainer)/analytics.tsx goes on importing it from here.
export { goalPct } from '../lib/coachPrefs';
