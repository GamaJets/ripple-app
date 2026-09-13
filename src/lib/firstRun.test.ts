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
import {
  SETUP_QUESTIONS, EMPTY_DRAFT, questionsToAsk, readDraft, resumeAt, isSetupStep,
  showBody, showFuel, showWeek, homeSectionsShown,
  CHECKLIST, checklist, checklistDone, checklistLeft, everLoggedMeal, nextTodo, showChecklist,
  type SetupStep, type HomeFacts, type ChecklistFacts, type ChecklistItemId, type MealEverFacts,
} from './firstRun';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the questions, and the rule that lets one exist ────────────────────── */

// Four. Not a number to grow casually: this is the whole of what a new member
// is asked before the app works, and every addition is a step somebody has to
// tap through before they have seen a single screen.
eq(SETUP_QUESTIONS.length, 4, 'setup asks four questions');
same(SETUP_QUESTIONS.map((q) => q.id), ['coaching', 'goal', 'body', 'injuries'],
  'the four, in the order they are put');

// The rule the file's header states, checked rather than trusted. A question
// with no sentence saying what breaks is a question nobody has justified, and
// that is how eight steps happened.
for (const q of SETUP_QUESTIONS) {
  ok(q.breaks.trim().length > 20, `${q.id} says what breaks without it`);
  // Sentence case. These are read as prose, under a heading, and check:caps
  // cannot see inside this array.
  ok(q.breaks[0] === q.breaks[0].toLowerCase(), `${q.id}'s reason is sentence case`);
}

// No duplicates, because the ids are storage values and an index into the list.
eq(new Set(SETUP_QUESTIONS.map((q) => q.id)).size, SETUP_QUESTIONS.length, 'the ids are distinct');

/* ── what a given account is actually asked ─────────────────────────────── */

// The cold start: nobody has invited them, nothing has measured them.
same(questionsToAsk({ coachingAgreed: false, weighed: false }),
  ['coaching', 'goal', 'body', 'injuries'], 'a brand-new account is asked all four');

// A coach invited them and both sides agreed the mode. Asking again would hand
// one party a control over a two-party fact — and it is the same control the
// dashboard's accept button has already used.
same(questionsToAsk({ coachingAgreed: true, weighed: false }),
  ['goal', 'body', 'injuries'], 'a linked account is not asked how it is coached');

// They stood on an InBody scan on the way in. The app is holding a measured
// weight; asking them to type one can only make it worse.
same(questionsToAsk({ coachingAgreed: false, weighed: true }),
  ['coaching', 'goal', 'injuries'], 'a measured account is not asked for its weight');

// Both: two questions, and neither was answerable from anything held.
same(questionsToAsk({ coachingAgreed: true, weighed: true }),
  ['goal', 'injuries'], 'a coached, measured account is asked twice');

// Never empty, whatever is known. Nothing in the app can supply a goal (it has
// a default, which is a guess) or an injury (only a person knows), so setup
// always has something to do — an empty list would open a wizard with no steps.
for (const a of [true, false]) for (const b of [true, false]) {
  ok(questionsToAsk({ coachingAgreed: a, weighed: b }).length > 0,
    `something is always asked (${a}, ${b})`);
  ok(questionsToAsk({ coachingAgreed: a, weighed: b }).includes('goal'),
    `the goal is always asked (${a}, ${b})`);
  ok(questionsToAsk({ coachingAgreed: a, weighed: b }).includes('injuries'),
    `injuries are always asked (${a}, ${b})`);
}

// The order survives the filtering. A list rebuilt by hand would be free to
// reorder; this one is derived from SETUP_QUESTIONS and must not.
const filtered = questionsToAsk({ coachingAgreed: true, weighed: true });
eq(filtered.indexOf('goal') < filtered.indexOf('injuries'), true, 'the surviving questions keep their order');

/* ── step ids ───────────────────────────────────────────────────────────── */

ok(isSetupStep('coaching') && isSetupStep('goal') && isSetupStep('body') && isSetupStep('injuries'),
  'the four ids are recognised');
ok(!isSetupStep('diet'), 'a question that was dropped is not a step');
ok(!isSetupStep(''), 'the empty string is not a step');
ok(!isSetupStep(null), 'null is not a step');
ok(!isSetupStep(2), 'an index is not a step');
// `includes` on an array rather than `in` on an object: a prototype member must
// not resolve to a step and be handed to the renderer as an index.
ok(!isSetupStep('toString'), 'toString is not a step');
ok(!isSetupStep('constructor'), 'constructor is not a step');

