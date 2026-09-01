// The badges, and which of them a training log has earned.
//
// ── Why this is a module and not twelve lines inside a screen ─────────────
//
// It was twelve lines inside a screen. `app/(client)/achievements.tsx` built
// the array at render, decided each `earned` inline, and that was the only
// place in the app that knew a badge existed. So nothing happened when one
// unlocked: no notification, no celebration, no share, no row anywhere. A
// member earned Fifty Club on a Tuesday and found out about it whenever they
// next happened to open a screen most of them never open.
//
// Making it a module is what lets something WATCH it. A pure function from a
// log to a set of earned keys can be compared against what was announced last
// time, which is the whole of `src/ui/badgeWatch.tsx` — and it can be tested,
// which twelve lines of JSX-adjacent arithmetic could not be.
//
// ── The rule that governs every threshold here ────────────────────────────
//
// EVERY THRESHOLD IS MONOTONE IN THE LOG. `totalWorkouts >= 50` over a
// truncated read can only under-count, never over-count, and the same is true
// of the longest streak, the PR count and the total volume. That asymmetry is
// the reason `badgeState` below returns three values rather than a boolean:
//
//   'earned'  the threshold is met by what was read. Monotone, so it is met
//             full stop — a badge shown as earned on a partial read is really
//             earned.
//   'locked'  the threshold is not met AND the read was whole, so this is a
//             statement about the member.
//   'unknown' the threshold is not met and the read was not whole. The
//             sessions that would have unlocked it may be the ones that did
//             not come back, and "Locked" here revokes an achievement somebody
//             already has.
//
// The screen has carried that reasoning in a comment for a while and applied it
// by hand with two separate booleans. It is the type now.
import type { WorkoutEntry } from './mockData';
import type { BodyweightHistory } from './bodyweightSets';
import { longestStreak, personalRecords } from './streaks';
import { setLoadKg } from './bodyweightSets';

export type BadgeKey =
  | 'first-rep' | 'on-a-roll' | 'week-warrior' | 'two-weeks' | 'unstoppable'
  | 'ten-sessions' | 'fifty-club' | 'record-breaker' | 'pr-machine'
  | 'cardio-kick' | 'one-tonne' | 'ten-tonnes';

export type BadgeState = 'earned' | 'locked' | 'unknown';

export interface BadgeDef {
  key: BadgeKey;
  /** Title Case — this is a name, and it is the same name everywhere. */
  title: string;
  /**
   * What has to happen, in the member's words.
   *
   * The two volume badges take their description from a function rather than a
   * string, because the THRESHOLD is a fixed mass and the way it is stated is
   * not: a pounds reader chasing "1,000 kg" is being given a target in a unit
   * they do not train in. The titles deliberately do not convert — a badge that
   * renames itself when a setting changes is a different badge.
   */
  desc: string | ((volumeLabel: (kg: number) => string) => string);
  /** What the sentence celebrating it says. Sentence case, ends in a full
   *  stop, because it is prose and stands on its own in a notification. */
  cheer: string;
}

/**
 * The set, in the order the screen lists them, which is roughly the order they
 * are earned in.
 *
 * The `icon` field this list used to carry is gone and stays gone: it held an
 * empty string for every badge after the emoji were stripped, so each tile drew
 * a blank 28px circle.
 */
export const BADGES: readonly BadgeDef[] = [
  { key: 'first-rep', title: 'First Rep', desc: 'Log your first workout', cheer: 'Your first session is on the record. Everything else is built on this one.' },
  { key: 'on-a-roll', title: 'On a Roll', desc: '3-day streak', cheer: 'Three days in a row. That is the hardest part of a habit.' },
  { key: 'week-warrior', title: 'Week Warrior', desc: '7-day streak', cheer: 'Seven days in a row.' },
  { key: 'two-weeks', title: 'Two Weeks Strong', desc: '14-day streak', cheer: 'Two straight weeks of training.' },
  { key: 'unstoppable', title: 'Unstoppable', desc: '30-day streak', cheer: 'Thirty days in a row. Very few people get here.' },
  { key: 'ten-sessions', title: 'Ten Sessions', desc: 'Log 10 workouts', cheer: 'Ten sessions logged.' },
  { key: 'fifty-club', title: 'Fifty Club', desc: 'Log 50 workouts', cheer: 'Fifty sessions logged.' },
  { key: 'record-breaker', title: 'Record Breaker', desc: 'Set a personal record', cheer: 'Your first personal record is on the board.' },
  { key: 'pr-machine', title: 'PR Machine', desc: '5 personal records', cheer: 'Five personal records.' },
  { key: 'cardio-kick', title: 'Cardio Kick', desc: 'Log a cardio session', cheer: 'Cardio is on your record too.' },
  { key: 'one-tonne', title: 'One Tonne', desc: (vol) => `Lift ${vol(1000)} total volume`, cheer: 'You have moved a tonne of total volume.' },
  { key: 'ten-tonnes', title: 'Ten Tonnes', desc: (vol) => `Lift ${vol(10000)} total volume`, cheer: 'Ten tonnes of total volume moved.' },
];

export const BADGE_COUNT = BADGES.length;

/** The figures every threshold is decided from, so they are computed once. */
export interface BadgeFigures {
  totalWorkouts: number;
  longestStreak: number;
  prCount: number;
  hasCardio: boolean;
  /** Kilograms, always. The thresholds are a fixed mass. */
  totalVolumeKg: number;
}

