// Client · Daily Habits & Water (Phase 7). Check off habits and log water; the
// water goal auto-completes the water habit. Reachable from the profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, handler and accessibility role is preserved — the three
// bordered blocks became one hero figure and two hairline-separated sections.
//
// ── Against the board (client page 10, "Habit Tracking") ────────────────────
//
// The board opens with a centred "Daily Habits" title, then ONE card headed
// "Daily Habits" with a round green check at its trailing edge, then a row per
// habit: a round icon, the habit's name, and a FIGURE on the right — "0/8",
// "8,483/10,000", "7.5/10". The hero percentage that led this screen is gone
// (the card's head carries the day's count instead), and the figure beside
// each row is a real read and never a sample:
//
//   · water  — today's glasses off the habits store, over the goal;
//   · steps  — today's count off the connected watch (`useWearables().today`),
//              over the step goal;
//   · sleep  — last night off the connected devices (`useDeviceSleep`), or a
//              night the member typed on Recovery this morning, over the goal;
//   · everything else — the tick itself, 0/1 or 1/1.
//
// Every one of those has a way of NOT being known, and each of those draws
// `fig(null)` and says why underneath. A dash on the steps row of somebody
// with no watch is the truth; "0/10,000" is the app telling them they have not
// moved today. The board's "8,483/10,000" is a member with a watch on.
//
// The water glasses, the +/− controls and the three goal boxes are still here,
// under the card, because the card's water row is a tick and a figure and not
// a place to log a glass.
//
// ── TF-31 ───────────────────────────────────────────────────────────────────
//
// The checklist is derived now (src/lib/checklist.ts), so it varies in length
// and can legitimately be empty. Two things on this screen assumed it could not
// be:
//
//   · `Math.round((doneCount / habits.length) * 100)` divided by zero and put
//     the result straight into the one big number on the screen: "NaN%", over
//     an arc drawn from NaN. donePercent returns null instead and the Hero
//     shows a dash, which is what `fig` is for.
//   · "0 of 0 habits done" over an empty list read as a day with nothing asked
//     of you. Under `status === 'error'` that is exactly the lie the provider's
//     header is about, so the empty state and the notice below say which of the
//     two it is before the client draws a conclusion about their own day.
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { Icon, type IconName } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, PageHead, Flag, Notice, Field, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useHabits } from '../../src/ui/habits';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { unsentNote } from '../../src/lib/offlineQueue';
import { hydrationNote } from '../../src/lib/hydrationHero';
import { donePercent } from '../../src/lib/checklist';
import { streakFor, habitStreakFigure, habitStreakNote, habitStreakCaveat } from '../../src/lib/habitStreaks';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { isWhole } from '../../src/ui/loadStatus';
import { readNumber, plain } from '../../src/lib/units';
import { num } from '../../src/lib/format';
import { hitSlopFor } from '../../src/lib/a11y';
import { END_ALIGN } from '../../src/ui/direction';
import { useScrollPad } from '../../src/ui/keyboardPad';
// The three figures the board draws beside a row that this store cannot
// supply on its own. Steps come off the watch; last night off the devices
// that record sleep, or off the night the member typed on Recovery. Same
// hooks, same gating, as app/(client)/recovery.tsx — one arithmetic over the
// same nights, so this row and that screen cannot disagree about a morning.
import { useWearables } from '../../src/ui/wearables';
import { useDeviceSleep } from '../../src/ui/deviceSleep';
import { useWellness } from '../../src/ui/wellness';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import { connectedProviders } from '../../src/lib/wearables/sleep';
import type { ProviderId } from '../../src/lib/wearables/types';
import { markNightsUnread } from '../../src/lib/sleepMerge';
import { useToday } from '../../src/ui/today';
import { dateParts } from '../../src/lib/localDate';

// The same bounds clients_step_goal_check, clients_sleep_goal_hours_check
// (supabase/parts/60) and clients_water_goal_glasses_check (part 70) enforce.
// Checked here as well, and not as belt and braces: the profile write is one
// UPDATE carrying every field on it, so a value the constraint refuses takes
// the client's name, goal, diet and allergens down with it — silently, in a
// debounced effect nobody is watching. That is exactly how the 'solo' coaching
// mode ate whole profile saves.
const STEP_MIN = 500, STEP_MAX = 100000;
const SLEEP_MIN = 3, SLEEP_MAX = 14;
const WATER_MIN = 1, WATER_MAX = 30;

