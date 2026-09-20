// Forgot password (Phase 1) — one shared flow for all 3 portals (Client,
// Trainer, Platform Owner), since they're all the same Supabase Auth identity
// picked apart by role on the portal screen, not separate credential stores.
// Emails a Supabase recovery link that deep-links back to /reset-password.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). The send call, the deliberate always-the-same
// confirmation and both branches are unchanged — only the presentation moved:
// no hero (nothing is measured here), the white-label app name is the kicker
// above a `ty.title`, the field lost its 1px border for a `surface2` fill, and
// the error is ink text beside a coloured dot rather than coloured text.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { USE_SUPABASE } from '../src/lib/config';
import { Card, Cta, HeroCard } from '../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, font } from '../src/theme/scale';

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

  // The door's field — see app/welcome.tsx: a 52pt `surface2` pill on the card.
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, minHeight: 52, paddingVertical: sp.md, marginBottom: sp.md } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {/* The door's night head, carried onto this step. "If an account
              exists" stays word for word: it is the sentence that stops this
              screen telling anybody which addresses are registered. */}
          <HeroCard eyebrow={appName.toUpperCase()} title={sent ? 'Check Your Email' : 'Reset Your Password'}
            meta={sent
              ? `If an account exists for that email, a reset link is on its way. One login covers every ${appName} app.`
              : `We'll email you a link to set a new one.`} />

          <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, padding: sp.lg, marginTop: sp.lg, ...elevation.card }}>
          {error ? (
            <Card tone={t.crit} style={{ marginBottom: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit, marginTop: 6 }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{error}</Text>
              </View>
            </Card>
          ) : null}

          {sent ? (
            <Cta wide label="Back to Sign In" onPress={() => router.back()} />
          ) : (
            <>
              <Text style={{ ...ty.caption, ...font('600'), color: t.ink2, marginBottom: 6 }}>Email</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.ink3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={inp} accessibilityLabel="Email" autoFocus />
              <View style={{ marginTop: sp.sm }}>
                <Cta wide disabled={!canGo} onPress={send} label={busy ? 'Sending…' : 'Send Reset Link'} />
              </View>
              <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to sign in" style={{ marginTop: sp.lg, alignItems: 'center', paddingVertical: sp.sm }}>
                <Text style={{ ...ty.label, ...font('600'), color: t.ink2 }}>Back to Sign In</Text>
              </Pressable>
              {!USE_SUPABASE ? (
                <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>Demo mode — no email is actually sent. Real reset links go out once the backend is connected.</Text>
              ) : null}
            </>
          )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
