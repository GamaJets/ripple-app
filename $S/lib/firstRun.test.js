"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The first run: which questions get asked, where setup resumes, and what the
// home screen draws before there is anything to draw. Compile with tsc, run
// with node.
//
// The defects these guard, all of them reported as "too complicated":
//
//   · Two wizards asked goal, diet, weight and height twice each. The list of
//     questions is now one list, in one file, and every entry carries the
//     sentence saying what breaks without it — so a question added later has to
//     answer that in writing before it can be asked.
//   · Coaching mode has a DEFAULT ('online' in clientData) rather than an
//     absence, so an unasked account is not undecided, it is wrong. The
//     assertions below pin that it is asked unless a coach has settled it.
//   · A half-finished setup restarted at step one on relaunch.
//   · A brand-new home screen drew nine em dashes across three sections. The
//     sections are hidden now — but only on a settled read. Hiding them on a
//     failed one would tell a member who has trained for a year that they have
//     never trained, which is the exact class of bug LoadStatus exists for.
const firstRun_1 = require("./firstRun");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the questions, and the rule that lets one exist ────────────────────── */
// Four. Not a number to grow casually: this is the whole of what a new member
// is asked before the app works, and every addition is a step somebody has to
// tap through before they have seen a single screen.
eq(firstRun_1.SETUP_QUESTIONS.length, 4, 'setup asks four questions');
same(firstRun_1.SETUP_QUESTIONS.map((q) => q.id), ['coaching', 'goal', 'body', 'injuries'], 'the four, in the order they are put');
// The rule the file's header states, checked rather than trusted. A question
// with no sentence saying what breaks is a question nobody has justified, and
// that is how eight steps happened.
for (const q of firstRun_1.SETUP_QUESTIONS) {
    ok(q.breaks.trim().length > 20, `${q.id} says what breaks without it`);
    // Sentence case. These are read as prose, under a heading, and check:caps
    // cannot see inside this array.
    ok(q.breaks[0] === q.breaks[0].toLowerCase(), `${q.id}'s reason is sentence case`);
}
// No duplicates, because the ids are storage values and an index into the list.
eq(new Set(firstRun_1.SETUP_QUESTIONS.map((q) => q.id)).size, firstRun_1.SETUP_QUESTIONS.length, 'the ids are distinct');
/* ── what a given account is actually asked ─────────────────────────────── */
// The cold start: nobody has invited them, nothing has measured them.
same((0, firstRun_1.questionsToAsk)({ coachingAgreed: false, weighed: false }), ['coaching', 'goal', 'body', 'injuries'], 'a brand-new account is asked all four');
// A coach invited them and both sides agreed the mode. Asking again would hand
// one party a control over a two-party fact — and it is the same control the
// dashboard's accept button has already used.
same((0, firstRun_1.questionsToAsk)({ coachingAgreed: true, weighed: false }), ['goal', 'body', 'injuries'], 'a linked account is not asked how it is coached');
// They stood on an InBody scan on the way in. The app is holding a measured
// weight; asking them to type one can only make it worse.
same((0, firstRun_1.questionsToAsk)({ coachingAgreed: false, weighed: true }), ['coaching', 'goal', 'injuries'], 'a measured account is not asked for its weight');
// Both: two questions, and neither was answerable from anything held.
same((0, firstRun_1.questionsToAsk)({ coachingAgreed: true, weighed: true }), ['goal', 'injuries'], 'a coached, measured account is asked twice');
// Never empty, whatever is known. Nothing in the app can supply a goal (it has
// a default, which is a guess) or an injury (only a person knows), so setup
// always has something to do — an empty list would open a wizard with no steps.
for (const a of [true, false])
    for (const b of [true, false]) {
        ok((0, firstRun_1.questionsToAsk)({ coachingAgreed: a, weighed: b }).length > 0, `something is always asked (${a}, ${b})`);
        ok((0, firstRun_1.questionsToAsk)({ coachingAgreed: a, weighed: b }).includes('goal'), `the goal is always asked (${a}, ${b})`);
        ok((0, firstRun_1.questionsToAsk)({ coachingAgreed: a, weighed: b }).includes('injuries'), `injuries are always asked (${a}, ${b})`);
    }
