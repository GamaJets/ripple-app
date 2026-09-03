"use strict";
// What this screen is for, said on the screen, once.
//
// ── Why not the tour ───────────────────────────────────────────────────────
//
// There is one, at app/tour.tsx, and a reference version of it at app/guide.tsx.
// Both are good and neither answers the report. A carousel is shown before the
// member has seen the thing it describes, in one sitting, and is then gone: by
// the time somebody is actually looking at a hero reading 62 /100 and wondering
// what it is, the card that explained it was five screens and one session ago.
// That is the shape of every walkthrough complaint — "I swiped past it" is not
// a failure of attention, it is a question asked before there was anything to
// be curious about.
//
// So this is the other half. The tour stays where it is, openable from the
// guide; these are the same facts, moved to the moment of confusion. One row
// per tab, shut until it is tapped, gone for good once it is dismissed.
//
// ── The rules the strip has to keep ────────────────────────────────────────
//
//   · Dismissible. One control, and it says so.
//   · Never blocking. It is a row in the scroll view, not a modal, not an
//     overlay, and nothing waits on it.
//   · Never twice. Dismissed is permanent — a help card that comes back is the
//     nag the report is complaining about, wearing a different hat.
//   · Never lost. The words below are also in app/guide.tsx, which is in the Me
//     hub and stays there. Dismissing takes the row off the screen, not the
//     explanation out of the app.
//
// ── Voice ──────────────────────────────────────────────────────────────────
//
// Each line names one thing that is really on that screen and says what it
// means. Not what it is good for, not why it matters — what the number IS. The
// term is Title Case because it is quoting a label the reader can see; the
// explanation is a sentence and is punctuated as one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCREEN_HELP = exports.COACH_HELP_KEYS = exports.CLIENT_HELP_KEYS = void 0;
exports.isHelpKey = isHelpKey;
exports.dismissedFrom = dismissedFrom;
exports.isDismissed = isDismissed;
exports.withDismissed = withDismissed;
/** The client's five, in tab order. Exported so the test can assert on the two
 *  populations separately — a coach card must never be countable as a client
 *  tab, which is what a bare `Object.keys` length assertion would allow. */
