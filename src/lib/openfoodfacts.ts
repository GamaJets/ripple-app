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
  const p = json.product;
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
