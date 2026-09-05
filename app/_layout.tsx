import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import * as Updates from 'expo-updates';
import { sayUpdateCheck, whyFailed } from '../src/lib/updateCheck';
import { reportError } from '../src/lib/reportError';
import { addNotificationTapListener } from '../src/ui/pushNotifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientDataProvider } from '../src/ui/clientData';
import { WearablesProvider } from '../src/ui/wearables';
import { BadgeWatchProvider } from '../src/ui/badgeWatch';
import { NotifyPrefsProvider } from '../src/ui/notifyPrefs';
import { ReminderSyncProvider } from '../src/ui/reminderSync';
import { MotivationNudgeProvider } from '../src/ui/motivationNudges';
import { DeviceSleepProvider } from '../src/ui/deviceSleep';
import { SessionsProvider } from '../src/ui/sessions';
import { WorkoutLogProvider } from '../src/ui/workoutLog';
import { MyTrainerProfileProvider } from '../src/ui/coachProfile';
import { RosterProvider } from '../src/ui/roster';
import { CoachDeliveryProvider } from '../src/ui/coachDelivery';
import { InjuryAcksProvider } from '../src/ui/injuryAcks';
import { AssignedProgramsProvider } from '../src/ui/assignedPrograms';
import { CoachFeedbackProvider } from '../src/ui/feedback';
import { CoachNutritionProvider } from '../src/ui/coachNutrition';
import { PlatformTrainersProvider } from '../src/ui/trainers';
import { MeasurementsProvider } from '../src/ui/measurements';
import { PromosProvider } from '../src/ui/promos';
import { GoalTrackerProvider } from '../src/ui/goalTracker';
import { CoachNotesProvider } from '../src/ui/coachNotes';
import { AnnouncementsProvider } from '../src/ui/announcements';
import { WellnessProvider } from '../src/ui/wellness';
import { OwnerOpsProvider } from '../src/ui/ownerOps';
import { SettingsProvider } from '../src/ui/settings';
import { HabitsProvider } from '../src/ui/habits';
import { CheckInsProvider } from '../src/ui/checkins';
import { FoodLogProvider } from '../src/ui/foodLog';
import { InvitesProvider } from '../src/ui/invites';
import { TrainerInvitesProvider } from '../src/ui/trainerInvites';
import { ClientTagsProvider } from '../src/ui/clientTags';
import { ChallengesProvider } from '../src/ui/challenges';
import { ProgramTemplatesProvider } from '../src/ui/programTemplates';
import { ClassesProvider } from '../src/ui/classes';
import { AuthProvider } from '../src/ui/auth';
import { AppState } from 'react-native';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { AppLockProvider } from '../src/ui/appLock';
import { ToastProvider } from '../src/ui/toast';
import { LockGate } from '../src/ui/LockScreen';
import { useAuth } from '../src/ui/auth';
import { AppThemeProvider, useTheme } from '../src/ui/components';
import { BrandProvider } from '../src/ui/brand';
import { TenantProvider } from '../src/ui/tenant';
import { OutboxProvider } from '../src/ui/outbox';
import { ReachabilityProbe } from '../src/ui/reachability';
import { OfflineFlush } from '../src/ui/offlineFlush';
import { MessageOutboxHandler } from '../src/ui/messaging';

function ThemedStack() {
  const t = useTheme();
  const router = useRouter();
  // Tapping a notification (reminder or coach push) opens the right screen.
  useEffect(() => addNotificationTapListener((route) => { try { router.push(route as any); } catch { /* ignore */ } }), []);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}

// Auto-apply any already-published OTA update immediately on launch instead
// of silently downloading it in the background and waiting for the NEXT app
// open to run it. Without this, every fix we ship needs two full closes +
// reopens before a tester actually sees it, which reads as "the fix didn't
// work" when it's really just normal (if confusing) expo-updates behavior.
function useApplyUpdateOnLaunch() {
  useEffect(() => {
    // Recorded, not swallowed. The previous version of this effect ended in
    // `catch {}` with a comment reading "offline or check failed", which is two
    // different situations, and neither reached the phone's own Build screen.
    // Four devices then sat on stale bundles for a morning while thirteen
    // publishes reported success, and nothing on any of them could say whether
    // the check had run at all. src/lib/updateCheck.ts has the full account.
    if (!Updates.isEnabled) { sayUpdateCheck({ state: 'disabled' }); return; } // dev build / Expo Go
    (async () => {
      try {
        sayUpdateCheck({ state: 'checking', at: Date.now() });
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) {
          // Said out loud on purpose. "Already up to date" and "never checked"
          // are the two this screen exists to tell apart, and they are
          // indistinguishable unless the first one is stated.
          sayUpdateCheck({ state: 'current', at: Date.now() });
          return;
        }
        sayUpdateCheck({ state: 'downloading', at: Date.now() });
        await Updates.fetchUpdateAsync();
        // ── not while somebody is typing into it ──────────────────────
        //
        // `reloadAsync()` tears the whole tree down and starts it again. On a
        // fast connection this lands within the launch and nobody sees it. On a
        // slow one the download outlasts the launch by tens of seconds, and the
        // reload then arrived on top of whatever the person had gone on to do:
        // a half-written message, a set being logged, a form filled in and not
        // yet submitted. None of that survives a reload, and none of it is in
        // an outbox until it is sent.
        //
        // So the bundle is applied only while the app is in the FOREGROUND at
        // the moment the download finishes — which is the launch case this
        // effect was written for — and otherwise on the next launch, which is
        // the ordinary expo-updates behaviour and is already downloaded by
        // then. The Build screen is told either way, because "downloaded, will
        // apply next launch" and "never checked" are exactly the two states
        // src/lib/updateCheck.ts exists to tell apart.
        if (AppState.currentState !== 'active') {
          sayUpdateCheck({ state: 'ready', at: Date.now() });
          return;
        }
        sayUpdateCheck({ state: 'applying', at: Date.now() });
        await Updates.reloadAsync();
      } catch (e) {
        // Offline is ordinary and stays quiet in the crash log; anything else
        // is worth reporting. Both are shown on the Build screen either way,
        // because the person who can see this phone is the one who can act.
        const why = whyFailed(e);
        sayUpdateCheck({ state: 'failed', at: Date.now(), why });
        if (!/offline/i.test(why)) reportError('updates.check', e);
      }
    })();
  }, []);
}

