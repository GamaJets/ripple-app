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
  coachSetupNext, showCoachSetup, coachSetupHeading, coachSetupNote,
  type CoachSetupFacts, type CoachSetupId,
} from './coachFirstRun';

/** The only screens a setup step may open. Every one of them takes no params
 *  and does the thing its step describes. Written out rather than derived, so
 *  adding a ninth item is a decision somebody has to make here too. */
const REACHABLE: readonly string[] = [
  '/(trainer)/settings', '/(trainer)/profile', '/(trainer)/dashboard',
  '/(trainer)/calendar', '/(trainer)/payments', '/(trainer)/documents',
];

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Nothing read. The state a brand-new mount is in, and the state a signed-out
 *  session is in, and they must produce the same answers. */
const NONE: CoachSetupFacts = {
  currency: null, rate: null, client: null, availability: null,
  package: null, stripe: null, code: null, document: null,
};
const ALL_TODO: CoachSetupFacts = {
  currency: false, rate: false, client: false, availability: false,
  package: false, stripe: false, code: false, document: false,
};
const ALL_DONE: CoachSetupFacts = {
  currency: true, rate: true, client: true, availability: true,
  package: true, stripe: true, code: true, document: true,
};

/* ── the list itself ────────────────────────────────────────────────────── */

// Eight, and every id distinct. A duplicate id would make `f[it.id]` read one
// fact twice and leave another unread with nothing saying so.
eq(COACH_SETUP.length, 8, 'eight items');
eq(new Set(COACH_SETUP.map((i) => i.id)).size, 8, 'every id is distinct');

// Currency first. Not decoration: it is the one setting whose absence blanks
// six other screens, and a list that puts it fourth spends a coach's first
// fortnight teaching them the money features do not work.
eq(COACH_SETUP[0].id, 'currency', 'currency is the first thing asked for');

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
  // Every route is a coach route and takes NO params — the screen pushes it
  // bare, and a row that opens a screen needing a clientId is a dead end.
  ok(it.route.startsWith('/(trainer)/'), `${it.id} opens a coach screen`);
  ok(!it.route.includes('?'), `${it.id}'s route carries no parameters`);
  // …and it is one of the screens this list is allowed to send anybody to.
  // src/lib/features.ts is NOT imported to check that: it pulls in the icon
  // component and this suite runs under plain node with no JSX. The route
  // strings are literals in coachFirstRun.ts, so scripts/check-reachable.mjs is
  // what proves each names a screen that exists; what this asserts is the
  // narrower thing a grep cannot — that nobody has quietly pointed a setup step
  // at a screen the coach cannot act on.
  ok(REACHABLE.includes(it.route), `${it.id} points at one of the screens this list may open`);
}

/* ── a dash is not a cross ──────────────────────────────────────────────── */

const noneRows = coachSetupRows(NONE);
eq(noneRows.length, 8, 'every item gets a row whatever was read');
eq(coachSetupDone(noneRows), 0, 'nothing read is nothing done');
// THE assertion. Eight unread rows are not eight outstanding tasks.
eq(coachSetupLeft(noneRows), 0, 'nothing read is nothing OUTSTANDING either');
eq(coachSetupUnknown(noneRows), 8, 'they are all unknown');
eq(coachSetupNext(noneRows), null, 'and there is no "next" to send anybody to');

const todoRows = coachSetupRows(ALL_TODO);
eq(coachSetupLeft(todoRows), 8, 'a settled false IS outstanding');
eq(coachSetupUnknown(todoRows), 0, 'and is not unknown');
eq(coachSetupNext(todoRows)?.id, 'currency' as CoachSetupId, 'the next thing is the first outstanding one, in list order');

// The mixed case, which is the one that actually happens: some reads land and
// one does not.
const mixed: CoachSetupFacts = { ...ALL_DONE, stripe: null, code: false };
const mixedRows = coachSetupRows(mixed);
eq(coachSetupDone(mixedRows), 6, 'six known done');
eq(coachSetupLeft(mixedRows), 1, 'one known outstanding');
eq(coachSetupUnknown(mixedRows), 1, 'and one unread');
eq(coachSetupDone(mixedRows) + coachSetupLeft(mixedRows) + coachSetupUnknown(mixedRows), 8,
  'the three counts partition the list');
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

eq(coachSetupHeading(coachSetupRows(ALL_DONE)), '8 of 8 done', 'a fully-read list may state a fraction');
eq(coachSetupHeading(coachSetupRows(ALL_TODO)), '0 of 8 done', 'including one where nothing is done');
// "6 of 8" over two unread rows states something about the two we could not
// see. The count stands alone instead.
eq(coachSetupHeading(mixedRows), '6 done', 'a partly-unread list states a count and no denominator');
eq(coachSetupHeading(noneRows), '0 done', 'and an entirely unread one says 0 done, not 0 of 8');

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

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachFirstRun.test.ts — ok');
