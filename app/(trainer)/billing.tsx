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
import { View, Text, ScrollView, Alert, ActivityIndicator, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, PageHead, Notice, Flag, Ring, TonedChip, type Tone } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, value } from '../../src/theme/scale';
import { PLANS } from '../../src/lib/ownerMock';
import { planOffer } from '../../src/lib/planOffer';
import { subscribeToPlan, openBillingPortal, fetchMySubscription, money, PRICE_IDS, type Invoice, type Subscription } from '../../src/lib/billing';
import { trialDisagreement, TRIAL_NOT_YET_ENFORCED, TRIAL_DAYS } from '../../src/lib/trialGate';
import { useTrialReading } from '../../src/ui/trialReading';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
// The billing history this screen promised in its own subtitle and never had.
// The sentences and the three claims it may not make are in the module; the
// read is below and the rendering is at the bottom of this file.
import {
  INVOICES_ARE_NOT_TOTALLED, invoiceListNote, invoiceListState, invoiceNeedsMark,
  invoiceOpenable, invoiceStatusLine,
} from '../../src/lib/planInvoices';
import { supabase } from '../../src/lib/supabase';
import { capLimit, capped } from '../../src/lib/rowCap';
import { reportError } from '../../src/lib/reportError';
import { fmtFullDay } from '../../src/lib/format';
import type { LoadStatus } from '../../src/ui/loadStatus';

const STATUS_LABEL: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Canceled', incomplete: 'Incomplete' };

/**
 * This coach's own Repple invoices, newest first.
 *
 * Read here rather than added to src/lib/billing.ts because that module is
 * imported by the dashboard and the money screen as well, and the only read it
 * carries over this table — `fetchFailedInvoices` — answers a different
 * question (what is OUTSTANDING, for the callout on money.tsx). This is the
 * whole history, which is what a billing screen is for.
 *
 * `.eq('trainer_id', uid)` on top of the policy, not instead of it. `inv_read`
 * (supabase/parts/106) already restricts this table to `trainer_id =
 * auth.uid()`, so the filter changes nothing for a signed-in coach — but with
 * no session it is the difference between an empty list that means "nobody is
 * signed in" and one that means "you have never been billed". The uid is read
 * first for exactly that reason and its absence is 'error', never 'ready'.
 *
 * `.limit(capLimit())` and `capped()` for the reason every list in this repo
 * carries them: PostgREST stops at 1000 rows and says nothing about having
 * stopped, and a billing history quietly cut at its ceiling is one somebody
 * hands an accountant.
 */
async function readMyInvoices(): Promise<{ rows: Invoice[] | null; status: LoadStatus }> {
  try {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) { reportError('billing.invoices.auth', authErr); return { rows: null, status: 'error' }; }
    const uid = auth?.user?.id ?? null;
    if (!uid) return { rows: null, status: 'error' };
    const { data, error } = await supabase.from('invoices')
      .select('id, trainer_id, amount_due, currency, status, attempt_count, hosted_invoice_url, created_at')
      .eq('trainer_id', uid)
      // `.order('id')` behind the date so which invoices a capped read drops is
      // the same on every read rather than whatever Postgres does with a tie.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('billing.invoices', error); return { rows: null, status: 'error' }; }
    const page = capped((data as Invoice[]) ?? []);
    return { rows: page.rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('billing.invoices', e);
    return { rows: null, status: 'error' };
  }
}

