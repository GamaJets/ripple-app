// Owner · Growth. Trainer acquisition/retention + an interactive promo-code
//
// ── Growth of WHAT ────────────────────────────────────────────────────────
//
// Every figure on this screen counts TRAINERS. The hero is trainers who joined
// this month, the retention row is trainers carrying nobody, the cohorts are
// trainers grouped by the month they signed up, and the funnel starts at a
// trainer signup. Under a tab called Growth, beside a strapline that read
// "Acquisition & retention", an owner reads all of that as their gym's member
// growth — and the comment on `idle` below actually said so out loud: idle
// trainers were "the gym's equivalent of churn".
//
// They are not. A coach carrying no clients is a coach with a gap in their
// diary; a member who left is somebody who stopped paying. Calling the first
// one churn puts a number in front of an owner that answers a question they did
// not ask, under a word that means the one they did.
//
// ── And the real figure, which is now here as well ────────────────────────
//
// Naming the trainer figures honestly was half the job. The other half was that
// this screen then said member churn "is not derived anywhere on this handset"
// — true, and the actual defect: the number a gym runs on could only be got at
// from a laptop.
//
// The constraint that sentence was built on is real and unchanged.
// `app/(owner)/financials.tsx` sets it out: nothing in `memberships` records
// WHEN a membership was cancelled. `status` moves to 'cancelled' in place, and
// `ends_on` is only set where somebody set it, so a member who left in March and
// one who left last week can be the same row today. What does not follow is that
// no figure may be derived — the console's Analytics page has derived one all
// along, from `ends_on` where every ended membership carries one, and withheld
// it where they do not.
//
// So the same derivation runs here, over the same table, through the same
// module: src/lib/memberChurn.ts, read by `useMemberChurn()` in
// src/ui/memberChurn.ts. Not a phone-shaped approximation of the console's
// answer — literally the same functions, so the two surfaces cannot report
// different churn for the same gym on the same day. Where the record cannot
// carry a rate the handset withholds it and says which of the four reasons it
// was, exactly as the console does: the month is still running, an ended
// membership has no end date, somebody left with no start date recorded, or
// there was nobody on the books to be a share of.
//
// Promo rows carry a real redemption count. They once appended "· N redeemed"
// over `promos.redeemed`, a column whose only write was the literal `0` at
// creation, so it was removed as a fabricated metric. Part 104 made redemption
// an event — a row per member per code — and the count is derived from those
// rows, with a dash when the count could not be read.
// tool: create referral/discount codes, toggle them on/off, track redemptions.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): three bordered stat boxes and four stacked cards became
// one hero figure plus hairline-separated sections, and the Georgia serif
// header is gone.
import { useState, useEffect, useCallback } from 'react';
import { num, num1 } from '../../src/lib/format';
import { plainExact } from '../../src/lib/units';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ScreenHeader, KpiRow, Cta, Ghost, Flag, fig, HeroCard, Ring, Meter, Donut, Legend, Expandable, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value, font } from '../../src/theme/scale';
import { usePromos } from '../../src/ui/promos';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
// Not for anything this screen draws — for the STATUS. The roster provider
// reads the tenant and drops its status (see the note beside `rosterStatus`),
// so this screen has to ask for it directly.
import { useTenant } from '../../src/ui/tenant';
import { useMemberChurn, PHONE_MONTHS } from '../../src/ui/memberChurn';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { gymRollup, cohorts, clientAnalytics, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { deltaLabel } from '../../src/lib/deltaLabel';

const DISCOUNTS = [10, 20, 30, 50];

export default function OwnerGrowth() {
  const t = useTheme();
  const router = useRouter();
  const { promos, status: promoStatus, addPromo, toggleActive, removePromo, refresh: refreshPromos } = usePromos();
  // The roster read has to be waited on. Every count on this screen — new this
  // month, idle, the whole funnel — is derived from `trainers`, so before it
  // returns the hero read "+0 new trainers" over "No trainers yet" and the
  // retention row reported 0% idle. An owner checking whether their growth push
  // worked was shown a month with no signups by a query that had not finished.
  const { trainers, loading, status: trainersStatus, refresh } = usePlatformTrainers();
  const { status: tenantStatus } = useTenant();
  // The gym's own members — joiners, leavers and the rate between them, from
  // the same module the console's Analytics page uses. Its own read and its own
  // three states: the roster failing has nothing to do with the roster of
  // trainers failing, and a screen that folded them together would blame one
  // for the other.
  const churn = useMemberChurn();
  /** When the roster the trainer figures are a roll-up of last came back.
   *  'ready' only — a failed retry must not move the stamp. */
  const [trainersAt, setTrainersAt] = useState<number | null>(null);
  useEffect(() => { if (trainersStatus === 'ready') setTrainersAt(Date.now()); }, [trainersStatus]);
  /** And when the memberships did. Two reads, two stamps. */
  const [churnAt, setChurnAt] = useState<number | null>(null);
  useEffect(() => { if (churn.status === 'ready') setChurnAt(Date.now()); }, [churn.status]);
  /** And the promo codes, which are the third read on this screen and were in
   *  neither the stamp nor the refresh — so the codes section sat at whatever
   *  the first read returned while the line above it said "Read just now". */
  const [promosAt, setPromosAt] = useState<number | null>(null);
  useEffect(() => { if (promoStatus === 'ready') setPromosAt(Date.now()); }, [promoStatus]);
  /**
   * The OLDEST of the three, which is the only honest thing one stamp can say
   * about three reads.
   *
   * There is one "Read just now" at the top of a screen that draws from three
   * independent reads. Showing the newest of them would put a fresh timestamp
   * over a member churn section that had not been refreshed in twenty minutes —
   * the staleness marker exists precisely to stop that. Null while any has yet
   * to land, because "read 2 minutes ago" over a section that has never been
   * read is worse than "Reading…". `oldestFetch` is that rule, with the test.
   */
  const fetchedAt = oldestFetch(trainersAt, churnAt, promosAt);
  /** All three, or the gesture leaves part of the screen stale. */
  const refreshAll = useCallback(() => { refresh(); churn.refresh(); void refreshPromos(); }, [refresh, churn.refresh, refreshPromos]);
  const pull = usePullToRefresh(refreshAll);
  // And having waited on it, the read can still have FAILED — which leaves
  // `trainers` empty with `loading` false, i.e. exactly the state the paragraph
  // above describes, permanently. "+0 new trainers" over "No trainers yet", and
  // a retention row of Idle 0% · Sessions 0 · Clients 0, are then not a slow
  // query being caught mid-flight but a settled answer about the gym, and the
  // owner who came here to see whether their growth push worked is told it did
  // not. Overview tells the two apart; this is that check.
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
  // One sentence for every dash on the screen that is a dash for this reason.
  const unreadNote = 'could not be read';
  const roll = gymRollup(trainers as TrainerLike[], null);
  const coh = cohorts(trainers as TrainerLike[]);
  const ca = clientAnalytics(trainers as TrainerLike[]);
  // Joined this month, from the real `profiles.created_at` rather than a
  // hand-formatted "Aug 2026" string that only matched by luck.
  const now = new Date();
  const newThisMonth = trainers.filter((x) => {
    const ts = x.since ? Date.parse(x.since) : NaN;
    if (!isFinite(ts)) return false;
    const d = new Date(ts);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  // Idle = a trainer carrying no clients and delivering nothing. This once
  // called itself "the gym's equivalent of churn", which is the confusion the
  // header is about: it is a gap in a coach's diary, not a member who left. The
  // figure is worth having and the word was not — a subscription "suspended"
  // flag never existed here either, so idle is what the roster can actually
  // show.
  const idle = trainers.filter((x) => (x.clients || 0) === 0 && (x.sessions30 || 0) === 0).length;
  // Null, not 0, over a roster we do not have: "0% idle" is the best possible
  // reading of a retention figure and was what a refused read produced.
  const idlePct = trainersUnknown || !trainers.length ? null : Math.round((idle / trainers.length) * 100);
  const [code, setCode] = useState('');
  const [disc, setDisc] = useState(20);
  /** The caveat carried back by the LAST creation, and the code it was about.
   *
   *  Null when the last creation's duplicate check actually ran — `addPromo`
   *  sets `caveat` exactly when `duplicatesChecked` is false — so a clean
   *  creation clears a stale one rather than leaving it standing over a code it
   *  is not about. See `create` for why this outlives the alert. */
  const [lastCaveat, setLastCaveat] = useState<{ code: string; note: string } | null>(null);
  // Trainer funnel, derived from the real roster. There is no analytics on
  // site visits, so the funnel starts at signup — a "Visited site 100% →
  // Paying 18%" curve was previously hardcoded here and was entirely invented.
  const activated = trainers.filter((x) => x.clients > 0).length;
  const funnelPct = (n: number) => (roll.trainers ? Math.round((n / roll.trainers) * 100) : 0);
  const funnel: [string, number, number][] = [
    ['Signed Up', roll.trainers, 100],
    ['Activated (Has Clients)', activated, funnelPct(activated)],
    ['Delivering Sessions', roll.trainers - idle, funnelPct(roll.trainers - idle)],
  ];

  // Awaited now that a code is a row rather than a number in memory. The old
  // synchronous call told the owner "is now live" the instant they tapped,
  // which was true of nothing outside this process.
  //
  // ── the caveat this screen used to swallow ────────────────────────────────
  //
  // `addPromo` answers with `AddPromoResult` — `{ ok, reason?,
  // duplicatesChecked, caveat? }`. This read `ok` and `reason` and nothing
  // else, which is why it still compiled and why nothing looked wrong: the
  // change was additive.
  //
  // What it dropped is the half of the answer that outlives the tap. When the
  // gym's existing codes could not be read, `addPromo` creates the code anyway
  // — deliberately, and rightly: a gym that cannot read its codes is not
  // thereby forbidden from making one — and comes back with
  // `duplicatesChecked: false` and one sentence naming the check that did not
  // run. This screen said "is now live", full stop. The code IS live; what was
  // not said is that nothing looked to see whether it was already in use.
  //
  // ── alert AND Flag, and why that is not belt-and-braces ───────────────────
  //
  // The alert has to carry it, because the tap is the moment the owner is
  // looking, and an alert that says only "is now live" is where they learn that
  // the check ran. The alert cannot be the only place, because it is gone a
  // second later and the duplicate surfaces weeks later — when a member types
  // the code and gets whichever of two identically spelled rows the database
  // reaches first. So the sentence also stays on the screen as a `Flag`, which
  // is the kit component app/(owner)/promotions.tsx already uses to say this
  // same thing BEFORE creation. Same idiom, deliberately, rather than a second
  // one invented here.
  //
  // It is not an error and is not dressed as one. `t.warn`, the tone the
  // sibling screen uses, and copy that opens by saying the code is live.
  const create = async () => {
    // Normalised the way `addPromo` normalises it, `.replace(/\s+/g, '')` and
    // all. Both sentences below name a code back to the owner, and
    // `code.trim().toUpperCase()` alone named one the gym does not have: a
    // typed `SUM MER` is stored as `SUMMER` and was read back with the space
    // still in it.
    const c = code.trim().toUpperCase().replace(/\s+/g, '');
    const r = await addPromo(code, disc);
    if (!r.ok) { Alert.alert('Cannot Create', r.reason ?? 'Try a different code.'); return; }
    setCode('');
    // Set exactly when the check did not run, and cleared when it did — so a
    // caveat never stands over a later code it is not about.
    setLastCaveat(r.caveat ? { code: c, note: r.caveat } : null);
    Alert.alert('Code Created',
      // `plainExact` on the discount for the reason the promo rows below give:
      // the separator in a printed figure is the reader's, not English's.
      [`${c} · ${plainExact(disc)}% off is now live.`, r.caveat].filter(Boolean).join(' '));
  };

  /** One labelled bar — the section's unit of comparison.
   *
   *  A PLAIN FUNCTION, called as `bar(key, {…})`, and not a component rendered
   *  as `<Bar …/>`. `Bar` was declared in this render body, so it was a new
   *  function object on every render: React compares element types by identity,
   *  saw a different type each time, and unmounted and remounted every bar in
   *  all three sections below instead of reconciling them.
   *
   *  The harm here is smaller than the two failures scripts/check-remount.mjs
   *  was written from, and worth stating at its real size. Nothing in this
   *  subtree is a `TextInput`, so no caret is lost, and nothing is an
   *  `accessible` group with a composed label, so VoiceOver is not sent back to
   *  the top. What it cost is wasted work — a full teardown and rebuild of
   *  every bar on the screen on each of the three background reads landing, and
   *  on each `setCode` keystroke in the promo field below — and a subtree that
   *  could never hold state across a redraw, which is why no bar here can be
   *  animated to its width. Not a wrong figure.
   *
   *  `key` is the FIRST argument and lands on the returned View. All three call
   *  sites are inside a `.map` and a plain call cannot take a `key`, so leaving
   *  it on the call site is the one silent way to break this conversion. Same
   *  edit, same reason, as app/(client)/injuries.tsx.
   */
  // The kit's labelled 8pt `Meter` now, where a hand-built 3pt hairline was.
  // `right` is the Meter's `note`, so the count and its share are what is
  // drawn AND what is spoken; the tone names the section, not a judgement.
  const bar = (key: string, { label, right, pct, dim, tone }: { label: string; right: string; pct: number; dim?: boolean; tone?: Tone }) => (
    <Meter key={key} label={label} val={Math.max(0, Math.min(100, pct))} target={100} note={right} dim={dim} tone={tone} />
  );

  const G = layout.gutter;
  const FUNNEL_TONES: Tone[] = ['blue', 'purple', 'teal', 'brand'];
  const promosWhole = isWhole(promoStatus);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board's tab-root opening: a quiet eyebrow and the title. */}
        {/* The same search control the Overview tab carries. Studio's hidden
            screens hang off Overview (13 of them) and Ops (5), so an owner
            standing on any other tab root had no way into
            app/(owner)/explore.tsx and its search over OWNER_NAV. */}
        <ScreenHeader eyebrow="Trainers and Members" title="Growth"
          actions={<Ghost icon="search" a11yLabel="Search every screen" onPress={() => router.push('/(owner)/explore')} />} />

        {/* ── the figure ─────────────────────────────────────────────────── */}
        {/* A card rather than the kit's bare `Hero`: the one block on this
            screen the board does not draw. */}
        {(() => {
          const label = `New Trainers · ${now.toLocaleString(undefined, { month: 'short' })} ${now.getFullYear()}`;
          // A month with nobody joining reads "0", not "+0". The plus was
          // unconditional, so the emptiest month on the roster was the one the
          // hero dressed up as an addition.
          const figure = trainersUnknown ? '—' : deltaLabel(newThisMonth, { since: null, decimals: 0, noChange: '0' });
          const note = loading
            ? 'Reading your roster…'
            : trainersUnread
            ? 'Your roster could not be read. This is not a month with no signups in it.'
            : roll.trainers > 0
            ? `${roll.trainers} on the roster · ${roll.trainers - idle} delivering sessions`
            : 'No trainers yet. This fills in as they join your gym.';
          return (
            /* The tab root's one night hero. The figure is two or three
               characters ("+2", "0", a dash), so the kit's wrapping title is
               safe here in a way it is not for money. */
            <HeroCard eyebrow={label.toUpperCase()} title={figure} meta={note}>
              {/* Under the figure, not buried at the bottom: this is the
                  sentence that stops every trainer figure below being read as
                  a member figure — one line now, pointing at where the other
                  question is answered. */}
              <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.md }}>
                Counts trainers. Members are in Member Retention below.
              </Text>
            </HeroCard>
          );
        })()}

        {/* The age of both reads, under the figure rather than in the header
            so the first viewport is the gym and not the plumbing. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={loading || churn.loading} />


        {/* ── retention ──────────────────────────────────────────────────── */}
        <Section>
          {/* Headed "Retention" over three trainer figures, one tap from a tab
              called Growth. Named. */}
          {/* First under the figure, which is also a trainer figure: the
              review's order for Growth is trainer retention, then the member
              base and its change, then cohorts, the funnel and the codes. The
              two trainer blocks now sit together and the member blocks follow
              under their own names, so nobody has to work out which population
              a percentage is a share of. */}
          <SectionHead title="Trainer Retention" note="Trainers, not members · last 30 days" />
          {/* The share of the roster that is NOT idle, as a ring, with the
              sample it is a share of beside it. `idlePct` is null for a roster
              that did not come back whole or has nobody on it, and the ring
              then draws no arc and a dash — never a full or an empty circle. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg, marginBottom: sp.lg }}>
            <Ring size={112} tone="brand"
              value={idlePct == null ? null : (100 - idlePct) / 100}
              figure={idlePct == null ? null : `${num(100 - idlePct)}%`} sub="active"
              spoken={idlePct == null ? 'Active trainers, no figure' : `${num(100 - idlePct)}% of trainers active, ${num(roll.trainers - idle)} of ${num(roll.trainers)}`} />
            <Text style={{ ...ty.label, color: t.ink2, flex: 1, minWidth: 140 }}>
              {idlePct == null ? 'No share to state yet.' : `${num(roll.trainers - idle)} of ${num(roll.trainers)} trainers had a client or a session in the last 30 days.`}
            </Text>
          </View>
          <KpiRow items={[
            // "0 of 0" under a dash is a fraction of nobody. `idlePct` is
            // already null with an empty roster, so the caption says the same
            // thing the figure does rather than inventing a denominator.
            { label: 'Idle', value: trainersUnknown ? '—' : fig(idlePct), unit: trainersUnknown || idlePct == null ? undefined : '%',
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : idlePct == null ? 'no trainers yet' : `${idle} of ${roll.trainers}` },
            // `avgSessionsPerTrainer` is NULL with no trainers — an average over
            // an empty set — and this was the one interpolation on the screen
            // that did not branch on it, so a gym with nobody on the roster read
            // "null avg / trainer" under its session count. Two of the three
            // owner gyms in the live database are in exactly that state. The
            // sibling row below and both rows on Overview have always had this
            // guard; this one had been missed.
            { label: 'Sessions · 30d', value: trainersUnknown ? '—' : fig(num(roll.sessions30)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : roll.avgSessionsPerTrainer == null ? 'no trainers yet' : `${plainExact(roll.avgSessionsPerTrainer)} avg / trainer` },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(num(ca.total)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : ca.avgPerTrainer == null ? 'no trainers yet' : `${plainExact(ca.avgPerTrainer)} avg / trainer` },
          ]} />
          {/* The sample and the window, in a sentence. "12%" with nothing
              beside it is a share of an unstated number of people over an
              unstated period; idle is a share of THIS roster, judged on the
              thirty days the roster read covers. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {loading ? 'Reading your roster…'
              : trainersUnread ? 'Your roster could not be read, so nothing here is a statement about your trainers.'
              : trainersUnknown ? 'Only part of your roster came back, so no share of it is stated.'
              : roll.trainers === 0 ? 'No trainers on your roster yet, so there is nobody to be a share of.'
              : `Over the ${num(roll.trainers)} trainer${roll.trainers === 1 ? '' : 's'} on your roster today. Idle means no clients and no sessions in 30 days.`}
          </Text>
        </Section>



        {/* ── member churn ───────────────────────────────────────────────── */}
        {/* The question a gym owner came to a tab called Growth to ask, which
            this screen used to answer by explaining that it could not. */}
        <Section>
          {/* "Member Retention", over a Churn figure. The section was headed by
              its first KPI, which left the screen with a "Trainer Retention"
              and no member one — and an owner looking for the second read the
              first. The head names the population and the month; the figure
              keeps the word the rate actually is. */}
          <SectionHead
            title="Member Retention"
            note={churn.headline.label ? `Members · ${churn.headline.label}` : 'Members'}
          />
          {/* The members who STAYED, as a ring: the complement of the churn
              rate below it, over the same roster the rate is over. A withheld
              rate is a withheld ring — no arc, a dash, and `headline.note`
              under the row says which reason applied. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg, marginBottom: sp.lg }}>
            <Ring size={112} tone="blue"
              value={churn.headline.pct == null ? null : (100 - churn.headline.pct) / 100}
              figure={churn.headline.pct == null ? null : `${num1(100 - churn.headline.pct)}%`} sub="stayed"
              spoken={churn.headline.pct == null ? 'Members who stayed, no figure' : `${num1(100 - churn.headline.pct)}% of members stayed, ${churn.headline.label ?? ''}`} />
            {/* Always shown, never only on the failure. Under a rate it says
                what the rate is OVER — "2 of 20 on the books when August
                began" — and where there is none it says which of the reasons
                applied. A dash with no sentence beside it is a dash an owner
                learns to ignore. */}
            <Text style={{ ...ty.label, color: t.ink2, flex: 1, minWidth: 140 }}>{churn.headline.note}</Text>
          </View>
          {/* A KpiRow and not a second <Hero>. The kit's hero is the screen's
              ONE figure and this screen already has one; two of them side by
              side make an owner decide which number the tab is about, which is
              the confusion this whole file exists to end. */}
          <KpiRow items={[
            // `fig` renders null as a dash. Every one of the reasons a rate is
            // withheld arrives here as null and the sentence below says which
            // — "0%" would be the best figure on the scale, handed to an owner
            // who has no figure at all.
            { label: 'Churn', value: fig(churn.headline.pct),
              unit: churn.headline.pct == null ? undefined : '%',
              // The month the figure is about. Null only when no month on
              // offer has finished, and the sentence below then says so in
              // full rather than this repeating it in miniature.
              delta: churn.headline.label ?? 'no finished month yet' },
            { label: 'Joined', value: fig(churn.lastClosed?.joined ?? null),
              delta: churn.lastClosed ? churn.lastClosed.label : 'no finished month yet' },
            { label: 'Left', value: fig(churn.lastClosed?.left ?? null),
              delta: churn.lastClosed ? churn.lastClosed.label : 'no finished month yet' },
          ]} />
          <View style={{ marginTop: sp.md }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {churn.loading ? 'Reading your memberships…'
                // dash-ok: the dash stands for a figure that could not be read, the app's unknown-not-zero sign (see fig() in src/ui/kit.tsx). Not punctuation.
                : churn.status === 'error' ? `On the books: — (${unreadNote})`
                // Never `?? 0`. A count that is not known is a dash; a zero
                // here is the claim that the gym has nobody.
                : `${churn.onBooks == null ? '—' : num(churn.onBooks)} on the books today`}
              {churn.undatedJoins ? ` · ${churn.undatedJoins} with no start date on record` : ''}
              {churn.undatedExits ? ` · ${churn.undatedExits} ended with no end date` : ''}
            </Text>
          </View>

          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>
              Last {PHONE_MONTHS} Months
            </Text>
            {churn.loading ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Reading your memberships…</Text>
            ) : churn.status === 'error' ? (
              // Not "no members left". An empty list under a failed read is
              // unknown, and the best-looking sentence on the screen is the one
              // an owner must never be shown on no evidence.
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your memberships could not be read, so nobody could be counted arriving or
                leaving. This is not a gym that nobody left.
              </Text>
            ) : !churn.months || churn.months.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>No month to draw yet.</Text>
            ) : churn.months.map((mo) => (
              <View key={mo.key} style={{ paddingVertical: sp.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...ty.caption, color: mo.running ? t.ink3 : t.ink2 }}>
                    {mo.label}{mo.running ? ' · running' : ''}
                  </Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                    +{mo.joined} · −{mo.left}
                    {mo.churn == null ? '' : ` · ${num1(mo.churn * 100)}%`}
                  </Text>
                </View>
                {/* The reason, in the month's own words, wherever there is no
                    rate. A row of dashes an owner cannot account for is a row
                    they learn to ignore. */}
                {mo.churn == null ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{mo.churnNote}</Text>
                ) : null}
              </View>
            ))}
          </View>

        </Section>

        {/* How the rate is worked out, behind a fold: it explains the
            method, and every WITHHELD month already carries its own reason
            on its own row above. */}
        <Expandable title="How Churn Is Counted">
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Churn is leavers over the roster the month opened with, counted per person
            rather than per membership row. A month still running has no rate: the
            leavers it has not had yet have not happened. Nothing in the record says WHEN
            a membership was cancelled, only the end date somebody wrote, so a month that
            lost anybody undated withholds the rate rather than printing the smaller one.
          </Text>
        </Expandable>


        {/* ── platform client analytics ──────────────────────────────────── */}
        <Section>
          {/* "Platform Clients" was a survivor of the subscription console this
              app used to be, where "the platform" meant Repple. To a gym owner
              it names somebody else's product: these are the members of THEIR
              gym, counted through the coaches who carry them. Overview settled
              this when it stopped saying "Repple HQ · Platform". */}
          {/* Members counted a SECOND way, and the difference matters enough to
              say: this is a headcount today through the coaches who carry them,
              which is not the same population as the memberships Member Retention
              is drawn from. A member with no coach is in the churn section and
              not in this one. Neither is wrong and they will not agree — so
              they are separately headed rather than folded together, and
              nothing here subtracts anybody. */}
          <SectionHead title="Clients of Your Trainers" note="Counted today, through the roster" />
          <KpiRow items={[
            { label: 'Active Clients', value: trainersUnknown ? '—' : fig(num(ca.total)) },
            { label: 'Engaged', value: trainersUnknown ? '—' : fig(ca.engagementPct), unit: trainersUnknown || ca.engagementPct == null ? undefined : '%' },
            { label: 'Avg / Trainer', value: trainersUnknown ? '—' : fig(ca.avgPerTrainer) },
          ]} />
          {/* The split is drawn from the same roster. Under a failed read both
              segments are 0, which DistBar has no way to distinguish from a gym
              where nobody is engaged and nobody is at risk — so the picture is
              withheld rather than drawn empty. */}
          {trainersUnknown ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg, marginTop: sp.xl }}>
              {(() => {
                const mix = [
                  { label: 'Engaged', value: ca.engaged, tone: 'brand' as Tone, shown: num(ca.engaged) },
                  { label: 'At Risk', value: ca.atRisk, tone: 'amber' as Tone, shown: num(ca.atRisk) },
                ];
                return (<>
                  <Donut slices={mix} centre={num(ca.total)} sub="clients"
                    spoken={`${num(ca.total)} clients, ${num(ca.engaged)} engaged, ${num(ca.atRisk)} at risk`} />
                  <View style={{ flex: 1, minWidth: 140 }}><Legend items={mix} /></View>
                </>);
              })()}
            </View>
          )}
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Clients by Trainer</Text>
            {loading ? <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
              : trainersUnread ? <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so their clients could not be counted.</Text>
              : ca.byTrainer.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No clients on the roster yet.</Text> : null}
            {/* The key moved onto the View `bar` returns — see its header. */}
            {trainersUnread ? null : ca.byTrainer.map((bt) => bar(bt.id, {
              label: bt.name, right: `${num(bt.clients)} · ${bt.pct}%`, pct: bt.pct, tone: 'blue',
            }))}
          </View>
        </Section>


        {/* ── cohort retention ───────────────────────────────────────────── */}
        <Section>
          {/* "Cohort Retention · By signup month" reads as member cohorts and
              is `cohorts(trainers)` — trainers, grouped by the month THEY
              joined. */}
          <SectionHead title="Trainer Cohorts" note="Trainers, by signup month" />
          {loading ? <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
            : trainersUnread ? <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so there was nothing to group into cohorts.</Text>
            : coh.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No trainer signups to group yet.</Text> : null}
          {coh.map((c) => bar(c.label, {
            label: c.label, right: `${c.pct}% · ${num(c.active)}/${num(c.total)}`, pct: c.pct, dim: c.pct < 60, tone: 'purple',
          }))}
        </Section>


        {/* ── trainer acquisition funnel ─────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer Acquisition Funnel" note={trainersUnknown || roll.trainers === 0 ? 'From signup' : `Of ${num(roll.trainers)} on the roster today`} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read. An empty funnel here would say nobody signed up, which is not something this screen found out.</Text>
          ) : roll.trainers === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers at your gym yet. The funnel fills in as they join.</Text>
          ) : funnel.map(([label, count, pct], i) => bar(label, {
            // One hue per stage, so the narrowing reads as four named steps
            // stacked rather than one bar drawn four times.
            label, right: `${num(count)} · ${pct}%`, pct, tone: FUNNEL_TONES[i % FUNNEL_TONES.length],
          }))}
        </Section>

        {/* ── how the codes have done, as figures ─────────────────────────
            On the ground above the list, as the look keeps tiles. Only from a
            WHOLE read: a first page of codes is not the gym's codes, and a
            code whose redemptions could not be counted (-1) withholds the
            total rather than being added in as nought. */}
        <KpiRow tiles items={[
          { label: 'Codes', value: fig(promosWhole ? num(promos.length) : null), tone: 'purple' },
          { label: 'Active', value: fig(promosWhole ? num(promos.filter((p) => p.active).length) : null), tone: 'brand' },
          { label: 'Used, All Time', value: fig(promosWhole && promos.every((p) => p.redeemed >= 0) ? num(promos.reduce((a, p) => a + p.redeemed, 0)) : null), tone: 'orange' },
        ]} />


        {/* ── promo / referral codes ─────────────────────────────────────── */}
        <Section>
          {/* The note read "Trainer subscriptions", which is what these codes
              were for in the subscription console this app used to be. They are
              redeemed by MEMBERS now — `offers.tsx` in the client app calls
              `redeem_promo` against this same `promos` table — so the label
              named the wrong audience entirely, on the one screen an owner
              reads aloud when explaining a promotion to somebody. */}
          <SectionHead title="Promo & Referral Codes" note="Redeemed by members" />
          {/* ── how the codes have done, then the tool that makes one ────────
              The list leads. This section opened on the create field, so the
              first thing under "Promo & Referral Codes" was a form, and what
              the codes already out there had DONE — the only performance
              figure this section has — was under it. "Used" is every
              redemption on record for the code, with no window on it: there is
              one row per member per code and nothing here buckets them by
              month, so no period is claimed. */}
          {promoStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your codes could not be read just now. This is not a statement that you have none.</Text>
          ) : promos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{promoStatus === 'loading' ? 'Loading.' : 'No codes yet. Create one below.'}</Text>
          ) : null}
          {promos.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...value(15), letterSpacing: 1, color: t.ink }}>{p.code}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {/* `fig` on the percentage: `src/ui/promos.tsx` builds this with
                      `Number(r.discount)`, straight off a numeric column, so a
                      12.5% offer is a shape this row can be handed and `{p.discountPct}`
                      wrote an English full stop into it. */}
                  {/* And `num` on the count, for the same reason one line up:
                      a gym whose code has been redeemed four thousand times
                      reads a grouped figure in its own locale. -1 is the
                      provider's "could not be counted", which is a dash and
                      never a zero. */}
                  {fig(p.discountPct)}% off · {p.redeemed < 0 ? '—' : num(p.redeemed)} used, all time
                </Text>
              </View>
              {/* Awaited. `toggleActive` and `removePromo` became server calls
                  that deliberately check the affected row count — and both call
                  sites still threw the answer away, so a refused toggle or a
                  refused delete was a silent no-op. The provider went to the
                  trouble of finding out; the screen has to say. */}
              <Pressable onPress={async () => { if (!await toggleActive(p.id)) Alert.alert('Not Changed', `“${p.code}” could not be switched ${p.active ? 'off' : 'on'}, so it is still ${p.active ? 'active' : 'off'}.`); }} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: p.active ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.active ? 'Active' : 'Off'}</Text>
              </Pressable>
              <Pressable onPress={async () => { if (!await removePromo(p.id)) Alert.alert('Not Deleted', `“${p.code}” could not be deleted, so it is still live and can still be redeemed.`); }} accessibilityLabel="Delete code" accessibilityRole="button" hitSlop={8}
                style={{ paddingHorizontal: sp.xs, paddingVertical: sp.xs }}>
                <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
              </Pressable>
            </View>
          ))}

          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Create a Code</Text>
          </View>
          {/* Before the field, the same standing warning Lane 93 put on
              app/(owner)/promotions.tsx, because this screen offers the SAME
              create path from the same provider and said nothing at all. The
              duplicate check `addPromo` runs is against the array this screen
              holds: under 'error' that is the last successful read or nothing,
              under 'partial' it is the first page of a longer list, so on both
              a code that already exists can pass it. Creating is still offered
              — a gym past the read ceiling cannot make itself smaller — and
              what changes is that the screen says which check cannot run. */}
          {promoStatus === 'error' || (promoStatus !== 'loading' && !isWhole(promoStatus)) ? (
            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
              {promoStatus === 'error'
                ? 'Your existing codes could not be read, so nothing here can tell you whether the code you are about to type is already in use.'
                : 'Your existing codes did not all come back, so the ones above are part of the list rather than all of it, and nothing here can tell you whether the code you are about to type is further down it.'}
            </Flag>
          ) : null}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
            {/* Named. `CODE` is a placeholder, and a placeholder is gone the
                moment somebody types into it. */}
            <TextInput value={code} onChangeText={setCode}
              accessibilityLabel="The promo or referral code to create"
              placeholder="CODE" placeholderTextColor={t.ink3}
              autoCapitalize="characters" autoCorrect={false}
              style={{ ...ty.body, ...font('500'), letterSpacing: 1, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }} />
            <Cta label="Create" onPress={create} />
          </View>
          {/* Last in the card now, so the trailing margin is only there when
              the caveat follows it. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: lastCaveat ? sp.xl : 0 }}>
            {DISCOUNTS.map((d) => { const on = disc === d; return (
              <Pressable key={d} onPress={() => setDisc(d)}
                accessibilityRole="button" accessibilityLabel={`${d} percent off`} accessibilityState={{ selected: on }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                <Text style={{ ...ty.label, ...font('500'), color: on ? t.brandInk : t.ink2 }}>{d}%</Text>
              </Pressable>); })}
          </View>

          {/* The caveat from the creation just made, kept on the screen after
              the alert carrying it has been dismissed. It opens by saying the
              code is live, because it is: this is a check that did not run, not
              a failure to create, and it must not read as one. It stays until
              the next creation, because the fact it records — that this
              particular code went in unchecked — does not stop being true when
              the owner taps OK. */}
          {lastCaveat ? (
            <Flag tone={t.warn}>
              “{lastCaveat.code}” is live. {lastCaveat.note} Two codes spelled the same
              way can both be saved, and a member typing one of them gets whichever the
              database reaches first, so pull down to read your codes again and check
              this one is the only one.
            </Flag>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
