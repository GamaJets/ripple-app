// Client · Memberships & packs. Shows what you've bought from your coach and your
// remaining session-pack balance. Buying is done from your coach's profile once
// Stripe Connect is live; this view tracks the result. Real data via connect.ts.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { money } from '../../src/lib/billing';
import { fetchMyPurchases, type Purchase } from '../../src/lib/connect';

export default function ClientPackages() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); setRows(await fetchMyPurchases()); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const activePacks = rows.filter((r) => r.sessions_total != null && r.status === 'paid');
  const remaining = activePacks.reduce((a, r) => a + Math.max(0, (r.sessions_total || 0) - r.sessions_used), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={{ marginBottom: 8 }}><Icon name="back" size={22} color={t.ink2} /></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Memberships & packs</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>What you've bought from your coach and what's left.</Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {activePacks.length > 0 ? (
              <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.brand, padding: 18, marginBottom: 16, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Sessions remaining</Text>
                <Text style={{ color: t.ink, fontSize: 40, fontWeight: '900', marginTop: 4 }}>{remaining}</Text>
              </View>
            ) : null}

            {rows.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 15, marginTop: 10 }}>No purchases yet</Text>
                <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 4, maxWidth: 280 }}>When your coach offers memberships or session packs, buy them from their profile and they'll show up here.</Text>
                <Pressable onPress={() => router.push('/(client)/trainers')} style={{ marginTop: 16, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Browse coaches</Text>
                </Pressable>
              </View>
            ) : rows.map((r) => (
              <View key={r.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{r.sessions_total != null ? `${r.sessions_total}-session pack` : 'Membership'}</Text>
                  <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{money(r.amount_cents)}</Text>
                </View>
                {r.sessions_total != null ? (
                  <View style={{ marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={{ color: t.ink3, fontSize: 12 }}>{Math.max(0, r.sessions_total - r.sessions_used)} of {r.sessions_total} left</Text>
                      <Text style={{ color: t.ink3, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, backgroundColor: t.brand, width: (r.sessions_total ? Math.round((Math.max(0, r.sessions_total - r.sessions_used) / r.sessions_total) * 100) : 0) + '%' }} /></View>
                  </View>
                ) : <Text style={{ color: t.ink3, fontSize: 12, marginTop: 6 }}>Active since {new Date(r.created_at).toLocaleDateString()}</Text>}
              </View>
            ))}

            <Text style={{ color: t.ink3, fontSize: 11.5, textAlign: 'center', marginTop: 12, lineHeight: 17 }}>Payments are processed securely by Stripe. Repple never stores your card details.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
