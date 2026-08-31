// Client · Memberships & packs. What you have bought from your coach, what you
// are subscribed to, what is left, and what else they sell. Real data via
// connect.ts and subscriptions.ts.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): the remaining-sessions figure becomes the screen's one
// hero instead of a bordered box with a 40px 900-weight number, and purchases
// are hairline-separated rows with a 3px meter. Every figure still comes from
// `client_purchases` — nothing is defaulted when the query returns nothing.
//
// Recurring packages (part 97) live here too, because this is the screen a
// client opens to answer "what am I paying for". Three sentences on it are
// load-bearing and none of them may be guessed:
//
//   "You are not subscribed"  — never printed on a failed read. Somebody who is
//                               paying, told that, subscribes again.
//   the renewal date          — never printed unless Stripe stated one.
//   the amount                — never printed unless we know the CURRENCY it is
//                               in. `client_purchases` stores no currency, so a
//                               purchase whose package has gone is a dash, not
//                               a number with a dollar sign guessed onto it.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Meter, Ghost, Cta, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import { fetchMyPurchases, fetchTrainerPackages, packageCurrencies, buyPackage, type Purchase, type TrainerPackage } from '../../src/lib/connect';
import {
  fetchMySubscriptions, myCoachId, subscribeToPackage, cancelSubscription, resumeSubscription,
  openSubscriptionPortal, pkgMoney, pkgPriceLine, statusLabel, isLive, type ClientSubscription,
} from '../../src/lib/subscriptions';