/* ── the draft, read out of storage ─────────────────────────────────────── */

same(readDraft(null), EMPTY_DRAFT, 'nothing stored reads as nothing');
same(readDraft(undefined), EMPTY_DRAFT, 'undefined reads as nothing');
same(readDraft('body'), EMPTY_DRAFT, 'a bare string is not a draft');
same(readDraft(42), EMPTY_DRAFT, 'a number is not a draft');
same(readDraft([]), { at: null }, 'an array carries no step');
same(readDraft({}), EMPTY_DRAFT, 'an object with no step reads as nothing');
same(readDraft({ at: 'body' }), { at: 'body' }, 'a stored step is read back');
same(readDraft({ at: 'diet' }), EMPTY_DRAFT, 'a step from an older build is dropped');
same(readDraft({ at: 3 }), EMPTY_DRAFT, 'an index stored where a step belongs is dropped');
// The shape a crash mid-write leaves behind.
same(readDraft({ at: null, junk: true }), EMPTY_DRAFT, 'extra keys are ignored');

/* ── where setup reopens ────────────────────────────────────────────────── */

const ALL: SetupStep[] = ['coaching', 'goal', 'body', 'injuries'];

eq(resumeAt(ALL, EMPTY_DRAFT), 0, 'a fresh setup opens at the first question');
eq(resumeAt(ALL, { at: 'coaching' }), 0, 'the first step resumes at the first step');
eq(resumeAt(ALL, { at: 'body' }), 2, 'a step in the middle resumes where it was');
eq(resumeAt(ALL, { at: 'injuries' }), 3, 'the last step resumes at the last step');

// The reason this function exists rather than an indexOf at the call site. A
// coach linked the account, or a scan landed, while setup was half-finished —
// so the stored step is no longer on the list. Restart at the first thing still
// being asked; the alternative is index -1, which renders nothing at all and is
// how a half-finished setup becomes a blank screen somebody force-quits.
const SHORT: SetupStep[] = ['goal', 'injuries'];
eq(resumeAt(SHORT, { at: 'coaching' }), 0, 'a step that is no longer asked restarts at the first');
eq(resumeAt(SHORT, { at: 'body' }), 0, 'a step dropped by a scan restarts at the first');
eq(resumeAt(SHORT, { at: 'injuries' }), 1, 'a surviving step keeps its new index');

// Never out of range, for any list and any draft. The renderer indexes straight
// into the step array.
for (const steps of [ALL, SHORT, ['goal'] as SetupStep[]]) {
  for (const at of [...ALL, null]) {
    const i = resumeAt(steps, { at });
    ok(i >= 0 && i < steps.length, `resume stays in range (${JSON.stringify(steps)}, ${at})`);
  }
}

/* ── the home screen before there is anything on it ─────────────────────── */

/** A brand-new account: both reads settled, nothing in either. */
const NEW: HomeFacts = { bodyStatus: 'ready', measured: false, logStatus: 'ready', loggedEver: 0, hasTargets: false };
/** Somebody a month in. */
const USED: HomeFacts = { bodyStatus: 'ready', measured: true, logStatus: 'ready', loggedEver: 12, hasTargets: true };

eq(homeSectionsShown(NEW), 0, 'a brand-new home screen draws none of the three');
eq(homeSectionsShown(USED), 3, 'a used one draws all three');

ok(!showBody(NEW), 'the body row is not three dashes on day one');
ok(showBody(USED), 'the body row is back with the first measurement');
// One figure is enough. Weight alone, with no scan behind it, still has
// something true to say.
ok(showBody({ ...NEW, measured: true }), 'one measured figure brings the body row back');

ok(!showFuel(NEW), 'a fuel section with no target is not drawn');
ok(showFuel({ ...NEW, hasTargets: true }), 'a target brings it back');

ok(!showWeek(NEW), 'this week is not seven empty dots on day one');
ok(showWeek({ ...NEW, loggedEver: 1 }), 'one logged session brings this week back');
// Gated on the log ever holding anything, not on THIS week. A member who trains
// Monday and Tuesday and opens the app on Sunday has an empty week and eleven
// months of history behind it.
ok(showWeek({ ...USED, loggedEver: 40 }), 'a quiet week does not hide a full history');

