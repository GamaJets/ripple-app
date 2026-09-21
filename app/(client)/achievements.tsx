// Client · Achievements (Phase 7). Badges derived from the reactive workout log:
// streaks, total sessions, PRs, cardio, volume. Earned badges are marked; locked
// ones show what to do next. Reachable from the profile hub and the dashboard
// streak card.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every threshold, computation and route is preserved. Round five: the count is
// a ring, the next badge is a meter under it, and the set is a grid of medals —
// toned when earned, grey behind a lock when not, grey with a dash when the
// read cannot say. The badges' `icon` field
// held an empty string for every badge (its emoji had been stripped), so each
// tile rendered a blank 28px circle; that dead field is gone.
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon, type IconName } from '../../src/ui/Icon';
import type { Theme } from '../../src/theme/tokens';
import { Section, SectionHead, PageHead, Ring, Meter, TonedChip, fig, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, fontScale } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { volumeIn } from '../../src/lib/units';
import { BADGES, badgeFigures, badgeState, type BadgeState, type BadgeKey, type BadgeFigures } from '../../src/lib/badges';

// The medal each badge wears: a glyph and a hue by FAMILY — streaks orange (the
// streak chip on Home), training days the accent, records amber and purple,
// volume blue and teal. The hue says nothing the title does not. The same table
// is in app/(client)/profile.tsx, because a lane may not add a module; it
// belongs in src/lib/badges.ts beside BADGES.
const BADGE_LOOK: Record<BadgeKey, { icon: IconName; tone: Tone }> = {
  'first-rep': { icon: 'check', tone: 'amber' },
  'on-a-roll': { icon: 'flame', tone: 'orange' },
  'week-warrior': { icon: 'flame', tone: 'orange' },
  'two-weeks': { icon: 'calendar', tone: 'orange' },
  'unstoppable': { icon: 'sparkle', tone: 'orange' },
  'ten-sessions': { icon: 'dumbbell', tone: 'brand' },
  'fifty-club': { icon: 'dumbbell', tone: 'brand' },
  'record-breaker': { icon: 'trophy', tone: 'amber' },
  'pr-machine': { icon: 'trending', tone: 'purple' },
  'cardio-kick': { icon: 'heart', tone: 'pink' },
  'one-tonne': { icon: 'scale', tone: 'blue' },
  'ten-tonnes': { icon: 'scale', tone: 'teal' },
};
/** A medal's plate and glyph colours — the kit's `toneOf` is not exported, and
 *  its IconPlate is a rounded square where the mockup's medal is a circle. */
const medalColours = (t: Theme, tone: Tone) => tone === 'brand' ? { soft: t.brandSoft, ink: t.brandText }
  : tone === 'neutral' ? { soft: t.surface3, ink: t.ink3 }
  : { soft: t.data[`${tone}Soft`], ink: t.data[`${tone}Ink`] };

/**
 * How far along one badge is: what they have, and what it takes.
 *
 * These are `badgeMet`'s thresholds read as a pair rather than as a verdict,
 * and they must stay its thresholds — src/lib/badges.ts is where they are
 * decided and this only draws them, so whether a badge is EARNED is never
 * taken from here. Cardio Kick has no distance to cover (it is one session or
 * none), so it has no meter. `say` writes the figure the way the badge's own
 * description does: days, records, or volume in the reader's unit.
 */
function progressOf(key: BadgeKey, f: BadgeFigures): { have: number; need: number; kind: 'days' | 'records' | 'volume' } | null {
  switch (key) {
    case 'first-rep': return { have: f.trainingDays, need: 1, kind: 'days' };
    case 'ten-sessions': return { have: f.trainingDays, need: 10, kind: 'days' };
    case 'fifty-club': return { have: f.trainingDays, need: 50, kind: 'days' };
    case 'on-a-roll': return { have: f.longestStreak, need: 3, kind: 'days' };
    case 'week-warrior': return { have: f.longestStreak, need: 7, kind: 'days' };
    case 'two-weeks': return { have: f.longestStreak, need: 14, kind: 'days' };
    case 'unstoppable': return { have: f.longestStreak, need: 30, kind: 'days' };
    case 'record-breaker': return { have: f.prCount, need: 1, kind: 'records' };
    case 'pr-machine': return { have: f.prCount, need: 5, kind: 'records' };
    case 'one-tonne': return { have: f.totalVolumeKg, need: 1000, kind: 'volume' };
    case 'ten-tonnes': return { have: f.totalVolumeKg, need: 10000, kind: 'volume' };
    case 'cardio-kick': return null;
  }
}
import { useBadgeWatch } from '../../src/ui/badgeWatch';
import { Confetti } from '../../src/ui/Confetti';

