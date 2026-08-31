// A challenge that other people are also in.
//
// The screen this feeds used to read a hard-coded constant: three challenges
// with `field: []`, a literal `endsInDays`, and a "leaderboard" containing one
// person. Before that it contained six invented athletes with invented scores,
// which shipped to real clients and told them where they stood against people
// who do not exist. Both versions were the same mistake at different volumes —
// the screen was stating a fact it had no source for.
//
// Everything here is now shaped from what `my_challenges()` and
// `challenge_board()` return (supabase/parts/128), and this module's whole job
// is the gap between "the server answered" and "the screen may say so".
//
// ── Why so much of this file is about LoadStatus ───────────────────────────
//
// A leaderboard has a uniquely bad failure mode. An empty board rendered under
// a failed read looks exactly like a board nobody has joined, and the sentence
// a screen writes underneath it — "you're the only athlete here" — is a claim
// about forty other people made on the strength of a dropped connection in a
// gym basement. Worse, a rank is a figure computed over a SET: under 'partial'
// the rows are real and there are more of them than came back, so "#3 of 12" is
// arithmetic over an unknown fraction and is simply wrong. See
// src/ui/loadStatus.ts. Every line-producing function below therefore takes the
// status first and refuses to state a figure unless it is 'ready'.
//
// ── Why PostgREST numbers arrive as strings ────────────────────────────────
//
// `goal`, `my_score` and `score` are `numeric` in Postgres, and PostgREST
// serialises numeric as a JSON STRING — a numeric does not survive
// JSON.parse intact, so it is not risked. `"4.0"` reaching a `<Meter val=…>`
// renders nothing and `"4.0" > 3` is false. Confirmed live: my_challenges()
// answers `{"my_score":"4.0","goal":"20"}`. Everything is parsed through
// `figure()` on the way in, and anything that is not a finite number becomes
// null rather than 0 — a score of zero is a real answer and must not be the
// value a parse failure lands on.
import { num, num1 } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/** The three things a challenge can measure. Mirrors the `challenges_metric_known`
 *  check constraint; a row carrying anything else is dropped rather than drawn,
 *  because the unit and the meter would both be guesses. */
export type ChallengeMetric = 'days' | 'streak' | 'volume';

/** Who the client is being ranked against. `coach_id` on the row decides it:
 *  the database allows exactly one of tenant_id / coach_id to be set. */
export type Cohort = 'gym' | 'roster';

/** Where a challenge is in its own window. */
export type Phase = 'upcoming' | 'open' | 'finished';

/** A row of my_challenges(), as PostgREST hands it back. */
export interface RawChallenge {
  id: string | null;
  title: string | null;
  blurb: string | null;
  metric: string | null;
  unit: string | null;
  goal: number | string | null;
  starts_at: string | null;
  ends_at: string | null;
  time_zone: string | null;
  icon: string | null;
  coach_id: string | null;
  joined: boolean | null;
  participants: number | string | null;
  my_score: number | string | null;
}

/** The same row, once it is safe to render. */
export interface ChallengeRow {
  id: string;
  title: string;
  blurb: string;
  metric: ChallengeMetric;
  unit: string;
  goal: number;
  startsAt: number;
  endsAt: number;
  icon: string;
  cohort: Cohort;
  joined: boolean;
  /** How many people are on the board, including the client if they joined. */
  participants: number;
  /** The client's own score, computed server-side from their own workouts.
   *  Null when the server could not compute one — never silently zero. */
  myScore: number | null;
}

/** A row of challenge_board(). Nothing identifying: a place, a first name, a
 *  score, and whether it is you. There is deliberately no user id here — see
 *  the header of supabase/parts/128-a-cohort-and-a-credit.sql. */
export interface RawBoardRow {
  place: number | string | null;
  display_name: string | null;
  score: number | string | null;
  is_me: boolean | null;
}

export interface BoardRow {
  place: number;
  name: string;
  score: number;
  isMe: boolean;
}

const DAY = 86_400_000;

/**
 * A figure from PostgREST, or null.
 *
 * Number('') and Number(null) are both 0, so a blank and an absent field would
 * otherwise arrive as a confident zero — which on a leaderboard is a real
 * standing, at the bottom. Only a finite number is a figure.
 */
