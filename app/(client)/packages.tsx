// Client · Memberships & packs. What you have bought from your coach, what you
// are subscribed to, what is left, and what else they sell. Real data via
// connect.ts and subscriptions.ts.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): the remaining-sessions figure becomes the screen's one
// hero instead of a bordered box with a 40px 900-weight number, and purchases
// are hairline-separated rows with a 3px meter. Every figure still comes from
// `client_purchases` — nothing is defaulted when the query returns nothing.
//
// Recurring packages (part 97) live here too, because this is the screen a
// client opens to answer "what am I paying for". Three sentences on it are
// load-bearing and none of them may be guessed:
//
//   "You are not subscribed"  — never printed on a failed read. Somebody who is
//                               paying, told that, subscribes again.
//   the renewal date          — never printed unless Stripe stated one.
//   the amount                — never printed unless we know the CURRENCY it is
//                               in. `client_purchases` stores no currency, so a
//                               purchase whose package has gone is a dash, not
//                               a number with a dollar sign guessed onto it.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { BRAND } from '../../src/lib/brands';
import { View, Text, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Meter, Ghost, Cta, Flag, ListRow, fig } from '../../src/ui/kit';
import { sp, layout, hairline, radius, type as ty, numeric } from '../../src/theme/scale';
import { normaliseCode, checkoutCodeBlocker, type PromoTarget } from '../../src/lib/packagePromo';
import { fetchMyPurchases, fetchTrainerPackages, packageLabels, buyPackage, openPurchasePortal, portalPurchase, myPtPasses, type Purchase, type TrainerPackage, type PtPassRow } from '../../src/lib/connect';
// The routed balance, shared with app/(client)/pt-sessions.tsx and
// app/(client)/session-credits.tsx so the three screens cannot answer "how many
// sessions can I book" three ways. See its header for what they each read.
import { bookableCredits, creditsHeroNote, creditsEmptyLine } from '../../src/lib/sessionCredits';
import { useToday } from '../../src/ui/today';
import { packBalance, type PackPurchase } from '../../src/lib/packDraw';
import { withDeadline } from '../../src/lib/readDeadline';
// What a validity window means on the client's own side of the sale: the day it
// closes, and — where it closed with credits on it — how many they paid for and
// did not take. Never a silent zero. See src/lib/packExpiry.ts.
import { expiryLine } from '../../src/lib/packExpiry';
import { isoToday } from '../../src/lib/dayPlan';
import { useAuth } from '../../src/ui/auth';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../../src/lib/readCache';
import { fmtFullDay } from '../../src/lib/format';
import {
  fetchMySubscriptions, myCoachId, subscribeToPackage, cancelSubscription, resumeSubscription,
  openSubscriptionPortal, pkgMoney, pkgPriceLine, statusLabel, isLive, type ClientSubscription,
} from '../../src/lib/subscriptions';
import { BACK_ICON } from '../../src/ui/direction';

