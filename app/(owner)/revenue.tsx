// Owner · Revenue. What the gym was actually paid, what its coaches delivered,
// and the trend behind both.
//
// ── The screen used to be called Revenue and was not about revenue ────────
//
// Every figure on it was derived from ONE calculation: delivered sessions ×
// `tenants.session_fee`. Membership dues, class income, packages and pass sales
// were absent entirely — from a screen headed "Your gym's revenue" — while
// app/(owner)/members.tsx has been reading `gym_payments` two screens away for
// months. A gym whose income is mostly memberships, which is most gyms, was
// shown a revenue screen reporting a fraction of its takings as the whole of
// them, with nothing on screen saying which fraction.
//
// So the hero is now MONEY SOMEBODY RECORDED RECEIVING, from `gym_payments`,
// whatever it was for. Sessions × fee is still here and still worth having —
// it is what the coaching is WORTH, which is a different and useful question —
// but it is beside the takings under its own label rather than standing in for
// them.
//
// The two are never added. A payment recorded at the desk for a PT block and a
// session delivered out of that block are the same money counted twice, and
// nothing in the record links them.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): four bordered stat boxes and five stacked cards became
// one hero figure plus hairline-separated sections, and the Georgia serif
// header is gone.
//
// Also removed: the hardcoded 24-month trainer lifespan that was substituted
// whenever no churn had been observed. It rendered as "Trainer LTV $X · ~24 mo
// lifespan" — a measured-looking unit economic derived from a magic number.
// With no churn signal there is no lifespan and no LTV; the screen says so.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { num } from '../../src/lib/format';
import { plainExact } from '../../src/lib/units';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, KpiRow, Cta, Spark, Notice, fig, PageHead, Meter, Donut, Legend, type Slice, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { gymRollup, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { deltaLabel, deltaSign } from '../../src/lib/deltaLabel';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';
import { supabase } from '../../src/lib/supabase';
import {
  fetchPayments, sharedCurrency, money, fetchOnlineOrders,
  type GymPayment, type OnlineOrder,
} from '../../src/lib/gymRecord';
// Money Stripe took that the ledger does not hold.
//
// `fetchOnlineOrders` has existed since part 480 and had exactly one caller in
// the product — studio-web/app/accounting, a desktop console. Nothing in app/
// read it, so an owner holding a phone had no figure anywhere for a sale that
// charged a member and produced neither a membership nor a payment row.
//
// The counting rule is in src/lib/onlineMoneyGap.ts with its own suite, and the
// part of it that matters most is what `status = 'failed'` actually means:
// supabase/parts/281 defines it as "Stripe took the money and the entitlement
// could not be written", and the webhook gates the `gym_payments` insert on the
// same condition. It is not a declined card. It is money that arrived, that the
// member has nothing to show for, and that the hero above does not count.
import { onlineMoneyGap, NOT_TAKINGS_NOTE } from '../../src/lib/onlineMoneyGap';
import { reportError } from '../../src/lib/reportError';
// When these figures were read, whether the phone can reach us, and a way to
// ask again. This screen's own comment used to end "this screen has no
// pull-to-refresh, so without a button there is nothing an owner can actually
// do about it" — that button, and the stamp that says why it matters.
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useToday } from '../../src/ui/today';
// Which of this owner's gyms these figures are, and whether there are others.
// Renders nothing for a single-site owner — see src/lib/ownerSiteScope.ts.
import { fetchOwnerSites, SITES_LOADING } from '../../src/lib/ownerSiteScope';
import { siteNotice, type SiteScope } from '../../src/lib/ownedSites';

