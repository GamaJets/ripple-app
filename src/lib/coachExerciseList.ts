// Merging a coach's own exercise names with the built-in list.
//
// Deliberately here and not beside the hook in `src/ui/coachExercises.ts`.
// That module constructs the Supabase client at import time, which cannot
// happen under `tsconfig.test.json` — the test runner is plain node with no
// EXPO_PUBLIC_ env, and importing it fails with "supabaseUrl is required".
// The rule this codebase already follows: the part worth asserting on has no
// runtime dependencies, so it can be tested without standing anything up.

export interface CoachExercise { name: string; group: string }

const byName = (a: CoachExercise, b: CoachExercise) => a.name.localeCompare(b.name);

/**
 * The picker's list: the coach's own names first, alphabetically, then the
 * built-ins in their own order.
 *
 * A saved name that duplicates a built-in appears once, matched case-
 * insensitively — "bench press" and "Bench Press" are the same exercise to
 * everyone except a string comparison. The coach's spelling is the one kept,
 * because they chose it.
 */
export function mergeExerciseLists(
  saved: CoachExercise[],
  builtIn: CoachExercise[],
): CoachExercise[] {
  const seen = new Set(saved.map((x) => x.name.toLowerCase()));
  return [...[...saved].sort(byName), ...builtIn.filter((x) => !seen.has(x.name.toLowerCase()))];
}
