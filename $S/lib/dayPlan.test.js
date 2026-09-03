"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Planned day types (TF-20). Compile with tsc then run with node.
//
// Two things are being defended here, and neither is the happy path.
//
// 1. A plan never becomes a record. The assertions on `planOutcome` are mostly
//    negative: no combination of type, date and log may come back saying the
//    plan was kept when nothing was logged — including a rest day, where an
//    empty log is exactly what the plan predicts and still is not proof of it.
//
// 2. The dates survive the reader's timezone. Every date here is a bare
//    `YYYY-MM-DD`, which `new Date` resolves to UTC midnight; the repo runs
//    these under America/Los_Angeles, Pacific/Auckland and Asia/Dubai for the
//    two bugs described in src/lib/localDate.ts. A `weekdayOfIso` built on
//    `new Date(iso).getDay()` passes in Dubai and returns the previous day in
//    Los Angeles, which would ask the program for the wrong session.
const dayPlan_1 = require("./dayPlan");
const checklist_1 = require("./checklist");
const programs_1 = require("./programs");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
// ── the vocabulary ──
ok(dayPlan_1.PLANNED_DAY_TYPES.length === 4, `four day types, got ${dayPlan_1.PLANNED_DAY_TYPES.length}`);
// 'off' is Nutrition's key for Standard. Renaming it would give the calendar and
// the meal plan two words for one day type, which is the whole reason this file
// inherited the vocabulary instead of writing one.
ok(dayPlan_1.PLANNED_DAY_TYPES.includes('off'), "the Standard day keeps Nutrition's key, 'off'");
ok(dayPlan_1.DAY_TYPE_LABEL.off === 'Standard', 'and Nutrition’s label, "Standard"');
// Word for word from DAY_TYPES in app/(client)/nutrition.tsx. If that file's
// blurb is ever reworded, this is the assertion that says so.
ok(dayPlan_1.DAY_TYPE_BLURB.rest === 'A full day off training. Fuel comes down, because there is no session to feed.', 'the rest-day definition is the one already shown on Nutrition');
ok(dayPlan_1.PLANNED_DAY_TYPES.every((t) => dayPlan_1.DAY_TYPE_LABEL[t] && dayPlan_1.DAY_TYPE_BLURB[t]), 'every type has a label and a definition — an unexplained button is what TF asked to fix once already');
ok((0, dayPlan_1.isPlannedDayType)('rest') && !(0, dayPlan_1.isPlannedDayType)('refeed') && !(0, dayPlan_1.isPlannedDayType)(null), 'a type this build does not know is rejected, not coerced');
// ── dates, under whichever zone this is running in ──
ok((0, dayPlan_1.isoFromParts)(2026, 8, 3) === '2026-09-03', 'month index 8 is September, and both parts are padded');
ok((0, dayPlan_1.isoToday)(new Date(2026, 0, 5, 23, 30)) === '2026-01-05', 'today is built from local getters — toISOString() would already be the 6th here');
ok((0, dayPlan_1.cellKeyFromIso)('2026-09-03') === '2026-8-3', 'the grid cell key is year-monthIndex-day');
// 1 Sept 2026 is a Tuesday. Read as UTC midnight and displayed locally it is
// Monday the 31st anywhere west of Greenwich.
ok((0, dayPlan_1.weekdayOfIso)('2026-09-01') === 2, `1 Sep 2026 is a Tuesday, got weekday ${(0, dayPlan_1.weekdayOfIso)('2026-09-01')}`);
ok((0, dayPlan_1.weekdayOfIso)('2026-09-06') === 0, '6 Sep 2026 is a Sunday');
ok((0, dayPlan_1.weekdayOfIso)('nonsense') === null, 'an unreadable date has no weekday rather than a plausible one');
ok((0, dayPlan_1.compareIsoDays)('2026-09-01', '2026-09-02') === -1, 'earlier compares first');
ok((0, dayPlan_1.compareIsoDays)('2026-12-31', '2027-01-01') === -1, 'and across a year boundary');
ok((0, dayPlan_1.compareIsoDays)('2026-09-02', '2026-09-02') === 0, 'the same day compares equal');
ok((0, dayPlan_1.compareIsoDays)('2026-09-02', 'nonsense') === null, 'an unreadable date compares to nothing');
// ── planning is forward-only ──
ok((0, dayPlan_1.canPlan)('2026-09-10', '2026-09-01'), 'a future day can be planned');
ok((0, dayPlan_1.canPlan)('2026-09-01', '2026-09-01'), 'today can still be planned');
ok(!(0, dayPlan_1.canPlan)('2026-08-31', '2026-09-01'), 'yesterday cannot — that would be a claim about the past, not a plan');
ok(!(0, dayPlan_1.canPlan)('nonsense', '2026-09-01'), 'an unreadable date cannot be planned');
// ── a plan never becomes a record ──
const PAST = '2026-08-25', TODAY = '2026-09-01', FUTURE = '2026-09-10';
for (const type of dayPlan_1.PLANNED_DAY_TYPES) {
    ok((0, dayPlan_1.planOutcome)(type, FUTURE, TODAY, null) === 'not-yet', `a ${type} next week has not happened yet`);
    ok((0, dayPlan_1.planOutcome)(type, TODAY, TODAY, false) === 'today', `a ${type} today is still running`);
    // The assertion this whole file exists for.
    ok((0, dayPlan_1.planOutcome)(type, PAST, TODAY, false) === 'nothing-logged', `a planned ${type} that passed with an empty log must not read as kept`);
    ok((0, dayPlan_1.planOutcome)(type, PAST, TODAY, false) !== 'log-agrees', `and specifically must never be 'log-agrees' — including ${type}`);
    ok((0, dayPlan_1.planOutcome)(type, PAST, TODAY, null) === 'log-unknown', `an unread log is unknown for a planned ${type}, not an empty one`);
}
// The one that catches a naive implementation: for a rest day an empty log is
// what the plan predicts, and it is still not evidence the client rested.
ok((0, dayPlan_1.planOutcome)('rest', PAST, TODAY, false) === 'nothing-logged', 'an empty log on a planned rest day is absence of evidence, not evidence of rest');
ok((0, dayPlan_1.planOutcome)('training', PAST, TODAY, true) === 'log-agrees', 'training logged on a planned training day agrees');
// A deload is a training day with the volume cut — restday.tsx's own words are
// "keep training, but cut volume to ~60%" — so a session on one is the plan
// being followed.
ok((0, dayPlan_1.planOutcome)('deload', PAST, TODAY, true) === 'log-agrees', 'a session on a planned deload day agrees with it');
ok((0, dayPlan_1.planOutcome)('rest', PAST, TODAY, true) === 'log-disagrees', 'training logged on a planned rest day disagrees');
ok((0, dayPlan_1.planOutcome)('off', PAST, TODAY, true) === 'log-disagrees', 'and on a planned Standard day, which said "no session"');
ok((0, dayPlan_1.planOutcome)('rest', 'nonsense', TODAY, true) === null, 'an unreadable date has no outcome');
// No sentence this module produces may tell a client their plan was completed.
const CLAIMS = ['completed', 'complete', 'done', 'achieved', 'you rested', 'well done'];
for (const type of dayPlan_1.PLANNED_DAY_TYPES) {
    for (const outcome of ['not-yet', 'today', 'log-agrees', 'log-disagrees', 'nothing-logged', 'log-unknown']) {
        const note = (0, dayPlan_1.outcomeNote)(type, outcome).toLowerCase();
        ok(note.length > 0, `${type}/${outcome} must say something`);
        for (const claim of CLAIMS) {
            ok(!note.includes(claim), `${type}/${outcome} must not claim "${claim}": ${note}`);
        }
    }
}
ok((0, dayPlan_1.outcomeNote)('rest', 'nothing-logged').includes('stays a plan'), 'a passed, unlogged plan is still described as a plan');
// ── conflicts with the program are shown, not resolved ──
// The real thing: the muscle program schedules Push on Monday, Pull on
// Wednesday, Legs on Friday. 7 Sep 2026 is a Monday.
const program = (0, programs_1.buildProgram)('muscle', 22);
const MONDAY = '2026-09-07', TUESDAY = '2026-09-08';
const focusOn = (iso) => {
    const wd = (0, dayPlan_1.weekdayOfIso)(iso);
    return wd == null ? undefined : (0, checklist_1.scheduledFocus)(program.days, wd);
};
ok(focusOn(MONDAY) === 'Push', `the program schedules Push on Monday, got ${String(focusOn(MONDAY))}`);
ok(focusOn(TUESDAY) === null, 'and nothing on Tuesday');
const clash = (0, dayPlan_1.planConflict)('rest', focusOn(MONDAY));
ok(clash?.kind === 'plan-schedules-a-session', 'a rest day on a scheduled Push day is a conflict worth showing');
ok(clash?.focus === 'Push', 'and it names the session the program had for that day');
ok((clash?.note ?? '').includes('Push'), 'the note says which session, so the client can weigh it');
ok((0, dayPlan_1.planConflict)('off', focusOn(MONDAY))?.kind === 'plan-schedules-a-session', 'so is a Standard day — its own definition is "a normal day with no session"');
ok((0, dayPlan_1.planConflict)('training', focusOn(MONDAY)) === null, 'a training day on a scheduled session day agrees');
ok((0, dayPlan_1.planConflict)('deload', focusOn(MONDAY)) === null, 'a deload day does not conflict with a scheduled session — a deload IS training, lighter');
ok((0, dayPlan_1.planConflict)('training', focusOn(TUESDAY))?.kind === 'plan-schedules-nothing', 'an extra session the program does not schedule is worth saying, the other way round');
ok((0, dayPlan_1.planConflict)('rest', focusOn(TUESDAY)) === null, 'a rest day the program already leaves free is no conflict');
ok((0, dayPlan_1.planConflict)(null, focusOn(MONDAY)) === null, 'an unmarked day cannot conflict with anything');
// The fabricated-empty-answer bug in a new hat: an unread program is not a
// program with nothing in it.
ok((0, dayPlan_1.planConflict)('rest', undefined) === null, 'no conflict is claimed while the program is unknown');
ok((0, dayPlan_1.planConflict)('training', undefined) === null, 'in either direction');
// ── grouping and listing ──
const PLANS = [
    { dateISO: '2026-09-10', type: 'rest', note: 'Flying to Berlin' },
    { dateISO: '2026-08-25', type: 'training', note: null },
    { dateISO: '2026-09-01', type: 'deload', note: null },
    { dateISO: 'nonsense', type: 'off', note: null },
];
const keyed = (0, dayPlan_1.byCellKey)(PLANS);
ok(keyed.get('2026-8-10')?.type === 'rest', '10 Sep is keyed under month index 8');
ok(keyed.size === 3, 'a row whose date will not parse is dropped, not filed under an empty key');
const coming = (0, dayPlan_1.upcomingPlans)(PLANS, TODAY);
ok(coming.map((p) => p.dateISO).join(',') === '2026-09-01,2026-09-10', `upcoming plans are today-and-forward, soonest first, got ${coming.map((p) => p.dateISO).join(',')}`);
// A note is the client's own words and survives the round trip untouched —
// this is where a travel day lives while the app has no behaviour for one.
ok(coming[1].note === 'Flying to Berlin', 'the client’s note is carried, not normalised away');
// Exhaustiveness: a fifth type added to the union without a label or a blurb
// should fail to compile here rather than render as a blank button.
const _exhaustive = dayPlan_1.DAY_TYPE_LABEL;
void _exhaustive;
console.log(errors.length ? 'DAY PLAN FAILURES:\n' + errors.join('\n') : 'ALL DAY PLAN TESTS PASSED');
if (errors.length)
    process.exit(1);
