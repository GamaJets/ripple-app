const fs = require('fs');
const F = 'app/(trainer)/dashboard.tsx';
let s = fs.readFileSync(F, 'utf8');
const block = fs.readFileSync('.rgen11/block.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 60)); process.exit(1); } s = s.replace(a, b); }
// import metric defs
rep("import { atRiskClient } from '../../src/lib/trainerMock';",
    "import { atRiskClient } from '../../src/lib/trainerMock';\nimport { METRIC_DEFS, METRIC_GROUPS } from '../../src/lib/inbodyMetrics';");
// insert composition block before the Tags section in the detail sheet
rep("              <View style={{ marginBottom: 16 }}>\n                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Tags</Text>",
    block + "\n              <View style={{ marginBottom: 16 }}>\n                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Tags</Text>");
fs.writeFileSync(F, s); console.log('applied OK');
