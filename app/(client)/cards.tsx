// Client · Milestone Cards. Branded, screenshot-ready cards for streak, top PR,
// and weight change. Uses the tenant brand (colour + app name). Profile hub.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Share, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useBrand } from '../../src/ui/brand';
import { currentStreak, longestStreak, personalRecords } from '../../src/lib/streaks';

function Card({ t, appName, kicker, big, unit, sub }: { t: Theme; appName: string; kicker: string; big: string; unit: string; sub: string }) {
 return (
 <View style={{ backgroundColor: t.brand, borderRadius: 24, padding: 26, marginBottom: 16, minHeight: 200, justifyContent: 'space-between' }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15, opacity: 0.9 }}>{appName}</Text>
 <Text style={{ color: t.brandInk, fontSize: 13, opacity: 0.8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>{kicker}</Text>
 </View>
 <View>
 <Text style={{ color: t.brandInk, fontSize: 64, fontWeight: '900', letterSpacing: -2 }}>{big}<Text style={{ fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}> {unit}</Text></Text>
 <Text style={{ color: t.brandInk, fontSize: 16, fontWeight: '700', opacity: 0.9, marginTop: 4 }}>{sub}</Text>
 </View>
 </View>
 );
}

export default function Cards() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 const { log } = useWorkoutLog();
 const { appName } = useBrand();
 const [idx, setIdx] = useState(0);

 const streak = currentStreak(log);
 const best = longestStreak(log);
 const prs = personalRecords(log).sort((a, b) => b.est1RM - a.est1RM);
 const topPr = prs[0];
 const w = c.weightSeries;
 const wDelta = w.length > 1 ? +(w[w.length - 1].v - w[0].v).toFixed(1) : 0;

 const cards = [
 { kicker: 'Streak', big: String(streak), unit: streak === 1 ? 'day' : 'days', sub: `Best ever: ${best} days `, available: true },
 { kicker: 'Top Lift', big: topPr ? String(topPr.est1RM) : '—', unit: topPr ? 'kg' : '', sub: topPr ? `${topPr.exercise} · est 1RM ` : 'Log a lift to unlock', available: !!topPr },
 { kicker: 'Progress', big: `${wDelta > 0 ? '+' : ''}${wDelta}`, unit: 'kg', sub: `Since you started `, available: w.length > 1 },
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
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Milestone Cards</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Screenshot & share your wins</Text>

 <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
 {cards.map((cd, i) => (
 <Pressable key={cd.kicker} onPress={() => setIdx(i)} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: idx === i ? t.brand : t.surface2, borderWidth: 1, borderColor: idx === i ? t.brand : t.ring }}>
 <Text style={{ color: idx === i ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{cd.kicker}</Text>
 </Pressable>
 ))}
 </View>

 <Card t={t} appName={appName} kicker={card.kicker} big={card.big} unit={card.unit} sub={card.sub} />

 <Pressable onPress={shareCard} accessibilityRole="button" accessibilityLabel={`Share ${card.kicker} card`} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
 <Icon name="share" size={17} color={t.brandInk} />
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Share this card</Text>
 </Pressable>
 <Pressable onPress={() => router.push('/(client)/social')} style={{ paddingVertical: 12, alignItems: 'center', marginTop: 4 }}>
 <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Connect Instagram / TikTok ›</Text>
 </Pressable>
 <Text style={{ color: t.ink3, fontSize: 12, textAlign: 'center', marginTop: 6 }}>Tip: screenshot the card above to post the visual too.</Text>
 </ScrollView>
 </SafeAreaView>
 );
}
