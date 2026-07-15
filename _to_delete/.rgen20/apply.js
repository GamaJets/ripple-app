const fs = require('fs');
const F = 'app/(trainer)/dashboard.tsx';
let s = fs.readFileSync(F, 'utf8');
const slots = fs.readFileSync('.rgen20/slots.txt', 'utf8');
const modal = fs.readFileSync('.rgen20/modal.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
rep("import { useCoachNutrition } from '../../src/ui/coachNutrition';",
    "import { useCoachNutrition } from '../../src/ui/coachNutrition';\nimport { slotsFor, searchMeals, mealAt, type Slot } from '../../src/lib/meals';");
rep("  const { get: getNutri, setAdjust: setNutri, clear: clearNutri } = useCoachNutrition();",
    "  const { get: getNutri, setAdjust: setNutri, clear: clearNutri } = useCoachNutrition();\n  const [mealPick, setMealPick] = useState<{ pos: number; slot: Slot } | null>(null);\n  const [mealQuery, setMealQuery] = useState('');");
rep("                <View style={{ flexDirection: 'row', gap: 8 }}>\n                  <TextInput value={nnote} onChangeText={setNnote} placeholder=\"Note on the plan (optional)…\"",
    slots + "                <View style={{ flexDirection: 'row', gap: 8 }}>\n                  <TextInput value={nnote} onChangeText={setNnote} placeholder=\"Note on the plan (optional)…\"");
rep("      {/* AI check-in draft review */}", modal + "      {/* AI check-in draft review */}");
fs.writeFileSync(F, s); console.log('applied OK');
