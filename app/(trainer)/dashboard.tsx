// Trainer · Clients — roster with progress, tap a client for detail.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_TRAINER } from '../../src/lib/mockData';
import { ROSTER, type RosterClient } from '../../src/lib/trainerMock';

function Stat({ t, label, value, unit }: { t: Theme; label: string; value: string; unit?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
      <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 21, fontWeight: '800', marginTop: 4 }}>{value}{unit ? <Text style={{ fontSize: 12, color: t.ink3, fontWeight: '600' }}> {unit}</Text> : null}</Text>
    </View>
  );
}

export default function TrainerClients() {
  const t = useTheme();
  const router = useRouter();
  const [sel, setSel] = useState<RosterClient | null>(null);
  const active = ROSTER.length;
  const revenue = active * MOCK_TRAINER.sessionFee * 4;
  const unread = ROSTER.reduce((a, c) => a + c.unread, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 14 }}>Coaching</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>{MOCK_TRAINER.name.replace('Coach ', '')}</Text>
          </View>
          <Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Stat t={t} label="Active clients" value={String(active)} />
          <Stat t={t} label="Est. revenue" value={'$' + revenue.toLocaleString()} unit="/mo" />
          <Stat t={t} label="Unread" value={String(unread)} />
        </View>

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 10 }}>Your clients</Text>
        {ROSTER.map((c) => (
          <Pressable key={c.id} onPress={() => setSel(c)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{c.name}</Text>
                  {c.unread > 0 && <View style={{ backgroundColor: t.s6, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{c.unread}</Text></View>}
                </View>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.goal} · {c.lastActive}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ backgroundColor: c.weightDelta <= 0 ? 'rgba(45,212,191,0.15)' : 'rgba(224,103,103,0.15)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14 }}>
                  <Text style={{ color: c.weightDelta <= 0 ? t.brand : t.s6, fontWeight: '700', fontSize: 12 }}>{c.weightDelta > 0 ? '+' : ''}{c.weightDelta} kg</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 4 }}>Next: {c.next}</Text>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: t.ink3, fontSize: 11 }}>Plan adherence</Text>
                <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '700' }}>{c.adherence}%</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: c.adherence >= 85 ? t.brand : t.s3, width: c.adherence + '%' }} />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20 }}>
          {sel && (
            <View>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{sel.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 16 }}>{sel.goal} · {sel.weightDelta > 0 ? '+' : ''}{sel.weightDelta} kg · {sel.adherence}% adherence</Text>
              {[['📋 Review program', 'Adjust sets, reps & exercises'], ['🥗 Review meal plan', 'Tweak macros & swaps'], ['📊 View progress & scans', 'Weight, body fat, photos'], ['💬 Message', 'Open the chat thread']].map(([label, sub]) => (
                <Pressable key={label} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{sub}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSel(null)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                <Text style={{ color: t.brandInk, fontWeight: '800' }}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
