"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCORING_NOTE = exports.BOARD_VISIBILITY_NOTE = exports.cohortLabel = exports.boardTruncated = exports.BOARD_CAP = exports.myBoardRow = exports.canJoin = void 0;
exports.figure = figure;
exports.defaultUnit = defaultUnit;
exports.challengePhase = challengePhase;
exports.shapeChallenges = shapeChallenges;
exports.shapeBoard = shapeBoard;
exports.scoreText = scoreText;
exports.windowLine = windowLine;
exports.standingLine = standingLine;
exports.rankLine = rankLine;
exports.challengeActionsAllowed = challengeActionsAllowed;
exports.staleChallengeNote = staleChallengeNote;
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
const format_1 = require("./format");
const DAY = 86400000;
/**
 * A figure from PostgREST, or null.
 *
 * Number('') and Number(null) are both 0, so a blank and an absent field would
 * otherwise arrive as a confident zero — which on a leaderboard is a real
 * standing, at the bottom. Only a finite number is a figure.
 */
function figure(v) {
    if (v == null)
        return null;
    if (typeof v === 'string' && v.trim() === '')
        return null;
    const n = typeof v === 'string' ? Number(v.trim()) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
const isMetric = (m) => m === 'days' || m === 'streak' || m === 'volume';
/** The unit shown beside a score when the row does not carry its own. */
function defaultUnit(metric) {
    if (metric === 'streak')
        return 'day streak';
    if (metric === 'volume')
        return 't';
    return 'days';
}
/**
 * Where a challenge sits relative to `now`, in the same terms the join policy
 * uses. `cp_self_join` refuses an insert once `now() >= ends_at`, so a screen
 * offering a Join button on a finished challenge is offering a button that
 * cannot work — the phase is what stops it being offered.
 */
function challengePhase(c, now = Date.now()) {
    if (now < c.startsAt)
        return 'upcoming';
    if (now >= c.endsAt)
        return 'finished';
    return 'open';
}
/** Whether joining is possible at all. Mirrors `cp_self_join`. */
const canJoin = (c, now = Date.now()) => challengePhase(c, now) !== 'finished';
exports.canJoin = canJoin;
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
function shapeChallenges(rows, 
// Injectable so the ORDER can be asserted against a fixed instant. It read
// `Date.now()` internally, which made the sort untestable except by building
// a fixture relative to the real clock — and a fixture relative to the real
// clock is a test with a date in it. This one had one: challenges.test.ts
// pinned NOW to 31 Aug and gave a challenge two days to run, so the suite
// went red of its own accord on 2 Sep at noon, halting every suite after it.
// Nobody broke it. Time did. Same fault as `YEARS = 2019..2026`.
now = Date.now()) {
    const out = [];
    for (const r of rows || []) {
        const id = (r?.id || '').trim();
        const title = (r?.title || '').trim();
        const metric = r?.metric;
        if (!id || !title || !isMetric(metric))
            continue;
        const startsAt = Date.parse(r.starts_at || '');
        const endsAt = Date.parse(r.ends_at || '');
        if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)
            continue;
        const goal = figure(r.goal);
        // A goal of zero would divide the meter by zero and a negative one can
        // never be reached. The database refuses both; this refuses them again so
        // that a row written by anything else cannot reach the meter.
        if (goal == null || goal <= 0)
            continue;
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
    const order = { open: 0, upcoming: 1, finished: 2 };
    return out.sort((a, b) => {
        const pa = order[challengePhase(a, now)];
        const pb = order[challengePhase(b, now)];
        if (pa !== pb)
            return pa - pb;
        if (pa === 2)
            return b.endsAt - a.endsAt;
        if (pa === 1)
            return a.startsAt - b.startsAt;
        if (a.endsAt !== b.endsAt)
            return a.endsAt - b.endsAt;
        return a.title.localeCompare(b.title);
    });
}
/** Board rows → rows worth rendering, in the order the server ranked them. */
function shapeBoard(rows) {
    const out = [];
    for (const r of rows || []) {
        const place = figure(r?.place);
        const score = figure(r?.score);
        // A row with no place or no score cannot be put in a ranked list at all.
        // Dropping it is honest; drawing it at 0 would move everybody below it.
        if (place == null || score == null)
            continue;
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
const myBoardRow = (board) => board.find((r) => r.isMe) || null;
exports.myBoardRow = myBoardRow;
/**
 * How many rows `challenge_board()` will ever hand back.
 *
 * ── Why this number is here and not only in the SQL ────────────────────────
 *
 * The function ends `limit 200` (supabase/parts/128-a-cohort-and-a-credit.sql).
 * That is a deliberate product decision — a leaderboard past two hundred names
 * is not a leaderboard — and it is NOT the PostgREST row cap, so nothing in
 * src/lib/rowCap.ts sees it. A gym-wide challenge with four hundred entrants
 * therefore returned two hundred real rows, with no error and no flag, and the
 * provider reported 'ready' over them.
 *
 * What that printed is the reason this constant now exists. `my_challenges()`
 * carries the TRUE head count, so one sheet said both of these at once:
 *
 *     400 athletes on this board          ← standingLine, from head_count
 *     You are #147 of 200                 ← rankLine, counting the page
 *
 * and a member ranked 250th — a member who had joined, and whose score the
 * server had computed — opened the board, could not find themselves on it, and
 * was given no sentence saying why.
 *
 * ── Why `capped()` cannot be used here ────────────────────────────────────
 *
 * src/lib/rowCap.ts detects truncation by asking for one row MORE than it will
 * accept, so a full page and a cut-off one stop looking alike. That probe is
 * not available through this door: the limit lives inside the function, the
 * client's own `.limit()` can only narrow it further, and the server will never
 * answer with 201. So the test is `>= BOARD_CAP` — the same shape
 * src/ui/glucoseData.ts already uses against the PostgREST cap for the same
 * reason.
 *
 * That is deliberately conservative: a challenge with exactly two hundred
 * entrants reports 'partial' and its rank loses a denominator it was entitled
 * to. One board in that exact position saying less than it could is a far
 * smaller wrong than every larger board stating a denominator that is not true.
 */
exports.BOARD_CAP = 200;
/**
 * Whether a board came back at the server's own ceiling, and so is a prefix.
 *
 * Counts the RAW rows the server sent, not the shaped ones. `shapeBoard` drops
 * a row with no place or no score, so a truncated page carrying one unusable
 * row would arrive here as 199 and be waved through as complete — the read was
 * cut off either way, and a row we could not draw does not make the rest of the
 * board the whole of it.
 */
const boardTruncated = (rawRowCount) => rawRowCount >= exports.BOARD_CAP;
exports.boardTruncated = boardTruncated;
/**
 * A score with its unit, for a screen.
 *
 * Tonnage keeps a decimal (4.0 t is a different claim from 4 t after a week of
 * lifting) and day counts do not. Both go through the house formatters so a
 * four-figure tonnage carries its separator like every other figure in the app.
 */
function scoreText(metric, score) {
    if (score == null)
        return '—';
    return metric === 'volume' ? (0, format_1.num1)(score) : (0, format_1.num)(score);
}
/** What the cohort is called on screen. The client is entitled to know who
 *  they are being measured against before they agree to be measured. */
const cohortLabel = (c) => c.cohort === 'gym' ? 'Everyone at your gym' : 'Your coach’s athletes';
exports.cohortLabel = cohortLabel;
/**
 * How long is left, in the words a person would use.
 *
 * Whole days from `now`, rounded UP while the challenge is running: with eight
 * hours left, "1 day left" is true and "0 days left" reads as over. Once it is
 * over it says so rather than counting negative days.
 */
function windowLine(c, now = Date.now()) {
    const phase = challengePhase(c, now);
    if (phase === 'upcoming') {
        const d = Math.ceil((c.startsAt - now) / DAY);
        return d <= 1 ? 'Starts tomorrow' : `Starts in ${(0, format_1.num)(d)} days`;
    }
    if (phase === 'finished') {
        const d = Math.floor((now - c.endsAt) / DAY);
        if (d < 1)
            return 'Finished today';
        return d === 1 ? 'Finished yesterday' : `Finished ${(0, format_1.num)(d)} days ago`;
    }
    const d = Math.ceil((c.endsAt - now) / DAY);
    return d <= 1 ? 'Last day' : `${(0, format_1.num)(d)} days left`;
}
/**
 * The line under one challenge in the list.
 *
 * Under anything but 'ready' it states no figure at all — not the score, not
 * the head count, not "nobody has joined". A screen that prints "1 athlete" off
 * a truncated read is telling a member their gym is empty.
 */
function standingLine(status, c) {
    if (status === 'loading')
        return 'Checking where you stand…';
    if (status === 'error')
        return 'We couldn’t reach the board.';
    if (status === 'partial')
        return 'Not all of this board could be read.';
    if (!c.joined) {
        return `${scoreText(c.metric, c.myScore)} ${c.unit} so far · not joined`;
    }
    if (c.participants <= 1) {
        return 'You are the first one in. Others appear as they join.';
    }
    return `${(0, format_1.num)(c.participants)} athletes on this board`;
}
/**
 * The line above the board itself, once it has been fetched.
 *
 * `board` is the whole page of rows, so a DENOMINATOR stated here is a count of
 * the page. That is only the whole board when the read was whole, which is why
 * "of N" appears under 'ready' and nowhere else.
 *
 * ── the half of 'partial' that is not missing ─────────────────────────────
 *
 * The place itself is a different matter and this line used to throw it away.
 * `challenge_board()` computes `place` with `rank() over (order by score desc)`
 * across every participant BEFORE it applies its own `limit 200`, so a member
 * sitting at #147 of four hundred is told #147 by the server and that number is
 * simply correct — it is the denominator, and only the denominator, that the
 * page cannot supply. Refusing the whole sentence over the wrong half left a
 * member who had joined, and whose score had been computed, with no answer at
 * all to the one question the sheet is for.
 *
 * So under 'partial' the rank is stated bare. And when the member is NOT in the
 * page — the case that has no honest figure anywhere — the line says that in
 * words, rather than leaving them to conclude from an unfamiliar list that the
 * gym has forgotten they entered.
 */
function rankLine(status, board) {
    if (status === 'loading')
        return 'Loading the board…';
    if (status === 'error')
        return 'The board could not be read.';
    const me = (0, exports.myBoardRow)(board);
    if (status === 'partial') {
        return me
            ? `You are #${(0, format_1.num)(me.place)} · this board is longer than we can show`
            : 'This board is longer than we can show, and your place is past the part of it we can see.';
    }
    if (!me)
        return `${(0, format_1.num)(board.length)} on the board`;
    return `You are #${(0, format_1.num)(me.place)} of ${(0, format_1.num)(board.length)}`;
}
/**
 * Whether the Join and Leave controls on a challenge row mean anything.
 *
 * ── The defect this exists for ────────────────────────────────────────────
 *
 * `src/ui/challenges.tsx` keeps the previous list on purpose when a read fails
 * — "Clearing it here would tell a client their gym is running nothing" — which
 * is the right call in a provider. The screen did not finish it: it drew the
 * banner ("We couldn’t check which challenges are running. This is a connection
 * problem, not an empty gym.") and then mapped over every stale row underneath,
 * each with a live Leave control.
 *
 * So the screen says it does not know the state of these challenges, and offers
 * to change that state in the same breath. A member reads the banner, sees a
 * challenge they believe they have already finished, taps Leave, and withdraws
 * from a board whose current standing the app has just said it cannot see.
 *
 * Either the rows carry the caveat or the controls come off. They may not do
 * neither, and the cheapest correct answer is both: the rows stay — they are
 * the last thing that was true and hiding them WOULD say the gym is running
 * nothing — and the controls wait for a read.
 */
function challengeActionsAllowed(status) {
    return status === 'ready';
}
/** Why the controls are not there, or null when they are. One sentence, on the
 *  row, next to where the button was. */
function staleChallengeNote(status) {
    if (status === 'loading')
        return 'Checking this one…';
    if (status === 'error')
        return 'Last read — joining and leaving are off until this can be checked.';
    if (status === 'partial')
        return 'Part of this list came back — joining and leaving are off until all of it does.';
    return null;
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
exports.BOARD_VISIBILITY_NOTE = 'Joining puts your first name and your score on this board for the other '
    + 'athletes in it. Nothing else is shared — not your surname, not your photo, '
    + 'not what you trained. Leave and you come straight off it.';
/** Where the score comes from. Said on screen because a client who thinks a
 *  board is self-reported has no reason to trust their own place on it. */
exports.SCORING_NOTE = 'Scores are counted from logged workouts inside the challenge window, in the '
    + 'gym’s time zone, so everyone’s days line up. Nobody can type a score in.';
