const fs = require('fs');
const F = 'app/(client)/music.tsx';
let s = fs.readFileSync(F, 'utf8');
const a = " <Text style={{ color: t.ink3, fontSize: 11 }}>{''.repeat(tr.energy)}</Text>";
const b = " <Text style={{ color: t.brand, fontSize: 10, letterSpacing: 1 }}>{tr.bpm > 0 ? '\\u25cf'.repeat(tr.energy) : ''}</Text>";
const n = s.split(a).length - 1;
if (n !== 1) { console.error('ANCHOR x' + n); process.exit(1); }
s = s.replace(a, b);
fs.writeFileSync(F, s); console.log('applied OK');
