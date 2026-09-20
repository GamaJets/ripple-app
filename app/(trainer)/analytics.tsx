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
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { useTheme } from '../../src/ui/components';
// The month window's instant, recomputed at midnight, on foreground and on
// focus — never frozen at mount. See src/ui/today.ts.
import { useNow } from '../../src/ui/today';
// Counts go through the reader's own digit grouping, as every other figure in
// the app does — 1,248 sessions, not 1248.
import { num } from '../../src/lib/format';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, ScreenHeader, FigureCard, Segmented, KpiRow, ListRow, Card, Cta, Ghost, Spark, fig, Flag, Notice, PartialRead, TonedChip, Donut, Legend, Meter, Expandable, type Slice } from '../../src/ui/kit';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import { sp, layout, radius, hairline, type as ty, numeric, value, font } from '../../src/theme/scale';
import { sharePercent } from '../../src/lib/sharePercent';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { STATUS_LABEL } from '../../src/lib/status';
import { useRoster } from '../../src/ui/roster';
import { type RosterClient } from '../../src/lib/trainerMock';
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
import { deltaSign, deltaLabel } from '../../src/lib/deltaLabel';
// The board's 7D / 30D / 90D / 1Y windows: what each covers, what is read for
// it, and the bar chart. See the header of src/ui/coach/analyticsRange.ts.
import { RANGES, bucketsOf, priorWindow, useRangeActivity, rangeFigures, type RangeKey, type RangeRead } from '../../src/ui/coach/analyticsRange';
import { RangeBars } from '../../src/ui/coach/RangeBars';
import { recentWindow, dayLabel } from '../../src/lib/adherence';
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
import { receiptTakenRows, type CoachReceipt } from '../../src/lib/coachReceipts';
import { END_ALIGN } from '../../src/ui/direction';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

/**
 * The mockup's windowed figure card: a quiet label, the Sora figure at hero
 * size with its movement as a chip BESIDE it, one line of period and
 * population, then the chart.
 *
 * Not the kit's `FigureCard`, which puts the comparison under the figure as a
 * sentence — right for money, where the comparison is long. Here it is "+12
 * points", and the approved screen has it on the figure's own line. The row
 * wraps, so at large text the chip drops under the figure by itself rather
 * than the figure shrinking to make room for it.
 *
 * The words are one spoken sentence, as FigureCard's are; the chart is outside
 * that group because it has its own gestures and its own label.
 */
