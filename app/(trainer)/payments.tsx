// Trainer · Payments (Stripe Connect). Onboard a payout account, then create
// packages (memberships / session-packs) clients can buy. Money goes to the
// trainer's connected account minus the platform fee. Credential-ready: activates
// once Stripe Connect is enabled and keys are set. No card details in-app.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every Stripe/Connect call, handler, conditional and route
// was untouched in that pass — only the presentation changed: the four bordered cards became
// hairline-separated sections, the one card left is the payout decision itself,
// and the Georgia serif header is gone.
//
// ── What this screen may say about money, and what it may not ─────────────
//
// It used to say: "Nothing here reports a balance, a payout or a transaction:
// every figure is a price the trainer typed. There is no earnings number on
// this screen because the app is not told one." Half of that was true and half
// of it was a read nobody had written.
//
// The true half stands. Stripe has never told this app a balance, a payout, its
// own processing fee or the platform's application fee — no webhook in this
// repo writes any of them — so none of those four words appears on this screen.
// A "net earnings" figure here would be plausible and invented, and the one
// number a working trainer has to be able to trust is the one about their own
// money.
//
// The false half is now fixed. One thing IS written down: what a client was
// charged. `client_purchases` records `amount_cents` on every completed
// one-off checkout, and all four functions that had ever read that table
// filtered on `client_id = uid` — they are the CLIENT's side. So the app took
// money on the coach's behalf and then showed them nothing about it: not who
// bought a ten-pack, not how many sessions were left on it, not who had run
// out. `fetchClientPurchases` is the other side of the same sale, and the
// figure above it is labelled as exactly what it is — gross, taken, per
// currency, before anybody's fee.
//
// ── What a coach has EARNED, and why that took a new table ────────────────
//
// The figure above used to be one-off sales and nothing else, because one-off
// sales were the only money this database had ever written down. A client
// subscribing to "Online coaching, AED 600/month" was recorded as a
// SUBSCRIPTION — status, price, renewal date — and each month's actual payment
// was recorded nowhere at all: the webhook answered a paid invoice by re-reading
// the subscription and writing its status. After a year of that client paying,
// this app held one row saying "active, AED 600 / month" and no evidence that
// twelve payments had happened. The screen said so, which was honest and no use
// to anybody: the one question a coach asks of a payments screen is how much
// they have earned.
//
// Part 132 adds `client_subscription_payments` — one row per PAID Stripe
// invoice — and the stripe-webhook writes it. So the figures here are now both
// halves of the coach's takings added together, per currency:
//
//   one-off sales   client_purchases, from checkout.session.completed
//   renewals        client_subscription_payments, from invoice.paid
//
// and the split between the two is printed underneath, because "how much of
// this recurs" is a different question from "how much came in" and a coach
// running a membership business needs both.
//
// A renewal is dated by Stripe's own `paid_at`, never by when the row was
// written. A webhook retried three days late would otherwise move somebody's
// payment into a different month.
//
// ── What is still NOT in that figure, and cannot be ───────────────────────
//
//   · Any purchase whose currency we cannot recover. `client_purchases` only
//     records a currency from part 132 onward; older rows were backfilled from
//     the `trainer_packages` row they were sold from, and a package already
//     deleted by then left an amount with no unit forever. Those are counted and
//     reported as missing from the total rather than dropped out of it quietly
//     or summed as dollars.
//   · Anything Stripe has actually PAID OUT. This is gross — what the client
//     was charged. Stripe's processing fee, the platform's application fee, and
//     whether the money has cleared into the coach's bank are facts that live at
//     Stripe, and no webhook in this repo has ever been told any of them. That
//     sentence is on the screen, not just in this comment, because the gap
//     between "taken" and "in my account" is exactly where a coach would
//     otherwise assume a number that nobody here computed.
//
// The standing price of the live subscriptions is still printed separately,
// further down, and still labelled as a price. It is what is expected to be
// charged NEXT if nobody cancels — a forward-looking figure, which is why it is
// not added to a backward-looking one.
//
// Stopping a subscription is still the client's to do. The `cancel`/`resume`
// actions in the connect-checkout edge function scope the lookup to
// `client_id = auth.uid()`, so a coach calling them gets "subscription not
// found" — and a Cancel button that always fails is worse than none. It is said
// on screen instead of offered.
//
// Two things are new. A package can now bill EVERY month or year rather than
// once (part 97), which is the biggest difference between two rows on this
// screen and so is stated on every one of them — "one-off" is written out
// rather than implied by the absence of the word "month". And a coach can see
// who is subscribed, because a recurring charge nobody can list is a recurring
// charge nobody can check.
//
// Prices are printed in the package's OWN currency, with the code spelled out
// — "AED 600.00", not "$600". `money()` in src/lib/billing.ts maps everything
// it does not recognise onto a dollar sign, and a coach in Dubai has been
// showing their clients a price in a currency they do not take.
//
// New packages are priced in the GYM's currency (tenants.currency, part 99) and
// in nothing else. There is no picker and no default: Repple is white-labelled,
// so a currency this screen chose would be wrong for half the gyms running it.
// A gym that has not set one cannot put a package on sale, and is told that,
// rather than being given a price with a unit invented for it.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import { startTrainerOnboarding, fetchMyConnect, fetchMyPackages, createPackage, deactivatePackage, fetchClientPurchases, type ConnectStatus, type TrainerPackage, type CoachPurchase } from '../../src/lib/connect';
import { fetchMySubscribers, fetchMySubscriptionPayments, myTenantCurrency, pkgMoney, pkgPriceLine, statusLabel, isLive, type BillingInterval, type Subscriber, type SubscriptionPayment } from '../../src/lib/subscriptions';
import { sumTaken, combineTaken, sumRecurring, since, monthStart, packLeft, packRunOut, minorMoney, type Pot, type TakenRow } from '../../src/lib/coachMoney';

