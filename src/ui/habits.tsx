// Daily habits + water tracker (Phase 7). Habit done-states persist to Supabase
// `habit_logs` per user per day (hydrate-or-fallback + optimistic write) with a
// defensive in-memory fallback so it never blanks/crashes.
//
// ── The water count used to be the odd one out ─────────────────────────────
//
// This header read "Water glass count is session-local (no counter column); its
// 'done' state persists like the rest", and that sentence describes the worst
// possible half-state: the TICK survived a relaunch and the NUMBER it was
// derived from did not. A client who drank six of eight glasses, hit the goal,
// and reopened the app got a green water habit sitting above a counter reading
// zero — two rows of the same screen disagreeing about the same morning. And on
// the Recovery screen, where hydration is the one hero figure, the count simply
// went back to nothing every launch.
//
// The count now persists to `hydration_logs` (supabase/parts/109), one row per
// person per local day, owner-scoped by auth.uid().
//
// ── Why its own table and not a counter column on habit_logs ───────────────
//
// The migration argues this at length; the short version is that in
// `habit_logs` THE ROW IS THE TICK. This provider reads that table as
// `new Set(rows.map(r => r.habit))` — presence means done — and src/lib/
// adherence.ts counts rows over four weeks to tell a coach how often a client
// kept a habit. A client on their third of eight glasses is not done, so a
// running count stored there would need a row to exist before the habit was
// complete, and that row would tick the habit green at one glass here and count
// the day as adhered-to on the coach's screen. There is also no habit row to
// hang it on when the client has set no goal — `buildChecklist` only emits a
// 'water' item once `waterGoal` is non-null — and they still drink water.
//
// Two of a client's devices can each hold a count for today, so the two are
// reconciled on recency rather than by taking the larger (`mergeCount` in
// src/lib/wellnessSync.ts, and the test there for why `Math.max` silently
// refuses to let a miscount be corrected). `waterStatus` says whether the
// number on screen has been confirmed by the server or is this device's alone.
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
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { macrosFor, applyCoachAdjust } from '../lib/nutrition';
import { buildProgram } from '../lib/programs';
import { buildChecklist, scheduledFocus, type ChecklistGap, type ChecklistSource, type CoachChecklistItem } from '../lib/checklist';
import { worstStatus, type LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { WATER_CAP, clampGlasses, mergeCount, type CountAt } from '../lib/wellnessSync';
import { classifyWrite, serverRows, type WriteOutcome } from '../lib/offlineQueue';
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
  /** The client's own daily goal, in glasses, or null when they have not set
   *  one. Null is not "no water tracked": the count above is still real and
   *  still worth showing. What is absent is the thing to measure it against, so
   *  a screen must not divide by this, fill a row of that many glasses, or
   *  print it — see the four callers, all of which now branch on it. */
  waterGoal: number | null;
  /** Whether the count above was confirmed by the server.
   *
   *  Deliberately separate from `status`, for the reason `coachStatus` is
   *  separate from `ticksStatus`: a hydration read failing and a checklist read
   *  failing are two different holes, and folding them into one flag means a
   *  working read gets reported as broken depending on which query happened to
   *  fail. A screen that draws a row of glasses or a percentage against the
   *  goal should check this one.
   *
   *  Under 'error' the count is still REAL — it is this device's tally, and a
   *  client who drank six glasses drank them whether or not the server heard.
   *  What is unknown is whether another device has since moved it. */
  waterStatus: LoadStatus;
  addWater: () => void;
  removeWater: () => void;
  /** How many of today's ticks (and un-ticks) the server has not accepted.
   *  Under 'error' this is the difference between what the client did and what
   *  their coach's adherence figures are counting, and it is not zero just
   *  because the screen looks green. */
  unsent: number;
}

/** Where today's count is cached on this device.
 *
 *  Keyed by account as well as by day, so signing in as somebody else on a
 *  shared phone cannot show one client another's morning. The key without an
 *  account is the one older builds used, and it is still read as a fallback
 *  below — see `readLocalWater`. */
const waterKey = (uid: string | null, day: string) => (uid ? `repple.water:${uid}:${day}` : `repple.water:${day}`);

/** Today's ticks on this device, and the writes the server has not taken yet.
 *
 *  Keyed by account and by day, like the water count and for the same reason:
 *  a shared gym phone must not show one client another's morning, and a tick
 *  belongs to the day it was made on and to no other.
 *
 *  This did not exist. Ticks lived in a useState and a write that never
 *  reached the server left nothing behind, so a client who worked through
 *  their checklist in a basement gym came back to a blank card — and the
 *  coach's adherence figures, which count `habit_logs` rows over four weeks,
 *  read the same morning as a day the client did nothing. */
