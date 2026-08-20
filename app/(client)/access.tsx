// Client · Access. Full-screen member barcode for gym entry — scan at the turnstile.
//
// Deliberately off-theme: the card is real black-on-white because that is what a
// laser scanner can read, and the surround stays black so the screen is as bright
// as possible. Type comes from the scale; the colours here are a hardware
// requirement, not a palette choice.
//
// The encoded number is `memberNoFrom(...)` — derived from the signed-in user and
// stable for them. No gym billing system issues it, so a turnstile will NOT open
// on it unless the gym has been given this exact number and loaded it against the
// member. The screen used to read "Hold this to the scanner at the gym entrance",
// which promised a door that opens; it now says what the number is and what has
// to happen before it works.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { memberNoFrom } from '../../src/lib/membership';
import { code39Segments } from '../../src/lib/barcode';

export default function Access() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const memberNo = memberNoFrom(c.name, c.id);
  const segs = useMemo(() => code39Segments(memberNo), [memberNo]);
  const unit = 2; // px per narrow unit

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ position: 'absolute', top: 10, left: 6, padding: 10 }}>
          <Icon name="back" size={20} color="#fff" />
        </Pressable>
        <Text style={{ ...ty.title, color: '#fff', marginBottom: 4 }}>{c.name || 'Member'}</Text>
        <Text style={{ ...ty.body, ...numeric, color: '#8a8a8a', marginBottom: sp.huge }}>Repple ID {memberNo}</Text>

        <View style={{ backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: sp.xl, paddingHorizontal: sp.xl, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 130 }}>
            {segs.map((s, i) => (
              <View key={i} style={{ width: s.w * unit, backgroundColor: s.bar ? '#000' : '#fff' }} />
            ))}
          </View>
          <Text style={{ ...value(15), letterSpacing: 3, color: '#000', marginTop: sp.md }}>{memberNo}</Text>
        </View>

        <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.xxl }}>This is your Repple ID, not a membership number your gym issued.{'\n'}Give it to reception once and they can link it to your account — after that the entrance scanner will read it.{'\n'}Turn your screen brightness up for a clean read.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
