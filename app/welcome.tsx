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
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme, PasswordField, PasswordRules } from '../src/ui/components';
import { passwordMeetsLocalRules, passwordErrorMessage, PASSWORD_MIN } from '../src/lib/passwordRules';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { openLegalDoc } from '../src/ui/legal';
import { USE_SUPABASE } from '../src/lib/config';
import { VARIANT } from '../src/lib/variant';
import { recordReferral, stashPendingReferral, flushPendingReferral, peekPendingReferral } from '../src/lib/referrals';
import { OtpCodeEntry } from '../src/ui/OtpCodeEntry';
import { isUnconfirmedEmailError, EMAIL_OTP_LENGTH, spellDigits } from '../src/ui/emailOtp';
import { Card, Cta, CtaBright, HeroCard, Segmented } from '../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, font } from '../src/theme/scale';
import { BrandMark, BrandWordmark, useMarkSignal } from '../src/ui/BrandMark';
import { BRAND_ID, DEFAULT_BRAND_ID } from '../src/lib/brands';


/** What this build signs you up as, said plainly, plus where to go if the
 *  reader has the wrong one of the three apps. */
const ROLE_NOTE: Record<typeof VARIANT, string> = {
  client: 'Signing up to track your own training. Coaching clients instead? Get Repple Coach.',
  trainer: 'Signing up as a coach. Your clients use the Repple app, and gym owners use Repple Studio.',
  owner: 'Signing up as a gym owner. Your coaches use Repple Coach and your members use Repple.',
};

