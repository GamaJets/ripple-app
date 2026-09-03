// The coach's first-run list. Compile with tsc, run with node.
//
// One rule is worth almost all of this file: A DASH IS NOT A CROSS. Every fact
// the screen hands in is `boolean | null`, null means the read did not answer,
// and the failure this suite exists to stop is a null being counted as "not
// done" anywhere — in the tick, in the "N left" figure, in the fraction, or in
// the decision to take the row off the dashboard.
//
// That failure has a concrete cost and it is not hypothetical. Told "you have
// not connected Stripe", a coach with a live payout account goes and
// disconnects it. Told "0 of 8 done" because the session read was in flight, a
// coach who set everything up in March concludes the app has lost their
// account. src/lib/firstRun.ts states the same rule for the client's list and
// this is the coach's half of it.
import {
  COACH_SETUP, coachSetupRows, coachSetupDone, coachSetupLeft, coachSetupUnknown,
  coachSetupNa, coachSetupNext, showCoachSetup, coachSetupHeading, coachSetupNote,
  coachSetupCardLine, stepApplies, NOT_YOUR_SETUP,
  type CoachSetupFacts, type CoachSetupId,
} from './coachFirstRun';

declare const process: { exit(code: number): void; exitCode: number };
// Start failed and reach success, so a throw partway down cannot pass silently.
process.exitCode = 1;

/** The only screens a setup step may open. Every one of them does the thing
 *  its step describes. Written out rather than derived, so adding a tenth item
 *  is a decision somebody has to make here too. */
const REACHABLE: readonly string[] = [
  '/(trainer)/settings', '/(trainer)/profile', '/(trainer)/dashboard',
  '/(trainer)/calendar', '/(trainer)/payments', '/(trainer)/documents',
];

/** The only things a route may ask a screen to open on arrival, and the screen
 *  that honours each. A step is allowed to name a CONTROL as well as a screen
 *  — two of them are done in a bottom sheet nothing on the screen names — but
 *  it is not allowed to invent one: a `?start=` nobody handles lands the coach
 *  exactly where the bare route did, which is the dead end the parameter was
 *  added to fix. */
const START_TARGETS: Record<string, string> = { invite: '/(trainer)/dashboard' };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Nothing read. The state a brand-new mount is in, and the state a signed-out
 *  session is in, and they must produce the same answers. */
const NONE: CoachSetupFacts = {
  mode: null, currency: null, rate: null, client: null, availability: null,
  package: null, stripe: null, code: null, document: null,
};
const ALL_TODO: CoachSetupFacts = {
  mode: false, currency: false, rate: false, client: false, availability: false,
  package: false, stripe: false, code: false, document: false,
};
const ALL_DONE: CoachSetupFacts = {
  mode: true, currency: true, rate: true, client: true, availability: true,
  package: true, stripe: true, code: true, document: true,
};

/* ── the list itself ────────────────────────────────────────────────────── */

// Eight, and every id distinct. A duplicate id would make `f[it.id]` read one
// fact twice and leave another unread with nothing saying so.
eq(COACH_SETUP.length, 9, 'nine items');
eq(new Set(COACH_SETUP.map((i) => i.id)).size, 9, 'every id is distinct');

// How they coach first, because it is the only item that changes what the rest
// of the list IS: answering "online" takes the availability step off it.
eq(COACH_SETUP[0].id, 'mode', 'how they coach is asked before anything it changes');
// Currency second. Not decoration: it is the one setting whose absence blanks
// six other screens, and a list that puts it fifth spends a coach's first
// fortnight teaching them the money features do not work.
eq(COACH_SETUP[1].id, 'currency', 'currency is the first thing that has to be set');

