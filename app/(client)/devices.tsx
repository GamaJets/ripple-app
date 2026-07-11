// Watch & Devices — real wearable connections through the provider layer.
// Apple Health works in a Repple app build (reads your paired Apple Watch);
// cloud devices show as "coming with the backend". Live metrics are real data
// pulled from HealthKit when connected — no more simulated numbers.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import type { WearableProvider } from '../../src/lib/wearables/types';
import { useWearables } from '../../src/ui/wearables';

function Metric({ t, ico, label, value, unit }: { t: Theme; ico: string; label: string; value: string; unit: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 14, padding: 14 }}>
      <Text style={{ fontSize: 18 }}>{ico}</Text>
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginTop: 6 }}>{value}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}> {unit}</Text></Text>
      <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function num(n: number | null | undefined, dashes = '—'): string {
  return typeof n === 'number' ? n.toLocaleString() : dashes;
}

export default function Devices() {
  const t = useTheme();
  const router = useRouter();
  const w = useWearables();
  const [expanded, setExpanded] = useState<string | null>(null);

  const onConnect = async (p: WearableProvider) => {
    const reason = p.unavailableReason();
    if (!p.isAvailable() && reason) { Alert.alert(p.meta.name, reason); return; }
    try {
      await w.connect(p.meta.id);
    } catch (e: any) {
      Alert.alert(p.meta.name, e?.message || 'Could not connect.');
    }
  };
  const onDisconnect = (p: WearableProvider) => w.disconnect(p.meta.id);

  const connected = PROVIDERS.filter((p) => w.states[p.meta.id] === 'connected');
  const showLive = connected.length > 0 && (w.today.activeKcal != null || w.today.heartRateAvg != null || w.today.steps != null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.push('/(client)/profile')} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Watch &amp; Devices</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Connect a wearable to auto-track heart rate &amp; calories burned</Text>

        {showLive ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.good }} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>Live today</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <Metric t={t} ico="🔥" label="Calories burned" value={num(w.today.activeKcal)} unit="kcal" />
              <Metric t={t} ico="❤️" label="Avg heart rate" value={num(w.today.heartRateAvg)} unit="bpm" />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Metric t={t} ico="👟" label="Steps" value={num(w.today.steps)} unit="" />
              <Metric t={t} ico="⌚" label="Source" value={String(connected.length)} unit={connected.length === 1 ? 'device' : 'devices'} />
            </View>
            <Text style={{ color: t.ink3, fontSize: 11, marginTop: 12 }}>Calories burned feed into your daily target — eat back what you earn on training days.</Text>
          </View>
        ) : null}

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 10 }}>Available devices</Text>
        {PROVIDERS.map((p) => {
          const st = w.states[p.meta.id] || 'disconnected';
          const on = st === 'connected';
          const busy = !!w.busy[p.meta.id];
          const reason = p.unavailableReason();
          const blocked = !p.isAvailable() && !on;
          const open = expanded === p.meta.id;
          return (
            <View key={p.meta.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: on ? t.brand : t.ring, padding: 15, marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22 }}>{p.meta.icon}</Text></View>
                <Pressable style={{ flex: 1 }} onPress={() => setExpanded(open ? null : p.meta.id)}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{p.meta.name}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{p.meta.blurb}</Text>
                </Pressable>
                {busy ? (
                  <ActivityIndicator color={t.brand} />
                ) : (
                  <Pressable onPress={() => (on ? onDisconnect(p) : onConnect(p))}
                    style={{ backgroundColor: on ? t.surface2 : blocked ? t.surface2 : t.brand, borderColor: t.ring, borderWidth: on || blocked ? 1 : 0, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}>
                    <Text style={{ color: on ? t.ink2 : blocked ? t.ink3 : t.brandInk, fontWeight: '800', fontSize: 13 }}>{on ? 'Connected' : blocked ? 'Unavailable' : 'Connect'}</Text>
                  </Pressable>
                )}
              </View>

              {blocked && reason ? <Text style={{ color: t.ink3, fontSize: 11, marginTop: 10 }}>ⓘ {reason}</Text> : null}

              {on ? (
                <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.ring, paddingTop: 12 }}>
                  {(() => {
                    const m = w.metrics[p.meta.id];
                    if (!m) return <Text style={{ color: t.ink3, fontSize: 12 }}>Connected. Pull to sync — no data for today yet.</Text>;
                    return (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                        {m.activeKcal != null ? <Text style={{ color: t.ink2, fontSize: 12 }}>🔥 {m.activeKcal} kcal</Text> : null}
                        {m.heartRateAvg != null ? <Text style={{ color: t.ink2, fontSize: 12 }}>❤️ {m.heartRateAvg} bpm avg</Text> : null}
                        {m.heartRateResting != null ? <Text style={{ color: t.ink2, fontSize: 12 }}>🌙 {m.heartRateResting} resting</Text> : null}
                        {m.steps != null ? <Text style={{ color: t.ink2, fontSize: 12 }}>👟 {m.steps.toLocaleString()} steps</Text> : null}
                        {m.workoutMins != null ? <Text style={{ color: t.ink2, fontSize: 12 }}>⏱️ {m.workoutMins} min</Text> : null}
                      </View>
                    );
                  })()}
                  <Pressable onPress={() => w.sync(p.meta.id)} style={{ marginTop: 12, alignSelf: 'flex-start', backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>↻ Sync now</Text>
                  </Pressable>
                </View>
              ) : open ? (
                <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.ring, paddingTop: 12 }}>
                  <Text style={{ color: t.ink3, fontSize: 12 }}>Reads: {p.meta.metrics.join(' · ')}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 8 }}>Apple Health reads your paired Apple Watch through HealthKit in the Repple app build. Cloud devices (WHOOP, Oura, Garmin, Fitbit) connect via their APIs and arrive with the backend rollout.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
