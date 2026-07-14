// Trainer · Leaderboard. Ranks the roster by a composite of adherence + weight
// progress toward goal. A lightweight cohort view. Reached from Analytics.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useRoster } from '../../src/ui/roster';

const MEDALS = ['1', '2', '3'];

export default function Leaderboard() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();

  // Composite: adherence (0-100) + progress bonus (fat-loss clients rewarded for
  // negative weightDelta; others for positive). Simple, transparent.
  const scored = roster.map((c) => {
    const goalDown = /fat|tone/i.test(c.goal);
    const prog = goalDown ? -c.weightDelta : c.weightDelta;
    const score = Math.round(c.adherence + Math.max(0, prog) * 4);
    return { c, score };
  }).sort((a, b) => b.score - a.score);

  const maxScore = Math.max(1, ...scored.map((s) => s.score));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Leaderboard</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Adherence + progress toward goal</Text>

        {scored.map(({ c, score }, i) => (
          <Pressable key={c.id} onPress={() => router.push('/(trainer)/analytics')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: i === 0 ? t.brand : t.ring, padding: 15, marginBottom: 10 }}>
            <Text style={{ fontSize: 20, width: 30, textAlign: 'center' }}>{i < 3 ? MEDALS[i] : ''}</Text>
            {i >= 3 ? <Text style={{ color: t.ink3, fontWeight: '800', width: 0, marginLeft: -30, textAlign: 'center' }}>{i + 1}</Text> : null}
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.brand, fontWeight: '800', fontSize: 14 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{c.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.goal} · {c.adherence}% adherence · {c.weightDelta > 0 ? '+' : ''}{c.weightDelta} kg</Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden', marginTop: 6 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.brand, width: `${Math.round((score / maxScore) * 100)}%` }} />
              </View>
            </View>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{score}</Text>
          </Pressable>
        ))}
        <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 6 }}>Use the Broadcast button on Clients to celebrate the top of the board.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
