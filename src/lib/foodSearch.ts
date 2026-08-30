// One search across the three food sources this app already had.
//
// ── Why this exists ───────────────────────────────────────────────────────
//
// "Search Foods" queried two sources and neither covered the everyday case.
// Open Food Facts is a BRANDED index — it answers "Tesco Greek Style Yogurt
// 500g" and does badly at "chicken breast", because a chicken breast has no
// barcode. Beside it sat twelve foods hardcoded in the screen. A third source
// — 41 restaurant dishes with cuisines and portions — lived on the "Eating
// Out" screen and could not be reached from search at all, so logging last
// night's pad thai required knowing that a second screen existed.
//
// The three stay separate at the source: they answer different questions and
// are honest about different things. They are merged HERE — pure, so it runs
// under plain node and is pinned by foodSearch.test.ts — and every row is
// labelled with where its numbers came from.
//
// ── The ranking rule ──────────────────────────────────────────────────────
//
// Two keys, in this order, and nothing else decides the list:
//
//   1. MATCH TIER — how completely the query lands on the name.
//        0  every word typed prefix-matches a word of the name, and the first
//           word typed matches the name's FIRST word ("chicken" → "Chicken
//           Breast, Grilled").
//        1  every word typed lands somewhere in the name ("yogurt" → "Greek
//           Yogurt, 0%"; "tesco" → "Tesco Chicken Breast").
//        2  some words typed land, some do not.
//        3  none do — the source matched on something else entirely.
//
//   2. SOURCE — the tie-break inside a tier, and it flips on how the person
//      typed. ONE word names a kind of food, so the generic table leads:
//      Common, Restaurant, Branded. TWO OR MORE words names a product off a
//      packet, so the packet's own label leads: Branded, Common, Restaurant.
//      A generic average must never outrank a real label for a query that
//      named the real thing.
//
// Ties beyond that fall back to the order each source returned (each already
// ranks its own results) and then the name, so the list is total and
// deterministic: the same three inputs always produce the same list.
//
// ── What a label is for ───────────────────────────────────────────────────
//
// A Common or Restaurant figure is a typical value for a named portion, not a
// measurement of the food in front of the person and not a brand's label. A
// Branded figure is the product's own declared nutrition. Those are different
// kinds of fact and the row says which one it is holding, because the failure
// this whole screen exists to avoid is a generic average being read as though
// it were somebody's own packet.
import { estimateDish, type Dish } from './restaurant';
import type { CommonFood } from './foods';

export type FoodSource = 'common' | 'restaurant' | 'branded';

/**
 * The branded fields the merge needs.
 *
 * Declared structurally rather than imported from openfoodfacts.ts on purpose:
 * that module reaches for fetch and AbortSignal, and this one has to compile
 * and run under plain node for the test. An OffProduct satisfies this shape.
 */
export interface BrandedItem {
  name: string;
  kcal: number; protein: number; carbs: number; fat: number;
  /** The basis the macros are for — "100 g", "1 serving", "330 ml". */
  serving: string;
}

export interface FoodResult {
  /** Stable and unique across the merged list — React keys, and nothing else. */
  key: string;
  /** As shown and as logged; carries the portion the macros are for. */
  name: string;
  source: FoodSource;
  /** Short Title Case badge: "Common", "Restaurant · Italian", "Branded". */
  label: string;
  kcal: number; protein: number; carbs: number; fat: number;
}

export interface FoodSourceResults {
  common: CommonFood[];
  restaurant: Dish[];
  /** Empty when the remote search failed. The screen says so separately. */
  branded: BrandedItem[];
}

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The key two rows have to share before one is dropped as a duplicate.
 *
 * Parenthesised portions come off — the same product reached by search and by
 * barcode differs only in whether "(100 g)" got appended — and punctuation is
 * flattened. Nothing else is stripped: "Greek Yogurt, 0%" and "Greek Yogurt,
 * Full Fat" are two different foods, and a normaliser aggressive enough to
 * merge "Latte, Regular" into "Latte" is aggressive enough to hide one of
 * those behind the other.
 */
