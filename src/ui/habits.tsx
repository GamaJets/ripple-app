// Daily habits + water tracker (Phase 7). Habit done-states persist to Supabase
// `habit_logs` per user per day (hydrate-or-fallback + optimistic write) with a
// defensive in-memory fallback so it never blanks/crashes. Water glass count is
// session-local (no counter column); its 'done' state persists like the rest.
//
// The habit list is seeded from a constant, so it is never empty and a failed
// read looked completely healthy — five habits, all unticked. A client who had
// already ticked four of them that morning opened the app to a blank card and
// re-did the day, and the coach's dashboard read the same unticked row as a
// missed day. `status` separates "you have not ticked anything today" from "we
// could not read what you ticked".
//
// The writes were fire-and-forget on both branches, so a tick the server refused
// stayed green until the next launch and then quietly reverted.
//
// ── TF-31: the list is no longer a constant ─────────────────────────────────
//
// "What generates the daily checklist? Is it actually useful?" — nothing did.
// SEED was five items compiled into the app, identical for every client on the
// platform: "10,000 steps" and "Sleep 7h+" were invented figures belonging to
// nobody, and "Protein target" never said what the target was, so the one line
// that was about their plan still could not be acted on from this screen.
//
// It is derived now, from what the app already holds about THIS person: their
// macro targets (buildChecklist's caller layers the coach's adjustment on the
// way in, exactly as the home screen and the food log do), the app's hydration
// goal, the day their training plan schedules for today, and whatever their
// coach has put on their list in `coach_checklist_items`. The rule that shapes
// it — a target the app does not have is not a checklist item, ever, and never
// a plausible default — is documented at length in src/lib/checklist.ts.
//
// ── Two consequences of the list no longer being a constant of five ─────────
//
// 1. `done` cannot live inside the habit objects any more. It used to, and
//    setHabits((p) => p.map(…)) was how a tick was applied. A derived list is
//    REBUILT whenever a target arrives — and the scans read lands a beat after
//    the ticks read — so the rebuild would have thrown away every tick made in
//    between. The ticks are their own set of ids, and the list is projected
//    through it.
//
// 2. `status` now has more ways to be 'error' than it did, and they all mean
//    the same thing they meant before: the checklist on screen is not what the
//    server holds. A macro target that could not be read is a row that is
//    MISSING, not a row that is unticked, and an empty-looking checklist must
//    not be presented as a light day. That includes the coach's nutrition
//    adjustment: coachNutrition.tsx documents that a failed read there hands
//    back the uncorrected generic targets, and "Hit 152 g protein" is a worse
//    thing to put in front of a client whose coach cut them 40 g than no line.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { macrosFor, applyCoachAdjust } from '../lib/nutrition';
import { buildProgram } from '../lib/programs';
import { buildChecklist, scheduledFocus, type ChecklistGap, type ChecklistSource, type CoachChecklistItem } from '../lib/checklist';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { useClientData } from './clientData';
import { useCoachNutrition } from './coachNutrition';
import { useAssignedPrograms } from './assignedPrograms';

export interface Habit { id: string; label: string; icon: string; done: boolean; source: ChecklistSource }

