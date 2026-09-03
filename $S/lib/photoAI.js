"use strict";
// The member's answer about sending a PHOTOGRAPH they have just framed to a
// language model.
//
// ── Why this is not the AI Coach's consent ────────────────────────────────
//
// src/lib/coachShare.ts asks about the member's own health FIGURES — their
// weight, their tape measurements, their check-in scores — going to a model as
// text. This asks about something with a different subject: a photograph taken
// on a gym floor routinely contains other members, and none of them are in the
// room when the question is put. A "yes" to one is not a "yes" to the other,
// so they are two answers under two keys, and neither is allowed to stand in
// for the other.
//
// ── What the member is actually agreeing to ───────────────────────────────
//
// `analyzeMachine` and `analyzeMeal` in src/lib/vision.ts post the image to the
// `vision-analyze` edge function, which posts it to api.anthropic.com — see
// supabase/functions/vision-analyze/index.ts. Before this, the ONLY thing
// either screen said was a camera permission — "Allow camera access to identify
// a machine by photo", "Allow camera to log a meal by photo" — which describes
// the camera and not the destination. A permission dialog about hardware is not
// consent about where the frame goes.
//
// ── TWO SUBJECTS, ONE PATTERN, TWO KEYS ───────────────────────────────────
//
// This module started with one subject, the machine scanner. The meal-photo
// path in app/(client)/foodlog.tsx and app/(client)/nutrition.tsx was the same
// defect — `analyzeMeal(base64)` behind a camera permission and nothing else —
// and it is EXACTLY the same question: the same recipient (Anthropic), the same
// payload (a whole frame, not an extract), and the same property that decides
// the shape of the answer, which is that the member composes the picture, in
// the moment, looking at what is in it, for this purpose.
//
// So it is this module and not a third one. What is NOT shared is the ANSWER.
// `PHOTO_AI_KEYS` gives each subject its own AsyncStorage key, because somebody
// who agreed to photograph a leg press on a gym floor has not agreed to
// photograph their kitchen table with their family around it. Reusing one key
// would inherit a yes onto a question that was never put — which is the defect
// named three paragraphs down, pointing the other way. `usePhotoAI` takes the
// subject as a REQUIRED argument for the same reason `readInjuryDocument` takes
// consent as one: a screen that has not said which question it asked does not
// compile.
//
// ── WHY THIS IS A REMEMBERED ANSWER AND NOT A LEDGER ──────────────────────
//
// src/lib/injuryDocConsent.ts argues at length that a medical document must be
// asked about PER DOCUMENT, with a row in the database written before the send,
// because "a setting ticked months ago cannot consent to a document that did
// not exist yet": the member who agreed while adding a sprained ankle has not
// agreed to the oncology letter they upload in March, and NOTHING ABOUT THE
// FIRST ANSWER KNOWS WHAT THE SECOND DOCUMENT CONTAINS — including the person
// answering, who has not read it yet either.
//
// That argument turns entirely on the document being a thing that arrives from
// outside, composed by somebody else, whose contents the member has not
// inspected. A photograph is the other case. The member points the camera, sees
// the frame, and presses the button; the contents are decided by them, at the
// moment of sending, with the question already answered and the rule in front
// of them ("frame the machine", "the people at your table go too"). There is no
// gap between what they agreed to and what they can see, because the thing they
// are agreeing about does not exist until they make it.
//
// The second half of the argument is the one that actually settles it. A meal
// photo is a HIGH-FREQUENCY act — three or four a day, every day, for as long
// as somebody logs their food. A per-photo modal on that path is not a stronger
// consent than a remembered one; it is a weaker one, because the fourth time
// today it is an obstacle between a person and their lunch and it gets tapped
// through without being read. Consent fatigue converts a question into a
// gesture, and a gesture is not an answer. The injury-document path is asked
// per document precisely because it is rare — a handful of documents in a
// lifetime of using the app — so the question is still being READ on the tenth
// one.
//
// So: asked once per subject, before the camera opens, remembered, and
// CHANGEABLE — a 'no' does not close the door, it re-puts the question on the
// next tap (see `mayAnalyzePhoto`, where 'unasked' and 'refused' are separate
// blocks landing on the same sheet). What is deliberately NOT here is a durable
// per-item row: there is no artefact for it to be about. Nothing is stored, the
// photograph is not kept by this app at all, and a ledger of "on 14 March you
// sent a picture of a chicken salad" would be a new permanent record of the
// member's meals, created in the name of protecting them. The record would be
// worse than the thing it recorded.
//
// The InBody printout is the third case and it goes the OTHER way — it is a
// document, not a composed frame, and it has its own module and its own ledger.
// See src/lib/scanSheetConsent.ts, which argues the difference from this file.
//
// ── The answer is device-local, and what that costs ───────────────────────
//
// Same store and same trade as COACH_SHARE_KEY: its own AsyncStorage key, not
// the settings blob, so a settings migration cannot silently clear an answer
// about somebody's photographs. A member who reinstalls is ASKED AGAIN, which
// is the right way for this to fail — being asked twice costs a tap, and
// inheriting a "yes" onto a handset where the question was never put is the
// defect this exists to prevent, pointing the other way.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHOTO_OFF_NOTE = exports.PHOTO_UNREAD_NOTE = exports.PHOTO_REFUSED_NOTE = exports.PHOTO_REFUSED_TITLE = exports.PHOTO_DECLINE_A11Y = exports.PHOTO_SEND_A11Y = exports.PHOTO_DECLINE_LABEL = exports.PHOTO_SEND_LABEL = exports.PHOTO_IF_YOU_DECLINE = exports.PHOTO_ASK_TITLE = exports.PHOTO_ASK_KICKER = exports.PHOTO_DESTINATION_BY_SUBJECT = exports.PHOTO_NOT_SENT_BY_SUBJECT = exports.PHOTO_SENT_BY_SUBJECT = exports.MEAL_PHOTO_DESTINATION = exports.MEAL_PHOTO_NOT_SENT = exports.MEAL_PHOTO_SENT = exports.PHOTO_DESTINATION = exports.PHOTO_NOT_SENT = exports.PHOTO_SENT = exports.PHOTO_AI_KEY = exports.PHOTO_AI_KEYS = void 0;
exports.photoAIKey = photoAIKey;
exports.consentFromStored = consentFromStored;
exports.storedConsent = storedConsent;
exports.mayAnalyzePhoto = mayAnalyzePhoto;
/**
 * One key per subject, and never one key for both.
 *
 * 'machine' keeps the original string. Every answer already on a handset was
 * given about a gym-floor photograph, and it still means that; renaming the key
 * would ask everybody again for no gain, and reusing it for meals would take an
 * answer about a leg press as an answer about somebody's dinner table.
 */
