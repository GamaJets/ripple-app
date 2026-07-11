import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../src/ui/components';
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) { return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>; }
export default function OwnerLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 62, paddingTop: 6, paddingBottom: 8 }, tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.ink3, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, sceneStyle: { backgroundColor: t.bg } }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} /> }} />
      <Tabs.Screen name="trainers" options={{ title: 'Trainers', tabBarIcon: ({ focused }) => <TabIcon emoji="🧑‍🏫" focused={focused} /> }} />
      <Tabs.Screen name="brand" options={{ title: 'Brand', tabBarIcon: ({ focused }) => <TabIcon emoji="🎨" focused={focused} /> }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth', tabBarIcon: ({ focused }) => <TabIcon emoji="📈" focused={focused} /> }} />
      <Tabs.Screen name="ops" options={{ title: 'Ops', tabBarIcon: ({ focused }) => <TabIcon emoji="🛠️" focused={focused} /> }} />
    </Tabs>
  );
}
