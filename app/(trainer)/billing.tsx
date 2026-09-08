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
// pricing config — and `planOffer` (src/lib/planOffer.ts) decides which of them
// this screen is allowed to put a Subscribe button under, so no plan is ever
// offered that cannot be bought and no button here is ever dead.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, value } from '../../src/theme/scale';
import { PLANS } from '../../src/lib/ownerMock';
import { planOffer } from '../../src/lib/planOffer';
import { subscribeToPlan, openBillingPortal, fetchMySubscription, PRICE_IDS, type Subscription } from '../../src/lib/billing';
import { trialDisagreement, TRIAL_NOT_YET_ENFORCED } from '../../src/lib/trialGate';
import { useTrialReading } from '../../src/ui/trialReading';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BACK_ICON } from '../../src/ui/direction';

const STATUS_LABEL: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Canceled', incomplete: 'Incomplete' };

export default function TrainerBilling() {
  const t = useTheme();
  const router = useRouter();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // The trial as the ACCOUNT records it (part 191), and as this phone happens
  // to remember it. Two separate values on purpose: the account is the
  // authority and the device's copy is kept only so the screen can SAY when
  // they disagree — the gap between them is the leak part 191 closes, and a
  // coach who has reinstalled twice is entitled to see that the app noticed.
  //
  // Both now come from src/ui/trialReading.ts, which is also what the Clients
  // tab renders its card from. This screen used to do its own `readTrial` over
  // its own `fetchAccountTrial` and its own `Date.now()`, and the dashboard
  // did something else entirely — so the two screens said different things
  // about one account, minutes apart, and each was right about its own source.
  // One read, one clock, both screens.
  const { reading: trial, localDaysLeft: localDays, reload: reloadTrial } = useTrialReading();
  // What this screen is allowed to put in front of a coach, and whether any of
  // it is for sale. The rule and the reasoning are in src/lib/planOffer.ts;
  // the short version is that a plan with no Stripe price id is not rendered
  // with a dead button, it is not rendered at all. See the note at the plan
  // list below for what was there before.
  const offer = planOffer(PLANS, PRICE_IDS);
  const available = offer.buyable;

  // fetchMySubscription used to answer null for both 'no plan' and 'could not
  // read', so a failed read showed the subscribe screen to somebody already
  // paying — and the obvious thing to do on that screen is pay again.
  const load = useCallback(async () => {
    setLoading(true);
    const [r] = await Promise.all([fetchMySubscription(), reloadTrial()]);
    setSub(r.sub);
    setSubErr(r.error);
    setLoading(false);
  }, [reloadTrial]);
  // On focus, not on mount, and the comment directly above is the reason.
  //
  // `subscribe` and `manage` both hand off to `Linking.openURL` — Stripe
  // Checkout and the Billing Portal are hosted pages in the system browser —
  // and this screen is never unmounted while the coach is over there. A
  // mount-only effect therefore read the subscription exactly once, BEFORE the
  // payment: a coach who completed Checkout came back to the "Choose a Plan"
  // branch with a live Subscribe button under the plan they had just bought,
  // and the obvious thing to do on that screen is pay again. The reverse is as
  // bad in its own way — cancel in the portal, come back, and the screen still
  // shows an active plan with a renewal date. Every other money screen in this
  // folder re-reads on focus; this one was the outlier.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The same read the focus effect runs. Stripe's own state can change while
  // the coach is looking at this screen — a card declining, a portal
  // cancellation settling — and refocusing is not always available to them.
  const pull = usePullToRefresh(load);

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your Repple plan</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Billing</Text>
          </View>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
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

        {/* ── the trial, from the account rather than from this phone ─────
            `src/lib/trial.ts` kept the start date in AsyncStorage, so clearing
            app data or signing in on a second phone started the fourteen days
            again. Part 191 records it on the trainer row, immutable once set,
            and this is where a coach can see which figure is the real one.

            Nothing is gated on it yet and the copy says so outright. A coach
            reading "your trial has ended" beside a fully working app would
            reasonably conclude the app was lying about one or the other. */}
        {/* Always rendered, because this screen's subject IS the trial and
            all four states have a sentence. The Clients tab is the opposite
            case and takes the opposite decision — `trialCard` prints a
            countdown only when the account produced one and draws nothing
            otherwise — and the argument for the asymmetry is in that
            function's header. */}
        <Section>
          <SectionHead title="Your Free Trial" />
          {/* An unread start date is not an expired trial, and a read still in
              flight is neither. `readTrial` returns no state for either and
              the note says WHICH silence it is — a paywall raised on a refused
              query is this app's worst defect wearing a billing hat. */}
          {trial.state ? (
            <Text style={{ ...ty.body, color: t.ink }}>
              {trial.state.expired ? 'Your free days are used up' : `${trial.state.daysLeft} free ${trial.state.daysLeft === 1 ? 'day' : 'days'} left`}
            </Text>
          ) : null}
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{trial.note}</Text>
          {/* The whole reading, not just its state. Passing `trial.state`
              meant this line was silent for BOTH kinds of null — the account
              that did not answer and the account that answered with nothing —
              so the one mechanism built to reconcile the phone with the
              account was switched off in the case where they diverge hardest.
              See trialGate.ts. */}
          {trialDisagreement(trial, localDays) ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>{trialDisagreement(trial, localDays)}</Flag>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{TRIAL_NOT_YET_ENFORCED}</Text>
        </Section>

        {loading ? (
          <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} accessible accessibilityRole="progressbar" accessibilityLabel="Reading your subscription…" />
        ) : subErr ? (
          <Section>
            <SectionHead title="Current Plan" />
            <Flag tone={t.crit}>
              We could not read your subscription, so nothing below tells you whether you have one.
              If you are already subscribed you still are — do not subscribe again from this screen.
            </Flag>
            <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>{subErr}</Text>
          </Section>
        ) : sub && sub.status ? (
          <Section>
            <SectionHead title="Current Plan" />
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
            <Cta label={busy === 'portal' ? 'Opening…' : 'Manage Billing'} wide disabled={busy === 'portal'} onPress={manage} />
          </Section>
        ) : (
          <Section>
            {/* ── the plan list, and the developer's note it used to show a
                customer ────────────────────────────────────────────────────
                This mapped every entry in `PLANS` and put a Subscribe button
                under each, disabled and relabelled "Coming Soon" when that
                plan had no Stripe price id. Pressing it alerted "This plan
                needs a Stripe price id configured." — a sentence about our
                deployment, shown to the coach who was trying to give us money.
                It told them nothing they could act on and named an internal
                concept to explain why they could not buy the thing they had
                just tapped.

                It was also inconsistent on its face: with one tier priced and
                two not, the same list carried a live Subscribe above a dead
                button, so the price list was half a real offer.

                Now `planOffer` decides. When anything is for sale, only the
                plans that are for sale are listed and every button works. When
                nothing is — which is where this project is today, no
                EXPO_PUBLIC_STRIPE_PRICE_* is set in any eas.json profile — the
                heading below changes and the same plans render as a plain
                price list with no buttons at all, under the "Billing is not
                switched on" notice at the top of the screen. A coach can still
                read what the tiers cost, which is the one useful thing this
                screen can do in that state, and there is nothing to press
                because there is nothing to press. */}
            <SectionHead title={available ? 'Choose a Plan' : 'Plans'} />
            {!available ? (
              <Text style={{ ...ty.label, color: t.ink3, paddingBottom: sp.sm }}>
                What the tiers cost, for reference. Subscribing opens here once billing is switched on.
              </Text>
            ) : null}
            {offer.plans.map((pl, i) => (
                <View key={pl.name} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ ...ty.head, color: t.ink }}>{pl.name}</Text>
                    {/* No dollar sign. `PLANS` in ownerMock carries a number
                        and no currency at all, and Repple is white-labelled —
                        a coach in London reading "$49" for a plan Stripe will
                        bill them in sterling has been quoted a figure in a
                        currency nobody chose. The unit is stated under the
                        list, where the truth is that Stripe decides it. */}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(20), color: t.ink }}>{pl.price}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginStart: 2 }}>/mo</Text>
                    </View>
                  </View>
                  {pl.feats.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                      <Icon name="check" size={13} color={t.brand} />
                      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{f}</Text>
                    </View>
                  ))}
                  {/* No button at all when nothing is for sale. Every plan
                      `offer.plans` hands back in the buyable state has a price
                      id by construction, so this button is never dead — the
                      only thing that can disable it is the tap in flight. */}
                  {available ? (
                    <>
                      <View style={{ height: sp.md }} />
                      <Cta label={busy === pl.name ? 'Opening…' : 'Subscribe'} wide
                        disabled={busy === pl.name}
                        onPress={() => subscribe(pl.name)} />
                    </>
                  ) : null}
                </View>
            ))}
          </Section>
        )}

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
          Plan prices are stated without a currency because Repple&apos;s plan config does not record
          one — Stripe shows the exact amount and currency before you pay. This is your Repple
          subscription; what your own clients pay you is on Payments.
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
          Payments are processed securely by Stripe. Repple never sees or stores your card details.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
