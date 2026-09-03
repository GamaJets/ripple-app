"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The day sheet's two missing answers, asserted without a device.
//
// Both of the things this module decides are decisions a coach acts on thirty
// seconds before a session starts, and both of them have a wrong answer that
// looks exactly like a right one:
//
//   · a tap that leads nowhere. A booked hour whose client the roster could not
//     name still carries an id, so a screen that routes on the id alone opens a
//     blank record — which a coach reads as the app having lost the client, not
//     as a read that did not land.
//   · a rest day that is not a rest day. Three of the six states below mean
//     "nothing is scheduled" for three different reasons, and only one of them
//     may be drawn as a day off. The other two are an unread connection and an
//     empty programme, and a coach shown a rest day for either trains around a
//     plan that was never written or was never read.
//
// So the assertions are mostly about the states that must NOT collapse into
// each other. Compile with tsc, run with node.
const daySession_1 = require("./daySession");
const programBlock_1 = require("./programBlock");
const dayPlan_1 = require("./dayPlan");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const STATUSES = ['loading', 'ready', 'partial', 'error'];
/* ══ 1 · whose hour is this ═══════════════════════════════════════════════ */
const roster = [
    { id: 'ana', name: 'Ana Ruiz' },
    // On the book, resolvable, and the row carries no name. Not the same client
    // as the one the roster never returned, and not refused.
    { id: 'blank', name: '   ' },
];
/* ── the two that open ─────────────────────────────────────────────────── */
{
    const tap = (0, daySession_1.clientTap)('ana', roster, 'ready');
    eq(tap, { can: true, clientId: 'ana', name: 'Ana Ruiz', why: null, who: 'named' }, 'a named client on the roster opens, with their name to pass as a title');
    ok((0, daySession_1.clientTapLabel)(tap).includes('Ana Ruiz'), 'and the spoken label names them');
    ok(/record/.test((0, daySession_1.clientTapLabel)(tap)) && /planned/.test((0, daySession_1.clientTapLabel)(tap)), 'and says both things the tap does, because it does two');
}
{
    const tap = (0, daySession_1.clientTap)('blank', roster, 'ready');
    eq(tap.can, true, 'a client on the roster whose row has no name still opens');
    eq(tap.clientId, 'blank', 'and routes on their real id');
    eq(tap.name, null, 'and passes NO name rather than a blank one, which the record would print as a title');
    eq(tap.who, 'unnamed', 'the reading is carried so the screen can branch on the fact');
    ok(!/undefined|null/.test((0, daySession_1.clientTapLabel)(tap)), 'and the spoken label stands on its own without a name in it');
}
/* ── the two that do not ───────────────────────────────────────────────── */
{
    const tap = (0, daySession_1.clientTap)(null, roster, 'ready');
    eq(tap.who, 'open', 'an empty hour is open');
    eq(tap.can, false, 'and there is no record behind it to open');
    ok(tap.why !== null && /no record/i.test(tap.why), 'and it says so rather than doing nothing');
}
{
    // The whole book came back and this id is not in it. They have left.
    const gone = (0, daySession_1.clientTap)('ghost', roster, 'ready');
    eq(gone.who, 'unread', 'a booked hour whose client is not on a complete roster is unread');
    eq(gone.can, false, 'and is not a button');
    ok(gone.why !== null && /no longer on your book/i.test(gone.why), 'and says they have left, which is not something a refresh fixes');
    ok(gone.why !== null && !/refresh|load/i.test(gone.why), 'so it does not send the coach round a loop that cannot end');
}
for (const status of STATUSES.filter((s) => s !== 'ready')) {
    // The identical row under a roster that is short for reasons that have
    // nothing to do with the client. Saying "they have left your book" here is a
    // claim about a person, made from a failed read.
    const tap = (0, daySession_1.clientTap)('ana', [], status);
    eq(tap.who, 'unread', `a roster that is not whole cannot name anybody (${status})`);
    eq(tap.can, false, `and the tap is refused rather than opening a blank record (${status})`);
    ok(tap.why !== null && /until your roster loads/i.test(tap.why), `and the refusal is about the read, not about the client (${status})`);
}
/* ── no caller can route past a refusal ────────────────────────────────── */
//
// `can` is the flag, but a screen that reached for `clientId` directly would
// route on an id that resolves to nothing. Every refusal carries a null.
for (const status of STATUSES) {
    for (const id of [null, undefined, '', 'ghost']) {
        const tap = (0, daySession_1.clientTap)(id, roster, status);
        if (!tap.can) {
            eq(tap.clientId, null, `a refused tap carries no id to route with (${String(id)}, ${status})`);
            eq(tap.name, null, `and no name to print (${String(id)}, ${status})`);
            ok(tap.why !== null, `and always says why (${String(id)}, ${status})`);
        }
    }
    // And the reverse: an offered tap always carries the id and never a
    // description standing in for a name.
    for (const id of ['ana', 'blank']) {
        const tap = (0, daySession_1.clientTap)(id, roster, status);
        if (tap.can) {
            eq(tap.clientId, id, `an offered tap routes on the real id (${id}, ${status})`);
            ok(tap.name === null || tap.name === 'Ana Ruiz', `and its name is a name or nothing, never a noun phrase (${id}, ${status})`);
            eq(tap.why, null, `and an offered tap has nothing to refuse (${id}, ${status})`);
        }
    }
}
/* ══ 2 · what they are due to train in it ═════════════════════════════════ */
const ex = (name) => ({ key: name.toLowerCase(), name, group: 'full', sets: 3, reps: '8', alternatives: [] });
const day = (d, focus, n, cardio) => ({ day: d, focus, exercises: Array.from({ length: n }, (_, i) => ex(`Lift ${i + 1}`)), ...(cardio ? { cardio } : {}) });
const one = (days) => ({ title: 'A programme', focus: [], note: '', days });
/** A block of `n` weeks whose Monday session names its own week, so the join
 *  from a date to a week to a day can be walked rather than trusted. */