// The board draws every row's icon as a glyph in a circle. The derived rows
// have a kit icon each; a coach's own row keeps the emoji the coach chose,
// because that is the one thing about the row that is theirs.
const ROW_ICON: Record<string, IconName> = {
  train: 'dumbbell', kcal: 'flame', protein: 'meals', water: 'water', steps: 'trending', sleep: 'moon',
};

/** What the trailing figure on a row is, and — when it is a dash — why. */
interface RowFigure {
  text: string;
  /** The sentence under the name. Where the figure is a dash this is the
   *  reason; where it is real this names the device it came from. Null when
   *  there is nothing worth a line. */
  note: string | null;
}

export default function Habits() {
  const t = useTheme();
  const scrollPad = useScrollPad(180);
  const router = useRouter();
  const h = useHabits();
  // The checklist's training row names today's session, and that name comes
  // off the assigned block — which `getProgram` will serve from this device
  // for thirty days when the server cannot be reached. src/ui/habits.tsx
  // cannot render this itself: its only return is a Provider wrapping the
  // tree, so a Flag there would draw above the whole app or nowhere. The
  // sentence has to sit beside the row it qualifies, which is here.
  const { cachedNote } = useAssignedPrograms();
  // null when there is nothing on the list. Not 0 — nought per cent is a claim
  // that the client did none of the things asked of them today.
  const pct = donePercent(h.doneCount, h.habits.length);
  const unknown = h.status === 'error';
  // `unknown` was only consulted inside the `pct == null` branch, so it only
  // ever spoke when the LIST was empty. `h.status` is the worst of several
  // reads and the TICKS are one of them — a failed tick read leaves the list
  // intact and every box unticked, so the screen printed a filled arc, a
  // percentage and "3 of 4 done" over a day nobody could read. Which is the
  // exact thing the notice further down apologises for in advance: "an empty
  // circle here doesn't mean you skipped it".
  //
  // The figure follows the same rule as everywhere else: it is shown when the
  // read behind it is whole, and withheld otherwise.
  const doneKnown = isWhole(h.status);
  const c = useClientData();
  // The water half of this screen, through the module that already owns the
  // four states it has — loading, count unread, goal unread, and a real
  // figure. app/(client)/recovery.tsx has used it since it was written; this
  // screen, which that one links to, printed the loading zero as fact.
  const hydration = hydrationNote(h.waterStatus, c.profileStatus, h.water, h.waterGoal);
  // The count may be shown, and therefore counted from and written to.
  const waterCounted = hydration.showCount;

  // ── the watch, for the steps row ─────────────────────────────────────────
  //
  // `states` is empty until the provider has looked, and an empty map is not
  // the claim "no watch is connected" — src/ui/wearables.tsx told a client with
  // a live WHOOP token exactly that, for exactly this reason. The home screen
  // draws the same two lines for the same reason.
  const wear = useWearables();
  const wearableKnown = Object.keys(wear.states).length > 0;
  const wearableConnected = Object.values(wear.states).some((v) => v === 'connected');
  // `todayFrom`, not "the first connected provider that publishes this field":
  // app/(client)/devices.tsx :701 records the Apple Watch being credited with
  // WHOOP's number that way.
  const stepsDevice = (() => {
    const id = wear.todayFrom.steps;
    return (id ? PROVIDERS.find((p) => p.meta.id === id)?.meta.name : null) ?? 'your device';
  })();

  // ── last night, for the sleep row ────────────────────────────────────────
  //
  // The merge lives in DeviceSleepProvider and is not redone here — see the
  // long note in app/(client)/recovery.tsx on why re-merging on a second
  // screen put two screens on separate arithmetic over the same nights. The
  // one thing decided here is the same one Recovery decides: a WALK that
  // failed reports 'error' with an empty `reads`, and an empty `reads` carries
  // no failures, so every night in the window would read 'no-record'. That is
  // a read that never completed printed as a fact about how the member slept;
  // `markNightsUnread` turns those nights back into 'unknown'.
  const deviceSleep = useDeviceSleep();
  const deviceProviderIds = connectedProviders(wear.states).map((p: { meta: { id: string } }) => p.meta.id as ProviderId);
  const deviceNights = deviceSleep.status === 'error'
    ? markNightsUnread(deviceSleep.nights, deviceProviderIds)
    : deviceSleep.nights;
  const lastNight = deviceNights[0] ?? null;
  // A night the member typed on Recovery this morning stands in when no device
  // measured it. "This morning" is the member's own day, through `dateParts`,
  // because `sleep_logs.at` is a timestamp and a bare comparison of its date
  // slice would file a 23:30 entry under tomorrow for anyone east of Greenwich.
  const wellness = useWellness();
  const today = useToday();
  const todayParts = dateParts(today);
  const typedNight = isWhole(wellness.status) && todayParts
    ? wellness.sleep.find((e) => {
      const p = dateParts(e.at);
      return !!p && p[0] === todayParts[0] && p[1] === todayParts[1] && p[2] === todayParts[2];
    }) ?? null
    : null;

  // The ticks and the water count come from the habits provider; the targets
  // they are measured against are on the profile. Both are server reads. The
  // watch and the devices are the other two reads on this screen now, and the
  // gesture asks for them too — a pull that refreshed the ticks and left the
  // step count where it was would make the count look confirmed.
  const pull = usePullToRefresh(useCallback(() => {
    h.reload(); c.reload(); void wear.syncAll(); deviceSleep.refresh(); wellness.reload();
  }, [h.reload, c.reload, wear, deviceSleep, wellness]));
  // The three targets below live on `clients` and are read once, with no local
  // copy under USE_SUPABASE. A null one therefore has two meanings — "you have
  // not set this" and "the row that holds it could not be read" — and this
  // screen stated the first in both cases, on a screen whose whole purpose is
  // to show a member the goals they set. `hint` is what each field says under
  // its own box, so it is where the difference belongs.
  const goalsRead = c.profileStatus === 'ready' || c.profileStatus === 'partial';
  const unsetHint = c.profileStatus === 'loading' ? 'reading' : goalsRead ? 'not set' : 'not read';
  // ── the member's own runs ────────────────────────────────────────────────
  //
  // Null is not an empty list. `h.streaks` is null when the history was not
  // read at all — signed out, no backend, or a refused read — and `[]` under a
  // 'ready' status is a window that genuinely holds no tick. The first must not
  // be drawn as "no runs going", which is the claim src/ui/habits.tsx's header
  // is entirely about.
  const runs = h.streaks;
  const runsRead = runs !== null;
  // Deliberately NOT `h.status`. The history is truncated by a member having
  // used the app for a long time, and today's checklist beside it is complete
  // — see the note on `historyStatus` in src/ui/habits.tsx. Rolling them
  // together would put "some of today's list is missing" over a whole list for
  // every member with a long record.
  //
  // 'partial' is not hidden and is not counted either. Every run carries its
  // own `bounded`, so a run that reaches the bottom of a truncated read prints
  // as "12 days or more" rather than as a smaller number stated as a fact.
  const historyPartial = h.historyStatus === 'partial';
  const historyUnread = h.historyStatus === 'error';
  const [stepDraft, setStepDraft] = useState('');
  const [sleepDraft, setSleepDraft] = useState('');
  const [waterDraft, setWaterDraft] = useState('');

  /**
   * The figure on the right of a row, as the board draws it.
   *
   * Three rows have a count of their own to show against the goal; the rest
   * are a tick, and a tick is "1/1" or "0/1". None of the three may print a
   * zero it was not told: a watch that has not answered, a night no device
   * measured and a glass count still loading are all a dash with the reason
   * under the name, which is the same rule `fig` and the hero it replaced
   * followed.
   */
  function rowFigure(id: string, done: boolean): RowFigure {
    if (id === 'water') {
      if (!waterCounted || h.waterGoal == null) return { text: fig(null), note: hydration.text };
      return { text: `${num(h.water)}/${num(h.waterGoal)}`, note: null };
    }
    if (id === 'steps') {
      if (c.stepGoal == null) return { text: fig(null), note: null };
      if (wearableKnown && !wearableConnected) {
        return { text: fig(null), note: 'Connect a watch under Me to count these here. Tick it yourself if you got there.' };
      }
      if (!isWhole(wear.todayStatus)) {
        return {
          text: fig(null),
          note: wear.todayStatus === 'loading' || !wearableKnown
            ? 'Reading today’s steps from your device…'
            : 'Your device could not be read just now, so today’s count is not shown. That is not a count of nought.',
        };
      }
      // numbers-ok: stepsDevice is the device's name, not a count.
      if (wear.today.steps == null) return { text: fig(null), note: `Your ${stepsDevice} has no step count for today yet.` };
      return { text: `${num(wear.today.steps)}/${num(c.stepGoal)}`, note: `Today, from your ${stepsDevice}` };
    }
    if (id === 'sleep') {
      if (c.sleepGoalHours == null) return { text: fig(null), note: null };
      const goal = plain(c.sleepGoalHours, 1);
      if (lastNight?.outcome === 'measured' && lastNight.minutesAsleep != null) {
        // One decimal, the way the goal box spells it — "7.5/8", with the
        // reader's own decimal separator. `formatSleepHours` writes "7h 12m",
        // which does not sit over a slash.
        const src = lastNight.source;
        return {
          text: `${plain(lastNight.minutesAsleep / 60, 1)}/${goal}`,
          note: src
            ? `Last night, from your ${src.sourceName}${src.basis === 'in-bed' ? ' — time in bed' : ''}${lastNight.kept ? ', as read earlier' : ''}`
            : 'Last night, from your device',
        };
      }
      if (typedNight) return { text: `${plain(typedNight.hours, 1)}/${goal}`, note: 'Last night, as you logged it on Recovery' };
      if (deviceSleep.status === 'loading' || wellness.status === 'loading') {
        return { text: fig(null), note: 'Reading last night…' };
      }
      if (lastNight?.outcome === 'unknown') {
        return { text: fig(null), note: 'Your devices could not be read for last night, so it is unknown — that is not the same as no sleep.' };
      }
      if (deviceProviderIds.length === 0) {
        return { text: fig(null), note: 'No device records your sleep. Log last night on Recovery and it shows here.' };
      }
      return { text: fig(null), note: 'No device recorded last night. Log it on Recovery if you know it.' };
    }
    return { text: doneKnown ? (done ? '1/1' : '0/1') : fig(null), note: null };
  }

  // The card's trailing mark: the board's round green check. It is drawn
  // filled only when EVERYTHING on the list is ticked and the read behind the
  // list is whole; otherwise the day's count stands in its place, and a day
  // that could not be read shows the dash rather than a hollow circle that
  // would read as "nothing done".
  const allDone = doneKnown && h.habits.length > 0 && h.doneCount === h.habits.length;
  const headCount = doneKnown && h.habits.length > 0 ? `${h.doneCount}/${h.habits.length}` : fig(null);
  const headSpoken = allDone
    ? 'All of today’s list done'
    : doneKnown
      ? (pct == null ? 'Nothing on today’s list yet' : `${h.doneCount} of ${h.habits.length} done`)
      : (unknown ? 'We could not read today’s list or what you have ticked off it' : h.status === 'loading' ? 'Reading today’s list…' : 'Not all of today’s list could be read');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          220 rather than 40 because the water goal is the last field on the screen. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────
            The board centres the title between the back chevron and an
            empty trailing slot; PageHead keeps it on the screen's centre
            line rather than the row's. */}
        <PageHead title="Daily Habits" />

        {/* ── the card: today's list, one row per habit ──────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
            <Text style={{ ...ty.head, color: t.ink, flexShrink: 1 }}>Daily Habits</Text>
            <View accessible accessibilityLabel={headSpoken}
              style={{ minWidth: 28, height: 28, borderRadius: radius.pill, paddingHorizontal: allDone ? 0 : sp.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: allDone ? t.brand : t.surface2 }}>
              {allDone
                ? <Icon name="check" size={15} color={t.brandInk} />
                : <Text style={{ ...ty.caption, ...numeric, fontWeight: '600', color: t.ink2 }}>{headCount}</Text>}
            </View>
          </View>

          {/* Which copy of the plan named today's session, and how old it is.
              Non-null only while the cache is what is being served —
              `mayServeCached` in src/ui/assignedPrograms.tsx sees to that — so
              this needs no gate of its own. Same sentence and same treatment as
              app/(client)/week.tsx and app/(client)/workouts.tsx. */}
          {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{cachedNote}</Flag> : null}

          {/* Ticks the server has not taken. The client did the thing and the
              tick is safe on this phone — what has not happened is the row in
              `habit_logs`, which is what src/lib/adherence.ts counts to tell
              their coach how often they keep a habit. Saying "saved" without
              saying "not sent" would let somebody read a green screen as a
              figure their coach can see. */}
          {unsentNote(h.unsent, 'tick') ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.warn} kicker="Checklist" title="Not sent yet"
                note={`${unsentNote(h.unsent, 'tick')} Until then your coach's records for today are short of them.`} />
            </View>
          ) : null}

          {/* A refused read leaves rows off the list. Naming that is the whole
              point of `status` — an unticked (or absent) habit under 'error'
              means unknown, and the coach's dashboard reads the same rows. */}
          {/* 'partial' is the same harm by a different route and had no arm
              anywhere on this screen: `useHabits` sets it when the ticks or the
              coach items exceed the row cap, so rows are genuinely missing from
              the list below and an empty circle is genuinely unknown. */}
          {unknown ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.warn} kicker="Checklist" title="Some of today’s list is missing"
                note="We couldn’t read your targets or your ticks just now, so anything below may be short a line — and an empty circle here doesn’t mean you skipped it." />
            </View>
          ) : h.status === 'partial' ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.warn} kicker="Checklist" title="Some of today’s list is missing"
                note="There is more on your record than we can read at once, so a line may be missing below and an empty circle here doesn’t mean you skipped it." />
            </View>
          ) : null}

          {/* Why the runs beside each line are missing, or qualified.
              Separate from the notice above, and that is the whole point of the
              split in src/ui/habits.tsx: one is about TODAY's list and the
              other is about the quarter behind it. They fail independently and
              a member reading "some of today's list is missing" because their
              record is long would be reading a false sentence.
              'partial' is said rather than hidden, and it is not counted: each
              run below carries its own floor and prints "or more". */}
          {historyUnread ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.warn} kicker="Your runs" title="We couldn’t read your history"
                note="The runs beside each line need your record from the last few weeks, and we could not fetch it just now. Nothing has been lost — we simply cannot count them from here." />
            </View>
          ) : historyPartial ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.warn} kicker="Your runs" title="Your record is longer than we can read at once"
                note={`We read back ${h.historyDays} days and there is more on your record than fits in one go. A run that reaches the bottom of what we read is shown as "or more" — it has not been cut short, we just cannot see where it started.`} />
            </View>
          ) : null}

          {/* `!unknown` let 'partial' through to a sentence that says the list
              is genuinely empty, which is exactly the claim a truncated read
              cannot support. The notice above now covers 'partial' and says so;
              this stays silent there rather than contradicting it. */}
          {h.habits.length === 0 && h.status === 'ready' && h.gaps.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
              Nothing on today’s list. Rest days and un-set targets both look like this — set a goal or ask your coach for one.
            </Text>
          ) : null}

          <View style={{ marginTop: sp.sm }}>
            {h.habits.map((hb, hi) => {
              // The run for THIS line, or null. Three different nulls meet here
              // and none of them is a zero:
              //   · the history was not read     → `runsRead` false;
              //   · it was read and holds no row for this habit — a line they
              //     have never ticked, or one whose ticks are all older than the
              //     window — → `streakFor` null;
              //   · it was read and this habit has no CURRENT run → `days: 0`,
              //     which is the one case with something to say.
              const run = runsRead ? streakFor(runs!, hb.id) : null;
              const runFig = run ? habitStreakFigure(run) : null;
              // A run of nought is not printed as "0 days". There is no run, and
              // a zero beside a habit reads as a score.
              const runText = runFig && run && run.days > 0 ? `${runFig.figure} ${runFig.unit}` : null;
              // The sentence under the line. Two cases earn one, and no others —
              // a note under every row is a note nobody reads:
              //   · the figure cannot stand on its own (silence in the run, or a
              //     run that reaches the bottom of what we read);
              //   · there is NO current run but the record knows when the habit
              //     was last kept. That is the half of their own history this
              //     screen could never show, and it is the half worth saying:
              //     "no run going just now, last ticked on the 2nd" rather than a
              //     blank, which reads as nothing ever happened.
              const caveat = run ? habitStreakCaveat(run) : null;
              const ended = !!run && run.days === 0 && run.lastTicked !== null;
              const runNote = run && (caveat || ended) ? habitStreakNote(run) : null;
              const figure = rowFigure(hb.id, hb.done);
              // The run moved under the name: the board spends the row's
              // trailing slot on the figure. It is still said, and still only
              // when there is one — a blank is honest where the history was not
              // read, and a "0" or a "—" both read as a figure about them.
              const runLine = runText ? `${runText} running` : null;
              const icon = ROW_ICON[hb.id];
              // The label on a Pressable REPLACES its children for a screen
              // reader, so anything drawn inside it that is not in here is silent.
              // The figure is the new thing on this row and it would have been
              // the one part a screen-reader user never heard.
              const a11y = [
                hb.label,
                figure.text === fig(null) ? 'not counted' : figure.text,
                figure.note,
                hb.source === 'coach' ? 'Set by your coach' : null,
                runText ? `Ticked ${runText} running` : null,
                runNote,
              ].filter(Boolean).join('. ');
              return (
              <View key={hb.id}>
                {hi > 0 ? <Rule /> : null}
                <Pressable
                  onPress={() => h.toggleHabit(hb.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: hb.done }}
                  // The attribution is a second line on the row, and a label on
                  // a Pressable replaces it. "Your coach asked for this" is the
                  // reason the line exists.
                  accessibilityLabel={a11y}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
                >
                  {/* The board's round icon plate. A ticked row fills it in the
                      accent and swaps the glyph for the check — the green check
                      state page 10 draws on its Meditate row — so done and not
                      done differ in fill, in glyph and in the figure's ink, and
                      none of the three is colour alone. */}
                  <View style={{ width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: hb.done ? t.brand : t.surface2 }}>
                    {hb.done
                      ? <Icon name="check" size={17} color={t.brandInk} />
                      : icon
                        ? <Icon name={icon} size={17} color={t.brand} />
                        : <Text style={{ ...ty.body, color: t.ink2 }}>{hb.icon}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: hb.done ? t.ink : t.ink2 }}>{hb.label}</Text>
                    {/* Only the coach-set rows are attributed. "From your targets"
                        under a line that already reads "Hit 152 g protein" is
                        noise; "your coach asked for this" is not. */}
                    {hb.source === 'coach' ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Set by your coach</Text>
                    ) : null}
                    {/* Where the figure came from, or why there is none. */}
                    {figure.note ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{figure.note}</Text>
                    ) : null}
                    {runLine ? (
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{runLine}</Text>
                    ) : null}
                    {/* Why the figure beside it is not a plain number. Only drawn
                        when there IS something to say — a clean run needs no
                        apology, and a sentence under every line would train the
                        member to stop reading them. */}
                    {runNote ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{runNote}</Text>
                    ) : null}
                  </View>
                  {/* The figure, as the board draws it: count over goal, in the
                      accent once the row is ticked. Wraps rather than truncates
                      — "8,483/10,000" at the largest text size is two lines and
                      still a figure. */}
                  <Text style={{ ...value(15), color: hb.done ? t.brand : t.ink, textAlign: END_ALIGN, flexShrink: 1 }}>{figure.text}</Text>
                </Pressable>
              </View>
              );
            })}

            {/* A target the app does not have is not a row. Where the client can
                go and supply it, the list says so instead of quietly shrinking. */}
            {h.gaps.map((g) => (
              <View key={g.id}>
                {h.habits.length > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 36, height: 36, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring, borderStyle: 'dashed' }} />
                  <Text style={{ flex: 1, ...ty.label, color: t.ink3 }}>{g.note}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* The list is built from this person's own plan and targets, which is
              the question TF-31 asked outright. Saying so costs one line and
              stops the next tester having to ask. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Built from your plan, your targets and anything your coach adds.
          </Text>
        </Section>


        {/* ── water ──────────────────────────────────────────────────────── */}
        <Section>
          {/* With no goal there is no "/ 8" to write and no eight empty glasses
              to draw: `Array.from({ length: null })` is a zero-length array, so
              the row silently vanished rather than saying anything. The count
              they have drunk is still true and still theirs, so it leads, and
              the row draws exactly the glasses they logged. */}
          {/* The count is withheld until it has arrived.
              `src/ui/habits.tsx` starts `water` at 0 under a 'loading' status,
              so the first frame of this screen stated "0 / 8 glasses" over
              eight empty glasses to a member who had drunk six. That is the
              defect src/lib/hydrationHero.ts was written about — for the hero
              on Recovery, which this screen is the destination of. The hero
              there says "Reading today's glasses…" and correctly shows no
              figure; the member taps through and lands here, where the same
              unread zero was printed as fact. One module, both screens. */}
          <SectionHead title="Water"
            note={!waterCounted ? undefined
              : h.waterGoal != null ? `${h.water} / ${h.waterGoal} glasses`
              : `${h.water} ${h.water === 1 ? 'glass' : 'glasses'}`} />
          {waterCounted ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: h.waterGoal == null ? sp.md : sp.lg }}>
              {Array.from({ length: h.waterGoal ?? h.water }).map((_, i) => (
                <View key={i} style={{ width: 24, height: 32, borderRadius: radius.sm, borderWidth: hairline, borderColor: i < h.water ? t.brand : t.ring, backgroundColor: i < h.water ? t.brand : 'transparent', opacity: i < h.water ? 0.9 : 1 }} />
              ))}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>{hydration.text}</Text>
          )}
          {/* `waterGoal` is `clients.water_goal_glasses` and nothing else, with
              no local copy under USE_SUPABASE — so a null one is "you have not
              set a goal" only when the row it lives on was actually read. Said
              flatly, it told a member with a goal on record that they had none,
              and pointed them at a box below that would have shown them their
              own number if the same read had worked. */}
          {h.waterGoal == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              {goalsRead
                ? 'No daily goal yet — set one under Your daily targets below and these glasses count towards it.'
                : c.profileStatus === 'loading'
                  ? 'Reading your daily goal…'
                  : 'Your daily goal could not be read, so there is nothing here to count these glasses towards. It has not been cleared — we just cannot see it right now.'}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
            {/* 38pt drawn, 44pt to the finger. The one control on this screen
                that takes something AWAY, sitting beside a full-width Add — so
                a near-miss on it is a glass the member logged and did not get
                credited, and the correction is another two taps. `hitSlopFor`
                grows only the boundary; the circle is a deliberate visual size
                against the Cta next to it. See MIN_TARGET in src/lib/a11y.ts. */}
            {/* Both controls are dead until the count has arrived, and that is
                not tidiness. `pushWater` upserts an ABSOLUTE count for the day,
                and `addWater` computes it from `waterRef.current` — which is 0
                until the read lands. A member who logged five glasses on
                another device this morning and taps once too early writes 1
                over their 5, server-side. src/ui/habits.tsx refuses the write
                as a backstop; these two say why rather than swallowing a tap. */}
            <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={h.removeWater}
              disabled={!waterCounted}
              accessibilityState={{ disabled: !waterCounted }}
              hitSlop={hitSlopFor(38)}
              style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', opacity: waterCounted ? 1 : 0.5 }}>
              <Icon name="minus" size={16} color={t.ink2} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Cta label={waterCounted ? 'Add a Glass' : 'Reading today’s glasses…'} disabled={!waterCounted} wide onPress={h.addWater} />
            </View>
          </View>
          {/* Which copy of the count these glasses are drawn from.
              Before part 109 the count lived in this device's storage and
              nowhere else, so it could not be wrong about the server — there
              was no server copy to be wrong about. Now there is, and the count
              still has to work with no signal (this is a gym), so the honest
              state is "counted here, unconfirmed" rather than either a reset to
              zero or a number presented as though it had been checked. */}
          {h.waterStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
              Counted on this phone. We couldn’t check it against your account just now, so if you have logged water on another device today this may not be the whole picture.
            </Text>
          ) : null}
        </Section>


        {/* ── your daily targets ──────────────────────────────────────────
            The three numbers the checklist used to invent. "10,000 steps",
            "Sleep 7h+" and "8 glasses" were compiled into the app, identical
            for everybody, and no screen could change them — this is that
            screen. Leaving one blank is a real answer: the list simply carries
            no row for it. Water was the last to arrive because it was the one
            that never looked broken — it had a row, a hero arc and a readiness
            score built on it, all from a literal. */}
        <Section>
          <SectionHead title="Your Daily Targets" note="Optional" />
          <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.md }}>
            Set any of these and it joins your list. Leave one blank and nothing is assumed.
          </Text>

          {/* The unit for each of these three is what the whole box means, and
              two of them have a wrong reading that looks entirely plausible:
              7 hours of sleep and 7 minutes of it are both "7", and 8 glasses
              and 8 ml are both "8" — the Alerts below already have to explain
              that. So the unit is in the label, not in a placeholder that a
              typed digit erases. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
            <Field label="Steps a day" hint={c.stepGoal != null ? `now ${c.stepGoal}` : unsetHint}>
            <TextInput
              value={stepDraft} onChangeText={setStepDraft} keyboardType="number-pad"
              placeholder={c.stepGoal != null ? String(c.stepGoal) : 'e.g. 8000'} placeholderTextColor={t.ink3}
              accessibilityLabel="Daily step goal"
              style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            </Field>
            <Cta label="Save" onPress={() => {
              // `readNumber`, not `parseFloat` — the same reader the sleep box
              // twelve lines below uses, and for the same reason. This is a
              // whole-number field on a number pad, so the comma is rarer here
              // than there, but "rarer" is not a rule: an 8,000 pasted or typed
              // with a group separator is `parseFloat`'s 8, which is a step goal
              // a member passes walking to the kitchen and then reads as met
              // every day for ever. One reader for every typed figure in this
              // app is what src/lib/units.ts asks for and what
              // `check:decimals` was written alongside.
              const typed = readNumber(stepDraft);
              const n = typed == null ? NaN : Math.round(typed);
              if (!Number.isFinite(n) || n < STEP_MIN || n > STEP_MAX) {
                Alert.alert('Check that number', `A step goal needs to be between ${STEP_MIN} and ${STEP_MAX}.`);
                return;
              }
              c.setStepGoal(n); setStepDraft('');
            }} />
            {c.stepGoal != null ? (
              <Pressable onPress={() => { c.setStepGoal(null); setStepDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear step goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end', marginTop: sp.lg }}>
            <Field label="Sleep a night" hint={c.sleepGoalHours != null ? `hours · now ${c.sleepGoalHours}h` : `hours · ${unsetHint}`}>
            <TextInput
              value={sleepDraft} onChangeText={setSleepDraft} keyboardType="decimal-pad"
              placeholder={c.sleepGoalHours != null ? String(c.sleepGoalHours) : 'e.g. 7.5'} placeholderTextColor={t.ink3}
              accessibilityLabel="Nightly sleep goal in hours"
              style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            </Field>
            <Cta label="Save" onPress={() => {
              // One decimal, matching numeric(3,1) on the column. Postgres would
              // round it anyway; doing it here means the number the client sees
              // afterwards is the number that was stored.
              // `readNumber`, not `parseFloat`. This box has always been a
              // decimal pad and its placeholder says "e.g. 7.5" — but on a
              // German keyboard that pad's decimal key is a comma, and
              // `parseFloat('7,5')` is 7. The goal stored was half an hour
              // short of the goal typed, for every client outside the
              // English-speaking world.
              const typed = readNumber(sleepDraft);
              const n = typed == null ? NaN : Math.round(typed * 10) / 10;
              if (!Number.isFinite(n) || n < SLEEP_MIN || n > SLEEP_MAX) {
                Alert.alert('Check that number', `A sleep goal needs to be between ${SLEEP_MIN} and ${SLEEP_MAX} hours. If you meant minutes, use hours here — 450 minutes is 7.5.`);
                return;
              }
              c.setSleepGoalHours(n); setSleepDraft('');
            }} />
            {c.sleepGoalHours != null ? (
              <Pressable onPress={() => { c.setSleepGoalHours(null); setSleepDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear sleep goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end', marginTop: sp.lg }}>
            <Field label="Water a day" hint={c.waterGoalGlasses != null ? `glasses · now ${c.waterGoalGlasses}` : `glasses · ${unsetHint}`}>
            <TextInput
              value={waterDraft} onChangeText={setWaterDraft} keyboardType="number-pad"
              placeholder={c.waterGoalGlasses != null ? String(c.waterGoalGlasses) : 'e.g. 8'} placeholderTextColor={t.ink3}
              accessibilityLabel="Daily water goal in glasses"
              style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            </Field>
            <Cta label="Save" onPress={() => {
              // As above: one reader for every typed figure. A glass count is a
              // small number and a comma in it is unlikely — and the box next
              // to it, which is neither, is the one this file already fixed.
              const typed = readNumber(waterDraft);
              const n = typed == null ? NaN : Math.round(typed);
              if (!Number.isFinite(n) || n < WATER_MIN || n > WATER_MAX) {
                Alert.alert('Check that number', `A water goal needs to be between ${WATER_MIN} and ${WATER_MAX} glasses. If you meant millilitres, use glasses here — a glass is about 250 ml.`);
                return;
              }
              c.setWaterGoalGlasses(n); setWaterDraft('');
            }} />
            {c.waterGoalGlasses != null ? (
              <Pressable onPress={() => { c.setWaterGoalGlasses(null); setWaterDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear water goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          {c.saveFailed ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              Your last profile change could not be saved, so this may not have stored either.
            </Flag>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
