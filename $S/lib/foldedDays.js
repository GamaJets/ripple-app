"use strict";
// Which days of a programme the coach has folded shut, kept across an edit
// that moves them.
//
// ── The bug this exists to end ────────────────────────────────────────────
//
// The programme builder folds a day away by INDEX: `foldedDays[2]` means "the
// third day in the list is collapsed". That is the cheapest key available and
// it is a key that means something different after every structural edit,
// because removing a day shifts every day after it down one.
//
// So: fold Tuesday, then delete Monday. Wednesday inherits index 1, index 1 is
// still marked folded, and Wednesday renders collapsed while Tuesday — the one
// the coach actually put away — is open. On the builder screen, where the
// standing fear is losing work, a day that has silently closed itself reads as
// a day whose exercises are gone. The comment on `foldedDays` had claimed since
// it was written that the map is reset when a day is removed; `removeDay` was a
// bare `filter` that never touched it.
//
// Resetting would fix the misattribution and throw away every fold the coach
// set, on a screen where the whole point of folding is to keep a five-day
// programme readable. Re-keying costs nothing and keeps them, so that is what
// this does: the removed day's entry is dropped, everything above it slides
// down by one, and everything below it is untouched.
//
// A pure function with a test because it is an off-by-one over a sparse map,
// which is the kind of thing that looks right in review and is wrong at one
// end. Its callers are in app/(trainer)/builder.tsx.
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldsAfterRemoval = foldsAfterRemoval;
exports.foldsForNewProgramme = foldsForNewProgramme;
/**
 * The fold map as it should be after the day at `removed` is deleted.
 *
 * Indices above `removed` shift down by one; the removed day's own entry goes;
 * indices below it are unchanged. Keys that are not finite non-negative
 * integers are dropped rather than carried — nothing legitimate writes one, and
 * a key that cannot name a day cannot fold one either.
 *
 * `false` entries are dropped as well, because the map's absence of a key
 * already means "open"; keeping them would grow it for the life of the screen
 * with no reader able to tell the two apart.
 */
function foldsAfterRemoval(folds, removed) {
    const next = {};
    for (const key of Object.keys(folds)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0)
            continue;
        if (!folds[i])
            continue;
        if (i === removed)
            continue;
        next[i > removed ? i - 1 : i] = true;
    }
    return next;
}
/**
 * The fold map for a day list that has been replaced wholesale — loading a
 * client's programme, loading a template, clearing the builder, or restoring a
 * draft.
 *
 * Nothing carries over, because the indices now name entirely different days.
 * Written as a named function rather than a bare `{}` at four call sites so
 * that the reason is stated once and a fifth caller has something to reach for.
 */
function foldsForNewProgramme() {
    return {};
}
