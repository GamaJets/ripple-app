// The store behind TF-20's planned days. `planned_days`, one row per client per
// date (supabase/parts/62-day-types.sql).
//
// The vocabulary, the date arithmetic and everything that decides what a
// planned day MEANS are in src/lib/dayPlan.ts, which is pure and tested. This
// file is only the wire, and it is separate for the reason goalTargets.ts is
// separate from goalTracker.tsx: the part that can be quietly wrong is the
// reasoning, and reasoning that needs a Supabase client to reach is reasoning
// nothing tests.
//
// ── null is not an empty week ──────────────────────────────────────────────
//
// `fetchPlannedDays` returns `days: null` when the read failed and `[]` when the
// client genuinely has nothing marked. The screen must keep those apart: "nothing
// planned yet — tap a day" put in front of somebody who planned their whole
// month is the same class of lie as "0 sessions left" to a client holding ten.
// See src/ui/loadStatus.ts.
import { supabase } from './supabase';
import { reportError } from './reportError';
import { capLimit, capped } from './rowCap';
import { isPlannedDayType, type PlannedDay, type PlannedDayType } from './dayPlan';

/** How long a note may be, matching the CHECK on the column. Enforced here too
 *  so the client is told before the round trip rather than by a 400. */
export const PLAN_NOTE_MAX = 140;

interface Row { on_date: string; day_type: string; note: string | null }

async function myId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user?.id ?? null;
  } catch { return null; }
}

/** What a client's read of their OWN plans came back with.
 *
 *  `days` null means the read failed, on the rule in this file's header. The
 *  flag beside it is the second thing a screen has to know and used not to be
 *  carried at all — see `fetchPlannedDays`. */
export interface MyPlanRead {
  days: PlannedDay[] | null;
  /** True when the read came back at its row limit, so `days` is a PREFIX of
   *  the set. Feeds the 'partial' member of LoadStatus. */
  truncated: boolean;
}

/**
 * Every day this client has marked.
 *
 * The whole set rather than a month's window: a client's plans are a handful of
 * rows, and paging them by the month on screen would mean a read on every
 * arrow-tap and a blank grid whenever one of those failed.
 *
 * ── why this one is capped, when the window it reads is unbounded ──────────
 *
 * `fetchClientPlannedDays` below has carried `.order()`, `.limit(capLimit())`
 * and `capped()` since it was written, and its own comment says the guard
 * cannot fire today because three weeks of one client is not a thousand rows.
 * This read had none of the three, and it is the one with no window on it at
 * all — the read with MORE exposure to the ceiling had LESS protection than the
 * read with less. A member who has marked every day for three years crosses it,
 * and everything downstream then states the prefix as the whole plan: the grid
 * loses rings, the day panel says "Nothing on this day" over a day they marked
 * as rest, and "Planned Ahead" says "Nothing planned from today onwards".
 *
 * The `.order()` is not decoration either. Without it PostgREST cuts an
 * unordered set, so which thousand days come back is whatever the plan happened
 * to hand over — most likely the OLDEST, which is precisely the half of the
 * calendar nobody is looking at. Ordered ascending, a cut set at least loses the
 * far future rather than an arbitrary scatter, and the screen is told it was
 * cut. See src/lib/rowCap.ts.
 */
export async function fetchPlannedDays(): Promise<MyPlanRead> {
  const uid = await myId();
  if (!uid) return { days: null, truncated: false };
  const { data, error } = await supabase
    .from('planned_days')
    .select('on_date, day_type, note')
    .eq('client_id', uid)
    .order('on_date', { ascending: true })
    .limit(capLimit());
  if (error) { reportError('plannedDays.fetch', error); return { days: null, truncated: false }; }
  const page = capped((data ?? []) as unknown as Row[]);
  // A row whose type this build does not recognise is dropped, not defaulted.
  // Coercing it to 'off' would show the client a Standard day where they had
  // marked something else — the app inventing an answer about their own plan.
  const days = page.rows
    .filter((r) => isPlannedDayType(r.day_type))
    .map((r) => ({ dateISO: String(r.on_date).slice(0, 10), type: r.day_type as PlannedDayType, note: r.note ?? null }));
  return { days, truncated: page.truncated };
}

/** What a coach's read of somebody else's plans came back with.
 *
 *  `days` null means the read failed — the same distinction the header of this
 *  file draws for the client's own read, and it matters more here: a coach
 *  shown "they have marked nothing" about a client who has planned their
 *  fortnight will act on it, and the client never sees the screen that told
 *  them so. */
