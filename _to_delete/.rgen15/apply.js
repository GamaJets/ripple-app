const fs = require('fs');
const F = 'app/(trainer)/dashboard.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
// enrich the coach AI summary context with InBody composition
rep(
  "    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence + '%', recentMeals: clientMeals.map((mm) => mm.name).join(', ') || 'no meals logged yet' };\n    const reply = await askCoach([{ role: 'user', content: 'Write a concise 3-4 sentence weekly coaching summary for this client: what is going well, one concern to watch, and one focus for next week. Use their adherence and recent meals.' }], ctx);",
  "    const m = client.metrics;\n    const compStr = m ? [m.visceralFat != null ? 'visceral fat ' + m.visceralFat : '', m.inbodyScore != null ? 'InBody score ' + m.inbodyScore : '', m.leanMassKg != null ? 'lean mass ' + m.leanMassKg + 'kg' : '', m.fatMassKg != null ? 'fat mass ' + m.fatMassKg + 'kg' : '', (m.leanArmLKg != null && m.leanArmRKg != null && Math.abs(m.leanArmLKg - m.leanArmRKg) / Math.max(m.leanArmLKg, m.leanArmRKg) >= 0.1) ? 'arm imbalance' : '', (m.leanLegLKg != null && m.leanLegRKg != null && Math.abs(m.leanLegLKg - m.leanLegRKg) / Math.max(m.leanLegLKg, m.leanLegRKg) >= 0.1) ? 'leg imbalance' : ''].filter(Boolean).join(', ') : '';\n    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence + '%', recentMeals: clientMeals.map((mm) => mm.name).join(', ') || 'no meals logged yet', composition: compStr || 'no InBody scan yet' };\n    const reply = await askCoach([{ role: 'user', content: 'Write a concise 3-4 sentence weekly coaching summary for this client: what is going well, one concern to watch, and one focus for next week. Use their adherence, recent meals and InBody composition where available.' }], ctx);"
);
fs.writeFileSync(F, s); console.log('applied OK');
