"use strict";
// Whether the coach's profile actually saved, said out loud.
//
// ── The question a person asked, that the screen could not answer ─────────
//
// "In the coach profile tab, when you change or update a setting, how do you
// save and know that the information is saved?"
//
// There was no answer. `src/ui/coachProfile.tsx` autosaves 600ms after the last
// edit and the write ended:
//
//     .then(() => {}, () => {})
//
// Both arms empty. Success and failure discarded identically, so the screen
// could not tell a saved bio from a refused one, and neither could the coach.
// A comment above it called this "right for a bio and wrong for [the public
// handle]". It is wrong for a bio too: the failure mode is not a wrong bio, it
// is a coach who typed one, saw nothing, and believes it is on their profile.
//
// ── The third defect, which nobody would guess ───────────────────────────
//
// The debounce cleanup was `clearTimeout(timer)`. React runs that on every
// dependency change AND on unmount — so a coach who changed a setting and left
// the screen within 600ms had the write CANCELLED. Not failed, not queued:
// never attempted, with nothing on screen having suggested there was anything
// in flight. Toggling "List me in Find a Trainer" and immediately going to look
// at the directory is exactly that gesture.
//
// So `saveState` has four values and not three: a pending write is a state a
// person can see and wait for, which is what makes leaving the screen a choice
// rather than an accident.
//
// ── Why not a Save button ────────────────────────────────────────────────
//
// Considered and rejected. Every field on this screen is a toggle, a chip or a
// text box that already commits on change, and half of them are inside sheets
// that dismiss themselves. A Save button would make all of that provisional and
// give the coach a new way to lose work — closing the screen with it unpressed.
// The autosave is the right shape; what it lacked was an answer. So the answer
// is a status line that names the moment of the last successful write, and says
// so when there has not been one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPending = exports.hasUnsavedWork = exports.IDLE_SAVE = void 0;
exports.saveLine = saveLine;
exports.leaveWarning = leaveWarning;
exports.afterWrite = afterWrite;
exports.profileFingerprint = profileFingerprint;
exports.isProfileEdit = isProfileEdit;
exports.profileWriteFailure = profileWriteFailure;
// The count, not the absence of an error. A write that matched no rows is not
// an error in PostgREST and looked exactly like a saved one here — see
// `profileWriteFailure` at the foot of this file.
const wroteRows_1 = require("./wroteRows");
exports.IDLE_SAVE = { state: 'idle', savedAt: null, error: null };
/**
 * The line under the profile fields, or null when there is nothing to say.
 *
 * Null only for 'idle'. A coach who has changed nothing needs no reassurance,
 * and a permanent "Saved" over an untouched screen is the kind of badge people
 * stop reading — which is the whole failure this is fixing, one layer up.
 *
 * `now` is an argument so the sentence is testable without a clock.
 */
function saveLine(s, now) {
    if (s.state === 'idle')
        return null;
    if (s.state === 'pending')
        return 'Saving your changes…';
    if (s.state === 'failed') {
        // Names what is true of the DATA, not of the request. "Request failed" tells
        // a coach nothing about whether their bio is on their profile; "not saved"
        // tells them exactly what they need to know and what to do about it.
        const why = s.error ? ` (${s.error})` : '';
        return `Your last change was NOT saved${why}. It is still on this screen but not on your profile — `
            + 'change something again to retry, or come back when you have a connection.';
    }
    const ago = Math.max(0, now - (s.savedAt ?? now));
    if (ago < 5000)
        return 'Saved.';
    if (ago < 60000)
        return 'Saved a moment ago.';
    const mins = Math.floor(ago / 60000);
    if (mins < 60)
        return `Saved ${mins} minute${mins === 1 ? '' : 's'} ago.`;
    const hrs = Math.floor(mins / 60);
    return `Saved ${hrs} hour${hrs === 1 ? '' : 's'} ago.`;
}
/**
 * Whether leaving now would lose something.
 *
 * The screen uses this to warn on the way out. True for 'failed' as well as
 * 'pending', because a failed write is also unsaved work — the coach can see
 * their text on screen and has no reason to think it is not on the server.
 */
const hasUnsavedWork = (s) => s.state === 'pending' || s.state === 'failed';
exports.hasUnsavedWork = hasUnsavedWork;
/** What to say when they try to leave with work outstanding. */
function leaveWarning(s) {
    if (s.state === 'pending') {
        return 'Your last change is still being saved. Give it a moment before you close the app, or it may not reach your profile.';
    }
    if (s.state === 'failed') {
        return 'Your last change was not saved and will be lost if you leave. Change something again to retry it.';
    }
    return null;
}
/** Fold a write's outcome into the status. Written as a reducer so the ordering
 *  rules live in one tested place rather than in four call sites. */
