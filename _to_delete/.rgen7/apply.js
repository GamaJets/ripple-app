const fs = require('fs');
const F = 'src/ui/clientData.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 64)); process.exit(1); }
  s = s.replace(a, b);
}
// import
rep("import AsyncStorage from '@react-native-async-storage/async-storage';",
    "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport type { ScanMetrics } from '../lib/inbodyMetrics';");
// ScanRec field
rep("skeletalMuscleKg: number; source: string; image?: string }",
    "skeletalMuscleKg: number; source: string; image?: string; metrics?: ScanMetrics }");
// state
rep("  const [scans, setScans] = useState<ScanRec[]>(base.scans.map((s) => ({ id: s.id, takenAt: s.takenAt, weightKg: s.weightKg, bodyFatPct: s.bodyFatPct, skeletalMuscleKg: s.skeletalMuscleKg, source: s.source })));",
    "  const [scans, setScans] = useState<ScanRec[]>(base.scans.map((s) => ({ id: s.id, takenAt: s.takenAt, weightKg: s.weightKg, bodyFatPct: s.bodyFatPct, skeletalMuscleKg: s.skeletalMuscleKg, source: s.source })));\n  const [scanMetrics, setScanMetrics] = useState<Record<string, ScanMetrics>>({});");
// hydrate effect
rep("  // Sync body scans with Supabase (per user) — hydrate-or-seed, defensive.",
    "  // Load locally-cached InBody composition metrics (keyed by scan date).\n  useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem('repple.scanMetrics'); if (raw) setScanMetrics(JSON.parse(raw)); } catch { /* ignore */ } })(); }, []);\n  // Sync body scans with Supabase (per user) — hydrate-or-seed, defensive.");
// merge metrics into sorted
rep("  const sorted = useMemo(() => [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [scans]);",
    "  const sorted = useMemo(() => [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)).map((s) => (s.metrics ? s : (scanMetrics[s.takenAt.slice(0, 10)] ? { ...s, metrics: scanMetrics[s.takenAt.slice(0, 10)] } : s))), [scans, scanMetrics]);");
// addScan writes metrics side-store
rep("addScan: (s) => { setScans((p) => [...p, s]); setManualWeight(null);",
    "addScan: (s) => { setScans((p) => [...p, s]); if (s.metrics && Object.values(s.metrics).some((v) => v != null)) { setScanMetrics((prev) => { const nm = { ...prev, [s.takenAt.slice(0, 10)]: s.metrics! }; AsyncStorage.setItem('repple.scanMetrics', JSON.stringify(nm)).catch(() => {}); return nm; }); } setManualWeight(null);");
fs.writeFileSync(F, s);
console.log('applied OK');
