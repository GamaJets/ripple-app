const fs = require('fs');
// trainer dashboard: real coach name in header
{
  const F = 'app/(trainer)/dashboard.tsx';
  let s = fs.readFileSync(F, 'utf8');
  function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('dash x' + n + ' :: ' + a.slice(0,40)); process.exit(1); } s = s.replace(a, b); }
  rep("  const { sessionFee } = useCoachProfile();",
      "  const { sessionFee, name: coachName } = useCoachProfile();");
  rep("{MOCK_TRAINER.name.replace('Coach ', '')}",
      "{(coachName || MOCK_TRAINER.name).replace('Coach ', '')}");
  fs.writeFileSync(F, s); console.log('patched dashboard');
}
// trainer chat: empty state
{
  const F = 'app/(trainer)/chat.tsx';
  let s = fs.readFileSync(F, 'utf8');
  const a = "          {msgs.map((m) => {";
  const b = "          {msgs.length === 0 ? (\n            <View style={{ alignItems: 'center', paddingVertical: 48 }}>\n              <Text style={{ color: t.ink3, fontSize: 13 }}>No messages yet — say hi to {name.split(' ')[0]}.</Text>\n            </View>\n          ) : null}\n          {msgs.map((m) => {";
  const n = s.split(a).length - 1; if (n !== 1) { console.error('chat x' + n); process.exit(1); }
  s = s.replace(a, b);
  fs.writeFileSync(F, s); console.log('patched chat');
}