export function figure(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const isMetric = (m: string | null | undefined): m is ChallengeMetric =>
  m === 'days' || m === 'streak' || m === 'volume';

/** The unit shown beside a score when the row does not carry its own. */
export function defaultUnit(metric: ChallengeMetric): string {
  if (metric === 'streak') return 'day streak';
  if (metric === 'volume') return 't';
  return 'days';
}

/**
 * Where a challenge sits relative to `now`, in the same terms the join policy
 * uses. `cp_self_join` refuses an insert once `now() >= ends_at`, so a screen
 * offering a Join button on a finished challenge is offering a button that
 * cannot work — the phase is what stops it being offered.
 */
export function challengePhase(c: ChallengeRow, now: number = Date.now()): Phase {
  if (now < c.startsAt) return 'upcoming';
  if (now >= c.endsAt) return 'finished';
  return 'open';
}

/** Whether joining is possible at all. Mirrors `cp_self_join`. */
export const canJoin = (c: ChallengeRow, now: number = Date.now()): boolean =>
  challengePhase(c, now) !== 'finished';

/**
 * Raw rows → rows worth rendering.
 *
 * A row missing an id, a title, a usable window or a known metric is DROPPED
 * rather than drawn with a placeholder. Every one of those is load-bearing:
 * without an id the Join button posts nowhere, without a window the countdown
 * is a guess, and without a known metric neither the unit nor the meter means
 * anything. A challenge that quietly does not appear is a smaller failure than
 * one that appears wrong.
 *
 * `myScore` is allowed to be null and survives, because "we could not compute
 * your score" is a thing the screen can say and a zero is not.
 */
export function shapeChallenges(rows: RawChallenge[] | null | undefined): ChallengeRow[] {
  const out: ChallengeRow[] = [];
  for (const r of rows || []) {
    const id = (r?.id || '').trim();
    const title = (r?.title || '').trim();
    const metric = r?.metric;
    if (!id || !title || !isMetric(metric)) continue;
    const startsAt = Date.parse(r.starts_at || '');
    const endsAt = Date.parse(r.ends_at || '');
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) continue;
    const goal = figure(r.goal);
    // A goal of zero would divide the meter by zero and a negative one can
    // never be reached. The database refuses both; this refuses them again so
    // that a row written by anything else cannot reach the meter.
    if (goal == null || goal <= 0) continue;
    const participants = figure(r.participants);
    out.push({
      id,
      title,
      blurb: (r.blurb || '').trim(),
      metric,
      unit: (r.unit || '').trim() || defaultUnit(metric),
      goal,
      startsAt,
      endsAt,
      icon: (r.icon || '').trim() || 'trophy',
      cohort: r.coach_id ? 'roster' : 'gym',
      joined: r.joined === true,
      participants: participants != null && participants >= 0 ? Math.round(participants) : 0,
      myScore: figure(r.my_score),
    });
  }
  // Running challenges first and soonest-to-end at the top, because the one
  // ending on Sunday is the one worth acting on today. Then the ones that have
  // not started, soonest first. Then finished ones, most recent first — they
  // are kept on screen for a month (the server drops them after that) because
  // "did I hit it?" is asked after the thing ends, not during.
  const order: Record<Phase, number> = { open: 0, upcoming: 1, finished: 2 };
  const now = Date.now();
  return out.sort((a, b) => {
    const pa = order[challengePhase(a, now)];
    const pb = order[challengePhase(b, now)];
    if (pa !== pb) return pa - pb;
    if (pa === 2) return b.endsAt - a.endsAt;
    if (pa === 1) return a.startsAt - b.startsAt;
    if (a.endsAt !== b.endsAt) return a.endsAt - b.endsAt;
    return a.title.localeCompare(b.title);
  });
}

/** Board rows → rows worth rendering, in the order the server ranked them. */
export function shapeBoard(rows: RawBoardRow[] | null | undefined): BoardRow[] {
  const out: BoardRow[] = [];
  for (const r of rows || []) {
    const place = figure(r?.place);
    const score = figure(r?.score);
    // A row with no place or no score cannot be put in a ranked list at all.
    // Dropping it is honest; drawing it at 0 would move everybody below it.
    if (place == null || score == null) continue;
    out.push({
      place: Math.round(place),
      name: (r.display_name || '').trim() || 'Athlete',
      score,
      isMe: r.is_me === true,
    });
  }
  return out;
}

