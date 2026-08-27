// Trainer · Billing & subscription. Shows the current plan/status and lets a
// trainer subscribe or manage billing via Stripe's hosted pages (Checkout /
// Billing Portal) — no card details are ever entered in-app. Credential-ready:
// activates once the owner sets Stripe secrets + each plan's price id.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every Stripe call, handler, conditional and route is
// untouched — only the presentation changed: the plan cards became
// hairline-separated sections, the Georgia serif header is gone, and the
// subscription status is a coloured dot beside ink text rather than coloured
// text (`statusTone` now marks, it no longer inks).
//
// The plan names, prices and features come from `PLANS` — the platform's real
// pricing config — and every Subscribe button is gated on a Stripe price id
// actually existing, so no plan is offered that cannot be bought.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, value } from '../../src/theme/scale';
import { PLANS } from '../../src/lib/ownerMock';
import { billingAvailable, subscribeToPlan, openBillingPortal, fetchMySubscription, PRICE_IDS, type Subscription } from '../../src/lib/billing';

const STATUS_LABEL: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Canceled', incomplete: 'Incomplete' };

export default function TrainerBilling() {
  const t = useTheme();
  const router = useRouter();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const available = billingAvailable();

  // fetchMySubscription used to answer null for both 'no plan' and 'could not
  // read', so a failed read showed the subscribe screen to somebody already
  // paying — and the obvious thing to do on that screen is pay again.
  const load = useCallback(async () => { setLoading(true); const r = await fetchMySubscription(); setSub(r.sub); setSubErr(r.error); setLoading(false); }, []);
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

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your Repple plan</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Billing</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Your Repple plan, payment method and invoices.
        </Text>

        {!available ? (
          <View style={{ marginTop: sp.xl }}>
            <Notice tone={t.ink3} kicker="Not live yet" title="Billing is not switched on"
              note="Billing turns on once the platform's Stripe keys and plan prices are configured. You'll be able to subscribe and manage payment here." />
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} />
        ) : subErr ? (
          <Section>
            <SectionHead title="Current plan" />
            <Flag tone={t.crit}>
              We could not read your subscription, so nothing below tells you whether you have one.
              If you are already subscribed you still are — do not subscribe again from this screen.
            </Flag>
            <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>{subErr}</Text>
          </Section>
        ) : sub && sub.status ? (
          <Section>
            <SectionHead title="Current plan" />
            <Text style={{ ...ty.title, color: t.ink }}>{sub.plan || 'Subscription'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusTone(sub.status) }} />
              <Text style={{ ...ty.label, color: t.ink2 }}>{STATUS_LABEL[sub.status] || sub.status}</Text>
            </View>
            {sub.current_period_end ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {sub.cancel_at_period_end ? 'Ends' : 'Renews'} {new Date(sub.current_period_end).toLocaleDateString()}
              </Text>
            ) : null}
            <View style={{ height: sp.lg }} />
            <Cta label={busy === 'portal' ? 'Opening…' : 'Manage billing'} wide disabled={busy === 'portal'} onPress={manage} />
          </Section>
        ) : (
          <Section>
            <SectionHead title="Choose a plan" />
            {PLANS.map((pl, i) => {
              const priced = !!PRICE_IDS[pl.name];
              return (
                <View key={pl.name} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ ...ty.head, color: t.ink }}>{pl.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(20), color: t.ink }}>${pl.price}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 2 }}>/mo</Text>
                    </View>
                  </View>
                  {pl.feats.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                      <Icon name="check" size={13} color={t.brand} />
                      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{f}</Text>
                    </View>
                  ))}
                  <View style={{ height: sp.md }} />
                  <Cta label={busy === pl.name ? 'Opening…' : (available && priced ? 'Subscribe' : 'Coming soon')} wide
                    disabled={!available || !priced || busy === pl.name}
                    onPress={() => (available && priced ? subscribe(pl.name) : Alert.alert('Not available yet', 'This plan needs a Stripe price id configured.'))} />
                </View>
              );
            })}
          </Section>
        )}

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
          Payments are processed securely by Stripe. Repple never sees or stores your card details.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
