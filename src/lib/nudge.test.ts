// The app may not message a client in its coach's name, may not ask twice, and
// may not call somebody quiet when it did not manage to look.
// Compile with tsc, run with node.
//
// Four blocks, and three of them are about a refusal rather than a result:
//
//   COPY      every draft says what was observed and nothing else. The list in
//             NEVER_SAYS is run over every sentence this module can produce, so
//             a future edit that reaches for "you seem to have lost motivation"
//             fails here rather than arriving in somebody's inbox in their
//             coach's voice.
//   NEVER-NAG a client who has been messaged, and a client a coach has set
//             aside, are both out of the list until their own window passes.
//             The window is the one that was RECORDED, so re-tuning the
//             constants cannot un-mute a book. The mutations these kill are the
//             ones that drop the mutedBy call, invert its comparison, or
//             recompute the window from today's pace.
//   UNREAD    a client whose record did not come back is never a suggestion,
//             and the count that says so is never zero by accident. The
//             mutation this kills is the one that treats `{ read: false }` as
//             an empty event list — which is exactly what every version of this
//             feature that takes a bare array does.
//   EVIDENCE  the dates behind the figure are the dates the figure was computed
//             from, and a source nobody read is reported as unread rather than
//             as silence.
//
// No expectation is built against a hardcoded "today" or a hardcoded zone.
// `npm test` runs three times under three timezones (`test:zones`), the day
// boundary in clientDrift is LOCAL, and every day expectation below is built
// with `localDayKey` — the same helper the code uses.
import {
  mutedBy, mutedDaysFor, buildNudgeBoard, draftMessage, observedLine, greetingName,
  refusalsIn, explainDrift, earnsNudge, boardNote, readableDay,
  NEVER_SAYS, WHAT_IT_CANNOT_SEE, WITHHELD_NOTE, DISMISS_FLOOR_DAYS,
  type NudgeRecord, type NudgeCandidate,
} from './nudge';
import { assessDrift, localDayKey, DEFAULT_WINDOWS, type ActivityEvent } from './clientDrift';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
/** Local noon, so a day expectation is the same in Auckland and Los Angeles and
 *  an hour of DST cannot move an event into the day next door. */
const NOW = new Date(2026, 7, 31, 12, 0).getTime();
const ago = (days: number, kind: ActivityEvent['kind'] = 'workout'): ActivityEvent =>
  ({ at: new Date(NOW - days * DAY).toISOString(), kind });
const agoIso = (days: number) => new Date(NOW - days * DAY).toISOString();

/** Roughly every other day between `from` and `to` days ago — a settled pattern
 *  of about three and a half days a week, which is a rhythm to break. */
const pattern = (from: number, to: number, kind: ActivityEvent['kind'] = 'workout'): ActivityEvent[] => {
  const out: ActivityEvent[] = [];
  for (let d = from; d <= to; d += 2) out.push(ago(d, kind));
  return out;
};

/* ── the four people every block below is about ───────────────────────────── */

// Trained about every other day for six weeks, then nothing for a fortnight.
const wentQuiet = pattern(15, 55);
// The same six weeks, still going.
const steady = [...pattern(15, 55), ...pattern(1, 13)];
// The same six weeks, now down to about two a week — a real fall, and not far
// enough to be a call to make.
const slipping = [...pattern(15, 55), ago(2), ago(5), ago(8), ago(11)];

const D = (events: ActivityEvent[], since = agoIso(200)) =>
  assessDrift({ clientId: 'c', events, since }, NOW, DEFAULT_WINDOWS);

const dQuiet = D(wentQuiet);
const dSteady = D(steady);
const dSlipping = D(slipping);
const dNothing = D([], agoIso(200));

eq(dQuiet.status, 'at_risk', 'a client who trained every other day for six weeks and then stopped is drifting');
eq(dSteady.status, 'on_track', 'and one who kept going is not');
eq(dSlipping.status, 'watch', 'and one who halved is slipping, which is the band this module leaves alone');
eq(dNothing.status, 'idle', 'and a client with nothing on record is UNKNOWN, which is not fine');

/* ── COPY · it says what was observed, and refuses the rest ───────────────── */

for (const [who, d] of [['quiet', dQuiet], ['nothing', dNothing], ['slipping', dSlipping], ['steady', dSteady]] as const) {
  const draft = draftMessage('Sam Okafor', d);
  eqJson(refusalsIn(draft), [], `the draft for a ${who} client claims nothing the record cannot support`);
  eqJson(refusalsIn(observedLine(d)), [], `and neither does the observed line for a ${who} client`);
  ok(draft.includes('Sam'), `the draft for a ${who} client greets them by their given name`);
  ok(!/\bOkafor\b/.test(draft), `and not by their surname, which nobody says out loud`);
}