exports.PHOTO_AI_KEYS = {
    machine: 'repple.photoAI',
    meal: 'repple.photoAI.meal',
};
/** The original name, kept because it is what the machine scanner and its test
 *  import. It is the machine subject's key and nothing else. */
exports.PHOTO_AI_KEY = exports.PHOTO_AI_KEYS.machine;
/** Where one subject's answer lives. A function so callers cannot index the
 *  record with a string that is not a subject. */
function photoAIKey(subject) {
    return exports.PHOTO_AI_KEYS[subject];
}
/**
 * What a stored value means.
 *
 * Anything that is not an explicit recorded 'yes' or 'no' — absent, empty,
 * corrupt, half-written, from a future version — is 'unasked'. It is never
 * 'yes': a value nobody can parse is not somebody's permission, and the cost
 * of re-asking is a tap.
 */
function consentFromStored(raw) {
    if (raw === 'yes')
        return 'yes';
    if (raw === 'no')
        return 'no';
    return 'unasked';
}
function storedConsent(answer) {
    return answer;
}
/**
 * May this photograph go to the model?
 *
 * `available` is whether the reader is reachable at all. It is asked FIRST so
 * a build with no reader never puts a consent question about a thing that
 * cannot happen — being asked to agree to something the app is not going to do
 * teaches somebody that the question is decorative.
 */
function mayAnalyzePhoto(consent, available) {
    if (!available)
        return { allowed: false, block: 'off' };
    if (consent === 'unknown')
        return { allowed: false, block: 'unknown' };
    if (consent === 'unasked')
        return { allowed: false, block: 'unasked' };
    if (consent === 'no')
        return { allowed: false, block: 'refused' };
    return { allowed: true, block: null };
}
/**
 * What goes, in the member's own words, rendered from here rather than typed
 * into the screen.
 *
 * The list and the code have to be unable to drift: a list somebody has read
 * and agreed to that no longer describes what happens is worse than no list.
 * See src/lib/coachShare.ts for the same rule and the same reason.
 */
exports.PHOTO_SENT = [
    'the photograph itself, in full',
    'anything else in the frame — other people, their faces, the room',
];
/** What does not go. Also rendered, for the same reason. */
exports.PHOTO_NOT_SENT = [
    'your name, your account or anything else about you',
    'your injuries, measurements, weight or check-in scores',
];
/** One line naming the destination. A member is entitled to the name of the
 *  company, not "a service". */
exports.PHOTO_DESTINATION = 'The photo is sent to Anthropic, who run the model that reads it, and is used to answer this one question.';
/* ── the meal photo ───────────────────────────────────────────────────────
 *
 * Same recipient, same payload, different room. The machine list says "other
 * people, their faces, the room" about a gym floor; a meal is photographed at
 * a table, at home as often as out, and the people in the frame are more often
 * the member's family than strangers. That is not a stronger or weaker fact,
 * it is a different one, and it is what the member is deciding about — so it
 * is said in the words that fit where they are standing.
 */
exports.MEAL_PHOTO_SENT = [
    'the photograph itself, in full — the whole frame, not a crop of the plate',
    'whoever else is at the table, their faces, and the room you are in',
];
/** What does not go with a meal photo.
 *
 *  The third line is here because it is the one somebody assumes wrongly: the
 *  reader is handed ONE picture and nothing else. It is not told what else was
 *  eaten today, what the targets are, or who is eating. */
