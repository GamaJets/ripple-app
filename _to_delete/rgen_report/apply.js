const fs = require('fs');
const F = 'app/(client)/report.tsx';
let src = fs.readFileSync(F, 'utf8');
const rd = (p) => fs.readFileSync('.rgen/' + p, 'utf8');
const pairs = [
  ['a_import.txt', 'r_import.txt'],
  ['a_logic.txt', 'r_logic.txt'],
  ['a_jsx.txt', 'r_jsx.txt'],
];
for (const [a, r] of pairs) {
  const anc = rd(a), rep = rd(r);
  const n = src.split(anc).length - 1;
  if (n !== 1) { console.error('ANCHOR COUNT ' + n + ' for ' + a); process.exit(1); }
  src = src.replace(anc, rep);
}
fs.writeFileSync(F, src);
console.log('applied OK');
