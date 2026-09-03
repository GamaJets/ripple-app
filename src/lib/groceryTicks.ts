// Which items on the grocery list are already in the trolley — and whose, and
// for which week.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// The ticks were stored under one unqualified key, `repple.grocery.checked`,
// keyed by nothing: not by week, not by plan, not by account. The item keys are
// department plus item name — 'Produce|Spinach' — so spinach ticked three weeks
// ago was still ticked the next time spinach was on the list.
//
// The member opens the list in the shop and it says 12 of 30 in cart before
// they have picked anything up, with the progress bar above it agreeing. The
// twelve that are ticked are last week's staples, which are exactly the things
// they still need — so the list quietly hides the items most likely to be
// forgotten and tells them they are nearly done.
//
// And because the key carried no account, it was outside PERSONAL_DEVICE_KEYS
// in src/lib/signOutState.ts and survived a sign-out: the next person on a
// shared handset inherited somebody else's shop.
//
// ── The fix, and why the key shape is the whole of it ─────────────────────
//
// Account AND week. Both scopes are needed and they close different holes: the
// account stops a handset carrying one person's ticks into another person's
// session, and the week stops this week's list opening half-ticked from last
// week's. A key with the account in it is also, by construction, unreadable to
// the next account — which is why src/lib/signOutState.ts does not have to
// grow an entry for it, and says so about every other per-account key.

/** Every grocery-tick key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const GROCERY_TICKS_PREFIX = 'repple.grocery.checked:';

/**
 * Where this member's ticks for this week live.
 *
 * Null when there is no account to scope it to — a signed-out or
 * still-restoring session — and a null means DO NOT PERSIST. Falling back to a
 * shared key is exactly the defect: ticks written with no account are ticks the
 * next account inherits. Nothing is lost by not saving them, because a list
 * ticked before anybody is signed in has no shop behind it.
 *
 * `weekKey` is the local `YYYY-MM-DD` of the week's first day, which the app
 * takes as Sunday (`WEEK_STARTS_ON`). The week rolls, the ticks go with it.
 */
export function groceryTicksKey(uid: string | null | undefined, weekKey: string): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  const wk = typeof weekKey === 'string' ? weekKey.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx settles on before the auth
  // read lands. It is not an account and must never be used as one — every
  // signed-out session on a handset would share it.
  if (!id || id === 'unknown' || !wk) return null;
  return `${GROCERY_TICKS_PREFIX}${id}:${wk}`;
}

/** Whether a key holds somebody's grocery ticks. For the sign-out assertion. */
export const isGroceryTicksKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(GROCERY_TICKS_PREFIX);

/**
 * The ticks read back off a stored string.
 *
 * Anything unreadable is NO ticks rather than a throw or a partial: a corrupt
 * blob means we do not know what is in the trolley, and an empty list is the
 * only honest starting point for a shop.
 */
export function readGroceryTicks(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, on] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === 'string' && k && on === true) out[k] = true;
    }
    return out;
  } catch { return {}; }
}
