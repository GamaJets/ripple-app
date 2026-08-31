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
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme, PasswordField, PasswordRules } from '../src/ui/components';
import { passwordMeetsLocalRules, passwordErrorMessage, PASSWORD_MIN } from '../src/lib/passwordRules';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { USE_SUPABASE } from '../src/lib/config';
import { VARIANT, VARIANT_LABEL, VARIANT_TILE } from '../src/lib/variant';
import { recordReferral, stashPendingReferral, flushPendingReferral } from '../src/lib/referrals';
import { OtpCodeEntry } from '../src/ui/OtpCodeEntry';
import { isUnconfirmedEmailError, EMAIL_OTP_LENGTH } from '../src/ui/emailOtp';
import { Card, Cta } from '../src/ui/kit';
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

/** What this build signs you up as, said plainly, plus where to go if the
 *  reader has the wrong one of the three apps. */
const ROLE_NOTE: Record<typeof VARIANT, string> = {
  client: 'Signing up to track your own training. Coaching clients instead? Get Repple Coach.',
  trainer: 'Signing up as a coach — your clients use the Repple app, and gym owners use Repple Studio.',
  owner: 'Signing up as a gym owner. Your coaches use Repple Coach and your members use Repple.',
};

export default function Welcome() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [name, setName] = useState('');
  // Not state, and not a choice: the build decides. A trainer who signs up
  // inside Repple Coach and picks "A client" would land in an app with no
  // client routes at all.
  const role = VARIANT;
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [refCode, setRefCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The address a confirmation code has just been sent to, or null.
   *
   * Set ONLY when we know an email actually went out — signUp reporting
   * `needsConfirmation`, or a resend that came back ok. Never inferred: with
   * confirmation switched off (which is where the project is today, see
   * docs/LAUNCH-CHECKLIST.md item 1) signUp hands back a live session and
   * nothing is sent, so this stays null and the person goes straight in. A code
   * screen shown on a guess is a screen no email will ever satisfy.
   */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // A session refused at launch because it belongs to another brand has nobody
  // to tell: it is turned away before this screen mounts, and all the reader
  // sees is a sign-in screen where their account used to be. That is
  // indistinguishable from being logged out at random, and the first thing
  // anybody does about it is try their password again, then reset it. So the
  // guard's own sentence is picked up here and shown in the notice card the
  // screen already has. An interactive sign-in does not come through here —
  // signIn throws the same sentence and the catch below prints it.
  useEffect(() => { if (auth.brandNotice) setNotice(auth.brandNotice); }, [auth.brandNotice]);

  // Signing IN must not apply the new-password rules: an existing account may
  // hold a password created under the old, looser policy, and gating the button
  // on today's rules would lock them out of their own account with no way
  // forward. Only signing UP has to satisfy what the server will demand.
  const pwOkForSignUp = passwordMeetsLocalRules(pw);
  const canGo = email.trim().length > 3
    && (mode === 'in' ? pw.length > 0 : pwOkForSignUp)
    && (mode === 'in' || name.trim().length > 0);
  const go = async () => {
    if (!canGo || busy) return;
    setBusy(true); setNotice(null);
    try {
      if (mode === 'up') {
        const res = await auth.signUp(name, email.trim(), pw, role);
        if (res.needsConfirmation) {
          // Stashed rather than recorded, because there is no session yet to
          // attribute it to. Kept even though the code screen flushes it on
          // success: somebody who closes the app on the code screen and signs
          // in a day later must still be attributed to whoever referred them.
          await stashPendingReferral(refCode);
          setPendingEmail(email.trim());
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
      // An unconfirmed account is the one sign-in failure with a way forward
      // that is not "try the password again": it exists, the password was
      // right, and what is missing is a code we can send. Before this, the
      // person read "Email not confirmed" on a screen offering them nothing to
      // do about it — and the email they were being sent back to is the one
      // that a mail scanner had already spent.
      if (isUnconfirmedEmailError(e)) {
        const r = await auth.resendEmailCode(email.trim());
        // Only a send we watched succeed opens the code screen. A refused one
        // says so and leaves them here, where their password still is.
        if (r.ok) setPendingEmail(email.trim());
        else setNotice(`That address has not been confirmed yet. ${r.reason}`);
      } else {
        setNotice(e?.message || 'Something went wrong. Please try again.');
      }
    } finally { setBusy(false); }
  };

  /** Confirmed, signed in, and brand new — the same door signUp uses when
   *  confirmation is off. The referral stashed a moment ago is spent here. */
  const onConfirmed = async () => {
    await flushPendingReferral();
    router.replace('/onboarding');
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
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.huge, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

          {/* ── the brand mark ──────────────────────────────────────────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            {/* The tile the user just tapped on their home screen — teal for
                Repple, indigo for Coach, amber for Studio. */}
            <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: VARIANT_TILE[VARIANT], alignItems: 'center', justifyContent: 'center' }}>
              <Ripple size={28} color="#ffffff" />
            </View>
            <Text style={{ ...ty.title, color: t.ink }}>{appName}</Text>
          </View>
          <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>
            {pendingEmail ? 'One step left — the six digits we just emailed you.'
              : mode === 'up' ? 'Create your account to get started.' : 'Welcome back — sign in to continue.'}
          </Text>

          {pendingEmail ? (
            /* The confirmation code, in the same six boxes the phone door uses.
               A code and not a link on purpose: a link in a confirmation email
               is fetched, and spent, by the recipient's own mail scanner before
               they ever see the message — the failure that had email
               confirmation switched off in the first place. Six digits give a
               scanner nothing to press. See src/ui/emailOtp.ts. */
            <OtpCodeEntry
              title="Confirm Your Email"
              sentTo={pendingEmail}
              length={EMAIL_OTP_LENGTH}
              channel="email"
              onVerify={(submitted) => auth.confirmEmailCode(pendingEmail, submitted)}
              onVerified={onConfirmed}
              onResend={() => auth.resendEmailCode(pendingEmail)}
              // Says where to look, and names the one case where no code is
              // coming at all: an address that already has a confirmed account
              // gets nothing sent to it, and signUp cannot tell us that without
              // telling anybody who asks which addresses are registered.
              note="No link to click, so nothing can use it before you do. If it has not arrived, check your junk folder — and if you already have an account at this address, go back and sign in instead."
              changeLabel="Wrong address? Go back"
              onChange={() => {
                // Back to the form with the address still in the field. The
                // account that was just created keeps that address — it is not
                // being deleted here and saying otherwise would be a lie — so
                // the way out of a typo is to create the account again at the
                // right one, which is exactly what this returns them to.
                setPendingEmail(null);
                setNotice(`Nothing has been sent anywhere else. If ${pendingEmail} is wrong, correct it and create the account again.`);
              }}
            />
          ) : (
          <>
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
              {/* The phone door, offered first. Every tester who could not get in
              this week was stuck on a password or a link: a policy that said
              six characters and enforced eight, a reset token spent by a mail
              scanner, an invitation sent to a mistyped address. A texted code
              has none of those failure modes. Email and password stay below,
              because an existing member has no phone on their account yet. */}
          <Pressable onPress={() => router.push('/phone-signin')} accessibilityRole="button"
            accessibilityLabel="Continue with your phone number"
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
              backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 14,
              marginBottom: sp.lg,
            }}>
            <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>Continue with your phone number</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
            <Text style={{ ...ty.caption, color: t.ink3 }}>or</Text>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
          </View>
          <Text style={lab}>Full name</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={t.ink3} autoCapitalize="words" style={inp} accessibilityLabel="Full name" />
            </>
          ) : null}
          {mode === 'up' ? (
            <View style={{ marginBottom: sp.md, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: sp.sm }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 7 }} />
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                {ROLE_NOTE[VARIANT]}
              </Text>
            </View>
          ) : null}
          <Text style={lab}>Email</Text>
          {/* Editing either field clears the last failure. A sign-in error
              used to sit on this screen until the next submit, so somebody who
              changed their password in another tab — or simply mistyped once —
              was left looking at "Invalid login credentials" that had stopped
              being true. A stale error is indistinguishable from a live one,
              and this one names the reader's credentials as the problem. */}
          <TextInput value={email} onChangeText={(v) => { setEmail(v); if (notice) setNotice(null); }} placeholder="Email" placeholderTextColor={t.ink3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={inp} accessibilityLabel="Email" />
          <Text style={lab}>Password</Text>
          <PasswordField value={pw} onChangeText={(v) => { setPw(v); if (notice) setNotice(null); }} placeholder={mode === 'in' ? 'Password' : `Password (${PASSWORD_MIN}+ characters)`} style={inp} accessibilityLabel="Password" />
          {mode === 'up' ? <PasswordRules value={pw} /> : null}
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
              label={busy ? 'Please Wait…' : mode === 'up' ? 'Create Account' : 'Sign In'} />
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

          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl }}>{USE_SUPABASE ? 'Your account is securely stored. By continuing you agree to the Terms & Privacy Policy.' : 'Not connected to Repple — any email/password works and stays on this device. Real accounts activate when the backend is connected.'}</Text>
          </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
