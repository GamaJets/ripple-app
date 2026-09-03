"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRIC_DEFS = exports.METRIC_GROUPS = void 0;
exports.metricTrends = metricTrends;
exports.compositionInsights = compositionInsights;
// InBody composition metrics — the richer field set we extract from a scan and
// trend over time. Kept backend-agnostic so the vision layer, storage and UI
// all share one definition. Every field is optional (a report may omit some).
const deltaLabel_1 = require("./deltaLabel");
// Groups match the four the owner chose to track.
exports.METRIC_GROUPS = ['Health & metabolism', 'Fat vs lean', 'Segmental lean', 'Water, protein & minerals'];
exports.METRIC_DEFS = [
    { key: 'visceralFat', label: 'Visceral Fat', unit: 'lvl', better: 'down', group: 'Health & metabolism' },
    { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', group: 'Health & metabolism' },
    { key: 'bmr', label: 'BMR', unit: 'kcal', better: 'up', group: 'Health & metabolism' },
    { key: 'fatMassKg', label: 'Fat Mass', unit: 'kg', better: 'down', group: 'Fat vs lean', decimals: 1 },
    { key: 'leanMassKg', label: 'Lean Mass', unit: 'kg', better: 'up', group: 'Fat vs lean', decimals: 1 },
    { key: 'leanArmLKg', label: 'Left Arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
    { key: 'leanArmRKg', label: 'Right Arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
    { key: 'leanTrunkKg', label: 'Trunk', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 1 },
    { key: 'leanLegLKg', label: 'Left Leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
    { key: 'leanLegRKg', label: 'Right Leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
    { key: 'bodyWaterL', label: 'Body Water', unit: 'L', better: 'up', group: 'Water, protein & minerals', decimals: 1 },
    { key: 'proteinKg', label: 'Protein', unit: 'kg', better: 'up', group: 'Water, protein & minerals', decimals: 1 },
    { key: 'mineralsKg', label: 'Minerals', unit: 'kg', better: 'up', group: 'Water, protein & minerals', decimals: 2 },
];
/** Per-metric latest value, delta vs the previous scan that had it, and the full series. */
function metricTrends(scans) {
    const asc = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
    const out = [];
    for (const def of exports.METRIC_DEFS) {
        const pts = asc.map((s) => (s.metrics ? s.metrics[def.key] : undefined)).filter((v) => typeof v === 'number');
        if (!pts.length)
            continue;
        const latest = pts[pts.length - 1];
        const prev = pts.length > 1 ? pts[pts.length - 2] : null;
        const delta = prev != null ? +(latest - prev).toFixed(def.decimals ?? 0) : null;
        let good = null;
        if (delta != null && def.better !== 'none' && delta !== 0)
            good = def.better === 'up' ? delta > 0 : delta < 0;
        out.push({ def, latest, prev, delta, good, series: pts });
    }
    return out;
}
/** Plain-English "what's improving / what to watch", plus left-right balance flags. */
function compositionInsights(scans) {
    const trends = metricTrends(scans);
    const improving = [], watch = [];
    // Through deltaLabel rather than interpolating the number. `${tr.delta}` on a
    // negative prints a HYPHEN, and the rest of the app prints U+2212 MINUS, so
    // the same drop read differently depending on which screen showed it — and
    // deltaLabel is also what guarantees a movement of nothing never arrives here
    // wearing a sign. No baseline is named because this line has none of its own:
    // it is a fragment for a summary that dates itself.
    const line = (tr) => `${tr.def.label} ${(0, deltaLabel_1.deltaLabel)(tr.delta, {
        since: null,
        decimals: tr.def.decimals ?? 0,
        noChange: 'unchanged',
        noBaseline: 'no earlier reading',
    })}`.trim();
    for (const tr of trends) {
        if (tr.good === true)
            improving.push(line(tr));
        else if (tr.good === false)
            watch.push(line(tr));
    }
    const balance = [];
    const asc = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
    const last = [...asc].reverse().find((s) => s.metrics && (s.metrics.leanArmLKg != null || s.metrics.leanLegLKg != null));
    const m = last?.metrics;
    if (m) {
        const pair = (l, r, name) => {
            if (l == null || r == null || l === 0 || r === 0)
                return;
            const diff = Math.abs(l - r) / Math.max(l, r);
            if (diff >= 0.1)
                balance.push(`${name}: ${l < r ? 'left' : 'right'} ${Math.round(diff * 100)}% behind — train the weaker side.`);
        };
        pair(m.leanArmLKg, m.leanArmRKg, 'Arms');
        pair(m.leanLegLKg, m.leanLegRKg, 'Legs');
    }
    return { improving, watch, balance };
}
