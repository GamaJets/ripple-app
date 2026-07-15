const fs = require('fs');
function patch(F, edits) {
  let s = fs.readFileSync(F, 'utf8');
  for (const [a, b] of edits) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + F + ' :: ' + a.slice(0, 60)); process.exit(1); }
    s = s.replace(a, b);
  }
  fs.writeFileSync(F, s); console.log('patched ' + F);
}
// RosterClient: carry latest InBody metrics
patch('src/lib/trainerMock.ts', [
  ["  mode: 'online' | 'inperson';\n  injuries?: { area: string; severity: string; note?: string; isNew?: boolean }[];\n}",
   "  mode: 'online' | 'inperson';\n  injuries?: { area: string; severity: string; note?: string; isNew?: boolean }[];\n  metrics?: import('./inbodyMetrics').ScanMetrics;\n}"],
]);
// roster: fetch metrics, capture latest per client, expose it
patch('src/ui/roster.tsx', [
  ["const { data: sc } = await supabase.from('scans').select('client_id, weight_kg, taken_at').in('client_id', ids).order('taken_at', { ascending: true });",
   "const { data: sc } = await supabase.from('scans').select('client_id, weight_kg, taken_at, metrics').in('client_id', ids).order('taken_at', { ascending: true });"],
  ["const st: Record<string, { wDelta: number; adh: number | null; last: number }> = {};",
   "const st: Record<string, { wDelta: number; adh: number | null; last: number; mx?: any }> = {};"],
  ["const byC: Record<string, { w: number; t: number }[]> = {};\n          (sc || []).forEach((r: any) => { (byC[r.client_id] = byC[r.client_id] || []).push({ w: Number(r.weight_kg), t: Date.parse(r.taken_at) }); });\n          for (const id of ids) { const arr = byC[id]; if (arr && arr.length) { st[id].wDelta = Math.round((arr[arr.length - 1].w - arr[0].w) * 10) / 10; st[id].last = Math.max(st[id].last, arr[arr.length - 1].t); } }",
   "const byC: Record<string, { w: number; t: number; m: any }[]> = {};\n          (sc || []).forEach((r: any) => { (byC[r.client_id] = byC[r.client_id] || []).push({ w: Number(r.weight_kg), t: Date.parse(r.taken_at), m: r.metrics }); });\n          for (const id of ids) { const arr = byC[id]; if (arr && arr.length) { st[id].wDelta = Math.round((arr[arr.length - 1].w - arr[0].w) * 10) / 10; st[id].last = Math.max(st[id].last, arr[arr.length - 1].t); for (let k = arr.length - 1; k >= 0; k--) { if (arr[k].m) { st[id].mx = arr[k].m; break; } } } }"],
  ["weightDelta: st[c.id].wDelta, adherence: st[c.id].adh != null ? st[c.id].adh : 100, lastActive: st[c.id].last ? ago(st[c.id].last) : 'recently', next: '—', unread: 0, mode: 'online' }));",
   "weightDelta: st[c.id].wDelta, adherence: st[c.id].adh != null ? st[c.id].adh : 100, lastActive: st[c.id].last ? ago(st[c.id].last) : 'recently', next: '—', unread: 0, mode: 'online', metrics: st[c.id].mx ?? undefined }));"],
]);
