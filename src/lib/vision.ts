// Client wrapper for the vision-analyze edge function.
// Reads a meal photo into macros, or an InBody scan into body stats.
// Falls back gracefully (returns null) when the backend isn't configured yet,
// so the UI keeps its editable-estimate path until you deploy the function.
import { supabase } from './supabase';
import type { ScanMetrics } from './inbodyMetrics';
// ── One switch for every door to the model ────────────────────────────────
//
// This used to read `USE_SUPABASE || EXPO_PUBLIC_ENABLE_VISION === '1'`, while
// the AI Coach's door — `coachAvailable` in src/lib/coach.ts, the one that
// asks the member first — read the flag alone. Two gates on two paths to the
// same api.anthropic.com, and the looser one was on the path that asked
// nothing: every build with a backend sent photographs, INCLUDING builds where
// the door that does ask had been deliberately switched off. The unasked path
// outlived the asked one, which is exactly the wrong way round.
//
// So it is the flag, and only the flag, and `coachAvailable` defers to this
// function so there is one answer rather than two that can drift. Turning the
// flag off now turns off every path to the model, which is what somebody
// turning it off believes they are doing. Every published profile in eas.json
// sets it, so nothing in the field changes.

export interface MealVision {
  name: string;
  kcal: number;
  /** Null when the reader did not give us one. These were `?? 0`, so a model
   *  that returned calories and nothing else recorded a zero-protein meal that
   *  then fed the day's remaining-macro figures. A zero is a measurement and
   *  "we were not told" is not one — src/lib/foodPortion.ts refuses to build a
   *  loggable food out of a gap, and the member fills it in. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  confidence: number;
}
export interface InBodyVision { weightKg: number | null; bodyFatPct: number | null; skeletalMuscleKg: number | null; takenAt: string | null; metrics?: ScanMetrics }

/** True when the vision function is reachable. The single gate for every door
 *  to the model — see the note above, and `coachAvailable`, which calls this. */
export function visionAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
}

// Coerce a model value to a number: accepts real numbers AND numeric strings
// like "76.2", "76.2 kg", "28%" — models often stringify JSON numbers, and
// dropping those silently broke scan auto-fill.
function toNum(v: any): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') { const p = parseFloat(v.replace(/[^0-9.\-]/g, '')); return isFinite(p) ? p : null; }
  return null;
}

// The last vision failure reason, so the UI can tell the user WHY a scan didn't
// read (bad model, missing key, etc.) instead of a generic message. '' when fine.
export let lastVisionError = '';

async function call(mode: string, imageBase64: string, mediaType = 'image/jpeg'): Promise<any | null> {
  lastVisionError = '';
  if (!visionAvailable()) { lastVisionError = 'AI reader is off (EXPO_PUBLIC_ENABLE_VISION)'; return null; }
  if (!imageBase64) { lastVisionError = 'no image'; return null; }
  try {
    const { data, error } = await supabase.functions.invoke('vision-analyze', {
      body: { mode, imageBase64, mediaType },
    });
    if (error) {
      // supabase-js puts the function's JSON error body on error.context (a Response).
      let detail = (error as any)?.message || 'reader error';
      try { const body = await (error as any)?.context?.json?.(); if (body?.error) detail = String(body.error) + (body.detail ? ': ' + String(body.detail).slice(0, 140) : ''); } catch { /* ignore */ }
      lastVisionError = detail; return null;
    }
    if (!data) { lastVisionError = 'no response from reader'; return null; }
    if ((data as any).error) { lastVisionError = String((data as any).error); return null; }
    return (data as any).result ?? null;
  } catch (e) {
    lastVisionError = String(e); return null;
  }
}

export async function analyzeMeal(imageBase64: string, mediaType?: string): Promise<MealVision | null> {
  const r = await call('meal', imageBase64, mediaType);
  const kcal = toNum(r?.kcal);
  if (!r || kcal == null) return null;
  const macro = (v: any): number | null => { const n = toNum(v); return n == null ? null : Math.round(n); };
  return {
    name: String(r.name ?? 'Meal'),
    kcal: Math.round(kcal), protein: macro(r.protein), carbs: macro(r.carbs), fat: macro(r.fat),
    confidence: toNum(r.confidence) ?? 0.6,
  };
}

export interface PhysiqueVision { bodyFatPct: number | null; notes: string; focusAreas: string[] }
export async function analyzePhysique(imageBase64: string, mediaType?: string): Promise<PhysiqueVision | null> {
  const r = await call('physique', imageBase64, mediaType);
  if (!r) return null;
  return { bodyFatPct: toNum(r.bodyFatPct), notes: String(r.notes ?? ''), focusAreas: Array.isArray(r.focusAreas) ? r.focusAreas.map(String).slice(0, 4) : [] };
}

export interface MachineVision { name: string; muscleGroup: string; isCardio: boolean; confidence: number }
export async function analyzeMachine(imageBase64: string, mediaType?: string): Promise<MachineVision | null> {
  const r = await call('machine', imageBase64, mediaType);
  const name = r?.name ? String(r.name).trim() : '';
  if (!name) return null;
  return { name, muscleGroup: String(r.muscleGroup ?? ''), isCardio: !!r.isCardio, confidence: toNum(r.confidence) ?? 0.6 };
}

export async function analyzeInBody(imageBase64: string, mediaType?: string): Promise<InBodyVision | null> {
  const r = await call('inbody', imageBase64, mediaType);
  if (!r) return null;
  const num = (v: any) => toNum(v) ?? undefined;
  const metrics: ScanMetrics = {
    visceralFat: num(r.visceralFat), inbodyScore: num(r.inbodyScore), bmr: num(r.bmr),
    fatMassKg: num(r.fatMassKg), leanMassKg: num(r.leanMassKg),
    bodyWaterL: num(r.bodyWaterL), proteinKg: num(r.proteinKg), mineralsKg: num(r.mineralsKg),
    leanArmLKg: num(r.leanArmLKg), leanArmRKg: num(r.leanArmRKg), leanTrunkKg: num(r.leanTrunkKg),
    leanLegLKg: num(r.leanLegLKg), leanLegRKg: num(r.leanLegRKg),
  };
  return { weightKg: toNum(r.weightKg), bodyFatPct: toNum(r.bodyFatPct), skeletalMuscleKg: toNum(r.skeletalMuscleKg), takenAt: r.takenAt ?? null, metrics };
}
