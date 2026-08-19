// Welcome / Auth (Phase 1) — sign in or create an account. Mock auth when
// USE_SUPABASE is false; real Supabase auth when true. Gated by app/index.tsx.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every auth call, branch, route and validation rule is
// unchanged — only the presentation moved: no hero (an auth screen has no
// number to lead with), the brand mark and the white-label app name lead
// instead, fields lost their 1px borders for a `surface2` fill with a quiet
// label above, and the notice is ink text beside a coloured dot rather than
// coloured text.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme, PasswordField } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { USE_SUPABASE } from '../src/lib/config';
import { recordReferral, stashPendingReferral, flushPendingReferral } from '../src/lib/referrals';
import { Rule, Card, Cta } from '../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../src/theme/scale';

function Ripple({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, opacity: 0.35 }} />
      <View style={{ position: 'absolute', width: size * 0.6, height: size * 0.6, borderRadius: size, borderWidth: 2.5, borderColor: color, opacity: 0.65 }} />
      <View style={{ width: size * 0.24, height: size * 0.24, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

export default function Welcome() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'client' | 'trainer'>('client');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [refCode, setRefCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const canGo = email.trim().length > 3 && pw.length >= 6 && (mode === 'in' || name.trim().length > 0);
  const go = async () => {
    if (!canGo || busy) return;
    setBusy(true); setNotice(null);
    try {
      if (mode === 'up') {
        const res = await auth.signUp(name, email.trim(), pw, role);
        if (res.needsConfirmation) {
          await stashPendingReferral(refCode);
          setNotice('Account created. Check your email to confirm, then sign in.');
          setMode('in');
        } else {
          await recordReferral(refCode);
          router.replace('/onboarding');
        }
      } else {
        await auth.signIn(email.trim(), pw);
        await flushPendingReferral();
        router.replace('/');
      }
    } catch (e: any) {
      setNotice(e?.message || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };
  const provider = async (p: 'apple' | 'google') => {
    setNotice(null);
    try { await auth.signInWithProvider(p); router.replace('/'); }
    catch (e: any) { setNotice(e?.message || 'Sign-in failed.'); }
  };

  // One field style, shared with <PasswordField> (which lifts the marginBottom
  // onto its wrapper so the eye toggle stays centred on the input itself).
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, marginBottom: sp.md } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.huge, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

          {/* ── the brand mark ──────────────────────────────────────────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Ripple size={28} color={t.brandInk} />
            </View>
            <Text style={{ ...ty.title, color: t.ink }}>{appName}</Text>
          </View>
          <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>
            {mode === 'up' ? 'Create your account to get started.' : 'Welcome back — sign in to continue.'}
          </Text>

          {/* Sign in / Sign up toggle */}
          <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3, marginBottom: sp.xl }}>
            {([['up', 'Create Account'], ['in', 'Sign In']] as const).map(([m, label]) => (
              <Pressable key={m} onPress={() => { setMode(m); setNotice(null); }} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: mode === m ? t.brand : 'transparent' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: mode === m ? t.brandInk : t.ink3 }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {notice ? (
            <Card tone={t.brand} style={{ marginBottom: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 6 }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{notice}</Text>
              </View>
            </Card>
          ) : null}

          {mode === 'up' ? (
            <>
              <Text style={lab}>Full name</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={t.ink3} autoCapitalize="words" style={inp} accessibilityLabel="Full name" />
            </>
          ) : null}
          {mode === 'up' ? (
            <View style={{ marginBottom: sp.md }}>
              <Text style={lab}>I'm signing up as…</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {([['client', 'A client', 'Track my own training'], ['trainer', 'A coach', 'Train & manage clients']] as const).map(([r, label, sub]) => (
                  <Pressable key={r} onPress={() => setRole(r)} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, paddingVertical: sp.md, paddingHorizontal: sp.md, borderRadius: radius.sm, backgroundColor: role === r ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.body, fontWeight: role === r ? '600' : '500', color: role === r ? t.brandInk : t.ink }}>{label}</Text>
                    <Text style={{ ...ty.caption, color: role === r ? t.brandInk : t.ink3, marginTop: 2, opacity: role === r ? 0.85 : 1 }}>{sub}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <Text style={lab}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.ink3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={inp} accessibilityLabel="Email" />
          <Text style={lab}>Password</Text>
          <PasswordField value={pw} onChangeText={setPw} placeholder="Password (min 6 characters)" style={inp} accessibilityLabel="Password" />
          {mode === 'up' ? (
            <>
              <Text style={lab}>Referral code (optional)</Text>
              <TextInput value={refCode} onChangeText={setRefCode} placeholder="Referral code (optional)" placeholderTextColor={t.ink3} autoCapitalize="characters" autoCorrect={false} style={inp} accessibilityLabel="Referral code (optional)" />
            </>
          ) : null}
          {mode === 'in' ? (
            <Pressable onPress={() => router.push('/forgot-password')} accessibilityRole="button" accessibilityLabel="Forgot password" hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Forgot password?</Text>
            </Pressable>
          ) : null}

          <View style={{ marginTop: sp.sm }}>
            <Cta wide disabled={!canGo || busy} onPress={go}
              label={busy ? 'Please wait…' : mode === 'up' ? 'Create Account' : 'Sign In'} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginVertical: sp.xl }}>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
            <Text style={{ ...ty.caption, color: t.ink3 }}>or</Text>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
          </View>

          <Pressable onPress={() => provider('apple')} accessibilityRole="button" accessibilityLabel="Continue with Apple" style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', marginBottom: sp.sm, flexDirection: 'row', justifyContent: 'center', gap: sp.sm }}>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Continue with Apple</Text>
          </Pressable>
          <Pressable onPress={() => provider('google')} accessibilityRole="button" accessibilityLabel="Continue with Google" style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm }}>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Continue with Google</Text>
          </Pressable>

          <View style={{ marginTop: sp.xl }}><Rule /></View>
          <Pressable onPress={() => { auth.enterDemo(); router.replace('/'); }} accessibilityRole="button" accessibilityLabel="Explore the demo" style={{ alignItems: 'center', paddingVertical: sp.lg }}>
            <Text style={{ ...ty.body, fontWeight: '600', color: t.brand }}>Explore the demo →</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>See the full app with sample data — no sign-up needed</Text>
          </Pressable>

          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>{USE_SUPABASE ? 'Your account is securely stored. By continuing you agree to the Terms & Privacy Policy.' : 'Demo mode — any email/password works. Real accounts activate when the backend is connected.'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
