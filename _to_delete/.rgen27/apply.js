const fs = require('fs');
const F = 'app/(client)/nutrition.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 50)); process.exit(1); } s = s.replace(a, b); }
// helper: is this slot a coach-set meal the client hasn't overridden?
rep("  const { plan, target, tot } = buildPlan(input);",
    "  const { plan, target, tot } = buildPlan(input);\n  const coachPick = (pos: number) => !!(coachAdjust?.mealOverride && coachAdjust.mealOverride[pos] != null && override[pos] == null);");
// badge on the today meal card
rep("              <Text style={{ color: t.brand, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>{m.slot}</Text>",
    "              <Text style={{ color: t.brand, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>{m.slot}{coachPick(m.pos) ? \"  ·  COACH'S PICK\" : ''}</Text>");
fs.writeFileSync(F, s); console.log('applied OK');
