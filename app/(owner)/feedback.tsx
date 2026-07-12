// Owner feedback inbox — every tester's in-app feedback, newest first.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { fetchAllFeedback, fetchAppErrors, type FeedbackRow, type AppErrorRow } from '../../src/ui/appFeedback';
import { SkeletonList } from '../../src/ui/Skeleton';

const CAT_COLOR = (t: any, c: string | null) => c === 'Bug' ? t.crit : c === 'Praise' ? t.brand : c === 'Confusing' ? t.warn : t.ink3;

export default function OwnerFeedback() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AppErrorRow[]>([]);
  const [showErr, setShowErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [data, errs] = await Promise.all([fetchAllFeedback(), fetchAppErrors(20)]);
      if (!cancelled) { setRows(data); setErrors(errs); setLoading(false); }
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
          <SkeletonList n={4} />
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

        {errors.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <Pressable onPress={() => setShowErr((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name="wrench" size={15} color={t.crit} />
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Recent errors ({errors.length})</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>{showErr ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {showErr ? errors.map((e) => (
              <View key={e.id} style={{ backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
                <Text style={{ color: t.ink2, fontSize: 12, fontFamily: 'Courier' }} numberOfLines={3}>{e.message}</Text>
                <Text style={{ color: t.ink3, fontSize: 10, marginTop: 6 }}>{e.platform || '—'}{e.appVersion ? ' · v' + e.appVersion : ''} · {fmt(e.createdAt)}</Text>
              </View>
            )) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
