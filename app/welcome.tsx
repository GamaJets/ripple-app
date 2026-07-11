// Welcome / Auth (Phase 1) — sign in or create an account. Mock auth when
// USE_SUPABASE is false; real Supabase auth when true. Gated by app/index.tsx.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { USE_SUPABASE } from '../src/lib/config';

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
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canGo = email.trim().length > 3 && pw.length >= 6 && (mode === 'in' || name.trim().length > 0);
  const go = async () => {
    if (!canGo || busy) return;
    setBusy(true); setNotice(null);
    try {
      if (mode === 'up') {
        const res = await auth.signUp(name, email.trim(), pw);
        if (res.needsConfirmation) {
          setNotice('Account created. Check your email to confirm, then sign in.');
          setMode('in');
        } else {
          router.replace('/onboarding');
        }
      } else {
        await auth.signIn(email.trim(), pw);
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

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, marginBottom: 12 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Ripple size={28} color={t.brandInk} /></View>
            <Text style={{ color: t.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }}>{appName}</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 28 }}>{mode === 'up' ? 'Create your account to get started.' : 'Welcome back — sign in to continue.'}</Text>

          {/* Sign in / Sign up toggle */}
          <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 12, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: t.ring }}>
            {([['up', 'Create Account'], ['in', 'Sign In']] as const).map(([m, label]) => (
              <Pressable key={m} onPress={() => { setMode(m); setNotice(null); }} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', backgroundColor: mode === m ? t.brand : 'transparent' }}>
                <Text style={{ color: mode === m ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {notice ? (
            <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 18 }}>{notice}</Text>
            </View>
          ) : null}

          {mode === 'up' ? (
            <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={t.ink3} autoCapitalize="words" style={inp} accessibilityLabel="Full name" />
          ) : null}
          <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.ink3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={inp} accessibilityLabel="Email" />
          <TextInput value={pw} onChangeText={setPw} placeholder="Password (min 6 characters)" placeholderTextColor={t.ink3} secureTextEntry autoCapitalize="none" style={inp} accessibilityLabel="Password" />

          <Pressable onPress={go} disabled={!canGo || busy} accessibilityRole="button" style={{ backgroundColor: canGo ? t.brand : t.surface2, borderColor: canGo ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 }}>
            <Text style={{ color: canGo ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 15 }}>{busy ? 'Please wait…' : mode === 'up' ? 'Create Account' : 'Sign In'}</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: t.ring }} />
            <Text style={{ color: t.ink3, fontSize: 12 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.ring }} />
          </View>

          <Pressable onPress={() => provider('apple')} accessibilityRole="button" accessibilityLabel="Continue with Apple" style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <Text style={{ fontSize: 17 }}></Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>Continue with Apple</Text>
          </Pressable>
          <Pressable onPress={() => provider('google')} accessibilityRole="button" accessibilityLabel="Continue with Google" style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <Text style={{ fontSize: 15 }}>🇬</Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>Continue with Google</Text>
          </Pressable>

          <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 22, lineHeight: 16 }}>{USE_SUPABASE ? 'Your account is securely stored. By continuing you agree to the Terms & Privacy Policy.' : 'Demo mode — any email/password works. Real accounts activate when the backend is connected.'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
