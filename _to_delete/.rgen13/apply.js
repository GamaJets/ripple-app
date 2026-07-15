const fs = require('fs');
const F = 'app/(trainer)/dashboard.tsx';
let s = fs.readFileSync(F, 'utf8');
const block = fs.readFileSync('.rgen13/block.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
// widen the helper text
rep("Nudge {sel.name.split(' ')[0]}'s daily calories & protein — applies to their Meals tab live.",
    "Shape {sel.name.split(' ')[0]}'s daily calories, protein, carbs & fat — applies to their Meals tab live.");
// insert carbs + fat rows before the note row
rep("                <View style={{ flexDirection: 'row', gap: 8 }}>\n                  <TextInput value={nnote} onChangeText={setNnote} placeholder=\"Note on the plan (optional)…\"",
    block + "                <View style={{ flexDirection: 'row', gap: 8 }}>\n                  <TextInput value={nnote} onChangeText={setNnote} placeholder=\"Note on the plan (optional)…\"");
fs.writeFileSync(F, s); console.log('applied OK');
