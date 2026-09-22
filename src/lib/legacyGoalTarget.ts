// The pre-server target weight, and why it is dropped rather than scoped.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// Before goals lived in `goal_targets`, a client's one target weight and date
// were held in AsyncStorage under 'repple.goalTarget'. src/ui/goalTracker.tsx
// kept a `migrateLegacyTarget` that moved that blob up exactly once, and the
// line that did it was:
//
//   const old = JSON.parse(raw) as { targetWeightKg?: number; … };
//   await supabase.from('goal_targets').insert({ client_id: who, kind: 'weight',
//                                                target_value: kg, … });
//
// `who` is whichever uid `supabase.auth.getUser()` resolved on that launch. The
// key carries no account. So this is not the ordinary inheritance of a stale
// preference — it is a device-global blob being WRITTEN TO THE SERVER under a
// freshly-resolved stranger's id, and it is the only member of this key class
// found so far that reaches a server table at all.
//
// On a shared handset the sequence is short and entirely ordinary. Member A set
// a target weight on an older build and never opened the app again after the
// goals release. Member B signs in on the same phone. The migration has never
// run, so the guard key is absent; the server has no weight goal for B, so
// nothing contradicts it; B's `goal_targets` gets a row saying their target
// weight is A's number.
//
// A goal target is the DENOMINATOR of every progress figure the coach reads —
// `progressOf` in src/lib/goalTargets.ts divides by it, `projectionOf` dates
// against it, and src/lib/goalOnBody.ts prints the remainder on the body screen.
// So the coach is not looking at a wrong preference. They are looking at a
// percentage, computed correctly, about a target the member never set.
//
// The reverse case is quieter and is the same fault: A signs in first, the
// migration runs and writes the guard key, and the guard key is device-global
// too — so the migration is now spent for everybody on that handset, and B's own
// legacy target, if it were theirs, would never move.
//
// ── Why there is no scoped key here ───────────────────────────────────────
//
// The rest of this class is repaired by putting the account in the key
// (src/lib/mealSwaps.ts, src/lib/handsetClips.ts, src/lib/clientModeOverrides.ts).
// That repair does not apply to this one, and pretending otherwise would leave a
// key nothing could ever fill: 'repple.goalTarget' has had NO WRITER since goals
// moved to the server. A grep of the tree finds the two strings below and
// nothing else — both of them reads, both in the migration. Scoping a key that
// is only ever read is a key that is always empty.
//
// So the fix is the second half of the class's repair on its own: the blob is
// removed UNREAD, and the migration is gone.
//
// ── What that costs, stated rather than glossed ───────────────────────────
//
// A single-owner handset that still holds a pre-goals target loses it, and the
// member re-enters a number on the goals screen. That is the real price and it
// is paid knowingly, because the blob carries no account and a migration is
// therefore a guess: nothing on the device tells a sole owner's old target apart
// from a shared handset's previous member's. Guessing right saves one member one
// number. Guessing wrong publishes somebody else's target weight to a coach as
// if the member had chosen it, and — unlike every other key in this class — it
// publishes it to the SERVER, where a re-read cannot take it back and only a
// deletion the member has to think to make will.
//
// Both keys are named here, rather than inline in the provider, so the removal
// is a stated decision with its reasoning attached and so the sign-out test can
// assert that neither ever became an entry in `PERSONAL_DEVICE_KEYS` or a
// scoped prefix.
//
// Pure: two strings and a rule. src/ui/goalTracker.tsx does the removal.

/** Where one target weight and one date used to live. Removed on sight, never
 *  read — see the header. */
export const LEGACY_GOAL_TARGET_KEY = 'repple.goalTarget';

/** The flag that said the migration above had already run. Device-global like
 *  the blob it guarded, so it was spent for every account on the handset by
 *  whoever signed in first. It goes with the blob. */
export const LEGACY_GOAL_TARGET_MIGRATED_KEY = 'repple.goalTarget.migrated';

/**
 * The keys a launch drops without reading them.
 *
 * A list rather than two exports used at the call site, so the provider's
 * removal cannot quietly lose one of them and so the test has one thing to
 * assert against.
 */
export const LEGACY_GOAL_TARGET_KEYS: readonly string[] = [
  LEGACY_GOAL_TARGET_KEY,
  LEGACY_GOAL_TARGET_MIGRATED_KEY,
];

/** Whether a key is one of the two above. For the sign-out assertion, which
 *  needs to say that a dropped key is neither cleared as a personal device key
 *  nor scoped as if it had a writer. */
export const isLegacyGoalTargetKey = (k: string): boolean =>
  typeof k === 'string' && LEGACY_GOAL_TARGET_KEYS.includes(k);
