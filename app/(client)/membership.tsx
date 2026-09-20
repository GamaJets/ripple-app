// Client · Membership. The gym-member home: your member pass, the sessions you
// have actually logged this month, and the places you can go from here — entry
// barcode, classes, personal training, bookings, offers, referrals and packs.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): one hero figure instead of four competing bordered
// tiles, and a single card spent on the thing you actually do here (show the
// barcode).
//
// Fabrication removed in this pass: the card used to print a "Plan · Member"
// and a "Valid until <today + 1 year>" that no billing system had ever issued,
// a "Loyalty points" figure invented as (visit days × 10 + log entries × 2)
// with no loyalty program behind it, and a "Balance · Add top-up ›" tile for
// an account balance that does not exist. Nothing replaced them — what is left
// is the member number, which is derived from the signed-in user, and visit
// counts, which come from the real workout log.
//
// ── And then nothing replaced them for rather too long ─────────────────────
//
// Removing the invention was right and left the screen unable to answer the
// three questions a paying member opens it to ask: which plan am I on, is it
// still running, and when does it renew. The real answers were in `memberships`
// and `membership_plans` the whole time (part 29) and had simply never been
// read by anything but the owner console.
//
// They are read here now, and the difference from what was removed is that
// every figure comes off a row somebody recorded. Where there is no row the
// screen says there is no row. In particular:
//
//   · a plan the gym never attached and a plan we were not allowed to read are
//     two different sentences, not one blank field — see rule 1 in
//     src/lib/memberRecord.ts, and supabase/parts/125 for the live hole that
//     made the second case real;
//   · "Active" comes from the DATES, not from `memberships.status`, which no
//     job moves and which was still reading 'active' on a membership that
//     ended in March;
//   · and no renewal date is ever computed from an interval. "Valid until
//     <today + 1 year>" is exactly what this screen is not doing again.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ActionCard, ListRow, Ghost, PageHead, Flag, FigureCard, Meter, fig, type Tone } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import type { IconName } from '../../src/ui/Icon';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useClientData } from '../../src/ui/clientData';
import { fmtFullDay } from '../../src/lib/format';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { useBrand } from '../../src/ui/brand';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../../src/lib/readCache';
import { memberNoFrom, MEMBER_NO_CHANGED_NOTE } from '../../src/lib/membership';
import {
  amount, fetchMyMemberships, isCurrent, planStateOf, primaryMembership, renewalNote,
  standingLabel, standingOf, type MemberMembership,
} from '../../src/lib/memberRecord';
// The pause, in words. Reused rather than reimplemented: app/(owner)/members.tsx
// has printed these exact sentences off these exact two columns since
// supabase/parts/2616, and the member — the person whose access to a building
// it is — was reading the bare word "Frozen" with no date it lifts. Two
// renderings of one rule is how the desk and the phone come to disagree.
import { freezeState, frozenDays, freezeLine } from '../../src/lib/membershipFreeze';
// The purchase behind the membership above. `gym_orders_own_r` has admitted the
// member to their own orders since supabase/parts/281 and part 800's header
// says the table "is read by the member's own purchase history" — which did not
// exist. This is it. `memberships.note` is deliberately NOT here: see the
// header of src/lib/membershipOrder.ts and supabase/parts/125.
import {
  fetchMyOrders, orderForMembership, intentLabel, orderAmount, orderStatusLine,
  orderAbsence, type MemberOrder,
} from '../../src/lib/membershipOrder';
import { useToday } from '../../src/ui/today';
import { localDate } from '../../src/lib/localDate';
import { appLocale } from '../../src/lib/locale';
import { END_ALIGN } from '../../src/ui/direction';

/** A bare ISO date as a member reads it. Local, because a date column means a
 *  calendar day in the reader's own life — see src/lib/localDate.ts. */
