"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Which notifications a coach is told about. Compile with tsc, run with node.
//
// The rule that carries the weight here is the one the settings screen would
// otherwise get wrong: AN UNREAD PREFERENCE IS NOT "OPTED IN".
//
// The muted set is empty under 'loading' and under 'error', and an empty muted
// set means "everything on". A screen that only read the set would draw five
// switches in the on position over a read that never happened — the app stating
// five facts about somebody's settings that it has not looked up, on the screen
// they came to in order to control them, and a coach who then taps one has just
// saved the guess. `channelState` is where that is prevented and it takes the
// status first for that reason.
//
// The mirror rule is on the send side: no row is not an answer. The product
// default is on, and the edge function's filter and this switch have to agree —
// a screen showing "on" while the server suppressed the push would be the
// master switch's original bug pointing the other way.
const coachNotify_1 = require("./coachNotify");
const coachReminders_1 = require("./coachReminders");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the catalogue ─────────────────────────────────────────────────────── */
eq(coachNotify_1.COACH_CHANNELS.length, 6, 'six channels');
const keys = coachNotify_1.COACH_CHANNELS.map((c) => c.key);
eq(new Set(keys).size, 6, 'each named once');
for (const k of ['chat', 'bookings', 'money', 'clients', 'admin', 'book']) {
    ok(keys.includes(k), `${k} is one of them`);
    ok((0, coachNotify_1.channelDef)(k) != null, `and has a definition`);
}
eq((0, coachNotify_1.channelDef)('nonsense'), null, 'a channel this build has never heard of has no definition');
// ── the sixth, and why the first five were all one thing ────────────────
//
// Every one of the first five is somebody ELSE doing something, and that was
// not a decision about what a coach wants to know — it is the whole of what the
// platform could tell them, because another person's action is what a trigger
// needs in order to exist. So the coach heard about everything their clients
// did and nothing about their own book going wrong.
eq(coachNotify_1.COACH_CHANNELS.filter((c) => c.local).length, 1, 'exactly one channel is worked out by the handset');
eq(coachNotify_1.COACH_CHANNELS.find((c) => c.local)?.key, 'book', 'and it is the coach\'s own book, which has no other person\'s action behind it to hang a trigger on');
for (const c of coachNotify_1.COACH_CHANNELS) {
    if (c.key === 'book')
        continue;
    eq(c.local, false, `${c.key} is remote and its preference is applied where the recipients are resolved`);
}
// The quiet cost is a SENTENCE per channel and not a shared one, because a
// second channel earned it and the two costs are different things.
const costly = coachNotify_1.COACH_CHANNELS.filter((c) => c.quietCost);
eq(costly.length, 2, 'two channels hurt quietly, and no more — six identical warnings is a wall nobody reads');
eq(costly.map((c) => c.key).join(','), 'money,book', 'money and the coach\'s own book: a declined card and an unmarked session are both invisible until somebody goes looking');
eq(new Set(costly.map((c) => c.quietCost)).size, 2, 'and they say DIFFERENT things — one shared warning would have named the wrong consequence under one of them');
ok(/statement|revenue/i.test(coachNotify_1.CHANNEL_QUIET_COST_BOOK), 'the book warning names what an unmarked session actually costs');
ok(!/personalis|personaliz|may miss/i.test(coachNotify_1.CHANNEL_QUIET_COST_BOOK), 'and does not soften it');
/* ── the coach's own book, as one banner ───────────────────────────────── */
const NOTHING = {
    unmarkedSessions: 0, invoicesOverdue: 0, clientsDrifting: 0, packsRunningOut: 0,
};
eq((0, coachNotify_1.bookAlert)(NOTHING), null, 'a book with nothing wrong in it is not news and gets no banner');
// THE rule. Every figure is null when its read did not answer, and a banner
// about a coach's own business composed out of a failed query is how somebody
// learns to ignore the next one — and the next one is the one that matters.
const UNKNOWN = {
    unmarkedSessions: null, invoicesOverdue: null, clientsDrifting: null, packsRunningOut: null,
};
eq((0, coachNotify_1.bookAlert)(UNKNOWN), null, 'and neither is a book nobody could read — null never prompts');
eq((0, coachNotify_1.bookAlert)({ ...UNKNOWN, invoicesOverdue: 2 })?.title, '2 invoices past their due date', 'a caller that read one of the four and not the others still gets the one it read');
// One banner, not four. A phone that fires four notifications about the same
// business on the same morning is a phone whose notifications get turned off,
// and turning them off is how the money channel went down with the chat one.
const everything = {
    unmarkedSessions: 9, invoicesOverdue: 2, clientsDrifting: 4, packsRunningOut: 1,
};
const all = (0, coachNotify_1.bookAlert)(everything);
ok(all != null, 'a book with four things wrong in it still gets a banner');
ok(/9 sessions/.test(all.title), 'and the unmarked queue leads, because it is somebody\'s pay held up');
ok(/2 overdue invoice/.test(all.body) && /1 pack/.test(all.body) && /4 clients/.test(all.body), 'while the other three are counted after it rather than dropped');
// The unmarked wording is `backlogBody`'s and not a second copy of it: that
// sentence names the CONSEQUENCE rather than the chore, and it was the whole of
// this channel before the channel had a name.
ok(all.body.startsWith((0, coachReminders_1.backlogBody)(9)), 'and the sentence itself comes from src/lib/coachReminders.ts');
// The order is by what it costs to leave alone, and each step down is only
// reached when everything above it is clear.
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, invoicesOverdue: 3, clientsDrifting: 1 })?.title, '3 invoices past their due date', 'with nothing unmarked, the money already earned speaks');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, packsRunningOut: 2, clientsDrifting: 1 })?.title, '2 packs about to run out', 'then a client about to arrive with nothing left to draw on');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, clientsDrifting: 1 })?.title, '1 client has gone quiet', 'and drift last, which is the slowest of the four and has a screen of its own');
// Singulars read as singulars. This is a banner on a lock screen and "1
// invoices past their due date" is the kind of thing that makes a coach trust
// the number less.
ok(!/s past their/.test((0, coachNotify_1.bookAlert)({ ...NOTHING, invoicesOverdue: 1 }).title), 'one invoice is singular');
ok(/have gone quiet/.test((0, coachNotify_1.bookAlert)({ ...NOTHING, clientsDrifting: 2 }).title), 'and two clients are plural');
// The floors. Everything takes one, EXCEPT the unmarked queue, which keeps the
// bar it was already given in src/lib/coachReminders.ts — imported rather than
// restated, because "below this it is a normal week's work" is one decision.
eq(coachNotify_1.BOOK_FLOOR, 1, 'one overdue invoice is worth saying to a coach with three clients');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, unmarkedSessions: coachReminders_1.BACKLOG_FLOOR - 1 }), null, 'a queue below the backlog floor is a normal week and says nothing');
ok((0, coachNotify_1.bookAlert)({ ...NOTHING, unmarkedSessions: coachReminders_1.BACKLOG_FLOOR }) != null, 'and at the floor it does');
// A sub-floor queue must not silence the rest of the book either.
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, unmarkedSessions: coachReminders_1.BACKLOG_FLOOR - 1, invoicesOverdue: 1 })?.title, '1 invoice past its due date', 'and a queue too small to mention does not swallow an overdue invoice');
// Never a cheerful all-clear. A notification saying nothing is wrong is
// indistinguishable from one composed out of four failed reads.
for (const st of [NOTHING, UNKNOWN]) {
    eq((0, coachNotify_1.bookAlert)(st), null, 'nothing to say produces no banner rather than an all-clear');
}
// ── where the tap lands ──────────────────────────────────────────────────
//
// src/ui/coachReminders.ts passed '/(trainer)/sessions' for every one of these,
// so three of the four opened a screen with nothing on it about what they had
// just said. Asserted per branch rather than as "there is a route", because the
// defect was not a missing route — it was the same right-for-one-case route on
// all four.
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, unmarkedSessions: coachReminders_1.BACKLOG_FLOOR })?.route, '/(trainer)/sessions', 'the unmarked queue opens the screen you clear it on');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, invoicesOverdue: 3 })?.route, '/(trainer)/invoices', 'money already earned opens the book it is aged in, not Mark Sessions');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, packsRunningOut: 2 })?.route, '/(trainer)/payments', 'a pack running out opens where the server’s own notice about the same fact sends a coach');
eq((0, coachNotify_1.bookAlert)({ ...NOTHING, clientsDrifting: 1 })?.route, '/(trainer)/nudges', 'and drift opens Quiet Clients, which is the screen its own body names');
// The whole point: no two branches may share a destination by accident again.
{
    const routes = [
        (0, coachNotify_1.bookAlert)({ ...NOTHING, unmarkedSessions: coachReminders_1.BACKLOG_FLOOR }).route,
        (0, coachNotify_1.bookAlert)({ ...NOTHING, invoicesOverdue: 3 }).route,
        (0, coachNotify_1.bookAlert)({ ...NOTHING, packsRunningOut: 2 }).route,
        (0, coachNotify_1.bookAlert)({ ...NOTHING, clientsDrifting: 1 }).route,
    ];
    eq(new Set(routes).size, 4, 'four things to do, four screens to do them on');
}
/* ── the stored rows ───────────────────────────────────────────────────── */
eq((0, coachNotify_1.mutedFromRows)(null).size, 0, 'nothing read is nothing muted, as a SET — the status is what says whether that is known');
eq((0, coachNotify_1.mutedFromRows)([]).size, 0, 'and an empty answer is nobody muted');
eq((0, coachNotify_1.mutedFromRows)([{ channel: 'chat', enabled: false }]).size, 1, 'an explicit false is a mute');
eq((0, coachNotify_1.mutedFromRows)([{ channel: 'chat', enabled: true }]).size, 0, 'an explicit true is not');
// Only a real boolean false counts. A string, a null or a number is damage, not
// somebody's answer about their own notifications, and reading one as a mute
// would silence a category they never touched.
for (const bad of ['false', 0, null, undefined, {}]) {
    eq((0, coachNotify_1.mutedFromRows)([{ channel: 'chat', enabled: bad }]).size, 0, `${JSON.stringify(bad)} is damage rather than an answer`);
}
// A channel a NEWER build wrote and this one does not know is dropped rather
// than kept, so it cannot mute anything here by accident.
eq((0, coachNotify_1.mutedFromRows)([{ channel: 'something_new', enabled: false }]).size, 0, 'a channel this build does not recognise mutes nothing');
/* ── THE ONE THAT MATTERS: unread is not on ────────────────────────────── */
const none = (0, coachNotify_1.mutedFromRows)([]);
eq((0, coachNotify_1.channelState)('chat', none, 'ready'), 'on', 'a whole read with no mute is genuinely on');
eq((0, coachNotify_1.channelState)('chat', (0, coachNotify_1.mutedFromRows)([{ channel: 'chat', enabled: false }]), 'ready'), 'off', 'and a mute is off');
for (const s of ['loading', 'error', 'partial']) {
    eq((0, coachNotify_1.channelState)('chat', none, s), 'unknown', `under '${s}' the switch shows neither position — an empty muted set is not five facts about somebody's settings`);
}
// Including the case that looks safe: a channel that IS muted, read short.
eq((0, coachNotify_1.channelState)('chat', (0, coachNotify_1.mutedFromRows)([{ channel: 'chat', enabled: false }]), 'partial'), 'unknown', 'a partial read is unknown even for a channel that happened to arrive — the one that did not is the one being misreported');
ok((0, coachNotify_1.channelsNote)('ready') === null, 'nothing is explained when the switches are showing real answers');
for (const s of ['loading', 'error', 'partial']) {
    ok((0, coachNotify_1.channelsNote)(s) != null, `under '${s}' the reason is on screen`);
}
ok(/saving over|save over/i.test((0, coachNotify_1.channelsNote)('error')), 'and the failed-read note warns that changing one now would write over what is stored');
ok(!/all on|everything is on/i.test((0, coachNotify_1.channelsNote)('error')), 'and never says everything is on');
ok(coachNotify_1.CHANNEL_UNKNOWN_LABEL.length > 0, 'the unknown position has a word for itself');
/* ── the send-side default, which must agree with the switch ───────────── */
eq((0, coachNotify_1.channelAllows)('money', none), true, 'a channel nobody has answered is sent — the product default is on');
eq((0, coachNotify_1.channelAllows)('money', (0, coachNotify_1.mutedFromRows)([{ channel: 'money', enabled: false }])), false, 'and a muted one is not');
// The two halves agree: `channelState` shows on for an unanswered channel under
// a whole read, and `channelAllows` sends it. A screen showing on while the
// server suppressed would be the master switch's bug pointing the other way.
for (const c of coachNotify_1.COACH_CHANNELS) {
    eq((0, coachNotify_1.channelState)(c.key, none, 'ready') === 'on', (0, coachNotify_1.channelAllows)(c.key, none), `${c.key}: what the switch shows and what the server does agree for an unanswered channel`);
}
/* ── the sentences ─────────────────────────────────────────────────────── */
ok(/Push Notifications/i.test(coachNotify_1.CHANNEL_MASTER_NOTE), 'the coach is told the master switch outranks these, because the relationship is not guessable');
ok(/notifications list|still written/i.test(coachNotify_1.CHANNEL_STILL_RECORDED), 'and that muting stops the buzz and not the record, which is what makes it safe to offer for money at all');
ok(/paying/i.test(coachNotify_1.CHANNEL_QUIET_COST), 'the money warning names the consequence rather than reassuring');
ok(!/personalis|personaliz|may miss/i.test(coachNotify_1.CHANNEL_QUIET_COST), 'and does not soften it');
ok(/account/i.test(coachNotify_1.CHANNEL_ACCOUNT_WIDE) && /phone|handset/i.test(coachNotify_1.CHANNEL_ACCOUNT_WIDE), 'and the per-account / per-handset difference is stated, because it is discovered by accident otherwise');
ok(/no signal|without signal/i.test(coachNotify_1.CHANNEL_LOCAL_NOTE) && /opened the app/i.test(coachNotify_1.CHANNEL_LOCAL_NOTE), 'the local channel says both of the things that are true only of it: it arrives offline, and it is only as current as the last time the app was opened');
ok(/account/i.test(coachNotify_1.CHANNEL_LOCAL_NOTE), 'and that the answer still follows the coach between phones, so CHANNEL_ACCOUNT_WIDE stays true of all six');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`coachNotify: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('coachNotify: ok (an unread preference shows as unread, not as on, and the switch and the server agree)');
