// Client · Challenges + leaderboards. Join a 30-day consistency, streak, or
// volume challenge; your live score (from your real workout log) is ranked
// against a cohort. Tap a challenge to see the full board. Reachable from the
// dashboard and Explore.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useChallenges, CHALLENGES, type Challenge } from '../../src/ui/challenges';
import { notifySuccess } from '../../src/ui/haptics';

export default function Challenges() {
  const t = useTheme();
  const router = useRouter();
  const ch = useChallenges();
  const [open, setOpen] = useState<Challenge | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Challenges</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Join a challenge and climb the leaderboard.</Text>

        {CHALLENGES.map((c) => {
          const joined = ch.isJoined(c.id);
          const my = ch.myScore(c.metric);
          const rank = ch.myRank(c);
          const total = c.field.length + 1;
          const pct = Math.max(0, Math.min(1, c.goal ? my / c.goal : 0));
          return (
            <View key={c.id} style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: joined ? t.brand : t.ring, padding: 16, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={c.icon as any} size={22} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{c.title}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.blurb}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: t.ink3, fontSize: 11 }}>Your score: <Text style={{ color: t.ink, fontWeight: '800' }}>{my} {c.unit}</Text></Text>
                    <Text style={{ color: t.ink3, fontSize: 11 }}>Goal {c.goal}</Text>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: t.surface3, overflow: 'hidden' }}>
                    <View style={{ height: 7, borderRadius: 4, backgroundColor: t.brand, width: `${(pct * 100)}%` }} />
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                <Pressable onPress={() => setOpen(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="trophy" size={14} color={t.ink3} />
                  <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{!joined ? 'View progress' : total > 1 ? `You're #${rank} of ${total}` : `${my} of ${c.goal} ${c.unit}`}</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ color: t.ink3, fontSize: 11 }}>{c.endsInDays}d left</Text>
                  <Pressable onPress={() => { ch.toggle(c.id); if (!joined) notifySuccess(); }} style={{ backgroundColor: joined ? t.surface2 : t.brand, borderColor: joined ? t.ring : t.brand, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <Text style={{ color: joined ? t.ink2 : t.brandInk, fontWeight: '800', fontSize: 13 }}>{joined ? 'Joined' : 'Join'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}

        <Text style={{ color: t.ink3, fontSize: 11, marginTop: 6, lineHeight: 16 }}>Your score is computed live from your logged workouts. Challenges are solo against the goal for now — competing against other athletes arrives with the group-coaching update.</Text>
      </ScrollView>

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '80%' }}>
          {open && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
              <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: 'Georgia', marginBottom: 2 }}>{open.title}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>{open.field.length > 0 ? 'Leaderboard' : 'Your progress'} · {open.endsInDays} days left</Text>
              {open.field.length === 0 ? (
                <Text style={{ color: t.ink3, fontSize: 12.5, lineHeight: 18, marginBottom: 14 }}>You're the only athlete on this board right now. Other athletes appear once group challenges are live — nothing here is simulated.</Text>
              ) : null}
              {ch.board(open).map((r, i) => (
                <View key={r.name + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.ring, backgroundColor: r.you ? 'rgba(45,212,191,0.08)' : 'transparent', borderRadius: r.you ? 10 : 0, paddingHorizontal: r.you ? 8 : 0 }}>
                  <Text style={{ color: i < 3 ? t.brand : t.ink3, fontWeight: '800', fontSize: 15, width: 26 }}>{i + 1}</Text>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: r.you ? t.brand : t.ink2, fontWeight: '800', fontSize: 13 }}>{r.name.split(' ').map((x) => x[0]).join('')}</Text>
                  </View>
                  <Text style={{ flex: 1, color: r.you ? t.ink : t.ink2, fontWeight: r.you ? '800' : '600', fontSize: 14 }}>{r.name}</Text>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>{r.score} <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>{open.unit}</Text></Text>
                </View>
              ))}
              <Pressable onPress={() => { const c = open; ch.toggle(c.id); }} style={{ backgroundColor: ch.isJoined(open.id) ? t.surface2 : t.brand, borderColor: ch.isJoined(open.id) ? t.ring : t.brand, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}>
                <Text style={{ color: ch.isJoined(open.id) ? t.ink2 : t.brandInk, fontWeight: '800' }}>{ch.isJoined(open.id) ? 'Leave challenge' : 'Join challenge'}</Text>
              </Pressable>
              <Pressable onPress={() => setOpen(null)} style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
