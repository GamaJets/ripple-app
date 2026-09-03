// Client · Plans & passes. What the gym sells, and the first screen in this app
// from which a member can actually buy any of it.
//
// ── What was here before, which was nothing ───────────────────────────────
//
// app/(client)/membership.tsx could read a member's plan, its price and its
// dates and offered no action of any kind; app/(client)/classes.tsx could book
// a seat and never mention money; and the only purchasable thing anywhere in
// the client app was a COACH's package, on app/(client)/packages.tsx. The gym's
// own price book has been readable since part 29 and actionable never.
//
// ── The three sentences on this screen that must not be guessed ───────────
//
//   "your gym cannot take payments yet"   said only when the readiness read
//                                          LANDED. Under a failed read it is
//                                          unknown, and telling a member their
//                                          gym does not take cards when it does
//                                          sends them to the desk with cash for
//                                          no reason.
//   "your gym sells nothing"               said only under 'ready'. An empty
//                                          price list under 'error' means
//                                          UNKNOWN — src/ui/loadStatus.ts says
//                                          so in as many words.
//   the price                              printed only in the currency the row
//                                          itself carries. Never the gym's
//                                          current setting, never a default.
//
// ── What buying does, and what it deliberately does not ───────────────────
//
// A membership is sold ONE TERM AT A TIME, with the start and the end quoted
// before the card is touched. There is no auto-renew, and the screen says so
// rather than letting somebody assume it: a member who believes they are on a
// standing order and is not turns up to a gym that will not let them in. The
// argument for that, and for why a class SEAT is never sold here, is written
// out at the top of src/lib/memberBuy.ts.
//
// Payment happens on Stripe, in the browser, and the confirmation comes from
// Stripe rather than from the tap. So nothing here claims a purchase succeeded.
// The order shows as waiting until the webhook has granted it, which is the
// same shape app/(client)/packages.tsx already uses for a coach's package.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Ghost, Cta, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { worstStatus } from '../../src/ui/loadStatus';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { appLink } from '../../src/lib/deepLink';
import {
  fetchMyMemberships, primaryMembership, standingOf, standingLabel,
  type MemberMembership,
} from '../../src/lib/memberRecord';
import { useToday } from '../../src/ui/today';
import {
  fetchGymPaymentFacts, fetchGymPlans, fetchGymPassOffers, fetchMyGymOrders, startGymCheckout, MY_ORDERS_CAP,
  gymCanSell, offerFor, passNote, offerMoney, orderNote, orderIsLive, dayLabel,
  type GymAccountFacts, type GymPlan, type GymPassOffer, type GymOrder,
} from '../../src/lib/memberBuy';

/** How a plan's price reads, with its own interval beside it. The interval is a
 *  word about the PLAN, not a promise that anything recurs: nothing bought here
 *  charges again on its own. */
function planPrice(p: GymPlan): string {
  const m = offerMoney(p.priceCents, p.currency);
  if (!m) return fig(null);
  return p.interval === 'once' ? m : p.interval === 'year' ? `${m} a year` : `${m} a month`;
}

