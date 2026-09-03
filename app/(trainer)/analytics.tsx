// Trainer · Analytics — sessions delivered, clients, retention.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same AI digest — the ten
// stacked bordered cards became hairline-separated sections, revenue became the
// screen's one hero figure, and the Georgia serif header is gone.
//
// Also removed: a `months` array of hardcoded growth fractions (Feb 0.55 …
// Jul 1) that was dead but still shipping in the bundle.
//
// ── Every figure here waits for a whole read ───────────────────────────────
//
// This screen is nothing but sums, averages and rankings over two sets — the
// roster and the sessions — and it read neither set's status. A figure computed
// from part of a set is not a smaller figure, it is a wrong one, so each is
// gated on `isWhole`: 'ready' and nothing else. 'partial' is refused alongside
// 'error' deliberately, because a truncated read is the more dangerous of the
// two — it produces a plausible number rather than an obviously empty screen,
// and there is nothing on a plausible number for a coach to doubt.
//
// Two of these are more than a wrong sentence. The roster-health bar always
// fills its width, so a split over a fragment of the book is drawn as the whole
// of it; it is withheld rather than drawn short. And the revenue trend WRITES:
// `useMonthlyHistory` stores this month's figure, so one bad month recorded
// from a truncated read stays in the chart forever, indistinguishable from a
// month that really was that quiet.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
// The month window's instant, recomputed at midnight, on foreground and on
// focus — never frozen at mount. See src/ui/today.ts.
import { useNow } from '../../src/ui/today';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Spark, fig, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { STATUS_LABEL } from '../../src/lib/status';
import { useRoster } from '../../src/ui/roster';
import { type RosterClient } from '../../src/lib/trainerMock';
import { DistBar } from '../../src/ui/charts';
import { askAboutMyBusiness } from '../../src/lib/coach';
import { useCoachingSpans } from '../../src/ui/coachCohorts';
import {
  yearOnYear, yearOnYearLine, cohorts, cohortsBlocker,
  MILESTONES, COHORT_CAVEAT, COHORT_FLOOR_NOTE,
} from '../../src/lib/coachCohorts';
import {
  buildAnalyticsExport, analyticsExportBlocker, analyticsShareNote,
  monthLabel as monthLabelOf, type AnalyticsReads,
} from '../../src/lib/analyticsExport';
import { shareTextFile, fileShareBlocker } from '../../src/lib/exportShare';
import { localDayKey, bandNote, DRIFT_LABEL } from '../../src/lib/clientDrift';
import { useClientDrift } from '../../src/ui/clientDrift';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';
import { useTrainerGoals, goalPct } from '../../src/ui/trainerGoals';
import { goalsEmptyLine, goalSaveLine, parseGoal, goalText } from '../../src/lib/coachPrefs';
import { useMonthlyHistory, YEAR_WINDOW } from '../../src/ui/useMrrHistory';
import { useSessions } from '../../src/ui/sessions';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import { myCurrencyLine, type MyCurrency, type MyCurrencyGap } from '../../src/lib/currencySource';
import { currencyForModel } from '../../src/lib/currencyForModel';
import { deltaSign } from '../../src/lib/deltaLabel';
import { wholeMoney, minorMoney, since, type TakenRow } from '../../src/lib/coachMoney';
import { monthWindow } from '../../src/lib/monthlyHistory';
import {
  monthToDate, sessionMonth, sessionMonthFor, deliveredValue, unmarkedValue,
  unmarkedLine, sessionsUnknownLine, takingsStrands,
  DELIVERED_IS_MARKED, TAKINGS_IS_GROSS, TWO_FIGURES_NEVER_SUM,
} from '../../src/lib/coachRevenue';
import { ledger } from '../../src/lib/coachLedger';
import { useDeliveryFact } from '../../src/ui/coachDelivery';
import { deliveryNote, showsInPerson, HIDDEN_NOT_GONE } from '../../src/lib/coachDelivery';
import { fetchClientPurchases, type CoachPurchase } from '../../src/lib/connect';
import { fetchMySubscriptionPayments, type SubscriptionPayment } from '../../src/lib/subscriptions';
import { fetchMyReceipts } from '../../src/ui/coachReceipts';
import type { CoachReceipt } from '../../src/lib/coachReceipts';
import { END_ALIGN } from '../../src/ui/direction';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

