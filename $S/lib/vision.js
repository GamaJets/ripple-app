"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastVisionError = void 0;
exports.visionAvailable = visionAvailable;
exports.analyzeMeal = analyzeMeal;
exports.analyzePhysique = analyzePhysique;
exports.analyzeMachine = analyzeMachine;
exports.analyzeInBody = analyzeInBody;
// Client wrapper for the vision-analyze edge function.
// Reads a meal photo into macros, or an InBody scan into body stats.
// Falls back gracefully (returns null) when the backend isn't configured yet,
// so the UI keeps its editable-estimate path until you deploy the function.
const supabase_1 = require("./supabase");
/** True when the vision function is reachable. The single gate for every door
 *  to the model — see the note above, and `coachAvailable`, which calls this. */
function visionAvailable() {
    return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
}
// Coerce a model value to a number: accepts real numbers AND numeric strings
// like "76.2", "76.2 kg", "28%" — models often stringify JSON numbers, and
// dropping those silently broke scan auto-fill.
function toNum(v) {
    if (typeof v === 'number')
        return isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const p = parseFloat(v.replace(/[^0-9.\-]/g, ''));
        return isFinite(p) ? p : null;
    }
    return null;
}
// The last vision failure reason, so the UI can tell the user WHY a scan didn't
// read (bad model, missing key, etc.) instead of a generic message. '' when fine.
exports.lastVisionError = '';
async function call(mode, imageBase64, mediaType = 'image/jpeg') {
    exports.lastVisionError = '';
    if (!visionAvailable()) {
        exports.lastVisionError = 'AI reader is off (EXPO_PUBLIC_ENABLE_VISION)';
        return null;
    }
    if (!imageBase64) {
        exports.lastVisionError = 'no image';
        return null;
    }
    try {
        const { data, error } = await supabase_1.supabase.functions.invoke('vision-analyze', {
            body: { mode, imageBase64, mediaType },
        });
        if (error) {
            // supabase-js puts the function's JSON error body on error.context (a Response).
            let detail = error?.message || 'reader error';
            try {
                const body = await error?.context?.json?.();
                if (body?.error)
                    detail = String(body.error) + (body.detail ? ': ' + String(body.detail).slice(0, 140) : '');
            }
            catch { /* ignore */ }
            exports.lastVisionError = detail;
            return null;
        }
        if (!data) {
            exports.lastVisionError = 'no response from reader';
            return null;
        }
        if (data.error) {
            exports.lastVisionError = String(data.error);
            return null;
        }
        return data.result ?? null;
    }
    catch (e) {
        exports.lastVisionError = String(e);
        return null;
    }
}
async function analyzeMeal(imageBase64, mediaType) {
    const r = await call('meal', imageBase64, mediaType);
    const kcal = toNum(r?.kcal);
    if (!r || kcal == null)
        return null;
    const macro = (v) => { const n = toNum(v); return n == null ? null : Math.round(n); };
    return {
        name: String(r.name ?? 'Meal'),
        kcal: Math.round(kcal), protein: macro(r.protein), carbs: macro(r.carbs), fat: macro(r.fat),
        confidence: toNum(r.confidence) ?? 0.6,
    };
}
async function analyzePhysique(imageBase64, mediaType) {
    const r = await call('physique', imageBase64, mediaType);
    if (!r)
        return null;
    return { bodyFatPct: toNum(r.bodyFatPct), notes: String(r.notes ?? ''), focusAreas: Array.isArray(r.focusAreas) ? r.focusAreas.map(String).slice(0, 4) : [] };
}
async function analyzeMachine(imageBase64, mediaType) {
    const r = await call('machine', imageBase64, mediaType);
    const name = r?.name ? String(r.name).trim() : '';
    if (!name)
        return null;
    return { name, muscleGroup: String(r.muscleGroup ?? ''), isCardio: !!r.isCardio, confidence: toNum(r.confidence) ?? 0.6 };
}
async function analyzeInBody(imageBase64, mediaType) {
    const r = await call('inbody', imageBase64, mediaType);
    if (!r)
        return null;
    const num = (v) => toNum(v) ?? undefined;
    const metrics = {
        visceralFat: num(r.visceralFat), inbodyScore: num(r.inbodyScore), bmr: num(r.bmr),
        fatMassKg: num(r.fatMassKg), leanMassKg: num(r.leanMassKg),
        bodyWaterL: num(r.bodyWaterL), proteinKg: num(r.proteinKg), mineralsKg: num(r.mineralsKg),
        leanArmLKg: num(r.leanArmLKg), leanArmRKg: num(r.leanArmRKg), leanTrunkKg: num(r.leanTrunkKg),
        leanLegLKg: num(r.leanLegLKg), leanLegRKg: num(r.leanLegRKg),
    };
    return { weightKg: toNum(r.weightKg), bodyFatPct: toNum(r.bodyFatPct), skeletalMuscleKg: toNum(r.skeletalMuscleKg), takenAt: r.takenAt ?? null, metrics };
}