for (const it of COACH_SETUP) {
  // Title Case — these render as a row title, and check:caps cannot see inside
  // an object literal.
  ok(/^[A-Z]/.test(it.title), `"${it.title}" opens in capitals`);
  // The note and the breaks line are prose and run on from other words on the
  // row, so both open in lower case.
  ok(it.note[0] === it.note[0].toLowerCase(), `${it.id}'s note is sentence case`);
  ok(it.breaks[0] === it.breaks[0].toLowerCase(), `${it.id}'s breaks line is sentence case`);
  // "Until this is done, {breaks}." is the sentence the screen builds, so a
  // full stop inside would produce two.
  ok(!it.breaks.endsWith('.'), `${it.id}'s breaks line is a clause, not a sentence — the screen punctuates it`);
  // Long enough to be a reason rather than a restatement of the title.
  ok(it.breaks.length > 40, `${it.id} says what actually breaks`);
  ok(!it.note.includes('!') && !it.breaks.includes('!'), `${it.id} does not shout`);
  // Every route is a coach route, and the only parameter any of them may
  // carry is `start` — which names a control on the screen it already names.
  // A row that opens a screen needing a clientId is still a dead end.
  ok(it.route.startsWith('/(trainer)/'), `${it.id} opens a coach screen`);
  const [path, query] = it.route.split('?');
  if (query != null) {
    const [key, value] = query.split('=');
    eq(key, 'start', `${it.id} carries no parameter but 'start'`);
    ok(value in START_TARGETS, `${it.id} names a control something actually opens`);
    eq(START_TARGETS[value], path, `${it.id}'s control lives on the screen it opens`);
    ok(!query.includes('&'), `${it.id} carries one parameter, not a query string`);
  }
  // …and it is one of the screens this list is allowed to send anybody to.
  // src/lib/features.ts is NOT imported to check that: it pulls in the icon
  // component and this suite runs under plain node with no JSX. The route
  // strings are literals in coachFirstRun.ts, so scripts/check-reachable.mjs is
  // what proves each names a screen that exists; what this asserts is the
  // narrower thing a grep cannot — that nobody has quietly pointed a setup step
  // at a screen the coach cannot act on.
  ok(REACHABLE.includes(path), `${it.id} points at one of the screens this list may open`);
}

// ── the two steps whose control is not the screen ─────────────────────────
//
// Both are completed in one bottom sheet on the Clients tab, behind a button
// nothing on the checklist mentions. Routed bare, a coach tapping either
// arrived back on the tab the card is ON, looking at the card that had just
// sent them. A checklist item that cannot be finished from where it sends the
// reader is worse than no item, because it teaches them to ignore the card.
for (const id of ['client', 'code'] as const) {
  const it = COACH_SETUP.find((x) => x.id === id)!;
  ok(it.route.includes('?start='), `${id} is done in a sheet, so it names the sheet and not just the screen`);
}

/* ── a dash is not a cross ──────────────────────────────────────────────── */

const noneRows = coachSetupRows(NONE);
eq(noneRows.length, 9, 'every item gets a row whatever was read');
eq(coachSetupDone(noneRows), 0, 'nothing read is nothing done');
// THE assertion. Eight unread rows are not eight outstanding tasks.
eq(coachSetupLeft(noneRows), 0, 'nothing read is nothing OUTSTANDING either');
eq(coachSetupUnknown(noneRows), 9, 'they are all unknown');
eq(coachSetupNext(noneRows), null, 'and there is no "next" to send anybody to');

const todoRows = coachSetupRows(ALL_TODO);
eq(coachSetupLeft(todoRows), 9, 'a settled false IS outstanding');
eq(coachSetupUnknown(todoRows), 0, 'and is not unknown');
eq(coachSetupNext(todoRows)?.id, 'mode' as CoachSetupId, 'the next thing is the first outstanding one, in list order');

// The mixed case, which is the one that actually happens: some reads land and
// one does not.
const mixed: CoachSetupFacts = { ...ALL_DONE, stripe: null, code: false };
const mixedRows = coachSetupRows(mixed);
eq(coachSetupDone(mixedRows), 7, 'seven known done');
eq(coachSetupLeft(mixedRows), 1, 'one known outstanding');
eq(coachSetupUnknown(mixedRows), 1, 'and one unread');
eq(coachSetupDone(mixedRows) + coachSetupLeft(mixedRows) + coachSetupUnknown(mixedRows)
   + coachSetupNa(mixedRows), 9,
  'the four counts partition the list');
