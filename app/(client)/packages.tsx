// Client · Memberships & packs. Shows what you've bought from your coach and your
// remaining session-pack balance. Buying is done from your coach's profile once
// Stripe Connect is live; this view tracks the result. Real data via connect.ts.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): the remaining-sessions figure becomes the screen's one
// hero instead of a bordered box with a 40px 900-weight number, and purchases
// are hairline-separated rows with a 3px meter. Every figure still comes from
// `client_purchases` — nothing is defaulted when the query returns nothing.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Meter, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
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
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Memberships &amp; packs</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>What you've bought from your coach and what's left.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {activePacks.length > 0 ? (
              <Hero label="Sessions remaining" figure={fig(remaining)}
                note={`Across ${activePacks.length} active pack${activePacks.length === 1 ? '' : 's'}`} />
            ) : null}

            <Rule />

            {rows.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>No purchases yet</Text>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 4, maxWidth: 300 }}>When your coach offers memberships or session packs, buy them from their profile and they'll show up here.</Text>
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Browse coaches" onPress={() => router.push('/(client)/trainers')} />
                </View>
              </View>
            ) : (
              <Section>
                <SectionHead title="Your purchases" note={`${rows.length}`} />
                {rows.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.md }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{r.sessions_total != null ? `${r.sessions_total}-session pack` : 'Membership'}</Text>
                        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{money(r.amount_cents)}</Text>
                      </View>
                      {r.sessions_total != null ? (
                        <Meter label={`${Math.max(0, r.sessions_total - r.sessions_used)} of ${r.sessions_total} left`}
                          val={Math.max(0, r.sessions_total - r.sessions_used)} target={r.sessions_total} unit="" />
                      ) : (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>Active since {new Date(r.created_at).toLocaleDateString()}</Text>
                      )}
                      {r.sessions_total != null ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>Bought {new Date(r.created_at).toLocaleDateString()}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Section>
            )}

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>Payments are processed securely by Stripe. Repple never stores your card details.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