export interface ClientPlanRead {
  days: PlannedDay[] | null;
  /** True when the window came back at its row limit, so `days` is a prefix of
   *  the set. Feeds the 'partial' member of LoadStatus. */
  truncated: boolean;
  /** Rows this build could not read — a day_type written by a newer build.
   *  Counted rather than dropped in silence, because the day IS marked and the
   *  coach is looking at a screen that does not show it. */
  skipped: number;
}

/**
 * One client's planned days between two dates, for their coach.
 *
 * Reads under `planned_days_coach_read` (supabase/parts/62-day-types.sql),
 * which grants SELECT on `is_my_client(client_id)` and nothing else — so the
 * `eq` below chooses which of the coach's clients is on screen and is not what
 * decides who may be seen. There is deliberately no coach-side write anywhere
 * in this file: a plan is the client's statement of what they intend, and a
 * coach editing it would turn the client's own calendar into an assignment.
 *
 * Windowed, unlike the client's own read, because a coach opens this against
 * one client at a time and only ever looks at three weeks of it. `from`/`to`
 * are bare `YYYY-MM-DD` and are compared against a `date` column, so no
 * timezone enters the query — see src/lib/localDate.ts for what happens when
 * one does.
 */
export async function fetchClientPlannedDays(
  clientId: string,
  fromISO: string,
  toISO: string,
): Promise<ClientPlanRead> {
  const { data, error } = await supabase
    .from('planned_days')
    .select('on_date, day_type, note')
    .eq('client_id', clientId)
    .gte('on_date', fromISO)
    .lte('on_date', toISO)
    .order('on_date', { ascending: true })
    // Three weeks of one client cannot reach a thousand rows, so this cannot
    // fire today. It is here because the window is a constant somebody will
    // widen one day, and the failure it guards against is the silent one: a
    // truncated read looks exactly like a complete one, and nothing downstream
    // would have cause to doubt it. See src/lib/rowCap.ts.
    .limit(capLimit());
  if (error) {
    reportError('plannedDays.fetchForClient', error);
    return { days: null, truncated: false, skipped: 0 };
  }
  const page = capped((data ?? []) as unknown as Row[]);
  const days: PlannedDay[] = [];
  let skipped = 0;
  for (const r of page.rows) {
    // Same rule as the client's read: an unrecognised type is dropped, never
    // coerced. Showing a coach "Standard" where their client marked something
    // this build has not heard of is the app inventing somebody's plan.
    if (!isPlannedDayType(r.day_type)) { skipped++; continue; }
    days.push({ dateISO: String(r.on_date).slice(0, 10), type: r.day_type as PlannedDayType, note: r.note ?? null });
  }
  return { days, truncated: page.truncated, skipped };
}

/**
 * Mark a date, or change the mark already on it.
 *
 * Returns whether the server took it. Reporting a save that never landed is how
 * a client comes back a week later to a calendar that has forgotten the plan
 * they made — and unlike a failed read, there is nothing on screen afterwards
 * to hint at it.
 */
export async function savePlannedDay(
  dateISO: string,
  type: PlannedDayType,
  note: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const uid = await myId();
  if (!uid) return { ok: false, error: 'Not signed in.' };
  const trimmed = (note ?? '').trim().slice(0, PLAN_NOTE_MAX);
  const { error } = await supabase
    .from('planned_days')
    // The primary key is (client_id, on_date), so re-marking a day updates the
    // one row rather than adding a second answer for the same date.
    .upsert(
      { client_id: uid, on_date: dateISO, day_type: type, note: trimmed || null },
      { onConflict: 'client_id,on_date' },
    );
  if (error) { reportError('plannedDays.save', error); return { ok: false, error: error.message }; }
  return { ok: true };
}

/** Take the mark off a date entirely. */
export async function clearPlannedDay(dateISO: string): Promise<{ ok: boolean; error?: string }> {
  const uid = await myId();
  if (!uid) return { ok: false, error: 'Not signed in.' };
  // no-count-ok: taking a mark off a date that was never marked is the
  // outcome the member asked for. The screen shows no mark either way, so
  // there is nothing a row count could tell them that they cannot already see.
  const { error } = await supabase
    .from('planned_days')
    .delete()
    .eq('client_id', uid)
    .eq('on_date', dateISO);
  if (error) { reportError('plannedDays.clear', error); return { ok: false, error: error.message }; }
  return { ok: true };
}