eq(coachSetupNext(mixedRows)?.id, 'code' as CoachSetupId,
  'the unread row is skipped over rather than offered as the next thing to do');

/* ── when the row comes off the dashboard ───────────────────────────────── */

ok(showCoachSetup(coachSetupRows(ALL_TODO)), 'an unfinished list stays on the dashboard');
// The clause that matters. A list that hid itself because its reads failed
// would take the currency step away from the coach whose currency read failed —
// which is the same coach it exists for.
ok(showCoachSetup(noneRows), 'a list nobody could read stays too, because unknown is not finished');
ok(showCoachSetup(coachSetupRows({ ...ALL_DONE, document: null })),
  'one unread row keeps it, even when every other row is done');
ok(!showCoachSetup(coachSetupRows(ALL_DONE)), 'and it goes only when every row is genuinely done');

/* ── the heading, and the denominator it is allowed to state ────────────── */

eq(coachSetupHeading(coachSetupRows(ALL_DONE)), '9 of 9 done', 'a fully-read list may state a fraction');
eq(coachSetupHeading(coachSetupRows(ALL_TODO)), '0 of 9 done', 'including one where nothing is done');
// "6 of 8" over two unread rows states something about the two we could not
// see. The count stands alone instead.
eq(coachSetupHeading(mixedRows), '7 done', 'a partly-unread list states a count and no denominator');
eq(coachSetupHeading(noneRows), '0 done', 'and an entirely unread one says 0 done, not 0 of 9');

/* ── the line under it ──────────────────────────────────────────────────── */

ok(coachSetupNote(noneRows, 'loading').includes('Checking'), 'nothing is claimed while the read is in flight');
// The dangerous sentence: everything readable is done, and something was not
// readable. "That is everything" here is the app congratulating a coach on a
// setup it has not seen.
const nearly = coachSetupRows({ ...ALL_DONE, stripe: null });
const nearlyNote = coachSetupNote(nearly, 'ready');
ok(!nearlyNote.startsWith('That is everything'),
  'a list with an unread row never calls itself finished');
ok(nearlyNote.includes('dash'), 'and it says what the dash means instead');
ok(coachSetupNote(coachSetupRows(ALL_DONE), 'ready').startsWith('That is everything'),
  'a genuinely finished list says so');
ok(coachSetupNote(coachSetupRows(ALL_TODO), 'ready').includes('any order'),
  'an outstanding list invites work in any order');

// House voice, on every sentence this module can print.
for (const st of ['loading', 'ready'] as const) {
  for (const f of [NONE, ALL_TODO, ALL_DONE, mixed]) {
    const line = coachSetupNote(coachSetupRows(f), st);
    ok(!line.includes('!'), 'the note does not shout');
    ok(line.length > 20, 'the note says something');
  }
}

/* ── a step that does not apply is neither a task nor a tick ────────────── */
//
// "Set When You Work" publishes bookable slots. An online-only client gets no
// booking calendar at all, so for a coach with nobody in the room there is
// nobody who could ever take one. Left as 'todo' it is a permanent nag for
// something that would change nothing; marked 'done' it is a claim that they
// published hours they did not.

// The widest answer, which is what an unknown shape resolves to: everything
// applies, and the list is exactly what it has always been.
for (const id of COACH_SETUP.map((i) => i.id)) {
  ok(stepApplies(id, null), `${id} applies when we do not know how they coach`);
  ok(stepApplies(id, 'inperson'), `${id} applies to a coach who trains in the room`);
}
eq(COACH_SETUP.map((i) => i.id).filter((id) => !stepApplies(id, 'remote')).join(','), 'availability',
  'exactly one step does not apply to a remote coach, and it is availability');
ok(NOT_YOUR_SETUP.availability != null, 'and the row says why rather than vanishing');
ok(NOT_YOUR_SETUP.availability.includes('comes back'),
  'and says how to get it back, because hidden is not deleted');

