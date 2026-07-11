// Client tab navigator — Home · Train · Meals · Progress · Me
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../src/ui/components';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

export default function ClientLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 62, paddingTop: 6, paddingBottom: 8 },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ headerShown: false, title: 'Home', tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> }} />
      <Tabs.Screen name="workouts" options={{ headerShown: false, title: 'Train', tabBarIcon: ({ focused }) => <TabIcon emoji="🏋️" focused={focused} /> }} />
      <Tabs.Screen name="nutrition" options={{ headerShown: false, title: 'Meals', tabBarIcon: ({ focused }) => <TabIcon emoji="🍽️" focused={focused} /> }} />
      <Tabs.Screen name="scans" options={{ headerShown: false, title: 'Progress', tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ headerShown: false, title: 'Me', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }} />
      <Tabs.Screen name="messages" options={{ href: null, title: "Messages" }} />
      <Tabs.Screen name="devices" options={{ href: null, title: "Watch & Devices" }} />
      <Tabs.Screen name="foodlog" options={{ href: null, title: "Food Log" }} />
      <Tabs.Screen name="library" options={{ href: null, title: "Exercise Library" }} />
      <Tabs.Screen name="social" options={{ href: null, title: "Share & Social" }} />
      <Tabs.Screen name="appearance" options={{ href: null, title: "Appearance" }} />
      <Tabs.Screen name="coach" options={{ href: null, title: "AI Coach" }} />
      <Tabs.Screen name="music" options={{ href: null, title: "Music & Playlists" }} />
      <Tabs.Screen name="calendar" options={{ href: null, title: 'Book Sessions' }} />
    </Tabs>
  );
}
