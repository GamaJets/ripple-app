import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { dark } from '../src/theme/tokens';
import { ClientDataProvider } from '../src/ui/clientData';
import { WearablesProvider } from '../src/ui/wearables';

export default function RootLayout() {
  const t = dark;
  return (
    <SafeAreaProvider>
      <ClientDataProvider>
        <WearablesProvider>
        <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.ink, contentStyle: { backgroundColor: t.bg } }} />
        </WearablesProvider>
      </ClientDataProvider>
    </SafeAreaProvider>
  );
}