const block = (n) => (0, programBlock_1.withWeeks)(one([day('Mon', 'Push 1', 3)]), Array.from({ length: n }, (_, i) => ({ days: [day('Mon', `Push ${i + 1}`, i + 1)] })));
// Mondays of an eight-week block that starts on a Monday, so the week number
// and the weekday are both unambiguous.
const W1 = '2026-09-07', W2 = '2026-09-14', W5 = '2026-10-05';
/* ── undated ───────────────────────────────────────────────────────────── */
{
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, 'the 7th', 'ready', 'Ana');
    eq(d.state, 'undated', 'a date that cannot be read is its own answer');
    eq(d.day, null, 'and yields no plan');
    eq(d.exercises, null, 'and no count — an unknown is not a zero');
    eq((0, daySession_1.dayTrainingCaveat)(d), null, 'and needs no caveat, because its own line already says it');
}
/* ── the three ways to have nothing, kept apart ────────────────────────── */
{
    const d = (0, daySession_1.trainingOnDay)(null, null, W1, 'ready', 'Ana');
    eq(d.state, 'unassigned', 'a null programme under a whole read is a client with no programme');
    eq(d.confirmed, true, 'which is a confirmed answer');
    eq((0, daySession_1.dayPlanUnread)(d), false, 'and is ordinary rather than a problem to solve');
    ok(/no programme from you/i.test(d.line), 'and the line says whose omission it is');
}
for (const status of STATUSES.filter((s) => s !== 'ready')) {
    // THE assertion this module exists for. `useAssignedPrograms` hands back the
    // same null for "nothing assigned" and "the read did not land", and only one
    // of those may reach a coach as a fact about their client.
    const d = (0, daySession_1.trainingOnDay)(null, null, W1, status, 'Ana');
    eq(d.state, 'unreadable', `a null programme under ${status} is UNKNOWN, not unassigned`);
    ok(d.state !== 'rest', `and is never a rest day (${status})`);
    ok(/not a rest day/i.test(d.line), `and says so in words (${status})`);
    eq(d.day, null, `with no plan behind it (${status})`);
    eq((0, daySession_1.dayPlanUnread)(d), true, `and is the one a coach must not walk past (${status})`);
    eq((0, daySession_1.dayTrainingCaveat)(d), null, `its line is the caveat, so there is no second one (${status})`);
    ok((0, daySession_1.dayPlanHeading)(d) !== (0, daySession_1.dayPlanHeading)((0, daySession_1.trainingOnDay)(null, null, W1, 'ready', 'Ana')), `and it does not share a heading with "no programme assigned" (${status})`);
}
{
    // The regression. `programWeeks` never returns an empty list for a programme
    // that exists — a programme with no `weeks` IS one week, and that week is
    // `days` — so a guard on the list's length could not fire, and an assigned
    // programme with nothing in it was answered with the rest-day sentence.
    const d = (0, daySession_1.trainingOnDay)(one([]), null, W1, 'ready', 'Ana');
    eq(d.state, 'unwritten', 'an assigned programme with no days in it is unwritten, not a rest day');
    ok(!/schedules nothing/i.test(d.line), 'and does not borrow the rest day’s sentence');
    ok(/no days written/i.test(d.line), 'it says the programme is empty');
    eq(d.day, null, 'and there is no plan behind it');
    eq((0, daySession_1.dayPlanHeading)(d), 'Programme is empty', 'a one-week programme with no days IS the empty programme');
}
{
    // And the same fact about one week of a block whose other weeks are written.
    const patchy = (0, programBlock_1.withWeeks)(one([day('Mon', 'Push 1', 3)]), [
        { days: [day('Mon', 'Push 1', 3)] },
        { days: [] },
    ]);
    const d = (0, daySession_1.trainingOnDay)(patchy, W1, W2, 'ready', 'Ana');
    eq(d.state, 'unwritten', 'a blank week of a written block is unwritten on every day of it');
    eq(d.weekLabel, 'Week 2', 'and names the week that is blank');
    eq((0, daySession_1.dayPlanHeading)(d), 'Nothing written for that week', 'and does not tell the coach to go and rewrite a programme that is eleven-twelfths written');
}
/* ── the one that may be drawn as a day off ────────────────────────────── */
{
    // Tuesday, on a programme that only has a Monday.
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, '2026-09-08', 'ready', 'Ana');
    eq(d.state, 'rest', 'a written programme that puts nothing on this weekday is a rest day');
    eq(d.weekLabel, null, 'a one-week programme is given no week number');
    eq(d.week && d.week.count, 1, 'because it is one week');
    eq((0, daySession_1.dayPlanUnread)(d), false, 'and a rest day is not a warning');
    eq((0, daySession_1.dayTrainingCaveat)(d), null, 'nor does it carry one under a whole read');
}
/* ── and the one that is a session ─────────────────────────────────────── */
{
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3, '10 min bike')]), null, W1, 'ready', 'Ana');
    eq(d.state, 'session', 'the weekday the coach wrote is a session');
    eq(d.focus, 'Push', 'with the heading they wrote on it');
    eq(d.exercises, 3, 'and the number of exercises actually on it');
    eq(d.cardio, '10 min bike', 'and the cardio line');
    eq(d.day && d.day.focus, 'Push', 'and the day itself, so a screen can draw the exercises');
    ok(d.line.includes('Push') && d.line.includes('3 exercises') && d.line.includes('10 min bike'), 'the one line carries what it is, how much of it there is, and the cardio');
    eq((0, daySession_1.dayPlanHeading)(d), 'Planned for this day', 'and the heading names the day rather than implying today');
}
{
    // A coach who wrote six exercises and no heading has still written a session.
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', '   ', 2)]), null, W1, 'ready', 'Ana');
    eq(d.focus, null, 'a blank focus is null rather than an empty string');
    ok(/A session is planned/.test(d.line), 'and is described rather than left as a hole in the line');
    ok(/2 exercises/.test(d.line), 'with what is actually on it');
}
{
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 1)]), null, W1, 'ready', 'Ana');
    ok(/\b1 exercise\b/.test(d.line) && !/1 exercises/.test(d.line), 'one exercise is not "1 exercises"');
}
{
    // Nothing but cardio. "No exercises written yet" over a written conditioning
    // session reads as an unfinished plan; it is a finished one with no lifts.
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Conditioning', 0, '20 min row')]), null, W1, 'ready', 'Ana');
    eq(d.exercises, 0, 'a day with no lifts on it counts zero');
    ok(/no lifts written/.test(d.line), 'and says lifts, because the session is not empty');
    const bare = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 0)]), null, W1, 'ready', 'Ana');
    ok(/no exercises written yet/.test(bare.line), 'while a day with nothing on it at all says so');
}
/* ── which week: the day on screen, never today ────────────────────────── */
//
// The day sheet is routinely open on a date that is not today, and "what are
// they due to train" on that date is that date's week of the block. Two dates
// against ONE programme and one start date, so nothing but the date can be
// making the difference.
{
    const p = block(8);
    const w1 = (0, daySession_1.trainingOnDay)(p, W1, W1, 'ready', 'Ana');
    const w2 = (0, daySession_1.trainingOnDay)(p, W1, W2, 'ready', 'Ana');
    const w5 = (0, daySession_1.trainingOnDay)(p, W1, W5, 'ready', 'Ana');
    eq(w1.week && w1.week.index, 0, 'the first Monday of the block is week one');
    eq(w2.week && w2.week.index, 1, 'the Monday after it is week two');
    eq(w5.week && w5.week.index, 4, 'and four weeks on is week five');
    // The join walked rather than trusted: the index is only worth anything if
    // it selects the week the coach actually wrote.
    eq(w1.focus, 'Push 1', 'and week one’s session is week one’s');
    eq(w2.focus, 'Push 2', 'week two’s is week two’s');
    eq(w5.focus, 'Push 5', 'and week five’s is week five’s');
    eq(w5.exercises, 5, 'down to the exercises on it');
    eq(w5.weekLabel, 'Week 5', 'the week is named');
    ok(w5.line.includes('Week 5'), 'and named on the row, so the plan cannot be read as this week’s');
    eq(w5.week && w5.week.count, 8, 'out of eight');
}
{
    // No start date is not a missing answer: it is week one, which is what every
    // assignment made before start dates existed has always meant.
    const p = block(4);
    const d = (0, daySession_1.trainingOnDay)(p, null, W5, 'ready', 'Ana');
    eq(d.week && d.week.reason, 'no-date', 'a block with no start date says why it is on week one');
    eq(d.focus, 'Push 1', 'and shows week one rather than nothing');
}
{
    // A block whose last week has passed keeps its last week. An empty day sheet
    // for a coach who is a week late writing the next block is a screen saying
    // their client has no training.
    const p = block(2);
    const d = (0, daySession_1.trainingOnDay)(p, '2026-01-05', W1, 'ready', 'Ana');
    eq(d.week && d.week.reason, 'ended', 'a block that has run out is on its last week');
    eq(d.state, 'session', 'and still resolves to a session');
    eq(d.focus, 'Push 2', 'which is the last week’s');
}
/* ── the weekday is read off the date locally ──────────────────────────── */
//
// `new Date(iso).getDay()` is UTC-parsed for a bare date, which west of
// Greenwich is the day before — asking the programme for Monday's session on a
// Tuesday. Walked across a whole week: exactly one date resolves to the single
// day the programme holds, and it is the one whose LOCAL weekday matches.
{
    const p = one([day('Thu', 'Pull', 4)]);
    const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
    const hit = week.filter((iso) => (0, daySession_1.trainingOnDay)(p, null, iso, 'ready', 'Ana').state === 'session');
    eq(hit.length, 1, 'a programme with one day in it trains on exactly one day of the week');
    eq((0, dayPlan_1.weekdayOfIso)(hit[0]), 4, 'and that day is the Thursday the coach wrote, read as a local date');
    for (const iso of week) {
        const d = (0, daySession_1.trainingOnDay)(p, null, iso, 'ready', 'Ana');
        ok(d.state === 'session' || d.state === 'rest', `and every other day of it is an ordinary rest day (${iso})`);
    }
}
/* ── confirmed is a caveat on a true answer, not a different answer ────── */
//
// `useAssignedPrograms` keeps what it last held when a read fails. The
// programme in hand is a real programme; it is simply not known to be the
// newest one. Folding that into the state would cost the day its plan every
// time the connection dropped, which is precisely when a coach is standing in
// a basement looking at it.
{
    const p = one([day('Mon', 'Push', 3)]);
    const good = (0, daySession_1.trainingOnDay)(p, null, W1, 'ready', 'Ana');
    const stale = (0, daySession_1.trainingOnDay)(p, null, W1, 'error', 'Ana');
    eq(stale.state, 'session', 'a programme in hand under a failed read still resolves');
    eq(stale.focus, good.focus, 'to the same session');
    eq(stale.line, good.line, 'and the same line');
    eq(stale.confirmed, false, 'on a separate axis that says it is not confirmed current');
    eq(good.confirmed, true, 'while a whole read is');
    const caveat = (0, daySession_1.dayTrainingCaveat)(stale);
    ok(caveat !== null && /last plan this phone had/i.test(caveat), 'and the caveat is its own sentence, about the connection rather than the training');
    eq((0, daySession_1.dayTrainingCaveat)(good), null, 'with nothing to add under a whole read');
    eq((0, daySession_1.dayPlanUnread)(stale), true, 'an unconfirmed plan carries the mark');
    eq((0, daySession_1.dayPlanUnread)(good), false, 'and a confirmed one does not');
}
{
    // 'partial' is not 'ready' here either: a truncated assignments read may have
    // dropped this client's row, so the programme in hand is not known to be the
    // whole answer.
    const d = (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, W1, 'partial', 'Ana');
    eq(d.confirmed, false, 'a truncated read does not confirm a programme');
    eq(d.state, 'session', 'but does not withhold the one it has');
}
/* ── every state says something, and no two say the same thing ─────────── */
{
    const all = [
        (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, 'the 7th', 'ready', 'Ana'),
        (0, daySession_1.trainingOnDay)(null, null, W1, 'error', 'Ana'),
        (0, daySession_1.trainingOnDay)(null, null, W1, 'ready', 'Ana'),
        (0, daySession_1.trainingOnDay)(one([]), null, W1, 'ready', 'Ana'),
        (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, '2026-09-08', 'ready', 'Ana'),
        (0, daySession_1.trainingOnDay)(one([day('Mon', 'Push', 3)]), null, W1, 'ready', 'Ana'),
    ];
    eq(all.map((d) => d.state), ['undated', 'unreadable', 'unassigned', 'unwritten', 'rest', 'session'], 'all six states are reachable');
    for (const d of all) {
        ok(d.line.trim().length > 0, `${d.state} has a sentence`);
        // Every state that has to EXPLAIN itself does so in a sentence. 'session'
        // is the one that does not: it is the row's label — "Push · 3 exercises ·
        // 10 min bike · Week 5" — and a full stop on the end of a middot list
        // would be punctuation on a caption.
        if (d.state !== 'session') {
            ok(/[.!]$/.test(d.line.trim()), `${d.state}'s line explains itself, and ends like a sentence`);
        }
        ok(!/undefined|null|NaN/.test(d.line), `${d.state}'s line has no hole in it`);
        ok((0, daySession_1.dayPlanHeading)(d).trim().length > 0, `${d.state} has a heading`);
    }
    const lines = new Set(all.map((d) => d.line));
    eq(lines.size, all.length, 'and no two states are said with the same sentence');
    // The one collapse that costs the most: "nothing scheduled" said four ways.
    const nothing = all.filter((d) => d.day === null).map((d) => d.line);
    eq(new Set(nothing).size, nothing.length, 'in particular the four ways of having no session are four different sentences');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('daySession: ok — no dead tap, no unread programme drawn as a rest day, and the week counted to the day on screen');
