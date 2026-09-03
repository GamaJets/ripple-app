"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for photoInbox — the coach's side of a shared progress photo.
//
// The assertions that earn this file are the negative ones. It is easy to
// check that a live link comes back; what has to hold is that there is NO
// input for which an expired link, a missing file, a failed read or a severed
// coaching link produces a string a screen could render, or a sentence that
// says the client sent nothing. Those are the four ways this feature shows
// somebody's body to a person they took it back from, or accuses a client of
// having shared nothing when the truth was an error.
//
// Compile with tsc then run with node, like logic.test.ts.
const photoInbox_1 = require("./photoInbox");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const T0 = Date.parse('2026-08-29T09:00:00.000Z');
const TTL = 5 * 60; // photoShare.SHARED_URL_TTL_S
const photo = (p = {}) => ({
    id: 'p1',
    path: 'c1/1-abc.jpg',
    takenAt: '2026-07-18T07:30:00.000Z',
    sharedAt: '2026-08-29T08:55:00.000Z',
    link: (0, photoInbox_1.signedLink)('https://signed/p1', T0, TTL),
    ...p,
});
const inbox = (i = {}) => ({
    clientId: 'c1',
    coachId: 'coach1',
    linkActive: true,
    photos: [photo()],
    readAtMs: T0,
    ...i,
});
// ── a link is a photo for five minutes, and then it is not ──
const live = (0, photoInbox_1.signedLink)('https://signed/p1', T0, TTL);
ok(live !== null && live.expiresAtMs === T0 + TTL * 1000, 'a link expires one TTL after it was minted');
ok((0, photoInbox_1.liveUrl)(live, T0) === 'https://signed/p1', 'a fresh link hands back its url');
ok((0, photoInbox_1.liveUrl)(live, T0 + TTL * 1000) === null, 'a spent signature hands back nothing');
ok((0, photoInbox_1.liveUrl)(live, T0 + TTL * 1000 - photoInbox_1.LINK_MARGIN_MS + 1) === null, 'a link inside the margin is already treated as gone, not as nearly good');
ok((0, photoInbox_1.liveUrl)(null, T0) === null, 'no link is not a url');
// The property the whole module exists for: across every state a tile can be
// in, at every instant from mint to well past expiry, the only string that can
// reach a screen is a live signature.
const everyLink = [live, (0, photoInbox_1.signedLink)(null, T0, TTL), (0, photoInbox_1.signedLink)('https://signed/p2', T0, 0)];
const everyInstant = [T0 - 1000, T0, T0 + 60000, T0 + TTL * 1000 - 1, T0 + TTL * 1000, T0 + 3600000];
ok(everyLink.every((l) => everyInstant.every((n) => {
    const u = (0, photoInbox_1.liveUrl)(l, n);
    return u === null || (l !== null && u === l.url && n + photoInbox_1.LINK_MARGIN_MS < l.expiresAtMs);
})), 'no link and no instant produces a url that is not a comfortably live one');
ok((0, photoInbox_1.signedLink)(null, T0, TTL) === null, 'a file that would not sign has no link');
ok((0, photoInbox_1.signedLink)('https://signed/p1', Number.NaN, TTL) === null, 'a link with no honest mint time is no link');
ok((0, photoInbox_1.signedLink)('https://signed/p1', T0, 0) === null, 'a zero-length signature is not a link');
// ── the three tile states are three different sentences ──
ok((0, photoInbox_1.linkState)(live, T0) === 'live', 'a signed, unexpired file is live');
ok((0, photoInbox_1.linkState)(live, T0 + TTL * 1000) === 'expired', 'a lapsed signature is expired, which will fix itself');
ok((0, photoInbox_1.linkState)(null, T0) === 'missing', 'a file that would not sign is missing, which will not');
// ── refresh cadence: inside the signature, never a busy loop ──
ok((0, photoInbox_1.refreshEveryMs)(TTL) < TTL * 1000, 'the list is re-asked before its links can lapse');
ok((0, photoInbox_1.refreshEveryMs)(1) >= 30000, 'a short TTL cannot turn the refresh into a hammering loop');
ok((0, photoInbox_1.inboxStale)(null, T0, TTL), 'a list that was never read is stale, not fresh by default');
ok(!(0, photoInbox_1.inboxStale)(inbox(), T0 + 1000, TTL), 'a list read a second ago is not stale');
ok((0, photoInbox_1.inboxStale)(inbox(), T0 + (0, photoInbox_1.refreshEveryMs)(TTL), TTL), 'a list is stale once its refresh is due');
// ── counts are never invented ──
ok((0, photoInbox_1.unusableCount)(null, T0) === null, 'nothing read is not zero unusable');
ok((0, photoInbox_1.unusableCount)(inbox(), T0) === 0, 'a live list has nothing unusable');
ok((0, photoInbox_1.unusableCount)(inbox({ photos: [photo(), photo({ id: 'p2', link: null })] }), T0) === 1, 'a file that would not sign counts as unusable');
ok((0, photoInbox_1.unusableCount)(inbox(), T0 + TTL * 1000) === 1, 'every tile is unusable once the signatures behind them have lapsed');
// ── an empty list is three different facts ──
ok((0, photoInbox_1.emptyReason)(null) === 'unknown', 'a list that has not come back says nothing about the client');
ok((0, photoInbox_1.emptyReason)(inbox({ photos: [], linkActive: false })) === 'unlinked', 'no live coaching link explains an empty list without blaming the client');
ok((0, photoInbox_1.emptyReason)(inbox({ photos: [] })) === 'none', 'a linked client with no grants has genuinely sent nothing');
ok((0, photoInbox_1.emptyReason)(inbox()) === null, 'a list with photos in it is not empty');
// The severed link outranks the empty list: order matters, because both are
// true at once and only one of them is the reason.
ok((0, photoInbox_1.emptyReason)(inbox({ photos: [photo()], linkActive: false })) === 'unlinked', 'a severed link is the reason even when rows are somehow still held');
ok((0, photoInbox_1.inboxNote)(null) === null, 'no note is claimed before anything is known');
ok((0, photoInbox_1.inboxNote)(inbox({ photos: [] })) === 'None sent', 'an empty linked list says so plainly');
ok((0, photoInbox_1.inboxNote)(inbox()) === '1 photo', 'one photo is one photo');
ok((0, photoInbox_1.inboxNote)(inbox({ photos: [photo(), photo({ id: 'p2' })] })) === '2 photos', 'two photos are counted');
ok((0, photoInbox_1.inboxNote)(inbox({ linkActive: false })) === null, 'no count is offered for a client this coach is not linked to');
// ── the list's age is stated, not implied ──
ok((0, photoInbox_1.checkedNote)(null, T0) === null, 'an unread list has no age');
ok((0, photoInbox_1.checkedNote)(inbox(), T0 + 5000) === 'Checked just now', 'seconds old reads as just now');
ok((0, photoInbox_1.checkedNote)(inbox(), T0 + 60000) === 'Checked 1 minute ago', 'a minute is singular');
ok((0, photoInbox_1.checkedNote)(inbox(), T0 + 185000) === 'Checked 3 minutes ago', 'minutes are floored, never rounded up');
ok((0, photoInbox_1.checkedNote)(inbox(), T0 - 90000) === 'Checked just now', 'a clock that jumped backwards does not produce a list from the future');
// ── the two dates are not the same date ──
ok((0, photoInbox_1.gapDays)('2026-07-18T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 42, 'six weeks between the shot and the send is six weeks');
ok((0, photoInbox_1.gapDays)('2026-08-29T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === null, 'a same-day send has no gap to report');
ok((0, photoInbox_1.gapDays)('not a date', '2026-08-29T08:55:00.000Z') === null, 'an unparseable date yields no figure');
ok((0, photoInbox_1.gapDays)('2026-08-29T08:55:00.000Z', '2026-07-18T07:30:00.000Z') === null, 'a send that precedes the shot is a record this screen will not narrate');
ok((0, photoInbox_1.gapNote)('2026-07-18T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 'Taken 42 days before it was sent', 'the gap is spelled out on the tile');
ok((0, photoInbox_1.gapNote)('2026-08-28T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 'Taken the day before it was sent', 'one day is not "1 days"');
ok((0, photoInbox_1.gapNote)('2026-08-29T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === null, 'same-day sends carry no line');
// ── a date is a date or it is nothing ──
ok((0, photoInbox_1.stamp)('nonsense') === null, 'an unparseable timestamp has no readable date');
ok((0, photoInbox_1.stamp)('2026-07-18T07:30:00.000Z') !== null, 'a real timestamp has one');
ok(((0, photoInbox_1.stamp)('2026-07-18T07:30:00.000Z') ?? '').includes('2026'), 'the year is on the face of it — a coach reading a photo date needs to know it is not this year');
// ── order is by the send, and it does not wobble ──
const ordered = (0, photoInbox_1.newestSharedFirst)([
    { id: 'a', sharedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c', sharedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'b', sharedAt: '2026-02-01T00:00:00.000Z' },
]);
ok(ordered.map((r) => r.id).join(',') === 'c,b,a', 'the most recently sent is first');
const tied = (0, photoInbox_1.newestSharedFirst)([
    { id: 'z', sharedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'a', sharedAt: '2026-03-01T00:00:00.000Z' },
]);
ok(tied.map((r) => r.id).join(',') === 'a,z', 'two sends at the same instant hold a stable order');
// ── a photo that leaves the list leaves the viewer ──
ok((0, photoInbox_1.stillShared)('p1', inbox()), 'a listed photo is still shared');
ok(!(0, photoInbox_1.stillShared)('p1', inbox({ photos: [] })), 'a photo that has left the list is not still shared');
ok(!(0, photoInbox_1.stillShared)('p1', null), 'with no list there is nothing to keep open');
ok(/took it back/.test((0, photoInbox_1.withdrawnNote)()) && /deleted/.test((0, photoInbox_1.withdrawnNote)()), 'the withdrawal sentence names both possibilities rather than picking one it cannot know');
if (errors.length) {
    console.error(`photoInbox: ${errors.length} failing assertion${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('photoInbox ok — expiry, freshness, the two dates, and the four ways to be empty.');
