"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for bulkActions — the three sentences that stand between a coach and a
// bulk write they cannot see the shape of.
//
// The defects these exist for are all the same defect at scale: a control that
// acts on thirty rows and reports on none of them.
//
//   · "Assign to 12" is a number, and the tap behind it replaces nine
//     programmes a human wrote. The confirmation has to say HOW MANY are on
//     something and WHO — a count alone leaves the coach to work out whether
//     Tuesday's client is in the set, which is exactly the work they opened a
//     bulk control to avoid.
//   · twelve writes are twelve chances to be refused, and "8 of 12 saved" tells
//     a coach something is wrong and nothing about what to do. The report has
//     to name both halves and hand back the failures so they stay selected.
//   · a Select All over a roster that came back at its row limit ticks a
//     thousand people and calls it everybody. Nothing on the screen is false
//     and the coach is still acting on a set they cannot see.
//
// So the assertions below are about CONTENT — is the count there, is the name
// there, are the failures returned — rather than about exact wording. Pinning
// strings would make a rewording a red test, and the thing that must not
// regress is that the coach is told the fact.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
const bulkActions_1 = require("./bulkActions");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const target = (name, onProgramme) => ({ clientId: name.toLowerCase(), name, onProgramme });
/* ── namesWithRest: a truncated list of names is a false sentence ─────────── */
eq((0, bulkActions_1.namesWithRest)([]), '', 'no names is an empty string, not the word "nobody" invented here');
eq((0, bulkActions_1.namesWithRest)(['Ana']), 'Ana', 'one name is the name');
eq((0, bulkActions_1.namesWithRest)(['Ana', 'Ben']), 'Ana and Ben', 'two are joined with "and", never a bare comma');
eq((0, bulkActions_1.namesWithRest)(['Ana', 'Ben', 'Cara']), 'Ana, Ben and Cara', 'three read as a sentence');
{
    const nine = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'];
    const s = (0, bulkActions_1.namesWithRest)(nine);
    ok(s.includes('3 more'), 'PAST THE LIMIT THE REMAINDER IS COUNTED — a bare "A1, A2, A3" for a set of nine is a false sentence, and false in the direction that makes the coach relax');
    eq(nine.slice(0, bulkActions_1.NAMES_IN_BRIEF).every((n) => s.includes(n)), true, 'and the names it does print are the first NAMES_IN_BRIEF of them');
}
/* ── the overwrite brief ──────────────────────────────────────────────────── */
// THE SHAPE FROM THE BRIEF: nine of twelve are on something.
{
    const twelve = [
        target('Ana', true), target('Ben', true), target('Cara', true),
        target('Dev', true), target('Eve', true), target('Fay', true),
        target('Gus', true), target('Hal', true), target('Ivy', true),
        target('Jan', false), target('Kim', false), target('Lou', false),
    ];
    const b = (0, bulkActions_1.overwriteBrief)(twelve, 'Push · Pull · Legs');
    ok(b.body.includes('9') && b.body.includes('12'), 'THE COUNT OF WHO IS ON SOMETHING IS IN THE BODY — "assign to 12" is not consent, "9 of these 12" is the fact that makes it one');
    ok(b.body.includes('Ana') && b.body.includes('Ben'), 'AND THEY ARE NAMED — a coach recognises the person they spent an hour programming on Tuesday; they do not recognise a nine');
    ok(b.body.includes('Push · Pull · Legs'), 'the programme going out is quoted back, so the dialog is about a specific thing rather than about the button that opened it');
    ok(/no undo/i.test(b.body), 'and the cost is stated: there is no undo, which is the whole reason this dialog exists');
    ok(/nothing tells them|nothing.*changed/i.test(b.body), 'including that the client is never told — the coach is the only person who will know this happened');
    ok(b.body.includes('Jan') || b.body.includes('3'), 'the three who are on nothing are accounted for too, so the dialog covers everybody it is about to write to');
    eq(b.replacing.length, 9, 'replacing carries exactly the clients whose training is being written over');
    ok(b.confirmLabel.includes('9'), 'THE BUTTON CARRIES THE NUMBER — "Assign" is the word a coach remembers afterwards, and it must not be the whole sentence');
}
// Nobody is on anything. This must NOT raise an alarm — a dialog that shouts
// every time is one a coach taps through, including the time it mattered.
{
    const b = (0, bulkActions_1.overwriteBrief)([target('Jan', false), target('Kim', false)], 'Starter');
    ok(!/no undo/i.test(b.body), 'with nothing to replace there is no irreversible loss to warn about, and warning anyway teaches the coach to tap through this dialog');
    ok(/nothing is being replaced/i.test(b.body), 'it says so positively rather than by omission');
    eq(b.replacing.length, 0, 'and nothing is listed as being replaced');
}
// Everybody is on something — a different sentence again, because "9 of 9" is
// a strange way to say "all of them".
{
    const b = (0, bulkActions_1.overwriteBrief)([target('Ana', true), target('Ben', true)], 'Block 2');
    ok(/all/i.test(b.title) || /all/i.test(b.body), 'when every one of them is on something the sentence says all of them rather than counting up to the total');
    ok(b.body.includes('Ana') && b.body.includes('Ben'), 'and still names them');
}
// One client. The bulk path is reachable with a single tick and the copy must
// not read "1 clients" or "all 1 of these".
{
    const b = (0, bulkActions_1.overwriteBrief)([target('Ana', true)], 'Block 2');
    ok(!/1 clients|these 1|all 1/i.test(b.title + b.body + b.confirmLabel), 'a selection of one is written in English — four counts on the builder once said "1 exercises" for the same reason');
    ok(b.body.includes('Ana'), 'and the one person is named');
}
/* ── the report: partial failure is the normal case ───────────────────────── */
const outcome = (name, isOk, why = null) => ({ clientId: name.toLowerCase(), name, ok: isOk, why });
// Everything landed. Still not the word "Done".
{
    const r = (0, bulkActions_1.bulkReport)('assign', [outcome('Ana', true), outcome('Ben', true)]);
    eq(r.retry.length, 0, 'nothing to retry when everything landed');
    ok(r.body.includes('Ana') && r.body.includes('Ben'), 'the successes are named, so a coach can see it reached who they meant');
    ok(!/^done$/i.test(r.title.trim()), 'NEVER A BARE "DONE" — that is the word that made the old fire-and-forget writes look identical to the working ones');
    ok(r.body.includes('2'), 'and the count is in the sentence');
}
// THE CASE THE BRIEF CALLS NORMAL: some landed, some did not.
{
    const r = (0, bulkActions_1.bulkReport)('assign', [
        outcome('Ana', true), outcome('Ben', true), outcome('Cara', true),
        outcome('Dev', false, 'That programme was not changed — the server matched no rows.'),
        outcome('Eve', false, 'That programme could not be saved.'),
    ]);
    eq(r.retry.join(','), 'dev,eve', 'THE FAILURES COME BACK AS IDS — the caller leaves exactly them selected, so trying again is the same gesture over the set that still needs it');
    ok(r.body.includes('Dev') && r.body.includes('Eve'), 'and they are NAMED: "2 of 5 failed" tells a coach something is wrong and nothing about what to do');
    ok(r.body.includes('Ana'), 'the ones that landed are named too, so the coach knows not to redo them');
    ok(r.body.includes('matched no rows'), 'each failure carries its own reason — a refused write and a lost connection are different problems');
    ok(/still selected/i.test(r.body), 'and the report says the failures are still selected, because a coach who does not know that re-ticks everybody');
    ok(/part/i.test(r.title), 'the title says partly, not "assigned"');
}
// Nothing landed. The useful half of this is that NOTHING CHANGED — a coach who
// thinks a failed bulk assign half-landed has to check twelve people by hand.
{
    const r = (0, bulkActions_1.bulkReport)('assign', [
        outcome('Ana', false, 'That programme could not be saved.'),
        outcome('Ben', false, 'That programme could not be saved.'),
    ]);
    eq(r.retry.length, 2, 'every one of them is offered for retry');
    ok(/nothing has changed|nothing.*changed/i.test(r.body), 'and the report states that nothing changed, which is what stops the coach auditing a write that never happened');
    ok(!/^assigned$/i.test(r.title.trim()), 'the title is not "Assigned"');
}
// A long tail of identical failures collapses its REASONS and keeps its NAMES.
{
    const many = [];
    for (let i = 1; i <= 12; i++)
        many.push(outcome('C' + i, false, 'That programme could not be saved.'));
    const r = (0, bulkActions_1.bulkReport)('assign', many);
    eq(r.retry.length, 12, 'all twelve come back for retry however the sentence is written');
    ok(r.body.includes('C1') && r.body.includes('C12'), 'EVERY NAME SURVIVES — the reasons may collapse, the people may not; a coach has to be able to see who');
    const occurrences = r.body.split('could not be saved').length - 1;
    ok(occurrences <= 2, 'but one shared reason is said once rather than twelve times, because a wall of identical sentences is one nobody reads');
}
// The message wording is its own vocabulary, not "assigned" with a noun swapped.
{
    const r = (0, bulkActions_1.bulkReport)('message', [outcome('Ana', true)]);
    ok(/sent/i.test(r.title) && !/assign/i.test(r.title + r.body), 'a message that went out is reported as sent, and never as assigned');
    ok(/thread/i.test(r.body), 'and it says where it went — a real row in their own thread, which is the thing that makes it a message and not a broadcast');
}
// Nobody ticked. Reachable only through a bug, and it must not claim an action.
{
    const r = (0, bulkActions_1.bulkReport)('assign', []);
    ok(!/^assigned$/i.test(r.title.trim()), 'an empty set is never reported as a completed assign');
    eq(r.retry.length, 0, 'and there is nothing to retry');
}
/* ── select all over a list that may be part of one ───────────────────────── */
{
    const r = (0, bulkActions_1.selectAllOffer)('ready', 12);
    eq(r.allowed, true, 'a whole read may offer the plain gesture');
    eq(r.scope, 'all', 'and it genuinely means all of them');
    eq(r.label, 'Select All', 'labelled plainly, in Title Case like every other button');
    eq(r.note, null, 'with nothing to caveat');
}
{
    // THE ONE THIS SECTION EXISTS FOR.
    const r = (0, bulkActions_1.selectAllOffer)('partial', 1000);
    eq(r.allowed, true, 'the gesture is NOT withheld under a truncated read — ticking a thousand named people is a true gesture and refusing it takes a working control away');
    eq(r.scope, 'shown', 'but what it means is the rows on screen, not the book');
    ok(!/^Select All$/.test(r.label), 'AND IT IS NOT CALLED "ALL" — "all" over a capped page is a claim about people this screen has never seen');
    ok(r.label.includes('1,000'), 'the label names its own size instead, so the coach reads what they are about to tick');
    ok(r.note !== null && /more|past|limit/i.test(r.note), 'and the note says there are more past it, which is the fact the word "all" was hiding');
}
{
    const r = (0, bulkActions_1.selectAllOffer)('error', 0);
    eq(r.allowed, false, 'a failed read offers no sweeping gesture: there is no list to sweep');
    eq(r.scope, null, 'and no scope for one');
    ok(r.note !== null && /read failed|did not come back|failed/i.test(r.note), 'the note says the READ failed rather than that the book is empty — an empty roster under error means unknown');
}
{
    const r = (0, bulkActions_1.selectAllOffer)('loading', 0);
    eq(r.allowed, false, 'nothing is selected while the list is still arriving');
    ok(r.label !== (0, bulkActions_1.selectAllOffer)('error', 0).label, 'and "still reading" does not read the same as "could not be read" — one resolves itself and the other needs signal');
}
/* ── who a message is about to go to ──────────────────────────────────────── */
{
    const g = (0, bulkActions_1.guardRecipients)('ready', 'ready', 'all of your clients');
    eq(g.allowed, true, 'two whole reads may send');
    eq(g.reason, null, 'with no refusal to render');
}
{
    // The count on the button is the size of the page, not the size of the
    // segment, and the message reads as complete either way.
    const g = (0, bulkActions_1.guardRecipients)('partial', 'ready', 'all of your clients');
    eq(g.allowed, false, 'A SEGMENT SEND IS REFUSED OVER A TRUNCATED ROSTER — "everyone" written against part of a book is not a smaller version of what the coach asked for');
    ok(g.reason !== null && /size of/i.test(g.reason), 'and the refusal says why: the number in front of them is the size of what loaded');
}
{
    // With tags unread every tagsFor() comes back empty, so a chosen tag matches
    // nobody — which renders identically to a tag that genuinely has nobody in it.
    const g = (0, bulkActions_1.guardRecipients)('ready', 'error', 'the “bootcamp” segment');
    eq(g.allowed, false, 'the read that DEFINES the segment is load-bearing too, not just the roster read');
    ok(g.reason.includes('bootcamp'), 'and the refusal names the segment, so the coach knows which of the two reads to wait on');
}
{
    const g = (0, bulkActions_1.guardRecipients)('loading', 'ready', 'all of your clients');
    eq(g.allowed, false, 'nothing goes out while the list is still arriving');
    ok(g.label !== (0, bulkActions_1.guardRecipients)('error', 'ready', 'all of your clients').label, 'and a wait is not worded as a failure');
}
/* ── what the composer says, and what the message does not ────────────────── */
eq((0, bulkActions_1.bulkThreadNote)(1), null, 'one recipient needs no note — it is an ordinary message and saying so would be noise');
{
    const n = (0, bulkActions_1.bulkThreadNote)(20) ?? '';
    ok(n.includes('20'), 'the note carries the real recipient count');
    ok(/own thread/i.test(n), 'and says these are N real messages in N real threads rather than one broadcast object');
    ok(/nothing marks it|read as though you wrote it/i.test(n), 'AND IT TELLS THE COACH WHAT THE CLIENT WILL SEE — nothing is appended to the body under the coach’s name, so the decision to say "this went to everyone" is theirs to type');
}
/* ── taking clients OFF a programme ───────────────────────────────────────── */
//
// The user's request carried the fear inside it: "un-assign templates meanwhile
// keeping the data for the history of the workouts done in those templates so
// you can add it back in at a later stage". A coach who believes un-assigning
// might take their client's training record with it will never press the
// button, so the sentence that settles it is the feature.
//
// It is settled by the schema and not by reassurance: no foreign key anywhere
// in the live database points at `assigned_programs` or `program_templates`,
// and `workouts` is keyed by user and date with no reference to a plan.
{
    const b = (0, bulkActions_1.unassignBrief)([target('Ana', true), target('Ben', true), target('Cara', false)]);
    ok(b.body.includes('Ana') && b.body.includes('Ben'), 'the clients actually coming off are NAMED — a coach recognises the person, not the count');
    ok(!b.body.includes('Cara'), 'and somebody already on their auto plan is not counted as being taken off anything');
    eq(b.replacing.length, 2, 'only the ones on a programme are acted on');
    ok(/already logged/i.test(b.body) && /still/i.test(b.body), 'THE HISTORY IS PROMISED IN WORDS — that what is already logged stays, and is STILL there if the programme goes back on. This is the whole reason the dialog exists: a coach who is unsure will never press the button');
    ok(/2/.test(b.confirmLabel), 'and the button carries the number, like every other destructive one here');
}
{
    const b = (0, bulkActions_1.unassignBrief)([target('Ana', false)]);
    eq(b.replacing.length, 0, 'nobody on a programme is nobody to take off');
    ok(/nothing to remove|already/i.test(b.body), 'and that is said plainly rather than raising an alarm about a write that would do nothing');
}
{
    const r = (0, bulkActions_1.bulkReport)('unassign', [
        { clientId: 'a', name: 'Ana', ok: true, why: null },
        { clientId: 'b', name: 'Ben', ok: false, why: 'the server refused it.' },
    ]);
    ok(/off/i.test(r.title), 'a partial un-assign is titled as an un-assign, not as an assign');
    ok(r.body.includes('Ana') && r.body.includes('Ben'), 'both halves are named');
    eq(r.retry.join(','), 'b', 'and the one that did not land stays selected');
}
{
    const r = (0, bulkActions_1.bulkReport)('unassign', [{ clientId: 'a', name: 'Ana', ok: true, why: null }]);
    ok(/logged|untouched/i.test(r.body), 'and the success says the logged sessions are untouched — the coach is told the thing they were most likely to be wrong about');
    eq(r.retry.length, 0, 'nothing to retry when it all landed');
}
if (errors.length) {
    console.error(`bulkActions.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors.slice(0, 20))
        console.error('  · ' + e);
    if (errors.length > 20)
        console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
}
console.log('bulkActions.test.ts — ok');
