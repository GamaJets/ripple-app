import { Stack } from 'expo-router';
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
import { HabitsProvider } from '../src/ui/habits';
import { CheckInsProvider } from '../src/ui/checkins';
import { AuthProvider } from '../src/ui/auth';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { AppThemeProvider, useTheme } from '../src/ui/components';
import { BrandProvider } from '../src/ui/brand';

function ThemedStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.ink, contentStyle: { backgroundColor: t.bg } }} />;
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
                    <HabitsProvider>
                      <CheckInsProvider>
                        <ErrorBoundary>
                          <ThemedStack />
                        </ErrorBoundary>
                      </CheckInsProvider>
                    </HabitsProvider>
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
