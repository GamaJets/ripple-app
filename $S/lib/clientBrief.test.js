"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The sentences the coach's client screen puts under each destination.
// Compile with tsc, run with node.
//
// Two things are defended here, and both of them are the kind that ship quietly
// wrong because the screen still looks fine:
//
// 1. No read status produces a figure the read cannot support. A refused read
//    must never come out as a count, and a truncated one must never come out as
//    a total — `capped()` hands back a prefix of an unknown set, so "3 open"
//    over a truncated read is a wrong number rather than a rough one. Every
//    line function is asked all four statuses and the counting branches are
//    checked for the hedge.
//
// 2. An empty `attention()` list can never be produced by reads that failed.
//    That is the most dangerous screen in the app: a short, clean, reassuring
//    list assembled out of three reads that never landed. `blind` has to name
//    what was missed whenever anything was.
const clientBrief_1 = require("./clientBrief");
const clientGoals_1 = require("./clientGoals");
const coachWeek_1 = require("./coachWeek");
const clientDrift_1 = require("./clientDrift");
const locale_1 = require("./locale");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
// These assertions read dates in British order — the day first. That is no
// longer what the app writes for everybody: src/lib/format.ts asks
// src/lib/locale.ts, which reads the handset, so the same call produces
// "Sep 2, 2026" on an American one. The locale is stated here for the same
// reason this file states its timezones: a test that reads whatever the runner
// happens to be set to is a test of the machine.
(0, locale_1.setAppLocale)('en-GB');
const NOW = Date.parse('2026-09-01T12:00:00Z');
const TODAY = '2026-09-01';
const WHO = 'Sam';
/* ── the hero line ────────────────────────────────────────────────────────── */
const silent = (0, clientDrift_1.assessDrift)({ clientId: 'c', events: [], since: '2026-06-01T00:00:00Z' }, NOW);
ok((0, clientBrief_1.lastSeenLine)(silent, false, WHO) === silent.reason, 'a drift that landed speaks in its own words — two screens must not word the same verdict differently');
ok(/could not be read/.test((0, clientBrief_1.lastSeenLine)(null, true, WHO)), 'a failed read says so');
ok(!/could not be read/.test((0, clientBrief_1.lastSeenLine)(null, false, WHO))
    && /Reading/.test((0, clientBrief_1.lastSeenLine)(null, false, WHO)), 'a read still in flight is not a failure and does not read as one');
/* ── goals ───────────────────────────────────────────────────────────────── */
const goal = (over = {}) => ({
    id: 'g1', kind: 'weight', targetValue: 80, title: null,
    targetDateISO: '2026-10-01', achievedAtISO: null, createdAtISO: '2026-08-01T00:00:00Z',
    ...over,
});
const working = (0, clientGoals_1.goalBoard)([goal(), goal({ id: 'g2', targetDateISO: '2026-12-01' })]);
ok(/^2 open\./.test((0, clientBrief_1.goalsLine)('ready', working, WHO, NOW)), 'two open goals are counted when the read was whole');
ok(/at least 2 open/i.test((0, clientBrief_1.goalsLine)('partial', working, WHO, NOW)), 'a truncated read is hedged, never counted flat — a prefix of an unknown set is not a total');
ok(/could not be read/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)(null), WHO, NOW))
    && /not the same as/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)(null), WHO, NOW)), 'unreadable goals say so AND say what that is not');