const remoteDone = coachSetupRows(ALL_DONE, 'remote');
eq(coachSetupNa(remoteDone), 1, 'one row does not apply');
eq(coachSetupDone(remoteDone), 8, 'and it is not counted as done');
eq(coachSetupHeading(remoteDone), '8 of 8 done', 'the denominator is the steps that apply to THIS coach');

const remoteTodo = coachSetupRows(ALL_TODO, 'remote');
eq(coachSetupLeft(remoteTodo), 8, 'nor is it counted as outstanding');
ok(coachSetupNext(remoteTodo)?.id !== 'availability', 'and a coach is never sent to do it');

// The one that matters: an online coach who has done everything that applies is
// finished, and the row comes off their dashboard.
const remoteFinished = coachSetupRows({ ...ALL_DONE, availability: false }, 'remote');
ok(!showCoachSetup(remoteFinished),
  'a remote coach who never published hours has still finished the list');
ok(showCoachSetup(coachSetupRows({ ...ALL_DONE, availability: false }, 'inperson')),
  'and an in-person coach in the same state has not');
ok(coachSetupNote(remoteFinished, 'ready').startsWith('That is everything'),
  'and is told so');

// The unknown shape must never narrow the list. Same facts, no shape: the
// availability step is back and outstanding.
ok(showCoachSetup(coachSetupRows({ ...ALL_DONE, availability: false })),
  'not knowing how a coach works never takes a step off their list');
eq(coachSetupNa(coachSetupRows(ALL_DONE)), 0, 'and nothing is marked as not applying');

/* ── the step that asks the question ────────────────────────────────────── */

const unasked = coachSetupRows({ ...ALL_DONE, mode: false });
eq(coachSetupNext(unasked)?.id, 'mode' as CoachSetupId,
  'a coach who has not said how they coach is asked');
// And a coach whose declaration could not be READ is not asked. A dash, not a
// cross, on the row whose whole subject is what we know about them.
eq(coachSetupNext(coachSetupRows({ ...ALL_DONE, mode: null })), null,
  'a coach whose answer could not be read is not told to answer again');

/* ── the card's one line, and the count it used to print bare ───────────── */

// `coachSetupLeft` excludes rows whose read did not answer — the rule that
// stops a failed read becoming a nag — so the figure UNDERSTATES whenever
// anything is unread, and the card said nothing about that. `coachSetupHeading`
// already refuses to print a denominator over a partly-unread list for exactly
// this reason; the card was the surface that had not learnt it.
{
  const clean = coachSetupRows({ ...ALL_DONE, rate: false, package: false });
  eq(coachSetupUnknown(clean), 0, 'the fixture has nothing unread');
  eq(coachSetupCardLine(clean), 'Setting up · 2 left', 'a wholly-read list prints the count alone');

  const partly = coachSetupRows({ ...ALL_DONE, rate: false, package: false, stripe: null, document: null });
  eq(coachSetupLeft(partly), 2, 'the outstanding count is unchanged by two refused reads');
  eq(coachSetupUnknown(partly), 2, 'and the two are counted as unread');
  const line = coachSetupCardLine(partly);
  ok(line.includes('2 left'), 'the card still says what is known to be outstanding');
  ok(/not checked/.test(line), 'and says the figure is not the whole list');
  ok(line !== coachSetupCardLine(clean),
    'so two identical-looking lists that differ by two refused reads do not read identically');

  // Nothing outstanding but something unread. The card stays — `showCoachSetup`
  // keeps it — and it must not imply a task, because none is known.
  const onlyUnknown = coachSetupRows({ ...ALL_DONE, stripe: null });
  ok(showCoachSetup(onlyUnknown), 'an unread row keeps the card on screen');
  eq(coachSetupLeft(onlyUnknown), 0, 'with nothing known to be outstanding');
  ok(!/left/.test(coachSetupCardLine(onlyUnknown)), 'so the card claims nothing is left to do');
  ok(/could not be checked/.test(coachSetupCardLine(onlyUnknown)), 'and says what it actually is');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachFirstRun.test.ts — ok');
process.exitCode = 0;
