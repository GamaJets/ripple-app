// The yogurt you eat every morning.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// A repo-wide grep for `favourite`, `favorite`, `recentFoods`, `frequentFoods`
// and `quick add` returned nothing. Every logging session started from an empty
// search box — including for the four things somebody eats every single day —
// so the cost of logging breakfast never came down, no matter how many times
// they logged it. That is most of the difference between a food diary that
// survives week two and one that does not.
//
// ── Two different memories, and they are not the same list ─────────────────
//
// RECENT is derived from the log itself. It needs no storage, no schema and no
// sync: the food history read is already on the screen, and "what did I log
// yesterday" is answered by the rows themselves. It follows a member to a new
// phone because it was never on the old one.
//
// FAVOURITE is chosen. It is the small list somebody pins on purpose, and it
// cannot be derived from anything — a food eaten twice a week is not
// necessarily one you want at the top of the screen, and the one you do want
// there might be the thing you are trying to eat more of.
//
// ── Why a favourite is a copy, not a reference ─────────────────────────────
//
// The remembered food carries its own macros rather than pointing at the log
// row it came from. The row can be corrected, deleted, or belong to a day that
// has scrolled out of the fortnight this app reads; a favourite that pointed at
// one would quietly become an empty row or, worse, follow a correction made for
// a different meal. What is pinned is the FOOD as it was logged, and re-logging
// it writes a new row of its own.
//
// ── And nothing here rounds anything ───────────────────────────────────────
//
// The figures pass through exactly as they were logged. Re-logging a favourite
// is the same write the first one was, so a member who logs the same yogurt
// four days running gets four identical rows rather than a slow drift.

/** What this module needs from a food-log entry. Declared structurally rather
 *  than imported from src/ui/foodLog.tsx, which pulls in React and Supabase —
 *  this file has to run under plain node for its test. A `FoodEntry`
 *  satisfies it. */
export interface LoggedFoodLike {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** ISO instant it was eaten. */
  at: string;
}

/** A food worth offering again. */
export interface RememberedFood {
  /** Stable across renders and across the two lists. The name IS the identity:
   *  a member who logs "Greek Yogurt (170 g)" twice has logged one food twice,
   *  and there is no id on a food log row that means anything to them. */
  key: string;
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** How many times it has been logged inside the window that was read. */
  count: number;
  /** The newest time it was logged, for ordering and for a date. */
  lastAt: string;
}

/** One key for one food. Case and spacing are flattened so "greek yogurt" and
 *  "Greek Yogurt" are one entry; nothing else is stripped, because "Greek
 *  Yogurt, 0%" and "Greek Yogurt, Full Fat" are two different foods and a
 *  normaliser aggressive enough to merge them would hide one behind the other. */
export function foodKey(name: string): string {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fold(entries: readonly LoggedFoodLike[]): Map<string, RememberedFood> {
  const by = new Map<string, RememberedFood>();
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    const key = foodKey(e.name);
    if (!key) continue;
    const at = typeof e.at === 'string' ? e.at : '';
    const cur = by.get(key);
    if (!cur) {
      by.set(key, {
        key, name: e.name.trim(),
        kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat,
        count: 1, lastAt: at,
      });
      continue;
    }
    cur.count += 1;
    // The NEWEST logging wins the figures and the spelling. A member who
    // corrected the calories on yesterday's portion meant the correction, and
    // offering them last month's number back is the app arguing with them.
    if (at && at > cur.lastAt) {
      cur.lastAt = at;
      cur.name = e.name.trim();
      cur.kcal = e.kcal; cur.protein = e.protein; cur.carbs = e.carbs; cur.fat = e.fat;
    }
  }
  return by;
}

/**
 * What was logged most recently, newest first, one row per food.
 *
 * Most recent rather than most frequent, because the commonest reason to reach
 * for this list is "the same again" — the thing eaten yesterday, this morning,
 * an hour ago. Frequency is the other list.
 */
export function recentFoods(entries: readonly LoggedFoodLike[], limit = 8): RememberedFood[] {
  return [...fold(entries).values()]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

/**
 * What was logged most often inside the window that was read.
 *
 * `minCount` is 2 by default and that is load-bearing: everything logged once
 * is already in `recentFoods`, and a "frequent" list that included one-offs
 * would be the same list twice under two headings.
 */
export function frequentFoods(entries: readonly LoggedFoodLike[], limit = 8, minCount = 2): RememberedFood[] {
  return [...fold(entries).values()]
    .filter((f) => f.count >= minCount)
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

/* ── the pinned list ──────────────────────────────────────────────────────── */

/** Per account, so signing in as somebody else on a shared gym phone cannot
 *  show one member another member's food. Same rule the food-log cache keeps. */
export const favouritesKey = (uid: string) => `repple.foodFavourites:${uid}`;

/** How many can be pinned. A cap, not a limit anybody will hit: the value of
 *  this list is that it is short enough to read without scrolling, and a
 *  member pinning their fortieth food has built a second search box. */
export const MAX_FAVOURITES = 20;

/**
 * Read the pinned list, and say whether it was actually read.
 *
 * The same pair src/lib/planEdits.ts and src/lib/workoutQueue.ts return, for
 * the same reason: `null` is a real answer — nothing has been pinned — and
 * bytes that will not parse are not. A caller that cannot tell them apart
 * writes an empty list over somebody's favourites the first time a parse fails.
 */
export function readFavourites(raw: string | null | undefined): { foods: RememberedFood[]; read: boolean } {
  if (raw == null) return { foods: [], read: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { foods: [], read: false }; }
  if (!Array.isArray(parsed)) return { foods: [], read: false };
  const foods: RememberedFood[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const nums = ['kcal', 'protein', 'carbs', 'fat'] as const;
    if (!name || !nums.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number))) continue;
    foods.push({
      key: foodKey(name), name,
      kcal: r.kcal as number, protein: r.protein as number, carbs: r.carbs as number, fat: r.fat as number,
      count: typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : 1,
      lastAt: typeof r.lastAt === 'string' ? r.lastAt : '',
    });
  }
  return { foods, read: true };
}

export function writeFavourites(list: readonly RememberedFood[]): string {
  return JSON.stringify(list.slice(0, MAX_FAVOURITES));
}

export function isFavourite(list: readonly RememberedFood[], name: string): boolean {
  const k = foodKey(name);
  return !!k && list.some((f) => f.key === k);
}

/**
 * Pin a food, or unpin it. One function, because it is one control.
 *
 * A food pinned again REPLACES the pinned copy rather than being ignored: the
 * figures may have been corrected since, and the pinned copy is a copy for the
 * reason the header gives.
 */
export function toggleFavourite(list: readonly RememberedFood[], food: RememberedFood): RememberedFood[] {
  const k = foodKey(food.name);
  if (!k) return [...list];
  if (list.some((f) => f.key === k)) return list.filter((f) => f.key !== k);
  return [{ ...food, key: k }, ...list.filter((f) => f.key !== k)].slice(0, MAX_FAVOURITES);
}
