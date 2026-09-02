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
import { BRAND } from '../../src/lib/brands';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { memberNoFrom, MEMBER_NO_CHANGED_NOTE } from '../../src/lib/membership';
import { code39Segments } from '../../src/lib/barcode';

export default function Access() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const memberNo = memberNoFrom(c.name, c.id, BRAND.label);
  const segs = useMemo(() => code39Segments(memberNo), [memberNo]);
  // The bar width used to be a pinned 2. The number is longer now — nine base-36
  // characters instead of four digits, because four digits was nine thousand
  // buckets and two members of one gym could share one — so a fixed unit runs
  // off the side of a phone and a laser reads half a barcode. It is computed
  // from the space the card actually has, capped at 2 so a short number on a
  // tablet does not become a wall.
  const { width: screenW } = useWindowDimensions();
  const available = Math.max(120, screenW - sp.xl * 4);
  const totalUnits = segs.reduce((n, sg) => n + sg.w, 0);
  const unit = Math.max(1, Math.min(2, available / Math.max(1, totalUnits)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ position: 'absolute', top: 10, left: 6, padding: 10 }}>
          <Icon name="back" size={20} color="#fff" />
        </Pressable>
        <Text style={{ ...ty.title, color: '#fff', marginBottom: 4 }}>{c.name || 'Member'}</Text>
        <Text style={{ ...ty.body, ...numeric, color: '#8a8a8a', marginBottom: sp.huge }}>{BRAND.label} ID {memberNo}</Text>

        <View style={{ backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: sp.xl, paddingHorizontal: sp.xl, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 130 }}>
            {segs.map((s, i) => (
              <View key={i} style={{ width: s.w * unit, backgroundColor: s.bar ? '#000' : '#fff' }} />
            ))}
          </View>
          <Text style={{ ...value(15), letterSpacing: 3, color: '#000', marginTop: sp.md }}>{memberNo}</Text>
        </View>

        <Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.xxl }}>This is your {BRAND.label} ID, not a membership number your gym issued.{'\n'}Give it to reception once and they can link it to your account — after that the entrance scanner will read it.{'\n'}Turn your screen brightness up for a clean read.</Text>
        {/* The number widened and therefore changed. This is the screen the
            instruction above is on, so it is the screen that owes somebody who
            followed that instruction an explanation. */}
        <Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>{MEMBER_NO_CHANGED_NOTE}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