// The two halves of rule 3, stated as assertions rather than as a comment.
ok(draftMessage('Sam', dQuiet).includes('14 days')
  || draftMessage('Sam', dQuiet).includes(`${dQuiet.quietDays} days`),
  'the draft says how long the app has had nothing, because that is the observation');
ok(/\bapp\b/.test(draftMessage('Sam', dQuiet)),
  'and attributes it to the app, so a client who trained without logging can say so');
ok(!/you have not|you haven't|didn't train|did not train/i.test(draftMessage('Sam', dQuiet)),
  'and never states that they did not train, which is the thing the record does not know');

// The caveat is the ONE place the three explanations are named, and it must
// name all three — a caveat that mentions injury and not money is a caveat that
// has been edited down, which is how it ends up saying nothing.
for (const word of ['njur', 'away', 'gym', 'payment']) {
  ok(WHAT_IT_CANNOT_SEE.toLowerCase().includes(word.toLowerCase()),
    `the caveat names what the signal cannot see: ${word}`);
}
ok(refusalsIn(WHAT_IT_CANNOT_SEE).length > 0,
  'and it would be refused inside a draft — which is the point: it is written to the COACH');

// The refusal list itself has to be able to fire, or every assertion above is
// vacuous. This is the one that kills a mutation emptying NEVER_SAYS.
ok(NEVER_SAYS.length >= 15, 'the refusal list is not empty');
eqJson(refusalsIn('You seem to have lost your motivation lately.'), ['a state of mind'],
  'a draft that diagnoses a state of mind is refused');
eqJson(refusalsIn('I know you have been injured, so no rush.'), ['a cause the record cannot see'],
  'and one that asserts a cause the app cannot see is refused');
eqJson(refusalsIn('You need to get back in this week.'),
  ['an instruction, which is the nagging this exists to avoid'],
  'and an instruction is refused');
eqJson(refusalsIn('I will be at the gym on Thursday.'), [],
  'but "I will" is not "ill" — the boundaries are word boundaries, not substrings');
eqJson(refusalsIn('Still training on Fridays?'), [],
  'and "still" is not "ill" either');

eq(greetingName('Sam Okafor'), 'Sam', 'a greeting uses the given name');
eq(greetingName('  '), null, 'an empty name is no greeting, not an empty one');
eq(greetingName('7f3a9c21-0000-4000-8000-000000000000'), null,
  'and a uuid is never greeted as a person');
eq(greetingName('sam@example.com'), null, 'nor is an email address');
ok(!draftMessage(null, dQuiet).startsWith('Hi'),
  'with no name the draft opens on the observation rather than on "Hi ,"');

/* ── NEVER-NAG · one approach, then silence for a stated window ───────────── */

const rec = (over: Partial<NudgeRecord> & { action: NudgeRecord['action'] }): NudgeRecord => ({
  id: 'r1', clientId: 'c1', at: agoIso(1), mutedDays: 14, observed: null, ...over,
});

eq(mutedBy([rec({ action: 'sent', at: agoIso(3), mutedDays: 14 })], 'c1', NOW)?.daysLeft, 11,
  'a client messaged three days ago is muted for the eleven that are left');
eq(mutedBy([rec({ action: 'sent', at: agoIso(15), mutedDays: 14 })], 'c1', NOW), null,
  'and comes back the day after the window closes');
eq(mutedBy([rec({ action: 'dismissed', at: agoIso(20), mutedDays: 30 })], 'c1', NOW)?.daysLeft, 10,
  'a client set aside twenty days ago is still set aside');
eq(mutedBy([rec({ action: 'sent' })], 'someone-else', NOW), null,
  'a record about one client does not mute another');

// The window is the RECORDED one. A mutation that recomputes it from today's
// pace — 14 for a client with no pattern — makes this client come back today.
eq(mutedBy([rec({ action: 'dismissed', at: agoIso(40), mutedDays: 60 })], 'c1', NOW)?.daysLeft, 20,
  'the window is the one that was written down, not the one today’s constants would give');

// Two live mutes, and the longer must win: setting somebody aside for a month
// and then messaging them the same afternoon has not shortened the month.
eq(mutedBy([
  rec({ id: 'a', action: 'dismissed', at: agoIso(1), mutedDays: 30 }),
  rec({ id: 'b', action: 'sent', at: agoIso(0), mutedDays: 14 }),
], 'c1', NOW)?.record.id, 'a', 'the latest-ENDING mute wins, not the most recent record');

