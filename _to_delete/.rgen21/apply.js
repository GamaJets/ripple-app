const fs = require('fs');
const F = 'app/(client)/scans.tsx';
let s = fs.readFileSync(F, 'utf8');
const old = fs.readFileSync('.rgen21/old.txt', 'utf8');
const nw = fs.readFileSync('.rgen21/new.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 40)); process.exit(1); } s = s.replace(a, b); }
rep("  const [ocrMsg, setOcrMsg] = useState<string | null>(null);",
    "  const [ocrMsg, setOcrMsg] = useState<string | null>(null);\n  const [mxOpen, setMxOpen] = useState<string | null>(null);");
rep(old, nw);
fs.writeFileSync(F, s); console.log('applied OK');
