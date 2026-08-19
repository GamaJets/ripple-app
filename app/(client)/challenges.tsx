// Client · Challenges. Join a 30-day consistency, streak, or volume challenge;
// your live score is computed from your real workout log and measured against
// the goal. Tap a challenge to see the full board. Reachable from the dashboard
// and Explore.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, conditional branch and route from the previous version is
// preserved — only the presentation changed: hairline-separated rows and a 3px
// meter instead of three bordered cards with their own progress bars.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Meter, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { useChallenges, CHALLENGES, type Challenge } from '../../src/ui/challenges';
import { notifySuccess } from '../../src/ui/haptics';

export default function Challenges() {
  const t = useTheme();
  const router = useRouter();
  const ch = useChallenges();
  const [open, setOpen] = useState<Challenge | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>You against the goal</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Challenges</Text>
          </View>
        </View>

        <Section>
          <SectionHead title="Open challenges" />

          {CHALLENGES.map((c, ci) => {
            const joined = ch.isJoined(c.id);
            const my = ch.myScore(c.metric);
            const rank = ch.myRank(c);
            const total = c.field.length + 1;
            return (
              <View key={c.id}>
                {ci > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.lg }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={c.icon as any} size={17} color={joined ? t.brand : t.ink2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.blurb}</Text>
                    </View>
                  </View>

                  <Meter label="Your score" val={my} target={c.goal} unit={' ' + c.unit} dim={!joined} />

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sp.lg }}>
                    <Pressable onPress={() => setOpen(c)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <Icon name="trophy" size={14} color={t.ink3} />
                      <Text style={{ ...ty.label, color: t.ink2 }} numberOfLines={1}>{!joined ? 'View progress' : total > 1 ? `You're #${rank} of ${total}` : `${my} of ${c.goal} ${c.unit}`}</Text>
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{c.endsInDays}-day</Text>
                      {joined ? (
                        <Ghost label="Joined" onPress={() => { ch.toggle(c.id); if (!joined) notifySuccess(); }} />
                      ) : (
                        <Cta label="Join" onPress={() => { ch.toggle(c.id); if (!joined) notifySuccess(); }} />
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Your score is computed live from your logged workouts. Challenges are solo against the goal for now — competing against other athletes arrives with the group-coaching update.</Text>
        </Section>
      </ScrollView>

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '80%', ...elevation.e2 }}>
          {open && (
            <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{open.field.length > 0 ? 'Leaderboard' : 'Your progress'} · {open.endsInDays}-day challenge</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3, marginBottom: sp.lg }}>{open.title}</Text>
              {open.field.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>You're the only athlete on this board right now. Other athletes appear once group challenges are live — nothing here is simulated.</Text>
              ) : null}
              {ch.board(open).map((r, i) => (
                <View key={r.name + i}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...value(15), color: t.ink3, width: 22 }}>{i + 1}</Text>
                    <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...ty.caption, fontWeight: '500', color: r.you ? t.brand : t.ink2 }}>{r.name.split(' ').map((x) => x[0]).join('')}</Text>
                    </View>
                    <Text style={{ flex: 1, ...ty.body, fontWeight: r.you ? '500' : '400', color: r.you ? t.ink : t.ink2 }}>{r.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(15), color: t.ink }}>{r.score}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>{open.unit}</Text>
                    </View>
                  </View>
                </View>
              ))}
              <View style={{ marginTop: sp.xl }}>
                {ch.isJoined(open.id) ? (
                  <Ghost label="Leave challenge" onPress={() => { const c = open; ch.toggle(c.id); }} />
                ) : (
                  <Cta label="Join challenge" wide onPress={() => { const c = open; ch.toggle(c.id); }} />
                )}
              </View>
              <Pressable onPress={() => setOpen(null)} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