/** The client's own row on a board they are looking at, if it is in the page. */
export const myBoardRow = (board: BoardRow[]): BoardRow | null =>
  board.find((r) => r.isMe) || null;

/**
 * A score with its unit, for a screen.
 *
 * Tonnage keeps a decimal (4.0 t is a different claim from 4 t after a week of
 * lifting) and day counts do not. Both go through the house formatters so a
 * four-figure tonnage carries its separator like every other figure in the app.
 */
export function scoreText(metric: ChallengeMetric, score: number | null): string {
  if (score == null) return '—';
  return metric === 'volume' ? num1(score) : num(score);
}

/** What the cohort is called on screen. The client is entitled to know who
 *  they are being measured against before they agree to be measured. */
export const cohortLabel = (c: ChallengeRow): string =>
  c.cohort === 'gym' ? 'Everyone at your gym' : 'Your coach’s athletes';

/**
 * How long is left, in the words a person would use.
 *
 * Whole days from `now`, rounded UP while the challenge is running: with eight
 * hours left, "1 day left" is true and "0 days left" reads as over. Once it is
 * over it says so rather than counting negative days.
 */
export function windowLine(c: ChallengeRow, now: number = Date.now()): string {
  const phase = challengePhase(c, now);
  if (phase === 'upcoming') {
    const d = Math.ceil((c.startsAt - now) / DAY);
    return d <= 1 ? 'Starts tomorrow' : `Starts in ${num(d)} days`;
  }
  if (phase === 'finished') {
    const d = Math.floor((now - c.endsAt) / DAY);
    if (d < 1) return 'Finished today';
    return d === 1 ? 'Finished yesterday' : `Finished ${num(d)} days ago`;
  }
  const d = Math.ceil((c.endsAt - now) / DAY);
  return d <= 1 ? 'Last day' : `${num(d)} days left`;
}

/**
 * The line under one challenge in the list.
 *
 * Under anything but 'ready' it states no figure at all — not the score, not
 * the head count, not "nobody has joined". A screen that prints "1 athlete" off
 * a truncated read is telling a member their gym is empty.
 */
export function standingLine(status: LoadStatus, c: ChallengeRow): string {
  if (status === 'loading') return 'Checking where you stand…';
  if (status === 'error') return 'We couldn’t reach the board.';
  if (status === 'partial') return 'Not all of this board could be read.';
  if (!c.joined) {
    return `${scoreText(c.metric, c.myScore)} ${c.unit} so far · not joined`;
  }
  if (c.participants <= 1) {
    return 'You are the first one in. Others appear as they join.';
  }
  return `${num(c.participants)} athletes on this board`;
}

/**
 * The line above the board itself, once it has been fetched.
 *
 * `board` is the whole page of rows, so a rank stated here is a rank within
 * what came back. That is only the true rank when the read was whole, which is
 * why 'partial' says nothing — the server's `place` column is computed over
 * every participant, but "of 12" would be counting the page.
 */
export function rankLine(status: LoadStatus, board: BoardRow[]): string {
  if (status === 'loading') return 'Loading the board…';
  if (status === 'error') return 'The board could not be read.';
  if (status === 'partial') return 'This board is longer than we could read.';
  const me = myBoardRow(board);
  if (!me) return `${num(board.length)} on the board`;
  return `You are #${num(me.place)} of ${num(board.length)}`;
}

/**
 * What the client is agreeing to when they join, in plain words on the screen.
 *
 * A leaderboard shows one person's activity to another, and this is the whole
 * of what it shows. It is written here rather than inline in the JSX so the
 * test can hold it against what `challenge_board()` actually returns: a first
 * name, a score, a place. If somebody widens that select list, this sentence
 * has to change with it, and a sentence in a tested module is harder to leave
 * behind than one in a paragraph of markup.
 */
export const BOARD_VISIBILITY_NOTE =
  'Joining puts your first name and your score on this board for the other '
  + 'athletes in it. Nothing else is shared — not your surname, not your photo, '
  + 'not what you trained. Leave and you come straight off it.';

/** Where the score comes from. Said on screen because a client who thinks a
 *  board is self-reported has no reason to trust their own place on it. */
export const SCORING_NOTE =
  'Scores are counted from logged workouts inside the challenge window, in the '
  + 'gym’s time zone, so everyone’s days line up. Nobody can type a score in.';
