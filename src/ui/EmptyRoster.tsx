// "Nobody is on your book yet" — eleven times, with no way out of any of them.
//
// ── What was found ────────────────────────────────────────────────────────
//
// Eleven per-client coach screens each wrote their own version of the same
// sentence and then stopped:
//
//   checklists            "…so there is no list to add to."
//   client-goals          "…so there are no goals to look at."
//   client-nutrition      "…so there is nobody to write a plan for."
//   client-body           "…so there are no scans to look at."
//   client-training       "…so there is no training to look at."
//   client-week           "…so there are no weeks to look at."
//   client-photos         (the sentence on its own)
//   client-attendance     "…so there is no record to open."
//   client-cancellations  "…so there is no record to open."
//   client-report         "You have nobody on your book yet."
//   client-intake         "You have nobody on your book yet."
//
// Every one of them is reachable from TRAINER_NAV and from Explore, so a coach
// who has just signed up can land on any of the eleven before they have a
// single client — and each one told them a true fact and offered nothing. Two
// screens did better (builder.tsx and log-session.tsx name the Clients screen
// in prose), which is the shape of the fix without the tap.
//
// ── Why a component and not eleven edits ──────────────────────────────────
//
// The sentence is the same fact eleven times over and the remedy is the same
// remedy, so a coach who learns it on one screen should meet it in the same
// place, in the same words, with the same control, on the other ten. Eleven
// copies is also how the first half drifts from the second — which is exactly
// what happened to the sentence itself: nine of them say "on your book" and
// two say "on your book yet" in a different clause order.
//
// What varies is only the tail: what THIS screen has none of. That is the one
// prop, and it is required, because "Nobody is on your book yet." with no tail
// is the version of this sentence that says nothing about where the coach is.
//
// ── Where the button goes, and why there ──────────────────────────────────
//
// `/(trainer)/dashboard?start=invite` — the Clients tab with its invite sheet
// already open, the same parameter src/lib/coachFirstRun.ts uses for the two
// checklist steps that are completed in that sheet (see dashboard.tsx's own
// comment on landing "on the control, not merely on the screen"). Pushing the
// tab alone would leave the coach looking for the control that the sentence
// has just told them about, which is the dead end one step along.
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from './components';
import { Ghost } from './kit';
import { sp, type as ty } from '../theme/scale';

/**
 * The empty-roster sentence, and the way out of it.
 *
 * `lacks` completes "Nobody is on your book yet, so …" — write it as the tail
 * of that sentence, lower case, no full stop: `there is no list to add to`.
 */
export function EmptyRoster({ lacks }: { lacks: string }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View>
      <Text style={{ ...ty.body, color: t.ink3 }}>
        Nobody is on your book yet, so {lacks}.
      </Text>
      {/* A Ghost rather than a Cta. A coach who opened this screen came to do
          the thing the screen is for, and a full-width primary button would
          make inviting somebody look like this screen's purpose. */}
      <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
        <Ghost label="Invite a Client" a11yLabel="Invite a client, on the Clients screen"
          onPress={() => router.push('/(trainer)/dashboard?start=invite')} />
      </View>
    </View>
  );
}
