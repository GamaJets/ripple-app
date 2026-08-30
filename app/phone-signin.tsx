// Sign in with a phone number and a texted code.
//
// The shape is the one in the David Lloyd flow: a number, then six boxes, then
// you are in. No password anywhere, because the password is what has been
// failing — a policy mismatch, a breach check, three reset screens, and three
// testers stuck on links that expire or arrive at the wrong address.
//
// Email and password still work and are still on the welcome screen. This is an
// additional door, not a replacement: an existing member has an email account
// and no phone on it yet, and somebody abroad without their SIM needs a way in
// that does not depend on a text arriving.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { Cta, Ghost, Card } from '../src/ui/kit';
import { Icon } from '../src/ui/Icon';
import { sp, layout, radius, hairline, type as ty, value } from '../src/theme/scale';
import {
  COUNTRIES, DEFAULT_COUNTRY, countryFor, flagFor,
  toE164, isPlausiblePhone, maskedForDisplay, digitsOnly,
  OTP_LENGTH, isCompleteOtp,
} from '../src/lib/phone';

/** Seconds before a new code may be requested. Matches Supabase's own default. */
const RESEND_AFTER = 60;

export default function PhoneSignIn() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { appName } = useBrand();

  const [iso, setIso] = useState(DEFAULT_COUNTRY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [national, setNational] = useState('');
  const [name, setName] = useState('');

  const [stage, setStage] = useState<'number' | 'code'>('number');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const codeRef = useRef<TextInput>(null);

  // The resend countdown. A dead "Resend" that silently does nothing until the
  // server's own window passes teaches people to tap it repeatedly and then
  // hit the rate limit, which is a worse failure than waiting.
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [left]);

  const e164 = toE164(national, iso);
  const canSend = !busy && isPlausiblePhone(national, iso);

  const send = async () => {
    if (!canSend || !e164) return;
    setBusy(true); setError(null);
    const r = await auth.sendPhoneCode(e164);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setSentTo(e164);
    setStage('code');
    setCode('');
    setLeft(RESEND_AFTER);
    setTimeout(() => codeRef.current?.focus(), 250);
  };

  const verify = async (submitted: string) => {
    if (!sentTo || busy) return;
    setBusy(true); setError(null);
    const r = await auth.verifyPhoneCode(sentTo, digitsOnly(submitted), name);
    setBusy(false);
    if (!r.ok) { setError(r.reason); setCode(''); return; }
    // The root layout routes on `authed`; replacing avoids leaving a signed-in
    // person able to swipe back to a sign-in screen.
    router.replace('/');
  };

  const list = COUNTRIES.filter((c) => {
    const q = search.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.iso.toLowerCase() === q;
  });

  const field = {
    backgroundColor: t.surface2, borderRadius: radius.sm,
    paddingHorizontal: sp.lg, paddingVertical: 14,
    ...ty.body, color: t.ink,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled">

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.xxl }}>
            <Ghost icon="back" onPress={() => (stage === 'code' ? setStage('number') : router.back())} />
            <Text style={{ ...ty.micro, color: t.ink3 }}>{appName}</Text>
          </View>

          {stage === 'number' ? (
            <>
              <Text style={{ ...ty.title, color: t.ink }}>What’s Your Number?</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, marginBottom: sp.xl }}>
                We’ll text you a six-digit code. No password to remember, and nothing to reset.
              </Text>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>MOBILE NUMBER</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <Pressable onPress={() => { setSearch(''); setPickerOpen(true); }}
                  accessibilityRole="button" accessibilityLabel={`Country: ${countryFor(iso).name}, +${countryFor(iso).dial}`}
                  style={{ ...field, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: sp.md }}>
                  <Text style={{ fontSize: 19 }}>{flagFor(iso)}</Text>
                  <Text style={{ ...ty.body, color: t.ink }}>+{countryFor(iso).dial}</Text>
                </Pressable>
                <TextInput
                  value={national}
                  onChangeText={(v) => { setNational(v); setError(null); }}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  placeholder="50 767 1842"
                  placeholderTextColor={t.ink3}
                  accessibilityLabel="Your mobile number"
                  returnKeyType="go"
                  onSubmitEditing={send}
                  style={{ ...field, flex: 1 }}
                />
              </View>
              {/* Shown so somebody can check the number we will actually text,
                  which is not always the one they typed — a leading zero is a
                  domestic dialling prefix and comes off. */}
              {e164 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 7 }}>We’ll text {e164}</Text>
              ) : null}

              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: 6 }}>YOUR NAME</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Only needed the first time"
                placeholderTextColor={t.ink3} autoCapitalize="words" autoComplete="name"
                accessibilityLabel="Your name" style={field} />

              {error ? (
                <Card tone={t.warn} style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{error}</Text>
                </Card>
              ) : null}

              <View style={{ marginTop: sp.xl }}>
                <Cta label={busy ? 'Sending…' : 'Send me a code'} wide disabled={!canSend} onPress={send} />
              </View>

              <Pressable onPress={() => router.replace('/welcome')} hitSlop={8}
                style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Use email and password instead</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ ...ty.title, color: t.ink }}>Enter Your Code</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, marginBottom: sp.xxl }}>
                Sent to {sentTo ? maskedForDisplay(sentTo) : 'your phone'}.
              </Text>

              {/* One real input behind six painted boxes: iOS fills a texted
                  code into a single field via autoComplete, and six separate
                  inputs break that — the thing that makes this flow quick. */}
              <Pressable onPress={() => codeRef.current?.focus()} accessibilityRole="button"
                accessibilityLabel="Enter the six-digit code">
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {Array.from({ length: OTP_LENGTH }).map((_, i) => {
                    const ch = digitsOnly(code)[i];
                    const active = digitsOnly(code).length === i;
                    return (
                      <View key={i} style={{
                        flex: 1, aspectRatio: 0.82, borderRadius: radius.sm,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: t.surface2,
                        borderWidth: active ? 2 : hairline,
                        borderColor: active ? t.brand : t.ring,
                      }}>
                        <Text style={{ ...value(26), color: t.ink }}>{ch ?? ''}</Text>
                      </View>
                    );
                  })}
                </View>
              </Pressable>
              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={(v) => {
                  const d = digitsOnly(v).slice(0, OTP_LENGTH);
                  setCode(d); setError(null);
                  // Submit as soon as it is complete. Making somebody tap a
                  // button after typing the last digit is a step with no
                  // decision in it.
                  if (isCompleteOtp(d)) void verify(d);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={OTP_LENGTH}
                autoFocus
                style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
              />

              {error ? (
                <Card tone={t.warn} style={{ marginTop: sp.xl }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{error}</Text>
                </Card>
              ) : null}

              <View style={{ alignItems: 'center', marginTop: sp.xxl }}>
                {left > 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Resend a new code in {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
                  </Text>
                ) : (
                  <Ghost label={busy ? 'Sending…' : 'Send a new code'} onPress={send} />
                )}
              </View>

              <Pressable onPress={() => { setStage('number'); setCode(''); setError(null); }} hitSlop={8}
                style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Wrong number? Change it</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── country picker ─────────────────────────────────────────────── */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerOpen(false)} accessibilityLabel="Close" />
          <View style={{
            backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
            paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xxl, maxHeight: '76%',
          }}>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.md }}>Country</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search"
              placeholderTextColor={t.ink3} autoCorrect={false}
              accessibilityLabel="Search countries" style={{ ...field, marginBottom: sp.md }} />
            <ScrollView keyboardShouldPersistTaps="handled">
              {list.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.xl }}>
                  No country matches that. You can type the full number with a + instead.
                </Text>
              ) : list.map((c, i) => (
                <Pressable key={c.iso} onPress={() => { setIso(c.iso); setPickerOpen(false); }}
                  accessibilityRole="button" accessibilityLabel={`${c.name}, plus ${c.dial}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 13,
                    borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}>
                  <Text style={{ fontSize: 21 }}>{flagFor(c.iso)}</Text>
                  <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{c.name}</Text>
                  <Text style={{ ...ty.label, color: t.ink3 }}>+{c.dial}</Text>
                  {c.iso === iso ? <Icon name="check" size={16} color={t.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
