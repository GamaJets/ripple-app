import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { addNotificationTapListener } from '../src/ui/pushNotifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientDataProvider } from '../src/ui/clientData';
import { WearablesProvider } from '../src/ui/wearables';
import { SessionsProvider } from '../src/ui/sessions';
import { WorkoutLogProvider } from '../src/ui/workoutLog';
import { CoachProfileProvider } from '../src/ui/coachProfile';
import { RosterProvider } from '../src/ui/roster';
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
import { AppThemeProvider, useTheme } from '../src/ui/components';
import { BrandProvider } from '../src/ui/brand';

function ThemedStack() {
  const t = useTheme();
  const router = useRouter();
  // Tapping a notification (reminder or coach push) opens the right screen.
  useEffect(() => addNotificationTapListener((route) => { try { router.push(route as any); } catch { /* ignore */ } }), []);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <BrandProvider>
        <AuthProvider>
        <ClientDataProvider>
          <WearablesProvider>
            <SessionsProvider>
              <WorkoutLogProvider>
                <CoachProfileProvider>
                  <RosterProvider>
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
                          <ThemedStack />
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
                  </RosterProvider>
                </CoachProfileProvider>
              </WorkoutLogProvider>
            </SessionsProvider>
          </WearablesProvider>
        </ClientDataProvider>
        </AuthProvider>
      </BrandProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