// An undateable row must not silence somebody forever. Erring the other way
// would mean a client leaves and is never mentioned again.
eq(mutedBy([rec({ action: 'sent', at: 'not a date' })], 'c1', NOW), null,
  'a record nobody can date mutes nothing');
eq(mutedBy([rec({ action: 'sent', at: agoIso(1), mutedDays: 0 })], 'c1', NOW), null,
  'and a zero-day window is not a mute');
eq(mutedBy([rec({ action: 'sent', at: agoIso(1), mutedDays: -5 })], 'c1', NOW), null,
  'nor is a negative one');

// The windows themselves come from the client's own rhythm, not from a fixed
// number of days for everybody.
const sentQuiet = mutedDaysFor('sent', dQuiet);
ok(sentQuiet >= 7 && sentQuiet <= 28, 'a send mutes for a span paced off their own baseline');
eq(mutedDaysFor('dismissed', dQuiet), Math.max(DISMISS_FLOOR_DAYS, sentQuiet),
  'and setting aside is never shorter than a month');
ok(mutedDaysFor('dismissed', dNothing) >= DISMISS_FLOOR_DAYS,
  'including for a client with no pattern at all to pace against');

/* ── the board refuses to nag ─────────────────────────────────────────────── */

const cand = (id: string, events: ActivityEvent[], name: string | null = 'Sam ' + id): NudgeCandidate =>
  ({ clientId: id, name, activity: { read: true, events }, since: agoIso(200) });

const book: NudgeCandidate[] = [
  cand('a', wentQuiet), cand('b', steady), cand('c', slipping), cand('d', []),
];

const plain = buildNudgeBoard(book, [], { now: NOW });
eqJson(plain.nudges.map((n) => n.clientId), ['a', 'd'],
  'only the client who broke their pattern and the one with no record at all are suggested');
eq(plain.muted.length, 0, 'nobody is muted when nothing has been recorded');
eq(plain.withheld.length, 0, 'and nobody is withheld when every read came back');
eq(plain.assessed, 4, 'all four were assessed');
eq(plain.summary?.drifting, 1, 'and the bands are over the four who were assessed');

ok(earnsNudge(dSlipping) === false,
  'the watch band earns no suggestion — a busy fortnight is not a call to make');

const afterSend = buildNudgeBoard(book, [
  { id: 'r', clientId: 'a', action: 'sent', at: agoIso(2), mutedDays: 14, observed: 'Nothing for 15 days.' },
], { now: NOW });
eqJson(afterSend.nudges.map((n) => n.clientId), ['d'],
  'a client messaged two days ago is not suggested again');
eqJson(afterSend.muted.map((m) => m.clientId), ['a'], 'they are set aside, not deleted');
eq(afterSend.muted[0]?.muted.daysLeft, 12, 'with the days until they come back');
eq(afterSend.assessed, 4, 'and they are still assessed, so the bands do not move when a coach acts');
eq(afterSend.summary?.drifting, 1, 'contacting somebody does not make them stop drifting');

const afterDismiss = buildNudgeBoard(book, [
  { id: 'r', clientId: 'd', action: 'dismissed', at: agoIso(5), mutedDays: 30, observed: null },
], { now: NOW });
eqJson(afterDismiss.nudges.map((n) => n.clientId), ['a'],
  'a client the coach set aside is not offered again');

const longAfter = buildNudgeBoard(book, [
  { id: 'r', clientId: 'd', action: 'dismissed', at: agoIso(40), mutedDays: 30, observed: null },
], { now: NOW });
eqJson(longAfter.nudges.map((n) => n.clientId), ['a', 'd'],
  'but they do come back once the window has passed — a set-aside is not a delete');

/* ── UNREAD · a client nobody managed to read is not a quiet client ───────── */

const halfRead: NudgeCandidate[] = [
  cand('a', wentQuiet),
  { clientId: 'e', name: 'Unreadable', activity: { read: false, why: 'read-failed' } },
  { clientId: 'f', name: 'Hand-added', activity: { read: false, why: 'no-account' } },
  { clientId: 'g', name: 'Truncated', activity: { read: false, why: 'read-partial' } },
];
const hr = buildNudgeBoard(halfRead, [], { now: NOW });
eqJson(hr.nudges.map((n) => n.clientId), ['a'],
  'a client whose record did not come back is NEVER suggested, however empty it looks');
