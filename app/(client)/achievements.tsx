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
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { volumeIn } from '../../src/lib/units';
import { longestStreak, personalRecords } from '../../src/lib/streaks';

export default function Achievements() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus } = useWorkoutLog();
  const wu = useSettings().weightUnit;
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

  const totalWorkouts = log.length;
  const best = longestStreak(log);
  const prs = personalRecords(log).length;
  const hasCardio = log.some((e) => e.cardio);
  const totalVolume = log.reduce((a, e) => a + (e.sets ? e.sets.reduce((x, [r, w]) => x + (r || 0) * (w || 0), 0) : 0), 0);

  const badges: { title: string; desc: string; earned: boolean }[] = [
    { title: 'First Rep', desc: 'Log your first workout', earned: totalWorkouts >= 1 },
    { title: 'On a Roll', desc: '3-day streak', earned: best >= 3 },
    { title: 'Week Warrior', desc: '7-day streak', earned: best >= 7 },
    { title: 'Two Weeks Strong', desc: '14-day streak', earned: best >= 14 },
    { title: 'Unstoppable', desc: '30-day streak', earned: best >= 30 },
    { title: 'Ten Sessions', desc: 'Log 10 workouts', earned: totalWorkouts >= 10 },
    { title: 'Fifty Club', desc: 'Log 50 workouts', earned: totalWorkouts >= 50 },
    { title: 'Record Breaker', desc: 'Set a personal record', earned: prs >= 1 },
    { title: 'PR Machine', desc: '5 personal records', earned: prs >= 5 },
    { title: 'Cardio Kick', desc: 'Log a cardio session', earned: hasCardio },
    // The threshold stays a fixed mass — 1,000 kg is 1,000 kg however it is
    // read — and only the figure describing it converts, so a pounds reader is
    // not left chasing a target stated in a unit they do not train in. The
    // TITLES do not convert: they are the badges' names, and a badge that
    // renames itself when a setting changes is a different badge.
    { title: 'One Tonne', desc: `Lift ${volumeIn(1000, wu)!.toLocaleString()} ${wu} total volume`, earned: totalVolume >= 1000 },
    { title: 'Ten Tonnes', desc: `Lift ${volumeIn(10000, wu)!.toLocaleString()} ${wu} total volume`, earned: totalVolume >= 10000 },
  ];
  const earnedCount = badges.filter((b) => b.earned).length;

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
          {badges.map((b, bi) => (
            <View key={b.title}>
              {bi > 0 ? <Rule /> : null}
              <View accessibilityLabel={`${b.title}, ${!logKnown ? 'not known' : b.earned ? 'unlocked' : countable ? 'locked' : 'not known'}. ${b.desc}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={logKnown && b.earned ? 'check' : 'trophy'} size={16} color={logKnown && b.earned ? t.brand : t.ink3} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: b.earned ? t.ink : t.ink2 }}>{b.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{b.desc}</Text>
                </View>
                {/* "Locked" is a claim that this badge has not been earned.
                    With nothing read we do not know, and a dash says so — and
                    the same applies to a read that stopped at its row limit,
                    where the sessions that earned it may simply not have come
                    back. "Earned" survives both, because the thresholds only
                    ever under-count. */}
                <Text style={{ ...ty.micro, color: t.ink3 }}>{!logKnown ? fig(null) : b.earned ? 'Earned' : countable ? 'Locked' : fig(null)}</Text>
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
