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
// `fetchPlannedDays` returns null when the read failed and `[]` when the client
// genuinely has nothing marked. The screen must keep those apart: "nothing
// planned yet — tap a day" put in front of somebody who planned their whole
// month is the same class of lie as "0 sessions left" to a client holding ten.
// See src/ui/loadStatus.ts.
import { supabase } from './supabase';
import { reportError } from './reportError';
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

/**
 * Every day this client has marked.
 *
 * The whole set rather than a month's window: a client's plans are a handful of
 * rows, and paging them by the month on screen would mean a read on every
 * arrow-tap and a blank grid whenever one of those failed.
 */
export async function fetchPlannedDays(): Promise<PlannedDay[] | null> {
  const uid = await myId();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('planned_days')
    .select('on_date, day_type, note')
    .eq('client_id', uid);
  if (error) { reportError('plannedDays.fetch', error); return null; }
  const rows = (data ?? []) as unknown as Row[];
  // A row whose type this build does not recognise is dropped, not defaulted.
  // Coercing it to 'off' would show the client a Standard day where they had
  // marked something else — the app inventing an answer about their own plan.
  return rows
    .filter((r) => isPlannedDayType(r.day_type))
    .map((r) => ({ dateISO: String(r.on_date).slice(0, 10), type: r.day_type as PlannedDayType, note: r.note ?? null }));
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
  const { error } = await supabase
    .from('planned_days')
    .delete()
    .eq('client_id', uid)
    .eq('on_date', dateISO);
  if (error) { reportError('plannedDays.clear', error); return { ok: false, error: error.message }; }
  return { ok: true };
}
