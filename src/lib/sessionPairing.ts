// Pairing a heart-rate source WITHOUT leaving the session that is running.
//
// ── the note this module is the answer to ─────────────────────────────────
//
// `ZonePanel` in app/(client)/workouts.tsx carries this, and has since it was
// written:
//
//     Deliberately not a link to the settings: leaving mid-session to go and
//     pair a device would abandon the workout being logged.
//
// The refusal is right. That screen holds sets typed on a rack, a wall-clock
// elapsed, a live zone tally and an offline queue, and navigating away from it
// is how a member loses an hour of work they cannot retype.
//
// What it left behind is a member who reads, mid-session, the sentence
// `zonesNote('none')` prints — "Connect a watch under Train → Watch & Devices
// and your zones appear here live while you train" — and has exactly two
// options: obey it and lose the session, or finish without heart rate. The
// second is what happens, and it is unrecoverable: HealthKit is not asked, so
// nothing writes the samples, and no later screen can reconstruct a zone
// breakdown for an hour nobody was reading a pulse during.
//
// The sheet is the missing third option. Connecting is a permission prompt and
// an AsyncStorage write — `connect()` in src/ui/wearables.tsx — and neither
// needs the session to unmount. So the pairing comes to the session rather than
// the member going to the pairing.
//
// ── why the sentences are here and not in watchReach.ts ───────────────────
//
// `zonesNote` and `liveHrNote` (src/lib/watchReach.ts) are shared with screens
// that genuinely have no pairing to offer, and their 'none' sentence sends the
// reader to the settings BY NAME. Rewriting it there would point every caller at
// a sheet most of them do not have. So this module holds the in-session
// sentences, the panel prefers them when a sheet is wired, and watchReach keeps
// saying the true thing for everybody else.
//
// Pure: no provider is called and no state is touched. The registry and the
// connection map arrive as arguments so every branch can be asserted under
// plain node.
import type { WatchReach } from './watchReach';

/** The two provider kinds that can stream per-second samples into a running
 *  session. A cloud vendor returns day aggregates — src/lib/watchReach.ts makes
 *  the same exclusion and gives the reason: offering to pair an Oura ring
 *  mid-session would promise live zones that cannot arrive. */
export const LIVE_KINDS = ['healthkit', 'health-connect'] as const;

/** The shape this module needs from `PROVIDERS`. Structural, so a test can hand
 *  it four inventions rather than standing up the real registry. */
export interface PairableSource {
  id: string;
  name: string;
  kind: string;
  /** Whether the provider can run in THIS binary on THIS device. */
  available: boolean;
  /** Why not, in the provider's own words, when it cannot. */
  unavailableReason: string | null;
}

/** A source as the sheet draws it. */
export interface PairRow extends PairableSource {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** Whether pressing it would do anything. */
  actionable: boolean;
  /** The button's word. */
  action: string;
}

/**
 * The sources worth showing in a running session, in registry order.
 *
 * Only the live kinds, and unavailable ones are KEPT rather than filtered out.
 * That is deliberate and it is the lesson src/lib/wearables/registry.ts records
 * about its own catalogue: a device that silently is not listed reads as a
 * device this app does not support, and the member goes looking for it in the
 * settings — which is the trip this whole item exists to save them. Listed with
 * its reason, it answers the question where it was asked.
 */
export function pairRows(
  sources: readonly PairableSource[],
  states: Readonly<Record<string, string | undefined>>,
): PairRow[] {
  const out: PairRow[] = [];
  for (const s of sources) {
    if (!(LIVE_KINDS as readonly string[]).includes(s.kind)) continue;
    const raw = states[s.id];
    const state: PairRow['state'] =
      raw === 'connected' || raw === 'connecting' || raw === 'error' ? raw : 'disconnected';
    const actionable = s.available && state !== 'connecting' && state !== 'connected';
    out.push({
      ...s,
      state,
      actionable,
      action: !s.available ? 'Unavailable'
        : state === 'connected' ? 'Connected'
        : state === 'connecting' ? 'Asking…'
        : state === 'error' ? 'Try again'
        : 'Connect',
    });
  }
  return out;
}

