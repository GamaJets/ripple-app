// Reading and writing `coach_prefs` (part 129) — the coach's own settings,
// which until now never left the handset.
//
// The sibling of src/lib/coachPrefs.ts, which holds the arithmetic. This half
// touches supabase and so is deliberately not under `npm test`.
//
// ── The shape of every answer here ─────────────────────────────────────────
//
// Each read returns `{ prefs, status }` and never a bare value, for the reason
// src/ui/loadStatus.ts sets out at length: supabase-js RESOLVES on a database
// error, so `const { data } = …; return data` turns a refusal into a confident
// "you have not set one". On this table that would put an empty rate box and an
// empty goals section in front of a coach who has set both — and the empty box
// is then typed into and saved, overwriting what was there.
//
//   'ready' — the server answered. A null field under 'ready' genuinely is unset.
//   'error' — the read failed or was refused. A null field means UNKNOWN.
//
// There is no 'partial': every read here is a single row by primary key.
//
// ── Writes are never blind ─────────────────────────────────────────────────
//
// `upsert` with the uid in the payload, so the row is created on first write
// and the RLS `with check (user_id = auth.uid())` is what decides it may exist.
// The return is a boolean the caller may act on rather than a promise it may
// ignore — a settings screen that cannot say "not saved" will say "saved".
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { reportError } from './reportError';
import type { LoadStatus } from '../ui/loadStatus';
import type { Diet, Goal } from './types';
import { asOwnDiet, asOwnGoal } from './coachMacros';

/** The row, in the app's own vocabulary. Every field nullable: null means the
 *  coach has not set that one, which is not zero. */
export interface CoachPrefs {
  classRate: number | null;
  goalRevenue: number | null;
  goalClients: number | null;
  /**
   * The shortest gap the coach will accept between two approaches to the same
   * client, in days. Null means "use the app's own floor" — see `cooldownFloor`
   * in src/lib/interventions.ts, which refuses anything outside 1..365 rather
   * than clamping it, because honouring a stored 0 would prompt daily.
   *
   * Not zero-as-unset, for the same reason `class_rate` is not: a coach who
   * cleared the box has asked for the app's own pacing back, and a coach who
   * typed a number has asked for theirs. Those are different requests.
   */
  nudgeCooldownDays: number | null;
}

export const EMPTY_PREFS: CoachPrefs = {
  classRate: null, goalRevenue: null, goalClients: null, nudgeCooldownDays: null,
};

/** `numeric` arrives from PostgREST as a string often enough to matter. A
 *  silent NaN here becomes a rate box showing "NaN" or a bar drawn at zero. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * This account's prefs.
 *
 * Signed out, or the backend switched off, is 'ready' with nothing in it: there
 * is no absent server to misreport, and the device cache above this is the
 * whole story. That matches the rule in src/ui/loadStatus.ts rather than
 * inventing a fourth state for it.
 */
export async function fetchCoachPrefs(): Promise<{ prefs: CoachPrefs; status: LoadStatus }> {
  if (!USE_SUPABASE) return { prefs: EMPTY_PREFS, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { prefs: EMPTY_PREFS, status: 'ready' };
    const { data, error } = await supabase
      .from('coach_prefs')
      .select('class_rate, goal_revenue, goal_clients, nudge_cooldown_days')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      reportError('coachPrefs.read', error);
      return { prefs: EMPTY_PREFS, status: 'error' };
    }
    // maybeSingle: no row is an absence, not a fault. A coach who has never set
    // anything has no row, and that is 'ready' with three nulls.
    const row = (data ?? null) as {
      class_rate?: unknown; goal_revenue?: unknown; goal_clients?: unknown; nudge_cooldown_days?: unknown;
    } | null;
    return {
      prefs: {
        classRate: num(row?.class_rate),
        goalRevenue: num(row?.goal_revenue),
        goalClients: num(row?.goal_clients),
        nudgeCooldownDays: num(row?.nudge_cooldown_days),
      },
      status: 'ready',
    };
  } catch (e) {
    reportError('coachPrefs.read', e);
    return { prefs: EMPTY_PREFS, status: 'error' };
  }
}

