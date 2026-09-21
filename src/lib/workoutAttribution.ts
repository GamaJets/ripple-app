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
  e: Pick<WorkoutEntry, 'loggedBy' | 'amendedAt' | 'amendedBy'>,
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
  // WHO, since part 3230. Only two people can stamp a change: the member the
  // set is about, and the coach who logged it. So `amendedBy` equal to
  // `loggedBy` is the coach, and anything else is the member. Said from the
  // reader's side on both apps.
  //
  // No `amendedBy` means the change was stamped before that column existed.
  // Then we know THAT it changed and not who, and we say only what we know:
  // guessing would tell somebody they did a thing they may not have done.
  if (!e.amendedBy) return `${by} · changed after it was filed${stamp}`;
  const coachChangedIt = e.amendedBy === e.loggedBy;
  const changer = coachChangedIt
    ? (viewerIsTheClient ? who : 'you')
    : (viewerIsTheClient ? 'you' : 'your client');
  return `${by} · changed by ${changer}${stamp}`;
}