/**
 * The app, behind the Face ID lock when one is set.
 *
 * Inside AuthProvider on purpose: the lock asks whether anybody is signed in,
 * and a lock over a sign-in screen protects nothing while teaching people to
 * dismiss it. Shared by all three apps, because a phone left on a bench is a
 * phone left on a bench whichever one is installed.
 */
function LockedApp() {
  const { authed } = useAuth();
  // What changed since this account was last in the app is NOT mounted here.
  // It lives in each portal's own layout — app/(client|trainer|owner)/_layout —
  // for two reasons. It is per app, and the layout is the only place that knows
  // which app this is without asking. And a second full-screen <Modal> at this
  // height would sit alongside the release of liability and the lock screen,
  // two things that must never be the second-most-important thing on screen.
  // Inside the portal it is under both.
  return (
    <AppLockProvider signedIn={authed}>
      <LockGate>
        {/* Inside the lock and around the whole stack. Inside, because a bar
            saying "Meal removed. Undo" must not be readable over a locked
            phone; around the stack, because the toast has to outlive the
            screen that raised it — a delete staged on Meals and undone from
            the bar is undone whether or not the member has already navigated,
            and ToastProvider flushes the held write when it goes away rather
            than when a screen does. */}
        <ToastProvider>
          <ThemedStack />
        </ToastProvider>
      </LockGate>
    </AppLockProvider>
  );
}

