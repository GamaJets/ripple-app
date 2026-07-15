const fs = require('fs');
const F = 'app/(client)/music.tsx';
let s = fs.readFileSync(F, 'utf8');
const a = " const generate = (nextSalt = salt, nextIntensity = intensity) => {";
const b = " // When a playlist is on screen, changing mode/intensity/length re-matches it live.\n useEffect(() => { setPl((cur) => cur ? generatePlaylist({ mode, intensity, minutes }, salt) : cur); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, intensity, minutes]);\n const generate = (nextSalt = salt, nextIntensity = intensity) => {";
const n = s.split(a).length - 1;
if (n !== 1) { console.error('ANCHOR x' + n); process.exit(1); }
s = s.replace(a, b);
fs.writeFileSync(F, s); console.log('applied OK');
