// Client · Achievements (Phase 7). Badges derived from the reactive workout log:
// streaks, total sessions, PRs, cardio, volume. Earned badges are marked; locked
// ones show what to do next. Reachable from the profile hub and the dashboard
// streak card.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every threshold, computation and route is preserved — twelve bordered tiles
// became one hero figure and a hairline-separated list. The badges' `icon` field
// held an empty string for every badge (its emoji had been stripped), so each
// tile rendered a blank 28px circle; that dead field is gone.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { volumeIn } from '../../src/lib/units';
import { BADGES, badgeFigures, badgeState, type BadgeState } from '../../src/lib/badges';
import { useBadgeWatch } from '../../src/ui/badgeWatch';
import { Confetti } from '../../src/ui/Confetti';

export default function Achievements() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus } = useWorkoutLog();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const watch = useBadgeWatch();
  // Under 'error' the log is empty because it could not be read, so every
  // threshold below evaluates false and all twelve badges render "Locked". That
  // is not a display glitch — it revokes achievements the client has already
  // earned, and tells someone with a year of training to log their first
  // workout. `earned` therefore has to be able to say "unknown".
  const logKnown = logStatus !== 'error';
  // 'partial' is not 'error', and it needs a different answer from either.
  //
  // A truncated read (src/lib/rowCap.ts) holds real rows — just not all of
  // them — and every threshold here is MONOTONE: `totalWorkouts >= 50` over the
  // newest thousand sessions can only be an under-count, never an over-count,
  // and the same is true of `best`, `prs` and `totalVolume`. So on a partial
  // read an EARNED badge is genuinely earned and may be shown; a LOCKED one is
  // not known to be locked, because the sessions that would have unlocked it
  // may be the ones that did not come back. That asymmetry is the whole shape
  // of this screen under truncation, and it is why `earnedCount` — a figure
  // over the set — is withheld while the individual "Earned" marks are not.
  const countable = isWhole(logStatus);

  // ── The badge set is no longer built here ──────────────────────────────
  //
  // It lived in this file and nowhere else, which is why nothing ever happened
  // when one unlocked: no other part of the app could see a badge, so nothing
  // could notify, celebrate or share one. src/lib/badges.ts is the set, it is
  // pure, it is tested, and src/ui/badgeWatch.tsx watches it from above every
  // screen so an unlock is an event rather than something to be noticed here.
  //
  // The `history` argument closes a second gap in the same move. Volume and PRs
  // used to be computed from `[reps, weight]` with a blank load stored as 0, so
  // every pull-up, dip and push-up counted as nothing — a calisthenics member
  // could never earn One Tonne, Ten Tonnes, Record Breaker or PR Machine. Only
  // offered when the scan read was whole: a shorter weight history under-counts
  // volume, which would hold a badge back.
  const figures = badgeFigures(log, isWhole(cd.scansStatus) ? cd.weightSeries : []);
  // The threshold stays a fixed mass — 1,000 kg is 1,000 kg however it is read
  // — and only the figure describing it converts, so a pounds reader is not
  // left chasing a target stated in a unit they do not train in. The TITLES do
  // not convert: they are the badges' names, and a badge that renames itself
  // when a setting changes is a different badge.
  const volumeLabel = (kg: number) => `${volumeIn(kg, wu)!.toLocaleString()} ${wu}`;
  const badges = BADGES.map((b) => ({
    key: b.key,
    title: b.title,
    desc: typeof b.desc === 'function' ? b.desc(volumeLabel) : b.desc,
    state: badgeState(b.key, figures, countable) as BadgeState,
  }));
  const earnedCount = badges.filter((b) => b.state === 'earned').length;

  // ── The celebration ────────────────────────────────────────────────────
  //
  // Fired by the watcher rather than by this screen, so it happens wherever the
  // member is when the badge lands and not only if they come here. This screen
  // is where the notification's own tap goes, so it is also where the confetti
  // gets a second chance if they were not looking.
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!watch.pending) return;
    const b = BADGES.find((x) => x.key === watch.pending);
    if (!b) { watch.acknowledge(); return; }
    setBurst(true);
    Alert.alert(
      `Badge unlocked · ${b.title}`,
      (typeof b.cheer === 'string' ? b.cheer : '')
        + (watch.alsoUnlocked > 0
          ? ` ${watch.alsoUnlocked === 1 ? 'One more badge' : `${watch.alsoUnlocked} more badges`} unlocked at the same time.`
          : ''),
    );
    watch.acknowledge();
  }, [watch.pending]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Earned from your log</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Achievements</Text>
          </View>
        </View>

        {/* ── the hero: how much of the set is unlocked ───────────────────── */}
        <Hero
          label="Unlocked"
          figure={countable ? fig(earnedCount) : fig(null)}
          unit={`of ${badges.length}`}
          arc={countable ? earnedCount / badges.length : undefined}
          arcLabel="of badges earned"
          note={logStatus === 'loading' ? 'Reading your training log…'
            : !logKnown ? 'We couldn’t read your training log — badges you have earned are not shown below.'
            : !countable ? 'You have trained more times than this screen can read in one go, so the count is left blank. Anything marked Earned below really is.'
            : earnedCount === 0 ? 'Log a workout to unlock your first badge' : `${badges.length - earnedCount} left to earn`}
        />

        <Rule />

        <Section>
          <SectionHead title="Badges" />
          {badges.map((b, bi) => {
            // 'earned' | 'locked' | 'unknown' from the module, which encodes
            // what this screen used to work out from two separate booleans:
            // "Locked" is a claim that the badge has NOT been earned, and with
            // an unread or truncated log we do not know — while "Earned"
            // survives both, because every threshold only ever under-counts.
            // A failed read is 'unknown' too: `countable` is false there.
            const earned = logKnown && b.state === 'earned';
            return (
            <View key={b.key}>
              {bi > 0 ? <Rule /> : null}
              <View accessibilityLabel={`${b.title}, ${!logKnown ? 'not known' : b.state === 'earned' ? 'unlocked' : b.state === 'locked' ? 'locked' : 'not known'}. ${b.desc}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={earned ? 'check' : 'trophy'} size={16} color={earned ? t.brand : t.ink3} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: earned ? t.ink : t.ink2 }}>{b.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{b.desc}</Text>
                </View>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{!logKnown ? fig(null) : b.state === 'earned' ? 'Earned' : b.state === 'locked' ? 'Locked' : fig(null)}</Text>
              </View>
            </View>
            );
          })}
        </Section>
      </ScrollView>
      {/* Over the list rather than inside it, so the burst is not clipped by
          the scroll view and does not push the layout around while it runs. */}
      <Confetti show={burst} onDone={() => setBurst(false)} />
    </SafeAreaView>
  );
}
