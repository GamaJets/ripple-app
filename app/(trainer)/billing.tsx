// Trainer · Billing & subscription. Shows the current plan/status and lets a
// trainer subscribe or manage billing via Stripe's hosted pages (Checkout /
// Billing Portal) — no card details are ever entered in-app. Credential-ready:
// activates once the owner sets Stripe secrets + each plan's price id.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { PLANS } from '../../src/lib/ownerMock';
import { billingAvailable, subscribeToPlan, openBillingPortal, fetchMySubscription, PRICE_IDS, type Subscription } from '../../src/lib/billing';

const STATUS_LABEL: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Canceled', incomplete: 'Incomplete' };

export default function TrainerBilling() {
  const t = useTheme();
  const router = useRouter();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const available = billingAvailable();

  const load = useCallback(async () => { setLoading(true); setSub(await fetchMySubscription()); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const subscribe = async (plan: string) => {
    setBusy(plan);
    const r = await subscribeToPlan(plan);
    setBusy(null);
    if (!r.ok) Alert.alert('Could not start checkout', r.error || 'Try again in a moment.');
  };
  const manage = async () => {
    setBusy('portal');
    const r = await openBillingPortal();
    setBusy(null);
    if (!r.ok) Alert.alert('Billing portal', r.error || 'No active subscription to manage yet.');
  };

  const statusTone = (s: string | null) => (s === 'active' || s === 'trialing' ? t.brand : s === 'past_due' || s === 'unpaid' ? t.crit : t.ink3);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={{ marginBottom: 8 }}><Icon name="back" size={22} color={t.ink2} /></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Billing & subscription</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Your Repple plan, payment method and invoices.</Text>

        {!available ? (
          <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 18, flexDirection: 'row', gap: 8 }}>
            <Icon name="clock" size={15} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 12.5, flex: 1, lineHeight: 18 }}>Billing turns on once the platform's Stripe keys and plan prices are configured. You'll be able to subscribe and manage payment here.</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} />
        ) : sub && sub.status ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: statusTone(sub.status), padding: 18, marginBottom: 18 }}>
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Current plan</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>{sub.plan || 'Subscription'}</Text>
              <View style={{ backgroundColor: t.surface2, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: statusTone(sub.status), fontSize: 11, fontWeight: '800' }}>{STATUS_LABEL[sub.status] || sub.status}</Text></View>
            </View>
            {sub.current_period_end ? <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 6 }}>{sub.cancel_at_period_end ? 'Ends' : 'Renews'} {new Date(sub.current_period_end).toLocaleDateString()}</Text> : null}
            <Pressable onPress={manage} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
              {busy === 'portal' ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Manage billing</Text>}
            </Pressable>
          </View>
        ) : (
          <View>
            <Text style={{ color: t.ink2, fontSize: 13, marginBottom: 12 }}>Choose a plan to get started:</Text>
            {PLANS.map((pl) => {
              const priced = !!PRICE_IDS[pl.name];
              return (
                <View key={pl.name} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: t.ink, fontWeight: '800', fontSize: 17 }}>{pl.name}</Text>
                    <Text style={{ color: t.ink, fontWeight: '900', fontSize: 18 }}>${pl.price}<Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>/mo</Text></Text>
                  </View>
                  {pl.feats.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 }}><Icon name="check" size={13} color={t.brand} /><Text style={{ color: t.ink3, fontSize: 13 }}>{f}</Text></View>
                  ))}
                  <Pressable onPress={() => (available && priced ? subscribe(pl.name) : Alert.alert('Not available yet', 'This plan needs a Stripe price id configured.'))} disabled={!available || !priced} style={{ marginTop: 14, backgroundColor: available && priced ? t.brand : t.surface2, borderWidth: 1, borderColor: available && priced ? t.brand : t.ring, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                    {busy === pl.name ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: available && priced ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 14 }}>{available && priced ? 'Subscribe' : 'Coming soon'}</Text>}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <Text style={{ color: t.ink3, fontSize: 11.5, textAlign: 'center', marginTop: 8, lineHeight: 17 }}>Payments are processed securely by Stripe. Repple never sees or stores your card details.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
