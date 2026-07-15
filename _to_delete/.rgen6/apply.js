const fs = require('fs');
function patch(F, edits) {
  let s = fs.readFileSync(F, 'utf8');
  for (const [a, b] of edits) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + F + ' :: ' + a.slice(0, 60)); process.exit(1); }
    s = s.replace(a, b);
  }
  fs.writeFileSync(F, s);
  console.log('patched ' + F);
}
// --- vision.ts ---
patch('src/lib/vision.ts', [
  ["import { supabase } from './supabase';",
   "import { supabase } from './supabase';\nimport type { ScanMetrics } from './inbodyMetrics';"],
  ["export interface InBodyVision { weightKg: number | null; bodyFatPct: number | null; skeletalMuscleKg: number | null; takenAt: string | null }",
   "export interface InBodyVision { weightKg: number | null; bodyFatPct: number | null; skeletalMuscleKg: number | null; takenAt: string | null; metrics?: ScanMetrics }"],
  ["  const r = await call('inbody', imageBase64, mediaType);\n  if (!r) return null;\n  return { weightKg: toNum(r.weightKg), bodyFatPct: toNum(r.bodyFatPct), skeletalMuscleKg: toNum(r.skeletalMuscleKg), takenAt: r.takenAt ?? null };",
   "  const r = await call('inbody', imageBase64, mediaType);\n  if (!r) return null;\n  const num = (v: any) => toNum(v) ?? undefined;\n  const metrics: ScanMetrics = {\n    visceralFat: num(r.visceralFat), inbodyScore: num(r.inbodyScore), bmr: num(r.bmr),\n    fatMassKg: num(r.fatMassKg), leanMassKg: num(r.leanMassKg),\n    bodyWaterL: num(r.bodyWaterL), proteinKg: num(r.proteinKg), mineralsKg: num(r.mineralsKg),\n    leanArmLKg: num(r.leanArmLKg), leanArmRKg: num(r.leanArmRKg), leanTrunkKg: num(r.leanTrunkKg),\n    leanLegLKg: num(r.leanLegLKg), leanLegRKg: num(r.leanLegRKg),\n  };\n  return { weightKg: toNum(r.weightKg), bodyFatPct: toNum(r.bodyFatPct), skeletalMuscleKg: toNum(r.skeletalMuscleKg), takenAt: r.takenAt ?? null, metrics };"],
]);
// --- edge function inbody prompt ---
patch('supabase/functions/vision-analyze/index.ts', [
  ["  inbody:\n    'This is an InBody (or similar) body-composition scan. Extract these fields. ' +\n    'Respond with ONLY valid JSON, no prose: {\"weightKg\": number, \"bodyFatPct\": number, \"skeletalMuscleKg\": number, \"takenAt\": string|null}. ' +\n    'weightKg is total body weight in kg, bodyFatPct is PBF %, skeletalMuscleKg is SMM in kg. takenAt is the scan date as YYYY-MM-DD if printed, else null. ' +\n    'If a value is not present, use null for it.',",
   "  inbody:\n    'This is an InBody (or similar) body-composition scan. Extract EVERY field below that is printed. ' +\n    'Respond with ONLY valid JSON numbers (not strings), no prose: ' +\n    '{\"weightKg\": number, \"bodyFatPct\": number, \"skeletalMuscleKg\": number, \"takenAt\": string|null, ' +\n    '\"visceralFat\": number, \"inbodyScore\": number, \"bmr\": number, \"fatMassKg\": number, \"leanMassKg\": number, ' +\n    '\"bodyWaterL\": number, \"proteinKg\": number, \"mineralsKg\": number, ' +\n    '\"leanArmLKg\": number, \"leanArmRKg\": number, \"leanTrunkKg\": number, \"leanLegLKg\": number, \"leanLegRKg\": number}. ' +\n    'Definitions: weightKg=total body weight kg; bodyFatPct=PBF %; skeletalMuscleKg=SMM kg; visceralFat=visceral fat level (unitless); ' +\n    'inbodyScore=total InBody score points; bmr=basal metabolic rate kcal; fatMassKg=body fat mass kg; leanMassKg=lean/fat-free body mass kg; ' +\n    'bodyWaterL=total body water L; proteinKg and mineralsKg in kg; leanArmLKg/leanArmRKg/leanTrunkKg/leanLegLKg/leanLegRKg are the segmental lean analysis (left/right arm, trunk, left/right leg) in kg. ' +\n    'takenAt is the scan date YYYY-MM-DD if printed, else null. Use null for any field not present on the sheet. Return numbers as numbers.',"],
]);