const INTERVALS: { key: BillingInterval | null; label: string }[] = [
  { key: null, label: 'One-off' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

/** How a package bills, in words, for a row in a list. Never blank: "one-off"
 *  said out loud is the point — a coach scanning their price list has to be
 *  able to see which of these charges again. */
const billingWords = (p: TrainerPackage): string => {
  const price = pkgPriceLine(p.price_cents, p.currency, p.billing_interval);
  const what = p.billing_interval ? '' : p.sessions ? ` · ${p.sessions} sessions` : ' · one-off membership';
  return `${price ?? fig(null)}${what}`;
};

export default function TrainerPayments() {
  const t = useTheme();
  const router = useRouter();
  const [conn, setConn] = useState<ConnectStatus | null>(null);
  // null is not []. [] is a trainer who sells nothing; null is a price list we
  // could not read, and telling someone they have no packages when they do is
  // how a duplicate price list gets built.
  const [pkgs, setPkgs] = useState<TrainerPackage[] | null>(null);
  const [pkgErr, setPkgErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('');
  const [interval, setInterval] = useState<BillingInterval | null>(null);
  // The gym's own currency, and no fallback. Repple is white-labelled: null
  // here means the gym has not set one, and a price is not offered until it
  // has — a package priced in a currency nobody chose is a wrong number in
  // front of every client who ever sees it.
  const [currency, setCurrency] = useState<string | null>(null);
  const [currencyErr, setCurrencyErr] = useState<string | null>(null);
  // Who is paying this coach every month. 'ready' with nothing means nobody has
  // subscribed; 'error' with nothing means we could not find out, and those are
  // not the same fact about somebody's income.
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [subsStatus, setSubsStatus] = useState<LoadStatus>('loading');
  // What clients have actually bought. Same three-way distinction, and it
  // carries more weight here than anywhere else on the screen: an empty list
  // under 'error' is "we could not look", and rendering it as "nothing has been
  // bought" tells a coach who has been paid that they have not been.
  const [buys, setBuys] = useState<CoachPurchase[]>([]);
  const [buysStatus, setBuysStatus] = useState<LoadStatus>('loading');
  // The renewals actually paid — the other half of the same coach's takings,
  // and the half that did not exist in this database until part 132. Carried
  // with its own status rather than folded into `buysStatus`, because the two
  // are separate reads and either can fail on its own: a total that quietly
  // omitted every renewal would be a smaller number about somebody's income
  // with nothing on screen to say it was short.
  const [pays, setPays] = useState<SubscriptionPayment[]>([]);
  const [paysStatus, setPaysStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, s, cur, b, r] = await Promise.all([fetchMyConnect(), fetchMyPackages(), fetchMySubscribers(), myTenantCurrency(), fetchClientPurchases(), fetchMySubscriptionPayments()]);
    setConn(c); setPkgs(p); setPkgErr(p === null);
    setSubs(s.rows); setSubsStatus(s.status);
    setCurrency(cur.currency); setCurrencyErr(cur.error);
    setBuys(b.rows); setBuysStatus(b.status);
    setPays(r.rows); setPaysStatus(r.status);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const onboard = async () => { setBusy(true); const r = await startTrainerOnboarding(); setBusy(false); if (!r.ok) Alert.alert('Payouts setup', r.error || 'Could not start setup. Make sure Stripe Connect is enabled.'); };

  const addPkg = async () => {
    const nm = name.trim(); const amount = parseFloat(price);
    if (!nm) { Alert.alert('Name it', 'Give the package a name.'); return; }
    if (!(amount > 0)) { Alert.alert('Set a price', 'Enter a price greater than 0.'); return; }
    // Nothing is priced in a currency nobody chose. There is no sensible
    // default in a white-label product — see tenants.currency, part 99.
    if (!currency) {
      Alert.alert('No currency set', currencyErr
        ? 'We could not read what your gym charges in, so a price would have no unit. Try again in a moment.'
        : 'Your gym has not set a currency yet, so there is nothing to price this in. An owner sets it in the gym settings.');
      return;
    }
    // A recurring package is never also a session pack — the constraint in part
    // 97 and the guard in createPackage both refuse it, and the form does not
    // offer the field at all, so this is belt and braces on a typed value.
    const sess = interval ? null : sessions.trim() ? parseInt(sessions, 10) : null;
    const cents = Math.round(amount * 100);
    // The last thing before a recurring price goes on sale is the coach reading
    // it back in the currency it will actually be charged in. A subscription
    // priced by accident in the wrong currency is not one wrong sale, it is a
    // wrong sale every month to everybody who ever buys it.
    const confirmLine = `${pkgPriceLine(cents, currency, interval) ?? fig(null)} — ${nm}`;
    const go = async () => {
      setBusy(true);
      const r = await createPackage({ name: nm, price_cents: cents, sessions: sess && sess > 0 ? sess : null, currency, billing_interval: interval });
      setBusy(false);
      if (!r.ok) { Alert.alert('Could not save', r.error || 'Try again.'); return; }
      setName(''); setPrice(''); setSessions(''); setInterval(null); load();
    };
    if (!interval) { go(); return; }
    Alert.alert('Charge this every ' + (interval === 'month' ? 'month' : 'year') + '?',
      `${confirmLine}\n\nClients who subscribe are charged again every ${interval === 'month' ? 'month' : 'year'} until they cancel.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Put On Sale', onPress: go }]);
  };

  const remove = (id: string) => Alert.alert('Remove package?', 'Clients will no longer see it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
    // deactivatePackage used to return void and swallow the error, so this
    // refreshed and said nothing — a package the trainer believes is withdrawn
    // stays on sale until a client buys it.
    const ok = await deactivatePackage(id);
    if (!ok) { Alert.alert('Not removed', 'That package is still on sale — the change did not save. Try again in a moment.'); return; }
    load();
  } }]);

  const active = conn?.charges_enabled;
  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  /** One row of mutually exclusive choices, drawn from the same tokens as the
   *  inputs beside it. Local rather than in the kit because it is one form. */
  const Pick = ({ label, options, chosen, onPick }: {
    label: string; options: { key: string | null; label: string }[]; chosen: string | null; onPick: (k: any) => void;
  }) => (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: sp.xs, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const on = o.key === chosen;
          return (
            <Pressable key={o.label} onPress={() => onPick(o.key)} accessibilityRole="button"
              accessibilityState={{ selected: on }} accessibilityLabel={label + ': ' + o.label}
              style={{
                paddingHorizontal: sp.md, paddingVertical: 9, borderRadius: radius.pill,
                backgroundColor: on ? t.brand : t.surface2,
              }}>
              <Text style={{ ...ty.caption, fontWeight: '600', color: on ? t.bg : t.ink2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const liveSubs = subs.filter((s) => isLive(s.status));

  // ── the money figures ─────────────────────────────────────────────────────
  // Only a WHOLE read may be summed. 'partial' is refused alongside 'error' on
  // purpose, and it is the more dangerous of the two: a subtotal of somebody's
  // sales printed as a month's takings is a plausible number with nothing about
  // it to doubt, where an error at least looks like one.
  const buysWhole = buysStatus === 'ready';
  const paid = buys.filter((b) => b.status === 'paid');

  // A renewal, as a row that can be added up. `paid_at` is the date, not
  // `created_at`: Stripe says when the money moved, and a webhook retried three
  // days late must not push somebody's payment into the wrong month. A payment
  // Stripe gave no date for passes a string that will not parse, which keeps it
  // out of every month rather than sweeping it into this one — it is still in
  // the all-time figure, because the money is not in doubt, only its date.
  const renewals: TakenRow[] = pays.map((p) => ({ amount_cents: p.amount_cents, currency: p.currency, created_at: p.paid_at ?? '' }));
  const undated = renewals.filter((r) => !Number.isFinite(Date.parse(r.created_at))).length;

  // Both halves or nothing. The earnings figure is the two reads added
  // together, so it is only as complete as the worse of them: a coach whose
  // renewals could not be read must not be shown their one-off sales under the
  // heading of what they have earned. `worstStatus` is the same rule every
  // multi-read screen in the app uses.
  const earnedStatus = worstStatus(buysStatus, paysStatus);
  const earnedWhole = earnedStatus === 'ready';
  const mStart = monthStart();
  const oneOffAll = earnedWhole ? sumTaken(paid) : null;
  const renewAll = earnedWhole ? sumTaken(renewals) : null;
  const takenAll = oneOffAll && renewAll ? combineTaken(oneOffAll, renewAll) : null;
  const oneOffMonth = earnedWhole ? sumTaken(since(paid, mStart)) : null;
  const renewMonth = earnedWhole ? sumTaken(since(renewals, mStart)) : null;
  const takenMonth = oneOffMonth && renewMonth ? combineTaken(oneOffMonth, renewMonth) : null;

  // A standing price, not a takings. Renewals ARE now recorded as money and are
  // in the figures above; this is a different statement — what the live
  // subscriptions are set to charge NEXT, at today's prices, if nobody cancels.
  const recurring = subsStatus === 'ready' ? sumRecurring(liveSubs) : null;
  // The packs a coach has to know about: sold, and how much of each is left.
  // Listable under 'partial' (the rows are real); not countable.
  const packs = buys.filter((b) => b.sessions_total != null);
  const runOut = packs.filter(packRunOut);
  // Used-up packs first. They are the only rows on this screen a coach has to
  // DO something about — the next session that client books is not covered by
  // anything they have paid for — and a coach with thirty packs sold was being
  // asked to find them by scanning a list ordered by purchase date. The order
  // within each group is unchanged (newest first, as fetchClientPurchases
  // returns them), so nothing else about the list moves.
  const packsShown = [...packs].sort((a, b) => Number(packRunOut(b)) - Number(packRunOut(a)));

  /** A row of money pots, one per currency. Never one figure: AED 600 and
   *  GBP 90 do not add to 690 of anything, and a white-label product sees both
   *  on the same coach's book the first time a visitor buys a session. */
  const Pots = ({ label, pots }: { label: string; pots: Pot[] }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ ...ty.caption, color: t.ink3 }}>{label}</Text>
      {pots.length === 0 ? (
        <Text style={{ ...value(22), color: t.ink, marginTop: 4 }}>{fig(null)}</Text>
      ) : pots.map((p) => (
        <View key={p.currency} style={{ marginTop: 4 }}>
          <Text style={{ ...value(22), color: t.ink }}>{fig(minorMoney(p.minorUnits, p.currency))}</Text>
          {/* "payments", not "sales": a pot now holds one-off purchases and
              subscription renewals together, and a renewal is not a sale. */}
          <Text style={{ ...ty.caption, color: t.ink3 }}>{p.count === 1 ? 'from 1 payment' : 'from ' + p.count + ' payments'}</Text>
        </View>
      ))}
    </View>
  );

  /** Several currencies on one line — "AED 1,000.00 · GBP 90.00" — for the
   *  breakdown under the totals, where each half is a supporting figure rather
   *  than the headline. A pot whose amount will not print is left out entirely
   *  rather than dashed: it cannot happen (a pot exists only because an amount
   *  and a currency were both there), and a dash mid-list would read as a
   *  currency whose figure is missing. */
  const potLine = (pots: Pot[]): string | null =>
    pots.map((p) => minorMoney(p.minorUnits, p.currency)).filter(Boolean).join(' · ') || null;

  /** One half of the takings — what recurred, and what did not. Printed under
   *  the totals because "how much of this repeats next month" is the question a
   *  membership business actually runs on, and it is not answerable from a
   *  single combined figure. */
  const Made = ({ label, taken }: { label: string; taken: { pots: Pot[] } }) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md, marginTop: 4 }}>
      <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{label}</Text>
      <Text style={{ ...ty.caption, color: t.ink2, fontWeight: '500' }}>{fig(potLine(taken.pots))}</Text>
    </View>
  );
  // The typed price read back in the gym's currency, or null when either half
  // is missing. Never a number with a unit put on it for the look of the thing.
  const typed = parseFloat(price);
  const priceEcho = currency && typed > 0 ? pkgMoney(Math.round(typed * 100), currency) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting paid</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Payments</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Get paid by your clients — memberships &amp; session packs.
        </Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {/* ── payout status: the one decision on this screen ──────────── */}
            {!active ? (
              <View style={{ marginTop: sp.xl }}>
                <Notice tone={t.warn} kicker="Payouts" title="Set Up Payouts"
                  note={conn?.stripe_account_id ? 'Finish verifying with Stripe to go live.' : 'Connect a payout account with Stripe.'}>
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={busy ? 'Opening…' : (conn?.stripe_account_id ? 'Continue Setup' : 'Set Up Payouts')} wide disabled={busy} onPress={onboard} />
                  </View>
                </Notice>
              </View>
            ) : (
              <Section>
                <SectionHead title="Payouts" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Payouts active</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>You can accept client payments.</Text>
                  </View>
                </View>
              </Section>
            )}

            <Rule />

            {/* ── what has actually been taken ───────────────────────────── */}
            <Section>
              <SectionHead title="Taken Through Stripe" />
              {earnedStatus === 'error' ? (
                <Flag tone={t.crit}>
                  {buysStatus === 'error' && paysStatus === 'error'
                    ? 'Your sales and your renewals could not be read, so there is no figure here. This is not a statement that nothing has been paid — anything a client has paid, they have paid.'
                    : buysStatus === 'error'
                      ? 'Your one-off sales could not be read, so there is no figure here. Your renewals were read fine, but half of what you have taken is not a total and will not be shown as one.'
                      : 'Your subscription renewals could not be read, so there is no figure here. Your one-off sales were read fine, but half of what you have taken is not a total and will not be shown as one.'}
                </Flag>
              ) : earnedStatus === 'partial' ? (
                <PartialRead what="payments" shown={buys.length + pays.length} onPress={load} />
              ) : takenAll && takenMonth && oneOffAll && renewAll && oneOffMonth && renewMonth ? (<>
                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <Pots label="This month" pots={takenMonth.pots} />
                  <Pots label="All time" pots={takenAll.pots} />
                </View>

                {/* What the total is made of. A membership business lives on the
                    second line of this, and it cannot be read off the combined
                    figure — two coaches with the same month's takings, one of
                    them all one-off and one of them all recurring, are in
                    completely different positions next month. */}
                <View style={{ marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 2 }}>This month, made up of</Text>
                  <Made label="One-off sales and packs" taken={oneOffMonth} />
                  <Made label="Subscription renewals" taken={renewMonth} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, marginBottom: 2 }}>All time, made up of</Text>
                  <Made label="One-off sales and packs" taken={oneOffAll} />
                  <Made label="Subscription renewals" taken={renewAll} />
                </View>

                {/* An amount we cannot put a unit on is missing from the totals
                    above, and saying so is the only thing that keeps them
                    honest. `client_purchases` only records a currency from part
                    132 onward; older sales were backfilled from the package they
                    came from, and one already deleted by then left the amount
                    unlabelled for good. */}
                {takenAll.unlabelled || takenAll.unpriced ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.warn}>
                      {takenAll.unlabelled
                        ? `${takenAll.unlabelled === 1 ? 'One payment is' : takenAll.unlabelled + ' payments are'} not in the figures above: the package ${takenAll.unlabelled === 1 ? 'it was' : 'they were'} bought from is gone, and the currency was only ever recorded there. Stripe still has ${takenAll.unlabelled === 1 ? 'it' : 'them'}.`
                        : `${takenAll.unpriced === 1 ? 'One payment has' : takenAll.unpriced + ' payments have'} no amount recorded, so ${takenAll.unpriced === 1 ? 'it is' : 'they are'} not in the figures above.`}
                    </Flag>
                  </View>
                ) : null}

                {/* A renewal Stripe gave no paid date for. It is real money and
                    it is in All time; it is in no month, because we cannot say
                    which one. Rare enough to be worth stating plainly when it
                    happens rather than quietly deciding for it. */}
                {undated ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.warn}>
                      {undated === 1
                        ? 'One renewal has no payment date from Stripe, so it counts in All time but in no month.'
                        : undated + ' renewals have no payment date from Stripe, so they count in All time but in no month.'}
                    </Flag>
                  </View>
                ) : null}

                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  Everything your clients have been charged through Repple — one-off packages,
                  session packs and subscription renewals — in the currency each was charged in, and
                  dated by when Stripe took the money.
                </Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  This is the GROSS. Stripe&apos;s processing fee and the platform fee come out of it
                  and Repple is told neither, so nothing here is a payout, a balance, or what has
                  landed in your bank. Your Stripe dashboard is the only place those exist.
                </Text>
              </>) : null}
            </Section>

            <Rule />

            {/* ── session packs sold, and what is left on them ───────────── */}
            <Section>
              {/* Counted only under 'ready'. Under 'partial' the packs shown
                  are real but there are more, and "2 clients have run out" off
                  part of the set is a smaller number than the truth — which is
                  the direction that makes it safe to ignore. */}
              <SectionHead title="Session Packs" note={buysWhole && packs.length ? String(packs.length) : undefined} />
              {buysStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We could not read what your clients have bought, so this is not a list of their
                  packs. Anyone holding credits still holds them.
                </Flag>
              ) : buysStatus === 'partial' ? (
                <PartialRead what="purchases" shown={buys.length} onPress={load} />
              ) : packs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Nobody has bought a session pack yet. Add one below with a number of sessions, and
                  the balance appears here as your clients use it.
                </Text>
              ) : runOut.length ? (
                <View style={{ marginBottom: sp.md }}>
                  <Flag tone={t.warn}>
                    {runOut.length === 1
                      ? 'One client has used every session they paid for. Their next session is not covered by a pack.'
                      : runOut.length + ' clients have used every session they paid for. Their next sessions are not covered by a pack.'}
                  </Flag>
                </View>
              ) : null}
              {(buysStatus === 'error' ? [] : packsShown).map((b, i) => {
                const left = packLeft(b);
                const out = packRunOut(b);
                return (
                  <View key={b.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                      {/* A name we could not read is a dash, never 'Client'. */}
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(b.client_name)}</Text>
                      {/* Dashed rather than dollared when the package it was
                          sold from is gone: that row held the only record of
                          what this amount is denominated in. */}
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(minorMoney(b.amount_cents, b.currency))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: out ? t.warn : t.brand }} />
                      {/* "Used up" rather than "0 of 10 left". Both are true;
                          only one of them reads as a thing to act on, and a
                          zero in a row of numbers is easy to scan past. `left`
                          is null only for a row that is not a pack, which
                          cannot reach this list — so the dash is a guard, not
                          an expected state. */}
                      <Text style={{ ...ty.caption, color: out ? t.warn : t.ink3, flex: 1 }}>
                        {out ? `Used up — all ${fig(b.sessions_total)} sessions` : `${fig(left)} of ${fig(b.sessions_total)} left`}
                        {b.package_name ? ' · ' + b.package_name : ''}
                        {' · '}{new Date(b.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Section>

            <Rule />

            {/* ── what clients can buy ───────────────────────────────────── */}
            <Section>
              <SectionHead title="Your Packages" note={(pkgs ?? []).filter((p) => p.active).length ? String((pkgs ?? []).filter((p) => p.active).length) : undefined} />
              {pkgErr ? (
                <Flag tone={t.crit}>
                  Your packages could not be read, so this is not a list of what you sell. Do not add
                  them again from here — reopen the screen once you have signal.
                </Flag>
              ) : (pkgs ?? []).filter((p) => p.active).length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No packages yet. Add one below — a monthly membership or a pack of sessions.</Text>
              ) : null}
              {(pkgs ?? []).filter((p) => p.active).map((p, i) => (
                <View key={p.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{billingWords(p)}</Text>
                  </View>
                  <Pressable onPress={() => remove(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + p.name} style={{ padding: 6 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── who is subscribed ──────────────────────────────────────── */}
            <Section>
              {/* The count is only printed under 'ready'. Under 'partial' the
                  rows are real but there are more of them, so a number beside
                  the title would be a total computed from part of the set —
                  and this particular total is somebody's recurring income. */}
              <SectionHead title="Subscribers" note={subsStatus === 'ready' && liveSubs.length ? String(liveSubs.length) : undefined} />
              {subsStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We could not read your subscribers, so this is not a list of who is paying you. It is
                  not a statement that nobody is — anyone subscribed still is.
                </Flag>
              ) : subsStatus === 'partial' ? (
                <PartialRead what="subscribers" shown={subs.length} onPress={load} />
              ) : liveSubs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Nobody is subscribed yet. Add a monthly or yearly package below and it appears on your
                  clients&apos; Memberships screen.
                </Text>
              ) : null}
              {(subsStatus === 'error' ? [] : liveSubs).map((s, i) => (
                <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                    {/* A name we could not read is a dash, never 'Client' —
                        the money beside it is real either way. */}
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(s.client_name)}</Text>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(pkgPriceLine(s.amount_cents, s.currency, s.billing_interval))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'past_due' ? t.crit : s.cancel_at_period_end ? t.warn : t.brand }} />
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {statusLabel(s.status)}
                      {s.current_period_end
                        ? ` · ${s.cancel_at_period_end ? 'ends' : 'renews'} ${new Date(s.current_period_end).toLocaleDateString()}`
                        : ''}
                    </Text>
                  </View>
                </View>
              ))}

              {/* What is running today, at what it is priced at — printed only
                  on a whole read, and never called income. Kept apart by
                  interval as well as by currency: a yearly package divided by
                  twelve is a monthly figure this app invented. And kept apart
                  from the takings at the top of the screen, which are money
                  that has already moved: this one is forward-looking, and a
                  charge nobody has made yet is not earnings. */}
              {recurring && recurring.pots.length ? (
                <View style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Priced to recur</Text>
                  {recurring.pots.map((p) => (
                    <Text key={p.currency + p.interval} style={{ ...value(20), color: t.ink, marginTop: 4 }}>
                      {fig(pkgPriceLine(p.minorUnits, p.currency, p.interval))}
                    </Text>
                  ))}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    What your live subscriptions are priced at — what they are set to charge next,
                    if nobody cancels and no card fails. It is not money you have been paid. What
                    you have actually been paid is in Taken Through Stripe at the top, renewals
                    included.
                  </Text>
                </View>
              ) : null}

              {/* Why there is no Cancel button beside these rows. The cancel and
                  resume actions in the connect-checkout function look the
                  subscription up by `client_id = auth.uid()`, so a coach
                  pressing one would get "subscription not found" every time,
                  and a control that always fails on somebody's recurring charge
                  is worse than no control. Said rather than offered. */}
              {liveSubs.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  Stopping a subscription is the client&apos;s to do, from their Memberships screen —
                  it cancels at the end of the period they have already paid for. You can also cancel
                  or refund from your Stripe dashboard.
                </Text>
              ) : null}
            </Section>

            <Rule />

            {/* ── add a package ──────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Add a Package" />
              <TextInput value={name} onChangeText={setName} placeholder="Name — e.g. 10-Session Pack" placeholderTextColor={t.ink3} style={input} />

              <View style={{ marginTop: sp.md }}>
                <Pick label="Billing" options={INTERVALS.map((i) => ({ key: i.key, label: i.label }))} chosen={interval}
                  onPick={(k: BillingInterval | null) => { setInterval(k); if (k) setSessions(''); }} />
              </View>

              {/* The gym's currency, stated rather than picked — and dashed
                  rather than guessed. Repple is white-labelled, so there is no
                  currency this screen could assume that is not simply wrong for
                  half the gyms running it. Null is a missing setting an owner
                  fixes, not a value to fill in here. */}
              {!currency ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>
                    {currencyErr
                      ? 'We could not read what your gym charges in, so a price here would have no unit. Nothing can go on sale until we can.'
                      : 'Your gym has not set a currency yet, so a price here would have no unit. An owner sets it in the gym settings, then packages can go on sale.'}
                  </Flag>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Price ({fig(currency)})</Text>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="500" placeholderTextColor={t.ink3} style={input} />
                </View>
                {/* Not offered at all on a recurring package. `sessions` is a
                    balance granted once and drawn down; nothing renews it, so
                    "10 sessions, monthly" would charge again in month two for
                    credits already spent in month one. Part 97 refuses the
                    combination outright. */}
                {interval ? null : (
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Sessions (blank = membership)</Text>
                    <TextInput value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="10" placeholderTextColor={t.ink3} style={input} />
                  </View>
                )}
              </View>

              {/* Read back exactly what will be charged, in the unit it will be
                  charged in — or nothing at all. A preview that says "AED" on a
                  gym that has not set a currency is the invention this whole
                  screen is avoiding. */}
              {interval ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {priceEcho
                    ? `Clients are charged ${priceEcho} every ${interval === 'month' ? 'month' : 'year'} until they cancel.`
                    : `Clients are charged every ${interval === 'month' ? 'month' : 'year'} until they cancel.`}
                </Text>
              ) : null}

              <View style={{ height: sp.lg }} />
              <Cta label={busy ? 'Saving…' : interval ? 'Add Subscription' : 'Add Package'} wide disabled={busy || !currency} onPress={addPkg} />
            </Section>

            <Rule />

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
              Payments are processed by Stripe. A platform fee applies to each sale. You never handle card details.
            </Text>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
