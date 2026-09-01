// The per-screen help card: its words, and the promise that it never comes
// back. Compile with tsc, run with node.
//
// The rule worth a test is the dismissal one. A help card that reappears is
// worse than no help card at all — it is the nag the report was complaining
// about — and the two ways it comes back are both parse failures rather than
// logic ones: a stored list that fails to read as a list, and a key written
// twice so the round trip through storage compounds. Both are pinned below.
import {
  SCREEN_HELP, CLIENT_HELP_KEYS, COACH_HELP_KEYS,
  dismissedFrom, isDismissed, withDismissed, isHelpKey,
  type ScreenHelpKey,
} from './screenHelp';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL = Object.keys(SCREEN_HELP) as ScreenHelpKey[];

/* ── one card per tab, and no more ──────────────────────────────────────── */

// Two populations, asserted separately and never as one total. A bare
// `ALL.length === 10` would pass just as happily if a coach card were added and
// a client tab's card deleted, which is the exact accident the client half of
// this feature could not survive: the five below match the five tabs in
// app/(client)/_layout.tsx and a sixth is a sixth thing on a screen, which the
// whole argument for this feature is against.
same(CLIENT_HELP_KEYS, ['home', 'train', 'meals', 'progress', 'me'], 'the client five, in tab order');
eq(CLIENT_HELP_KEYS.length, 5, 'there is one card per client tab');

// The coach's five are not tabs — the coach app has no tab bar — they are the
// five screens whose numbers are computed rather than typed. Capped at five for
// the same volume reason: a help row on all fifty-one coach screens is the
// complaint this feature answers, restated.
eq(COACH_HELP_KEYS.length, 5, 'and five for the coach');
for (const k of COACH_HELP_KEYS) {
  ok(k.startsWith('coach-'), `${k} is namespaced to the coach — a client and a coach can share a handset, and a collision dismisses the wrong card`);
}

// Every key belongs to exactly one of the two lists, and every entry in the
// record is reachable from one of them. A card in SCREEN_HELP that is in
// neither list is a card no screen can be pointed at and no test can watch.
eq(ALL.length, CLIENT_HELP_KEYS.length + COACH_HELP_KEYS.length, 'the record holds the two lists and nothing else');
for (const k of ALL) {
  const inClient = CLIENT_HELP_KEYS.includes(k);
  const inCoach = COACH_HELP_KEYS.includes(k);
  ok(inClient !== inCoach, `${k} is listed in exactly one of the two populations`);
}

for (const k of ALL) {
  const h = SCREEN_HELP[k];
  // The record's key and the entry's own key are the storage value. A mismatch
  // dismisses one card and hides another.
  eq(h.key, k, `${k} knows its own key`);
  // Title Case: the collapsed row is a control, and check:caps cannot see
  // inside this object.
  ok(/^[A-Z]/.test(h.title), `${k}'s title opens in capitals`);
  ok(h.lines.length >= 3 && h.lines.length <= 4, `${k} has three or four lines`);
  for (const l of h.lines) {
    // The term quotes a label the reader can see on the screen, so it is cased
    // the way that label is.
    ok(/^[A-Z]/.test(l.term), `"${l.term}" on ${k} is Title Case`);
    // The explanation is a sentence and is punctuated as one. It runs on from
    // the term, so it opens lower case deliberately.
    ok(l.means[0] === l.means[0].toLowerCase(), `"${l.term}" on ${k} explains itself in sentence case`);
    ok(l.means.endsWith('.'), `"${l.term}" on ${k} ends its sentence`);
    // House voice. An exclamation mark in help copy is the "Welcome to your
    // fitness journey" register this app does not use.
    ok(!l.means.includes('!'), `"${l.term}" on ${k} does not shout`);
    // Long enough to say something. "The Card Below It" x 5 tabs is a tour.
    ok(l.means.length > 40, `"${l.term}" on ${k} says something specific`);
  }
  // No two lines on one card explaining the same label.
  eq(new Set(h.lines.map((l) => l.term)).size, h.lines.length, `${k} does not repeat a term`);
}

