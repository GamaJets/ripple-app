"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What the invites console may honestly say about a message it did not send.
// Compile with tsc, run with node.
//
// The assertions that matter here are the ones about ABSENCE. A console with no
// transactional sender has exactly one thing it can observe — that the owner
// pressed a button in it — and the failure this suite exists to stop is that
// observation quietly widening into a claim about delivery: an empty log
// reading as "not sent", a handoff reading as "sent", a note that drops the
// words "on this browser". Every string produced here is checked for saying
// which of the three facts in the module header it is about.
const inviteDelivery_1 = require("./inviteDelivery");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const DAY = 86400000;
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const invite = (o = {}) => ({
    id: 'i1', tenantId: 't1', email: 'jane@example.com', fullName: 'Jane Okafor',
    planId: null, planName: null, invitedBy: null, token: null,
    status: 'pending', createdAt: iso(NOW - 2 * DAY), expiresAt: iso(NOW + 28 * DAY),
    acceptedAt: null, acceptedBy: null, ...o,
});
/** A localStorage that can be told to fail, which is the private-window case. */
function store(initial, mode = 'ok') {
    let held = initial ?? null;
    return {
        getItem() { if (mode === 'throws')
            throw new Error('denied'); return held; },
        setItem(_k, v) { if (mode === 'throws')
            throw new Error('quota'); held = v; },
        get last() { return held; },
    };
}
/* ── the key is per gym ─────────────────────────────────────────────────── */
ok((0, inviteDelivery_1.handoffKey)('gym-a') !== (0, inviteDelivery_1.handoffKey)('gym-b'), 'two gyms do not share one log');
/* ── reading a log back ─────────────────────────────────────────────────── */
const good = { i1: { how: 'mail', at: iso(NOW - DAY) } };
eq((0, inviteDelivery_1.readHandoffs)(store(JSON.stringify(good)), 't1').i1?.how, 'mail', 'a written log reads back');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store(null), 't1')).length, 0, 'nothing stored is an empty log');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store('{not json'), 't1')).length, 0, 'unparseable is an empty log, not a throw');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store('[1,2,3]'), 't1')).length, 0, 'an array is not a log');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store(undefined, 'throws'), 't1')).length, 0, 'a private window that refuses getItem gives an empty log rather than an exception');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(null, 't1')).length, 0, 'no store at all is an empty log');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store(JSON.stringify(good)), '')).length, 0, 'no gym, no log');
// A row written by some other shape of this module is dropped rather than
// carried through as a half-record that renders as an empty sentence.
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store('{"i1":{"how":"carrier pigeon","at":"2026-01-01T00:00:00Z"}}'), 't1')).length, 0, 'an unknown channel is dropped');
eq(Object.keys((0, inviteDelivery_1.readHandoffs)(store('{"i1":{"how":"mail","at":"never"}}'), 't1')).length, 0, 'an unparseable instant is dropped');
/* ── writing ────────────────────────────────────────────────────────────── */
const s = store();
eq((0, inviteDelivery_1.writeHandoffs)(s, 't1', good), true, 'a write that lands says so');
eq((0, inviteDelivery_1.readHandoffs)(s, 't1').i1?.at, good.i1.at, 'and reads back identically');
eq((0, inviteDelivery_1.writeHandoffs)(store(undefined, 'throws'), 't1', good), false, 'a refused write says so rather than throwing — the handoff happened, the note did not survive');
/* ── noting a handoff ───────────────────────────────────────────────────── */
const one = (0, inviteDelivery_1.noteHandoff)({}, ['i1'], 'clipboard', iso(NOW));
eq(one.i1?.how, 'clipboard', 'copying is recorded as copying');
// Pure: the input is not mutated, so a render that holds the old log holds the
// old log.
eq(Object.keys((0, inviteDelivery_1.noteHandoff)(one, ['i2'], 'mail', iso(NOW))).length, 2, 'a second invitation joins it');
eq(Object.keys(one).length, 1, 'and the log it was derived from is unchanged');
const again = (0, inviteDelivery_1.noteHandoff)(one, ['i1'], 'mail', iso(NOW + DAY));
eq(again.i1?.how, 'mail', 'the latest handoff replaces the earlier one');
eq(Object.keys(again).length, 1, 'rather than accumulating a history of button presses');
eq(Object.keys((0, inviteDelivery_1.noteHandoff)({}, [''], 'mail', iso(NOW))).length, 0, 'a blank id is not an invitation');
eq(Object.keys((0, inviteDelivery_1.pruneHandoffs)(again, ['i1'])).length, 1, 'a live invitation keeps its note');
eq(Object.keys((0, inviteDelivery_1.pruneHandoffs)(again, ['i9'])).length, 0, 'a note about a row that is gone is dropped');
/* ── how long ago ───────────────────────────────────────────────────────── */
eq((0, inviteDelivery_1.daysSince)(iso(NOW - 3 * DAY), NOW), 3, 'three days ago');
eq((0, inviteDelivery_1.daysSince)(iso(NOW - 3600000), NOW), 0, 'this morning is 0 days, not a fraction');
eq((0, inviteDelivery_1.daysSince)(null, NOW), null, 'no instant, no answer');
eq((0, inviteDelivery_1.daysSince)('whenever', NOW), null, 'an unparseable instant is unknown, not 0');
// A laptop whose clock is behind the server's would otherwise produce "copied
// in −1 days", which reads as a fault rather than as a clock.
eq((0, inviteDelivery_1.daysSince)(iso(NOW + 2 * DAY), NOW), 0, 'a future instant is 0, never negative');
/* ── the note, which may never say "sent" ───────────────────────────────── */
const noNote = (0, inviteDelivery_1.handoffNote)(null, NOW);
eq(noNote, 'not from this browser', 'no record is a statement about this browser');
ok(!/\bsent\b/i.test(noNote), 'and never a statement that nothing was sent');
for (const h of [
    { how: 'mail', at: iso(NOW) },
    { how: 'clipboard', at: iso(NOW - DAY) },
    { how: 'bulk', at: iso(NOW - 9 * DAY) },
]) {
    const note = (0, inviteDelivery_1.handoffNote)(h, NOW);
    ok(note.includes('on this browser'), `"${note}" says which browser it is about`);
    ok(!/\b(sent|delivered|received)\b/i.test(note), `"${note}" does not claim delivery`);
}
ok((0, inviteDelivery_1.handoffNote)({ how: 'mail', at: iso(NOW) }, NOW).includes('today'), 'today reads as today');
ok((0, inviteDelivery_1.handoffNote)({ how: 'mail', at: iso(NOW - DAY) }, NOW).includes('yesterday'), 'yesterday reads as yesterday');
ok((0, inviteDelivery_1.handoffNote)({ how: 'clipboard', at: iso(NOW - 4 * DAY) }, NOW).includes('4 days ago'), 'and further back in days');
ok((0, inviteDelivery_1.handoffNote)({ how: 'mail', at: 'nonsense' }, NOW).includes('at some point'), 'an unusable instant still produces a sentence, and does not claim a day');
/* ── who is worth chasing ───────────────────────────────────────────────── */
const week = inviteDelivery_1.REMIND_AFTER_DAYS;
eq((0, inviteDelivery_1.remindable)(invite({ createdAt: iso(NOW - (week + 1) * DAY) }), null, NOW), true, 'an invitation written over a week ago and never handed off from here is exactly the one to chase');
eq((0, inviteDelivery_1.remindable)(invite({ createdAt: iso(NOW - 2 * DAY) }), null, NOW), false, 'two days is not a chase');
// The one a "count from the handoff" rule alone would get wrong: it never
// happened, so there is nothing to count from, and the invitation would sit
// there forever.
eq((0, inviteDelivery_1.remindable)(invite({ createdAt: iso(NOW - 40 * DAY), expiresAt: iso(NOW + DAY) }), { how: 'mail', at: iso(NOW - DAY) }, NOW), false, 'chased yesterday is not chased again today, however old the row is');
eq((0, inviteDelivery_1.remindable)(invite({ createdAt: iso(NOW - 40 * DAY), expiresAt: iso(NOW + DAY) }), { how: 'mail', at: iso(NOW - (week + 2) * DAY) }, NOW), true, 'a handoff that is itself over a week old is chaseable again');
eq((0, inviteDelivery_1.remindable)(invite({ status: 'accepted', createdAt: iso(NOW - 40 * DAY) }), null, NOW), false, 'somebody who joined is a member, not an invitation to chase');
eq((0, inviteDelivery_1.remindable)(invite({ status: 'revoked', createdAt: iso(NOW - 40 * DAY) }), null, NOW), false, 'a withdrawn invitation was a decision');
eq((0, inviteDelivery_1.remindable)(invite({ createdAt: iso(NOW - 40 * DAY), expiresAt: iso(NOW - DAY) }), null, NOW), false, 'a lapsed one is reopened, not chased — a chase would send a dead link');
/* ── the second message ─────────────────────────────────────────────────── */
eq((0, inviteDelivery_1.reminderSubject)('Iron Yard'), 'Your invitation to Iron Yard is still open', 'named after the gym');
ok(!(0, inviteDelivery_1.reminderSubject)(null).includes('undefined'), 'and a gym with no name still gets a sentence');
ok(!(0, inviteDelivery_1.reminderSubject)('   ').includes('   '), 'blank is the same fact as absent');
const body = (0, inviteDelivery_1.reminderMessage)(invite(), { gymName: 'Iron Yard', siteUrl: 'https://ironyard.example' }, NOW);
ok(body.includes('jane@example.com'), 'the exact address is in the message — the only failure mode of this mechanism');
ok(body.includes('Jane Okafor'), 'and the name when the gym has one');
ok(body.includes('28 days'), 'the expiry is stated');
ok(body.includes('https://ironyard.example'), "the brand's own site, never a hardcoded one — a chain must not link its members to its supplier");
ok(!/\bagain\b/i.test(body) && !/ignor/i.test(body), 'and it never accuses somebody of ignoring a message this console cannot prove arrived');
const lapsed = (0, inviteDelivery_1.reminderMessage)(invite({ expiresAt: iso(NOW - DAY) }), { gymName: 'Iron Yard' }, NOW);
ok(lapsed.includes('lapsed'), 'a lapsed invitation says so rather than sending a dead link silently');
const noExpiry = (0, inviteDelivery_1.reminderMessage)(invite({ expiresAt: null }), { gymName: 'Iron Yard' }, NOW);
ok(!/open for another/.test(noExpiry) && !/lapsed/.test(noExpiry), 'no expiry recorded means no deadline is invented in either direction');
const nameless = (0, inviteDelivery_1.reminderMessage)(invite({ fullName: null }), {}, NOW);
ok(nameless.startsWith('Hi,'), 'no name, no invented one');
ok(nameless.includes('your gym'), 'and no gym name is described rather than left as a hole');
const link = (0, inviteDelivery_1.reminderMailto)(invite(), { gymName: 'Iron Yard' }, NOW);
ok(link.startsWith('mailto:jane%40example.com?'), 'addressed to the invitee');
ok(link.includes('subject=') && link.includes('body='), 'with the whole thing filled in');
// The newlines are the difference between a message with paragraphs and one
// run-on line, and %0A is what carries them through a mailto.
ok(link.includes('%0A'), 'and the paragraphs survive the encoding');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('inviteDelivery.test.ts — all assertions passed');
