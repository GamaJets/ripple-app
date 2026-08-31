// Shaping a challenge and its board. Compile with tsc, run with node.
//
// The bug this guards is the one the feature was BUILT out of. This screen has
// twice told a client something about other people that was not true: first
// with six invented athletes and invented scores, then — after those were
// removed — with a one-person board captioned as though that were the finding.
// Both are the same failure, which is a screen stating a fact it does not have.
//
// So most of what follows pins the sentences to the read's status. A rank is a
// figure over a SET, and it is the single most dangerous figure in this app to
// get wrong: "you're 12th of 40" printed off a truncated read is arithmetic
// over an unknown fraction, and it is arithmetic about other people.
//
// The rest pins the parsing, because PostgREST hands `numeric` back as a STRING
// and every score, goal and place in this feature is numeric. `"4.0"` is not a
// number to a progress meter, and `Number(null)` is 0 — which on a leaderboard
// is a real place, at the bottom.
import {
  BOARD_VISIBILITY_NOTE, SCORING_NOTE, canJoin, challengePhase, cohortLabel,
  defaultUnit, figure, myBoardRow, rankLine, scoreText, shapeBoard,
  shapeChallenges, standingLine, windowLine,
  type BoardRow, type ChallengeRow, type RawBoardRow, type RawChallenge,
} from './challenges';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-31T12:00:00Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

// Exactly the shape my_challenges() answered with, live, on 2026-08-31 —
// numeric columns as strings, booleans as booleans.
const raw = (over: Partial<RawChallenge> = {}): RawChallenge => ({
  id: 'ch-1', title: 'Gym Consistency', blurb: 'Most training days.',
  metric: 'days', unit: 'days', goal: '10',
  starts_at: iso(-14), ends_at: iso(14), time_zone: 'Europe/London',
  icon: 'flame', coach_id: null, joined: false, participants: 3, my_score: '4',
  ...over,
});

const row = (over: Partial<ChallengeRow> = {}): ChallengeRow => ({
  id: 'ch-1', title: 'Gym Consistency', blurb: 'Most training days.',
  metric: 'days', unit: 'days', goal: 10,
  startsAt: NOW - 14 * DAY, endsAt: NOW + 14 * DAY,
  icon: 'flame', cohort: 'gym', joined: false, participants: 3, myScore: 4,
  ...over,
});

const boardRow = (over: Partial<BoardRow> = {}): BoardRow =>
  ({ place: 1, name: 'Ben', score: 6, isMe: false, ...over });

/* ── a numeric arrives as a string, and a blank is not a zero ──────────── */

// The live answer. Nothing downstream survives these staying strings: a meter
// compares them, a sort orders them, and "4.0" fails both silently.
eq(figure('4.0'), 4, 'a numeric column arrives as a string and is parsed');
eq(figure('20'), 20, 'so does a whole-number goal');
eq(figure(6), 6, 'a real number passes through');
eq(figure(0), 0, 'zero is a figure — a score of nothing is an answer');
// The three ways a confident zero used to get invented.
eq(figure(null), null, 'absent is not zero');
eq(figure(''), null, 'blank is not zero, though Number("") is');
eq(figure('nope'), null, 'unparseable is not zero');
eq(figure(Number.NaN), null, 'NaN is not a figure');
eq(figure(Number.POSITIVE_INFINITY), null, 'nor is infinity');

/* ── shaping drops what cannot be drawn honestly ───────────────────────── */

const shaped = shapeChallenges([
  raw(),
  raw({ id: 'ch-2', title: 'Squad Volume', metric: 'volume', unit: 't', goal: '20', coach_id: 'coach-1', my_score: '4.0' }),
]);
eq(shaped.length, 2, 'two good rows shape');
eq(shaped[0].goal, 10, 'the goal is a number, not a string');
eq(shaped[1].myScore, 4, 'so is the score');
eq(shaped[0].cohort, 'gym', 'no coach_id means the cohort is the gym');
eq(shaped[1].cohort, 'roster', 'a coach_id means the cohort is that coach’s athletes');

// Each of these would render as something wrong rather than as nothing.
eq(shapeChallenges([raw({ id: null })]).length, 0, 'no id: the Join button would post nowhere');
eq(shapeChallenges([raw({ id: '   ' })]).length, 0, 'a blank id is no id');
eq(shapeChallenges([raw({ title: '' })]).length, 0, 'no title: an unnamed row on a list');
eq(shapeChallenges([raw({ metric: 'steps' })]).length, 0, 'an unknown metric has no unit and no meter');
eq(shapeChallenges([raw({ metric: null })]).length, 0, 'nor does a missing one');
eq(shapeChallenges([raw({ ends_at: null })]).length, 0, 'no window: the countdown would be a guess');
eq(shapeChallenges([raw({ ends_at: iso(-20) })]).length, 0, 'a window that ends before it starts is not a window');
// A zero goal divides the meter by zero; a negative one can never be reached.
// The database refuses both, and so does this, so a row written by anything
// else cannot reach a progress bar.
eq(shapeChallenges([raw({ goal: '0' })]).length, 0, 'a goal of zero is completed by standing still');
eq(shapeChallenges([raw({ goal: '-5' })]).length, 0, 'a negative goal can never be completed');
eq(shapeChallenges([raw({ goal: null })]).length, 0, 'and a missing goal is not zero either');

