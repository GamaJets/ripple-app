const fs = require('fs');
const F = 'src/lib/vision.ts';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 70)); process.exit(1); }
  s = s.replace(a, b);
}
// 1) shared numeric coercion (handles model returning "76.2" as a string, or with a unit suffix)
rep(
  "export function visionAvailable(): boolean {\n  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';\n}",
  "export function visionAvailable(): boolean {\n  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';\n}\n\n// Coerce a model value to a number: accepts real numbers AND numeric strings\n// like \"76.2\", \"76.2 kg\", \"28%\" — models often stringify JSON numbers, and\n// dropping those silently broke scan auto-fill.\nfunction toNum(v: any): number | null {\n  if (typeof v === 'number') return isFinite(v) ? v : null;\n  if (typeof v === 'string') { const p = parseFloat(v.replace(/[^0-9.\\-]/g, '')); return isFinite(p) ? p : null; }\n  return null;\n}"
);
// 2) analyzeMeal: accept stringified numbers
rep(
  "  const r = await call('meal', imageBase64, mediaType);\n  if (!r || typeof r.kcal !== 'number') return null;\n  return {\n    name: String(r.name ?? 'Meal'),\n    kcal: Math.round(r.kcal), protein: Math.round(r.protein ?? 0), carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),\n    confidence: typeof r.confidence === 'number' ? r.confidence : 0.6,\n  };",
  "  const r = await call('meal', imageBase64, mediaType);\n  const kcal = toNum(r?.kcal);\n  if (!r || kcal == null) return null;\n  return {\n    name: String(r.name ?? 'Meal'),\n    kcal: Math.round(kcal), protein: Math.round(toNum(r.protein) ?? 0), carbs: Math.round(toNum(r.carbs) ?? 0), fat: Math.round(toNum(r.fat) ?? 0),\n    confidence: toNum(r.confidence) ?? 0.6,\n  };"
);
// 3) analyzePhysique: coerce bodyFatPct
rep(
  "  return { bodyFatPct: typeof r.bodyFatPct === 'number' ? r.bodyFatPct : null, notes: String(r.notes ?? ''), focusAreas: Array.isArray(r.focusAreas) ? r.focusAreas.map(String).slice(0, 4) : [] };",
  "  return { bodyFatPct: toNum(r.bodyFatPct), notes: String(r.notes ?? ''), focusAreas: Array.isArray(r.focusAreas) ? r.focusAreas.map(String).slice(0, 4) : [] };"
);
// 4) analyzeInBody: use shared toNum (was number-only)
rep(
  "  const n = (v: any) => (typeof v === 'number' ? v : null);\n  return { weightKg: n(r.weightKg), bodyFatPct: n(r.bodyFatPct), skeletalMuscleKg: n(r.skeletalMuscleKg), takenAt: r.takenAt ?? null };",
  "  return { weightKg: toNum(r.weightKg), bodyFatPct: toNum(r.bodyFatPct), skeletalMuscleKg: toNum(r.skeletalMuscleKg), takenAt: r.takenAt ?? null };"
);
fs.writeFileSync(F, s);
console.log('applied OK');
