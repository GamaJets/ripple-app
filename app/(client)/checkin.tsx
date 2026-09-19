// Client · Weekly Check-in (Phase 7). Rate the week and log weight; it goes to
// your coach and updates your tracked weight. Reachable from the profile hub.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`).
//
// ── Board page 12 ──────────────────────────────────────────────────────────
//
// The approved board draws this as one flat form, not a stack of cards: a
// centred "Weekly Check-in" over a back chevron, "How Are You Feeling?" with a
// row of five faces and the chosen one filled, "Energy Level" and "Sleep
// Quality" as sliders, a "Notes" field, and one full-width "Submit Check-in".
// That is the order here, and the first viewport holds exactly those. The two
// questions the board does not draw but the coach has always been sent — plan
// adherence and this week's weight — sit under the board's four in the same
// idiom (a slider and a field), because a check-in without them is not the
// check-in `sendCheckIn` files and src/lib/coachCheckins.ts reads. The
// history under the button (waiting to send, last check-in, the weeks before)
// is unchanged and below the fold.
//
// Honesty fixes:
//  · The four ratings arrived pre-selected at energy 4 / sleep 3 / mood 4 /
//    adherence 4. Tapping Send without touching them filed that invented week
//    under the client's name, and the coach — and the weekly report — read it
//    as their answer. They now start unset and Send asks for a score. A
//    slider with nothing set draws NO thumb, for the same reason: a thumb
//    resting at the left end is a 1 the client never gave.
//  · The weight field was pre-filled from `cd.weightKg`, which for an account
//    with no scan and no logged weigh-in is the provider's 70 kg placeholder;
//    submitting wrote that 70 kg back as a real measurement. It now starts
//    blank unless there is a genuine weight on record.
//  · The 1–5 buttons rendered `SCALE`, an array of five empty strings — five
//    blank squares. They show the score they set.
//  · TF-37, and the worst of the lot: this field was labelled "kg", validated
//    20–400, and whatever was typed went into `weightKg` unconverted. A client
//    who reads in pounds typed 180 and their record gained 180 kg — a 99 kg
//    error, inside the accepted range, written to the weight their macros,
//    their goal progress and their coach's view are all computed from. The
//    field now says which unit it wants, the bound is expressed in that unit,
//    and the number is converted on the way to storage.
import { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import { useSubmitOnce } from '../../src/ui/submitOnce';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Cta, PageHead, Spark, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { MIN_TARGET } from '../../src/lib/a11y';
import { useClientData } from '../../src/ui/clientData';
import { fmtFullDay } from '../../src/lib/format';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, kgToLb, plain, convertedNote, readNumber } from '../../src/lib/units';
import { useCheckIns } from '../../src/ui/checkins';
// The rest of what they already sent. Energy, sleep, mood and adherence have
// been filed weekly on a 1–5 scale and read back by the provider all along;
// this screen rendered `latest` and threw the remainder away, so the one
// question a weekly rating exists to answer — is this going up or down — could
// not be asked by the person answering it every Sunday. Their coach has read
// the same rows since src/lib/coachCheckins.ts was written.
import { checkinTrend, seriesNote, trendLine } from '../../src/lib/checkinTrend';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isPending } from '../../src/lib/wellnessSync';
import { unsentNote } from '../../src/lib/offlineQueue';
import { isRTL } from '../../src/ui/direction';

// The range a human weighs, in the kilograms this app stores. Kept in metric
// because the record is metric; the two bounds are converted for whichever unit
// the client is typing in, so the message they read quotes numbers on the same
// scale as the number in the box rather than a metric range they never see.
const MIN_KG = 20;
const MAX_KG = 400;

/**
 * The five faces, spoken. The coach reads mood as a number out of five — that
 * is the column and it has not changed — but a screen reader cannot read a
 * drawn mouth, so each face carries one word. The words are this screen's
 * names for the five scores and are stored nowhere.
 */
const MOOD_WORDS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;

/** The mouth for one score: a frown that flattens at 3 and lifts to a grin. */
function mouth(n: number): string {
  switch (n) {
    case 1: return 'M7.5 16.5 Q12 12 16.5 16.5';
    case 2: return 'M7.5 16 Q12 14 16.5 16';
    case 3: return 'M7.5 15.5 L16.5 15.5';
    case 4: return 'M7.5 14.5 Q12 17.5 16.5 14.5';
    default: return 'M7.5 14 Q12 19.5 16.5 14';
  }
}

