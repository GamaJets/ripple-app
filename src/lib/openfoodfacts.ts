// Open Food Facts barcode lookup — turns a scanned/typed barcode (UPC/EAN) into
// real per-serving nutrition. No key required; free public API. We prefer the
// product's declared serving size, else fall back to 100g. Pure fetch, so this
// ships over-the-air (camera scanning is native-gated; manual entry works now).

export interface OffProduct {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  serving: string; // human label of the basis we used
}

const num = (v: any): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};

// Only digits; UPC-A is 12, EAN-13 is 13, EAN-8 is 8. Accept 8–14 to be lenient.
export function normalizeBarcode(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14 ? d : null;
}

export async function lookupBarcode(raw: string): Promise<OffProduct | null> {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`;
  let json: any;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Repple/1.0 (fitness app)' } });
    if (!res.ok) return null;
    json = await res.json();
  } catch { return null; }
  if (!json || json.status !== 1 || !json.product) return null;
  return toProduct(json.product);
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
  const servingG = num(p.serving_quantity);
  const hasServing = num(nu['energy-kcal_serving']) > 0 || num(nu.proteins_serving) > 0;
  let kcal: number, protein: number, carbs: number, fat: number, basis: string;
  if (hasServing) {
    kcal = num(nu['energy-kcal_serving']);
    protein = num(nu.proteins_serving);
    carbs = num(nu.carbohydrates_serving);
    fat = num(nu.fat_serving);
    basis = p.serving_size ? String(p.serving_size) : (servingG ? `${servingG} g` : '1 serving');
  } else if (servingG > 0) {
    const k = servingG / 100;
    kcal = num(nu['energy-kcal_100g']) * k;
    protein = num(nu.proteins_100g) * k;
    carbs = num(nu.carbohydrates_100g) * k;
    fat = num(nu.fat_100g) * k;
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
  if (kcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return null;
  return {
    name,
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
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
