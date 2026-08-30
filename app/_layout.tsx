import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import * as Updates from 'expo-updates';
import { addNotificationTapListener } from '../src/ui/pushNotifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientDataProvider } from '../src/ui/clientData';
import { WearablesProvider } from '../src/ui/wearables';
import { DeviceSleepProvider } from '../src/ui/deviceSleep';
import { SessionsProvider } from '../src/ui/sessions';
import { WorkoutLogProvider } from '../src/ui/workoutLog';
import { MyTrainerProfileProvider } from '../src/ui/coachProfile';
import { RosterProvider } from '../src/ui/roster';
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
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { AppLockProvider } from '../src/ui/appLock';
import { LockGate } from '../src/ui/LockScreen';
import { WhatsNewSheet, useWhatsNew } from '../src/ui/WhatsNew';
import { useAuth } from '../src/ui/auth';
import { AppThemeProvider, useTheme } from '../src/ui/components';
import { BrandProvider } from '../src/ui/brand';
import { TenantProvider } from '../src/ui/tenant';

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
    if (!Updates.isEnabled) return; // no-op in dev / Expo Go
    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch { /* offline or check failed — just stay on the current bundle */ }
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
  // What changed since the version they last opened. Gated on being signed in
  // for the same reason the lock is: there is nothing to tell somebody looking
  // at a sign-in screen, and it would land before they have seen the app at
  // all. It sits INSIDE the gate so it cannot appear over the lock screen.
  const whatsNew = useWhatsNew(authed);
  return (
    <AppLockProvider signedIn={authed}>
      <LockGate>
        <ThemedStack />
        <WhatsNewSheet visible={whatsNew.visible} onClose={whatsNew.onClose} />
      </LockGate>
    </AppLockProvider>
  );
}

export default function RootLayout() {
  useApplyUpdateOnLaunch();
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <BrandProvider>
        <AuthProvider>
        <TenantProvider>
        <ClientDataProvider>
          <WearablesProvider>
                  <DeviceSleepProvider>
            <SessionsProvider>
              <WorkoutLogProvider>
                <MyTrainerProfileProvider>
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
                </MyTrainerProfileProvider>
              </WorkoutLogProvider>
            </SessionsProvider>
          </DeviceSleepProvider>
                  </WearablesProvider>
        </ClientDataProvider>
        </TenantProvider>
        </AuthProvider>
      </BrandProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