/** Whether there is anything here a member could actually press. */
export function canPairHere(rows: readonly PairRow[]): boolean {
  return rows.some((r) => r.actionable);
}

/**
 * The invitation shown on the zone panel, or null when there is nothing to say.
 *
 * Null for 'live' — a reading is arriving, there is nothing to pair — and null
 * when no source on this device could stream one, because an offer that opens a
 * sheet saying "nothing here can do this" is worse than the settings sentence it
 * replaced. In both of those the panel falls back to `zonesNote`, which is
 * still true.
 *
 * 'connected-silent' gets its own line. A member whose watch IS paired and is
 * sending nothing must not be offered "pair a monitor" — that is the exact
 * confusion src/lib/watchReach.ts was written to end, a screen telling somebody
 * with a connected watch to connect a watch.
 */
export function pairInvite(reach: WatchReach, pairable: boolean): string | null {
  if (!pairable) return null;
  switch (reach) {
    case 'live':
      return null;
    case 'stale':
    case 'connected-silent':
      // Not an invitation to pair — they already have. What this offers is the
      // permission check, which is the half of pairing that silently fails.
      return 'Paired and quiet? Check what this app is allowed to read, without leaving your session.';
    case 'none':
      return 'No heart-rate source yet. You can pair one here; your sets, your clock and your session all stay exactly where they are.';
  }
}

/** The button beside `pairInvite`. */
export function pairInviteAction(reach: WatchReach): string {
  return reach === 'none' ? 'Pair a monitor' : 'Check my monitor';
}

/**
 * What actually happened, decided from the state AFTER the attempt.
 *
 * Never from the absence of a throw. `connect()` in src/ui/wearables.tsx
 * resolves `void` and sets the provider's state to 'error' on failure, so an
 * awaited call that came back tells you nothing at all — the same shape as the
 * Supabase writes check-writes.mjs exists for, in a different library. A sheet
 * that said "Connected" because nothing threw would send a member back into
 * their session believing they had a heart rate.
 */
export type PairOutcome = 'connected' | 'refused' | 'pending';

export function pairOutcome(stateAfter: string | undefined): PairOutcome {
  if (stateAfter === 'connected') return 'connected';
  if (stateAfter === 'connecting') return 'pending';
  return 'refused';
}

/**
 * What to tell the member once the attempt has settled.
 *
 * The 'connected' sentence is the one that has to be careful. Connecting is not
 * the same as reading: `watchReach.ts` sets out at length that an Apple Watch
 * only streams heart rate while a workout is running ON THE WATCH, and that
 * HealthKit will never tell an app whether READ access was granted. So the
 * success line claims the connection and asks for the one thing that actually
 * produces samples, rather than promising zones that may never arrive.
 */
export function pairResultNote(outcome: PairOutcome, hasSample: boolean): string {
  switch (outcome) {
    case 'connected':
      return hasSample
        ? 'Connected, and a reading is coming through. Your zones are building from now on. The minutes before this are not counted, because nothing was measuring them.'
        : 'Connected. Nothing is coming through yet: an Apple Watch only streams heart rate while a workout is running ON THE WATCH, so start one there. Zones build from the first reading, not from the start of this session.';
    case 'pending':
      return 'Still asking. Answer the permission prompt and this will update on its own.';
    case 'refused':
      return 'Not connected. Nothing was changed and your session is untouched. You can carry on and pair later, or try again here.';
  }
}

/**
 * The sentence that stops a member believing their whole session has zones.
 *
 * Pairing halfway through a workout cannot retrofit the first half: no source
 * was recording it, so those minutes are absent rather than zero. Said plainly,
 * once, because the alternative is a zone board that reads as an hour's effort
 * when it describes twenty minutes of it — the exact class of figure the house
 * rule about nulls exists for.
 */
export const MID_SESSION_GAP_NOTE =
  'Zones count from the first reading. The part of this session before that is not in them. It was not measured, so it is missing rather than empty.';
