// Open Food Facts barcode lookup — turns a scanned/typed barcode (UPC/EAN) into
// real per-serving nutrition. No key required; free public API. We prefer the
// product's declared serving size, else fall back to 100g. Pure fetch, so this
// ships over-the-air (camera scanning is native-gated; manual entry works now).

export interface OffProduct {
  name: string;
  kcal: number;
  /**
   * Null where Open Food Facts recorded nothing for it.
   *
   * These were `number`, and `num()` turned every absent field into 0 — so a
   * branded product with only an energy figure came back as protein 0, carbs 0,
   * fat 0, `missingMacros` (src/lib/foodPortion.ts) never fired, and the log
   * sheet pre-filled three zeros for a member to confirm. That is the exact
   * rule foodPortion.ts was written against: A ZERO IS A MEASUREMENT, and "we
   * were not told" is not a zero — reintroduced on the one path whose figures a
   * member trusts most, because a barcode feels like a fact.
   */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  serving: string; // human label of the basis we used
}

/** A recorded number, or null. Blank, absent and unparseable are all null — the
 *  three of them mean "not told", and only a real figure means a figure. */
const num = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
/** Scale a recorded figure, keeping null null. */
const scale = (v: number | null, k: number): number | null => (v == null ? null : v * k);
const round = (v: number | null): number | null => (v == null ? null : Math.round(v));

// Only digits; UPC-A is 12, EAN-13 is 13, EAN-8 is 8. Accept 8–14 to be lenient.
export function normalizeBarcode(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14 ? d : null;
}

/**
 * What a barcode lookup came back as.
 *
 * ── Why this is an outcome and not `OffProduct | null` ────────────────────
 *
 * It was null for all five of these, and src/ui/BarcodeSheet.tsx rendered that
 * one null as `Alert.alert('Not found', … 'there is no match for it in the Open
 * Food Facts database')`. So on a supermarket's bad signal a member was told
 * their yoghurt is not in the database, rather than that we could not ask.
 *
 * That is the failed-read-as-empty-state this codebase refuses everywhere else
 * — and `searchProducts`, directly below in this same file, already goes to the
 * trouble of returning `{ ok: false, reason: 'busy' | 'offline' }` so the
 * screen can tell a throttle from an empty result. This is that, on the scan
 * side.
 *
 *   bad-code      the digits are not a barcode this database is keyed on
 *   not-found     we asked, and there is genuinely no such product
 *   no-nutrition  the product is there and its figures are not
 *   busy          throttled or a server error — ask again in a moment
 *   offline       we could not reach it at all
 */
export type LookupOutcome =
  | { ok: true; product: OffProduct }
  | { ok: false; reason: 'bad-code' | 'not-found' | 'no-nutrition' | 'busy' | 'offline' };

