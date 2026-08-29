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
import {
  signedLink, liveUrl, linkState, refreshEveryMs, inboxStale, unusableCount,
  stillShared, withdrawnNote, emptyReason, inboxNote, checkedNote,
  gapDays, gapNote, stamp, newestSharedFirst, LINK_MARGIN_MS,
  type Inbox, type InboxPhoto,
} from './photoInbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const T0 = Date.parse('2026-08-29T09:00:00.000Z');
const TTL = 5 * 60; // photoShare.SHARED_URL_TTL_S

const photo = (p: Partial<InboxPhoto> = {}): InboxPhoto => ({
  id: 'p1',
  path: 'c1/1-abc.jpg',
  takenAt: '2026-07-18T07:30:00.000Z',
  sharedAt: '2026-08-29T08:55:00.000Z',
  link: signedLink('https://signed/p1', T0, TTL),
  ...p,
});

const inbox = (i: Partial<Inbox> = {}): Inbox => ({
  clientId: 'c1',
  coachId: 'coach1',
  linkActive: true,
  photos: [photo()],
  readAtMs: T0,
  ...i,
});

// ── a link is a photo for five minutes, and then it is not ──
const live = signedLink('https://signed/p1', T0, TTL);
ok(live !== null && live.expiresAtMs === T0 + TTL * 1000, 'a link expires one TTL after it was minted');
ok(liveUrl(live, T0) === 'https://signed/p1', 'a fresh link hands back its url');
ok(liveUrl(live, T0 + TTL * 1000) === null, 'a spent signature hands back nothing');
ok(liveUrl(live, T0 + TTL * 1000 - LINK_MARGIN_MS + 1) === null,
   'a link inside the margin is already treated as gone, not as nearly good');
ok(liveUrl(null, T0) === null, 'no link is not a url');

// The property the whole module exists for: across every state a tile can be
// in, at every instant from mint to well past expiry, the only string that can
// reach a screen is a live signature.
const everyLink = [live, signedLink(null, T0, TTL), signedLink('https://signed/p2', T0, 0)];
const everyInstant = [T0 - 1000, T0, T0 + 60_000, T0 + TTL * 1000 - 1, T0 + TTL * 1000, T0 + 3600_000];
ok(everyLink.every((l) => everyInstant.every((n) => {
  const u = liveUrl(l, n);
  return u === null || (l !== null && u === l.url && n + LINK_MARGIN_MS < l.expiresAtMs);
})), 'no link and no instant produces a url that is not a comfortably live one');

ok(signedLink(null, T0, TTL) === null, 'a file that would not sign has no link');
ok(signedLink('https://signed/p1', Number.NaN, TTL) === null, 'a link with no honest mint time is no link');
ok(signedLink('https://signed/p1', T0, 0) === null, 'a zero-length signature is not a link');

// ── the three tile states are three different sentences ──
ok(linkState(live, T0) === 'live', 'a signed, unexpired file is live');
ok(linkState(live, T0 + TTL * 1000) === 'expired', 'a lapsed signature is expired, which will fix itself');
ok(linkState(null, T0) === 'missing', 'a file that would not sign is missing, which will not');

// ── refresh cadence: inside the signature, never a busy loop ──
ok(refreshEveryMs(TTL) < TTL * 1000, 'the list is re-asked before its links can lapse');
ok(refreshEveryMs(1) >= 30_000, 'a short TTL cannot turn the refresh into a hammering loop');
ok(inboxStale(null, T0, TTL), 'a list that was never read is stale, not fresh by default');
ok(!inboxStale(inbox(), T0 + 1000, TTL), 'a list read a second ago is not stale');
ok(inboxStale(inbox(), T0 + refreshEveryMs(TTL), TTL), 'a list is stale once its refresh is due');

// ── counts are never invented ──
ok(unusableCount(null, T0) === null, 'nothing read is not zero unusable');
ok(unusableCount(inbox(), T0) === 0, 'a live list has nothing unusable');
ok(unusableCount(inbox({ photos: [photo(), photo({ id: 'p2', link: null })] }), T0) === 1,
   'a file that would not sign counts as unusable');
ok(unusableCount(inbox(), T0 + TTL * 1000) === 1,
   'every tile is unusable once the signatures behind them have lapsed');

