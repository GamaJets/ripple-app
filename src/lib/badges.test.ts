// Badges: what is earned, what is merely unknown, and what may be announced.
//
// Two failure modes matter more than everything else here and both are about
// telling a member something untrue about their own record:
//
//   1. A FAILED READ REVOKES TWELVE BADGES. Under 'error' the workout log is
//      empty, every threshold evaluates false, and a screen that renders that
//      as "Locked" tells somebody with a year of training to log their first
//      workout. `badgeState` takes the read's wholeness for exactly this.
//   2. A CALISTHENICS MEMBER EARNS NOTHING. A bodyweight set stores a blank
//      load, and volume and PRs computed off the raw weight column count every
//      pull-up as zero — so four of the twelve badges could never unlock.
//
// `ok`/`eq` into an errors array and process.exit(1) — never node:assert.
import {
  BADGES, BADGE_COUNT, badgeAnnouncement, badgeByKey, badgeFigures, badgeMet,
  badgeState, earnedKeys, newlyEarned, type BadgeKey,
} from './badges';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}T10:00:00.000Z`;
const entry = (over: Partial<WorkoutEntry> & { t: string }): WorkoutEntry => ({
  id: over.t + (over.exercise ?? ''),
  exercise: 'Bench Press',
  sets: [[10, 60]],
  ...over,
} as WorkoutEntry);

const zero = badgeFigures([]);

// ── the catalogue itself ─────────────────────────────────────────────────
{
  eq(BADGE_COUNT, BADGES.length, 'the count is the list, not a literal beside it');
  const keys = BADGES.map((b) => b.key);
  eq(new Set(keys).size, keys.length, 'every key is unique — a duplicate silently merges two badges into one');
  for (const b of BADGES) {
    ok(b.title === b.title.trim() && b.title.length > 0, `${b.key} has a name`);
    // Title Case on the name, sentence case on the prose. The house rule, and
    // both of these are read side by side.
    ok(/^[A-Z]/.test(b.title), `${b.key}'s name is Title Case — it is a label, not prose`);
    ok(b.cheer.endsWith('.'), `${b.key}'s cheer is a sentence and ends in one — it stands alone in a notification`);
    eq(badgeByKey(b.key)!.key, b.key, `${b.key} is findable by key`);
  }
  eq(badgeByKey('not-a-badge'), null, 'and an unknown key is null rather than the first badge in the list');
}

// ── nothing logged earns nothing ─────────────────────────────────────────
{
  eq(earnedKeys(zero).length, 0, 'an empty log earns no badges');
  for (const b of BADGES) eq(badgeMet(b.key, zero), false, `${b.key} is not met by nothing`);
}

// ── the read-status gate, which is assertion 1 ───────────────────────────
{
  // A member with a year of training whose log could not be read looks exactly
  // like a member with no training. The figures cannot tell them apart; the
  // wholeness of the read can, and that is the entire reason it is a parameter.
  eq(badgeState('fifty-club', zero, true), 'locked',
    'a WHOLE read with nothing in it is a statement about the member: locked');
  eq(badgeState('fifty-club', zero, false), 'unknown',
    'AN INCOMPLETE READ IS NOT — "locked" there revokes a badge somebody already has');
  // Earned survives both, because every threshold under-counts and never over-
  // counts: fifty sessions found in a truncated read really are fifty sessions.
  const many = badgeFigures(Array.from({ length: 50 }, (_, i) => entry({ t: day((i % 28) + 1) + `#${i}` })));
  eq(badgeState('fifty-club', many, true), 'earned', 'fifty sessions is fifty sessions');
  eq(badgeState('fifty-club', many, false), 'earned',
    'and it stays earned on a partial read, because the count can only be short');
}