export default function TrainerAnalytics() {
  const t = useTheme();
  const router = useRouter();
  // This screen is nothing but figures over two sets, and it read neither set's
  // status. Every number below — the session count, the revenue, the average
  // adherence, the on-track/watch/at-risk split, the value per client, the
  // trend point written to storage — is a sum, an average or a ranking, and a
  // sum over part of a set is not a smaller sum, it is a wrong one. A coach
  // with fourteen clients whose roster read was refused was shown 0 clients, 0%
  // adherence and "$0 at risk", every one of them stated as a measurement.
  //
  // So the figures are gated on the read being WHOLE — `isWhole`, which is
  // 'ready' and nothing else. 'partial' is refused alongside 'error' here on
  // purpose: a truncated read is the more dangerous of the two, because it
  // produces a plausible number rather than an obviously empty screen.
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  const { sessionFee } = useMyTrainerProfile();
  const { sessions, status: sessionsStatus, refresh: refreshSessions } = useSessions();
  const rosterWhole = isWhole(rosterStatus);
  const sessionsWhole = isWhole(sessionsStatus);
  // Anything that crosses the two — revenue per client, revenue at risk, the
  // digest — is only as sound as the worse of them.
  const figureStatus = worstStatus(rosterStatus, sessionsStatus);
  const figuresWhole = isWhole(figureStatus);
  /* ── who is drifting, on the app's ONE definition of it ─────────────────
   *
   * This screen ranked and counted on `atRiskClient` from src/lib/trainerMock.ts
   * — `adherence < 80 || staleDays(lastActive) >= 2 || noRecordOf` — where
   * `staleDays` recovers a number by running a regex over a DISPLAY STRING.
   * `ago()` in src/ui/roster.tsx writes "3d ago" for a human to read and that
   * function parsed the 3 back out of it. Its own comment says
   * src/lib/clientDrift.ts "models this properly with a distinct UNKNOWN band
   * and is what the Clients screen ranks on — this function remains for the
   * screens that have not moved to it yet."
   *
   * So the Clients screen and this one answered "who needs a call" differently,
   * and a coach comparing the two was looking at two different books. This is
   * that screen moving. `useClientDrift` is the same read the dashboard makes,
   * lifted into src/ui/clientDrift.ts so there is one of it rather than three.
   *
   * NULL, not [], when it is not established — the roster read was short, the
   * training record has not landed, or it failed. Every consumer below treats
   * null as "we cannot say", because an empty list here renders as "everyone is
   * on track", which is the one sentence on this screen that stops a coach
   * looking.
   */
  const { tenant } = useTenant();
  // Bumped by the pull below. The drift read re-runs on its own when the
  // roster's ids change, and a refresh usually changes none of them — so
  // without this the coach could refresh every figure on the screen except the
  // one the at-risk card tells them to act on.
  const [driftNonce, setDriftNonce] = useState(0);
  const dr = useClientDrift(roster, tenant?.id ?? null, driftNonce);
  const atRisk: RosterClient[] | null =
    rosterWhole && dr.drift && !dr.error
      // 'at_risk' is a break in their own pattern; 'idle' is the UNKNOWN band —
      // nothing on record at all — and it is in here for the reason
      // clientDrift.ts gives: a client nobody has heard from is the client this
      // whole feature is about, and the old signal could not see them.
      ? roster.filter((c) => { const d = dr.driftFor(c.id); return d?.status === 'at_risk' || d?.status === 'idle'; })
      : null;
  const clients = rosterWhole ? roster.length : null;

  /* ── what actually happened this month ──────────────────────────────────
   *
   * THE BUG THIS REPLACES, exactly as it shipped:
   *
   *     sessions.filter(s => s.status === 'booked' && startsAt <= now).length
   *
   * which is the clock and not the record. A no-show is booked and in the past.
   * So is a session the coach never turned up to, and so is a slot nobody
   * cancelled. Every one of them was counted as delivered work here, priced at
   * the coach's rate, printed as the hero of the screen, fed into the at-risk
   * card and written into the AI digest — and src/lib/gymSessions.ts names that
   * exact inference in its own header as the thing part 33 was written to end.
   * It WAS ended, for the gym owner. This screen still had it.
   *
   * `sessionMonth` counts by `outcome` instead, in the vocabulary
   * src/lib/sessionHistory.ts already uses on four other screens, and keeps the
   * UNMARKED ones as their own state — folded into neither side, and stated
   * below rather than swept anywhere. See src/lib/coachRevenue.ts.
   *
   * `now` is fixed for the render. The window's upper bound is "now", and a
   * bound that moves on every re-render would recompute a month's figures
   * against a different instant each time. */
  /* `useNow`, not `useMemo(() => new Date(), [])`. The comment that stood here
     said `now` was fixed "for the render"; an empty dependency array fixes it
     for the life of the MOUNT, and this screen is a tab that stays mounted for
     as long as the app runs. Both bounds of the month window come from it, so a
     coach who opened this on the 31st and came back on the 1st read last
     month's figures under a heading saying this month — and a pull-to-refresh
     re-read the server against the same wrong dates, which made the stale
     figure look freshly confirmed. See src/ui/today.ts. */
  const now = useNow();
  const { from: monthFrom, to: monthTo } = useMemo(() => monthToDate(now), [now]);
  const month = useMemo(
    () => sessionMonth(sessions, sessionsStatus, monthFrom, monthTo),
    [sessions, sessionsStatus, monthFrom, monthTo],
  );
  // Null unless the sessions read was whole — `sessionMonth` enforces that
  // itself, so no caller can forget. A count of the sessions that came back is
  // not a count of the sessions delivered.
  const sessionsMo = month.delivered;
  // Sessions nobody has said anything about. Its own figure, never added to the
  // one above and never quietly dropped: an unmarked session is money that is
  // neither claimed nor denied, and the size of it is the reason to go and mark
  // them.
  const unmarkedMo = month.unmarked;
  // Still arithmetic, but now on sessions that were RECORDED as delivered and
  // on the trainer's own rate, and the note on screen says exactly that. The
  // $99 "platform fee" that used to be subtracted here is gone: nothing charges
  // it, and billing.tsx reports that billing is not switched on while this
  // screen called them a paying Pro customer.
  //
  // Null, not 0, when no rate is known. `sessionFee` used to be a number
  // starting at 0, so every figure derived from it was silently zero until the
  // profile loaded.
  const revenue = deliveredValue(month, sessionFee);
  /** What the unmarked ones would come to if every one had been delivered.
   *  Priced apart and never added — see the note on `unmarkedValue`. */
  const unmarkedWorth = unmarkedValue(month, sessionFee);
  // Null, not 0, with no clients: an average over nobody is undefined, and
  // "$0 / client" reads as a fact about a coaching business that has none.
  const valuePerClient = revenue != null && clients ? Math.round(revenue / clients) : null;
  // Average over clients who have actually checked in. Averaging a null-as-100
  // default meant a roster of strangers reported 100% adherence.
  const _adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  // Same rule. 0% adherence is a damning number to show a coach whose clients
  // have simply never checked in — and this screen opens by saying so. An
  // average over a roster that came back short is the same kind of lie one step
  // removed: it is a real average of a set nobody chose.
  const avgAdh = rosterWhole && _adhKnown.length ? Math.round(_adhKnown.reduce((a, x) => a + x, 0) / _adhKnown.length) : null;
  // Clients with no check-in are counted as unknown, not as on-track. Null when
  // the roster is not whole: these three are a distribution, and a distribution
  // over an unknown fraction of the book is drawn to full width and read as
  // everybody.
  const onTrack = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 85).length : null;
  const watch = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 70 && c.adherence < 85).length : null;
  const riskCount = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence < 70).length : null;
  // Sessions those clients actually took this month, at the trainer's rate —
  // not `at-risk count x rate x 4`, which invented a subscription nobody pays,
  // and no longer "booked and in the past", which counted the no-shows of the
  // very clients this card is about. A client who books and does not turn up is
  // exactly the client who ends up here, so the old figure was at its most
  // wrong precisely where it mattered most.
  //
  // `figureStatus` is handed in rather than the sessions status alone: both
  // sets have to be whole, the sessions being counted AND the roster that
  // decides which clients count. Short either one and this understates the
  // money at risk, which is the one direction that makes the card safe to
  // ignore.
  const _atRiskIds = useMemo(() => new Set((atRisk ?? []).map((c) => c.id)), [atRisk]);
  const atRiskMonth = useMemo(
    () => sessionMonthFor(sessions, _atRiskIds, figureStatus, monthFrom, monthTo),
    [sessions, _atRiskIds, figureStatus, monthFrom, monthTo],
  );
  // And null the whole way through when we do not know WHO is at risk. An empty
  // id set sums to zero, and "~0/mo at risk" is the same reassuring lie as
  // "everyone is on track" — computed here out of a training record that had
  // not come back rather than out of a book with nothing wrong in it.
  const atRiskRevenue = atRisk === null ? null : deliveredValue(atRiskMonth, sessionFee);
  // Every money figure on this screen is the coach's own session rate times a
  // count, and every one of them printed a dollar sign. Repple is
  // white-labelled and its live gyms are priced in AED, so the whole screen has
  // been quoting a coach in Dubai a number in a currency they do not take. The
  // unit is the gym's (`tenants.currency`, part 99) and there is no fallback:
  // with none set the amounts are withheld, because "$4,000" invented for a
  // London gym reads as a considered figure rather than as a missing setting.
  /**
   * What this coach is priced in — through the ONE resolver, not the gym half
   * of it.
   *
   * This screen called `myTenantCurrency()`, which answers about a GYM and
   * correctly returns null for a coach who has none. That was the whole answer
   * until part 940 gave a coach with no gym a currency of their own on
   * `trainers.currency`. It has been half-migrated ever since: a coach with no
   * gym could set a currency in Settings, price a package on the Payments
   * screen and take a payment through it — and then this screen would tell them
   * their gym had not set one and to go and ask an owner who does not exist.
   *
   * `fetchMyCurrency` applies the precedence rule written out in
   * src/lib/currencySource.ts: the gym on `profiles.tenant_id` is the
   * authority, and the coach's own column applies if and only if there is no
   * gym. `myTenantCurrency` was deliberately left alone rather than widened,
   * because widening it would have changed what its callers were told without
   * any of them saying so. This file was the last of the three its own comment
   * named as the debt, so once this moved it had no caller left and was
   * deleted — see the tombstone in src/lib/subscriptions.ts.
   *
   * Null while the first read is in flight, which is why `curGap` reads
   * 'reading' rather than any of the six real gaps until it lands.
   */
  const [cur, setCur] = useState<MyCurrency | null>(null);
  // Lifted out of the effect so the pull below asks for it again. A refused
  // read withholds every priced figure on this screen for the rest of the
  // session, and it was the one read here with no way back.
  const loadCurrency = useCallback(async () => { setCur(await fetchMyCurrency()); }, []);
  useEffect(() => { void loadCurrency(); }, [loadCurrency]);
  /** The code, or null. Named for the coach rather than the gym, because it is
   *  now either — and which one it was is in `cur.from`. */
  const myCur = cur?.currency ?? null;
  /**
   * Why there is no code to print, or null when there is one.
   *
   * Six causes, not four, and the extra two are the point: 'own-unset' is the
   * independent coach who has not chosen yet, which THEY fix in Settings, and
   * 'nowhere' is an account with no coach record for one to live on. Only
   * 'gym-unset' names an owner, and it is the one that used to be printed at
   * all of them.
   */
  const curGap = cur ? cur.gap : ('reading' as MyCurrencyGap);
  /** The sentence that goes where a priced figure would have gone. Takes the
   *  clause continuing "…, so ___", so each of the sites below says what IT
   *  loses rather than something general about amounts. */
  const noCur = (consequence: string) => myCurrencyLine(curGap ?? 'unreadable', consequence);
  /** A whole-unit figure in this coach's currency, or null — never a bare
   *  number and never a dollar. `fig()` renders the null as a dash. */
  const priced = (n: number | null | undefined) => wholeMoney(n, myCur);

  /* ── money that actually moved ──────────────────────────────────────────
   *
   * The second half of the fix, and the half that matters most to a coach with
   * no in-person clients: they sell no sessions, so "sessions × your rate" was
   * not an inflated figure for them, it was a figure about a business they do
   * not run. Their money is packages, subscription renewals and whatever was
   * handed over outside the app, and all three already existed —
   * app/(trainer)/money.tsx has read them for months.
   *
   * Nothing here is a second money rule. `takingsStrands` is the SAME strand
   * composition the Money screen uses, lifted into src/lib/coachRevenue.ts so
   * the two screens cannot drift, and `ledger()` is unchanged — which means the
   * currency rules come with it: two currencies never sum, an amount with no
   * currency is counted rather than dropped, and there is no default currency.
   *
   * Three separate statuses on purpose. They fail independently, and a shared
   * one would hide a working half behind a broken one. `ledger()` then
   * withholds the TOTAL the moment any of the three is short, because takings
   * with the cash half missing is not a smaller number, it is a different
   * number about a different business. */
  const [sales, setSales] = useState<{ rows: CoachPurchase[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  const [renewals, setRenewals] = useState<{ rows: SubscriptionPayment[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  const [receipts, setReceipts] = useState<{ rows: CoachReceipt[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  const loadTakings = useCallback(async () => {
    const [p, r, rec] = await Promise.all([
      fetchClientPurchases(), fetchMySubscriptionPayments(), fetchMyReceipts(),
    ]);
    setSales(p); setRenewals(r); setReceipts(rec);
  }, []);
  // On focus, not on mount: a coach who records a cash payment and comes
  // straight back here would otherwise be looking at the figure from before
  // they recorded it, which reads as the record not having saved.
  useFocusEffect(useCallback(() => { void loadTakings(); }, [loadTakings]));

  // Each dated by when the MONEY moved, never by when the row was written. A
  // webhook retried three days late, or a coach writing up three weeks of cash
  // on a Sunday, must not shift somebody's payment into the wrong month; a
  // payment with no date passes a value that will not parse, which keeps it out
  // of every period rather than sweeping it into this one.
  const takenRows = useMemo(() => ({
    sale: sales.rows.map((r): TakenRow => ({ amount_cents: r.amount_cents, currency: r.currency, created_at: r.created_at })),
    renewal: renewals.rows.map((r): TakenRow => ({ amount_cents: r.amount_cents, currency: r.currency, created_at: r.paid_at ?? 'unknown' })),
    receipt: receipts.rows.map((r): TakenRow => ({ amount_cents: r.amountCents, currency: r.currency, created_at: r.receivedOn })),
  }), [sales.rows, renewals.rows, receipts.rows]);
  const takingsReads = useMemo(
    () => ({ sales: sales.status, renewals: renewals.status, receipts: receipts.status }),
    [sales.status, renewals.status, receipts.status],
  );
  /** What was taken this calendar month, or withheld with the reason. */
  const takenMonth = useMemo(() => ledger(takingsStrands(takingsReads, {
    sale: since(takenRows.sale, monthFrom),
    renewal: since(takenRows.renewal, monthFrom),
    receipt: since(takenRows.receipt, monthFrom),
  })), [takingsReads, takenRows, monthFrom]);

  /* ── how this coach works ───────────────────────────────────────────────
   *
   * Their own declared answer, WIDENED by their roster and never narrowed by
   * it. It only reaches 'remote' when the coach said "online", the roster came
   * back WHOLE, and nobody on it trains in the room; every other combination —
   * including a roster read that failed, and a question nobody has answered —
   * resolves to showing everything. src/lib/coachDelivery.ts carries the rule
   * and coachDelivery.test.ts holds it down.
   *
   * On this screen it decides one thing: which figure leads. A coach who sells
   * packages should not open their analytics on a session count of nought. */
  const delivery = useDeliveryFact();
  const sessionsLead = showsInPerson(delivery);

  /* ── the takings figure, and the one thing it may not become ────────────
   *
   * A hero is ONE number, and a coach who took AED 6,000 and GBP 400 has not
   * taken 6,400 of anything. So a single figure is printed only where there is
   * exactly one currency in the month; with two the hero is a dash and both
   * pots are listed under it. src/lib/coachMoney.ts refuses the addition at the
   * source, which is why this is a presentation decision rather than a rule. */
  const takenPots = takenMonth.total?.pots ?? [];
  const takenOne = takenMonth.total != null && takenPots.length === 1
    ? minorMoney(takenPots[0].minorUnits, takenPots[0].currency)
    : null;
  /** Payments that are real and are missing from the figure: an amount with no
   *  currency on it, and an amount Stripe never stated. Counted rather than
   *  dropped — a short total nobody can see is worse than a stated hole. */
  const takenHoles = (takenMonth.total?.unlabelled ?? 0) + (takenMonth.total?.unpriced ?? 0);
  const takenNote = takenMonth.reason
    ? takenMonth.reason
    : takenPots.length === 0
      ? 'Nothing is recorded as taken this month. Packages, subscription renewals and the payments you record yourself all count here.'
      : takenPots.length > 1
        ? `Taken in ${takenPots.length} currencies this month, which are never added into one figure: ${takenPots.map((pt) => minorMoney(pt.minorUnits, pt.currency)).filter(Boolean).join(', ')}.`
        : TAKINGS_IS_GROSS;

  const { goals, setGoals, status: goalsStatus, reload: reloadGoals } = useTrainerGoals();
  const [goalOpen, setGoalOpen] = useState(false);
  const [gRev, setGRev] = useState('');
  const [gCli, setGCli] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);
  /**
   * Set the targets, and say if they did not leave the phone.
   *
   * This was `onPress={() => { setGoals({…}); setGoalOpen(false); }}` — a void
   * call and a sheet that closed. Two silent ways a target ends up on one
   * handset for good sat behind it: the account write is SKIPPED for the rest of
   * a session in which the prefs read failed (deliberately, so this phone's
   * cache cannot overwrite targets that may exist elsewhere), and the write
   * itself was un-awaited and unchecked. Either way the bar redrew against the
   * new number immediately, so nothing on the screen ever differed.
   *
   * A goal is the one figure here the coach authored rather than the app
   * computing, and it is the one most likely to be gone.
   */
  const saveGoals = async () => {
    if (goalBusy) return;
    setGoalBusy(true);
    const outcome = await setGoals({ revenue: parseGoal(gRev), clients: parseGoal(gCli) });
    setGoalBusy(false);
    setGoalOpen(false);
    const said = goalSaveLine(outcome);
    if (said) Alert.alert('Set on this phone', said);
  };
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  // The digest is prose a coach acts on, written from these numbers. With the
  // reads short or refused every input to it is null, and a paragraph composed
  // from nulls is not a cautious digest — it is a confident one about a
  // business that does not exist. The button is withheld instead, which is why
  // this guard is here as well as on the control.
  const genDigest = async () => {
    if (!figuresWhole) return;
    setDigestBusy(true); setDigest('');
    // The model is told the rate is unset rather than handed a number, because
    // a null arriving as 0 would come back as a paragraph about a coach who
    // earned nothing this month.
    // The rate was labelled `…Usd` and the prompt said "in US dollars", on a
    // product whose live gyms price in AED. The model was being told the wrong
    // currency and dutifully wrote it back to the coach in prose, where no
    // formatter could catch it. It is now told the gym's actual code — or told
    // there is none, and to leave the amount out rather than pick one.
    // Every figure the digest is written from now follows the hero, which is
    // the whole point of composing it here rather than letting the model infer
    // one. It used to be handed a session count that included no-shows, so the
    // paragraph a coach read on a Monday morning congratulated them on work
    // that had not happened — and prose is the one place no formatter and no
    // dash can catch it afterwards.
    //
    // The unmarked count goes in as its own field and is described as its own
    // state, because a model given only "delivered: 4" from a month with nine
    // unmarked sessions would write a sentence about a quiet month.
    //
    // Takings go in too, as a formatted STRING or as the reason there is none.
    // A remote coach's month is packages and renewals; a digest built only from
    // sessions would tell them their business did nothing.
    const ctx = {
      sessionsDeliveredThisMonth: sessionsMo,
      sessionsStillUnmarked: unmarkedMo,
      revenueAtOwnRate: revenue ?? 'unknown — no session rate set',
      takenThisMonth: takenOne ?? (takenMonth.reason ?? 'nothing recorded'),
      // Was `myCur ?? 'unknown — the gym has not set one'` — one string for six
      // states, four of which it describes wrongly, and after part 940 the
      // commonest of them is a coach who HAS no gym. See
      // src/lib/currencyForModel.ts.
      currency: currencyForModel(cur),
      clients,
      avgAdherence: avgAdh != null ? avgAdh + '%' : 'no check-ins yet',
      // Null rather than a number when the training record did not come back.
      // The system prompt tells the model to say it was not given a figure
      // rather than guess at one; a zero here would have it write a paragraph
      // about a book where nobody is drifting.
      atRiskClients: atRisk === null ? null : atRisk.length,
      onTrack, watch, atRiskLow: riskCount,
      howTheyCoach: sessionsLead ? 'in person, or both in person and remotely' : 'entirely online',
    };
    // `askAboutMyBusiness`, not `askCoach`. Nothing in `ctx` above names a
    // person today, and the filter is what keeps that true the day somebody
    // adds `atRiskNames` to it — see the coach half of src/lib/coachShare.ts.
    const answer = await askAboutMyBusiness([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers: one line on money and clients, one on roster health (on-track vs at-risk), and one concrete action to grow or retain. Encouraging and specific. RULES. sessionsDeliveredThisMonth counts only sessions whose outcome was recorded as completed — never describe it as sessions booked. sessionsStillUnmarked are sessions that happened and have no outcome recorded: they are neither delivered nor missed, so never add them to the delivered figure, and if there are any, say they are waiting to be marked. revenueAtOwnRate is those delivered sessions multiplied by the coach own session rate and is the coach own arithmetic, not a payout. takenThisMonth is money clients were actually charged across packages, subscription renewals and payments recorded by hand: it is already written in its own currency, quote it exactly as given, and NEVER add it to revenueAtOwnRate, because a package and the sessions delivered out of it are the same money twice. For any other amount write the ISO code from the currency field before the figure, never a currency symbol, and if currency is unknown state no amount at all. If howTheyCoach says entirely online, lead on takenThisMonth and do not suggest anything that needs a room or a booking calendar.' }], ctx);
    setDigestBusy(false);
    setDigest(answer.ok ? answer.reply : 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  // `revenue` is already null unless the sessions read was whole, and that
  // matters more here than anywhere else on the screen: this hook WRITES. A
  // month's figure recorded off a truncated read is not wrong for a second, it
  // is saved as that month's history and shows in the trend chart forever,
  // indistinguishable from a month that really was that quiet. Nothing later
  // can tell the two apart — see the note on useMonthlyHistory.
  //
  // The window is THIRTEEN months rather than six, so `revHist.snapshots` holds
  // the same month last year and the year-on-year read below has both ends of
  // its comparison. The CHART still draws six — `Spark` is handed the last six
  // columns — because thirteen labels do not fit on a phone and the trend the
  // chart is for is the recent one. Two questions, one record.
  //
  // ── AND THE KEY CHANGED, WHICH IS NOT A DETAIL ────────────────────────────
  //
  // 'repple.trainer.revHistory' holds months recorded under the OLD definition:
  // booked sessions in the past, no-shows included, times the rate. Those
  // months are real records of what the app said at the time and are not
  // deleted — but they are not comparable with a month counted from outcomes,
  // and charting the two together would show every coach a fall in the month
  // this shipped that has nothing to do with their business. That fall is
  // exactly the kind of figure nothing later can tell from a real one, which is
  // the failure the header of src/lib/monthlyHistory.ts is about.
  //
  // So the honest thing is a new series on the honest basis. The trend restarts
  // and says so, rather than being wrong for thirteen months.
  //
  // There is deliberately no takings trend beside it. A month's takings is a
  // LIST of pots, one per currency, and `useMonthlyHistory` stores one number —
  // so the only way to chart it would be to pick a pot or add them up, and both
  // are inventions. Two currencies are not one figure and are not one line.
  const revHist = useMonthlyHistory('repple.trainer.deliveredRevHistory', revenue, YEAR_WINDOW);
  const CHART_MONTHS = 6;
  const chartSeries = revHist.series.slice(-CHART_MONTHS);
  const chartLabels = revHist.labels.slice(-CHART_MONTHS);
  const chartMonths = chartSeries.filter((v) => v != null).length;

  /* ── the same month last year ─────────────────────────────────────────
   *
   * Coaching is seasonal, so "down 18% on last month" is a sentence about the
   * calendar at least as often as it is a sentence about the coach. The
   * comparison is withheld outright when the month it needs was never
   * recorded — `yearOnYear` returns null rather than reaching for the nearest
   * month it does have, which is the substitution src/lib/monthlyHistory.ts
   * exists to prevent. */
  const yoy = yearOnYear(revHist.snapshots, new Date());

  /* ── how long people stay ─────────────────────────────────────────────
   *
   * Read from `coaching_relationships` and NOT from the roster: the roster is
   * the people who did not leave, so a curve built from it is flat at 100%
   * forever with nothing on it to give that away. See src/ui/coachCohorts.ts. */
  const spans = useCoachingSpans();
  // Destructured because the hook returns a fresh object each render; the
  // callback itself is stable, and depending on the object instead would
  // rebuild the refresh control on every render.
  const reloadSpans = spans.reload;
  const cohortBlock = cohortsBlocker(spans.status);
  // Newest cohorts first — a coach reads the recent ones and the oldest are
  // the ones with the least left to say.
  const cohortRows = cohortBlock ? [] : cohorts(spans.spans, new Date()).slice().reverse();

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * Six reads sit behind this screen and every figure on it is a combination of
   * several: the roster and the sessions feed the headline counts, the three
   * takings strands feed the money, the tenant's currency decides whether any
   * money may be printed at all, the retention curve is its own read and the
   * targets are another. Refreshing a subset would leave the screen stating a
   * ratio whose halves came from different minutes, which is the failure the
   * status plumbing above exists to prevent — so the gesture asks for all of
   * them, and the worst status still governs what is stated. */
  const pull = usePullToRefresh(useCallback(
    () => {
      setDriftNonce((n) => n + 1);
      return Promise.all([
        refreshRoster(), refreshSessions(), loadTakings(), loadCurrency(),
        Promise.resolve(reloadSpans()), Promise.resolve(reloadGoals()),
      ]);
    },
    [refreshRoster, refreshSessions, loadTakings, loadCurrency, reloadSpans, reloadGoals],
  ));

  const [exportBusy, setExportBusy] = useState(false);
  /* ── the screen, out of the app ───────────────────────────────────────
   *
   * The statement already does this for the money and the coach has the habit.
   * Every figure in the file is `number | null` and a null is written as an
   * EMPTY cell, never a zero — the difference between a dash on screen and a
   * zero in a spreadsheet is that nobody doubts the zero. src/lib/analyticsExport.ts
   * carries the reasoning and the banner row. */
  const exportAnalytics = async () => {
    if (exportBusy) return;
    const reads: AnalyticsReads = { roster: rosterStatus, sessions: sessionsStatus, history: revHist.status };
    const why = analyticsExportBlocker(reads);
    if (why) { Alert.alert('Nothing to Export', why); return; }
    setExportBusy(true);
    try {
      const file = buildAnalyticsExport({
        currency: myCur,
        sessionsThisMonth: sessionsMo,
        sessionsUnmarked: unmarkedMo,
        revenueAtOwnRate: revenue,
        clients,
        avgAdherencePct: avgAdh,
        onTrack, watch, atRisk: riskCount,
        history: revHist.series,
        months: monthWindow(new Date(), YEAR_WINDOW).map((m) => m.key),
      }, reads, localDayKey(Date.now()));
      const blocked = fileShareBlocker();
      const how = await shareTextFile(file.csv, file.filename, 'text/csv', 'Your analytics');
      // Said after, because it is about what actually left the phone.
      if (how === 'text' && blocked) Alert.alert('Sent as Text', blocked);
      else if (!file.complete) Alert.alert('Exported, but Incomplete', analyticsShareNote(file, revHist.months));
    } catch (e) {
      reportError('analytics.export', e);
      Alert.alert('Not Exported', 'The file could not be written. Try again once you have a little free space on your phone.');
    } finally { setExportBusy(false); }
  };
  // Only the targets that have both a number to aim at and a number reached so
  // far. A revenue goal with no session rate has the first and not the second,
  // and is spoken to separately below rather than drawn as a bar at zero.
  const goalRows = ([
    { label: 'Monthly Revenue', cur: revenue, goal: goals.revenue, money: true },
    { label: 'Active Clients', cur: clients, goal: goals.clients, money: false },
  ] as { label: string; cur: number | null; goal: number; money: boolean }[])
    .filter((g): g is typeof g & { cur: number } => g.goal > 0 && g.cur != null);
  // Null once there is a target to draw — the bars then speak for themselves.
  const goalsLine = goalsEmptyLine(goalsStatus, goals.revenue, goals.clients);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching business</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Analytics</Text>
        </View>

        {/* Said once, at the top, because it is the reason every figure below
            is a dash. Without it the screen reads as a coaching business with
            nothing in it rather than as a screen that could not look. */}
        {figureStatus === 'error' ? (
          <Notice tone={t.warn} kicker="Analytics" title="These figures could not be worked out"
            note={rosterStatus === 'error' && sessionsStatus === 'error'
              ? 'Neither your roster nor your sessions came back, so nothing on this screen has been counted. Every dash below means unknown, not zero.'
              : rosterStatus === 'error'
                ? 'Your roster did not come back, so nothing counted over your clients has been worked out. Every dash below means unknown, not zero.'
                : 'Your sessions did not come back, so nothing counted over them has been worked out. Every dash below means unknown, not zero.'} />
        ) : figureStatus === 'partial' ? (
          <PartialRead what={rosterStatus === 'partial' ? 'clients on your book' : 'sessions in your calendar'} />
        ) : null}

        {/* A coach with an empty book that we KNOW is empty. Deliberately said
            in the words of the business they told us they run: a remote coach
            sold nothing rather than delivered nothing, and being told to "run
            sessions" is being told to do something they do not do. */}
        {clients === 0 ? (
          <Card style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {sessionsLead
                ? 'No clients yet. Revenue, adherence and roster health fill in as you add clients and mark the sessions you deliver.'
                : 'No clients yet. Your takings, adherence and roster health fill in as you add clients and they buy a package or start a subscription.'}
            </Text>
          </Card>
        ) : null}

        {/* ── the hero ─────────────────────────────────────────────────────
            WHICH figure leads is the one thing `delivery` decides here. A coach
            who trains people in the room leads on the sessions they delivered;
            a coach who works remotely sells no sessions at all, so leading on a
            session count would open their business analytics on a nought. Both
            figures are on the screen either way and neither is ever removed —
            the order is what changes.

            Every unknown resolves to the in-person layout, so a coach whose
            roster failed to load, or who has not answered how they coach, gets
            the screen they have always had. */}
        {sessionsLead ? (
          <Hero
            label="Sessions Delivered"
            figure={fig(sessionsMo)}
            unit={sessionsMo == null ? undefined : 'this month'}
            note={sessionsMo == null
              ? sessionsUnknownLine(sessionsStatus)
              : revenue != null && sessionFee != null
                ? (myCur
                    ? `${fig(priced(revenue))} at your ${fig(priced(sessionFee))} session rate. ${DELIVERED_IS_MARKED} Repple does not process this, so it is your own arithmetic and not a payout.`
                    : noCur('there is no unit to price these sessions in'))
                : `Set a session rate in your profile to see what that is worth. ${DELIVERED_IS_MARKED}`}
            arc={revenue != null && goals.revenue > 0 ? goalPct(revenue, goals.revenue) : undefined}
            arcLabel="of the revenue goal"
            onPress={() => router.push('/(trainer)/payments')}
          />
        ) : (
          <Hero
            label="Taken This Month"
            figure={fig(takenOne)}
            note={takenNote}
            onPress={() => router.push('/(trainer)/money')}
          />
        )}

        {/* Sessions nobody has said anything about, on whichever layout. This
            is the money that used to be swept silently INTO the figure above:
            the old count was "booked and in the past", which is every one of
            these. Stating it is the opposite of counting it, and one tap goes
            to the queue that clears it. */}
        {unmarkedLine(month) ? (
          <Card onPress={() => router.push('/(trainer)/sessions')} tone={t.warn} style={{ marginTop: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
              <Text style={{ ...ty.micro, color: t.ink3 }}>Not yet marked</Text>
            </View>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {unmarkedLine(month)}
              {unmarkedWorth != null && priced(unmarkedWorth) != null
                ? ` At your rate that is ${priced(unmarkedWorth)} either way.`
                : ''}
            </Text>
          </Card>
        ) : null}

        <Rule />

        {/* ── the other figure, always present ───────────────────────────────
            Whichever led above, the other one is here. They are never added:
            a package a client paid for and the sessions delivered out of it are
            the same money counted twice, which is why src/lib/coachRevenue.ts
            has no function that sums them. */}
        <Section>
          {sessionsLead ? (<>
            <SectionHead title="Taken This Month" note="Money" onPress={() => router.push('/(trainer)/money')} />
            <Text style={{ ...value(26), color: t.ink }}>{fig(takenOne)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{takenNote}</Text>
          </>) : (<>
            <SectionHead title="Sessions Delivered" note="Mark What Happened" onPress={() => router.push('/(trainer)/sessions')} />
            <Text style={{ ...value(26), color: t.ink }}>{fig(sessionsMo)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
              {sessionsMo == null
                ? sessionsUnknownLine(sessionsStatus)
                : revenue != null && priced(revenue) != null
                  ? `${priced(revenue)} at your session rate. ${DELIVERED_IS_MARKED} ${TWO_FIGURES_NEVER_SUM}`
                  : `${DELIVERED_IS_MARKED} ${TWO_FIGURES_NEVER_SUM}`}
            </Text>
            {/* Said once, on the screen that put something away, because a
                coach has to be able to believe it. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {deliveryNote(delivery)} {HIDDEN_NOT_GONE}
            </Text>
          </>)}
          {takenHoles > 0 ? (
            <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
              {takenHoles} payment{takenHoles === 1 ? '' : 's'} this month could not be added to that figure, because no currency or no amount was recorded against {takenHoles === 1 ? 'it' : 'them'}. {takenHoles === 1 ? 'It is' : 'They are'} real and {takenHoles === 1 ? 'is' : 'are'} missing from the total.
            </Flag>
          ) : null}
        </Section>

        <Rule />

        {/* ── the shape of the business ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster" note="Leaderboard" onPress={() => router.push('/(trainer)/leaderboard')} />
          <KpiRow items={[
            { label: 'Clients', value: fig(clients) },
            { label: 'Avg Adherence', value: fig(avgAdh), unit: avgAdh == null ? undefined : '%' },
            { label: 'Value / Client', value: fig(priced(valuePerClient)), unit: priced(valuePerClient) == null ? undefined : '/mo' },
          ]} />
        </Section>

        <Rule />

        {/* ── goals ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Goals" note="Edit"
            // goalText, not String(): an unset target is 0 in the app, and
            // String(0) put the digit "0" in the box — which reads as a target
            // of nothing and saved straight back as one the moment the coach
            // filled in only the other field.
            onPress={() => { setGRev(goalText(goals.revenue)); setGCli(goalText(goals.clients)); setGoalOpen(true); }} />
          {/* Was a heading with nothing under it, then a heading that said "No
              targets set" whatever the reason there was nothing to show. The
              targets follow the account now (part 129), so {0, 0} arrives from
              two different situations and the second is a read that failed —
              telling that coach they have no targets is both false and an
              invitation to type them in again over the top of the stored ones.
              goalsEmptyLine picks the sentence, and is tested. */}
          {/* crit as ink measures 3.03–4.05:1 on all ten palettes, so the
              failed-read sentence was the least readable line on the screen.
              Flag puts crit in the dot and the sentence in ink2. */}
          {goalsLine ? (
            goalsStatus === 'error'
              ? <Flag tone={t.crit}>{goalsLine}</Flag>
              : <Text style={{ ...ty.label, color: t.ink3 }}>{goalsLine}</Text>
          ) : null}
          {/* A revenue target set with no session rate has a goal but no
              progress, and drawing that bar at 0% would tell a coach who has
              delivered a full month of sessions that they are nowhere. The bar
              is withheld and the reason is given instead. */}
          {/* The target is the SUBJECT of this sentence, so it cannot be a
              dash: with no gym currency `priced()` returns null and the line
              read "Monthly revenue target — — progress needs a session rate in
              your profile", which is a sentence that has lost the figure it is
              about. A target nobody can price is a missing currency before it
              is anything else, so that is what the line says instead. */}
          {goals.revenue > 0 && revenue == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              {priced(goals.revenue) == null
                ? noCur('your monthly revenue target cannot be shown as an amount')
                : `Monthly revenue target ${priced(goals.revenue)} — progress needs ${sessionsMo == null ? (sessionsStatus === 'loading' ? 'a session count that is still being read' : 'a session count that did not come back whole') : 'a session rate in your profile'}.`}
            </Text>
          ) : null}
          {/* Same withholding for the client target. A bar drawn at 0% tells a
              coach with a full book that nobody is on it. */}
          {goals.clients > 0 && clients == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Client target {goals.clients} — your roster {rosterStatus === 'loading' ? 'is still being read' : 'did not come back whole'}, so there is no progress to draw against it.
            </Text>
          ) : null}
          {goalRows.map((g) => {
            const pc = goalPct(g.cur, g.goal);
            const hit = pc >= 1;
            return (
              <View key={g.label} style={{ marginBottom: sp.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{g.label}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                    {g.money ? fig(priced(g.cur)) : g.cur} / {g.money ? fig(priced(g.goal)) : g.goal}
                  </Text>
                </View>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                  <View style={{ height: 3, borderRadius: 2, width: `${pc * 100}%`, backgroundColor: t.brand, opacity: hit ? 1 : 0.55 }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  {hit ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{hit ? 'Goal reached' : Math.round(pc * 100) + '% there'}</Text>
                </View>
              </View>
            );
          })}
        </Section>

        {/* ── at-risk revenue: the one thing to act on ────────────────────── */}
        {atRisk && atRisk.length > 0 ? (<>
          <Rule />
          <Section>
            <Card tone={t.warn}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>Revenue at risk</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  {/* A dash, not ~$0. The figure is these clients' delivered
                      sessions priced at the coach's own rate, so with no rate
                      set there is no figure — and "~$0/mo at risk" is the one
                      reading that would make this card safe to ignore. */}
                  <Text style={{ ...value(26), color: t.ink }}>
                    {priced(atRiskRevenue) == null ? '—' : <>~{priced(atRiskRevenue)}<Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text></>}
                  </Text>
                  {/* "N clients slipping" is a count of the whole book, and off
                      a short roster it is a count of whoever happened to load —
                      which reads as reassuringly small. The card no longer
                      renders at all unless the roster came back whole AND the
                      training record behind the verdict landed (`atRisk` is
                      null otherwise), which is a stricter bargain than the "at
                      least" hedge it replaces: this card is an instruction to
                      go and ring people, and a hedged instruction is still an
                      instruction. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {atRisk.length} client{atRisk.length > 1 ? 's' : ''} slipping — check in before they churn.
                    {atRiskRevenue == null
                      ? (sessionFee == null
                          ? ' Set a session rate in your profile to see what that is worth.'
                          : ' What that is worth cannot be worked out from a read this short.')
                      : ' Counted from the sessions they were marked as having taken, so a booking they did not turn up to is not in it.'}
                  </Text>
                </View>
                <Cta label="Review" onPress={() => router.push('/(trainer)/dashboard')} />
              </View>
            </Card>
          </Section>
        </>) : null}

        <Rule />

        {/* ── roster health ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster Health"
            note={!rosterWhole ? undefined : avgAdh == null ? 'no check-ins yet' : `${avgAdh}% avg adherence`}
            onPress={() => router.push('/(trainer)/leaderboard')} />
          {/* The bar is withheld rather than drawn from what loaded. A DistBar
              always fills its width, so a split computed over a short roster is
              rendered as the whole book at whatever proportions the fragment
              happened to have — the one chart on this screen that cannot show
              its own incompleteness. Three zeroes would be worse still: an
              empty bar under "Roster health" reads as a roster in trouble. */}
          {onTrack == null || watch == null || riskCount == null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterStatus === 'loading'
                ? 'Reading your roster…'
                : rosterStatus === 'partial'
                  ? 'Your roster came back short, so the split between on-track, watch and at-risk is not drawn — a share of part of your book is not a share of it.'
                  : 'Your roster could not be read, so the split between on-track, watch and at-risk is not drawn. It is unknown, not empty.'}
            </Text>
          ) : (<>
            <DistBar segments={[
              { label: STATUS_LABEL.on_track, value: onTrack, color: t.brand },
              { label: STATUS_LABEL.watch, value: watch, color: t.warn },
              { label: STATUS_LABEL.at_risk, value: riskCount, color: t.crit },
            ]} />
            <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md }}>
              {([[STATUS_LABEL.on_track, onTrack, t.brand], [STATUS_LABEL.watch, watch, t.warn], [STATUS_LABEL.at_risk, riskCount, t.crit]] as const).map(([l, v, col]) => (
                <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{l} {v}</Text>
                </View>
              ))}
            </View>
          </>)}
        </Section>

        <Rule />

        {/* ── revenue trend ──────────────────────────────────────────────── */}
        <Section>
          {/* With no figure for this month there is nothing to compare against
              last month, and "Tracking started" reads as though a point had
              just been recorded — nothing was, deliberately: an unsound figure
              written here would be indistinguishable from a real month forever
              after. */}
          {/* The '$' that used to sit here was removed in the currency sweep,
              but the `?? delta.toLocaleString()` behind it was left — so with
              no currency set this printed the month-on-month change as a BARE
              number, "+1,500 vs last mo", directly under a hero that had just
              said the gym has not set a currency and the sessions cannot be
              priced. A bare figure is read in whatever money the reader happens
              to be thinking in, which is the same wrong amount with fewer clues
              than a wrong symbol would have given. 35 of the 54 live tenants
              have `tenants.currency` NULL, so withholding is the COMMON path
              through this line, not the edge case.

              Withheld the way every other amount on this screen is withheld,
              and the reason named rather than left as a dash — the coach can
              act on "no currency set", and an owner is the one who sets it —
              but only when that is what happened. A refused read is labelled as
              one, because "No currency set" over a query that failed is the
              same wrong sentence the four longer ones on this screen used to
              carry. See src/lib/currencyGap.ts. */}
          <SectionHead title="Revenue Trend"
            note={revenue == null ? 'This month not recorded'
              : revHist.delta === 0 ? 'Tracking started'
              : priced(Math.abs(revHist.delta)) == null
                ? (curGap === 'gym-unset' || curGap === 'own-unset' ? 'No currency set'
                  : curGap === 'reading' ? 'Reading your currency'
                  : 'Currency not read')
              : `${deltaSign(revHist.delta, 0)}${priced(Math.abs(revHist.delta))} vs last mo`}
            onPress={() => router.push('/(trainer)/payments')} />
          {/* This drew the wrong months, not merely undated ones. The
              `.filter()` threw away exactly the nulls monthlyHistory.ts exists
              to produce, so the LINE plotted 4 points across the full width
              while the LABEL ROW printed 6 evenly spaced — putting every point
              above the wrong month, by up to two. Nothing on screen gave a
              reason to doubt it. Spark takes the holes now and keeps each
              reading in its own slot. */}
          {chartMonths >= 2 ? (
          <Spark data={chartSeries} labels={chartLabels} />
          ) : revHist.status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading the months you have recorded…</Text>
          ) : revHist.status === 'error' ? (
            // "Not enough history yet" is a statement about this coach's
            // trading, and under a failed read it is one the app cannot make.
            // The months live on the account now (part 129) — a phone that
            // cannot reach them has not established that there are none.
            <Flag tone={t.crit}>
              Your recorded months could not be read, so this is not "no history yet" — there may be months on your account this phone has not got. Nothing has been lost; open this screen again once you have signal.
            </Flag>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet — a snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
          {/* A chart drawn from the device cache alone is real as far as it
              goes and is not the whole of the account. Said under the line
              rather than in place of it: withholding a trend the coach has
              genuinely recorded would be its own kind of wrong. */}
          {chartMonths >= 2 && revHist.status === 'error' ? (
            <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
              Drawn from what this phone recorded — your account's months could not be read just now, so there may be more than this.
            </Flag>
          ) : null}
        </Section>

        <Rule />

        {/* ── the same month last year ───────────────────────────────────
            The comparison directly above is month-on-month, and coaching is a
            seasonal business: August against July is a sentence about the
            summer at least as often as it is a sentence about the coach, and a
            coach who reads it as the second discounts their prices.

            Withheld outright rather than approximated. `yearOnYear` returns
            null when the month it needs was never recorded, and
            `yearOnYearLine` says WHICH of the three reasons applies — still
            reading, not enough history yet with a count of the months to wait,
            or a hole where that month should be. Reaching for the nearest
            month there is instead would be the exact substitution
            src/lib/monthlyHistory.ts exists to prevent. */}
        <Section>
          <SectionHead title="Against Last Year" />
          {yoy ? (<>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
              <Text style={{ ...value(26), color: t.ink }}>
                {priced(Math.abs(yoy.delta)) == null
                  ? '—'
                  : `${deltaSign(yoy.delta, 0)}${priced(Math.abs(yoy.delta))}`}
              </Text>
              {/* The percentage is null when last year was zero. There is no
                  percentage of nothing, and "+100%" over a zero base is a
                  figure with no meaning that reads like a triumph. */}
              {yoy.pct != null ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>{deltaSign(yoy.pct, 0)}{Math.abs(yoy.pct)}%</Text>
              ) : null}
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
              {priced(yoy.then) == null
                ? noCur('this month and the same month last year cannot be shown as amounts')
                : `${monthLabelOf(yoy.monthKey)} against the same month last year, which was ${priced(yoy.then)}. Both figures are sessions you marked as delivered, at your own rate, so a change in your rate moves this as much as a change in your book.`}
            </Text>
          </>) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>{yearOnYearLine(revHist.snapshots, new Date(), revHist.status)}</Text>
          )}
        </Section>

        <Rule />

        {/* ── how long people stay ───────────────────────────────────────
            Read from `coaching_relationships` and NOT from the roster. The
            roster is the people who have not left, so a curve built from it is
            flat at 100% forever and there is nothing on it that would give
            that away — see src/ui/coachCohorts.ts.

            Counts first, percentages only where the cohort is big enough. The
            floor is the console's own `MIN_COHORT_FOR_RATE` rather than a
            second number, and it is ten — more people than most self-employed
            coaches sign in a month — so a screen that had only percentages
            would say "too small" against every row it ever drew. */}
        <Section>
          <SectionHead title="How Long People Stay" />
          {cohortBlock ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{cohortBlock}</Text>
          ) : cohortRows.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody has started with you yet, so there is no cohort to follow. This fills in on its own as people join and as time passes.
            </Text>
          ) : (<>
            <View style={{ flexDirection: 'row', paddingBottom: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3, flex: 1.4 }}>Started</Text>
              {MILESTONES.map((m) => (
                <Text key={m} style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: END_ALIGN }}>{m}m</Text>
              ))}
            </View>
            {cohortRows.map((row, i) => (
              <View key={row.month} style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: sp.sm,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flex: 1.4 }}>
                  <Text style={{ ...ty.label, color: t.ink }}>{monthLabelOf(row.month)}</Text>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{row.size} joined</Text>
                </View>
                {row.held.map((h, k) => (
                  <View key={MILESTONES[k]} style={{ flex: 1, alignItems: 'flex-end' }}>
                    {/* A dash where the cohort has not reached this milestone.
                        A zero there would draw as a collapse on the right-hand
                        side of the table, which is where the eye lands. */}
                    <Text style={{ ...value(15), color: t.ink }}>{h == null ? '—' : `${h}/${row.size}`}</Text>
                    {row.retained[k] != null ? (
                      <Text style={{ ...ty.micro, color: t.ink3 }}>{row.retained[k]}%</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COHORT_CAVEAT}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{COHORT_FLOOR_NOTE}</Text>
          </>)}
        </Section>

        <Rule />

        {/* ── client value ───────────────────────────────────────────────── */}

        {/* ── at-risk clients ────────────────────────────────────────────── */}
        <Section>
          {/* The note said "Low adherence or inactive 2+ days", which was an
              accurate description of `atRiskClient` and of nothing else in the
              app. What is measured now is each client against their OWN
              baseline over 56 days, plus the band for a client there is nothing
              on record about — see src/lib/clientDrift.ts, and the Clients
              screen, which has always said it this way. */}
          {/* ── and the explanation goes UNDER the head, not inside it ──────
              This sentence was passed as `note`. `SectionHead` lays title and
              note out as a two-child `space-between` row with no gap and no
              shrink on either — the slot is for "Leaderboard ›" or "Last 90
              days", three words at most. Two sentences in it rendered on a
              device as "AT-RISK CLIENTSWell below their own rate over the last
              14 days. …" — the title and the note touching with no space
              between them, the first line running off the right edge of the
              phone, and the remainder wrapping to a centred second line under
              the whole row. Seen on an iPhone 17 Pro at the default text size,
              so it is not an accessibility-size edge case.

              Every other explanatory sentence on this screen is a caption
              beneath its head; this one now is too. */}
          <SectionHead title="At-risk Clients" />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.lg }}>
            {bandNote('at_risk')} Plus anyone there is nothing on record for.
          </Text>
          {/* Four renders, and the first three are the ones that were missing.
              "Everyone is on track" is a claim about every client the coach
              has: it may be made only over a whole roster AND a training record
              that came back. Before, an unread record produced an empty filter
              and that sentence. */}
          {dr.error ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Their training records could not be read, so who is drifting is unknown. This is not a clean bill of health for your book.
            </Text>
          ) : atRisk === null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterStatus === 'loading' || dr.drift === null
                ? 'Reading who has stopped training…'
                : 'Your roster did not come back whole, so who is drifting cannot be worked out — this is not a clean bill of health for your book.'}
            </Text>
          ) : atRisk.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Everyone is holding their own pattern.</Text>
          ) : atRisk.map((c, i) => (
            <View key={c.id} style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              {/* The dot, the label and the line under the name all used to be
                  re-derived here from `adherence` and from `lastActive`, which
                  is a display string. They are the verdict's own now, so this
                  row cannot say something different from the band it was put
                  in. `idle` is drawn in the quieter tone on purpose: it is not
                  a judgement about the client, it is the absence of one. */}
              <View style={{ width: 6, height: 6, borderRadius: 3, marginEnd: sp.md, backgroundColor: dr.driftFor(c.id)?.status === 'at_risk' ? t.crit : t.warn }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {DRIFT_LABEL[dr.driftFor(c.id)!.status]} · {dr.driftFor(c.id)!.reason}
                </Text>
              </View>
            </View>
          ))}

          {/* The list above names them and stops. This is the row that does
              something about it, and it sits directly under the names because
              that is the second the coach wants it — not three taps away in a
              hub they had no reason to open.

              Shown whatever the roster read did. On 'error' the list above says
              nothing was suggested, and nudges.tsx keeps the same three states
              apart on its own read; withholding the row when the read failed
              would hide the screen precisely when the coach cannot see who has
              gone quiet from here either. */}
          <View style={{ marginTop: sp.md }}>
            <ListRow icon="bell" title="Quiet Clients"
              note="Who is breaking their own pattern, and a draft you read and send yourself"
              onPress={() => router.push('/(trainer)/nudges')} />
          </View>
        </Section>

        <Rule />

        {/* ── AI digest ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Weekly Business Digest" />
          {digest ? (
            <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{digest}</Text>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              {figuresWhole
                ? 'An AI Monday summary of your coaching business.'
                : figureStatus === 'loading'
                  ? 'An AI Monday summary of your coaching business — it needs the figures above, which are still being read.'
                  : 'An AI Monday summary of your coaching business. It is written from the figures above, and those could not be worked out from this read — a digest composed from them would sound just as certain and be about nothing.'}
            </Text>
          )}
          {/* Withheld rather than run on nulls. The digest comes back as
              paragraphs of plain English with no dashes in it, so a coach has
              no way to tell a summary of their month from a summary of what
              happened to load. */}
          {/* The refusal was drawn and never announced. The button says "Needs
              figures it could not read" and dims to 0.4, and neither of those
              reaches a screen reader without a role and a state: with no
              `accessibilityRole` VoiceOver does not call it a button, and with
              no `accessibilityState` it does not say "dimmed", so the control
              read as ordinary text and a coach could not tell why nothing
              happened. Opacity is a colour, not a sentence. */}
          <Pressable onPress={genDigest} disabled={digestBusy || !figuresWhole}
            accessibilityRole="button"
            accessibilityState={{ disabled: digestBusy || !figuresWhole, busy: digestBusy }}
            accessibilityLabel={digestBusy
              ? 'Writing your weekly business digest'
              : !figuresWhole
                ? 'Generate digest — unavailable, because the figures above could not all be read'
                : digest ? 'Write the digest again' : 'Generate your weekly business digest'}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
                     backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, opacity: digestBusy || !figuresWhole ? 0.4 : 1 }}>
            {digestBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>
              {digestBusy ? 'Writing…' : !figuresWhole ? 'Needs figures it could not read' : digest ? 'Regenerate' : 'Generate digest'}
            </Text>
          </Pressable>
        </Section>

        <Rule />

        <Section>
          {/* The conversational half of the digest above. The digest answers
              one fixed question this app wrote; a coach's second question has
              never had anywhere to go. It sends the same figures through the
              same filter — see app/(trainer)/assistant.tsx for why it will not
              name a client. */}
          <ListRow icon="sparkle" title="Ask The Assistant"
            note="A conversation about your own figures, with no client named to it"
            onPress={() => router.push('/(trainer)/assistant')} />
          {/* Out of the app. The statement already does this for the money and
              the coach has the habit; analytics had no share action at all, so
              the one screen a coach would show an accountant was the one screen
              they could only photograph. Every unknown figure leaves as an
              EMPTY cell — see src/lib/analyticsExport.ts for why a zero in a
              spreadsheet is worse than a dash on a screen. */}
          <ListRow icon="share" title={exportBusy ? 'Exporting…' : 'Export These Figures'}
            note="A CSV of the figures above and every month you have recorded"
            onPress={() => { void exportAnalytics(); }} />
          <ListRow icon="chart" title="Payments"
            onPress={() => router.push('/(trainer)/payments')} />
          {/* Beside Payments because it is the other half of the same sum —
              what came in, and what was spent to bring it in. Not a screen this
              change added: ad-spend.tsx was reachable ONLY from an Explore
              search result, which finds it for a coach who already knows the
              phrase "ad spend" and for nobody else. The screen a coach is
              standing on when they wonder what marketing cost them is this one. */}
          <ListRow icon="trending" title="Ad Spend"
            note="What your ads cost, and what they brought in"
            onPress={() => router.push('/(trainer)/ad-spend')} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {sessionFee == null
              ? 'Set a session rate in your profile to see what a new client is worth.'
              : myCur
                ? `Every new client at ${fig(priced(sessionFee))}/session adds about ${fig(priced(sessionFee * 4))}/mo.`
                : noCur('what a new client is worth cannot be priced here')}
          </Text>
        </Section>

      </ScrollView>

      {/* ── goal editor ──────────────────────────────────────────────────── */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setGoalOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Set Your Goals</Text>
          {/* The parenthetical names the unit the coach is typing in, so with
              no currency set it rendered as the literal label "Monthly revenue
              target (—)" — a bracket around a dash, which names nothing and
              reads as a rendering fault rather than as a missing setting. It is
              the common case, not a rare one: 35 of the 54 live tenants have
              `tenants.currency` NULL. Dropped entirely when there is no unit to
              name, and the sentence under the field says what that means. */}
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Monthly revenue target{myCur ? ` (${myCur})` : ''}</Text>
          <TextInput value={gRev} onChangeText={setGRev} keyboardType="number-pad" placeholder="4000" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, marginBottom: myCur ? sp.md : 6 }} />
          {/* Said where the unit would have been named, so a coach typing 4000
              into a box with no currency on it knows why — and knows the target
              is still saved and still compared, it just cannot be printed as an
              amount anywhere on the screen above. */}
          {!myCur ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              {noCur('this target is saved as a plain number and shown as a dash rather than an amount')}
            </Text>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Client target</Text>
          <TextInput value={gCli} onChangeText={setGCli} keyboardType="number-pad" placeholder="12" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, marginBottom: sp.xl }} />
          {/* Targets follow the account now, so this tap leaves the phone.
              parseGoal, not parseInt: parseInt('12abc') is 12 and
              parseInt('-12') is -12, and both of those become a target the
              coach did not type — one of them a bar drawn backwards. */}
          <Cta label={goalBusy ? 'Saving…' : 'Save Goals'} wide onPress={saveGoals} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setGoalOpen(false)} />
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
