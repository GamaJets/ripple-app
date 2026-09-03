"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKLIST = exports.EMPTY_DRAFT = exports.SETUP_QUESTIONS = void 0;
exports.questionsToAsk = questionsToAsk;
exports.isSetupStep = isSetupStep;
exports.readDraft = readDraft;
exports.resumeAt = resumeAt;
exports.showBody = showBody;
exports.showFuel = showFuel;
exports.showWeek = showWeek;
exports.homeSectionsShown = homeSectionsShown;
exports.checklist = checklist;
exports.checklistDone = checklistDone;
exports.checklistLeft = checklistLeft;
exports.nextTodo = nextTodo;
exports.showChecklist = showChecklist;
const loadStatus_1 = require("../ui/loadStatus");
/**
 * The questions, and the reason each one survives.
 *
 * Order is not arbitrary. Coaching is first because it decides what the rest of
 * the app even offers — a member training alone should not be walked past a
 * booking calendar and a weekly check-in on their way in. Body is third rather
 * than second because a goal is a tap and a body is typing, and the cheap
 * question goes first.
 */
exports.SETUP_QUESTIONS = [
    {
        id: 'coaching',
        // src/ui/clientData.tsx defaults coachingMode to 'online' and nothing ever
        // asks again. So an unanswered account is not undecided, it is WRONG: the
        // home screen offers a weekly check-in "your coach reads it" to somebody
        // with no coach, Explore stops hiding the rows marked soloHide, and the
        // dashboard looks for a coach-written program before falling back to the
        // automatic one.
        breaks: 'the app assumes you have a coach and offers you check-ins nobody reads',
    },
    {
        id: 'goal',
        // buildProgram(goal, bodyFat) picks the whole training split from this, and
        // macrosFor() splits the calories by it. The default is 'muscle', so a
        // member who came to lose fat is handed a push/pull/legs plan and a
        // muscle-building macro split without being asked.
        breaks: 'your plan and your macros are built for building muscle whatever you came for',
    },
    {
        id: 'body',
        // macrosFor needs weightKg, and the dashboard's `macros` is null without
        // it — so the Fuel section has no target at all, the Meals tab has no
        // target at all, and the home screen says "add your weight for a target".
        breaks: 'there are no calorie or macro targets anywhere, because there is nothing to scale them to',
    },
    {
        id: 'injuries',
        // The automatic program is built without them, so it loads whatever hurts.
        // This is the one question on the list whose absence is a safety question
        // rather than an accuracy one, and it is why it is asked rather than
        // deferred to the screen that owns it.
        breaks: 'the plan loads the areas you need it to leave alone',
    },
];
/**
 * The questions this account still has to be asked.
 *
 * This is the "shorter path" half of the brief: a member whose coach invited
 * them and who has stood on an InBody scan is asked two questions, not four,
 * and neither of the two was answerable from anything the app held.
 *
 * Goal and injuries are never dropped. Nothing else in the app can supply
 * either — the goal has a default that is a guess, and an injury is only ever
 * known because somebody said so.
 */
function questionsToAsk(known) {
    return exports.SETUP_QUESTIONS
        .filter((q) => {
        if (q.id === 'coaching')
            return !known.coachingAgreed;
        if (q.id === 'body')
            return !known.weighed;
        return true;
    })
        .map((q) => q.id);
}
exports.EMPTY_DRAFT = { at: null };
const STEPS = exports.SETUP_QUESTIONS.map((q) => q.id);
/** Whether a value is one of the four ids. Narrow, so a stored string from an
 *  older build with a step that no longer exists resolves to null rather than
 *  to an index nothing can render. */
function isSetupStep(v) {
    return typeof v === 'string' && STEPS.includes(v);
}
/**
 * Read a stored draft. Tolerant by construction: a preference written by an
 * older build, hand-edited, or half-written by a crash must not stop somebody
 * setting up their account. Anything unreadable starts at the beginning, which
 * costs taps and never an answer.
 */
function readDraft(raw) {
    if (!raw || typeof raw !== 'object')
        return exports.EMPTY_DRAFT;
    const at = raw.at;
    return { at: isSetupStep(at) ? at : null };
}
/**
 * The index to open setup at, given the questions this account is being asked.
 *
 * Never past the end and never negative — a resume that lands outside the list
 * renders nothing at all, which is how a half-finished setup becomes a blank
 * screen somebody force-quits.
 *
 * A stored step that is not in `steps` resolves to 0 rather than being hunted
 * for: it means the question was dropped since (a coach linked the account, a
 * scan arrived), and the honest restart is the first thing still being asked.
 */