// ── the bodyweight gap, which is assertion 2 ─────────────────────────────
//
// `bw: [true]` marks a set as the member's own bodyweight. Without the weight
// history, `setLoadKg` has no mass to resolve it to and the set is worth
// nothing — which is the behaviour being fixed, so it is asserted in both
// directions rather than only in the good one.
{
  const pullups = Array.from({ length: 5 }, (_, i) => entry({
    t: day(i + 1), exercise: 'Pull-Up', sets: [[10, 0], [10, 0], [10, 0]], bw: [true, true, true],
  } as Partial<WorkoutEntry> & { t: string }));
  const history = [{ t: day(1), v: 80 }];

  const blind = badgeFigures(pullups);
  eq(blind.totalVolumeKg, 0, 'with no weight history a bodyweight set resolves to nothing');
  eq(blind.prCount, 0, 'and sets no record');

  const seeing = badgeFigures(pullups, history);
  ok(seeing.totalVolumeKg >= 1000,
    `A CALISTHENICS MEMBER MUST EARN ONE TONNE — 150 pull-ups at 80 kg is 12,000 kg, got ${seeing.totalVolumeKg}`);
  ok(seeing.prCount >= 1, 'and must be able to set a personal record');
  ok(earnedKeys(seeing).includes('one-tonne'), 'so One Tonne unlocks');
  ok(earnedKeys(seeing).includes('record-breaker'), 'and Record Breaker unlocks');
  ok(!earnedKeys(blind).includes('one-tonne'), 'neither of which happens without the history — this is the gap being closed');
}

// ── a failed SCANS read must not print as the member's shortfall ─────────
//
// The screen has two reads, not one. With a whole training log and a refused
// scans read, the caller passes an empty history, every bodyweight set is
// unpriced, and One Tonne, Ten Tonnes, Record Breaker and PR Machine all fall
// under their thresholds. `whole` was true, so all four rendered "Locked" —
// our failed read stated as a fact about the member, which is precisely what
// the three-valued return exists to prevent.
{
  const pullups = Array.from({ length: 5 }, (_, i) => entry({
    t: day(i + 1), exercise: 'Pull-Up', sets: [[10, 0], [10, 0], [10, 0]], bw: [true, true, true],
  } as Partial<WorkoutEntry> & { t: string }));
  const blind = badgeFigures(pullups);

  ok(blind.unpricedBodyweightSets > 0, 'the unpriced sets are counted, not just dropped');

  for (const k of ['one-tonne', 'ten-tonnes', 'record-breaker', 'pr-machine'] as BadgeKey[]) {
    eq(badgeState(k, blind, true, false), 'unknown',
      `${k} is unknown while the weight history could not be read, not locked`);
    eq(badgeState(k, blind, true, true), 'locked',
      `${k} is a statement about the member only once BOTH reads are whole`);
  }
  // The badges that are counted rather than weighed are unaffected: a failed
  // scans read tells us nothing new about how many sessions somebody logged.
  eq(badgeState('fifty-club', blind, true, false), 'locked',
    'a session count owes nothing to the weight history');
  eq(badgeState('first-rep', blind, true, false), 'earned', 'and an earned badge stays earned');

  // And where there is nothing to be missing, "Locked" stays honest: a member
  // with no bodyweight sets loses nothing to a failed scans read.
  const barbell = badgeFigures([entry({ t: day(1) })]);
  eq(barbell.unpricedBodyweightSets, 0, 'a barbell log has no unpriced bodyweight sets');
  eq(badgeState('one-tonne', barbell, true, false), 'locked',
    'so One Tonne is still locked rather than hedged into nothing');

  // The default keeps every existing caller where it was.
  eq(badgeState('one-tonne', blind, true), badgeState('one-tonne', blind, true, true),
    'omitting the second read means there is no second read to be missing');
}

