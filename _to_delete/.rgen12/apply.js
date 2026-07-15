const fs = require('fs');
function patch(F, edits) {
  let s = fs.readFileSync(F, 'utf8');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + F + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
  fs.writeFileSync(F, s); console.log('patched ' + F);
}
// nutrition.ts — CoachAdjust + applyCoachAdjust with carbs & fat
patch('src/lib/nutrition.ts', [
  ["export interface CoachAdjust { kcalDelta?: number; proteinDelta?: number }",
   "export interface CoachAdjust { kcalDelta?: number; proteinDelta?: number; carbDelta?: number; fatDelta?: number }"],
  ["  if (!a || (!a.kcalDelta && !a.proteinDelta)) return m;\n  const kcal = Math.max(1000, m.kcal + (a.kcalDelta || 0));\n  const protein = Math.max(0, m.protein + (a.proteinDelta || 0));\n  const carbs = Math.max(20, Math.round((kcal - protein * 4 - m.fat * 9) / 4));\n  return { ...m, kcal, protein, carbs };",
   "  if (!a || (!a.kcalDelta && !a.proteinDelta && !a.carbDelta && !a.fatDelta)) return m;\n  const kcal = Math.max(1000, m.kcal + (a.kcalDelta || 0));\n  const protein = Math.max(0, m.protein + (a.proteinDelta || 0));\n  const fat = Math.max(0, m.fat + (a.fatDelta || 0));\n  const carbs = (a.carbDelta != null && a.carbDelta !== 0) ? Math.max(20, m.carbs + a.carbDelta) : Math.max(20, Math.round((kcal - protein * 4 - fat * 9) / 4));\n  return { ...m, kcal, protein, carbs, fat };"],
]);
// coachNutrition.tsx — read/write carb & fat deltas (base upsert stays reliable; carb/fat via best-effort update)
patch('src/ui/coachNutrition.tsx', [
  ["m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, note: r.note ?? undefined };",
   "m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined };"],
  ["const merged: NutritionAdjust = { kcalDelta: 0, proteinDelta: 0, ...(map[clientId] ?? {}), ...patch };",
   "const merged: NutritionAdjust = { kcalDelta: 0, proteinDelta: 0, carbDelta: 0, fatDelta: 0, ...(map[clientId] ?? {}), ...patch };"],
  ["try { supabase.from('coach_nutrition').upsert({ client_id: clientId, coach_id: uid, kcal_delta: merged.kcalDelta, protein_delta: merged.proteinDelta, note: merged.note ?? null }, { onConflict: 'client_id' }).then(() => {}, () => {}); } catch { /* ignore */ }",
   "try { supabase.from('coach_nutrition').upsert({ client_id: clientId, coach_id: uid, kcal_delta: merged.kcalDelta, protein_delta: merged.proteinDelta, note: merged.note ?? null }, { onConflict: 'client_id' }).then(() => { supabase.from('coach_nutrition').update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0 }).eq('client_id', clientId).then(() => {}, () => {}); }, () => {}); } catch { /* ignore */ }"],
]);
