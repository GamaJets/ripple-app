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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, ActionCard, ListRow, Ghost, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { IconName } from '../../src/ui/Icon';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useBrand } from '../../src/ui/brand';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { memberNoFrom } from '../../src/lib/membership';
import {
  amount, fetchMyMemberships, isCurrent, planStateOf, primaryMembership, renewalNote,
  standingLabel, standingOf, todayIso, type MemberMembership,
} from '../../src/lib/memberRecord';
import { localDate } from '../../src/lib/localDate';

/** A bare ISO date as a member reads it. Local, because a date column means a
 *  calendar day in the reader's own life — see src/lib/localDate.ts. */
function day(iso: string | null): string {
  const d = localDate(iso);
  if (!d) return fig(null);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A label and a fact, one line. */
function Line({ t, label, value, first }: { t: ReturnType<typeof useTheme>; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: 'right' }} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export default function Membership() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus } = useWorkoutLog();
  const { appName } = useBrand();
  const auth = useAuth();
  const uid = auth.user?.id || '';
  // Under 'error' the log is empty because it could not be read. This screen's
  // one live number is "sessions logged this month", and a member who trained
  // twelve times was shown a zero under it with "No sessions logged yet this
  // month" spelled out underneath — a specific, checkable claim about their own
  // month that the app was in no position to make.
  const logKnown = logStatus !== 'error';
  const memberNo = memberNoFrom(c.name, c.id);

  const { visits, last } = useMemo(() => {
    const now = new Date();
    const days = new Set<string>();
    let latest = 0;
    for (const e of log) {
      const d = new Date(e.t);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) days.add(d.toDateString());
      const ts = Date.parse(e.t); if (ts > latest) latest = ts;
    }
    const lastLabel = latest ? new Date(latest).toLocaleDateString() : '—';
    return { visits: days.size, last: lastLabel };
  }, [log]);

  /* ── the membership itself ────────────────────────────────────────────── */

  const [mships, setMships] = useState<MemberMembership[]>([]);
  const [mStatus, setMStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const loadMembership = useCallback(async () => {
    if (!USE_SUPABASE) { setMStatus('ready'); return; }
    if (!uid) { if (!auth.loading) setMStatus('error'); return; }
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
  }, [uid, auth.loading]);
  useEffect(() => { void loadMembership(); }, [loadMembership]);

  // Recomputed per render rather than memoised on a date string: the screen can
  // be open across midnight, and a membership that expired at 00:00 should not
  // still read "Active" because the component has not re-rendered for a new day.
  const today = todayIso(new Date());
  const primary = primaryMembership(mships, today);
  const standing = primary ? standingOf(primary, today) : null;
  const planState = primary ? planStateOf(primary) : null;

  const actions: { label: string; note: string; icon: IconName; route: string; hero?: boolean }[] = [
    { label: 'Entry Barcode', note: 'Your Repple ID — link it at reception', icon: 'grid', route: '/(client)/access', hero: true },
    { label: 'Classes', note: 'Book a group class at your branch', icon: 'calendar', route: '/(client)/classes' },
    { label: 'Personal Training', note: 'Approve sessions your trainer delivered', icon: 'people', route: '/(client)/pt-sessions' },
    { label: 'My Bookings', note: 'Everything you have booked', icon: 'check', route: '/(client)/bookings' },
    { label: 'Memberships & Packs', note: 'What you have bought and what is left', icon: 'trophy', route: '/(client)/packages' },
    // Pointed at Explore — "what else the app can do" — which is not an offer.
    // There is a real offers screen now, where a gym code is redeemed.
    { label: 'Payments', note: 'What your gym has recorded taking from you', icon: 'clock', route: '/(client)/receipts' },
    { label: 'Offers', note: 'Redeem a code from your gym', icon: 'sparkle', route: '/(client)/offers' },
    { label: 'Refer a Friend', note: 'Share Repple with someone', icon: 'share', route: '/(client)/referral' },
  ];
  const heroAction = actions.find((a) => a.hero);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{appName}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Membership</Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 3 }}>{c.name || 'Member'} · {memberNo}</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
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
          ) : mStatus === 'error' ? (
            <View style={{ gap: sp.md }}>
              <Flag tone={t.crit}>
                We couldn’t read your membership. That is a read that failed, not an answer — it does not mean your gym has no record of you.
              </Flag>
              <View style={{ flexDirection: 'row' }}>
                <Ghost label="Try Again" onPress={() => { void loadMembership(); }} />
              </View>
            </View>
          ) : !primary || !standing || !planState ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your gym has not recorded a membership against your account. Plenty of gyms run on day passes and packs instead — if you believe you are on a plan, reception can add it.
            </Text>
          ) : (
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
            </>
          )}
        </Section>

        <Rule />

        {/* ── the hero: the only live number this screen has ──────────────── */}
        <Hero
          label="Sessions Logged This Month"
          figure={logKnown ? fig(visits) : fig(null)}
          note={!logKnown ? 'We couldn’t read your training log — this is not a month with nothing in it.'
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
