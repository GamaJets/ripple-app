// A figure with no read time on it is read as current.
// Compile with tsc, run with node.
//
// The defect: nineteen of the twenty owner-app screens carried no fetched-at
// stamp, no refresh and no reachability check, so an owner in a basement read
// yesterday's takings in 44pt type with nothing on the page saying when it was
// fetched. The number was not wrong; it was unlabelled, which is worse.
//
//   AGE          how long ago, rounded the safe way
//   ELAPSED      no calendar in it, so no timezone needed to produce it
//   SENTENCE     every combination of (read yet?) × (reachable?)
//   THE GYM'S    the hour on the gym's own wall, added where the gym has said
//   OWN CLOCK    which wall — and omitted, never guessed, where it has not
//   MARK         when the line earns a dot beside it
//   OLDEST       one stamp over several reads is the age of the worst of them
import { agePhrase, fetchedNote, fetchedNeedsMark, isStale, oldestFetch, STALE_MS } from './freshness';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ── AGE ──────────────────────────────────────────────────────────────────
 * Rounded DOWN everywhere. The one direction this may not err in is claiming
 * a figure is older than it is: that sends somebody to refresh a number that
 * was fine, on a screen whose whole job is telling them when to.
 */
{
  eq(agePhrase(0), 'just now', 'a figure read this instant is just now');
  eq(agePhrase(59_999), 'just now', 'under a minute is still just now');
  eq(agePhrase(MIN), '1 minute ago', 'a minute is singular');
  eq(agePhrase(119_999), '1 minute ago', 'one second short of two minutes is one minute, never two');
  eq(agePhrase(2 * MIN), '2 minutes ago', 'and two is plural');
  eq(agePhrase(59 * MIN), '59 minutes ago', 'minutes run to 59');
  eq(agePhrase(HOUR), '1 hour ago', 'then hours, singular at one');
  eq(agePhrase(23 * HOUR + 59 * MIN), '23 hours ago', 'hours run to 23');
  eq(agePhrase(DAY), '1 day ago', 'then days');
  eq(agePhrase(9 * DAY), '9 days ago', 'and keep counting');

  eq(agePhrase(-5000), 'just now',
    'a clock that moved backwards is "just now", never "-1 minutes ago"');
  eq(agePhrase(Number.NaN), 'just now', 'a NaN age does not reach the screen as NaN');
  eq(agePhrase(Number.POSITIVE_INFINITY), 'just now', 'nor does an infinite one');
}

/* ── ELAPSED ──────────────────────────────────────────────────────────────
 * There is no `tenants.timezone`, so any calendar word here would mean the
 * READER's calendar. Elapsed time means the same thing in Kiritimati (UTC+14)
 * and Midway (UTC-11), which is what npm run test:zones checks.
 */
{
  const at = Date.UTC(2026, 8, 1, 23, 30, 0);
  eq(agePhrase(Date.UTC(2026, 8, 2, 0, 30, 0) - at), '1 hour ago',
    'an hour across a UTC midnight is an hour, not "yesterday"');
  eq(fetchedNote(at, Date.UTC(2026, 8, 2, 0, 30, 0), 'online'), 'Read 1 hour ago',
    'and the sentence says the same thing wherever the phone is');
}

/* ── SENTENCE ─────────────────────────────────────────────────────────────
 * Four combinations, four different true sentences. The one that did not
 * exist anywhere in the owner app is read-and-offline.
 */
{
  eq(fetchedNote(null, 1_000_000, 'online'), 'Reading…',
    'nothing read yet, and we can reach the server: still reading');
  eq(fetchedNote(null, 1_000_000, 'unknown'), 'Reading…',
    'an unknown connection does not change what is true — nothing has been read');
  ok(fetchedNote(null, 1_000_000, 'offline').includes('cannot reach us'),
    'nothing read and no signal says both halves');
  ok(!fetchedNote(null, 1_000_000, 'offline').includes('Reading'),
    'and does not claim a read is in flight when nothing can be');

  const at = 1_000_000;
  eq(fetchedNote(at, at + 3 * MIN, 'online'), 'Read 3 minutes ago',
    'reachable: just when');
  eq(fetchedNote(at, at + 3 * MIN, 'unknown'), 'Read 3 minutes ago',
    'unknown reach makes no claim about the connection either way');
  ok(fetchedNote(at, at + 3 * MIN, 'unknown').indexOf('ffline') === -1,
    'in particular it must not say offline');

  const off = fetchedNote(at, at + 3 * MIN, 'offline');
  ok(off.includes('Offline'), 'offline with figures on screen says so');
  ok(off.includes('3 minutes ago'), 'and still says when they were read');
  ok(off.includes('Nothing here will change until there is signal'),
    'and says the figures are frozen — the sentence the basement gym needed');

  eq(fetchedNote(at, at - 5 * MIN, 'online'), 'Read just now',
    'a backwards clock does not produce a negative duration on screen');
}