exports.CLIENT_HELP_KEYS = ['home', 'train', 'meals', 'progress', 'me'];
/** The coach's, in the order a coach meets them. */
exports.COACH_HELP_KEYS = ['coach-clients', 'coach-quiet', 'coach-schedule', 'coach-enquiries', 'coach-adspend'];
exports.SCREEN_HELP = {
    home: {
        key: 'home',
        title: 'What This Screen Shows',
        lines: [
            // The hero, and the single most-asked question in the app. The score is
            // built in src/lib/readiness.ts out of sleep, water and how recently the
            // member trained, and the screen already prints which of those it could
            // see — but not what the score is.
            { term: 'Readiness', means: 'a score out of 100 from your sleep, your water and how recently you trained. Tap it to see which of those it used.' },
            // The ActionCard. Two numbers on it that are about different things, which
            // its own source comments already flag as confusing.
            { term: 'The Card Below It', means: 'the one thing to do today. The ring on it is this week’s sessions; the number inside the ring is days in a row.' },
            // The thing no first-time reader knows, and the reason the screen looks
            // broken rather than empty.
            { term: 'A Dash', means: 'not measured, rather than zero. Sections appear here as you fill them in.' },
        ],
    },
    train: {
        key: 'train',
        title: 'What This Screen Shows',
        lines: [
            { term: 'Today', means: 'the session your plan has for today, and how many of its exercises you have ticked off.' },
            { term: 'Go To', means: 'everything else this tab holds — cardio, mobility, stretches, recovery and the exercise library.' },
            { term: 'Log by Text', means: 'type what you did in plain words and it becomes a logged session. Nothing has to be planned first.' },
        ],
    },
    meals: {
        key: 'meals',
        title: 'What These Numbers Mean',
        lines: [
            // The exact sentence the report was written about.
            { term: 'Calories Left', means: 'your target for the day, minus what you have logged, plus anything a watch says you burned beyond a normal day.' },
            { term: 'Burned All Day', means: 'a whole-day figure from your watch, resting included — not the calories of one session.' },
            { term: 'Macros', means: 'protein, carbs and fat. The bars fill as you log food; the targets come from your weight and your goal.' },
        ],
    },
    progress: {
        key: 'progress',
        title: 'What This Screen Shows',
        lines: [
            { term: 'Body Fat', means: 'the newest reading, with the day and the instrument that measured it underneath.' },
            { term: 'A Change', means: 'always measured from a named day. If no day is named, nothing has moved enough to report.' },
            { term: 'Progress Photos', means: 'stored on your account. Your coach sees one only when you send it.' },
        ],
    },
    me: {
        key: 'me',
        title: 'What This Screen Shows',
        lines: [
            { term: 'The Groups', means: 'every screen in the app, sorted. Tap a heading to fold one away.' },
            { term: 'Coaching', means: 'whether a coach programs for you, trains you in the room, both, or neither. It decides what the other tabs offer.' },
            { term: 'Search', means: 'the magnifier on the home screen finds any of these by name — faster than scrolling this list.' },
        ],
    },
    /* ── the coach ─────────────────────────────────────────────────────────── */
    'coach-clients': {
        key: 'coach-clients',
        title: 'What This Screen Shows',
        lines: [
            // The band heading, and the thing every coach reads as an absolute.
            { term: 'At Risk', means: 'measured against that client’s own earlier rate, never against a target. Somebody who always trained twice a week is not at risk.' },
            // The band clientDrift deliberately sorts SECOND rather than last.
            { term: 'Nothing to Assess', means: 'the record holds too little to judge them on, which is not the same as fine. They sit high on purpose.' },
            { term: 'A Dash', means: 'not measured, rather than zero. A failed read draws a dash and says so above the list.' },
        ],
    },
    'coach-quiet': {
        key: 'coach-quiet',
        title: 'What Quiet Means Here',
        lines: [
            { term: 'Quiet', means: 'a fall in what the app was told, over two weeks against the six before them. It is not a fall in what they did.' },
            { term: 'Could Not Be Assessed', means: 'people whose record did not come back. They are not on the list below and they are not fine.' },
            { term: 'Write a Message', means: 'a draft in a box for you to edit and send yourself. Nothing on this screen sends anything.' },
        ],
    },
    'coach-schedule': {
        key: 'coach-schedule',
        title: 'What This Grid Shows',
        lines: [
            { term: 'An Open Slot', means: 'time you have offered that nobody has taken. Clients see it and can book it until you withdraw it.' },
            { term: 'Blocked', means: 'time nobody can book across. Blocking withdraws the open slots inside it and refuses if a session is already booked.' },
            { term: 'Unmarked', means: 'a session that has happened and that you have not said what became of. Those sessions count nowhere until you do.' },
        ],
    },
    'coach-enquiries': {
        key: 'coach-enquiries',
        title: 'What This Screen Shows',
        lines: [
            { term: 'An Enquiry', means: 'somebody who filled in your join page and did not make an account. They are not a client yet and not counted as one.' },
            { term: 'The Code', means: 'the join code they arrived through, so you can tell which flyer or post produced them.' },
            { term: 'Contacted', means: 'a note to yourself that you reached out. Nothing is sent from this screen on your behalf.' },
        ],
    },
    'coach-adspend': {
        key: 'coach-adspend',
        title: 'What These Figures Mean',
        lines: [
            { term: 'Matched Spend', means: 'money against an ad whose link carries one of your join codes. Only matched spend can be attributed to anybody.' },
            { term: 'Unmatched', means: 'money the app can see but cannot attribute, because nothing in the ad names a code of yours.' },
            { term: 'Cost Unknown', means: 'a code with joins and no spend behind it. Mark it free and it stops being reported as a gap.' },
        ],
    },
};
const KEYS = Object.keys(exports.SCREEN_HELP);
/** Whether a value names a screen that still exists. A key stored by an older
 *  build for a tab that has since gone is dropped rather than kept, so the set
 *  cannot grow forever on names nothing reads. */
function isHelpKey(v) {
    return typeof v === 'string' && KEYS.includes(v);
}
/**
 * The screens whose card has been dismissed, from whatever was in storage.
 *
 * Tolerant, and deliberately so: the consequence of a bad parse here is a help
 * card coming back, which is the exact nag this file exists to prevent. So a
 * corrupt or older preference keeps every key it can still recognise instead of
 * starting again — the opposite of the setup draft in src/lib/firstRun.ts,
 * where starting again costs a tap and nothing else.
 */
function dismissedFrom(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const v of raw)
        if (isHelpKey(v) && !out.includes(v))
            out.push(v);
    return out;
}
/** Whether this screen's card is done with. */
function isDismissed(list, k) {
    return list.includes(k);
}
/**
 * The set with one more screen dismissed. Idempotent — dismissing twice must
 * not write the same key twice, because the list is round-tripped through
 * storage on every dismissal and a duplicate would compound.
 */
function withDismissed(list, k) {
    return list.includes(k) ? [...list] : [...list, k];
}
