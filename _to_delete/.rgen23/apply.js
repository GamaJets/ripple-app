const fs = require('fs');
const F = 'app/(client)/workouts.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
// MET table + estimator (module level)
rep("const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility']] as const;",
    "const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility']] as const;\n// Approx METs per activity — kcal = MET x weight(kg) x hours (standard estimate).\nconst MET: Record<string, number> = {\n  'Treadmill / Run': 9.8, 'Cycling': 7.5, 'Rowing': 7.0, 'Ski erg': 9.0, 'Elliptical': 5.0, 'Swim': 8.0, 'Walk': 3.8, 'Stairs': 8.0,\n  'Circuit': 8.0, 'Tabata': 10.0, 'EMOM': 8.0, 'AMRAP': 8.0, 'Sprint intervals': 12.0, 'Bike intervals': 10.0, 'Bag work': 7.0,\n  'Stretching': 2.5, 'Yoga': 3.0, 'Foam rolling': 2.5, 'Dynamic warm-up': 4.0, 'Pilates': 3.5,\n};\nconst cardioKcal = (type: string, mins: number, weightKg?: number) => Math.round((MET[type] ?? 7) * (weightKg && weightKg > 0 ? weightKg : 70) * (mins / 60));");
// use it in logCardio
rep("    const m = parseInt(mins, 10) || 0, d = parseFloat(dist) || 0; if (!m) return;\n    const kcal = Math.round(m * 10);",
    "    const m = parseInt(mins, 10) || 0, d = parseFloat(dist) || 0; if (!m) return;\n    const kcal = cardioKcal(ctype, m, cd.weightKg);");
fs.writeFileSync(F, s); console.log('applied OK');