const ticksKey = (uid: string, day: string) => `repple.habits:${uid}:${day}`;

/** What that cache holds: the ticks as they stand, and the toggles that have
 *  not been accepted. The two are separate because they answer different
 *  questions — `done` is what the client sees, `pending` is what the server
 *  still owes — and a single list could not represent an UN-tick that has not
 *  landed, which is a row that must be deleted rather than one to write. */
interface CachedTicks { done: string[]; pending: Record<string, boolean> }

const readLocalTicks = async (uid: string, day: string): Promise<CachedTicks> => {
  try {
    const raw = await AsyncStorage.getItem(ticksKey(uid, day));
    if (!raw) return { done: [], pending: {} };
    const v = JSON.parse(raw);
    const done = Array.isArray(v?.done) ? v.done.map(String) : [];
    const pending: Record<string, boolean> = {};
    if (v?.pending && typeof v.pending === 'object') {
      for (const [k, on] of Object.entries(v.pending)) pending[String(k)] = !!on;
    }
    return { done, pending };
  } catch { return { done: [], pending: {} }; }
};

/** Today's cached count, from whichever key holds it.
 *
 *  Two formats exist. The current one is `{"count":6,"at":"…"}`; builds before
 *  part 109 wrote a bare integer, because there was nothing to reconcile
 *  against and so no need for a timestamp. A legacy value is read as the epoch,
 *  which means a server row — any server row — wins over it. That is the right
 *  way round: the legacy value has no idea when it was written, and the whole
 *  merge rests on being able to say which copy is more recent. In practice it
 *  almost never arises, because `hydration_logs` is new and the first launch
 *  after this update finds no server row at all, so the device's count is the
 *  one that gets pushed up. */
const readLocalWater = async (uid: string | null, day: string): Promise<CountAt | null> => {
  const parse = (raw: string | null): CountAt | null => {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (typeof v === 'number') return { count: clampGlasses(v), at: new Date(0).toISOString() };
      if (v && typeof v === 'object' && 'count' in v) return { count: clampGlasses(Number(v.count)), at: String(v.at ?? new Date(0).toISOString()) };
    } catch { /* a bare integer from an older build is not JSON on every path */ }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? { count: clampGlasses(n), at: new Date(0).toISOString() } : null;
  };
  try {
    const own = parse(await AsyncStorage.getItem(waterKey(uid, day)));
    if (own) return own;
    // Nothing under the per-account key: this may be the first launch after the
    // update that introduced it. Falling back to the old key is what stops a
    // client who has already drunk four glasses this morning watching the
    // counter reset to zero the moment the update installs.
    return uid ? parse(await AsyncStorage.getItem(waterKey(null, day))) : null;
  } catch { return null; }
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Worst of the three, in the order a screen cares about: an unknown beats a
// still-loading beats a confirmed answer.
//
// Moved to loadStatus.ts. The local copy predated 'partial' and, being written
// as a chain of ternaries ending in 'ready', would have answered "complete" for
// a truncated part — the exact silent lie the status exists to prevent, from
// the one line whose whole job is not to tell it.
const worst = worstStatus;