eqJson(hr.withheld.map((w) => w.clientId), ['e', 'f', 'g'], 'all three are counted out loud');
eq(hr.assessed, 1, 'and none of them is counted as assessed');
eq(hr.summary?.total, 1, 'the bands describe the one client who was read, not the four who were listed');
for (const w of hr.withheld) {
  eq(w.note, WITHHELD_NOTE[w.why], 'each withheld client carries the reason in words');
  ok(w.note.length > 20, 'and the reason is a sentence, not a code');
}

// The distinction the whole block turns on: a read that came back EMPTY is a
// real answer and does surface. If `{ read: false }` were treated as an empty
// array these two would be indistinguishable, and this is the pair that says so.
const emptyRead = buildNudgeBoard([cand('d', [])], [], { now: NOW });
const failedRead = buildNudgeBoard(
  [{ clientId: 'd', name: 'Sam d', activity: { read: false, why: 'read-failed' } }], [], { now: NOW });
eq(emptyRead.nudges.length, 1, 'read, and there was nothing: that is a suggestion');
eq(failedRead.nudges.length, 0, 'not read: that is not');

// And the sentence under the heading has to say so, or a short list reads as a
// calm week.
ok(boardNote(hr).includes('not the whole book'),
  'the note says the list is incomplete when anybody could not be assessed');
eq(boardNote(null), 'Reading who has gone quiet…',
  'and before the read lands it claims no number at all');
ok(boardNote(buildNudgeBoard([cand('b', steady)], [], { now: NOW })).startsWith('Nobody to chase'),
  'an assessed book with nobody to contact says so plainly');
ok(boardNote(buildNudgeBoard([], [], { now: NOW })).includes('Nobody could be assessed'),
  'an empty book is not a clear week');

/* ── ordering ─────────────────────────────────────────────────────────────── */

const ordered = buildNudgeBoard([cand('d', []), cand('a', wentQuiet)], [], { now: NOW });
eqJson(ordered.nudges.map((n) => n.clientId), ['a', 'd'],
  'the measurable break leads, and the client nothing is known about is second — never last');

/* ── EVIDENCE · the dates behind the figure ───────────────────────────────── */

const ev = explainDrift({ drift: dQuiet, events: wentQuiet }, NOW, DEFAULT_WINDOWS);
eq(ev.recentDays.length, 0, 'nothing in the near window');
eq(ev.lastSeen?.day, localDayKey(NOW - 15 * DAY),
  'and the last thing on record is the day it actually happened');
eq(ev.baselineDays.length, 21, 'twenty-one active days sit behind the baseline rate');
eqJson(ev.baselineDays.map((d) => d.day).slice(0, 2),
  [localDayKey(NOW - 55 * DAY), localDayKey(NOW - 53 * DAY)],
  'listed oldest first, as the actual days');
eq(ev.window.today, localDayKey(NOW), 'the window ends today');
eq(ev.window.recentFrom, localDayKey(NOW - DEFAULT_WINDOWS.recentDays * DAY),
  'and the near window starts where assessDrift starts it');

// A source nobody read is reported as unread, not as silence. This is the
// difference between "they have not been to the gym" and "this coach has no
// gym, so nobody looked at the door".
eqJson(ev.notRead, ['visit'], 'with no gym on the account the door log is NOT READ');
ok(!ev.silent.includes('visit'), 'and is therefore never reported as silent');
ok(ev.silent.includes('check_in'), 'while a source that was read and gave nothing is silent');
const withDoor = explainDrift({ drift: dQuiet, events: wentQuiet, doorLogRead: true }, NOW);
eqJson(withDoor.notRead, [], 'with a gym, everything was read');
ok(withDoor.silent.includes('visit'), 'and an empty door log then means an empty door log');

ok(ev.lines.some((l) => l.includes(readableDay(localDayKey(NOW - 15 * DAY)))),
  'the printed lines carry the real date, not only the count of days');
ok(ev.lines[ev.lines.length - 1] === WHAT_IT_CANNOT_SEE,
  'and the last thing a coach reads under the working is what it cannot see');

const evNothing = explainDrift({ drift: dNothing, events: [] }, NOW);
eq(evNothing.lastSeen, null, 'a client with nothing on record has no last day');
ok(evNothing.lines[0].includes('Nothing on record at all'),
  'and the working says so rather than printing a blank date');

if (errors.length) {
  console.error(`nudge.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('nudge.test.ts — all assertions passed.');
