// The signed-in person's own two rows, read once for everybody who needs them.
//
// ── What this replaces ────────────────────────────────────────────────────
//
// Five reads of `profiles` and two of `clients`, all of the same person, all on
// the same cold launch, each for a different slice of columns:
//
//   profiles   auth.tsx        full_name              (on verify, not launch)
//   profiles   tenant.tsx      role, tenant_id
//   profiles   clientData.tsx  full_name, avatar
//   profiles   settings.tsx    weight_unit, length_unit
//   profiles   invites.tsx     full_name
//   clients    clientData.tsx  the profile the member edits
//   clients    settings.tsx    weight_unit, length_unit
//
// Three of those read `full_name`. They landed at different moments and, on a
// bad connection, some landed and some did not — so for the length of a launch
// the app could hold three different answers to "what is this person called"
// and show a different one in the greeting, on the invite card and in the
// coach's thread list. Round trips are the cheap half of that complaint.
//
// Each read now goes through one request per row per launch. `src/lib/sharedRead.ts`
// holds the rules and the argument for the shape; the short version is that
// what is shared is the READ, not anybody's `LoadStatus`. Every caller is handed
// the same outcome — the row, or the error — and decides for itself what to
// publish. A provider still says 'error' when this fails, still under its own
// name, and no provider ever reports 'ready' because somebody else's read went
// well: the only thing it can be told is how THIS row's read went, which is a
// fact it needed anyway.
//
// ── Why a superset select and not a union of slices ───────────────────────
//
// One request has to name every column any caller wants, so this file names
// them all. That is a real trade: a column that does not exist yet would fail
// the read for all four callers rather than for one. Every column below is
// declared in supabase/setup.sql — `role`, `tenant_id`, `full_name` and `avatar`
// in the table itself, `weight_unit` and `length_unit` in part 82 — and
// `npm run check:schema` compares this list against both the repo's SQL and the
// live database on every preflight, which is what makes the trade safe to take.
//
// The lists are literal and local on purpose. check-schema.mjs resolves a
// select list only within the file that names it, so a select assembled from
// somewhere else is a select nothing compares against the database.
import { supabase } from '../lib/supabase';
import { createSharedRead, type ReadOutcome } from '../lib/sharedRead';

/** The whole of the signed-in account's own `profiles` row that anything in
 *  this app reads. Values are `unknown` where the column is free text the
 *  caller has to narrow — units are checked against a union before use. */
export interface MyProfileRow {
  role: string | null;
  tenant_id: string | null;
  full_name: string | null;
  avatar: string | null;
  weight_unit: unknown;
  length_unit: unknown;
}

/** The member's own `clients` row. Not every account has one — a coach and an
 *  owner have none, permanently and normally — so `null` here is an answer and
 *  not a failure. */
export interface MyClientRow {
  dob: unknown;
  height_cm: unknown;
  goal: unknown;
  diet: unknown;
  avoid: unknown;
  mode: unknown;
  trainer_id: unknown;
  injuries: unknown;
  focus_areas: unknown;
  manual_weight_kg: unknown;
  manual_body_fat_pct: unknown;
  manual_at: unknown;
  meals_per_day: unknown;
  step_goal: unknown;
  sleep_goal_hours: unknown;
  water_goal_glasses: unknown;
  weight_unit: unknown;
  length_unit: unknown;
}

const profiles = createSharedRead<MyProfileRow | null>();
const clients = createSharedRead<MyClientRow | null>();

/**
 * The account's own `profiles` row.
 *
 * `maybeSingle`, so a missing row comes back as `{ ok: true, value: null }`
 * rather than as PGRST116. Every account is supposed to have one — the
 * `handle_new_user` trigger inserts it — so a caller for whom its absence is a
 * failure has to say so itself; src/ui/clientData.tsx does, because it arms a
 * write off this read and must not do that over a row it never saw.
 */
export function readMyProfileRow(uid: string): Promise<ReadOutcome<MyProfileRow | null>> {
  return profiles.read(uid, async () => {
    const { data, error } = await supabase
      .from('profiles').select('role, tenant_id, full_name, avatar, weight_unit, length_unit')
      .eq('id', uid).maybeSingle();
    if (error) return { ok: false, error };
    return { ok: true, value: (data as MyProfileRow | null) ?? null };
  });
}

/**
 * The account's own `clients` row, or null where there is none.
 *
 * `maybeSingle` for the reason clientData.tsx already records at length:
 * `single()` calls no row PGRST116, having no `clients` row is the permanent
 * state of every coach and every gym owner, and treating that as a failure had
 * the whole coach app running on a profile read it believed had failed.
 */
export function readMyClientRow(uid: string): Promise<ReadOutcome<MyClientRow | null>> {
  return clients.read(uid, async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('dob, height_cm, goal, diet, avoid, mode, trainer_id, injuries, focus_areas, manual_weight_kg, manual_body_fat_pct, manual_at, meals_per_day, step_goal, sleep_goal_hours, water_goal_glasses, weight_unit, length_unit')
      .eq('id', uid).maybeSingle();
    if (error) return { ok: false, error };
    return { ok: true, value: (data as MyClientRow | null) ?? null };
  });
}

/**
 * Forget both rows, so the next reader goes to the server.
 *
 * Call it after ANY write to either row, and on a refresh a person asked for —
 * a pull-down, a retry button. Not calling it after a write is the one way this
 * can put a stale name back on a screen: the window is five seconds, so the
 * cost of forgetting to is small and brief, but a write followed by a re-read
 * is exactly the sequence that would hit it.
 *
 * No argument forgets every account's rows, which is what a sign-out wants.
 */
export function forgetMyRows(uid?: string): void {
  profiles.forget(uid);
  clients.forget(uid);
}
