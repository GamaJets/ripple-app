"use strict";
// Wearable integration — one contract every device plugs into.
// Apple Health (HealthKit), Google Health Connect, and cloud APIs (WHOOP, Oura,
// Garmin, Fitbit) all implement WearableProvider, so the UI and the sync logic
// never care which brand they're talking to.
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyMetrics = emptyMetrics;
function emptyMetrics(source) {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, activeKcal: null, totalKcal: null, steps: null, heartRateAvg: null, heartRateLatest: null, heartRateResting: null, heartRateMax: null, zoneSeconds: null, workoutMins: null, hrv: null, recoveryPct: null, recoverySource: null, strain: null, updatedAt: d.toISOString(), source };
}
