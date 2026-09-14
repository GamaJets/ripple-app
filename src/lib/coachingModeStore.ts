// How a member says they are coached — and whose answer it is.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// src/ui/clientData.tsx kept the member's own coaching mode under one
// unqualified AsyncStorage key, `repple.coachingMode`, keyed by nothing at all.
// It is the fourth instance of the shape `repple.mealOverride`
// (src/lib/mealSwaps.ts), `repple.exerciseVideos` (src/lib/handsetClips.ts) and
// `repple.scanMetrics` (src/lib/scanMetricsStore.ts) were each written to end,
// and it is the worst of the four, because it does not stop at the handset.
//
// The path, traced end to end:
//
//   1. Member A on the gym's shared phone sets themselves to 'solo'. The push
//      effect writes 'solo' to the key.
//   2. A signs out. The key is not in `PERSONAL_DEVICE_KEYS`
//      (src/lib/signOutState.ts), it carries no account, and nothing else in
//      the tree removes it. It survives.
//   3. Member B signs in — a new member, or one between coaches, so their row
//      says `mode = 'online'` and `trainer_id = null`. The reconciler in the
//      hydrate reads the device key as `mine`, and its second branch is
//
//          : mine === 'solo' && r.trainer_id == null ? 'solo'
//
//      which is satisfied by A's answer and B's empty coach link. B is
//      switched to solo without being asked.
//   4. And then it is PROMOTED: `update({ mode: agreed }).eq('id', sbUid)`
//      writes A's answer onto B's row on the SERVER, where the coach's roster
//      and the web console read it.
//   5. `soloHide` in src/lib/features.ts then takes Book a Session, Ask for a
//      Time, Standing Appointments, Weekly Check-in and Messages off B's
//      Explore screen — a member who cannot find the way to message their coach
//      and has not been told why.
//
// The branch above it inherits the same way: A's 'hybrid' beside B's server
// 'inperson' promotes 'hybrid' onto B's row.
//
// So this is not "the next member sees a stale preference". It is one member's
// answer becoming another member's recorded fact, visible to their coach, with
// a screen hidden behind it.
//
// ── The fix, and why it is the key rather than the branch ─────────────────
//
// The account goes in the key. The reconciler is CORRECT about the account it
// was written for — that file says what it is for at length: `clients.mode`
// could not hold 'hybrid' or 'solo' before part 57, so a member who chose one
// of those has a truthful answer on their device and a narrowed one on the
// server, and this promotes the fuller one once. Every line of that reasoning
// is about one person. What was missing is any statement of WHICH person, and
// a key with the account in it is that statement, made by construction. It is
// also why src/lib/signOutState.ts needs no entry for it: an account-scoped key
// is unreadable to the next account without destroying the departing member's
// copy.
//
// ── What is NOT migrated, and why — and why it is easier here ─────────────
//
// The unqualified key is REMOVED on sight, never read into the signed-in
// account, which is the call made for all three keys before it. Nothing on the
// device distinguishes a single-owner handset's own old answer from a shared
// handset's previous member's, so reading it would be this defect performed
// once, deliberately.
//
// It is a cheaper call here than it was for the scan metrics, and that is worth
// saying out loud rather than leaving as a pattern that was followed. A
// coaching mode is a PREFERENCE with a server row behind it and a control in
// the app: `clients.mode` already holds all four answers, the reconciler's own
// header says the device "never overrides the server, it only fills in what the
// server cannot say", and the only thing lost by dropping the key is the
// pre-part-57 promotion for a handset whose owner has not launched the app
// since — after which they see the server's narrowed answer and set it right in
// one tap on a screen built to ask them. Weigh that against the alternative,
// which is a stranger's answer written onto a member's row and five features
// removed from their app, and the two are not close.
//
// `LEGACY_COACHING_MODE_KEY` is exported so the provider can remove it on
// sight, and so the choice is visible to a reader rather than implied.

/** Every coaching-mode key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const COACHING_MODE_PREFIX = 'repple.coachingMode:';

/** The unqualified key this replaces. Removed on sight, never read — see the
 *  header. */
export const LEGACY_COACHING_MODE_KEY = 'repple.coachingMode';

/**
 * Where this member's own answer lives.
 *
 * Null when there is no account to scope it to, and a null means DO NOT READ
 * and DO NOT WRITE. Both ends of this key are already gated on a signed-in uid
 * — the reconciler runs inside the hydrate for one account, and the push effect
 * refuses without `sbUid` — so a null here is a belt on a fact the callers
 * already hold, and the reconciler treats it exactly as it treats a key that is
 * not there: the server's answer stands, unmodified, which is the safe end.
 */
export function coachingModeKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx publishes as `id` before the
  // auth read lands. It is not an account; every signed-out session on a
  // handset would otherwise share one key, which is the whole defect. Guarded
  // the same way `mealSwapsKey`, `handsetClipsKey` and `scanMetricsKey` guard
  // it.
  if (!id || id === 'unknown') return null;
  return `${COACHING_MODE_PREFIX}${id}`;
}

/** Whether a key holds somebody's coaching mode. For the sign-out assertion. */
export const isCoachingModeKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(COACHING_MODE_PREFIX);
