const fs = require('fs');
const F = 'supabase/functions/wearable-day/index.ts';
let s = fs.readFileSync(F, 'utf8');
const whoop = fs.readFileSync('.rgen18/whoop.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
rep("async function readVendor(provider: string, token: string) {", whoop + "async function readVendor(provider: string, token: string) {");
rep("  if (provider === 'oura') return await ouraDay(token);\n  return null; // whoop/garmin day-mapping: add once credentials exist to test against",
    "  if (provider === 'oura') return await ouraDay(token);\n  if (provider === 'whoop') return await whoopDay(token);\n  return null; // garmin day-mapping: add once credentials exist to test against");
fs.writeFileSync(F, s); console.log('applied OK');
