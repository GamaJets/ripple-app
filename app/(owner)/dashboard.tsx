// Owner · Overview — the platform operating console. Real roll-ups (MRR + MoM
// delta, ARR, trainers, clients), an at-risk-MRR churn callout, a trainer-health
// board (score + risk, tap for detail), and an accumulating MRR trend.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same modal — the four tinted
// stat boxes and eleven bordered cards became one hero figure plus
// hairline-separated sections, and the Georgia serif header is gone.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, QuickRow, Spark, Notice, fig } from '../../src/ui/kit';
import { NotificationBell } from '../../src/ui/notifications';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';
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
import { deltaSign } from '../../src/lib/deltaLabel';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';
import { cohorts } from '../../src/lib/ownerAnalytics';
import { ownerReportDoc, shareDoc, pdfExportAvailable } from '../../src/lib/exportShare';
import { reportError } from '../../src/lib/reportError';
import { Linking } from 'react-native';
import { supabase } from '../../src/lib/supabase';
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

  const refreshAll = useCallback(() => { refresh(); refreshTenant(); void loadSetup(); }, [refresh, refreshTenant, loadSetup]);
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
        loading ? 'Still reading your roster' : 'Roster could not be read',
        loading
          ? 'Your trainers have not come back yet, so every figure in the report would be a zero this app has not confirmed. Try again in a moment.'
          : 'Your trainers could not be read, so a report built now would state that your gym has no trainers, no clients and no sessions — none of which this app found out. Reload the roster and share it then.',
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
    const how = await shareDoc(doc.html, doc.text, 'Platform report');
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
      Alert.alert('Report shared', pdfExportAvailable()
        ? 'Shared as text — the PDF could not be produced on this phone. Nothing is missing from the figures.'
        : 'Shared as text — this build cannot make a PDF. A newer build of the app can.');
    }
  };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            {/* The owner's own gym, not "Repple HQ · Platform" — this app is
                one gym's console, and the previous wording read like an
                internal admin tool belonging to somebody else. */}
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }} numberOfLines={1}>
              {/* Said "in Ops". Ops gained the session FEE; the gym's NAME is
                  in Brand. Sending an owner to the wrong screen for the one
                  thing the hero is asking them to do. */}
              {tenant?.name?.trim() || 'Name your gym in Brand'}
            </Text>
            {/* The console's own age. Every figure below is a roll-up of one
                read, and until now nothing on the page said when it happened
                or whether the phone could still reach us. */}
            <Fetched at={fetchedAt} onRefresh={refreshAll} busy={loading} />
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            <Ghost icon="search" onPress={() => router.push('/(owner)/explore')} />
            {/* Quiet by design — nothing in the product addresses an owner
                today except what a coach in their gym sends them. It is here
                anyway, and it is here with a mark that distinguishes "nothing
                for you" from "we could not find out", which is the difference
                that matters on a screen an owner reads at a glance. */}
            <NotificationBell group="owner" />
            <Ghost icon="share" onPress={exportReport} />
          </View>
        </View>

        {/* ── shortcuts ──────────────────────────────────────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          <QuickRow items={[
            { icon: 'people', label: 'Trainers', onPress: () => router.push('/(owner)/trainers') },
            { icon: 'me', label: 'Members', onPress: () => router.push('/(owner)/members') },
            { icon: 'palette', label: 'Brand', onPress: () => router.push('/(owner)/brand') },
            { icon: 'trending', label: 'Growth', onPress: () => router.push('/(owner)/growth') },
            { icon: 'wrench', label: 'Ops', onPress: () => router.push('/(owner)/ops') },
          ]} />
        </View>

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {/* First, because for a gym in this state everything under it is a
              dash and this is the reason for all of them. Draws nothing at all
              once the six are set — and nothing while the reads are in flight,
              since an unsettled read leaves every item 'unknown' rather than
              outstanding. */}
          <SetUp items={setup} onGo={(r) => router.push(r as never)} />

          {/* The noun was pluralised and the verb was not, so a gym with one
              client under a flagged trainer read "1 client ARE with them". On a
              small gym's dashboard that count is the commonest case, not an
              edge.

              The trainer count moves off `> 1` and onto the `=== 1` form the
              rest of this file and the owner app use. It cannot currently
              render zero — the card is behind `atRiskCount > 0` on the line
              below — but `> 1` says "0 trainer" the day that guard moves, and
              two adjacent lines disagreeing about how to count is what produced
              the verb bug in the first place. */}
          {roll.atRiskCount > 0 ? (
            <Notice tone={t.warn} kicker="Needs a look"
              title={`${roll.atRiskCount} trainer${roll.atRiskCount === 1 ? '' : 's'} flagged`}
              note={`${roll.atRiskClients} client${roll.atRiskClients === 1 ? '' : 's'} ${roll.atRiskClients === 1 ? 'is' : 'are'} with them — review the most urgent.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Review" wide
                  onPress={() => { const first = ranked.find((r) => r.h.risk === 'high' || r.h.risk === 'watch'); if (first) setSel(first.tr); }} />
              </View>
            </Notice>
          ) : null}

        </View>

        {!loading && roll.trainers === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {trainersUnread
                ? 'Your trainers could not be read, so this is not "no trainers".'
                : 'No trainers yet — clients, delivered sessions and trainer health fill in as they join your gym.'}
            </Text>
            {trainersUnread ? (
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Try Again" onPress={refresh} />
              </View>
            ) : null}
          </Card>
        ) : null}

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
        <Hero
          label="Sessions · 30 Days"
          figure={trainersUnknown ? '—' : num(roll.sessions30)}
          note={loading
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
              : `${num(roll.delivered30)} marked delivered · worth ${gymMoney(roll.payroll30, cur)} at your session fee`}
          onPress={() => router.push('/(owner)/revenue')}
        />

        <Rule />

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
            { label: 'Payroll · 30d', value: trainersUnknown ? '—' : fig(gymMoney(roll.payroll30, cur)), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.payroll30 == null ? 'no session fee set' : `${num(roll.delivered30)} of ${num(roll.sessions30)} delivered, at your fee` },
          ]} />
        </Section>

        <Rule />

        {/* ── MRR trend (real, accumulating) ─────────────────────────────── */}
        <Section>
          {/* `delta` is a count of SESSIONS — useSessionsHistory keeps its own
              key precisely so session counts and the old dollar history cannot
              be drawn as one line. It was printed with a dollar sign in front
              of it, so a month up twelve sessions read "+$12 vs last mo". */}
          <SectionHead title="Sessions Trend"
            note={!histWhole ? 'your months could not be read'
              : delta !== 0 ? `${deltaSign(delta, 0)}${num(Math.abs(delta))} session${Math.abs(delta) === 1 ? '' : 's'} vs last mo`
              : 'Tracking started'}
            onPress={() => router.push('/(owner)/revenue')} />
          {!histWhole ? (
            /* Not "not enough history". That sentence is a claim about this
               gym, and under a failed read the only months in hand are the
               ones this handset happened to keep. */
            <Text style={{ ...ty.label, color: t.ink3 }}>Your recorded months could not be read, so the trend is held back. Pull down to try again.</Text>
          ) : months >= 2 ? (
            /* The series goes in WITH its holes, and the months go in with it.
               This was `series.filter((v) => v != null)` over a hand-rolled
               label row, which drew four points across the width while
               printing six evenly spaced months underneath — so every point
               sat above the wrong one. <Spark> now places each point and its
               own label from the same index, and breaks the line across a
               month nobody recorded instead of closing over it. */
            <Spark data={series} labels={labels} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet — a snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
        </Section>

        <Rule />

        {/* ── trainer health board ───────────────────────────────────────── */}
        {/* Before the pills, because a coach at the top of a list called "worst
            first" is a conversation with a person, and an owner should know
            what put them there before having it. The owner app carried no help
            card at all until this one. */}
        <ScreenHelp screen="owner-trainers" />
        <Section>
          <SectionHead title="Trainer Health" note="Worst first" />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            // Ahead of the empty branch: an unread roster scores nobody, which
            // is not the same as there being nobody to score.
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so none of them were scored — nobody here has been cleared.</Text>
          ) : ranked.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers to score yet.</Text>
          ) : ranked.map(({ tr, h }, i) => (
            <Pressable key={tr.id} onPress={() => setSel(tr)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                       borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <HealthPill score={h.score} tone={h.tone} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{tr.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: h.risk === 'high' ? t.crit : h.risk === 'watch' ? t.warn : t.brand }} />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{riskLabel(h.risk)} · {tr.clients} client{tr.clients === 1 ? '' : 's'} · {tr.sessions30} session{tr.sessions30 === 1 ? '' : 's'}</Text>
                </View>
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{tr.sessions30} in 30d</Text>
            </Pressable>
          ))}
        </Section>

        <Rule />

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
            <View key={p.id} style={{ marginBottom: sp.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.name}</Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{p.clients} client{p.clients === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                <View style={{ height: 3, borderRadius: 2, width: `${Math.round((p.clients / maxLoad) * 100)}%`, backgroundColor: t.brand, opacity: p.clients > 0 ? 1 : 0.55 }} />
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
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
          <ListRow icon="share" title="Promotions" note="Create an offer & push it to members"
            onPress={() => router.push('/(owner)/promotions')} />
          <ListRow icon="calendar" title="Classes & Payroll" note="Attendance, fill rates & trainer pay per check-in"
            onPress={() => router.push('/(owner)/class-analytics')} />
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
      </ScrollView>

      {/* Trainer drill-down */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
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
    <Notice kicker="Set up" title={line ?? 'Some settings are not set yet'}
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
            {elsewhere.map((i) => i.title.toLowerCase()).join(', ')} — in the Repple Studio web
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