function afterWrite(prev, ok, at, error) {
    if (ok)
        return { state: 'saved', savedAt: at, error: null };
    // `savedAt` is CARRIED THROUGH a failure rather than cleared. The earlier
    // successful write really did happen, and forgetting it would turn "saved ten
    // minutes ago, and the last change did not land" into "never saved", which is
    // a worse description of the same profile.
    return { state: 'failed', savedAt: prev.savedAt, error: error?.trim() || null };
}
/**
 * A stable string for a set of profile values, so "did anything actually
 * change" can be answered without comparing eight fields by hand at a call
 * site.
 *
 * ── The defect this exists for ────────────────────────────────────────────
 *
 * The debounced write effect in `src/ui/coachProfile.tsx` fired on ANY change
 * to its dependency array, and `synced` and `hydrated` are in that array. So
 * the moment the server read settled — with the values that had just come FROM
 * the server — the effect ran, set `dirty`, and 600ms later PATCHed `profiles`
 * and `trainers` with them. Every launch. Seen on an iPhone: the app was
 * relaunched, nothing was typed, and the badge already read "Saved."
 *
 * It is not only a wasted round trip per coach per launch. It is a write of
 * handset-held state over server-held state, which is the direction that loses
 * data: two devices, or one device with a stale cache, and the last one to open
 * the app wins. The screen's own comment said "Nothing is drawn before the
 * first edit", and the code disagreed with it.
 *
 * ── Why a fingerprint and not a dirty flag on each setter ─────────────────
 *
 * Because the values arrive through eight different setters, from two different
 * sources (AsyncStorage then the server), across several awaits. A flag would
 * have to be cleared correctly by every one of them and would be wrong the
 * first time somebody added a ninth field. A fingerprint compared against the
 * last known server state cannot drift: if it differs, a person changed
 * something; if it does not, nothing needs writing whatever caused the render.
 *
 * Arrays are compared in order, because the order of a coach's specialities is
 * the order they chose to list them in and reordering is an edit.
 *
 * Null, undefined and empty string all fingerprint the same for the text
 * fields: they are the same statement — the coach has not written one — and a
 * launch that turned an absent tagline into an empty one would be exactly the
 * needless write this is here to stop. A session fee is NOT treated that way:
 * `null` is "no rate set" and `0` is a legacy row, and `src/ui/coachProfile.tsx`
 * maps the second to the first on read, so by the time a value reaches here the
 * two are already one thing.
 */
function profileFingerprint(v) {
    const text = (x) => String(x ?? '').trim();
    const list = (x) => Array.isArray(x) ? x.map((s) => String(s ?? '').trim()) : [];
    return JSON.stringify([
        text(v.name), text(v.photo), text(v.tagline), text(v.bio),
        list(v.offers), list(v.specialties),
        v.sessionFee == null || !Number.isFinite(Number(v.sessionFee)) ? null : Number(v.sessionFee),
        v.listed === true,
    ]);
}
/**
 * Has a person changed something since `baseline` was taken?
 *
 * `baseline` null means no baseline has been taken yet — the read has not
 * settled — and the answer is NO. That is the first-run guard: the first
 * settled render establishes what the server holds and writes nothing, and
 * every render after it is compared against that.
 */
function isProfileEdit(baseline, now) {
    if (baseline == null)
        return false;
    return baseline !== profileFingerprint(now);
}
const markPending = (prev) => ({ state: 'pending', savedAt: prev.savedAt, error: null });
exports.markPending = markPending;
/**
 * Why the coach's profile save cannot be reported as saved, or null when it
 * can.
 *
 * ── The half this module was missing ──────────────────────────────────────
 *
 * Everything above answers "did the request fail?". That was never the whole
 * question. A PostgREST UPDATE that matches ZERO rows is not an error — it
 * returns 204 with `error: null` — so the two statements behind this screen
 * could both come back clean having changed nothing, and `afterWrite(prev,
 * true, …)` printed "Saved." over it. The two ways that actually happens are
 * the two most likely states a coach can be in: no `trainers` row yet, and an
 * RLS policy refusing the write.
 *
 * `session_fee` goes through that second statement, and it is the number every
 * priced figure in Analytics and the Assistant is derived from. So the count is
 * what is checked here, exactly as src/lib/wroteRows.ts sets out — `null`
 * counted as not-confirmed, so a call site that forgets `{ count: 'exact' }`
 * says so rather than passing.
 *
 * BOTH halves are named. `profiles` holds the name and the photo and `trainers`
 * holds the bio, the rate and the directory listing, and a coach told only that
 * "your profile" did not save cannot tell which of the two is still only on
 * this phone.
 */
function profileWriteFailure(profiles, trainers) {
    const p = (0, wroteRows_1.writeFailure)('Your name and photo', profiles);
    const t = (0, wroteRows_1.writeFailure)('Your bio, rate and listing', trainers);
    if (p && t)
        return `${p} ${t}`;
    return p ?? t;
}