export default function Achievements() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const cd = useClientData();
  // Every badge here is scored off the training log and the profile's weight
  // history. A failed read of either scores the member at nothing and says so
  // in the same type used when it is true, and until now there was no gesture
  // that would ask again.
  const pull = usePullToRefresh(useCallback(() => { reloadLog(); cd.reload(); }, [reloadLog, cd.reload]));
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
  // them — and every threshold here is MONOTONE: `trainingDays >= 50` over the
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
  const scansWhole = isWhole(cd.scansStatus);
  const figures = badgeFigures(log, scansWhole ? cd.weightSeries : []);
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
    // Both reads, not one. `countable` is the log; `scansWhole` is the weight
    // history the four load-priced badges are computed from. With a whole log
    // and a failed scans read every bodyweight set is unpriced, so One Tonne,
    // Ten Tonnes, Record Breaker and PR Machine fell under their thresholds and
    // were printed as Locked — our failure rendered as the member's shortfall.
    // They read "unknown" now, and only where the log actually holds bodyweight
    // sets to be missing.
    state: badgeState(b.key, figures, countable, scansWhole) as BadgeState,
  }));
  const earnedCount = badges.filter((b) => b.state === 'earned').length;
  // True only where the failed scans read actually costs this member something:
  // a badge left at 'unknown' that a whole weight history might have unlocked.
  // "N left to earn" is a claim about how far they have to go, and it is not one
  // this screen can make while four of the twelve are unreadable.
  const bodyUnknown = !scansWhole && badges.some((b) => b.state === 'unknown') && countable;
  // …and WHICH of the two silences it is. `scansWhole` is `isWhole`, so it is
  // false for 'loading' as well as for 'error' and 'partial' — and the log
  // lands before the scans do often enough that this is an ordinary frame, not
  // an edge: `countable` goes true, four badges go 'unknown', and the hero said
  // "Your weight history could not be read" about a read that was still in
  // flight and about to succeed. A failure stated over a read that has not
  // finished is the defect this whole screen is otherwise careful about, one
  // read to the left. The badges stay blank either way — that part was right —
  // and only the sentence under them changes.
  const bodyReading = bodyUnknown && cd.scansStatus === 'loading';
  /** The count may be stated: a whole log, and no badge left unreadable. */
  const counted = countable && !bodyUnknown;
  const next = counted ? badges.find((b) => b.state === 'locked' && progressOf(b.key, figures)) ?? null : null;
  const nextProgress = next ? progressOf(next.key, figures) : null;
  // "7 of 10 days", "2 of 5 records", "640 of 1,000 kg" — the quantity on its
  // own, because it is also what the meter says aloud. Volume converts the way
  // the badge's description does; the threshold itself stays a fixed mass.
  const say = (p: { have: number; need: number; kind: 'days' | 'records' | 'volume' }) => {
    if (p.kind !== 'volume') return `${Math.min(p.have, p.need).toLocaleString()} of ${p.need.toLocaleString()} ${p.kind === 'days' ? 'days' : 'records'}`;
    // `volumeIn` may decline to answer, and then only the target is stated:
    // a volume nobody converted is not a volume of nought.
    const have = volumeIn(Math.min(p.have, p.need), wu);
    return have == null ? `Toward ${volumeLabel(p.need)}` : `${Math.floor(have).toLocaleString()} of ${volumeLabel(p.need)}`;
  };

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
      `Badge Unlocked · ${b.title}`,
      (typeof b.cheer === 'string' ? b.cheer : '')
        + (watch.alsoUnlocked > 0
          ? ` ${watch.alsoUnlocked === 1 ? 'One more badge' : `${watch.alsoUnlocked} more badges`} unlocked at the same time.`
          : ''),
    );
    watch.acknowledge();
  }, [watch.pending]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board has no page for this screen, so it takes its sibling's
            opening — Challenges, board page 14: the title centred between
            the back control and an equal space at the trailing edge. Two
            screens reached from the same rows should open the same way. */}
        <PageHead title="Achievements" />

        {/* ── the figure: how much of the set is unlocked, as a ring ────────
            Withheld under `bodyUnknown` for the same reason it is withheld
            under a partial log: the count can only be an under-count while
            four of the twelve are unreadable, and a figure that is silently
            low is worse than a track with no arc and a sentence beside it. */}
        <Section>
          <View style={{ flexDirection: fontScale >= 1.35 ? 'column' : 'row', alignItems: 'center', gap: sp.lg }}>
            <Ring value={counted ? earnedCount / badges.length : null} figure={counted ? fig(earnedCount) : null} sub={`of ${badges.length}`}
              size={112} tone="amber"
              spoken={counted ? `${earnedCount} of ${badges.length} badges earned` : 'Badges earned, not counted'} />
            <View style={{ flex: 1, minWidth: 0, gap: sp.sm, alignSelf: 'stretch', justifyContent: 'center' }}>
              <Text style={{ ...ty.section, color: t.ink }}>Unlocked</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                {logStatus === 'loading' ? 'Reading your training log…'
                  : !logKnown ? 'We couldn’t read your training log, so badges you have earned are not shown below.'
                  : !countable ? 'You have trained more times than this screen can read in one go, so the count is left blank. Anything marked Earned below really is.'
                  : bodyReading ? 'Reading your weight history. The badges priced from your bodyweight sets are blank until it lands.'
                  : bodyUnknown ? 'Your weight history could not be read, so the badges priced from your bodyweight sets are left blank rather than shown as locked.'
                  : earnedCount === 0 ? 'Log a workout to unlock your first badge' : `${badges.length - earnedCount} left to earn`}
              </Text>
            </View>
          </View>
          {/* ── the next one, and how far off it is ──────────────────────────
              The first LOCKED badge in the set's own order that has a distance
              to cover. Only a badge known to be locked: 'unknown' is not a
              shortfall, and a meter under it would draw our failed read as the
              member's. Nothing under a count that is withheld, for the same
              reason. */}
          {next && nextProgress ? (
            <View style={{ marginTop: sp.lg }}>
              <Meter label={`Next · ${next.title}`} val={nextProgress.have} target={nextProgress.need} tone={BADGE_LOOK[next.key].tone}
                note={say(nextProgress)} />
            </View>
          ) : null}
        </Section>

        <Section>
          <SectionHead title="Badges" />
          {bodyUnknown ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
              {bodyReading
                ? 'A pull-up or a dip is priced from your bodyweight on the day, and that history is still being read. The badges that depend on it are blank until it arrives.'
                : 'A pull-up or a dip is priced from your bodyweight on the day, and that history could not be read just now. The badges that depend on it are blank rather than locked. Nothing you have earned is gone.'}
            </Text>
          ) : null}
          {/* A grid of medals, three across and two once the reader's text is
              large. 'earned' | 'locked' | 'unknown' from the module, which
              encodes what this screen used to work out from two separate
              booleans: "Locked" is a claim that the badge has NOT been earned,
              and with an unread or truncated log we do not know — while
              "Earned" survives both, because every threshold only ever
              under-counts. A failed read is 'unknown' too: `countable` is
              false there. An unknown medal is grey with a dash and NO lock. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: sp.lg }}>
            {badges.map((b) => {
              const earned = logKnown && b.state === 'earned';
              const locked = logKnown && b.state === 'locked';
              const c = medalColours(t, earned ? BADGE_LOOK[b.key].tone : 'neutral');
              return (
                <View key={b.key} accessible accessibilityLabel={`${b.title}, ${earned ? 'unlocked' : locked ? 'locked' : 'not known'}. ${b.desc}`}
                  style={{ width: fontScale >= 1.35 ? '50%' : '33.33%', alignItems: 'center', paddingHorizontal: sp.xs, gap: sp.xs }}>
                  <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                    {earned ? <Icon name={BADGE_LOOK[b.key].icon} size={30} color={c.ink} />
                      : locked ? <Icon name="lock" size={24} color={c.ink} />
                      : <Text style={{ ...ty.head, color: c.ink }}>{fig(null)}</Text>}
                  </View>
                  <Text style={{ ...ty.label, color: earned ? t.ink : t.ink2, textAlign: 'center', marginTop: sp.xs }}>{b.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>{b.desc}</Text>
                  {earned ? <View style={{ alignSelf: 'center' }}><TonedChip label="Earned" tone={BADGE_LOOK[b.key].tone} icon="check" /></View> : null}
                </View>
              );
            })}
          </View>
        </Section>
      </ScrollView>
      {/* Over the list rather than inside it, so the burst is not clipped by
          the scroll view and does not push the layout around while it runs. */}
      <Confetti show={burst} onDone={() => setBurst(false)} />
    </SafeAreaView>
  );
}
