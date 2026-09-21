// Owner · Overview — the platform operating console. Real roll-ups (MRR + MoM
// delta, ARR, trainers, clients), an at-risk-MRR churn callout, a trainer-health
// board (score + risk, tap for detail), and an accumulating MRR trend.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same modal — the four tinted
// stat boxes and eleven bordered cards became one hero figure plus
// hairline-separated sections, and the Georgia serif header is gone.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { Icon, type IconName } from '../../src/ui/Icon';
import { FORWARD_ICON } from '../../src/ui/direction';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ScreenHeader, KpiRow, ListRow, Card, Cta, Ghost, QuickRow, Spark, Notice, Flag, AttentionRow, ChartShell, HeroCard, DayBars, Donut, Legend, Meter, TonedChip, fig } from '../../src/ui/kit';
import { NotificationBell } from '../../src/ui/notifications';
import { sp, layout, radius, hairline, type as ty, value, font, grown } from '../../src/theme/scale';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { num } from '../../src/lib/format';
import { plainExact } from '../../src/lib/units';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { gymRollup, trainerHealth, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { riskLabel } from '../../src/lib/status';
import { HealthPill } from '../../src/ui/charts';
import { deltaSign, deltaMagnitude, deltaMoved, pctChange } from '../../src/lib/deltaLabel';
import { sharePercent } from '../../src/lib/sharePercent';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';
import { cohorts } from '../../src/lib/ownerAnalytics';
import { ownerReportDoc, shareDoc, pdfExportAvailable } from '../../src/lib/exportShare';
import { reportError } from '../../src/lib/reportError';
import { Linking } from 'react-native';
import { supabase } from '../../src/lib/supabase';
// The two reads the approved look added to this console, and the clock both
// are cut on. The till is `gym_payments`, the read Revenue already leads with;
// the week is the rota's own diary read, `fetchDemand`. Neither is new to the
// product, and both go through the gym's zone for the reason src/lib/gymMonth.ts
// and src/lib/rotaClock.ts give: a month or a day cut on the reader's midnight
// files four hours of a Gulf gym's takings under the wrong one.
import { fetchPayments, sharedCurrency, normaliseCurrency, money, type GymPayment } from '../../src/lib/gymRecord';
import { fetchDemand } from '../../src/lib/gymRota';
import { fetchGymZone } from '../../src/lib/gymZone';
import { gymRecentMonths, gymMonthKey, monthAtGym } from '../../src/lib/gymMonth';
import { monthKeyOf } from '../../src/lib/monthEnd';
import { rotaToday, rotaDay, rotaInstant, addCalendarDays } from '../../src/lib/rotaClock';
import { calendarDateText, whoseClockNote } from '../../src/lib/gymWhen';
import { useToday } from '../../src/ui/today';
// The six settings a gym is computed from, and which of them nobody has set.
// Shared with the console's Overview, which draws the same six from its own
// screens — see the header of src/lib/gymSetup.ts for the counts against the
// live database that made this worth drawing at all, and for why the list
// holds no routes.
import {
  assessGymSetup, setupLine, needsSetup,
  type SetupFacts, type SetupItem, type SetupKey, type TenantSettings,
} from '../../src/lib/gymSetup';

// Labels come from the one settled scale now — see src/lib/status.ts for why
// "Not delivering" is gone and what "Idle" does and does not mean.

export default function OwnerOverview() {
  const t = useTheme(); const router = useRouter();
  // `loading` is destructured because the provider exposes it for exactly one
  // reason: until the roster read returns, every roll-up below is computed over
  // an empty array. Ignoring it put "Sessions delivered · 30 days · 0" and "No
  // trainers yet" on the console's biggest figure while the query was still in
  // flight — an owner opening the app first thing was told their gym delivered
  // nothing last month, in the same confident type used when it is true.
  // `refresh` is taken because the failed-read card below used to end "pull
  // down to try again" over a ScrollView with no RefreshControl on it — the
  // gesture did nothing, and the dashboard was the one owner screen with no
  // retry of any kind. Revenue and Trainers both offer the provider's own
  // `refresh` behind a button; this is that, here.
  const { trainers, loading, status: trainersStatus, sessions30, payroll30, refresh } = usePlatformTrainers();
  const { tenant, status: tenantStatus, refresh: refreshTenant } = useTenant();
  /** When the roster every figure on this console is a roll-up of last came
   *  back. Derived from the provider's `status`, so a refresh that FAILED
   *  leaves the stamp on the read the figures actually came from. */
  const [trainersAt, setTrainersAt] = useState<number | null>(null);
  useEffect(() => { if (trainersStatus === 'ready') setTrainersAt(Date.now()); }, [trainersStatus]);
  // `loading` covered the in-flight case. It does not cover the read having
  // FAILED — that also leaves `trainers` empty, and every roll-up below then
  // computes a confident 0 over it. Same wrong sentence, arrived at a second
  // later: an owner told their gym delivered nothing last month.
  //
  // ── And the roster is only as trustworthy as the TENANT read under it ────
  //
  // `PlatformTrainersProvider` (src/ui/trainers.tsx) destructures `tenant` from
  // `useTenant()` and never reads its `status`. A refused tenant read leaves
  // `tenant` null — which that provider treats as "this account has no gym at
  // all, so there is no roster we are failing to read" — and it publishes an
  // empty roster under status 'ready'. Every guard on this screen then passes
  // cleanly, and the empty-roster sentence below is stated over a read that
  // failed one level up.
  //
  // `worstStatus` is the house answer for a screen fed by more than one read:
  // it is only as complete as its worst. `src/ui/memberChurn.ts` already checks
  // the tenant status the same way, which is why the churn half of these
  // screens has never had this hole.
  const rosterStatus = worstStatus(tenantStatus, trainersStatus);
  const trainersUnread = rosterStatus === 'error';
  // `isWhole`, not `!== 'error'`. Neither read emits 'partial' today —
  // `fetchGymTrainers` calls `assertWhole` and throws rather than degrading, and
  // the tenant is a single row — so this is the house rule holding rather than a
  // live miscount being fixed. That is the difference between a gate that is
  // right and one that happens to be.
  const trainersUnknown = loading || !isWhole(rosterStatus);
  // The gym's own currency (`tenants.currency`, part 99). Null until the tenant
  // read returns, null for a gym that has not chosen one, and null when the
  // read failed — and `gymMoney` renders a DASH for all three rather than a
  // figure in a currency nobody chose.
  //
  // This comment used to end "and gymMoney falls back to GYM_CURRENCY for that
  // window", which was true once and is not now: src/ui/tenant.tsx makes
  // `gymMoney` a straight call to `wholeMoney`, whose contract is "a null
  // amount or a missing currency renders a dash, and there is no fallback
  // currency", and that file's own header says `gymMoney` no longer touches
  // GYM_CURRENCY. The sentence is kept here rather than deleted because of the
  // direction it was wrong in: it read as an instruction, and a future reader
  // "restoring" the fallback it describes would put back the exact defect parts
  // 150 and 940 were written to end — an owner's money screen denominated in a
  // currency somebody else picked. Repple is white-labelled; there is no
  // default currency anywhere in it, and a dash is the honest answer.
  const cur = tenant?.currency ?? null;
  // The tenant is the OTHER read this console renders — the gym's name in the
  // header and the currency every money figure below is denominated in — and it
  // has its own stamp for the same reason the roster does.
  const [tenantAt, setTenantAt] = useState<number | null>(null);
  useEffect(() => { if (tenantStatus === 'ready') setTenantAt(Date.now()); }, [tenantStatus]);
  /** One line over two reads, and it is the age of the older of them. A stamp
   *  that took whichever landed last would label an hour-old roster with the
   *  age of a tenant read that had just come back. */
  const fetchedAt = oldestFetch(trainersAt, tenantAt);
  // The failed-read card below ends "pull down to try again". Until this it did
  // not: the ScrollView had no RefreshControl and the gesture the card names did
  // nothing. Both of this screen's reads are asked again, because both of them
  // are on it.
  /* ── what this gym has not set up yet ────────────────────────────────────
   *
   * Three reads of its own, and not one of them is a row this screen already
   * holds. `useTenant` carries the name, the currency and the session fee and
   * has never carried the TIMEZONE — which is the setting every gym on the
   * platform is missing — and nothing in the owner app has ever counted the
   * price book or the register.
   *
   * The counts are `head: true, count: 'exact'`: the server does the counting
   * and sends no rows back, so there is no thousand-row ceiling to fall off
   * and no `isWhole` question to get wrong. A count that arrives is one the
   * server confirmed; a count that does not arrive stays null, and null is a
   * question nobody answered rather than a price book with nothing in it.
   *
   * The tenants row is read here rather than taken from `useTenant` for the
   * same reason: four settings from one query settle together, so a single
   * refusal makes all four unknown at once instead of leaving three of them
   * looking established by a read that never happened.
   */
  const [setupTenant, setSetupTenant] = useState<TenantSettings | null>(null);
  const [setupPlans, setSetupPlans] = useState<number | null>(null);
  const [setupMembers, setSetupMembers] = useState<number | null>(null);
  const tenantId = tenant?.id ?? null;
  const loadSetup = useCallback(async () => {
    if (!tenantId) return;
    const [gymRes, planRes, memberRes] = await Promise.allSettled([
      supabase.from('tenants').select('name, currency, session_fee, timezone').eq('id', tenantId).single(),
      supabase.from('membership_plans').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ]);
    // Each one is set back to null on failure rather than left at its last
    // value. A stale tick is worse than a blank here: it is the one state that
    // says "nothing to do" about a setting nobody has just checked.
    const row = gymRes.status === 'fulfilled' && !gymRes.value.error
      ? (gymRes.value.data as { name: string | null; currency: string | null; session_fee: number | null; timezone: string | null } | null)
      : null;
    setSetupTenant(row
      ? { name: row.name, currency: row.currency, timezone: row.timezone, sessionFee: row.session_fee }
      : null);
    setSetupPlans(planRes.status === 'fulfilled' && !planRes.value.error ? planRes.value.count ?? null : null);
    setSetupMembers(memberRes.status === 'fulfilled' && !memberRes.value.error ? memberRes.value.count ?? null : null);
    // Arguments in the order reportError declares them — `(context, err)`. This
    // was the one reversed call in the repository, and it typechecks because
    // PromiseRejectedResult.reason is `any`. The row it filed read
    // `[Error: …the real message…] owner.dashboard.setup`, with the label and
    // the error swapped; the stack was dropped, because `err` was a string and
    // reportError only keeps a stack for an Error; and the once-a-minute
    // throttle keys on context + detail, so it grouped per MESSAGE instead of
    // per context and stopped throttling anything.
    //
    // And it was on a branch that almost never fires. supabase-js RESOLVES on a
    // database error rather than rejecting, so the real failure is
    // `res.value.error` — which the three lines above already test, to blank the
    // checklist, and then never reported. An RLS refusal emptied the owner's
    // setup checklist and left no trace at all. Reported for all three reads
    // rather than only the gym one: they fail the same way and blank the same
    // checklist.
    if (gymRes.status === 'rejected') reportError('owner.dashboard.setup', gymRes.reason);
    else if (gymRes.value.error) reportError('owner.dashboard.setup', gymRes.value.error);
    if (planRes.status === 'rejected') reportError('owner.dashboard.setup.plans', planRes.reason);
    else if (planRes.value.error) reportError('owner.dashboard.setup.plans', planRes.value.error);
    if (memberRes.status === 'rejected') reportError('owner.dashboard.setup.members', memberRes.reason);
    else if (memberRes.value.error) reportError('owner.dashboard.setup.members', memberRes.value.error);
  }, [tenantId]);
  useEffect(() => { void loadSetup(); }, [loadSetup]);

  /* ── the till and the week: the two pictures the approved look leads with ──
   *
   * `undefined` is "not read yet", `null` is "could not be read", and only an
   * array is an answer — the three states Revenue keeps for the same payments,
   * for the same reason: a refused read and a gym that recorded nothing are
   * both an empty list, and only one of them is a fact about the gym.
   *
   * ONE zone read ahead of both, and a refusal of it holds BOTH back. The month
   * the hero names and the seven days under it are cut on the gym's clock; a
   * zone that could not be read is not a gym with no zone (src/lib/gymZone.ts
   * keeps the two apart), and cutting on the phone's clock under a failed read
   * would caption the reader's September as the gym's.
   *
   * What the read was cut WITH is kept beside the rows — the month keys, the
   * day list and the instant it was asked — so everything derived below is
   * arithmetic over one settled read and no memo has a clock inside it.
   *
   * Seven months: the one running, and the six finished ones the hero's line
   * is drawn over. A month still running is not a point on that line — on the
   * 3rd it would draw as a collapse.
   *
   * ponytail: seven months of payment ROWS are paged to the phone to make seven
   * sums, through the one reader every money screen already trusts. Fine at a
   * few thousand payments; if a gym's till outgrows that, the upgrade is a
   * per-month, per-currency roll-up on the server, not a second reader here.
   */
  const [till, setTill] = useState<{ rows: GymPayment[]; zone: string | null; keys: string[]; asOf: number } | null | undefined>(undefined);
  const [week, setWeek] = useState<{ days: { day: string; count: number }[]; zone: string | null } | null | undefined>(undefined);
  const [again, setAgain] = useState(0);
  // The calendar day, kept current while the console stays mounted: a tab root
  // is never torn down, and a week read on Monday is not Thursday's week.
  const today = useToday();
  useEffect(() => {
    if (tenantStatus === 'error') { setTill(null); setWeek(null); return; }
    // No gym on a read that SETTLED is not a read still in flight.
    if (!tenantId) { setTill(tenantStatus === 'loading' ? undefined : null); setWeek(tenantStatus === 'loading' ? undefined : null); return; }
    let on = true;
    (async () => {
      let zone: string | null;
      try {
        const z = await fetchGymZone(supabase, tenantId);
        if (z.error) throw new Error(z.error);
        zone = z.zone;
      } catch (e) {
        reportError('owner.dashboard.zone', e);
        if (on) { setTill(null); setWeek(null); }
        return;
      }
      const asOf = Date.now();
      const keys = gymRecentMonths(7, zone, asOf).keys;
      const from = monthAtGym(keys[keys.length - 1] ?? '', zone)?.window.fromIso ?? null;
      const last = rotaToday(zone, asOf);
      const days = [6, 5, 4, 3, 2, 1, 0].map((n) => addCalendarDays(last, -n));
      const weekFrom = rotaInstant(days[0], 0, zone);
      const weekTo = rotaInstant(addCalendarDays(last, 1), 0, zone);
      // Settled apart: a refused diary must not blank the takings, and a
      // refused till must not hide a week that did come back.
      const [pay, diary] = await Promise.allSettled([
        from ? fetchPayments(supabase, tenantId, from, new Date(asOf).toISOString()) : Promise.reject(new Error('no month window')),
        weekFrom && weekTo ? fetchDemand(supabase, tenantId, weekFrom, weekTo) : Promise.reject(new Error('no week window')),
      ]);
      if (!on) return;
      // Both throw on a refusal AND on a truncated read, so a fulfilled one is
      // whole. Null on rejection — a dash and a sentence, never a quiet week.
      if (pay.status === 'fulfilled') setTill({ rows: pay.value, zone, keys, asOf });
      else { reportError('owner.dashboard.payments', pay.reason); setTill(null); }
      if (diary.status === 'fulfilled') {
        // One-to-ones only, which is what "session" means on every other
        // figure here; `fetchDemand` has already left the cancelled ones out.
        const pt = diary.value.filter((d) => d.kind === 'pt');
        setWeek({
          zone,
          days: days.filter((d): d is string => d != null)
            .map((day) => ({ day, count: pt.filter((d) => rotaDay(d.startsAt, zone) === day).length })),
        });
      } else { reportError('owner.dashboard.week', diary.reason); setWeek(null); }
    })();
    return () => { on = false; };
  }, [tenantId, tenantStatus, again, today]);

  /**
   * The month running at the gym, in money somebody recorded receiving.
   *
   * Null when there is no whole money read to lead with — not read, refused,
   * or a till nobody has used in seven months — and the hero then falls back
   * to the session count, which is the figure this console led with before.
   *
   * NEVER SUMMED ACROSS CURRENCIES. The running month is potted by the
   * currency each row states and every pot is its own line. The comparison
   * and the line are drawn only where every row they are made of states the
   * SAME currency (`sharedCurrency`), because a percentage of dirhams over
   * pounds is not a percentage.
   *
   * The comparison is like for like: this month so far against the SAME SPAN
   * of the month before. Twenty days of September against all of August reads
   * as a third of the gym's income gone, on every day but the last.
   */
  const revenue = useMemo(() => {
    if (!till || !till.rows.length) return null;
    const { rows, zone, keys, asOf } = till;
    const keyOf = (at: string) => gymMonthKey(at, zone) ?? monthKeyOf(new Date(at));
    const [nowKey, prevKey] = keys;
    const mine = rows.filter((r) => keyOf(r.takenAt) === nowKey);
    const pots = new Map<string | null, number>();
    for (const r of mine) { const c = normaliseCurrency(r.currency); pots.set(c, (pots.get(c) ?? 0) + r.amountCents); }
    // A running month with nothing in it yet is a real nought, in the one
    // currency the rest of the till agrees on, or the gym's own.
    const lines = mine.length
      ? [...pots.entries()].map(([c, cents]) => money(cents, c))
      : [money(0, sharedCurrency(rows) ?? cur)];

    const nowFrom = Date.parse(monthAtGym(nowKey ?? '', zone)?.window.fromIso ?? '');
    const prevFrom = Date.parse(monthAtGym(prevKey ?? '', zone)?.window.fromIso ?? '');
    const span = asOf - nowFrom;
    const before = Number.isFinite(span) && Number.isFinite(prevFrom)
      ? rows.filter((r) => keyOf(r.takenAt) === prevKey && Date.parse(r.takenAt) < prevFrom + span) : [];
    const sum = (list: GymPayment[]) => list.reduce((a, r) => a + r.amountCents, 0);
    const change = mine.length && before.length && sharedCurrency([...mine, ...before])
      ? pctChange(sum(mine), sum(before)) : null;

    // Six FINISHED months, oldest first. A month before the first payment in
    // hand is unknown rather than nought: the till may not have been in use.
    const ended = keys.slice(1).reverse();
    const past = rows.filter((r) => keyOf(r.takenAt) !== nowKey);
    const firstKey = past.length ? past.map((r) => keyOf(r.takenAt)).sort()[0] : null;
    const series = past.length && sharedCurrency(past) && firstKey
      ? ended.map((k) => (k < firstKey ? null : sum(past.filter((r) => keyOf(r.takenAt) === k))))
      : null;
    const monthName = (k: string | undefined) => (k ? calendarDateText(`${k}-01`, { month: 'long' }) : null);
    return {
      lines, count: mine.length, mixed: pots.size > 1, change, series,
      month: monthName(nowKey), prevMonth: monthName(prevKey),
      from: monthName(ended[0]), to: monthName(ended[ended.length - 1]),
      clock: whoseClockNote(zone),
    };
  }, [till, cur]);

  const refreshAll = useCallback(() => { refresh(); refreshTenant(); void loadSetup(); setAgain((n) => n + 1); }, [refresh, refreshTenant, loadSetup]);
  const pull = usePullToRefresh(refreshAll);
  const setup: SetupItem[] = assessGymSetup({
    tenant: setupTenant,
    plans: setupPlans,
    members: setupMembers,
  } satisfies SetupFacts);
  const roll = gymRollup(trainers as TrainerLike[], tenant?.sessionFee ?? null);
  // This hook PERSISTS what it is handed, so a figure we are unsure of is not
  // wrong for a second — it is saved as this month's history and nothing later
  // can tell it from a month that really was quiet. `sessions30` is already null
  // under a failed read; the `loading` half is added here because a sum over a
  // roster still in flight is a zero for the same reason and keeps for as long.
  // `status` was destructured away here and on the revenue screen, and it is
  // the one available LoadStatus on this screen that was not gated. Under
  // 'error' the hook skips the merge and lets THIS DEVICE'S CACHE stand alone,
  // and the delta and the "Not enough history yet" sentence were both computed
  // over it — the second of those being a claim about the gym made over months
  // that were never read.
  const { series, labels, delta, months, status: histStatus } = useSessionsHistory(trainersUnknown ? null : sessions30);
  const histWhole = isWhole(histStatus);
  const [sel, setSel] = useState<TrainerLike | null>(null);

  // Client load per trainer. The old version split revenue by Repple plan,
  // which is what a trainer pays us, not anything the gym earns.
  const byTrainer = [...trainers].sort((a, b) => b.clients - a.clients).slice(0, 5);
  const maxLoad = Math.max(1, ...byTrainer.map((x) => x.clients));
  // Trainers sorted worst-health first so problems surface at the top.
  const ranked = [...(trainers as TrainerLike[])].map((tr) => ({ tr, h: trainerHealth(tr) })).sort((a, b) => a.h.score - b.h.score);
  // Sessions in the 30 days that carry an outcome other than completed — a
  // no-show, a cancellation, a late cancellation. All three keep `status =
  // 'booked'` (see the note over the figure card below), so they are inside
  // `sessions30` and inside neither `delivered30` nor `unmarked30`, and the
  // remainder is exactly them. Floored at zero so a roster mid-refresh cannot
  // draw a negative count.
  const notDelivered30 = Math.max(0, roll.sessions30 - roll.delivered30 - roll.unmarked30);
  const selHealth = sel ? trainerHealth(sel) : null;
  // ── The failed-payments callout is gone, and it should never have been here.
  //
  // It read `invoices`, which is the Stripe ledger for a TRAINER paying REPPLE
  // (part 20) — not gym money. It is a survivor of the subscription console
  // this app used to be. So a gym owner was shown "AED X in failed payments,
  // retry or chase before they churn" over other people's platform bills, in a
  // currency it hardcoded, and the money their own members owe them was never
  // on this screen at all.
  //
  // The Trainers screen states the principle in its own header: what a trainer
  // pays Repple is "not a number a gym owner has any business seeing on their
  // own dashboard".
  //
  // It was also reading across every gym in the project. `invoices` has no
  // tenant column, and the policy's second arm was an unscoped
  // `role = 'owner'`, so the query returned every trainer's invoices
  // everywhere. Part 106 removes that arm; this removes the reader.
  //
  // The gym's own receivables are `gym_invoices` (part 29) and its payments are
  // `gym_payments`, read by the Members screen. A callout over those would be
  // the right feature — it is not this one.
  const exportReport = async () => {
    // The one artefact on this screen that leaves the app. Every figure in it
    // is a roll-up of `trainers`, and ownerReportDoc prints each one as a bare
    // String(...) with no way to render an unknown — so a refused roster read
    // produced a document headed with the gym's name reading "Trainers: 0 /
    // Clients: 0 / Sessions · 30d: 0", which the owner then sent to a bank, a
    // landlord or a board. On screen a wrong figure is corrected by the next
    // refresh; in somebody else's inbox it is permanent, and nothing in the
    // document says where the zeroes came from. So the share is refused rather
    // than dashed: there is no honest version of this report to send yet.
    if (trainersUnknown) {
      Alert.alert(
        loading ? 'Still Reading Your Roster' : 'Roster Could Not Be Read',
        loading
          ? 'Your trainers have not come back yet, so every figure in the report would be a zero this app has not confirmed. Try again in a moment.'
          : 'Your trainers could not be read, so a report built now would state that your gym has no trainers, no clients and no sessions, none of which this app found out. Reload the roster and share it then.',
      );
      return;
    }
    const doc = ownerReportDoc({
      trainers: roll.trainers, clients: roll.clients, sessions30: roll.sessions30,
      payroll30: roll.payroll30, atRiskCount: roll.atRiskCount, atRiskClients: roll.atRiskClients,
      avgClientsPerTrainer: roll.avgClientsPerTrainer,
      cohorts: cohorts(trainers as TrainerLike[]),
      generatedOn: new Date().toLocaleDateString(),
      // The gym's own currency, and `?? null` rather than a fallback. Until
      // this arrived the report's one money line rendered a dash for every gym
      // — `money()` refuses to guess — and before that it printed dirhams at
      // gyms that have never seen one. Null is passed through honestly so a gym
      // that has not chosen a currency gets the withheld line and the sentence
      // under the table saying why, rather than a figure in somebody's guess.
      currency: cur,
    });
    const how = await shareDoc(doc.html, doc.text, 'Platform Report');
    // Which of the three reasons it fell back to text, rather than asserting
    // the one that is now usually false. shareDoc returns 'text' when
    // printToFileAsync is MISSING, when it THREW, or when sharing is
    // unavailable — and only the first is a build problem. expo-print and
    // expo-sharing are dependencies now and are in ios/Podfile.lock, so on a
    // current binary the old sentence sent an owner to wait for an App Store
    // update for a PDF that had simply failed to render.
    //
    // The same reasoning as the wearable copy in oauthConfig.ts and the
    // withdrawn Google Calendar row: an update the reader cannot get, offered
    // as the fix for something an update would not change. Where a newer build
    // GENUINELY is the answer this app still says so — calendar.tsx keeps
    // exactly that sentence, and says in a comment why it earned it.
    if (how === 'text') {
      Alert.alert('Report Shared', pdfExportAvailable()
        ? 'Shared as text. The PDF could not be produced on this phone. Nothing is missing from the figures.'
        : 'Shared as text. This build cannot make a PDF. A newer build of the app can.');
    }
  };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board's opening on every tab root: a quiet eyebrow, the title,
            and the round controls at the trailing edge. The owner's own gym,
            not "Repple HQ · Platform" — this app is one gym's console, and the
            previous wording read like an internal admin tool belonging to
            somebody else. Said "in Ops" once: Ops gained the session FEE; the
            gym's NAME is in Brand. */}
        <ScreenHeader
          eyebrow="Your Gym"
          title={tenant?.name?.trim() || 'Name Your Gym in Brand'}
          actions={<>
            <Ghost icon="search" a11yLabel="Search every screen" onPress={() => router.push('/(owner)/explore')} />
            {/* Quiet by design — nothing in the product addresses an owner
                today except what a coach in their gym sends them. It is here
                anyway, and it is here with a mark that distinguishes "nothing
                for you" from "we could not find out", which is the difference
                that matters on a screen an owner reads at a glance. */}
            <NotificationBell group="owner" />
            <Ghost icon="share" a11yLabel="Share a platform report" onPress={exportReport} />
          </>}
        />

        {/* ── the hero ───────────────────────────────────────────────────── */}
        {/* ── "Delivered" was the one word this figure could not carry ─────
            `roll.sessions30` is every booking whose clock has passed, WHATEVER
            its outcome — src/lib/ownerAnalytics.ts says so at the field and
            src/lib/gymTrainers.ts:155 counts it that way: a no-show, a
            cancellation and a late cancellation all keep `status = 'booked'`
            (markOutcome writes `outcome` and never touches `status`), so all
            three are in here and in neither `delivered30` nor `unmarked30`.

            The money underneath is `payroll30`, which is `delivered30 × fee` —
            the sessions somebody actually marked completed. So the two halves of
            one hero counted two different populations, and an owner dividing the
            money by the figure above it reads a session fee the gym does not
            charge. The count is worth having and the word was not; `delivered`
            now appears only beside the figure that means it. */}
        {/* The figure is a card now, the way the coach's Payments card leads
            with its own: the kit's `Hero` sat bare on the ground and was the one
            block on this screen the board does not draw. The tap through to
            Revenue is the head's trailing note rather than the whole block. */}
        {/* ── and since the approved look, the hero is the night card ────────
            Revenue where a whole money read exists, the session count where it
            does not — chosen by what is WHOLE, money preferred, because the
            month's takings is the first thing an owner opens this console to
            learn and the session count was only ever standing in for it.

            The figure is the card's `title`, so eyebrow, figure and meta are
            one spoken sentence with the header role, as the FigureCard said
            them. Two currencies are two lines of it and never one total. */}
        {(() => {
          const open = () => router.push('/(owner)/revenue');
          if (till === undefined && !revenue) {
            return <HeroCard eyebrow="REVENUE" title="—" meta="Reading what your gym was paid…" onPress={open} />;
          }
          if (revenue) {
            const pay = `${num(revenue.count)} payment${revenue.count === 1 ? '' : 's'} recorded`;
            return (
              <HeroCard onPress={open}
                eyebrow={revenue.month ? `REVENUE · ${revenue.month.toUpperCase()}` : 'REVENUE · THIS MONTH'}
                title={revenue.lines.map((l) => fig(l)).join('\n')}
                meta={revenue.mixed ? `Month to date · ${pay}, in more than one currency, so there is no one total` : `Month to date · ${pay}`}
                ring={revenue.series ? (
                  <NightSpark data={revenue.series}
                    spoken={`Takings by month, ${revenue.from ?? 'six months ago'} to ${revenue.to ?? 'last month'}. Open Revenue for the figures.`} />
                ) : undefined}>
                {/* Only where both spans are whole AND in one currency — see
                    `revenue`. Bright when it is up; the amber plate when it is
                    not, because a dip is "slipping" and red is "needs you". */}
                {revenue.change != null && revenue.prevMonth ? (
                  <View style={{ marginTop: sp.md }}>
                    {deltaMoved(revenue.change, 0) && revenue.change > 0 ? (
                      <View accessible accessibilityRole="text" style={{ alignSelf: 'flex-start', minHeight: grown(26), justifyContent: 'center', paddingHorizontal: 11, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: t.brandBright }}>
                        <Text style={{ ...ty.micro, ...font('700'), letterSpacing: 0, color: t.brandDeep }}>
                          {`${deltaSign(revenue.change, 0)}${deltaMagnitude(revenue.change, 0)}% vs ${revenue.prevMonth} to the same day`}
                        </Text>
                      </View>
                    ) : (
                      <TonedChip tone={deltaMoved(revenue.change, 0) ? 'amber' : 'neutral'}
                        label={deltaMoved(revenue.change, 0)
                          ? `${deltaSign(revenue.change, 0)}${deltaMagnitude(revenue.change, 0)}% vs ${revenue.prevMonth} to the same day`
                          : `Level with ${revenue.prevMonth} to the same day`} />
                    )}
                  </View>
                ) : null}
                {/* A money caveat, so it stays on the page: whose clock the
                    month was cut on, said only when it was not the gym's. */}
                {revenue.clock ? (
                  <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.md }}>
                    {`${revenue.clock.charAt(0).toUpperCase()}${revenue.clock.slice(1)}.`}
                  </Text>
                ) : null}
              </HeroCard>
            );
          }
          const note = loading
            ? 'Reading your roster…'
            : trainersUnread
            ? 'Your trainers could not be read'
            : !histWhole
            ? 'Your recorded months could not be read'
            : delta !== 0
            ? `${deltaSign(delta, 0)}${num(Math.abs(delta))} vs last month`
            : roll.payroll30 == null
              ? 'Set a session fee in Ops to value these'
              // Null here also covers "the gym has not set a currency", and an
              // unguarded ${} would say "Worth null at your session fee".
              : gymMoney(roll.payroll30, cur) == null
              ? "Set your gym's currency in Ops to value these"
              : `${num(roll.delivered30)} marked delivered · worth ${gymMoney(roll.payroll30, cur)} at your session fee`;
          return (
            /* `fig` draws the dash for an unread roster: null is "not
               counted", and a 0 here told an owner their gym delivered
               nothing last month. */
            <HeroCard eyebrow="SESSIONS · 30 DAYS" onPress={open}
              title={fig(trainersUnknown ? null : num(roll.sessions30))} meta={note}
              ring={histWhole && months >= 2 ? (
                <NightSpark data={series} spoken={`Sessions by month, ${labels[0] ?? ''} to ${labels[labels.length - 1] ?? ''}. The trend is further down.`} />
              ) : undefined} />
          );
        })()}

        {/* ── the three figures under the hero, as tiles on the ground ─────
            Sessions blue, delivered in the accent, unmarked red: the colours
            the rest of the app gives the same three things. Only the first has
            a trend, because only the first has a HISTORY — `useSessionsHistory`
            has recorded it monthly; nothing has ever recorded the other two,
            and a strip drawn from one reading would be a picture of nothing. A
            dash here is explained by the card under it. */}
        <KpiRow tiles onPress={(k) => { if (k.route) router.push(k.route as never); }} items={[
          { label: 'Sessions · 30d', tone: 'blue', route: '/(owner)/revenue',
            value: fig(trainersUnknown ? null : num(roll.sessions30)), trend: histWhole ? series : undefined },
          // `sharePercent` is null for a gym with no finished session, which is
          // "no share to state" and not 0%.
          { label: 'Delivered', tone: 'brand', route: '/(owner)/trainers',
            value: fig(trainersUnknown ? null : sharePercent(roll.delivered30, roll.sessions30)),
            delta: trainersUnknown ? undefined : `${num(roll.delivered30)} of ${num(roll.sessions30)} sessions` },
          { label: 'Unmarked', tone: 'red', route: '/(owner)/trainers',
            value: fig(trainersUnknown ? null : num(roll.unmarked30)),
            delta: trainersUnknown ? undefined : 'finished, no outcome recorded' },
        ]} />

        {/* The console's own age. Every figure on this screen is a roll-up of
            one read, and nothing on the page used to say when it happened or
            whether the phone could still reach us. Under the figure rather
            than in the header, so nothing procedural sits in the first
            viewport — the same move Home made. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={loading} />

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {/* First, because for a gym in this state everything under it is a
              dash and this is the reason for all of them. Draws nothing at all
              once the six are set — and nothing while the reads are in flight,
              since an unsettled read leaves every item 'unknown' rather than
              outstanding. */}
          <SetUp items={setup} onGo={(r) => router.push(r as never)} />
        </View>

        {!loading && roll.trainers === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {trainersUnread
                ? 'Your trainers could not be read, so this is not "no trainers".'
                : 'No trainers yet. Clients, delivered sessions and trainer health fill in as they join your gym.'}
            </Text>
            {trainersUnread ? (
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Try Again" onPress={refresh} />
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* ── sessions by day: the last seven days of the diary ────────────
            The rota's own read (`fetchDemand`), over the seven gym days ending
            today, so this is the same count the Rota checks cover against.
            BOOKED one-to-ones with the cancelled ones left out — not the same
            population as the 30-day figure above, which keeps them — and the
            head says so rather than letting the two be added up. */}
        <Section>
          <SectionHead title="Sessions by Day" note="Booked · Last 7 Days" onPress={() => router.push('/(owner)/rota')} />
          <ChartShell status={week === undefined ? 'loading' : week === null ? 'error' : 'ready'}
            // Seven day-counts are seven readings; a week with nothing in it
            // is the one state in which "none booked" is a fact.
            points={week && week.days.some((d) => d.count > 0) ? week.days.length : 0}
            loadingLine="Reading the last seven days…"
            errorLine="The last seven days could not be read, so no week is drawn. That is a failed read, not a week with nothing booked. Pull down to try again."
            emptyLine="No one-to-one was booked in the last seven days.">
            {week ? (
              <DayBars
                days={week.days.map((d) => ({ label: calendarDateText(d.day, { weekday: 'short' }) ?? '', value: d.count, tone: 'brand' as const }))}
                spoken={`One-to-ones booked by day. ${week.days.map((d) => `${calendarDateText(d.day, { weekday: 'long' }) ?? d.day}, ${num(d.count)}`).join('. ')}.`} />
            ) : null}
          </ChartShell>
          {week && whoseClockNote(week.zone) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {`${whoseClockNote(week.zone)!.charAt(0).toUpperCase()}${whoseClockNote(week.zone)!.slice(1)}.`}
            </Text>
          ) : null}
        </Section>

        {/* ── needs a look: who, and WHY, on the row ────────────────────────
            Was a Notice carrying a count, the most urgent name and a Review
            button. A count sends an owner into a sheet to learn what the
            warning is about; the sentence that flagged each trainer is already
            in hand (`trainerHealth().reason`), so each one is a row that says
            it. High before watch before idle, and within each the worst score
            — the order `ranked` and `urgent` were already in.

            The counts keep the `=== 1` form: "1 client ARE with them" shipped
            from a `> 1`, and on a small gym one is the commonest case. */}
        {!trainersUnknown && roll.atRiskCount > 0 ? (
          <Section>
            <SectionHead title="Needs a Look"
              note={`${roll.atRiskCount} Trainer${roll.atRiskCount === 1 ? '' : 's'} · ${roll.atRiskClients} Client${roll.atRiskClients === 1 ? '' : 's'}`} />
            {[...ranked.filter((r) => r.h.risk === 'high'), ...ranked.filter((r) => r.h.risk === 'watch'), ...ranked.filter((r) => r.h.risk !== 'ok' && r.h.risk !== 'high' && r.h.risk !== 'watch')]
              .map(({ tr, h }, i) => (
                <AttentionRow key={tr.id} divider={i > 0}
                  icon="bell" name={tr.name} reason={h.reason}
                  status={riskLabel(h.risk)}
                  tone={h.risk === 'high' ? t.crit : h.risk === 'watch' ? t.warn : t.ink3}
                  age={`${tr.clients} client${tr.clients === 1 ? '' : 's'} with them`}
                  onPress={() => setSel(tr)} />
              ))}
          </Section>
        ) : null}

        {/* ── trainer health board ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer Health" note="All" onPress={() => router.push('/(owner)/trainers')} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            // Ahead of the empty branch: an unread roster scores nobody, which
            // is not the same as there being nobody to score.
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so none of them were scored. Nobody here has been cleared.</Text>
          ) : ranked.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers to score yet.</Text>
          ) : ranked.map(({ tr, h }, i) => (
            // Delivered OF booked, over the same thirty days as every other
            // figure on this console — the figure the score is computed from.
            // The WHY moved to Needs a Look above for anyone flagged, and is
            // one tap away in the sheet for everyone else.
            <HealthRow key={tr.id} divider={i > 0} name={tr.name} score={h.score} band={h.tone}
              caption={`${num(tr.delivered30 ?? 0)} of ${num(tr.sessions30)} delivered${(tr.unmarked30 ?? 0) > 0 ? ` · ${num(tr.unmarked30 ?? 0)} unmarked` : ''} · ${riskLabel(h.risk)}`}
              onPress={() => setSel(tr)} />
          ))}
        </Section>
        {/* Under the board rather than over it since the approved look: what a
            score is made of is reference, and it sat between the hero and the
            people it describes. Still here, because "worst first" is a
            conversation with a person and an owner should be able to learn
            what put them there before having it. */}
        <ScreenHelp screen="owner-trainers" />

        {/* ── delivery: what happened to the sessions above ───────────────── */}
        {/* The review's order for this screen is attention → one live metric →
            today's sessions, attendance and delivery exceptions → trainer
            health → members → money → administration. The week above is the
            diary; THIS is the roster read — thirty days of sessions per
            trainer — and what it can stand behind: of the sessions whose clock
            has passed, how many were marked delivered, how many carry another
            outcome, and how many nobody has marked at all. Today's floor is
            one tap away on the Rota, which reads the gym's own day in the
            gym's own zone.

            Three populations that sum to the figure in the middle, named
            separately because they are different facts: prescribed is not
            completed is not skipped. A mix, so it is a donut — and under an
            unread roster it is the grey track and three dashes, never an even
            split. */}
        <Section>
          <SectionHead title="Delivery · 30 Days" note="Today’s Rota" onPress={() => router.push('/(owner)/rota')} />
          {(() => {
            const n = (v: number) => (trainersUnknown ? null : v);
            const slices = [
              { label: 'Delivered', value: n(roll.delivered30), tone: 'brand' as const, shown: trainersUnknown ? null : num(roll.delivered30) },
              { label: 'Awaiting Outcome', value: n(roll.unmarked30), tone: 'amber' as const, shown: trainersUnknown ? null : num(roll.unmarked30) },
              { label: 'Missed or Cancelled', value: n(notDelivered30), tone: 'red' as const, shown: trainersUnknown ? null : num(notDelivered30) },
            ];
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg, flexWrap: 'wrap' }}>
                <Donut slices={slices} centre={trainersUnknown ? null : num(roll.sessions30)} sub="sessions"
                  spoken={trainersUnknown
                    ? (loading ? 'Delivery, not read yet' : 'Delivery could not be read')
                    : `Of ${num(roll.sessions30)} sessions in 30 days, ${num(roll.delivered30)} delivered, ${num(roll.unmarked30)} awaiting an outcome, ${num(notDelivered30)} missed or cancelled`} />
                <Legend items={slices} />
              </View>
            );
          })()}
          {trainersUnknown ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{loading ? 'Reading your roster…' : 'Your trainers could not be read, so none of these were counted.'}</Text>
          ) : null}
          {/* The exception, with its consequence beside it. `payroll30` is null
              while ANY session is unmarked, so this is also the reason the
              payroll figure lower down is a dash for a gym whose fee is set. */}
          {!trainersUnknown && roll.unmarked30 > 0 ? (
            <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
              {`${num(roll.unmarked30)} finished session${roll.unmarked30 === 1 ? '' : 's'} ${roll.unmarked30 === 1 ? 'has' : 'have'} no outcome recorded, so the last 30 days cannot be valued for payroll yet. The trainer who ran ${roll.unmarked30 === 1 ? 'it marks it' : 'them marks them'} in their own app.`}
            </Flag>
          ) : null}
          <View style={{ marginTop: sp.md }}>
            <Rule />
            {/* Moved up from the quiet list at the foot of the screen:
                attendance belongs with delivery, and it was six rows below
                anything it explained. */}
            <ListRow icon="calendar" title="Classes & Payroll" note="Attendance, fill rates & trainer pay per check-in"
              onPress={() => router.push('/(owner)/class-analytics')} />
          </View>
        </Section>
        {/* ── the shape of the platform ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Gym" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
          <KpiRow items={[
            { label: 'Trainers', value: trainersUnknown ? '—' : fig(roll.trainers), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.avgSessionsPerTrainer == null ? 'no trainers yet' : `${plainExact(roll.avgSessionsPerTrainer)} sessions avg` },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(num(roll.clients)), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.avgClientsPerTrainer == null ? 'no trainers yet' : `${plainExact(roll.avgClientsPerTrainer)} avg / trainer` },
            // The delta names the population the money is priced over, which is
            // `delivered30` and not the count in the hero above. Without it the
            // two figures sit on one screen with nothing saying they are made of
            // different sessions.
            //
            // `unmarked30 > 0` is asked FIRST. `gymRollup` returns a null
            // payroll while any session is unmarked, fee or no fee, and this
            // delta read "no session fee set" to a gym whose fee was set — an
            // instruction to fix a setting that was already right.
            { label: 'Payroll · 30d', value: trainersUnknown ? '—' : fig(gymMoney(roll.payroll30, cur)), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.unmarked30 > 0 ? `${num(roll.unmarked30)} still unmarked` : roll.payroll30 == null ? 'no session fee set' : `${num(roll.delivered30)} of ${num(roll.sessions30)} delivered, at your fee` },
          ]} />
        </Section>


        {/* ── client load per trainer ────────────────────────────────────── */}
        <Section>
          {/* The note read "Revenue", which named neither what the section
              shows — a client count per coach — nor the state it is in. It is
              the label on the tap target through to Revenue, so it says so. */}
          <SectionHead title="Client Load" note="Open Revenue" onPress={() => router.push('/(owner)/revenue')} />
          {/* Every other section on this screen says what an empty one means;
              this was the one that drew its heading over blank space. With no
              trainers — which is two of the three owner gyms in the live
              database — an owner saw a title, a rule, and nothing between. */}
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so their client load is not known.</Text>
          ) : byTrainer.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers to show a client load for yet.</Text>
          ) : byTrainer.map((p) => (
            // The kit's Meter, against the busiest trainer: the same bar the
            // rest of the app draws, 8pt rather than the 3pt hairline this had,
            // and one spoken fact per trainer instead of two loose Texts.
            <Meter key={p.id} label={p.name} val={p.clients} target={maxLoad} tone="blue"
              note={`${num(p.clients)} client${p.clients === 1 ? '' : 's'}`} />
          ))}
          <View style={{ height: sp.lg }} />
          {/* Load is who is carried today; retention is who stayed. The second
              is derived from the memberships on Growth, by the same module the
              web console uses, and is pointed at rather than re-read here — a
              second churn read on this console would be a second place for the
              two to disagree. */}
          <Rule />
          <ListRow icon="trending" title="Member Retention" note="Who joined and who left, month by month, on Growth"
            onPress={() => router.push('/(owner)/growth')} />
        </Section>




        {/* ── MRR trend (real, accumulating) ─────────────────────────────── */}
        <Section>
          {/* `delta` is a count of SESSIONS — useSessionsHistory keeps its own
              key precisely so session counts and the old dollar history cannot
              be drawn as one line. It was printed with a dollar sign in front
              of it, so a month up twelve sessions read "+$12 vs last mo". */}
          <SectionHead title="Sessions Trend"
            note={histStatus === 'loading' ? 'Reading Your Months'
              : !histWhole ? 'Your Months Could Not Be Read'
              : delta !== 0 ? `${deltaSign(delta, 0)}${num(Math.abs(delta))} Session${Math.abs(delta) === 1 ? '' : 's'} vs Last Mo`
              : 'Tracking Started'}
            onPress={() => router.push('/(owner)/revenue')} />
          {/* The kit's ChartShell owns the ladder now: a read still in flight
              says so instead of borrowing the failed read's sentence, which is
              what `!histWhole` alone did; a failed or partial read is marked
              and draws nothing; and the line appears from the second real
              month. `months` is how many points are REAL, not how many slots
              the window has. */}
          <ChartShell status={histStatus} points={months}
            /* Not "not enough history". That sentence is a claim about this
               gym, and under a failed read the only months in hand are the
               ones this handset happened to keep. */
            errorLine="Your recorded months could not be read, so the trend is held back. Pull down to try again."
            partialLine="Only some of your recorded months came back, so the trend is held back rather than drawn through the ones that did. Pull down to try again."
            loadingLine="Reading your recorded months…"
            emptyLine="Not enough history yet. A snapshot is recorded each month, and the trend appears from the second one."
            onePointLine="Not enough history yet. A snapshot is recorded each month, and the trend appears from the second one.">
            {/* The series goes in WITH its holes, and the months go in with it.
                This was `series.filter((v) => v != null)` over a hand-rolled
                label row, which drew four points across the width while
                printing six evenly spaced months underneath — so every point
                sat above the wrong one. <Spark> now places each point and its
                own label from the same index, and breaks the line across a
                month nobody recorded instead of closing over it. */}
            <Spark data={series} labels={labels} area tone="blue" />
          </ChartShell>
        </Section>

        {/* ── money: the two screens behind the trend ─────────────────────── */}
        {/* Was the top of one six-row list at the foot of the screen. Split so
            the money rows sit under the money section and the administrative
            ones come last, which is the order the console is read in. */}
        <Section>
          <SectionHead title="Revenue & Finance" />
          <ListRow icon="trending" title="Revenue Analytics" note="Forecast, plan mix, LTV & revenue at risk"
            onPress={() => router.push('/(owner)/revenue')} />
          {/* Was `icon="sparkle"` over "Financial Health · AI Review", noting
              "connect accounting". Three claims, none of them true: the screen
              behind this row is an if/else chain in src/lib/finReview.ts, no
              model is called, and there is no accounting integration to
              connect — the control that offered one was removed from that
              screen for describing a feature nobody has written. A sparkle is
              the icon this product uses for model-backed things, so it was
              making the claim on its own even for somebody who read no words. */}
          <ListRow icon="chart" title="Financial Checks" note="Margin, retention & growth against fixed thresholds, from figures you enter"
            onPress={() => router.push('/(owner)/financials')} />
        </Section>


        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Promotions & Inbox" />
          <ListRow icon="share" title="Promotions" note="Create an offer & push it to members"
            onPress={() => router.push('/(owner)/promotions')} />
          {/* Last in the quiet list rather than a bell in the header: the owner
              app has no bell anywhere, so this row and Explore are the whole of
              the way in. Ops keeps the announcements a gym SENDS; this is the
              other direction — what has been sent to it. */}
          <ListRow icon="bell" title="Notifications" note="What the gym has been told, in one list"
            onPress={() => router.push('/(owner)/notifications')} />
          {/* Also not a screen this change added. feedback.tsx was reachable
              only from an Explore search result — an inbox nobody opens is the
              same as no inbox, and an owner does not search for a screen they
              have never been shown exists. */}
          <ListRow icon="message" title="Feedback Inbox" note="What testers and members are saying"
            onPress={() => router.push('/(owner)/feedback')} />
        </Section>

        {/* ── shortcuts ──────────────────────────────────────────────────── */}
        {/* Below the fold, as the board keeps tiles off every first viewport:
            these are the five tabs again plus Members, and a reader who has
            scrolled this far is looking for a way onward. */}
        <View style={{ marginTop: sp.md }}>
          <QuickRow items={[
            { icon: 'people', label: 'Trainers', onPress: () => router.push('/(owner)/trainers') },
            { icon: 'me', label: 'Members', onPress: () => router.push('/(owner)/members') },
            { icon: 'palette', label: 'Brand', onPress: () => router.push('/(owner)/brand') },
            { icon: 'trending', label: 'Growth', onPress: () => router.push('/(owner)/growth') },
            { icon: 'wrench', label: 'Ops', onPress: () => router.push('/(owner)/ops') },
          ]} />
        </View>
      </ScrollView>

      {/* Trainer drill-down */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          {sel && selHealth && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: 6 }}>
                <HealthPill score={selHealth.score} tone={selHealth.tone} />
                <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>{sel.name}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.lg }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selHealth.risk === 'high' ? t.crit : selHealth.risk === 'watch' ? t.warn : t.brand }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{selHealth.reason}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginBottom: sp.xl }}>
                {[['Clients', String(sel.clients)], ['Sessions · 30d', String(sel.sessions30)], ['Health', String(trainerHealth(sel).score)]].map(([l, v], i) => (
                  <View key={l} style={{ flex: 1, paddingEnd: sp.sm, paddingStart: i === 0 ? 0 : sp.md, borderStartWidth: i === 0 ? 0 : hairline, borderStartColor: t.ring }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{l}</Text>
                    <Text style={{ ...value(15), color: t.ink, marginTop: 3 }} numberOfLines={1}>{v}</Text>
                  </View>
                ))}
              </View>
              <Cta label={`Manage ${sel.name.split(' ')[0]}`} wide onPress={() => { setSel(null); router.push('/(owner)/trainers'); }} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Close" onPress={() => setSel(null)} />
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ── two shapes the kit does not have yet ───────────────────────────────────
 *
 * Built here from tokens because this lane may not edit src/ui/kit.tsx; both
 * are candidates to move there (the Trainers screen carries the same row).
 */

/**
 * A small trend on the NIGHT card. The kit's <Spark> is drawn for a white
 * surface — an ink readout, a surface-coloured halo, ink3 axis labels — and on
 * night all three disappear or glare. This is the line alone, in the bright
 * accent, with Spark's two honest parts kept: a hole in the series breaks the
 * line rather than being closed over, and fewer than two readings draw nothing.
 * Decoration over figures stated elsewhere, so it is one spoken sentence.
 */
function NightSpark({ data, spoken }: { data: (number | null | undefined)[]; spoken: string }) {
  const t = useTheme();
  const W = 96, H = 44, PAD = 5;
  const pts = data.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => typeof p.v === 'number' && Number.isFinite(p.v));
  if (pts.length < 2 || data.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v)), rng = (Math.max(...pts.map((p) => p.v)) - min) || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / rng);
  // Unbroken runs: consecutive indices only.
  const runs: { i: number; v: number }[][] = [];
  for (const p of pts) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1].i === p.i - 1) run.push(p); else runs.push([p]);
  }
  const last = pts[pts.length - 1];
  return (
    // rtl-ok by construction: SVG user space does not mirror, and oldest is on
    // the left in every locale, as Spark's is.
    <View accessible accessibilityRole="image" accessibilityLabel={spoken} style={{ flexShrink: 0 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {runs.map((run, ri) => run.length >= 2 ? (
          <Polyline key={ri} points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
            fill="none" stroke={t.brandBright} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Circle key={ri} cx={x(run[0].i)} cy={y(run[0].v)} r={2.5} fill={t.brandBright} />
        ))}
        <Circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={t.night} stroke={t.brandBright} strokeWidth={3} />
      </Svg>
    </View>
  );
}

/**
 * One trainer on the health board, the mockup's way: a monogram on the band's
 * pale plate, the name, what they delivered, and the score in a pill of the
 * same band.
 *
 * The bands are `trainerHealth`'s own — good from 70, moderate from 40, low
 * under it (src/lib/ownerAnalytics.ts) — and NOT the mockup's 80 and 60, which
 * nothing in this product computes. Good is the ACCENT, so under white-label
 * it is the gym's colour; amber and red are the data palette and do not move.
 * The colour never stands alone: the caption ends in the state in words, and
 * the spoken label says the band.
 */
function HealthRow({ name, caption, score, band, divider, onPress }: {
  name: string; caption: string; score: number; band: 'good' | 'moderate' | 'low'; divider?: boolean; onPress: () => void;
}) {
  const t = useTheme();
  const tone = band === 'good' ? 'brand' as const : band === 'moderate' ? 'amber' as const : 'red' as const;
  const plate = tone === 'brand' ? t.brandSoft : t.data[`${tone}Soft`];
  const ink = tone === 'brand' ? t.brandText : t.data[`${tone}Ink`];
  const D = grown(42);
  // Array.from, not slice: a name that opens with an astral-plane letter is
  // two UTF-16 units, and half of one is "\uFFFD".
  const mono = name.split(' ').filter(Boolean).map((w) => Array.from(w)[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${name}. ${caption}. Health ${score} of 100, ${band === 'good' ? 'good' : band === 'moderate' ? 'moderate' : 'low'}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: grown(64), paddingVertical: sp.sm, borderTopWidth: divider ? hairline : 0, borderTopColor: t.ring }}>
      <View style={{ width: D, height: D, borderRadius: radius.pill, backgroundColor: plate, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...ty.label, ...font('700'), color: ink }}>{mono}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ ...ty.head, color: t.ink }}>{name}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{caption}</Text>
      </View>
      <View><TonedChip label={String(score)} tone={tone} /></View>
      <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
    </Pressable>
  );
}

