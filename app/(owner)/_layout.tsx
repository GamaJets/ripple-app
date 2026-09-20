// Owner portal tabs — Overview · Trainers · Brand · Growth · Ops
//
// Configuration, not layout: every Tabs.Screen, name, href, title and their
// order are untouched. The bar that draws them is the shared floating one,
// src/ui/FloatingTabBar.tsx, handed to <Tabs> through `tabBar`.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { FloatingTabBar } from '../../src/ui/FloatingTabBar';
import { useAuth } from '../../src/ui/auth';
import { WhatsNewSheet, useWhatsNew } from '../../src/ui/WhatsNew';
export default function OwnerLayout() {
  // ── Every hook first, and the gate after them ─────────────────────────────
  //
  // The early `return <Redirect/>` used to sit ABOVE these three, which is a
  // rules-of-hooks violation that is currently harmless and will not stay that
  // way. `groupAllowed('owner')` reads a build constant, so today the branch is
  // decided at compile time and this component either always calls the hooks or
  // never does — React never sees the count change and nothing breaks.
  //
  // The day that gate becomes dynamic — a per-account entitlement, a remote
  // flag, anything read rather than baked — the count changes between renders,
  // and React does not report that as "the gate changed". It reports it as
  // whichever hook happens to be third: a theme that is suddenly an auth
  // session, or a crash from deep inside useWhatsNew. That is a very hard
  // failure to read back to this line, and it costs nothing to make impossible
  // now.
  //
  // Calling the hooks in a build that does not ship the owner portal is not
  // waste: this component is not mounted at all in those builds beyond the one
  // render that redirects, and `useWhatsNew` is keyed on the account, so a
  // redirecting render asks nothing it would not otherwise ask.
  const t = useTheme();
  // What this owner missed, filtered to the Studio app. A release whose only
  // changes were a client's or a coach's is skipped entirely rather than
  // opening an empty sheet at them.
  const { user, authed, loading } = useAuth();
  const whatsNew = useWhatsNew(user?.id ?? null);

  // The bar sat under the home indicator here once, and only here: this file
  // pinned a numeric `height` on the stock bar, which made expo-router skip
  // the inset entirely. There is no bar configuration left in this file to get
  // wrong — src/ui/FloatingTabBar.tsx is the one bar for all three apps, and
  // it reads the inset and the reader's text size for itself.

  // This build is one of three separate apps. If the owner portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  if (!groupAllowed('owner')) return <Redirect href="/" />;

  // And nobody reads this portal without a session. There was no auth gate in
  // any of the three groups — the variant gate above was the only Redirect in
  // app/(client), app/(trainer) or app/(owner). app/index.tsx is where `authed`
  // is checked, and a deep link or a tapped notification lands on this layout
  // without going through it. The path that makes it matter is the lock screen:
  // its Sign Out (src/ui/LockScreen.tsx) ends the session and navigates
  // nowhere, and the lock drops as soon as `signedIn` goes false
  // (src/ui/appLock.tsx:130), so whoever is holding the handset was left inside
  // the previous owner's Studio — revenue, payroll, deletion requests — rather
  // than at sign-in. `!loading` because redirecting while auth is still
  // resolving would bounce a signed-in owner to welcome on every cold start;
  // '/' because app/index.tsx is what knows where a signed-out reader belongs.
  // The same gate is in app/(client)/_layout.tsx and app/(trainer)/_layout.tsx.
  if (!loading && !authed) return <Redirect href="/" />;

  return (
    <>
    {/* The same bar as app/(client)/_layout.tsx and app/(trainer)/_layout.tsx,
        option for option: one label style, one icon size, the accent from the
        theme so a white-label gym's tint reaches its own portal. Laid out the
        same way as theirs so the three can be read against each other. */}
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Icon name="grid" size={size} color={color} /> }} />
      <Tabs.Screen name="trainers" options={{ title: 'Trainers', tabBarIcon: ({ color, size }) => <Icon name="people" size={size} color={color} /> }} />
      <Tabs.Screen name="brand" options={{ title: 'Brand', tabBarIcon: ({ color, size }) => <Icon name="palette" size={size} color={color} /> }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth', tabBarIcon: ({ color, size }) => <Icon name="trending" size={size} color={color} /> }} />
      <Tabs.Screen name="ops" options={{ title: 'Ops', tabBarIcon: ({ color, size }) => <Icon name="wrench" size={size} color={color} /> }} />
      <Tabs.Screen name="members" options={{ href: null, title: 'Members' }} />
      <Tabs.Screen name="equipment" options={{ href: null, title: 'Equipment' }} />
      <Tabs.Screen name="library" options={{ href: null, title: 'Exercise Library' }} />
      <Tabs.Screen name="exercise" options={{ href: null, title: 'Exercise' }} />
      <Tabs.Screen name="rota" options={{ href: null, title: 'Rota' }} />
      <Tabs.Screen name="deletions" options={{ href: null, title: 'Deletion Requests' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Feedback' }} />
      <Tabs.Screen name="revenue" options={{ href: null, title: 'Revenue' }} />
      <Tabs.Screen name="financials" options={{ href: null, title: 'Financial Checks' }} />
      <Tabs.Screen name="promotions" options={{ href: null, title: 'Promotions' }} />
      <Tabs.Screen name="class-analytics" options={{ href: null, title: 'Classes & Payroll' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
      <Tabs.Screen name="orders" options={{ href: null, title: 'Online Orders' }} />
    </Tabs>
    <WhatsNewSheet visible={whatsNew.visible} releases={whatsNew.releases} onClose={whatsNew.onClose} />
    </>
  );
}