// A score that could not be computed stays null and reaches the screen as a
// dash. It must NOT become 0, which on a board is last place.
eq(shapeChallenges([raw({ my_score: null })])[0].myScore, null, 'an uncomputed score is not a zero score');
eq(shapeChallenges([raw({ my_score: '0' })])[0].myScore, 0, 'a genuine zero survives');
eq(shapeChallenges([raw({ participants: null })])[0].participants, 0,
  'an absent head count is treated as none — it is only ever used behind a ready status');
eq(shapeChallenges([raw({ unit: null })])[0].unit, 'days', 'a missing unit falls back to the metric’s own');
eq(shapeChallenges([raw({ unit: null, metric: 'volume' })])[0].unit, 't', 'and volume is tonnes');
eq(shapeChallenges([raw({ unit: null, metric: 'streak' })])[0].unit, 'day streak', 'and a streak is days');
eq(shapeChallenges(null).length, 0, 'a null read shapes to nothing rather than throwing');
eq(shapeChallenges([]).length, 0, 'so does an empty one');

/* ── running first, then upcoming, then done ───────────────────────────── */

const sorted = shapeChallenges([
  raw({ id: 'done', title: 'Finished', starts_at: iso(-20), ends_at: iso(-5) }),
  raw({ id: 'later', title: 'Later', starts_at: iso(3), ends_at: iso(30) }),
  raw({ id: 'soon', title: 'Ends soon', starts_at: iso(-10), ends_at: iso(2) }),
  raw({ id: 'open', title: 'Ends later', starts_at: iso(-10), ends_at: iso(9) }),
]);
eq(sorted.map((c) => c.id).join(','), 'soon,open,later,done',
  'running challenges first, soonest to end at the top; then upcoming; then finished');

/* ── the phase decides whether Join can work at all ────────────────────── */

eq(challengePhase(row(), NOW), 'open', 'inside its window a challenge is open');
eq(challengePhase(row({ startsAt: NOW + DAY, endsAt: NOW + 10 * DAY }), NOW), 'upcoming', 'before it starts');
eq(challengePhase(row({ startsAt: NOW - 10 * DAY, endsAt: NOW - DAY }), NOW), 'finished', 'after it ends');
// The boundaries match `cp_self_join`, which refuses an insert once
// now() >= ends_at. A Join button offered one second late is a button that
// returns a 42501 the client cannot act on.
eq(challengePhase(row({ startsAt: NOW, endsAt: NOW + DAY }), NOW), 'open', 'the first instant is inside');
eq(challengePhase(row({ startsAt: NOW - DAY, endsAt: NOW }), NOW), 'finished', 'the last instant is outside');
eq(canJoin(row({ startsAt: NOW - DAY, endsAt: NOW }), NOW), false, 'a finished challenge cannot be joined');
eq(canJoin(row({ startsAt: NOW + DAY, endsAt: NOW + 2 * DAY }), NOW), true,
  'one that has not started can be — the server allows it and the meter simply reads zero');

/* ── the countdown never counts a day that is not there ────────────────── */

eq(windowLine(row({ endsAt: NOW + 12 * DAY }), NOW), '12 days left', 'whole days left');
// Rounded up while it runs: with eight hours to go, "0 days left" reads as over.
eq(windowLine(row({ endsAt: NOW + DAY / 3 }), NOW), 'Last day', 'the final hours are the last day, not zero days');
eq(windowLine(row({ endsAt: NOW + DAY }), NOW), 'Last day', 'exactly one day left is the last day');
eq(windowLine(row({ startsAt: NOW + 3 * DAY, endsAt: NOW + 30 * DAY }), NOW), 'Starts in 3 days', 'before it starts');
eq(windowLine(row({ startsAt: NOW + DAY / 2, endsAt: NOW + 30 * DAY }), NOW), 'Starts tomorrow', 'starting within a day');
eq(windowLine(row({ startsAt: NOW - 30 * DAY, endsAt: NOW - 2 * DAY }), NOW), 'Finished 2 days ago', 'after it ends');
eq(windowLine(row({ startsAt: NOW - 30 * DAY, endsAt: NOW - DAY }), NOW), 'Finished yesterday', 'yesterday is named');
eq(windowLine(row({ startsAt: NOW - 30 * DAY, endsAt: NOW - DAY / 4 }), NOW), 'Finished today', 'today is named');
ok(!/-/.test(windowLine(row({ endsAt: NOW - 5 * DAY, startsAt: NOW - 30 * DAY }), NOW)),
  'a finished challenge never prints a negative day count');
// House rule: four figures carry a separator. A challenge can be a year long.
ok(/1,200/.test(windowLine(row({ endsAt: NOW + 1200 * DAY }), NOW)),
  'a four-figure day count carries its thousands separator');

/* ── nothing is stated unless the read was whole ───────────────────────── */

