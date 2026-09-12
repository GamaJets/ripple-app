// The code a coach hands to somebody standing in front of them. Compile with
// tsc, run with node.
//
// ── the bug this guards ────────────────────────────────────────────────────
//
// One sentence, and it is expensive in a way nothing on the screen would ever
// show. A read of the coach's own code fails; the screen says "you have no code
// yet"; the coach presses New Code. Rotating INVALIDATES the string already
// printed on their cards and given to everybody they met last week, and it does
// it to fix a dropped request. The old code is gone, the people holding it are
// told "no coach uses that code", and nothing anywhere says the read failed.
//
// So most of what follows is one assertion written several ways: NOTHING this
// module produces under a failed or empty read may read as a coach who has no
// code. Not the heading, not the note, and not the provider's own words, which
// is the case that actually shipped — `fetchMyJoinCode` returns "…so there is
// nothing to give out yet", and pasting that above the correction was the app
// stating the false conclusion first and in its own voice.
//
// The rest pins the three states apart (loading is not failed, failed is not
// empty), and pins the LIVE-only rule on the list of named codes: this screen
// is an act, not a record, and a revoked code handed to somebody is a client
// who downloads the app, types six characters and is told the code is off.
import {
  UNREAD_NOTE, HOW_THEY_USE_IT, codeToGive, codesToHandOut, copiedNote,
  copyBlockedNote, copyFailedNote, handOut, keptReason, namedCodesLine,
  spokenCode, type CodeRead,
  codeUptakeLine, uptakeNeedsAnswering,
} from './handOutCode';
import { normaliseCode, joinLink, inviteMessage } from './joinCode';
import type { JoinCodeRow } from './joinCodes';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (over: Partial<JoinCodeRow> = {}): JoinCodeRow => ({
  id: 'id-1', code: 'K7M2QX', label: 'Gym flyer', isDefault: false,
  isLive: true, createdAt: '2026-08-01T10:00:00Z', joined: 0, pending: 0, ...over,
});

/** Every sentence a state produces, so a claim cannot hide in the one that was
 *  not looked at. */
const wordsOf = (g: ReturnType<typeof codeToGive>): string =>
  g.give ? `${g.hand.code} ${g.hand.link} ${g.hand.message}` : `${g.head} ${g.note}`;

/* ── an unread code is not a missing one ───────────────────────────────── */

// The whole file. Said three ways because there are three ways to arrive at an
// empty screen and only one of them is a fact about the coach — and none of the
// three is "you have no code", because `my_join_code()` allocates on first ask
// and a signed-in coach with a trainer profile always has one.
const failed = codeToGive({ status: 'error', reason: 'Your coaching code could not be read, so there is nothing to give out yet.' });
const empty = codeToGive({ status: 'ready', code: '' });
const waiting = codeToGive({ status: 'loading' });

for (const [name, g] of [['failed', failed], ['empty', empty], ['loading', waiting]] as const) {
  const words = wordsOf(g);
  ok(!/nothing to give out/i.test(words), `${name}: never says there is nothing to give out — got ${JSON.stringify(words)}`);
  ok(!/no code|have no|without a code/i.test(words), `${name}: never says the coach has no code`);
  ok(g.give === false, `${name}: hands nothing over`);
}

// The rotation is the thing that cannot be undone, so the note names it and
// names what it costs rather than leaving "try again" to be inferred.
ok(/still have one/i.test(UNREAD_NOTE), 'the note says the code still exists');
ok(/not changed|has not changed/i.test(UNREAD_NOTE), 'and that it has not changed');
ok(/already given out still works|already given out/i.test(UNREAD_NOTE), 'and that what is already out there still works');
ok(/stops the old one working/i.test(UNREAD_NOTE), 'and says outright what pressing New Code would cost');
ok(UNREAD_NOTE.includes(' '), 'and it is prose, not a code');

// Loading is not failed. A coach who is told the read failed while it is still
// in flight retries something that was going to arrive.
ok(!/could not|failed/i.test(waiting.give ? '' : waiting.head), 'a read in flight is not reported as a failure');
ok(waiting.give === false && waiting.why === 'reading', 'and it is marked as still reading');
ok(failed.give === false && failed.why === 'unread', 'a failed read is marked unread');
ok(empty.give === false && empty.why === 'unread', 'and so is a code that came back blank');

/* ── the provider's own words, minus the false half ────────────────────── */

// The two reasons `fetchMyJoinCode` returns on a failure both end with the one
// clause this screen must not print. Nothing is lost: `head` already says the
// read failed, which is the same fact without the conclusion attached.
eq(keptReason('Your coaching code could not be read, so there is nothing to give out yet.'), null,
  'a reason that only claims absence is dropped whole');
eq(keptReason('Your coaching code came back empty, so there is nothing to give out yet.'), null,
  'and so is the empty one');