export async function lookupBarcode(raw: string): Promise<LookupOutcome> {
  const code = normalizeBarcode(raw);
  if (!code) return { ok: false, reason: 'bad-code' };
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`;
  let json: any;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Repple/1.0 (fitness app)' } });
    // A 404 is the database answering: there is no such product. Everything
    // else in the 4xx/5xx range is us failing to ask it properly, and the same
    // split `searchProducts` makes two functions down.
    if (res.status === 404) return { ok: false, reason: 'not-found' };
    if (res.status === 429 || res.status >= 500) return { ok: false, reason: 'busy' };
    if (!res.ok) return { ok: false, reason: 'offline' };
    json = await res.json();
  } catch { return { ok: false, reason: 'offline' }; }
  // `status: 0` is Open Food Facts' own "product not found" on a 200.
  if (!json) return { ok: false, reason: 'offline' };
  if (json.status !== 1 || !json.product) return { ok: false, reason: 'not-found' };
  const product = toProduct(json.product);
  // The barcode matched. What it matched has no nutrition on file, which is a
  // different sentence from "no match" and is the member's cue to describe it
  // instead of scanning it again.
  return product ? { ok: true, product } : { ok: false, reason: 'no-nutrition' };
}

/**
 * One Open Food Facts product row to the shape the app logs.
 *
 * Shared by the barcode lookup and the text search so the two can never
 * disagree about what a product's macros are — the same tin scanned and
 * searched has to come back the same, or the food log is quietly a lie.
 */
function toProduct(p: any): OffProduct | null {
  const nu = p.nutriments || {};

  // Prefer per-serving values if present, else scale per-100g by serving qty.
  const servingG = num(p.serving_quantity) ?? 0;
  const hasServing = (num(nu['energy-kcal_serving']) ?? 0) > 0 || (num(nu.proteins_serving) ?? 0) > 0;
  let kcal: number | null, protein: number | null, carbs: number | null, fat: number | null, basis: string;
  if (hasServing) {
    kcal = num(nu['energy-kcal_serving']);
    protein = num(nu.proteins_serving);
    carbs = num(nu.carbohydrates_serving);
    fat = num(nu.fat_serving);
    basis = p.serving_size ? String(p.serving_size) : (servingG ? `${servingG} g` : '1 serving');
  } else if (servingG > 0) {
    const k = servingG / 100;
    kcal = scale(num(nu['energy-kcal_100g']), k);
    protein = scale(num(nu.proteins_100g), k);
    carbs = scale(num(nu.carbohydrates_100g), k);
    fat = scale(num(nu.fat_100g), k);
    basis = p.serving_size ? String(p.serving_size) : `${servingG} g`;
  } else {
    kcal = num(nu['energy-kcal_100g']);
    protein = num(nu.proteins_100g);
    carbs = num(nu.carbohydrates_100g);
    fat = num(nu.fat_100g);
    basis = '100 g';
  }

  const brand = (p.brands || '').split(',')[0]?.trim();
  const base = (p.product_name || '').trim() || 'Product';
  const name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : base;

  // Zero is a real nutrition figure, and this used to throw it away.
  //
  // The old guard was `kcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0`,
  // which cannot tell "this product records no nutrition" from "this product
  // genuinely contains none". So scanning a Coke Zero — 0.3 kcal/100g, and 0
  // per serving — returned null, and the screen said "No match in the Open Food
  // Facts database for that barcode". The match was found; it was thrown away
  // for being a diet drink. Water, black coffee, sweeteners and every zero-
  // calorie mixer failed the same way, and the message blamed the database.
  //
  // Presence of the FIELD is the question, not its value — which is now what
  // `num` answers, so a recorded 0 survives and an absent field is null all the
  // way to the sheet. ENERGY is what decides whether there is a row at all: a
  // food log entry is `kcal` plus three optional macros, so a product with no
  // energy on file is not loggable, and the caller says "we have the product
  // but not its figures" rather than "no match".
  if (kcal == null) return null;
  return {
    name,
    kcal: Math.round(kcal),
    protein: round(protein),
    carbs: round(carbs),
    fat: round(fat),
    serving: basis,
  };
}

/**
 * Free-text product search.
 *
 * Why this exists: "Search foods" was searching a 113-row table hardcoded in
 * the Food Log screen — chicken breast, oats, banana. It matched nothing a
 * person actually buys, which is why it was reported as not working. It never
 * touched a nutrition database at all, while the barcode path two buttons away
 * was already reading Open Food Facts.
 *
 * Open Food Facts rather than a UK-specific set, deliberately. A UAE shelf is
 * four baskets at once — Spinneys carries UK and US imports, Carrefour is
 * French, and Gulf brands sit beside them — and one global database answers all
 * four: 6,344 Waitrose products, 3,119 Oreo, and 550 Almarai tagged
 * en:united-arab-emirates with Arabic names. Any single-country database would
 * cover one aisle of that shop and miss the rest.
 *
 * ── Why this returns an outcome and not an array ──────────────────────────
 *
 * The search endpoint is free and rate-limited, and it answers 503 when it is
 * busy. Returning [] for that would put "Nothing found" under the search box —
 * telling somebody their food does not exist because a server was throttling
 * us. An empty result and an unanswered question are different facts and the
 * screen has to be able to say which one it has.
 */
export type SearchOutcome =
  | { ok: true; products: OffProduct[] }
  | { ok: false; reason: 'busy' | 'offline' };

export async function searchProducts(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<SearchOutcome> {
  const q = (query || '').trim();
  // Two characters matches half the database and is never what somebody meant.
  if (q.length < 3) return { ok: true, products: [] };
  const limit = opts.limit ?? 12;
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + `?search_terms=${encodeURIComponent(q)}`
    + '&search_simple=1&action=process&json=1'
    + `&page_size=${limit}`
    + '&fields=product_name,brands,nutriments,serving_size,serving_quantity';
  let json: any;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Repple/1.0 (fitness app; +https://repplefitness.com)' },
      signal: opts.signal,
    });
    // 429 and 503 are the throttle. 5xx generally means the service, not the food.
    if (res.status === 429 || res.status >= 500) return { ok: false, reason: 'busy' };
    if (!res.ok) return { ok: false, reason: 'offline' };
    json = await res.json();
  } catch {
    // Includes an aborted request; the caller drops the result either way.
    return { ok: false, reason: 'offline' };
  }

  const products: OffProduct[] = [];
  const seen = new Set<string>();
  for (const raw of (json?.products ?? [])) {
    const prod = toProduct(raw);
    if (!prod) continue;                       // no macros recorded — not a result
    const key = prod.name.toLowerCase();
    if (seen.has(key)) continue;               // OFF carries near-duplicates of popular items
    seen.add(key);
    products.push(prod);
  }
  return { ok: true, products };
}
