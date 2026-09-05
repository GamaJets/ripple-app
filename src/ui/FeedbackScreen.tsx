// Shared "Send Feedback" screen used by the client & trainer portals. Rating +
// category + note -> saved to Supabase (owner reads it in their portal).
//
// On the scale (`src/theme/scale`) and the kit's controls: the Georgia serif
// title and the 700/800 weights are gone, the uppercase field labels are the
// scale's `micro`, and the submit button is the kit's `Cta`. Every handler,
// route and piece of copy is unchanged — this is a re-skin.
import { useState } from 'react';
import { BRAND } from '../lib/brands';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Cta, Ghost } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';
import { submitAppFeedback } from './appFeedback';
import { notifySuccess } from './haptics';
import { BACK_ICON } from './direction';

const CATS = ['Bug', 'Confusing', 'Idea', 'Praise'];

export default function FeedbackScreen({ audience }: { audience: string }) {
  const t = useTheme();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [cat, setCat] = useState('Idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim()) { Alert.alert('Add a note', 'Tell us what worked or what to improve.'); return; }
    setBusy(true);
    const res = await submitAppFeedback(rating || 0, cat, body);
    setBusy(false);
    if (res.ok) notifySuccess();
    // The failure branch used to read "Saved - Thanks, your feedback was
    // recorded." It was not recorded: ok===false means no signed-in user, a
    // rejected insert, or a thrown error. The text was discarded and the screen
    // popped, so it never reached the owner's Feedback inbox.
    if (!res.ok) {
      // Say what actually went wrong. This previously blamed the connection for
      // every failure — a real user hit a rejected insert with perfect signal
      // and was told to reconnect.
      Alert.alert(
        'Not sent',
        (res.reason ? res.reason + '\n\n' : '') + 'Your text is still here, so you can try again.',
      );
      return;
    }
    Alert.alert('Thank you', `Your feedback went to the ${BRAND.label} team.`, [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* No KeyboardAvoidingView. This one component is mounted under a
          navigator header in the client portal and with no header at all in the
          trainer portal, so the offset KeyboardAvoidingView needs is not the
          same in the two places it renders — it mixes its own parent-relative
          layout with the keyboard's window-absolute top edge, and under the
          client header it under-lifted by the height of that header. The
          "Details" box is the last field on the screen, so that is the one the
          keyboard covered. `automaticallyAdjustKeyboardInsets` is measured by
          iOS in window coordinates and is right in both mountings; there is no
          docked bar here that would need src/ui/keyboardLift.ts instead. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        {/* Back leads the row rather than trailing it. It trailed here, which
            put the one control that leaves the screen at the far RIGHT — where
            iOS has never put it, and where the rest of this app does not put it
            either (see the Money screen, which reads back-then-title). A coach
            reaching for the top-left corner found nothing there. The a11yLabel
            is not decoration: without one the button is announced as "button"
            and there is no other back affordance on this screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Feedback</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Send Feedback</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>{audience}. Tell us what to fix, what is confusing, or what you would love to see.</Text>

        {/* The five buttons carried a trophy each and nothing else. Unrated,
            that is five IDENTICAL grey glyphs: nothing on the row says it is a
            scale, nothing says which end is good, and a trophy means "you won"
            rather than "this was fine" — the one question the row is asking.
            Seen on an iPhone 17 Pro at the default text size.

            The digit is the fix rather than a star because there is no star in
            src/ui/Icon.tsx and inventing one to carry this meaning is a larger
            change than the defect. A number needs no legend, scales with the
            text size, and is read out as itself. The fill-to-N behaviour is
            unchanged — tapping 3 lights 1, 2 and 3 — so the row still reads as
            a magnitude and not five separate choices, and the end labels say
            which direction that magnitude runs in. */}
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>How is the experience?</Text>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${n} out of 5`}
                accessibilityState={{ selected: rating >= n }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TARGET, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: rating >= n ? t.brand : t.surface2, borderWidth: hairline, borderColor: rating >= n ? t.brand : t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '600', color: rating >= n ? t.brandInk : t.ink3 }}>{n}</Text>
            </Pressable>
          ))}
        </View>
        {/* Which way the row runs, said once and quietly. Without it a 1 is as
            likely to be read as "first place" as "worst". */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.xs, marginBottom: sp.xl }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Poor</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Great</Text>
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.xl }}>
          {CATS.map((c) => (
            <Pressable key={c} onPress={() => setCat(c)} style={{ paddingHorizontal: sp.lg, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: cat === c ? t.brand : t.surface2, borderWidth: hairline, borderColor: cat === c ? t.brand : t.ring }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: cat === c ? t.brandInk : t.ink2 }}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Details</Text>
        <TextInput value={body} onChangeText={setBody} placeholder="What happened, or what would make this better?" placeholderTextColor={t.ink3} multiline style={{ ...ty.body, color: t.ink, backgroundColor: t.surface, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.xl }} />

        <Cta label={busy ? 'Sending…' : 'Send Feedback'} onPress={submit} disabled={busy} wide />
      </ScrollView>
    </SafeAreaView>
  );
}