// The third is actionable and is not a claim about whether a code exists, so it
// survives — being signed out is something the coach can do something about.
eq(keptReason('Sign in to Repple to get your coaching code.'), 'Sign in to Repple to get your coaching code.',
  'an actionable reason is kept as it was written');
// Sentence by sentence, so a future reason pairing the two still shows its
// useful half rather than being dropped or printed whole.
eq(keptReason('Sign in to Repple first. There is nothing to give out yet.'), 'Sign in to Repple first.',
  'a mixed reason keeps the half a coach can act on');
eq(keptReason(''), null, 'no reason is no sentence');
eq(keptReason(null), null, 'and neither is nothing at all');

const signedOut = codeToGive({ status: 'error', reason: 'Sign in to Repple to get your coaching code.' });
ok(!signedOut.give && signedOut.note.startsWith('Sign in'), 'the kept reason leads, because it is the thing to do next');
ok(!signedOut.give && signedOut.note.includes(UNREAD_NOTE), 'and the correction still follows it');
ok(!failed.give && failed.note === UNREAD_NOTE, 'a dropped reason leaves the correction standing alone');

/* ── a code that did arrive ────────────────────────────────────────────── */

const good = codeToGive({ status: 'ready', code: 'k7m-2qx' });
ok(good.give, 'a code that came back is handed over');
if (good.give) {
  eq(good.hand.code, 'K7M2QX', 'read out in the case it is spoken in, separators dropped');
  eq(good.hand.link, joinLink('K7M2QX'), 'the bare link is the one joinCode.ts builds');
  eq(good.hand.message, inviteMessage('K7M2QX'), 'and the message is the one every other share button sends');
  // The link and the message are both offered because they go to different
  // places: a bio field takes a URL and mangles prose around it.
  ok(good.hand.message.includes(good.hand.link), 'the message carries the link, so one share does both');
  ok(good.hand.link.includes('K7M2QX'), 'and the link carries the code, so a join through it is attributed');
}

// Spoken one character at a time. "AB4K7M" is read out by VoiceOver as a word,
// and this is a string whose whole purpose is being transcribed correctly by
// somebody who cannot see it.
eq(spokenCode('K7M2QX'), 'K 7 M 2 Q X', 'the code is spoken one character at a time');
eq(spokenCode('k7m-2qx'), 'K 7 M 2 Q X', 'however it arrived');
eq(spokenCode(''), '', 'and nothing is spoken as nothing');
eq(handOut('k7m-2qx').spoken, spokenCode('K7M2QX'), 'handOut spells it the same way');
eq(handOut('K7M2QX').code, normaliseCode('K7M2QX'), 'and normalises once, the same way as everywhere else');

/* ── the named codes are an act, not a record ──────────────────────────── */

const rows = [
  row({ id: null, code: 'DEF123', label: 'Your main code', isDefault: true }),
  row({ id: 'a', code: 'AAAAAA', label: 'Instagram bio' }),
  row({ id: 'b', code: 'BBBBBB', label: 'Old flyer', isLive: false, joined: 40 }),
  row({ id: 'c', code: 'CCCCCC', label: 'Gym flyer' }),
];
const hand = codesToHandOut(rows);
eq(hand.map((r) => r.id).join(','), 'a,c', 'only the live named codes are offered');
// A revoked code handed over is a client who downloads the app, types six
// characters and is told the code has been turned off. The Clients sheet keeps
// it visible because its count is history; this screen is not that screen.
ok(!hand.some((r) => !r.isLive), 'a turned-off code is never offered to somebody in the room');
// The default code is excluded because it is drawn above, on its own, as the
// one to reach for — listing it twice makes a coach choose between two copies
// of the same thing.
ok(!hand.some((r) => r.isDefault), 'the main code is not repeated in the list under it');
eq(codesToHandOut(null).length, 0, 'no rows hand out nothing');
eq(codesToHandOut(undefined).length, 0, 'and neither does nothing at all');
// The order shapeJoinCodes established is preserved rather than re-imposed.
eq(codesToHandOut([rows[3], rows[1]]).map((r) => r.id).join(','), 'c,a', 'the order the rows arrived in is kept');

/* ── four states, four different sentences ─────────────────────────────── */

const lines = new Map<LoadStatus, string>(
  (['loading', 'error', 'partial', 'ready'] as LoadStatus[]).map((s) => [s, namedCodesLine(s, [])]),
);
eq(new Set(lines.values()).size, 4, 'loading, failed, truncated and empty are four different sentences');

// The one that must never be said about a read that did not finish: "you have
// made none". Under a failure that is the app's own silence being reported as
// the coach's history.
for (const s of ['loading', 'error', 'partial'] as LoadStatus[]) {
  ok(!/none yet/i.test(lines.get(s)!), `${s} does not claim the coach has made no named codes`);
}
ok(/none yet/i.test(lines.get('ready')!), 'only a completed read may say there are none');
ok(/could not be read/i.test(lines.get('error')!), 'a failed read says so');
// And says what is NOT affected, because the code above it is a separate read
// and a coach who thinks everything failed puts their phone away.
ok(/above is unaffected|one above/i.test(lines.get('error')!), 'and that the main code above it is unaffected');
ok(/not all/i.test(lines.get('partial')!), 'a truncated read says it is not all of them');
ok(/looking for/i.test(lines.get('loading')!), 'and a read in flight says it is still looking');