ok(/hasn't set a goal/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)([]), WHO, NOW)), 'an empty answer that really came back is a fact about the client');
ok((0, clientBrief_1.goalsLine)('loading', (0, clientGoals_1.goalBoard)(null), WHO, NOW) === 'Reading their goals…', 'in flight outranks the unreadable board a loading screen is holding');
ok(/All 1 goal reached/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)([goal({ achievedAtISO: '2026-08-20T00:00:00Z' })]), WHO, NOW)), 'everything reached is its own state, not an empty list');
ok(/target date passed/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)([goal({ targetDateISO: '2026-08-01' })]), WHO, NOW)), 'a target date behind us is called out on the nearest goal');
ok(/no target date/.test((0, clientBrief_1.goalsLine)('ready', (0, clientGoals_1.goalBoard)([goal({ targetDateISO: null })]), WHO, NOW)), 'an undated goal is never given a deadline');
/* ── the week ────────────────────────────────────────────────────────────── */
const days = [
    { dateISO: '2026-09-02', type: 'training', note: null },
    { dateISO: '2026-09-03', type: 'rest', note: null },
    { dateISO: '2026-08-30', type: 'training', note: null },
];
const noProgramme = () => undefined;
// Thursday 3 Sep — which they have marked a rest day — is a session in the
// coach's programme. That is `planConflict`'s 'plan-schedules-a-session', and
// it is the one a coach can still settle before the day arrives.
const programme = (wd) => (wd === 4 ? 'Push' : null);
const plainWeek = (0, coachWeek_1.coachWeek)(days, TODAY, noProgramme);
ok(/^2 days marked from today on\./.test((0, clientBrief_1.weekLine)('ready', plainWeek, WHO)), 'the days ahead are counted; the one behind is left to the screen itself');
ok(/at least 2 days/i.test((0, clientBrief_1.weekLine)('partial', plainWeek, WHO)), 'a truncated week is hedged too');
ok(/could not be read/.test((0, clientBrief_1.weekLine)('ready', (0, coachWeek_1.coachWeek)(null, TODAY, noProgramme), WHO)), 'a failed planned-days read is never "they have marked nothing"');
const empty = (0, coachWeek_1.coachWeek)([], TODAY, noProgramme);
ok((0, clientBrief_1.weekLine)('ready', empty, WHO).includes(String(clientBrief_1.WEEK_SPAN_DAYS))
    && clientBrief_1.WEEK_SPAN_DAYS === coachWeek_1.DAYS_BEHIND + coachWeek_1.DAYS_AHEAD, 'the empty-week sentence names the window it actually looked at');
