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
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { Cta, Ghost, Card } from '../src/ui/kit';
import { Icon } from '../src/ui/Icon';
// The code half of this screen now lives in src/ui/OtpCodeEntry — six boxes, a
// countdown and a resend that reports both outcomes — because email
// confirmation needs the identical gesture and two copies would drift.
import { OtpCodeEntry } from '../src/ui/OtpCodeEntry';
import { sp, layout, radius, hairline, type as ty } from '../src/theme/scale';
import {
  COUNTRIES, DEFAULT_COUNTRY, countryFor, flagFor,
  toE164, isPlausiblePhone, maskedForDisplay,
  OTP_LENGTH,
} from '../src/lib/phone';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                <Cta label={busy ? 'Sending…' : 'Send Me a Code'} wide disabled={!canSend} onPress={send} />
              </View>

              <Pressable onPress={() => router.replace('/welcome')} hitSlop={8}
                style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Use email and password instead</Text>
              </Pressable>
            </>
          ) : (
            <OtpCodeEntry
              title="Enter Your Code"
              sentTo={sentTo ? maskedForDisplay(sentTo) : 'your phone'}
              length={OTP_LENGTH}
              channel="sms"
              // `sentTo` and not `e164`: the number we actually texted, which is
              // not always the one still sitting in the field above.
              onVerify={(submitted) => (sentTo
                ? auth.verifyPhoneCode(sentTo, submitted, name)
                : Promise.resolve({ ok: false as const, reason: 'No number to check that code against. Enter your number again.' }))}
              // The root layout routes on `authed`; replacing avoids leaving a
              // signed-in person able to swipe back to a sign-in screen.
              onVerified={() => router.replace('/')}
              onResend={() => (sentTo
                ? auth.sendPhoneCode(sentTo)
                : Promise.resolve({ ok: false as const, reason: 'No number to send to. Enter your number again.' }))}
              changeLabel="Wrong number? Change it"
              onChange={() => { setStage('number'); setError(null); }}
            />
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
