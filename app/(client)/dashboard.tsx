// Client · Home — the daily briefing: readiness, today's session, body stats,
// weight trend, fuel, this week, and the things that need attention.
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
import { weekIndexOf } from '../../src/lib/weekStart';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, ScrollView, Pressable, Alert, Image } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ScreenHeader, KpiRow, ListRow, Cta, Ghost, QuickRow, Notice, Card, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, hairline } from '../../src/theme/scale';
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
import { shownStreak, thisWeekStats, streakRisk, freezeBudget } from '../../src/lib/streaks';
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
  showFuel, showWeek,
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
  const { water, waterGoal, reload: reloadHabits } = useHabits();
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
  const readinessColor = readiness == null ? t.ink3 : readiness.tone === 'good' ? t.brand : readiness.tone === 'moderate' ? t.warn : t.crit;
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
  const dayCal = macros ? caloriesLeft(macros.kcal, consumed.kcal, burn?.burned ?? 0, burn?.budgeted ?? 0, burn?.kind) : null;
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
            <Ghost icon="search" label={undefined} onPress={() => router.push('/(client)/explore')} />
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
              hitSlop={hitSlopFor(36)}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {avatarSource(c.photo) ? (
                <Image source={{ uri: avatarSource(c.photo)! }} style={{ width: 36, height: 36 }} accessibilityIgnoresInvertColors />
              ) : c.init ? (
                <Text style={{ ...ty.caption, fontWeight: '700', color: t.brandInk }}>{c.init}</Text>
              ) : (
                <Icon name="me" size={16} color={t.brandInk} />
              )}
            </Pressable>
          </>}
        />

        {/* ── the week's goal, and the one thing to do about it ────────────
            The approved board opens Home on a single card: this week's goal as
            a ring, the count beside it, and the day's primary action under
            both. It replaces the readiness hero, the action card's own ring
            and the This Week tiles that used to say the same number three
            times down the screen.

            Counted in DAYS against a goal counted in days — see the note on
            `wk` above, and the one that was on the action card's ring: a
            member who trained once and logged seven movements is one day in,
            not seven. Withheld, ring and all, when the log is not whole: an
            empty ring over "0 of 4" is a claim about the member's week that a
            failed or capped read cannot make, and the two Notices further down
            say which of the two it was. */}
        <View style={{ marginTop: sp.lg, backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.ring, padding: sp.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Weekly Goal</Text>
              <Text style={{ ...ty.head, color: t.ink, marginTop: sp.sm }}>
                {logKnown ? `${wk.days} of ${goalDays} training days` : 'This week could not be counted'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                {!logKnown
                  ? 'Your log could not be read in full, so nothing here is guessed.'
                  // A goal is a floor, not a quota — past it the count is
                  // still the member's own, and "6 of 3" reads as a fault.
                  : wk.days > goalDays ? `Past your goal by ${wk.days - goalDays} · keep it up`
                  : wk.days === goalDays ? 'Goal met · keep the momentum going'
                  : `${goalDays - wk.days} ${goalDays - wk.days === 1 ? 'day' : 'days'} left this week`}
              </Text>
            </View>
            {/* The ring is decoration over the figure inside it, so the
                control is a button that says the figure and where it goes —
                not a progressbar, which a reader cannot tap. */}
            <Pressable onPress={() => router.push('/(client)/week')} accessibilityRole="button"
              accessibilityLabel={logKnown
                ? `${wk.days} of ${goalDays} training days this week. Open This Week`
                : 'This week could not be counted. Open This Week'}
              hitSlop={8}
              style={{ width: 62, height: 62, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={62} height={62} viewBox="0 0 62 62" style={{ position: 'absolute' }}
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Circle cx="31" cy="31" r="26" fill="none" stroke={t.surface2} strokeWidth={6} />
                {logKnown ? (
                  <Circle cx="31" cy="31" r="26" fill="none" stroke={t.brand} strokeWidth={6} strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 26}
                    strokeDashoffset={2 * Math.PI * 26 * (1 - Math.min(1, wk.days / Math.max(1, goalDays)))}
                    transform="rotate(-90 31 31)" />
                ) : null}
              </Svg>
              <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                {logKnown ? `${wk.days}/${goalDays}` : fig(null)}
              </Text>
            </Pressable>
          </View>
          <View style={{ marginTop: sp.lg }}>
            <Cta label={today.cta} wide tone={today.tone} onPress={() => router.push(trainIntent(today.route) as any)} />
          </View>
        </View>

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {/* First, because it changes how everything under it should be read.
              It deliberately promises nothing about anything being sent later:
              whether a particular write is queued is a fact about that write,
              and src/lib/outbox.ts owns saying so. */}
          {offline ? (
            <Notice tone={t.warn} kicker="Offline" title="Showing what this phone already had" note={offline} />
          ) : null}

          {waiting.length > 0 ? (
            <Notice tone={t.warn} kicker="Waiting to send"
              title={waiting.length === 1 ? 'One thing is still on this phone' : 'Some things are still on this phone'}
              note={waiting.join(' ')} />
          ) : null}

          {lapsedKinds.map((k) => (
            <Notice key={`lapsed-${k}`} tone={t.warn} kicker="Not sent"
              title="Something waited too long to send" note={lapsedNote(k)}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Ghost label="Got It" onPress={() => outbox?.clearLapsed()} /></View>
              </View>
            </Notice>
          ))}
          {needsOnboard ? (
            <Card onPress={() => router.push('/(client)/onboarding')} tone={t.brand} style={{ marginBottom: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <Icon name="sparkle" size={20} color={t.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Personalise your plan</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>One minute — tailors your workouts and meals to you.</Text>
                </View>
                <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
              </View>
            </Card>
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


        {/* ── whose copy today's focus was drawn from ──────────────────────
            Said before the card, for the same reason the notice below it is:
            the card is what the reader acts on. `getProgram` serves this
            device's copy when no read has landed, and keeps serving it for
            THIRTY DAYS (src/lib/programCache.ts) — so "Today · Push" and the
            session on the card can be last month's block with nothing here to
            doubt it, and the notice below is suppressed exactly then, because
            the cache is what made `coachProgram` non-null.

            Non-null only while the copy is what is being served —
            `mayServeCached` decides that — so no gate of its own, and it goes
            the moment a live read lands. Same sentence, same position, as
            app/(client)/week.tsx :194. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{cachedNote}</Flag> : null}
        {programUnknown ? (
          <Notice tone={t.warn} kicker="Today" title="We couldn’t check for a coach plan"
            note={`Today's focus below comes from ${BRAND.label}'s automatic program. If your coach has assigned you one it takes over as soon as we can read it.`} />
        ) : null}
        {logStatus === 'error' ? (
          <Notice tone={t.warn} kicker="Today" title="We couldn’t read your training log"
            note="Your streak and this week's sessions are shown as dashes because we can't see them — not because they're zero. Nothing has been lost." />
        ) : logStatus === 'partial' ? (
          // A separate sentence, because it is a separate situation and the
          // reader's question is different: nothing failed, there is simply
          // more history than one read returns, and a streak or a total taken
          // over the part that came back would be wrong by however much did
          // not. Only the FIGURES are withheld — everything on this screen
          // driven by the sessions themselves is unaffected.
          <Notice tone={t.warn} kicker="Today" title="You have more training logged than we can read at once"
            note="Your streak, this week's sessions, your tonnage and your PRs are shown as dashes because they would be counted over part of your history rather than all of it. Nothing is missing from your log." />
        ) : null}
        {/* Fuel Today is simply absent when its inputs could not be read, which
            is right — a meter drawn from the defaults would be somebody else's
            day — but absent on its own reads as "you have no targets". This
            says which read is missing. Not shown while one is still in flight:
            an apology for a request that is proceeding normally is a nag. */}
        {targetInputsUnknown && c.profileStatus !== 'loading' && coachNutrition.status !== 'loading' ? (
          !isWhole(c.profileStatus) ? (
            <Notice tone={t.warn} kicker="Today" title="We couldn’t read what you are training for"
              note="Your goal and how you eat are what split a day into protein, carbs and fat, so Fuel Today is left out rather than drawn from the defaults. Pull down to try again." />
          ) : (
            <Notice tone={t.warn} kicker="Today" title="We couldn’t read your coach’s adjustment"
              note="Fuel Today is left out rather than showing the uncorrected figures as your plan. Pull down to try again." />
          )
        ) : null}

        {/* ── the one card: today's action ────────────────────────────────── */}
        <Section>
          {/* The header follows the card. When the adaptive call is "fuel up" or
              "recover", naming today's muscle group here made the header and the
              card underneath talk about two different things. */}
          {/* No week count on this line any more: the goal card at the top
              says it, in days against a goal counted in days (`wk.days`, never
              `wk.workouts`, which is one log entry per EXERCISE), and a second
              copy three inches under the first is the clutter this redesign
              exists to remove. */}
          <SectionHead title={today.route.includes('workouts') ? `Today · ${workout.focus}` : 'Today'} />
          {/* One row, not a second card: the ring and the button it used to
              carry are on the goal card at the top of the screen now, and a
              card here would be the same action offered twice. The row keeps
              the adaptive headline — Ready to Train, Recover Today, Fuel Up —
              and the sentence under it, which is what changes day to day. */}
          <ListRow
            icon={today.route.includes('nutrition') ? 'meals' : today.route.includes('recovery') ? 'heart' : 'train'}
            title={today.headline}
            note={today.tip}
            tone={today.tone}
            onPress={() => router.push(trainIntent(today.route) as any)}
          />
          {/* ── what you are actually in for ─────────────────────────────────
              Nike Training Club, Strava and TrueCoach all put the SHAPE of a
              session in front of the button that starts it — how many
              movements, how much work — and this card said "Ready to Train"
              over the word "Push" and nothing else. A member deciding at
              21:40 whether they have time for this had no way to tell a
              four-exercise accessory day from an eleven-exercise one without
              opening it.

              Counted, never estimated. There is no duration model in this
              codebase and inventing one here would be exactly the fabricated
              figure the rest of this screen refuses: "about 45 min" over a
              session nobody has timed is a number with nothing behind it.
              The exercise count and the set total ARE facts — they are the
              plan, in hand, already being rendered on the Train tab — and a
              reader can price their own evening from them.

              Drawn only under the training card, because it describes the
              thing that card starts; and only where there is a session, so the
              Rest Day fallback and an empty coach block draw nothing. The
              cardio line comes along when the day has one, since a 20-minute
              interval finish is most of what somebody is deciding about. */}
          {today.route.includes('workouts') && workoutSetCount != null ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {workout.exercises.length === 1 ? '1 exercise' : `${workout.exercises.length} exercises`}
              {workoutSetCount > 0 ? ` · ${workoutSetCount === 1 ? '1 set' : `${workoutSetCount} sets`}` : ''}
              {workout.cardio ? ` · ${workout.cardio}` : ''}
            </Text>
          ) : null}
        </Section>

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

        {/* ── daily snapshot ──────────────────────────────────────────────
            A daily briefing, not four miniature dashboards. The body figures,
            the weight chart, the macro meters, the water controls and the
            week's tonnage each had a section here, and every one of them is
            the lead figure of another tab — Progress, Meals, Habits, This
            Week — where it is drawn with the room it needs. What stays is one
            readiness row and one KPI row, each figure tappable to the screen
            that owns it, so nothing became unreachable and nothing here
            competes with the card at the top.

            The first-run rules still apply. `showWeek` and `showFuel` (see
            src/lib/firstRun.ts) withhold a tile that would be a dash on a
            brand-new account — and only on a SETTLED read, because a dash
            under a failed read is the honest answer and hiding it would tell
            somebody who has trained for a year that they never have. */}
        <Section>
          <SectionHead title="Daily Snapshot" note="Your progress" onPress={() => router.push('/(client)/scans')} />
          <ListRow
            icon="heart"
            title={readiness != null ? `Readiness · ${readiness.score}/100` : 'Readiness'}
            // What the number is made of, said out loud, EVERY time — not only
            // when a signal is missing. An 83 built from sleep and training
            // alone and an 83 built from all three are different claims. The
            // direction goes FIRST, and only in the 'scored' state: the other
            // three states reach the reader as Flags below or are silent on
            // purpose (see src/lib/readinessDirection.ts). Never render
            // direction.delta as a number here — it is null in every state
            // but 'scored', and `detail` is the figure.
            //
            // Six different reasons there is no score, and they ask the reader
            // for six different things; which one it is, is decided in
            // src/lib/readinessBreakdown.ts and tested there.
            note={readiness != null
              ? `${direction?.state === 'scored'
                  ? direction.detail.charAt(0).toUpperCase() + direction.detail.slice(1) + '. '
                  : ''}${readiness.tip} ${readinessMadeOf(readiness)}.`
              : breakdown.absence ?? undefined}
            tone={readinessColor}
            onPress={() => router.push('/(client)/recovery')}
          />
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
          {(showWeek(facts) || showFuel(facts)) ? (
            <View style={{ marginTop: sp.lg }}>
              <KpiRow
                onPress={(item) => { if (item.route) router.push(item.route as any); }}
                items={[
                  // Days, against a goal counted in days — the same pair the
                  // card at the top draws, and for the same reason.
                  ...(showWeek(facts) ? [{
                    label: 'Training',
                    value: logKnown ? fig(wk.days) : fig(null),
                    unit: logKnown ? `/${goalDays} days` : undefined,
                    delta: !logKnown ? 'log not read in full'
                      : wk.days >= goalDays ? 'goal met this week'
                      : `${goalDays - wk.days} more this week`,
                    good: logKnown && wk.days >= goalDays,
                    route: '/(client)/trends',
                  }] : []),
                  // `dayCal.net`, the one calorie sum the Meals tab and the
                  // Food Log also read — never a kcalLeft defaulted to zero.
                  // Non-null exactly when `macros` is, which `showFuel` has
                  // already checked.
                  ...(showFuel(facts) && dayCal ? [{
                    label: 'Fuel',
                    value: num(Math.abs(dayCal.net)),
                    unit: 'kcal',
                    delta: dayCal.net >= 0 ? 'left today' : 'over today’s target',
                    route: '/(client)/nutrition',
                  }] : []),
                  // "of 8 glasses" was a platform constant read as this
                  // client's own target. With no goal set there is no
                  // denominator to print — the count stands on its own and
                  // the tap lands on the screen that sets one, which is also
                  // where the add and remove controls now live.
                  {
                    label: 'Water',
                    value: fig(water),
                    unit: water === 1 ? 'glass' : 'glasses',
                    delta: waterGoal != null ? `of ${waterGoal} a day` : 'set a daily goal',
                    good: waterGoal != null && water >= waterGoal,
                    route: '/(client)/habits',
                  },
                ]}
              />
            </View>
          ) : null}
        </Section>


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
            <ListRow icon="sparkle" title="Getting Started"
              note={startedNext
                ? `${checklistDone(started)} of ${started.length} done · next, ${startedNext.title.toLowerCase()}`
                : startedLeft === 0
                  ? 'some of this could not be read just now'
                  : `${checklistDone(started)} of ${started.length} done`}
              onPress={() => router.push('/(client)/getting-started')} />
          ) : null}

          {/* `|| nextSession` because a booking is a fact, not a preference: a
              client who switches to online after booking is still expected in
              the room on Thursday, and hiding the row would be how they miss
              it. The row appears to show them what exists; only the invitation
              to book more is gated. */}
          {(booksSessions || nextSession) ? (
            <ListRow icon="calendar"
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
            <ListRow icon="message" title="Weekly Check-in"
              note={booksSessions
                ? 'How the weeks you train alone went — your coach reads it'
                : 'How the week went — your coach only sees what you send'}
              onPress={() => router.push('/(client)/checkin')} />
          ) : null}

          <ListRow icon="clock" title="Your History" note="Every month you have trained, back to the start"
            onPress={() => router.push('/(client)/history')} />

          {/* Beside History because that is where its only other link lives, and
              one link three levels deep is how a feature ships and is never
              found. */}
          <ListRow icon="dumbbell" title="Your Muscles" note="What you worked, on the body, and how long it has rested"
            onPress={() => router.push('/(client)/muscles')} />

          <ListRow icon="trophy" title="Challenges" note="Track your progress against the goal"
            onPress={() => router.push('/(client)/challenges')} />

          {/* Unconditional, and that is the point. The block further down shows
              the LATEST notice from a coach or a gym and nothing else, which is
              how "we are closed Monday" used to be readable for one day and
              then nowhere at all. This row is the way back to the older ones,
              and it is here whether or not there is a notice today — a screen
              you can only reach when it has something on it is a screen nobody
              learns exists. */}
          <ListRow icon="info" title="Notices" note="Everything your gym and your coach have posted"
            onPress={() => router.push('/(client)/notices')} />

          {needsCoach ? (
            <ListRow icon="people"
              title={solo ? 'Work with a Coach' : 'Find Your Coach'}
              note={solo
                ? "Enter your coach's code, or browse trainers"
                : "You have not been linked to a coach yet — enter their code, accept an invitation, or browse trainers"}
              onPress={() => router.push('/(client)/trainers')} />
          ) : null}
        </Section>

        {/* ── coach note ─────────────────────────────────────────────────── */}
        {(!solo && (coachNotes.length > 0 || !!ann)) ? (<>
          <Rule />
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
          <Rule />
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
