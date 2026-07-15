const fs = require('fs');
const F = 'src/ui/clientData.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 64)); process.exit(1); }
  s = s.replace(a, b);
}
// hydrate: carry metrics jsonb from DB
rep("setScans(data.map((r: any) => ({ id: r.id, takenAt: r.taken_at, weightKg: Number(r.weight_kg), bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : 0, source: r.source ?? '' })));",
    "setScans(data.map((r: any) => ({ id: r.id, takenAt: r.taken_at, weightKg: Number(r.weight_kg), bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : 0, source: r.source ?? '', metrics: r.metrics ?? undefined })));");
// addScan: base insert stays reliable; write metrics via a separate best-effort update (non-breaking if the column isn't there yet)
rep("supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).then(() => {}, () => {});",
    "supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).select('id').single().then((res: any) => { const rid = res && res.data && res.data.id; if (rid && s.metrics && Object.values(s.metrics).some((v) => v != null)) { supabase.from('scans').update({ metrics: s.metrics }).eq('id', rid).then(() => {}, () => {}); } }, () => {});");
fs.writeFileSync(F, s);
console.log('applied OK');