export default function ClientPackages() {
  const t = useTheme();
  const router = useRouter();
  // null is not []. [] is somebody who has bought nothing; null is a purchase
  // history we could not read — and telling a paying customer they have no
  // purchases is the one sentence here that must never be guessed.
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The same distinction again, for the thing that charges again next month.
  const [subs, setSubs] = useState<ClientSubscription[] | null>(null);
  const [offers, setOffers] = useState<TrainerPackage[] | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachErr, setCoachErr] = useState<string | null>(null);
  const [cur, setCur] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, s, c] = await Promise.all([fetchMyPurchases(), fetchMySubscriptions(), myCoachId()]);
    setRows(p); setFailed(p === null); setSubs(s);
    setCoachId(c.coachId); setCoachErr(c.error);
    // What the coach currently sells — null means the read failed, which is not
    // "your coach sells nothing".
    const list = c.coachId ? await fetchTrainerPackages(c.coachId) : null;
    setOffers(c.coachId ? list : []);
    // The unit for every past amount on this screen. Purchases carry none of
    // their own; see packageCurrencies.
    const ids = [...(p ?? []).map((r) => r.package_id), ...(s ?? []).map((r) => r.package_id)].filter(Boolean) as string[];
    setCur(await packageCurrencies(ids));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const activePacks = (rows ?? []).filter((r) => r.sessions_total != null && r.status === 'paid');
  const remaining = activePacks.reduce((a, r) => a + Math.max(0, (r.sessions_total || 0) - r.sessions_used), 0);
  // Subscriptions the client is actually on the hook for. A cancelled one from
  // last year is history, not a thing they are paying.
  const liveSubs = (subs ?? []).filter((s) => isLive(s.status));
  const subIds = new Set(liveSubs.map((s) => s.package_id).filter(Boolean));
  // What is left to buy: everything the coach sells that this client is not
  // already subscribed to. A one-off pack stays on offer however many they own.
  const buyable = (offers ?? []).filter((p) => !(p.billing_interval && subIds.has(p.id)));
  const G = layout.gutter;

  const start = async (p: TrainerPackage) => {
    setBusy(p.id);
    const r = p.billing_interval ? await subscribeToPackage(p.id) : await buyPackage(p.id);
    setBusy(null);
    if (!r.ok) Alert.alert('Could not start checkout', r.error || 'Try again in a moment.');
  };

  const stop = (s: ClientSubscription) => {
    const ends = s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : null;
    Alert.alert('Cancel this subscription?',
      ends
        ? `You keep it until ${ends} — you have already paid for this period — and you will not be charged again.`
        : 'You keep it until the end of the period you have already paid for, and you will not be charged again.',
      [{ text: 'Keep It', style: 'cancel' }, { text: 'Cancel Subscription', style: 'destructive', onPress: async () => {
        setBusy(s.id);
        const r = await cancelSubscription(s.stripe_subscription_id);
        setBusy(null);
        // Stripe's answer, not ours. Saying "cancelled" on a failure would stop
        // the client trying again, and they would be charged next month.
        if (!r.ok) { Alert.alert('Not cancelled', (r.error || 'The change did not go through.') + ' Your subscription is still running — try again in a moment.'); return; }
        load();
      } }]);
  };

  const resume = async (s: ClientSubscription) => {
    setBusy(s.id);
    const r = await resumeSubscription(s.stripe_subscription_id);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not restarted', (r.error || 'The change did not go through.') + ' It is still set to end.'); return; }
    load();
  };

  const manage = async (s: ClientSubscription) => {
    setBusy(s.id);
    const r = await openSubscriptionPortal(s.stripe_subscription_id);
    setBusy(null);
    if (!r.ok) Alert.alert('Billing', r.error || 'Could not open billing in a browser.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Memberships &amp; Packs</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>What you've bought from your coach and what's left.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {activePacks.length > 0 ? (
              <Hero label="Sessions Remaining" figure={fig(remaining)}
                note={`Across ${activePacks.length} active pack${activePacks.length === 1 ? '' : 's'}`} />
            ) : null}

            <Rule />

            {/* ── what recurs ────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Your Subscriptions" note={subs && liveSubs.length ? String(liveSubs.length) : undefined} />
              {subs === null ? (
                <Flag tone={t.crit}>
                  We couldn't read your subscriptions. This is not a statement that you have none — if you
                  are subscribed to your coach you still are, and you should not subscribe again from here.
                </Flag>
              ) : liveSubs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>You have no recurring subscription. Anything your coach sells monthly appears below.</Text>
              ) : null}
              {(subs === null ? [] : liveSubs).map((s, i) => (
                <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>Coaching subscription</Text>
                    {/* The amount Stripe bills, in the currency Stripe bills it
                        in. Unknown is a dash — never a zero, and never a figure
                        with a currency guessed onto it. */}
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>
                      {fig(pkgPriceLine(s.amount_cents, s.currency || (s.package_id ? cur.get(s.package_id) : null), s.billing_interval))}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'past_due' ? t.crit : s.cancel_at_period_end ? t.warn : t.brand }} />
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {statusLabel(s.status)}
                      {/* No date rather than a date we do not have. A renewal
                          day is the thing somebody plans around. */}
                      {s.current_period_end
                        ? ` · ${s.cancel_at_period_end ? 'ends' : 'renews'} ${new Date(s.current_period_end).toLocaleDateString()}`
                        : ' · renewal date not known'}
                    </Text>
                  </View>
                  {s.status === 'past_due' ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Flag tone={t.crit}>
                        Your last payment did not go through. The subscription has not ended — update your
                        card and it carries on.
                      </Flag>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                    {s.cancel_at_period_end
                      ? <Ghost label={busy === s.id ? 'Working…' : 'Keep Subscription'} onPress={() => resume(s)} />
                      : <Ghost label={busy === s.id ? 'Working…' : 'Cancel'} onPress={() => stop(s)} />}
                    <Ghost label="Payment & Invoices" onPress={() => manage(s)} />
                  </View>
                </View>
              ))}
            </Section>

            <Rule />

            {failed ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>We couldn't load your purchases</Text>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 4, maxWidth: 320 }}>
                  This is our end, not a statement about what you have bought. Anything you have paid
                  for is still yours — it just is not readable right now.
                </Text>
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Try Again" onPress={load} />
                </View>
              </View>
            ) : (rows ?? []).length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>No purchases yet</Text>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 4, maxWidth: 300 }}>When your coach offers memberships or session packs, buy them from their profile and they'll show up here.</Text>
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Browse Coaches" onPress={() => router.push('/(client)/trainers')} />
                </View>
              </View>
            ) : (
              <Section>
                <SectionHead title="Your Purchases" note={`${(rows ?? []).length}`} />
                {(rows ?? []).map((r, i) => (
                  <View key={r.id}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.md }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{r.sessions_total != null ? `${r.sessions_total}-session pack` : 'Membership'}</Text>
                        {/* Was money(r.amount_cents), which rendered an unknown
                            amount as $0.00 and stamped a dollar sign on a price
                            paid in dirhams. The unit comes from the package;
                            with no unit there is no figure. */}
                        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>
                          {fig(pkgMoney(r.amount_cents, r.package_id ? cur.get(r.package_id) : null))}
                        </Text>
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

            <Rule />

            {/* ── what your coach sells ──────────────────────────────────── */}
            <Section>
              <SectionHead title="From Your Coach" />
              {coachErr ? (
                <Flag tone={t.crit}>We couldn't check who coaches you, so this is not a list of what is on offer.</Flag>
              ) : !coachId ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>You are not linked to a coach yet. Find one and their packages appear here.</Text>
              ) : offers === null ? (
                <Flag tone={t.crit}>
                  We couldn't read your coach's packages. This is not a statement that they sell none —
                  try again in a moment.
                </Flag>
              ) : buyable.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Your coach has nothing else on sale right now.</Text>
              ) : null}
              {(offers === null ? [] : buyable).map((p, i) => (
                <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{p.name}</Text>
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(pkgPriceLine(p.price_cents, p.currency, p.billing_interval))}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {p.billing_interval
                      ? `Charged every ${p.billing_interval === 'month' ? 'month' : 'year'} until you cancel. Cancel any time.`
                      : p.sessions ? `${p.sessions} sessions · paid once` : 'Paid once'}
                  </Text>
                  <View style={{ marginTop: sp.md }}>
                    <Cta label={busy === p.id ? 'Opening…' : p.billing_interval ? 'Subscribe' : 'Buy'} wide disabled={busy === p.id} onPress={() => start(p)} />
                  </View>
                </View>
              ))}
              {/* Checkout happens in a browser and the confirmation arrives from
                  Stripe, not from the tap. So this screen does not claim a
                  payment succeeded — it says where the answer comes from and
                  offers the refresh that fetches it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                  Paying opens Stripe in your browser. A new subscription shows up here once Stripe confirms it,
                  which can take a moment.
                </Text>
                <Ghost label="Refresh" onPress={load} />
              </View>
            </Section>

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>Payments are processed securely by Stripe. Repple never stores your card details.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
