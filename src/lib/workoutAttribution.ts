// How "who logged this" should read, on either app.
//
// Separate from `coachLog.ts` for the same reason `coachExerciseList.ts` is
// separate from the hook beside it: that module constructs the Supabase client
// at import time, which cannot happen under tsconfig.test.json — plain node
// with no EXPO_PUBLIC_ env fails with "supabaseUrl is required". The part worth
// asserting on has no runtime dependencies.
import type { WorkoutEntry } from './mockData';

/** The logged-by line for a workout, or null when the person logged it themselves. */
export function attributionLine(
  e: Pick<WorkoutEntry, 'loggedBy' | 'amendedAt'>,
  coachName: string | null,
  viewerIsTheClient: boolean,
): string | null {
  if (!e.loggedBy) return null;
  const who = coachName?.trim() || 'your coach';
  const by = viewerIsTheClient ? `Logged by ${who}` : 'Logged by you';
  if (!e.amendedAt) return by;
  const when = new Date(e.amendedAt);
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : ` on ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  // Said plainly on both sides. The coach needs to know their account of the
  // session was changed; the client needs to know their change is visible.
  return `${by} · amended by ${viewerIsTheClient ? 'you' : 'them'}${stamp}`;
}
