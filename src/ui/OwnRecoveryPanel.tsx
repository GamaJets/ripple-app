// Somebody's own recovery: the readiness score taken apart, today's water, and
// the nights they have logged.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(client)/recovery.tsx has had all of this since the client app was
// written, and the coach app had none of it: `useWellness`, `useHabits` and
// `useReadiness` had no importer anywhere under app/(trainer) before this. A
// coach could read a client's shared sleep and water on Body Composition and
// had nowhere at all to see or log their own.
//
// ── Built on the client hooks, because that is the rule ────────────────────
//
// Trainers self-track and there is no client→trainer promotion in this product,
// so this is the same three providers the client screen renders, unwrapped, not
// a coach-shaped copy of them. Each reads and writes the SIGNED-IN USER'S rows —
// `sleep_logs.user_id = auth.uid()`, `hydration_logs.user_id = auth.uid()` —
// and both of those columns reference `profiles`, which every account has. So a
// coach logging a night here writes a row of their own and no migration was
// needed for it.
//
// `useReadiness` is called rather than re-derived for the reason its own file
// gives: a second derivation of one number is how this app has repeatedly come
// to state two of them.
//
// ── The one thing a coach account genuinely cannot do ──────────────────────
//
// A daily water GOAL lives on `clients.water_goal_glasses`, and
// `provision_profile()` gives a role='trainer' signup a `trainers` row and no
// `clients` row — confirmed in the header of app/(trainer)/my-progress.tsx
// against the live database. So a coach's goal is permanently null, the ring
// has nothing to fill against, and the client app's own sentence for that case
// points at a screen in a portal a coach cannot open. `noGoalNote` is therefore
// a prop: only the mounting screen knows where — or whether — a goal can be
// set, and inventing a route here would be a dead end dressed as an offer. The
// COUNT is unaffected and is still worth showing; what is absent is the thing
// to measure it against.
import { useState } from 'react';
import { View, Text, Pressable, TextInput, Alert } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, KpiRow, Cta, Ghost, Flag, fig } from './kit';
import { sp, radius, hairline, type as ty, numeric } from '../theme/scale';
import { END_ALIGN } from './direction';
import { useReadiness } from './readiness';
import { useHabits } from './habits';
import { useWellness, sleepRefusal } from './wellness';
import { useClientData } from './clientData';
import { isWhole } from './loadStatus';
import { readinessMadeOf } from '../lib/readiness';
import { hydrationNote } from '../lib/hydrationHero';
import { readNumber } from '../lib/units';
import { num, num1 } from '../lib/format';
import { appLocale } from '../lib/locale';

/** How many logged nights the list shows. Beyond this it is a sleep history
 *  rather than the last few nights, which is what a recovery panel is for. */
const NIGHTS = 4;

/** Sleep quality 1–5 as marks, not as a glyph the font may not carry. The
 *  client screen once drew a star that is no longer in the source, so
 *  `''.repeat(quality)` painted an empty string and the picker was invisible
 *  and untappable. */
function Quality({ n, of = 5, color, dim }: { n: number; of?: number; color: string; dim: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {Array.from({ length: of }).map((_, i) => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i < n ? color : dim }} />
      ))}
    </View>
  );
}