// ── what counts as new ───────────────────────────────────────────────────
{
  const now: BadgeKey[] = ['first-rep', 'ten-sessions', 'fifty-club'];
  eq(newlyEarned(now, []).join(','), 'first-rep,ten-sessions,fifty-club',
    'everything is new against an empty seen-set');
  eq(newlyEarned(now, ['first-rep']).join(','), 'ten-sessions,fifty-club', 'and what was already told is not');
  eq(newlyEarned(now, now).length, 0, 'nothing new when nothing changed');
  // Order is not incidental: the caller takes the LAST as the headline, so
  // somebody whose fiftieth session unlocks both is congratulated on Fifty
  // Club rather than on Ten Sessions.
  const fresh = newlyEarned(now, ['first-rep']);
  eq(fresh[fresh.length - 1], 'fifty-club',
    'the furthest-along badge comes last, because that is the one the celebration names');
  // A badge that disappears is ignored. That can only happen when the log
  // shrank, and taking a badge back is worse than letting a stale one stand.
  eq(newlyEarned(['first-rep'], ['first-rep', 'fifty-club']).length, 0,
    'A BADGE THAT VANISHED IS NEVER UN-ANNOUNCED, and never re-announced either');
}

// ── the announcement ─────────────────────────────────────────────────────
{
  const one = badgeAnnouncement('fifty-club', 0)!;
  ok(one.title.includes('Fifty Club'), 'the banner names the badge');
  ok(!/\d+ more/.test(one.body), 'and says nothing about others when there are none');
  const many = badgeAnnouncement('fifty-club', 2)!;
  ok(/2 more badges/.test(many.body),
    'when several land together the others are COUNTED rather than sent as more banners — three banners for one session is how notifications get turned off');
  eq(badgeAnnouncement('ten-sessions', 1)!.body.includes('One more badge'), true, 'and one is singular');
  eq(badgeAnnouncement('nope' as BadgeKey, 0), null, 'an unknown badge announces nothing rather than an empty banner');
}

/* ── a plank is not four and a half thousand repetitions ──────────────────
 *
 * This file's own loop resolved a load and multiplied it by whatever was in the
 * reps column. For a hold that column is SECONDS, so one 45-second plank by an
 * 80 kg member scored 3,600 kg and unlocked One Tonne on its own. A few of them
 * unlocked Ten Tonnes. Badges meant to mark a year of lifting were handed out
 * in a week.
 */
{
  const at = '2026-03-02T10:00:00.000Z';
  const weighed = [{ t: '2026-03-01T00:00:00.000Z', v: 80 }];
  const plank = badgeFigures(
    [{ t: at, exercise: 'Plank', sets: [[45, 0]], timed: [true], bw: [true] } as any],
    weighed,
  );
  eq(plank.totalVolumeKg, 0, 'one plank is not 3,600 kg of lifting');
  ok(!earnedKeys(plank).includes('one-tonne'), 'so a first plank does not unlock One Tonne');
  ok(!earnedKeys(plank).includes('ten-tonnes'), 'and three of them do not unlock Ten Tonnes');
  eq(plank.unpricedBodyweightSets, 0,
    'nor is a hold reported as work we could not price — it is work this total is not about');

  // A weighted hold is the same answer: 45 seconds under a 10 kg plate is not
  // 450 kg either.
  const weighted = badgeFigures(
    [{ t: at, exercise: 'Plank', sets: [[45, 10]], timed: [true] } as any],
    weighed,
  );
  eq(weighted.totalVolumeKg, 0, 'a weighted hold prices at nothing here too');

  // And a real lift beside it still counts for exactly what it is.
  const both = badgeFigures(
    [
      { t: at, exercise: 'Plank', sets: [[60, 20]], timed: [true] } as any,
      { t: at, exercise: 'Squat', sets: [[5, 100]] } as any,
    ],
    weighed,
  );
  eq(both.totalVolumeKg, 500, 'the hold takes nothing from the squat and adds nothing to it');
}


// The exit-on-failure epilogue belongs LAST. It used to sit further up this
// file, and everything appended below it ran with its failures collected into
// `errors` and never read — the suite printed "ok" and exited 0 while real
// assertions were failing. Found in sessionCredits.test.ts and swept for; this
// file was one of three. Append new sections ABOVE this block.
if (errors.length) {
  console.error(`badges.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}

console.log('badges.test.ts — ok');
