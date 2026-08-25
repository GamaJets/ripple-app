// Shared "Send Feedback" screen used by the client & trainer portals. Rating +
// category + note -> saved to Supabase (owner reads it in their portal).
//
// On the scale (`src/theme/scale`) and the kit's controls: the Georgia serif
// title and the 700/800 weights are gone, the uppercase field labels are the
// scale's `micro`, and the submit button is the kit's `Cta`. Every handler,
// route and piece of copy is unchanged — this is a re-skin.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Cta, Ghost } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import { submitAppFeedback } from './appFeedback';
import { notifySuccess } from './haptics';

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
    Alert.alert('Thank you', 'Your feedback went to the Repple team.', [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Feedback</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Send feedback</Text>
            </View>
            <Ghost icon="back" onPress={() => router.back()} />
          </View>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>{audience}. Tell us what to fix, what is confusing, or what you would love to see.</Text>

          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>How is the experience?</Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${n} out of 5`}
                  accessibilityState={{ selected: rating >= n }} style={{ flex: 1, alignItems: 'center', paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: rating >= n ? t.brand : t.surface2, borderWidth: hairline, borderColor: rating >= n ? t.brand : t.ring }}>
                <Icon name="trophy" size={18} color={rating >= n ? t.brandInk : t.ink3} />
              </Pressable>
            ))}
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

          <Cta label={busy ? 'Sending...' : 'Send feedback'} onPress={submit} disabled={busy} wide />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
