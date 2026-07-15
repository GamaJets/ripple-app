const fs = require('fs');
// --- auth.tsx: thread role through signUp ---
{
  const F = 'src/ui/auth.tsx';
  let s = fs.readFileSync(F, 'utf8');
  function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('auth x' + n + ' :: ' + a.slice(0,40)); process.exit(1); } s = s.replace(a, b); }
  rep("  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>;",
      "  signUp: (name: string, email: string, password: string, role?: Role) => Promise<SignUpResult>;");
  rep("  const signUp = async (name: string, email: string, password: string): Promise<SignUpResult> => {\n    if (!USE_SUPABASE) {\n      setUser({ id: 'local', name: name.trim() || nameFromEmail(email), email, role: 'client' });\n      return { needsConfirmation: false };\n    }\n    await sbSignUp(email, password, name.trim(), 'client');",
      "  const signUp = async (name: string, email: string, password: string, role: Role = 'client'): Promise<SignUpResult> => {\n    if (!USE_SUPABASE) {\n      setUser({ id: 'local', name: name.trim() || nameFromEmail(email), email, role });\n      return { needsConfirmation: false };\n    }\n    await sbSignUp(email, password, name.trim(), role);");
  fs.writeFileSync(F, s); console.log('patched auth.tsx');
}
// --- welcome.tsx: role state + pass role + picker UI ---
{
  const F = 'app/welcome.tsx';
  let s = fs.readFileSync(F, 'utf8');
  const picker = fs.readFileSync('.rgen31/picker.txt', 'utf8');
  function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('welcome x' + n + ' :: ' + a.slice(0,40)); process.exit(1); } s = s.replace(a, b); }
  rep(" const [name, setName] = useState('');",
      " const [name, setName] = useState('');\n const [role, setRole] = useState<'client' | 'trainer'>('client');");
  rep("const res = await auth.signUp(name, email.trim(), pw);",
      "const res = await auth.signUp(name, email.trim(), pw, role);");
  rep(' <TextInput value={email} onChangeText={setEmail} placeholder="Email"',
      picker + ' <TextInput value={email} onChangeText={setEmail} placeholder="Email"');
  fs.writeFileSync(F, s); console.log('patched welcome.tsx');
}