/* ── THE GYM'S OWN CLOCK ──────────────────────────────────────────────────
 * `tenants.timezone` exists as of supabase/parts/710, so the sentence can now
 * carry the hour the clock ON THE GYM'S WALL said — which is the only thing an
 * owner standing at that wall can check the figure against. Asserted as an
 * ADDITION: every sentence above has to survive unchanged, because a screen
 * that has not been given a zone is every screen today.
 */
{
  // 22:07 UTC. Three gyms, three different clocks, one instant — and none of
  // them is the clock of the machine this test is running on, which is the
  // whole point and is why `npm run test:zones` sweeps six of those.
  const readAt = Date.UTC(2026, 5, 15, 22, 7, 0);
  const now = readAt + 3 * MIN;

  eq(fetchedNote(readAt, now, 'online'), 'Read 3 minutes ago',
    'no zone: exactly the sentence that was there before, with no hour invented from the reader’s phone');
  eq(fetchedNote(readAt, now, 'online', null), 'Read 3 minutes ago',
    'and an explicit null is the same as saying nothing');
  eq(fetchedNote(readAt, now, 'online', 'Europe/Londn'), 'Read 3 minutes ago',
    'and a zone this runtime cannot resolve adds nothing rather than an hour it had to guess at');

  eq(fetchedNote(readAt, now, 'online', 'Asia/Dubai'), 'Read 3 minutes ago, at 02:07 at the gym',
    'with a zone, the gym’s own wall clock is on the end');
  eq(fetchedNote(readAt, now, 'online', 'Europe/London'), 'Read 3 minutes ago, at 23:07 at the gym',
    'and it is that gym’s hour, summer time included, not this machine’s');
  eq(fetchedNote(readAt, now, 'online', 'America/Los_Angeles'), 'Read 3 minutes ago, at 15:07 at the gym',
    'and the same instant is a different hour again on the other side of it');

  const off = fetchedNote(readAt, now, 'offline', 'Asia/Dubai');
  ok(off.includes('Offline') && off.includes('02:07 at the gym'),
    'the offline sentence carries it too, and still says the figures are frozen');
  ok(off.includes('Nothing here will change until there is signal'),
    'in that order — the clock is an aside, the freeze is the warning');

  eq(fetchedNote(null, now, 'online', 'Asia/Dubai'), 'Reading…',
    'and a screen that has read nothing has no hour to state, zone or no zone');
}

/* ── MARK ─────────────────────────────────────────────────────────────────
 * A dot beside the line, never a coloured sentence — src/theme/scale.ts
 * reserves the status colours for marks. This decides whether there is one.
 */
{
  const at = 1_000_000;
  eq(isStale(null, at + DAY), false,
    'never read is NOT stale — it has its own sentence and must not be accused of holding an old figure');
  eq(isStale(at, at + STALE_MS - 1), false, 'just inside the window is fresh');
  eq(isStale(at, at + STALE_MS), true, 'on the boundary it is stale');
  eq(isStale(at, at + 60 * MIN), true, 'and well past it, obviously');
  eq(isStale(at, at + 30 * MIN, 60 * MIN), false, 'the window is the caller’s to widen');

  eq(fetchedNeedsMark(at, at + MIN, 'online'), false, 'a fresh figure on a reachable phone is unmarked');
  eq(fetchedNeedsMark(at, at + MIN, 'offline'), true, 'offline is always marked, however fresh the figure');
  eq(fetchedNeedsMark(at, at + 20 * MIN, 'online'), true, 'and a stale one is marked even when reachable');
  eq(fetchedNeedsMark(null, at, 'unknown'), false, 'a screen that is still loading is not marked as stale');
  eq(fetchedNeedsMark(null, at, 'offline'), true, 'but one that cannot read at all is');
}

/* ── OLDEST ───────────────────────────────────────────────────────────────
 * A screen fed by three providers under one stamp is claiming an age for all
 * three. The claim is only true of the oldest, and a source that has never
 * come back has no age to contribute — so it takes the whole thing back to
 * "not read yet" rather than letting two fresh reads speak for a third that
 * never happened.
 */
{
  const at = Date.parse('2026-09-01T09:00:00Z');

  eq(oldestFetch(at), at, 'one source is its own age');
  eq(oldestFetch(at, at + MIN), at, 'two sources take the older');
  eq(oldestFetch(at + MIN, at), at, 'and the order they arrive in does not matter');
  eq(oldestFetch(at + HOUR, at + MIN, at), at, 'three sources take the oldest of the three');

  eq(oldestFetch(null), null, 'a source that has never come back has no age');
  eq(oldestFetch(at, null), null,
    'and one unread source makes the whole stamp unread — a fresh figure beside one that was never read must not be labelled fresh');
  eq(oldestFetch(null, at), null, 'whichever side the hole is on');
  eq(oldestFetch(), null, 'no sources at all is nothing to be the age of');

  // The sentence the stamp is for, end to end.
  eq(fetchedNote(oldestFetch(at, at + 20 * MIN), at + 20 * MIN, 'online'),
    'Read 20 minutes ago',
    'the line reports the age of the older read, not of the refresh that just landed beside it');
  eq(fetchedNeedsMark(oldestFetch(at, at + 20 * MIN), at + 20 * MIN, 'online'), true,
    'and it earns its mark on the older read, which a newest-wins stamp would have hidden');
}


if (errors.length) {
  console.error(`freshness: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('freshness: all assertions passed');