function resumeAt(steps, draft) {
    if (draft.at == null)
        return 0;
    // Math.max rather than `i < 0 ? 0 : i`, which no test could ever tell apart
    // from `i <= 0 ? 0 : i` — both return 0 at zero. A comparison whose two
    // spellings are indistinguishable is a line the suite cannot watch, and
    // scripts/mutate.mjs reported it as exactly that. There is nothing to
    // compare here: indexOf returns -1 or an index, and the floor is zero.
    return Math.max(0, steps.indexOf(draft.at));
}
/**
 * Whether to draw the Body row of weight, body fat and muscle.
 *
 * Hidden only on a settled read that found nothing. The Progress tab is in the
 * bar and the quick-action row still points at it, so nothing becomes
 * unreachable by this — the row comes back with the first figure.
 */
function showBody(f) {
    return f.measured || !(0, loadStatus_1.isWhole)(f.bodyStatus);
}
/**
 * Whether to draw Fuel Today.
 *
 * Without a weight there is no target, so the section rendered a heading, a
 * note reading "0 kcal eaten — add your weight for a target", and no meters
 * under it. That note is a good sentence in the wrong place: the ask belongs on
 * the body step of setup and on the Meals tab, not as a section that exists to
 * explain why it is empty.
 */
function showFuel(f) {
    return f.hasTargets;
}
/**
 * Whether to draw This Week.
 *
 * Gated on the log ever having anything in it rather than on this week's count:
 * a member who trains Monday and Tuesday and opens the app on a Sunday has an
 * empty week and eleven months of history, and hiding it from them would be a
 * statement about their training rather than about their data.
 */
function showWeek(f) {
    return f.loggedEver > 0 || !(0, loadStatus_1.isWhole)(f.logStatus);
}
/**
 * How many of the three the screen is drawing. Not used to lay anything out —
 * it is what the test asserts against, because the claim worth pinning is
 * "a brand-new account sees none of these and a used one sees all three".
 */
function homeSectionsShown(f) {
    return (showBody(f) ? 1 : 0) + (showFuel(f) ? 1 : 0) + (showWeek(f) ? 1 : 0);
}
/**
 * In the order they are worth doing, which is not the order they are easiest.
 * Setup first because everything downstream is computed from it; the guide
 * second because it is the answer to "what is all this", and it was previously
 * findable only as one row inside the Me hub.
 */
exports.CHECKLIST = [
    { id: 'setup', title: 'Finish Setting Up', note: 'four questions that decide your plan and your targets', route: '/(client)/onboarding' },
    { id: 'guide', title: 'Read the User Guide', note: 'what each tab is for, in one screen', route: '/guide' },
    { id: 'coach', title: 'Connect With Your Coach', note: 'enter their code, or accept the invitation they sent', route: '/(client)/trainers' },
    { id: 'workout', title: 'Log Your First Session', note: 'anything you did — it can be typed in plain words', route: '/(client)/workouts' },
    { id: 'meal', title: 'Log Something You Ate', note: 'search, scan a barcode, or photograph the plate', route: '/(client)/foodlog' },
    { id: 'device', title: 'Connect a Watch', note: 'where your sleep, steps and readiness come from', route: '/(client)/devices' },
];
const stateOf = (v) => (v == null ? 'unknown' : v ? 'done' : 'todo');
/** The rows this client actually has, each with where it stands. */
function checklist(f) {
    return exports.CHECKLIST
        .filter((it) => !(it.id === 'coach' && f.solo))
        .map((it) => ({ item: it, state: stateOf(f[it.id]) }));
}
/** How many are done. Never counts an unread one. */
function checklistDone(rows) {
    return rows.filter((r) => r.state === 'done').length;
}
/** How many are known to be outstanding. Never counts an unread one either —
 *  "3 left" over a failed read is a number made out of our own failure. */
function checklistLeft(rows) {
    return rows.filter((r) => r.state === 'todo').length;
}
/** The next thing worth doing, or null when there is nothing known to do. */
function nextTodo(rows) {
    return rows.find((r) => r.state === 'todo')?.item ?? null;
}
/**
 * Whether the home screen still carries the row.
 *
 * True while anything is outstanding — and true while anything is merely
 * UNKNOWN, which is the LoadStatus rule applied to a checklist: a list that
 * congratulates somebody on finishing because three of its reads failed is
 * worse than one that stays a day too long.
 */
function showChecklist(rows) {
    return rows.some((r) => r.state !== 'done');
}
