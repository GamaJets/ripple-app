const fs = require('fs');
const F = 'app/(client)/nutrition.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
rep("  const [override, setOverride] = useState<Record<number, number>>({});",
    "  const [override, setOverride] = useState<Record<number, number>>({});\n  const [ovHydrated, setOvHydrated] = useState(false);");
rep("  useEffect(() => { AsyncStorage.getItem('repple.grocery.checked').then((r) => { if (r) { try { setChecked(JSON.parse(r)); } catch { /* ignore */ } } }); }, []);",
    "  useEffect(() => { AsyncStorage.getItem('repple.grocery.checked').then((r) => { if (r) { try { setChecked(JSON.parse(r)); } catch { /* ignore */ } } }); }, []);\n  // Persist the client's meal swaps so they survive leaving the tab / relaunch.\n  useEffect(() => { AsyncStorage.getItem('repple.mealOverride').then((r) => { if (r) { try { setOverride(JSON.parse(r)); } catch { /* ignore */ } } setOvHydrated(true); }); }, []);\n  useEffect(() => { if (!ovHydrated) return; AsyncStorage.setItem('repple.mealOverride', JSON.stringify(override)).catch(() => {}); }, [override, ovHydrated]);");
fs.writeFileSync(F, s); console.log('applied OK');