interface HabitsValue {
  habits: Habit[];
  /** Resolves true only once the tick (or un-tick) is stored server-side. False
   *  means the green tick on screen is local and will be gone tomorrow. */
  toggleHabit: (id: string) => Promise<boolean>;
  /** Whether today's ticks AND the list itself were read from the server. Under
   *  'error' an unticked habit means unknown, not "not done" — and the list may
   *  be short of rows whose target could not be read. */
  status: LoadStatus;
  /** Targets the checklist would carry if the app knew them, and what the
   *  client can do about it. Only raised where there is somewhere to go. */
  gaps: ChecklistGap[];
  doneCount: number;
  water: number;          // glasses today
  waterGoal: number;
  addWater: () => void;
  removeWater: () => void;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Worst of the three, in the order a screen cares about: an unknown beats a
// still-loading beats a confirmed answer.
const worst = (...s: LoadStatus[]): LoadStatus =>
  s.includes('error') ? 'error' : s.includes('loading') ? 'loading' : 'ready';

const Ctx = createContext<HabitsValue | null>(null);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const c = useClientData();
  const coachNutrition = useCoachNutrition();
  const assigned = useAssignedPrograms();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [coachItems, setCoachItems] = useState<CoachChecklistItem[]>([]);
  const [water, setWater] = useState(0);
  const [wHydrated, setWHydrated] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [ticksStatus, setTicksStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Separate from the ticks on purpose: a coach's items failing to load and
  // today's ticks failing to load are two different holes, and folding them
  // into one flag meant a working read could be reported as broken (and the
  // reverse) depending on which query happened to fail.
  const [coachStatus, setCoachStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // The app's hydration goal. Still a platform constant rather than this
  // client's own answer — nothing in the product sets a per-person one — but it
  // is the figure the water tracker draws, the home screen counts against and
  // readinessScore divides by, so the checklist stating it invents nothing. A
  // per-client goal, when there is one, replaces this line and nothing else.
  const waterGoal = 8;
  useEffect(() => { AsyncStorage.getItem('repple.water:' + today()).then((r) => { const n = r ? parseInt(r, 10) : 0; if (Number.isFinite(n) && n > 0) setWater(n); setWHydrated(true); }); }, []);
  useEffect(() => { if (!wHydrated) return; AsyncStorage.setItem('repple.water:' + today(), String(water)).catch(() => {}); }, [water, wHydrated]);

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
        if (!sess?.session) { setTicksStatus('ready'); setCoachStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setTicksStatus('error'); setCoachStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setTicksStatus('ready'); setCoachStatus('ready'); return; }
        setUid(id);

        const { data, error } = await supabase.from('habit_logs').select('habit').eq('user_id', id).eq('done_on', today());
        if (cancelled) return;
        if (error) { setTicksStatus('error'); }
        else {
          // Replaces rather than merges. A tick that is not in the server's
          // answer is not ticked, and carrying a stale optimistic one forward
          // is how a refused write stayed green until the next launch.
          setDoneIds(new Set((data ?? []).map((r: any) => String(r.habit))));
          setTicksStatus('ready');
        }

        // Inactive rows are filtered here rather than in RLS — the client is
        // entitled to read an item their coach retired, it just is not on
        // today's list. See 58-coach-checklist.sql.
        const { data: ci, error: ciErr } = await supabase
          .from('coach_checklist_items')
          .select('id,label,icon')
          .eq('client_id', id)
          .eq('active', true)
          .order('sort', { ascending: true })
          .order('created_at', { ascending: true });
        if (cancelled) return;
        if (ciErr) { setCoachStatus('error'); return; }
        setCoachItems((ci ?? []).map((r: any) => ({ id: String(r.id), label: String(r.label ?? ''), icon: r.icon ?? null })));
        setCoachStatus('ready');
      } catch { if (!cancelled) { setTicksStatus('error'); setCoachStatus('error'); } }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  // ── The day's targets ─────────────────────────────────────────────────────
  //
  // The same calculation the home screen, the food log and the profile all run,
  // including the solo case: somebody training with no coach has no coach
  // adjustment to apply, and passing one would be applying a stranger's.
  const solo = c.coachingMode === 'solo';
  const adjust = solo ? undefined : (coachNutrition.get(c.id) || undefined);
  // Under 'error' the coach's adjustment is UNKNOWN, not absent — so the
  // uncorrected generic figure is not this client's target and does not go on
  // their list. Only for a coached client; nobody adjusts a solo client's
  // macros, so the read failing tells us nothing we needed.
  const adjustUnknown = !solo && coachNutrition.status === 'error' && adjust == null;
  const macros = (c.weightKg != null && c.bodyFatPct != null && !adjustUnknown)
    ? applyCoachAdjust(macrosFor({ weightKg: c.weightKg, bodyFatPct: c.bodyFatPct, activity: c.activity, goal: c.goal, diet: c.diet }), adjust)
    : null;
  // A null weight under a failed scans read means "we could not find out", and
  // the missing protein row is a hole rather than a fact about this client.
  const macrosUnknown = macros == null && (adjustUnknown || c.scansStatus === 'error' || c.profileStatus === 'error');

  // Today's session, and only if the plan actually schedules one for today —
  // scheduledFocus is an exact weekday match, unlike the home screen's
  // nearest-day pick. See the note on it.
  const coachProgram = assigned.getProgram(c.id);
  // Same reasoning as the home screen: a coached client whose assignment could
  // not be read would otherwise be handed the generic auto program, and the
  // checklist would name a session their coach never wrote.
  const planUnknown = !solo && assigned.status === 'error' && coachProgram == null;
  const program = planUnknown ? null : ((solo ? null : coachProgram) ?? buildProgram(c.goal, c.bodyFatPct));
  const trainingFocus = program ? scheduledFocus(program.days, new Date().getDay()) : null;

  const { items, gaps } = useMemo(() => buildChecklist({
    waterGoalGlasses: waterGoal,
    proteinTargetG: macros?.protein ?? null,
    kcalTarget: macros?.kcal ?? null,
    // Nothing in the product sets either of these. They are here so the shape
    // of the answer is right the day something does; today they are honestly
    // null and produce no rows. See the header of src/lib/checklist.ts.
    stepGoal: null,
    sleepGoalHours: null,
    todaysTrainingFocus: trainingFocus,
    coachItems,
  }), [waterGoal, macros?.protein, macros?.kcal, trainingFocus, coachItems]);

  const habits: Habit[] = useMemo(
    () => items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, source: i.source, done: doneIds.has(i.id) })),
    [items, doneIds],
  );

  // Every way the list on screen can be short of, or ahead of, what the server
  // holds. The macro and plan cases are new with the derived list: a row that
  // is missing because a read failed is not a row the client left unticked.
  const status = worst(
    ticksStatus,
    coachStatus,
    macrosUnknown ? 'error' : 'ready',
    planUnknown ? 'error' : 'ready',
    c.scansStatus === 'loading' || c.profileStatus === 'loading' ? 'loading' : 'ready',
  );

  const persist = async (id: string, done: boolean): Promise<boolean> => {
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = done
        ? await supabase.from('habit_logs').upsert({ user_id: uid, habit: id, done_on: today() }, { onConflict: 'user_id,habit,done_on' })
        : await supabase.from('habit_logs').delete().eq('user_id', uid).eq('habit', id).eq('done_on', today());
      return !error;
    } catch { return false; }
  };

  const toggleHabit = async (id: string): Promise<boolean> => {
    // Only what is on today's list may be ticked. A derived list can lose a row
    // between render and tap — a coach deactivating an item, a target read
    // resolving — and writing a habit_logs row for a line that is no longer
    // there records a day nobody had.
    if (!items.some((i) => i.id === id)) return false;
    const nd = !doneIds.has(id);
    // The write used to run INSIDE the setHabits updater, which meant it could
    // fire twice under React's double-invoked updaters and had nowhere to put a
    // result. It is its own step now.
    setDoneIds((p) => { const n = new Set(p); if (nd) n.add(id); else n.delete(id); return n; });
    return persist(id, nd);
  };

  // Hitting the goal ticks the water habit off. The tick used to be issued from
  // INSIDE the setWater updater, which is the same shape as the bug toggleHabit
  // documents: React double-invokes updaters in development, so the write could
  // fire twice, and an updater is no place for a network call.
  const markWaterDone = () => {
    if (doneIds.has('water') || !items.some((i) => i.id === 'water')) return;
    setDoneIds((p) => { const n = new Set(p); n.add('water'); return n; });
    void persist('water', true);
  };
  const addWater = () => {
    setWater((w) => Math.min(w + 1, 20));
    if (water + 1 >= waterGoal) markWaterDone();
  };
  const removeWater = () => setWater((w) => Math.max(0, w - 1));
  // Counted over today's list, not over doneIds: a tick against an item the
  // coach has since retired is still in habit_logs and would otherwise push the
  // count past the number of rows on screen.
  const doneCount = habits.filter((h) => h.done).length;

  return <Ctx.Provider value={{ habits, toggleHabit, status, gaps, doneCount, water, waterGoal, addWater, removeWater }}>{children}</Ctx.Provider>;
}

export function useHabits(): HabitsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHabits must be used inside <HabitsProvider>');
  return v;
}