const Ctx = createContext<HabitsValue | null>(null);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const c = useClientData();
  const coachNutrition = useCoachNutrition();
  const assigned = useAssignedPrograms();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [coachItems, setCoachItems] = useState<CoachChecklistItem[]>([]);
  const [water, setWater] = useState(0);
  const [waterStatus, setWaterStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  // The account and the count as they stand right now, for the async paths.
  //
  // A tap resolves its write a second or two after the render that produced it,
  // and the alternative to a ref is a functional updater — which is exactly the
  // shape both of the bugs documented further down this file had: React
  // double-invokes updaters in development, so a network call placed inside one
  // fires twice, and an updater is no place for one regardless.
  const uidRef = useRef<string | null>(null);
  const waterRef = useRef(0);
  // Today's ticks and the toggles the server has not accepted, as they stand
  // right now, for the async paths. A tap resolves its write a second or two
  // after the render that produced it; a functional updater is no place for a
  // network call or a cache write, because React double-invokes updaters in
  // development and both would fire twice. That is the shape of the two bugs
  // documented further down this file.
  const doneRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Map<string, boolean>>(new Map());
  // The same count, in state, because `unsent` is rendered and a ref changing
  // re-renders nothing. Only ever written beside `pendingRef`.
  const [pendingCount, setPendingCount] = useState(0);
  const [ticksStatus, setTicksStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Separate from the ticks on purpose: a coach's items failing to load and
  // today's ticks failing to load are two different holes, and folding them
  // into one flag meant a working read could be reported as broken (and the
  // reverse) depending on which query happened to fail.
  const [coachStatus, setCoachStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // The client's own hydration goal, from clients.water_goal_glasses (part 70).
  //
  // It was `const waterGoal = 8;` — the last of the invented daily figures, and
  // the furthest-travelled: the checklist stated it as a target, Recovery drew
  // an arc against it, the home screen counted "3 of 8" and readinessScore
  // divided by it, all from a literal nobody had chosen. Null now, until they
  // set one on the Daily habits screen, and null all the way out: no caller
  // substitutes a figure for it.
  const waterGoal = c.waterGoalGlasses;
  // Today's count off this device, before anything is asked of the network.
  //
  // This runs with no account, under the legacy key, and it is what a client
  // with no signal — or no session yet — sees. The account-scoped read and the
  // reconcile against the server happen in the main effect below, once there is
  // an account to scope to.
  useEffect(() => {
    let cancelled = false;
    readLocalWater(null, today()).then((w) => {
      // `w.count > 0` deliberately, not `w != null`: this fires before the
      // account-scoped read and must not overwrite a count that read has
      // already established. A cached zero carries no information anybody is
      // missing, and the account-scoped path handles a real zero properly.
      if (!cancelled && w && w.count > 0 && waterRef.current === 0) { waterRef.current = w.count; setWater(w.count); }
    });
    return () => { cancelled = true; };
  }, []);

  /** Write today's count to this device. Cheap, synchronous from the caller's
   *  point of view, and the thing that has to happen before the network is even
   *  attempted — a glass logged in a basement gym has to survive the app being
   *  killed before signal comes back. */
  //
  // One key, the account-scoped one when there is an account. Mirroring the
  // count into the unscoped key as well was tried and removed: it would have
  // meant a signed-in client's morning sitting under a key any other account on
  // that phone reads first, and the first effect above runs before the session
  // resolves — so on a shared gym phone the previous client's count would flash
  // up as the next one's. The unscoped key is read once as a migration
  // fallback (see readLocalWater) and otherwise belongs to the signed-out case
  // alone, which is exactly what it held before part 109.
  const cacheWater = (n: number, at: string) => {
    AsyncStorage.setItem(waterKey(uidRef.current, today()), JSON.stringify({ count: n, at }))
      .catch(() => { /* the count is correct this session either way */ });
  };

  /** Write today's ticks and the outstanding toggles to this device.
   *
   *  Before the network, never conditional on it. A checklist worked through
   *  in a basement gym has to survive the app being killed before signal comes
   *  back — which is the whole of what was missing here. */
  const cacheTicks = () => {
    const owner = uidRef.current;
    if (!owner) return;
    const payload: CachedTicks = { done: [...doneRef.current], pending: Object.fromEntries(pendingRef.current) };
    AsyncStorage.setItem(ticksKey(owner, today()), JSON.stringify(payload))
      .catch(() => { /* the ticks are correct this session either way */ });
  };

  /** Set the ticks, the ref, and the cache together. Three copies of one fact
   *  that must not be allowed to disagree. */
  const applyDone = (next: Set<string>) => {
    doneRef.current = next;
    setDoneIds(next);
    cacheTicks();
  };

  /** Record, or clear, a toggle the server has not taken. */
  const markPending = (id: string, done: boolean | null) => {
    if (done === null) pendingRef.current.delete(id);
    else pendingRef.current.set(id, done);
    setPendingCount(pendingRef.current.size);
    cacheTicks();
  };

  /** Send today's count up. Resolves true only when the server holds this
   *  number — which is what separates 'ready' from 'error' on a screen about to
   *  draw six glasses as filled.
   *
   *  The row count is checked, not just `error`. PostgREST does not fail an
   *  upsert that RLS silently narrows to zero rows, so "no error" on its own is
   *  not evidence that anything was written. */
  const pushWater = async (owner: string, day: string, n: number): Promise<boolean> => {
    try {
      const { data, error } = await supabase.from('hydration_logs')
        .upsert({ user_id: owner, logged_on: day, glasses: n }, { onConflict: 'user_id,logged_on' })
        .select('glasses');
      if (error || !data || data.length !== 1) { setWaterStatus('error'); return false; }
      setWaterStatus('ready');
      return true;
    } catch { setWaterStatus('error'); return false; }
  };

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
        // Signed out: this device IS the store for all three of these, so what
        // is on screen is authoritative and there is no absent server to
        // misreport. That includes the water count, which is why waterStatus is
        // set on every one of these branches rather than left at 'loading' —
        // a status stuck on 'loading' forever is a screen that never renders
        // its figure.
        if (!sess?.session) { setTicksStatus('ready'); setCoachStatus('ready'); setWaterStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setTicksStatus('error'); setCoachStatus('error'); setWaterStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setTicksStatus('ready'); setCoachStatus('ready'); setWaterStatus('ready'); return; }
        setUid(id);
        uidRef.current = id;

        // ── today's water count ────────────────────────────────────────────
        //
        // Local first, then the server, then whichever is more recent — the
        // same order availability.ts settled on, for the same reason: a client
        // in a basement gym still sees their morning.
        const day = today();

        // ── today's ticks, off this device ─────────────────────────────────
        //
        // Before the network, like the water count beside it. This is what a
        // client who worked through their checklist in a basement gym sees,
        // and `pending` is what the server still owes them.
        const localTicks = await readLocalTicks(id, day);
        if (cancelled) return;
        pendingRef.current = new Map(Object.entries(localTicks.pending));
        setPendingCount(pendingRef.current.size);
        if (localTicks.done.length || pendingRef.current.size) {
          doneRef.current = new Set(localTicks.done);
          setDoneIds(doneRef.current);
        }

        const localWater = await readLocalWater(id, day);
        if (cancelled) return;
        if (localWater && localWater.count !== waterRef.current) { waterRef.current = localWater.count; setWater(localWater.count); }
        const { data: hy, error: hyErr } = await supabase.from('hydration_logs')
          .select('glasses, updated_at')
          .eq('user_id', id).eq('logged_on', day)
          .maybeSingle();
        if (cancelled) return;
        // The cached count stays on screen and the status records that it was
        // not checked — rather than the screen resetting to zero, which is what
        // a client would read as "the app lost my glasses".
        if (hyErr) { setWaterStatus('error'); }
        else {
          // No row is a true answer here, not a missing one: a day nobody has
          // logged has no row, and `mergeCount` treats a null server side as
          // "the server knows nothing about today" rather than as zero.
          const server: CountAt | null = hy
            ? { count: clampGlasses(Number((hy as any).glasses)), at: String((hy as any).updated_at ?? new Date(0).toISOString()) }
            : null;
          const m = mergeCount(server, localWater);
          waterRef.current = m.count;
          setWater(m.count);
          cacheWater(m.count, new Date().toISOString());
          if (m.push) await pushWater(id, day, m.count);
          else setWaterStatus('ready');
          if (cancelled) return;
        }

        // One row per habit ticked today by one person: a handful, and it cannot
        // grow with the business the way the roster reads do. Capped because the
        // ceiling is free and `capped()` turns "it cannot be long" from an
        // assumption into something the code checks.
        const { data, error } = await supabase.from('habit_logs').select('habit')
          .eq('user_id', id).eq('done_on', today())
          .order('habit', { ascending: true }).limit(capLimit());
        if (cancelled) return;
        // null when the read failed, [] when the client genuinely has not
        // ticked anything today. The cached ticks stay on screen either way;
        // only the second is allowed to take them off it.
        const tickRows = serverRows<any>(error, data);
        if (tickRows === null) { setTicksStatus('error'); }
        else {
          const page = capped(tickRows);
          // Replaces rather than merges — and then re-applies the toggles the
          // server has not been TOLD about. Those are two different things and
          // the distinction is the whole of this change.
          //
          // The old comment here was right about the bug it named: "a tick that
          // is not in the server's answer is not ticked, and carrying a stale
          // optimistic one forward is how a refused write stayed green until
          // the next launch". A REFUSED write. It is dropped from `pending` by
          // `settle` the moment the server declines it, so nothing carries it
          // forward. What survives is a toggle nobody answered, which the
          // server's silence about is not evidence of anything — and wiping it
          // here is precisely how a morning's work in a basement gym was
          // deleted by the first launch that got signal.
          const server = new Set(page.rows.map((r: any) => String(r.habit)));
          for (const [habit, on] of pendingRef.current) { if (on) server.add(habit); else server.delete(habit); }
          applyDone(server);
          setTicksStatus(page.truncated ? 'partial' : 'ready');

          // And now they go up. A failure is neither fatal nor silent: the
          // toggle stays queued, stays counted in `unsent`, and is tried again
          // on the next launch.
          for (const [habit, on] of [...pendingRef.current]) {
            if (cancelled) return;
            settle(habit, on, await persist(id, habit, on));
          }
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
          .order('created_at', { ascending: true })
          // The coach's own ordering decides which items survive a cap, which is
          // the right answer: a coach who put an item at the top of a client's
          // list meant it to be seen.
          .limit(capLimit());
        if (cancelled) return;
        if (ciErr) { setCoachStatus('error'); return; }
        const ciPage = capped(ci);
        setCoachItems(ciPage.rows.map((r: any) => ({ id: String(r.id), label: String(r.label ?? ''), icon: r.icon ?? null })));
        setCoachStatus(ciPage.truncated ? 'partial' : 'ready');
      } catch {
        // Offline, or the client threw before any of the reads landed. The
        // cached water count and the optimistic ticks stay on screen; all three
        // statuses say they are unconfirmed. `waterStatus` is included because
        // leaving it at 'loading' here is how a figure never renders at all.
        if (!cancelled) { setTicksStatus('error'); setCoachStatus('error'); setWaterStatus('error'); }
      }
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
    // The client's own, from clients.step_goal / clients.sleep_goal_hours
    // (part 60). Null until they set one, which produces a note rather than a
    // row — see the header of src/lib/checklist.ts.
    stepGoal: c.stepGoal,
    sleepGoalHours: c.sleepGoalHours,
    todaysTrainingFocus: trainingFocus,
    coachItems,
  }), [waterGoal, macros?.protein, macros?.kcal, c.stepGoal, c.sleepGoalHours, trainingFocus, coachItems]);

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

  /**
   * Send one toggle, and say which of the three things happened to it.
   *
   * The row count is read, not just `error`. Neither of these writes fails
   * when RLS narrows it to nothing: the upsert succeeds having written no row,
   * and a delete that matched nothing succeeds having removed none — so "no
   * error" was never evidence that the server had heard.
   *
   * The delete is the exception, and it is deliberate: removing a tick that is
   * not there IS the un-tick. Zero rows back means the row is already gone,
   * which is the state the client asked for, so it counts as stored rather
   * than as a refusal.
   */
  const persist = async (owner: string, id: string, done: boolean): Promise<WriteOutcome> => {
    try {
      if (done) {
        const { data, error } = await supabase.from('habit_logs')
          .upsert({ user_id: owner, habit: id, done_on: today() }, { onConflict: 'user_id,habit,done_on' })
          .select('habit');
        return classifyWrite(error as any, data ? data.length : 0);
      }
      const { data, error } = await supabase.from('habit_logs')
        .delete().eq('user_id', owner).eq('habit', id).eq('done_on', today())
        .select('habit');
      const out = classifyWrite(error as any, data ? data.length : 0);
      return out === 'refused' && !error ? 'stored' : out;
    } catch { return 'unsent'; }
  };

  /**
   * Apply one toggle's outcome to what is on screen and to what is still owed.
   *
   * 'stored'  the server has it; nothing is owed.
   * 'unsent'  nobody answered. The tick stands — the client did the thing —
   *           and the toggle stays queued for the next launch.
   * 'refused' the server read it and said no. The tick is REVERTED, because a
   *           green tick that no policy will ever record is the thing this
   *           file's header already complains about: right on screen, absent
   *           in the row the coach's adherence figures count.
   */
  const settle = (id: string, done: boolean, out: WriteOutcome) => {
    if (out === 'unsent') { markPending(id, done); return; }
    if (out === 'refused') {
      const n = new Set(doneRef.current);
      if (done) n.delete(id); else n.add(id);
      doneRef.current = n;
      setDoneIds(n);
    }
    markPending(id, null);
  };

  const toggleHabit = async (id: string): Promise<boolean> => {
    // Only what is on today's list may be ticked. A derived list can lose a row
    // between render and tap — a coach deactivating an item, a target read
    // resolving — and writing a habit_logs row for a line that is no longer
    // there records a day nobody had.
    if (!items.some((i) => i.id === id)) return false;
    const nd = !doneRef.current.has(id);
    // The write used to run INSIDE the setHabits updater, which meant it could
    // fire twice under React's double-invoked updaters and had nowhere to put a
    // result. It is its own step now.
    //
    // Cached before the network is attempted, and the toggle is queued in the
    // same breath — so a tick made with no signal is on the phone whatever
    // happens next, including the app being killed on the walk home.
    const n = new Set(doneRef.current);
    if (nd) n.add(id); else n.delete(id);
    applyDone(n);
    // Nothing is owed when there is no server to owe it to. A build with no
    // backend IS the store, and a signed-out session has no account to cache
    // or to write under — queueing there would show a client a toggle
    // "waiting to send" that nothing will ever pick up.
    if (!USE_SUPABASE || !uidRef.current) return false;
    markPending(id, nd);
    const out = await persist(uidRef.current, id, nd);
    settle(id, nd, out);
    return out === 'stored';
  };

  // Hitting the goal ticks the water habit off. The tick used to be issued from
  // INSIDE the setWater updater, which is the same shape as the bug toggleHabit
  // documents: React double-invokes updaters in development, so the write could
  // fire twice, and an updater is no place for a network call.
  const markWaterDone = () => {
    if (doneRef.current.has('water') || !items.some((i) => i.id === 'water')) return;
    const n = new Set(doneRef.current);
    n.add('water');
    applyDone(n);
    const owner = uidRef.current;
    if (!USE_SUPABASE || !owner) return;
    markPending('water', true);
    void persist(owner, 'water', true).then((out) => settle('water', true, out));
  };
  // A sanity ceiling on the counter, not a goal. It was a bare 20, which was
  // above the old constant 8 and below the 30 the column now permits — so a
  // client who set a 25-glass goal could log 20 and never reach it, and the
  // Recovery hero would have sat at 80% for the rest of their life. It tracks
  // clients_water_goal_glasses_check (part 70): whatever goal the database will
  // accept must be reachable here.
  //
  // Moved to src/lib/wellnessSync.ts, because `hydration_logs_glasses_check`
  // (part 109) now enforces the same range server-side and there are three
  // numbers that have to agree rather than two. A local copy of a constant that
  // has to match a column is a copy that will one day not match it, and the
  // symptom would be writes the client never sees refused.
  const addWater = () => {
    // Local, cached, then sent — in that order, and never conditional on the
    // send. The count on screen is this device's tally and it is real whether
    // or not the server hears about it; `waterStatus` is where "the server has
    // not confirmed this" is recorded, not in a glass that refuses to fill.
    const next = clampGlasses(waterRef.current + 1);
    const hit = waterRef.current !== next;
    waterRef.current = next;
    setWater(next);
    cacheWater(next, new Date().toISOString());
    if (uidRef.current && USE_SUPABASE) void pushWater(uidRef.current, today(), next);
    // No goal means there is nothing to complete. Without this the comparison
    // coerces the null to 0, so the very first glass reads as hitting the goal.
    // markWaterDone would currently refuse it — there is no 'water' row on a
    // list built from a null goal — but that is the wrong reason to be safe:
    // the guard there is about a row the coach or a read took away, and leaning
    // on it here means a change to it silently starts ticking a target nobody
    // set. The condition says what it means.
    //
    // `hit` is new with the clamp: at the ceiling the count does not move, and
    // firing the goal tick off an unchanged number would be reporting a glass
    // nobody drank. WATER_CAP is at or above every goal the database accepts,
    // so a client who can reach their goal reaches it before this bites.
    if (hit && waterGoal != null && next >= waterGoal) markWaterDone();
  };
  const removeWater = () => {
    const next = clampGlasses(waterRef.current - 1);
    if (next === waterRef.current) return;
    waterRef.current = next;
    setWater(next);
    cacheWater(next, new Date().toISOString());
    // The habit tick is deliberately NOT un-done here. Dropping back below the
    // goal after hitting it is a correction to the count, and whether the day
    // counts as a day the client hit their water is a question habit_logs
    // already answers on its own terms — un-ticking it from a minus button
    // would delete a row the coach's adherence figures are counting, from a
    // control whose label is "remove a glass".
    if (uidRef.current && USE_SUPABASE) void pushWater(uidRef.current, today(), next);
  };
  // Counted over today's list, not over doneIds: a tick against an item the
  // coach has since retired is still in habit_logs and would otherwise push the
  // count past the number of rows on screen.
  const doneCount = habits.filter((h) => h.done).length;

  return <Ctx.Provider value={{ habits, toggleHabit, status, gaps, doneCount, water, waterGoal, waterStatus, addWater, removeWater, unsent: pendingCount }}>{children}</Ctx.Provider>;
}

export function useHabits(): HabitsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHabits must be used inside <HabitsProvider>');
  return v;
}
