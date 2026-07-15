const fs = require('fs');
const F = 'app/(client)/workouts.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 60)); process.exit(1); }
  s = s.replace(a, b);
}
// 1) empty defaults so placeholders show
rep(
  "const [mins, setMins] = useState('30'); const [dist, setDist] = useState('5');",
  "const [mins, setMins] = useState(''); const [dist, setDist] = useState('');"
);
// 2) after logging: clear to empty (ready for next) + haptic confirmation
rep(
  "    setMins('30'); setDist('5');",
  "    setMins(''); setDist(''); tapLight();"
);
// 3) descriptive placeholders (visible now that fields start empty)
rep('placeholder="mins"', 'placeholder="Time (min)"');
rep('placeholder="dist"', 'placeholder="Distance"');
fs.writeFileSync(F, s);
console.log('applied OK');
