// Client · Home — the daily briefing, in the order the approved mockup sets:
// HERO (today's session, the week's ring, the one adaptive action) →
// INFOGRAPHICS (Daily Snapshot's four rings, This Week's bars) → LISTS (what
// is coming up, readiness, what the coach and the gym said, and the doors to
// everything else). What is WRONG — offline, a write that lapsed, an injury,
// an invitation — sits directly under the hero and draws nothing on an
// ordinary day.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: one hero figure instead
// of four competing 20px numbers, hairline-separated sections instead of eleven
// stacked bordered cards, and a card spent only on the thing you can act on.
import { useState, useEffect, useCallback } from 'react';
import { Fetched } from '../../src/ui/fetched';
import { useReadStamp } from '../../src/ui/readStamp';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useNow } from '../../src/ui/today';
// The one answer to "is this booking still ahead of the member", with the hour
// of grace on it that keeps a session they are walking into on their screen.
import { isUpcoming } from '../../src/lib/upcomingWindow';
import { useReachability } from '../../src/ui/reachability';
import { offlineBanner } from '../../src/lib/reachability';
import { useOutbox } from '../../src/ui/outbox';
import { OUTBOX_KINDS, lapsedNote, outboxNote } from '../../src/lib/outbox';
import { BRAND } from '../../src/lib/brands';
import { WEEK_DAYS, isoDay, startOfWeek, weekIndexOf } from '../../src/lib/weekStart';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, ScrollView, Pressable, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ScreenHeader, ListRow, Cta, Ghost, QuickRow, Notice, Card, Flag, HeroCard, HeroRing, Ring, MiniRing, DayBars, TonedChip, ChartShell, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, font, grown } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { num, fmtTime } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { macrosFor, applyCoachAdjust, caloriesLeft, caloriesNote, dayBurn } from '../../src/lib/nutrition';
import { buildProgram } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
// `agoLabel` — "today" / "yesterday" / "18 days ago", the same wording the
// body figures are dated with, so a coach's note and a weigh-in are aged in one
// vocabulary.
import { agoLabel, todayISO } from '../../src/lib/bodyFigures';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
// Which week of the block today belongs to. See src/lib/clientBlock.ts.
import { useClientWeek } from '../../src/ui/clientWeek';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useAnnouncements } from '../../src/ui/announcements';
import { useHabits } from '../../src/ui/habits';
import { readinessMadeOf } from '../../src/lib/readiness';
import { useReadiness } from '../../src/ui/readiness';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARD_KEY } from './onboarding';
import { useSessions } from '../../src/ui/sessions';
import { useInvites } from '../../src/ui/invites';
import { useFoodLog } from '../../src/ui/foodLog';
import { useWearables } from '../../src/ui/wearables';
import { shownStreak, longestStreak, thisWeekStats, streakRisk, freezeBudget } from '../../src/lib/streaks';
// The one hydration rule: whether the glass count may be shown, whether it has
// a goal to fill against, and the sentence for when it has not. Recovery and
// Daily Habits read it; the Water ring here is the third and may not differ.
import { hydrationNote } from '../../src/lib/hydrationHero';
import { sharePercent } from '../../src/lib/sharePercent';
import { severeSummary } from '../../src/lib/injuries';
import { booksInPerson, coachedRemotely, COACHED_MODE_SHORT, COACHING_MODE_NOTE } from '../../src/lib/types';
import { scheduleLocal, pushAvailable } from '../../src/ui/pushNotifications';
import { allows } from '../../src/lib/notifyPrefs';
import { notifyPrefs } from '../../src/lib/notifyPrefsLatch';
import { NotificationBell } from '../../src/ui/notifications';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { GUIDE_SEEN_KEY } from '../guide';
import { isWhole } from '../../src/ui/loadStatus';
import {
  showWeek,
  checklist, checklistDone, checklistLeft, everLoggedMeal, nextTodo, showChecklist,
} from '../../src/lib/firstRun';
import { FORWARD_ICON } from '../../src/ui/direction';
import { avatarSource } from '../../src/lib/avatarImage';
import { hitSlopFor } from '../../src/lib/a11y';

// The month and weekday names used to be two hardcoded English arrays here,
// rendered as `{DAYS[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]}` on the
// first line of the first screen every member sees every day — in a language
// and an order the reader may not use. Repple is white-label: a gym in Dubai,
// one in London and one in Tokyo run the same binary, so there is no house
// locale to fall back to (src/lib/locale.ts). The date is the handset's now.


