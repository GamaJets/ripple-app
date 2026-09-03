"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The six messages a coach types every week. Compile with tsc, run with node.
//
// The rule that has to hold whatever else changes here: A TEMPLATE IS NOT A
// SEND. Nothing in this module dispatches anything, schedules anything or
// carries an audience, and the assertions below say so about the shape as well
// as about the behaviour — src/lib/nudge.ts and supabase/parts/140 both exist
// because `messages.sender` once came from the caller's own request, and a
// message composed under somebody's name without them reading it is that defect
// with better manners.
//
// After that: an unfilled placeholder stays VISIBLE. "Hey {name}" is obviously
// unfinished and gets fixed before it is sent; "Hey ," gets sent.
const messageTemplates_1 = require("./messageTemplates");
const coachShare_1 = require("./coachShare");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── a template is not a send ──────────────────────────────────────────── */
for (const s of messageTemplates_1.STARTERS) {
    const keys = Object.keys(s);
    for (const forbidden of ['sendAt', 'trigger', 'audience', 'segment', 'auto', 'schedule']) {
        ok(!keys.includes(forbidden), `a template carries no ${forbidden} — nothing here may become automation`);
    }
    eq(s.id, null, 'a starter is not a saved row until the coach adds it');
}
/* ── the starters ──────────────────────────────────────────────────────── */
eq(messageTemplates_1.STARTERS.length, 6, 'the six a coach was measured typing every week');
for (const s of messageTemplates_1.STARTERS) {
    ok(s.body.includes(coachShare_1.NAME_TOKEN), `“${s.title}” addresses the client by the placeholder rather than by nothing`);
    ok((0, messageTemplates_1.templateBlockers)(s).length === 0, `“${s.title}” is itself a valid template`);
    // Title Case, because it is a row label in a picker.
    ok(/^[A-Z]/.test(s.title), `“${s.title}” starts with a capital`);
}
// Offered, never inserted — and never offered twice. A library that silently
// acquired six rows is one a coach cannot tell their own work from.
eq((0, messageTemplates_1.startersToOffer)([]).length, 6, 'a coach with nothing gets all six offered');
const mine = [{ id: 'x', title: 'welcome', body: 'Hi {name}', position: 100 }];
eq((0, messageTemplates_1.startersToOffer)(mine).length, 5, 'a coach who has written their own Welcome is not offered a second one');
ok(!(0, messageTemplates_1.startersToOffer)(mine).some((s) => s.title.toLowerCase() === 'welcome'), 'and it is that one that is dropped');
eq((0, messageTemplates_1.startersToOffer)([{ id: 'x', title: '  WELCOME  ', body: 'Hi', position: 1 }]).length, 5, 'matched case- and space-insensitively, because a coach types their own names');
/* ── validation, all of it at once ─────────────────────────────────────── */
eq((0, messageTemplates_1.templateBlockers)({ title: 'Welcome', body: 'Hey {name}' }).length, 0, 'a good one passes');
// A list, not the first failure: somebody with two fields wrong should be told
// both rather than made to press Save twice.
eq((0, messageTemplates_1.templateBlockers)({ title: '', body: '' }).length, 2, 'two empty fields produce two reasons');
eq((0, messageTemplates_1.templateBlockers)({ title: '   ', body: 'x' }).length, 1, 'whitespace is not a name');
eq((0, messageTemplates_1.templateBlockers)({ title: 'x', body: '   ' }).length, 1, 'and it is not a message either');
eq((0, messageTemplates_1.templateBlockers)({ title: 'x'.repeat(messageTemplates_1.MAX_TEMPLATE_TITLE + 1), body: 'y' }).length, 1, 'an over-long name is refused');
eq((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'y'.repeat(messageTemplates_1.MAX_TEMPLATE_BODY + 1) }).length, 1, 'and so is a paste accident');
eq((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'y'.repeat(messageTemplates_1.MAX_TEMPLATE_BODY) }).length, 0, 'the boundary itself is allowed');
// The near-misses a person actually types. They look right and they would be
// sent to a client verbatim.
ok((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'Hey {Name}' }).length === 1, '{Name} is caught before it reaches a client');
ok((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'Hey { name }' }).length === 1, 'and so is a spaced one');
ok(/\{name\}/.test((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'Hey {Name}' })[0]), 'and the message says what the real one is');
// A template with NO placeholder is perfectly good and must not be refused.
eq((0, messageTemplates_1.templateBlockers)({ title: 'Notice', body: 'Session times move next week.' }).length, 0, 'a template that addresses nobody by name is a real template');
// And something in brackets that is not a placeholder at all is left alone —
// refusing it would be this module deciding what a coach may write.
eq((0, messageTemplates_1.templateBlockers)({ title: 'x', body: 'Bring your kit (and a towel {optional})' }).length, 0, 'brackets that are not a near-miss of a placeholder are the coach’s own words');
/* ── filling it in ─────────────────────────────────────────────────────── */
eq((0, messageTemplates_1.applyTemplate)('Hey {name} — {coach}', 'Ana Ferreira', 'Sam Doyle'), 'Hey Ana — Sam', 'both tokens, first names both');
eq((0, messageTemplates_1.applyTemplate)('Hey {name}', null), 'Hey {name}', 'an unknown name leaves the placeholder visible rather than a blank');
ok((0, messageTemplates_1.hasUnfilledToken)((0, messageTemplates_1.applyTemplate)('Hey {name}', null)), 'and the composer can tell');
ok(!(0, messageTemplates_1.hasUnfilledToken)((0, messageTemplates_1.applyTemplate)('Hey {name}', 'Ana')), 'a filled one is finished');
ok((0, messageTemplates_1.hasUnfilledToken)(`Hi ${messageTemplates_1.COACH_TOKEN}`), 'the coach token counts too');
ok(/exactly as it appears/i.test(messageTemplates_1.UNFILLED_TOKEN_NOTE), 'and the warning says what will actually be sent');
/* ── ordering ──────────────────────────────────────────────────────────── */
const jumbled = [
    { id: 'c', title: 'Zed', body: 'z', position: 100 },
    { id: 'a', title: 'Alpha', body: 'a', position: 100 },
    { id: 'b', title: 'Mid', body: 'm', position: 50 },
];
eq((0, messageTemplates_1.orderTemplates)(jumbled).map((x) => x.id).join(''), 'bac', 'position first, then name, so the order does not shuffle between reads');
eq((0, messageTemplates_1.nextPosition)([]), 100, 'the first one starts at 100');
eq((0, messageTemplates_1.nextPosition)(jumbled), 200, 'and a new one lands past the last, spaced so a coach can insert between two');
/* ── an empty library means what the read says ─────────────────────────── */
ok(/could not be read/i.test((0, messageTemplates_1.templatesEmptyLine)('error')), 'a failed read is not "you have none" — a coach told that writes a second copy of a template they already have');
ok(/no saved messages/i.test((0, messageTemplates_1.templatesEmptyLine)('ready')), 'a whole read genuinely may say so');
ok(/reading/i.test((0, messageTemplates_1.templatesEmptyLine)('loading')), 'and one in flight says so');
ok(/not all of them/i.test((0, messageTemplates_1.templatesEmptyLine)('partial')), 'and a truncated one does not claim to be the whole library');
/* ── the two tokens, and no more ───────────────────────────────────────── */
eq(messageTemplates_1.TOKENS.length, 2, 'two placeholders — every extra one is a thing that can be missing');
ok(messageTemplates_1.TOKENS.some((t) => t.token === coachShare_1.NAME_TOKEN), 'the name');
ok(messageTemplates_1.TOKENS.some((t) => t.token === messageTemplates_1.COACH_TOKEN), 'and the coach');
// The same convention the AI drafts use, so a coach who has learned it from a
// template recognises it in a draft — and so the model can be told to write a
// placeholder instead of being handed a name.
eq(coachShare_1.NAME_TOKEN, '{name}', 'one placeholder convention across the coach app');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`messageTemplates: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('messageTemplates: ok (nothing sends, an unfilled placeholder stays visible, and an unread library is not an empty one)');