/**
 * The board's mood row: five faces, the chosen one filled in the accent.
 *
 * Drawn, not typed. An emoji would render in whatever face the handset's font
 * gives it and could not take the theme's ink, so the board's filled circle
 * with a face inside it is two SVG dots and one path per score. The circle
 * itself is the Pressable's fill, which is what makes the selected one read as
 * the board's chip — `t.brand` with `t.brandInk` strokes — under every accent
 * a gym white-labels this to.
 */
function Faces({ t, label, value: val, onChange }: { t: Theme; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ marginBottom: sp.xl }}>
      <FieldLabel t={t} label={label} note={val ? MOOD_WORDS[val - 1] : undefined} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.md }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = val === n;
          const ink = on ? t.brandInk : t.ink2;
          return (
            <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button"
              accessibilityLabel={`${label}: ${MOOD_WORDS[n - 1]}, ${n} of 5`} accessibilityState={{ selected: on }}
              style={{ width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
              <Svg width={30} height={30} viewBox="0 0 24 24">
                <Circle cx="8.5" cy="9.5" r="1.5" fill={ink} />
                <Circle cx="15.5" cy="9.5" r="1.5" fill={ink} />
                <Path d={mouth(n)} stroke={ink} strokeWidth={2} strokeLinecap="round" fill="none" />
              </Svg>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A label over a control, with the control's current answer at the far end of
 * the same line — "4/5", the unit, the word for the face — so the answer is
 * read where the question is.
 */
function FieldLabel({ t, label, note }: { t: Theme; label: string; note?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, flexShrink: 1 }}>{label}</Text>
      {note ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{note}</Text> : null}
    </View>
  );
}

/**
 * The board's slider, on a five-point scale.
 *
 * Built on the raw responder props rather than a slider package: none is in
 * the binary, and a native dependency cannot ship over the air to the phones
 * that already have this app (see src/lib/dragReorder.ts for the same
 * reasoning about reanimated). The scale is 1–5 and discrete, because that is
 * what `sendCheckIn` files and what the coach's console and the trend under
 * this form have always read; the thumb snaps to the nearest score, so
 * nothing between two scores can be sent.
 *
 * Unset draws no fill and no thumb. A thumb resting at the left end IS a 1 to
 * anybody looking at it, and this screen has already been fixed once for
 * ratings it invented. The first touch anywhere on the track sets a score.
 *
 * `accessibilityRole="adjustable"` is the RN role for this shape: the rotor's
 * up/down and a switch's increment land on `onAccessibilityAction` and step by
 * one, which is the same thing a drag does through a path that needs no drag.
 * The touch area is the full width and `MIN_TARGET` tall — the track is 4pt
 * and nobody can hit 4pt.
 *
 * `locationX` is measured from the physical left edge, and under a right-to-
 * left layout `start` is the right edge, so the fraction is mirrored there —
 * otherwise a drag to the right would shrink the fill it was growing.
 */
function Slider({ t, label, value: val, onChange }: { t: Theme; label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const THUMB = 22;
  const pick = (x: number) => {
    if (w <= 0) return;
    const frac = Math.max(0, Math.min(1, x / w));
    onChange(1 + Math.round((isRTL ? 1 - frac : frac) * 4));
  };
  const step = (by: number) => onChange(val ? Math.max(1, Math.min(5, val + by)) : 1);
  const pct = val ? ((val - 1) / 4) * 100 : 0;
  return (
    <View style={{ marginBottom: sp.xl }}>
      <FieldLabel t={t} label={label} note={val ? `${val}/5` : 'Not set'} />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={val ? { min: 1, max: 5, now: val } : { text: 'Not set' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') step(1);
          else if (e.nativeEvent.actionName === 'decrement') step(-1);
        }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        style={{ height: MIN_TARGET, justifyContent: 'center' }}>
        <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: t.surface3 }} />
        {val ? (
          <View>
            <View style={{ position: 'absolute', start: 0, top: -2, height: 4, width: `${pct}%`, borderRadius: radius.pill, backgroundColor: t.brand }} />
            {/* The thumb is the board's: near-black on the green, lifted off
                the track by a ring of the canvas. `start` is a percentage of
                the track less half the thumb, so score 1 and score 5 sit
                centred on the two ends rather than hanging past them. */}
            <View style={{
              position: 'absolute', top: -THUMB / 2, start: `${pct}%`, marginStart: -THUMB / 2,
              width: THUMB, height: THUMB, borderRadius: radius.pill,
              backgroundColor: t.ink, borderWidth: 3, borderColor: t.bg,
            }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function CheckIn() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const ci = useCheckIns();
  // The history under the form — what was sent, and whether the coach has it —
  // plus the profile the figures are prefilled from.
  const pull = usePullToRefresh(useCallback(() => { ci.reload(); cd.reload(); }, [ci.reload, cd.reload]));

  const wu = useSettings().weightUnit;

  // Four lines out of one pass, so a series and its dates cannot be reversed
  // apart — which would put every point over the wrong week and render
  // perfectly while doing it. Pending check-ins are IN it on purpose: they are
  // this member's own answers, they are what the chart is about, and the only
  // thing a pending row must never imply is that the coach has read it — which
  // is the "Waiting to Send" section's job and not the chart's.
  const trend = useMemo(() => checkinTrend(ci.checkins, ci.status), [ci.checkins, ci.status]);

  // Blank unless there is a weight actually on record for this client, and in
  // the unit that client reads in.
  //
  // `typed` is null until the client touches the field, and while it is null
  // the box shows the record converted afresh on every render. That indirection
  // is not decoration: the account's unit preference arrives from the server a
  // moment after this screen mounts, so a field seeded once at mount would sit
  // there holding kilograms under a "lb" label for exactly the client this
  // ticket is about. Once they have typed, what they typed is what stands.
  const [typed, setTyped] = useState<string | null>(null);
  const shownWeight = weightIn(cd.weightKg, wu);
  const weight = typed ?? (shownWeight == null ? '' : plain(shownWeight));

  // The bound the client is actually held to, said in the unit they are typing.
  // 20–400 kg is 44–882 lb, and telling somebody who typed 180 that the range
  // is "20 to 400" would read as a rejection of a perfectly ordinary weight.
  const minShown = wu === 'lb' ? Math.round(kgToLb(MIN_KG)) : MIN_KG;
  const maxShown = wu === 'lb' ? Math.round(kgToLb(MAX_KG)) : MAX_KG;

  // Said under the field when, and only when, the figure in it came out of the
  // metric record — `convertedNote` returns null in kilograms, so a metric
  // client is not lectured about a conversion that is not happening.
  const weightNote = convertedNote(wu);

  const [energy, setEnergy] = useState(0);
  const [sleep, setSleep] = useState(0);
  const [mood, setMood] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [note, setNote] = useState('');

  const send = useSubmitOnce('checkin.submit');

  const submit = async () => {
    // The range is checked against the number as typed, before any conversion,
    // so that the figure being judged is the figure on screen. Checking a
    // converted number against a metric range would reject 900 lb by quoting
    // kilograms, and — far worse in the other direction — used to accept 180 lb
    // as 180 kg without either number ever leaving the range.
    // Through `readNumber`, not `parseFloat`. This box is now a decimal pad,
    // and on a German or French phone the decimal key on it is a COMMA:
    // `parseFloat('73,5')` is 73, so the figure being range-checked would not
    // be the figure `weightToKg` stores two lines below. One reader, one number.
    const w = readNumber(weight);
    if (w == null || !(w > minShown && w < maxShown)) { Alert.alert('Add your weight', `Enter this week's weight in ${wu} so your coach sees the real number.`); return; }
    if (!energy || !sleep || !mood || !adherence) { Alert.alert('Rate your week', 'Pick a face, and slide energy, sleep and adherence to a score — we won\'t guess them for you.'); return; }
    // Storage is metric everywhere, so the pounds a client typed become the
    // kilograms the coach's console, the macro calculator and the goal tracker
    // all read. `weightToKg` returns null for an unreadable field, but the
    // range check above has already established there is a number here.
    const kg = weightToKg(weight, wu);
    if (kg == null) return;
    // Written and CONFIRMED, not typed and hoped for. `setWeightKg` is local
    // state plus a debounced push whose only outcome is `saveFailed` six
    // hundred milliseconds later, and this screen never read it — so it said
    // "your weight has been updated" over a write nobody had asked the server
    // about. That figure drives the macro target, the goal projection, the meal
    // plan's seed and the coach's console.
    const weightStored = await cd.saveWeightNow(kg);
    // `sendCheckIn` says which of three things happened, and they need three
    // different sentences. The result used to be thrown away entirely, so "your
    // coach can see this week's check-in" was printed whether or not anybody
    // could — the entire reason a person fills this in, and a client who
    // believes their coach has their numbers does not send them again.
    //
    // The middle case is new. This form used to be lost outright when the gym
    // had no reception, and the alert said so honestly: "energy, sleep, mood,
    // adherence and your note is not saved anywhere". The provider keeps it
    // now, so what has to be said is narrower and harder — the work is safe,
    // the coach still has not seen it, and nothing here may blur those two.
    const out = await ci.sendCheckIn({ weightKg: kg, energy, sleep, mood, adherence, note: note.trim() });
    if (out === 'unsent') {
      Alert.alert(
        'Saved on this phone',
        'No connection, so your coach has not seen this yet — nothing is lost. The whole check-in, including your note, is saved here and goes up on its own the next time the app has signal.'
        + (weightStored ? '' : ' Your profile weight, which your targets are worked out from, is not in that queue — record it on Body once you have signal.'),
        [{ text: 'Done', onPress: () => router.back() }],
      );
      return;
    }
    if (out === 'refused') {
      Alert.alert(
        'Not saved',
        'Your check-in was rejected, so it is not stored and your coach has not seen it. Sending it again as it is will be rejected again — check for an update, or tell your coach directly.',
        [{ text: 'OK' }],
      );
      return;
    }
    Alert.alert(
      'Check-in sent',
      weightStored
        ? 'Your coach can see this week\'s check-in and your weight has been updated.'
        : 'Your coach can see this week\'s check-in, including the weight on it. Your profile weight — the one your targets and your goal are worked out from — could not be updated just now, so record it again on Body when you have signal.',
      [{ text: 'Done', onPress: () => router.back() }],
    );
  };

  const field = {
    ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline,
    borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginTop: sp.md,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>
        {/* The board's header: a back chevron and the title centred over the
            form. Said "Daily" over a title reading "Weekly Check-in", above a
            line calling it a weekly pulse — one of the three had to move and
            it was the kicker: the screen sends one check-in, the coach reads
            it weekly, and nothing here is daily. The board draws no kicker at
            all, so none is. */}
        <PageHead title="Weekly Check-in" />

        {/* ── the board's four, in the board's order ──────────────────────── */}
        <View style={{ marginTop: sp.xxl }}>
          <Faces t={t} label="How Are You Feeling?" value={mood} onChange={setMood} />
          <Slider t={t} label="Energy Level" value={energy} onChange={setEnergy} />
          <Slider t={t} label="Sleep Quality" value={sleep} onChange={setSleep} />
          <View style={{ marginBottom: sp.xl }}>
            <FieldLabel t={t} label="Notes" />
            <TextInput value={note} onChangeText={setNote} placeholder="Add a note…" placeholderTextColor={t.ink3} multiline accessibilityLabel="Note for your coach"
              style={{ ...field, minHeight: 72, textAlignVertical: 'top' }} />
          </View>

          {/* ── and the two the coach has always been sent ──────────────────
              Below the board's four and in the same idiom. Adherence is the
              fourth score the coach's console and the weekly report read;
              weight is what the macro target and the goal are worked out
              from. Neither can be dropped to match a picture. */}
          <Slider t={t} label="Plan Adherence" value={adherence} onChange={setAdherence} />
          <View style={{ marginBottom: sp.xl }}>
            <FieldLabel t={t} label="Current Weight" note={wu} />
            <TextInput value={weight} onChangeText={setTyped} keyboardType="decimal-pad" placeholder={wu} placeholderTextColor={t.ink3}
              accessibilityLabel={wu === 'kg' ? 'Current weight in kilograms' : 'Current weight in pounds'}
              style={{ ...field, ...numeric }} />
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{weightNote}</Text> : null}
          </View>
        </View>

        {/* Guarded, and the label says why. `submit` awaits two network
            writes before it says anything, and on a gym's wifi that window is
            now as long as the transport ceiling in src/lib/requestTimeout.ts —
            thirty seconds of a button that looks exactly as it did before it
            was pressed. `sendCheckIn` mints a fresh id per call, so a member
            who taps again in that window puts two check-ins in their coach's
            inbox for one week and gets two "Check-in sent" alerts. A `busy`
            useState alone would not have stopped it: the handler reads the flag
            out of the closure it was made in, and two taps in one frame both
            see false. See src/lib/submitOnce.ts. */}
        <Cta label={send.busy ? 'Sending…' : 'Submit Check-in'} disabled={send.busy}
          onPress={() => send.run(submit)} wide />

        {/* Waiting to go up. Said here rather than only in the alert that
            followed the tap, because the alert is gone by the next time this
            screen is opened and the client's question then is "did that
            send?". `unsentNote` is the one wording for it — see the note on it
            in src/lib/offlineQueue.ts about not letting "saved" read as
            "delivered". */}
        {unsentNote(ci.unsent, 'check-in', 'check-ins') ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Waiting to Send" />
              <Text style={{ ...ty.label, color: t.ink3 }}>{unsentNote(ci.unsent, 'check-in', 'check-ins')}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>Your coach cannot see it until then.</Text>
            </Section>
          </View>
        ) : null}

        {ci.latest ? (
          <View>
            <Rule />
            <Section>
              {/* Which copy this is. A pending check-in is real and is the
                  client's own, but their coach has not read it — and under
                  'error' even a stored-looking one came off this phone and
                  could not be checked, which is what src/ui/loadStatus.ts
                  means by an unconfirmed non-empty answer. */}
              <SectionHead
                title="Last Check-in"
                note={isPending(ci.latest.id) ? 'not sent yet' : ci.status === 'error' ? 'not checked' : fmtFullDay(ci.latest.at)}
              />
              {/* The stored kilograms read back in the client's unit. The two
                  ratings beside it are scores out of five and are not a
                  measurement of anything physical, so they are printed as they
                  are recorded. */}
              <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{fig(weightLabel(ci.latest.weightKg, wu))} · Energy {ci.latest.energy}/5 · Sleep {ci.latest.sleep}/5</Text>
              {ci.latest.note ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, fontStyle: 'italic' }}>“{ci.latest.note}”</Text> : null}
            </Section>
          </View>
        ) : null}

        {/* ── the weeks before this one ────────────────────────────────────
            Four ratings, filed weekly, read back by the provider since it was
            written and rendered by nothing. `latest` answered "what did I say
            last week"; a member wants to know whether it is going up.

            Drawn ONLY from real scores. The scale is 1–5 and a week that
            recorded nothing arrives here as the number 0 — `rowToCI` in
            src/ui/checkins.tsx coerces with `Number(x) || 0` — so
            `checkinTrend` turns everything outside the scale into a null and
            `Spark` breaks the line across it. A 0 plotted on a 1–5 axis is the
            worst week of somebody's year, invented.

            No average anywhere, under any status. A mean over four weeks of a
            five-point scale is a figure that reads as a measurement and is a
            summary of four taps; and under 'partial' it would be computed from
            an unknown fraction of the set, which src/ui/loadStatus.ts rules out
            outright. */}
        <View>
          <Rule />
          <Section>
            <SectionHead title="How the Weeks Have Gone"
              note={trend.charted == null ? undefined : `${trend.charted}`} />
            <Text style={{ ...ty.caption, color: t.ink3 }}>{trendLine(ci.status, trend)}</Text>
            {trend.state === 'some' ? trend.series.map((s) => {
              const note = seriesNote(s, trend.labels.length);
              return (
                <View key={s.key} style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, marginBottom: sp.xs }}>{s.label}</Text>
                  {/* `Spark` draws nothing under two readable points, which is
                      correct — a line needs two — and `seriesNote` is what says
                      so where that happens, rather than leaving a heading over
                      empty space. */}
                  <Spark data={s.values} labels={trend.labels} unit="/5" />
                  {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{note}</Text> : null}
                </View>
              );
            }) : null}
            {/* The oldest end is what the row cap eats, so a truncated read is
                short of exactly the weeks a member scrolls back for. */}
            {ci.status === 'partial' ? (
              <View style={{ marginTop: sp.md }}>
                <PartialRead what="check-ins" shown={trend.labels.length} onPress={ci.reload} />
              </View>
            ) : null}
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
