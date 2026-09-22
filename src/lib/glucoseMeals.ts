// Which meals a glucose pairing is allowed to be drawn against.
//
// This is the judgement that used to live inside a `useMemo` in
// src/ui/glucoseData.ts, where nothing could reach it. It is here because the
// two halves of the meal set fail in opposite directions and neither failure
// looks like an error on screen — the pairing simply comes out wrong, quietly,
// against a number somebody is managing their insulin by.
//
// ── why the server read alone is not the meal set ──────────────────────────
//
// `pastRevision` only causes a RE-READ of the server's `food_logs`. A meal
// back-dated with no signal sits in the food provider's `owed` queue and has
// never reached the server, so no number of re-reads can return it. Only the
// merge below can.
//
// ── why the device's queue alone is not the meal set ───────────────────────
//
// `owed` fails at the moment of success. When a flush lands the row the
// provider drops it from `owed`, so the meal then exists only on the server —
// and without the `pastRevision`-keyed re-read the pairing would lose the meal
// exactly when the member was told it was saved. The two are not alternatives
// and neither is a fallback for the other; the set is the union.
//
// ── why it matters more here than in a day total ───────────────────────────
//
// `pairMeals` closes each meal's window at the NEXT meal. A missing dinner
// does not just lose its own row: it leaves lunch's window open across the
// evening and hands lunch the rise that dinner caused. One absent meal
// misattributes another meal's number.
//
// ── whose meals these are ──────────────────────────────────────────────────
//
// The device's queue belongs to the SIGNED-IN account. A coach reading a
// client contributes nothing from it, because merging the coach's own
// breakfast into a client's pairing would be inventing a meal for somebody
// else. `mealReadRevision` is the same rule applied to the re-read trigger: a
// coach's own back-dated dinner must not re-read a client's meals.
import { type MealRef } from './glucose';
import { isPending } from './wellnessSync';

/**
 * A meal as the device's food log holds one — the fields this merge needs.
 *
 * `carbs` may be null: a meal logged without them is a meal, and a zero here
 * would be a carb count nobody entered.
 */
export interface HeldMeal {
  id: string;
  /** ISO timestamp. */
  at: string;
  name: string;
  carbs: number | null;
}

/** Everything the meal set is decided from. */
export interface MealSetFacts {
  /** True when these are somebody else's readings — a coach reading a client. */
  readOnly: boolean;
  /**
   * Start of the window the server read actually asked for, in ms.
   *
   * Null until one has been asked, which is a real state and not a zero: with
   * no window read there is nothing to hold the device's own meals to, and a
   * fortnight counted again from a clock read here would be a second window
   * disagreeing with the first.
   */
  windowSince: number | null;
  /** The provider's `owed` queue: back-dated and left-over rows. */
  owed: HeldMeal[];
  /** Everything the provider is showing, pending and stored alike. */
  entries: HeldMeal[];
  /** What the server's read returned. */
  serverMeals: MealRef[];
}

/**
 * The meals this device is holding that the server has not accepted.
 *
 * Both kinds, and neither can reach the server read however often it runs:
 * `owed` is the back-dated and left-over rows, `entries` filtered to
 * `isPending` is today's, logged with no signal. A row with a `local:` id has
 * never been stored, so merging it cannot double-count against the server's
 * copy — and the moment one IS stored the food log drops it from the queue and
 * bumps `pastRevision`, which re-reads.
 *
 * Empty for a coach, and empty before a window has been asked for.
 *
 * Held to the window the READ asked for. The food queue never expires a row
 * for age, so a meal owed from a month ago is a real row this device is still
 * carrying — it belongs in the food log rather than in a fortnight of glucose
 * pairing. A row whose timestamp will not parse is dropped rather than placed
 * at the epoch, which would hand it to the oldest reading on the chart.
 */
export function heldMeals(f: MealSetFacts): MealRef[] {
  if (f.readOnly || f.windowSince == null) return [];
  const since = f.windowSince;
  const held: HeldMeal[] = [...f.owed, ...f.entries.filter((e) => isPending(e.id))];
  return held
    .filter((e) => {
      const t = Date.parse(e.at);
      return Number.isFinite(t) && t >= since;
    })
    .map((e) => ({ id: e.id, name: e.name, loggedAt: e.at, carbs: e.carbs }));
}

/**
 * The full meal set a pairing runs over: what this device is still carrying,
 * then what the server returned.
 *
 * The server's list is handed back unchanged when the device holds nothing, so
 * the common case allocates nothing and the pairing sees the same array
 * identity it saw last time.
 */
export function mealsForPairing(f: MealSetFacts): MealRef[] {
  const held = heldMeals(f);
  return held.length ? [...held, ...f.serverMeals] : f.serverMeals;
}

/**
 * The revision number the server meal read is keyed on.
 *
 * Zero for a coach. The food provider's `pastRevision` counts the signed-in
 * account's own accepted back-dates and flushes, and letting a coach's own
 * back-dated dinner re-read a CLIENT's meals would be one person's food log
 * driving another person's chart. The value is never shown; only its change
 * matters, and a constant never changes.
 */
export function mealReadRevision(readOnly: boolean, pastRevision: number): number {
  return readOnly ? 0 : pastRevision;
}
