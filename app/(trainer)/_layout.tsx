// Trainer portal tabs — Clients · Schedule · Videos · Analytics · Profile
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../src/ui/components';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

export default function TrainerLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 62, paddingTop: 6, paddingBottom: 8 },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Clients', tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} /> }} />
      <Tabs.Screen name="calendar" options={{ title: 'Schedule', tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} /> }} />
      <Tabs.Screen name="videos" options={{ title: 'Videos', tabBarIcon: ({ focused }) => <TabIcon emoji="🎬" focused={focused} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ focused }) => <TabIcon emoji="📈" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }} />
    </Tabs>
  );
}
