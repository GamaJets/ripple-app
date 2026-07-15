const fs = require('fs');
const F = 'app/(client)/scans.tsx';
let s = fs.readFileSync(F, 'utf8');
const trends = fs.readFileSync('.rgen8/trends.txt', 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 64)); process.exit(1); }
  s = s.replace(a, b);
}
// import helpers
rep("import { analyzeInBody, analyzePhysique, visionAvailable, type PhysiqueVision } from '../../src/lib/vision';",
    "import { analyzeInBody, analyzePhysique, visionAvailable, type PhysiqueVision } from '../../src/lib/vision';\nimport { metricTrends, compositionInsights, METRIC_GROUPS, type ScanMetrics } from '../../src/lib/inbodyMetrics';");
// state
rep("  const [ocrMsg, setOcrMsg] = useState<string | null>(null);",
    "  const [ocrMsg, setOcrMsg] = useState<string | null>(null);\n  const [scanMx, setScanMx] = useState<ScanMetrics | null>(null);");
// reset on new pick
rep("const asset = res.assets[0]; const uri = asset.uri; setImg(uri); setReading(true); setOcrMsg(null);",
    "const asset = res.assets[0]; const uri = asset.uri; setImg(uri); setReading(true); setOcrMsg(null); setScanMx(null);");
// capture metrics from vision
rep("          setReading(false);\n          if (v.weightKg != null) setWt(String(v.weightKg));",
    "          setReading(false);\n          setScanMx(v.metrics ?? null);\n          if (v.weightKg != null) setWt(String(v.weightKg));");
// include metrics on save + reset
rep("cd.addScan({ id: 's' + Date.now(), takenAt: scanDateISO(), weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source: 'InBody (manual)', image: img || undefined });",
    "cd.addScan({ id: 's' + Date.now(), takenAt: scanDateISO(), weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source: scanMx ? 'InBody (OCR)' : 'InBody (manual)', image: img || undefined, metrics: scanMx ?? undefined });");
rep("    setImg(null); setWt(''); setBf(''); setSm(''); setShowAdd(false);",
    "    setImg(null); setWt(''); setBf(''); setSm(''); setScanMx(null); setShowAdd(false);");
// derived trend data
rep("  const wsv = cd.weightSeries.map((x) => x.v);",
    "  const wsv = cd.weightSeries.map((x) => x.v);\n  const mTrends = metricTrends(cd.scans);\n  const mInsights = compositionInsights(cd.scans);\n  const mByGroup = METRIC_GROUPS.map((g) => ({ group: g, items: mTrends.filter((x) => x.def.group === g) })).filter((g) => g.items.length > 0);");
// insert trends section before the latest-scan card
rep("        {/* latest InBody scan card */}", trends + "\n        {/* latest InBody scan card */}");
fs.writeFileSync(F, s);
console.log('applied OK');
