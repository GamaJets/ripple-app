// Client wrapper for the vision-analyze edge function.
// Reads a meal photo into macros, or an InBody scan into body stats.
// Falls back gracefully (returns null) when the backend isn't configured yet,
// so the UI keeps its editable-estimate path until you deploy the function.
import { supabase } from './supabase';
// Vision runs off its own flag so you can enable AI photo reading without
// flipping the whole app to live Supabase data. Set EXPO_PUBLIC_ENABLE_VISION=1
// once the vision-analyze function is deployed.

export interface MealVision { name: string; kcal: number; protein: number; carbs: number; fat: number; confidence: number }
export interface InBodyVision { weightKg: number | null; bodyFatPct: number | null; skeletalMuscleKg: number | null; takenAt: string | null }

/** True when the live backend is on — the vision function lives there. */
export function visionAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
}

async function call(mode: string, imageBase64: string, mediaType = 'image/jpeg'): Promise<any | null> {
  if (!visionAvailable() || !imageBase64) return null;
  try {
    const { data, error } = await supabase.functions.invoke('vision-analyze', {
      body: { mode, imageBase64, mediaType },
    });
    if (error || !data || (data as any).error) return null;
    return (data as any).result ?? null;
  } catch {
    return null;
  }
}

export async function analyzeMeal(imageBase64: string, mediaType?: string): Promise<MealVision | null> {
  const r = await call('meal', imageBase64, mediaType);
  if (!r || typeof r.kcal !== 'number') return null;
  return {
    name: String(r.name ?? 'Meal'),
    kcal: Math.round(r.kcal), protein: Math.round(r.protein ?? 0), carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.6,
  };
}

export interface PhysiqueVision { bodyFatPct: number | null; notes: string; focusAreas: string[] }
export async function analyzePhysique(imageBase64: string, mediaType?: string): Promise<PhysiqueVision | null> {
  const r = await call('physique', imageBase64, mediaType);
  if (!r) return null;
  return { bodyFatPct: typeof r.bodyFatPct === 'number' ? r.bodyFatPct : null, notes: String(r.notes ?? ''), focusAreas: Array.isArray(r.focusAreas) ? r.focusAreas.map(String).slice(0, 4) : [] };
}

export async function analyzeInBody(imageBase64: string, mediaType?: string): Promise<InBodyVision | null> {
  const r = await call('inbody', imageBase64, mediaType);
  if (!r) return null;
  const n = (v: any) => (typeof v === 'number' ? v : null);
  return { weightKg: n(r.weightKg), bodyFatPct: n(r.bodyFatPct), skeletalMuscleKg: n(r.skeletalMuscleKg), takenAt: r.takenAt ?? null };
}