/* ── the first five minutes, on the phone ───────────────────────────────────
 *
 * WHERE each of the six is set, in THIS app. The list itself is in
 * src/lib/gymSetup.ts and deliberately holds no routes, because the two
 * surfaces answer the same six questions from different screens: the gym's
 * name is on Brand here and on Gym settings in the console, the currency and
 * the session fee are on Ops here and on the same console screen there.
 *
 * ONE of the six has no phone screen at all, and that is a fact about this app
 * rather than a gap in the list: nothing in `app/(owner)/**` writes
 * `membership_plans`, so the price book is priced in the console or nowhere.
 * A null here is therefore an honest "not from this app", and the card says so
 * in one line rather than routing somebody to a screen that cannot do it.
 *
 * The timezone used to be the second one. It is now on Ops, which is the point
 * of putting this card here at all — an item that can only end in "go and open
 * a browser" is a nag rather than a task.
 *
 * A Record keyed by SetupKey rather than a lookup with a fallback: a seventh
 * item added to the module fails to compile here instead of rendering with
 * nowhere to go.
 */
const PHONE_WHERE: Record<SetupKey, { route: string; label: string; icon: IconName } | null> = {
  currency: { route: '/(owner)/ops', label: 'Ops', icon: 'wrench' },
  timezone: { route: '/(owner)/ops', label: 'Ops', icon: 'wrench' },
  name: { route: '/(owner)/brand', label: 'Brand', icon: 'palette' },
  plan: null,
  // Members opens a membership against an account that already exists. It
  // cannot invite — `memberships.member_id` references `profiles`, so somebody
  // who has never used the app has to be invited first, and that flow is in the
  // console. The item's own `breaks` copy says so; this only says where to go.
  member: { route: '/(owner)/members', label: 'Members', icon: 'me' },
  fee: { route: '/(owner)/ops', label: 'Ops', icon: 'wrench' },
};

