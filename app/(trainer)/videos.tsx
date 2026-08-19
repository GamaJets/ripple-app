// Trainer · Videos — exercise library the client app pulls from. Upload your own.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, modal and route from the
// previous version is preserved — only the presentation changed: the library
// count became the screen's one hero figure, the bordered clip boxes became a
// hairline-divided list, and the Georgia serif header is gone.
//
// Also removed: the row subtitle printed `v.dur`, a duration field that was
// invented and has since been blanked — a clip now says what it is and whether
// it is recorded, and nothing it cannot know.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal, TextInput, ActivityIndicator, Linking } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import { useRouter } from 'expo-router';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useExerciseVideos, uploadExerciseVideo, videoUploadAvailable, type VideoItem } from '../../src/ui/exerciseVideos';

export default function TrainerVideos() {
  const t = useTheme();
  const { videos: vids, addVideo, removeVideo } = useExerciseVideos();
  const router = useRouter();
  const [linkOpen, setLinkOpen] = useState(false);
  const [lName, setLName] = useState('');
  const [lGroup, setLGroup] = useState('');
  const [lUrl, setLUrl] = useState('');
  const [pendUri, setPendUri] = useState<string | null>(null);
  const [upName, setUpName] = useState('');
  const [upGroup, setUpGroup] = useState('');
  const [upBusy, setUpBusy] = useState(false);

  const upload = async (fromCamera: boolean, prefill?: { name?: string; group?: string }) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your library') + ' to add a video.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) {
      // Open the naming sheet; pre-fill from the tapped exercise when there is one.
      setUpName(prefill?.name || ''); setUpGroup(prefill?.group || ''); setPendUri(res.assets[0].uri);
    }
  };

  const saveUpload = async () => {
    if (!pendUri || upBusy) return;
    setUpBusy(true);
    let url: string | null = null;
    if (videoUploadAvailable()) {
      url = await uploadExerciseVideo(pendUri);
      if (!url) { setUpBusy(false); Alert.alert('Upload failed', 'Could not upload the clip right now. Check your connection and try again, or add it as a link.'); return; }
    }
    await addVideo({ name: upName.trim() || 'Exercise clip', group: upGroup.trim() || 'Uncategorised', url: url || undefined });
    setUpBusy(false); setPendUri(null);
    Alert.alert('Clip added', videoUploadAvailable() ? 'Uploaded — your clients can watch it in their program on any device.' : 'Saved to your library on this device.');
  };

  // Tap a clip's play button to watch it; tap a not-yet-recorded exercise to add one.
  const openVideo = async (v: VideoItem) => {
    if (v.url) {
      try {
        const ok = await Linking.canOpenURL(v.url);
        if (ok) { await Linking.openURL(v.url); return; }
      } catch { /* fall through to message */ }
      Alert.alert('Could not open', 'This video link could not be opened on your device.');
      return;
    }
    if (v.uploaded) {
      Alert.alert('Saved on this device', 'This clip is stored locally only. Turn on hosting so it plays here and your clients can watch it on any device.');
      return;
    }
    Alert.alert(v.name, 'No video yet for this exercise — add one now:', [
      { text: 'Record', onPress: () => upload(true, { name: v.name, group: v.group }) },
      { text: 'Upload from library', onPress: () => upload(false, { name: v.name, group: v.group }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Guard removal — a hosted clip disappears for every client, so confirm first.
  const confirmRemove = (v: VideoItem) => {
    const hosted = v.id.startsWith('db');
    Alert.alert(
      'Remove ' + v.name + '?',
      hosted ? 'This deletes the clip for you and every client who sees it. This cannot be undone.' : 'This removes it from your library.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeVideo(v.id) },
      ],
    );
  };

  const done = vids.filter((v) => v.uploaded).length;
  const G = layout.gutter;
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: 30, ...elevation.e2 };
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginBottom: sp.md };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients see these</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise videos</Text>
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="In your library"
          figure={String(vids.length)}
          unit={vids.length === 1 ? 'clip' : 'clips'}
          note={vids.length ? `${done} of ${vids.length} recorded · clients see these in their program` : 'Record a clip or paste a link and it appears in every client’s program.'}
        />

        <Rule />

        {/* ── add a clip: the primary action ─────────────────────────────── */}
        <Section>
          <SectionHead title="Add a clip" />
          <Cta label="Record" wide onPress={() => upload(true)} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
            <View style={{ flex: 1 }}><Ghost label="Upload" icon="plus" onPress={() => upload(false)} /></View>
            <View style={{ flex: 1 }}><Ghost label="Add link" icon="share" onPress={() => { setLName(''); setLGroup(''); setLUrl(''); setLinkOpen(true); }} /></View>
          </View>
        </Section>

        <Rule />

        <Section>
          <ListRow icon="share" title="Broadcast a session to social" note="Share a session from your library"
            onPress={() => router.push('/(trainer)/broadcast-session')} />
        </Section>

        <Rule />

        {/* ── the library ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Library" note={vids.length ? `${vids.length} clip${vids.length === 1 ? '' : 's'}` : undefined} />
          {vids.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clips yet. Record one, upload one from your library, or paste a hosted link — whatever you add here is what your clients watch in their program.
            </Text>
          ) : vids.map((v, i) => (
            <View key={v.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <Pressable onPress={() => openVideo(v)} hitSlop={6} accessibilityRole="button" accessibilityLabel={'Play ' + v.name}
                style={({ pressed }) => ({ width: 46, height: 36, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                {v.uploaded ? <Icon name="play" size={17} color={t.brand} /> : <Icon name="plus" size={17} color={t.ink3} />}
              </Pressable>
              <Pressable onPress={() => openVideo(v)} style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{v.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{v.group}{v.uploaded ? '' : ' · not recorded yet'}</Text>
              </Pressable>
              {(v.id.startsWith('vx') || v.id.startsWith('db')) ? (
                <Pressable onPress={() => confirmRemove(v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + v.name}>
                  <Icon name="minus" size={16} color={t.ink3} />
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: v.uploaded ? t.brand : t.s3 }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{v.uploaded ? 'Live' : 'To do'}</Text>
                </View>
              )}
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* ── add by link ──────────────────────────────────────────────────── */}
      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setLinkOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Add a video by link</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>Paste a hosted link (YouTube, Vimeo…). Clients watch it in their library.</Text>
          <TextInput value={lName} onChangeText={setLName} placeholder="Exercise name (e.g. Front Squat)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={lGroup} onChangeText={setLGroup} placeholder="Muscle group (e.g. Legs)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={lUrl} onChangeText={setLUrl} placeholder="https://…" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="url" style={[input, { marginBottom: sp.lg }]} />
          <Cta label="Add to library" wide onPress={() => { if (!lName.trim()) { Alert.alert('Name needed', 'Give the exercise a name.'); return; } addVideo({ name: lName, group: lGroup, url: lUrl }); setLinkOpen(false); Alert.alert('Added', lName + ' is in the exercise library.'); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setLinkOpen(false)} />
        </View>
      </Modal>

      {/* ── name a recorded / picked clip ────────────────────────────────── */}
      <Modal visible={!!pendUri} transparent animationType="slide" onRequestClose={() => { if (!upBusy) setPendUri(null); }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => { if (!upBusy) setPendUri(null); }} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Name this clip</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{videoUploadAvailable() ? 'It uploads to your library so clients watch it in their program on any device.' : 'Saved to this device — turn on the backend to share it with clients.'}</Text>
          <TextInput value={upName} onChangeText={setUpName} editable={!upBusy} placeholder="Exercise name (e.g. Front Squat)" placeholderTextColor={t.ink3} style={input} />
          <TextInput value={upGroup} onChangeText={setUpGroup} editable={!upBusy} placeholder="Muscle group (e.g. Legs)" placeholderTextColor={t.ink3} style={[input, { marginBottom: sp.lg }]} />
          <Pressable onPress={saveUpload} disabled={upBusy}
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm, opacity: upBusy ? 0.7 : 1 }}>
            {upBusy ? <ActivityIndicator color={t.brandInk} /> : null}
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{upBusy ? 'Uploading…' : (videoUploadAvailable() ? 'Upload to library' : 'Save clip')}</Text>
          </Pressable>
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => { if (!upBusy) setPendUri(null); }} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
