// The Back handlers for a detail screen and for the hub it belongs to. The
// rule they follow, and why it is not simply router.back(), is in
// src/lib/backTo.ts — kept there so it can be tested without pulling
// expo-router into node.
import { useNavigation, useRouter } from 'expo-router';
import {
  backDestination,
  previousNonDetailRouteName,
  previousRouteName,
  routeNameOf,
  type NavState,
} from '../lib/backTo';

/**
 * Back from a detail screen: the screen that opened it when it said so, and
 * the navigator's own idea of back when it did not.
 *
 * When the navigator would ALREADY land on that origin, it is let do it.
 * Going back shortens the history; navigating instead appends this screen
 * behind the origin, and then the origin's Back returns here. The common path
 * is therefore untouched, and the carried origin only overrides the navigator
 * on the paths where its history has drifted away from what the person did.
 */
export function useBackTo(from: string | undefined): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  return () => {
    const dest = backDestination(from);
    if (!dest) { router.back(); return; }
    const state = navigation.getState?.() as NavState;
    if (previousRouteName(state) === routeNameOf(dest)) { router.back(); return; }
    router.navigate(dest as never);
  };
}

/**
 * Back from a hub screen — one whose rows open detail screens.
 *
 * Skips its own details. Without this, a detail that navigated here rather
 * than popping sits behind us in the tab history, and Back walks forward into
 * the movement the person just finished reading.
 */
export function useBackFromHub(group: '(client)' | '(owner)' | '(trainer)'): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  return () => {
    const state = navigation.getState?.() as NavState;
    const skipTo = previousNonDetailRouteName(state);
    // Nothing to skip — the navigator already agrees, so let it do the work
    // and keep the history one entry shorter.
    if (!skipTo || skipTo === previousRouteName(state)) { router.back(); return; }
    // Every screen in a group is a file in it, so its route name IS its path.
    router.navigate(`/${group}/${skipTo}` as never);
  };
}