export default function ClientPackages() {
  const t = useTheme();
  const router = useRouter();
  // null is not []. [] is somebody who has bought nothing; null is a purchase
  // history we could not read — and telling a paying customer they have no
  // purchases is the one sentence here that must never be guessed.
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The SUBSCRIPTIONS read, which had no failure state of its own. `if (s)
  // setSubs(s)` dropped a refusal silently, so the cached copy stayed on screen
  // and was drawn as fact — "Active · renews 14 March" to a member whose card
  // failed last week, with `past_due` invisible for exactly as long as the read
  // kept failing. This file's own header promises the renewal date is "never
  // printed unless Stripe stated one".
  const [subsFailed, setSubsFailed] = useState(false);
  // The same distinction again, for the thing that charges again next month.
  const [subs, setSubs] = useState<ClientSubscription[] | null>(null);
  const [offers, setOffers] = useState<TrainerPackage[] | null>(null);
  // ── the other place a PT credit comes from ────────────────────────────
  //
  // This screen is headed "what you've bought from your coach", and that is why
  // it read `client_purchases` and stopped. But its hero is "Sessions
  // Remaining", which is not a question about `client_purchases` — it is the
  // question a member asks before they book, and a gym can sell the answer out
  // of `gym_passes` (supabase/parts/370). A member whose gym sold them a PT
  // pass and assigned them a coach got NO hero here at all, while
  // app/(client)/pt-sessions.tsx told them 0 and
  // app/(client)/session-credits.tsx told them 8. Three screens, three answers,
  // one balance.
  //
  // `undefined` is still loading, `null` is a read that did not land. Not
  // cached: a pack somebody bought does not change in a basement, which is the
  // argument for the cache below, and a PASS balance changes every time a
  // session is marked. The rest of this screen may be a week old and say so;
  // the figure somebody is about to book against may not.
  const [passes, setPasses] = useState<PtPassRow[] | null | undefined>(undefined);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachErr, setCoachErr] = useState<string | null>(null);
  // Name AND currency, from the package row — the two things a purchase does
  // not carry itself. An id missing from this map is a package we could not
  // read (see packageLabels), which is why a pack can end up described by its
  // size and an amount can end up as a dash.
  const [pkgInfo, setPkgInfo] = useState<Map<string, { name: string | null; currency: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  /** The signed-in account, purely to key this device's copy of these lists. */
  const uid = useAuth().user?.id ?? null;
  /** When the purchases on screen were last confirmed, or null when they just
   *  were. Non-null means what is drawn came off this phone. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * The discount code, and which package's box is open.
   *
   * ── Why there is a box at all ─────────────────────────────────────────
   *
   * There was not one. The code was collected on Stripe's own hosted page
   * (`allow_promotion_codes`), which is less to build and put the code
   * somewhere nothing in this app could see — and the restriction of a code to
   * ONE package is recorded in Stripe metadata that Stripe does not enforce, so
   * a code meant for one membership worked on every other one the coach sold.
   * Typed here, it travels with the request and can be checked before a session
   * exists. src/lib/packagePromo.ts carries the argument.
   *
   * Behind a disclosure rather than on every row: most clients have no code,
   * and an empty box under every price reads as a price that is negotiable.
   * null is "no box open", which is not the same as an open box holding
   * nothing.
   */
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);

    // ── this device's copy, before the network ──────────────────────────
    //
    // "Anything you have paid for is still yours — it just is not readable
    // right now" was the honest thing to say when there was nothing to show.
    // Now there usually is: what somebody bought does not change while they are
    // in a basement, so a cached list of purchases is very nearly always still
    // true, and it is labelled with its age either way.
    //
    // The package names and currencies are cached alongside, because a purchase
    // row carries neither: without them every amount on this screen renders as
    // a dash, and a list of packs with no prices is barely a list. No currency
    // is ever assumed — a purchase whose package is not in the cache still
    // shows a dash rather than a number in some default unit.
    if (uid) {
      try {
        const [rawP, rawS, rawI] = await Promise.all([
          AsyncStorage.getItem(cacheKey('purchases', uid)),
          AsyncStorage.getItem(cacheKey('subscriptions', uid)),
          AsyncStorage.getItem(cacheKey('packageLabels', uid)),
        ]);
        const cachedP = readCache<Purchase>(rawP);
        // `rows === null` means the device taught us nothing, which must never
        // become "No purchases yet" — the empty state two screens down.
        if (cachedP.rows && withinHorizon(cachedP.at)) {
          setRows(cachedP.rows);
          setCachedAt(cachedP.at);
          const cachedS = readCache<ClientSubscription>(rawS);
          if (cachedS.rows) setSubs(cachedS.rows);
          const cachedI = readCache<{ id: string; name: string | null; currency: string | null }>(rawI);
          if (cachedI.rows) setPkgInfo(new Map(cachedI.rows.map((r) => [r.id, { name: r.name, currency: r.currency }])));
        }
      } catch { /* no usable cache; the reads below are the only source */ }
    }

    // ── the network half, under a ceiling ───────────────────────────────
    //
    // Every read below reports a failure by handing back null, and this screen
    // is built around that: a null leaves the cached list alone and raises the
    // banner beside it. What none of them can report is a request that never
    // SETTLES, and no request in this app carries a timeout — see
    // src/lib/readDeadline.ts.
    //
    // That case cost this screen more than most, because `loading` gates the
    // WHOLE body at line 346. The device's own copy of the purchases is read
    // immediately above, precisely so a member in a basement can still see what
    // they have bought — and on a gym wifi behind a captive portal
    // `setLoading(false)` was never reached, so the spinner sat over that
    // cached list for the life of the app. The fallback was unreachable in
    // exactly the condition it was written for.
    //
    // A stall is reported as the failure it is: the rows already on screen stay
    // (src/lib/staleRead.ts — a read that did not land is not a purchase that
    // stopped existing), and the banners this screen already has say so.
    const first = await withDeadline(Promise.all([fetchMyPurchases(), fetchMySubscriptions(), myCoachId(), myPtPasses()]));
    if (!first.answered) {
      setFailed(true);
      setSubsFailed(true);
      // A stall over a balance is a failed read of it, not an empty pass list.
      setPasses((v) => (v === undefined ? null : v));
      // Any non-null string raises the flag; the sentence itself is in the
      // render. Not knowing who coaches you is exactly what this is.
      setCoachErr('The server did not answer.');
      setLoading(false);
      return;
    }
    const [p, s, c, g] = first.value;
    // Assigned straight through, null included. Unlike the purchases above
    // there is no cached copy to protect, and null is this screen's word for
    // "we could not read it" — which `bookableCredits` turns into 'unknown' and
    // never into a nought.
    setPasses(g);
    // `p === null` is a failed read. Assigning it would wipe the cached list
    // above — replacing what somebody bought with the fact that we could not
    // ask, which is the exact substitution this screen's own header warns
    // about. `failed` still records it, and the render below shows the cached
    // list with its age when there is one and the failure state when there is
    // not.
    if (p) setRows(p);
    setFailed(p === null);
    if (s) setSubs(s);
    setSubsFailed(s === null);
    setCoachId(c.coachId); setCoachErr(c.error);
    // What the coach currently sells — null means the read failed, which is not
    // "your coach sells nothing".
    // `null` is already this screen's word for "we could not read the coach's
    // packages", and the flag under it is already written. A stall is that.
    const listRead = c.coachId ? await withDeadline(fetchTrainerPackages(c.coachId)) : null;
    const list = listRead == null ? null : listRead.answered ? listRead.value : null;
    setOffers(c.coachId ? list : []);
    // The name and the unit for every past purchase on this screen. A purchase
    // row carries neither of its own — no currency column at all, and no name —
    // so both come from the package it was bought from, in one read. An id this
    // does not come back with is a package the client cannot see — which since
    // part 147 means DELETED, not merely withdrawn: pkg_read now lets a buyer
    // read any package they paid for. See packageLabels.
    const ids = [...(p ?? []).map((r) => r.package_id), ...(s ?? []).map((r) => r.package_id)].filter(Boolean) as string[];
    // The names and currencies. A stall here leaves whatever the device's cache
    // taught us in place rather than emptying the map: without it every amount
    // on this screen renders as a dash, and a list of packs with no prices is
    // barely a list. No currency is invented either way — an id this map does
    // not hold still shows a dash rather than a number in some default unit.
    const infoRead = await withDeadline(packageLabels(ids));
    const info = infoRead.answered ? infoRead.value : null;
    // Replaced only when BOTH lists it labels came back; merged otherwise.
    //
    // `ids` is built out of `p` and `s`, so a failed purchases read makes it
    // empty, `packageLabels([])` returns an empty Map, and assigning that wiped
    // the names and currencies this screen had just restored from the device
    // cache — leaving the cached purchases listed with a generic label and a
    // dash where every amount should be. A list of packs with no prices is
    // barely a list, and it was produced by a read that failed rather than by
    // anything about what the member bought.
    //
    // No currency is invented by the merge: an id the map does not hold still
    // renders as a dash rather than a number in some default unit, which is the
    // rule this whole screen is built on.
    if (info) {
      setPkgInfo((prev) => (p != null && s != null ? info : new Map([...prev, ...info])));
    }
    // Cached only when the purchases actually came back. `p === null` is a
    // failed read, and writing that over a good copy would replace what
    // somebody bought with the fact that we could not ask.
    if (uid && p) {
      setCachedAt(null);
      AsyncStorage.setItem(cacheKey('purchases', uid), packCache(p)).catch(() => { /* right this session either way */ });
      if (s) AsyncStorage.setItem(cacheKey('subscriptions', uid), packCache(s)).catch(() => { /* as above */ });
      if (info) {
        AsyncStorage.setItem(cacheKey('packageLabels', uid),
          packCache([...info].map(([id, v]) => ({ id, name: v.name, currency: v.currency }))))
          .catch(() => { /* as above */ });
      }
    }
    setLoading(false);
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  // The currency of a past amount, and nothing else. Kept as its own lookup so
  // every `pkgMoney`/`pkgPriceLine` call below still reads the same as before.
  const cur = useMemo(() => {
    const m = new Map<string, string>();
    pkgInfo.forEach((v, k) => { if (v.currency) m.set(k, v.currency); });
    return m;
  }, [pkgInfo]);
  // What each pack is called, for the packs whose package is still readable.
  const pkgNames = useMemo(() => {
    const m = new Map<string, string | null>();
    pkgInfo.forEach((v, k) => m.set(k, v.name));
    return m;
  }, [pkgInfo]);

  // `rows === null` is a history we could not read, and `packBalance` carries
  // that through as `left: null` rather than flattening it to a zero. The hero
  // below prints the figure only when there is one; a null renders as the
  // failure panel further down, never as "0 sessions remaining" to somebody
  // holding ten.
  const balance = useMemo(() => packBalance(rows as PackPurchase[] | null, pkgNames), [rows, pkgNames]);
  // A failed read used to strand this screen for the whole session — the only
  // way to ask again was to leave and come back. Pull to refresh is the
  // gesture people already try; see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => load(), [load]));
  const remaining = balance.left;
  // The day a gym pass is judged live against — `useToday`, which re-reads at
  // the next local midnight and on every return to the foreground, because a
  // pass that lapsed overnight decides whose money pays for the next session.
  const today = useToday();
  // The bookable figure, by the same composition the other two screens use.
  // `remaining` above is still the coach-pack half and is still what the pack
  // LIST below is about; `book.left` is what a member can actually book, which
  // is the coach's pack when they hold one at all — empty included, because an
  // exhausted coach pack still beats a live gym pass — and the gym's pass
  // otherwise.
  //
  // `rows == null` and NOT `balance.lines`. `packBalance(null)` returns
  // `{ lines: [], left: null }` — the null is carried on the figure, correctly,
  // and the LIST is an empty array either way. Handing that empty array to
  // `bookableCredits` tells it "this member holds no coach pack", which is the
  // one fabrication `chooseRoute` exists to refuse: it would fall straight
  // through to the gym's pass and print the gym's balance to somebody whose
  // coach pack simply could not be read — and the coach pack is what the
  // database would actually have drawn from. Three screens got this right by
  // holding a `PackBalance | null`; this one holds the rows, so the null has to
  // be re-derived here.
  const book = useMemo(
    () => bookableCredits(rows == null ? null : balance.lines, passes === undefined ? null : passes, today),
    [rows, balance, passes, today]);
  const packLines = useMemo(() => new Map(balance.lines.map((l) => [l.id, l])), [balance]);
  // `balance.lines` is oldest first, the order redeem_pack_session spends them
  // in, so the first one with anything left is the one the next booking draws
  // from. null when nothing is left to draw.
  // A pack whose validity window has closed can no longer be drawn on, whatever
  // its balance says — part 612 reduces `sessions_total` so that every draw site
  // in the database stops at it — so it is not the pack anything comes off next.
  const nextPackId = balance.lines.find((l) => !l.exhausted && !l.expired && l.left > 0)?.id ?? null;
  // Fixed for the render. Every expiry sentence below is about a calendar day,
  // and a bound recomputed per row would let two lines on the same screen
  // disagree about what today is across a midnight.
  const todayKey = isoToday(new Date());
  // Subscriptions the client is actually on the hook for. A cancelled one from
  // last year is history, not a thing they are paying.
  const liveSubs = (subs ?? []).filter((s) => isLive(s.status));
  const subIds = new Set(liveSubs.map((s) => s.package_id).filter(Boolean));
  // What is left to buy: everything the coach sells that this client is not
  // already subscribed to. A one-off pack stays on offer however many they own.
  const buyable = (offers ?? []).filter((p) => !(p.billing_interval && subIds.has(p.id)));
  /**
   * Whether we actually know what this member is already paying for.
   *
   * `subIds` is built out of what came BACK. A refused or unanswered
   * subscriptions read leaves `subs` null, so `liveSubs` is empty, so `subIds`
   * is empty, so the very package this member is already subscribed to comes
   * back into the list below under a live "Subscribe" button — and a second tap
   * is a second Stripe subscription and a second charge every month until
   * somebody notices. `fetchMySubscriptions`' own docstring names this exact
   * consequence: "the obvious response to that sentence is to subscribe, and
   * the client is then paying their coach twice a month."
   *
   * The flag above the list said so in prose and the button under it stayed
   * enabled. A sentence is not a guard when the thing it warns about is one tap
   * away, so the recurring rows below are shown — a member is still entitled to
   * see what their coach sells — and cannot be bought until we know.
   *
   * `subsFailed` rather than `subs === null`, so a WARM CACHE does not count as
   * knowing either: it is up to a week old (see `withinHorizon`), and a
   * subscription taken out since is exactly the one that would not be in it.
   */
  const subsUnknown = subsFailed;
  const G = layout.gutter;

  /** The package, in the shape the code rule reads. */
  const promoTargetOf = (p: TrainerPackage): PromoTarget =>
    ({ id: p.id, name: p.name, billingInterval: p.billing_interval, active: p.active, priceCents: p.price_cents });

  /**
   * The code as it stands for one package, or the reason it cannot be sent.
   *
   * Null while the box is closed or empty — a client who has not typed anything
   * has not made a mistake, and a refusal under an untouched box is a screen
   * telling somebody off for nothing.
   */
  const codeProblem = (p: TrainerPackage): string | null =>
    codeFor === p.id && code.trim() ? checkoutCodeBlocker(code, promoTargetOf(p)) : null;

  const start = async (p: TrainerPackage) => {
    // The screen's copy of the rule, so a client is not sent to Stripe to be
    // told no. connect-checkout runs the same one from the same module.
    const problem = codeProblem(p);
    if (problem) { Alert.alert('That code cannot be used here', problem); return; }
    const typed = codeFor === p.id ? normaliseCode(code) : '';
    setBusy(p.id);
    // Both kinds take one now. On a subscription Repple's cut is a percentage
    // and scales with the discount by itself; on a one-off it is an absolute
    // figure Stripe wants in the same call it works the discount out in, so the
    // server honours a code there only where the discounted total is knowable
    // exactly first — and refuses every other shape before anything is charged.
    // `oneOffDiscount` in src/lib/packagePromo.ts is that rule, and it can only
    // run where the coupon is, which is the server.
    const r = p.billing_interval ? await subscribeToPackage(p.id, typed) : await buyPackage(p.id, typed);
    setBusy(null);
    if (!r.ok) { Alert.alert('Could not start checkout', r.error || 'Try again in a moment.'); return; }
    // Cleared only once the payment page has actually opened. `ok` used to mean
    // "a URL came back", not "a browser opened" — `openUrl` in
    // src/lib/connect.ts swallowed the failure — so a member whose browser
    // never opened was told nothing, lost the code they had typed, and was left
    // waiting for a checkout that had not started. `buyPackage` now answers on
    // the open itself.
    //
    // And so does the subscription arm. `subscribeToPackage` in
    // src/lib/subscriptions.ts kept the old answer for a while after this
    // comment was written; it now returns the same `false` on the same
    // failure, so BOTH branches of the line above mean "a browser opened" and
    // the code below this is cleared only when one did.
    setCodeFor(null);
    setCode('');
  };

  const stop = (s: ClientSubscription) => {
    // Guarded and localised. `fmtFullDay` returns a dash for a timestamp that
    // does not parse, where this printed the literal words "Invalid Date"
    // into a sentence about money.
    const ends = s.current_period_end ? fmtFullDay(s.current_period_end) : null;
    Alert.alert('Cancel this subscription?',
      ends
        ? `You keep it until ${ends} — you have already paid for this period — and you will not be charged again.`
        : 'You keep it until the end of the period you have already paid for, and you will not be charged again.',
      [{ text: 'Keep It', style: 'cancel' }, { text: 'Cancel Subscription', style: 'destructive', onPress: async () => {
        setBusy(s.id);
        const r = await cancelSubscription(s.stripe_subscription_id);
        setBusy(null);
        // Stripe's answer, not ours. Saying "cancelled" on a failure would stop
        // the client trying again, and they would be charged next month.
        if (!r.ok) { Alert.alert('Not cancelled', (r.error || 'The change did not go through.') + ' Your subscription is still running — try again in a moment.'); return; }
        load();
      } }]);
  };

  const resume = async (s: ClientSubscription) => {
    setBusy(s.id);
    const r = await resumeSubscription(s.stripe_subscription_id);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not restarted', (r.error || 'The change did not go through.') + ' It is still set to end.'); return; }
    load();
  };

  /**
   * The one billing portal this client has, and what it is opened FROM.
   *
   * A subscription first, because that is the account Stripe keeps their card
   * on when there is one. Otherwise the newest purchase Stripe created a
   * Customer for — which is what gives a pack-only buyer a portal at all. Both
   * are opened by the server in the object's OWN Stripe account context, so a
   * coach on direct charges and one still on the platform both work.
   *
   * Null for both is a real state and it is not an error: every sale made
   * before part 282 has no Customer to open. The render says so rather than
   * drawing a button that produces a refusal.
   */
  const portalSub = liveSubs.find((s) => !!s.stripe_subscription_id) ?? null;
  const portalBuy = portalSub ? null : portalPurchase(rows);

  const openBilling = async () => {
    setBusy('portal');
    const r = portalSub
      ? await openSubscriptionPortal(portalSub.stripe_subscription_id)
      : portalBuy ? await openPurchasePortal(portalBuy.id)
      : { ok: false as const, error: 'There is no billing account to open.' };
    setBusy(null);
    if (!r.ok) Alert.alert('Billing', r.error || 'Could not open billing in a browser.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          200 rather than 40 because the discount code belongs to the LAST package in the list,
          and the Buy button under it has to come up with the field. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Connect</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Memberships &amp; Packs</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>What you've bought from your coach and what's left.</Text>
          </View>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
        </View>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} accessible accessibilityRole="progressbar" accessibilityLabel="Reading what you have bought…" /> : (
          <>
            {/* ── how old this screen is, before any of it is read ──────────
                This banner was a hundred lines down, below the subscriptions
                section, the billing section and a rule, and its own comment
                argued that it belongs above the list "because a member checking
                how many sessions are left on a pack is about to plan around the
                number". The number is the hero, three lines below this. The
                cache horizon is a WEEK, so "4" could be seven days old, and a
                member books four sessions and finds two of them uncovered. */}
            {cachedAt && (rows ?? []).length ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{cachedAtLine(cachedAt)}</Flag> : null}
            {/* The one figure on this screen somebody plans their week around.
                Shown only when the history was actually read: `remaining` is
                null for a refused read, and a hero reading "0" would tell a
                client holding ten that they have none. The failure panel below
                says what actually happened. */}
            {book.route === 'gym_pass' && book.left != null ? (
              /* ── the balance this screen could not see ──────────────────
                 No coach pack, and a live PT pass the gym sold them. The hero
                 was gated on `balance.lines.length > 0` — coach packs only —
                 so this member got no figure here at all while the other two
                 screens gave them two different ones. The note names the gym,
                 so a figure on a screen headed "bought from your coach" is not
                 mistaken for something they bought from their coach; the pack
                 list below still, correctly, shows nothing. */
              /* No second route to the ledger beside it: the "Session Credits"
                 row below already goes there, for every member, and two rows to
                 one screen a few inches apart reads as two different places. */
              <Hero label="Sessions Remaining" figure={fig(book.left)} note={creditsHeroNote(book) ?? ''} />
            ) : balance.lines.length > 0 && remaining != null ? (
              <Hero label="Sessions Remaining" figure={fig(remaining)}
                note={balance.live > 0
                  ? `Across ${balance.live} active pack${balance.live === 1 ? '' : 's'}${balance.exhausted ? ` · ${balance.exhausted} used up` : ''}${balance.stranded ? ` · ${balance.stranded} ran out of time` : ''}`
                  // "Used up" is a claim that they had the sessions, and it is
                  // false of a pack that ran out of time with credits on it.
                  // The two are the same zero and opposite sentences about
                  // somebody's money — see src/lib/packExpiry.ts.
                  : balance.stranded
                    ? `${balance.stranded} session${balance.stranded === 1 ? '' : 's'} you paid for ran out of time before ${balance.stranded === 1 ? 'it was' : 'they were'} used`
                    : `Every pack you have bought is used up`} />
            ) : null}

            {/* Their next booking is not covered by anything they have paid
                for. Said plainly rather than left to be inferred from a meter
                sitting at zero. */}
            {/* An empty entitlement, named. Through `creditsEmptyLine` rather
                than a local `remaining === 0`, because the sentence has to say
                WHICH thing is empty: a member holding a spent gym pass was
                being told to buy another pack from a coach who never sold them
                one. Null when there is a balance to book against, and null for
                'none' here — a member who holds nothing at all needs no warning
                on the screen that sells them their first pack. */}
            {book.route !== 'none' && creditsEmptyLine(book) ? (
              <Flag tone={book.route === 'unknown' || book.left == null ? t.crit : t.warn}>
                {creditsEmptyLine(book)}
              </Flag>
            ) : null}

            {/* The balance answers "how many", and the next two questions a
                person asks are "which ones used the rest" and "which of the
                ones in my diary are going to use these". Both live on the
                ledger, which reads a gym-sold PT pass and a coach-sold pack
                the same way. */}
            <ListRow icon="calendar" title="Session Credits"
              note="Which sessions used a credit, and what your bookings are due to draw"
              onPress={() => router.push('/(client)/session-credits')} />

            <Rule />

            {/* ── what recurs ────────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Your Subscriptions" note={subs && liveSubs.length ? String(liveSubs.length) : undefined} />
              {subs === null ? (
                <Flag tone={t.crit}>
                  We couldn't read your subscriptions. This is not a statement that you have none — if you
                  are subscribed to your coach you still are, and you should not subscribe again from here.
                </Flag>
              ) : subsFailed ? (
                // Rows on screen AND a failed read: this is the cached copy,
                // and the state and the date on it are whatever was true when
                // it was written. A card that failed since would not show here.
                <Flag tone={t.warn}>
                  These are the subscriptions this phone last read, and they could not be checked just now — so
                  the state and the date on each one are not confirmed as current. A payment that failed since
                  would not be shown here.
                </Flag>
              ) : liveSubs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>You have no recurring subscription. Anything your coach sells monthly appears below.</Text>
              ) : null}
              {(subs === null ? [] : liveSubs).map((s, i) => (
                <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>Coaching subscription</Text>
                    {/* The amount Stripe bills, in the currency Stripe bills it
                        in. Unknown is a dash — never a zero, and never a figure
                        with a currency guessed onto it. */}
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>
                      {fig(pkgPriceLine(s.amount_cents, s.currency || (s.package_id ? cur.get(s.package_id) : null), s.billing_interval))}
                    </Text>
                  </View>
                  {/* The dot says past-due, ending or live in colour alone.
                      Grouped with the sentence beside it so the state is
                      spoken rather than only seen. */}
                  <View accessible accessibilityRole="text"
                    accessibilityLabel={`${statusLabel(s.status)}${s.cancel_at_period_end ? ', ending at the end of the period' : ''}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'past_due' ? t.crit : s.cancel_at_period_end ? t.warn : t.brand }} />
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {statusLabel(s.status)}
                      {/* No date rather than a date we do not have. A renewal
                          day is the thing somebody plans around — and a date
                          off an unconfirmed copy is one this screen cannot
                          stand behind, so under a failed read it is withheld
                          exactly as a missing one is. */}
                      {subsFailed
                        ? ' · not confirmed just now'
                        : s.current_period_end
                        ? ` · ${s.cancel_at_period_end ? 'ends' : 'renews'} ${fmtFullDay(s.current_period_end)}`
                        : ' · renewal date not known'}
                    </Text>
                  </View>
                  {s.status === 'past_due' ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Flag tone={t.crit}>
                        Your last payment did not go through. The subscription has not ended — update your
                        card and it carries on.
                      </Flag>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                    {s.cancel_at_period_end
                      ? <Ghost label={busy === s.id ? 'Working…' : 'Keep Subscription'} onPress={() => resume(s)} />
                      : <Ghost label={busy === s.id ? 'Working…' : 'Cancel'}
                          a11yLabel={`Cancel your ${(s.package_id ? pkgNames.get(s.package_id) : null) || 'subscription'} at the end of the period`}
                          onPress={() => stop(s)} />}
                  </View>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── your card, your invoices, your money back ────────────────
                This button used to live INSIDE the loop above, and that was not
                a layout accident: `openSubscriptionPortal` takes a subscription
                id, so the only place it could be drawn was beside a
                subscription. A client who had only ever bought session packs
                therefore had no invoice, no card management and no route to a
                refund at all, and nothing on the screen said so.

                It is drawn once now, and what it opens depends on what the
                client actually has. A subscription opens its own portal; with
                no subscription, the newest PURCHASE Stripe made a Customer for
                opens the same portal on the same account (part 282). Both open
                the card, the invoices and the receipts.

                The third state is the honest one and it is why this is not
                simply a button moved: every sale made before Checkout was asked
                to create a Customer has none, and there is nothing to open. A
                dead button is worse than a sentence, so the sentence says what
                is missing and who can act on it. */}
            <Section>
              <SectionHead title="Payment & Invoices" />
              {/* BOTH reads, because the button is chosen from both. The guard
                  was `subs === null` alone, and the final arm of this chain is
                  an assertion about the member's money: "Stripe has no billing
                  account for anything you have bought here." `portalBuy` is
                  `portalPurchase(rows)`, and `fetchMyPurchases` answers `null`
                  for a refusal, a stall AND a truncated read — so a member
                  whose purchases read failed while their subscriptions read
                  came back empty was told, as a fact, that there is no receipt
                  and no route to a refund for anything they have ever paid for.
                  Twenty lines below, the same failed read renders the panel
                  that says the opposite: "This is our end, not a statement
                  about what you have bought."

                  `subsUnknown` rather than `subs === null` for the other half,
                  for the reason this file already gives where that flag is
                  defined: a WARM CACHE is not knowing either — it is up to a
                  week old, and a subscription taken out since is exactly the
                  one that would not be in it. */}
              {subsUnknown || subs === null || failed || rows == null ? (
                <Flag tone={t.crit}>
                  We couldn't read everything you have bought here, so we can't tell you which billing account to open.
                  This is our end, not a statement about what you are paying for.
                </Flag>
              ) : portalSub || portalBuy ? (
                <>
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Your card, your invoices and your receipts, on Stripe. Opens in your browser.
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                    <Ghost label={busy === 'portal' ? 'Opening…' : 'Open Billing'} onPress={openBilling} />
                  </View>
                </>
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Stripe has no billing account for anything you have bought here, so there is nothing to open.
                  Your coach can send a receipt or arrange a refund, and anything you buy from now on will have one.
                </Text>
              )}
            </Section>

            <Rule />

            {failed && !(rows ?? []).length ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>We couldn't load your purchases</Text>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 4, maxWidth: 320 }}>
                  This is our end, not a statement about what you have bought. Anything you have paid
                  for is still yours — it just is not readable right now.
                </Text>
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Try Again" onPress={load} />
                </View>
              </View>
            ) : (rows ?? []).length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
                <Icon name="trophy" size={30} color={t.ink3} />
                <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>No purchases yet</Text>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 4, maxWidth: 300 }}>When your coach offers memberships or session packs, buy them from their profile and they'll show up here.</Text>
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Browse Coaches" onPress={() => router.push('/(client)/trainers')} />
                </View>
              </View>
            ) : (
              <Section>
                <SectionHead title="Your Purchases" note={`${(rows ?? []).length}`} />
                {(rows ?? []).map((r, i) => {
                  // The pack line for this row, when it is a pack at all. It
                  // carries the label — the package's real NAME where the
                  // package is still readable, and a description of the pack
                  // where it is not. A pack a coach has withdrawn is invisible
                  // to the client who bought it (pkg_read is `active or
                  // trainer_id = auth.uid()`), and inventing a name for one is
                  // the same class of error as inventing its currency.
                  const line = packLines.get(r.id);
                  return (
                    <View key={r.id}>
                      {i > 0 ? <Rule /> : null}
                      <View style={{ paddingVertical: sp.md }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>
                            {line ? line.label : 'Membership'}
                          </Text>
                          {/* Was money(r.amount_cents), which rendered an unknown
                              amount as $0.00 and stamped a dollar sign on a price
                              paid in dirhams. With no unit there is no figure.

                              ── the SALE's currency first, the package's second ──
                              And it was `cur.get(r.package_id)` alone: the
                              package row's currency as it stands TODAY, over an
                              amount that moved months ago. `client_purchases.
                              currency` (part 132) is what Stripe actually
                              charged in, it is on the row this line is
                              rendering, and src/lib/connect.ts says in as many
                              words that the two are "not to be confused" —
                              "the package's currency is a lookup that can
                              change underneath a sale that already happened".

                              Two consequences, both on the client's own record
                              of what they paid: a coach who moved country and
                              re-priced a package had every past purchase of it
                              relabelled with the new code; and a purchase whose
                              package row has since been DELETED showed a dash
                              for a price the row beside it records perfectly
                              well. The subscription line above already reads
                              `s.currency || (lookup)` — this was the one that
                              never got the same fix. */}
                          <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>
                            {fig(pkgMoney(r.amount_cents, r.currency || (r.package_id ? cur.get(r.package_id) : null)))}
                          </Text>
                        </View>
                        {line ? (
                          <>
                            {/* The size of the pack, said out loud beside a
                                name that does not state it. "Kickstart Ten"
                                does not tell anybody it is ten sessions. */}
                            {line.named ? (
                              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{line.sessions_total}-session pack</Text>
                            ) : null}
                            <Meter label={line.expired
                              ? (line.sessionsExpired > 0
                                // Never "none left of ten". They had them and
                                // the window closed on them, which is a
                                // different thing to be told about your own
                                // money and the start of a conversation with
                                // the coach rather than the end of one.
                                ? `${line.sessionsExpired} of ${line.sessions_total} ran out of time`
                                // A credit that came BACK after the window
                                // shut. `refund_pack_session` (part 123)
                                // decrements `sessions_used` on the newest pack
                                // with usage without asking whether its window
                                // has closed, so a refund after expiry leaves a
                                // credit here that nothing will let the member
                                // draw. This row said "All 10 used before it
                                // ran out" while its own meter drew one
                                // remaining underneath — a sentence and a bar
                                // contradicting each other about somebody's
                                // money. The line below says what to do.
                                : line.left > 0
                                  ? `${line.left} of ${line.sessions_total} came back after it ran out`
                                  : `All ${line.sessions_total} used before it ran out`)
                              : line.exhausted ? `None left of ${line.sessions_total}` : `${line.left} of ${line.sessions_total} left`}
                              val={line.left} target={line.sessions_total} unit="" />
                            {/* The date, because "ran out of time" without one
                                is a thing that happened to them at no
                                particular moment. Null for the packs with no
                                window, which is every pack sold before part
                                612 — so nothing is added to a screen this does
                                not concern. */}
                            {expiryLine({ expiresOn: line.expiresOn, expiredAt: line.expiredAt, sessionsExpired: line.sessionsExpired }, line.left, todayKey) ? (
                              <Text style={{ ...ty.caption, color: line.expired && line.sessionsExpired > 0 ? t.ink2 : t.ink3, marginTop: 4 }}>
                                {expiryLine({ expiresOn: line.expiresOn, expiredAt: line.expiredAt, sessionsExpired: line.sessionsExpired }, line.left, todayKey)}
                              </Text>
                            ) : null}
                          </>
                        ) : (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>Active since {fmtFullDay(r.created_at)}</Text>
                        )}
                        {line ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                            Bought {fmtFullDay(r.created_at)}
                            {/* Which pack the next booking actually comes off.
                                `redeem_pack_session` draws from the oldest with
                                room, so this is a statement about what the
                                database will do, not a guess. */}
                            {nextPackId === r.id ? ' · your next session comes off this one' : ''}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </Section>
            )}

            <Rule />

            {/* ── what your coach sells ──────────────────────────────────── */}
            <Section>
              <SectionHead title="From Your Coach" />
              {coachErr ? (
                <Flag tone={t.crit}>We couldn't check who coaches you, so this is not a list of what is on offer.</Flag>
              ) : !coachId ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>You are not linked to a coach yet. Find one and their packages appear here.</Text>
              ) : offers === null ? (
                <Flag tone={t.crit}>
                  We couldn't read your coach's packages. This is not a statement that they sell none —
                  try again in a moment.
                </Flag>
              ) : buyable.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Your coach has nothing else on sale right now.</Text>
              ) : null}
              {(offers === null ? [] : buyable).map((p, i) => (
                <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{p.name}</Text>
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(pkgPriceLine(p.price_cents, p.currency, p.billing_interval))}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {p.billing_interval
                      ? `Charged every ${p.billing_interval === 'month' ? 'month' : 'year'} until you cancel. Cancel any time.`
                      : p.sessions ? `${p.sessions} sessions · paid once` : 'Paid once'}
                  </Text>
                  {/* ── a discount code ───────────────────────────────────
                      On both kinds now. It used to be offered on subscriptions
                      only, because a one-off could not take a code at all: the
                      platform's cut there is an absolute figure Stripe wants in
                      the same call it works the discount out in. It can take
                      one where the discounted total is knowable exactly
                      beforehand — see `oneOffDiscount` in
                      src/lib/packagePromo.ts — and where it is not, the server
                      refuses before anything is charged and says the price
                      shown is the price.

                      Behind a disclosure because most clients have none, and an
                      empty code box under every price reads as a price that is
                      negotiable. */}
                  {codeFor === p.id ? (
                    <View style={{ marginTop: sp.md }}>
                      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Discount code</Text>
                      {/* Normalised as it is typed, so what the client sees is
                          what is actually sent — Stripe upper-cases these and
                          drops everything that is not a letter or a digit, and
                          a box that quietly disagreed with the code on the
                          poster is a support message for the coach. */}
                      <TextInput value={code} onChangeText={(v) => setCode(normaliseCode(v))}
                        autoCapitalize="characters" autoCorrect={false}
                        placeholder="The code your coach gave you" placeholderTextColor={t.ink3}
                        accessibilityLabel="Discount code"
                        style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
                      {codeProblem(p) ? <Flag tone={t.crit} style={{ marginTop: sp.sm }}>{codeProblem(p)}</Flag> : null}
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        The discount is applied on the payment page, and what you see there is what you pay.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}>
                      <Ghost label="Have A Code" onPress={() => { setCodeFor(p.id); setCode(''); }} />
                    </View>
                  )}
                  {p.billing_interval && subsUnknown ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                      We could not read what you are already subscribed to, so this cannot be bought right
                      now — if you are already on it, subscribing again would charge you twice every
                      {p.billing_interval === 'month' ? ' month' : ' year'}. Pull down to try the read again.
                    </Flag>
                  ) : null}
                  <View style={{ marginTop: sp.md }}>
                    {/* A recurring package is not buyable while `subsUnknown`.
                        See the note on that flag: the guard used to be a
                        sentence at the top of the screen with a live button
                        under it. A one-off pack is unaffected — buying a second
                        ten-pack is a thing people do on purpose. */}
                    <Cta label={busy === p.id ? 'Opening…' : p.billing_interval ? 'Subscribe' : 'Buy'} wide
                      disabled={busy === p.id || !!codeProblem(p) || (!!p.billing_interval && subsUnknown)}
                      onPress={() => start(p)} />
                  </View>
                </View>
              ))}
              {/* Checkout happens in a browser and the confirmation arrives from
                  Stripe, not from the tap. So this screen does not claim a
                  payment succeeded — it says where the answer comes from and
                  offers the refresh that fetches it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                  Paying opens Stripe in your browser. A new subscription shows up here once Stripe confirms it,
                  which can take a moment.
                </Text>
                <Ghost label="Refresh" onPress={load} />
              </View>
            </Section>

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>Payments are processed securely by Stripe. {BRAND.label} never stores your card details.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
