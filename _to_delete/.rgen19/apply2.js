const fs = require('fs');
const F = 'app/(client)/nutrition.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
// forward carb + fat deltas through the macro-cycling wrapper (were dropped on Meals)
rep("    ? { kcalDelta: (coachAdjust?.kcalDelta || 0) + cycleDelta, proteinDelta: coachAdjust?.proteinDelta }",
    "    ? { kcalDelta: (coachAdjust?.kcalDelta || 0) + cycleDelta, proteinDelta: coachAdjust?.proteinDelta, carbDelta: coachAdjust?.carbDelta, fatDelta: coachAdjust?.fatDelta }");
// merge the coach's per-meal picks under the client's own swaps (client wins)
rep("mealOverride: override, coachAdjust: cyclingAdjust, avoid: c.avoid };",
    "mealOverride: { ...(coachAdjust?.mealOverride ?? {}), ...override }, coachAdjust: cyclingAdjust, avoid: c.avoid };");
fs.writeFileSync(F, s); console.log('applied OK');
