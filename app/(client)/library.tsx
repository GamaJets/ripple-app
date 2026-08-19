// Client · Exercise library — the how-to clips the client's coach has uploaded.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same provider, same hooks in the same order, same modal.
// No hero: a searchable list has no live number to lead with, so the field sits
// under the title and each clip is a `<ListRow>` instead of its own box.
//
// The list comes entirely from the `useExerciseVideos` provider — Supabase rows
// plus the trainer's local additions. Nothing is seeded, so an empty library
// now says so honestly instead of reading as "no search results".
//
// Also corrected: the sheet claimed that without a coach clip it "opens a
// trusted demo". It opens a YouTube search for the movement, which is what the
// copy and the button now say.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useExerciseVideos, type VideoItem } from '../../src/ui/exerciseVideos';
import { Rule, Section, SectionHead, ListRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty } from '../../src/theme/scale';

const GROUPS = ['All', 'Legs', 'Chest', 'Back', 'Shoulders', 'Hamstrings'];

export default function Library() {
 const t = useTheme();
 const router = useRouter();
 const [q, setQ] = useState('');
 const [group, setGroup] = useState('All');
 const { videos } = useExerciseVideos();
 const [open, setOpen] = useState<VideoItem | null>(null);

 const list = videos.filter((v) =>
 (group === 'All' || v.group === group) &&
 (q.trim() === '' || v.name.toLowerCase().includes(q.toLowerCase()))
 );

 const G = layout.gutter;
 const watch = () => open && Linking.openURL(open.url || ('https://www.youtube.com/results?search_query=' + encodeURIComponent(open.name + ' proper form technique')));

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>How-to clips from your coach</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise library</Text>
 </View>
 </View>

 {/* ── the field is the screen ────────────────────────────────────── */}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg }}>
 <Icon name="search" size={16} color={t.ink3} />
 <TextInput value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={t.ink3}
 style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
 {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
 </View>

 <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.md }} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
 {GROUPS.map((g) => {
 const on = group === g;
 return (
 <Pressable key={g} onPress={() => setGroup(g)} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{g}</Text>
 </Pressable>
 );
 })}
 </ScrollView>

 <Section>
 <SectionHead title={group === 'All' ? 'All exercises' : group} note={list.length ? `${list.length} clip${list.length === 1 ? '' : 's'}` : undefined} />
 {list.length === 0 ? (
 <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
 <Icon name="video" size={26} color={t.ink3} />
 <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
 {videos.length === 0 ? 'No clips yet — they appear here as your coach uploads them.' : 'No exercises match that search.'}
 </Text>
 </View>
 ) : list.map((v, i) => (
 <View key={v.id}>
 {i > 0 ? <Rule /> : null}
 <ListRow icon="video" title={v.name} note={`${v.group} · ${v.dur}${v.uploaded ? '' : ' · coming soon'}`} onPress={() => setOpen(v)} />
 </View>
 ))}
 </Section>

 </ScrollView>

 {/* ── the clip ───────────────────────────────────────────────────── */}
 <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(null)} />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
 <Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={1}>{open?.name}</Text>
 <Pressable onPress={() => setOpen(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
 <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Close</Text>
 </Pressable>
 </View>
 <Pressable onPress={watch} accessibilityRole="button" accessibilityLabel="Play"
 style={{ height: 180, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: sp.lg }}>
 <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
 <Icon name="play" size={22} color={t.brandInk} />
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{open ? `${open.group} · ${open.dur}` : ''}</Text>
 </Pressable>
 <Cta label={open?.url ? "Watch coach's video" : 'Search YouTube for the form'} wide onPress={watch} />
 <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.lg }}>
 Watch the movement, then head to Train to log your sets. When your coach uploads their own clip it plays here; until then this opens a YouTube search for the exercise. If a lift bothers you, use “Swap” on the workout screen for an alternative.
 </Text>
 </View>
 </Modal>
 </SafeAreaView>
 );
}