export default function GymPlans() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const uid = auth.user?.id || '';

  const [facts, setFacts] = useState<GymAccountFacts | null>(null);
  const [factStatus, setFactStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [plans, setPlans] = useState<GymPlan[]>([]);
  const [planStatus, setPlanStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [passes, setPasses] = useState<GymPassOffer[]>([]);
  const [passStatus, setPassStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [mships, setMships] = useState<MemberMembership[]>([]);
  const [mStatus, setMStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [orders, setOrders] = useState<GymOrder[]>([]);
  // The orders read carries a status like every other read on this screen, and
  // for the sharpest reason of the four: this list is the ONLY place a member
  // is told that their card was charged and the membership was never granted
  // (`orderNote` on a 'failed' order). `if (o.ok) setOrders(o.value)` was the
  // whole of the old handling, so a refused read left `orders` empty, the
  // section gated itself away, and the person whose money had gone opened the
  // screen built to tell them and found nothing on it.
  const [orderStatus, setOrderStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setFactStatus('ready'); setPlanStatus('ready'); setPassStatus('ready'); setMStatus('ready'); setOrderStatus('ready'); return; }
    if (!uid) { if (!auth.loading) { setFactStatus('error'); setPlanStatus('error'); setPassStatus('error'); setMStatus('error'); setOrderStatus('error'); } return; }

    const [f, p, x, m, o] = await Promise.all([
      fetchGymPaymentFacts(supabase as any),
      fetchGymPlans(supabase as any),
      fetchGymPassOffers(supabase as any),
      fetchMyMemberships(supabase as any, uid),
      fetchMyGymOrders(supabase as any, uid),
    ]);

    // A refused readiness read is NOT "this gym cannot take payments". That is
    // a specific claim about the gym, and `value: null` — no account row at all
    // — is the only thing that means it.
    if (f.ok) { setFacts(f.value); setFactStatus('ready'); }
    else { reportError('gymPlans.readiness', new Error(f.reason)); setFactStatus('error'); }

    if (p.ok) { setPlans(p.value); setPlanStatus('ready'); }
    else { reportError('gymPlans.plans', new Error(p.reason)); setPlanStatus('error'); }

    if (x.ok) { setPasses(x.value); setPassStatus('ready'); }
    else { reportError('gymPlans.passes', new Error(x.reason)); setPassStatus('error'); }

    // Not cleared on failure. What is on screen is the last thing we knew, and
    // replacing a membership with the fact that we could not ask is the
    // substitution app/(client)/membership.tsx's own header warns about.
    if (m.ok) { setMships(m.value); setMStatus('ready'); }
    else { reportError('gymPlans.memberships', new Error(m.reason)); setMStatus('error'); }

    // Not cleared on failure, same as the memberships above: an order we read a
    // moment ago is still the last thing we knew, and the sentence below says
    // the list is short rather than pretending it is complete.
    //
    // 'partial' when the member has more orders than the read's fifty. It is
    // not 'ready': the count in the header below is a figure over a set, and a
    // figure over a prefix is not a smaller figure, it is a wrong one — on the
    // one screen where the difference is somebody's money.
    if (o.ok) { setOrders(o.value.orders); setOrderStatus(o.value.truncated ? 'partial' : 'ready'); }
    else { reportError('gymPlans.orders', new Error(o.reason)); setOrderStatus('error'); }
  }, [uid, auth.loading]);
  useEffect(() => { void load(); }, [load]);

  const pull = usePullToRefresh(useCallback(() => load(), [load]));

  // This screen can be open across midnight, and a term starting "today" must
  // mean the day the member is actually in when they press the button.
  //
  // `todayIso(new Date())` in the render body did not deliver that, and the
  // comment it carried said so without noticing: a value recomputed per render
  // is only right when a render happens, and this screen is registered
  // `href: null` in app/(client)/_layout.tsx — mounted once, never torn down,
  // and redrawing for nothing while it sits open. The button is the point: this
  // is where a member buys a plan, so the stale day is not a stale label but
  // the start date on something they are about to pay for.
  //
  // `useToday` (src/ui/today.ts) re-reads the day at the next local midnight
  // and whenever the app returns to the foreground.
  const today = useToday();
  const primary = primaryMembership(mships, today);
  const standing = primary ? standingOf(primary, today) : null;

  // Whether the gym can take a card, and whether we know. Three states, and the
  // screen says three different things.
  const sell = factStatus === 'ready' ? gymCanSell(facts) : null;
  const canSell = sell?.ok === true;
  // Whether this screen knows what the member is already on. Every offer below
  // is relative to that, so under anything but a whole read the offers are
  // sentences rather than buttons.
  const membershipKnown = mStatus === 'ready';

  const waiting = useMemo(() => orders.filter(orderIsLive), [orders]);
  const overall = worstStatus(factStatus, planStatus, passStatus, orderStatus);
  const G = layout.gutter;

  const buy = async (label: string, req: Parameters<typeof startGymCheckout>[1]) => {
    setBusy(label);
    const r = await startGymCheckout(supabase as any, req);
    setBusy(null);
    if (!r.ok) { Alert.alert('Could not start checkout', r.error || 'Nothing has been charged. Try again in a moment.'); return; }
    try { await Linking.openURL(r.url); } catch { Alert.alert('Could not open Stripe', 'Nothing has been charged. Try again in a moment.'); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Plans &amp; Passes</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>What your gym sells, and what you are on now.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── can the gym take a card at all ──────────────────────────────
            First, because every button below depends on it, and because
            "we could not find out" and "no, and here is why" are different
            sentences with different actions attached. */}
        {factStatus === 'error' ? (
          <View style={{ marginTop: sp.lg, gap: sp.md }}>
            <Flag tone={t.crit}>
              We couldn’t check whether your gym takes card payments. That is a read that failed, not an answer.
            </Flag>
            <View style={{ flexDirection: 'row' }}>
              <Ghost label="Try Again" onPress={() => { void load(); }} />
            </View>
          </View>
        ) : sell && !sell.ok ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.warn}>{sell.reason}</Flag>
          </View>
        ) : null}

        <Rule />

        {/* ── what you are on now ─────────────────────────────────────────
            Short, because app/(client)/membership.tsx is the screen for it.
            Here it exists to make the button below readable: "Renew This Plan"
            means nothing without the date it renews from. */}
        <Section>
          <SectionHead title="Where You Stand" />
          {mStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your membership…</Text>
          ) : mStatus === 'error' ? (
            <Flag tone={t.crit}>
              We couldn’t read your membership, so nothing below can say what buying would do to it. This does not mean your gym has no record of you.
            </Flag>
          ) : !primary || !standing ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your gym has not recorded a membership against your account. Anything below starts a new one.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: standing.kind === 'expired' || standing.kind === 'cancelled' ? t.warn : t.brand }} />
              <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                {standingLabel(standing)}
                {primary.endsOn ? ` · runs to ${dayLabel(primary.endsOn)}` : ' · no end date recorded'}
              </Text>
            </View>
          )}
        </Section>

        <Rule />

        {/* ── memberships ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Memberships" note={planStatus === 'ready' && plans.length ? String(plans.length) : undefined} />
          {planStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading what your gym sells…</Text>
          ) : planStatus === 'error' ? (
            <Flag tone={t.crit}>
              We couldn’t read your gym’s plans. This is not a statement that it sells none.
            </Flag>
          ) : plans.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your gym sells no membership plans in the app. Plenty of gyms run on day passes and packs instead.
            </Text>
          ) : null}

          {(planStatus === 'error' ? [] : plans).map((p, i) => {
            // `offerFor` reads a null current membership as "there is none",
            // which is the right reading of a member who has none and the wrong
            // reading of a read that failed — and under a failed read it
            // answered "Buy This Plan · runs from today" for a member with a
            // running membership, from a start date this screen had just told
            // them it could not compute. Ten lines up it says so out loud.
            const offer = offerFor(p, membershipKnown ? primary : null, membershipKnown ? standing : null, today);
            const key = `plan:${p.id}`;
            return (
              <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{p.name}</Text>
                  <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{planPrice(p)}</Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{offer.note}</Text>
                {/* No transaction on an unknown membership. Everywhere else in
                    this file an unread fact withholds the CLAIM; this was the
                    one place it was allowed to start a payment. */}
                {offer.label && canSell && !membershipKnown ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    {mStatus === 'loading'
                      ? 'Reading your membership before this can be offered.'
                      : 'Buying is not offered until your membership can be read — starting a second term over one that is still running is not something this screen can undo. Pull down to try again.'}
                  </Text>
                ) : null}
                {offer.label && canSell && membershipKnown ? (
                  <View style={{ marginTop: sp.md }}>
                    <Cta label={busy === key ? 'Opening…' : offer.label} wide disabled={busy === key}
                      onPress={() => buy(key, {
                        kind: 'membership',
                        planId: p.id,
                        intent: offer.kind === 'renew' ? 'renew' : offer.kind === 'upgrade' ? 'upgrade' : 'new',
                        supersedesMembershipId: offer.kind === 'renew' || offer.kind === 'upgrade' ? (primary?.id ?? null) : null,
                        today,
                        successUrl: appLink('gym-purchase/success'),
                        cancelUrl: appLink('gym-purchase/cancel'),
                      })} />
                  </View>
                ) : null}
              </View>
            );
          })}

          {/* Said once, under the list, and said plainly. A member who assumes a
              standing order and does not have one stops being a member without
              ever deciding to. */}
          {planStatus === 'ready' && plans.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Nothing here charges you again on its own. Each purchase buys the run of dates shown beside it, and you renew when you want to.
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* ── drop-ins and packs ──────────────────────────────────────────
            The other half of the class screen. A pass is a CREDIT, not a seat:
            it is booked separately, and it cannot be taken by anybody else
            while a card is being typed. src/lib/memberBuy.ts carries the
            argument. */}
        <Section>
          <SectionHead title="Drop-Ins & Class Packs" note={passStatus === 'ready' && passes.length ? String(passes.length) : undefined} />
          {passStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading what your gym sells…</Text>
          ) : passStatus === 'error' ? (
            <Flag tone={t.crit}>
              We couldn’t read your gym’s passes. This is not a statement that it sells none.
            </Flag>
          ) : passes.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your gym sells no drop-ins or packs in the app.</Text>
          ) : null}

          {(passStatus === 'error' ? [] : passes).map((p, i) => {
            const key = `pass:${p.id}`;
            return (
              <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{p.name}</Text>
                  <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(offerMoney(p.priceCents, p.currency))}</Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{passNote(p, today)}</Text>
                {canSell ? (
                  <View style={{ marginTop: sp.md }}>
                    <Cta label={busy === key ? 'Opening…' : 'Buy This Pass'} wide disabled={busy === key}
                      onPress={() => buy(key, {
                        kind: 'pass',
                        passTypeId: p.id,
                        intent: 'new',
                        today,
                        successUrl: appLink('gym-purchase/success'),
                        cancelUrl: appLink('gym-purchase/cancel'),
                      })} />
                  </View>
                ) : null}
              </View>
            );
          })}

          {passStatus === 'ready' && passes.length ? (
            <View style={{ marginTop: sp.md, gap: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                A pass buys you visits, not a particular class. Book the class itself on the Classes screen, and show the pass at reception.
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Ghost label="Book a Class" onPress={() => router.push('/(client)/classes')} />
              </View>
            </View>
          ) : null}
        </Section>

        {/* ── anything Stripe has not finished with ───────────────────────
            A purchase is confirmed by Stripe, not by the tap, so an order can
            sit here for a moment. A FAILED one is the important case: the money
            moved and the entitlement did not, and saying nothing would leave
            somebody who has paid looking at a screen with nothing on it.

            Which is why the section is drawn on a FAILED read too, with no
            rows in it. An empty `waiting` under 'error' means unknown, never
            "there is nothing pending", and this is the one screen in the app
            where that difference is somebody's money. */}
        {waiting.length || orderStatus === 'error' || orderStatus === 'partial' ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Waiting On Stripe" note={orderStatus === 'ready' ? String(waiting.length) : undefined} />
              {orderStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We couldn’t read your purchases, so we can’t say whether any are still with Stripe. This is not a statement that none are. If you have paid for something that has not appeared, show your card statement to reception and they can put it right.
                </Flag>
              ) : orderStatus === 'partial' ? (
                /* A different sentence from the failed one above, and drawn on
                   its own even when nothing here is waiting: "none of your
                   recent fifty is stuck" is not "nothing of yours is stuck". */
                <Flag tone={t.warn}>
                  You have more purchases than we can show here, so this covers your {MY_ORDERS_CAP} most recent only. Anything older that Stripe never finished is not counted above. If you have paid for something that has not appeared, show your card statement to reception and they can put it right.
                </Flag>
              ) : null}
              {waiting.map((o, i) => (
                <View key={o.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>
                      {o.kind === 'membership' ? 'Membership' : 'Pass'}
                    </Text>
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(offerMoney(o.amountCents, o.currency))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: o.status === 'failed' ? t.crit : t.warn }} />
                    <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{orderNote(o)}</Text>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                <Ghost label="Refresh" onPress={() => { void load(); }} />
              </View>
            </Section>
          </>
        ) : null}

        <Rule />

        <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
          <Ghost label="Your Membership" onPress={() => router.push('/(client)/membership')} />
          <Ghost label="Payments & Receipts" onPress={() => router.push('/(client)/receipts')} />
        </View>

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
          {overall === 'ready'
            ? 'Paying opens Stripe in your browser. What you have bought appears here once Stripe confirms it, which can take a moment.'
            : 'Some of this screen could not be read, so what is missing from it is unknown rather than nothing.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
