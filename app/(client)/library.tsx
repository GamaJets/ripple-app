// Exercise Library — searchable list of how-to videos your coach uploaded.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { EX_VIDEOS } from '../../src/lib/trainerMock';

const GROUPS = ['All', 'Legs', 'Chest', 'Back', 'Shoulders', 'Hamstrings'];

export default function Library() {
  const t = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('All');
  const [open, setOpen] = useState<typeof EX_VIDEOS[number] | null>(null);

  const list = EX_VIDEOS.filter((v) =>
    (group === 'All' || v.group === group) &&
    (q.trim() === '' || v.name.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.ink3, fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Exercise Library</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>How-to videos from your coach — tap to watch the form.</Text>

        <TextInput value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={t.ink3}
          style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 }} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
          {GROUPS.map((g) => (
            <Pressable key={g} onPress={() => setGroup(g)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: group === g ? t.brand : t.surface2, borderWidth: 1, borderColor: group === g ? t.brand : t.ring }}>
              <Text style={{ color: group === g ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{g}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {list.length === 0 ? (
          <Text style={{ color: t.ink3, fontSize: 14 }}>No exercises match that search.</Text>
        ) : list.map((v) => (
          <Pressable key={v.id} onPress={() => setOpen(v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 10 }}>
            <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22 }}>{v.uploaded ? '▶️' : '🎬'}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{v.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{v.group} · {v.dur}{v.uploaded ? '' : ' · coming soon'}</Text>
            </View>
            <Text style={{ color: t.ink3, fontSize: 20 }}>›</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setOpen(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 18, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{open?.name}</Text>
            <Pressable onPress={() => setOpen(null)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Close</Text></Pressable>
          </View>
          <View style={{ height: 200, borderRadius: 14, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 44 }}>{open?.uploaded ? '▶️' : '🎬'}</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginTop: 8 }}>{open?.uploaded ? `${open?.group} · ${open?.dur}` : 'Your coach is still filming this one'}</Text>
          </View>
          <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>Watch your coach demo the movement, then head to Train to log your sets. If a lift bothers you, use “Swap” on the workout screen for an alternative.</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