export default function RootLayout() {
  useApplyUpdateOnLaunch();
  return (
    // ── ABOVE EVERY PROVIDER, and it was below all forty of them ──────────
    //
    // It wrapped <LockedApp /> alone, at the bottom of the stack, so it could
    // only ever catch a throw from a SCREEN. A throw in any provider's render —
    // and there are around forty of them, several of which parse stored JSON,
    // resolve a timezone or read a cached blob at mount — unwound past it,
    // React unmounted the whole tree, and the member got a white screen with no
    // fallback, no Reload and no `app_errors` row, because componentDidCatch
    // never ran. The one class of crash nobody could see was the one nobody
    // could recover from either.
    //
    // Safe to put here, and deliberately so: this component was written to
    // render AFTER a crash and its own header says it imports "no theme
    // provider, no kit, nothing that could itself throw". Checked rather than
    // trusted — its only component import is `Icon`, which reaches
    // react-native-svg and no context at all.
    //
    // Inside SafeAreaProvider only, so the fallback is not drawn under a notch.
    // That provider is from the library and takes no data of ours.
    //
    // The boundary further down, around <LockedApp />, STAYS. The two catch
    // different things and the inner one is the cheaper answer where it
    // applies: it keeps the reachability probe and the two outbox handlers
    // mounted through a screen's crash, so a session queued in a basement still
    // goes up. This one catches what unwinds past all of that, where there is
    // nothing left to preserve because the tree is going regardless.
    <SafeAreaProvider>
      <ErrorBoundary>
      <AppThemeProvider>
        <BrandProvider>
        <AuthProvider>
        <TenantProvider>
        {/* Above every provider that queues a write, because it holds the
            device's outbox and they register their handlers into it. Inside
            AuthProvider, because an outbox is keyed by account: two people
            sharing a phone must not inherit each other's unsent messages. */}
        <OutboxProvider>
        <ClientDataProvider>
          {/* Above everything that can schedule a notification, and it seeds
              src/lib/notifyPrefsLatch.ts — the synchronous read the gate inside
              scheduleLocal uses. High in the tree because a session reminder is
              armed by a booking callback that could fire from almost anywhere. */}
          <NotifyPrefsProvider>
          {/* Inside NotifyPrefsProvider, because it waits for the stored
              preferences to have seeded that latch before scheduling anything —
              otherwise a launch could re-arm a reminder at an hour the member
              asked to be left alone in, and not correct it until the next
              launch, where the same race could happen again. The reminders
              screen said of itself that "nothing anywhere re-schedules them
              from the saved payload later"; this is that. Renders nothing. */}
          <ReminderSyncProvider>
          <WearablesProvider>
                  <DeviceSleepProvider>
            <SessionsProvider>
              <WorkoutLogProvider>
                {/* Inside WorkoutLogProvider and ClientDataProvider, because it
                    watches both: a badge is earned by the training log, and
                    four of the twelve need the weight history for a bodyweight
                    set to count for anything. It renders nothing — it exists so
                    that an unlock is an event wherever the member happens to be
                    rather than something to be noticed on a screen most people
                    never open. `useBadgeWatch` returns a safe empty view when
                    this is absent, so the coach and owner builds are unaffected
                    by it not being mounted for them. */}
                <BadgeWatchProvider>
                {/* Inside WorkoutLogProvider, because a streak and a quiet week
                    are facts about the training log — and it refuses to arm
                    anything off an incomplete read of it. Renders nothing. */}
                <MotivationNudgeProvider>
                <MyTrainerProfileProvider>
                {/* How the coach says they coach. One row, one column, and it sits
                    OUTSIDE the roster because the two are the two halves of one
                    answer: the declaration is the floor and the roster may only
                    widen it. See src/lib/coachDelivery.ts. Reads nothing at all
                    off the coach app. */}
                <CoachDeliveryProvider>
                  <RosterProvider>
                    <InjuryAcksProvider>
                    <AssignedProgramsProvider>
                    <CoachFeedbackProvider>
                    <CoachNutritionProvider>
                    <PlatformTrainersProvider>
                    <MeasurementsProvider>
                    <PromosProvider>
                    <GoalTrackerProvider>
                    <CoachNotesProvider>
                    <AnnouncementsProvider>
                    <WellnessProvider>
                    <OwnerOpsProvider>
                    <SettingsProvider>
                    <HabitsProvider>
                      <CheckInsProvider>
                        <FoodLogProvider>
                        <InvitesProvider>
                        <TrainerInvitesProvider>
                        <ClientTagsProvider>
                        <ChallengesProvider>
                        <ProgramTemplatesProvider>
                        <ClassesProvider>
                        {/* Both render nothing, and both are here — at the
                            bottom of the provider stack — for the same reason:
                            they act on every queue in the app, and a queue
                            whose provider is mounted below them would not be
                            registered when they first fire.

                            The probe asks whether we can reach the server when
                            nothing else is asking; the flush sends what is
                            waiting the moment we can. Neither is inside
                            ErrorBoundary, because a crash in a screen must not
                            take the app's ability to send a queued session with
                            it. */}
                        <ReachabilityProbe />
                        {/* Mounted at the root rather than inside the chat
                            screen: a message typed in a basement and then left
                            there — app closed, thread never reopened — would
                            otherwise have nothing registered to send it, and
                            would sit on the phone being counted forever. */}
                        <MessageOutboxHandler />
                        <OfflineFlush />
                        {/* KEPT, and there is now a second one at the top of
                            this file. They are not redundant and the comment
                            twenty lines up is why: this inner one catches a
                            SCREEN's throw without unmounting ReachabilityProbe,
                            MessageOutboxHandler or OfflineFlush, so a crash on
                            one screen does not take the app's ability to send a
                            queued session with it. The outer one exists for the
                            throw this one can never see — a provider's own
                            render — where there is nothing left to preserve
                            because the whole tree is going anyway. */}
                        <ErrorBoundary>
                          <LockedApp />
                        </ErrorBoundary>
                        </ClassesProvider>
                        </ProgramTemplatesProvider>
                        </ChallengesProvider>
                        </ClientTagsProvider>
                        </TrainerInvitesProvider>
                        </InvitesProvider>
                        </FoodLogProvider>
                      </CheckInsProvider>
                    </HabitsProvider>
                  </SettingsProvider>
                    </OwnerOpsProvider>
                    </WellnessProvider>
                    </AnnouncementsProvider>
                    </CoachNotesProvider>
                    </GoalTrackerProvider>
                    </PromosProvider>
                    </MeasurementsProvider>
                    </PlatformTrainersProvider>
                    </CoachNutritionProvider>
                    </CoachFeedbackProvider>
                    </AssignedProgramsProvider>
                    </InjuryAcksProvider>
                  </RosterProvider>
                </CoachDeliveryProvider>
                </MyTrainerProfileProvider>
                </MotivationNudgeProvider>
                </BadgeWatchProvider>
              </WorkoutLogProvider>
            </SessionsProvider>
          </DeviceSleepProvider>
                  </WearablesProvider>
          </ReminderSyncProvider>
          </NotifyPrefsProvider>
        </ClientDataProvider>
        </OutboxProvider>
        </TenantProvider>
        </AuthProvider>
      </BrandProvider>
      </AppThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
