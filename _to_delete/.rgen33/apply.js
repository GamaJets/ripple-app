const fs = require('fs');
// dashboard: welcoming empty state for a brand-new coach
{
  const F = 'app/(trainer)/dashboard.tsx';
  let s = fs.readFileSync(F, 'utf8');
  const a = "            <Text style={{ color: t.ink3, fontSize: 13 }}>No clients in this segment.</Text>";
  const b = "            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{roster.length === 0 ? 'No clients yet. Tap Add Client to invite your first — they connect once they accept in the app.' : 'No clients in this segment.'}</Text>";
  const n = s.split(a).length - 1; if (n !== 1) { console.error('dash x' + n); process.exit(1); }
  s = s.replace(a, b); fs.writeFileSync(F, s); console.log('patched dashboard');
}
// leaderboard: empty state
{
  const F = 'app/(trainer)/leaderboard.tsx';
  let s = fs.readFileSync(F, 'utf8');
  const a = "        {scored.map(({ c, score }, i) => (";
  const b = "        {scored.length === 0 ? (\n          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>\n            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>No clients yet — your leaderboard fills in as clients join and log their workouts.</Text>\n          </View>\n        ) : null}\n        {scored.map(({ c, score }, i) => (";
  const n = s.split(a).length - 1; if (n !== 1) { console.error('lb x' + n); process.exit(1); }
  s = s.replace(a, b); fs.writeFileSync(F, s); console.log('patched leaderboard');
}
// analytics: empty-state note when no clients
{
  const F = 'app/(trainer)/analytics.tsx';
  let s = fs.readFileSync(F, 'utf8');
  const a = "        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Your coaching business at a glance</Text>";
  const b = a + "\n        {clients === 0 ? (\n          <View style={{ backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 16 }}>\n            <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19 }}>No clients yet — revenue, adherence and roster health populate as you add clients and run sessions.</Text>\n          </View>\n        ) : null}";
  const n = s.split(a).length - 1; if (n !== 1) { console.error('an x' + n); process.exit(1); }
  s = s.replace(a, b); fs.writeFileSync(F, s); console.log('patched analytics');
}
