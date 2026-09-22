// Client tab navigator — Home · Train · Meals · Progress · Me
//
// Configuration, not layout: every Tabs.Screen, name, href, title and the order
// they appear in is untouched. The bar that draws them is the shared floating
// one, src/ui/FloatingTabBar.tsx, handed to <Tabs> through `tabBar`; an icon
// takes the size and colour the bar gives it, because the current tab's icon
// is a different size and colour from the rest.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { FloatingTabBar } from '../../src/ui/FloatingTabBar';
import { WaiverGate, useWaiver } from '../../src/ui/waiver';
import { useAuth } from '../../src/ui/auth';
import { WhatsNewSheet, useWhatsNew } from '../../src/ui/WhatsNew';

export default function ClientLayout() {
  // ── Every hook first, and the gates after them ────────────────────────────
  //
  // The early `return <Redirect/>` used to sit ABOVE all of these, and
  // app/(owner)/_layout.tsx already carries the argument for why it must not:
  // `groupAllowed('client')` reads a build constant today, so the branch is
  // decided at compile time and React never sees the hook count change. The day
  // that gate becomes dynamic — a per-account entitlement, a remote flag — the
  // count changes between renders, and React reports it as whichever hook
  // happens to be third rather than as "the gate changed".
  //
  // The one cost this file has that the owner layout does not: `useWaiver()`
  // asks the server for this account's release of liability, and it now runs in
  // the render that redirects. That render only happens in a build that does
  // not ship the client portal, reached by a stale deep link, which is the rare
  // case the redirect exists for — one query, no writes, and the component
  // unmounts immediately after.
  const t = useTheme();

  // What this client missed while they were away — and the one thing that
  // outranks it.
  //
  // <WaiverGate> puts the release of liability on screen as a native <Modal>.
  // CORRECTION, recorded rather than swapped out: this sheet was a <Modal> too
  // when that was written, and it is not one any more. src/ui/WhatsNew.tsx now
  // renders an absolutely-positioned view inside the ordinary tree, because a
  // walkthrough found the whole client app inert — every tab, every button,
  // every scroll swallowed — by a modal iOS had never presented but which was
  // still taking the touches. Two natives Modals visible at once is a fight
  // nobody wins: React Native presents them in its own order and the loser is
  // invisible until the other closes.
  //
  // The hold below STAYS, and not merely out of caution. It is no longer about
  // the presentation race — an overlay in the tree cannot enter one, and a
  // native Modal draws over it regardless — it is about what the reader is
  // looking at. Somebody who has not signed the release must not be reading a
  // feature list instead, and `onClose` must not be reachable behind the gate,
  // because dismissing the sheet records this release as read when nobody read
  // it. The check behind the sheet still runs while it is held, so the notes
  // are ready the moment the release is signed.
  const waiver = useWaiver();
  const { user, authed, loading } = useAuth();
  // `gate === 'block' || gate === 'wait'`, not `!== 'pass'`. The gate answers
  // THREE things and the negation collapsed them: 'block' (there is a release
  // to sign — hold, and the gate is on screen saying so), 'wait' (the read has
  // not come back — hold, and the gate is on screen saying so), and the case
  // that has no name here, where `waiverState` could not be established at all.
  //
  // That third one is the reason for the change. `waiverGate` sends an
  // unreadable state to 'block' only when the member has never accepted before,
  // and to 'pass' when they have — so a member whose acceptance is on file and
  // whose read failed gets 'pass' and their news, which is right. But writing
  // the hold as "anything that is not pass" made this file's behaviour depend
  // on a default two modules away rather than on the two states it actually
  // means to wait for. Naming them is what stops a fourth gate value, added
  // later for some other reason, silently suppressing the changelog with
  // nothing on screen to explain it — a sheet held by a state nobody can see
  // is indistinguishable from a sheet that is broken.
  const waiverHolds = waiver.applies && (waiver.gate === 'block' || waiver.gate === 'wait');
  const whatsNew = useWhatsNew(user?.id ?? null, waiverHolds);

  // This build is one of three separate apps. If the client portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  if (!groupAllowed('client')) return <Redirect href="/" />;

  // ── And nobody reads this portal without a session ────────────────────────
  //
  // There was no auth gate anywhere inside app/(client), app/(trainer) or
  // app/(owner) — the only Redirect in any of the three groups was the variant
  // gate above. app/index.tsx is where `authed` is checked, and a deep link
  // does not go through app/index.tsx: `repple://(client)/injury-doc` and a
  // tapped notification both land on this layout directly, and every screen
  // below it mounted and fired its reads with no session.
  //
  // The path that makes this more than untidy is the lock screen. Its Sign Out
  // (src/ui/LockScreen.tsx) ends the session and navigates nowhere — "the lock
  // lifts either way" — and AppLockProvider drops the lock the moment
  // `signedIn` goes false (src/ui/appLock.tsx:130). So somebody handed a locked
  // gym handset taps Sign Out and is left standing INSIDE the previous member's
  // portal, on whatever screen they had open, rather than at sign-in. Every
  // other sign-out in the app calls `router.replace('/welcome')` itself; that
  // one cannot, and a gate here covers it and every future one that forgets.
  //
  // `!loading` is the whole of the care this needs. Redirecting while auth is
  // still resolving would bounce a legitimately signed-in member to the welcome
  // screen on every cold start, which is the opposite defect. Until the session
  // is known this renders exactly what it rendered before; the moment it is
  // known to be absent, the reader leaves. '/' rather than '/welcome' because
  // app/index.tsx is what knows where a signed-out reader belongs.
  if (!loading && !authed) return <Redirect href="/" />;

  return (
    <WaiverGate>
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        // No navigator header, anywhere in this group — the same line
        // app/(trainer)/_layout.tsx and app/(owner)/_layout.tsx have always
        // carried, and the one this file did not.
        //
        // It was set per-screen on the five bar tabs and nowhere else, so the
        // sixty-six `href: null` detail screens below took the navigator's
        // default, which is `true`
        // (expo-router/build/react-navigation/elements/Screen.js: `headerShown
        // = true` in the destructuring). Every one of them drew its own title
        // and its own back control INSIDE a header the navigator had already
        // drawn above it — two titles, and a back arrow that only one of them
        // had, because a bottom-tabs header renders no back button at all
        // (BottomTabView passes `header({ layout, options })` with no `back`).
        //
        // The cost was not only the doubled title. That header is a plain
        // sibling View above the content, `44 + statusBarHeight` tall on a
        // phone (elements/Header/getDefaultHeaderHeight.js), and
        // `elements/Screen` does not reset SafeAreaInsetsContext underneath it
        // — so the `<SafeAreaView edges={['top']}>` every one of these screens
        // opens with then added the top inset a SECOND time. On an iPhone that
        // put roughly 160 points between the top of the screen and the top of
        // the ScrollView.
        //
        // Which is what the pull-to-refresh report was about. A RefreshControl
        // belongs to its ScrollView, and a downward drag started in that strip
        // is not in the ScrollView: no spinner, no error, nothing. The coach's
        // Watch & Devices has no header, its list starts at the top of the
        // screen, and the same gesture on the same code works — reported as
        // "pull to refresh is working on the coach but not on the client app",
        // and alongside it "connected but not updating", which is the same
        // fault seen from the data side: the pull never fired, so `syncAll`
        // never ran.
        //
        // The three header* style options that used to be here went with it.
        // They only ever described a header this group does not draw.
        headerShown: false,
        // The bar itself is src/ui/FloatingTabBar.tsx — one component for all
        // three apps — so nothing about its look is configured here. It reads
        // the inset and the reader's text size for itself, and it still
        // honours the `tabBarStyle: { display: 'none' }` onboarding sets below.
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Icon name="home" size={size} color={color} duo /> }} />
      <Tabs.Screen name="workouts" options={{ title: 'Train', tabBarIcon: ({ color, size }) => <Icon name="train" size={size} color={color} duo /> }} />
      <Tabs.Screen name="nutrition" options={{ title: 'Meals', tabBarIcon: ({ color, size }) => <Icon name="meals" size={size} color={color} duo /> }} />
      <Tabs.Screen name="scans" options={{ title: 'Progress', tabBarIcon: ({ color, size }) => <Icon name="progress" size={size} color={color} duo /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: ({ color, size }) => <Icon name="me" size={size} color={color} duo /> }} />
      <Tabs.Screen name="messages" options={{ href: null, title: "Messages" }} />
      <Tabs.Screen name="devices" options={{ href: null, title: "Watch & Devices" }} />
      <Tabs.Screen name="foodlog" options={{ href: null, title: "Food Log" }} />
      <Tabs.Screen name="library" options={{ href: null, title: "Exercise Library" }} />
      <Tabs.Screen name="programs" options={{ href: null, title: 'Programs' }} />
      <Tabs.Screen name="build-workout" options={{ href: null, title: 'Build a Workout' }} />
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
      <Tabs.Screen name="invoices" options={{ href: null, title: 'Invoices' }} />
      <Tabs.Screen name="intake" options={{ href: null, title: 'Your Intake' }} />
      <Tabs.Screen name="my-coach" options={{ href: null, title: 'Your Coach' }} />
      <Tabs.Screen name="coach-documents" options={{ href: null, title: 'Paperwork' }} />
      <Tabs.Screen name="resources" options={{ href: null, title: 'Resources' }} />
      <Tabs.Screen name="assessments" options={{ href: null, title: 'My Assessments' }} />
      <Tabs.Screen name="agreements" options={{ href: null, title: 'Gym Paperwork' }} />
      <Tabs.Screen name="standing" options={{ href: null, title: 'Standing Appointments' }} />
      <Tabs.Screen name="notices" options={{ href: null, title: 'Notices' }} />
      <Tabs.Screen name="compare" options={{ href: null, title: 'Before & After' }} />
      <Tabs.Screen name="attendance" options={{ href: null, title: 'Attendance' }} />
      <Tabs.Screen name="injury-doc" options={{ href: null, title: 'Read a Document' }} />
      <Tabs.Screen name="reminders" options={{ href: null, title: 'Reminders' }} />
      <Tabs.Screen name="notification-prefs" options={{ href: null, title: 'Notifications' }} />
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
      {/* ── setup is a door, not a tab ────────────────────────────────────
          `href: null` takes the BUTTON out of the bar; it does not take the
          BAR off the screen. So a member part-way through setup still had Home,
          Train, Meals, Progress and Me sitting under the Continue button, and
          one tap dropped them into an app configured by whatever the questions
          had defaulted to — the coaching mode, the units, the goal — with no
          route back to the questions they had abandoned.
          Hiding the bar here is what "lock the tabs until they have been
          through onboarding" means in practice: while this screen is up there
          is nothing to tap. Nobody is trapped by it, because Skip is on every
          card and both Skip and Start Training leave for the app proper. */}
      <Tabs.Screen name="onboarding" options={{ href: null, title: 'Get Started', tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="getting-started" options={{ href: null, title: 'Getting Started' }} />
      <Tabs.Screen name="progression" options={{ href: null, title: 'Progression' }} />
      <Tabs.Screen name="trends" options={{ href: null, title: 'Trends' }} />
      <Tabs.Screen name="history" options={{ href: null, title: 'Your History' }} />
      <Tabs.Screen name="muscles" options={{ href: null, title: 'Your Muscles' }} />
      <Tabs.Screen name="body-trends" options={{ href: null, title: 'Composition Trends' }} />
      <Tabs.Screen name="scan-machine" options={{ href: null, title: 'Scan Machine' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="referral" options={{ href: null, title: 'Invite Friends' }} />
      <Tabs.Screen name="restaurant" options={{ href: null, title: 'Eating Out' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="me-group" options={{ href: null, title: 'Profile' }} />
      <Tabs.Screen name="membership" options={{ href: null, title: 'Membership' }} />
      <Tabs.Screen name="gym-plans" options={{ href: null, title: 'Plans & Passes' }} />
      <Tabs.Screen name="access" options={{ href: null, title: 'Access' }} />
      <Tabs.Screen name="restday" options={{ href: null, title: 'When to Rest' }} />
      <Tabs.Screen name="pt-sessions" options={{ href: null, title: 'Personal Training' }} />
      <Tabs.Screen name="session-credits" options={{ href: null, title: 'Session Credits' }} />
      <Tabs.Screen name="bookings" options={{ href: null, title: 'My Bookings' }} />
      <Tabs.Screen name="request-session" options={{ href: null, title: 'Ask for a Time' }} />
    </Tabs>
    <WhatsNewSheet visible={whatsNew.visible} releases={whatsNew.releases} onClose={whatsNew.onClose} />
    </WaiverGate>
  );
}