export function OwnRecoveryPanel({ noGoalNote }: {
  /** What to say when there is no daily water goal to fill against. The
   *  mounting screen owns this sentence because it owns whether there is
   *  anywhere to go and set one — see the header. */
  noGoalNote: string;
}) {
  const t = useTheme();
  const rv = useReadiness();
  const {
    water: cups, waterGoal: goalCups, waterStatus,
    addWater, removeWater, reload: reloadHabits,
  } = useHabits();
  const {
    sleep, addSleep, removeSleep, status: sleepStatus,
    unsent: unsentNights, reload: reloadSleep,
  } = useWellness();
  // Only for the GOAL's read status — `hydrationNote` has to tell "no goal set"
  // apart from "the goal could not be read", and those are opposite sentences.
  const cd = useClientData();

  const [hrs, setHrs] = useState('');
  const [q, setQ] = useState(0);

  const hydration = hydrationNote(waterStatus, cd.profileStatus, cups, goalCups);
  const sleepWhole = isWhole(sleepStatus);
  // Over the nights in hand, and only when they are ALL of them. An average
  // over a truncated read is a subtotal wearing an average's name.
  const avgSleep = sleepWhole && sleep.length
    ? num1(sleep.reduce((a, s) => a + s.hours, 0) / sleep.length)
    : null;

  const nightLabel = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? d.toLocaleDateString(appLocale(), { weekday: 'short', month: 'short', day: 'numeric' })
      : iso;
  };

  const logNight = () => {
    const h = readNumber(hrs) ?? 0;
    const why = sleepRefusal(h, q);
    if (why) { Alert.alert('That night was not logged', why); return; }
    void (async () => {
      const out = await addSleep(h, q);
      if (out === 'refused') {
        // The provider refused it after the check above passed, which the two
        // agreeing about the range makes very unlikely — and "unlikely" is not
        // "cannot", and somebody whose night vanished is owed the sentence.
        Alert.alert('That night was not logged',
          sleepRefusal(h, q) ?? 'That night could not be stored, so nothing has been logged.');
        return;
      }
      // Cleared only on the two outcomes that KEPT the night. Emptying the
      // boxes is the universal sign that a figure was accepted, and doing it
      // over a refusal says the opposite of what happened.
      setHrs(''); setQ(0);
      if (out === 'unsent') {
        Alert.alert('Saved on This Phone',
          'That night has not reached your account yet. There is no connection right now. Nothing is lost: it is on this phone and goes up on its own the next time you have signal.');
      }
    })();
  };

  const removeNight = (id: string, hours: number, at: string) => {
    Alert.alert('Remove This Night?',
      `${num1(hours)} hours on ${nightLabel(at)} would come out of your own sleep log, and out of your average and your readiness score with it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          void (async () => {
            // Believed only when the row is gone. A delete that resolves false
            // leaves the night on screen, which is honest — letting it vanish
            // and reappear at the next read is what makes people stop believing
            // a remove button.
            if (!(await removeSleep(id))) {
              Alert.alert('Not Removed',
                'That night is still in your log. We could not reach the server to take it out.');
            }
          })();
        } },
      ]);
  };

  const inp = {
    ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2,
    borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10,
    width: 78, textAlign: 'center',
  } as const;

  return (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
        Your own recovery, under your own account. No client sees any of this, and nothing here is
        about a client of yours.
      </Text>

      {/* ── readiness, taken apart ────────────────────────────────────────
          The score is not recomputed here: it comes from the same
          `useReadiness()` the rest of the app renders. The ROWS are the point —
          a signal that was scored says with what figure, a signal that is
          missing says which kind of missing it is, and the two kinds are never
          collapsed. "You have not set a water goal" and "today's count could
          not be read" arrive at the same null inside `readinessScore` and mean
          opposite things to the person reading it. */}
      <Section>
        <SectionHead title="Readiness" note={rv.readiness != null ? rv.readiness.label : undefined} />
        <KpiRow items={[
          { label: 'Score', value: rv.readiness != null ? fig(rv.readiness.score) : fig(null), unit: rv.readiness != null ? 'of 100' : undefined },
        ]} />
        {/* The tip and what the tip was computed from, together. A tip standing
            on its own is advice with no stated basis, which is the thing nobody
            can argue with and therefore cannot trust. */}
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
          {rv.readiness != null
            ? `${rv.readiness.tip} ${readinessMadeOf(rv.readiness)}.`
            : rv.breakdown.absence}
        </Text>
        {rv.breakdown.lines.map((l) => (
          // "Sleep" and "7h 30m a night over 2 of the last 3 nights" are ONE
          // fact and would otherwise be two stops with a swipe between them.
          <View key={l.key} accessible accessibilityLabel={`${l.title}. ${l.detail}`}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.sm, marginTop: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
            <Text style={{ ...ty.caption, color: t.ink2 }}>{l.title}</Text>
            <Text style={{ ...ty.caption, color: l.state === 'scored' ? t.ink2 : t.ink3, flex: 1, textAlign: END_ALIGN }}>
              {l.detail}
            </Text>
          </View>
        ))}
        {/* Named devices, not "a device": the fix for a watch that stopped
            answering is on Watch & Devices under that device's own name. */}
        {rv.breakdown.caveats.map((c) => (
          <Flag key={c} tone={t.warn} style={{ marginTop: sp.md }}>{c}</Flag>
        ))}
      </Section>

      <Rule />

      {/* ── today's water ─────────────────────────────────────────────── */}
      <Section>
        <SectionHead title="Hydration" />
        <KpiRow items={[
          {
            label: 'Today',
            value: hydration.showCount ? fig(cups) : fig(null),
            unit: hydration.showRing && goalCups != null
              ? `of ${num(goalCups)} glasses`
              : cups === 1 && hydration.showCount ? 'glass' : 'glasses',
          },
        ]} />
        {/* The caveat LEADS the count rather than following it. "Goal met
            today" drawn from a count the note underneath admits may be missing
            glasses logged elsewhere is a congratulation arriving before its own
            qualification. `kind === 'noGoal'` takes the mounting screen's
            sentence, because the library's version offers a route that does not
            exist in every portal. */}
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
          {hydration.kind === 'noGoal' ? noGoalNote : hydration.text}
        </Text>
        {/* Dead until the count has arrived, and that is not caution: `addWater`
            upserts an ABSOLUTE count for the day computed from a base that is 0
            until the read lands, so a tap made too early writes 1 over the five
            glasses logged on another handset this morning. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
          <Ghost icon="minus" a11yLabel="Take a glass off today's count"
            onPress={removeWater} disabled={!hydration.showCount} />
          <View style={{ flex: 1 }}>
            <Cta wide label={hydration.showCount ? 'Add a Glass' : 'Reading Today’s Glasses…'}
              disabled={!hydration.showCount} onPress={addWater} />
          </View>
        </View>
        {waterStatus === 'error' ? (
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Try Again" onPress={reloadHabits} />
          </View>
        ) : null}
      </Section>

      <Rule />

      {/* ── the nights ────────────────────────────────────────────────── */}
      <Section>
        <SectionHead title="Sleep"
          note={sleepWhole && avgSleep != null ? `${avgSleep} h average`
            : sleepStatus === 'error' ? 'not confirmed'
              : sleepStatus === 'partial' ? 'more nights than are shown' : undefined} />
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
          Nights you type in. A night a watch or a ring recorded is read separately and is never
          averaged into these. A figure somebody remembered in the morning and a figure a device
          measured are not the same kind of fact, and blending them would make both unfalsifiable.
        </Text>
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
          {/* Hours slept is a fraction — 7.5 is the commonest answer there is —
              so this is a decimal pad, and `readNumber` takes the decimal COMMA
              a European keyboard puts on it. `parseFloat('7,5')` is 7, and half
              an hour a night is the whole of what is being asked. */}
          <TextInput value={hrs} onChangeText={setHrs} keyboardType="decimal-pad"
            accessibilityLabel="Hours you slept" style={inp} />
          <Text style={{ ...ty.caption, color: t.ink3 }}>hrs · quality</Text>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setQ(n)} hitSlop={8} accessibilityRole="button"
              accessibilityState={{ selected: n === q }}
              accessibilityLabel={`Sleep quality ${n} of 5`}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: n <= q ? t.brand : t.surface3 }} />
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: sp.md }}>
          {/* Nothing pre-filled. A box that opens at 7.5 hours and quality 4 is
              a night nobody had, one tap from the record. */}
          <Cta label="Log Sleep" wide disabled={!((readNumber(hrs) ?? 0) > 0) || q < 1}
            onPress={logNight} />
        </View>

        {/* An empty list is three different sentences and it used to be one.
            "No nights logged yet" is a claim about somebody's own history, and
            under a failed read it is a claim nobody can make — the nights may be
            sitting on the server, unread, and the cost of getting it wrong is
            that they re-type a night they already logged. */}
        {sleep.length === 0 ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
            {sleepStatus === 'error'
              ? 'Your sleep log could not be read just now, so this is blank rather than empty. Any nights you have already logged are not shown here.'
              : sleepStatus === 'loading'
                ? 'Reading your sleep log…'
                : 'No nights of your own logged yet. Log one above and your average appears here.'}
          </Text>
        ) : null}
        {sleepStatus === 'error' ? (
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Try Again" onPress={reloadSleep} />
          </View>
        ) : null}
        {/* A night logged with no signal. It is on screen, it is on this phone,
            and it goes up on its own. */}
        {unsentNights > 0 ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
            {unsentNights === 1
              ? 'One night is saved on this phone only'
              : `${num(unsentNights)} nights are saved on this phone only`}
            {'. '}They go up the next time you are online. Nothing to re-enter.
          </Text>
        ) : null}
        {sleep.slice(0, NIGHTS).map((sx) => (
          <View key={sx.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.sm, marginTop: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>{nightLabel(sx.at)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink2 }}>{num1(sx.hours)} h</Text>
              <Quality n={sx.quality} color={t.brand} dim={t.surface3} />
              {/* A visible control, not a gesture: a way out that nothing
                  announces is not a way out. The label names the night, so four
                  of these do not all say the same thing. */}
              <Ghost icon="minus"
                a11yLabel={`Remove the ${num1(sx.hours)} hour night of ${nightLabel(sx.at)} from your own sleep log`}
                onPress={() => removeNight(sx.id, sx.hours, sx.at)} />
            </View>
          </View>
        ))}
      </Section>
    </View>
  );
}
