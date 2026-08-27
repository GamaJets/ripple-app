// Trainer · Leaderboard. Ranks the roster by a composite of adherence + weight
// progress toward goal. A lightweight cohort view. Reached from Analytics.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). The scoring, the roster provider, the route behind each
// row and the empty state are unchanged — only the presentation: the bordered
// per-client cards became hairline-separated rows, the Georgia serif header is
// gone, and the `MEDALS` lookup (which held the strings '1','2','3' and was
// drawn on top of a zero-width, negatively-offset rank label) is now just the
// rank, rendered once.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';

export default function Leaderboard() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();

  // Composite: adherence (0-100) + progress bonus (fat-loss clients rewarded for
  // negative weightDelta; others for positive). Simple, transparent.
  const scored = roster.map((c) => {
    const goalDown = /fat|tone/i.test(c.goal);
    // A client with no scans has no progress to score. Null contributes
    // nothing rather than counting as "held their weight", which is what a 0
    // delta meant here — it let somebody who has never stepped on a scale
    // score the same as somebody measured to be flat.
    const prog = c.weightDelta == null ? null : (goalDown ? -c.weightDelta : c.weightDelta);
    // A client with no check-ins contributes 0 adherence, not a phantom 100 -
    // otherwise strangers outrank clients who are actually training.
    const score = Math.round((c.adherence ?? 0) + Math.max(0, prog ?? 0) * 4);
    return { c, score };
  }).sort((a, b) => b.score - a.score);

  const maxScore = Math.max(1, ...scored.map((s) => s.score));

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your roster</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Leaderboard</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Adherence + progress toward goal</Text>

        <Rule />

        <Section>
          <SectionHead title="Ranking" note={scored.length ? `${scored.length} client${scored.length === 1 ? '' : 's'}` : undefined} />

          {scored.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clients yet — your leaderboard fills in as clients join and log their workouts.
            </Text>
          ) : null}

          {scored.map(({ c, score }, i) => (
            <Pressable key={c.id} onPress={() => router.push('/(trainer)/analytics')}
              accessibilityRole="button" accessibilityLabel={`${c.name}, rank ${i + 1}, score ${score}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <Text style={{ ...value(15), color: i === 0 ? t.brand : t.ink3, width: 20, textAlign: 'center' }}>{i + 1}</Text>
              <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {c.adherence == null ? 'no check-ins' : `${c.adherence}% adherence`} · {c.weightDelta == null ? 'no scans yet' : `${c.weightDelta > 0 ? '+' : ''}${c.weightDelta} kg`}</Text>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden', marginTop: 7 }}>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: t.brand, width: `${Math.round((score / maxScore) * 100)}%` }} />
                </View>
              </View>
              <Text style={{ ...value(18), color: t.ink }}>{score}</Text>
            </Pressable>
          ))}
        </Section>

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Use the Broadcast button on Clients to celebrate the top of the board.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