export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const assigned = useAssignedPrograms();
  const { getProgram, status: programStatus, cachedNote } = assigned;
  const coachProgram = getProgram(c.id);
  // Under 'error' an empty log means the history could not be read, not that
  // there is none — so the streak, the week's session count and the PR count
  // below are unknowns rather than zeroes. This is the first screen of the app,
  // and "0 of 4 this week" over a broken streak is the first thing a client who
  // trained four times would read about their own week.
  //
  // The gate was `!== 'error'`, which admits both of the other two answers that
  // are not a whole log. 'loading' printed the whole week — a streak, a session
  // count, a tonnage and a PR count — on the first frame, before the read came
  // back at all. And 'partial' is not an edge case here: src/ui/workoutLog.tsx
  // notes that four sessions a week at twenty sets apiece passes PostgREST's
  // thousand-row cap inside three months, so for a committed member 'partial'
  // is the ORDINARY state, and every figure below was a total computed from the
  // most recent thousand rows and presented as their whole history.
  //
  // `isWhole` is the gate src/ui/loadStatus.ts asks for and the one
  // app/(client)/membership.tsx already applies to this same log. The two
  // notices below say which of the three it is.
  const logKnown = isWhole(logStatus);
  const coachNutrition = useCoachNutrition();
  const nutriAdjust = coachNutrition.get(c.id);
  const coachFeedback = useCoachFeedback();
  const coachNotes = coachFeedback.getFeedback(c.id);
  // Two slots, not one. `latest` is the newest notice from this client's COACH
  // and `latestGym` the newest from their GYM: they are different authors
  // addressing different groups, and the block below that says "From Your
  // Coach" may only ever show the first. Both are the newest of their kind —
  // the rest live in app/(client)/notices.tsx, which is what stops a notice
  // being readable for one day and then nowhere.
  const { latest: ann, latestGym: gymAnn, reload: reloadAnnouncements } = useAnnouncements();
  const { water, waterGoal, waterStatus, reload: reloadHabits } = useHabits();
  // Readiness, its inputs and its caveats, from the one shared derivation.
  //
  // This screen used to assemble it here out of five providers, and so did
  // app/(client)/coach.tsx, and the two drifted: the gate on an unreadable
  // training log was written on the coach screen months before this one got it,
  // and until then the home screen's hero ROSE whenever the log failed to load.
  // Recovery is now a third reader — it is where this hero's own tap lands —
  // and three hand copies of one derivation is three chances to disagree about
  // the same number. See src/ui/readiness.ts for what moved and why.
  const { readiness, breakdown, direction } = useReadiness();
  // Two device-local marks. `null` on either is "we could not read it", which
  // the Getting Started list below draws as a dash rather than as undone —
  // see src/lib/firstRun.ts.
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [guideSeen, setGuideSeen] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    let gone = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([AsyncStorage.getItem(ONBOARD_KEY), AsyncStorage.getItem(GUIDE_SEEN_KEY)]);
        if (!gone) { setSetupDone(!!a); setGuideSeen(!!b); }
      } catch { if (!gone) { setSetupDone(null); setGuideSeen(null); } }
    })();
    return () => { gone = true; };
  }, []));
  // Only when we KNOW it is unfinished. A failed read must not put a
  // "personalise your plan" banner in front of somebody who did it last week.
  const needsOnboard = setupDone === false;
  // `status`, not just the rows. SessionsProvider returns 'error' with
  // `sessions` still `[]` (src/ui/sessions.tsx), and this row is the only read
  // on the whole screen that was taking that empty list at face value — the
  // log, the programs, the invites and readiness are all status-gated a few
  // lines from here. "No Sessions Booked" said to somebody expected in the room
  // on Thursday is the sentence this app pays most dearly for.
  // The clock the calendar week is measured against. A `Date.now()` in the
  // body would be read once per render on a screen that has no reason to
  // re-render at midnight, so a member with Home open across a Sunday goes on
  // being shown last week's total under "This Week". `useNow` re-settles at the
  // next local midnight and on every return to the foreground.
  //
  // ONE clock for the whole screen, and that is the point of holding the Date
  // as well as the milliseconds. The date line in the header, the greeting, the
  // day of the programme the card names and the week the KPI row counts were
  // four separate reads of the clock, three of them `new Date()` in the render
  // body — so they were not merely stale, they could disagree with each other
  // across a midnight this tab sat open through.
  const now = useNow();
  const nowMs = now.getTime();
  const { sessions, status: sessionStatus, refresh: refreshSessions } = useSessions();
  // ── when the figures on this screen were last confirmed ───────────────
  //
  // Home draws from three reads at once — the training log behind "This Week",
  // the diary behind the next booking, and the profile behind the body
  // figures — so one stamp over all three has to be true of the WORST of them.
  // `oldestFetch` in src/lib/freshness.ts makes that argument in full: taking
  // the newest gives a figure read an hour ago a confident wrong label instead
  // of none, and `oldestFetch` returns null if any of them has never landed,
  // which `<Fetched>` renders as "Reading…" rather than as an age.
  const logRead = useReadStamp(logStatus, log);
  const sessionsRead = useReadStamp(sessionStatus, sessions);
  const bodyRead = useReadStamp(c.status, c.id);
  const sessionsKnown = sessionStatus === 'ready' || sessionStatus === 'partial';
  // `status` is read, not discarded. useInvites documents that under 'error' an
  // empty `received` means the check did not happen — not that nobody invited
  // you — and this screen used to take the empty list at face value. A coach
  // would add a client, the client's home screen would show no invitation and
  // no reason for its absence, and both sides concluded the other had failed.
  // Reported four separate times from two apps.
  const {
    received: myInvites, status: invitesStatus, reload: reloadInvites,
    acceptInvite: acceptCoachInvite, declineInvite: declineCoachInvite,
  } = useInvites();
  // ── the three sentences about being offline that nothing rendered ───────
  //
  // `offlineBanner` and `lapsedNote` were both written, both tested and both
  // read by nothing. This is the home screen, so this is where the standing one
  // belongs: offline, every figure below is what this phone last had, and until
  // now nothing anywhere said so. `offlineBanner` returns null on 'online' AND
  // on 'unknown', so a launch that has not made a request yet draws nothing.
  const reach = useReachability();
  const offline = offlineBanner(reach);
  // An intent that sat past the moment it was about is taken out of the queue
  // without being sent, and the member's model is that it happened. This is the
  // one case the outbox header calls out as having to be TOLD, and it was being
  // discarded in silence. One line per kind, not per item: three lapsed
  // measurements are one thing to say.
  const outbox = useOutbox();
  const lapsedKinds = [...new Set((outbox?.lapsed ?? []).map((i) => i.kind))];
  // And what is still waiting. `outboxNote` returns null at zero, so a kind
  // with nothing pending contributes no line rather than an empty one.
  const waiting = OUTBOX_KINDS
    .map((k) => outboxNote(outbox?.countOf(k) ?? 0, k))
    .filter((line): line is string => line !== null);
  const foodLog = useFoodLog();
  const foodToday = foodLog.consumed;
  const wearables = useWearables();
  const wToday = wearables.today;
  // `states` is empty until the provider has looked, and an empty map is not
  // the claim "no watch is connected" — src/ui/wearables.tsx told a client with
  // a live WHOOP token exactly that, for exactly this reason.
  const wearableKnown = Object.keys(wearables.states).length > 0;
  const wearableConnected = Object.values(wearables.states).some((v) => v === 'connected');

  // The home screen tells a member whose invitation check failed to "pull down
  // to try again", and before this the ScrollView had no RefreshControl at all
  // — the gesture did nothing and the only remedy was killing the app.
  //
  // It then asked for three reads: the invitations, the training log and the
  // booked sessions. This screen draws on ten. Weight and body fat come from
  // the profile, the plan from the assignment, the calorie target from the
  // coach's adjustment, the notes from the coach's feedback, the notice from
  // announcements, the water count from habits, the fuel row from the food log
  // and the watch panel from the wearables — and none of those moved when
  // somebody pulled. A home screen that refreshes a third of itself under one
  // gesture is worse than one that refreshes nothing, because the parts that
  // did not move now look confirmed.
  const pull = usePullToRefresh(useCallback(() => {
    reloadInvites(); reloadLog(); void refreshSessions();
    c.reload(); assigned.reload(); void coachNutrition.reload(); coachFeedback.reload();
    reloadAnnouncements(); reloadHabits(); foodLog.reload(); void wearables.syncAll();
  }, [
    reloadInvites, reloadLog, refreshSessions, c.reload, assigned,
    coachNutrition, coachFeedback, reloadAnnouncements, reloadHabits, foodLog.reload, wearables,
  ]));

  const solo = c.coachingMode === 'solo';
  // Whether to offer a way to FIND a coach. Deliberately not `solo`: that is
  // what somebody said they wanted, not whether anybody is coaching them, and
  // gating on it meant the only route to Find a trainer on this screen was
  // shown exclusively to the people who had said they did not want one.
  // Reported as "nowhere on the client home screen shows you can find a
  // trainer" — which was true for every client who chose online, in-person or
  // hybrid coaching and had not yet been accepted by a coach, i.e. all of them
  // between signing up and being linked.
  //
  // `coachLinked` is null while unread, and that shows the row too: hiding the
  // way in is the bug, and offering it to somebody who already has a coach
  // costs them one tap.
  const needsCoach = c.coachLinked !== true;
  // What the coaching answer actually decides on this screen.
  //
  // It decided nothing before TF-30: `online || inperson` gated the booking row
  // and the Book action, so the two produced an identical home screen and the
  // only difference between them anywhere in the app was the noun printed in a
  // caption. A tester picked one, then the other, and correctly reported that
  // nothing had happened.
  //
  // `booksInPerson` — the booking calendar is in-person by construction (see
  // the header of calendar.tsx), so an online-only client was being offered
  // slots in a room they are never in. `coachedRemotely` — a coach who is not
  // there only learns how the week went if the client writes it down, so the
  // weekly check-in leads for them instead. Hybrid is both, which is the whole
  // point of the option: sessions to book AND a check-in for the weeks between.
  const booksSessions = booksInPerson(c.coachingMode);
  const remoteCoached = coachedRemotely(c.coachingMode);
  // Same `??` as This Week: a coached client whose assignment could not be read
  // gets the generic auto program in its place, titled and laid out exactly like
  // a plan their coach wrote. Nothing on the screen distinguished the two, so
  // the client trains the wrong session and has no reason to look twice.
  const programUnknown = !solo && programStatus === 'error' && coachProgram == null;
  const program = (solo ? null : coachProgram) ?? buildProgram(c.goal, c.bodyFatPct);
  // The days of the WEEK OF THE BLOCK they are on, not `program.days`, which is
  // week one for ever. Identical for a one-week programme, which is every
  // programme this app generates itself. `useClientWeek` is the one rule, and
  // Train, This Week and this screen all ask it rather than each deciding —
  // three screens naming three different sessions for the same Tuesday is worse
  // than all three naming week one.
  const blk = useClientWeek(program, c.id);
  const planDays = blk.days;
  // A POSITIONAL pick, on purpose, and the one place in the app that is still
  // allowed to be: this card always names something to train because its
  // headline is "Ready to Train", and src/lib/checklist.ts sets out why the
  // exact `scheduledDay` match belongs on the checklist and the week strip
  // rather than here. The index is the day's column in the week, which
  // src/lib/weekStart.ts owns — it was a hand-rolled Monday offset, and this
  // screen deciding for itself which day opens a week is how the three screens
  // that name today's session came to disagree about it.
  //
  // `nowMs`, not a bare `new Date()` in the render body. Home is a TAB: expo
  // router mounts it once and nothing tears it down, so a clock read here is
  // fixed at whatever moment the member first opened the app — and this one
  // picks WHICH DAY OF THE PROGRAMME the card names. A member who left Home
  // open on Monday evening and picked the phone up on Tuesday morning was shown
  // "Today · Push" over Monday's session, tapped Start Workout, and trained the
  // wrong day. It self-healed only when something else happened to re-render,
  // which on a screen somebody is reading rather than touching is nothing.
  // `useNow` re-settles at the next local midnight, on every foreground and on
  // every return to this tab, which are the three moments the answer changes.
  const todayIdx = weekIndexOf(new Date(nowMs));
  const workout = planDays[todayIdx % (planDays.length || 1)] || planDays[0] || { focus: 'Rest Day', exercises: [] };
  /**
   * How much work today's session is, counted off the plan itself.
   *
   * Null when there is no session to describe — the Rest Day fallback above, or
   * a coach block with an empty day in it — so the caption under the card is
   * absent rather than reading "0 exercises" over something somebody is about
   * to train. `sets` is a number on every `ProgramExercise`, but a programme
   * that came out of an import may not have one on every row, so an unreported
   * set count contributes nothing to the total rather than a zero, and the
   * caption drops the clause entirely when nothing reported.
   */
  const workoutSetCount = workout.exercises.length
    ? workout.exercises.reduce((n, e) => n + (typeof e.sets === 'number' && Number.isFinite(e.sets) ? e.sets : 0), 0)
    : null;

  // ── all three of these are totals over the WHOLE log ──────────────────
  //
  // The freeze budget is earned from the count of active days, the streak is a
  // chain through them, and `atRisk` is a claim about yesterday and today that
  // a log read at the row cap cannot make either — src/lib/rowCap.ts drops the
  // OLDEST rows, but a chain of 200 days counted over the most recent thousand
  // sets is still a chain measured over part of the history, and `activeDays`
  // has no way to know where the read stopped.
  //
  // They were gated on nothing while `logKnown` twenty lines up correctly gated
  // the ring, Sessions, Lifted, New PRs and the WeekDots. So a member on a
  // 200-day streak whose log came back 'partial' read the banner "Your 47-day
  // streak is on the line" four inches above a ring showing a dash, with the
  // screen's own 'partial' notice sitting between them explaining that the
  // figures are dashed because they would be counted over part of their
  // history. And "Remind Me Tonight" on that banner scheduled a LOCAL
  // NOTIFICATION carrying the same wrong number into their evening.
  //
  // The banner goes rather than getting a dash of its own: "Your —-day streak
  // is on the line" is not a sentence, and there is nothing to warn somebody
  // about when we cannot tell whether the chain is unbroken. The two notices
  // below already say the streak is being withheld and why, which is the
  // sentence this screen owes the reader.
  const freezes = logKnown ? freezeBudget(log) : 0;
  // ONE number on this screen. The ring took the frozen streak and the banner
  // four inches above it took `risk.streak`, which is the raw chain — so a
  // member whose freeze had bridged a missed day read "23" in the ring and
  // "A freeze is holding your 12-day streak" over it, on the screen that grants
  // the freeze. `streakRisk` is still asked WHETHER the streak is at risk,
  // because that question is about the unhelped chain; it is no longer asked
  // how long it is.
  const streak = logKnown ? shownStreak(log) : 0;
  const risk = logKnown ? streakRisk(log) : { atRisk: false, streak: 0, trainedToday: false };
  const protectedTonight = risk.atRisk && freezes > 0;
  const sevInj = severeSummary(c.injuries);
  const remindTonight = async () => {
    const when = new Date(); when.setHours(19, 0, 0, 0);
    if (when.getTime() <= Date.now()) when.setTime(Date.now() + 60 * 60 * 1000);
    // Category 'motivation', so it honours the member's switch and their
    // quiet hours. The same nudge is now also armed automatically at launch
    // (src/ui/motivationNudges.tsx) — this button stays because it is the one
    // that lets somebody arm it on a day the automatic rule would not, and
    // because a control that vanishes is a control somebody reports missing.
    // ── the button that said nothing ────────────────────────────────────
    //
    // The id was thrown away and every outcome looked the same from here.
    // `scheduleLocal` returns null for four different things — the category
    // switched off, the shifted time already past, no notifications module, a
    // throw — so a member who had turned "Streaks And Badges" off in the app's
    // own Notifications screen tapped the only button on the banner telling
    // them their streak was about to break, and nothing happened anywhere. No
    // alert, no state change, no mark. app/(client)/reminders.tsx answers the
    // same four outcomes with four different sentences.
    if (!pushAvailable()) {
      Alert.alert('Nothing scheduled', 'This build cannot schedule notifications, so no reminder has been set. Your streak is unaffected.');
      return;
    }
    if (!allows('motivation', notifyPrefs())) {
      Alert.alert(
        'Motivation nudges are off',
        'You have turned off nudges about streaks and badges, so this reminder was not scheduled. Turn them back on in Notifications and this button will work.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Notifications', onPress: () => router.push('/(client)/notification-prefs') },
        ],
      );
      return;
    }
    let id: string | null = null;
    // `streak` is only ever a number here because the banner this button lives
    // on is gated on `risk.atRisk`, which is false whenever the log did not
    // come back whole — see the note at `freezes` above. A notification is the
    // one thing on this screen that outlives the screen, so the figure in it
    // must not be one the screen itself was refusing to print.
    try { id = await scheduleLocal('Keep your streak alive', 'One session today keeps your ' + streak + '-day streak going.', when, { route: '/(client)/workouts' }, 'motivation'); } catch { id = null; }
    if (!id) {
      Alert.alert('Nothing scheduled', 'That reminder could not be set — this phone may not be allowing notifications from us. Nothing has changed about your streak.');
      return;
    }
    Alert.alert('Reminder set', `We will nudge you at ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} tonight. Log a session before then and you can ignore it.`);
  };
  // Priced with the member's own weight over time, so a pull-up counts. See
  // src/lib/bodyweightSets.ts — an unweighed member's bodyweight sets are
  // reported as unpriced rather than silently counted as zero.
  // `thisWeekStats`, not `weekStats`. Everything this feeds is captioned "This
  // Week" — the KPI row, the day dots and the goal ring — and `weekStats` is a
  // rolling 168 hours. On a Monday morning the ring counted the previous
  // Wednesday and Thursday and could read "4 of 4 this week · goal met" to
  // somebody who had not trained since the week opened; tapping through to
  // This Week, which is Sunday-anchored, then showed a different number for the
  // same phrase. See src/lib/weekStart.ts for why the anchor is product-wide.
  //
  // `useNow()` rather than `Date.now()`, because the answer changes at the
  // Sunday midnight this screen sits open across.
  const wk = thisWeekStats(log, nowMs, c.weightSeries);
  const goalDays = planDays.length || 4;

  // ── Getting Started, while it has anything to say ────────────────────────
  //
  // Reported as "Repple Coach has a Getting Started, however Client doesn't."
  // What the coach app had was the first-run tour firing on a fresh install —
  // a one-shot carousel, gone once consumed. This row is the persistent
  // version, and it is HERE rather than only in the Me hub because being
  // buried in Profile is the whole of what was reported. It leaves the screen
  // when the list is finished; app/(client)/getting-started.tsx keeps it.
  const started = checklist({
    setup: setupDone,
    guide: guideSeen,
    coach: c.coachLinked,
    workout: isWhole(logStatus) ? log.length > 0 : (log.length > 0 ? true : null),
    // The same fact as app/(client)/getting-started.tsx, from the same rule, and
    // it has to stay that way: a checklist that disagrees with itself between
    // the home row and the screen the home row opens is worse than one that is
    // wrong on both. `foodLog.entries` is TODAY ONLY, so reading the item off
    // it made "Log Something You Ate" outstanding again every midnight — this
    // row therefore never left the home screen of anybody, ever.
    meal: everLoggedMeal({ loggedToday: foodLog.entries.length, unsentEarlier: foodLog.owed.length, everLogged: foodLog.everLogged }),
    device: wearableKnown ? wearableConnected : null,
    solo,
  });
  const startedLeft = checklistLeft(started);
  const startedNext = nextTodo(started);

  /* ── the three answers Fuel Today is built from, and whose they are ───────
   *
   * A weight and a body fat, which this already checked — and the member's own
   * GOAL and DIET, which it did not. Both of those live on the `clients` row
   * and nowhere else: src/ui/clientData.tsx deletes the local profile cache at
   * launch under USE_SUPABASE, so a failed profile read leaves them at their
   * constructed defaults, 'muscle' and 'meat'. Through src/lib/nutrition.ts
   * that is a twelve per cent surplus and a 27% fat split — so a member who is
   * cutting on keto, whose profile read failed, was shown a bulking day's
   * protein, carb and fat meters headed "Fuel Today" and read them as theirs.
   *
   * The weight check does not catch it. Weight and body fat fall back to the
   * latest SCAN, a different read on a different table, which is routinely fine
   * when the profile read is not.
   *
   * And the coach's half of the same sum. `get()` returns null identically for
   * "your coach has not adjusted you" and "we could not find out whether they
   * have" — src/ui/coachNutrition.tsx exists to make that distinction, and the
   * second one silently serves the uncorrected figure. Same guard the Meals tab
   * and the Food Log already carry.
   *
   * Under any of these the section is not drawn at all, which is what this
   * screen already does for a member with no weight, with the reason said in a
   * Notice above rather than as a heading over nothing.
   */
  const targetInputsUnknown = !isWhole(c.profileStatus)
    || (!solo && coachNutrition.status === 'error' && nutriAdjust == null);
  // null until there is a body to scale to. This used to run on the 70 kg /
  // 20% placeholder from clientData and present the result as the client's
  // own daily targets.
  const macros = (c.weightKg != null && c.bodyFatPct != null && !targetInputsUnknown)
    ? applyCoachAdjust(macrosFor({ weightKg: c.weightKg, bodyFatPct: c.bodyFatPct, activity: c.activity, goal: c.goal, diet: c.diet }), solo ? undefined : (nutriAdjust || undefined))
    : null;
  // ── What this screen draws before there is anything to draw ──────────────
  //
  // On a brand-new account three of the sections below were entirely em
  // dashes: a Body row of three unmeasured figures, a Fuel heading standing
  // over no meters at all (there is no target without a weight), and This Week
  // reading 0 sessions, 0 lifted and 0 PRs over seven empty dots. Nine dashes
  // is not nine answers, it is a screen that looks broken — and "too much
  // information" was the report.
  //
  // Hidden only on a SETTLED read. Under 'error' an empty log means unknown,
  // and hiding This Week on one would tell somebody who has trained for a year
  // that they never have. The rules and that gate are in src/lib/firstRun.ts
  // and tested; the two Notices further down already say when a read failed.
  const facts = {
    bodyStatus: c.status,
    measured: c.weightKg != null || c.bodyFatPct != null || c.muscleKg != null,
    logStatus,
    loggedEver: log.length,
    hasTargets: macros != null,
  };


  // Real logged intake (shared with the Meals tab + Food Log); reflects what was actually eaten today.
  const consumed = { kcal: foodToday.kcal, p: foodToday.protein, cbs: foodToday.carbs, f: foodToday.fat };
  const burn = macros ? dayBurn(macros, wToday) : null;
  // Both sides of this comparison are the LOCAL day, and they used to be the
  // UTC one on both sides — `new Date().toISOString().slice(0, 10)` against a
  // slice of the entry's own ISO string. That is not a harmless pair of
  // matching mistakes: for a member in Auckland every session logged after 1pm
  // carries tomorrow's UTC date, so "Ready to Train" stayed on the card all
  // afternoon for somebody who had already trained, and then at midnight UTC —
  // lunchtime there — the whole day's training stopped counting as today's.
  // `todayISO` is the local calendar day and says in its own header that a
  // string slice is not it.
  //
  // And it is read off `now`, not off the clock. `todayISO()` with no argument
  // reads `new Date()`, which on a tab that mounts once is the day the member
  // first opened the app — the third frozen clock on this screen and the one
  // with the largest blast radius, because `trainedToday` is what decides which
  // of the four cards the top of Home shows. A member who trained on Monday and
  // left Home open woke up on Tuesday to "Session Done", with Start Workout
  // nowhere on the screen, for the whole of a day they had not trained.
  const _todayKey = todayISO(now);
  const trainedToday = log.some((e) => {
    const d = new Date(e.t || '');
    // An unparseable stamp is not evidence of a session today. It is dropped
    // rather than formatted, which would compare 'NaN-NaN-NaN' against a date.
    return Number.isNaN(d.getTime()) ? false : todayISO(d) === _todayKey;
  });
  // The third copy of this sum, and it had both of the faults the other two
  // were fixed for: it ADDED the day's burn to a target that already assumed
  // movement, and clamped at zero so Home could never say a client was over.
  // One function now, the same one the Meals tab and the Food Log call.
  //
  // And only off a WHOLE food log. `consumed` is a floor under anything else,
  // so a log that failed or came back capped did not make this sum blank, it
  // made it generous: "Fuel Up · 1,900 kcal left" on the hero, over a Calories
  // ring that is withholding its arc for exactly that reason. The Meals ring
  // has carried this gate since it was drawn.
  const foodWhole = isWhole(foodLog.status);
  const dayCal = macros && foodWhole ? caloriesLeft(macros.kcal, consumed.kcal, burn?.burned ?? 0, burn?.budgeted ?? 0, burn?.kind) : null;
  // Only claim somebody is under-recovered when there is a score saying so.
  // Unknown readiness falls through to the ordinary prompts, which assert
  // nothing about their body.
  //
  // ── the fourth branch, and the zero that hid it ───────────────────────
  //
  // This read `const kcalLeft = dayCal ? dayCal.net : 0` and then branched on
  // `kcalLeft > 200`. `dayCal` is null whenever there is no target — no weight
  // on record, no body fat, or, since the Fuel guard above, a profile or a
  // coach adjustment we could not read — and a null target became the number
  // zero, which is under 200, which fell through to "On Track · Session done
  // and your macros are on point. Nice work."
  //
  // So the card at the top of the first screen of the app congratulated a
  // member on hitting macros it had never worked out, on the strength of a
  // figure it had invented. For a brand-new member that is a compliment about
  // nothing. For a member whose profile read failed it is worse: Fuel Today
  // twelve inches below is WITHHELD, with a notice saying we could not read
  // what they are training for, while the card above it says their day is on
  // point. Two blocks on one screen, one read, opposite claims.
  //
  // `kcalLeft` is gone rather than defaulted. The only thing it was used for is
  // the comparison, and a comparison is exactly what a null cannot enter — see
  // `dayCal.net` for the figure itself, which is only ever read where there is
  // a target behind it.
  const today = readiness != null && readiness.tone === 'low'
    ? { headline: 'Recover Today', tip: 'Under-recovered — keep it light or take a rest day.', cta: 'Recovery', route: '/(client)/recovery', tone: t.warn }
    : !trainedToday
    ? { headline: 'Ready to Train', tip: readiness?.tip ?? 'Log tonight’s sleep and your readiness appears here.', cta: 'Start Workout', route: '/(client)/workouts', tone: t.brand }
    // Trained, and no target to judge the eating against. The session is a fact
    // and is said; the macros are not mentioned, because there is nothing to
    // mention. The route still opens Nutrition, which is where the missing
    // answer is given.
    : dayCal == null
    ? {
        headline: 'Session Done',
        tip: targetInputsUnknown
          ? 'Nice work. We couldn’t work out today’s calorie target, so there is nothing to say about your eating yet.'
          : macros != null
          ? 'Nice work. Today’s food log couldn’t be read in full, so there is nothing to say about your eating yet.'
          : 'Nice work. Add your weight and a scan and your daily target appears here.',
        cta: 'View Plan', route: '/(client)/nutrition', tone: t.brand,
      }
    : dayCal.net > 200
    ? { headline: 'Fuel Up', tip: caloriesNote(dayCal) + '.', cta: 'Log a Meal', route: '/(client)/nutrition', tone: t.brand }
    : { headline: 'On Track', tip: 'Session done and your macros are on point. Nice work.', cta: 'View Plan', route: '/(client)/nutrition', tone: t.brand };

  // ── the hour of grace, and the row that vanished without it ───────────
  //
  // `Date.parse(sx.startsAt) > now` drops a session from Home the instant its
  // clock strikes. Every other screen answering "what have I got coming" asks
  // `isUpcoming` (src/lib/upcomingWindow.ts), which draws the line an hour
  // BEHIND the start and says why: "A session that started ten minutes ago has
  // not stopped being the member's next appointment. They are walking to it."
  //
  // At 18:05 for an 18:00 booking this screen told an in-person client "No
  // Sessions Booked · Tap to book" while Book Sessions still listed the same
  // hour — and for an online-only client the row is gated `booksSessions ||
  // nextSession` below, so it DISAPPEARED altogether, which is the exact
  // outcome the comment above that gate exists to prevent.
  //
  // `nowMs` rather than a bare `Date.now()` in the render body, for the reason
  // this screen already gives at `useNow()`: a clock read once per render, on a
  // screen with no reason to re-render, is frozen at whatever time the member
  // opened it.
  const nextSession = sessions
    .filter((sx) => sx.status === 'booked' && sx.clientId === c.id && isUpcoming(sx.startsAt, nowMs))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  // The date printed at the top of the screen and the greeting under it, off
  // the SAME clock as everything else — see `now` above. This was `new Date()`
  // in the render body on a tab that mounts once, so both were frozen at the
  // moment the app was opened: a member who opened Home on Sunday night and
  // looked at it on Monday morning read "Sun 13 Sep" and "Good Evening" over a
  // Monday screen, and the two are the first and second lines they see.
  //
  // A greeting is the one thing here that turns on the HOUR rather than the
  // day, and `useNow` does not tick — it re-settles at midnight, on foreground
  // and on focus. That is right for this: a phone in a pocket from afternoon to
  // evening re-settles the moment it is picked up, and a screen somebody is
  // looking at while 11:59 becomes 12:01 is not worth a timer that re-renders
  // the whole tab every minute.
  const d = now;
  const hi = d.getHours() < 12 ? 'Good Morning' : d.getHours() < 18 ? 'Good Afternoon' : 'Good Evening';

  // ── the first viewport's three pictures, and what each may claim ─────────
  //
  // The approved mockup opens Home on a night hero, four small rings and a
  // week of bars. Every one of them is a picture of a number, so every one of
  // them answers to the same rule as the figure it replaced: a ring whose read
  // is not whole, or that has nothing to be measured against, draws its track
  // and a dash — never an empty arc, which is a drawn zero — and the reason is
  // ONE line under the row, beside the ring it accounts for.
  //
  // "WEEK n OF N" only when the week was COUNTED from a start date the coach
  // set. `useClientWeek` resolves every other phase to a real week so Train
  // always has a session to show, but 'no-date', 'unreadable', 'not-started'
  // and 'ended' are all "this number was not counted", and a one-week
  // programme has no week to name. The eyebrow then says TODAY and no more.
  const heroEyebrow = blk.week.reason === 'counted' && !programUnknown
    ? `TODAY · WEEK ${num(blk.week.index + 1)} OF ${num(blk.week.count)}`
    : 'TODAY';
  const hasSession = workout.exercises.length > 0;
  const heroTitle = hasSession || planDays.length > 0 ? (workout.focus || 'Rest Day') : 'No Sessions Planned';
  /* ── what you are actually in for ─────────────────────────────────────────
     Nike Training Club, Strava and TrueCoach all put the SHAPE of a session in
     front of the button that starts it — how many movements, how much work.
     A member deciding at 21:40 whether they have time for this had no way to
     tell a four-exercise accessory day from an eleven-exercise one without
     opening it.

     Counted, never estimated. There is no duration model in this codebase and
     inventing one here would be exactly the fabricated figure the rest of this
     screen refuses: "about 45 min" over a session nobody has timed is a number
     with nothing behind it. The exercise count and the set total ARE facts —
     they are the plan, in hand, already being rendered on the Train tab. The
     cardio line comes along when the day has one, since a 20-minute interval
     finish is most of what somebody is deciding about. A day with no session
     says so in words rather than as "0 exercises". */
  const heroMeta = hasSession && workoutSetCount != null
    ? `${workout.exercises.length === 1 ? '1 exercise' : `${num(workout.exercises.length)} exercises`}`
      + (workoutSetCount > 0 ? ` · ${workoutSetCount === 1 ? '1 set' : `${num(workoutSetCount)} sets`}` : '')
      + (workout.cardio ? ` · ${workout.cardio}` : '')
    : planDays.length > 0 ? 'Nothing on your plan for today' : 'This week of your programme has no days in it';

  // ── Daily Snapshot: four rings, four owners, four gates ──────────────────
  //
  // Calories and protein are `eaten / target`, so they need BOTH halves: the
  // target (`macros`, withheld above when the profile or the coach's adjustment
  // could not be read) and a whole read of today's food log — `eaten` is a
  // floor under anything else, and a floor drawn as an arc reads as "you have
  // barely eaten". The same gate the Meals ring carries.
  const targetWhy = macros != null ? null
    : c.profileStatus === 'loading' || coachNutrition.status === 'loading' ? 'Reading your targets…'
    : !isWhole(c.profileStatus) ? 'We couldn’t read what you are training for, so no target is drawn from the defaults.'
    : targetInputsUnknown ? 'We couldn’t read your coach’s adjustment, so the uncorrected target is not shown as yours.'
    : 'Add your weight and a scan and your daily target appears.';
  const fuelWhy = targetWhy ?? (foodWhole ? null
    : foodLog.status === 'loading' ? 'Reading today’s food log…'
    : 'Today’s food log could not be read in full, so what you have eaten is not counted.');
  // Non-null exactly when both halves are in hand, so nothing below can read a
  // target without the log that goes with it.
  const fuel = macros != null && foodWhole ? { kcal: macros.kcal, protein: macros.protein } : null;
  // Water is the hydration rule Recovery and Daily Habits already share: the
  // count only off a read that answered, the arc only against a goal the
  // member set. `waterGoal` is theirs or null — never the old platform "8".
  const hyd = hydrationNote(waterStatus, c.profileStatus, water, waterGoal);
  // Steps are today's count off a CONNECTED watch, against the member's own
  // goal. The order is Daily Habits': no watch, then a read that has not
  // answered, then a watch with no count yet, then no goal to fill against.
  const stepsWhy = !wearableKnown ? 'Reading today’s steps from your device…'
    : !wearableConnected ? 'Connect a watch and your steps are counted here.'
    : !isWhole(wearables.todayStatus)
      ? (wearables.todayStatus === 'loading'
        ? 'Reading today’s steps from your device…'
        : 'Your device could not be read just now — that is not a count of nought.')
    : wToday.steps == null ? 'Your device has no step count for today yet.'
    : c.stepGoal == null
      ? (isWhole(c.profileStatus)
        ? 'No step goal set — set one on Daily Habits and this fills against it.'
        : 'Your step goal could not be read, so this is not filling against one.')
    : null;
  const stepsCounted = wearableConnected && isWhole(wearables.todayStatus) && wToday.steps != null;
  const stepsGoal = c.stepGoal != null && c.stepGoal > 0 ? c.stepGoal : null;
  // The figure inside a calorie, protein or step ring is a SHARE, so it is
  // `sharePercent`'s to word ("under 1%", never a rounded-down nought); the
  // arc is the raw ratio, which has no rounding to get wrong. Water keeps its
  // count over its goal, the way its own screen reads.
  const snapshot: { key: string; label: string; tone: Tone; value: number | null; figure: string | null; spoken: string; route: string }[] = [
    {
      key: 'kcal', label: 'Calories', tone: 'orange', route: '/(client)/nutrition',
      value: fuel && fuel.kcal > 0 ? consumed.kcal / fuel.kcal : null,
      figure: fuel ? sharePercent(consumed.kcal, fuel.kcal) : null,
      spoken: fuel ? `${num(consumed.kcal)} of ${num(fuel.kcal)} calories eaten today` : `Calories not counted. ${fuelWhy}`,
    },
    {
      key: 'protein', label: 'Protein', tone: 'blue', route: '/(client)/nutrition',
      value: fuel && fuel.protein > 0 ? consumed.p / fuel.protein : null,
      figure: fuel ? sharePercent(consumed.p, fuel.protein) : null,
      spoken: fuel ? `${num(consumed.p)} of ${num(fuel.protein)} grams of protein eaten today` : `Protein not counted. ${fuelWhy}`,
    },
    {
      key: 'water', label: 'Water', tone: 'teal', route: '/(client)/habits',
      value: hyd.showRing && waterGoal != null && waterGoal > 0 ? water / waterGoal : null,
      figure: !hyd.showCount ? null : hyd.showRing && waterGoal != null ? `${num(water)}/${num(waterGoal)}` : num(water),
      spoken: !hyd.showCount ? `Water not counted. ${hyd.text}`
        : hyd.showRing && waterGoal != null ? `${num(water)} of ${num(waterGoal)} glasses of water today`
        : `${num(water)} ${water === 1 ? 'glass' : 'glasses'} of water today. ${hyd.text}`,
    },
    {
      key: 'steps', label: 'Steps', tone: 'purple',
      // A ring that says "connect a watch" opens the screen that connects one.
      route: wearableKnown && !wearableConnected ? '/(client)/devices' : '/(client)/habits',
      value: stepsCounted && stepsGoal != null ? (wToday.steps as number) / stepsGoal : null,
      figure: !stepsCounted ? null : stepsGoal != null ? sharePercent(wToday.steps, stepsGoal) : num(wToday.steps),
      // numbers-ok: stepsWhy is a sentence, not a count — the counts beside it go through num().
      spoken: !stepsCounted ? `Steps not counted. ${stepsWhy}`
        : stepsGoal != null ? `${num(wToday.steps)} of ${num(stepsGoal)} steps today`
        : `${num(wToday.steps)} steps today. ${stepsWhy}`,
    },
  ];
  // One line per reason, named for the ring it is about. Calories and protein
  // share theirs — one target, one food log — so they share a line.
  const snapshotNotes = [
    fuelWhy ? `Calories and protein · ${fuelWhy}`
      // Over is a fact about today and the ring cannot draw it: an arc stops at
      // full. `dayCal.net` is the one calorie sum Meals and the Food Log read.
      : dayCal != null && dayCal.net < 0 ? `Calories · ${num(Math.abs(dayCal.net))} kcal over today’s target` : null,
    hyd.showRing ? null : `Water · ${hyd.text}`,
    // numbers-ok: stepsWhy is a sentence, not a count.
    stepsWhy ? `Steps · ${stepsWhy}` : null,
  ].filter((line): line is string => line !== null);

  // ── This Week: seven bars off the training log ───────────────────────────
  //
  // How many movements the log holds for each day of THIS week — the same
  // count, keyed the same way, as the bars on This Week, which is where a tap
  // lands, so the two cannot disagree. A day that has not happened yet is null
  // and draws nothing; a day that has, with nothing logged, is a counted zero
  // and draws the grey stub. Only ever built from a whole log: <ChartShell>
  // below draws none of it otherwise and says which of the reads was short.
  const weekOpened = startOfWeek(now);
  const loggedOn = new Map<string, number>();
  for (const l of log) { const k = isoDay(new Date(l.t || '')); loggedOn.set(k, (loggedOn.get(k) ?? 0) + 1); }
  const weekBars = WEEK_DAYS.map((label, i) => {
    if (i > todayIdx) return { label, value: null };
    const date = new Date(weekOpened); date.setDate(weekOpened.getDate() + i);
    return { label, value: loggedOn.get(isoDay(date)) ?? 0 };
  });
  const weekSpoken = weekBars.filter((b) => b.value != null)
    .map((b) => `${b.label} ${b.value === 0 ? 'none' : num(b.value)}`).join(', ');
  // The chip is the run they are ON; with none going, the best they have had,
  // so the corner is not empty for somebody between runs. Both are totals over
  // the whole log and both are withheld with it — see `freezes` above.
  const bestRun = logKnown ? longestStreak(log) : 0;
  const readinessTone: Tone = readiness == null ? 'neutral' : readiness.tone === 'good' ? 'brand' : readiness.tone === 'moderate' ? 'amber' : 'red';

  const firstName = (c.name || '').trim().split(' ')[0] || '';
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <ScreenHeader
          greeting
          // "Good morning," over the name, as the board opens Home. A client
          // who has not finished onboarding has no name yet: then the greeting
          // is the title and the date stands in for the name's line.
          eyebrow={firstName ? `${hi},` : d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}
          title={firstName || hi}
          actions={<>
            {/* No search control up here any more: the mockup's header is the
                bell and the face, and Explore is a row in the list at the
                foot of the screen — the same route, one scroll away. */}
            {/* The bell opens the inbox now. It routed to '/(client)/messages'
                for as long as it has existed, because `notifications` had a
                writer and no reader — so "your session was cancelled" opened a
                chat thread that did not mention it, and the cancellation itself
                was readable nowhere. Its dot was fed by coach notes and the
                gym announcement, which are BOTH rendered further down this same
                screen, so nothing is lost by dropping it: the mark on the bell
                now counts unread notifications, which is what a bell claims. */}
            <NotificationBell group="client" />
            {/* The member's own face, top right, as the board draws it — the
                way to Me from the first screen. `avatarSource`, not `c.photo`:
                a device path from before uploads existed draws as initials. */}
            <Pressable onPress={() => router.push('/(client)/profile')} accessibilityRole="button" accessibilityLabel="Your profile"
              hitSlop={hitSlopFor(44)}
              // The pale accent plate under the accent's TEXT colour, 44pt, as
              // the mockup draws the initials — not the solid fill, which made
              // the avatar the loudest thing above a hero that should be.
              style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {avatarSource(c.photo) ? (
                <Image source={{ uri: avatarSource(c.photo)! }} style={{ width: 44, height: 44 }} accessibilityIgnoresInvertColors />
              ) : c.init ? (
                <Text style={{ ...ty.label, ...font('700'), color: t.brandText }}>{c.init}</Text>
              ) : (
                <Icon name="me" size={20} color={t.brandText} />
              )}
            </Pressable>
          </>}
        />

        {/* ── the hero: today's session, the week's ring, the one action ─────
            The approved mockup opens Home on one night card — "TODAY · WEEK 1
            OF 12 / Push Day / 5 exercises · 17 sets", the week's ring beside
            it and the bright button under both. The words are the PLAN (what
            today is), the ring is the LOG (how the week is going) and the
            button is the adaptive call this screen has always made — Start
            Workout, Recovery, Log a Meal, View Plan — with its label, route and
            tone untouched.

            The ring is counted in DAYS against a goal counted in days — see
            the note on `wk` above: a member who trained once and logged seven
            movements is one day in, not seven. Withheld, arc and figure, when
            the log is not whole: an empty ring over "0/4" is a claim about the
            member's week that a failed or capped read cannot make, and the
            This Week card under the snapshot says which of the two it was. */}
        <HeroCard
          eyebrow={heroEyebrow}
          title={heroTitle}
          meta={heroMeta}
          ring={
            // The ring is decoration over the figure inside it, so the
            // control is a button that says the figure and where it goes —
            // not a progressbar, which a reader cannot tap. The button's label
            // replaces the ring's own, which is why both are the same words.
            <Pressable onPress={() => router.push('/(client)/week')} accessibilityRole="button"
              accessibilityLabel={logKnown
                ? `${num(wk.days)} of ${num(goalDays)} training days this week. Open This Week`
                : 'This week could not be counted. Open This Week'}
              hitSlop={8}>
              {/* `null` when the log is not whole: track only, and a dash. */}
              <HeroRing
                value={logKnown ? wk.days / Math.max(1, goalDays) : null}
                figure={logKnown ? `${num(wk.days)}/${num(goalDays)}` : null}
                sub="this week"
                spoken={logKnown ? `${num(wk.days)} of ${num(goalDays)} training days this week` : 'This week could not be counted'}
              />
            </Pressable>
          }
          cta={{ label: today.cta, tone: today.tone, onPress: () => router.push(trainIntent(today.route) as any) }}
        >
          {/* ── why THIS button, said beside it ──────────────────────────────
              The button is adaptive, and an amber "Recovery" under a training
              headline with the sentence that explains it a screen away is an
              alert without its reason. So the call's own headline and its one
              sentence sit directly over it — this is the whole of what the
              Today row under the fold used to say, which is why that row is
              gone rather than repeated. */}
          <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.lg }}>
            <Text style={{ ...ty.caption, ...font('700'), color: t.nightInk }}>{today.headline}</Text>
            {` · ${today.tip}`}
          </Text>
          {/* A booking is a fact about today's page, so it is on it: the full
              row, with its unread and empty states, is under Coming Up. */}
          {nextSession ? (
            <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.xs }}>
              {`Next session · ${new Date(nextSession.startsAt).toLocaleDateString(appLocale(), { weekday: 'short' })} ${fmtTime(nextSession.startsAt)}`}
            </Text>
          ) : null}
        </HeroCard>

        {/* ── whose copy today's session was drawn from ────────────────────
            Directly under the card whose headline it qualifies. `getProgram`
            serves this device's copy when no read has landed, and keeps serving
            it for THIRTY DAYS (src/lib/programCache.ts) — so the session on the
            card can be last month's block with nothing here to doubt it, and
            the line below it is suppressed exactly then, because the cache is
            what made `coachProgram` non-null.

            Non-null only while the copy is what is being served —
            `mayServeCached` decides that — so no gate of its own, and it goes
            the moment a live read lands. Same sentence as
            app/(client)/week.tsx. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{cachedNote}</Flag> : null}
        {/* One line now, not a titled notice: it is the reason beside a
            headline, and the same two facts — whose programme this is, and that
            the coach's takes over when it can be read. */}
        {programUnknown ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>
            {`We couldn’t check for a coach plan, so today’s session is from ${BRAND.label}’s automatic programme. Your coach’s takes over as soon as we can read it.`}
          </Flag>
        ) : null}

        {/* ── interrupts: what is wrong, before what is next ────────────────
            The data-layout review's fourth slot: an urgent injury, a write that
            did not go, or the offline/outbox state — and nothing else. The
            "Personalise your plan" card and the streak warning used to sit in
            here, the first of them ABOVE the injury notice; a prompt and a nudge
            may not outrank a plan changed for an injury, a write that lapsed or
            a booked session, so both now follow the Today card. An invitation
            stays: it is somebody waiting on a decision, not a promotion. */}
        <View style={{ marginTop: sp.lg }}>
          {/* First, because it changes how everything under it should be read.
              It deliberately promises nothing about anything being sent later:
              whether a particular write is queued is a fact about that write,
              and src/lib/outbox.ts owns saying so. */}
          {offline ? (
            <Notice tone={t.warn} kicker="Offline" title="Showing what this phone already had" note={offline} />
          ) : null}

          {/* The write that FAILED, before the ones still in hand: a lapsed
              intent is the only line here the member has to be told about,
              because their model is that it happened. */}
          {lapsedKinds.map((k) => (
            <Notice key={`lapsed-${k}`} tone={t.warn} kicker="Not sent"
              title="Something waited too long to send" note={lapsedNote(k)}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Ghost label="Got It" onPress={() => outbox?.clearLapsed()} /></View>
              </View>
            </Notice>
          ))}

          {waiting.length > 0 ? (
            <Notice tone={t.warn} kicker="Waiting to send"
              title={waiting.length === 1 ? 'One thing is still on this phone' : 'Some things are still on this phone'}
              note={waiting.join(' ')} />
          ) : null}

          {sevInj ? (
            <Notice tone={t.crit} kicker="From your coach" title="Your plan is adjusted for your injury"
              note={`I've eased off ${sevInj.groups.join(' & ').toLowerCase()} while your ${sevInj.areas.join(' & ').toLowerCase()} ${sevInj.areas.length > 1 ? 'are' : 'is'} severe — risky moves are swapped or paused. Let's train safely around it.`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flexGrow: 2, flexBasis: 180 }}><Cta label="Get a Safe Plan" wide onPress={() => router.push('/(client)/coach?ask=injury')} /></View>
                <View style={{ flexGrow: 1, flexBasis: 110 }}><Ghost label="Update" onPress={() => router.push('/(client)/injuries')} /></View>
              </View>
            </Notice>
          ) : null}

          {myInvites.length === 0 && invitesStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Coaching invitations"
              title="Could not check for invitations"
              note="This is not the same as having none. If a coach has invited you, it will appear here once this loads — pull down to try again." />
          ) : null}

          {myInvites.length > 0 ? (
            <Notice tone={t.brand} kicker="Coaching invitation"
              title={`${myInvites[0].coachName || 'A Coach'} invited you`}
              note={`${COACHED_MODE_SHORT[myInvites[0].mode]} coaching. ${COACHING_MODE_NOTE[myInvites[0].mode]} Accept to connect.`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flexGrow: 1, flexBasis: 120 }}><Ghost label="Decline" onPress={() => declineCoachInvite(myInvites[0].id)} /></View>
                <View style={{ flexGrow: 2, flexBasis: 180 }}>
                  <Cta label="Accept" wide onPress={async () => {
                    const iv = myInvites[0];
                    // Only switch coaching mode once the server actually made
                    // the link; a refused accept used to move the whole app
                    // into coached mode with no coach behind it.
                    const { mode, ok } = await acceptCoachInvite(iv.id);
                    if (!ok) { Alert.alert('Not connected yet', 'We could not link you to that coach. The invitation is still here — try again in a moment.'); return; }
                    c.setCoachingMode(mode);
                  }} />
                </View>
              </View>
            </Notice>
          ) : null}
        </View>

        {/* ── daily snapshot ──────────────────────────────────────────────
            Four small rings, as the approved mockup draws them: Calories in
            orange, Protein in blue, Water in teal, Steps in purple — the same
            hue each of those four wears on its own screen. A daily briefing,
            still, and not four miniature dashboards: each ring is the lead
            figure of another screen and is a BUTTON to it, so the macro meters,
            the water controls and the step goal stay where they have room.

            All four are always drawn. A brand-new account used to get no fuel
            tile at all (`showFuel`), because a row of dashes looked broken; a
            ring with a dash in it and one line under the row saying what would
            fill it is the opposite of broken — it is the prompt. The lines are
            `snapshotNotes`, above, with the gate each ring answers to. */}
        <Section>
          <SectionHead title="Daily Snapshot" note="Details" onPress={() => router.push('/(client)/habits')} />
          {/* Wraps two and two at the largest text, where four grown rings no
              longer share a card's width; `grown(70)` is the ring's own size. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {snapshot.map((r) => (
              // The ring is a picture; the control is a button that says the
              // figure and where it goes, as the hero's ring does. A row, so
              // the ring's own `flex: 1` fills the cell's WIDTH.
              <Pressable key={r.key} onPress={() => router.push(r.route as any)}
                accessibilityRole="button"
                // The reasons end in their own full stop; a figure does not.
                accessibilityLabel={`${r.spoken.replace(/\.$/, '')}. Open ${r.route.includes('nutrition') ? 'Meals' : r.route.includes('devices') ? 'Devices' : 'Daily Habits'}`}
                style={{ flexGrow: 1, flexBasis: grown(70), minWidth: 0, flexDirection: 'row' }}>
                <MiniRing tone={r.tone} label={r.label} value={r.value} figure={r.figure} spoken={r.spoken} />
              </Pressable>
            ))}
          </View>
          {snapshotNotes.map((line, i) => (
            <Text key={line} style={{ ...ty.micro, ...font('500'), color: t.ink3, marginTop: i === 0 ? sp.md : sp.xs }}>{line}</Text>
          ))}
        </Section>

        {/* ── this week ───────────────────────────────────────────────────
            The mockup's third card: the week as seven bars, the run as a chip
            in the corner. `showWeek` (src/lib/firstRun.ts) still decides
            whether it is drawn at all — hidden on a brand-new account only when
            a SETTLED read says they have never logged, because under a failed
            read an empty log means unknown, and hiding the card would tell
            somebody who has trained for a year that they never have.

            The two titled notices that used to stand over the Today card — the
            log could not be read; there is more log than one read returns —
            are <ChartShell>'s two lines now, inside the card whose bars they
            withhold. Same two situations, same two reassurances (it is not
            zero; nothing is lost), beside the thing they qualify. */}
        {showWeek(facts) ? (
          <Section>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: sp.sm, marginBottom: sp.md }}>
              <Pressable onPress={() => router.push('/(client)/week')} accessibilityRole="button" accessibilityLabel="This Week. Open your week"
                hitSlop={hitSlopFor(26)} style={{ flexShrink: 1 }}>
                <Text style={{ ...ty.section, color: t.ink }}>This Week</Text>
              </Pressable>
              {/* `streak` is the frozen-aware run the banner below also prints
                  — ONE number on this screen. Nothing when the log is not
                  whole: both are 0 then, and a chip reading "0" would be the
                  invented zero the ring beside it refuses. */}
              {streak > 0 ? <TonedChip tone="orange" icon="flame" label={`${num(streak)}-Day Streak`} />
                : bestRun > 0 ? <TonedChip tone="neutral" icon="trophy" label={`Best Run · ${num(bestRun)} ${bestRun === 1 ? 'Day' : 'Days'}`} />
                : null}
            </View>
            {/* `points` is the seven slots, not a count of readings: these are
                bars, and one bar on a Sunday is a drawing — the one-point
                sentence is for a LINE, which needs two ends. */}
            <ChartShell status={logStatus} points={weekBars.length}
              emptyLine="Nothing logged yet this week."
              loadingLine="Reading your training log…"
              errorLine="We couldn’t read your training log, so this week and your streak are not shown — not because they’re zero. Nothing has been lost."
              partialLine="You have more training logged than we can read at once, so this week and your streak are held back rather than counted over part of it. Nothing is missing from your log.">
              <DayBars days={weekBars} spoken={`Movements logged each day this week. ${weekSpoken}.`} />
              {/* A goal is a floor, not a quota — past it the count is still
                  the member's own, and "6 of 3" reads as a fault. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {`${num(wk.days)} of ${num(goalDays)} training days · `}
                {wk.days > goalDays ? `past your goal by ${num(wk.days - goalDays)}`
                  : wk.days === goalDays ? 'goal met'
                  : `${num(goalDays - wk.days)} ${goalDays - wk.days === 1 ? 'day' : 'days'} left this week`}
              </Text>
            </ChartShell>
          </Section>
        ) : null}

        {/* ── coming up: the booking, then the check-in ─────────────────────
            What is left of the Today card. Its adaptive row — Ready to Train,
            Recover Today, Fuel Up — and the session’s exercise and set count are
            the hero now, so repeating them here would be the same action offered
            twice; these two rows are what the hero does not carry. The card is
            absent when neither row applies, rather than a heading over nothing. */}
        {(booksSessions || nextSession || remoteCoached) ? (
        <Section>
          <SectionHead title="Coming Up" />
          {/* ── the rest of today: the booking, then the check-in ─────────────
              Both rows used to sit under the snapshot, among History and
              Challenges, so a session booked for six o'clock this evening was
              drawn BELOW the water count. They belong to the question this card
              answers — what is on today and next — and they are the same two
              rows, with the same gates and the same sentences for a diary that
              could not be read. */}
          {/* `|| nextSession` because a booking is a fact, not a preference: a
              client who switches to online after booking is still expected in
              the room on Thursday, and hiding the row would be how they miss
              it. The row appears to show them what exists; only the invitation
              to book more is gated. */}
          {(booksSessions || nextSession) ? (
            <ListRow icon="calendar"
              // PT green while the diary answered; the quiet circle with an amber
              // icon when it did not, which is a status mark and not decoration.
              tone={nextSession || sessionsKnown || sessionStatus === 'loading' ? 'brand' : t.warn}
              // "No Sessions Booked" is a statement about the member's calendar
              // and only a read that answered may make it. Under a failed or
              // in-flight read the row still appears — the way to the calendar
              // must not disappear when the calendar cannot be read — but it
              // says which of the two it is looking at. 'partial' counts as
              // known here: the provider reads `starts_at` descending before
              // capping, so a truncated page holds the future and drops the
              // ancient history.
              title={nextSession
                // `undefined` as a locale is the reader's device and `appLocale()`
                // is the same handset asked through one place, so these two agreed
                // by luck. The CLOCK did not: it was a 12-hour am/pm formatter
                // hand-built in English, and most of the world reads 24 — see
                // `fmtClock` in src/lib/format.ts.
                ? `Next session · ${new Date(nextSession.startsAt).toLocaleDateString(appLocale(), { weekday: 'short' })} ${fmtTime(nextSession.startsAt)}`
                : sessionsKnown ? 'No Sessions Booked'
                : sessionStatus === 'loading' ? 'Checking Your Sessions'
                : 'Your Sessions Could Not Be Read'}
              note={nextSession
                ? `In person · ${nextSession.durationMin} min with your coach`
                : sessionsKnown ? 'Tap to book an in-person session'
                : sessionStatus === 'loading' ? 'Reading your calendar…'
                : 'This is not a statement that you have none booked. Open your calendar to check before assuming a session is not on.'}
              onPress={() => router.push('/(client)/calendar')} />
          ) : null}

          {remoteCoached ? (
            <ListRow icon="message" tone="blue" title="Weekly Check-in"
              note={booksSessions
                ? 'How the weeks you train alone went — your coach reads it'
                : 'How the week went — your coach only sees what you send'}
              onPress={() => router.push('/(client)/checkin')} />
          ) : null}
        </Section>
        ) : null}

        {/* ── the nudge and the prompt, after the day itself ────────────────
            Motivation and setup, in that order, and under the Today card on
            purpose — see the note on the interrupts above. Neither lost
            anything on the way down: the streak banner keeps both its actions
            and the figure it refuses to print off a partial log, and the card
            still goes straight into setup in one tap. */}
        {(risk.atRisk || needsOnboard) ? (
          <View style={{ marginTop: sp.lg }}>
            {risk.atRisk ? (
              <Notice tone={protectedTonight ? t.brand : t.warn}
                kicker={protectedTonight ? 'Streak protected' : 'Streak at risk'}
                title={protectedTonight ? `A freeze is holding your ${streak}-day streak` : `Your ${streak}-day streak is on the line`}
                note={protectedTonight
                  ? `${freezes} freeze${freezes > 1 ? 's' : ''} in reserve — tonight is covered, but training keeps it growing.`
                  : 'Log one session today to keep it alive.'}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.lg }}>
                  <View style={{ flexGrow: 1, flexBasis: 140 }}><Cta label="Start Now" wide onPress={() => router.push(trainIntent('/(client)/workouts') as any)} /></View>
                  {pushAvailable() ? <View style={{ flexGrow: 1, flexBasis: 180 }}><Ghost label="Remind Me Tonight" onPress={remindTonight} /></View> : null}
                </View>
              </Notice>
            ) : null}

            {needsOnboard ? (
              <Card onPress={() => router.push('/(client)/onboarding')} tone={t.brand} style={{ marginBottom: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <Icon name="sparkle" size={20} color={t.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.head, color: t.ink }}>Personalise your plan</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>One minute — tailors your workouts and meals to you.</Text>
                  </View>
                  <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                </View>
              </Card>
            ) : null}
          </View>
        ) : null}

        {/* Below the first viewport now — the board has nothing between the
            greeting and the goal card — but still one line over three reads, and it is the age of the OLDEST of them:
            the week's training days come off the training log, the next
            booking off the diary, and readiness off the profile, so a single
            stamp is a claim about all three and has to be true of the worst.
            See src/lib/freshness.ts. The Refresh does what pulling down does. */}
        <Fetched at={oldestFetch(logRead.at, sessionsRead.at, bodyRead.at)}
          onRefresh={() => { reloadLog(); void refreshSessions(); c.reload(); }}
          busy={logRead.busy || sessionsRead.busy || bodyRead.busy} />

        {/* ── what you are looking at ─────────────────────────────────────
            One row, shut, and gone for good once it is read. See
            src/ui/ScreenHelp.tsx: the tour explained these tabs before the
            reader had seen one, which is why nobody remembered it. */}
        <ScreenHelp screen="home" />

        {/* ── readiness ───────────────────────────────────────────────────
            Off the snapshot, which is the mockup's four rings now, and drawn
            as what it is — a score out of a hundred — in a ring of its own,
            green, amber or red with the WORD beside it, opening Recovery. */}
        <Section>
          <Pressable onPress={() => router.push('/(client)/recovery')} accessibilityRole="button"
            accessibilityLabel={readiness != null
              ? `Readiness ${num(readiness.score)} out of 100, ${readiness.label}. ${readinessMadeOf(readiness)}. Open Recovery`
              : `Readiness not scored. ${breakdown.absence ?? ''} Open Recovery`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
            <Ring size={76} tone={readinessTone}
              value={readiness != null ? readiness.score / 100 : null}
              figure={readiness != null ? num(readiness.score) : null}
              spoken={readiness != null ? `Readiness ${num(readiness.score)} out of 100` : 'Readiness not scored'} />
            <View style={{ flex: 1, minWidth: 0, gap: sp.xs }}>
              <Text style={{ ...ty.head, color: t.ink }}>Readiness</Text>
              {readiness != null ? <TonedChip tone={readinessTone} label={readiness.label} /> : null}
              {/* What the number is made of, said out loud, EVERY time — not
                  only when a signal is missing. An 83 built from sleep and
                  training alone and an 83 built from all three are different
                  claims. The direction goes FIRST, and only in the 'scored'
                  state: the other three states reach the reader as Flags below
                  or are silent on purpose (see src/lib/readinessDirection.ts).
                  Never render direction.delta as a number here — it is null in
                  every state but 'scored', and `detail` is the figure.

                  The TIP is not here any more: it is the hero's reason line on
                  a day with a session still to do, and advice about a session
                  already trained is prose.

                  Six different reasons there is no score, and they ask the
                  reader for six different things; which one it is, is decided
                  in src/lib/readinessBreakdown.ts and tested there. */}
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                {readiness != null
                  ? `${direction?.state === 'scored'
                      ? direction.detail.charAt(0).toUpperCase() + direction.detail.slice(1) + '. '
                      : ''}${readinessMadeOf(readiness)}.`
                  : breakdown.absence ?? 'Not scored yet.'}
              </Text>
            </View>
            <Icon name={FORWARD_ICON} size={18} color={t.ink3} />
          </Pressable>
          {/* What the score could not see, before the reader acts on it. A
              source that did not answer can only ever have FLATTERED this
              number — every signal readiness scores counts against the member
              — so a night a dead WHOOP token hid is a night that could only
              have pulled the figure down. The score still stands, because the
              nights that were recorded are real, but it is a shorter set than
              it looks and this is where that is said. */}
          {breakdown.caveats.map((cv) => (
            <Flag key={cv} tone={t.warn} style={{ marginTop: sp.sm }}>{cv}</Flag>
          ))}
        </Section>

        {/* ── updates, before tools ────────────────────────────────────────
            What the coach and the gym have said comes ahead of History,
            Challenges and the setup rows: a note is news and is dated, the rows
            under it are doors that are always there. */}
        {/* ── coach note ─────────────────────────────────────────────────── */}
        {(!solo && (coachNotes.length > 0 || !!ann)) ? (<>
          <Section>
            <SectionHead title="From Your Coach" />
            {/* ── when it was said ─────────────────────────────────────────
                Both of these are the NEWEST of their kind and nothing more —
                `latest` is whatever notice the coach posted last, with no
                window on it at all. So a note written six weeks ago sat under
                "From Your Coach" on the first screen of the app every morning
                since, in the present tense, with nothing to date it. A member
                read "Great session today, keep the protein up" as this
                morning's, and a gym's "we are closed Monday" as being about the
                Monday coming.
                Both rows carry `at` and always have; the screen simply did not
                draw it. `agoLabel` is the same wording the body figures use and
                returns null on an unparseable stamp, which draws nothing rather
                than a dash under a sentence. The day is `_todayKey`, which is
                this screen's one clock — so the label re-settles at midnight
                along with everything else rather than ageing a note by a day
                only when something happens to re-render. */}
            {coachNotes.length > 0 ? (<>
              <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={4}>{coachNotes[0].body}</Text>
              {agoLabel(coachNotes[0].at, _todayKey) ? (
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>
                  Your coach wrote this {agoLabel(coachNotes[0].at, _todayKey)}
                </Text>
              ) : null}
            </>) : null}
            {ann ? (<>
              <Text style={{ ...ty.body, color: t.ink2, marginTop: coachNotes.length > 0 ? sp.md : 0 }}>{ann.body}</Text>
              {agoLabel(ann.at, _todayKey) ? (
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>
                  Posted {agoLabel(ann.at, _todayKey)}
                </Text>
              ) : null}
            </>) : null}
          </Section>
        </>) : null}

        {/* ── from the gym ───────────────────────────────────────────────────
            Its own block, under its own heading, and NOT gated on `solo`. A
            gym's notice is addressed to its members, so a member who trains
            without a coach must see it — and it may never appear under "From
            Your Coach", which would put the gym's words in a coach's mouth.
            Only the newest one is here; the rest are one tap away in Notices,
            because a dashboard that grows a noticeboard stops being a
            dashboard. */}
        {gymAnn ? (<>
          <Section>
            <SectionHead title="From Your Gym" note="All notices" onPress={() => router.push('/(client)/notices')} />
            <Text style={{ ...ty.body, color: t.ink2 }}>{gymAnn.body}</Text>
            {/* Dated for the same reason the coach's note is, and it matters
                more here: a gym notice is usually about a DATE — closed Monday,
                new timetable from the 1st — and an undated one read weeks later
                is read about the wrong week. */}
            {agoLabel(gymAnn.at, _todayKey) ? (
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>Posted {agoLabel(gymAnn.at, _todayKey)}</Text>
            ) : null}
          </Section>
        </>) : null}


        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          {/* ── Getting Started ────────────────────────────────────────────
              Reported as "Repple Coach has a Getting Started, however Client
              doesn't have this." What the coach app had was the first-run tour
              firing on a fresh install — a carousel, gone once consumed, and
              findable afterwards only through a User Guide row buried in
              Profile. This row is the persistent answer and it is on the HOME
              screen, because being buried in Profile is the whole of what was
              reported.

              It leaves when the list is finished — a checklist stuck at 6 of 6
              is clutter, and clutter is the complaint. It does NOT leave
              because a read failed: an unknown row keeps it here, which is the
              LoadStatus rule applied to a list of ticks. The screen itself
              stays in the Me hub either way.

              Held back while the "personalise your plan" card is up. That card
              goes straight into setup in one tap and this row's first item is
              the same errand — two prompts for one thing on the first screen a
              new member ever sees is the disease, not the cure. */}
          {showChecklist(started) && !needsOnboard ? (
            <ListRow icon="sparkle" tone="amber" title="Getting Started"
              note={startedNext
                ? `${checklistDone(started)} of ${started.length} done · next, ${startedNext.title.toLowerCase()}`
                : startedLeft === 0
                  ? 'some of this could not be read just now'
                  : `${checklistDone(started)} of ${started.length} done`}
              onPress={() => router.push('/(client)/getting-started')} />
          ) : null}

          <ListRow icon="clock" tone="blue" title="Your History" note="Every month you have trained"
            onPress={() => router.push('/(client)/history')} />

          {/* Beside History because that is where its only other link lives, and
              one link three levels deep is how a feature ships and is never
              found. */}
          <ListRow icon="dumbbell" tone="brand" title="Your Muscles" note="What you worked and how long it has rested"
            onPress={() => router.push('/(client)/muscles')} />

          <ListRow icon="trophy" tone="orange" title="Challenges" note="Your progress against the goal"
            onPress={() => router.push('/(client)/challenges')} />

          {/* Unconditional, and that is the point. The blocks above this list show
              the LATEST notice from a coach or a gym and nothing else, which is
              how "we are closed Monday" used to be readable for one day and
              then nowhere at all. This row is the way back to the older ones,
              and it is here whether or not there is a notice today — a screen
              you can only reach when it has something on it is a screen nobody
              learns exists. */}
          <ListRow icon="info" tone="purple" title="Notices" note="Everything your gym and coach have posted"
            onPress={() => router.push('/(client)/notices')} />

          {needsCoach ? (
            <ListRow icon="people" tone="teal"
              title={solo ? 'Work with a Coach' : 'Find Your Coach'}
              note={solo
                ? "Enter your coach's code, or browse trainers"
                : "Not linked yet — enter their code, accept an invitation, or browse"}
              onPress={() => router.push('/(client)/trainers')} />
          ) : null}

          {/* The search control that was in the header, as a row: the mockup's
              header is the bell and the face. Same route. */}
          <ListRow icon="search" tone="neutral" title="Explore" note="Find anything in the app"
            onPress={() => router.push('/(client)/explore')} />
        </Section>



        {/* ── the four things to do from here ──────────────────────────────
            Below the first viewport, deliberately: the implementation brief
            says no row of equal feature tiles above the fold — Meals and
            Progress are tabs already, and the one action up there is the
            goal card's. These are the quiet way to the rest. */}
        <View style={{ marginTop: sp.md }}>
          <QuickRow items={[
            { icon: 'meals', label: 'Meals', onPress: () => router.push('/(client)/nutrition') },
            { icon: 'moon', label: 'Sleep', onPress: () => router.push('/(client)/recovery') },
            { icon: 'progress', label: 'Progress', onPress: () => router.push('/(client)/scans') },
            // One slot, so it goes to whichever of the three this client
            // actually has: a session to book, a check-in to send, or — with
            // nobody to send it to — their own report.
            booksSessions
              ? { icon: 'calendar' as const, label: 'Book', onPress: () => router.push('/(client)/calendar') }
              : remoteCoached
                ? { icon: 'message' as const, label: 'Check-in', onPress: () => router.push('/(client)/checkin') }
                : { icon: 'chart' as const, label: 'Report', onPress: () => router.push('/(client)/report') },
          ]} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
