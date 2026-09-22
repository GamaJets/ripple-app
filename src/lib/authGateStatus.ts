// What a provider's `status` becomes when there is no uid, and which of the two
// reasons there is not one.
//
// ── why this is a function and not three lines in three files ─────────────
//
// `sessionUid` and `signedInUid` hand back a `UidRead` whose failure half is
// already told apart: 'signed-out' means the credential was looked at and
// refused, or there was never one; 'unreadable' means the question could not be
// asked (src/lib/authReadFate.ts sets out the whole discrimination and why an
// unrecognised error lands in the second bucket). The providers in src/ui then
// have to turn that into their own vocabulary — src/ui/loadStatus.ts's
// 'ready' / 'error' — and the mapping is the entire defect, restated:
//
//     'signed-out' → 'ready'    nobody is signed in, so this coach's own list
//                               is empty and that emptiness is TRUE of them.
//     'unreadable' → 'error'    nothing was established about who they are, so
//                               nothing may be said about what they have.
//
// Written inline, that mapping is three characters away from the bug it fixes:
// swap the two arms and a dropped connection answers 'ready' with an empty map
// again, which is the sentence "you have written nothing about this client"
// said to a coach over a read that never happened. Nothing in this repo's gates
// can see that swap — check:reads is satisfied the moment `error` is named, and
// these providers are React hooks that reach react-native and so cannot be run
// by `npm test` at all. Mutation-testing the four call sites turned up exactly
// that: the mapping reversed in src/ui/coachNutrition.tsx compiled clean and
// passed every gate.
//
// So the mapping moves here, where it is pure, imported by four providers, and
// covered by src/lib/authGateStatus.test.ts — which does fail when it is
// reversed.
//
// ── where this does NOT apply ─────────────────────────────────────────────
//
// Only where a signed-out reader HONESTLY has nothing: a coach's own saved
// exercise names, their own private notes, their own nutrition adjustments.
// Every one of those is a set that is empty for somebody with no account, and
// 'ready' over an empty set is a true statement.
//
// It is wrong wherever the screen needs an identity before it can say anything
// at all. src/ui/coachPayTerms.ts and src/ui/coachRota.ts are the two in this
// family: "your gym has agreed no rate with you" and "your gym has you on no
// shifts" are claims about an employment relationship, not about an empty list,
// and neither may be printed for a reader nobody could name. Those two answer
// 'error' for both fates, in the branch, with the reason written beside it.

import type { AuthReadFate } from './authReadFate';

/**
 * The two statuses this decides between.
 *
 * A narrow literal union rather than `LoadStatus`, which lives in src/ui and
 * would be the first import from that folder into this one: src/lib is shared
 * by the phone apps and the web console and holds no dependency on either
 * app's own modules. The union is assignable to `LoadStatus` at every call
 * site, which is all the call sites need.
 */
export type AuthGateStatus = 'ready' | 'error';

/**
 * The status for a provider whose set is genuinely empty for a signed-out
 * reader.
 *
 * Read the header before reaching for this: it is the WRONG answer for a screen
 * that needs to know who somebody is before it can say anything, because there
 * 'ready' would license a sentence about a person nobody identified.
 *
 * Takes the fate rather than the whole `UidRead`, and takes it non-null, so it
 * can only be called from inside a branch that has already established there is
 * no uid — and so a caller cannot reach it by testing `!who.uid`, which does
 * not narrow the union (the signed-in member's `uid` is `string`, and `string`
 * includes '').
 */
export function authGateStatus(fate: AuthReadFate): AuthGateStatus {
  return fate === 'signed-out' ? 'ready' : 'error';
}
