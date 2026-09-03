"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_TRAINER_PROFILE = void 0;
exports.resolveTrainerAccess = resolveTrainerAccess;
exports.mayReadTrainerProfile = mayReadTrainerProfile;
exports.guardTrainerProfile = guardTrainerProfile;
exports.trainerAccessNote = trainerAccessNote;
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
function resolveTrainerAccess(r) {
    if (r.variant !== 'trainer')
        return 'wrong-app';
    if (!r.settled)
        return 'loading';
    if (!r.signedIn)
        return 'signed-out';
    if (r.trainerRow === 'absent')
        return 'not-a-trainer';
    return 'ok';
}
/** True only when the profile really is the signed-in user's own trainer profile. */
function mayReadTrainerProfile(a) {
    return a === 'ok';
}
/**
 * What every field is when access is not 'ok'. Frozen, and the arrays with it,
 * because this object is handed straight out of the provider on the wrong app —
 * a caller that pushed onto `offers` would be mutating the blank for everybody.
 */
exports.NO_TRAINER_PROFILE = Object.freeze({
    name: '',
    photo: null,
    tagline: '',
    bio: '',
    offers: Object.freeze([]),
    specialties: Object.freeze([]),
    sessionFee: null,
    listed: false,
    publicHandle: null,
    publicPage: false,
});
/**
 * The fields a consumer is allowed to see. The loaded values pass through only
 * when the profile is genuinely the signed-in user's own; otherwise the blank
 * goes out, so a screen on the wrong app renders empty rather than rendering
 * the reader.
 */
function guardTrainerProfile(access, loaded) {
    return mayReadTrainerProfile(access) ? loaded : exports.NO_TRAINER_PROFILE;
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
function trainerAccessNote(a) {
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
