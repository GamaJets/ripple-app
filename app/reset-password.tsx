// Reset password (Phase 1) — lands here from the `repple://reset-password`
// deep link in the recovery email (see forgot-password.tsx). The Supabase
// client uses the PKCE flow, so the link carries a `?code=...` query param
// (or `?error=...&error_description=...` if stale/used) that we exchange for
// a session. We parse it by hand since the client runs with
// detectSessionInUrl:false (no browser URL to auto-read on native). A
// fragment-based `#access_token=...&refresh_token=...` is kept as a fallback,
// but query params are the reliable path — fragments can get silently
// dropped when a server redirect crosses from https:// to a custom scheme.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';

function parseAuthParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = url.split(/[?#]/).slice(1);
  for (const part of parts) {
    part.split('&').forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
    });
  }
  return params;
}

type Stage = 'checking' | 'ready' | 'invalid' | 'saving' | 'done';

export default function ResetPassword() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();
  const [stage, setStage] = useState<Stage>('checking');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const handleUrl = async (url: string | null) => {
    if (!url || handled.current) return;
    const params = parseAuthParams(url);
    if (params.error || params.error_description) {
      handled.current = true;
      setStage('invalid');
      return;
    }
    if (params.code) {
      handled.current = true;
      try {
        await auth.beginPasswordRecoveryWithCode(params.code);
        setStage('ready');
      } catch {
        setStage('invalid');
      }
      return;
    }
    if (params.access_token && params.refresh_token) {
      handled.current = true;
      try {
        await auth.beginPasswordRecoveryWithTokens(params.access_token, params.refresh_token);
        setStage('ready');
      } catch {
        setStage('invalid');
      }
    }
  };

  useEffect(() => {
    let active = true;
    Linking.getInitialURL().then((url) => { if (active) handleUrl(url); });
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    // If neither an initial URL nor a live event hands us tokens within a beat
    // (e.g. someone navigated here directly), treat the link as invalid.
    const timer = setTimeout(() => { if (active && !handled.current) setStage('invalid'); }, 2500);
    return () => { active = false; sub.remove(); clearTimeout(timer); };
  }, []);

  const canSave = pw.length >= 6 && pw === pw2 && stage === 'ready';

  const save = async () => {
    if (!canSave) return;
    setStage('saving'); setError(null);
    try {
      await auth.completePasswordReset(pw);
      setStage('done');
    } catch (e: any) {
      setError(e?.message || 'Could not update your password. Please try the link again.');
      setStage('ready');
    }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, marginBottom: 12 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 8 }}>
            {stage === 'done' ? 'Password updated' : 'Set a new password'}
          </Text>

          {stage === 'checking' ? (
            <Text style={{ color: t.ink3, fontSize: 14, lineHeight: 20 }}>Checking your reset link…</Text>
          ) : null}

          {stage === 'invalid' ? (
            <>
              <Text style={{ color: t.ink3, fontSize: 14, marginBottom: 22, lineHeight: 20 }}>
                This link is invalid or has expired. Request a new one and use it within an hour.
              </Text>
              <Pressable onPress={() => router.replace('/forgot-password')} accessibilityRole="button" style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Request a new link</Text>
              </Pressable>
            </>
          ) : null}

          {stage === 'ready' || stage === 'saving' ? (
            <>
              <Text style={{ color: t.ink3, fontSize: 14, marginBottom: 22, lineHeight: 20 }}>
                Choose a new password for your {appName} account. It applies to Client, Trainer, and Owner access alike.
              </Text>
              {error ? (
                <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 18 }}>{error}</Text>
                </View>
              ) : null}
              <TextInput value={pw} onChangeText={setPw} placeholder="New password (min 6 characters)" placeholderTextColor={t.ink3} secureTextEntry autoCapitalize="none" style={inp} accessibilityLabel="New password" autoFocus />
              <TextInput value={pw2} onChangeText={setPw2} placeholder="Confirm new password" placeholderTextColor={t.ink3} secureTextEntry autoCapitalize="none" style={inp} accessibilityLabel="Confirm new password" />
              {pw2.length > 0 && pw !== pw2 ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: -6, marginBottom: 12 }}>Passwords don't match.</Text>
              ) : null}
              <Pressable onPress={save} disabled={!canSave || stage === 'saving'} accessibilityRole="button" style={{ backgroundColor: canSave ? t.brand : t.surface2, borderColor: canSave ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 }}>
                <Text style={{ color: canSave ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 15 }}>{stage === 'saving' ? 'Saving…' : 'Save new password'}</Text>
              </Pressable>
            </>
          ) : null}

          {stage === 'done' ? (
            <>
              <Text style={{ color: t.ink3, fontSize: 14, marginBottom: 22, lineHeight: 20 }}>
                You're signed in with your new password. Pick a portal to continue.
              </Text>
              <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Continue</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
