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
import { useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, value } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightDeltaIn } from '../../src/lib/units';
import { deltaLabel, deltaMoved } from '../../src/lib/deltaLabel';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { useBrand } from '../../src/ui/brand';
import { shownStreak, longestStreak, personalRecords } from '../../src/lib/streaks';
import { charsPerLine, wrapLines } from '../../src/lib/shareAsset';
import { sharePngAsset, imageShareBlocker } from '../../src/lib/social';
import { FORWARD_CHAR } from '../../src/ui/direction';

/**
 * The card as an EXPORTABLE GRAPHIC, drawn in SVG so `toDataURL` can turn it
 * into a PNG.
 *
 * ── Why this exists next to the on-screen card ─────────────────────────────
 *
 * This screen used to share a string and then print "Tip: screenshot the card
 * above to post the visual too." — an app telling somebody to work around it,
 * on the one surface built to leave the app and be seen by people who do not
 * have it. The whole SVG → toDataURL → PNG → share-sheet pipeline already
 * existed on the coach side (app/(trainer)/share-kit.tsx, src/lib/social.ts)
 * and no client screen had ever imported it.
 *
 * It is a second component rather than a render of the on-screen one because
 * the two have different jobs and different units. The screen card is laid out
 * in points against the member's theme; this is laid out in EXPORT PIXELS on a
 * fixed dark ground, because it is an artefact for somebody else's feed rather
 * than a view — a member who happens to have a light palette on should not get
 * a white card, and the same milestone should not come out looking like a
 * different template depending on a setting they changed months ago.
 *
 * The one thing that does follow the app is the accent, because that is the
 * tenant's brand colour and this is a white-label product.
 *
 * Every string goes through `wrapLines`. SVG has no line box: `<Text>` draws
 * one line and lets it run off the edge of the image, silently, in the exported
 * PNG that nobody opens again before posting it.
 */
const EXPORT_W = 1080;
const EXPORT_H = 1350;   // 4:5 — the tallest an Instagram or Facebook feed post
                         // may be without being cropped, so the most pixels a
                         // member gets for free.

function CardArt({ accent, appName, kicker, big, unit, sub, ref }: {
  accent: string; appName: string; kicker: string; big: string; unit: string; sub: string;
  ref?: React.Ref<Svg>;
}) {
  const w = EXPORT_W, h = EXPORT_H;
  const GROUND = '#0B0F14';
  const INK = '#FFFFFF';
  const MUTED = 'rgba(255,255,255,0.58)';
  const pad = Math.round(w * 0.089);
  const contentW = w - pad * 2;

  const kickerSize = Math.round(w * 0.032);
  // The figure shrinks as it lengthens. "12" and "-14.5" are the same element
  // at two very different widths, and a fixed size lets the longer one run into
  // the margin of the exported image.
  const bigSize = Math.round(w * (big.length > 5 ? 0.20 : big.length > 3 ? 0.26 : 0.32));
  const subSize = Math.round(w * 0.042);
  const subLines = wrapLines(sub, charsPerLine(contentW, subSize), 3);

  const footerY = h - pad;
  const ruleY = footerY - Math.round(h * 0.045);
  const bigY = ruleY - Math.round(h * 0.10);
  const subTop = bigY + Math.round(subSize * 1.7);

  return (
    <Svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Rect x={0} y={0} width={w} height={h} fill={GROUND} />
      {/* The accent, spent on two marks and nothing else — the rule under the
          kicker and the tick beside the footer. The instrument-panel rule from
          src/ui/kit: colour marks the live thing, not the chrome. */}
      <Rect x={pad} y={pad} width={Math.round(w * 0.075)} height={Math.round(h * 0.006)} fill={accent} rx={Math.round(h * 0.003)} />
      <SvgText x={pad} y={pad + kickerSize + Math.round(h * 0.03)} fill={MUTED} fontSize={kickerSize} fontWeight="600" letterSpacing={kickerSize * 0.12}>
        {kicker.toUpperCase()}
      </SvgText>

      <SvgText x={pad} y={bigY} fill={INK} fontSize={bigSize} fontWeight="700">
        {big}
        {unit ? <SvgText fill={MUTED} fontSize={Math.round(bigSize * 0.32)} fontWeight="600">{`  ${unit}`}</SvgText> : null}
      </SvgText>

      {subLines.map((l, i) => (
        <SvgText key={`s${i}`} x={pad} y={subTop + i * Math.round(subSize * 1.35)} fill={INK} fontSize={subSize} fontWeight="500">
          {l}
        </SvgText>
      ))}

      <Line x1={pad} y1={ruleY} x2={w - pad} y2={ruleY} stroke="rgba(255,255,255,0.16)" strokeWidth={2} />
      {/* The tenant's name, never the word Repple: this graphic is the most
          public thing the app produces, and a white-label gym's member posting
          their supplier's name is the gate on the first white-label sale. */}
      <SvgText x={pad} y={footerY} fill={MUTED} fontSize={Math.round(w * 0.03)} fontWeight="600">
        {wrapLines(appName, charsPerLine(contentW * 0.7, Math.round(w * 0.03)), 1)[0] ?? ''}
      </SvgText>
      <Rect x={w - pad - Math.round(w * 0.03)} y={footerY - Math.round(w * 0.022)} width={Math.round(w * 0.03)} height={Math.round(w * 0.008)} fill={accent} rx={Math.round(w * 0.004)} />
    </Svg>
  );
}

