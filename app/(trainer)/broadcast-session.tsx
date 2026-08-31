// Trainer · Share a session clip. Pick a video, write a caption, hand both to
// the phone's share sheet. That is the screen.
//
// ── What this screen used to be, and what is left of it ─────────────────────
//
// It was "Broadcast a Session": a clip, a caption, four tickable platforms —
// YouTube, Instagram, Facebook, TikTok — and a "Publish to all" button. None of
// it published anything. `publishToSocials` in src/lib/social.ts was one line
// long and pushed every platform onto a "pending" list; the green "Set up" dot
// beside each network tested whether an `EXPO_PUBLIC_*_CLIENT_ID` string
// existed in the build, which says nothing about an account being linked
// because there was no OAuth flow, no token and no account record anywhere. The
// footnote told the coach to "connect each account once (Settings →
// Integrations)", and there is no Integrations screen in this app.
//
// A previous pass rewrote the alerts to say so — which was right, and stopped
// short. It left four checkboxes on the screen, each labelled "Not available",
// above a button that opened the share sheet regardless of which ones were
// ticked. This codebase has already ruled on that shape twice, for Studio's
// "Connect Accounting" and for Apple Music: a control whose only function is to
// explain that it does not work is worse than no control, because the coach
// still has to read it, still has to decide, and still ends up somewhere the
// screen did not promise. So the picker is gone rather than reworded, along
// with `sel`, `toggle` and the publish call, and the screen now does the one
// thing it can actually do — well, and in one tap.
//
// What direct publishing would cost is written down in the header of
// src/lib/social.ts. It is not on this screen because a coach cannot act on it.
//
// The share sheet is not a consolation prize. It lists every app the phone
// actually has, reaches networks that do not exist yet, keeps working when any
// of them changes its SDK, and gives Repple no posting access — the coach picks
// the destination and confirms the post. Two taps, and the clip is theirs.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Card, Ghost, ListRow } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { shareSessionNatively } from '../../src/lib/social';

export default function ShareSessionClip() {
  const t = useTheme();
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a video'))) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 120 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) setUri(res.assets[0].uri);
  };

  // One path, no branches, no alert on the way out. The old version put a
  // dialog between the coach and the share sheet to explain what was about to
  // happen; there is nothing to explain now, and a confirmation step in front
  // of a confirmation step is just a tap.
  const share = async () => {
    if (!uri) { Alert.alert('Add a clip', 'Record or choose the session video first.'); return; }
    setBusy(true);
    await shareSessionNatively(caption.trim() || 'My training session', uri);
    setBusy(false);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Marketing</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Share a Session</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Your clip and your caption, straight into whichever app you post from.
        </Text>

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
          {/* Said once, plainly, and not as an apology: the coach is choosing
              where this goes, which is the part of the arrangement that makes
              it work at all. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            The caption travels with the clip. You pick where it goes on the next screen — Repple never posts on your behalf.
          </Text>
        </Section>

        <Rule />

        {/* ── share ──────────────────────────────────────────────────────── */}
        <Section>
          <Pressable onPress={share} disabled={busy} accessibilityRole="button" accessibilityLabel="Share this clip"
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, opacity: busy ? 0.7 : 1, borderWidth: hairline, borderColor: t.brand }}>
            {busy ? <ActivityIndicator color={t.brandInk} /> : <Icon name="share" size={16} color={t.brandInk} />}
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{busy ? 'Opening…' : 'Share this clip'}</Text>
          </Pressable>
        </Section>

        <Rule />

        {/* ── the other half of the marketing story ──────────────────────── */}
        <Section>
          <SectionHead title="No clip today?" />
          <ListRow icon="sparkle" title="Make a share card"
            note="Your week's real numbers as a graphic you can post"
            onPress={() => router.push('/(trainer)/share-kit')} />
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
