const fs = require('fs');
function patch(F, edits) {
  let s = fs.readFileSync(F, 'utf8');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + F + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
  fs.writeFileSync(F, s); console.log('patched ' + F);
}
patch('src/ui/clientData.tsx', [
  ["      supabase.from('clients').update({ goal }).eq('id', sbUid).then(() => {}, () => {});\n    } catch { /* ignore */ }\n  }, [name, goal, sbUid, hydrated]);",
   "      supabase.from('clients').update({ goal }).eq('id', sbUid).then(() => {}, () => {});\n      supabase.from('clients').update({ diet, meals_per_day: base.mealsPerDay }).eq('id', sbUid).then(() => {}, () => {});\n    } catch { /* ignore */ }\n  }, [name, goal, diet, sbUid, hydrated]);"],
]);
patch('src/ui/roster.tsx', [
  ["const { data: cls, error } = await supabase.from('clients').select('id, goal').eq('trainer_id', uid);",
   "const { data: cls, error } = await supabase.from('clients').select('id, goal, diet, meals_per_day').eq('trainer_id', uid);"],
  ["next: '—', unread: 0, mode: 'online', metrics: st[c.id].mx ?? undefined }));",
   "next: '—', unread: 0, mode: 'online', metrics: st[c.id].mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined }));"],
]);
patch('src/lib/trainerMock.ts', [
  ["  metrics?: import('./inbodyMetrics').ScanMetrics;\n}",
   "  metrics?: import('./inbodyMetrics').ScanMetrics;\n  diet?: string;\n  mealsPerDay?: number;\n}"],
]);
patch('src/ui/coachNutrition.tsx', [
  ["export interface NutritionAdjust extends CoachAdjust { note?: string }",
   "export interface NutritionAdjust extends CoachAdjust { note?: string; mealOverride?: Record<number, number> }"],
  ["m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined };",
   "m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined, mealOverride: r.meal_override ?? undefined };"],
  ["supabase.from('coach_nutrition').update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0 }).eq('client_id', clientId).then(() => {}, () => {});",
   "supabase.from('coach_nutrition').update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0, meal_override: merged.mealOverride ?? null }).eq('client_id', clientId).then(() => {}, () => {});"],
]);
