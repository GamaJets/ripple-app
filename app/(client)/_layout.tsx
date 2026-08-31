// Client tab navigator — Home · Train · Meals · Progress · Me
//
// Configuration, not layout: every Tabs.Screen, name, href, title and the order
// they appear in is untouched. The only change is that the tab label and the
// bar's padding come off the scale (`src/theme/scale`) instead of being raw
// numbers, and a dead emoji-based TabIcon (nothing rendered it since the Icon
// set landed) is gone.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, type as ty } from '../../src/theme/scale';
import { WaiverGate, useWaiver } from '../../src/ui/waiver';
import { useAuth } from '../../src/ui/auth';
import { WhatsNewSheet, useWhatsNew } from '../../src/ui/WhatsNew';

export default function ClientLayout() {
  // This build is one of three separate apps. If the client portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  if (!groupAllowed('client')) return <Redirect href="/" />;

  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  // What this client missed while they were away — and the one thing that
  // outranks it.
  //
  // <WaiverGate> puts the release of liability on screen as a <Modal>, and this
  // sheet is a <Modal> too. Two of those visible at once is a fight nobody
  // wins: React Native presents them in its own order, and the one that loses
  // is invisible until the other closes. That is survivable for news and
  // absolutely not for the release — somebody who has not signed it must not be
  // reading a feature list instead, and must never be able to dismiss their way
  // past it by tapping a backdrop that belongs to a different sheet.
  //
  // So the gate's own question is asked again here and the news is held until
  // it answers 'pass'. It is the same cheap read the gate makes, and asking it
  // rather than guessing is what makes "the waiver always wins" a fact instead
  // of a hope. The check behind the sheet still runs while it is held, so the
  // notes are ready the moment the release is signed.
  const waiver = useWaiver();
  const { user } = useAuth();
  const whatsNew = useWhatsNew(user?.id ?? null, waiver.applies && waiver.gate !== 'pass');
  return (
    <WaiverGate>
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 56 + bottomPad, paddingTop: sp.sm, paddingBottom: bottomPad },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        // The scale's smallest step, in sentence case and at the emphasis weight.
        tabBarLabelStyle: { ...ty.micro, textTransform: 'none', letterSpacing: 0.2, fontWeight: '500' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ headerShown: false, title: 'Home', tabBarIcon: ({ color }) => <Icon name="home" size={23} color={color} /> }} />
      <Tabs.Screen name="workouts" options={{ headerShown: false, title: 'Train', tabBarIcon: ({ color }) => <Icon name="train" size={23} color={color} /> }} />
      <Tabs.Screen name="nutrition" options={{ headerShown: false, title: 'Meals', tabBarIcon: ({ color }) => <Icon name="meals" size={23} color={color} /> }} />
      <Tabs.Screen name="scans" options={{ headerShown: false, title: 'Progress', tabBarIcon: ({ color }) => <Icon name="progress" size={23} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ headerShown: false, title: 'Me', tabBarIcon: ({ color }) => <Icon name="me" size={23} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ href: null, title: "Messages" }} />
      <Tabs.Screen name="devices" options={{ href: null, title: "Watch & Devices" }} />
      <Tabs.Screen name="foodlog" options={{ href: null, title: "Food Log" }} />
      <Tabs.Screen name="library" options={{ href: null, title: "Exercise Library" }} />
      <Tabs.Screen name="exercise" options={{ href: null, title: "Exercise" }} />
      <Tabs.Screen name="social" options={{ href: null, title: "Share & Social" }} />
      <Tabs.Screen name="appearance" options={{ href: null, title: "Appearance" }} />
      <Tabs.Screen name="coach" options={{ href: null, title: "AI Coach" }} />
      <Tabs.Screen name="music" options={{ href: null, title: "Music & Playlists" }} />
      <Tabs.Screen name="calendar" options={{ href: null, title: 'Book Sessions' }} />
      <Tabs.Screen name="habits" options={{ href: null, title: 'Daily Habits' }} />
      <Tabs.Screen name="achievements" options={{ href: null, title: 'Achievements' }} />
      <Tabs.Screen name="checkin" options={{ href: null, title: 'Weekly Check-in' }} />
      <Tabs.Screen name="activity" options={{ href: null, title: 'Activity' }} />
      <Tabs.Screen name="measurements" options={{ href: null, title: 'Body Measurements' }} />
      <Tabs.Screen name="injuries" options={{ href: null, title: 'Injuries & Limitations' }} />
      {/* href: null is not decoration. A route file in this directory with no
          Tabs.Screen entry gets a TAB BUTTON — expo-router's default — so
          adding a screen and forgetting this line puts it in the bar beside
          Home and Train. Glucose shipped that way in one OTA. */}
      <Tabs.Screen name="glucose" options={{ href: null, title: 'Blood Sugar' }} />
      <Tabs.Screen name="offers" options={{ href: null, title: 'Offers' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
      <Tabs.Screen name="account" options={{ href: null, title: 'Account & Security' }} />
      <Tabs.Screen name="receipts" options={{ href: null, title: 'Payments & Receipts' }} />
      <Tabs.Screen name="intake" options={{ href: null, title: 'Your Intake' }} />
      <Tabs.Screen name="my-coach" options={{ href: null, title: 'Your Coach' }} />
      <Tabs.Screen name="compare" options={{ href: null, title: 'Before & After' }} />
      <Tabs.Screen name="injury-doc" options={{ href: null, title: 'Read a Document' }} />
      <Tabs.Screen name="reminders" options={{ href: null, title: 'Reminders' }} />
      <Tabs.Screen name="packages" options={{ href: null, title: 'Memberships & Packs' }} />
      <Tabs.Screen name="report" options={{ href: null, title: 'Weekly Report' }} />
      <Tabs.Screen name="records" options={{ href: null, title: 'Personal Records' }} />
      <Tabs.Screen name="goal" options={{ href: null, title: 'Goal Tracker' }} />
      <Tabs.Screen name="tools" options={{ href: null, title: 'Lifting Tools' }} />
      <Tabs.Screen name="recovery" options={{ href: null, title: 'Recovery' }} />
      <Tabs.Screen name="week" options={{ href: null, title: 'This Week' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="cards" options={{ href: null, title: 'Milestone Cards' }} />
      <Tabs.Screen name="consistency" options={{ href: null, title: 'Consistency' }} />
      <Tabs.Screen name="standards" options={{ href: null, title: 'Strength Standards' }} />
      <Tabs.Screen name="trainers" options={{ href: null, title: 'Find a Trainer' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="challenges" options={{ href: null, title: 'Challenges' }} />
      <Tabs.Screen name="onboarding" options={{ href: null, title: 'Get Started' }} />
      <Tabs.Screen name="progression" options={{ href: null, title: 'Progression' }} />
      <Tabs.Screen name="trends" options={{ href: null, title: 'Trends' }} />
      <Tabs.Screen name="history" options={{ href: null, title: 'Your History' }} />
      <Tabs.Screen name="body-trends" options={{ href: null, title: 'Composition Trends' }} />
      <Tabs.Screen name="scan-machine" options={{ href: null, title: 'Scan Machine' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="referral" options={{ href: null, title: 'Invite Friends' }} />
      <Tabs.Screen name="restaurant" options={{ href: null, title: 'Eating Out' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="membership" options={{ href: null, title: 'Membership' }} />
      <Tabs.Screen name="access" options={{ href: null, title: 'Access' }} />
      <Tabs.Screen name="restday" options={{ href: null, title: 'When to Rest' }} />
      <Tabs.Screen name="pt-sessions" options={{ href: null, title: 'Personal Training' }} />
      <Tabs.Screen name="bookings" options={{ href: null, title: 'My Bookings' }} />
    </Tabs>
    <WhatsNewSheet visible={whatsNew.visible} releases={whatsNew.releases} onClose={whatsNew.onClose} />
    </WaiverGate>
  );
}