/* ── and the rule that makes hiding safe ────────────────────────────────── */

// An empty list under 'error' means unknown, not none. Every non-ready status
// keeps the section on screen, dashes and all, beside the warnings the
// dashboard already prints for exactly this case.
for (const s of ['loading', 'partial', 'error'] as LoadStatus[]) {
  ok(showBody({ ...NEW, bodyStatus: s }), `an unsettled body read (${s}) still draws the row`);
  ok(showWeek({ ...NEW, logStatus: s }), `an unsettled log read (${s}) still draws this week`);
  eq(homeSectionsShown({ ...NEW, bodyStatus: s, logStatus: s }), 2,
    `nothing is hidden on a ${s} read except what has no target`);
}

// 'partial' is not 'ready' and must not be treated as it. A truncated read of
// the training log is a set we cannot count, so "you have never trained" is not
// a claim we are entitled to make from it.
ok(showWeek({ ...NEW, logStatus: 'partial' }), 'a truncated log is not an empty one');

// Fuel is the one section with no status behind it, and correctly so: `macros`
// is null for want of a weight, which is a fact about the profile rather than
// about a read. It stays hidden under every status.
for (const s of ['loading', 'partial', 'error', 'ready'] as LoadStatus[]) {
  ok(!showFuel({ ...NEW, bodyStatus: s, logStatus: s }), `no target means no fuel section (${s})`);
}

/* ── Getting Started ────────────────────────────────────────────────────── */

// Reported as "Repple Coach has a Getting Started, however Client doesn't".
// What the coach app had was the first-run tour firing on a fresh install. This
// is the thing that had to exist instead: a list that survives being read.

eq(CHECKLIST.length, 6, 'six things are worth doing');
same(CHECKLIST.map((c) => c.id), ['setup', 'guide', 'coach', 'workout', 'meal', 'device'],
  'in the order they are worth doing');
