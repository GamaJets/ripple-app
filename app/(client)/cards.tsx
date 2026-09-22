// Client · Milestone Cards. Branded, screenshot-ready cards for streak, top PR,
// and weight change. Uses the tenant brand (colour + app name). Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation and route is preserved. One honesty fix: each card
// already computed an `available` flag and then ignored it, so the Progress card
// rendered "+0 kg · Since you started" — a fabricated zero — for a client with
// fewer than two weigh-ins, and offered to share it. Unavailable cards now show
// what to do to unlock them, and can't be shared.
//
// TF-37: the top lift and the weight change were stamped "kg" on the card and
// in the share text. These cards are the most public thing the app produces —
// they are built to be screenshotted and posted — so a client reading pounds
// was being handed a card announcing a number in a unit they never use, to an
// audience with no way to know that. Both now read in the client's unit.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, Cta, fig, PageHead, Segmented, ListRow } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, value, font } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn, weightShown } from '../../src/lib/units';
import { deltaLabel, deltaMoved } from '../../src/lib/deltaLabel';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { useBrand } from '../../src/ui/brand';
import { shownStreak, longestStreak, personalRecords } from '../../src/lib/streaks';
import { SharePostSheet } from '../../src/ui/SharePost';
import { streakPost, liftPost, progressPost, type PostBuild } from '../../src/lib/postCard';

/** The on-screen card. The exported picture is drawn by src/ui/SharePost.tsx,
 *  which also offers the Story size. */
function ShareCard({ t, appName, kicker, big, unit, sub }: { t: Theme; appName: string; kicker: string; big: string; unit: string; sub: string }) {
  return (
    <View style={{ backgroundColor: t.brand, borderRadius: radius.md, padding: sp.xl, minHeight: 200, justifyContent: 'space-between', ...elevation.e1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...ty.body, ...font('600'), color: t.brandInk }}>{appName}</Text>
        <Text style={{ ...ty.micro, color: t.brandInk, opacity: 0.85 }}>{kicker}</Text>
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ ...value(56), color: t.brandInk }}>{big}</Text>
          {unit ? <Text style={{ ...ty.title, color: t.brandInk, marginStart: 6, letterSpacing: 0 }}>{unit}</Text> : null}
        </View>
        <Text style={{ ...ty.body, ...font('500'), color: t.brandInk, opacity: 0.9, marginTop: sp.xs }}>{sub}</Text>
      </View>
    </View>
  );
}

