const fs = require('fs');
const F = 'src/ui/roster.tsx';
let s = fs.readFileSync(F, 'utf8');
const a = "        const real: RosterClient[] = cls.map((c: any) => ({ id: c.id, name: names[c.id] || 'Client', goal: goalMap[c.goal] || 'General', weightDelta: st[c.id].wDelta, adherence: st[c.id].adh != null ? st[c.id].adh : 100, lastActive: st[c.id].last ? ago(st[c.id].last) : 'recently', next: '—', unread: 0, mode: 'online', metrics: st[c.id].mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined }));";
const b = "        const real: RosterClient[] = cls.map((c: any) => { const sc = st[c.id]; return { id: c.id, name: names[c.id] || 'Client', goal: goalMap[c.goal] || 'General', weightDelta: sc.wDelta, adherence: sc.adh != null ? sc.adh : 100, lastActive: sc.last ? ago(sc.last) : 'recently', next: '—', unread: 0, mode: 'online' as const, metrics: sc.mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined }; });";
const n = s.split(a).length - 1;
if (n !== 1) { console.error('ANCHOR x' + n); process.exit(1); }
s = s.replace(a, b);
fs.writeFileSync(F, s); console.log('applied OK');
