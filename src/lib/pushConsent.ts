// Has this person agreed to receive push notifications, and do we know yet?
//
// ── The defect this module exists to close ─────────────────────────────────
//
// src/ui/auth.tsx called registerForPush() on every sign-in, unconditionally,
// without consulting the member's answer. registerForPush() asks the OS for
// notification permission and then writes a row into `push_tokens`, and
// `push_tokens` is the table the send-push edge function resolves recipients
// from — so a member who had turned Push Notifications OFF had the permission
// prompt raised at them anyway and had a live, deliverable token registered
// against their account. The switch said off. The token said yes. The token
// won. On the live database that is 20 rows across 15 accounts, none of which
// were ever checked against a preference.
//
// A toggle that says "off" and registers you anyway is not a cosmetic bug: it
// is a false statement about the person's own privacy, made by the one screen
// they went to in order to control it.
//
// ── Why the answer needs three states and not two ──────────────────────────
//
// The preference is persisted in AsyncStorage (the 'repple.settings' blob, see
// src/ui/settings.tsx) and AsyncStorage is asynchronous. So there is a real
// window at launch — from the first render until that read lands — in which
// nobody in this process knows what the member answered. A boolean cannot say
// that. It has to pick one of the two answers, and either choice is a lie: a
// default of `false` would silently drop registration for the majority who said
// yes, and a default of `true` is precisely the bug above, since the member who
// said no is exactly the member who is harmed by guessing.
//
// So 'unknown' is a value, and the rule for it is written down here rather than
// left to each caller: WHILE THE ANSWER IS UNKNOWN, NOTHING IS REGISTERED AND
// NOTHING IS ASKED OF THE OS. Asking for a permission we may not be entitled to
// ask for cannot be taken back — iOS shows the system prompt exactly once per
// install, and a member who is asked while their stored answer says no has had
// their answer overruled by a race. Registering one launch later costs a launch.
//
// ── Why "no stored answer" resolves to yes ─────────────────────────────────
//
// consentFromStored() applies the product's documented default, which is on
// (`DEFAULTS.notifPush = true` in src/ui/settings.tsx). A blob that has never
// been written, a blob that predates the key, and a blob too corrupt to parse
// are all indistinguishable from a fresh install, and a fresh install's answer
// is on — that is what the switch on the settings screen will show, because
// src/ui/settings.tsx falls back to the same default when its own parse fails.
// The two must agree: a screen that renders the switch ON while this module
// silently refused to register would be the original bug pointing the other way.
//
// The case this is careful about is the one that matters — a blob that parses
// and says `notifPush: false`. That is an answer, and it is honoured.
//
// ── Why a module and not a React context ───────────────────────────────────
//
// registerForPush() lives in src/ui/pushNotifications.ts and is called from
// outside React (an auth callback, a provider effect, a settings handler). A
// context would be unreadable from those places, and threading the answer
// through every call site as an argument is how the gate gets forgotten at the
// next one. A module-level latch is readable synchronously from anywhere, which
// is what lets `setPushEnabled(true)` register in the same tick it records the
// answer, instead of racing its own AsyncStorage write.
//
// SettingsProvider is mounted in app/_layout.tsx, above every route in all
// three apps, so the latch is always seeded within a tick or two of launch.

/** Yes, no, or nobody has read the stored answer yet. */
export type PushConsent = 'yes' | 'no' | 'unknown';

/**
 * What the persisted settings blob says about push.
 *
 * Pure, so the rule above is assertable without a device, a store, or a
 * network. `raw` is exactly what AsyncStorage handed back for 'repple.settings'
 * — null when nothing has ever been written.
 *
 * Never returns 'unknown': this function is only ever called on a read that
 * COMPLETED, and a completed read always yields an answer (the stored one, or
 * the default when nothing was stored). 'unknown' describes the window before
 * the read finishes, which is a fact about time and not about the blob.
 */
export function consentFromStored(raw: string | null | undefined): 'yes' | 'no' {
  if (raw == null) return 'yes';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return 'yes'; }
  // Not an object — 'null', '[]', '"x"', '3'. Nothing here is an answer, and
  // reading a property off it would throw or read undefined; either way the
  // blob is corrupt and a corrupt blob is treated as a fresh install.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'yes';
  const v = (parsed as Record<string, unknown>).notifPush;
  // A boolean and nothing else. A string "false" is not somebody's answer, it
  // is damage — and src/ui/settings.tsx's own reader accepts only booleans too,
  // so accepting more here would let the switch and the token store disagree.
  if (typeof v !== 'boolean') return 'yes';
  return v ? 'yes' : 'no';
}

// The answer this process is working from. Starts 'unknown' because at module
// load nobody has read anything, and the whole point of the type is that this
// state is representable rather than guessed at.
let current: PushConsent = 'unknown';

/** The answer, or 'unknown' while the stored one is still being read. */
export function pushConsent(): PushConsent { return current; }

/**
 * Record the answer, once it is known.
 *
 * Takes only 'yes' or 'no': this is a read landing or a member tapping the
 * switch, and neither of those can un-know an answer. Nothing may put the
 * process back into 'unknown', because a caller that did so would silently
 * disable push for the rest of the session.
 */
export function recordPushConsent(answer: 'yes' | 'no'): void { current = answer; }