function day(iso: string | null): string {
  const d = localDate(iso);
  if (!d) return fig(null);
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A label and a fact, one line. */
function Line({ t, label, value, first }: { t: ReturnType<typeof useTheme>; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: END_ALIGN }} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export default function Membership() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const { appName } = useBrand();
  const auth = useAuth();
  const uid = auth.user?.id || '';
  // Under 'error' the log is empty because it could not be read. This screen's
  // one live number is "sessions logged this month", and a member who trained
  // twelve times was shown a zero under it with "No sessions logged yet this
  // month" spelled out underneath — a specific, checkable claim about their own
  // month that the app was in no position to make.
  //
  // The gate was `!== 'error'`, which admits 'loading' — so that same sentence
  // was still printed to EVERY member on the first frame, before the read had
  // come back at all. `isWhole` is the gate loadStatus.ts asks for and excludes
  // 'loading' and 'partial' as well.
  const logKnown = isWhole(logStatus);
  // The brand's prefix, not the literal 'RPL'. This line already prints the
  // gym's name beside the number, so a chain's member read their gym's name and
  // their gym's supplier's initials in one string. See src/lib/membership.ts.
  const memberNo = memberNoFrom(c.name, c.id, appName);
  // ── and whether it may be printed at all ─────────────────────────────────
  //
  // `memberNoFrom` seeds on `id || name`, and `useClientData` publishes
  // `id: sbUid ?? 'unknown'` (src/ui/clientData.tsx). `sbUid` is null until an
  // `await supabase.auth.getUser()` inside an effect resolves — and stays null
  // for the whole session when that request never settles, which the same
  // provider's header records happening on captive-portal wifi. So the seed is
  // the literal string 'unknown' and the derivation is a pure function of it:
  // every member of a brand is shown the SAME number, on the screen whose whole
  // job is to name them, and one who reads it off here and gives it to
  // reception has handed over somebody else's.
  //
  // app/(client)/access.tsx — the barcode built from this exact call — already
  // refuses to draw on precisely this test and says why. It was the only one of
  // the two that did, so a member could be refused the card on Access and read
  // the placeholder number off Membership one tap earlier, then walk to the
  // desk with it.
  const idKnown = !!c.id && c.id !== 'unknown';
  const nameKnown = !!c.name.trim();
  const memberNoKnown = idKnown && nameKnown;

  // The day this screen is being read on. Declared here rather than beside the
  // membership standing further down, because the memo below needs it too and
  // was the one place on this screen still frozen.
  //
  // The comment on `primaryMembership` records this fix being made for the
  // standing and gives the argument in full: this screen is registered
  // `href: null` in app/(client)/_layout.tsx, so it mounts once and is never
  // torn down, and nothing on it renders on a clock. `useToday` holds the day
  // as state and re-reads it at the next local midnight and on every return to
  // the foreground.
  const today = useToday();

  const { visits, last } = useMemo(() => {
    // ── "This Month" was whichever month it was when `log` last changed ──
    //
    // This was `const now = new Date()` inside a memo keyed on `[log]` alone,
    // and the figure it produces is captioned "Sessions Logged This Month".
    // So a member who opened Membership on 30 September and came back on 2
    // October read September's count under the word "This" — and one who had
    // trained on the 1st read "No sessions logged yet this month" unless the
    // log itself happened to change. `check:frozen-day` only flags an EMPTY
    // dependency list, so `[log]` sailed through it while behaving the same way.
    //
    // Compared as a `YYYY-MM` prefix off the local day rather than through
    // Date parts on both sides: `today` is already the member's own local day,
    // and matching strings keeps a timezone out of a question that has none.
    const thisMonth = today.slice(0, 7);
    const days = new Set<string>();
    let latest = 0;
    for (const e of log) {
      const d = new Date(e.t);
      if (Number.isFinite(d.getTime())) {
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (month === thisMonth) days.add(d.toDateString());
      }
      const ts = Date.parse(e.t); if (ts > latest) latest = ts;
    }
    // `day()` at the top of this file already goes through `appLocale()`; this
    // line was the one that did not, so two dates on one screen were written
    // two different ways.
    const lastLabel = latest ? fmtFullDay(new Date(latest).toISOString()) : '—';
    return { visits: days.size, last: lastLabel };
  }, [log, today]);

  /* ── the membership itself ────────────────────────────────────────────── */

  const [mships, setMships] = useState<MemberMembership[]>([]);
  const [mStatus, setMStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  /** When this membership was last confirmed by the server, or null when it
   *  just was. Non-null means what is on screen came off this phone. */
  const [mCachedAt, setMCachedAt] = useState<string | null>(null);

  const loadMembership = useCallback(async () => {
    if (!USE_SUPABASE) { setMStatus('ready'); return; }
    if (!uid) { if (!auth.loading) setMStatus('error'); return; }

    // ── this device's copy, before the network ──────────────────────────
    //
    // "Not cleared" below was as far as this could go: it kept whatever was
    // already on screen, and on a cold launch in a basement there was nothing
    // on screen to keep. A member standing inside the building their membership
    // is for could not see that they were a member.
    //
    // A membership ages gracefully — it is a plan and a pair of dates, not a
    // timetable — so the default week-long horizon applies rather than the two
    // days the class list uses. Whatever is shown is labelled with its age.
    try {
      const cached = readCache<MemberMembership>(await AsyncStorage.getItem(cacheKey('memberships', uid)));
      // `rows === null` is "we learnt nothing from the device". It must not
      // become "your gym has no record of you", which is the sentence directly
      // below this one on the screen.
      if (cached.rows && cached.rows.length && withinHorizon(cached.at)) {
        setMships(cached.rows);
        setMCachedAt(cached.at);
      }
    } catch { /* no usable cache; the read below is the only source */ }

    const res = await fetchMyMemberships(supabase, uid);
    if (!res.ok) {
      reportError('membership.load', new Error(res.reason));
      // Not cleared. Under 'error' the section says the read failed and what is
      // on screen is the last thing we knew — never "you have no membership",
      // which is a specific claim about somebody's standing at their own gym.
      setMStatus('error');
      return;
    }
    setMships(res.value);
    setMStatus('ready');
    setMCachedAt(null);
    AsyncStorage.setItem(cacheKey('memberships', uid), packCache(res.value))
      .catch(() => { /* the membership is right this session either way */ });
  }, [uid, auth.loading]);
  useEffect(() => { void loadMembership(); }, [loadMembership]);

  /* ── and how it was bought ───────────────────────────────────────────── */
  //
  // A separate read from a separate table with its own policy, kept in its own
  // state for the reason the membership read above is: the two fail
  // independently. `gym_orders` refusing must leave the plan, the standing and
  // the dates exactly where they are — the purchase is a footnote to the
  // membership and must never be able to take it off the screen.
  //
  // Not cached to the device. The membership is, because a member standing in
  // the building needs to see that they are a member; an order is a historical
  // receipt nobody is refused entry over, and caching money means a figure that
  // can be read as current while being a week old.
  const [orders, setOrders] = useState<MemberOrder[]>([]);
  const [oStatus, setOStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const loadOrders = useCallback(async () => {
    if (!USE_SUPABASE) { setOStatus('ready'); return; }
    if (!uid) { if (!auth.loading) setOStatus('error'); return; }
    const res = await fetchMyOrders(supabase, uid);
    if (!res.ok) {
      reportError('membership.orders', new Error(res.reason));
      // NOT cleared, and NOT an empty list. `orderAbsence(false)` is the
      // sentence for this: "we couldn't read your purchases" is a different
      // fact from "your gym recorded this at the desk", and printing the second
      // one over a failed read tells a member who paid by card that they did
      // not.
      setOStatus('error');
      return;
    }
    setOrders(res.value);
    setOStatus('ready');
  }, [uid, auth.loading]);
  useEffect(() => { void loadOrders(); }, [loadOrders]);

  // The four reads this screen shows: the gym's membership record (which has
  // its own "Try Again" beside the failure, and this is the same read), the
  // order behind it, the profile, and the training log the visit count is
  // derived from.
  const pull = usePullToRefresh(useCallback(() => {
    void loadMembership(); void loadOrders(); c.reload(); reloadLog();
  }, [loadMembership, loadOrders, c.reload, reloadLog]));

  // The screen can be open across midnight, and a membership that expired at
  // 00:00 must not still read "Active".
  //
  // This line used to be `todayIso(new Date())` in the render body, under a
  // comment ending "because the component has not re-rendered for a new day" —
  // which names the hole it left. Moving the call out of a `useMemo` changed a
  // value frozen at MOUNT into one frozen at the LAST RENDER, and this screen
  // is registered `href: null` in app/(client)/_layout.tsx, so it mounts once
  // and is never torn down. Nothing here renders on a clock. A member who
  // opened Membership on Sunday evening and came back to it on Wednesday was
  // still being judged against Sunday, and "Active" is the single word on this
  // screen they would act on — it is what tells them the door will open.
  //
  // `useToday` (src/ui/today.ts) holds the day as state and re-reads it at the
  // next local midnight and on every return to the foreground, which is the
  // render this line was already written to be correct in.
  const primary = primaryMembership(mships, today);
  const standing = primary ? standingOf(primary, today) : null;
  const planState = primary ? planStateOf(primary) : null;

  /* ── the pause, and the two places it can disagree with the status ───────
     `freezeState` wants the GYM's day (src/lib/gymZone.ts), and `today` here is
     the member's own device day — this screen holds no tenant clock and
     `tenants_client_r` would refuse most gym members the row it lives on, so
     fetching one would mean printing a failed-read note to almost everybody.
     What that costs is bounded and worth writing down: on the first or last day
     of a pause a member whose device is a calendar day ahead of or behind the
     gym can read 'scheduled' where the desk reads 'frozen', or 'thawed' where
     the desk reads 'frozen'. Every one of those sentences NAMES BOTH DATES, so
     the member still reads the day it lifts — which is the thing they came here
     for and the thing they previously could not see at all.

     `newEndsOn` is null for the same reason app/(owner)/members.tsx passes null
     on the register row: `savePause` writes the moved end date into `ends_on`
     in the SAME update as the dates (see `setMembershipFreeze`), so the "Runs
     to" line above ALREADY has the paused days inside it. Promising the move a
     second time would read as days being given back twice. */
  const freeze = useMemo(() => {
    if (!primary) return null;
    const f = { from: primary.frozenFrom, to: primary.frozenTo };
    const state = freezeState(f, today);
    if (state === 'none') return null;
    const line = freezeLine(state, {
      from: primary.frozenFrom ? day(primary.frozenFrom) : null,
      to: primary.frozenTo ? day(primary.frozenTo) : null,
      days: frozenDays(f),
      newEndsOn: null,
    });
    if (!line) return null;
    /* supabase/parts/2616 is deliberate that nothing flips `status` at
       midnight, and its header says the app shows both and says when they
       disagree. The owner console does. Both directions matter to the member
       and they are different facts:
         · dates paused, status not — the door may still open, and a member who
           thinks they are paused may not bother ringing ahead.
         · status Frozen, dates say otherwise — the badge above says Frozen and
           nothing is going to lift it on its own, which is exactly the "nobody
           remembers to unfreeze it" failure part 2616 opens with. */
    const clash = state === 'frozen' && primary.status !== 'frozen'
      ? ' Your gym has not marked the membership itself paused, so the door may still let you in. Check at reception before you rely on either.'
      : state !== 'frozen' && primary.status === 'frozen'
        ? ' Your gym still has this marked Frozen, which does not lift by itself. Ask reception to take it off.'
        : '';
    return { state, line, clash };
  }, [primary, today]);

  // The order that produced the membership on screen, matched on
  // `membership_id` alone — see `orderForMembership`, which refuses the
  // "…or the newest one" fallback and says why. Only over a read that landed:
  // under 'error' and 'loading' the list is unknown, and `orderForMembership`
  // over an unknown list returns null, which the screen would otherwise draw as
  // "your gym recorded this at the desk".
  const ordersRead = oStatus === 'ready';
  const order = ordersRead && primary ? orderForMembership(orders, primary.id) : null;

  // How far through its term the membership is, for the meter under the
  // status — only where the gym recorded BOTH ends and the term is running.
  // `daysLeft` is `standingOf`'s own figure, so the bar and the "runs to" line
  // above it are one calculation; the length is two recorded dates apart, read
  // as local calendar days. An open-ended membership has no bar, because it
  // has no whole to be part of.
  const term = useMemo(() => {
    if (!primary || !standing || (standing.kind !== 'current' && standing.kind !== 'expiring')) return null;
    const a = localDate(primary.startedOn), b = localDate(standing.endsOn);
    if (!a || !b) return null;
    const total = Math.round((b.getTime() - a.getTime()) / 86_400_000);
    if (!(total > 0)) return null;
    return { total, used: Math.max(0, Math.min(total, total - standing.daysLeft)), left: standing.daysLeft };
  }, [primary, standing]);

  const actions: { label: string; note: string; icon: IconName; route: string; tone?: Tone; hero?: boolean }[] = [
    { label: 'Entry Barcode', note: `Your ${appName} ID — link it at reception`, icon: 'grid', route: '/(client)/access', hero: true },
    { label: 'Classes', note: 'Book a group class at your branch', icon: 'calendar', tone: 'purple', route: '/(client)/classes' },
    { label: 'Personal Training', note: 'Approve sessions your trainer delivered', icon: 'people', tone: 'brand', route: '/(client)/pt-sessions' },
    { label: 'My Bookings', note: 'Everything you have booked', icon: 'check', tone: 'blue', route: '/(client)/bookings' },
    // The screen this one could not reach for as long as it existed. Every
    // figure above is read-only: a member could see the plan they were on and
    // its price and could not buy it, renew it or move off it, and the gym's
    // own price book has been readable since part 29 with nothing to do about
    // it. src/lib/memberBuy.ts is the rules; that screen is the act.
    { label: 'Plans & Passes', note: 'Buy, renew or change what you are on', icon: 'target', tone: 'teal', route: '/(client)/gym-plans' },
    { label: 'Memberships & Packs', note: 'What you have bought and what is left', icon: 'trophy', tone: 'orange', route: '/(client)/packages' },
    // Pointed at Explore — "what else the app can do" — which is not an offer.
    // There is a real offers screen now, where a gym code is redeemed.
    { label: 'Payments', note: 'What your gym has recorded taking from you', icon: 'clock', tone: 'amber', route: '/(client)/receipts' },
    { label: 'Offers', note: 'Redeem a code from your gym', icon: 'sparkle', tone: 'pink', route: '/(client)/offers' },
    { label: 'Refer a Friend', note: `Share ${appName} with someone`, icon: 'share', route: '/(client)/referral' },
  ];
  const heroAction = actions.find((a) => a.hero);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────
            The board's pushed-page head: back at the leading edge, the title
            centred, and the one quiet line under it — here the member's name
            and number, which is what reception asks for. The gym's name that
            used to sit above the title is already on every tab and the
            barcode card, so it is not repeated here. */}
        <PageHead title="Membership"
          subtitle={memberNoKnown ? `${c.name || 'Member'} · ${memberNo}` : (c.name || 'Member')} />
        {memberNoKnown ? (
          /* The number widened, so it changed. Somebody who gave reception
             the old one and says nothing would be refused at the door with
             no idea why. */
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>{MEMBER_NO_CHANGED_NOTE}</Text>
        ) : (
          /* No number, and the reason for it. Loading and failed are two
             different sentences: one of them will end on its own. */
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>
            {c.profileStatus === 'loading'
              ? 'Your member number is built from your account, so it appears here once that has been read.'
              : 'Your member number is built from your account, and that could not be read just now — so it is left out rather than shown as a number that is not yours. Pull down to try again.'}
          </Text>
        )}


        {/* ── your membership ─────────────────────────────────────────────
            The section this screen exists for, and the one it has been unable
            to draw since the fabricated version was removed. Five states, and
            the differences between them are the whole point:

              loading   — nothing known yet, and it says so
              error     — the read did not land. NOT "no membership": telling
                          somebody who pays every month that their gym has no
                          record of them is worse than saying nothing
              none      — the read landed and there genuinely is no row. A gym
                          may run entirely on drop-ins and packs, so this is a
                          normal state with a normal sentence
              plan      — the real thing, off real rows
              unreadable— a plan is attached and did not come back. Said out
                          loud rather than rendered as an empty plan name */}
        {/* ── the failure, said ABOVE what it qualifies ────────────────
            This used to be an exclusive branch, and that quietly threw away
            the whole point of the cache read forty lines up. The device's
            copy was loaded into `mships` and then never drawn, because the
            'error' arm returned instead of falling through to the plan, the
            standing and the dates — so a member standing inside the
            building their membership is for saw two banners and nothing
            else, one of which said "Saved on this phone 3 days ago" about
            data that was not on the screen. The cache's own note names the
            case it was written for: "on a cold launch in a basement there
            was nothing on screen to keep."
            The banners lead, so the qualification arrives before the thing
            it qualifies rather than after it. */}
        {mStatus === 'error' ? (
          <Section>
            <View style={{ gap: sp.md }}>
              <Flag tone={t.crit}>
              We couldn’t read your membership. That is a read that failed, not an answer — it does not mean your gym has no record of you.
            </Flag>
            {/* …and when there IS something below, say where it came from and
                how old it is. A member reading a cached membership as a live
                one goes to reception believing they are in good standing. */}
            {mCachedAt && mships.length ? <Flag tone={t.warn}>{cachedAtLine(mCachedAt)}</Flag> : null}
            <View style={{ flexDirection: 'row' }}>
              <Ghost label="Try Again" onPress={() => { void loadMembership(); }} />
            </View>
          </View>
          </Section>
        ) : null}

        {/* ── and it opens on its figure ──────────────────────────────────
            The approved look leads a pushed page with its state, and this
            page's state is one word: Active, Ending Soon, Frozen, Expired. So
            the standing is the card's FIGURE now — it was the third of five
            grey lines — with the sentence about when it runs to as the marked
            line under it, the plan and its price as the quiet tail, and the
            term as a meter. When there is no membership to state, the figure
            is the dash and `detail` is the reason, never a blank card. */}
        <FigureCard title="Your Membership"
          note={mStatus === 'ready' && mships.length > 1 ? `${mships.length} on record` : undefined}
          figure={primary && standing && planState ? standingLabel(standing) : null}
          tone={standing ? (isCurrent(standing) ? t.brand : t.warn) : undefined}
          comparison={!primary || !standing || !planState ? undefined
            /* renewalNote refuses to compute a date the gym has not recorded —
               the exact thing "Valid until <today + 1 year>" used to do here. */
            : standing.kind === 'current' || standing.kind === 'expiring'
              ? `Runs to ${day(standing.endsOn)}`
              /* With dates on the pause there IS an answer, so the line that
                 used to send a paused member to reception to ask when it
                 restarts says when it restarts instead. Without them
                 `renewalNote` is still right: a status of Frozen and no dates
                 is a pause only a person can explain. */
              : standing.kind === 'frozen' && freeze
                ? `${freeze.line}${freeze.clash}`
                : renewalNote(standing, planState)}
          period={planState?.kind === 'plan' && planState.plan.name ? planState.plan.name : undefined}
          detail={mStatus === 'loading' ? 'Reading your membership…'
            // Under 'error' with nothing cached, the banner above has already
            // said what happened. "Your gym has not recorded a membership" is a
            // claim about somebody's standing at their own gym and may only be
            // made about a read that landed.
            : (!primary || !standing || !planState) && mStatus !== 'error'
              ? 'Your gym has not recorded a membership against your account. Plenty of gyms run on day passes and packs instead — if you believe you are on a plan, reception can add it.'
              : undefined}>
          {mStatus === 'loading' ? null : (<>
            {!primary || !standing || !planState ? null : (
            <>
              {term ? (
                <Meter label="Term" val={term.used} target={term.total} unit="days"
                  tone={standing.kind === 'expiring' ? 'amber' : 'brand'}
                  note={term.left === 1 ? '1 day left' : `${term.left} days left`} />
              ) : null}
              <View style={{ height: sp.md }} />
              {/* Plan. Three sentences for three states, never one blank. */}
              {planState.kind === 'plan' ? (
                <>
                  <Line t={t} first label="Plan" value={fig(planState.plan.name)} />
                  {/* A null price is not a free plan and it is not AED 0.00.
                      The interval is dropped with it: "— a month" is a billing
                      frequency attached to no amount, and the honest line says
                      the one thing we know. */}
                  <Line t={t} label="Price"
                    value={planState.plan.priceCents == null
                      ? 'Not recorded by your gym'
                      : `${amount(planState.plan.priceCents, planState.plan.currency)}${
                        planState.plan.interval === 'once' ? '' : planState.plan.interval === 'year' ? ' a year' : ' a month'}`} />
                </>
              ) : planState.kind === 'none' ? (
                <Line t={t} first label="Plan" value="None recorded by your gym" />
              ) : (
                <Line t={t} first label="Plan" value="On your account, but we couldn’t read it" />
              )}

              {/* The standing itself is the card's figure now, and its
                  sentence the marked line under it — see the FigureCard. */}
              <Line t={t} label="Started" value={day(primary.startedOn)} />
              {primary.endsOn ? <Line t={t} label="Runs To" value={day(primary.endsOn)} /> : null}

              {/* The pause the status column has not caught up with — or has
                  got ahead of. Drawn only where the line above is not already
                  carrying it, so the member reads it once. */}
              {freeze && standing.kind !== 'frozen' ? (
                <Flag tone={freeze.state === 'unreadable' ? t.warn : t.ink3} style={{ marginTop: sp.md }}>
                  {`${freeze.line}${freeze.clash}`}
                </Flag>
              ) : null}

              {planState.kind === 'unreadable' ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                  Your membership names a plan we couldn’t open, so its name and price aren’t shown. The membership above is real; ask reception what the plan is called.
                </Flag>
              ) : null}

              {standing.kind === 'expired' && standing.stale ? (
                <Flag tone={t.crit} style={{ marginTop: sp.md }}>
                  Your gym still has this marked active, but the end date has passed. Check at reception before you travel in for a session.
                </Flag>
              ) : null}

              {/* The one act this screen was missing. Offered where it is
                  useful rather than on every state: a membership with months
                  left does not need a renew button under it, and one that has
                  run out or is about to needs it more than it needs another
                  read-only line. What buying would actually DO is decided on
                  the other screen by `offerFor`, against the same standing this
                  one is printing, so the two cannot disagree. */}
              {standing.kind === 'expiring' || standing.kind === 'expired' ? (
                <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                  <Ghost label="Renew or Change Plan" onPress={() => router.push('/(client)/gym-plans')} />
                </View>
              ) : null}

              {/* ── how this membership was bought ──────────────────────────
                  `gym_orders` has admitted the member to their own rows since
                  supabase/parts/281 — `for select using (member_id =
                  auth.uid())` — and part 800's header describes the table as
                  "read by the member's own purchase history". There was no such
                  history: the only readers in the product were the owner
                  console, the gym export and the Stripe webhook. So a member
                  who bought a membership on this phone could read the plan and
                  the dates their payment produced and find nothing anywhere
                  saying they had bought it.

                  `memberships.note` is the other half of the same request and
                  is deliberately absent. Part 125 wrote the reason into the
                  schema: it is free text the OWNER console writes, "an owner who
                  types a private remark about a member into one is typing it
                  somewhere that member can read", and the standing answer is
                  that the client app does not select it. That answer is kept —
                  see the header of src/lib/membershipOrder.ts. */}
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>How This Was Bought</Text>
                {oStatus === 'loading' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Reading your purchases…</Text>
                ) : order ? (
                  <>
                    <Line t={t} first label="Purchase" value={intentLabel(order)} />
                    {/* The order's OWN currency, never the plan's and never a
                        default — this product is white-label and the two rows
                        are separate records of money. `orderAmount` prints the
                        stored integer rather than inventing a decimal point
                        when the currency was not recorded. */}
                    <Line t={t} label="Amount" value={orderAmount(order)} />
                    {order.paidAt ? <Line t={t} label="Paid On" value={fmtFullDay(order.paidAt)} /> : null}
                    {/* The term the ORDER bought, which is not necessarily the
                        membership's dates above: a gym may have edited those
                        since, and showing the two is how a member notices. */}
                    {order.termStartsOn ? (
                      <Line t={t} label="Term Bought"
                        value={order.termEndsOn
                          ? `${day(order.termStartsOn)} – ${day(order.termEndsOn)}`
                          : `${day(order.termStartsOn)} onwards`} />
                    ) : null}
                    {/* 'failed' is Stripe having taken the money while the
                        entitlement could not be written, and the member is the
                        one person guaranteed to notice. It gets a mark; the
                        other three states are statements, not warnings. A dot
                        rather than crit-coloured text, which fails the contrast
                        gate — see src/ui/kit.tsx `Flag`. */}
                    {order.status === 'failed' ? (
                      <Flag tone={t.crit} style={{ marginTop: sp.md }}>{orderStatusLine(order)}</Flag>
                    ) : (
                      <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>{orderStatusLine(order)}</Text>
                    )}
                  </>
                ) : (
                  // Two sentences behind one call, and the argument for them is
                  // the whole of src/ui/loadStatus.ts: a membership with no
                  // order is the ordinary case at a gym that sells at the desk,
                  // and an order list that did not load is not that.
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{orderAbsence(ordersRead)}</Text>
                )}
              </View>
            </>
          )}
          </>)}
        </FigureCard>


        {/* ── the hero: the only live number this screen has ────────────────
            Three sentences in the note, not two: "we couldn't read it" is wrong
            while it is still being read, and a member who sees that on every
            launch stops believing it for the time it is true. */}
        {(() => {
          const figure = logKnown ? fig(visits) : fig(null);
          const note = logStatus === 'loading' ? 'Reading your training log…'
            // Three arms, as on Home, and for the reason the comment above that
            // hero gives: "we couldn’t read it" is not true of all three ways
            // this can fail to be a number. Under 'partial' NOTHING failed —
            // the server answered, and src/ui/workoutLog.tsx reads
            // `performed_at` DESCENDING before capping, so what did not come
            // back is the far end of the member's history, not this month. The
            // count is still withheld, because `capped` cannot promise where
            // the page stopped; but telling somebody their log could not be
            // read, when it was read and only the oldest of it was left behind,
            // is a sentence that is simply false.
            : logStatus === 'partial' ? 'You have more training logged than we can read in one go, so this month is left blank rather than counted over part of it. Nothing failed and nothing is missing from your log.'
            : !logKnown ? 'We couldn’t read your training log — this is not a month with nothing in it.'
            : visits > 0 ? `Last logged ${last}` : 'No sessions logged yet this month';
          return (
            /* The board's figure card in place of the retired Hero: the
               section's name, the figure at hero size, the note under it,
               spoken as one sentence. */
            <FigureCard title="Sessions Logged This Month" figure={logKnown ? figure : null} detail={note} />
          );
        })()}


        {/* ── the one card: the thing you open this screen to do ──────────── */}
        {heroAction ? (
          <Section>
            <ActionCard
              title="Show Entry Barcode"
              note={memberNoKnown ? `Member ${memberNo} · ${heroAction.note}` : heroAction.note}
              cta="Show"
              onPress={() => router.push(heroAction.route as any)}
            />
          </Section>
        ) : null}


        {/* ── everywhere else you can go ─────────────────────────────────── */}
        <Section>
          <SectionHead title="At the Gym" />
          {actions.filter((a) => !a.hero).map((a) => (
            <ListRow key={a.label} icon={a.icon} tone={a.tone} title={a.label} note={a.note}
              onPress={() => router.push(a.route as any)} />
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
