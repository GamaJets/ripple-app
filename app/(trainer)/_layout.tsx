// Trainer portal tabs — Clients · Programs · Schedule · Videos · Analytics · Profile
//
// Configuration, not layout: every Tabs.Screen, name, href, title and the order
// they appear in is untouched. The primary bar stays six items; everything else
// in this group is a detail screen registered with `href: null`.
//
// The bar is the shared floating one (src/ui/FloatingTabBar.tsx). It grows
// with Dynamic Type and gets out of the way while the keyboard is open — that
// second part is asked for HERE, with `tabBarHideOnKeyboard`, because several
// primary Coach tabs open dense forms and scheduling tools and a composer's
// Send must not be pushed up by a bar.
//
// A `<Tabs.Screen>` list is walked by expo-router rather than rendered, so keep
// commentary out from between the entries — notes about a route belong here, or
// in the route's own file header.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { FloatingTabBar } from '../../src/ui/FloatingTabBar';
import { useAuth } from '../../src/ui/auth';
import { WhatsNewSheet, useWhatsNew } from '../../src/ui/WhatsNew';
import { FloorQueueSync } from '../../src/ui/floorQueue';

export default function TrainerLayout() {
  // This build is one of three separate apps. If the trainer portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  // Every hook runs before any early return. `VARIANT` is a build constant
  // today so the gate below is effectively static, but a hook index that
  // depends on a conditional is a silent corruption the day it stops being.
  const { user, authed, loading } = useAuth();

  if (!groupAllowed('trainer')) return <Redirect href="/" />;

  // `!loading` is load-bearing: redirecting while the session is still
  // resolving bounces a signed-in coach to welcome on every cold start.
  if (!loading && !authed) return <Redirect href="/" />;

  const t = useTheme();
  // What this coach missed while they were away, filtered to the coach app —
  // they are not told about client-only changes. Keyed on the account, so a
  // coach who has just made one is shown nothing at all.
  const whatsNew = useWhatsNew(user?.id ?? null);
  return (
    <>
      <Tabs
        backBehavior="history"
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          // The bar itself is src/ui/FloatingTabBar.tsx — one component for all
          // three apps — so nothing about its look is configured here. It
          // reads `tabBarHideOnKeyboard` above, the inset and the reader's
          // text size for itself.
          sceneStyle: { backgroundColor: t.bg },
        }}
      >
        <Tabs.Screen name="dashboard" options={{ title: 'Clients', tabBarIcon: ({ color, size }) => <Icon name="people" size={size} color={color} /> }} />
        <Tabs.Screen name="builder" options={{ title: 'Programs', tabBarIcon: ({ color, size }) => <Icon name="train" size={size} color={color} /> }} />
        <Tabs.Screen name="calendar" options={{ title: 'Schedule', tabBarIcon: ({ color, size }) => <Icon name="calendar" size={size} color={color} /> }} />
        <Tabs.Screen name="videos" options={{ title: 'Videos', tabBarIcon: ({ color, size }) => <Icon name="video" size={size} color={color} /> }} />
        <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color, size }) => <Icon name="chart" size={size} color={color} /> }} />
        <Tabs.Screen name="sessions" options={{ href: null, title: 'Mark Sessions' }} />
        <Tabs.Screen name="leaderboard" options={{ href: null, title: 'Leaderboard' }} />
        <Tabs.Screen name="client-attendance" options={{ href: null, title: 'Their Attendance' }} />
        <Tabs.Screen name="my-register" options={{ href: null, title: 'Your Register' }} />
        <Tabs.Screen name="referrals" options={{ href: null, title: 'Who Brings You Clients' }} />
        <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
        <Tabs.Screen name="chat" options={{ href: null, title: 'Chat' }} />
        <Tabs.Screen name="log-session" options={{ href: null, title: 'Log a Session' }} />
        <Tabs.Screen name="my-training" options={{ href: null, title: 'My Training' }} />
        <Tabs.Screen name="my-nutrition" options={{ href: null, title: 'My Nutrition' }} />
        <Tabs.Screen name="my-progress" options={{ href: null, title: 'My Progress' }} />
        <Tabs.Screen name="checklists" options={{ href: null, title: 'Their Checklists' }} />
        <Tabs.Screen name="client-goals" options={{ href: null, title: 'Working Toward' }} />
        <Tabs.Screen name="client-photos" options={{ href: null, title: 'Progress Photos' }} />
        <Tabs.Screen name="client-week" options={{ href: null, title: 'Their Week' }} />
        <Tabs.Screen name="client" options={{ href: null, title: 'Client' }} />
        <Tabs.Screen name="client-body" options={{ href: null, title: 'Body Composition' }} />
        <Tabs.Screen name="client-training" options={{ href: null, title: 'Their Training' }} />
        <Tabs.Screen name="templates" options={{ href: null, title: 'Program Templates' }} />
        <Tabs.Screen name="exercise" options={{ href: null, title: 'Exercise' }} />
        <Tabs.Screen name="library" options={{ href: null, title: 'Exercise Library' }} />
        <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
        <Tabs.Screen name="billing" options={{ href: null, title: 'Billing & Subscription' }} />
        <Tabs.Screen name="payments" options={{ href: null, title: 'Payments' }} />
        <Tabs.Screen name="ad-spend" options={{ href: null, title: 'Ad Spend' }} />
        <Tabs.Screen name="leads" options={{ href: null, title: 'Enquiries' }} />
        <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
        <Tabs.Screen name="class-checkin" options={{ href: null, title: 'Class Check-in' }} />
        <Tabs.Screen name="broadcast" options={{ href: null, title: 'Broadcast' }} />
        <Tabs.Screen name="broadcast-session" options={{ href: null, title: 'Broadcast a Session' }} />
        <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
        <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
        <Tabs.Screen name="client-intake" options={{ href: null, title: 'Their Intake' }} />
        <Tabs.Screen name="client-nutrition" options={{ href: null, title: 'Their Nutrition' }} />
        <Tabs.Screen name="group" options={{ href: null, title: 'Group Program' }} />
        <Tabs.Screen name="share-kit" options={{ href: null, title: 'Share Kit' }} />
        <Tabs.Screen name="documents" options={{ href: null, title: 'Documents' }} />
        <Tabs.Screen name="invoices" options={{ href: null, title: 'Invoices' }} />
        <Tabs.Screen name="receipts" options={{ href: null, title: 'Cash and Transfers' }} />
        <Tabs.Screen name="costs" options={{ href: null, title: 'What It Costs You' }} />
        <Tabs.Screen name="nudges" options={{ href: null, title: 'Nudges' }} />
        <Tabs.Screen name="client-report" options={{ href: null, title: 'Their Record' }} />
        <Tabs.Screen name="credentials" options={{ href: null, title: 'Credentials' }} />
        <Tabs.Screen name="messages" options={{ href: null, title: 'Messages' }} />
        <Tabs.Screen name="money" options={{ href: null, title: 'Money' }} />
        <Tabs.Screen name="brand" options={{ href: null, title: 'Branding' }} />
        <Tabs.Screen name="statement" options={{ href: null, title: 'Statement' }} />
        <Tabs.Screen name="getting-started" options={{ href: null, title: 'Getting Started' }} />
        <Tabs.Screen name="assistant" options={{ href: null, title: 'Assistant' }} />
        <Tabs.Screen name="templates-messages" options={{ href: null, title: 'Saved Messages' }} />
        <Tabs.Screen name="client-cancellations" options={{ href: null, title: 'Sessions They Cancelled' }} />
        <Tabs.Screen name="account" options={{ href: null, title: 'Account & Sign-in' }} />
        <Tabs.Screen name="join-code" options={{ href: null, title: 'Your Code' }} />
        <Tabs.Screen name="devices" options={{ href: null, title: 'Watch & Devices' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Icon name="me" size={size} color={color} /> }} />
      </Tabs>
      <WhatsNewSheet visible={whatsNew.visible} releases={whatsNew.releases} onClose={whatsNew.onClose} />
      {/* Renders nothing. Reads this coach's unsent floor queue — attendance
          ticks, session outcomes, logged sessions — off the device once, so the
          app's reconnect and foreground triggers can empty it without the coach
          having to reopen one of the three screens that own it. */}
      <FloorQueueSync uid={user?.id ?? null} />
    </>
  );
}
