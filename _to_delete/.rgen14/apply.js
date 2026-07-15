const fs = require('fs');
const F = 'app/(client)/report.tsx';
let s = fs.readFileSync(F, 'utf8');
const rd = (p) => fs.readFileSync('.rgen14/' + p, 'utf8');
for (const [a, r] of [['a1.txt','r1.txt'],['a2.txt','r2.txt'],['a3.txt','r3.txt'],['a4.txt','r4.txt']]) {
  const anc = rd(a), rep = rd(r);
  const n = s.split(anc).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' for ' + a); process.exit(1); }
  s = s.replace(anc, rep);
}
fs.writeFileSync(F, s); console.log('applied OK');