/**
 * What this gym has not set up yet, or nothing at all.
 *
 * Renders only when something is genuinely outstanding — `needsSetup` is false
 * for a list of unknowns, so a refused read cannot put a setup card in front of
 * a gym that finished setting up months ago, and an in-flight read cannot
 * either. Done rows are not drawn: this is what is left, not a scoreboard.
 */
function SetUp({ items, onGo }: { items: SetupItem[]; onGo: (route: string) => void }) {
  const t = useTheme();
  if (!needsSetup(items)) return null;
  const line = setupLine(items);
  const left = items.filter((i) => i.state !== 'done');
  const here = left.filter((i) => i.state === 'todo' && PHONE_WHERE[i.key] !== null);
  const elsewhere = left.filter((i) => i.state === 'todo' && PHONE_WHERE[i.key] === null);
  const unread = left.filter((i) => i.state === 'unknown');

  return (
    <Notice kicker="Set Up" title={line ?? 'Some Settings Are Not Set Yet'}
      note="Each of these breaks something until it is done. Nothing here is cosmetic.">
      <View style={{ marginTop: sp.sm }}>
        {here.map((i) => {
          const w = PHONE_WHERE[i.key];
          if (!w) return null;
          return (
            <View key={i.key}>
              <Rule />
              <ListRow icon={w.icon} title={i.title} note={i.breaks} onPress={() => onGo(w.route)} />
            </View>
          );
        })}

        {/* The two this app cannot do, named rather than routed. Saying "open
            the web console" is true; drawing a tappable row that lands on a
            screen with no such control is not. */}
        {elsewhere.length > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {elsewhere.map((i) => i.title.toLowerCase()).join(', ')}: in the Repple Studio web
            console, which is the only place this app can send you for it.
          </Text>
        ) : null}

        {/* Not folded into the count above, and not drawn as a row to act on:
            an item nobody managed to check is a statement about a read. */}
        {unread.map((i) => (
          <Text key={i.key} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {i.unknownWhy}
          </Text>
        ))}
      </View>
    </Notice>
  );
}
