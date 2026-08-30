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
//  · TF-37, and the worst of the lot: this field was labelled "kg", validated
//    20–400, and whatever was typed went into `weightKg` unconverted. A client
//    who reads in pounds typed 180 and their record gained 180 kg — a 99 kg
//    error, inside the accepted range, written to the weight their macros,
//    their goal progress and their coach's view are all computed from. The
//    field now says which unit it wants, the bound is expressed in that unit,
//    and the number is converted on the way to storage.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, kgToLb, plain, convertedNote } from '../../src/lib/units';
import { useCheckIns } from '../../src/ui/checkins';

// The range a human weighs, in the kilograms this app stores. Kept in metric
// because the record is metric; the two bounds are converted for whichever unit
// the client is typing in, so the message they read quotes numbers on the same
// scale as the number in the box rather than a metric range they never see.
const MIN_KG = 20;
const MAX_KG = 400;

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

  const wu = useSettings().weightUnit;

  // Blank unless there is a weight actually on record for this client, and in
  // the unit that client reads in.
  //
  // `typed` is null until the client touches the field, and while it is null
  // the box shows the record converted afresh on every render. That indirection
  // is not decoration: the account's unit preference arrives from the server a
  // moment after this screen mounts, so a field seeded once at mount would sit
  // there holding kilograms under a "lb" label for exactly the client this
  // ticket is about. Once they have typed, what they typed is what stands.
  const [typed, setTyped] = useState<string | null>(null);
  const shownWeight = weightIn(cd.weightKg, wu);
  const weight = typed ?? (shownWeight == null ? '' : plain(shownWeight));

  // The bound the client is actually held to, said in the unit they are typing.
  // 20–400 kg is 44–882 lb, and telling somebody who typed 180 that the range
  // is "20 to 400" would read as a rejection of a perfectly ordinary weight.
  const minShown = wu === 'lb' ? Math.round(kgToLb(MIN_KG)) : MIN_KG;
  const maxShown = wu === 'lb' ? Math.round(kgToLb(MAX_KG)) : MAX_KG;

  // Said under the field when, and only when, the figure in it came out of the
  // metric record — `convertedNote` returns null in kilograms, so a metric
  // client is not lectured about a conversion that is not happening.
  const weightNote = convertedNote(wu);

  const [energy, setEnergy] = useState(0);
  const [sleep, setSleep] = useState(0);
  const [mood, setMood] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [note, setNote] = useState('');

  const submit = () => {
    // The range is checked against the number as typed, before any conversion,
    // so that the figure being judged is the figure on screen. Checking a
    // converted number against a metric range would reject 900 lb by quoting
    // kilograms, and — far worse in the other direction — used to accept 180 lb
    // as 180 kg without either number ever leaving the range.
    const w = parseFloat(weight);
    if (!(w > minShown && w < maxShown)) { Alert.alert('Add your weight', `Enter this week's weight in ${wu} so your coach sees the real number.`); return; }
    if (!energy || !sleep || !mood || !adherence) { Alert.alert('Rate your week', 'Tap a score for energy, sleep, mood and adherence — we won\'t guess them for you.'); return; }
    // Storage is metric everywhere, so the pounds a client typed become the
    // kilograms the coach's console, the macro calculator and the goal tracker
    // all read. `weightToKg` returns null for an unreadable field, but the
    // range check above has already established there is a number here.
    const kg = weightToKg(weight, wu);
    if (kg == null) return;
    cd.setWeightKg(kg);
    ci.addCheckIn({ weightKg: kg, energy, sleep, mood, adherence, note: note.trim() });
    Alert.alert('Check-in sent', 'Your coach can see this week\'s check-in and your weight has been updated.', [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
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
          <SectionHead title="Current Weight" note={wu} />
          <TextInput value={weight} onChangeText={setTyped} keyboardType="numeric" placeholder={wu} placeholderTextColor={t.ink3}
            accessibilityLabel={wu === 'kg' ? 'Current weight in kilograms' : 'Current weight in pounds'}
            style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{weightNote}</Text> : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="How the Week Went" note="1 – 5" />
          <Rating t={t} label="Energy This Week" value={energy} onChange={setEnergy} />
          <Rating t={t} label="Sleep Quality" value={sleep} onChange={setSleep} />
          <Rating t={t} label="Mood" value={mood} onChange={setMood} />
          <Rating t={t} label="Plan Adherence" value={adherence} onChange={setAdherence} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Anything for Your Coach?" />
          <TextInput value={note} onChangeText={setNote} placeholder="Wins, struggles, questions…" placeholderTextColor={t.ink3} multiline accessibilityLabel="Note for your coach"
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 100, textAlignVertical: 'top' }} />
        </Section>

        <Cta label="Send Check-in" onPress={submit} wide />

        {ci.latest ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Last Check-in" note={new Date(ci.latest.at).toLocaleDateString()} />
              {/* The stored kilograms read back in the client's unit. The two
                  ratings beside it are scores out of five and are not a
                  measurement of anything physical, so they are printed as they
                  are recorded. */}
              <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{fig(weightLabel(ci.latest.weightKg, wu))} · energy {ci.latest.energy}/5 · sleep {ci.latest.sleep}/5</Text>
              {ci.latest.note ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, fontStyle: 'italic' }}>“{ci.latest.note}”</Text> : null}
            </Section>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
