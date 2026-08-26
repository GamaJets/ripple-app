// Client · Milestone Cards. Branded, screenshot-ready cards for streak, top PR,
// and weight change. Uses the tenant brand (colour + app name). Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation and route is preserved. One honesty fix: each card
// already computed an `available` flag and then ignored it, so the Progress card
// rendered "+0 kg · Since you started" — a fabricated zero — for a client with
// fewer than two weigh-ins, and offered to share it. Unavailable cards now show
// what to do to unlock them, and can't be shared.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Share, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, value } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useBrand } from '../../src/ui/brand';
import { currentStreak, longestStreak, personalRecords } from '../../src/lib/streaks';

function ShareCard({ t, appName, kicker, big, unit, sub }: { t: Theme; appName: string; kicker: string; big: string; unit: string; sub: string }) {
  return (
    <View style={{ backgroundColor: t.brand, borderRadius: radius.md, padding: sp.xl, minHeight: 200, justifyContent: 'space-between', ...elevation.e1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>{appName}</Text>
        <Text style={{ ...ty.micro, color: t.brandInk, opacity: 0.85 }}>{kicker}</Text>
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ ...value(56), color: t.brandInk }}>{big}</Text>
          {unit ? <Text style={{ ...ty.title, color: t.brandInk, marginLeft: 6, letterSpacing: 0 }}>{unit}</Text> : null}
        </View>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.brandInk, opacity: 0.9, marginTop: sp.xs }}>{sub}</Text>
      </View>
    </View>
  );
}

export default function Cards() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus } = useWorkoutLog();
  const { appName } = useBrand();
  const [idx, setIdx] = useState(0);

  const streak = currentStreak(log);
  const best = longestStreak(log);
  const prs = personalRecords(log).sort((a, b) => b.est1RM - a.est1RM);
  const topPr = prs[0];
  const w = c.weightSeries;
  const wDelta = w.length > 1 ? +(w[w.length - 1].v - w[0].v).toFixed(1) : 0;
  const hasProgress = w.length > 1;

  // Under 'error' the log is empty because it could not be read, not because
  // nothing was ever logged — so a streak of 0 and no PRs are unknowns here,
  // not zeroes, and a card is the last place to guess. These cards get posted.
  const logKnown = logStatus !== 'error';
  const hasStreak = logKnown && (streak > 0 || best > 0);
  const hasPr = logKnown && !!topPr;
  const UNREAD = 'We couldn’t read your training log';

  const cards = [
    // `available: true` was hardcoded on this one card while the other two
    // honoured the flag — so an unread log rendered "0 days · Best ever: 0 days"
    // as a milestone with Share still enabled, and a client on a live 40-day
    // streak was invited to publicly announce a streak of zero.
    { kicker: 'Streak', big: hasStreak ? String(streak) : '—', unit: hasStreak ? (streak === 1 ? 'day' : 'days') : '', sub: hasStreak ? `Best ever: ${best} days` : logKnown ? 'Log a workout to start a streak' : UNREAD, available: hasStreak },
    { kicker: 'Top Lift', big: hasPr ? String(topPr.est1RM) : '—', unit: hasPr ? 'kg' : '', sub: hasPr ? `${topPr.exercise} · est 1RM` : logKnown ? 'Log a lift to unlock' : UNREAD, available: hasPr },
    // No second weigh-in means no measured change — show the card locked rather
    // than a manufactured "+0 kg since you started".
    { kicker: 'Progress', big: hasProgress ? `${wDelta > 0 ? '+' : ''}${wDelta}` : '—', unit: hasProgress ? 'kg' : '', sub: hasProgress ? 'Since you started' : 'Weigh in twice to unlock', available: hasProgress },
  ];
  const card = cards[idx];
  const shareText = (i: number) => {
    if (i === 0) return `${streak}-day training streak on ${appName} (best: ${best}). Every rep ripples out.`;
    if (i === 1) return topPr ? `New milestone on ${appName}: ${topPr.exercise} — estimated 1RM ${topPr.est1RM}kg. The work is working.` : `Chasing my first PR on ${appName}.`;
    return `${wDelta > 0 ? '+' : ''}${wDelta}kg since I started with ${appName}. Progress you can measure.`;
  };
  const shareCard = async () => {
    try { await Share.share({ message: shareText(idx) }); } catch { Alert.alert('Could not open share', 'Try screenshotting the card instead.'); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Screenshot & share your wins</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Milestone cards</Text>
          </View>
        </View>

        <Section>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: layout.section }}>
            {cards.map((cd, i) => (
              <Pressable key={cd.kicker} onPress={() => setIdx(i)} accessibilityRole="button" accessibilityLabel={cd.kicker}
                style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: idx === i ? t.surface2 : 'transparent' }}>
                <Text style={{ ...ty.label, fontWeight: idx === i ? '500' : '400', color: idx === i ? t.ink : t.ink3 }}>{cd.kicker}</Text>
              </Pressable>
            ))}
          </View>

          <ShareCard t={t} appName={appName} kicker={card.kicker} big={card.big} unit={card.unit} sub={card.sub} />

          <View style={{ marginTop: layout.section }}>
            <Cta label="Share this card" wide disabled={!card.available} onPress={shareCard} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
            {card.available ? 'Tip: screenshot the card above to post the visual too.'
              : logKnown ? 'This card unlocks once there is something real to show.'
              : 'Cards stay locked until we can read your log — nothing has been lost.'}
          </Text>
        </Section>

        <Rule />

        <Section>
          <Pressable onPress={() => router.push('/(client)/social')} accessibilityRole="button" accessibilityLabel="Connect Instagram or TikTok"
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, alignSelf: 'center' }}>
            <Icon name="share" size={15} color={t.ink3} />
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Connect Instagram / TikTok ›</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
