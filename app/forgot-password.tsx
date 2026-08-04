// Forgot password (Phase 1) — one shared flow for all 3 portals (Client,
// Trainer, Platform Owner), since they're all the same Supabase Auth identity
// picked apart by role on the portal screen, not separate credential stores.
// Emails a Supabase recovery link that deep-links back to /reset-password.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { USE_SUPABASE } from '../src/lib/config';

export default function ForgotPassword() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGo = email.trim().length > 3 && !busy;

  const send = async () => {
    if (!canGo) return;
    setBusy(true); setError(null);
    try {
      await auth.sendPasswordReset(email.trim());
      // Always show the same confirmation, whether or not the address is
      // registered — don't let this screen be used to probe for accounts.
      setSent(true);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, marginBottom: 12 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 8 }}>Reset your password</Text>
          <Text style={{ color: t.ink3, fontSize: 14, marginBottom: 26, lineHeight: 20 }}>
            {sent
              ? `If an account exists for that email, we've sent a link to reset your ${appName} password. It works for your Client, Trainer, or Owner access — they all share one login.`
              : `Enter the email on your ${appName} account and we'll send you a link to set a new password.`}
          </Text>

          {error ? (
            <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 18 }}>{error}</Text>
            </View>
          ) : null}

          {sent ? (
            <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Back to sign in</Text>
            </Pressable>
          ) : (
            <>
              <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.ink3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={inp} accessibilityLabel="Email" autoFocus />
              <Pressable onPress={send} disabled={!canGo} accessibilityRole="button" style={{ backgroundColor: canGo ? t.brand : t.surface2, borderColor: canGo ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 }}>
                <Text style={{ color: canGo ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 15 }}>{busy ? 'Sending…' : 'Send reset link'}</Text>
              </Pressable>
              <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to sign in" style={{ marginTop: 18, alignItems: 'center', paddingVertical: 10 }}>
                <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Back to sign in</Text>
              </Pressable>
              {!USE_SUPABASE ? (
                <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 18, lineHeight: 16 }}>Demo mode — no email is actually sent. Real reset links go out once the backend is connected.</Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