/**
 * Write the named fields and leave the rest of the row alone.
 *
 * Only the keys present in `patch` are sent. That matters because the check-in
 * screen and the analytics screen write different halves of the same row, and a
 * full-row upsert from either would set the other's columns to null — a coach
 * saving a class rate would silently clear the targets they set last week.
 *
 * `undefined` means "not touching this"; an explicit `null` means "unset it",
 * which is what an emptied rate box asks for. The two are different requests
 * and the signature keeps them apart.
 *
 * Returns false on anything short of a confirmed write, including a zero-row
 * result: PostgREST does not treat writing nothing as an error, so the count is
 * checked rather than the absence of an error message.
 */
export async function saveCoachPrefs(patch: Partial<{
  classRate: number | null;
  goalRevenue: number | null;
  goalClients: number | null;
  nudgeCooldownDays: number | null;
  ownGoal: Goal | null;
  ownDiet: Diet | null;
  ownActivity: number | null;
}>): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false;
    const row: Record<string, unknown> = { user_id: uid, updated_at: new Date().toISOString() };
    if ('classRate' in patch) row.class_rate = patch.classRate;
    if ('goalRevenue' in patch) row.goal_revenue = patch.goalRevenue;
    if ('goalClients' in patch) row.goal_clients = patch.goalClients;
    if ('nudgeCooldownDays' in patch) row.nudge_cooldown_days = patch.nudgeCooldownDays;
    if ('ownGoal' in patch) row.own_goal = patch.ownGoal;
    if ('ownDiet' in patch) row.own_diet = patch.ownDiet;
    if ('ownActivity' in patch) row.own_activity = patch.ownActivity;
    // Nothing to say. Not a failure, but not a write either, and reporting it
    // as success would let a caller claim it saved something it never sent.
    if (Object.keys(row).length <= 2) return false;
    const { data, error } = await supabase
      .from('coach_prefs')
      .upsert(row, { onConflict: 'user_id' })
      .select('user_id');
    if (error) { reportError('coachPrefs.write', error); return false; }
    // A refused upsert can come back with no error and no rows. "We could not
    // check" is not "it saved", and this is the row a coach's pay is computed
    // from.
    if (!data || data.length === 0) {
      reportError('coachPrefs.write', new Error('upsert affected no rows'));
      return false;
    }
    return true;
  } catch (e) {
    reportError('coachPrefs.write', e);
    return false;
  }
}

/* ── the coach's own macro answers ─────────────────────────────────────────
 *
 * A SEPARATE read, and that is the whole design of it. `own_goal`, `own_diet`
 * and `own_activity` arrive with supabase/parts/1020, and a column PostgREST
 * cannot find fails the whole SELECT it appears in — so folding these three
 * into `fetchCoachPrefs` above would have taken the class rate and the monthly
 * targets down with them on every install running against a database where
 * that part has not been applied yet. One unapplied part must cost exactly the
 * feature it belongs to and nothing beside it.
 *
 * The same reasoning does NOT apply to the write: an upsert only names the
 * columns it is given, so `saveCoachPrefs` carries all seven safely.
 */
export async function fetchOwnMacroInputs(): Promise<{
  goal: Goal | null; diet: Diet | null; activity: number | null; status: LoadStatus;
}> {
  const NONE = { goal: null, diet: null, activity: null };
  if (!USE_SUPABASE) return { ...NONE, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ...NONE, status: 'ready' };
    const { data, error } = await supabase
      .from('coach_prefs')
      .select('own_goal, own_diet, own_activity')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      reportError('coachPrefs.readOwnMacros', error);
      return { ...NONE, status: 'error' };
    }
    const row = (data ?? null) as { own_goal?: unknown; own_diet?: unknown; own_activity?: unknown } | null;
    // Narrowed rather than cast. A value outside the three goals or the five
    // diets does not fail in `macrosFor` — it falls through to whatever its
    // last branch is and produces a plausible number for a diet nobody
    // follows, which is the same class of defect as the defaults these columns
    // replace.
    return {
      goal: asOwnGoal(row?.own_goal),
      diet: asOwnDiet(row?.own_diet),
      activity: num(row?.own_activity),
      status: 'ready',
    };
  } catch (e) {
    reportError('coachPrefs.readOwnMacros', e);
    return { ...NONE, status: 'error' };
  }
}
