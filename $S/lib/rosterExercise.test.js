"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// "Who is stalled on bench across my roster" — the judgement, and the four
// answers it must never collapse into it. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: "stalled" is a word a coach acts
// on. It has to mean one thing — logged in BOTH halves of the window, and the
// heaviest recent set no heavier than the heaviest earlier one — and it must
// never absorb "they have stopped doing it", "there is nothing to compare
// against yet", or "this movement carries no load to compare".
const rosterExercise_1 = require("./rosterExercise");
const exerciseId_1 = require("./exerciseId");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const row = (over) => ({
    clientId: 'c', lastAt: null,
    recentOutings: 0, priorOutings: 0,
    recentTopKg: null, priorTopKg: null,
    recentE1rmKg: null, priorE1rmKg: null,
    ...over,
});
/* ── the six answers, each excluding the next ───────────────────────────── */
eq((0, rosterExercise_1.judgeRosterRow)(row({})).level, 'unseen', 'a client with no outings in the window has not done it — which may be the most important row on this screen and is not stalling');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, recentTopKg: 100 })).level, 'new', 'logged only in the recent half has nothing to compare against, and "stalled" over one data point is a coin toss');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, priorOutings: 3 })).level, 'no-load', 'logged in both halves with no weight anywhere is press-ups, and a tonnage of nothing is not a plateau');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, priorOutings: 3, priorTopKg: 100 })).level, 'no-load', 'and so is a movement whose loads have stopped being recorded');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, priorOutings: 3, recentTopKg: 100, priorTopKg: 100 })).level, 'holding', 'the same top set in both halves is holding — the one this screen is for');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, priorOutings: 3, recentTopKg: 102.5, priorTopKg: 100 })).level, 'climbing', 'a heavier top set is climbing');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 3, priorOutings: 3, recentTopKg: 95, priorTopKg: 100 })).level, 'dropping', 'a lighter one is dropping, which a coach reads differently and often knows the reason for');
// The threshold is ZERO, not a tolerance band. 1.25 kg change plates are the
// finest most gyms carry, so any real increase is far outside a rounding — and
// a tolerance would swallow exactly the 1 kg microload a coach prescribes to a
// stalled client and go on reporting them as stalled.
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 1, priorOutings: 1, recentTopKg: 101, priorTopKg: 100 })).level, 'climbing', 'a single kilogram more is more — a tolerance band would swallow the microload prescribed to fix a stall');
/* ── the figures carried alongside ──────────────────────────────────────── */
const climbing = (0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 2, priorOutings: 2, recentTopKg: 110, priorTopKg: 100, recentE1rmKg: 127.5 }));
eq(climbing.topKg, 110, 'the recent top is carried');
eq(climbing.priorTopKg, 100, 'and the earlier one, so the comparison is readable rather than asserted');
eq(climbing.e1rmKg, 127.5, 'with the estimated maximum, which every screen naming it calls an estimate');
eq(Math.round(climbing.changePct), 10, 'and the change as a number, for deltaLabel to put a sign and an arrow on');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 1, recentTopKg: 100 })).changePct, null, 'a change from nothing is not a percentage, it is a first measurement');
eq((0, rosterExercise_1.judgeRosterRow)(row({ recentOutings: 1, priorOutings: 1, recentTopKg: 100, priorTopKg: 0 })).changePct, null, 'and a change from zero has nothing to be a percentage of');
/* ── the ranking, built from the ROSTER and not from the answer ─────────── */
// THE assertion. A client who has never touched the movement produces no row at
// all, and they are the most interesting person on this screen. Building the
// list from the aggregate's own rows would silently answer only for the people
// who already do the exercise, which is the question nobody asked.
const ranked = (0, rosterExercise_1.rankRosterExercise)(['ann', 'bob', 'cat', 'dan'], [
    { ...row({ clientId: 'bob', recentOutings: 2, priorOutings: 2, recentTopKg: 100, priorTopKg: 100 }), lastAt: '2026-08-30T10:00:00Z' },
    { ...row({ clientId: 'cat', recentOutings: 2, priorOutings: 2, recentTopKg: 110, priorTopKg: 100 }), lastAt: '2026-08-31T10:00:00Z' },
    { ...row({ clientId: 'dan', recentOutings: 2, priorOutings: 2, recentTopKg: 90, priorTopKg: 100 }), lastAt: '2026-08-29T10:00:00Z' },
]);
eq(ranked.length, 4, 'every client on the book is judged, including the one the aggregate had nothing to say about');
eq(ranked.map((c) => c.clientId), ['ann', 'dan', 'bob', 'cat'], 'and the ones a coach must act on lead: not doing it, going backwards, not moving, then going up');
eq(ranked[0].level, 'unseen', 'the client who has not touched it is first');
eq(ranked[3].level, 'climbing', 'and the one going well is last, and still listed rather than hidden');
// Within a band, the person who has not touched it for longest leads.
const sameBand = (0, rosterExercise_1.rankRosterExercise)(['x', 'y'], [
    { ...row({ clientId: 'x', recentOutings: 1, priorOutings: 1, recentTopKg: 80, priorTopKg: 80 }), lastAt: '2026-08-30T10:00:00Z' },
    { ...row({ clientId: 'y', recentOutings: 1, priorOutings: 1, recentTopKg: 80, priorTopKg: 80 }), lastAt: '2026-08-10T10:00:00Z' },
]);
eq(sameBand.map((c) => c.clientId), ['y', 'x'], 'inside a band the stalest goes first');
/* ── the slug rule, which the database now has to agree with ────────────── */
// supabase/parts/178 computes `exercise_slug` in SQL. The two spellings of this
// rule MUST agree or a coach's roster search silently misses the movement they
// searched for, and there is no test that can run the migration from here — so
// the worked examples in that part's header are asserted against the JavaScript
// side, which is the half this repo can check.
eq((0, exerciseId_1.exerciseSlug)('Bench Press'), 'bench-press', 'the slug rule the migration transcribes');
eq((0, exerciseId_1.exerciseSlug)('Bent-Over Row'), 'bent-over-row', 'punctuation collapses to one hyphen');
eq((0, exerciseId_1.exerciseSlug)('Bent-over Row'), 'bent-over-row', 'and case does not matter');
eq((0, exerciseId_1.exerciseSlug)('  Push-up  '), 'push-up', 'surrounding space leaves no leading or trailing hyphen');
eq((0, exerciseId_1.exerciseSlug)('Squat   Jump'), 'squat-jump', 'nor does a run of spaces leave two');
eq((0, exerciseId_1.exerciseSlug)('!!!'), '', 'a name with nothing alphanumeric in it has no slug, and matches nothing');
/* ── the line, and the two reads either of which makes it a lie ─────────── */
const line = (0, rosterExercise_1.rosterExerciseLine)('ready', 'ready', ranked, 'bench press');
ok(/4 clients on your book/.test(line), 'the count is over the whole book');
ok(/2 have not added weight/.test(line), 'holding and dropping are the ones named as not adding weight');
ok(/1 has not logged it at all/.test(line), 'and the person who has stopped is counted separately');
ok(new RegExp(String(rosterExercise_1.ROSTER_WINDOW_DAYS)).test(line), 'with the window it was measured over');
// A coach told "3 of 40 are stalled" off a partial roster acts on a denominator
// that is not their book.
ok(/not about them/i.test((0, rosterExercise_1.rosterExerciseLine)('error', 'ready', ranked, 'bench press')), 'a failed aggregate names the read rather than the clients');
ok(/could not be read in full/i.test((0, rosterExercise_1.rosterExerciseLine)('ready', 'partial', ranked, 'bench press')), 'and a partial roster refuses to say how many of the book this covers');
ok(!/\d+ clients?/.test((0, rosterExercise_1.rosterExerciseLine)('ready', 'partial', ranked, 'bench press')), 'with no count anywhere in that sentence');
eq(rosterExercise_1.ROSTER_SPLIT_DAYS * 2, rosterExercise_1.ROSTER_WINDOW_DAYS, 'the window splits in half, so neither side is given an advantage by being longer');
// Six bands, six headings and six notes, each naming the EVIDENCE rather than
// giving a verdict — so a coach who disagrees knows what to disagree with.
eq(new Set(Object.values(rosterExercise_1.LEVEL_TITLE)).size, 6, 'each band has its own heading');
eq(new Set(Object.values(rosterExercise_1.LEVEL_NOTE)).size, 6, 'and its own sentence');
ok(Object.values(rosterExercise_1.LEVEL_NOTE).every((n) => n === n.toLowerCase() || !/^[A-Z]/.test(n)), 'the notes are prose and are sentence case, not button labels');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('rosterExercise: ok — six answers kept apart, the whole book judged rather than the answer, and no count over a book that did not load');
