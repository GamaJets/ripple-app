// Post-sign-up onboarding. Owners name their gym here; trainers and clients are
// sent straight on. Reached via replace from the Welcome screen after creating
// an account.
//
// ── The client half of this screen is gone ─────────────────────────────────
//
// It asked photo, goal, diet, weight, height and coaching mode. Then the
// dashboard's "personalise" banner sent the same person to
// app/(client)/onboarding.tsx, which asked name, goal, weight, height, body
// fat, diet, allergens and injuries. Eight steps across two wizards, with goal,
// diet, weight and height each asked twice — and this one asked for weight in a
// box hard-labelled "kg" whatever unit the account reads in, so a member who
// thinks in pounds answered twice and got two different bodies out of it. The
// wrong one was written first.
//
// Reported as the app being too complicated to bother with, which it was. Only
// one of the two could survive and it is the other: it converts through
// src/lib/units.ts, it prefills from a scan the app already holds, it asks
// about injuries, and it drops a question the account can already answer. So a
// client is replaced straight into it and nothing is asked here.
//
// What is left is the owner's one question and two redirects, on the
// instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
import { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { Cta } from '../src/ui/kit';
import { sp, layout, radius, type as ty } from '../src/theme/scale';
import { VARIANT } from '../src/lib/variant';
import { useTenant } from '../src/ui/tenant';
import { readNumber } from '../src/lib/units';

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const { tenant, updateTenant } = useTenant();
  // Not a question any more: the app the user installed decides this, the same
  // way it does on the sign-up screen. Asking again could only contradict it.
  const role = VARIANT;
  // Owner setup. The provisioning trigger gives every new tenant a placeholder
  // name — "Tim's space" — which is nobody's gym.
  const [gymName, setGymName] = useState('');
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role === 'trainer') router.replace('/(trainer)/dashboard');
    // Setup lives at app/(client)/onboarding.tsx and is the whole of it. The
    // pending join code is not peeked at here any more either: that screen's
    // own finish() does it, because it is the screen that now knows whether the
    // member said they have a coach.
    if (role === 'client') router.replace('/(client)/onboarding');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // A tenant already exists (the trigger makes one); this names it. The
  // placeholder is offered as the field's placeholder, never as its value —
  // tapping through must not write "Tim's space" as though it were chosen.
  const saveGym = async () => {
    const name = gymName.trim();
    // `readNumber`, so a decimal comma is a decimal point — this box is a
    // decimal pad and a session fee of 62,50 must not be recorded as 62.
    const f = readNumber(fee) ?? NaN;
    const patch: { name?: string; sessionFee?: number } = {};
    if (name) patch.name = name;
    // Not `Math.round(f)`. `tenants.session_fee` is `numeric(8,2)`, so a gym
    // charging 62.50 a session can be recorded as one — and rounding it here
    // handed the owner back a fee fifty cents different from the one they had
    // just typed, on the screen where they type it for the first time.
    if (Number.isFinite(f) && f > 0) patch.sessionFee = Math.round(f * 100) / 100;
    if (!Object.keys(patch).length) { router.replace('/(owner)/dashboard'); return; }
    setSaving(true);
    const okWrite = await updateTenant(patch);
    setSaving(false);
    if (!okWrite) { Alert.alert('Could not save', 'Your gym details were not saved. The name and colour are under Brand; the session fee is under Ops.'); }
    router.replace('/(owner)/dashboard');
  };

  const next = () => {
    if (role === 'owner') { void saveGym(); return; }
    router.replace(role === 'client' ? '/(client)/onboarding' : '/(trainer)/dashboard');
  };

  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xxl, paddingBottom: sp.xxl, flexGrow: 1 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {role === 'owner' && (
          <View>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Step 1 of 1</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Name Your Gym</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>
              This is what your members and trainers will see. You can change it later under Brand.
            </Text>

            <Text style={lab}>Gym name</Text>
            <TextInput
              value={gymName}
              onChangeText={setGymName}
              placeholder={tenant?.name || 'e.g. Ironline Fitness'}
              placeholderTextColor={t.ink3}
              autoCapitalize="words"
              returnKeyType="next"
              style={inp}
              accessibilityLabel="Gym name"
            />

            {/* The very first money question the product asks an owner, and it
                named a currency for them. `tenants.currency` exists; a gym
                being set up has not chosen one yet, so the honest thing is to
                ask for the number and not to put a currency on it. */}
            <Text style={{ ...lab, marginTop: sp.lg }}>What one delivered session pays</Text>
            <TextInput
              value={fee}
              onChangeText={setFee}
              placeholder="Optional — leave blank if it varies"
              placeholderTextColor={t.ink3}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => { void saveGym(); }}
              style={inp}
              accessibilityLabel="What one delivered session pays"
            />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Payroll is counted against this. Left blank, the app shows a dash rather than
              guessing at what you owe.
            </Text>
          </View>
        )}

        <View style={{ flex: 1 }} />
        <Cta wide onPress={next} label={role === 'owner' ? (saving ? 'Saving…' : 'Open Studio') : 'Enter Portal'} />
      </ScrollView>
    </SafeAreaView>
  );
}
