import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientDataProvider } from '../src/ui/clientData';
import { WearablesProvider } from '../src/ui/wearables';
import { SessionsProvider } from '../src/ui/sessions';
import { WorkoutLogProvider } from '../src/ui/workoutLog';
import { CoachProfileProvider } from '../src/ui/coachProfile';
import { RosterProvider } from '../src/ui/roster';
import { AppThemeProvider, useTheme } from '../src/ui/components';

function ThemedStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.ink, contentStyle: { backgroundColor: t.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <ClientDataProvider>
          <WearablesProvider>
            <SessionsProvider>
              <WorkoutLogProvider>
                <CoachProfileProvider>
                  <RosterProvider>
                    <ThemedStack />
                  </RosterProvider>
                </CoachProfileProvider>
              </WorkoutLogProvider>
            </SessionsProvider>
          </WearablesProvider>
        </ClientDataProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
