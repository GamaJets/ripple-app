// Trainer · Broadcast a session. Pick a recorded session clip, write one caption,
// choose platforms, and publish to all at once. Connected platforms auto-post;
// unconnected ones prompt to connect (and offer native share right now).
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { SOCIAL_PLATFORMS, socialConnected, publishToSocials, shareSessionNatively, type SocialPlatform } from '../../src/lib/social';

export default function BroadcastSession() {
  const t = useTheme();
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sel, setSel] = useState<SocialPlatform[]>(['youtube', 'instagram', 'facebook']);
  const [busy, setBusy] = useState(false);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your library') + ' to add a video.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 120 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) setUri(res.assets[0].uri);
  };

  const toggle = (p: SocialPlatform) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const publish = async () => {
    if (!uri) { Alert.alert('Add a clip', 'Record or choose the session video first.'); return; }
    if (!sel.length) { Alert.alert('Pick a platform', 'Choose at least one place to post.'); return; }
    setBusy(true);
    const r = await publishToSocials({ uri, caption: caption.trim(), platforms: sel });
    setBusy(false);
    if (r.pending.length) {
      const names = r.pending.map((p) => SOCIAL_PLATFORMS.find((x) => x.key === p)?.name || p).join(', ');
      Alert.alert(
        'Connect to auto-post',
        `${names} ${r.pending.length > 1 ? 'are' : 'is'} not linked yet. Connect ${r.pending.length > 1 ? 'them' : 'it'} in Settings to publish automatically. Share now instead?`,
        [{ text: 'Not now' }, { text: 'Share now', onPress: () => shareSessionNatively(caption.trim() || 'My training session', uri) }],
      );
    } else {
      Alert.alert('Published', 'Posted to ' + r.posted.map((p) => SOCIAL_PLATFORMS.find((x) => x.key === p)?.name).join(', ') + '.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        </View>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Broadcast a session</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Post one clip to all your channels at once.</Text>

        <Pressable onPress={() => pick(false)} style={{ height: 150, borderRadius: 16, borderWidth: 1, borderColor: uri ? t.brand : t.ring, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
          <Icon name={uri ? 'play' : 'video'} size={26} color={t.brand} />
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14, marginTop: 8 }}>{uri ? 'Clip ready · tap to replace' : 'Choose session video'}</Text>
        </Pressable>
        <Pressable onPress={() => pick(true)} style={{ alignItems: 'center', paddingVertical: 8, marginBottom: 14 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 13 }}>Or record now</Text></Pressable>

        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Caption</Text>
        <TextInput value={caption} onChangeText={setCaption} placeholder="Today's session — 20 min full-body burner 🔥 #Warehouse" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 80, marginBottom: 16, textAlignVertical: 'top' }} />

        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 8 }}>Post to</Text>
        {SOCIAL_PLATFORMS.map((p) => {
          const on = sel.includes(p.key); const connected = socialConnected(p.key);
          return (
            <Pressable key={p.key} onPress={() => toggle(p.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderColor: on ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 9 }}>
              <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? t.brand : t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={13} color={t.brandInk} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>{p.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12 }}>{p.hint}</Text>
              </View>
              <Text style={{ color: connected ? t.good ?? t.brand : t.ink3, fontSize: 11, fontWeight: '800' }}>{connected ? 'Connected' : 'Connect'}</Text>
            </Pressable>
          );
        })}

        <Pressable onPress={publish} disabled={busy} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8, opacity: busy ? 0.7 : 1 }}>
          {busy ? <ActivityIndicator color={t.brandInk} /> : <Icon name="share" size={16} color={t.brandInk} />}
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{busy ? 'Publishing…' : 'Publish to all'}</Text>
        </Pressable>
        <Text style={{ color: t.ink3, fontSize: 11.5, lineHeight: 17, marginTop: 12 }}>Connect each account once (Settings → Integrations) to auto-post. Until then, "Publish" lets you share the clip to any app from your phone.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