eq(new Set(CHECKLIST.map((c) => c.id)).size, CHECKLIST.length, 'the ids are distinct');
for (const it of CHECKLIST) {
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
const FRESH: ChecklistFacts = { setup: false, guide: false, coach: false, workout: false, meal: false, device: false, solo: false };
/** Everything done. */
const FINISHED: ChecklistFacts = { setup: true, guide: true, coach: true, workout: true, meal: true, device: true, solo: false };

eq(checklist(FRESH).length, 6, 'a coached client has six rows');
eq(checklistDone(checklist(FRESH)), 0, 'and none of them done');
eq(checklistLeft(checklist(FRESH)), 6, 'and six to do');
eq(nextTodo(checklist(FRESH))?.id, 'setup', 'the first thing to do is finish setting up');
ok(showChecklist(checklist(FRESH)), 'a fresh checklist is on the home screen');

eq(checklistDone(checklist(FINISHED)), 6, 'a finished one counts six');
eq(checklistLeft(checklist(FINISHED)), 0, 'with nothing left');
eq(nextTodo(checklist(FINISHED)), null, 'and nothing to point at next');
// The rule that stops it becoming clutter. A list stuck at 6 of 6 forever is
// the thing the report was complaining about, wearing a tick.
ok(!showChecklist(checklist(FINISHED)), 'a finished checklist leaves the home screen');

// Solo. There is no coach to connect to, so the row is dropped rather than left
// permanently outstanding — which is the other way a checklist never finishes.
const SOLO_DONE: ChecklistFacts = { ...FINISHED, coach: false, solo: true };
eq(checklist(SOLO_DONE).length, 5, 'a solo client has five rows');
ok(!checklist(SOLO_DONE).some((r) => r.item.id === 'coach'), 'and none of them is the coach row');
ok(!showChecklist(checklist(SOLO_DONE)), 'a solo client can finish without a coach');
// And it comes back if they change their mind, because it is a real step again.
ok(showChecklist(checklist({ ...SOLO_DONE, solo: false })), 'switching off solo puts the coach row back');

/* ── an unread item is not an unfinished one ────────────────────────────── */

// The LoadStatus rule, applied to a list of ticks. Under a failed read the row
// draws neither a tick nor an empty circle.
const UNREAD: ChecklistFacts = { ...FRESH, workout: null, meal: null };
const ur = checklist(UNREAD);
eq(ur.find((r) => r.item.id === 'workout')?.state, 'unknown', 'an unread workout log is unknown');
eq(ur.find((r) => r.item.id === 'meal')?.state, 'unknown', 'an unread food log is unknown');
eq(ur.find((r) => r.item.id === 'setup')?.state, 'todo', 'and the rows that did read still say so');

// Neither counted as done nor counted as outstanding. "4 left" over two failed
// reads is a number made out of our own failure.
eq(checklistDone(ur), 0, 'an unknown row is not done');
eq(checklistLeft(ur), 4, 'nor is it outstanding');
ok(!ur.some((r) => r.item.id === 'workout' && r.state === 'todo'), 'a failed read never reads as not done');

// The important direction: a list whose reads all failed must NOT congratulate
// anybody. It stays on the home screen until it knows.
const ALL_UNREAD: ChecklistFacts = { setup: null, guide: null, coach: null, workout: null, meal: null, device: null, solo: false };
eq(checklistDone(checklist(ALL_UNREAD)), 0, 'nothing is done when nothing could be read');
eq(checklistLeft(checklist(ALL_UNREAD)), 0, 'and nothing is outstanding either');
eq(nextTodo(checklist(ALL_UNREAD)), null, 'so there is no next thing to point at');
ok(showChecklist(checklist(ALL_UNREAD)), 'but the checklist stays until it knows');

// One unread item among five ticks keeps it too. This is the case that would
// otherwise quietly drop a real to-do off somebody's home screen.
const NEARLY: ChecklistFacts = { ...FINISHED, device: null };
eq(checklistDone(checklist(NEARLY)), 5, 'five of six read as done');
ok(showChecklist(checklist(NEARLY)), 'and the sixth being unreadable keeps the row');

// nextTodo skips over the unknowns to the first thing genuinely outstanding,
// rather than sending somebody to a screen that may already be finished.
const SKIP: ChecklistFacts = { ...FRESH, setup: null, guide: null };
eq(nextTodo(checklist(SKIP))?.id, 'coach', 'the next thing to do is the first one known to be undone');

// Order survives. The rows are what the screen indexes and what the home row
// quotes, so a reordering that reversed them would send people to the wrong
// screen from the "next" line.
same(checklist(FRESH).map((r) => r.item.id as ChecklistItemId),
  ['setup', 'guide', 'coach', 'workout', 'meal', 'device'], 'the rows keep the list order');

/* ── "Log Something You Ate": ever, not today ───────────────────────────── */

// The defect: both screens computed this item from `useFoodLog().entries`,
// which is TODAY ONLY. So it ticked the evening somebody logged dinner and
// un-ticked itself at midnight; `checklistLeft` never reached zero and the
// onboarding row never left the home screen of ANY member, however long they
// had been logging. These are the assertions that stop it coming back.

/** Nothing on this phone, and the history read has not answered. */
const MEAL_SILENT: MealEverFacts = { loggedToday: 0, unsentEarlier: 0, everLogged: null };

// THE ONE THAT MATTERS. 00:05, they have not eaten yet, and they have logged
// every meal for six months. Today is empty and the item is still DONE.
eq(everLoggedMeal({ loggedToday: 0, unsentEarlier: 0, everLogged: true }), true,
  'an empty today does not un-tick a member who has logged before');

// And it is not a streak. There is no window in this, so "nothing today,
// nothing this week, nothing this month" is the same answer as "nothing since
// breakfast": the question was never about recency.
eq(everLoggedMeal({ loggedToday: 0, unsentEarlier: 0, everLogged: true }),
  everLoggedMeal({ loggedToday: 4, unsentEarlier: 0, everLogged: true }),
  'logging today adds nothing to having logged ever');

// A genuinely new member. The history read answered, and it answered no.
eq(everLoggedMeal({ loggedToday: 0, unsentEarlier: 0, everLogged: false }), false,
  'a member who has never logged one still has it to do');

// Their first meal, the moment it is on screen. It counts before any read
// confirms it — the row in front of them was logged by somebody.
eq(everLoggedMeal({ loggedToday: 1, unsentEarlier: 0, everLogged: false }), true,
  "today's meal is proof on its own");
eq(everLoggedMeal({ loggedToday: 1, unsentEarlier: 0, everLogged: null }), true,
  'and it does not wait for the history read to land');

// The offline case, which is the one that would be easiest to drop. A meal
// logged in a basement for yesterday is not in `entries` — it is held in the
// owed queue — and it is still a meal this member logged.
eq(everLoggedMeal({ loggedToday: 0, unsentEarlier: 1, everLogged: false }), true,
  'a meal this phone is still holding for an earlier day counts');
eq(everLoggedMeal({ loggedToday: 0, unsentEarlier: 2, everLogged: null }), true,
  'even when nothing has been able to confirm it');

// The null, which is the whole reason this is a function. A read that has not
// landed is not a no AND it is not a yes.
eq(everLoggedMeal(MEAL_SILENT), null, 'an unanswered history read says nothing');
ok(everLoggedMeal(MEAL_SILENT) !== false, 'it never reads as "you have never logged a meal"');
ok(everLoggedMeal(MEAL_SILENT) !== true, 'and never draws a tick it has not earned');

/* ── the same three facts, through the list the screens draw ─────────────── */

const mealRow = (f: MealEverFacts): ChecklistFacts => ({ ...FINISHED, meal: everLoggedMeal(f) });
const mealState = (f: MealEverFacts) => checklist(mealRow(f)).find((r) => r.item.id === 'meal')!.state;

// The reproduction, end to end: six months of meals, nothing logged yet today.
// Before this fix the row read 'todo', the count read 5 of 6, and the home row
// stayed. It is the finished list it should always have been.
eq(mealState({ loggedToday: 0, unsentEarlier: 0, everLogged: true }), 'done',
  'the six-month member has logged something they ate');
eq(checklistLeft(checklist(mealRow({ loggedToday: 0, unsentEarlier: 0, everLogged: true }))), 0,
  'and has nothing left over from midnight');
ok(!showChecklist(checklist(mealRow({ loggedToday: 0, unsentEarlier: 0, everLogged: true }))),
  'so the onboarding row finally leaves their home screen');

// In flight: a dash, and the row stays. Not a tick — the list must not
// congratulate anybody off a read that has not happened — and not an empty
// circle either.
eq(mealState(MEAL_SILENT), 'unknown', 'an unread history draws a dash');
eq(checklistDone(checklist(mealRow(MEAL_SILENT))), 5, 'an unknown meal row is not counted done');
eq(checklistLeft(checklist(mealRow(MEAL_SILENT))), 0, 'nor counted as outstanding');
ok(showChecklist(checklist(mealRow(MEAL_SILENT))), 'and the list stays until it knows');
eq(nextTodo(checklist(mealRow(MEAL_SILENT))), null,
  'nobody is sent to the Food Log to do a thing they may already have done');

// The new member, who really does still have it to do.
eq(mealState({ loggedToday: 0, unsentEarlier: 0, everLogged: false }), 'todo',
  'a brand-new member is told to log something');
eq(nextTodo(checklist(mealRow({ loggedToday: 0, unsentEarlier: 0, everLogged: false })))?.id, 'meal',
  'and pointed at the right row');

/* ── every other row on the list, checked for the same shape ─────────────── */
//
// The question asked of each: does the fact behind it come from a read with a
// DAY in it, so that the item could un-tick itself while the member's history
// stays exactly as it was?
//
//   setup   AsyncStorage ONBOARD_KEY — a device mark, set once, never cleared.
//   guide   AsyncStorage GUIDE_SEEN_KEY — the same. Both are per-DEVICE rather
//           than per-account, so a reinstall loses them; that is a different
//           complaint (it costs taps, not a day) and firstRun.ts argues it
//           deliberately where SetupDraft is defined.
//   coach   clientData.coachLinked — a state of the link, not a window.
//   workout useWorkoutLog().log — src/ui/workoutLog.tsx selects the member's
//           workouts with NO date floor, so `log.length > 0` really is "ever".
//           This is the one that proves the shape is available: the training
//           half of the same pair was already right, and only the food half
//           was reading a day.
//   meal    was the defect. Fixed above.
//   device  the live state of a connected watch, which is a present-tense
//           question by construction — "Connect a Watch" is undone again if
//           they disconnect it, and that is the honest answer.
//
// So: one row had it, and it is this one. Nothing below is a day-shaped fact
// wearing an ever-shaped title.
same(CHECKLIST.map((c) => c.id), ['setup', 'guide', 'coach', 'workout', 'meal', 'device'],
  'the six rows are still the six rows this was checked against');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('firstRun.test.ts — ok');
