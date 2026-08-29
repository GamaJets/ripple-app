// Whether the signed-in user's own trainer profile is a thing this build may
// read at all — and what every field of it is allowed to be when it is not.
//
// ── The bug this module exists for (TF-32) ──────────────────────────────────
//
// `useCoachProfile()` was named for what screens wanted (the coach) rather than
// for what it did. It calls `supabase.auth.getUser()` and loads THAT user's own
// `profiles` row and `trainers` row. On the coach app the signed-in user is the
// coach, so it was right; the name made it look right everywhere else too, and
// it is importable from everywhere else.
//
// On the client app the signed-in user is the client, and it was found on four
// of their screens at once. Messages headed the thread with the reader's own
// name under "Your coach". Calendar printed that name in seven places, took
// INITIALS of it, wrote it into an ICS file that lands permanently in the
// reader's real calendar, and interpolated it into a push notification sent to
// OTHER PEOPLE. It also drew `profiles.avatar` for the same id, so a client saw
// their own face labelled as their coach. Bookings titled every session "PT
// with {their own name}".
//
// And the money. A client has no row in `trainers`, so `sessionFee` never
// loaded and sat at its initial 0 forever — which rendered "Session rate $0"
// and "a $0 late fee may apply" on the screen where somebody decides whether
// cancelling is going to cost them anything. Nothing was wrong with the read;
// the initial value was a number where there was no number.
//
// ── Why this is a refusal and not just a rename ─────────────────────────────
//
// The call sites were all fixed, and a rename (`useMyTrainerProfile`) states
// the precondition to the next person who goes looking. But a name is advice.
// This decides the same question in code, so the provider can hold the field
// values back rather than trusting every future caller to have read the name:
//
//   - the app variant is a BUILD constant, so a client or owner bundle is known
//     to be the wrong app before a single row is read, and the provider does not
//     issue the reads at all. `name` and `photo` cannot be the reader's own
//     because nothing ever fetched the reader's own row.
//   - a signed-in user with no `trainers` row is not a trainer, whatever app
//     they are holding, so the trainer-side fields stay blank there too.
//
// Kept pure and separate from the provider so all five outcomes can be asserted
// directly (trainerProfileAccess.test.ts) rather than through a Supabase client.
import type { AppVariant } from './variant';

/**
 * Why (or whether) this build may show the signed-in user's own trainer profile.
 *
 * 'wrong-app' and 'not-a-trainer' are deliberately distinct even though they
 * blank the same fields: the first is decided at build time and is permanent for
 * the whole bundle, the second is about who happens to be signed in right now
 * and flips the moment a coach signs in on a coach build. Only the first means
 * "no future read here can ever be right".
 */
export type TrainerAccess =
  | 'wrong-app'
  | 'loading'
  | 'signed-out'
  | 'not-a-trainer'
  | 'ok';

/**
 * What the `trainers` select found.
 *
 * 'absent' means the read came back and said there is no such row — the stable
 * fact that this account is not a trainer. 'unknown' means the read has not
 * happened or did not come back, which is not the same thing and must not be
 * reported as though it were.
 */
export type TrainerRowRead = 'present' | 'absent' | 'unknown';

/** The four facts the decision is made from. Nothing else is consulted. */
export interface TrainerAccessRead {
  /** Which of the three apps this bundle is. A build constant. */
  variant: AppVariant;
  /** False until the server read for the current user has finished. */
  settled: boolean;
  /** Whether `supabase.auth.getUser()` returned a user. */
  signedIn: boolean;
  /** What the `trainers` select for that user found. */
  trainerRow: TrainerRowRead;
}

/**
 * Decide access. Ordered so the permanent answer comes first: on a client or
 * owner bundle there is nothing to wait for and nothing to sign in as, and
 * saying 'loading' there would invite a caller to render a spinner for a value
 * that is never going to arrive.
 *
 * An 'unknown' trainer row resolves to 'ok', and that is deliberate. The case
 * this whole module guards against — a reader being shown themselves as their
 * own coach — is already ruled out above by the variant, which is a build
 * constant and needs no network. All that is left to establish on a coach build
 * is whether this particular account finished provisioning, and answering "you
 * are not a trainer" to a coach whose read merely timed out would blank their
 * own profile screen and, because the setters are gated on the same answer,
 * quietly stop saving what they typed into it. The fields that failed to load
 * stay empty and the fee stays null on their own; nothing has to be invented to
 * fill them.
 */
export function resolveTrainerAccess(r: TrainerAccessRead): TrainerAccess {
  if (r.variant !== 'trainer') return 'wrong-app';
  if (!r.settled) return 'loading';
  if (!r.signedIn) return 'signed-out';
  if (r.trainerRow === 'absent') return 'not-a-trainer';
  return 'ok';
}

/** True only when the profile really is the signed-in user's own trainer profile. */
export function mayReadTrainerProfile(a: TrainerAccess): boolean {
  return a === 'ok';
}

/**
 * The profile itself. `sessionFee` is the only nullable number here, and it is
 * nullable for the reason the rest of this file exists: 0 is a rate a coach can
 * actually charge, so it cannot also be the way the app says it does not know
 * the rate. Consumers get a type error rather than a plausible zero.
 */
export interface TrainerProfileFields {
  name: string;
  photo: string | null;
  tagline: string;
  bio: string;
  offers: string[];
  specialties: string[];
  /** Dollars per session, or null when no rate is known. Never 0-as-unknown. */
  sessionFee: number | null;
  listed: boolean;
}

/**
 * What every field is when access is not 'ok'. Frozen, and the arrays with it,
 * because this object is handed straight out of the provider on the wrong app —
 * a caller that pushed onto `offers` would be mutating the blank for everybody.
 */
export const NO_TRAINER_PROFILE: TrainerProfileFields = Object.freeze({
  name: '',
  photo: null,
  tagline: '',
  bio: '',
  offers: Object.freeze([]) as unknown as string[],
  specialties: Object.freeze([]) as unknown as string[],
  sessionFee: null,
  listed: false,
});

/**
 * The fields a consumer is allowed to see. The loaded values pass through only
 * when the profile is genuinely the signed-in user's own; otherwise the blank
 * goes out, so a screen on the wrong app renders empty rather than rendering
 * the reader.
 */
export function guardTrainerProfile(
  access: TrainerAccess,
  loaded: TrainerProfileFields,
): TrainerProfileFields {
  return mayReadTrainerProfile(access) ? loaded : NO_TRAINER_PROFILE;
}

/**
 * A sentence for a coach-app screen that has nothing to show yet, or null when
 * there is nothing to explain.
 *
 * Null on 'wrong-app' on purpose: there is no correct copy for that case,
 * because there is no screen on the client or owner app that should be asking.
 * A screen wanting a coach's details there needs a different source entirely
 * (see src/lib/threadPeer.ts for how the client app names its coach), and
 * handing it a tidy explanation would make the wrong thing look finished.
 */
export function trainerAccessNote(a: TrainerAccess): string | null {
  switch (a) {
    case 'ok':
      return null;
    case 'loading':
      return 'Loading your profile…';
    case 'signed-out':
      return 'Sign in to see your profile.';
    case 'not-a-trainer':
      return 'This account is not set up as a trainer yet, so there is no coaching profile to show.';
    case 'wrong-app':
      return null;
  }
}
