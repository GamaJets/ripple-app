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
// ── The seventh place, and why it is now on this screen ────────────────────
//
// The best-answered money question in this app was also the least reachable.
// src/lib/codeReturn.ts has known since part 98 what each join code cost, who
// came in on it, what those people then paid, how many of them stayed, and —
// the part nothing else in the app does — when the gap between two channels is
// too small to mean anything. enoughToTell() refuses to rank until an exact
// two-sided binomial test could distinguish the split from a coin toss, which
// for most coaches most of the time is a refusal.
//
// All of it lived inside the Add a Client sheet on the Clients screen: three
// taps from here, behind a button whose label is about adding somebody, on a
// modal a coach opens when they have a new client rather than when they are
// asking where their clients came from. A coach deciding next month's ad budget
// had no reason to go there and no way to know it was there.
//
// So the reading half of it is here, under Which Codes Worked, drawn from those
// same functions unchanged. The WRITING half — the field where a coach types
// what a code cost — deliberately stays on the Clients screen and is linked to
// rather than duplicated. app/(trainer)/ad-spend.tsx already declined to carry
// a second copy of that field for the reason that applies twice over here: two
// places to type the same number is how they come to disagree.
//
// One thing here is genuinely new, and it is a roll-up rather than a rewrite.
// codeReturn.ts answers per code; nothing answered over the SET. That sentence
// — what the whole of a coach's advertising cost against what the whole of it
// returned — is one subtraction, and it is the most dangerous figure on this
// screen, because every hole in either side moves it in the flattering
// direction and leaves nothing on screen where the missing thing would have
// been. src/lib/coachChannels.ts computes it and, far more often, withholds it:
// one code with no cost recorded is enough to refuse the whole comparison.
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
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import { minorMoney, wholeMoney, since, monthStart, type Taken, type TakenRow } from '../../src/lib/coachMoney';
import { takingsStrands } from '../../src/lib/coachRevenue';
import {
  ledger, sumMajor, sumSpend, denominate, ledgerEmptyLine,
  NO_NET_NOTE, STRIPE_AUTHORITY_NOTE, PERIOD_NOTE,
  type Strand,
} from '../../src/lib/coachLedger';
import { fetchClientPurchases, fetchMyConnect, type CoachPurchase, type ConnectStatus } from '../../src/lib/connect';
import { fetchMySubscriptionPayments, type SubscriptionPayment } from '../../src/lib/subscriptions';
import { fetchMySubscription, fetchFailedInvoices, money as platformMoney, type Subscription, type Invoice } from '../../src/lib/billing';
import { fetchMyCodeReturns, type CodeReturnsRead } from '../../src/ui/joinCode';
import {
  LAST_TOUCH_NOTE, codeFigures, enoughToTell, returnLine, stayedLine,
} from '../../src/lib/codeReturn';
import {
  againstLine, channelEmptyLine, channelReachLine, channelSum, spendAgainstReturn,
} from '../../src/lib/coachChannels';
import { useLateCancelCharges } from '../../src/ui/sessions';
import { fetchMyInvoices } from '../../src/ui/coachInvoices';
import { fetchMyReceipts } from '../../src/ui/coachReceipts';
import { fetchMyPayouts } from '../../src/ui/coachPayouts';
import {
  payoutSummary, payoutStateLabel, payoutFailureLine, payoutsEmptyLine,
  PAYOUT_IS_NOT_A_SALE, PAYOUT_STRIPE_IS_THE_RECORD, type CoachPayout,
} from '../../src/lib/coachPayouts';
import { receiptsTaken, receiptsEmptyLine, RECEIPT_MAY_DOUBLE_COUNT, type CoachReceipt } from '../../src/lib/coachReceipts';
import { fetchMyCosts } from '../../src/ui/coachCosts';
import { costsTaken, costsEmptyLine, COSTS_ARE_NEVER_NETTED, type CoachCost } from '../../src/lib/coachCosts';
import {
  clientValue, rankByValue, currenciesIn, unattributedReceipts, unattributedLine,
  valueSpanLine, valueEmptyLine, VALUE_IS_PAST, VALUE_NEEDS_YOUR_RECORDS,
  type RankedClient,
} from '../../src/lib/clientValue';
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
  // The third strand of Coming In, and for most coaches the biggest one. Its
  // own state and its own status: it fails independently of Stripe's two
  // tables, and a screen that shared one status would hide a working half
  // behind a broken one.
  const [receipts, setReceipts] = useState<{ rows: CoachReceipt[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  // What Stripe says actually reached the bank. Deliberately NOT a strand of
  // the Coming In ledger: a payout is a balance, not a sale, and adding it to
  // the charges it partly consists of would count the same money twice. It is
  // its own section and the two are never subtracted from each other.
  const [payouts, setPayouts] = useState<{ rows: CoachPayout[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  // What the coach's own business costs them (part 450). Its own state and its
  // own status, and it is NEVER a strand of anything on the Coming In side:
  // nothing on this screen subtracts what goes out from what came in, and
  // `COSTS_ARE_NEVER_NETTED` says so where the figure is drawn.
  const [costs, setCosts] = useState<{ rows: CoachCost[]; status: LoadStatus }>({ rows: [], status: 'loading' });

  const fees = useLateCancelCharges();

  const load = useCallback(async () => {
    const [p, r, sub, inv, cr, ca, docs, rec, pay, cost] = await Promise.all([
      fetchClientPurchases(),
      fetchMySubscriptionPayments(),
      fetchMySubscription(),
      fetchFailedInvoices(),
      fetchMyCodeReturns(),
      fetchMyConnect(),
      fetchMyInvoices(),
      fetchMyReceipts(),
      fetchMyPayouts(),
      fetchMyCosts(),
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
    setReceipts(rec);
    setPayouts(pay);
    setCosts(cost);
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
  // Dated by the day the coach says the money ARRIVED, never by the day they
  // wrote the row down. A coach catching up on three weeks of cash on a Sunday
  // evening would otherwise have all of it land in that Sunday's month, which
  // is the one thing that would make this figure worse than not having it.
  const receiptRows = useMemo<TakenRow[]>(
    () => receipts.rows.map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: r.receivedOn })),
    [receipts.rows],
  );

  /* ── what each client has paid, all time ──────────────────────────────
   *
   * The three reads are already on this screen with their own statuses, which
   * is why this section lives here rather than on a fourth screen doing the
   * same three queries again.
   *
   * `valueReads` is passed as a SET to `clientValue`, never composed here:
   * a caller that took two of the three would produce a figure that looks
   * trustworthy while the cash half is unread, and for most coaches the cash
   * half is the bigger one. */
  const valueReads = useMemo(
    () => ({ purchases: sales.status, renewals: renewals.status, receipts: receipts.status }),
    [sales.status, renewals.status, receipts.status],
  );

  /** Every client id that appears in any of the three sources, once each. */
  const ranked = useMemo<RankedClient[]>(() => {
    const ids = new Set<string>();
    sales.rows.forEach((r) => { if (r.client_id) ids.add(r.client_id); });
    renewals.rows.forEach((r) => { if (r.client_id) ids.add(r.client_id); });
    receipts.rows.forEach((r) => { if (r.clientId) ids.add(r.clientId); });
    // The name comes from whichever source holds one. `client_purchases` joins
    // `profiles` for it; a receipt carries the name the coach TYPED, which is a
    // snapshot and is deliberately not a join — see part 138 on `bill_to`. A
    // renewal carries neither, so a client known only from renewals shows as a
    // dash and the money beside them is still real.
    const nameOf = (id: string): string | null =>
      sales.rows.find((r) => r.client_id === id)?.client_name
      ?? receipts.rows.find((r) => r.clientId === id)?.paidBy
      ?? null;
    const rows: RankedClient[] = [...ids].map((id) => ({
      clientId: id,
      name: nameOf(id),
      value: clientValue(id, sales.rows, renewals.rows, receipts.rows, valueReads),
    }));
    const cur = currenciesIn(rows)[0];
    return cur ? rankByValue(rows, cur) : rows;
  }, [sales.rows, renewals.rows, receipts.rows, valueReads]);

  const valueCurrencies = useMemo(() => currenciesIn(ranked), [ranked]);
  const orphanLine = useMemo(
    () => unattributedLine(unattributedReceipts(receipts.rows).count),
    [receipts.rows],
  );

  // Three strands rather than three figures, because they are one question:
  // what came in. `ledger()` withholds the whole total the moment any strand is
  // not whole, which is exactly right here — a coach's takings with the cash
  // half missing is not a smaller number, it is a wrong one, and for most
  // coaches it is the larger half that would be missing.
  //
  // The composition itself lives in src/lib/coachRevenue.ts. It was written out
  // here, and then app/(trainer)/analytics.tsx needed the same three strands to
  // state what a remote coach actually earns — at which point two screens would
  // have been stating a coach's takings from two copies of one rule, which is
  // how this codebase keeps finding it has two money rules. One function, both
  // callers, same labels, so `Ledger.reason` reads identically on both screens.
  const strandsFor = (rows: { sale: TakenRow[]; renewal: TakenRow[]; receipt: TakenRow[] }): Strand[] =>
    takingsStrands(
      { sales: sales.status, renewals: renewals.status, receipts: receipts.status },
      rows,
    );

  const monthIn = useMemo(
    () => ledger(strandsFor({ sale: since(saleRows, from), renewal: since(renewalRows, from), receipt: since(receiptRows, from) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saleRows, renewalRows, receiptRows, from, sales.status, renewals.status, receipts.status],
  );
  const allIn = useMemo(
    () => ledger(strandsFor({ sale: saleRows, renewal: renewalRows, receipt: receiptRows })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saleRows, renewalRows, receiptRows, sales.status, renewals.status, receipts.status],
  );

  const recordedByHand = useMemo(() => receiptsTaken(receipts.rows), [receipts.rows]);
  const landed = useMemo(() => payoutSummary(payouts.rows, payouts.status), [payouts.rows, payouts.status]);

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

  // What the coach recorded their own business costing them. Through
  // `costsTaken`, which is `sumTaken` under the same two rules everything else
  // on this screen obeys — currencies never merge, and an amount with no unit
  // is counted rather than dropped. Dated by the day the coach says the money
  // went out, never by the day the row was written.
  const costTaken = useMemo(() => costsTaken(costs.rows), [costs.rows]);

  /* ── which channels worked, which is a different question ──────────────── */

  // Two facts about the same rows, and they are not interchangeable. `spend`
  // above is EVERY code's recorded cost, default bucket included, because that
  // is money that left the coach's account and belongs under Going Out however
  // it was spent. `channels` below is named codes only — the default bucket is
  // not a channel, it has no spend to set its revenue against, and including it
  // would flatter every comparison. src/lib/coachChannels.ts holds the
  // reasoning; enoughToTell() has made the same exclusion since part 98.
  const channels = useMemo(() => channelSum(codes.rows), [codes.rows]);
  const against = useMemo(() => spendAgainstReturn(codes.status, channels), [codes.status, channels]);
  const codeTell = useMemo(() => enoughToTell(codes.status, codes.rows), [codes.status, codes.rows]);
  const namedCodes = useMemo(() => codes.rows.filter((r) => !r.isDefault), [codes.rows]);

  // The coach's session rate is the one figure in this app with no currency
  // column anywhere behind it — `trainers.session_fee` is a bare numeric — so
  // it is not shown here at all. `denominate` is used where a currency exists
  // to be read: the late-cancellation fees carry their own, and a set of them
  // that states nothing is the common case rather than a broken one.
  const feeDenom = denominate(feeSum.pots[0]?.currency ?? null, fees.status);

  const G = layout.gutter;

  /** One of the four figures under a code. Its label rides `ty.micro`, so it
   *  reads as a caption above the value rather than competing with it. */
  const codeFig = (label: string, value: string) => (
    <View key={label} style={{ flex: 1 }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.label, ...numeric, color: t.ink, marginTop: 1 }}>{value}</Text>
    </View>
  );

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

        {/* ── THE HALF STRIPE NEVER SAW ──────────────────────────────────
            For most self-employed coaches this is the bigger half. It is drawn
            as its own section as well as being inside the two ledgers above,
            because a coach reading a total needs to see how much of it is their
            own word rather than Stripe's — the two are different KINDS of fact
            and this screen's whole design is about not blurring those. */}
        <Section>
          <SectionHead title="Recorded by You" note="Cash, transfers and anything taken at a gym" />
          {receipts.status === 'partial' ? (
            <PartialRead what="recorded payments" shown={receipts.rows.length} onPress={load} />
          ) : null}
          {receipts.status !== 'ready' ? (
            <Flag>{receiptsEmptyLine(receipts.status)}</Flag>
          ) : recordedByHand.pots.length ? (
            <View>
              {recordedByHand.pots.map((p) => potRow(
                p.currency,
                `${p.count} ${plural(p.count, 'payment', 'payments')} in ${p.currency}`,
                minorMoney(p.minorUnits, p.currency),
              ))}
              {recordedByHand.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>{receiptsEmptyLine(receipts.status)}</Text>
          )}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{RECEIPT_MAY_DOUBLE_COUNT}</Text>
          <ListRow icon="grid" title="Cash and Transfers"
            note="Record a payment that did not go through this app"
            onPress={() => router.push('/(trainer)/receipts')} />
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

        {/* ── WHAT THE BUSINESS COSTS ────────────────────────────────────
            Rent or a chair fee, insurance, CPD, equipment, kit, travel, an
            accountant. Part 450, and until it existed the outgoing half of
            this screen was the Repple plan and ad spend and nothing else —
            which for a self-employed coach leaves out the largest single line
            of their year and makes the Statement of Record one-sided.

            NOTHING HERE IS SUBTRACTED FROM ANYTHING. There is no profit figure
            on this screen and there must never be one: the takings above are
            gross of Stripe's fee and the platform's, both sides are only as
            complete as what the coach wrote down, and the two can be in
            currencies this app holds no rate between. `NO_NET_NOTE` has been
            the rule since before this table existed and this is the feature
            that makes breaking it possible for the first time. */}
        <Section>
          <SectionHead title="What Your Business Costs" note="What you have recorded going out" />
          {costs.status === 'error' ? (
            <Flag>{costsEmptyLine('error')}</Flag>
          ) : costs.status === 'partial' ? (
            <PartialRead what="recorded costs" shown={costs.rows.length} onPress={load} />
          ) : costTaken.pots.length ? (
            <View>
              {costTaken.pots.map((p) => potRow(
                p.currency,
                `${p.count} ${plural(p.count, 'cost', 'costs')} in ${p.currency}`,
                minorMoney(p.minorUnits, p.currency),
              ))}
              {costTaken.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>{costsEmptyLine(costs.status)}</Text>
          )}
          {costTaken.unlabelled > 0 || costTaken.unpriced > 0 ? (
            <Flag style={{ marginTop: sp.sm }}>
              {costTaken.unlabelled + costTaken.unpriced} recorded {plural(costTaken.unlabelled + costTaken.unpriced, 'cost has', 'costs have')} an amount this app cannot put a currency on, so {plural(costTaken.unlabelled + costTaken.unpriced, 'it is', 'they are')} in no figure above.
            </Flag>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COSTS_ARE_NEVER_NETTED}</Text>
          <ListRow icon="grid" title="What It Costs You"
            note="Rent, insurance, courses, equipment, kit, travel, your accountant"
            onPress={() => router.push('/(trainer)/costs')} />
        </Section>

        <Rule />

        {/* ── WHAT EACH CLIENT HAS PAID ──────────────────────────────────
            The one figure this app could not produce. Three lists existed —
            sales, renewals, cash — on three screens, and no per-person total
            anywhere, so the decision a coach makes when somebody goes quiet or
            asks for a discount was made without the number that would change
            it.

            It is a SUM OF ROWS THAT ALREADY EXIST. Not a projection, not a
            model, not "lifetime value" in the sense anybody else uses the
            phrase — every figure is money already charged or already handed
            over, and `VALUE_IS_PAST` says so on the screen because a coach who
            reads it as a forecast will act on it as one.

            The cash half is not optional. A total from Stripe alone is wrong
            for most coaches and wrong in the direction that makes them
            undervalue the person in front of them, so a receipts read that did
            not come back whole withholds the total exactly as a failed sales
            read does. src/lib/clientValue.ts carries the argument. */}
        <Section>
          <SectionHead title="What Each Client Has Paid" note="All time" />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{VALUE_IS_PAST}</Text>

          {ranked.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {valueEmptyLine(clientValue('', [], [], [], valueReads))}
            </Text>
          ) : (<>
            {/* Ranked within ONE currency. Sorting a mixed book by "amount"
                would put AED 5,000 above GBP 900 because five thousand is more
                than nine hundred, and the order would be a fact about exchange
                rates nobody supplied. A coach paid in two currencies gets the
                leading one ranked and is told the other exists. */}
            {ranked.map((r, i) => {
              const total = r.value.ledger.total;
              const pots = total?.pots ?? [];
              return (
                <View key={r.clientId} style={{
                  paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1, textTransform: 'capitalize' }} numberOfLines={1}>
                      {r.name ?? '—'}
                    </Text>
                    <Text style={{ ...ty.body, ...numeric, color: t.ink }}>
                      {pots.length
                        ? pots.map((pp) => minorMoney(pp.minorUnits, pp.currency)).filter(Boolean).join(' · ')
                        : '—'}
                    </Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {total ? (valueSpanLine(r.value, now) ?? '') : valueEmptyLine(r.value)}
                  </Text>
                  {/* An amount with no currency on it is a hole in the figure
                      and the size of the hole is what is worth reporting. It is
                      never summed into a unit nobody stated. */}
                  {total && (total.unlabelled > 0 || total.unpriced > 0) ? (
                    <Flag style={{ marginTop: sp.sm }}>
                      {total.unlabelled > 0 ? `${total.unlabelled} ${plural(total.unlabelled, 'payment has', 'payments have')} no currency recorded and ${plural(total.unlabelled, 'is', 'are')} in no figure above. ` : ''}
                      {total.unpriced > 0 ? `${total.unpriced} ${plural(total.unpriced, 'payment has', 'payments have')} no amount recorded at all.` : ''}
                    </Flag>
                  ) : null}
                </View>
              );
            })}
            {valueCurrencies.length > 1 ? (
              <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                You have been paid in {valueCurrencies.join(' and ')}. Those are separate amounts of money, they are never added together, and the order above is by {valueCurrencies[0]} alone.
              </Flag>
            ) : null}
          </>)}

          {/* Cash from somebody the coach bills by hand has a typed name and no
              Repple account, so it can be attached to nobody in the list above.
              Counted and reported rather than dropped: a per-client breakdown
              that silently omits most of the cash is the same defect this whole
              section exists to close, one level down. */}
          {orphanLine ? <Flag style={{ marginTop: sp.md }}>{orphanLine}</Flag> : null}

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{VALUE_NEEDS_YOUR_RECORDS}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{RECEIPT_MAY_DOUBLE_COUNT}</Text>
        </Section>

        <Rule />

        {/* ── WHICH CHANNELS WORKED ──────────────────────────────────────── */}
        {/* The figures above say what the coach's advertising COST. They say
            nothing about whether any of it worked, and that is the question a
            coach opens a money screen holding.

            Every function drawn here already existed and is untouched:
            src/lib/codeReturn.ts has answered it per code since part 98 —
            what each cost, who came in on it, what they paid, and
            enoughToTell(), which declines to rank two channels until the split
            could be told from a coin toss. All of it was reachable only by
            opening the Add a Client sheet on the Clients screen, three taps
            from here and behind a button whose label is about adding somebody.
            Nothing about this section is new arithmetic except the roll-up in
            src/lib/coachChannels.ts, which is the one sentence that set could
            not produce: what the whole of it cost against what the whole of it
            returned, withheld the moment either side has a hole in it.

            It is read-only on purpose. The spend field per code stays on the
            Clients screen, beside the figures it feeds — app/(trainer)/ad-spend.tsx
            gives the reason and it applies twice over here: two places to type
            the same number is how they come to disagree. */}
        <Section>
          <SectionHead title="Which Codes Worked" note="Named codes only" />

          {/* First, before any figure. Every number below is last touch, and a
              coach about to move a budget on them is owed that sentence before
              they read them rather than under them. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{LAST_TOUCH_NOTE}</Text>

          {codes.status === 'error' ? (
            <Flag>{codes.reason ?? channelEmptyLine('error')}</Flag>
          ) : codes.status === 'partial' ? (
            <PartialRead what="join codes" shown={codes.rows.length} onPress={load} />
          ) : !namedCodes.length ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{channelEmptyLine(codes.status)}</Text>
          ) : (
            <View>
              {/* The verdict, and it is a refusal far more often than it is a
                  ranking. A coach with twelve clients told "Instagram is your
                  best channel" off a four-versus-one split has been handed a
                  coin toss dressed as a finding, and they spend real money on
                  it. enoughToTell() is what declines to say it. */}
              {codeTell.rankable ? (
                <Notice tone={t.good} kicker="Enough to tell"
                  title={`${codeTell.best.label} is ahead of ${codeTell.runnerUp.label}`}
                  note={codeTell.note} />
              ) : (
                <Notice tone={t.s3} kicker="Not enough yet"
                  title="Too early to say which is working" note={codeTell.note} />
              )}

              {/* The whole of it against the whole of it, or the reason there
                  is no such figure. `against` refuses on an unrecorded cost
                  before anything else, because that is the hole that makes a
                  coach's advertising look cheaper than it was — the direction
                  that loses them money. */}
              <Text style={{ ...ty.label, color: against.statable ? t.ink2 : t.ink3, marginBottom: sp.sm }}>
                {againstLine(against)}
              </Text>
              {channelReachLine(codes.status, channels) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                  {channelReachLine(codes.status, channels)}
                </Text>
              ) : null}
              {channels.unnamed > 0 ? (
                <Flag tone={t.ink3} style={{ marginBottom: sp.md }}>
                  Your main code is left out of everything in this section. It is not a channel — it collects everybody no named code claims, including codes you have since replaced — so setting what it earned against what it cost would compare real money with nothing.
                </Flag>
              ) : null}

              {namedCodes.map((c) => {
                const fgs = codeFigures(codes.status, c);
                const line = returnLine(codes.status, c);
                return (
                  <View key={c.id ?? c.code} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: c.isLive ? t.ink : t.ink3 }}>{c.label}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{stayedLine(codes.status, c)}</Text>
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                      {codeFig('Spent', fgs.spent)}
                      {codeFig('Clients', fgs.clients)}
                      {codeFig('They paid', fgs.revenue)}
                      {codeFig('Each cost', fgs.perClient)}
                    </View>
                    {line ? (
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>{line}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {/* Both ways out, because the two halves of a missing figure are
              fixed in two different places. A cost nobody has typed is typed on
              the Clients screen; a cost that should have arrived on its own is
              an ad account that is not connected. */}
          <ListRow icon="people" title="Clients"
            note="Where you make a code, and where you record what it cost you"
            onPress={() => router.push('/(trainer)/dashboard')} />
        </Section>

        <Rule />

        {/* ── WHERE IT LANDS ─────────────────────────────────────────────── */}

        {/* ── WHAT ACTUALLY LANDED ───────────────────────────────────────
            The figure a coach argues with. Every number above this is GROSS —
            what a client was charged — and the gap between "AED 4,800 taken"
            and "AED 4,281 in my account" is the gap a coach fills with a
            suspicion about the platform. Part 194 mirrors Stripe's payout
            events so the question has an answer.

            It is its own section and it is NEVER subtracted from anything
            above. A payout is a BALANCE reaching a bank — many charges at once,
            less what Stripe and Repple took and anything refunded, on Stripe's
            own schedule — so "taken minus landed equals fees" is wrong on all
            three numbers. `PAYOUT_IS_NOT_A_SALE` is that sentence on the page,
            and this is the same discipline `NO_NET_NOTE` keeps at the top. */}
        <Section>
          <SectionHead title="What Landed in Your Bank" note="Mirrored from Stripe as each payout happens" />
          {payouts.status === 'partial' ? (
            <PartialRead what="payouts" shown={payouts.rows.length} onPress={load} />
          ) : null}
          {landed.withheld ? (
            <Flag>{landed.withheld}</Flag>
          ) : landed.arrived && landed.arrived.pots.length ? (
            <View>
              {landed.arrived.pots.map((p) => potRow(
                p.currency,
                `${p.count} ${plural(p.count, 'payout', 'payouts')} in ${p.currency}`,
                minorMoney(p.minorUnits, p.currency),
              ))}
              {landed.arrived.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>{payoutsEmptyLine(payouts.status)}</Text>
          )}

          {/* A payout that bounced is a coach who is not being paid and does
              not know it. It is the one row on this screen that has to be acted
              on, so it is drawn above the ones that are merely on their way. */}
          {landed.failed ? (
            <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
              {landed.failed} {plural(landed.failed, 'payout did not reach your bank', 'payouts did not reach your bank')}. Until that is sorted out at Stripe, money stays in your Stripe balance instead of arriving.
            </Flag>
          ) : null}
          {payouts.rows.filter((p) => payoutFailureLine(p)).slice(0, 3).map((p) => (
            <Text key={p.id} style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{payoutFailureLine(p)}</Text>
          ))}
          {landed.onTheWay ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
              {landed.onTheWay} {plural(landed.onTheWay, 'payout is', 'payouts are')} on the way and {plural(landed.onTheWay, 'is', 'are')} in no figure above. Money in transit is not money in a bank account.
            </Flag>
          ) : null}
          {landed.unknown ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
              {landed.unknown} {plural(landed.unknown, 'payout carries a state', 'payouts carry a state')} this app does not recognise, so {plural(landed.unknown, 'it is', 'they are')} counted and not added to anything. Your Stripe dashboard says what happened to {plural(landed.unknown, 'it', 'them')}.
            </Flag>
          ) : null}

          {/* The three most recent, so the section is a record rather than a
              single figure. Stripe's own status word is resolved through
              `payoutStateLabel`, which answers "Not Stated" for anything it
              does not know rather than assuming the money arrived. */}
          {payouts.status === 'ready' && payouts.rows.length ? (
            <View style={{ marginTop: sp.md }}>
              {payouts.rows.slice(0, 3).map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }} numberOfLines={1}>
                    {payoutStateLabel(p.status)}{p.arrivalOn ? ` · ${p.arrivalOn}` : ''}
                  </Text>
                  <Text style={{ ...ty.label, ...numeric, color: t.ink2 }}>
                    {minorMoney(p.amountCents, p.currency) ?? 'not denominated'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{PAYOUT_IS_NOT_A_SALE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PAYOUT_STRIPE_IS_THE_RECORD}</Text>
        </Section>

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
            Cash, bank transfers and work paid for through a gym never reach Repple on their own. What you have recorded yourself is in the figures above and the rest is not, so they are a floor and only you know by how much. Nothing on this page is a projection or a forecast — it is what has been recorded, over the period each heading names.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