function WindowFigure({ title, figure, unit, chip, up, chipNote, line, tail, spoken, children }: {
  title: string;
  /** Spelled by the caller, or null for the dash. */
  figure: string | null;
  unit?: string;
  /** A finished `deltaLabel`, or null when there is nothing to compare with. */
  chip: string | null;
  /** Green only for movement upward; anything else is the neutral plate. */
  up: boolean;
  chipNote: string;
  /** Why there is no chip — said as a line, never as a chip. */
  line?: string;
  tail: string;
  spoken: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Section>
      <View accessible accessibilityLabel={spoken}>
        <Text style={{ ...ty.label, ...font('600'), color: t.ink2 }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: sp.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
              style={{ ...ty.hero, ...numeric, color: t.ink, flexShrink: 1 }}>{fig(figure)}</Text>
            {unit ? <Text style={{ ...ty.head, color: t.ink3, marginStart: 6 }}>{unit}</Text> : null}
          </View>
          {chip ? <TonedChip label={chip} tone={up ? 'brand' : 'neutral'} /> : null}
          {chip ? <Text style={{ ...ty.caption, color: t.ink3 }}>{chipNote}</Text> : null}
        </View>
        {line ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{line}</Text> : null}
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{tail}</Text>
      </View>
      <View style={{ marginTop: sp.md }}>{children}</View>
    </Section>
  );
}

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
  /**
   * Who is even ASKED about, and why it is not the whole roster.
   *
   * `readClientActivity` reports `notAsked` for ids that are not uuids, and
   * that is a narrower set than "clients with no Repple account behind them":
   * `coach_clients.id` is `uuid DEFAULT gen_random_uuid()`, so a client the
   * coach typed in on their phone has a perfectly queryable uuid from the first
   * round trip onward (src/lib/trainerMock.ts says so at length on
   * `handAdded`). Every read behind the drift verdict goes through
   * `is_my_client()`, which looks in `clients` — so those ids are put to the
   * database, come back with nothing, and `assessDrift` bands every one of them
   * `idle`. A coach with six cash clients had six extra names in the at-risk
   * list and six added to the count, on a read where nothing at all had gone
   * wrong.
   *
   * They are excluded rather than counted as "nothing recorded", which is the
   * rule `unassessed` in src/lib/segments.ts already states for the broadcast
   * segments — with the same two independent reasons: there is nothing of
   * theirs to read, and no thread to write into. The sentence under the list
   * says how many and why, because a list quietly shorter than the coach's book
   * with nothing explaining the gap is its own small lie.
   */
  const driftSubjects = useMemo(() => roster.filter((c) => c.handAdded !== true), [roster]);
  const handAdded = rosterWhole ? roster.length - driftSubjects.length : 0;
  const dr = useClientDrift(driftSubjects, tenant?.id ?? null, driftNonce);
  /**
   * Whether the record behind the verdict can support a claim about who has
   * STOPPED, as opposed to an order to put a list in.
   *
   * `useClientDrift` exports this and its header names it: "`actionable` is
   * that gate". This screen took `dr.drift && !dr.error` and stopped there,
   * which admits the one state that produces a plausible number instead of an
   * obviously empty screen. `readClientActivity` reads capped per 150-id chunk
   * with no `.order()`, and 56 days of check-ins, workouts, sessions and door
   * swipes for a two-dozen-client book runs to roughly a thousand rows — so a
   * healthy coach hits the ceiling routinely, the clients whose rows fell off
   * the end come back with no events, and `assessDrift` bands them `at_risk` or
   * `idle`. The card then reads "~AED 4,200/mo — 5 clients slipping" over a
   * list of whom three trained this week.
   *
   * The whole-book form of the same test is what app/(trainer)/dashboard.tsx
   * gates `clientsDrifting` on at :1143, and this is that test: a truncated read
   * disqualifies all of it, because there is no telling which names the missing
   * rows belonged to.
   */
  const driftCovered = !!dr.coverage && !dr.coverage.truncated && !dr.coverage.notAsked.size;
  const atRisk: RosterClient[] | null =
    rosterWhole && dr.drift && !dr.error && driftCovered
      // 'at_risk' is a break in their own pattern; 'idle' is the UNKNOWN band —
      // nothing on record at all — and it is in here for the reason
      // clientDrift.ts gives: a client nobody has heard from is the client this
      // whole feature is about, and the old signal could not see them.
      ? driftSubjects.filter((c) => { const d = dr.driftFor(c.id); return d?.status === 'at_risk' || d?.status === 'idle'; })
      : null;
  /** What this screen owes the coach about the people it did not consider, or
   *  null. Said in full sentences rather than left to a short list, on the
   *  reasoning `unassessedNote` in src/lib/segments.ts sets out. */
  const handAddedNote: string | null = handAdded > 0
    ? `${handAdded} ${handAdded === 1 ? 'client is' : 'clients are'} not in this and could not be: you added them by hand, so there is no account behind them and no training record to judge them by. They are not being counted as having stopped — they were never asked about.`
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
  /**
   * How many DISTINCT people this month's revenue actually came from.
   *
   * ── the two populations this replaces dividing across ─────────────────
   *
   * `revenue / clients` divided a numerator over one set of people by a
   * denominator over another. `revenue` is `deliveredValue(month, sessionFee)`
   * over `useSessions()`, which is every row RLS lets this coach read —
   * `sessions_trainer` is `trainer_id = auth.uid()` on the session's own
   * column. `clients` is `roster.length`, and `useRoster` reads `clients` where
   * `trainer_id = uid` plus `coach_clients` where `trainer_id = uid`. Two
   * different questions, and they disagree in both directions:
   *
   *   · A CLIENT WHO LEFT keeps their sessions and loses their roster row.
   *     `end_coaching()` (supabase/parts/68) nulls `clients.trainer_id` — the
   *     column the roster reads — and that file's own "what a coach keeps"
   *     section names the other half in as many words: "`sessions` —
   *     `sessions_trainer` is `trainer_id = auth.uid()` on the session's OWN
   *     column. Every session they ever delivered stays readable." So ten
   *     clients at AED 200 with one leaving after eight sessions read AED
   *     960/mo per client against a true AED 800. Reassignment inside a gym is
   *     an UPDATE of the same column and does the same thing.
   *
   *   · A HAND-ADDED CLIENT is in the denominator and can never reach the
   *     numerator. `sessions.client_id` is `references clients(id)`
   *     (supabase/setup.sql), and a `coach_clients` id is not in `clients` —
   *     app/(trainer)/videos.tsx spells the consequence out for grants:
   *     "a coach_clients id is a perfectly good uuid that is in no profile".
   *     A coach with ten linked clients and six cash clients had their per-
   *     client figure cut by well over a third, on a book where nothing was
   *     wrong. The screen already knows about this population — see
   *     `handAdded` and `driftSubjects` above, which exclude them from the
   *     drift verdict for the same reason.
   *
   * The reviewer's third suggestion — a GYM MEMBER who was never this coach's
   * client landing in the numerator — did NOT hold up and is not what this
   * fixes. `book_session()` in supabase/parts/09-sessions-access.sql updates
   * only `where … exists (select 1 from clients c where c.id = auth.uid() and
   * c.trainer_id = sessions.trainer_id)`, which is the same predicate the
   * roster reads, so nobody can take a slot from a coach they are not linked
   * to at the moment they book. Every stray in the numerator is somebody who
   * WAS linked and no longer is — the first bullet, not a third case.
   *
   * So the denominator is now the people the numerator is actually made of:
   * distinct clients with at least one session marked delivered inside the
   * window. Numerator and denominator over one population, and it needs no
   * roster read at all — which is why it survives a roster that came back
   * short, where the old figure quietly did not.
   *
   * `sessionMonthFor` per id rather than a second copy of the outcome rules:
   * what counts as delivered — `outcome === 'completed'`, bounded by
   * `startsAt`, never "booked and in the past" — is decided in exactly one
   * place, src/lib/coachRevenue.ts, and re-deriving it here is how this screen
   * and the hero above it would come to disagree about the same month.
   */
  const payingClients = useMemo(() => {
    if (!isWhole(sessionsStatus)) return null;
    const ids = new Set<string>();
    for (const s of sessions) if (s.clientId) ids.add(s.clientId);
    let n = 0;
    for (const id of ids) {
      const m = sessionMonthFor(sessions, new Set([id]), sessionsStatus, monthFrom, monthTo);
      if ((m.delivered ?? 0) > 0) n += 1;
    }
    return n;
  }, [sessions, sessionsStatus, monthFrom, monthTo]);
  // Null, not 0, with nobody in the denominator: an average over nobody is
  // undefined, and "0 / client" reads as a fact about a coaching business that
  // has none.
  //
  // No `Math.round` any more either. It rounded to a whole unit and then handed
  // the result to `wholeMoney`, which prints the currency's own decimals — so a
  // three-decimal currency was shown ".000" and a two-decimal one ".00", false
  // precision announced on a figure that had just been rounded away.
  // `currencyDecimals()` is the only thing that gets to decide how many places
  // this money has, and it is inside `wholeMoney`.
  const valuePerClient = revenue != null && payingClients ? revenue / payingClients : null;
  // Average over clients who have actually checked in. Averaging a null-as-100
  // default meant a roster of strangers reported 100% adherence.
  const _adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  // Same rule. 0% adherence is a damning number to show a coach whose clients
  // have simply never checked in — and this screen opens by saying so. An
  // average over a roster that came back short is the same kind of lie one step
  // removed: it is a real average of a set nobody chose.
  const avgAdh = rosterWhole && _adhKnown.length ? Math.round(_adhKnown.reduce((a, x) => a + x, 0) / _adhKnown.length) : null;
  /**
   * The reason there is no adherence figure, or null when there is one.
   *
   * Worded once and used by the average and all three bands in the digest
   * context below, so they cannot describe the same gap four different ways.
   * Begins with the word `unknown` because the coach-side prompts scan for
   * exactly that word and the edge function's own rule (coach-chat/index.ts)
   * forbids reporting a figure it was not given as zero.
   *
   * This is the twin of `adhGap` in app/(trainer)/assistant.tsx, which is the
   * screen this digest was copied from. A hand-added client has no Repple
   * account and no check-in screen to have been silent on, so `adherence` is
   * null for every one of them — and in the live database 2 of 4 clients are
   * hand-added. "No check-ins yet" is a sentence about people who have not
   * failed to do anything.
   */
  const adhGap = !rosterWhole || _adhKnown.length ? null
    : roster.length === 0
      ? 'unknown — there is nobody on this roster to have an adherence figure'
      : 'unknown — not one of the ' + roster.length + ' clients on this roster has a check-in on record'
        + (handAdded ? ' (' + handAdded + ' of them were added by hand and have no Repple account to record one with)' : '')
        + ', so state no adherence figure and do not say anyone is on track or at risk';
  // Clients with no check-in are counted as unknown, not as on-track. Null when
  // the roster is not whole: these three are a distribution, and a distribution
  // over an unknown fraction of the book is drawn to full width and read as
  // everybody.
  const onTrack = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 85).length : null;
  const watch = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 70 && c.adherence < 85).length : null;
  const riskCount = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence < 70).length : null;
  /**
   * The clients none of the three bands above counts.
   *
   * ── The zero over a list that was not empty ───────────────────────────
   *
   * Seen on an iPhone: "On track 0 · Watch 0 · At risk 0" and, a section
   * below it, "AT-RISK CLIENTS" listing a person by name. Nothing was broken
   * and every figure was true — the three bands are computed from
   * `adherence`, which is null for a client with no check-ins, and every one
   * of them was null. The at-risk list below is computed from
   * src/lib/clientDrift.ts, which is a different measure over a different
   * population and does have something to say about a client with nothing on
   * record.
   *
   * A coach does not read two definitions. They read a zero, then a name
   * under a heading that says the zero was wrong, and conclude the screen is
   * broken. So the fourth band is drawn: it makes the bar the whole roster
   * rather than the part of it that has check-ins, and it turns three zeroes
   * into the fact that was actually true — nobody has anything on record —
   * which is itself the thing to act on.
   */
  const noRecord = rosterWhole ? roster.filter((c) => c.adherence == null).length : null;
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
    // `receiptTakenRows`, not a fourth copy of the mapping. `receivedOn` is a
    // Postgres `date` and arrives as a bare `YYYY-MM-DD`; `since()` reads
    // `created_at` with `Date.parse`, which is UTC midnight, while `monthFrom`
    // is LOCAL midnight — so west of Greenwich this dropped every cash payment
    // a coach recorded as received on the FIRST of the month out of the hero
    // figure on this screen, silently, under a 'ready' status. app/(trainer)/
    // money.tsx already fixed this in its own memo; the rule now lives in
    // src/lib/coachReceipts.ts so the two screens cannot disagree about which
    // month somebody's cash was in.
    receipt: receiptTakenRows(receipts.rows),
  }), [sales.rows, renewals.rows, receipts.rows]);
  const takingsReads = useMemo(
    () => ({ sales: sales.status, renewals: renewals.status, receipts: receipts.status }),
    [sales.status, renewals.status, receipts.status],
  );
  /** What was taken this calendar month, or withheld with the reason. */
  // The strands are kept as well as their ledger: Revenue by Source draws each
  // one's pot as a slice, and reads them only once `ledger()` has stated a
  // total — which it does only when all three reads were whole.
  const takenStrands = useMemo(() => takingsStrands(takingsReads, {
    sale: since(takenRows.sale, monthFrom),
    renewal: since(takenRows.renewal, monthFrom),
    receipt: since(takenRows.receipt, monthFrom),
  }), [takingsReads, takenRows, monthFrom]);
  const takenMonth = useMemo(() => ledger(takenStrands), [takenStrands]);

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

  /* ── revenue by source: one ring per currency ────────────────────────────
   *
   * Built off `takenMonth.total`, which is null unless all three reads were
   * whole, so there is no ring over part of the month. Each slice is ONE
   * strand's pot in ONE currency; the ring's whole is that currency's pot in
   * the ledger's own total, so the shares are of money that may be added. */
  const SOURCE_TONE = { sales: 'brand', renewals: 'blue', receipts: 'amber' } as const;
  const SOURCE_NAME = { sales: 'Packages', renewals: 'Subscriptions', receipts: 'Recorded by You' } as const;
  const sourceDonuts = takenPots.map((pot) => {
    const slices: Slice[] = takenStrands.map((st) => {
      const part = st.taken.pots.find((x) => x.currency === pot.currency)?.minorUnits ?? 0;
      return {
        label: SOURCE_NAME[st.key as keyof typeof SOURCE_NAME] ?? st.label,
        tone: SOURCE_TONE[st.key as keyof typeof SOURCE_TONE] ?? 'neutral',
        value: part,
        shown: sharePercent(part, pot.minorUnits),
      };
    });
    const centre = minorMoney(pot.minorUnits, pot.currency);
    return {
      currency: pot.currency, slices, centre,
      spoken: `Revenue by source this month, ${centre ?? 'no figure'}: ${slices.map((x) => `${x.label} ${x.shown ?? 'no figure'}`).join(', ')}`,
    };
  });

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
    if (said) Alert.alert('Set on This Phone', said);
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
      // Was `takenOne ?? (takenMonth.reason ?? 'nothing recorded')`. The reason
      // arm is honest and stays; the bare fallback behind it was reached in
      // three different states and described one of them.
      //
      //   · TWO OR MORE CURRENCIES. `takenOne` is null whenever there is not
      //     exactly one pot, so a coach who took AED 6,000 and GBP 400 was
      //     telling the model nothing was recorded. The pots go over as they
      //     are printed on the screen, never added — src/lib/coachMoney.ts
      //     refuses that addition at the source and the prompt above repeats it.
      //   · AMOUNTS WITH NO CURRENCY ON THEM. `unlabelled` and `unpriced` are
      //     payments that are real and cannot be totalled (src/lib/coachLedger.ts
      //     counts them rather than dropping them), so an empty pot list with
      //     holes in it is a hole, not a quiet month.
      //   · A GENUINELY EMPTY MONTH. `takenMonth.total` is non-null only when
      //     every contributing read came back whole, so this one is a counted
      //     zero and says so — a figure, with the evidence for it attached.
      takenThisMonth: takenOne
        ?? takenMonth.reason
        ?? (takenPots.length > 1
          ? 'taken in ' + takenPots.length + ' separate currencies this month, which are never added into one figure: '
            + takenPots.map((pt) => minorMoney(pt.minorUnits, pt.currency)).filter(Boolean).join(', ')
          : takenHoles > 0
            ? 'unknown — ' + takenHoles + ' payment' + (takenHoles === 1 ? '' : 's') + ' recorded this month '
              + 'carr' + (takenHoles === 1 ? 'ies' : 'y') + ' no currency or no amount, so nothing can be totalled: '
              + 'state no takings figure and do not say they took nothing'
            : '0 — every takings read for this month (packages, subscription renewals and payments recorded by hand) '
              + 'came back whole and holds no payment, so this is a counted zero rather than a missing figure'),
      // Was `myCur ?? 'unknown — the gym has not set one'` — one string for six
      // states, four of which it describes wrongly, and after part 940 the
      // commonest of them is a coach who HAS no gym. See
      // src/lib/currencyForModel.ts.
      currency: currencyForModel(cur),
      clients,
      // Was `avgAdh != null ? avgAdh + '%' : 'no check-ins yet'` — the exact
      // line lane 89 replaced in assistant.tsx, and both halves of it were
      // wrong here for the same reasons. The fallback asserts a silence about
      // people who may have no account to have been silent from; the figure
      // itself is an average over whoever happens to have one, handed over
      // beside `clients: 4` with no denominator, so a model reads it as the
      // adherence of the whole book. It carries its own coverage now.
      avgAdherence: avgAdh != null
        ? _adhKnown.length === roster.length
          ? avgAdh + '%'
          : avgAdh + '% — averaged over the ' + _adhKnown.length + ' of ' + roster.length
            + ' clients who have a check-in on record, so it is not the whole book'
        : adhGap,
      // Null rather than a number when the training record did not come back.
      // The system prompt tells the model to say it was not given a figure
      // rather than guess at one; a zero here would have it write a paragraph
      // about a book where nobody is drifting.
      //
      // And `atRisk === null ? null : atRisk.length` left the emptiest read of
      // all reporting 0. `driftSubjects` is the roster MINUS the hand-added
      // clients, so a book that is entirely hand-added makes it empty;
      // `useClientDrift` short-circuits on an empty subject list and returns a
      // clean, empty map, `driftCovered` is true, the filter runs over nothing
      // and the digest told the coach nobody is drifting. Nobody had been
      // assessed. This screen did the filtering, so it is the only place that
      // knows what it removed — the same repair as assistant.tsx:391.
      atRiskClients: !rosterWhole ? null
        : driftSubjects.length === 0
          ? (roster.length
            ? 'unknown — all ' + roster.length + ' clients on this roster were added by hand and have no Repple '
              + 'account, so there is no training record to judge any of them by and nobody has been assessed'
            : null)
          : atRisk === null
            ? (dr.note ? 'unknown — ' + dr.note : null)
            : handAdded
              // The denominator travels with the number whenever it is not the
              // whole book, for the same reason `avgAdherence` now carries one.
              ? atRisk.length + ' of the ' + driftSubjects.length + ' clients with a Repple account; the other '
                + handAdded + ' were added by hand and have no training record, so they are in no count here'
              : atRisk.length,
      // The three bands are counted over the clients who have an adherence on
      // record, which is narrower than the roster — `noRecord` beside them on
      // the roster-health bar is exactly the clients they cannot see. Reported
      // as `0 / 0 / 0` when that set is empty they are three more all-clears
      // made out of an absence, so they hand over `adhGap` instead.
      onTrack: rosterWhole ? (_adhKnown.length ? onTrack : adhGap) : null,
      watch: rosterWhole ? (_adhKnown.length ? watch : adhGap) : null,
      atRiskLow: rosterWhole ? (_adhKnown.length ? riskCount : adhGap) : null,
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

  /* ── the board's window: adherence and completions over 7D / 30D / 90D / 1Y
   *
   * The board opens Analytics on a chip row and two figures with charts under
   * them, and neither figure existed on this screen: the KPI strip's
   * adherence is each client's NEWEST check-in averaged across the book, which
   * answers "how is the book now" and cannot be cut into weeks. These are the
   * same rating read across every check-in in the window, and the sessions
   * clients logged in it — src/ui/coach/analyticsRange.ts says where each comes
   * from and why it is not src/lib/adherence.ts's tick-rate.
   *
   * Three gates, in order, and the sentence under the figure names whichever
   * one closed:
   *   · the roster read was WHOLE — the ids handed to the read are the book,
   *     and a fragment of a book is not a smaller book;
   *   · somebody on it has an account — a hand-added client has no check-in
   *     screen and no workout log, so a roster that is all hand-added has
   *     nobody to measure, which is not the same as a book that did nothing;
   *   · the window's own read came back whole — capped reads produce no
   *     figure, because a mean over the rows that happened to come back is a
   *     wrong mean rather than a small one.
   *
   * The delta is gated on the SAME three for the window before, separately,
   * so the figure a coach is looking at is not withheld because the comparison
   * behind it came back short. */
  const [range, setRange] = useState<RangeKey>('30D');
  // Bumped by the pull below, like `driftNonce`: the window read re-runs on
  // its own when the ids or the window change, and a refresh changes neither.
  const [rangeNonce, setRangeNonce] = useState(0);
  const rangeDef = RANGES.find((r) => r.key === range) ?? RANGES[1];
  // `now` is the same instant the month figures use, so a coach who comes back
  // to this tab after midnight reads a window that has moved with the day.
  const win = useMemo(() => recentWindow(now, rangeDef.days), [now, rangeDef.days]);
  const prevWin = useMemo(() => priorWindow(win), [win]);
  const buckets = useMemo(() => bucketsOf(win, rangeDef.bucketDays), [win, rangeDef.bucketDays]);
  const prevBuckets = useMemo(() => (prevWin ? bucketsOf(prevWin, rangeDef.bucketDays) : []), [prevWin, rangeDef.bucketDays]);
  // The linked clients, and only off a whole roster: an empty list under a
  // short read is "nobody was asked", and the reason line below says so
  // before the read's own status gets a word.
  const rangeIds = useMemo(() => (rosterWhole ? driftSubjects.map((c) => c.id) : []), [rosterWhole, driftSubjects]);
  const curRead = useRangeActivity(rangeIds, win, rangeNonce);
  const prevRead = useRangeActivity(rangeIds, prevWin ?? win, rangeNonce);
  /** Why a window has no figure, or null when it may have one. */
  const rangeGap = (read: RangeRead): string | null => {
    if (rosterStatus === 'loading') return 'Reading your roster…';
    if (!rosterWhole) {
      return rosterStatus === 'partial'
        ? 'Your roster came back short, so this is not drawn — a figure over part of your book is not a figure about it.'
        : 'Your roster could not be read, so this is not drawn. It is unknown, not zero.';
    }
    if (read.status === 'loading') return 'Reading what your clients recorded…';
    if (read.asked < 1) {
      return clients === 0
        ? 'No clients yet. This fills in as clients join, check in and log their sessions.'
        : 'Everyone on your roster was added by hand, so there is no account behind them and nothing of theirs to read. They are not being counted as having done nothing.';
    }
    if (read.status === 'error') return 'Their records could not be read, so this is not drawn. It is unknown, not zero.';
    if (read.status === 'partial') return 'More was recorded in this window than one read returns, so this is not drawn — a figure over part of it would be stated as the whole.';
    return null;
  };
  const windowGap = rangeGap(curRead);
  const prevWindowGap = prevWin ? rangeGap(prevRead) : 'The window before this one could not be worked out.';
  const curFigures = useMemo(
    () => (windowGap == null && isWhole(curRead.status) ? rangeFigures(curRead, buckets) : null),
    [windowGap, curRead, buckets],
  );
  const prevFigures = useMemo(
    () => (prevWindowGap == null && isWhole(prevRead.status) ? rangeFigures(prevRead, prevBuckets) : null),
    [prevWindowGap, prevRead, prevBuckets],
  );
  const rangeLabels = buckets.map((b) => b.key);
  const beforeNote = `the ${rangeDef.days} days before`;
  /** The delta line under a figure: the movement against the window before,
   *  or the reason there is none. `deltaLabel` signs it, so a change of
   *  nothing reads "No change" rather than "−0". */
  const rangeDeltaLine = (cur: number | null, prev: number | null, unit: string): string | null => {
    if (cur == null) return null;
    if (prevWindowGap != null) {
      return prevRead.status === 'loading' && rosterWhole
        ? `Reading ${beforeNote} to compare…`
        : `Not compared with ${beforeNote}: ${prevWindowGap.charAt(0).toLowerCase()}${prevWindowGap.slice(1)}`;
    }
    if (prev == null) return `Nothing recorded in ${beforeNote} to compare with.`;
    return `${deltaLabel(cur - prev, { since: null, unit, decimals: 0 })} vs ${beforeNote}`;
  };
  // The gap between two percentages is in POINTS, and "+12%" beside "92%" says
  // something else: that adherence grew by an eighth, which from 80 would be
  // 89.6 and not 92. The review's own example reads "down 9 points".
  const adhMoved = curFigures?.adherence != null && prevFigures?.adherence != null
    ? Math.abs(Math.round(curFigures.adherence - prevFigures.adherence)) : null;
  const adhDeltaLine = rangeDeltaLine(curFigures?.adherence ?? null, prevFigures?.adherence ?? null, adhMoved === 1 ? 'point' : 'points');
  const doneDeltaLine = rangeDeltaLine(curFigures?.completions ?? null, prevFigures?.completions ?? null, '');
  /** The movement alone — "+12 points" — for the chip beside the figure, and
   *  only when there IS a comparison. Every no-baseline arm stays a sentence
   *  (`rangeDeltaLine`), because a chip reading "Not compared" is a state with
   *  its reason cut off. */
  const rangeChip = (cur: number | null, prev: number | null, unit: string): string | null =>
    cur == null || prev == null || prevWindowGap != null ? null : deltaLabel(cur - prev, { since: null, unit, decimals: 0 });
  const adhChip = rangeChip(curFigures?.adherence ?? null, prevFigures?.adherence ?? null, adhMoved === 1 ? 'point' : 'points');
  const doneChip = rangeChip(curFigures?.completions ?? null, prevFigures?.completions ?? null, '');
  /** Green only for movement upward; a fall, or no change, sits in ink. Read
   *  off `deltaSign` rather than the raw difference so the two never disagree
   *  about whether something moved. */
  const upward = (cur: number | null, prev: number | null): boolean =>
    cur != null && prev != null && deltaSign(cur - prev, 0) === '+';
  /** "1 client", "12 clients" — for the source line of a figure card, where the
   *  population a figure is over is half of what the figure means. `asked` is
   *  who the read was PUT to — every linked client — and not who answered, so
   *  the line says "across" and never "from" or "logged by". */
  const countOf = (n: number, noun: string) => `${num(n)} ${noun}${n === 1 ? '' : 's'}`;
  /** The window's span, as the axis would write it: "14 Aug to 12 Sep". */
  const winSpan = `${dayLabel(win.start)} to ${dayLabel(win.end)}`;

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
      setRangeNonce((n) => n + 1);
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
      const how = await shareTextFile(file.csv, file.filename, 'text/csv', 'Your Analytics');
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
  // Null-safe by construction: the ring is only rendered inside the branch
  // where all three counts are known.
  const healthSlices: Slice[] = [
    { label: STATUS_LABEL.on_track, value: onTrack, tone: 'brand', shown: onTrack == null ? null : num(onTrack) },
    { label: STATUS_LABEL.watch, value: watch, tone: 'amber', shown: watch == null ? null : num(watch) },
    { label: STATUS_LABEL.at_risk, value: riskCount, tone: 'red', shown: riskCount == null ? null : num(riskCount) },
    ...(noRecord ? [{ label: STATUS_LABEL.idle, value: noRecord, tone: 'neutral' as const, shown: num(noRecord) }] : []),
  ];
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <ScreenHeader eyebrow="Your coaching business" title="Analytics" />

        {/* ── the window ────────────────────────────────────────────────────
            The board's chip row, in the segmented-bar idiom the kit already
            uses: one pill, equal segments, the chosen one in ink. 30D leads,
            as the board has it. The chips change which days the two blocks
            below are read over — real windows, real reads — and nothing else
            on the screen, which is still the calendar month. */}
        {/* The kit's `Segmented` since round four, in place of the hand-built
            tablist: the same pill, the same ink fill and the same spoken
            "Last 30 days", plus the two things the copy here never had — the
            label gives up points before it truncates, and from 1.35 the four
            segments wrap two to a row instead of squeezing. */}
        <Segmented
          options={RANGES.map((r) => ({ key: r.key, label: r.label, a11yLabel: r.spoken }))}
          value={range}
          onChange={setRange}
          style={{ marginTop: sp.lg }}
        />

        {/* ── client adherence over the window ─────────────────────────────
            The mockup's first block: the Sora figure, its movement against
            the window before as a chip beside it, and a bar per period in two
            greens. `WindowFigure` above draws it; the dates the window covers
            and WHOSE check-ins it averages are the card's one quiet line. The
            figure is a dash and the chart is not drawn under any read that was
            not whole — the sentence in the chart's place says which read, and
            that a dash is unknown rather than nought. */}
        <WindowFigure
          title="Client Adherence"
          figure={curFigures?.adherence == null ? null : String(curFigures.adherence)}
          unit={curFigures?.adherence == null ? undefined : '%'}
          chip={adhChip}
          up={upward(curFigures?.adherence ?? null, prevFigures?.adherence ?? null)}
          chipNote={`vs ${beforeNote}`}
          line={adhChip ? undefined : adhDeltaLine ?? undefined}
          tail={[winSpan, curFigures?.adherence == null ? null : `${countOf(curFigures.checkIns, 'check-in')}, across ${countOf(curRead.asked, 'client')} with an account`].filter(Boolean).join(' · ')}
          spoken={`Client adherence, ${rangeDef.spoken.toLowerCase()}, ${winSpan}: ${curFigures?.adherence == null ? 'not drawn' : `${curFigures.adherence} percent`}. ${adhDeltaLine ?? windowGap ?? ''}`}
        >
          {curFigures == null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{windowGap}</Text>
          ) : curFigures.adherence == null ? (
            // A whole read with nothing in it. Said rather than drawn as a
            // row of empty slots, which reads as a chart that failed.
            <Text style={{ ...ty.label, color: t.ink3 }}>No check-ins from {winSpan}, so there is no adherence to average.</Text>
          ) : (
            <RangeBars data={curFigures.adherenceByBucket} prior={prevFigures?.adherenceByBucket ?? null}
              labels={rangeLabels} unit="%" max={100} what="Client adherence" priorNote={beforeNote} />
          )}
        </WindowFigure>

        {/* ── program completions over the window ────────────────────────
            The mockup's second block, as its blue area chart. One completion
            is one session a client logged — a program day done — and the
            unit says "sessions", because "completions" under a bare count
            would otherwise be read as programs finished, which nothing in
            the record marks. The longer account is in How These Are Counted. */}
        <WindowFigure
          title="Program Completions"
          figure={curFigures == null ? null : num(curFigures.completions)}
          unit={curFigures == null ? undefined : (curFigures.completions === 1 ? 'session' : 'sessions')}
          chip={doneChip}
          up={upward(curFigures?.completions ?? null, prevFigures?.completions ?? null)}
          chipNote={`vs ${beforeNote}`}
          line={doneChip ? undefined : doneDeltaLine ?? undefined}
          tail={[winSpan, curFigures == null ? null : `Across ${countOf(curRead.asked, 'client')} with an account`].filter(Boolean).join(' · ')}
          spoken={`Program completions, ${rangeDef.spoken.toLowerCase()}, ${winSpan}: ${curFigures == null ? 'not drawn' : `${curFigures.completions} session${curFigures.completions === 1 ? '' : 's'} logged`}. ${doneDeltaLine ?? windowGap ?? ''}`}
        >
          {curFigures == null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{windowGap}</Text>
          ) : (
            // Spark takes the counts as they are: a period with no session
            // under a whole read is a counted zero and is drawn at the
            // baseline, not left as a hole.
            <Spark data={curFigures.completionsByBucket} labels={rangeLabels} area tone="blue" />
          )}
        </WindowFigure>

        {/* ── revenue by source ────────────────────────────────────────────
            The mockup's third card. ONE DONUT PER CURRENCY and never one for
            the month: a ring is a whole, and AED 6,000 beside GBP 400 is not
            a whole of anything. `sourceDonuts` is empty unless `ledger()`
            stated a total, which it does only when all three reads were whole
            — a ring over two strands of three would draw the missing one as
            nought per cent, in colour. The mockup's Classes slice is not
            drawn: class takings are not a strand this app records apart from
            packages, and a slice nobody measured is a made-up one. */}
        <Section>
          <SectionHead title="Revenue by Source" note="Money" onPress={() => router.push('/(trainer)/money')} />
          {takenMonth.reason ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{takenMonth.reason}</Text>
          ) : sourceDonuts.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Nothing is recorded as taken this month, so there is no split to draw.</Text>
          ) : sourceDonuts.map((d, i) => (
            <View key={d.currency} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.lg, marginTop: i === 0 ? 0 : sp.lg }}>
              <Donut slices={d.slices} centre={d.centre} sub="this month" spoken={d.spoken} />
              <Legend items={d.slices} />
            </View>
          ))}
          {sourceDonuts.length > 1 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>One ring per currency. They are never added together.</Text>
          ) : null}
          {takenHoles > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {num(takenHoles)} payment{takenHoles === 1 ? '' : 's'} with no currency or no amount {takenHoles === 1 ? 'is' : 'are'} in no ring.
            </Text>
          ) : null}
        </Section>

        {/* ── the roster, as tiles ─────────────────────────────────────────
            On the ground between the cards, the way the kit means tiles to
            sit. All three are already computed below under a whole roster
            read and are dashes otherwise; the notice under this strip says
            why. They are the roster AS IT STANDS and not the window chosen
            above — the one line under them says so, because a strip directly
            under a "Last 30 days" card would otherwise borrow its dates. */}
        <KpiRow tiles items={[
          { label: 'Adherence', value: avgAdh == null ? fig(null) : String(avgAdh), unit: avgAdh == null ? undefined : '%', tone: 'brand' },
          { label: 'Clients', value: fig(clients), tone: 'blue' },
          { label: 'At Risk', value: fig(riskCount), tone: 'red' },
        ]} />
        {rosterWhole ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Your roster as it stands today, not the window above.</Text>
        ) : null}

        {/* The explaining that sat under each chart, word for word, behind one
            fold. The owner's note on this screen was that it read as prose
            with charts in it; the definitions are still one tap away, and the
            sentences that state WHY a figure is withheld stayed on the cards. */}
        <Expandable title="How These Are Counted" note="Adherence, completions and the roster strip">
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Adherence is each client's own rating at check-in, as a percentage, averaged over the check-ins from {winSpan}. Each bar is {rangeDef.bucketDays === 1 ? 'a day' : 'a week, starting on the date under it'}; a gap is a {rangeDef.bucketDays === 1 ? 'day' : 'week'} nobody checked in on, not a zero.
            {prevFigures?.adherenceByBucket.some((v) => v != null) ? ` The fainter bar beside each is the same ${rangeDef.bucketDays === 1 ? 'day' : 'week'} of ${beforeNote}.` : ''}
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Completions are workout sessions your clients logged from {winSpan}, by the day they trained. A session logged is a program day done, not a whole program finished. Nothing in the record marks that.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            In the roster strip, Adherence is the average of each client’s own check-in rating{avgAdh == null ? '' : `, over the ${_adhKnown.length} who have one`}; At Risk is anyone under 70% on it.
          </Text>
        </Expandable>

        {/* The densest figures screen in either app. Two of the things this
            file already explains to itself in prose — delivered is marked, and
            Value / Client is over a different population than Clients — are
            said to the coach here. */}
        <ScreenHelp screen="coach-analytics" />

        {/* Said once, at the top, because it is the reason every figure below
            is a dash. Without it the screen reads as a coaching business with
            nothing in it rather than as a screen that could not look. */}
        {figureStatus === 'error' ? (
          <Notice tone={t.warn} kicker="Analytics" title="These Figures Could Not Be Worked Out"
            note={rosterStatus === 'error' && sessionsStatus === 'error'
              ? 'Neither your roster nor your sessions came back, so nothing on this screen has been counted. Every dash below means unknown, not zero.'
              : rosterStatus === 'error'
                ? 'Your roster did not come back, so nothing counted over your clients has been worked out. Every dash below means unknown, not zero.'
                : 'Your sessions did not come back, so nothing counted over them has been worked out. Every dash below means unknown, not zero.'} />
        ) : figureStatus === 'partial' ? (
          <PartialRead what={rosterStatus === 'partial' ? 'clients on your book' : 'sessions in your calendar'} />
        ) : null}

        {/* ── at-risk revenue: the one thing to act on ──────────────────────
            Above the month's figures rather than under them: the
            relationships at risk come before the turnover they may affect.
            Everything about the card is as it was — a dash and never "~$0"
            without a rate, and no card at all unless the roster came back
            whole and the training record behind the verdict landed. */}
        {atRisk && atRisk.length > 0 ? (<>
          <Rule />
          <View style={{ marginTop: sp.md }}>
            <Card tone={t.warn}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>Revenue at Risk</Text>
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
          </View>
        </>) : null}


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

        {/* ── RETENTION, BEFORE DELIVERY AND MONEY ─────────────────────────
            The data-layout review's order for this screen: client outcomes,
            then retention and who is at risk, then the coach's own delivery
            and takings, then where clients come from, and comparisons last.
            Roster Health, At-risk Clients and How Long People Stay were the
            thirteenth, seventeenth and sixteenth things on the page — under
            the goals, the revenue chart and last year — so the question "who
            am I about to lose" was answered after "how did August compare".
            They are moved, whole and unre-worded, to directly under the
            at-risk card they explain. */}

        {/* ── roster health ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster Health"
            note={!rosterWhole ? undefined : avgAdh == null ? 'No check-ins yet' : `${avgAdh}% avg adherence`} />
          {/* The ring is withheld rather than drawn from what loaded. A ring
              always closes, so a split computed over a short roster is
              rendered as the whole book at whatever proportions the fragment
              happened to have — the one chart on this screen that cannot show
              its own incompleteness. Three zeroes would be worse still: an
              empty ring under "Roster health" reads as a roster in trouble. */}
          {onTrack == null || watch == null || riskCount == null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterStatus === 'loading'
                ? 'Reading your roster…'
                : rosterStatus === 'partial'
                  ? 'Your roster came back short, so the split between on-track, watch and at-risk is not drawn — a share of part of your book is not a share of it.'
                  : 'Your roster could not be read, so the split between on-track, watch and at-risk is not drawn. It is unknown, not empty.'}
            </Text>
          ) : (<>
            {/* Four bands, and the fourth is the one that was missing. See
                `noRecord` above: without it this bar was drawn over the
                clients who have check-ins and read as though it were drawn
                over the book. */}
            {/* A ring and its legend since round five, the same drawing
                coach Home uses for the same four bands, so the two screens
                read as one picture of one roster. The legend carries every
                count in words; the colours repeat it. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.lg }}>
              <Donut slices={healthSlices} centre={fig(clients)} sub={clients === 1 ? 'client' : 'clients'}
                spoken={`Roster health: ${healthSlices.map((x) => `${x.label} ${x.shown}`).join(', ')}`} />
              <Legend items={healthSlices} />
            </View>
            {/* Which measure these bands are, in one line, because the At-risk
                list below is a different one. Two measures on one screen is
                fine; two with nothing saying so is how a coach comes to
                distrust both. The idle band's longer account is behind How
                These Are Counted. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Measured on check-in adherence{noRecord ? `; ${noRecord === 1 ? 'one client has' : `${num(noRecord)} clients have`} no check-ins and ${noRecord === 1 ? 'is' : 'are'} ${STATUS_LABEL.idle.toLowerCase()}, not on track` : ''}. At-risk Clients below measures each client against their own pattern.
            </Text>
          </>)}
        </Section>


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
          <SectionHead title="At-Risk Clients" />
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
                : !rosterWhole
                  ? 'Your roster did not come back whole, so who is drifting cannot be worked out — this is not a clean bill of health for your book.'
                  /* The truncated read gets its own sentence, and it is the
                     provider's — `dr.note`. A read that came back at the row
                     ceiling is not a roster that came back short, and sending a
                     coach off to their Clients tab would send them after a
                     problem that is not there. Said second because a short
                     roster is the more fundamental of the two and is the one
                     they can do something about. */
                  : (dr.note ?? 'More activity is on record than one request returns, so who is drifting cannot be worked out from it — this is not a clean bill of health for your book.')}
            </Text>
          ) : atRisk.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Everyone is holding their own pattern.</Text>
          ) : atRisk.map((c, i) => (
            <View key={c.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              {/* The dot, the label and the line under the name all used to be
                  re-derived here from `adherence` and from `lastActive`, which
                  is a display string. They are the verdict's own now, so this
                  row cannot say something different from the band it was put
                  in. `idle` is drawn in the quieter tone on purpose: it is not
                  a judgement about the client, it is the absence of one. */}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dr.driftFor(c.id)!.reason}</Text>
              </View>
              {/* The band as words on a plate, where a 6pt dot was: red for
                  at risk, amber for the quieter band. The words are the
                  state; the colour finds the row. */}
              <TonedChip label={DRIFT_LABEL[dr.driftFor(c.id)!.status]}
                tone={dr.driftFor(c.id)?.status === 'at_risk' ? 'red' : dr.driftFor(c.id)?.status === 'idle' ? 'neutral' : 'amber'} />
            </View>
          ))}

          {/* Who this section did not consider, said out loud. Drawn whatever
              the drift read did — the people it names are outside the list for
              a reason that has nothing to do with how the read went, and a
              coach comparing this section against their Clients tab is
              otherwise looking at two different books with no explanation of
              which. */}
          {handAddedNote ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{handAddedNote}</Text>
          ) : null}

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
            <ListRow icon="bell" tone="amber" title="Quiet Clients"
              note="Who is breaking their own pattern, and a draft you read and send yourself"
              onPress={() => router.push('/(trainer)/nudges')} />
          </View>
        </Section>


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
            {/* Each cohort as its own short stack of meters since round
                five: how many of the people who started that month were still
                with the coach at one, three, six and twelve months, as a bar
                out of the cohort's size. The count is the bar's own note, so
                it is printed and spoken; the percentage joins it only where
                the cohort clears the floor. A milestone the cohort has not
                REACHED draws no fill and says so — a zero there would draw as
                a collapse, and "not read" would be the wrong reason. */}
            {cohortRows.map((row, i) => (
              <View key={row.month} style={{
                paddingTop: i === 0 ? 0 : sp.md, marginTop: i === 0 ? 0 : sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.sm }}>
                  <Text style={{ ...ty.label, ...font('700'), color: t.ink, flexShrink: 1 }}>{monthLabelOf(row.month)}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(row.size)} joined</Text>
                </View>
                {row.held.map((h, k) => (
                  <Meter key={MILESTONES[k]} label={`${MILESTONES[k]} Month${MILESTONES[k] === 1 ? '' : 's'}`}
                    val={h} target={row.size} tone="teal"
                    note={h == null ? 'Not reached yet' : `${num(h)} of ${num(row.size)}${row.retained[k] != null ? ` · ${row.retained[k]}%` : ''}`} />
                ))}
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COHORT_CAVEAT}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{COHORT_FLOOR_NOTE}</Text>
          </>)}
        </Section>


        {/* ── DELIVERY AND TAKINGS ─────────────────────────────────────────
            The coach's own month: what they delivered, what was taken, the
            targets they set against both, and the trend. Third in the review's
            order, under the clients' outcomes and under who is at risk. */}

        {/* ── the hero ─────────────────────────────────────────────────────
            WHICH figure leads is the one thing `delivery` decides here. A coach
            who trains people in the room leads on the sessions they delivered;
            a coach who works remotely sells no sessions at all, so leading on a
            session count would open their business analytics on a nought. Both
            figures are on the screen either way and neither is ever removed —
            the order is what changes.

            Every unknown resolves to the in-person layout, so a coach whose
            roster failed to load, or who has not answered how they coach, gets
            the screen they have always had.

            A kit FigureCard now, not the retired `Hero`: the same figure and
            the same sentence under it, with the period and whose word it is
            on the card's last line. The ring Hero drew for the revenue goal is
            not carried over — Your Goals, below, draws that same progress as a
            bar beside its target, and one goal drawn twice in two shapes is
            two things to reconcile. */}
        {sessionsLead ? (
          <FigureCard
            title="Sessions Delivered"
            note="Payments"
            onPress={() => router.push('/(trainer)/payments')}
            figure={sessionsMo == null ? null : num(sessionsMo)}
            period="This month"
            source={sessionsMo == null ? undefined : 'From the outcomes you marked'}
            detail={sessionsMo == null
              ? sessionsUnknownLine(sessionsStatus)
              : revenue != null && sessionFee != null
                ? (myCur
                    ? `${fig(priced(revenue))} at your ${fig(priced(sessionFee))} session rate. ${DELIVERED_IS_MARKED} Repple does not process this, so it is your own arithmetic and not a payout.`
                    : noCur('there is no unit to price these sessions in'))
                : `Set a session rate in your profile to see what that is worth. ${DELIVERED_IS_MARKED}`}
          />
        ) : (
          <FigureCard
            title="Taken This Month"
            note="Money"
            onPress={() => router.push('/(trainer)/money')}
            figure={takenOne}
            period="This month"
            source={takenOne == null ? undefined : 'Recorded payments, gross'}
            detail={takenNote}
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
              <Text style={{ ...ty.micro, color: t.ink3 }}>Not Yet Marked</Text>
            </View>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {unmarkedLine(month)}
              {unmarkedWorth != null && priced(unmarkedWorth) != null
                ? ` At your rate that is ${priced(unmarkedWorth)} either way.`
                : ''}
            </Text>
          </Card>
        ) : null}


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


        {/* ── the shape of the business ──────────────────────────────────── */}
        <Section>
          {/* No way onward from this head any more. It opened the Leaderboard,
              which the review puts LAST on this screen — a ranking of clients
              against each other is a comparison, not an outcome — and it has
              its own row at the foot of the page. */}
          <SectionHead title="Roster" />
          <KpiRow items={[
            { label: 'Clients', value: fig(clients) },
            { label: 'Avg Adherence', value: fig(avgAdh), unit: avgAdh == null ? undefined : '%' },
            { label: 'Value / Client', value: fig(priced(valuePerClient)), unit: priced(valuePerClient) == null ? undefined : '/mo' },
          ]} />
          {/* The third figure is not the first two divided into each other, and
              a row of three numbers reads as though it were. Said out loud
              rather than left to be inferred — see `payingClients` above for
              what dividing across the two populations cost. */}
          {valuePerClient != null && priced(valuePerClient) != null ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {payingClients === 1
                ? 'Value per client is over the one client who trained with you this month, not over the roster beside it.'
                : `Value per client is over the ${payingClients} clients who trained with you this month, not over the ${clients == null ? 'roster' : `roster of ${clients}`} beside it. Somebody who has left keeps the sessions they took, and a client you added by hand has no bookings to count — so the two are different sets of people and dividing one by the other is not this figure.`}
            </Text>
          ) : null}
        </Section>


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
              // The kit's Meter since round five, in place of a hand-built
              // 3pt bar: the same two numbers at the trailing edge, an 8pt
              // bar that can be seen, and a progressbar role with its value.
              <View key={g.label} style={{ marginBottom: sp.lg }}>
                <Meter label={g.label} val={g.cur} target={g.goal} tone={g.money ? 'brand' : 'blue'}
                  note={`${g.money ? fig(priced(g.cur)) : num(g.cur)} / ${g.money ? fig(priced(g.goal)) : num(g.goal)}`} />
                <View style={{ marginTop: sp.sm }}>
                  {hit
                    ? <TonedChip label="Goal Reached" icon="check" />
                    : <Text style={{ ...ty.caption, color: t.ink3 }}>{Math.round(pc * 100) + '% there'}</Text>}
                </View>
              </View>
            );
          })}
        </Section>


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
          {/* ── "Tracking started" over a month that simply did not move ──
              `historyDelta` returns 0 for TWO different things and says so in
              its own header: "0 when either end is missing — and 0 here means
              'no comparison'". A coach who billed the same in August as in
              July has both ends present and a real delta of zero, and this
              line told them tracking had only just begun — under a chart
              already drawing six months of their history.

              The two are separable without touching that function: `series` is
              on the hook, and `series[length - 2]` is the previous month's
              column — null when there is nothing to compare against, a number
              when there is. That is the same slot `historyDelta` reads, so the
              branch here cannot drift from the arithmetic it is describing.

              The flat case prints no amount, which is not a dodge: zero is the
              one figure whose currency does not change what it means, so there
              is nothing to withhold and nothing to guess. */}
          <SectionHead title="Revenue Trend"
            note={revenue == null ? 'This month not recorded'
              : revHist.series[revHist.series.length - 2] == null ? 'Tracking started'
              : revHist.delta === 0 ? 'Level with last mo'
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
          <Spark data={chartSeries} labels={chartLabels} area />
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


        {/* ── where clients come from ──────────────────────────────────────
            Fourth and fifth in the review's order: referrals and enquiries,
            then what the advertising cost. Referrals and Enquiries had no row
            on this screen at all — one was a tile on the Clients tab and the
            other was reachable from Ad Spend and from search — so the screen
            a coach opens to ask "is the business growing" could not take them
            to either half of the answer. Rows and no figures: each of those
            screens owns a read this one does not make, and a count copied here
            would be a second number to keep honest.

            Ad Spend sits under them because it is the same question one step
            on — what it cost to bring them in. It was reachable ONLY from an
            Explore search result before it had a row here, which finds it for
            a coach who already knows the phrase "ad spend" and for nobody
            else. */}
        <Section>
          <SectionHead title="Where Clients Come From" />
          <ListRow icon="people" tone="purple" title="Who Brings You Clients"
            note="Clients whose code brought somebody in, and how many started training"
            onPress={() => router.push('/(trainer)/referrals')} />
          <ListRow icon="message" tone="blue" title="Enquiries"
            note="People who asked about coaching without joining, and who has waited longest"
            onPress={() => router.push('/(trainer)/leads')} />
          <ListRow icon="trending" tone="orange" title="Ad Spend"
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
            <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>
              {digestBusy ? 'Writing…' : !figuresWhole ? 'Needs figures it could not read' : digest ? 'Regenerate' : 'Generate Digest'}
            </Text>
          </Pressable>
        </Section>


        <Section>
          {/* The conversational half of the digest above. The digest answers
              one fixed question this app wrote; a coach's second question has
              never had anywhere to go. It sends the same figures through the
              same filter — see app/(trainer)/assistant.tsx for why it will not
              name a client. */}
          <ListRow icon="sparkle" tone="purple" title="Ask the Assistant"
            note="A conversation about your own figures, with no client named to it"
            onPress={() => router.push('/(trainer)/assistant')} />
          {/* Out of the app. The statement already does this for the money and
              the coach has the habit; analytics had no share action at all, so
              the one screen a coach would show an accountant was the one screen
              they could only photograph. Every unknown figure leaves as an
              EMPTY cell — see src/lib/analyticsExport.ts for why a zero in a
              spreadsheet is worse than a dash on a screen. */}
          <ListRow icon="share" tone="teal" title={exportBusy ? 'Exporting…' : 'Export These Figures'}
            note="A CSV of the figures above and every month you have recorded"
            onPress={() => { void exportAnalytics(); }} />
          <ListRow icon="chart" tone="brand" title="Payments"
            note="Who bought what, and the price list they buy from"
            onPress={() => router.push('/(trainer)/payments')} />
        </Section>

        {/* ── and the comparison, last ─────────────────────────────────────
            The review's sixth item. A leaderboard ranks clients against each
            other, which is motivating for them and says nothing about whether
            any of them is getting what they came for — so it closes the page
            rather than heading the Roster section, where it used to be the
            first way onward a coach met. */}
        <Section>
          <ListRow icon="trophy" tone="amber" title="Leaderboard"
            note="Your clients ranked by consistency — a comparison, not an outcome"
            onPress={() => router.push('/(trainer)/leaderboard')} />
        </Section>

      </ScrollView>

      {/* ── goal editor ──────────────────────────────────────────────────── */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setGoalOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Set Your Goals</Text>
          {/* The parenthetical names the unit the coach is typing in, so with
              no currency set it rendered as the literal label "Monthly revenue
              target (—)" — a bracket around a dash, which names nothing and
              reads as a rendering fault rather than as a missing setting. It is
              the common case, not a rare one: 35 of the 54 live tenants have
              `tenants.currency` NULL. Dropped entirely when there is no unit to
              name, and the sentence under the field says what that means. */}
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Monthly Revenue Target{myCur ? ` (${myCur})` : ''}</Text>
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
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Client Target</Text>
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
