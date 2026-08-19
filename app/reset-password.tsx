// Reset password (Phase 1) — lands here from the `repple://reset-password`
// deep link in the recovery email (see forgot-password.tsx).
//
// The link deep-links straight into the app carrying the recovery token as a
// query param (`?token_hash=...&type=recovery`, or `?error=...&error_description=...`
// if stale/used) — it does NOT route through Supabase's `/auth/v1/verify`
// endpoint first. That endpoint auto-redeems the one-time token on a bare GET,
// which meant an email security scanner prefetching the link (common with
// Gmail-hosted mail) could silently burn the token before the user ever
// tapped it — confirmed via Supabase Auth logs: the token was already dead
// ~5 minutes after being emailed, before the first real tap. A `repple://`
// URL can't be opened by an https-only bot, so routing the raw token straight
// into the app (redeemed here, client-side, only when a real device opens it)
// closes that hole. `code` (PKCE) and `access_token`/`refresh_token`
// (implicit) are kept as fallbacks for any link that still arrives in an
// older shape. We parse the URL by hand since the Supabase client runs with
// detectSessionInUrl:false (no browser URL to auto-read on native).
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). The link parsing, all four token shapes, the 2.5s
// give-up timer, every stage and every route are unchanged — only the
// presentation moved: no hero, the white-label app name is the kicker above a
// `ty.title`, fields lost their 1px borders for a `surface2` fill, and the
// "Passwords don't match" line is ink text beside a red dot instead of red
// text.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme, PasswordField } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { Card, Cta } from '../src/ui/kit';
import { sp, layout, radius, type as ty } from '../src/theme/scale';

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
    if (params.token_hash && params.email) {
      handled.current = true;
      try {
        await auth.beginPasswordRecoveryWithTokenHash(params.token_hash, params.email);
        setStage('ready');
      } catch {
        setStage('invalid');
      }
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

  // One field style, shared with <PasswordField> (which lifts the marginBottom
  // onto its wrapper so the eye toggle stays centred on the input itself).
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, marginBottom: sp.md } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.huge, paddingBottom: 40, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={{ ...ty.micro, color: t.ink3 }}>{appName}</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5, marginBottom: sp.md }}>
            {stage === 'done' ? 'Password updated' : 'Set a new password'}
          </Text>

          {stage === 'checking' ? (
            <Text style={{ ...ty.body, color: t.ink3 }}>Checking your reset link…</Text>
          ) : null}

          {stage === 'invalid' ? (
            <>
              <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.xl }}>
                This link is invalid or has expired. Request a new one and use it within an hour.
              </Text>
              <Cta wide label="Request a new link" onPress={() => router.replace('/forgot-password')} />
            </>
          ) : null}

          {stage === 'ready' || stage === 'saving' ? (
            <>
              <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.xl }}>
                Choose a new password for your {appName} account. It applies to Client, Trainer, and Owner access alike.
              </Text>
              {error ? (
                <Card tone={t.crit} style={{ marginBottom: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit, marginTop: 6 }} />
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{error}</Text>
                  </View>
                </Card>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>New password</Text>
              <PasswordField value={pw} onChangeText={setPw} placeholder="New password (min 6 characters)" style={inp} accessibilityLabel="New password" autoFocus />
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Confirm new password</Text>
              <PasswordField value={pw2} onChangeText={setPw2} placeholder="Confirm new password" style={inp} accessibilityLabel="Confirm new password" />
              {pw2.length > 0 && pw !== pw2 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -6, marginBottom: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>Passwords don't match.</Text>
                </View>
              ) : null}
              <View style={{ marginTop: sp.sm }}>
                <Cta wide disabled={!canSave} onPress={save} label={stage === 'saving' ? 'Saving…' : 'Save new password'} />
              </View>
            </>
          ) : null}

          {stage === 'done' ? (
            <>
              <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.xl }}>
                You're signed in with your new password. Pick a portal to continue.
              </Text>
              <Cta wide label="Continue" onPress={() => router.replace('/')} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