export default function OwnerRevenue() {
  const t = useTheme();
  const router = useRouter();
  // Every figure below is a roll-up of `trainers`, so until the roster read
  // returns they are all roll-ups of an empty array. Rendered without this flag
  // the screen opened on "Sessions delivered · 30 days · 0" and a value per
  // client of a dash — a revenue console reporting no revenue, which is the one
  // thing an owner would act on and the one thing it had not yet asked.
  const { trainers, loading, status: trainersStatus, sessions30, refresh } = usePlatformTrainers();
  const { tenant, status: tenantStatus } = useTenant();
  // `loading` was only half of it. A REFUSED roster read also leaves `trainers`
  // empty with `loading` false, and every roll-up below then computes a
  // confident 0 over it: "Sessions Delivered · 30 Days — 0", "Clients 0", a
  // forecast drawn from nothing. That is the same wrong screen the loading flag
  // was added to prevent, arriving a second later and staying. Overview already
  // tells the two apart; this is that check, here.
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
  const roll = gymRollup(trainers as TrainerLike[], tenant?.sessionFee ?? null);
  // The history hook PERSISTS what it is given, so this month's snapshot has to
  // be null rather than a zero we cannot vouch for — once "0 sessions" is in
  // AsyncStorage nothing afterwards can tell it from a month that really was
  // quiet, and the trend carries it forever. `sessions30` off the provider is
  // already null under a failed read; the `loading` half is ours, because a read
  // still in flight is no more a zero than a refused one is.
  // `status` was destructured away by both callers of this hook, and it is the
  // one available LoadStatus on this screen that was not gated. Under 'error'
  // the hook says so in as many words — it skips the merge and lets THIS
  // DEVICE'S CACHE stand alone — and the growth rate, the six-month forecast
  // and the "Not enough history yet" sentence were all computed over it with
  // nothing on screen to say the account's months had not been read.
  const { series, labels, delta, months, status: histStatus } = useSessionsHistory(trainersUnknown ? null : sessions30);
  const histWhole = isWhole(histStatus);

  // Monthly growth rate from the accumulating history (geometric, clamped).
  // `n` is the number of months ACTUALLY recorded, not the window length. It
  // used to be series.length, a constant 6, so two real snapshots were divided
  // over a five-month base and four of the six inputs were back-filled copies
  // of today's figure. With fewer than two real months there is no growth rate
  // and no forecast — the screen says so instead of projecting a flat line.
  const recorded = series.filter((v): v is number => v != null);
  const first = recorded.find((v) => v > 0) ?? roll.sessions30;
  const n = months;
  // Stored history survives a failed read, so `months` can still be 2 while
  // today's figure is unknown — and the growth rate divides by today's figure.
  // Forecasting from an unread month projects the gym to zero and puts a
  // confident "−50%/mo" on the screen.
  // `histWhole` joins the two conditions that were already here for the same
  // reason: a forecast is a claim about the gym's history, and a history read
  // that did not land is not a short history.
  const canForecast = histWhole && !trainersUnknown && n >= 2 && first > 0;
  let growth = canForecast ? Math.pow(roll.sessions30 / first, 1 / (n - 1)) - 1 : 0;
  growth = Math.max(-0.5, Math.min(0.5, growth));
  const forecast = Array.from({ length: 6 }, (_, i) => Math.round(roll.sessions30 * Math.pow(1 + growth, i + 1)));
  // The months the forecast lands in, so the chart can say WHICH six. It read
  // "Now" at one end and "6 mo →" at the other, which is a duration and not a
  // date — an owner could not tell whether the far end was February or March.
  //
  // Built with the Date constructor's own month rollover and read back through
  // local getters, the same way monthlyHistory.monthKey does it: `new Date(y,
  // m + k, 1)` normalises December + 1 into January of the next year, and
  // nothing here is ever parsed from a string, so a coach in Auckland gets
  // their own months and not UTC's.
  //
  // ── And they move ───────────────────────────────────────────────────────
  //
  // This was `useMemo(…, [])` reading `new Date()`. An empty dependency array
  // does not fix a value for a render, it fixes it for the life of the MOUNT,
  // and app/(owner)/_layout.tsx keeps this screen mounted — backgrounding the
  // app does not tear it down. An owner who opened Revenue on the 30th and came
  // back on the 2nd read a forecast whose first bar is the new month under a
  // label saying the old one, and every bar after it shifted by one, which is
  // precisely the confusion the paragraph above says these labels were added to
  // end: "an owner could not tell whether the far end was February or March."
  // The labels had stopped being able to answer that themselves.
  //
  // Keyed on `useToday()` rather than on a `useNow()`: the value that has to be
  // right is a MONTH, `useToday` re-settles on the local day rolling over and
  // on the app coming back to the foreground, and it compares before it sets —
  // so this recomputes at most once a day and produces a new array only on the
  // days it would produce a different one. The day string is also what the
  // months are derived FROM, so there is no second clock read to disagree with
  // the dependency.
  const today = useToday();
  const forecastLabels = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    return Array.from({ length: 7 }, (_, k) => {
      const d = new Date(y, (m - 1) + k, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, [today]);

  // Sessions delivered per trainer. The old split was by Repple plan, which is
  // what a trainer pays us — never a figure in the gym's own revenue.
  const byTrainer = [...trainers]
    .map((x) => ({ id: x.id, name: x.name, sessions: x.sessions30 }))
    .filter((x) => x.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const trainerTotal = byTrainer.reduce((a, x) => a + x.sessions, 0) || 1;

  // Value per client, from what the gym actually collects. `client_purchases`
  // is empty until payments are switched on, so this stays null rather than
  // dividing by a number nobody has earned.
  const fee = tenant?.sessionFee ?? null;

  /**
   * What the gym was actually paid in the last 30 days.
   *
   * `undefined` is "not read yet", `null` is "the read failed", and an array is
   * the answer — three states, because an empty array here would say "this gym
   * took nothing this month", which is the single most expensive wrong sentence
   * a revenue screen can produce.
   */
  const tenantId = tenant?.id ?? null;
  const [takings, setTakings] = useState<GymPayment[] | null | undefined>(undefined);
  /**
   * The window's online orders — paid and failed, which are the two statuses
   * that mean money moved.
   *
   * Same three states as `takings` and for the same reason, with one extra
   * sentence on the empty case: `[]` here means "no online sale in this window
   * went wrong", and that is a clean bill of health a refused read must never
   * be allowed to print. `null` says we could not ask.
   */
  const [orders, setOrders] = useState<OnlineOrder[] | null | undefined>(undefined);
  // Bumped by the Refresh control. A counter and not a boolean, because two
  // taps in a row have to be two reads.
  const [again, setAgain] = useState(0);
  // The moment the till read LANDED, not the moment it was asked for. A refused
  // read leaves this where it was: the figures on screen are still the ones
  // from the earlier read, and moving the stamp would be the same wrong
  // sentence one layer up.
  const [tillAt, setTillAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** And when the ROSTER landed — the other half of this screen, and the half
   *  the sessions figures and the trend are computed from. It had no stamp, so
   *  "Read just now" after a till refresh spoke for a roster nobody had asked
   *  for again. */
  const [rosterAt, setRosterAt] = useState<number | null>(null);
  useEffect(() => { if (trainersStatus === 'ready') setRosterAt(Date.now()); }, [trainersStatus]);
  /** One line over both, and it is the age of the older. */
  const fetchedAt = oldestFetch(tillAt, rosterAt);
  useEffect(() => {
    let on = true;
    // A tenant read that FAILED is not a screen still loading. Without this the
    // till read never starts — there is no `tenantId` to read it with — and the
    // hero sat on "Reading what your gym was paid…" for ever, with the Refresh
    // control re-entering this effect and returning at the same line. The
    // failure is reported as what it is, in the sentence the `null` branch of
    // the hero already carries.
    if (tenantStatus === 'error') { setTakings(null); setOrders(null); return; }
    if (!tenantId) { setTakings(undefined); setOrders(undefined); return; }
    setBusy(true);
    const now = Date.now();
    const since = new Date(now - 30 * 86400000).toISOString();
    fetchPayments(supabase, tenantId, since)
      .then((r) => { if (on) { setTakings(r); setTillAt(Date.now()); } })
      // fetchPayments throws on a PostgREST error and on a truncated read. Both
      // become null, which renders a dash and a sentence — never a zero.
      .catch((e) => { reportError('ownerRevenue.payments', e); if (on) setTakings(null); })
      .finally(() => { if (on) setBusy(false); });
    /*
     * The same window, asked of `gym_orders`.
     *
     * A read of its own and not chained onto the one above, because the two
     * answer different questions and either may fail alone: a refused ORDER
     * read must not blank the takings hero, and a refused PAYMENT read must not
     * silence a shortfall that is sitting right there in Stripe. The upper
     * bound is `now` — `fetchOnlineOrders` requires one, and the reason its
     * header gives is the reason /accounting and /close both learned: an
     * open-ended window grows without limit and the figures then filter it back
     * down.
     */
    fetchOnlineOrders(supabase, tenantId, since, new Date(now).toISOString())
      .then((r) => { if (on) setOrders(r); })
      .catch((e) => { reportError('ownerRevenue.onlineOrders', e); if (on) setOrders(null); });
    return () => { on = false; };
  }, [tenantId, tenantStatus, again]);

  // Both halves of the screen, together. The roster comes from the provider and
  // the till from the effect above, and an owner pressing one control expects
  // the whole screen to be current afterwards — not half of it.
  const refreshAll = useCallback(() => { setAgain((n) => n + 1); refresh(); }, [refresh]);
  // The screen said so itself: "the retry is the provider's own `refresh` —
  // this screen has no pull-to-refresh, so without a button there is nothing an
  // owner can actually do about it." There is now, and it runs both halves.
  const pull = usePullToRefresh(refreshAll);

  /**
   * The till, and the currency it is honestly in.
   *
   * `sharedCurrency` is the same rule /money and the console's Overview use: a
   * set whose rows disagree has NO currency, and a row stating none does not
   * agree with one that does. A gym that changed its currency has two in its
   * ledger, and adding them is not a total — it is a bigger number.
   */
  const till = useMemo(() => {
    if (!takings) return null;
    if (!takings.length) return { cents: 0, count: 0, currency: cur, empty: true };
    return {
      cents: takings.reduce((a, p) => a + p.amountCents, 0),
      count: takings.length,
      currency: sharedCurrency(takings),
      empty: false,
    };
  }, [takings, cur]);

  /** The till by payment method — see "How It Was Paid" in the render. Null
   *  whenever the till has no one currency to state a slice in. */
  const sources = useMemo((): Slice[] | null => {
    if (!takings || !till || till.empty || till.currency == null) return null;
    const METHODS: [GymPayment['method'], string, Tone][] = [
      ['card', 'Card', 'blue'], ['cash', 'Cash', 'brand'], ['transfer', 'Transfer', 'purple'],
      ['direct_debit', 'Direct Debit', 'teal'], ['other', 'Other', 'neutral'],
    ];
    const out = METHODS.map(([m, label, tone]): Slice => {
      const cents = takings.filter((p) => p.method === m && p.amountCents > 0).reduce((a, p) => a + p.amountCents, 0);
      return { label, tone, value: cents, shown: money(cents, till.currency) };
    }).filter((s) => (s.value as number) > 0);
    return out.length ? out : null;
  }, [takings, till]);

  /**
   * What Stripe took that the till above does not have.
   *
   * Computed only over a read that LANDED. `onlineMoneyGap` over `[]` says
   * "nothing went wrong", and handing it the empty array a failed read leaves
   * behind would print that sentence over a question nobody managed to ask.
   */
  const gap = useMemo(() => (orders ? onlineMoneyGap(orders, cur) : null), [orders, cur]);
  // `roll.payroll30` is delivered × fee over an empty roster, which is a real 0
  // when the gym delivered nothing and an unknown when we could not ask.
  const revenue30 = trainersUnknown ? null : roll.payroll30;
  // Not `Math.round(...)`. That is "to zero decimal places", which is the right
  // number of places for sixteen currencies and wrong for the rest: at a gym
  // with twelve clients and a payroll of 728.50 it printed 61 where the figure
  // is 60.71, and `gymMoney` then drew it as "GBP 61.00". The formatter takes
  // the places from the gym's own currency; nothing needs rounding first.
  /**
   * Delivered-session value spread over EVERY client on the book.
   *
   * Including the ones who did nothing this month, which is the part that has
   * to be said out loud. app/(trainer)/analytics.tsx computes the coach's
   * version over `payingClients` — clients who actually had a session that
   * month — and prints a sentence under the row saying so, because "Value /
   * Client" next to a "Clients" tile reads as the first divided by the second
   * and here it genuinely is: the very division that screen refuses.
   *
   * The owner screen has no per-client delivery data to narrow the divisor
   * with — `roll` carries `delivered30` per TRAINER, not per client — so the
   * figure is not silently recomputed over a population this screen cannot
   * see. It is labelled for what it is instead, which is the honest half of
   * the same fix and is why the caption below the row is not optional.
   */
  const valuePerClient = revenue30 != null && roll.clients > 0 ? revenue30 / roll.clients : null;
  // Said the same way wherever a figure is missing for the same reason, so an
  // owner reading three dashes is told once what they mean.
  const unreadNote = 'Your trainers could not be read';

  /* ── whose gym these figures are ────────────────────────────────────────
   *
   * Every number on this screen is ONE tenant's — `src/ui/tenant.tsx` reads a
   * single row — and until now nothing said so. An owner of four gyms looking
   * at a 30-day take had no way to tell it was a quarter of their business.
   *
   * `siteNotice` returns null for the single-site owner, which is almost
   * everybody, so this renders nothing at all in the ordinary case. Its other
   * job is the failed read: under one, the count is unknown rather than 1, and
   * saying nothing would be indistinguishable from having checked. */
  const [scope, setScope] = useState<SiteScope>(SITES_LOADING);
  useEffect(() => {
    let live = true;
    void fetchOwnerSites(supabase as any).then((s) => { if (live) setScope(s); });
    return () => { live = false; };
  }, [again]);
  const sites = siteNotice(scope);

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* Not "Platform revenue". Every figure below is this gym's own —
            sessions its coaches delivered, at its own session fee — and "the
            platform" is what a trainer pays Repple, which the header of
            src/ui/trainers.tsx rules is not a gym owner's business at all. */}
        <PageHead title="Revenue" />
        {/* What these figures cover. Null — and so absent entirely — for the
            one-gym owner, which is the overwhelming case and is asserted in
            ownedSites.test.ts. */}
        {sites ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{sites}</Text>
        ) : null}

        {/* ── the figure ─────────────────────────────────────────────────── */}
        {/* The figure is the TILL, not the coaching. Whatever the money was for
            — a membership, a class, a pack, a drop-in at the desk — if somebody
            recorded it, it is in here; if nobody did, it is not, and the note
            says how many payments the figure is made of so a suspiciously small
            one is legible as a recording gap rather than a bad month.

            A card rather than the kit's bare `Hero`: the one block on this
            screen the board does not draw. */}
        {(() => {
          const figure = fig(till && !till.empty ? money(till.cents, till.currency) : till?.empty ? money(0, cur) : null);
          const note = takings === undefined
            ? 'Reading what your gym was paid…'
            : takings === null
            ? 'Your payments could not be read. This is not a month in which the gym took nothing.'
            : till?.empty
            ? 'No payment has been recorded in 30 days. That is not the same as no income. It is the same as nobody having entered one.'
            : till && till.currency == null
            ? `${till.count} payments, in more than one currency, so there is no one total to state.`
            : `${till?.count} payment${till?.count === 1 ? '' : 's'} recorded: memberships, classes, packs and the desk, whatever somebody entered`;
          return (
            /* The night hero, built here rather than with the kit's `HeroCard`
               because its title wraps and this one must not: a money figure is
               shrunk to fit and never wrapped — broken across two lines it is
               a different number. */
            <View accessible accessibilityLabel={`Taken in 30 days, ${figure}, ${note}`}
              style={{ backgroundColor: t.night, borderRadius: radius.xl, padding: 20, marginTop: 14, ...elevation.hero }}>
              <Text style={{ ...ty.eyebrow, color: t.nightInk3 }}>TAKEN · 30 DAYS</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
                style={{ ...ty.hero, ...numeric, color: t.nightInk, marginTop: 6 }}>{figure}</Text>
              <Text style={{ ...ty.label, color: t.nightInk2, marginTop: sp.sm }}>{note}</Text>
            </View>
          );
        })()}

        {/* ── how it was paid ─────────────────────────────────────────────
            The till above as a mix, by the method somebody recorded against
            each payment. Drawn only when the till is ONE currency and has
            something in it: a ring round two moneys is the sum this screen
            refuses, and an empty ring under "no payment recorded" is the same
            sentence twice. Refunds and corrections are negative and are in the
            figure above but in no slice — a share of a whole cannot be owed. */}
        {sources ? (
          <Section>
            <SectionHead title="How It Was Paid" note="Payments recorded" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg }}>
              <Donut slices={sources} centre={num(sources.length)} sub={sources.length === 1 ? 'method' : 'methods'}
                spoken={`How the last 30 days were paid. ${sources.map((s) => `${s.label} ${s.shown ?? ''}`).join(', ')}`} />
              <View style={{ flex: 1, minWidth: 160 }}><Legend items={sources} /></View>
            </View>
          </Section>
        ) : null}

        {/* Under the figure rather than in the header, because it is about
            the whole screen and not about one figure — and so the first
            viewport is the till and not the plumbing. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={busy} />

        {/* ── money Stripe took that this ledger does not hold ────────────
            Deliberately directly under the hero and deliberately OUTSIDE it.
            The figure above is what somebody recorded receiving; these are
            sales that charged a member and produced no payment row, so they are
            absent from it. They are not added to it and not taken off it —
            `NOT_TAKINGS_NOTE` says so in the one place that sentence lives. */}
        {orders === null ? (
          <Notice tone={t.warn} kicker="Not Ruled Out"
            title="Your Online Sales Could Not Be Read"
            note="So whether any member was charged online without getting what they bought is unknown for this window. That is not the same as nothing having gone wrong." />
        ) : gap?.any ? (
          <Notice tone={gap.unfulfilled.count > 0 ? t.crit : t.warn}
            kicker="Taken by Stripe, Missing from Your Ledger"
            title="Money That Did Not Reach Your Payment Record"
            note={NOT_TAKINGS_NOTE}>
            <View style={{ marginTop: sp.lg }}>
              <KpiRow items={[
                {
                  label: 'Charged · Nothing Delivered',
                  value: fig(money(gap.unfulfilled.cents, gap.unfulfilled.currency)),
                  delta: gap.unfulfilled.count === 0
                    ? 'none this window'
                    : gap.unfulfilled.gap === 'unstated'
                    ? `${num(gap.unfulfilled.count)} orders, in more than one currency, so there is no one total`
                    : `${num(gap.unfulfilled.count)} order${gap.unfulfilled.count === 1 ? '' : 's'}: the member paid and holds nothing`,
                },
                {
                  label: 'Delivered · Not Recorded',
                  value: fig(money(gap.unledgered.cents, gap.unledgered.currency)),
                  delta: gap.unledgered.count === 0
                    ? 'none this window'
                    : gap.unledgered.gap === 'unstated'
                    ? `${num(gap.unledgered.count)} orders, in more than one currency, so there is no one total`
                    : `${num(gap.unledgered.count)} sale${gap.unledgered.count === 1 ? '' : 's'}, usually a month closed as it landed`,
                },
              ]} />
              {/* An order counted and not summed is the one way this block
                  could under-report itself, so it is said rather than left to
                  the difference between two numbers. */}
              {gap.unfulfilled.unstated + gap.unledgered.unstated > 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {num(gap.unfulfilled.unstated + gap.unledgered.unstated)} of these state no readable
                  amount or currency, so they are counted above and not included in either figure.
                </Text>
              ) : null}
            </View>
          </Notice>
        ) : null}

        {/* Said once, at the top, rather than left for an owner to infer from a
            screen of dashes: the dashes are unknowns, not a quiet month. The
            retry is the provider's own `refresh`, which the Refresh control
            under the title now also calls; this button is the same action
            beside the sentence that explains why it is needed. */}
        {trainersUnread ? (
          <Notice tone={t.warn} kicker="Nothing Here Is Your Gym's"
            title="Your Roster Could Not Be Read"
            note="Every figure on this screen is a roll-up of your trainers, so none of them can be stated.">
            <View style={{ marginTop: sp.lg }}>
              <Cta label="Try Again" wide onPress={refresh} />
            </View>
          </Notice>
        ) : null}


        {/* ── unit economics ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Unit Economics" note="Per client" />
          {/* The session fee is the tenant's own row, not a roll-up, so it
              survives a failed roster read and is still worth stating. */}
          <KpiRow items={[
            {
              label: 'Sessions · 30 Days',
              value: trainersUnknown ? '—' : num(roll.sessions30),
              // Not the bare word 'delivered'. `sessions30` is every booking
              // whose clock has passed whatever its outcome — a no-show and a
              // cancellation keep `status = 'booked'` and are in this count —
              // while `At Your Fee` beside it prices `delivered30` alone. The
              // caption names which of the two the figure is.
              delta: loading ? 'not read yet'
                : trainersUnread ? unreadNote
                : delta !== 0 ? `${deltaSign(delta, 0)}${num(Math.abs(delta))} vs last month`
                : `${num(roll.delivered30)} marked delivered`,
            },
            {
              // What the COACHING is worth, and it is deliberately not added to
              // the till above: a pack paid for at the desk and the sessions
              // drawn out of it are the same money, and nothing in the record
              // links the two.
              label: 'At Your Fee',
              value: trainersUnknown ? '—' : fig(gymMoney(revenue30, cur)),
              // "sessions × fee" named the count in the tile to its left, which
              // is not the one this is priced over: `payroll30` is
              // `delivered30 × fee` and skips every no-show and cancellation.
              delta: fee == null ? 'no session fee set' : 'delivered sessions × fee, not takings',
            },
            { label: 'Session Fee', value: fig(gymMoney(fee, cur)), delta: fee == null ? 'not set' : 'per delivered session' },
            { label: 'Value / Client', value: trainersUnknown ? '—' : fig(gymMoney(valuePerClient, cur)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : valuePerClient == null ? 'needs a session fee' : 'over every client on the book' },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(roll.clients),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : roll.avgClientsPerTrainer == null ? 'no trainers yet' : `${plainExact(roll.avgClientsPerTrainer)} avg / trainer` },
          ]} />
          {/* Said under the row, in the same place and for the same reason the
              coach's own analytics screen says it: three numbers in a line read
              as though the third were the first two divided into each other,
              and here that is exactly what it is — over a population that
              includes everybody who did nothing this month. */}
          {!trainersUnknown && valuePerClient != null ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Value per client counts every client on the book, not only those who trained.
            </Text>
          ) : null}
        </Section>


        {/* ── trend ──────────────────────────────────────────────────────── */}
        <Section>
          {/* `delta` counts SESSIONS — it comes out of useSessionsHistory,
              whose whole point is that it is a different unit from the MRR
              history it sits next to. It was printed through a dollar
              formatter, so a month that gained twelve sessions read "+$12 vs
              last mo" under a heading saying Sessions, and an owner had no way
              to know which of the two the screen meant. */}
          <SectionHead title="Sessions Trend"
            note={!histWhole ? 'your months could not be read'
              : delta !== 0 ? `${deltaSign(delta, 0)}${num(Math.abs(delta))} session${Math.abs(delta) === 1 ? '' : 's'} vs last mo`
              : 'Tracking started'} />
          {!histWhole ? (
            /* Not "not enough history": the sentence below is a claim about
               this gym, and under a failed read the only months in hand are
               the ones this handset happened to keep. */
            <Text style={{ ...ty.label, color: t.ink3 }}>Your recorded months could not be read, so the trend and the forecast are held back. Pull down to try again.</Text>
          ) : months >= 2 ? (
            /* With the holes, and with the months. See the same note on the
               owner dashboard: filtering the nulls out drew the line over four
               points and the labels over six, so each point was reported under
               a month it did not belong to. */
            <Spark data={series} labels={labels} area tone="blue" />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet. A snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>One real snapshot per month. Months before you started are left blank.</Text>
        </Section>


        {/* ── forecast ───────────────────────────────────────────────────── */}
        <Section>
          {/* The rate is judged at the precision it is PRINTED at. A growth of
              0.002 rounds to nothing at whole percents, and the old expression
              signed it anyway — "+0%/mo" over a six-month forecast line, which
              reads as growth an owner can plan against. */}
          <SectionHead title="6-Month Forecast" note={canForecast ? deltaLabel(growth * 100, { since: null, unit: '%/mo', decimals: 0, noChange: 'flat' }) : undefined} />
          {canForecast ? (<>
            <Spark data={[roll.sessions30, ...forecast]} labels={forecastLabels} h={58} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Now {num(roll.sessions30)}</Text>
              {/* rtl-ok: the arrow points into the FUTURE, not along the page.
                  It is the same claim the Spark above it makes and the Spark is
                  an <Svg> that cannot mirror, so a flipped arrow here would
                  have the forecast running back towards "Now". */}
              <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>6 mo → {num(forecast[5])}</Text>
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Projected from {n} months of your own history: a guide, not a guarantee.
            </Text>
          </>) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {trainersUnknown
                ? 'A forecast is drawn from this month against the months before it, and this month is not known yet.'
                : 'A forecast needs at least two months of recorded sessions. Come back next month.'}
            </Text>
          )}
        </Section>


        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Sessions by Trainer" note={byTrainer.length > 0 ? `${num(trainerTotal)} in 30d` : undefined} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            // Before this branch an empty `byTrainer` — which is what a refused
            // read leaves behind — printed a flat statement about the gym's
            // last thirty days.
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so what they delivered is not known. This is not a month with no sessions in it.</Text>
          ) : byTrainer.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No sessions delivered in the last 30 days.</Text>
          ) : byTrainer.map((p) => {
            const pct = Math.round((p.sessions / trainerTotal) * 100);
            // The kit's labelled 8pt bar where a 3pt hairline was: the name in
            // bold, the count and its share at the trailing edge, spoken once.
            return <Meter key={p.id} label={p.name} val={p.sessions} target={trainerTotal} tone="blue"
              note={`${num(p.sessions)} · ${pct}%`} />;
          })}
        </Section>


        {/* Where the online money is. The till above is what somebody RECORDED
            receiving; card money taken through the gym's own Stripe account
            has its own book, including the orders Stripe charged for and the
            gym never granted. */}
        <Section>
          <SectionHead title="Online Orders" note="Stripe" onPress={() => router.push('/(owner)/orders')} />
          <Text style={{ ...ty.label, color: t.ink3 }}>What sold, receipts, and any order charged but never delivered.</Text>
        </Section>


        {/* ── revenue at risk ────────────────────────────────────────────── */}
        <Section>
          {/* The noun agreed with the count and the verb did not: one client
              under a flagged trainer read "1 client ARE with them". The same
              sentence is on the owner dashboard and is fixed there too — they
              are two renders of one fact and must not start disagreeing about
              how to say it. */}
          {roll.atRiskCount > 0 ? (
            <Notice tone={t.warn} kicker="Needs a Look" title={`${roll.atRiskCount} Trainer${roll.atRiskCount === 1 ? '' : 's'} Flagged`}
              note={`${roll.atRiskClients} client${roll.atRiskClients === 1 ? '' : 's'} ${roll.atRiskClients === 1 ? 'is' : 'are'} with them.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Review Trainers" wide onPress={() => router.push('/(owner)/trainers')} />
              </View>
            </Notice>
          ) : (<>
            <SectionHead title="Revenue at Risk" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {loading ? 'Reading your roster…'
                : trainersUnread ? 'Your trainers could not be read, so none of them could be scored. Nobody has been cleared here.'
                : roll.trainers === 0 ? 'No trainers at your gym yet.'
                : 'No trainers flagged watch or high risk.'}
            </Text>
          </>)}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
