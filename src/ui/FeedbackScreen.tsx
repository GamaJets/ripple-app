// Shared "Send Feedback" screen used by the client & trainer portals. Rating +
// category + note -> saved to Supabase (owner reads it in their portal).
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Icon } from './Icon';
import { submitAppFeedback } from './appFeedback';

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
    const ok = await submitAppFeedback(rating || 0, cat, body);
    setBusy(false);
    Alert.alert(ok ? 'Thank you' : 'Saved', ok ? 'Your feedback went to the Repple team.' : 'Thanks - your feedback was recorded.', [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
            <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
          </Pressable>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Send feedback</Text>
          <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>{audience}. Tell us what to fix, what is confusing, or what you would love to see.</Text>

          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>How is the experience?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: rating >= n ? t.brand : t.surface, borderWidth: 1, borderColor: rating >= n ? t.brand : t.ring }}>
                <Icon name="trophy" size={18} color={rating >= n ? t.brandInk : t.ink3} />
              </Pressable>
            ))}
          </View>

          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {CATS.map((c) => (
              <Pressable key={c} onPress={() => setCat(c)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: cat === c ? t.brand : t.surface, borderWidth: 1, borderColor: cat === c ? t.brand : t.ring }}>
                <Text style={{ color: cat === c ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Details</Text>
          <TextInput value={body} onChangeText={setBody} placeholder="What happened, or what would make this better?" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 120, textAlignVertical: 'top', marginBottom: 20 }} />

          <Pressable onPress={submit} disabled={busy} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{busy ? 'Sending...' : 'Send feedback'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
