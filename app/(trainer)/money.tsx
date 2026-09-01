// Coach · Money. The one place a coach sees what they earn and what they owe.
//
// ── What was scattered, and what this is ───────────────────────────────────
//
// Six screens hold a piece of a coach's money and none of them holds the
// question. Payments has the Stripe Connect account, the price list and the
// sales. Invoices has the documents the coach hands over. Billing has the
// coach's own Repple plan. Ad Spend has the Meta connection. The Schedule
// screen has the late-cancellation fees that were actually recorded. The
// Clients screen has the per-join-code spend field. Every one of those is
// reachable — that part of the roadmap sentence is out of date — but a coach
// who wants to know how the month went has to visit five of them and hold the
// answer in their head.
//
// This screen does not replace any of them and deliberately owns nothing. It
// reads, states, and hands off: every section ends in a row that opens the
// screen that can actually change something. Nothing here writes.
//
// ── TWO LEDGERS, AND NO NET FIGURE ────────────────────────────────────────
//
// "How am I doing" and "what is going out" are different questions and a net
// number answers neither. So the page has two halves that are never subtracted
// from each other, and `NO_NET_NOTE` says on the page that this was a decision
// rather than an omission. There is no function in src/lib/coachLedger.ts that
// computes a net, because the moment one exists somebody puts it in a hero.
//
// The two halves are also not the same KIND of fact, which is the better reason
// to keep them apart:
//
//   Coming in   is recorded money a client was charged through Stripe. Gross,
//               and incomplete — Repple never sees cash, a bank transfer, or
//               work paid for through a gym.
//   Going out   is the coach's own Repple bill and what they told us their ads
//               cost. The second is self-reported and the first is Stripe's.
//
// ── WHAT THIS SCREEN MAY NOT SAY ──────────────────────────────────────────
//
//   · A total over a partial read. Coming in is TWO tables read separately —
//     `client_purchases` and `client_subscription_payments` — and either can
//     fail or truncate. `ledger()` returns no total unless both were whole, and
//     names the half that is missing. A subtotal of somebody's income printed
//     as a month's takings is a plausible number with nothing about it to doubt.
//   · A confident zero over a failed read. Every money table in this database
//     is empty today, verified live, so the empty state is what every coach
//     sees — which makes getting it right the whole job rather than a detail.
//     `ledgerEmptyLine` says "nothing recorded" under a whole read and "the read
//     failed" under a broken one, and those are different sentences.
//   · An amount in a currency nobody chose. 35 of 54 live tenants have
//     `tenants.currency` NULL and part 150 removed the last database defaults,
//     so no currency set is the COMMON path. Amounts that carry their own
//     currency (a sale, a renewal, a recorded fee) print it; the ones that do
//     not are withheld with `denominate` saying which silence it is.
//   · A projection. Nothing here is annualised, averaged forward, or run to a
//     year end. What is printed is what is recorded, over a period that is
//     named.
//   · A payout. Stripe's processing fee, the platform's application fee and
//     whether the money has cleared are facts that live at Stripe and no webhook
//     in this repo has ever been told any of them. `STRIPE_AUTHORITY_NOTE` is on
//     the page for the same reason part 138 puts it on an invoice: the gap
//     between "taken" and "in my account" is exactly where a coach would
//     otherwise assume a number nobody computed.
//
// ── One unit trap, worth naming ───────────────────────────────────────────
//
// `charges.amount` is `numeric` in WHOLE units — a forty-dirham late fee is 40,
// not 4000 — while every other money column here is minor units. It goes
// through `sumMajor` and `wholeMoney`, never `minorMoney`, or a recorded fee
// prints as a hundredth of itself.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, Flag, ListRow, PartialRead } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import { minorMoney, wholeMoney, sumTaken, since, monthStart, type Taken, type TakenRow } from '../../src/lib/coachMoney';
import {
  ledger, sumMajor, sumSpend, denominate, ledgerEmptyLine,
  NO_NET_NOTE, STRIPE_AUTHORITY_NOTE, PERIOD_NOTE,
  type Strand,
} from '../../src/lib/coachLedger';
import { fetchClientPurchases, fetchMyConnect, type CoachPurchase, type ConnectStatus } from '../../src/lib/connect';
import { fetchMySubscriptionPayments, type SubscriptionPayment } from '../../src/lib/subscriptions';
import { fetchMySubscription, fetchFailedInvoices, money as platformMoney, type Subscription, type Invoice } from '../../src/lib/billing';
import { fetchMyCodeReturns, type CodeReturnsRead } from '../../src/ui/joinCode';
import { useLateCancelCharges } from '../../src/ui/sessions';
import { fetchMyInvoices } from '../../src/ui/coachInvoices';
import type { LoadStatus } from '../../src/ui/loadStatus';

