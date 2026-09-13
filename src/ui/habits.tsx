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
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { macrosFor, applyCoachAdjust } from '../lib/nutrition';
import { buildProgram } from '../lib/programs';
import { buildChecklist, scheduledFocus, type ChecklistGap, type ChecklistSource, type CoachChecklistItem } from '../lib/checklist';
import { worstStatus, type LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import {
  habitStreaks, tickReadCoverage, daysBefore, STREAK_WINDOW_DAYS,
  type HabitStreak, type HabitTickRow,
} from '../lib/habitStreaks';
import { WATER_CAP, clampGlasses, mergeCount, type CountAt } from '../lib/wellnessSync';
import { classifyWrite, registerFlush, serverRows, type WriteOutcome } from '../lib/offlineQueue';
import { useAuthRevision } from './authRevision';
import { useClientData } from './clientData';
import { useCoachNutrition } from './coachNutrition';
import { useAssignedPrograms } from './assignedPrograms';
import { useClientWeek } from './clientWeek';
import { useToday } from './today';

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
  /**
   * Read again from the server.
   *
   * A real re-read, not a state reset: it bumps the key the load effect below
   * is keyed on, so the same query runs and `status` goes back through
   * 'loading' to whatever the server answers this time. Nothing local is
   * cleared and nothing pending is dropped, so a refused re-read leaves what is
   * on screen exactly where it was with the status saying it is not confirmed.
   *
   * Added for the pull-to-refresh gesture on the screens this provider feeds:
   * without it those screens could show a failed read for the whole session
   * with no way to ask again.
   */
  reload: () => void;
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
  /**
   * The member's own run on each habit, longest first, or null when the
   * history was not read.
   *
   * NULL IS NOT AN EMPTY LIST. `[]` under `historyStatus === 'ready'` means the
   * window genuinely holds no tick of anything, which a screen may say. Null
   * means we did not find out — signed out, no backend, or a refused read — and
   * a screen that prints "no runs going" over it is making the claim this
   * provider's header is entirely about.
   *
   * A habit with rows in the window but no current run is PRESENT, with
   * `days: 0` and a `lastTicked`. A habit with no row in the window at all is
   * absent, which is also not a zero: the window holds nothing about it either
   * way. See src/lib/habitStreaks.ts.
   */
  streaks: HabitStreak[] | null;
  /**
   * Whether the ninety-one day tick history was read, and read whole.
   *
   * ── DELIBERATELY NOT PART OF `status` ────────────────────────────────────
   *
   * `status` is the answer to "is what is on today's checklist what the server
   * holds", and three screens plus this one gate today's figures on it:
   * app/(client)/habits.tsx dashes its hero and prints "Some of today's list is
   * missing", app/(client)/dashboard.tsx and app/(client)/recovery.tsx read the
   * water half through it.
   *
   * The history is read in the SAME query as today's ticks, and it is the part
   * that can be truncated: ninety-one days of a dozen lines is past PostgREST's
   * thousand rows, and today's ticks never are. Rolling the two together would
   * mean a member with a long record opening this screen to "Some of today's
   * list is missing" over a list that is complete, every single day, because
   * their history is long. That is a false sentence produced by a true one, and
   * it is the exact shape of harm `partial` exists to prevent.
   *
   * So the two are separate flags over one read. `status` says whether TODAY is
   * whole; this says whether the HISTORY is. A PARTIAL WINDOW IS NOT A SHORT
   * HISTORY, and nothing downstream is allowed to count it as one — the runs
   * themselves carry `bounded` for precisely that.
   */
  historyStatus: LoadStatus;
  /** How many days back the history read reaches, for a screen that has to say
   *  so. The window, not the number of days that came back. */
  historyDays: number;
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
  /** Bumped by `reload`. A counter, so two pulls are two reads. */
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);
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
  /**
   * Today, kept current for as long as this provider is mounted — which is for
   * the whole life of the app, because HabitsProvider sits at the root and is
   * never torn down.
   *
   * ── what reading the clock once did ──────────────────────────────────────
   *
   * Everything below used to call `today()` at the moment it ran, and the
   * hydrate below ran once. So a member whose phone was open across midnight
   * kept yesterday's ticks in `doneRef` — and `cacheTicks` then wrote that set
   * under `ticksKey(owner, today())`, which is now TOMORROW's key. It survived
   * to the next launch, where `readLocalTicks` read it straight back as today's
   * ticks: a checklist that opens already finished, for a day nobody has
   * lived, on the screen whose whole job is to say what is still to do.
   *
   * The hydrate's own guard made it stick. It only replaces the tick set
   * `if (localTicks.done.length || pendingRef.current.size)` — deliberately, so
   * a local read cannot wipe a set the server already established — so an empty
   * new day left yesterday's standing.
   *
   * `useToday` is the remedy this codebase already has, and it is safe above
   * the navigator: its effect uses only setTimeout and AppState.
   */
  const day = useToday();
  /** The day the in-memory state belongs to, so a rollover can be told from a
   *  first run. Null until the first hydrate settles. */
  const stateDayRef = useRef<string | null>(null);
  /** `day` reachable from the callbacks below without adding it to every
   *  dependency array — the same shape `uidRef` uses for the same reason. */
  const dayRef = useRef(day);
  dayRef.current = day;
  const pendingRef = useRef<Map<string, boolean>>(new Map());
  /**
   * The local day each waiting toggle was MADE on.
   *
   * `persist` used to read `today()` at the moment it ran, and `flushQueue`
   * runs on the reconnect edge and on returning to the foreground — neither of
   * which is the moment the member ticked anything. A checklist worked through
   * in a basement gym at 23:50 and flushed on the walk home at 00:05 was
   * written with `done_on` set to the NEXT day: the tick landed on a day the
   * member had not lived yet, and their coach's adherence for the night they
   * actually trained still read as missed.
   *
   * The un-tick half is worse. The DELETE is matched on `done_on`, so after
   * midnight it matched nothing — and this file reads a delete that removed no
   * rows as 'stored', because removing a tick that is not there IS the un-tick.
   * So the member was told their correction had saved while yesterday's row sat
   * in the table still ticked.
   *
   * Written and cleared strictly beside `pendingRef` by `markPending`, so the
   * two cannot drift. Not part of `CachedTicks`: the cache is keyed on the day
   * already (`ticksKey`), so anything read back off the device at launch is by
   * construction today's, which is what the fallback says.
   */
  const pendingDayRef = useRef<Map<string, string>>(new Map());
  // The same count, in state, because `unsent` is rendered and a ref changing
  // re-renders nothing. Only ever written beside `pendingRef`.
  const [pendingCount, setPendingCount] = useState(0);
  const [ticksStatus, setTicksStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  /**
   * The window of ticks behind today, and how far it can be trusted.
   *
   * Null rather than `[]` on every path that did not read it, because this
   * file's whole header is about the difference. `rows` null and status 'error'
   * is "we did not find out"; `rows` `[]` and status 'ready' is "the window is
   * genuinely empty", which is a thing a screen may say.
   *
   * `coverFrom` is the oldest calendar day this read can SPEAK FOR, which is
   * not the oldest day that came back. On a truncated read the oldest day
   * present is itself a partial day — the ceiling fell somewhere inside it — so
   * the line is the day ABOVE it. `habitStreaks` turns a run that reaches this
   * line into a floor rather than a fact.
   */
  const [history, setHistory] = useState<{ rows: HabitTickRow[]; coverFrom: string | null } | null>(null);
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'error');
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
    // `day` rather than `today()`, and in the deps below, for the same reason
    // the main effect takes it: this provider outlives midnight.
    readLocalWater(null, day).then((w) => {
      // `w.count > 0` deliberately, not `w != null`: this fires before the
      // account-scoped read and must not overwrite a count that read has
      // already established. A cached zero carries no information anybody is
      // missing, and the account-scoped path handles a real zero properly.
      if (!cancelled && w && w.count > 0 && waterRef.current === 0) { waterRef.current = w.count; setWater(w.count); }
    });
    return () => { cancelled = true; };
  }, [day]);

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
    AsyncStorage.setItem(waterKey(uidRef.current, dayRef.current), JSON.stringify({ count: n, at }))
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
    AsyncStorage.setItem(ticksKey(owner, dayRef.current), JSON.stringify(payload))
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
    if (done === null) { pendingRef.current.delete(id); pendingDayRef.current.delete(id); }
    else { pendingRef.current.set(id, done); pendingDayRef.current.set(id, today()); }
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
        //
        // The history is the exception on this branch, and 'error' is the
        // honest answer rather than a pessimistic one: `habit_logs` is the only
        // place a tick from a previous day exists. This device caches TODAY
        // (see `ticksKey`) and nothing else, so with no session there is
        // nowhere for a run to be read from — which is "we cannot find out",
        // not "you have no runs". Null rows carry the same thing to the screen.
        if (!sess?.session) {
          setTicksStatus('ready'); setCoachStatus('ready'); setWaterStatus('ready');
          setHistory(null); setHistoryStatus('error');
          return;
        }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) {
          setTicksStatus('error'); setCoachStatus('error'); setWaterStatus('error');
          setHistory(null); setHistoryStatus('error');
          return;
        }
        const id = auth?.user?.id;
        if (!id) {
          setTicksStatus('ready'); setCoachStatus('ready'); setWaterStatus('ready');
          // As above: no account, so no history to read. Not an empty one.
          setHistory(null); setHistoryStatus('error');
          return;
        }
        setUid(id);
        uidRef.current = id;

        // ── today's water count ────────────────────────────────────────────
        //
        // Local first, then the server, then whichever is more recent — the
        // same order availability.ts settled on, for the same reason: a client
        // in a basement gym still sees their morning.
        // The provider's day, not the clock's, so this effect re-runs when the
        // day turns over — see `day` above for what one reading of the clock
        // did to a member whose phone stayed open.
        //
        // A ROLLOVER IS NOT A FIRST RUN. On a first run there is nothing in
        // memory to protect and the guards below are right to keep what they
        // find. On a rollover everything in memory belongs to yesterday, and
        // the guard that stops an empty local read wiping a set would otherwise
        // carry yesterday's ticks into today. So it is cleared here, before
        // anything is read.
        if (stateDayRef.current !== null && stateDayRef.current !== day) {
          doneRef.current = new Set();
          setDoneIds(doneRef.current);
          pendingRef.current = new Map();
          pendingDayRef.current = new Map();
          setPendingCount(0);
          waterRef.current = 0;
          setWater(0);
          // The history belongs to yesterday's window too. Its oldest day has
          // moved and, more to the point, the ANCHOR every run is counted back
          // from has: a run that reached yesterday is a run that reaches
          // today's yesterday, and re-reading is what settles it. Cleared to
          // null and not to [], so nothing reads the gap as "no runs".
          setHistory(null); setHistoryStatus('loading');
        }
        stateDayRef.current = day;

        // ── today's ticks, off this device ─────────────────────────────────
        //
        // Before the network, like the water count beside it. This is what a
        // client who worked through their checklist in a basement gym sees,
        // and `pending` is what the server still owes them.
        const localTicks = await readLocalTicks(id, day);
        if (cancelled) return;
        pendingRef.current = new Map(Object.entries(localTicks.pending));
        // Cleared with it. These came off the device under `ticksKey(owner,
        // day)`, so their day is `day` by construction; anything left in here
        // is the previous account's or the previous run's and must not be
        // carried onto a habit that happens to share an id.
        pendingDayRef.current = new Map();
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

        // ── today's ticks AND the window behind them, in one read ──────────
        //
        // This was `.eq('done_on', day)` — one day — and the note above it said
        // the set "cannot grow with the business the way the roster reads do".
        // That was true of one day and is the reason the member's own app could
        // not see its own history at all, while their COACH has read four weeks
        // of the same rows since src/lib/adherence.ts was written. The member
        // could not be shown a run on their own habits.
        //
        // ── why the cap is not a formality here ────────────────────────────
        //
        // One row per habit per day. A derived list plus a coach's lines is
        // commonly six to twelve ticks a day, and twelve times ninety-one is
        // 1,092 — past PostgREST's silent thousand-row ceiling (src/lib/
        // rowCap.ts). So this read genuinely truncates for the members with the
        // longest records, which is exactly the population a streak matters to.
        //
        // ── the ordering is load-bearing, twice ────────────────────────────
        //
        // `done_on` DESCENDING, so the rows that fall off a truncated read are
        // the OLDEST ones. Today's ticks — which drive every checkbox on the
        // screen and every figure `status` gates — are at the top and survive.
        // Ascending would have thrown today's ticks away to keep a quarter-old
        // Tuesday, and the checklist would have come up blank for the same
        // members.
        //
        // Then `habit` ascending, to make the order TOTAL. (user_id, habit,
        // done_on) is unique, so within one member these two clauses cannot
        // tie, and a read whose last page is decided by a tie is a read whose
        // boundary moves between two identical requests.
        const windowFrom = daysBefore(day, STREAK_WINDOW_DAYS - 1);
        const { data, error } = await supabase.from('habit_logs').select('habit, done_on')
          .eq('user_id', id)
          // `windowFrom` is null only if `day` were unreadable, which `useToday`
          // does not produce. Falling back to `day` reads today alone — the
          // behaviour this provider had before — rather than dropping the lower
          // bound and asking for the member's entire history.
          .gte('done_on', windowFrom ?? day)
          // Bounded at the top as well. A row dated tomorrow is not evidence
          // about a day nobody has lived; `habitStreaks` drops one anyway, and
          // asking for it in the first place would let it consume a row of the
          // cap at the end that matters.
          .lte('done_on', day)
          .order('done_on', { ascending: false })
          .order('habit', { ascending: true })
          .limit(capLimit());
        if (cancelled) return;
        // null when the read failed, [] when the client genuinely has not
        // ticked anything today. The cached ticks stay on screen either way;
        // only the second is allowed to take them off it.
        const tickRows = serverRows<any>(error, data);
        if (tickRows === null) { setTicksStatus('error'); setHistory(null); setHistoryStatus('error'); }
        else {
          const page = capped(tickRows);
          // ── splitting one read into two answers ──────────────────────────
          //
          // The rows are one set; the CLAIMS over them are two, and they fail
          // independently. Today's ticks are complete whenever the read came
          // back, because they sort first. The history behind them is complete
          // only if nothing fell off the bottom.
          //
          // Folding those into one status is the mistake this split exists to
          // avoid: `status` (below) is what app/(client)/habits.tsx dashes its
          // hero on and what prints "Some of today's list is missing". A member
          // whose history is long would have read that sentence every day, over
          // a checklist that was complete.
          const windowRows: HabitTickRow[] = page.rows.map((r: any) => ({
            habit: String(r.habit),
            done_on: String(r.done_on ?? '').slice(0, 10),
          }));
          // The split itself is arithmetic, and it lives in
          // src/lib/habitStreaks.ts where it is asserted — including the
          // off-by-one that decides whether a run is a fact or a floor, and the
          // case where the truncation reaches today itself. An async effect is
          // no place to keep a rule nobody can run.
          const cover = tickReadCoverage(windowRows, day, windowFrom, page.truncated);
          setHistory({ rows: windowRows, coverFrom: cover.coverFrom });
          setHistoryStatus(page.truncated ? 'partial' : 'ready');
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
          //
          // TODAY's rows only. The read now spans a quarter, and every row in
          // it is a habit the member ticked on SOME day — feeding the lot into
          // the tick set would light up the checklist with anything they had
          // ever kept.
          const server = new Set(cover.todayHabits);
          for (const [habit, on] of pendingRef.current) { if (on) server.add(habit); else server.delete(habit); }
          applyDone(server);
          // Today is whole unless the truncation reached today itself — which
          // it only can if a thousand rows were all stamped today. That should
          // be impossible: the checklist is a dozen lines and the unique
          // constraint allows one row each. "Should be impossible" is what this
          // codebase's rowCap.ts exists because of, so it is CHECKED rather
          // than assumed, and the check is one string comparison.
          //
          // Note the asymmetry with `historyStatus` above, and that it is the
          // point: a truncated read leaves today's ticks whole and the history
          // short, and those are two different sentences to a member.
          setTicksStatus(cover.todayWhole ? 'ready' : 'partial');

          // And now they go up. A failure is neither fatal nor silent: the
          // toggle stays queued, stays counted in `unsent`, and is tried again
          // on the next launch.
          for (const [habit, on] of [...pendingRef.current]) {
            if (cancelled) return;
            // The day the toggle was made on, never the day it is being sent
            // on. `day` is this hydrate's own `today()`, which is right for the
            // toggles just read off the device: they were cached under it.
            settle(habit, on, await persist(id, habit, on, pendingDayRef.current.get(habit) ?? day));
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
        if (!cancelled) {
          setTicksStatus('error'); setCoachStatus('error'); setWaterStatus('error');
          // The history is dropped rather than left standing. Unlike the ticks
          // and the water count, there is no local copy of it to keep on
          // screen — what is in state came from a read that has now failed, and
          // showing a run from a previous read under a status saying the read
          // failed is a figure nobody can date.
          setHistory(null); setHistoryStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick, day]);

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
  //
  // ── THE THIRD CASE, AND WHY IT IS NOT LABELLED HERE ──────────────────────
  //
  // `planUnknown` has two answers and the read has three. `assigned.getProgram`
  // serves THIS DEVICE'S COPY when no read has landed, and goes on serving it
  // for thirty days (PROGRAM_HORIZON_MS, src/lib/programCache.ts). That copy
  // makes `coachProgram` non-null, so `planUnknown` is false, `status` below
  // rolls up as though the plan were confirmed, and `trainingFocus` names a
  // session off a block the coach may have replaced a fortnight ago. Nothing in
  // this provider's value says so. `assigned.cachedNote` is the sentence for
  // exactly that state, non-null for precisely as long as the copy is what is
  // being served (`mayServeCached` decides), and it is deliberately NOT added
  // to `HabitsValue`:
  //
  //   1. THIS FILE HAS NO SURFACE. It renders one thing — `<Ctx.Provider>` —
  //      and it wraps the tree. A <Flag> here would appear above every screen
  //      in the app, or nowhere, and the label has to sit beside the checklist
  //      row it is about. The two screens that already carry this sentence
  //      (app/(client)/week.tsx :194, app/(trainer)/client-week.tsx :437) both
  //      put it next to the rows it qualifies, which is a judgement only the
  //      screen can make.
  //
  //   2. THE CALL SITES ALREADY HAVE IT. `useAssignedPrograms` is a context
  //      hook, so any screen under the provider reads `cachedNote` directly.
  //      Re-publishing it through `HabitsValue` would be a second path to one
  //      string, kept in sync by hand, buying nothing.
  //
  // It does not belong in `status` either: 'error' means "we could not find
  // out", and a copy read off this phone is not that — it is an answer, an old
  // one, and the whole point of the note is to say which.
  //
  // So it belongs at the call site that draws the checklist —
  // app/(client)/habits.tsx, which renders `habits` and `gaps` — as
  // `useAssignedPrograms().cachedNote` beside the training row.
  const planUnknown = !solo && assigned.status === 'error' && coachProgram == null;
  const program = planUnknown ? null : ((solo ? null : coachProgram) ?? buildProgram(c.goal, c.bodyFatPct));
  // The week of the block they are on, not week one for ever. The checklist
  // names today's session, and one naming week one's session while the Train
  // tab shows week five's is the app disagreeing with itself about what
  // somebody owes today. `useClientWeek` is the one rule all of them read.
  const blk = useClientWeek(program, c.id);
  const trainingFocus = program ? scheduledFocus(blk.days, new Date().getDay()) : null;

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

  /**
   * The member's run on each habit.
   *
   * Derived, not stored, for the reason `freezeBudget` is derived in
   * src/lib/streaks.ts rather than persisted: two places computing the same run
   * is how two answers happen. The arithmetic lives in src/lib/habitStreaks.ts
   * and is pure, so it is asserted under five timezones rather than reasoned
   * about here.
   *
   * `day` is the member's own day from `useToday()` — never a clock read at the
   * moment this runs, and never `new Date().toISOString()`. It is in the
   * dependency list, so a phone left open across midnight re-counts every run
   * against the day the member is actually in.
   *
   * Null when the history was not read. Not `[]`: see `streaks` on
   * `HabitsValue`.
   */
  const streaks = useMemo<HabitStreak[] | null>(
    () => (history ? habitStreaks(history.rows, day, { coverFrom: history.coverFrom }) : null),
    [history, day],
  );

  // Every way the list on screen can be short of, or ahead of, what the server
  // holds. The macro and plan cases are new with the derived list: a row that
  // is missing because a read failed is not a row the client left unticked.
  // `c.profileStatus === 'error'` was the one hole left in this roll-up, and it
  // is the one that silently SHORTENS the list. `stepGoal`, `sleepGoalHours`
  // and `waterGoalGlasses` come from the `clients` select and from nowhere else
  // — there is no local cache of them under USE_SUPABASE — so when that select
  // fails while `scans` succeeds, the water, steps and sleep rows simply are
  // not built. The screen then drew a filled arc and "100% · 2 of 2 done" over
  // a list missing three lines, and told a member with a 10,000-step goal on
  // record that they had no daily goal. A shorter list read as a finished day.
  //
  // `historyStatus` is deliberately NOT in this roll-up. It is the one read
  // here that can be truncated by a member simply having used the app for a
  // long time, and `status` is what three screens gate TODAY's figures on —
  // see the note on `historyStatus` in `HabitsValue`. Adding it would put
  // "Some of today's list is missing" over a complete list, permanently, for
  // the members with the longest records.
  const status = worst(
    ticksStatus,
    coachStatus,
    macrosUnknown ? 'error' : 'ready',
    planUnknown ? 'error' : 'ready',
    c.profileStatus === 'error' ? 'error' : 'ready',
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
   *
   * `day` is passed in and never read from the clock here. It is the day the
   * member made the toggle on, which is not the day a queued one is sent on —
   * see `pendingDayRef` for what reading `today()` on this line did to a
   * checklist worked through before midnight and flushed after it.
   */
  const persist = async (owner: string, id: string, done: boolean, day: string): Promise<WriteOutcome> => {
    try {
      if (done) {
        const { data, error } = await supabase.from('habit_logs')
          .upsert({ user_id: owner, habit: id, done_on: day }, { onConflict: 'user_id,habit,done_on' })
          .select('habit');
        return classifyWrite(error as any, data ? data.length : 0);
      }
      const { data, error } = await supabase.from('habit_logs')
        .delete().eq('user_id', owner).eq('habit', id).eq('done_on', day)
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

  /**
   * Offer the toggles the server has not accepted, again.
   *
   * A tick is a toggle rather than a row, so what is queued here is the last
   * state the member chose for each habit — `settle` is what takes it out of
   * `pendingRef` once the server agrees, or puts the tick back when the server
   * refuses. Replaying the map is therefore idempotent in the way an insert
   * queue is not: offering "this habit is done today" twice writes one row.
   *
   * Lifted out of the hydrate, which was the only thing that ran it. A
   * checklist worked through in a basement gym sat unsent until the next launch
   * that landed here; it now also goes on the reconnect edge and on returning
   * to the foreground, through src/lib/offlineQueue.ts · `flushAll`.
   *
   * Today's water count is deliberately NOT part of this. It is an upsert of a
   * single number that `mergeCount` reconciles against the server's own on the
   * next hydrate, and pushing it from here would race that reconciliation with
   * no more recent information than it already has.
   */
  const flushQueue = async (): Promise<void> => {
    const owner = uidRef.current;
    if (!USE_SUPABASE || !owner) return;
    for (const [habit, on] of [...pendingRef.current]) {
      // The day the member ticked it, not the day this flush is running on.
      // See `pendingDayRef`: this is the queue whose stamp used to be taken at
      // send time, and a flush fires on the walk home, which is often the other
      // side of midnight from the gym.
      const out = await persist(owner, habit, on, pendingDayRef.current.get(habit) ?? today());
      settle(habit, on, out);
      // Stop at the first silence: the rest would meet the same one, and every
      // attempt past it is a toggle re-offered to a connection that is not
      // there.
      if (out === 'unsent') return;
    }
  };

  useEffect(() => registerFlush('habits', flushQueue), []);

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
    const out = await persist(uidRef.current, id, nd, pendingDayRef.current.get(id) ?? today());
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
    void persist(owner, 'water', true, pendingDayRef.current.get('water') ?? today())
      .then((out) => settle('water', true, out));
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
    // ── nothing is counted from a base that has not arrived ──────────────
    //
    // `waterRef.current` starts at 0 and the first read is what fills it, so a
    // tap while `waterStatus` is 'loading' computes 0 + 1 — and `pushWater`
    // upserts an ABSOLUTE count for the day, not a delta. A member who logged
    // five glasses on another device this morning, opens this screen and taps
    // once before the read lands, therefore writes 1 over their 5, server-side,
    // and the four glasses are gone.
    //
    // Refused rather than queued, because a delta applied later would need to
    // survive a read that never lands at all. Both screens that offer this
    // control disable it while the read is in flight and say why, so the tap is
    // not silently dropped — this is the backstop for the one that forgets.
    if (waterStatus === 'loading') return;
    // Local, cached, then sent — in that order, and never conditional on the
    // send. The count on screen is this device's tally and it is real whether
    // or not the server hears about it; `waterStatus` is where "the server has
    // not confirmed this" is recorded, not in a glass that refuses to fill.
    const next = clampGlasses(waterRef.current + 1);
    const hit = waterRef.current !== next;
    waterRef.current = next;
    setWater(next);
    cacheWater(next, new Date().toISOString());
    if (uidRef.current && USE_SUPABASE) void pushWater(uidRef.current, dayRef.current, next);
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
    // The same guard as `addWater`, and for the same reason: this device may
    // have restored a cached count before the server read landed, so
    // `waterRef.current - 1` can be a real number computed from a stale base
    // and `pushWater` writes it as the absolute count for the day.
    if (waterStatus === 'loading') return;
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
    if (uidRef.current && USE_SUPABASE) void pushWater(uidRef.current, dayRef.current, next);
  };
  // Counted over today's list, not over doneIds: a tick against an item the
  // coach has since retired is still in habit_logs and would otherwise push the
  // count past the number of rows on screen.
  const doneCount = habits.filter((h) => h.done).length;

  // ── Why the implementations below are handed out through a ref ────────────
  //
  // This provider used to publish an inline object literal, so `useHabits`
  // returned a different value on every render — and every function on it was a
  // different function again. The consumer that writes the obvious thing,
  // `useFocusEffect(useCallback(() => { x.toggleHabit(); }, [x]))`, then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, the call re-runs the fetch, the fetch ends in a setState, the
  // provider re-renders, and both identities are new again. src/ui/roster.tsx
  // documents that at length and is the pattern this follows.
  //
  // The wrappers are created once and read the current implementations out of a
  // ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze that state with them, which is the same bug one
  // level down.
  const impl = useRef({ toggleHabit, addWater, removeWater });
  impl.current = { toggleHabit, addWater, removeWater };
  const toggleHabitStable = useCallback((...a: Parameters<typeof toggleHabit>) => impl.current.toggleHabit(...a), []);
  const addWaterStable = useCallback((...a: Parameters<typeof addWater>) => impl.current.addWater(...a), []);
  const removeWaterStable = useCallback((...a: Parameters<typeof removeWater>) => impl.current.removeWater(...a), []);
  const value = useMemo<HabitsValue>(() => ({ habits, toggleHabit: toggleHabitStable, status, gaps, doneCount, water, waterGoal, waterStatus, addWater: addWaterStable, removeWater: removeWaterStable, unsent: pendingCount, reload, streaks, historyStatus, historyDays: STREAK_WINDOW_DAYS }), [habits, toggleHabitStable, status, gaps, doneCount, water, waterGoal, waterStatus, addWaterStable, removeWaterStable, pendingCount, reload, streaks, historyStatus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHabits(): HabitsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHabits must be used inside <HabitsProvider>');
  return v;
}
