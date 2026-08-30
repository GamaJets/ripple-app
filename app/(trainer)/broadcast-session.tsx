// Trainer · Broadcast a session. Pick a recorded session clip, write one caption,
// choose platforms, and publish to all at once. Connected platforms auto-post;
// unconnected ones prompt to connect (and offer native share right now).
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero — a compose screen has no live number to lead
// with. Five bordered boxes became one card (the clip drop, the only thing you
// act on) plus hairline-separated sections. Same picker, same publish call,
// same alerts branch-for-branch.
//
// Two claims the code could not back were removed:
//   · "Published · Posted to YouTube, Instagram…" — `publishToSocials` has never
//     uploaded anything (the platform hand-off is still a TODO in
//     `src/lib/social.ts`), so the success alert announced posts that did not
//     happen. The branch survives; it now says what actually occurred and
//     offers the share sheet, which is the one thing that really works.
//   · The trailing "Connect each account once (Settings → Integrations)" —
//     there is no Integrations screen anywhere in the app.
// The right-hand "Connect" label went too: tapping a row toggles selection, it
// never opened a connect flow. The row now states the platform's status.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Card, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { SOCIAL_PLATFORMS, socialConnected, publishToSocials, shareSessionNatively, type SocialPlatform } from '../../src/lib/social';

export default function BroadcastSession() {
  const t = useTheme();
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sel, setSel] = useState<SocialPlatform[]>(['youtube', 'instagram', 'facebook']);
  const [busy, setBusy] = useState(false);

  const pick = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a video'))) return;
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
      const names = r.posted.map((p) => SOCIAL_PLATFORMS.find((x) => x.key === p)?.name || p).join(', ');
      Alert.alert(
        'Nothing uploaded',
        `Repple cannot upload to ${names} yet — no platform upload is wired. Share the clip from your phone instead?`,
        [{ text: 'Not now' }, { text: 'Share now', onPress: () => shareSessionNatively(caption.trim() || 'My training session', uri) }],
      );
    }
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your channels</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Broadcast a Session</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Post one clip to all your channels at once.</Text>

        {/* ── the clip: the one thing on this screen you act on ──────────── */}
        <Section>
          <Card onPress={() => pick(false)} tone={uri ? t.brand : undefined} style={{ alignItems: 'center', paddingVertical: sp.xxl }}>
            <Icon name={uri ? 'play' : 'video'} size={26} color={t.brand} />
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: sp.sm }}>
              {uri ? 'Clip ready · tap to replace' : 'Choose session video'}
            </Text>
          </Card>
          <View style={{ alignItems: 'center', marginTop: sp.md }}>
            <Ghost label="Or Record Now" onPress={() => pick(true)} />
          </View>
        </Section>

        <Rule />

        {/* ── caption ────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Caption" />
          <TextInput value={caption} onChangeText={setCaption} placeholder="Today's session — 20 min full-body burner 🔥 #Warehouse"
            placeholderTextColor={t.ink3} multiline
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 88, textAlignVertical: 'top' }} />
        </Section>

        <Rule />

        {/* ── platforms ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Post To" note={sel.length ? `${sel.length} selected` : 'None selected'} />
          {SOCIAL_PLATFORMS.map((p, i) => {
            const on = sel.includes(p.key); const connected = socialConnected(p.key);
            return (
              <Pressable key={p.key} onPress={() => toggle(p.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: hairline, borderColor: on ? t.brand : t.ink3, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={13} color={t.brandInk} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.hint}</Text>
                </View>
                {/* socialConnected() only tests whether a build-time client id exists.
                    It is not an OAuth session and no account is linked, so this used to
                    read "Set up" in green while nothing could post. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{connected ? 'Not linked yet' : 'Not available'}</Text>
                </View>
              </Pressable>
            );
          })}
        </Section>

        <Rule />

        {/* ── publish ────────────────────────────────────────────────────── */}
        <Section>
          <Pressable onPress={publish} disabled={busy} accessibilityRole="button" accessibilityLabel="Publish to all"
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, opacity: busy ? 0.7 : 1 }}>
            {busy ? <ActivityIndicator color={t.brandInk} /> : <Icon name="share" size={16} color={t.brandInk} />}
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{busy ? 'Publishing…' : 'Publish to all'}</Text>
          </Pressable>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            No platform upload is wired yet, so publishing opens your phone's share sheet and you post the clip yourself.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
