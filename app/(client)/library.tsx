// Client · Exercise library — the how-to clips the client's coach has uploaded.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same provider, same hooks in the same order, same modal.
// No hero: a searchable list has no live number to lead with, so the field sits
// under the title and each clip is a `<ListRow>` instead of its own box.
//
// ── Four answers where there used to be two ─────────────────────────────────
//
// `videos: []` meant both "your coach has not uploaded anything" and "we could
// not reach the server", and this screen asserted the first one in both cases:
// a client whose read had failed was told, in those words, that their coach had
// recorded nothing. `status` from useExerciseVideos separates them, so the
// screen now says which of loading / unreadable / genuinely empty / filtered-to-
// nothing it is actually looking at.
//
// ── The player is a player now ──────────────────────────────────────────────
//
// The 180px box with a play triangle drawn inside it was not a player: tapping
// it called Linking.openURL and the client left the app for the browser mid-
// session. The bucket is private, so the clip plays inline through
// <ExerciseVideo>, which mints the signed URL and reports its own failure. The
// web search survives as the fallback for the case where there genuinely is no
// clip — that one is a real answer, and it is the thing the old copy got right.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { useExerciseVideos, type VideoItem } from '../../src/ui/exerciseVideos';
import { Rule, Section, SectionHead, ListRow, Notice, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty } from '../../src/theme/scale';

