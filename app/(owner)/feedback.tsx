// Owner feedback inbox — every tester's in-app feedback, newest first.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { fetchAllFeedback, type FeedbackRow } from '../../src/ui/appFeedback';

const CAT_COLOR = (t: any, c: string | null) => c === 'Bug' ? t.crit : c === 'Praise' ? t.brand : c === 'Confusing' ? t.warn : t.ink3;

export default function OwnerFeedback() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchAllFeedback();
      if (!cancelled) { setRows(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } };
  const avg = rows.filter((r) => r.rating).length ? (rows.reduce((a, r) => a + (r.rating || 0), 0) / rows.filter((r) => r.rating).length) : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Feedback</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>What testers are telling you about the app.</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Submissions</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{rows.length}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Avg rating</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{avg ? avg.toFixed(1) : '—'}</Text>
          </View>
        </View>

        {loading ? (
          <Text style={{ color: t.ink3, fontSize: 14, textAlign: 'center', paddingVertical: 30 }}>Loading…</Text>
        ) : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Icon name="message" size={26} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 14, marginTop: 10, textAlign: 'center' }}>No feedback yet. It shows up here as testers send it from inside the app.</Text>
          </View>
        ) : rows.map((r) => (
          <View key={r.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={{ backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: CAT_COLOR(t, r.category), fontSize: 11, fontWeight: '800' }}>{r.category || 'Note'}</Text>
              </View>
              {r.role ? <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{r.role}</Text> : null}
              {r.rating ? <Text style={{ color: t.ink3, fontSize: 11 }}>{'★'.repeat(r.rating)}</Text> : null}
              <View style={{ flex: 1 }} />
              <Text style={{ color: t.ink3, fontSize: 11 }}>{fmt(r.createdAt)}</Text>
            </View>
            <Text style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>{r.body}</Text>
            {r.appVersion ? <Text style={{ color: t.ink3, fontSize: 10, marginTop: 6 }}>v{r.appVersion}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
