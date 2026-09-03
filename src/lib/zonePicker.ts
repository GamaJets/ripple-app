// Choosing a gym's timezone on a phone.
//
// ── Why this is a phone problem specifically ──────────────────────────────
//
// `tenants.timezone` (supabase/parts/710) is the column every dated figure in
// this product is supposed to be cut on, and on 4 September 2026 all 54 gyms
// in the live database had it null. The reason is not that owners disagree
// with the idea. It is that the ONLY writer in the whole product is the web
// console's Gym settings screen, and the owner app — the thing that actually
// ships to a gym owner's pocket — could not set it at all. So the console said
// "in the gym's own timezone" over figures it was drawing on the reader's
// laptop, the phone said nothing, and the setting that would fix it was on a
// screen many owners will never open.
//
// The console's control is a text field with a `<datalist>` behind it. That is
// the right control for a keyboard and the wrong one for a thumb: there is no
// datalist in React Native, and a `<select>` of four hundred zones on a phone
// is a scroll wheel nobody finishes. So the phone needs a search, and a search
// needs a ranking, and a ranking is logic — which is what is here.
//
// ── What this file refuses to offer, and why it matters ───────────────────
//
// Two kinds of identifier that `Intl.supportedValuesOf('timeZone')` may hand
// back and that must never be a GYM's zone:
//
//   1. `Etc/GMT+4`, `Etc/UTC` and their family. They are real IANA names and
//      `parseGymZone` accepts them, correctly — they are valid zones. They are
//      also fixed offsets that never move, which is the exact fault
//      `parseGymZone`'s own error message names when it refuses `+04:00`: "an
//      offset… stops being right when the clocks move". A gym pinned to
//      `Etc/GMT-4` files its March classes an hour out for six months and
//      nothing on any screen says why.
//   2. Single-segment ids — `UTC`, `GMT`, `Zulu`, `Japan`, `Israel`, `EST`.
//      Some are offsets by another name; the rest are deprecated aliases whose
//      canonical spelling (`Asia/Tokyo`, `Asia/Jerusalem`) is in the same list.
//      Offering both means two gyms in Tokyo whose rows do not compare equal.
//
// Node's own list already excludes both — it returns 418 canonical zones — so
// this is belt and braces rather than a live fix. It is written down because
// the runtime that matters here is Hermes on somebody's phone, its list is not
// Node's, and `zoneOptions()` in src/lib/gymZone.ts already documents that a
// runtime may return nothing at all.
//
// ── And what it deliberately does NOT do ──────────────────────────────────
//
// It does not put the phone's own zone at the top of the list, and there is no
// "use this phone's location" anywhere near it. Part 710 makes the argument
// about a laptop and it holds for a phone: the device's zone is a fact about
// the device. An owner reading their books in an airport would set their gym
// to `Europe/Amsterdam` with one tap and never find out. The phone's own zone
// is worth SAYING beside the field — the console prints it too — as a fact
// about the phone, labelled as one, with nothing to press.

/** One row in the picker: the id that gets stored, and how it reads. */
export interface ZoneChoice {
  /** The IANA id, exactly as it will be written to `tenants.timezone`. */
  zone: string;
  /** The last segment, underscores opened out. "Los Angeles", "New York". */
  city: string;
  /**
   * Everything before the city, as a readable trail — "America", or
   * "America · Argentina" for the three-segment ids. Empty string for an id
   * with no region, which `pickableZones` has already dropped; it is handled
   * anyway because this function is also used on a STORED value, and a gym
   * that set its zone before this existed may hold one.
   */
  where: string;
}

/**
 * The zones a gym may be in.
 *
 * See the header for the two exclusions and why each is not a matter of taste.
 * Sorted and de-duplicated so the same query gives the same list twice.
 */
export function pickableZones(all: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of all) {
    const z = String(raw ?? '').trim();
    if (!z) continue;
    if (!z.includes('/')) continue;
    if (z.startsWith('Etc/')) continue;
    out.add(z);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Split an id into the parts a person reads. */
export function zoneChoice(zone: string): ZoneChoice {
  const parts = String(zone ?? '').split('/').filter(Boolean);
  const city = (parts.length ? parts[parts.length - 1] : '').replace(/_/g, ' ');
  const where = parts.slice(0, -1).join(' · ').replace(/_/g, ' ');
  return { zone, city, where };
}

/** Lower case, underscores opened out, runs of space collapsed. Applied to
 *  both sides so "los angeles" finds `America/Los_Angeles`. */
function fold(s: string): string {
  return String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** How many rows a phone can usefully show before it becomes a scroll wheel. */
export const ZONE_RESULT_LIMIT = 8;

/**
 * The zones worth showing for what somebody has typed.
 *
 * Empty for an empty query — NOT the whole list. Four hundred rows under a
 * field nobody has typed in is the scroll wheel this exists to avoid, and the
 * screen's own prompt ("type the city the gym is in") is the better answer.
 *
 * Ranked in three bands, because a gym in London should not have to scroll
 * past `America/North_Dakota/New_Salem` to find `Europe/London`:
 *
 *   1. the CITY starts with what was typed          — "lond" → London
 *   2. the city contains it                         — "york" → New York
 *   3. anything else in the id contains it          — "europe" → every one
 *
 * Alphabetical within a band, so the order is stable and two identical
 * searches cannot disagree.
 */
export function searchZones(
  all: readonly string[], query: string, limit: number = ZONE_RESULT_LIMIT,
): ZoneChoice[] {
  const q = fold(query);
  if (!q) return [];

  const banded: Array<{ band: number; choice: ZoneChoice }> = [];
  for (const zone of pickableZones(all)) {
    const choice = zoneChoice(zone);
    const city = fold(choice.city);
    const whole = fold(zone.replace(/\//g, ' '));
    // The slash is folded to a space in `whole` so "europe london" matches,
    // and the raw id is checked too so a typed "europe/lon" does as well.
    const band = city.startsWith(q) ? 0
      : city.includes(q) ? 1
      : (whole.includes(q) || fold(zone).includes(q)) ? 2
      : -1;
    if (band < 0) continue;
    banded.push({ band, choice });
  }

  banded.sort((a, b) => a.band - b.band || a.choice.zone.localeCompare(b.choice.zone));
  return banded.slice(0, Math.max(0, limit)).map((b) => b.choice);
}

/**
 * What the screen says when the runtime has no zone list at all.
 *
 * `zoneOptions()` returns `[]` on a runtime without `Intl.supportedValuesOf`,
 * and its own header says the caller must then render a plain text field
 * rather than an empty picker. This is the sentence that goes with that field:
 * it names what is missing and what still works, because `parseGymZone`
 * validates the typed value either way and a gym in that state can still set
 * its zone correctly.
 */
export const NO_ZONE_LIST_NOTE =
  'This phone cannot list the world’s timezones, so there is nothing to search. Type the IANA name instead — Europe/London, Asia/Dubai, America/Los_Angeles — and it is checked before it is saved.';