// The order survives the filtering. A list rebuilt by hand would be free to
// reorder; this one is derived from SETUP_QUESTIONS and must not.
const filtered = (0, firstRun_1.questionsToAsk)({ coachingAgreed: true, weighed: true });
eq(filtered.indexOf('goal') < filtered.indexOf('injuries'), true, 'the surviving questions keep their order');
/* ── step ids ───────────────────────────────────────────────────────────── */
ok((0, firstRun_1.isSetupStep)('coaching') && (0, firstRun_1.isSetupStep)('goal') && (0, firstRun_1.isSetupStep)('body') && (0, firstRun_1.isSetupStep)('injuries'), 'the four ids are recognised');
ok(!(0, firstRun_1.isSetupStep)('diet'), 'a question that was dropped is not a step');
ok(!(0, firstRun_1.isSetupStep)(''), 'the empty string is not a step');
ok(!(0, firstRun_1.isSetupStep)(null), 'null is not a step');
ok(!(0, firstRun_1.isSetupStep)(2), 'an index is not a step');
// `includes` on an array rather than `in` on an object: a prototype member must
// not resolve to a step and be handed to the renderer as an index.
ok(!(0, firstRun_1.isSetupStep)('toString'), 'toString is not a step');
ok(!(0, firstRun_1.isSetupStep)('constructor'), 'constructor is not a step');
/* ── the draft, read out of storage ─────────────────────────────────────── */
same((0, firstRun_1.readDraft)(null), firstRun_1.EMPTY_DRAFT, 'nothing stored reads as nothing');
same((0, firstRun_1.readDraft)(undefined), firstRun_1.EMPTY_DRAFT, 'undefined reads as nothing');
same((0, firstRun_1.readDraft)('body'), firstRun_1.EMPTY_DRAFT, 'a bare string is not a draft');
same((0, firstRun_1.readDraft)(42), firstRun_1.EMPTY_DRAFT, 'a number is not a draft');
same((0, firstRun_1.readDraft)([]), { at: null }, 'an array carries no step');
same((0, firstRun_1.readDraft)({}), firstRun_1.EMPTY_DRAFT, 'an object with no step reads as nothing');
same((0, firstRun_1.readDraft)({ at: 'body' }), { at: 'body' }, 'a stored step is read back');
same((0, firstRun_1.readDraft)({ at: 'diet' }), firstRun_1.EMPTY_DRAFT, 'a step from an older build is dropped');
same((0, firstRun_1.readDraft)({ at: 3 }), firstRun_1.EMPTY_DRAFT, 'an index stored where a step belongs is dropped');
// The shape a crash mid-write leaves behind.
same((0, firstRun_1.readDraft)({ at: null, junk: true }), firstRun_1.EMPTY_DRAFT, 'extra keys are ignored');
/* ── where setup reopens ────────────────────────────────────────────────── */
const ALL = ['coaching', 'goal', 'body', 'injuries'];
eq((0, firstRun_1.resumeAt)(ALL, firstRun_1.EMPTY_DRAFT), 0, 'a fresh setup opens at the first question');
eq((0, firstRun_1.resumeAt)(ALL, { at: 'coaching' }), 0, 'the first step resumes at the first step');
eq((0, firstRun_1.resumeAt)(ALL, { at: 'body' }), 2, 'a step in the middle resumes where it was');
eq((0, firstRun_1.resumeAt)(ALL, { at: 'injuries' }), 3, 'the last step resumes at the last step');
// The reason this function exists rather than an indexOf at the call site. A
// coach linked the account, or a scan landed, while setup was half-finished —
// so the stored step is no longer on the list. Restart at the first thing still
// being asked; the alternative is index -1, which renders nothing at all and is
// how a half-finished setup becomes a blank screen somebody force-quits.
const SHORT = ['goal', 'injuries'];
eq((0, firstRun_1.resumeAt)(SHORT, { at: 'coaching' }), 0, 'a step that is no longer asked restarts at the first');
eq((0, firstRun_1.resumeAt)(SHORT, { at: 'body' }), 0, 'a step dropped by a scan restarts at the first');
eq((0, firstRun_1.resumeAt)(SHORT, { at: 'injuries' }), 1, 'a surviving step keeps its new index');
// Never out of range, for any list and any draft. The renderer indexes straight
// into the step array.
for (const steps of [ALL, SHORT, ['goal']]) {
    for (const at of [...ALL, null]) {
        const i = (0, firstRun_1.resumeAt)(steps, { at });
        ok(i >= 0 && i < steps.length, `resume stays in range (${JSON.stringify(steps)}, ${at})`);
    }
}
/* ── the home screen before there is anything on it ─────────────────────── */
/** A brand-new account: both reads settled, nothing in either. */
const NEW = { bodyStatus: 'ready', measured: false, logStatus: 'ready', loggedEver: 0, hasTargets: false };
/** Somebody a month in. */
const USED = { bodyStatus: 'ready', measured: true, logStatus: 'ready', loggedEver: 12, hasTargets: true };
eq((0, firstRun_1.homeSectionsShown)(NEW), 0, 'a brand-new home screen draws none of the three');
eq((0, firstRun_1.homeSectionsShown)(USED), 3, 'a used one draws all three');
ok(!(0, firstRun_1.showBody)(NEW), 'the body row is not three dashes on day one');
ok((0, firstRun_1.showBody)(USED), 'the body row is back with the first measurement');
// One figure is enough. Weight alone, with no scan behind it, still has
// something true to say.
ok((0, firstRun_1.showBody)({ ...NEW, measured: true }), 'one measured figure brings the body row back');
ok(!(0, firstRun_1.showFuel)(NEW), 'a fuel section with no target is not drawn');
ok((0, firstRun_1.showFuel)({ ...NEW, hasTargets: true }), 'a target brings it back');
ok(!(0, firstRun_1.showWeek)(NEW), 'this week is not seven empty dots on day one');
ok((0, firstRun_1.showWeek)({ ...NEW, loggedEver: 1 }), 'one logged session brings this week back');
// Gated on the log ever holding anything, not on THIS week. A member who trains
// Monday and Tuesday and opens the app on Sunday has an empty week and eleven
// months of history behind it.
ok((0, firstRun_1.showWeek)({ ...USED, loggedEver: 40 }), 'a quiet week does not hide a full history');
/* ── and the rule that makes hiding safe ────────────────────────────────── */
// An empty list under 'error' means unknown, not none. Every non-ready status
// keeps the section on screen, dashes and all, beside the warnings the
// dashboard already prints for exactly this case.
for (const s of ['loading', 'partial', 'error']) {
    ok((0, firstRun_1.showBody)({ ...NEW, bodyStatus: s }), `an unsettled body read (${s}) still draws the row`);
    ok((0, firstRun_1.showWeek)({ ...NEW, logStatus: s }), `an unsettled log read (${s}) still draws this week`);
    eq((0, firstRun_1.homeSectionsShown)({ ...NEW, bodyStatus: s, logStatus: s }), 2, `nothing is hidden on a ${s} read except what has no target`);
}
// 'partial' is not 'ready' and must not be treated as it. A truncated read of
// the training log is a set we cannot count, so "you have never trained" is not
// a claim we are entitled to make from it.
ok((0, firstRun_1.showWeek)({ ...NEW, logStatus: 'partial' }), 'a truncated log is not an empty one');
// Fuel is the one section with no status behind it, and correctly so: `macros`
// is null for want of a weight, which is a fact about the profile rather than
// about a read. It stays hidden under every status.
for (const s of ['loading', 'partial', 'error', 'ready']) {
    ok(!(0, firstRun_1.showFuel)({ ...NEW, bodyStatus: s, logStatus: s }), `no target means no fuel section (${s})`);
}
/* ── Getting Started ────────────────────────────────────────────────────── */
// Reported as "Repple Coach has a Getting Started, however Client doesn't".
// What the coach app had was the first-run tour firing on a fresh install. This
// is the thing that had to exist instead: a list that survives being read.
eq(firstRun_1.CHECKLIST.length, 6, 'six things are worth doing');
same(firstRun_1.CHECKLIST.map((c) => c.id), ['setup', 'guide', 'coach', 'workout', 'meal', 'device'], 'in the order they are worth doing');
eq(new Set(firstRun_1.CHECKLIST.map((c) => c.id)).size, firstRun_1.CHECKLIST.length, 'the ids are distinct');
for (const it of firstRun_1.CHECKLIST) {
    // Title Case: these render as <ListRow title>, which check:caps reads — but
    // it reads the JSX, not this array, so the rule is held here.
    ok(/^[A-Z]/.test(it.title), `"${it.title}" is Title Case`);
    ok(it.note[0] === it.note[0].toLowerCase(), `"${it.title}" has a sentence-case note`);
    // Pushed with no params. A row that opens a screen needing one lands on a
    // screen with nothing in it — the rule src/lib/features.ts keeps for Explore.
    ok(it.route.startsWith('/'), `"${it.title}" names a route`);
    ok(!it.route.includes('?'), `"${it.title}" needs no params`);
}
/** Nothing done, everything readable. */
const FRESH = { setup: false, guide: false, coach: false, workout: false, meal: false, device: false, solo: false };
/** Everything done. */
const FINISHED = { setup: true, guide: true, coach: true, workout: true, meal: true, device: true, solo: false };
eq((0, firstRun_1.checklist)(FRESH).length, 6, 'a coached client has six rows');
eq((0, firstRun_1.checklistDone)((0, firstRun_1.checklist)(FRESH)), 0, 'and none of them done');
eq((0, firstRun_1.checklistLeft)((0, firstRun_1.checklist)(FRESH)), 6, 'and six to do');
eq((0, firstRun_1.nextTodo)((0, firstRun_1.checklist)(FRESH))?.id, 'setup', 'the first thing to do is finish setting up');
ok((0, firstRun_1.showChecklist)((0, firstRun_1.checklist)(FRESH)), 'a fresh checklist is on the home screen');
eq((0, firstRun_1.checklistDone)((0, firstRun_1.checklist)(FINISHED)), 6, 'a finished one counts six');
eq((0, firstRun_1.checklistLeft)((0, firstRun_1.checklist)(FINISHED)), 0, 'with nothing left');
eq((0, firstRun_1.nextTodo)((0, firstRun_1.checklist)(FINISHED)), null, 'and nothing to point at next');
// The rule that stops it becoming clutter. A list stuck at 6 of 6 forever is
// the thing the report was complaining about, wearing a tick.
ok(!(0, firstRun_1.showChecklist)((0, firstRun_1.checklist)(FINISHED)), 'a finished checklist leaves the home screen');
// Solo. There is no coach to connect to, so the row is dropped rather than left
// permanently outstanding — which is the other way a checklist never finishes.
const SOLO_DONE = { ...FINISHED, coach: false, solo: true };
eq((0, firstRun_1.checklist)(SOLO_DONE).length, 5, 'a solo client has five rows');
ok(!(0, firstRun_1.checklist)(SOLO_DONE).some((r) => r.item.id === 'coach'), 'and none of them is the coach row');
ok(!(0, firstRun_1.showChecklist)((0, firstRun_1.checklist)(SOLO_DONE)), 'a solo client can finish without a coach');
// And it comes back if they change their mind, because it is a real step again.
ok((0, firstRun_1.showChecklist)((0, firstRun_1.checklist)({ ...SOLO_DONE, solo: false })), 'switching off solo puts the coach row back');
/* ── an unread item is not an unfinished one ────────────────────────────── */
// The LoadStatus rule, applied to a list of ticks. Under a failed read the row
// draws neither a tick nor an empty circle.
const UNREAD = { ...FRESH, workout: null, meal: null };
const ur = (0, firstRun_1.checklist)(UNREAD);
eq(ur.find((r) => r.item.id === 'workout')?.state, 'unknown', 'an unread workout log is unknown');
eq(ur.find((r) => r.item.id === 'meal')?.state, 'unknown', 'an unread food log is unknown');
eq(ur.find((r) => r.item.id === 'setup')?.state, 'todo', 'and the rows that did read still say so');
// Neither counted as done nor counted as outstanding. "4 left" over two failed
// reads is a number made out of our own failure.
eq((0, firstRun_1.checklistDone)(ur), 0, 'an unknown row is not done');
eq((0, firstRun_1.checklistLeft)(ur), 4, 'nor is it outstanding');
ok(!ur.some((r) => r.item.id === 'workout' && r.state === 'todo'), 'a failed read never reads as not done');
// The important direction: a list whose reads all failed must NOT congratulate
// anybody. It stays on the home screen until it knows.
const ALL_UNREAD = { setup: null, guide: null, coach: null, workout: null, meal: null, device: null, solo: false };
eq((0, firstRun_1.checklistDone)((0, firstRun_1.checklist)(ALL_UNREAD)), 0, 'nothing is done when nothing could be read');
eq((0, firstRun_1.checklistLeft)((0, firstRun_1.checklist)(ALL_UNREAD)), 0, 'and nothing is outstanding either');
eq((0, firstRun_1.nextTodo)((0, firstRun_1.checklist)(ALL_UNREAD)), null, 'so there is no next thing to point at');
ok((0, firstRun_1.showChecklist)((0, firstRun_1.checklist)(ALL_UNREAD)), 'but the checklist stays until it knows');
// One unread item among five ticks keeps it too. This is the case that would
// otherwise quietly drop a real to-do off somebody's home screen.
const NEARLY = { ...FINISHED, device: null };
eq((0, firstRun_1.checklistDone)((0, firstRun_1.checklist)(NEARLY)), 5, 'five of six read as done');
ok((0, firstRun_1.showChecklist)((0, firstRun_1.checklist)(NEARLY)), 'and the sixth being unreadable keeps the row');
// nextTodo skips over the unknowns to the first thing genuinely outstanding,
// rather than sending somebody to a screen that may already be finished.
const SKIP = { ...FRESH, setup: null, guide: null };
eq((0, firstRun_1.nextTodo)((0, firstRun_1.checklist)(SKIP))?.id, 'coach', 'the next thing to do is the first one known to be undone');
// Order survives. The rows are what the screen indexes and what the home row
// quotes, so a reordering that reversed them would send people to the wrong
// screen from the "next" line.
same((0, firstRun_1.checklist)(FRESH).map((r) => r.item.id), ['setup', 'guide', 'coach', 'workout', 'meal', 'device'], 'the rows keep the list order');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('firstRun.test.ts — ok');
