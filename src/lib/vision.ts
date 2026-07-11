// Client wrapper for the vision-analyze edge function.
// Reads a meal photo into macros, or an InBody scan into body stats.
// Falls back gracefully (returns null) when the backend isn't configured yet,
// so the UI keeps its editable-estimate path until you deploy the function.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';

export interface MealVision { name: string; kcal: number; protein: number; carbs: number; fat: number; confidence: number }
export interface InBodyVision { weightKg: number | null; bodyFatPct: number | null; skeletalMuscleKg: number | null; takenAt: string | null }

/** True when the live backend is on — the vision function lives there. */
export function visionAvailable(): boolean {
  return USE_SUPABASE;
}

async function call(mode: 'meal' | 'inbody', imageBase64: string, mediaType = 'image/jpeg'): Promise<any | null> {
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

export async function analyzeInBody(imageBase64: string, mediaType?: string): Promise<InBodyVision | null> {
  const r = await call('inbody', imageBase64, mediaType);
  if (!r) return null;
  const n = (v: any) => (typeof v === 'number' ? v : null);
  return { weightKg: n(r.weightKg), bodyFatPct: n(r.bodyFatPct), skeletalMuscleKg: n(r.skeletalMuscleKg), takenAt: r.takenAt ?? null };
}