export default function Library() {
 const t = useTheme();
 const router = useRouter();
 const [q, setQ] = useState('');
 const [group, setGroup] = useState('All');
 const { videos, status, reload } = useExerciseVideos();
 const [open, setOpen] = useState<VideoItem | null>(null);
 // Set when the player reports that the clip it was handed cannot be resolved —
 // a share the coach revoked, or a file the signing call could not reach. That
 // is a different sentence from "your coach never recorded one", so the web
 // search is only offered once the player has actually come back empty.
 const [unplayable, setUnplayable] = useState(false);

 // The chips are whatever the library actually holds. The hardcoded six were
 // matched with `v.group === group` against a field the trainer typed by hand,
 // so a clip filed under "legs", "Glutes", or the "Uncategorised" default sat in
 // the list under "All" and under nothing else — invisible to the one control on
 // the screen whose job is finding it.
 const groups = useMemo(() => {
  const seen = new Map<string, string>(); // lowercased key → the spelling to show
  for (const v of videos) {
   const g = (v.group || '').trim();
   if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  return ['All', ...[...seen.values()].sort((a, b) => a.localeCompare(b))];
 }, [videos]);

 // A derived chip can vanish underneath the selection — the coach deletes their
 // only Hamstrings clip while the client is standing on that chip. Left alone,
 // the screen would show an empty list under a chip that is no longer drawn.
 useEffect(() => {
  if (group !== 'All' && !groups.some((g) => g.toLowerCase() === group.toLowerCase())) setGroup('All');
 }, [groups, group]);

 const term = q.trim().toLowerCase();
 const list = videos.filter((v) =>
  (group === 'All' || (v.group || '').trim().toLowerCase() === group.toLowerCase()) &&
  (term === '' || v.name.toLowerCase().includes(term))
 );
 const filtering = term !== '' || group !== 'All';

 // Whose clip it is, in the same words <ExerciseVideoBlock> uses on the workout
 // screen: one clip described two ways on two screens reads as two facts. A null
 // trainerId is a platform clip belonging to no gym; anything else is here
 // because a coach chose to share it with this client.
 const source = (v: VideoItem) => (v.trainerId ? 'Recorded by your coach' : 'From the Repple library');
 // `dur` is not a duration and never was — it holds the literal word "clip" or
 // "link", which is how the client came to be reading "Legs · clip". What they
 // can use is whose demonstration it is and whether there is one to play at all.
 const rowNote = (v: VideoItem) => `${v.group} · ${v.uploaded ? source(v) : 'No clip yet'}`;

 const G = layout.gutter;
 const show = (v: VideoItem) => { setUnplayable(false); setOpen(v); };
 const close = () => { setOpen(null); setUnplayable(false); };
 const searchWeb = () => {
  if (!open) return;
  Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent(open.name + ' proper form technique')).catch(() => {});
 };

 return (
  <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
   <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

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
     {groups.map((g) => {
      const on = group.toLowerCase() === g.toLowerCase();
      return (
       <Pressable key={g} onPress={() => setGroup(g)} accessibilityRole="button" accessibilityLabel={g === 'All' ? 'Show every muscle group' : `Show ${g} only`} accessibilityState={{ selected: on }}
        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
        <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{g}</Text>
       </Pressable>
      );
     })}
    </ScrollView>

    <Section>
     <SectionHead title={group === 'All' ? 'All exercises' : group}
      note={status === 'ready' && list.length ? `${list.length} exercise${list.length === 1 ? '' : 's'}` : undefined} />

     {/* The read failed, so nothing below this line is a statement about what
         the coach has uploaded. Anything the phone already had is still shown
         underneath — it is real — but the gap is named rather than papered over. */}
     {status === 'error' ? (
      <Notice tone={t.warn} kicker="Library" title="We couldn’t load your clips"
       note="This is our end, not your coach's. Until the library loads we can't tell you what they have uploaded.">
       <View style={{ marginTop: sp.lg }}>
        <Cta label="Try again" wide onPress={() => { reload(); }} />
       </View>
      </Notice>
     ) : null}

     {status === 'loading' && videos.length === 0 ? (
      <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
       <Icon name="video" size={26} color={t.ink3} />
       <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>Loading your coach's clips…</Text>
      </View>
     ) : list.length === 0 ? (
      // On 'error' the notice above has already said why the list is empty;
      // repeating it here as "no clips yet" would be the old lie again.
      status === 'error' ? null : (
       <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
        <Icon name="video" size={26} color={t.ink3} />
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
         {videos.length === 0
          ? 'No clips yet — they appear here as your coach uploads them.'
          : term && group !== 'All' ? `Nothing in ${group} matches “${q.trim()}”.`
          : term ? `No exercises match “${q.trim()}”.`
          : `Nothing filed under ${group}.`}
        </Text>
        {videos.length > 0 && filtering ? (
         <View style={{ marginTop: sp.md }}>
          <Ghost label="Clear filters" onPress={() => { setQ(''); setGroup('All'); }} />
         </View>
        ) : null}
       </View>
      )
     ) : list.map((v, i) => (
      <View key={v.id}>
       {i > 0 ? <Rule /> : null}
       <ListRow icon="video" title={v.name} note={rowNote(v)} onPress={() => show(v)} />
      </View>
     ))}
    </Section>

   </ScrollView>

   {/* ── the clip, playing here rather than in the browser ───────────────── */}
   <Modal visible={!!open} transparent animationType="slide" onRequestClose={close}>
    <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close}
     accessibilityRole="button" accessibilityLabel="Close the clip" />
    <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
      <Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={1}>{open?.name}</Text>
      <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
       <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Close</Text>
      </Pressable>
     </View>

     {open && open.uploaded ? (
      <View>
       <ExerciseVideo video={open} exerciseName={open.name} onUnavailable={() => setUnplayable(true)} />
       <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{open.group} · {source(open)}</Text>
      </View>
     ) : (
      <Text style={{ ...ty.label, color: t.ink2 }}>
       {open ? `${open.name} is in your library, but no clip has been recorded for it yet.` : ''}
      </Text>
     )}

     {/* Offered only when there is nothing to watch here — either the entry has
         no clip at all, or the player could not resolve the one it has. With a
         clip playing, sending the client to YouTube would be sending them away
         from the better answer. */}
     {open && (!open.uploaded || unplayable) ? (
      <View style={{ marginTop: sp.lg }}>
       <Cta label="Look it up on the web" wide onPress={searchWeb} />
       <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Opens a YouTube search for {open.name}.</Text>
      </View>
     ) : null}

     <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.lg }}>
      Watch the movement, then head to Train to log your sets. The clip plays here rather than in the browser, so a set you have already typed is still there when you go back. If a lift bothers you, use “Swap” on the workout screen for an alternative.
     </Text>
    </View>
   </Modal>
  </SafeAreaView>
 );
}