export default function TrainerBilling() {
  const t = useTheme();
  const router = useRouter();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  /* The invoices Repple has raised against this coach. Null is UNKNOWN — a
   * read that failed or has not run — and is never an empty history, because
   * "you have never been billed" and "we could not look" are opposite things
   * to tell somebody checking what they have paid. `invStatus` carries the
   * third case: 'partial' means the rows are real and are not all of them,
   * under which no count of them may be stated. */
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [invStatus, setInvStatus] = useState<LoadStatus>('loading');
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
    setInvStatus('loading');
    const [r, , inv] = await Promise.all([fetchMySubscription(), reloadTrial(), readMyInvoices()]);
    setSub(r.sub);
    setSubErr(r.error);
    // Set together, and the rows are set even under 'partial': they are real
    // invoices and worth reading. It is the CLAIM over them — that this is the
    // whole history — that 'partial' withholds.
    setInvoices(inv.rows);
    setInvStatus(inv.status);
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

  /**
   * Open one invoice on Stripe's own hosted page.
   *
   * Stripe's copy is the authority and this table is a webhook's mirror of it,
   * so the receipt an accountant gets comes from there rather than from
   * anything drawn here. A row with no url is not offered as a tap at all
   * (`invoiceOpenable`), and a device that refuses to open it says so — an
   * unexplained nothing on a tap reads as a broken screen and the next move is
   * to tap it again.
   */
  const openInvoice = async (inv: Invoice) => {
    const url = inv.hosted_invoice_url;
    if (!url || !invoiceOpenable(inv)) return;
    try { await Linking.openURL(url); }
    catch (e) {
      reportError('billing.invoices.open', e);
      Alert.alert('Couldn’t open it', 'This device would not open that invoice. Nothing about it has changed — try Manage Billing for the same page.');
    }
  };

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

  const statusTone = (s: string | null): Tone => (s === 'active' || s === 'trialing' ? 'brand' : s === 'past_due' || s === 'unpaid' ? 'red' : 'neutral');

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* The board's head — back at the leading edge, the title centred,
            the way app/(trainer)/money.tsx opens. The eyebrow that stood here
            ("Your Repple plan") was a line of prose above the title; what it said is
            still said by the first card below. */}
        <PageHead title="Billing" />

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
          {/* Round five: the days as a ring out of the fourteen, beside the
              words. Under a null `state` the ring is its track and a dash —
              no arc, because an arc at nought would be the expired trial this
              comment exists to not claim — and the note beside it says which
              silence it is. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.lg }}>
            <Ring size={104} tone={trial.state?.expired ? 'neutral' : 'brand'}
              value={trial.state ? trial.state.daysLeft / TRIAL_DAYS : null}
              figure={trial.state ? String(trial.state.daysLeft) : null}
              sub={trial.state?.daysLeft === 1 ? 'day left' : 'days left'}
              spoken={trial.state
                ? (trial.state.expired ? 'Your free days are used up' : `${trial.state.daysLeft} of ${TRIAL_DAYS} free ${trial.state.daysLeft === 1 ? 'day' : 'days'} left`)
                : 'Free trial days not read'} />
            <View style={{ flex: 1, minWidth: 160 }}>
              {trial.state ? (
                <Text style={{ ...ty.head, color: t.ink }}>
                  {trial.state.expired ? 'Your free days are used up' : `${trial.state.daysLeft} free ${trial.state.daysLeft === 1 ? 'day' : 'days'} left`}
                </Text>
              ) : null}
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{trial.note}</Text>
            </View>
          </View>
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
            {/* The state as words on a plate, where a 6pt dot and a word were:
                green for a plan that is running, red for a payment that did
                not go through, grey for anything else Stripe calls it. */}
            <View style={{ marginTop: sp.sm }}>
              <TonedChip label={STATUS_LABEL[sub.status] || sub.status} tone={statusTone(sub.status)} />
            </View>
            {sub.current_period_end ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {/* `fmtFullDay`, not `new Date(x).toLocaleDateString()`, which
                    is what stood here. Two differences and both are on this
                    screen: it writes the date in the locale the APP is set to
                    rather than the one the handset is (src/lib/locale.ts, for a
                    white-labelled product where those are not the same thing),
                    and a `current_period_end` that will not parse becomes a
                    dash instead of the words "Invalid Date" beside "Renews". */}
                {sub.cancel_at_period_end ? 'Ends' : 'Renews'} {fmtFullDay(sub.current_period_end)}
              </Text>
            ) : null}
            {/* ── a payment that did not go through, said in words ──────────
                'past_due' and 'unpaid' were a coloured dot and one word. The
                dot is a mark and the word is Stripe's, and neither says what
                has happened or what fixes it — so the state a coach most needs
                to act on was the state this screen explained least. The
                invoice for it is in the list below, with the number of times
                the card has been tried on it.

                The words carry it and the dot marks it: `t.crit` as ink is
                below AA on the light palettes. And nothing here claims what
                Repple will do about it — no threat of losing access, because
                nothing in this app enforces one (TRIAL_NOT_YET_ENFORCED above
                says the same thing about the trial). */}
            {sub.status === 'past_due' || sub.status === 'unpaid' ? (
              <Flag tone={t.crit} style={{ marginTop: sp.md }}>
                A payment for this plan has not gone through. Stripe will try the card again, and updating it
                in Manage Billing is what settles it — your clients see nothing about any of this.
              </Flag>
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

        {/* ── what Repple has charged you ─────────────────────────────────
            The screen's own subtitle has said "your Repple plan, payment
            method and invoices" since it was written, and there was no
            invoice on it — paid or unpaid. The ledger existed (`invoices`,
            supabase/parts/20), the coach was already allowed to read their own
            rows (`inv_read`, part 106), and the only thing in the app that
            touched it was the outstanding-only callout on money.tsx, which
            points the coach HERE for the rest.

            Four states and not two: reading, could-not-read, nothing billed,
            and a list — with a fifth, a list that hit its ceiling, which shows
            its rows and withholds the claim that they are the whole history.
            src/lib/planInvoices.ts holds all five and the test beside it is
            what stops "nothing has been billed to you yet" being said over a
            read that failed.

            No total, here or anywhere near here. Every row carries its own
            currency from Stripe and two currencies do not add up. */}
        <Section>
          <SectionHead title="Your Invoices" note="what Repple has charged you" />
          {(() => {
            const state = invoiceListState(invoices, invStatus);
            const note = invoiceListNote(state);
            const rows = state === 'some' || state === 'some-partial' ? (invoices ?? []) : [];
            return (<>
              {/* A failed read is a Flag, not warn-coloured ink: `t.warn` as
                  text is 3.87–4.08:1 on the three light palettes. */}
              {note ? (
                state === 'unread' || state === 'some-partial'
                  ? <Flag tone={t.warn}>{note}</Flag>
                  : <Text style={{ ...ty.label, color: t.ink3 }}>{note}</Text>
              ) : null}
              {rows.map((i, n) => {
                const openable = invoiceOpenable(i);
                const line = invoiceStatusLine(i);
                return (
                  <Pressable key={i.id}
                    onPress={() => { void openInvoice(i); }}
                    disabled={!openable}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !openable }}
                    accessibilityLabel={openable
                      ? `Open the invoice of ${fmtFullDay(i.created_at)} for ${money(i.amount_due, i.currency)} on Stripe. ${line}`
                      : `Invoice of ${fmtFullDay(i.created_at)} for ${money(i.amount_due, i.currency)}. ${line}. There is no receipt page for this one.`}
                    style={{
                      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
                      gap: sp.md, paddingVertical: sp.md,
                      borderTopWidth: n === 0 ? 0 : hairline, borderTopColor: t.ring,
                    }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, color: t.ink }}>{fmtFullDay(i.created_at)}</Text>
                      {/* The words carry it and the dot marks it. An amount
                          somebody owes is the last thing here that should be
                          hard to read. */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {invoiceNeedsMark(i) ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} /> : null}
                        <Text style={{ ...ty.caption, color: invoiceNeedsMark(i) ? t.ink2 : t.ink3 }}>{line}</Text>
                      </View>
                    </View>
                    {/* `money`, never `amount / 100`: the divisor comes from
                        the currency on the row — there is no sen in a yen and
                        a dinar is thousandths — and an amount nobody read is a
                        dash rather than a free month. */}
                    <Text style={{ ...value(16), color: t.ink }}>{money(i.amount_due, i.currency)}</Text>
                  </Pressable>
                );
              })}
              {rows.length ? (
                // numbers-ok: not a figure. The name ends in TOTALLED and that is
                // what the check matched; the value is a sentence in
                // src/lib/planInvoices.ts saying these amounts are NOT added up,
                // because they each carry their own currency. There is no number
                // in it to group, and a total is the one thing this list refuses
                // to produce.
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{INVOICES_ARE_NOT_TOTALLED}</Text>
              ) : null}
            </>);
          })()}
        </Section>


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
