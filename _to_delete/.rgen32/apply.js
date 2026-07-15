const fs = require('fs');
const F = 'src/ui/roster.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 50)); process.exit(1); } s = s.replace(a, b); }
// 1) real users start with a clean (empty) roster; only local/demo mode seeds the mock
rep("  const [roster, setRoster] = useState<RosterClient[]>(() => JSON.parse(JSON.stringify(ROSTER)));",
    "  const [roster, setRoster] = useState<RosterClient[]>(() => (USE_SUPABASE ? [] : JSON.parse(JSON.stringify(ROSTER))));");
// 1b) update the stale comment
rep("  // Hydrate real, linked clients from Supabase (they appear alongside the demo\n  // roster with their true account id, so messaging/feedback/plans key off it).",
    "  // A real signed-in coach sees ONLY their linked clients (clean slate if none);\n  // a guest/demo (no session) sees the sample roster so the portal isn't empty to explore.");
// 2) guest/demo (no uid) → show the sample roster; real coach continues to real fetch
rep("        const uid = auth?.user?.id; if (!uid || cancelled) return;",
    "        const uid = auth?.user?.id;\n        if (cancelled) return;\n        if (!uid) { setRoster(JSON.parse(JSON.stringify(ROSTER))); return; }");
// 3) replace (not prepend to mock) with the real client list
rep("        if (!cancelled && real.length) setRoster((p) => { const seen = new Set(p.map((x) => x.id)); const add = real.filter((r) => !seen.has(r.id)); return add.length ? [...add, ...p] : p; });",
    "        if (!cancelled) setRoster(real);");
fs.writeFileSync(F, s); console.log('applied OK');