/**
 * The figures out of a log.
 *
 * `history` is the member's weight over time and it is not optional in spirit,
 * only in signature: without it every bodyweight set contributes NOTHING to
 * volume and can never set a PR, so a calisthenics member's whole log reads
 * back as an empty one and the two volume badges and both PR badges stay locked
 * forever. `setLoadKg` is what resolves a bodyweight set to a real load, and
 * this is the second place in the app that has to remember to pass the history
 * to it.
 */
export function badgeFigures(log: readonly WorkoutEntry[], history: BodyweightHistory = []): BadgeFigures {
  let totalVolumeKg = 0;
  for (const e of log) {
    if (!e.sets) continue;
    for (let i = 0; i < e.sets.length; i++) {
      const [reps] = e.sets[i];
      if (!reps) continue;
      const kg = setLoadKg(e, i, e.sets[i], history, e.t);
      if (kg == null || kg <= 0) continue;
      totalVolumeKg += reps * kg;
    }
  }
  return {
    totalWorkouts: log.length,
    longestStreak: longestStreak(log as WorkoutEntry[]),
    prCount: personalRecords(log as WorkoutEntry[], history).length,
    hasCardio: log.some((e) => e.cardio),
    totalVolumeKg,
  };
}

/** Whether one badge's threshold is met by these figures. Monotone in every
 *  input — see the header, which is why 'earned' survives a partial read. */
export function badgeMet(key: BadgeKey, f: BadgeFigures): boolean {
  switch (key) {
    case 'first-rep': return f.totalWorkouts >= 1;
    case 'on-a-roll': return f.longestStreak >= 3;
    case 'week-warrior': return f.longestStreak >= 7;
    case 'two-weeks': return f.longestStreak >= 14;
    case 'unstoppable': return f.longestStreak >= 30;
    case 'ten-sessions': return f.totalWorkouts >= 10;
    case 'fifty-club': return f.totalWorkouts >= 50;
    case 'record-breaker': return f.prCount >= 1;
    case 'pr-machine': return f.prCount >= 5;
    case 'cardio-kick': return f.hasCardio;
    case 'one-tonne': return f.totalVolumeKg >= 1000;
    case 'ten-tonnes': return f.totalVolumeKg >= 10000;
  }
}

/**
 * One badge's state, given how much of the log was actually read.
 *
 * `whole` is `isWhole(logStatus)` from src/ui/loadStatus — true only when the
 * read succeeded AND was not truncated. Passing `true` for a failed read is the
 * bug this signature exists to make visible: under 'error' the log is empty,
 * every threshold evaluates false, and twelve badges render "Locked" to
 * somebody with a year of training.
 */
export function badgeState(key: BadgeKey, f: BadgeFigures, whole: boolean): BadgeState {
  if (badgeMet(key, f)) return 'earned';
  return whole ? 'locked' : 'unknown';
}

/**
 * Which badges are earned, as keys.
 *
 * Safe on a partial read for the reason in the header, and NOT safe on a failed
 * one — a failed read gives an empty log, an empty log earns nothing, and
 * announcing "you lost eleven badges" is not a thing this app may do. Callers
 * that watch for changes must gate on the read having produced something at
 * all; `src/ui/badgeWatch.tsx` is where that gate lives and why.
 */
export function earnedKeys(f: BadgeFigures): BadgeKey[] {
  return BADGES.filter((b) => badgeMet(b.key, f)).map((b) => b.key);
}

/**
 * Badges in `now` that are not in `seen`, in list order.
 *
 * Order matters because it decides which one a single celebration names when
 * several land at once — the last in list order is the furthest along, so
 * `newlyEarned` returns them in list order and the caller takes the last as the
 * headline. Somebody who logs their fiftieth session unlocking both Ten
 * Sessions and Fifty Club should be congratulated on Fifty Club.
 *
 * A badge in `seen` and NOT in `now` is ignored entirely. That can only happen
 * when the log shrank — a deleted session, a truncated read — and revoking a
 * badge somebody was already told about is worse than letting a stale one
 * stand. Nothing here ever un-announces.
 */
export function newlyEarned(now: readonly BadgeKey[], seen: readonly string[]): BadgeKey[] {
  const had = new Set(seen);
  return BADGES.filter((b) => now.includes(b.key) && !had.has(b.key)).map((b) => b.key);
}

/** A badge by key, or null. */
export function badgeByKey(key: string): BadgeDef | null {
  return BADGES.find((b) => b.key === key) ?? null;
}

/**
 * The notification a newly-earned badge produces.
 *
 * `extra` is how many OTHER badges landed at the same moment. It is stated
 * rather than swallowed, because a member who unlocked three and was told about
 * one has been under-told; and it is not a second notification, because three
 * banners for one session is the fastest way to have notifications turned off.
 */
export function badgeAnnouncement(key: BadgeKey, extra: number): { title: string; body: string } | null {
  const b = badgeByKey(key);
  if (!b) return null;
  return {
    // Title Case: this is a name, and it is the badge's own.
    title: `Badge unlocked · ${b.title}`,
    body: extra > 0
      ? `${b.cheer} ${extra === 1 ? 'One more badge' : `${extra} more badges`} unlocked at the same time.`
      : b.cheer,
  };
}
