// Trainer portal tabs — Clients · Schedule · Videos · Analytics · Profile
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

export default function TrainerLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 56 + bottomPad, paddingTop: 8, paddingBottom: bottomPad },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Clients', tabBarIcon: ({ color }) => <Icon name="people" size={23} color={color} /> }} />
      <Tabs.Screen name="builder" options={{ title: 'Programs', tabBarIcon: ({ color }) => <Icon name="train" size={23} color={color} /> }} />
      <Tabs.Screen name="calendar" options={{ title: 'Schedule', tabBarIcon: ({ color }) => <Icon name="calendar" size={23} color={color} /> }} />
      <Tabs.Screen name="videos" options={{ title: 'Videos', tabBarIcon: ({ color }) => <Icon name="video" size={23} color={color} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color }) => <Icon name="chart" size={23} color={color} /> }} />
      <Tabs.Screen name="leaderboard" options={{ href: null, title: 'Leaderboard' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="chat" options={{ href: null, title: 'Chat' }} />
      <Tabs.Screen name="templates" options={{ href: null, title: 'Program Templates' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="billing" options={{ href: null, title: 'Billing & subscription' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Icon name="me" size={23} color={color} /> }} />
    </Tabs>
  );
}