// ── an empty list is three different facts ──
ok(emptyReason(null) === 'unknown', 'a list that has not come back says nothing about the client');
ok(emptyReason(inbox({ photos: [], linkActive: false })) === 'unlinked',
   'no live coaching link explains an empty list without blaming the client');
ok(emptyReason(inbox({ photos: [] })) === 'none', 'a linked client with no grants has genuinely sent nothing');
ok(emptyReason(inbox()) === null, 'a list with photos in it is not empty');
// The severed link outranks the empty list: order matters, because both are
// true at once and only one of them is the reason.
ok(emptyReason(inbox({ photos: [photo()], linkActive: false })) === 'unlinked',
   'a severed link is the reason even when rows are somehow still held');

ok(inboxNote(null) === null, 'no note is claimed before anything is known');
ok(inboxNote(inbox({ photos: [] })) === 'None sent', 'an empty linked list says so plainly');
ok(inboxNote(inbox()) === '1 photo', 'one photo is one photo');
ok(inboxNote(inbox({ photos: [photo(), photo({ id: 'p2' })] })) === '2 photos', 'two photos are counted');
ok(inboxNote(inbox({ linkActive: false })) === null, 'no count is offered for a client this coach is not linked to');

// ── the list's age is stated, not implied ──
ok(checkedNote(null, T0) === null, 'an unread list has no age');
ok(checkedNote(inbox(), T0 + 5_000) === 'Checked just now', 'seconds old reads as just now');
ok(checkedNote(inbox(), T0 + 60_000) === 'Checked 1 minute ago', 'a minute is singular');
ok(checkedNote(inbox(), T0 + 185_000) === 'Checked 3 minutes ago', 'minutes are floored, never rounded up');
ok(checkedNote(inbox(), T0 - 90_000) === 'Checked just now',
   'a clock that jumped backwards does not produce a list from the future');

// ── the two dates are not the same date ──
ok(gapDays('2026-07-18T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 42,
   'six weeks between the shot and the send is six weeks');
ok(gapDays('2026-08-29T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === null, 'a same-day send has no gap to report');
ok(gapDays('not a date', '2026-08-29T08:55:00.000Z') === null, 'an unparseable date yields no figure');
ok(gapDays('2026-08-29T08:55:00.000Z', '2026-07-18T07:30:00.000Z') === null,
   'a send that precedes the shot is a record this screen will not narrate');
ok(gapNote('2026-07-18T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 'Taken 42 days before it was sent',
   'the gap is spelled out on the tile');
ok(gapNote('2026-08-28T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === 'Taken the day before it was sent',
   'one day is not "1 days"');
ok(gapNote('2026-08-29T07:30:00.000Z', '2026-08-29T08:55:00.000Z') === null, 'same-day sends carry no line');

// ── a date is a date or it is nothing ──
ok(stamp('nonsense') === null, 'an unparseable timestamp has no readable date');
ok(stamp('2026-07-18T07:30:00.000Z') !== null, 'a real timestamp has one');
ok((stamp('2026-07-18T07:30:00.000Z') ?? '').includes('2026'),
   'the year is on the face of it — a coach reading a photo date needs to know it is not this year');

// ── order is by the send, and it does not wobble ──
const ordered = newestSharedFirst([
  { id: 'a', sharedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'c', sharedAt: '2026-03-01T00:00:00.000Z' },
  { id: 'b', sharedAt: '2026-02-01T00:00:00.000Z' },
]);
ok(ordered.map((r) => r.id).join(',') === 'c,b,a', 'the most recently sent is first');
const tied = newestSharedFirst([
  { id: 'z', sharedAt: '2026-03-01T00:00:00.000Z' },
  { id: 'a', sharedAt: '2026-03-01T00:00:00.000Z' },
]);
ok(tied.map((r) => r.id).join(',') === 'a,z', 'two sends at the same instant hold a stable order');

// ── a photo that leaves the list leaves the viewer ──
ok(stillShared('p1', inbox()), 'a listed photo is still shared');
ok(!stillShared('p1', inbox({ photos: [] })), 'a photo that has left the list is not still shared');
ok(!stillShared('p1', null), 'with no list there is nothing to keep open');
ok(/took it back/.test(withdrawnNote()) && /deleted/.test(withdrawnNote()),
   'the withdrawal sentence names both possibilities rather than picking one it cannot know');

if (errors.length) {
  console.error(`photoInbox: ${errors.length} failing assertion${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('photoInbox ok — expiry, freshness, the two dates, and the four ways to be empty.');
