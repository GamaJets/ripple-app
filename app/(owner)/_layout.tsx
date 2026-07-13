import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) { return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>; }
export default function OwnerLayout() {
  const t = useTheme();
  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 62, paddingTop: 6, paddingBottom: 8 }, tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.ink3, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, sceneStyle: { backgroundColor: t.bg } }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ color }) => <Icon name="grid" size={23} color={color} /> }} />
      <Tabs.Screen name="trainers" options={{ title: 'Trainers', tabBarIcon: ({ color }) => <Icon name="people" size={23} color={color} /> }} />
      <Tabs.Screen name="brand" options={{ title: 'Brand', tabBarIcon: ({ color }) => <Icon name="palette" size={23} color={color} /> }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth', tabBarIcon: ({ color }) => <Icon name="trending" size={23} color={color} /> }} />
      <Tabs.Screen name="ops" options={{ title: 'Ops', tabBarIcon: ({ color }) => <Icon name="wrench" size={23} color={color} /> }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Feedback' }} />
      <Tabs.Screen name="revenue" options={{ href: null, title: 'Revenue' }} />
    </Tabs>
  );
}