// Both ahead days disagree, for the two different reasons `planConflict` names:
// Wednesday is marked training and the programme schedules nothing, Thursday is
// marked rest and the programme schedules Push.
const clash = (0, coachWeek_1.coachWeek)(days, TODAY, programme);
ok(clash.conflicts.length === 2 && /2 disagree with the programme you set/.test((0, clientBrief_1.weekLine)('ready', clash, WHO)), 'a disagreement with the programme is surfaced in the summary');
ok(/1 disagrees with the programme you set/.test((0, clientBrief_1.weekLine)('ready', (0, coachWeek_1.coachWeek)([days[1]], TODAY, programme), WHO)), 'and one of them is singular — a summary line that says "1 disagree" is read as broken');
ok(!/disagree/.test((0, clientBrief_1.weekLine)('ready', plainWeek, WHO)), 'and is never claimed when no programme of the coach could be read');
/* ── photos ──────────────────────────────────────────────────────────────── */
const photo = (id, sharedAt) => ({
    id, path: `p/${id}.jpg`, takenAt: '2026-08-01T00:00:00Z', sharedAt, link: null,
});
const inbox = (over = {}) => ({
    clientId: 'c', coachId: 'k', linkActive: true, photos: [], readAtMs: NOW, ...over,
});
ok(/could not read/i.test((0, clientBrief_1.photosLine)(null, true, WHO)) && /not the same as/.test((0, clientBrief_1.photosLine)(null, true, WHO)), 'a failed photo read never becomes "they have sent you nothing"');
ok(/Reading/.test((0, clientBrief_1.photosLine)(null, false, WHO)), 'nothing read yet is not an empty inbox');
ok(/No live coaching link/.test((0, clientBrief_1.photosLine)(inbox({ linkActive: false }), false, WHO)), 'no coaching link is a fact about the link, and is kept apart from an empty inbox');
ok(/hasn't sent you a progress photo/.test((0, clientBrief_1.photosLine)(inbox(), false, WHO)), 'a live link and no grants is the one case that IS about the client');
// Local noon, not midnight and not a fixed UTC hour. `stamp` renders an instant
// in the READER's own zone, so a midnight timestamp lands on different calendar
// days depending on where the process runs, which would make this a test of the
// machine rather than of the ordering. `08:00Z` was the previous answer and was
// right for the three zones the suite ran at (UTC-7, UTC+4, UTC+12) — but it is
// the 27th at UTC-11, so the line reads "27 Aug" and this fails. No UTC hour
// fixes that: the inhabited offsets span more than a day. Local noon does.
const noonOn = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
const two = inbox({ photos: [photo('a', noonOn(2026, 8, 20)), photo('b', noonOn(2026, 8, 28))] });
ok(/^2 photos · newest sent 28 Aug 2026\./.test((0, clientBrief_1.photosLine)(two, false, WHO)), 'the newest SEND leads, because the send is the act addressed to the coach');
/* ── the checklist ───────────────────────────────────────────────────────── */
ok(/could not be read/.test((0, clientBrief_1.listLine)('error', null, { seenDays: 4, windowDays: 28 }, WHO)), 'a failed items read is not "you have set them nothing"');
ok(/row limit/.test((0, clientBrief_1.listLine)('partial', 9, { seenDays: 4, windowDays: 28 }, WHO)), 'a truncated list of lines says so instead of counting');
ok(/haven't put a line/.test((0, clientBrief_1.listLine)('ready', 0, { seenDays: 4, windowDays: 28 }, WHO)), 'no lines set, read whole, is a real answer');
ok(/3 lines of yours/.test((0, clientBrief_1.listLine)('ready', 3, { seenDays: 4, windowDays: 28 }, WHO))
    && /ticked something on 4 of the last 28 days/.test((0, clientBrief_1.listLine)('ready', 3, { seenDays: 4, windowDays: 28 }, WHO)), 'the count of lines and the days they were in the app are both stated, and neither is a percentage');
ok(!/%/.test((0, clientBrief_1.listLine)('ready', 3, { seenDays: 4, windowDays: 28 }, WHO)), 'ticks are never turned into a score out of a hundred — the whole point of adherence.ts');
ok(/could not be read/.test((0, clientBrief_1.listLine)('ready', 3, null, WHO)), 'ticks that did not come back are said out loud rather than shown as none');
ok(/Nothing ticked at all/.test((0, clientBrief_1.listLine)('ready', 3, { seenDays: 0, windowDays: 28 }, WHO))
    && /drawer/.test((0, clientBrief_1.listLine)('ready', 3, { seenDays: 0, windowDays: 28 }, WHO)), 'a real zero is stated as one AND carries the doubt that a zero cannot separate');
/* ── the programme ───────────────────────────────────────────────────────── */
ok(/could not be read/.test((0, clientBrief_1.programmeLine)('error', null, null, WHO)), 'a failed programme read is not "no programme assigned"');
ok(/that this app can read/.test((0, clientBrief_1.programmeLine)('ready', null, null, WHO)), 'no programme is hedged, because another coach\'s programme looks identical from here');
ok((0, clientBrief_1.programmeLine)('ready', 'Push Pull Legs', 3, WHO) === 'Push Pull Legs · 3 days a week.', 'an assigned programme is named with its own shape');
/* ── what is outstanding, and what was not checked ───────────────────────── */
const base = {
    who: WHO, unread: 0,
    injuries: [],
    goalStatus: 'ready', board: (0, clientGoals_1.goalBoard)([]),
    weekStatus: 'ready', week: empty,
    intake: 'complete', intakeLeft: 0,
    invoiceStatus: 'ready', overdueInvoices: 0,
    driftFailed: false, nowMs: NOW,
};
const clear = (0, clientBrief_1.attention)(base);
ok(clear.items.length === 0 && clear.blind === null, 'seven whole reads with nothing in them is a genuine all-clear and may say so');
/* ── the three the list could not raise ──────────────────────────────────
 *
 * All three were read and rendered further down the same screen and none of
 * them could reach the part of it written to say what needs doing. A coach who
 * read the short list at the top and did not scroll was not told that somebody
 * had just disclosed a knee.
 */
const hurt = (0, clientBrief_1.attention)({ ...base, injuries: [{ area: 'knee', isNew: true }, { area: 'shoulder' }] });
ok(hurt.items.length === 1, 'a newly disclosed injury is something to do');
ok(/knee/i.test(hurt.items[0]), 'and the area is named');
ok(!/shoulder/i.test(hurt.items[0]), 'while one disclosed months ago is not — the list is what changed, not everything on file');
ok(hurt.items[0].endsWith('.'), 'and it reads as a sentence');
// Injuries lead. It is the only item about somebody getting hurt and the only
// one that changes what the coach must not write next.
const hurtAndUnread = (0, clientBrief_1.attention)({ ...base, unread: 2, injuries: [{ area: 'knee', isNew: true }] });
ok(/knee/i.test(hurtAndUnread.items[0]), 'and it leads the list, ahead of an unread message');
// The note never travels. It is seeded from the line off an uploaded medical
// document, and this sentence is read at a glance on a roster screen.
const noted = (0, clientBrief_1.attention)({
    ...base,
    injuries: [{ area: 'knee', isNew: true, note: 'grade 2 MCL sprain per MRI' }],
});
ok(!noted.items.some((x) => /MRI|sprain/i.test(x)), 'the injury NOTE is not in the sentence, whatever the row carries');
const noRosterInjuries = (0, clientBrief_1.attention)({ ...base, injuries: null });
ok(noRosterInjuries.items.length === 0
    && /anything they have disclosed/.test(noRosterInjuries.blind ?? ''), 'a roster that did not come back cannot say they have disclosed nothing');
const halfIntake = (0, clientBrief_1.attention)({ ...base, intake: 'started', intakeLeft: 3 });
ok(halfIntake.items.some((x) => /3 parts/.test(x)), 'an unfinished intake is something to chase');
const noIntake = (0, clientBrief_1.attention)({ ...base, intake: 'none', intakeLeft: 6 });
ok(noIntake.items.some((x) => /not started their intake/.test(x)), 'and one never started says so');
const unknownIntake = (0, clientBrief_1.attention)({ ...base, intake: 'unknown', intakeLeft: 0 });
ok(unknownIntake.items.length === 0
    && /filled in their intake/.test(unknownIntake.blind ?? ''), 'an intake that could not be read is a blind spot, never an instruction to chase somebody');
const late = (0, clientBrief_1.attention)({ ...base, overdueInvoices: 2 });
ok(late.items.some((x) => /2 invoices/.test(x) && /past their due date/.test(x)), 'invoices past their due date are something to do');
for (const st of ['error', 'partial']) {
    const short = (0, clientBrief_1.attention)({ ...base, invoiceStatus: st, overdueInvoices: 2 });
    ok(short.items.every((x) => !/invoice/.test(x)), `an invoice count over a ${st} read is a wrong number and is not stated`);
    ok(/owe|invoice/.test(short.blind ?? ''), `and the ${st} read is named as a blind spot instead`);
}
const busy = (0, clientBrief_1.attention)({
    ...base,
    unread: 2,
    board: (0, clientGoals_1.goalBoard)([goal({ targetDateISO: '2026-08-01' })]),
    week: clash,
});
ok(busy.items.length === 3, `unread, an overdue goal and a clash are three separate things to do, got ${busy.items.length}`);
ok(busy.items[0] === '2 unread messages from Sam.', 'with nothing disclosed, the message a client has already sent leads');
ok(busy.items.some((x) => /past its target date/.test(x)), 'the overdue goal is named');
ok(busy.items.some((x) => /2 days they have marked ahead disagree with your programme/.test(x)), 'the clash is named');
ok(busy.blind === null, 'nothing was missed, so nothing is claimed to have been');
const noRoster = (0, clientBrief_1.attention)({ ...base, unread: null });
ok(noRoster.items.length === 0 && noRoster.blind != null && /anything unread/.test(noRoster.blind), 'a roster that did not come back is a blind spot, not a client with no unread messages');
const dark = (0, clientBrief_1.attention)({ ...base, goalStatus: 'error', board: (0, clientGoals_1.goalBoard)(null), weekStatus: 'error', week: (0, coachWeek_1.coachWeek)(null, TODAY, noProgramme), driftFailed: true });
ok(dark.items.length === 0, 'a failed read contributes no items — it has nothing to contribute');
ok(dark.blind != null
    && /their goals/.test(dark.blind)
    && /the days they have marked/.test(dark.blind)
    && /their training record/.test(dark.blind), 'and every one of them is named, so the empty list above cannot pass for an all-clear');
const truncated = (0, clientBrief_1.attention)({ ...base, goalStatus: 'partial', board: working, weekStatus: 'partial', week: plainWeek });
ok(truncated.blind != null && /rest of their goals/.test(truncated.blind), 'a truncated read is a blind spot too: the overdue goal may be in the part that did not come back');
ok(truncated.items.length === 0, 'and it contributes no items, because a count over a prefix is a wrong number');
/* ── a client with no account at all ─────────────────────────────────────── */
ok((0, clientBrief_1.unaskedNote)(true, true, WHO) === null, 'a client with an account on a build with a server was actually asked about');
ok(/not talking to a server/.test((0, clientBrief_1.unaskedNote)(false, true, WHO) ?? ''), 'a build with no server says so rather than showing four sections that read as "Reading…"');
ok(/until they join/.test((0, clientBrief_1.unaskedNote)(true, false, WHO) ?? ''), 'and a client with no account is a third thing again: nothing refused, nothing pending, nothing there');
ok((0, clientBrief_1.noAccountNote)(true, WHO) === null, 'a client with an account gets no caveat');
ok(/added by hand/.test((0, clientBrief_1.noAccountNote)(false, WHO) ?? ''), 'and one without gets the reason the sections below are empty');
console.log(errors.length ? 'CLIENT BRIEF FAILURES:\n' + errors.join('\n') : 'ALL CLIENT BRIEF TESTS PASSED');
if (errors.length)
    process.exit(1);