function ShareCard({ t, appName, kicker, big, unit, sub }: { t: Theme; appName: string; kicker: string; big: string; unit: string; sub: string }) {
  return (
    <View style={{ backgroundColor: t.brand, borderRadius: radius.md, padding: sp.xl, minHeight: 200, justifyContent: 'space-between', ...elevation.e1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>{appName}</Text>
        <Text style={{ ...ty.micro, color: t.brandInk, opacity: 0.85 }}>{kicker}</Text>
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ ...value(56), color: t.brandInk }}>{big}</Text>
          {unit ? <Text style={{ ...ty.title, color: t.brandInk, marginStart: 6, letterSpacing: 0 }}>{unit}</Text> : null}
        </View>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.brandInk, opacity: 0.9, marginTop: sp.xs }}>{sub}</Text>
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
  const prs = personalRecords(log, c.weightSeries).sort((a, b) => b.est1RM - a.est1RM);
  const topPr = prs[0];
  // `weightSeries` is derived from the SCANS, and this file asked the workout
  // log's status about everything and the scans' status about nothing. Under a
  // refused scan read the series is empty, so a member with twenty weigh-ins
  // was shown "Weigh in twice to unlock" — the same false claim about their own
  // record that the long note below refuses to make about their training log.
  // app/(client)/social.tsx checks exactly this on exactly this provider.
  const scansKnown = isWhole(c.scansStatus);
  const w = scansKnown ? c.weightSeries : [];
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
  const hasPr = logKnown && !!topPr;
  const UNREAD = logStatus === 'loading' ? 'Reading your training log…' : logStatus === 'partial' ? 'More logged than can be read at once — a “best ever” over part of it is not one' : 'We couldn’t read your training log';

  const cards = [
    // `available: true` was hardcoded on this one card while the other two
    // honoured the flag — so an unread log rendered "0 days · Best ever: 0 days"
    // as a milestone with Share still enabled, and a client on a live 40-day
    // streak was invited to publicly announce a streak of zero.
    { kicker: 'Streak', big: hasStreak ? String(streak) : '—', unit: hasStreak ? (streak === 1 ? 'day' : 'days') : '', sub: hasStreak ? `Best ever: ${best} days` : logKnown ? 'Log a workout to start a streak' : UNREAD, available: hasStreak },
    // `fig`, not `String`. `weightIn` returns `number | null`, and `String(null)`
    // is the four-letter word "null" — which this card would have drawn at 56pt
    // as the figure somebody screenshots and posts. That is the exact failure
    // fig() was written for, and this was the one screen in the app printing a
    // convertible weight without it.
    { kicker: 'Top Lift', big: hasPr ? fig(weightIn(topPr.est1RM, wu)) : '—', unit: hasPr ? wu : '', sub: hasPr ? `${topPr.exercise} · est 1RM` : logKnown ? 'Log a lift to unlock' : UNREAD, available: hasPr },
    // No second weigh-in means no measured change — show the card locked rather
    // than a manufactured "+0 kg since you started".
    // `hasProgress` asks whether there are two weigh-ins; it never asked
    // whether they differed. Two identical ones produced exactly the
    // "manufactured 0 kg since you started" the note above says this card
    // refuses — with Share enabled under it. `moved` is the same question
    // asked of the figure that will actually be printed, in the member's own
    // unit, so a change too small to show at this grain does not become a
    // shareable milestone either.
    { kicker: 'Progress', big: moved ? deltaLabel(wDeltaShown, { since: null }) : '—', unit: moved ? wu : '', sub: moved ? 'Since you started' : hasProgress ? 'No change since your first weigh-in' : scansKnown ? 'Weigh in twice to unlock' : 'We couldn’t read your weigh-ins', available: moved },
  ];
  const card = cards[idx];
  const shareText = (i: number) => {
    if (i === 0) return `${streak}-day training streak on ${appName} (best: ${best}). Every rep ripples out.`;
    // The lift converted BEFORE the sentence is built, and the sentence
    // withheld when it comes back null. Interpolating it straight in sent
    // "estimated 1RM nullkg" out of the phone, into a post, permanently.
    if (i === 1) {
      const lift = topPr ? weightIn(topPr.est1RM, wu) : null;
      return lift != null && topPr
        ? `New milestone on ${appName}: ${topPr.exercise} — estimated 1RM ${lift}${wu}. The work is working.`
        : `Chasing my first PR on ${appName}.`;
    }
    // Never a zero: this string leaves the phone. The card is unavailable
    // when nothing moved, so this is unreachable then — and if it ever is
    // reached it says what happened rather than posting a change of none as
    // "progress you can measure".
    return moved
      ? `${deltaLabel(wDeltaShown, { since: null })}${wu} since I started with ${appName}. Progress you can measure.`
      : `Training with ${appName}. Every rep ripples out.`;
  };
  const svgRef = useRef<Svg>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The card as a base64 PNG, or null when this build cannot make one.
   *
   * `toDataURL` is callback-based and native, and it has two failure modes a
   * plain promise wrapper would turn into a button that spins for ever: the
   * method is absent on some react-native-svg / architecture combinations, and
   * on others the callback is simply never invoked. Absent is checked, silent
   * is timed out, and both come back as null — which the share path below turns
   * into an honest "the words went as text" rather than a hang.
   *
   * Lifted verbatim in shape from app/(trainer)/share-kit.tsx, which has been
   * carrying this pipeline alone.
   */
  const capture = (): Promise<string | null> => new Promise((resolve) => {
    const node = svgRef.current as unknown as { toDataURL?: (cb: (d: string) => void, o?: object) => void } | null;
    if (!node || typeof node.toDataURL !== 'function') { resolve(null); return; }
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 5000);
    try {
      node.toDataURL((data: string) => { clearTimeout(timer); finish(data || null); }, { width: EXPORT_W, height: EXPORT_H });
    } catch { clearTimeout(timer); finish(null); }
  });

  const shareCard = async () => {
    if (busy) return;
    setBusy(true);
    const png = await capture();
    // The caption is put on the clipboard and the image goes through the sheet.
    // A share sheet will not carry both to an arbitrary destination — the long
    // note on `sharePngAsset` is the argument — so they travel separately and
    // the member is told which happened.
    const r = await sharePngAsset(png ?? '', `${appName.replace(/[^A-Za-z0-9]+/g, '-')}-${card.kicker.toLowerCase()}.png`, shareText(idx));
    setBusy(false);
    if (r.sent === 'image') {
      Alert.alert(
        'Card sent to your share sheet',
        r.captionCopied
          ? 'Your words are on the clipboard — paste them into the post. A share sheet cannot carry a picture and its words to the same place, so they travel separately.'
          : 'This version of the app could not put your words on the clipboard, so the picture went on its own.',
      );
      return;
    }
    // No image. Say which of the two reasons it was rather than letting the
    // member conclude the card failed to draw: one is a build that predates the
    // image pipeline, the other is that the graphic itself could not be made.
    const blocked = imageShareBlocker();
    Alert.alert(
      'Sent as text',
      blocked ?? 'The picture could not be made on this phone, so your words went on their own. The card on screen is unchanged.',
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Screenshot & share your wins</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Milestone Cards</Text>
          </View>
        </View>

        <Section>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: layout.section }}>
            {cards.map((cd, i) => (
              <Pressable key={cd.kicker} onPress={() => setIdx(i)} accessibilityRole="button" accessibilityLabel={cd.kicker}
                style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: idx === i ? t.surface2 : 'transparent' }}>
                <Text style={{ ...ty.label, fontWeight: idx === i ? '500' : '400', color: idx === i ? t.ink : t.ink3 }}>{cd.kicker}</Text>
              </Pressable>
            ))}
          </View>

          <ShareCard t={t} appName={appName} kicker={card.kicker} big={card.big} unit={card.unit} sub={card.sub} />

          {/* The export, off-screen and rendered at full size.
              It has to be MOUNTED for `toDataURL` to have anything to read, and
              it must not be visible — so it is pushed out of the layout rather
              than hidden with `display: none`, which on Android detaches the
              view and hands the capture back an empty bitmap. Only the
              available card is drawn: a locked one has a dash where the figure
              goes and there is nothing to export. */}
          {card.available ? (
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={{ position: 'absolute', start: -EXPORT_W * 2, top: 0, width: EXPORT_W, height: EXPORT_H, opacity: 0 }}>
              <CardArt ref={svgRef} accent={t.brand} appName={appName} kicker={card.kicker} big={card.big} unit={card.unit} sub={card.sub} />
            </View>
          ) : null}

          <View style={{ marginTop: layout.section }}>
            <Cta label={busy ? 'Preparing…' : 'Share This Card'} wide disabled={!card.available || busy} onPress={shareCard} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
            {/* This line used to read "Tip: screenshot the card above to post
                the visual too." — the app asking the member to work around it
                on its main organic-growth surface. It now says what the button
                does, or names the reason the picture cannot be made on this
                build, which is a different sentence with a different answer. */}
            {card.available ? (imageShareBlocker() ?? 'The card goes as a picture, and your words go on the clipboard to paste beside it.')
              : logKnown ? 'This card unlocks once there is something real to show.'
              : 'Cards stay locked until we can read your record — nothing has been lost.'}
          </Text>
        </Section>

        <Rule />

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
          <Pressable onPress={() => router.push('/(client)/social')} accessibilityRole="button" accessibilityLabel="Share your progress"
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, alignSelf: 'center' }}>
            <Icon name="share" size={15} color={t.ink3} />
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Share Your Progress {FORWARD_CHAR}</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
