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
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, ActionCard, ListRow, Cta, Ghost, QuickRow, Meter, Spark, WeekDots, Notice, Card, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { num, fmtTime } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { macrosFor, applyCoachAdjust, caloriesLeft, caloriesNote, dayBurn } from '../../src/lib/nutrition';
import { buildProgram } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightDeltaIn, kgToLb, type WeightUnit } from '../../src/lib/units';
import { deltaLabel, deltaMoved, movementIsProgress } from '../../src/lib/deltaLabel';
import { shortDayLabel, todayISO } from '../../src/lib/bodyFigures';
import { hitSlopFor } from '../../src/lib/a11y';
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
import { shownStreak, thisWeekStats, personalRecords, streakRisk, freezeBudget } from '../../src/lib/streaks';
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
  showBody, showFuel, showWeek,
  checklist, checklistDone, checklistLeft, nextTodo, showChecklist,
} from '../../src/lib/firstRun';
import { FORWARD_CHAR, FORWARD_ICON } from '../../src/ui/direction';

// The month and weekday names used to be two hardcoded English arrays here,
// rendered as `{DAYS[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]}` on the
// first line of the first screen every member sees every day — in a language
// and an order the reader may not use. Repple is white-label: a gym in Dubai,
// one in London and one in Tokyo run the same binary, so there is no house
// locale to fall back to (src/lib/locale.ts). The date is the handset's now.


