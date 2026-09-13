// The meals a member swapped out of their own plan — and whose they are.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(client)/nutrition.tsx kept them under one unqualified AsyncStorage key,
// `repple.mealOverride`, keyed by nothing at all:
//
//   useEffect(() => { AsyncStorage.getItem('repple.mealOverride').then(…) }, []);
//   useEffect(() => { AsyncStorage.setItem('repple.mealOverride', …) }, [override]);
//
// That is the same shape src/lib/groceryTicks.ts was written to end, fifteen
// lines above it in the same file, for the same handset. A key with no account
// in it is a key the next account inherits: member B signs in on the gym's
// shared phone and the Meals tab hydrates member A's swaps into `override`,
// which goes straight into `buildPlan`'s `mealOverride` and composes B's day,
// B's seven-day week, B's grocery list and the plan document B shares.
//
// And the swaps do not merely travel — they CHANGE MEANING on the way. An
// override is a catalogue index, and `mealAt(diet, slot, idx, avoid)` resolves
// it through pools that the member's diet and exclusions have already filtered.
// Shrinking a pool renumbers everything after it, so index 412 under A's
// `avoid: []` and index 412 under B's `avoid: ['shellfish']` are two different
// dinners. B is not shown A's meal; B is shown whatever A's number happens to
// point at in B's catalogue, under B's own name. src/lib/mealPlan.ts spends its
// header on exactly this hazard for a COACH'S plan and answers it with
// `planStale`; the member's own swaps had no answer at all.
//
// The key was also outside `PERSONAL_DEVICE_KEYS` in src/lib/signOutState.ts,
// so signing out did not remove it.
//
// ── The fix ───────────────────────────────────────────────────────────────
//
// The account goes in the key. That is the whole of it, and it is enough: a key
// with the account in it is unreadable to the next account by construction,
// which is why src/lib/signOutState.ts does not need an entry for it and says
// so about every other per-account key.
//
// Not the week as well, unlike the grocery ticks. A shop is a thing you do once
// and finish; a swapped breakfast is a standing preference, and expiring it
// every Sunday would quietly undo a choice the member made on purpose.
//
// ── What is NOT migrated, and why ─────────────────────────────────────────
//
// The old global key is deleted rather than read into the signed-in account.
// Reading it would be the defect, performed once, deliberately: there is no way
// to tell a single-owner handset's old swaps from a shared handset's previous
// member's, and the cost of guessing wrong is the wrong week of food under
// somebody's own name. Guessing right saves a member re-tapping "Swap this
// meal" a few times. `LEGACY_MEAL_SWAPS_KEY` is exported so the screen can
// remove it and so the choice is visible to a reader rather than implied.

/** Every meal-swap key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const MEAL_SWAPS_PREFIX = 'repple.mealSwaps:';

/** The unqualified key this replaces. Removed on sight, never read — see the
 *  header. */
export const LEGACY_MEAL_SWAPS_KEY = 'repple.mealOverride';

/**
 * Where this member's swaps live.
 *
 * Null when there is no account to scope them to — a signed-out or
 * still-restoring session — and a null means DO NOT PERSIST. Falling back to a
 * shared key is the defect itself. Nothing is lost by not saving: a swap made
 * before anybody is signed in belongs to a plan that has no member behind it.
 */
export function mealSwapsKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx settles on before the auth
  // read lands. It is not an account and must never be used as one — every
  // signed-out session on a handset would share it.
  if (!id || id === 'unknown') return null;
  return `${MEAL_SWAPS_PREFIX}${id}`;
}

/** Whether a key holds somebody's meal swaps. For the sign-out assertion. */
export const isMealSwapsKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(MEAL_SWAPS_PREFIX);

/**
 * The swaps read back off a stored string: slot position → catalogue index.
 *
 * Every pair is checked rather than trusted, because both halves are fed to
 * arithmetic. `buildPlan` reads the key as a position and the value as an index
 * it resolves with `idx % size`; a `NaN` or a `"3"` from a blob that will not
 * parse the way it used to would come out the other side as a meal nobody
 * chose, or as no meal at all. The old code was a bare `JSON.parse` inside a
 * `try`, so anything that parsed at all was accepted whatever was in it.
 *
 * Anything unreadable is NO swaps. That is not a failed read being called an
 * empty one — a swap is a preference this device is the only copy of, and the
 * honest fallback for "we cannot tell what you chose" is the plan as the engine
 * composes it, which is what the member sees before they swap anything.
 */
export function readMealSwaps(raw: string | null | undefined): Record<number, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<number, number> = {};
    for (const [k, idx] of Object.entries(v as Record<string, unknown>)) {
      const pos = Number(k);
      if (!Number.isInteger(pos) || pos < 0) continue;
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) continue;
      out[pos] = idx;
    }
    return out;
  } catch { return {}; }
}

/** The swaps as they go to the store. The counterpart of `readMealSwaps`, so
 *  the two cannot drift. */
export function writeMealSwaps(swaps: Record<number, number>): string {
  return JSON.stringify(readMealSwaps(JSON.stringify(swaps ?? {})));
}