exports.MEAL_PHOTO_NOT_SENT = [
    'your name, your account or anything else about you',
    'your weight, your scans, your injuries or your check-in scores',
    'your food log — the reader gets this one picture and nothing else about you',
];
exports.MEAL_PHOTO_DESTINATION = 'The photo is sent to Anthropic, who run the model that reads it, and is used to read this one meal. Your gym does not get it and your coach does not get it.';
/* ── per-subject sentences ────────────────────────────────────────────────
 *
 * Records rather than a `switch`, so a new `PhotoSubject` fails to compile
 * until every sentence it needs has been written. A subject that reached a
 * screen with a missing string would render an empty paragraph above a Send
 * button, which is a consent question with the question left out.
 */
exports.PHOTO_SENT_BY_SUBJECT = {
    machine: exports.PHOTO_SENT,
    meal: exports.MEAL_PHOTO_SENT,
};
exports.PHOTO_NOT_SENT_BY_SUBJECT = {
    machine: exports.PHOTO_NOT_SENT,
    meal: exports.MEAL_PHOTO_NOT_SENT,
};
exports.PHOTO_DESTINATION_BY_SUBJECT = {
    machine: exports.PHOTO_DESTINATION,
    meal: exports.MEAL_PHOTO_DESTINATION,
};
exports.PHOTO_ASK_KICKER = {
    machine: 'Before you photograph it',
    meal: 'Before you photograph your meal',
};
exports.PHOTO_ASK_TITLE = {
    machine: 'The photo goes to a language model',
    meal: 'The photo goes to a language model',
};
/**
 * What happens on no — stated BEFORE the choice, not discovered after it.
 *
 * Same rule as `CONSENT_IF_YOU_DECLINE` in src/lib/injuryDocConsent.ts: a
 * refusal that leads somewhere is an answer somebody can afford to give, and a
 * refusal whose consequences are unknown at the moment of answering is not a
 * choice, it is a dare.
 */
exports.PHOTO_IF_YOU_DECLINE = {
    machine: 'If you say no, nothing is sent. You pick the machine from the list, which is how this screen worked before photos existed.',
    meal: 'If you say no, nothing is sent anywhere. You still take the photo, it stays on this phone, and you type the calories and macros while you look at it — the meal is logged exactly the same.',
};
exports.PHOTO_SEND_LABEL = {
    machine: 'Send the Photo',
    meal: 'Send the Photo to Be Read',
};
exports.PHOTO_DECLINE_LABEL = {
    machine: 'No — I’ll Pick It Myself',
    meal: 'No — I’ll Type It Myself',
};
/** Spoken labels. A screen reader reads a button without the paragraph above
 *  it, and "No" out of context does not say no to what. */
exports.PHOTO_SEND_A11Y = {
    machine: 'Send this photo to Anthropic to identify the machine',
    meal: 'Send this photo to Anthropic to read the meal',
};
exports.PHOTO_DECLINE_A11Y = {
    machine: 'Do not send photos to Anthropic — pick the machine from the list instead',
    meal: 'Do not send photos to Anthropic — type the meal in myself instead',
};
/**
 * The outcome a member lands on after saying no, and it is NOT an error.
 *
 * Same stance as `REFUSED_TITLE` / `REFUSED_NOTE` in injuryDocConsent.ts: this
 * is the feature working the way they asked for it to, so it is worded and
 * styled as an outcome. A refusal drawn in the failure slot teaches somebody
 * that saying no broke something, and the next answer is yes for the wrong
 * reason.
 */
exports.PHOTO_REFUSED_TITLE = {
    machine: 'Nothing was sent',
    meal: 'Nothing was sent',
};
exports.PHOTO_REFUSED_NOTE = {
    machine: 'No photo left this phone. Pick the machine below and everything after that works the same.',
    meal: 'Your photo has not left this phone and nothing was read from it, so nothing has been estimated. It is on screen to look at while you type — fill the boxes in and this meal counts exactly like any other.',
};
/** Shown when the member has said yes but the reader gave nothing back. A
 *  DIFFERENT sentence from the refusal above, because they are different facts:
 *  one is a decision, the other is a failure, and a member acts on them
 *  differently. */
exports.PHOTO_UNREAD_NOTE = {
    machine: 'Nothing could be identified from your photo. Pick the machine below.',
    meal: 'Nothing could be read from your picture, so nothing has been estimated from it. Enter the calories and macros and they go into your log. The picture itself is not kept — it is here to check against while you type.',
};
/**
 * Shown when there is no reader on this build at all — `visionAvailable()` is
 * false, `block` is 'off', and no question was ever put because there was
 * nothing to put one about.
 *
 * A THIRD sentence, not a reuse of the refusal. "You said no" and "this app
 * cannot do that here" are different facts and the member's next move differs:
 * one of them is theirs to change and the other is not. Same rule the whole
 * codebase applies to loading, failed, empty and refused.
 */
exports.PHOTO_OFF_NOTE = {
    machine: 'This build has no machine reader, so no photo was sent. Scan the code or pick the machine from the list.',
    meal: 'This build cannot read a photo, so nothing was sent anywhere and nothing has been estimated. Your picture is on screen to look at — type the calories and macros in and this meal is logged exactly the same.',
};