// The whole point of this module. Under a failed or truncated read the numbers
// on the row mean nothing, and every sentence the old screen wrote — "you're
// the only athlete here", "#3 of 12" — is a claim about other people.
for (const s of ['error', 'partial', 'loading'] as LoadStatus[]) {
  const line = standingLine(s, row({ joined: true, participants: 12, myScore: 4 }));
  ok(!/\b12\b/.test(line) && !/\b4\b/.test(line), `${s} states no figure — got ${JSON.stringify(line)}`);
  ok(!/only|first one|nobody|alone/i.test(line), `${s} does not claim the board is empty — got ${JSON.stringify(line)}`);
  ok(!/\b0\b/.test(line), `${s} does not print a zero it did not read`);

  const rl = rankLine(s, [boardRow({ isMe: true, place: 3 }), boardRow({ place: 1, name: 'Ben' })]);
  ok(!/#3|\bof 2\b/.test(rl), `${s} states no rank — got ${JSON.stringify(rl)}`);
}

// And under 'ready' the figures are stated, because they are real.
ok(/12/.test(standingLine('ready', row({ joined: true, participants: 12 }))),
  'a completed read says how many are on the board');
ok(/first one in/i.test(standingLine('ready', row({ joined: true, participants: 1 }))),
  'a completed read may say the client is the first one in');
ok(/not joined/.test(standingLine('ready', row({ joined: false }))),
  'a challenge not joined says so rather than reporting a standing');
ok(/4 days/.test(standingLine('ready', row({ joined: false, myScore: 4 }))),
  'and shows what the client’s own log would score, which exposes nobody');
ok(/—/.test(standingLine('ready', row({ joined: false, myScore: null }))),
  'an uncomputed score renders as a dash, not as zero');

const board = shapeBoard([
  { place: 1, display_name: 'Ben', score: '6', is_me: false },
  { place: 2, display_name: 'Ana', score: '4', is_me: true },
  { place: 3, display_name: '  ', score: '2', is_me: false },
]);
eq(board.length, 3, 'three board rows shape');
eq(board[0].score, 6, 'a board score is parsed out of its string');
eq(board[2].name, 'Athlete', 'a blank name renders as Athlete rather than as an empty row');
eq(myBoardRow(board)?.name, 'Ana', 'the client’s own row is findable');
eq(myBoardRow(shapeBoard([{ place: 1, display_name: 'Ben', score: '6', is_me: false }])), null,
  'and is null when the client is not on the page');
ok(/#2 of 3/.test(rankLine('ready', board)), 'a completed read states the rank');

// A row with no place cannot be put in a ranked list; drawing it at zero would
// move everybody below it down one.
const holey: RawBoardRow[] = [
  { place: null, display_name: 'Ghost', score: '9', is_me: false },
  { place: 2, display_name: 'Ana', score: null, is_me: true },
  { place: 1, display_name: 'Ben', score: '6', is_me: false },
];
eq(shapeBoard(holey).length, 1, 'a row with no place or no score is dropped, not zeroed');
eq(shapeBoard(holey)[0].name, 'Ben', 'and the row that survives is the complete one');
eq(shapeBoard(null).length, 0, 'a null board shapes to nothing');

/* ── scores read the way the metric means them ─────────────────────────── */

eq(scoreText('volume', 4), '4.0', 'tonnage keeps its decimal — 4.0 t is a different claim from 4 t');
eq(scoreText('days', 4), '4', 'a day count does not invent one');
eq(scoreText('streak', 14), '14', 'nor does a streak');
eq(scoreText('days', null), '—', 'an unknown score is a dash');
eq(scoreText('volume', 1204.5), '1,204.5', 'a four-figure tonnage carries its separator');
eq(defaultUnit('volume'), 't', 'volume is tonnes');

/* ── the client is told who they are being measured against ────────────── */

eq(cohortLabel(row({ cohort: 'gym' })), 'Everyone at your gym', 'the gym cohort is named');
ok(/coach/i.test(cohortLabel(row({ cohort: 'roster' }))), 'and so is the coach’s roster');

// These two sentences are the client-facing description of what
// challenge_board() actually returns and where the numbers come from. They are
// here rather than in the JSX so that widening the select list in
// supabase/parts/128 fails a test rather than quietly outdating a paragraph.
ok(/first name/i.test(BOARD_VISIBILITY_NOTE), 'the note says a first name is shared');
ok(/score/i.test(BOARD_VISIBILITY_NOTE), 'and that the score is shared');
ok(/surname/i.test(BOARD_VISIBILITY_NOTE) && /photo/i.test(BOARD_VISIBILITY_NOTE),
  'and names what is not — the select list has neither');
ok(/leave/i.test(BOARD_VISIBILITY_NOTE), 'and that leaving takes the client off the board');
ok(/logged workouts/i.test(SCORING_NOTE), 'the scoring note says where a score comes from');
ok(/time zone/i.test(SCORING_NOTE), 'and that everyone’s days are counted the same way');
ok(/type a score/i.test(SCORING_NOTE), 'and that nobody can submit one');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`challenges: ok (${shaped.length} rows shaped, ${board.length} board rows, ${sorted.length} sorted)`);
