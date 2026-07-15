const fs = require('fs');
const F = 'app/(client)/music.tsx';
let s = fs.readFileSync(F, 'utf8');
const a = "catch (e) { Alert.alert('Spotify',";
const cnt = s.split(a).length - 1;
if (cnt !== 2) { console.error('expected 2, got ' + cnt); process.exit(1); }
s = s.split(a).join("catch (e: any) { Alert.alert('Spotify',");
fs.writeFileSync(F, s); console.log('fixed ' + cnt + ' catch blocks');
