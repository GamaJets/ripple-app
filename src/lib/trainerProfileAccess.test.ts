// Who may read their own trainer profile (TF-32). Compile with tsc then run
// with node.
//
// The assertions that matter here are the ones about ABSENCE, the same way they
// are in photoCompare.test.ts. It is easy to test that a coach on a coach build
// gets their name and their rate. What shipped the bug was the other four
// cases quietly returning something plausible: a name that was the reader's, a
// face that was the reader's, and a session fee of 0 that no coach had ever
// typed. So most of this file is about what must come back blank and about the
// one number that must come back null rather than zero.
import {
  resolveTrainerAccess,
  mayReadTrainerProfile,
  guardTrainerProfile,
  trainerAccessNote,
  NO_TRAINER_PROFILE,
  type TrainerAccess,
  type TrainerProfileFields,
} from './trainerProfileAccess';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// A fully loaded profile, standing in for the row the provider fetched. On the
// client app the equivalent object holds the READER's name and the READER's
// face, which is exactly why none of it may leave the guard there.
const LOADED: TrainerProfileFields = {
  name: 'Sam Rivera',
  photo: 'https://example.invalid/sam.jpg',
  tagline: 'Strength, patiently',
  bio: 'Twelve years coaching.',
  offers: ['1:1 PT'],
  specialties: ['Mobility'],
  sessionFee: 75,
  listed: true,
};

const read = (o: Partial<Parameters<typeof resolveTrainerAccess>[0]> = {}) =>
  resolveTrainerAccess({ variant: 'trainer', settled: true, signedIn: true, trainerRow: 'present', ...o });

/* ── the five outcomes ──────────────────────────────────────────────────── */

ok(read() === 'ok', 'a signed-in trainer on the trainer build may read their own profile');
ok(read({ settled: false }) === 'loading', 'nothing is decided before the read has settled');
ok(read({ signedIn: false }) === 'signed-out', 'signed out is signed out, not "not a trainer"');
ok(read({ trainerRow: 'absent' }) === 'not-a-trainer',
   'a signed-in user whose trainers row came back absent is not a trainer');

// A read that did not come back is not a read that said no. Getting this wrong
// would blank a working coach's own profile screen on a network blip — and,
// because the setters are gated on the same answer, silently drop the edits
// they went on typing into it.
ok(read({ trainerRow: 'unknown' }) === 'ok',
   'an unreadable trainers row does not demote a coach on the coach build');

// The whole bug, in one line: this is the client app, and it must not matter
// that somebody is signed in and every read succeeded.
ok(read({ variant: 'client' }) === 'wrong-app', 'the client build may never read this profile');
ok(read({ variant: 'owner' }) === 'wrong-app', 'nor may the owner build');

/* ── the wrong app is decided before anything else ──────────────────────── */

// Ordering matters, not just the set of answers. If 'loading' came first, a
// client screen would sit on a spinner waiting for a value that is never going
// to arrive; if 'signed-out' came first it would invite a sign-in that would
// not help. On the wrong app there is nothing to wait for.
ok(read({ variant: 'client', settled: false }) === 'wrong-app',
   'an unsettled read on the client build is still the wrong app, not loading');
ok(read({ variant: 'client', signedIn: false }) === 'wrong-app',
   'a signed-out client build is still the wrong app, not signed out');
ok(read({ variant: 'client', settled: false, signedIn: false, trainerRow: 'absent' }) === 'wrong-app',
   'no combination of the other three facts turns the wrong app into a real answer');
// The inverse of the blip rule above: on the client app an unreadable row must
// not be forgiven the way it is on the coach app, because there the reader is
// not a coach whatever the read says.
ok(read({ variant: 'client', trainerRow: 'unknown' }) === 'wrong-app',
   'the client build is refused even when the row read is inconclusive');

/* ── only 'ok' lets the loaded values out ───────────────────────────────── */

const ALL: TrainerAccess[] = ['wrong-app', 'loading', 'signed-out', 'not-a-trainer', 'ok'];
const BLOCKED = ALL.filter((a) => a !== 'ok');

ok(ALL.filter(mayReadTrainerProfile).length === 1, 'exactly one access state is readable');
ok(mayReadTrainerProfile('ok'), 'and it is the one that means the profile is really yours');

ok(guardTrainerProfile('ok', LOADED) === LOADED, 'a real trainer sees the row that was loaded');

// The name and the face. These are the two the client app got wrong in a way
// the reader could see and would believe, because both were their own.
ok(BLOCKED.every((a) => guardTrainerProfile(a, LOADED).name === ''),
   'no blocked state hands out a name');
ok(BLOCKED.every((a) => guardTrainerProfile(a, LOADED).photo === null),
   'no blocked state hands out a photo');

// Everything else on the profile goes with them. A tagline or a bio borrowed
// from the reader is the same mistake, just quieter.
ok(BLOCKED.every((a) => {
  const g = guardTrainerProfile(a, LOADED);
  return g.tagline === '' && g.bio === '' && g.offers.length === 0 && g.specialties.length === 0 && g.listed === false;
}), 'no blocked state hands out any other profile field either');

/* ── the fee is null, never zero ────────────────────────────────────────── */

// The single worst value this provider ever produced. "Session rate $0" and "a
// $0 late fee may apply" were both printed to clients deciding whether to
// cancel, and both came from an initial 0 that stood in for "not loaded".
ok(BLOCKED.every((a) => guardTrainerProfile(a, LOADED).sessionFee === null),
   'an unknown session fee is null in every blocked state');
ok(BLOCKED.every((a) => guardTrainerProfile(a, LOADED).sessionFee !== 0),
   'and it is never 0, which is a rate somebody could actually charge');
ok(NO_TRAINER_PROFILE.sessionFee === null, 'the blank profile carries no fee at all');

// 0 has to survive as a real answer, or the null is pointless: a coach who
// genuinely charges nothing must not be reported as having no rate set.
ok(guardTrainerProfile('ok', { ...LOADED, sessionFee: 0 }).sessionFee === 0,
   'a real rate of 0 passes through as 0');

/* ── the blank cannot be edited from under anyone ───────────────────────── */

// It is one shared object handed to every caller on the wrong app, so a screen
// that pushed an offer onto it would be editing what the next screen sees.
const blank = guardTrainerProfile('wrong-app', LOADED);
try { (blank.offers as string[]).push('sneaked in'); } catch { /* frozen, as intended */ }
ok(guardTrainerProfile('wrong-app', LOADED).offers.length === 0,
   'the blank profile cannot be added to');

/* ── the notes ──────────────────────────────────────────────────────────── */

ok(trainerAccessNote('ok') === null, 'a real profile needs no explanation beside it');
ok(!!trainerAccessNote('loading'), 'a coach waiting on the read is told so');
ok(!!trainerAccessNote('signed-out'), 'a signed-out coach is told to sign in');
ok(!!trainerAccessNote('not-a-trainer'), 'an account with no trainer row is told why it is empty');

// Deliberately null. There is no wording that makes a coach-profile panel on
// the client app correct, and offering one would make the wrong thing look
// finished — that screen needs a different source, not better copy.
ok(trainerAccessNote('wrong-app') === null, 'the wrong app is given no reassuring sentence');

ok(new Set(BLOCKED.map(trainerAccessNote)).size === BLOCKED.length,
   'each blocked state says something different, so the reason is never guessed at');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'TRAINERPROFILEACCESS FAILURES:\n' + errors.join('\n') : 'ALL TRAINERPROFILEACCESS TESTS PASSED');
if (errors.length) process.exit(1);