function dedupeKey(name: string): string {
  return words(name.replace(/\([^)]*\)/g, '')).join(' ');
}

/** Tier 0–3. See the ranking rule above. */
function matchTier(terms: string[], nameWords: string[], hayWords: string[]): number {
  if (!terms.length) return 1;
  let landed = 0;
  for (const term of terms) if (hayWords.some((w) => w.startsWith(term))) landed++;
  if (landed === 0) return 3;
  if (landed < terms.length) return 2;
  return nameWords[0]?.startsWith(terms[0]) ? 0 : 1;
}

// One word is a kind of food; two or more is a product. See the ranking rule.
const KIND_FIRST: FoodSource[] = ['common', 'restaurant', 'branded'];
const PRODUCT_FIRST: FoodSource[] = ['branded', 'common', 'restaurant'];

interface Candidate { row: FoodResult; tier: number; idx: number }

/**
 * Merge three already-fetched result sets into one ranked, labelled list.
 *
 * Takes results rather than fetching them: the remote source is debounced,
 * abortable and allowed to fail, and none of that belongs in a ranking rule.
 * A failed remote search arrives here as an empty `branded` array, which
 * removes nothing — the local rows are still the answer, and saying the
 * branded search is down is the screen's job, not this function's.
 */
export function mergeFoodResults(
  query: string,
  sources: FoodSourceResults,
  limit = 20,
): FoodResult[] {
  const terms = words(query || '');
  const order = terms.length > 1 ? PRODUCT_FIRST : KIND_FIRST;
  const candidates: Candidate[] = [];

  const consider = (row: FoodResult, hay: string, idx: number) => {
    const tier = matchTier(terms, words(row.name), words(hay));
    // Tier 3 is kept only for the branded source. Open Food Facts ranks by its
    // own relevance and legitimately answers "coke" with "Coca-Cola", so a row
    // that matches no word typed can still be the right product. The two local
    // searches are substring-based — searchDishes answers "ice" with "Chicken
    // fried rice" — and a match buried inside a word is noise, not an answer.
    if (tier === 3 && row.source !== 'branded') return;
    candidates.push({ row, tier, idx });
  };

  sources.common.forEach((f, i) => consider({
    key: `common:${dedupeKey(f.n)}`,
    name: f.n,
    source: 'common',
    label: 'Common',
    kcal: f.k, protein: f.p, carbs: f.c, fat: f.f,
  }, `${f.n} ${f.alias ?? ''}`, i));

  sources.restaurant.forEach((d, i) => {
    // Logged at the standard serving. The portion picker is the "Eating Out"
    // screen's, where somebody has already said they are estimating a meal
    // out; a row in a search list has no way to ask, and inventing a multiplier
    // it never asked about would be a figure nobody chose.
    const e = estimateDish(d, 1);
    consider({
      key: `restaurant:${d.id}`,
      name: e.name,
      source: 'restaurant',
      label: `Restaurant · ${d.cuisine}`,
      kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat,
    }, `${d.name} ${d.cuisine}`, i);
  });

  sources.branded.forEach((p, i) => {
    // Say what the numbers are FOR. A per-100g figure logged as though it were
    // a portion is the kind of quiet wrongness this app is built to avoid.
    const name = p.serving ? `${p.name} (${p.serving})` : p.name;
    consider({
      key: `branded:${dedupeKey(name)}`,
      name,
      source: 'branded',
      label: 'Branded',
      kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat,
    }, p.name, i);
  });

  candidates.sort((a, b) =>
    a.tier - b.tier
    || order.indexOf(a.row.source) - order.indexOf(b.row.source)
    || a.idx - b.idx
    || a.row.name.localeCompare(b.row.name));

  // De-duplicated AFTER ranking, so the row that survives is the better-ranked
  // one rather than whichever source happened to be read first.
  const out: FoodResult[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const k = dedupeKey(c.row.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c.row);
    if (out.length >= limit) break;
  }
  return out;
}