export default function Home() {
  const t = useTheme();
  // The unit this client reads weight in. Storage stays metric; this is only
  // ever applied on the way to the screen (TF-37).
  const wu = useSettings().weightUnit;
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const assigned = useAssignedPrograms();
  const { getProgram, status: programStatus } = assigned;
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
  const { water, waterGoal, addWater, removeWater, reload: reloadHabits } = useHabits();
  // Readiness, its inputs and its caveats, from the one shared derivation.
  //
  // This screen used to assemble it here out of five providers, and so did
  // app/(client)/coach.tsx, and the two drifted: the gate on an unreadable
  // training log was written on the coach screen months before this one got it,
  // and until then the home screen's hero ROSE whenever the log failed to load.
  // Recovery is now a third reader — it is where this hero's own tap lands —
  // and three hand copies of one derivation is three chances to disagree about
  // the same number. See src/ui/readiness.ts for what moved and why.
  const { readiness, breakdown } = useReadiness();
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
  const nowMs = useNow().getTime();
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
  const todayIdx = weekIndexOf(new Date());
  const workout = planDays[todayIdx % (planDays.length || 1)] || planDays[0] || { focus: 'Rest Day', exercises: [] };

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
  const prs = personalRecords(log, c.weightSeries);
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
    meal: isWhole(foodLog.status) ? foodLog.entries.length > 0 : (foodLog.entries.length > 0 ? true : null),
    device: wearableKnown ? wearableConnected : null,
    solo,
  });
  const startedLeft = checklistLeft(started);
  const startedNext = nextTodo(started);

  // null until there is a body to scale to. This used to run on the 70 kg /
  // 20% placeholder from clientData and present the result as the client's
  // own daily targets.
  const macros = (c.weightKg != null && c.bodyFatPct != null)
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
  const _todayKey = todayISO();
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
  const kcalLeft = dayCal ? dayCal.net : 0;
  // Only claim somebody is under-recovered when there is a score saying so.
  // Unknown readiness falls through to the ordinary prompts, which assert
  // nothing about their body.
  const today = readiness != null && readiness.tone === 'low'
    ? { headline: 'Recover Today', tip: 'Under-recovered — keep it light or take a rest day.', cta: 'Recovery', route: '/(client)/recovery', tone: t.warn }
    : !trainedToday
    ? { headline: 'Ready to Train', tip: readiness?.tip ?? 'Log tonight’s sleep and your readiness appears here.', cta: 'Start Workout', route: '/(client)/workouts', tone: t.brand }
    : kcalLeft > 200
    ? { headline: 'Fuel Up', tip: dayCal ? caloriesNote(dayCal) + '.' : num(kcalLeft) + ' kcal left today.', cta: 'Log a Meal', route: '/(client)/nutrition', tone: t.brand }
    : { headline: 'On Track', tip: 'Session done and your macros are on point. Nice work.', cta: 'View Plan', route: '/(client)/nutrition', tone: t.brand };

  const ws = c.weightSeries.map((x) => x.v);
  // Whether the scan history behind `ws` is all of it. `c.status` — which this
  // screen already reads for `facts.bodyStatus` — is the profile AND the scans
  // taken together and is not this question; `scansStatus` is, and the weight
  // trend heading below counted the series without asking it. Every other
  // screen that prints a scan count asks it first: my-progress.tsx, records.tsx,
  // social.tsx, cards.tsx and achievements.tsx all gate on `isWhole`.
  const scansWhole = isWhole(c.scansStatus);
  // The same series in the unit this client reads in, converted point by point
  // because each point is a value rather than a change. The filter is only
  // there to satisfy the null contract of `weightIn` — a series entry is always
  // a number, and a null one would have no place on a trend line anyway.
  const wsShown = ws.map((v) => weightIn(v, wu)).filter((v): v is number => v != null);
  const scSort = [...c.scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const scPrev = scSort.length > 1 ? scSort[scSort.length - 2] : null;
  const scLast = scSort[scSort.length - 1];
  const bfD = scPrev && scLast ? +(scLast.bodyFatPct - scPrev.bodyFatPct).toFixed(1) : 0;
  // null unless BOTH scans reported muscle. Read as `?? 0` this used to turn a
  // scan that measured no muscle into a whole body's worth of change overnight.
  const muD = scPrev?.skeletalMuscleKg != null && scLast?.skeletalMuscleKg != null
    ? +(scLast.skeletalMuscleKg - scPrev.skeletalMuscleKg).toFixed(1) : null;
  const wDelta = ws.length > 1 ? +(ws[ws.length - 1] - ws[0]).toFixed(1) : 0;
  // The two body changes in the client's unit. They are converted here and the
  // sign is taken from the converted figure, so that a change too small to show
  // at this grain — 0.2 kg is under half a pound — is reported as no change
  // rather than printed as "−0 lb", the fabricated zero this screen already
  // refuses to show elsewhere. That judgement, and the sign that follows from
  // it, now live in deltaLabel: `good` reads the converted figure too, because
  // a change that rounds away in the reader's own unit is not a direction of
  // travel the app should be marking either way.
  // wDelta comes off the weight series and is always finite, so the null
  // branch of weightDeltaIn cannot be reached here.
  const wDeltaShown = weightDeltaIn(wDelta, wu) ?? 0;
  const muDShown = weightDeltaIn(muD, wu);
  // The day each of those changes is measured FROM. Two different baselines
  // used to sit side by side in the Body row with neither of them named —
  // weight ran from the first check-in on record and body fat from the previous
  // scan — and at caption size they read as one interval. "+2 kg" against what,
  // and since when, is not a question to leave with the person it is about.
  const wSince = ws.length > 1 ? shortDayLabel(c.weightSeries[0].t) : null;
  const scanSince = scPrev ? shortDayLabel(scPrev.takenAt) : null;

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

  const d = new Date();
  const hi = d.getHours() < 12 ? 'Good Morning' : d.getHours() < 18 ? 'Good Afternoon' : 'Good Evening';

  const firstName = (c.name || '').trim().split(' ')[0] || '';
  const kcalNote = macros ? `${num(consumed.kcal)} of ${num(macros.kcal)} kcal` : `${num(consumed.kcal)} kcal eaten — add your weight for a target`;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            {/* A client who has not finished onboarding has no name yet — don't
                render "Good morning," with a dangling comma and nothing after it. */}
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }} numberOfLines={1}>
              {firstName ? `${hi}, ${firstName}` : hi}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
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
          </View>
        </View>

        {/* One line over three reads, and it is the age of the OLDEST of them:
            "This Week" comes off the training log, the next booking off the
            diary, and the body figures off the profile, so a single stamp is a
            claim about all three and has to be true of the worst. See
            src/lib/freshness.ts. The Refresh does what pulling down does. */}
        <Fetched at={oldestFetch(logRead.at, sessionsRead.at, bodyRead.at)}
          onRefresh={() => { reloadLog(); void refreshSessions(); c.reload(); }}
          busy={logRead.busy || sessionsRead.busy || bodyRead.busy} />

        {/* ── what you are looking at ─────────────────────────────────────
            One row, shut, and gone for good once it is read. See
            src/ui/ScreenHelp.tsx: the tour explained these tabs before the
            reader had seen one, which is why nobody remembered it. */}
        <ScreenHelp screen="home" />

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
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 2 }}><Cta label="Get a Safe Plan" wide onPress={() => router.push('/(client)/coach?ask=injury')} /></View>
                <View style={{ flex: 1 }}><Ghost label="Update" onPress={() => router.push('/(client)/injuries')} /></View>
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
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Cta label="Start Now" wide onPress={() => router.push('/(client)/workouts')} /></View>
                {pushAvailable() ? <View style={{ flex: 1 }}><Ghost label="Remind Me Tonight" onPress={remindTonight} /></View> : null}
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
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineCoachInvite(myInvites[0].id)} /></View>
                <View style={{ flex: 2 }}>
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

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Readiness"
          figure={readiness != null ? String(readiness.score) : '—'}
          unit={readiness != null ? '/100' : undefined}
          note={readiness != null
            // What the number is made of, said out loud, EVERY time — not only
            // when a signal is missing. An 83 built from sleep and training
            // alone and an 83 built from all three are different claims, and
            // the member cannot tell them apart from the number; but nor can
            // they tell a full-confidence 83 apart from either, if the only
            // score that explains itself is the incomplete one. The row-by-row
            // account is on Recovery, which is where this hero already taps to.
            ? `${readiness.tip} ${readinessMadeOf(readiness)}.`
            // Six different reasons there is no score, and they ask the reader
            // for six different things. "Log a night of sleep" to somebody
            // whose watch is connected and syncing is the complaint this fixed
            // — it asks them to type what the device already knows — and the
            // same sentence to somebody whose LOG merely failed to load is a
            // statement about their week made out of our failed read. Which
            // one it is, is decided in src/lib/readinessBreakdown.ts and
            // tested there.
            : breakdown.absence ?? undefined}
          arc={readiness != null ? readiness.score / 100 : undefined}
          arcLabel="readiness"
          tone={readiness != null ? readinessColor : undefined}
          onPress={() => router.push('/(client)/recovery')}
        />

        {/* What the score could not see, before the reader acts on it.

            A source that did not answer can only ever have FLATTERED this
            number: every signal readiness scores counts against the member —
            sleep short of eight hours, water short of the goal, sessions in the
            last two days — so a night a dead WHOOP token hid is a night that
            could only have pulled the figure down. The score still stands,
            because the nights that were recorded are real, but it is a shorter
            set than it looks and this is where that is said. Recovery has been
            saying it about the same devices all along, one tap away, while this
            screen printed the number bare. */}
        {breakdown.caveats.map((c) => (
          <Flag key={c} tone={t.warn} style={{ marginBottom: sp.md }}>{c}</Flag>
        ))}

        <Rule />

        {/* Said before the card, because the card is what the reader acts on. */}
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

        {/* ── the one card: today's action ────────────────────────────────── */}
        <Section>
          {/* The header follows the card. When the adaptive call is "fuel up" or
              "recover", naming today's muscle group here made the header and the
              card underneath talk about two different things. */}
          <SectionHead
            title={today.route.includes('workouts') ? `Today · ${workout.focus}` : 'Today'}
            // "6 of 3 this week" is arithmetically true and reads as a bug.
            // A goal is a floor, not a quota, and a client who trained twice as
            // often as they meant to should not be shown a fraction that looks
            // like a rendering fault. Past the goal it says so instead; the
            // count itself is never hidden, because the number they earned is
            // the point.
            note={!logKnown ? undefined
              : wk.workouts > goalDays ? `${wk.workouts} this week · goal was ${goalDays}`
                : wk.workouts === goalDays ? `${wk.workouts} of ${goalDays} this week · goal met`
                  : `${wk.workouts} of ${goalDays} this week`}
          />
          <ActionCard
            ring={logKnown && goalDays ? wk.workouts / goalDays : 0}
            ringLabel={logKnown ? String(streak) : fig(null)}
            // The number is a day streak and the ring is this week's sessions —
            // neither is about the meal this card is asking you to log.
            ringNote={logKnown ? (streak === 1 ? 'day streak' : 'day streak') : 'streak'}
            title={today.headline}
            note={today.tip}
            cta={today.cta}
            tone={today.tone}
            onPress={() => router.push(today.route as any)}
          />
        </Section>

        {/* ── body ─────────────────────────────────────────────────────────
            Withheld while nothing has been measured AND the read settled —
            three dashes under three labels on the first screen of a new app is
            what "too complicated" looks like. Progress is a tab and the quick
            actions still point at it, so nothing becomes unreachable. */}
        {showBody(facts) ? (<>
        <Rule />
        <Section>
          <SectionHead title="Body" note="Scans" onPress={() => router.push('/(client)/scans')} />
          <KpiRow
            onPress={() => router.push('/(client)/scans')}
            items={[
              // `good` was `wDelta <= 0` on every one of these: the app decided
              // that down is better whoever is reading it. A member whose goal
              // is Build Muscle was shown the accent dot — the app's "well
              // done" — for losing the weight they are training to put on, and
              // an unchanged reading got it too. `movementIsProgress` asks
              // their own goal, and returns undefined where the goal does not
              // settle it, which draws a neutral mark rather than a verdict.
              { label: 'Weight', value: fig(weightIn(c.weightKg, wu)), unit: wu, route: '/(client)/scans', good: movementIsProgress(wDeltaShown, c.goal, 'weight'), delta: deltaMoved(wDeltaShown) ? deltaLabel(wDeltaShown, { since: wSince, unit: wu }) : undefined },
              // Body fat is a proportion of the body, not an amount of it, and
              // stays a percentage under every unit preference. Nothing on this
              // line converts.
              { label: 'Body Fat', value: fig(c.bodyFatPct), unit: '%', route: '/(client)/scans', good: movementIsProgress(bfD, c.goal, 'bodyFat'), delta: deltaMoved(bfD) ? deltaLabel(bfD, { since: scanSince, unit: '%' }) : undefined },
              { label: 'Muscle', value: fig(weightIn(c.muscleKg, wu)), unit: wu, route: '/(client)/scans', good: movementIsProgress(muDShown, c.goal, 'muscle'), delta: deltaMoved(muDShown) ? deltaLabel(muDShown, { since: scanSince, unit: wu }) : undefined },
            ]}
          />
        </Section>
        </>) : null}

        {/* ── weight trend ───────────────────────────────────────────────── */}
        {ws.length > 1 ? (<>
          <Rule />
          <Section>
            {/* The count is dropped when the scan read is not whole, and only
                the count. `cd.scansStatus` answers 'partial' when the scan read
                came back at PostgREST's ceiling (src/ui/clientData.tsx reads
                `taken_at desc` at `capLimit()`), and "1,000 check-ins" is then
                a count over an unknown fraction of somebody's own history,
                rendered as fact — the one thing src/ui/loadStatus.ts says a
                screen may never do with a 'partial' set. The delta beside it
                survives because it names the day it is measured from and is
                therefore a true statement about a real interval, whatever else
                is missing; the count names no interval and cannot be read as
                anything but a total. The line under the chart says what is
                missing rather than leaving the heading quietly shorter. */}
            <SectionHead title={scansWhole ? `Weight · ${ws.length} check-ins` : 'Weight'}
              // Named from the day the series starts. A bare "1.2 kg" over a
              // heading counting check-ins is a figure with no interval on it.
              note={deltaLabel(wDeltaShown, { since: wSince, unit: wu })}
              onPress={() => router.push('/(client)/scans')} />
            <Spark data={wsShown} labels={c.weightSeries.map((x) => x.t)} unit={` ${wu}`} />
            {!scansWhole ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {c.scansStatus === 'loading'
                  ? 'Still reading your check-ins, so they aren’t counted here yet.'
                  : c.scansStatus === 'partial'
                    ? 'You have more check-ins on record than we can read at once, so this is the most recent part of them and they aren’t counted here. Nothing has been lost.'
                    : 'Your check-ins couldn’t all be read, so they aren’t counted here. This is not a shorter history — it is one we couldn’t open in full.'}
              </Text>
            ) : null}
          </Section>
        </>) : null}

        {/* ── fuel ─────────────────────────────────────────────────────────
            `macros` is null for want of a weight, and this section then drew a
            heading, a note explaining its own emptiness, and no meters. The
            ask belongs on the body step of setup and on the Meals tab, not as
            a section that exists to say why it has nothing in it. */}
        {showFuel(facts) && macros ? (<>
        <Rule />
        <Section>
          <SectionHead title="Fuel Today" note={kcalNote} onPress={() => router.push('/(client)/nutrition')} />
          <Meter label="Protein" val={consumed.p} target={macros.protein} />
          <Meter label="Carbs" val={consumed.cbs} target={macros.carbs} dim />
          <Meter label="Fat" val={consumed.f} target={macros.fat} dim />
        </Section>
        </>) : null}

        <Rule />

        {/* ── water ──────────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Water</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 5 }}>
                <Text style={{ ...value(22), color: t.ink }}>{water}</Text>
                {/* "of 8 glasses" was a platform constant read as this client's
                    own target. With no goal set there is no denominator to
                    print — not "of null glasses", and not a fallback eight —
                    so the count stands on its own and the line below offers
                    the screen that sets one. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginStart: 3 }}>
                  {waterGoal != null ? `of ${waterGoal} glasses` : water === 1 ? 'glass today' : 'glasses today'}
                </Text>
              </View>
              {waterGoal == null ? (
                <Pressable onPress={() => router.push('/(client)/habits')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Set a daily water goal">
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>Set a daily goal {FORWARD_CHAR}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              {/* 36pt drawn, 44pt to the finger. These two are the smallest
                  controls on the home screen and the ones most likely to be
                  hit one-handed with a wet hand mid-session, which is the case
                  MIN_TARGET in src/lib/a11y.ts is written for. `hitSlopFor`
                  leaves the drawing alone — growing the circles would push the
                  whole water row apart — and moves only the boundary the finger
                  has to find. The two sit `sp.sm` (8pt) apart and the slop is
                  4pt a side, so the regions meet in the middle of the gap and
                  never overlap: every point still belongs to exactly one of
                  them, which on a minus beside a plus is the property that
                  matters. */}
              <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={removeWater}
                hitSlop={hitSlopFor(36)}
                style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="minus" size={16} color={t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Add a glass of water" accessibilityRole="button" onPress={addWater}
                hitSlop={hitSlopFor(36)}
                style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={16} color={t.brandInk} />
              </Pressable>
            </View>
          </View>
        </Section>

        {/* ── this week ────────────────────────────────────────────────────
            Gated on the log ever holding anything, not on THIS week: somebody
            who trains Monday and Tuesday and opens the app on a Sunday has an
            empty week and eleven months behind it. Under an unsettled read it
            stays, dashes and all, beside the warning printed above. */}
        {showWeek(facts) ? (<>
        <Rule />
        <Section>
          <SectionHead title="This Week" note="All activity" onPress={() => router.push('/(client)/trends')} />
          <KpiRow items={[
            { label: 'Sessions', value: logKnown ? fig(wk.workouts) : fig(null), unit: logKnown ? `/${goalDays}` : undefined },
            // `(0).toLocaleString()` is the string "0" — a tonnage stated as
            // measured, with no hint that nothing was measured.
            // Tonnage is a weight like any other — a client who loads the bar
            // in pounds should be told what they shifted in pounds. Rounded to
            // a whole unit either way, because nobody reads a week's volume to
            // the tenth.
            { label: 'Lifted', value: logKnown ? Math.round(wu === 'lb' ? kgToLb(wk.volumeKg) : wk.volumeKg).toLocaleString() : fig(null), unit: logKnown ? wu : undefined },
            { label: 'New PRs', value: logKnown ? fig(prs.length) : fig(null) },
          ]} />
          <WeekDots done={logKnown ? wk.days : 0} />
        </Section>
        </>) : null}

        <Rule />

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
            {coachNotes.length > 0 ? (
              <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={4}>{coachNotes[0].body}</Text>
            ) : null}
            {ann ? (
              <Text style={{ ...ty.body, color: t.ink2, marginTop: coachNotes.length > 0 ? sp.md : 0 }}>{ann.body}</Text>
            ) : null}
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
          </Section>
        </>) : null}

        <Rule />

        {/* ── quick actions ──────────────────────────────────────────────── */}
        <Section>
          <QuickRow items={[
            { icon: 'plus', label: 'Log', onPress: () => router.push('/(client)/workouts') },
            { icon: 'meals', label: 'Food', onPress: () => router.push('/(client)/foodlog') },
            // One slot, so it goes to whichever of the three this client
            // actually has: a session to book, a check-in to send, or — with
            // nobody to send it to — their own report.
            booksSessions
              ? { icon: 'calendar' as const, label: 'Book', onPress: () => router.push('/(client)/calendar') }
              : remoteCoached
                ? { icon: 'message' as const, label: 'Check-in', onPress: () => router.push('/(client)/checkin') }
                : { icon: 'chart' as const, label: 'Report', onPress: () => router.push('/(client)/report') },
            { icon: 'camera', label: 'Photo', onPress: () => router.push('/(client)/scans') },
          ]} />
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
