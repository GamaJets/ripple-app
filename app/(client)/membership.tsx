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
// with no loyalty programme behind it, and a "Balance · Add top-up ›" tile for
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
import { Rule, Section, SectionHead, Hero, ActionCard, ListRow, Ghost, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
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
import { useToday } from '../../src/ui/today';
import { localDate } from '../../src/lib/localDate';
import { appLocale } from '../../src/lib/locale';
import { BACK_ICON, END_ALIGN } from '../../src/ui/direction';

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

  // The three reads this screen shows: the gym's membership record (which has
  // its own "Try Again" beside the failure, and this is the same read), the
  // profile, and the training log the visit count is derived from.
  const pull = usePullToRefresh(useCallback(() => {
    void loadMembership(); c.reload(); reloadLog();
  }, [loadMembership, c.reload, reloadLog]));

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

  const actions: { label: string; note: string; icon: IconName; route: string; hero?: boolean }[] = [
    { label: 'Entry Barcode', note: `Your ${appName} ID — link it at reception`, icon: 'grid', route: '/(client)/access', hero: true },
    { label: 'Classes', note: 'Book a group class at your branch', icon: 'calendar', route: '/(client)/classes' },
    { label: 'Personal Training', note: 'Approve sessions your trainer delivered', icon: 'people', route: '/(client)/pt-sessions' },
    { label: 'My Bookings', note: 'Everything you have booked', icon: 'check', route: '/(client)/bookings' },
    // The screen this one could not reach for as long as it existed. Every
    // figure above is read-only: a member could see the plan they were on and
    // its price and could not buy it, renew it or move off it, and the gym's
    // own price book has been readable since part 29 with nothing to do about
    // it. src/lib/memberBuy.ts is the rules; that screen is the act.
    { label: 'Plans & Passes', note: 'Buy, renew or change what you are on', icon: 'target', route: '/(client)/gym-plans' },
    { label: 'Memberships & Packs', note: 'What you have bought and what is left', icon: 'trophy', route: '/(client)/packages' },
    // Pointed at Explore — "what else the app can do" — which is not an offer.
    // There is a real offers screen now, where a gym code is redeemed.
    { label: 'Payments', note: 'What your gym has recorded taking from you', icon: 'clock', route: '/(client)/receipts' },
    { label: 'Offers', note: 'Redeem a code from your gym', icon: 'sparkle', route: '/(client)/offers' },
    { label: 'Refer a Friend', note: `Share ${appName} with someone`, icon: 'share', route: '/(client)/referral' },
  ];
  const heroAction = actions.find((a) => a.hero);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{appName}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Membership</Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 3 }}>{c.name || 'Member'} · {memberNo}</Text>
            {/* The number widened, so it changed. Somebody who gave reception
                the old one and says nothing would be refused at the door with
                no idea why. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{MEMBER_NO_CHANGED_NOTE}</Text>
          </View>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
        </View>

        <Rule />

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
        <Section>
          <SectionHead title="Your Membership"
            note={mStatus === 'ready' && mships.length > 1 ? `${mships.length} on record` : undefined} />

          {mStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your membership…</Text>
          ) : (<>
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
              <View style={{ gap: sp.md, marginBottom: sp.md }}>
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
            ) : null}
            {!primary || !standing || !planState ? (
            // Under 'error' with nothing cached, the banner above has already
            // said what happened. "Your gym has not recorded a membership" is a
            // claim about somebody's standing at their own gym and may only be
            // made about a read that landed.
            mStatus === 'error' ? null : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your gym has not recorded a membership against your account. Plenty of gyms run on day passes and packs instead — if you believe you are on a plan, reception can add it.
            </Text>
            )) : (
            <>
              {/* Plan. Three sentences for three states, never one blank. */}
              {planState.kind === 'plan' ? (
                <>
                  <Line t={t} first label="Plan" value={fig(planState.plan.name)} />
                  <Line t={t} label="Price"
                    value={`${amount(planState.plan.priceCents, planState.plan.currency)}${
                      planState.plan.interval === 'once' ? '' : planState.plan.interval === 'year' ? ' a year' : ' a month'}`} />
                </>
              ) : planState.kind === 'none' ? (
                <Line t={t} first label="Plan" value="None recorded by your gym" />
              ) : (
                <Line t={t} first label="Plan" value="On your account, but we couldn’t read it" />
              )}

              <Line t={t} label="Standing" value={standingLabel(standing)} />
              <Line t={t} label="Started" value={day(primary.startedOn)} />
              {primary.endsOn ? <Line t={t} label="Runs to" value={day(primary.endsOn)} /> : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isCurrent(standing) ? t.brand : t.warn }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                  {/* renewalNote refuses to compute a date the gym has not
                      recorded — the exact thing "Valid until <today + 1 year>"
                      used to do here. */}
                  {standing.kind === 'current' || standing.kind === 'expiring'
                    ? `${standingLabel(standing)} · runs to ${day(standing.endsOn)}`
                    : renewalNote(standing, planState)}
                </Text>
              </View>

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
            </>
          )}
          </>)}
        </Section>

        <Rule />

        {/* ── the hero: the only live number this screen has ────────────────
            Three sentences in the note, not two: "we couldn't read it" is wrong
            while it is still being read, and a member who sees that on every
            launch stops believing it for the time it is true. */}
        <Hero
          label="Sessions Logged This Month"
          figure={logKnown ? fig(visits) : fig(null)}
          note={logStatus === 'loading' ? 'Reading your training log…'
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
            : visits > 0 ? `Last logged ${last}` : 'No sessions logged yet this month'}
        />

        <Rule />

        {/* ── the one card: the thing you open this screen to do ──────────── */}
        {heroAction ? (
          <Section>
            <ActionCard
              title="Show Entry Barcode"
              note={`Member ${memberNo} · ${heroAction.note}`}
              cta="Show"
              onPress={() => router.push(heroAction.route as any)}
            />
          </Section>
        ) : null}

        <Rule />

        {/* ── everywhere else you can go ─────────────────────────────────── */}
        <Section>
          <SectionHead title="At the Gym" />
          {actions.filter((a) => !a.hero).map((a) => (
            <ListRow key={a.label} icon={a.icon} title={a.label} note={a.note}
              onPress={() => router.push(a.route as any)} />
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
