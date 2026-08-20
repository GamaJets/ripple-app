// Client · Weekly Check-in (Phase 7). Rate the week and log weight; it goes to
// your coach and updates your tracked weight. Reachable from the profile hub.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`).
//
// Honesty fixes:
//  · The four ratings arrived pre-selected at energy 4 / sleep 3 / mood 4 /
//    adherence 4. Tapping Send without touching them filed that invented week
//    under the client's name, and the coach — and the weekly report — read it
//    as their answer. They now start unset and Send asks for a score.
//  · The weight field was pre-filled from `cd.weightKg`, which for an account
//    with no scan and no logged weigh-in is the provider's 70 kg placeholder;
//    submitting wrote that 70 kg back as a real measurement. It now starts
//    blank unless there is a genuine weight on record.
//  · The 1–5 buttons rendered `SCALE`, an array of five empty strings — five
//    blank squares. They show the score they set.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useCheckIns } from '../../src/ui/checkins';

function Rating({ t, label, value: val, onChange }: { t: Theme; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ marginBottom: sp.lg }}>
      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, marginBottom: sp.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`${label}: ${n} of 5`} accessibilityState={{ selected: val === n }}
            style={{ flex: 1, aspectRatio: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: val === n ? t.brand : t.surface2 }}>
            <Text style={{ ...value(20), color: val === n ? t.brandInk : t.ink3 }}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function CheckIn() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const ci = useCheckIns();

  // Blank unless there is a weight actually on record for this client.
  const [weight, setWeight] = useState(cd.weightKg != null ? String(Math.round(cd.weightKg * 10) / 10) : '');
  const [energy, setEnergy] = useState(0);
  const [sleep, setSleep] = useState(0);
  const [mood, setMood] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [note, setNote] = useState('');

  const submit = () => {
    const w = parseFloat(weight);
    if (!(w > 20 && w < 400)) { Alert.alert('Add your weight', 'Enter this week\'s weight in kg so your coach sees the real number.'); return; }
    if (!energy || !sleep || !mood || !adherence) { Alert.alert('Rate your week', 'Tap a score for energy, sleep, mood and adherence — we won\'t guess them for you.'); return; }
    cd.setWeightKg(w);
    ci.addCheckIn({ weightKg: w, energy, sleep, mood, adherence, note: note.trim() });
    Alert.alert('Check-in sent', 'Your coach can see this week\'s check-in and your weight has been updated.', [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Daily</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Weekly Check-in</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>A quick pulse for your coach — takes 30 seconds.</Text>

        <Rule />

        <Section>
          <SectionHead title="Current weight" note="kg" />
          <TextInput value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} accessibilityLabel="Current weight in kilograms"
            style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="How the week went" note="1 – 5" />
          <Rating t={t} label="Energy this week" value={energy} onChange={setEnergy} />
          <Rating t={t} label="Sleep quality" value={sleep} onChange={setSleep} />
          <Rating t={t} label="Mood" value={mood} onChange={setMood} />
          <Rating t={t} label="Plan adherence" value={adherence} onChange={setAdherence} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Anything for your coach?" />
          <TextInput value={note} onChangeText={setNote} placeholder="Wins, struggles, questions…" placeholderTextColor={t.ink3} multiline accessibilityLabel="Note for your coach"
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 100, textAlignVertical: 'top' }} />
        </Section>

        <Cta label="Send Check-in" onPress={submit} wide />

        {ci.latest ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Last check-in" note={new Date(ci.latest.at).toLocaleDateString()} />
              <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{ci.latest.weightKg} kg · energy {ci.latest.energy}/5 · sleep {ci.latest.sleep}/5</Text>
              {ci.latest.note ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, fontStyle: 'italic' }}>“{ci.latest.note}”</Text> : null}
            </Section>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