/* ── keys ───────────────────────────────────────────────────────────────── */

for (const k of ALL) ok(isHelpKey(k), `${k} is a key`);
ok(!isHelpKey('dashboard'), 'the route file name is not the key');
ok(!isHelpKey(''), 'the empty string is not a key');
ok(!isHelpKey(null), 'null is not a key');
ok(!isHelpKey(0), 'an index is not a key');
// Object.keys on a plain object, checked with includes: a prototype member must
// not read back as a dismissed screen.
ok(!isHelpKey('toString'), 'toString is not a key');
ok(!isHelpKey('hasOwnProperty'), 'hasOwnProperty is not a key');

/* ── what was dismissed, read out of storage ────────────────────────────── */

same(dismissedFrom(null), [], 'nothing stored means nothing dismissed');
same(dismissedFrom(undefined), [], 'undefined means nothing dismissed');
same(dismissedFrom('home'), [], 'a bare string is not a list');
same(dismissedFrom({ home: true }), [], 'an object is not a list');
same(dismissedFrom([]), [], 'an empty list is empty');
same(dismissedFrom(['home', 'meals']), ['home', 'meals'], 'a stored list reads back');

// The tolerant half, and the reason it is tolerant. Every key that still names
// a screen is KEPT even when the entry beside it is rubbish — the cost of
// dropping one is a dismissed card coming back, which is the one outcome this
// file exists to prevent.
same(dismissedFrom(['home', 42, null, 'meals', { k: 'me' }]), ['home', 'meals'],
  'the recognisable keys survive a corrupt neighbour');
same(dismissedFrom(['home', 'nutrition']), ['home'], 'a key for a screen that no longer exists is dropped');
// Storage round-trips, so a duplicate written once would come back forever.
same(dismissedFrom(['home', 'home', 'home']), ['home'], 'a duplicate in storage reads back once');

/* ── dismissing, and staying dismissed ──────────────────────────────────── */

ok(!isDismissed([], 'home'), 'an untouched card shows');
ok(isDismissed(['home'], 'home'), 'a dismissed card does not');
ok(!isDismissed(['home'], 'meals'), 'dismissing one card does not dismiss the others');

same(withDismissed([], 'home'), ['home'], 'dismissing adds the key');
same(withDismissed(['home'], 'meals'), ['home', 'meals'], 'dismissing a second keeps the first');

// Idempotent. This list is read from storage, added to, and written back on
// every dismissal; a version that appended unconditionally would grow one entry
// per tap on a card the reader has already closed.
same(withDismissed(['home'], 'home'), ['home'], 'dismissing twice writes one key');
eq(withDismissed(withDismissed(['home'], 'home'), 'home').length, 1, 'and a third time');

// The input is not mutated: the caller holds it in React state and renders from
// it, so an in-place push would leave the old array and the new one identical
// and the card on screen until something else re-rendered.
const before: ScreenHelpKey[] = ['home'];
const after = withDismissed(before, 'meals');
eq(before.length, 1, 'the list handed in is left alone');
eq(after.length, 2, 'and a new one comes back');
ok(before !== after, 'a fresh array comes back even when nothing changed');
ok(withDismissed(before, 'home') !== before, 'including when the key was already there');

// The whole round trip, which is what actually runs: dismiss, serialise,
// reload, and the card must still be gone.
let stored: ScreenHelpKey[] = [];
for (const k of ALL) stored = withDismissed(stored, k);
const reread = dismissedFrom(JSON.parse(JSON.stringify(stored)));
for (const k of ALL) ok(isDismissed(reread, k), `${k} survives the round trip through storage`);
eq(reread.length, ALL.length, 'and nothing was added on the way');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('screenHelp.test.ts — ok');