/** The month a period figure covers, in the words a person uses for it. */
const monthName = (d: Date): string => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export default function CoachMoney() {
  const t = useTheme();
  const router = useRouter();

  // Each read holds its own status. They fail independently and a screen that
  // shared one would hide a working half behind a broken one.
  const [sales, setSales] = useState<{ rows: CoachPurchase[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  const [renewals, setRenewals] = useState<{ rows: SubscriptionPayment[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  const [plan, setPlan] = useState<{ sub: Subscription | null; error: string | null } | null>(null);
  const [dues, setDues] = useState<Invoice[] | null>(null);
  const [duesRead, setDuesRead] = useState<LoadStatus>('loading');
  const [codes, setCodes] = useState<CodeReturnsRead>({ status: 'loading', rows: [] });
  const [connect, setConnect] = useState<{ acct: ConnectStatus | null; read: LoadStatus }>({ acct: null, read: 'loading' });
  const [issued, setIssued] = useState<{ count: number; status: LoadStatus }>({ count: 0, status: 'loading' });

  const fees = useLateCancelCharges();

  const load = useCallback(async () => {
    const [p, r, sub, inv, cr, ca, docs] = await Promise.all([
      fetchClientPurchases(),
      fetchMySubscriptionPayments(),
      fetchMySubscription(),
      fetchFailedInvoices(),
      fetchMyCodeReturns(),
      fetchMyConnect(),
      fetchMyInvoices(),
    ]);
    setSales(p);
    setRenewals(r);
    setPlan(sub);
    setDues(inv);
    // fetchFailedInvoices answers null for a failed read and [] for nothing
    // outstanding. Collapsing those would tell a coach with an unpaid Repple
    // invoice that their account is clear, which is the one sentence that stops
    // them looking.
    setDuesRead(inv == null ? 'error' : 'ready');
    setCodes(cr);
    setConnect({ acct: ca, read: ca == null ? 'error' : 'ready' });
    setIssued({ count: docs.rows.length, status: docs.status });
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /* ── coming in ─────────────────────────────────────────────────────────── */

  const now = useMemo(() => new Date(), []);
  const from = monthStart(now);

  // A renewal is dated by Stripe's own `paid_at`, never by when the row landed
  // here: a webhook retried three days late would otherwise move somebody's
  // payment into the wrong month. A payment with no date passes a value that
  // will not parse, which keeps it out of every period rather than sweeping it
  // into the current one.
  const renewalRows = useMemo<TakenRow[]>(
    () => renewals.rows.map((r) => ({ amount_cents: r.amount_cents, currency: r.currency, created_at: r.paid_at ?? 'unknown' })),
    [renewals.rows],
  );
  const saleRows = useMemo<TakenRow[]>(
    () => sales.rows.map((r) => ({ amount_cents: r.amount_cents, currency: r.currency, created_at: r.created_at })),
    [sales.rows],
  );

  const strandsFor = (rows: { sale: TakenRow[]; renewal: TakenRow[] }): Strand[] => ([
    { key: 'sales', label: 'one-off sales', status: sales.status, taken: sumTaken(rows.sale) },
    { key: 'renewals', label: 'subscription renewals', status: renewals.status, taken: sumTaken(rows.renewal) },
  ]);

  const monthIn = useMemo(
    () => ledger(strandsFor({ sale: since(saleRows, from), renewal: since(renewalRows, from) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saleRows, renewalRows, from, sales.status, renewals.status],
  );
  const allIn = useMemo(
    () => ledger(strandsFor({ sale: saleRows, renewal: renewalRows })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saleRows, renewalRows, sales.status, renewals.status],
  );

  /* ── recorded against clients, and never collected by Repple ───────────── */

  // Waived fees are excluded from the figure and counted beside it. The row
  // stays either way: a forgiven fee is a fact about what happened, not an
  // absence, and a coach reconciling their own book needs to see that they
  // forgave it rather than find it silently gone.
  const standingFees = useMemo(() => fees.charges.filter((c) => !c.waivedAt), [fees.charges]);
  const waivedCount = fees.charges.length - standingFees.length;
  const feeSum = useMemo(() => sumMajor(standingFees), [standingFees]);

  /* ── going out ─────────────────────────────────────────────────────────── */

  const spend = useMemo(() => sumSpend(codes.rows), [codes.rows]);
  const owed = dues ?? [];

  // The coach's session rate is the one figure in this app with no currency
  // column anywhere behind it — `trainers.session_fee` is a bare numeric — so
  // it is not shown here at all. `denominate` is used where a currency exists
  // to be read: the late-cancellation fees carry their own, and a set of them
  // that states nothing is the common case rather than a broken one.
  const feeDenom = denominate(feeSum.pots[0]?.currency ?? null, fees.status);

  const G = layout.gutter;
  const potRow = (key: string, label: string, amount: string | null) => (
    <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 }}>
      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{label}</Text>
      <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{amount ?? 'not denominated'}</Text>
    </View>
  );

  /** One ledger drawn: its pots, or the reason there is no figure. */
  const drawIn = (l: ReturnType<typeof ledger>, side: 'in' | 'out') => {
    if (!l.total) return <Flag style={{ marginTop: sp.sm }}>{l.reason}</Flag>;
    const pots = l.total.pots;
    if (!pots.length) {
      return (
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          {ledgerEmptyLine(side, l.status)}
        </Text>
      );
    }
    return (
      <View style={{ marginTop: sp.sm }}>
        {pots.map((p) => potRow(
          p.currency,
          `${p.count} ${plural(p.count, 'payment', 'payments')} in ${p.currency}`,
          minorMoney(p.minorUnits, p.currency),
        ))}
        {pots.length > 1 ? (
          <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
            These are separate amounts of money and are deliberately not added together.
          </Flag>
        ) : null}
        {missingNote(l.total)}
      </View>
    );
  };

  /** The holes in a total, said out loud so a short figure is not read as the
   *  whole of it. */
  const missingNote = (tk: Taken) => (
    <>
      {tk.unlabelled > 0 ? (
        <Flag style={{ marginTop: sp.sm }}>
          {tk.unlabelled} {plural(tk.unlabelled, 'payment carries', 'payments carry')} an amount with no currency on it, so {plural(tk.unlabelled, 'it is', 'they are')} in no figure above. This happens to a sale whose package was deleted before the currency was recorded, and it cannot be recovered.
        </Flag>
      ) : null}
      {tk.unpriced > 0 ? (
        <Flag style={{ marginTop: sp.sm }}>
          {tk.unpriced} {plural(tk.unpriced, 'payment has', 'payments have')} no amount recorded at all, so {plural(tk.unpriced, 'it is', 'they are')} counted and not summed.
        </Flag>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What comes in, and what goes out</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Money</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice kicker="How to read this" title="Two ledgers, kept apart" note={NO_NET_NOTE} />
        </View>

        <Rule />

        {/* ── COMING IN ──────────────────────────────────────────────────── */}

        <Section>
          <SectionHead title="Coming In" note={`Charged to clients in ${monthName(now)}`} />
          {sales.status === 'partial' || renewals.status === 'partial' ? (
            <PartialRead what="payments" onPress={load} />
          ) : null}
          {drawIn(monthIn, 'in')}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{PERIOD_NOTE}</Text>
        </Section>

        <Section>
          <SectionHead title="All Recorded" note="Every payment Repple has a record of" />
          {drawIn(allIn, 'in')}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{STRIPE_AUTHORITY_NOTE}</Text>
        </Section>

        <Section>
          <ListRow icon="grid" title="Payments & Packages"
            note="Who bought what, who is subscribed, and the price list they buy from"
            onPress={() => router.push('/(trainer)/payments')} />
          <ListRow icon="grid" title="Invoices"
            note={issued.status === 'error'
              ? 'Your issued documents could not be counted just now'
              : issued.count > 0
                ? `${issued.count} issued — your own statement of a charge, never a payment receipt`
                : 'Issue a document for what somebody paid you, including cash and transfers'}
            onPress={() => router.push('/(trainer)/invoices')} />
        </Section>

        <Rule />

        {/* ── RECORDED, NOT COLLECTED ────────────────────────────────────── */}

        <Section>
          <SectionHead title="Recorded Against Clients" note="Late cancellations you settle yourself" />
          {fees.status === 'error' ? (
            <Flag>
              Your late-cancellation fees could not be read. This is not a statement that there are none — anything already recorded still stands against the client it was recorded against.
            </Flag>
          ) : fees.status === 'partial' ? (
            <PartialRead what="recorded fees" shown={fees.charges.length} onPress={fees.reload} />
          ) : !standingFees.length ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing has been recorded against a client. A fee is only recorded when your policy is switched on and somebody cancels inside your notice window.
            </Text>
          ) : (
            <View>
              {feeSum.pots.map((p) => potRow(
                p.currency,
                `${p.count} ${plural(p.count, 'fee', 'fees')} in ${p.currency}`,
                wholeMoney(p.units, p.currency),
              ))}
              {!feeSum.pots.length && feeDenom.ok === false ? (
                <Flag>{feeDenom.note}</Flag>
              ) : null}
              {feeSum.unlabelled > 0 ? (
                <Flag style={{ marginTop: sp.sm }}>
                  {feeSum.unlabelled} recorded {plural(feeSum.unlabelled, 'fee has', 'fees have')} no currency on the row, so {plural(feeSum.unlabelled, 'it is', 'they are')} in no figure above.
                </Flag>
              ) : null}
            </View>
          )}
          {waivedCount > 0 ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
              {waivedCount} {plural(waivedCount, 'fee has', 'fees have')} been waived and {plural(waivedCount, 'is', 'are')} left out of the figures above. The {plural(waivedCount, 'row remains', 'rows remain')} on record.
            </Flag>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Repple records these and never collects them. No card is charged and nothing arrives in your Stripe account — the client sees what they owe and who to settle it with.
          </Text>
          <ListRow icon="calendar" title="Schedule"
            note="Where a recorded fee is listed, and where you waive one"
            onPress={() => router.push('/(trainer)/calendar')} />
        </Section>

        <Rule />

        {/* ── GOING OUT ──────────────────────────────────────────────────── */}

        <Section>
          <SectionHead title="Going Out" note="What you pay, and what you have told us your ads cost" />
          {plan?.error ? (
            <Flag>
              Your own plan could not be read, so nothing here says what you are on. This is not a statement that you have no subscription.
            </Flag>
          ) : plan?.sub ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 }}>
              <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>Your Repple plan</Text>
              <Text style={{ ...ty.label, color: t.ink }}>
                {plan.sub.plan ?? 'unnamed'}{plan.sub.status ? ` · ${plan.sub.status}` : ''}
              </Text>
            </View>
          ) : plan ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              You are not on a paid Repple plan, so nothing is billed to you here.
            </Text>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Still reading.</Text>
          )}

          {duesRead === 'error' ? (
            <Flag style={{ marginTop: sp.sm }}>
              Whether anything is outstanding on your account could not be read. An empty space here is not a clear account.
            </Flag>
          ) : owed.length ? (
            <View style={{ marginTop: sp.sm }}>
              {/* The words carry the warning and the tone only marks it. A
                  figure inked in the critical colour reads at 3:1, which is a
                  mark's contrast and not a text's — and an amount somebody owes
                  is the last thing on this page that should be hard to read. */}
              <Flag tone={t.crit}>
                {owed.length} {plural(owed.length, 'invoice on your own account is', 'invoices on your own account are')} outstanding.
              </Flag>
              {owed.map((i) => (
                <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2, flex: 1 }} numberOfLines={1}>
                    Outstanding · {i.status ?? 'unknown'}
                  </Text>
                  <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{platformMoney(i.amount_due, i.currency)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <ListRow icon="chart" title="Billing & Subscription"
            note="Your own plan, payment method and Repple invoices"
            onPress={() => router.push('/(trainer)/billing')} />
        </Section>

        <Section>
          <SectionHead title="Ad Spend" note="What you recorded, per join code" />
          {codes.status === 'error' ? (
            <Flag>{codes.reason ?? 'What your codes cost could not be read, so nothing here is a figure.'}</Flag>
          ) : codes.status === 'partial' ? (
            <PartialRead what="join codes" shown={codes.rows.length} onPress={load} />
          ) : spend.pots.length ? (
            <View>
              {spend.pots.map((p) => potRow(
                p.currency,
                `${p.count} ${plural(p.count, 'code', 'codes')} in ${p.currency}`,
                minorMoney(p.minorUnits, p.currency),
              ))}
              {spend.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>{ledgerEmptyLine('out', codes.status)}</Text>
          )}
          {spend.unrecorded > 0 ? (
            <Flag style={{ marginTop: sp.sm }}>
              {spend.unrecorded} {plural(spend.unrecorded, 'code has', 'codes have')} no cost recorded. That is not a cost of nothing — until a figure is entered or synced, what {plural(spend.unrecorded, 'that code', 'those codes')} cost you is unknown and is in no total here.
            </Flag>
          ) : null}
          <ListRow icon="trending" title="Ad Spend"
            note="Connect an ad account, and see the spend that matched no code"
            onPress={() => router.push('/(trainer)/ad-spend')} />
        </Section>

        <Rule />

        {/* ── WHERE IT LANDS ─────────────────────────────────────────────── */}

        <Section>
          <SectionHead title="Where It Lands" />
          {connect.read === 'error' ? (
            <Flag>
              Your payout account could not be read. This is not a statement that you have none — if you had set one up it is still set up.
            </Flag>
          ) : connect.acct?.charges_enabled ? (
            <Text style={{ ...ty.label, color: t.ink2 }}>
              Your Stripe payout account is active, so a client can be charged. When each payment reaches your bank, and what Stripe took for it, are things only Stripe knows.
            </Text>
          ) : connect.acct?.stripe_account_id ? (
            <Text style={{ ...ty.label, color: t.ink2 }}>
              Your Stripe payout account is started but not finished, so nobody can be charged yet. Finish it on the Payments screen.
            </Text>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              You have no Stripe payout account, so nothing can be taken through Repple. Anything a client pays you in cash or by transfer never appears on this screen.
            </Text>
          )}
        </Section>

        <Section>
          <SectionHead title="What Is Not Here" />
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Cash, bank transfers and work paid for through a gym are invisible to Repple, so the figures above are a floor and not the whole of what you earn. Nothing on this page is a projection or a forecast — it is what has been recorded, over the period each heading names.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
