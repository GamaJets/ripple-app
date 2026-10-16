// ── The tab bar ──────────────────────────────────────────────────────────────
// One bar for all three apps, as the v2 mockups draw it (REDESIGN-PLAN §6): a
// glass capsule floating over the ground, every tab an outline icon over its
// name, the CURRENT tab in the app's accent with a soft glow. app/(client), app/(trainer) and app/(owner) hand this to expo-router's
// <Tabs tabBar=…> and configure nothing else about the bar.
//
// ── It floats, and nothing sits under it ────────────────────────────────────
//
// The obvious way to float a bar is `position: 'absolute'`, and its price is
// paid on every screen: the scene then runs underneath, and each of about two
// hundred ScrollViews needs bottom padding it does not have, or its last row —
// on most screens the primary button — is covered. The mockups do not do that
// either. Their bar is an ordinary child at the foot of the frame on a
// TRANSPARENT strip, and the content stops above it.
//
// So this is in flow. The navigator lays the scene out above it, no screen
// needs to know the bar's height, and there is deliberately no spacing hook to
// forget to call. What makes it float is what the eye reads as floating: side
// margins, a full radius, a shadow, and the ground's own colour behind it, so
// the strip is invisible and the capsule is not.
//
// ── What it keeps from the bar it replaces ──────────────────────────────────
//
//   · `href: null` screens get no button. expo-router says that with
//     `tabBarItemStyle: { display: 'none' }`, and that is what is read here.
//   · A screen that hides the bar (`tabBarStyle: { display: 'none' }` — client
//     onboarding, see that layout for why) still hides it.
//   · `tabBarHideOnKeyboard` still hides it while the keyboard is up. The
//     coach layout sets it; a composer's Send must not be pushed up by a bar.
//   · The `tabPress` event is emitted and may be prevented, as the stock bar
//     does, so a screen's listener keeps working.
//   · Roles and state: a `tablist` of `tab`s, `selected` said on each. The
//     accessibility label carries the name; colour and glow are the visual
//     channel for "selected", and neither reaches a screen reader.
//   · The bar grows with the reader's text up to 1.3x (LARGE_TYPE_SCALE) and
//     no further, as the system's own tab bar does. At the accessibility sizes
//     it grew a 125pt circle whose name spilled out of it (seen 21 Sep 2026 on
//     the simulator); the name is the accessibility label and every screen
//     above keeps growing, so nothing is lost by stopping the chrome.
//
// No badge support: no layout sets `tabBarBadge`. When one does, it is a dot
// on the icon here, and the count in the accessibility label.
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Tabs } from 'expo-router';
import { useTheme } from './components';
import { HERO_FIT } from './kit';
import { elevation, fontScale, type as ty } from '../theme/scale';
import { atScale, LARGE_TYPE_SCALE } from '../lib/typeScale';

const CAP = LARGE_TYPE_SCALE;
const PILL = atScale(50, Math.min(fontScale, CAP));

// Derived from <Tabs> rather than imported from expo-router's vendored
// react-navigation: that path is an implementation detail of one SDK.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** `partOf` names a hidden route that belongs to a visible tab, so that tab
 *  stays lit while it is open: the coach's Analytics is part of Business. */
export function FloatingTabBar({ state, descriptors, navigation, partOf }: TabBarProps & { partOf?: Record<string, string> }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    // `Will` on iOS so the bar is gone before the keyboard has finished
    // rising; Android only ever sends `Did`.
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const current = descriptors[state.routes[state.index].key]?.options;
  // `tabBarStyle` is typed as an ANIMATED style; the one thing read from it is
  // a plain `display`, which nothing animates.
  if ((StyleSheet.flatten(current?.tabBarStyle) as ViewStyle | undefined)?.display === 'none') return null;
  if (keyboardUp && current?.tabBarHideOnKeyboard) return null;

  return (
    // The strip. The ground's colour, so only the capsule is seen. Above the
    // home indicator by the phone's own inset, less the few points of it that
    // are air: the indicator is 5pt tall and 8 from the edge, and a bar a full
    // 34pt up reads as misplaced rather than floating.
    <View style={{
      backgroundColor: t.bg, paddingHorizontal: 14, paddingTop: 6,
      paddingBottom: insets.bottom > 0 ? Math.max(insets.bottom - 8, 14) : 14,
    }}>
      <View accessibilityRole="tablist" style={{
        flexDirection: 'row', alignItems: 'center', gap: 2, padding: 7,
        // v2 (REDESIGN-PLAN §6): a glass bar — the card colour at 88% so the
        // content scrolling past reads through it — on a 26pt radius.
        backgroundColor: `${t.surface}e0`, borderRadius: 26, ...elevation.float,
      }}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          if (StyleSheet.flatten(options.tabBarItemStyle)?.display === 'none') return null;
          const here = state.routes[state.index].name;
          const focused = state.index === index || partOf?.[here] === route.name;
          const name = options.title ?? route.name;
          const onPress = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            // `state.index`, not `focused`: a tab lit by `partOf` still goes to
            // its own screen when pressed from the one it is lit for.
            if (state.index !== index && !e.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable key={route.key} onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel ?? name}
              accessibilityState={{ selected: focused }}
              style={{
                // v2: four or five equal tabs, each an outline icon over its
                // name; the current one in the accent with a soft glow (plan
                // §6 "active tab icon drop-shadow accent@60%").
                flex: 1, minWidth: 0, minHeight: PILL, borderRadius: 18,
                alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4,
              }}>
              <View style={focused ? { boxShadow: `0 0 14px ${t.brand}66`, borderRadius: 14 } : null}>
                {options.tabBarIcon?.({ focused, color: focused ? t.brand : t.ink3, size: 22 })}
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={CAP}
                style={{ ...ty.tab, ...HERO_FIT, fontSize: 11, color: focused ? t.brandText : t.ink3 }}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