// With live codes in hand the line stops being about the absence of them.
const listed = namedCodesLine('ready', rows);
ok(!/none yet/i.test(listed), 'a coach who has named codes is not told they have none');
ok(/counts separately|separately/i.test(listed), 'and is told what makes them worth having');
// A list of nothing but revoked codes is still an empty list to hand from.
ok(/none yet/i.test(namedCodesLine('ready', [row({ isLive: false })])),
  'a book of turned-off codes has nothing to hand over');

/* ── the clipboard this build may not have ─────────────────────────────── */

// expo-clipboard is a native module and this ships over the air, so an OTA
// landing on an older binary has no clipboard at all. Sharing is core React
// Native and is always there.
eq(copyBlockedNote(true), null, 'nothing is said when the clipboard works');
const blocked = copyBlockedNote(false) || '';
ok(/written out above|above/i.test(blocked), 'without one the address is on screen instead');
ok(/sharing still works|share/i.test(blocked), 'and the coach is told what does still work');
ok(!/error|failed|broken/i.test(blocked), 'a build without a clipboard is not a fault to report at somebody');

// A coach told "copied" who then pastes nothing has lost the post, so the
// failure carries the address itself — it is still useful to somebody with a pen.
const failedCopy = copyFailedNote(joinLink('K7M2QX'));
ok(failedCopy.includes(joinLink('K7M2QX')), 'a failed copy still gives the coach the address');
ok(/could not be copied/i.test(failedCopy), 'and says plainly that it did not land');

// The destination sentence is not a nicety: an ad pointed at a profile instead
// of at this link arrives with no code on it, and no work afterwards recovers
// which clients the money bought.
const copied = copiedNote('your main code');
ok(copied.includes('your main code'), 'the copied note names the code it attributes to');
ok(/bio|caption|description/i.test(copied), 'and says where it goes');
ok(/ad’s destination|not your profile/i.test(copied), 'and where a paid ad must point instead');

/* ── what happens after they type it ───────────────────────────────────── */

// The part nobody expects: typing the code does not put them on the roster. A
// coach who does not know that never goes looking for the request.
ok(/approve/i.test(HOW_THEY_USE_IT), 'the instructions say the coach still has to approve them');
ok(/find a trainer/i.test(HOW_THEY_USE_IT), 'and name the screen the client actually opens');
ok(/whatever address/i.test(HOW_THEY_USE_IT), 'and say the code does not care which address they signed up with');

/* ── what the code brought in, and who is waiting ────────────────────────── */

// The failed read must never read as "nobody used it". This is a claim about a
// coach's own marketing and it may not be made from a dropped request.
{
  const line = codeUptakeLine(null);
  ok(/could not be read/.test(line), 'an unread count says so');
  ok(!/\b0\b|nobody has joined/i.test(line), 'and never reports nobody having joined');
  ok(/Nothing is wrong with the code/.test(line), 'and says the code itself is unaffected');
  ok(!uptakeNeedsAnswering(null), 'an unread count is not a queue to answer');
}

// Nobody waiting is worth saying out loud — the absence of a queue is the
// answer to "is anybody waiting on me", and silence is not.
{
  const line = codeUptakeLine({ joined: 17, pending: 0 });
  ok(/17 people have joined/.test(line), 'the joined count is plural above one');
  ok(/Nobody is waiting on you/.test(line), 'and no queue is stated rather than left out');
  ok(!uptakeNeedsAnswering({ joined: 17, pending: 0 }), 'and it is not a job');
}

// The half this was built for: people sitting in a queue a coach cannot see.
{
  const line = codeUptakeLine({ joined: 4, pending: 3 });
  ok(/3 are waiting for you to accept them/.test(line), 'the queue is named as a queue');
  ok(uptakeNeedsAnswering({ joined: 4, pending: 3 }), 'and reported as something to do');
}

// One of each, because "1 people have joined" is the sort of thing that ships.
ok(/^1 person has joined/.test(codeUptakeLine({ joined: 1, pending: 0 })),
  'one joiner is a person');
ok(/1 is waiting for you to accept them/.test(codeUptakeLine({ joined: 0, pending: 1 })),
  'and one waiting is singular too');

// A genuine zero, read whole, is allowed to say so — the refusal above is about
// an unread count, not about a code nobody has used yet.
ok(/0 people have joined/.test(codeUptakeLine({ joined: 0, pending: 0 })),
  'a read zero is stated, because it is true and it is what a new code looks like');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`handOutCode: ok (${hand.length} live named codes offered, ${new Set(lines.values()).size} distinct states)`);
