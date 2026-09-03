// When the intake screen may put a document on screen, and when it may send one.
//
// ── The defect this exists for ─────────────────────────────────────────────
//
// `app/(client)/intake.tsx` seeded its draft from the first settled read and
// latched — `if (m.status === 'loading' || seeded.current) return;`. The latch
// is right for the ordinary case: every keystroke writes a draft, the draft is
// a dependency of the seeding effect, and without a latch the second run would
// re-derive "restored" from what the member had just typed and put a banner
// about recovering their answers over a form they never left.
//
// It is wrong for one case, and that case destroys medical data.
//
// The first read FAILS. The screen seeds a blank marked 'local', draws the
// crit Flag — "this is not your form … saving now could replace answers you
// have already given" — and withholds Save. The member then does the one thing
// the screen offers them: they pull to refresh. The read succeeds, the
// provider's status goes to 'ready' carrying their real answers, and:
//
//   · the Flag disappears, because it is drawn on `status === 'error'`;
//   · `canSave` flips true, because it is `status === 'ready'`;
//   · and the draft on screen is still the blank one, because of the latch.
//
// Three things move together and all three move the wrong way. The member sees
// "0 of 7 parts answered", no warning, and a live Save button, and pressing it
// writes an empty document over a readiness questionnaire — heart conditions,
// chest pain, medication, injuries — that their coach programmes against. The
// gesture the screen offers to recover from the failure is what disarms the
// guard the screen's own header says must hold.
//
// ── The rule ───────────────────────────────────────────────────────────────
//
// A seed that stood in for a document that could NOT be read is provisional.
// The moment the document can be read, it is replaced — by `draftDecision`,
// which is already the thing that refuses to let a phone-only draft silently
// overwrite a server document it was never typed on top of. A seed taken from
// a read that LANDED is final, and the latch still holds for it.
//
// And Save is gated on the seed as well as on the status, because those are two
// different questions. `status === 'ready'` says the server answered; it does
// not say that what is on screen came from that answer. Between the status
// flipping and the effect re-seeding there is a frame where it did not, and a
// frame is enough — this is a full-screen form with a docked Save.
import type { LoadStatus } from '../ui/loadStatus';

/**
 * Where the document on screen came from.
 *
 *   'server'   the read landed and this is what came back.
 *   'restored' typed on this phone, put back without asking because there was
 *              nothing on the server to lose or it was built from this exact
 *              document.
 *   'local'    the read FAILED and this is a phone-only form standing in for
 *              one that may be full. Provisional, and never sent.
 *
 * `null` is "nothing has been seeded yet", which is not the same as any of them.
 */
export type IntakeSource = 'server' | 'restored' | 'local';

/**
 *   'wait'  the read is still in flight; seed nothing.
 *   'seed'  (re-)derive the document on screen from what is now known.
 *   'hold'  what is on screen came from a read that landed. Leave it alone —
 *           re-seeding would overwrite the member's own keystrokes.
 */
export type SeedAction = 'wait' | 'seed' | 'hold';

/** Whether the seeding effect should run, given how the read went and what is
 *  already on screen. */
export function intakeSeedAction(status: LoadStatus, seededFrom: IntakeSource | null): SeedAction {
  if (status === 'loading') return 'wait';
  // Nothing on screen yet.
  if (seededFrom === null) return 'seed';
  // A stand-in for a document that could not be read, and now it can be.
  // 'partial' and 'ready' both mean the server answered; either is better than
  // a blank standing in for an unknown, and `draftDecision` still owns what
  // happens to anything typed in the meantime.
  if (seededFrom === 'local' && status !== 'error') return 'seed';
  return 'hold';
}

/**
 * May this screen write what is on it to the server?
 *
 * Both halves are required and they are not the same claim. The status says the
 * server answered. The source says the document on screen is what it answered
 * with. A 'local' document under a 'ready' status is precisely the state the
 * pull-to-refresh used to leave the screen in.
 *
 * 'partial' is refused for the reason src/lib/overwriteGuard.ts refuses it: a
 * document read in part is as unknown, for the purpose of replacing it, as one
 * not read at all.
 */
export function intakeSaveAllowed(status: LoadStatus, seededFrom: IntakeSource | null): boolean {
  return status === 'ready' && (seededFrom === 'server' || seededFrom === 'restored');
}

/**
 * Which sentence belongs at the top of the screen.
 *
 *   'loading' the read is in flight.
 *   'unread'  the read failed and what is on screen is a phone-only stand-in.
 *             Nothing may be sent from here.
 *   'stale'   the read failed, but an EARLIER read landed and its answers are
 *             what is on screen. A different sentence, because "this is not
 *             your form" is false of it — it is your form, read a moment ago,
 *             and only the re-read failed.
 *   'none'    the read landed.
 */
export type IntakeBanner = 'loading' | 'unread' | 'stale' | 'none';

export function intakeBanner(status: LoadStatus, seededFrom: IntakeSource | null): IntakeBanner {
  if (status === 'loading') return 'loading';
  if (status !== 'error') return 'none';
  return seededFrom === 'server' || seededFrom === 'restored' ? 'stale' : 'unread';
}