export default function Welcome() {
  const t = useTheme();
  const markSignal = useMarkSignal();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();
  // The door, then the form. See the note above the door below.
  const [showForm, setShowForm] = useState(false);
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
  // A code a referral link left behind, put into the field rather than only
  // into storage.
  //
  // `app/join.tsx` stashes it so it survives an App Store install and a
  // confirm-by-email round trip, and `flushPendingReferral` spends it at the
  // first sign-in — but until now the form itself could not see it, so the box
  // sat empty and read as "no code" to somebody who had just tapped a friend's
  // invitation. Prefilling is also what makes the DIRECT signup path work: that
  // branch calls `recordReferral(refCode)` with whatever is in this field and
  // never flushes the stash.
  //
  // Only ever fills an EMPTY field. Somebody who has started typing their own
  // code has answered this question, and overwriting it a tick later would
  // replace their answer with ours.
  useEffect(() => {
    let cancelled = false;
    peekPendingReferral().then((c) => {
      if (!cancelled && c) setRefCode((cur) => (cur.trim() ? cur : c));
    }).catch(() => { /* the field simply stays empty; the stash still flushes */ });
    return () => { cancelled = true; };
  }, []);
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
  // One field style, shared with <PasswordField> (which lifts the marginBottom
  // onto its wrapper so the eye toggle stays centred on the input itself).
  // The approved look's field: a 52pt pill of `surface2` on the card, at the
  // card's own corner, so a thumb finds it and the label above it stays quiet.
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, minHeight: 52, paddingVertical: sp.md, marginBottom: sp.md } as const;
  const lab = { ...ty.caption, ...font('600'), color: t.ink2, marginBottom: 6 } as const;

  /* ── the door ───────────────────────────────────────────────────────────
     The approved board opens every app on a product door — the mark, the
     app's name, its strapline, and two buttons — not on a registration form.
     The door lives in this component so every authentication branch below
     is untouched: it only decides which mode the form opens in. The client
     app leads with Get Started (most people arriving at it are new); the
     coach and studio apps lead with Sign In (most people arriving at them
     were invited and already have an account).

     NIGHT, full screen, in light mode and dark alike: the approved look opens
     every app on the same near-black the hero cards are cut from, and a door
     that was white by day was a different product from the screens behind it.
     Still the theme's own tokens and never a fixed hex — `t.night` is derived
     per palette, and `brandBright` is the accent only where the accent clears
     3:1 on it and white where it does not — so a white-label brand's palette
     holds here exactly as it holds on a hero. The wordmark is drawn in
     `nightInk` with its three bars in `brandBright`.

     Composed to board page 1: nothing above the lockup, the mark over the
     wordmark over the one word that tells Coach and Studio apart, the
     strapline under that, and the two buttons stacked at the foot. The
     small tile-and-name row that used to sit top-left is gone from the
     door — it named the app twice on a screen whose whole content is the
     app's name — and the form below still opens with it. */
  if (!showForm) {
    const clientBuild = VARIANT === 'client';
    const primaryMode: 'in' | 'up' = clientBuild ? 'up' : 'in';
    const secondaryMode: 'in' | 'up' = clientBuild ? 'in' : 'up';
    const primaryLabel = clientBuild ? 'Get Started' : 'Sign In';
    const secondaryLabel = clientBuild ? 'Sign In' : 'Create Account';
    const strap = VARIANT === 'client'
      ? 'A healthier, happier, stronger you.'
      : VARIANT === 'trainer'
        ? 'Empower people. Change lives.'
        : 'Run your gym from one connected system.';
    const openForm = (nextMode: 'in' | 'up') => {
      setMode(nextMode);
      setNotice(null);
      setShowForm(true);
    };
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.night }}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* The clock and the battery, in white while this screen is up: the
            ground is night whatever the phone's own appearance is. */}
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, paddingHorizontal: layout.gutter, paddingVertical: sp.xl, justifyContent: 'space-between' }}>
          {/* Nothing above the lockup but ground, as the board leaves it. */}
          <View />

          {/* The lockup, centred. The variant word is upper-cased and tracked
              the same way the wordmark is — it is part of the lockup, not a
              label — and set in the bright accent as the board sets it. */}
          <View style={{ alignItems: 'center', paddingHorizontal: sp.md }}>
            {/* The house brand's door carries the board's wordmark — the word
                IS the logo, so it is drawn rather than typeset: white letters,
                bright bars. A white-label tenant has no such drawing: its door
                says its own name in Sora, the display face, under the mark
                in its own accent as it is drawn on night. */}
            {BRAND_ID === DEFAULT_BRAND_ID ? (
              <View accessible accessibilityRole="header" accessibilityLabel={appName}>
                <BrandWordmark width={236} ink={t.nightInk} signal={markSignal} />
              </View>
            ) : (
              /* The hero step's -1.5 tracking is an optical correction for a
                 44pt NUMBER and would close a word's letters into each other,
                 so it is opened up here. Wraps rather than shrinks: a gym's
                 name is the one thing on this screen that must be legible. */
              <>
                <BrandMark size={84} ink={t.nightInk} signal={markSignal} />
                <Text accessibilityRole="header" style={{ ...ty.hero, color: t.nightInk, letterSpacing: 0, textAlign: 'center', marginTop: sp.lg }}>{appName}</Text>
              </>
            )}
            {VARIANT !== 'client' ? (
              <Text style={{ ...ty.eyebrow, color: t.brandBright, letterSpacing: 5, marginTop: sp.md }}>{(VARIANT === 'trainer' ? 'Coach' : 'Studio').toUpperCase()}</Text>
            ) : null}
            <Text style={{ ...ty.title, color: t.nightInk, textAlign: 'center', maxWidth: 300, marginTop: sp.xxl }}>{strap}</Text>
          </View>

          <View style={{ gap: sp.sm }}>
            <CtaBright label={primaryLabel} onPress={() => openForm(primaryMode)} />
            {/* The quiet one: words on the night, no fill, still a 48pt
                target. The kit's `Ghost` is a `surface2` pill and would be a
                grey slab on this ground. */}
            <Pressable onPress={() => openForm(secondaryMode)} accessibilityRole="button" accessibilityLabel={secondaryLabel}
              style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ ...ty.button, color: t.nightInk2 }}>{secondaryLabel}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.huge, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

          {/* ── the night head ──────────────────────────────────────────
              The door's ground carried onto the form as a hero card: whose app
              this is, what this step is in Sora, and the one line that says
              what happens next. It replaced a tile-and-name row whose tile was
              two hardcoded hexes. */}
          <HeroCard eyebrow={appName.toUpperCase()}
            title={pendingEmail ? 'One Step Left' : mode === 'up' ? 'Create Your Account' : 'Welcome Back'}
            meta={pendingEmail ? `The ${spellDigits(EMAIL_OTP_LENGTH)} digits we just emailed you.`
              : mode === 'up' ? 'A minute, and you are in.' : 'Sign in to continue.'} />

          {/* The form — or the code boxes — on a surface card over the ground. */}
          {pendingEmail ? (
            /* The confirmation code, in the same boxes the phone door uses —
               though NOT necessarily the same number of them: the email length
               is a project setting and the phone length is a different one, so
               each side reads its own constant. Assuming they matched is what
               drew six boxes for an eight-digit code and made signing in by
               email impossible.

               A code and not a link on purpose: a link in a confirmation email
               is fetched, and spent, by the recipient's own mail scanner before
               they ever see the message — the failure that had email
               confirmation switched off in the first place. Digits give a
               scanner nothing to press. See src/ui/emailOtp.ts. */
            <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, padding: sp.lg, marginTop: sp.lg, ...elevation.card }}>
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
              note="No link to click, so nothing can use it before you do. If it has not arrived, check your junk folder. If you already have an account at this address, go back and sign in instead."
              changeLabel="Wrong Address? Go Back"
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
            </View>
          ) : (
          <>
          <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, padding: sp.lg, marginTop: sp.lg, ...elevation.card }}>
          {/* Sign in / Sign up — the kit's Segmented, so the selected state,
              the tab roles and what the bar does at large text are its. The
              handler is the one the hand-built toggle had: switch, and clear
              whatever the last attempt said. */}
          <Segmented style={{ marginBottom: sp.xl }} value={mode}
            onChange={(m) => { setMode(m); setNotice(null); }}
            options={[{ key: 'up', label: 'Create Account' }, { key: 'in', label: 'Sign In' }] as const} />

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
            accessibilityLabel="Continue with Your Phone Number"
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
              backgroundColor: t.surface2, borderRadius: radius.md, minHeight: 52, paddingVertical: sp.md,
              marginBottom: sp.lg,
            }}>
            <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>Continue with Your Phone Number</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
            <Text style={{ ...ty.caption, color: t.ink3 }}>or</Text>
            <View style={{ flex: 1, height: hairline, backgroundColor: t.ring }} />
          </View>
          <Text style={lab}>Full Name</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={t.ink3} autoCapitalize="words" style={inp} accessibilityLabel="Full Name" />
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
              <Text style={lab}>Referral Code (Optional)</Text>
              <TextInput value={refCode} onChangeText={setRefCode} placeholder="Referral code (optional)" placeholderTextColor={t.ink3} autoCapitalize="characters" autoCorrect={false} style={inp} accessibilityLabel="Referral Code (Optional)" />
            </>
          ) : null}
          {mode === 'in' ? (
            <Pressable onPress={() => router.push('/forgot-password')} accessibilityRole="button" accessibilityLabel="Forgot Password" hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: sp.sm }}>
              <Text style={{ ...ty.label, ...font('600'), color: t.brandText }}>Forgot Password?</Text>
            </Pressable>
          ) : null}

          <View style={{ marginTop: sp.sm }}>
            <Cta wide disabled={!canGo || busy} onPress={go}
              label={busy ? 'Please Wait…' : mode === 'up' ? 'Create Account' : 'Sign In'} />
          </View>
          </View>

          {/* There is no "Continue with Apple" or "Continue with Google" here,
              and their absence is the fix rather than an oversight.

              Both buttons shipped on this screen — the FIRST screen of all
              three apps — wired to auth.signInWithProvider, which is one line:
              `throw new Error('Social sign-in is not set up yet…')`. So the two
              most prominent controls under the sign-in button were guaranteed
              to fail, on every install, for everybody, including the App Store
              and Play reviewers who tap exactly these first. Apple rejects
              builds whose sign-in options do not work, and a person who tries
              Apple, then Google, then gives up has not reached the email form
              that would have worked.

              They are gone rather than disabled or relabelled "coming soon",
              because a greyed-out button is the same dead end with a nicer
              face: it still advertises a way in that does not exist, and it
              still costs the reader the seconds they spend deciding whether it
              is their phone that is broken. Email above and the phone code
              above that are the two doors, both of them real.

              What it would take to actually offer these is written out in full
              at signInWithProvider in src/ui/auth.tsx, next to the throw. It is
              not one afternoon: none of the per-brand OAuth client ids exist
              yet, and Sign in with Apple needs a native dependency that is not
              in package.json, which means a new binary and not an
              over-the-air update. Put the buttons back in the same commit that
              finishes that, and not before. */}

          {/* ── the two documents this sentence asserts agreement to ───────
              This read "By continuing you agree to the Terms & Privacy Policy"
              and there was no route to either — not from here, and not from
              anywhere else in the app. Consent to a document nobody can open is
              not consent. Both now open in a sheet over this screen, so a
              half-filled sign-up form is still here afterwards. The URLs are the
              BRAND's; see src/lib/brands.ts. */}
          {USE_SUPABASE ? (
            <View style={{ marginTop: sp.xl }}>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>
                Your account is securely stored. By continuing you agree to the{' '}
                <Text accessibilityRole="link" style={{ color: t.brandText, textDecorationLine: 'underline' }}
                  onPress={() => { void openLegalDoc('terms'); }}>Terms of Service</Text>
                {' '}and the{' '}
                <Text accessibilityRole="link" style={{ color: t.brandText, textDecorationLine: 'underline' }}
                  onPress={() => { void openLegalDoc('privacy'); }}>Privacy Policy</Text>.
              </Text>
            </View>
          ) : (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl }}>Not connected to {appName}. Any email/password works and stays on this device. Real accounts activate when the backend is connected.</Text>
          )}
          </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