export default function Cards() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  // Every figure printed on a card comes from the profile or the training log,
  // and a card is the one thing on this screen that leaves the phone.
  const pull = usePullToRefresh(useCallback(() => { c.reload(); reloadLog(); }, [c.reload, reloadLog]));
  const { appName } = useBrand();
  const wu = useSettings().weightUnit;
  const [idx, setIdx] = useState(0);

  // `shownStreak`, not `currentStreak`. This card is exported as an image and
  // posted, and it was printing the RAW chain while the ring on Home printed
  // the frozen one — so a member whose freeze had bridged a missed day posted a
  // smaller number than their own app had just congratulated them on.
  const streak = shownStreak(log);
  const best = longestStreak(log);
  // `weightSeries` is derived from the SCANS, and this file asked the workout
  // log's status about everything and the scans' status about nothing. Under a
  // refused scan read the series is empty, so a member with twenty weigh-ins
  // was shown "Weigh in twice to unlock" — the same false claim about their own
  // record that the long note below refuses to make about their training log.
  // app/(client)/social.tsx checks exactly this on exactly this provider.
  const scansKnown = isWhole(c.scansStatus);
  const w = scansKnown ? c.weightSeries : [];
  // ── the second read the Top Lift card was never asking about ──────────
  //
  // `personalRecords` skips any set whose `setLoadKg` comes back null, and with
  // no weight history that is EVERY bodyweight set — so under a scans read that
  // failed or truncated, an 84 kg member whose top record is a +20 kg pull-up
  // had every calisthenic record silently drop off the board and `topPr` became
  // the best BARBELL lift instead. The card then announced their bench as their
  // top lift, with Share still enabled, and these cards are exported as PNGs
  // and posted publicly.
  //
  // Priced from `w` and not `c.weightSeries`, so the board is built from the
  // same gated series the Progress card uses rather than from whatever the
  // provider happened to be holding when the read failed. That also settles
  // `shareText` below, which reads `topPr` directly.
  const prs = personalRecords(log, w).sort((a, b) => b.est1RM - a.est1RM);
  const topPr = prs[0];
  const wDelta = w.length > 1 ? +(w[w.length - 1].v - w[0].v).toFixed(1) : 0;
  // The change in the client's unit, converted as one span and rounded once at
  // the end rather than at each weigh-in. A measured half-kilo that rounds to a
  // pound is progress, and the card is allowed to say so; a change that rounds
  // all the way to nothing is not, and `moved` below is where that line is
  // drawn — on the converted figure, because that is the one being printed.
  // Always finite here, so the null branch of weightDeltaIn is unreachable.
  const wDeltaShown = weightDeltaIn(wDelta, wu) ?? 0;
  const hasProgress = w.length > 1;
  // Whether the figure this card would print is a movement at all, judged at
  // the precision it is printed to — 0.2 kg is under half a pound, and "+0 lb
  // since you started" is not a milestone.
  const moved = hasProgress && deltaMoved(wDeltaShown);

  // Under 'error' the log is empty because it could not be read, not because
  // nothing was ever logged — so a streak of 0 and no PRs are unknowns here,
  // not zeroes, and a card is the last place to guess. These cards get posted.
  // `isWhole`, not `!== 'error'`. These cards are built to be screenshotted and
  // posted, so every figure on one is a public claim — and a truncated read
  // (src/lib/rowCap.ts) makes two of them quietly wrong rather than obviously
  // missing: "Best ever: 12 days" is the best of the thousand sessions that
  // came back, and the top estimated 1RM is the heaviest of those. Under
  // 'loading' it also stops the first frame offering a streak of zero to share.
  const logKnown = isWhole(logStatus);
  const hasStreak = logKnown && (streak > 0 || best > 0);
  // Both reads, because this card is priced from both. `scansKnown` is the
  // gate two lines above, and it was applied to the Progress card and to
  // nothing else on the screen.
  const hasPr = logKnown && scansKnown && !!topPr;
  const UNREAD = logStatus === 'loading' ? 'Reading your training log…' : logStatus === 'partial' ? 'More logged than can be read at once, and a “best ever” over part of it is not one' : 'We couldn’t read your training log';
  // The same three sentences for the OTHER read, in the words
  // app/(client)/records.tsx already uses for this exact case.
  const UNWEIGHED = c.scansStatus === 'loading' ? 'Reading your weight history…'
    : c.scansStatus === 'partial' ? 'More weigh-ins on record than can be read at once, and a top lift priced against part of them is not one'
    : 'We couldn’t read your weight history, and pull-ups and dips are priced against it';
  // The same three sentences again for the Progress card, which asks a
  // different question of the same read and so cannot borrow the one above.
  //
  // That card ended its chain `scansKnown ? 'Weigh in twice to unlock' : 'We
  // couldn’t read your weigh-ins'` — and `scansKnown` is `isWhole`, which is
  // false for 'loading' and 'partial' as well as for 'error'. So on the first
  // frame of every launch, before anything had been asked for, this card
  // asserted a read failure that had not happened; and under a truncated read
  // it asserted one where nothing failed at all. The whole point of the card
  // is that it gets screenshotted and posted, and the note beside it says
  // every figure on one is a public claim — a false claim about our own
  // failure is still a false claim.
  const UNWEIGHED_PROGRESS = c.scansStatus === 'loading' ? 'Reading your weight history…'
    : c.scansStatus === 'partial' ? 'More weigh-ins on record than can be read at once, and a change measured over part of them is not one'
    : 'We couldn’t read your weigh-ins';

  const cards = [
    // `available: true` was hardcoded on this one card while the other two
    // honoured the flag — so an unread log rendered "0 days · Best ever: 0 days"
    // as a milestone with Share still enabled, and a client on a live 40-day
    // streak was invited to publicly announce a streak of zero.
    { kicker: 'Streak', big: hasStreak ? String(streak) : '—', unit: hasStreak ? (streak === 1 ? 'Day' : 'Days') : '', sub: hasStreak ? `Best Ever: ${best} ${best === 1 ? 'Day' : 'Days'}` : logKnown ? 'Log a Workout to Start a Streak' : UNREAD, available: hasStreak && streak > 0 },
    // `fig`, not `String`. `weightIn` returns `number | null`, and `String(null)`
    // is the four-letter word "null" — which this card would have drawn at 56pt
    // as the figure somebody screenshots and posts. That is the exact failure
    // fig() was written for, and this was the one screen in the app printing a
    // convertible weight without it.
    // The unread sentence names WHICH read: "we couldn't read your training
    // log" over a log that came back whole and a weight history that did not
    // points the member at the wrong thing to pull down on.
    { kicker: 'Top Lift', big: hasPr ? fig(weightShown(topPr.est1RM, wu)) : '—', unit: hasPr ? wu : '', sub: hasPr ? `${topPr.exercise} · Est. 1RM` : !logKnown ? UNREAD : !scansKnown ? UNWEIGHED : 'Log a Lift to Unlock', available: hasPr },
    // No second weigh-in means no measured change — show the card locked rather
    // than a manufactured "+0 kg since you started".
    // `hasProgress` asks whether there are two weigh-ins; it never asked
    // whether they differed. Two identical ones produced exactly the
    // "manufactured 0 kg since you started" the note above says this card
    // refuses — with Share enabled under it. `moved` is the same question
    // asked of the figure that will actually be printed, in the member's own
    // unit, so a change too small to show at this grain does not become a
    // shareable milestone either.
    { kicker: 'Progress', big: moved ? deltaLabel(wDeltaShown, { since: null }) : '—', unit: moved ? wu : '', sub: moved ? 'Since You Started' : hasProgress ? 'No Change Since Your First Weigh-In' : scansKnown ? 'Weigh In Twice to Unlock' : UNWEIGHED_PROGRESS, available: moved },
  ];
  const card = cards[idx];
  const [build, setBuild] = useState<PostBuild | null>(null);
  const makePost = (i: number): PostBuild => {
    if (i === 0) return hasStreak ? streakPost({ days: streak, best, brand: appName }) : { ok: false, why: card.sub };
    if (i === 1) return hasPr && topPr ? liftPost({ lift: topPr.exercise, figure: fig(weightShown(topPr.est1RM, wu)), unit: wu, brand: appName }) : { ok: false, why: card.sub };
    return moved ? progressPost({ what: 'Weight', change: `${deltaLabel(wDeltaShown, { since: null })} ${wu}`, since: 'Since I Started', brand: appName }) : { ok: false, why: card.sub };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <PageHead title="Milestone Cards" subtitle="Share Your Wins as a Story or Post" />

        <Section>
          {/* The kit's segmented bar, as every other screen picks between
              views; it was a hand-built row of three grey pills. */}
          <Segmented style={{ marginBottom: layout.section }} value={String(idx)} onChange={(k) => setIdx(Number(k))}
            options={cards.map((cd, i) => ({ key: String(i), label: cd.kicker }))} />

          <ShareCard t={t} appName={appName} kicker={card.kicker} big={card.big} unit={card.unit} sub={card.sub} />

          <View style={{ marginTop: layout.section }}>
            <Cta label="Share This Card" wide disabled={!card.available} onPress={() => setBuild(makePost(idx))} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
            {/* This line used to read "Tip: screenshot the card above to post
                the visual too." — the app asking the member to work around it
                on its main organic-growth surface. It now says what the button
                does, or names the reason the picture cannot be made on this
                build, which is a different sentence with a different answer. */}
            {card.available ? 'Pick Story or Post. The card goes as a picture, and your words go on the clipboard to paste beside it.'
              : logKnown ? (idx === 0 && best > 0 ? 'Your streak starts again with your next workout. Then this card is yours to share.' : 'This card unlocks once there is something real to show.')
              : 'Cards stay locked until we can read your record. Nothing has been lost.'}
          </Text>
        </Section>


        <Section>
          {/* This said "Connect Instagram / TikTok", in the spoken label as
              well. app/(client)/social.tsx removed that feature deliberately —
              its own header records a NETWORKS list whose Connect button
              flipped a local boolean, stored no token, linked nothing and reset
              on relaunch — and the control advertising it was left behind. A
              member tapped a specific promise, landed on a screen that never
              mentions either network, and concluded the connection was broken
              or buried in a setting. What is actually there is the phone's own
              share sheet, which is what this now says. */}
          <ListRow icon="share" tone="blue" title="Share Your Progress" note="Your change since your first scan, from the share sheet"
            onPress={() => router.push('/(client)/social')} />
        </Section>
      </ScrollView>
      <SharePostSheet invite build={build} onClose={() => setBuild(null)} />
    </SafeAreaView>
  );
}
