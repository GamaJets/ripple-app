// Owner portal tabs — Overview · Trainers · Brand · Growth · Ops
//
// Configuration, not layout: every Tabs.Screen, name, href, title and their
// order are untouched. Only the tab label and the bar's padding moved onto the
// scale (`src/theme/scale`); the dead emoji TabIcon is gone.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, type as ty } from '../../src/theme/scale';
export default function OwnerLayout() {
  // This build is one of three separate apps. If the owner portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  if (!groupAllowed('owner')) return <Redirect href="/" />;

  const t = useTheme();
  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 62, paddingTop: sp.sm, paddingBottom: sp.sm }, tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.ink3, tabBarLabelStyle: { ...ty.micro, textTransform: 'none', letterSpacing: 0.2, fontWeight: '500' }, sceneStyle: { backgroundColor: t.bg } }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ color }) => <Icon name="grid" size={23} color={color} /> }} />
      <Tabs.Screen name="trainers" options={{ title: 'Trainers', tabBarIcon: ({ color }) => <Icon name="people" size={23} color={color} /> }} />
      <Tabs.Screen name="brand" options={{ title: 'Brand', tabBarIcon: ({ color }) => <Icon name="palette" size={23} color={color} /> }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth', tabBarIcon: ({ color }) => <Icon name="trending" size={23} color={color} /> }} />
      <Tabs.Screen name="ops" options={{ title: 'Ops', tabBarIcon: ({ color }) => <Icon name="wrench" size={23} color={color} /> }} />
      <Tabs.Screen name="equipment" options={{ href: null, title: 'Equipment' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Feedback' }} />
      <Tabs.Screen name="revenue" options={{ href: null, title: 'Revenue' }} />
      <Tabs.Screen name="financials" options={{ href: null, title: 'Financial health' }} />
      <Tabs.Screen name="promotions" options={{ href: null, title: 'Promotions' }} />
      <Tabs.Screen name="class-analytics" options={{ href: null, title: 'Classes & payroll' }} />
    </Tabs>
  );
}
