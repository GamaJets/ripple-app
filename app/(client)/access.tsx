// Client · Access. Full-screen member barcode for gym entry — scan at the turnstile.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
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
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ position: 'absolute', top: 10, left: 6, padding: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 4 }}>{c.name || 'Member'}</Text>
        <Text style={{ color: '#8a8a8a', fontSize: 14, marginBottom: 40 }}>Membership {memberNo}</Text>

        <View style={{ backgroundColor: '#fff', borderRadius: 18, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 130 }}>
            {segs.map((s, i) => (
              <View key={i} style={{ width: s.w * unit, backgroundColor: s.bar ? '#000' : '#fff' }} />
            ))}
          </View>
          <Text style={{ color: '#000', fontSize: 15, fontWeight: '700', letterSpacing: 3, marginTop: 14 }}>{memberNo}</Text>
        </View>

        <Text style={{ color: '#8a8a8a', fontSize: 13, textAlign: 'center', marginTop: 34, lineHeight: 19 }}>Hold this to the scanner at the gym entrance.{'\n'}Turn your screen brightness up for a clean read.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
