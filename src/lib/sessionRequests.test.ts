// A member asking for an hour the coach never opened.
// Compile with tsc, run with node.
//
// The assertions that matter are not about the labels. They are about the one
// way this feature can do real harm: a member reading a question nobody has
// answered as a session somebody has agreed to, and arranging their evening
// around it. So the sentences are asserted to be DIFFERENT from each other, and
// the ones that are not bookings are asserted not to contain the words that
// would make them read like one.
//
// The second group is the expiry rule, which is derived rather than stored and
// therefore has no job to prove it works — only this.
import {
  COACH_ACCEPT_RULE, EXPIRY_RULE, NOT_A_BOOKING, NO_COACH_TO_ASK, OUTCOME_LABEL,
  REQUEST_HORIZON_DAYS,
  REQUEST_LIVE_CAP, REQUEST_NOTE_MAX, answerRefusalNote, askBlocker, askRefusalNote,
  askedConfirmation, answeredConfirmation, asRequestState, coachQueue, coachQueueNote,
  countByOutcome, isLive, myRequests, outcomeLine, outcomeOf, ownDiaryNote, shapeRequests,
  type RequestOutcome, type SessionRequest,
} from './sessionRequests';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-02T09:00:00Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();

const req = (over: Partial<SessionRequest> = {}): SessionRequest => ({
  id: 'r1', clientId: 'c1', trainerId: 't1',
  startsAt: at(2 * DAY), durationMin: 60, note: null,
  state: 'asked', sessionId: null, declineNote: null,
  answeredAt: null, createdAt: at(-DAY),
  ...over,
});

/* ── rows in ───────────────────────────────────────────────────────────── */

eq(shapeRequests(null).length, 0, 'no rows is no requests');
eq(shapeRequests([{ starts_at: at(DAY) }]).length, 0, 'a row with no id cannot be drawn and is dropped');
eq(shapeRequests([{ id: 'x' }]).length, 0, 'and neither can one with no hour');
eq(shapeRequests([{ id: 'x', starts_at: 'whenever' }]).length, 0, 'an unparseable hour is not an hour');

const shaped = shapeRequests([{ id: 'x', starts_at: at(DAY), state: 'declined', decline_note: ' busy ', duration_min: 45 }]);
eq(shaped.length, 1, 'a usable row comes through');
eq(shaped[0].state, 'declined', 'with its state');
eq(shaped[0].declineNote, 'busy', 'and its note trimmed');
eq(shaped[0].durationMin, 45, 'and the length actually asked for, not the default');
eq(shapeRequests([{ id: 'x', starts_at: at(DAY) }])[0].durationMin, 60, 'a missing length falls back to an hour');

// The one fallback that must never go the other way. A state this build has not
// heard of read as 'accepted' would tell somebody their coach said yes.
eq(asRequestState('accepted'), 'accepted', 'a known state is itself');
eq(asRequestState('confirmed'), null, 'an unknown one is not silently mapped');
eq(shapeRequests([{ id: 'x', starts_at: at(DAY), state: 'confirmed' }])[0].state, 'asked',
  'an unrecognised state falls back to the one that claims nothing');

/* ── the fifth outcome, which nothing stores ───────────────────────────── */

eq(outcomeOf(req(), NOW), 'asked', 'a question about a future hour is still a question');
eq(outcomeOf(req({ startsAt: at(-HOUR) }), NOW), 'expired', 'and one about an hour that has gone has lapsed');
eq(outcomeOf(req({ startsAt: at(-1) }), NOW), 'expired', 'the boundary is the hour itself');
eq(outcomeOf(req({ startsAt: at(1) }), NOW), 'asked', 'one millisecond before it, it still stands');

// Only an unanswered request can lapse. Reading an answered one as expired
// would erase an answer the coach actually gave.
eq(outcomeOf(req({ state: 'accepted', startsAt: at(-DAY) }), NOW), 'accepted',
  'a session that happened is not an expired request');
eq(outcomeOf(req({ state: 'declined', startsAt: at(-DAY) }), NOW), 'declined', 'and a decline stays a decline');
eq(outcomeOf(req({ state: 'withdrawn', startsAt: at(-DAY) }), NOW), 'withdrawn', 'and so does a withdrawal');

// An hour this file cannot read must not retire somebody's live question.
eq(outcomeOf({ state: 'asked', startsAt: 'nonsense' }, NOW), 'asked',
  'an unparseable hour is not treated as one that has passed');

eq(isLive(req(), NOW), true, 'a live question is live');
eq(isLive(req({ startsAt: at(-HOUR) }), NOW), false, 'a lapsed one is not');
eq(isLive(req({ state: 'accepted' }), NOW), false, 'and neither is an answered one');

/* ── the queues ────────────────────────────────────────────────────────── */

const list: SessionRequest[] = [
  req({ id: 'far', startsAt: at(5 * DAY), createdAt: at(-3 * DAY) }),
  req({ id: 'soon', startsAt: at(1 * DAY), createdAt: at(-1 * DAY) }),
  req({ id: 'gone', startsAt: at(-2 * DAY), createdAt: at(-4 * DAY) }),
  req({ id: 'said-no', state: 'declined', startsAt: at(3 * DAY), createdAt: at(-2 * DAY) }),
];

eq(coachQueue(list, NOW).map((r) => r.id).join(','), 'soon,far',
  'the coach is only asked about live questions, soonest first');
eq(myRequests(list).map((r) => r.id).join(','), 'soon,said-no,far,gone',
  'the member sees all of them, newest question first — including the declines');

const counts = countByOutcome(list, NOW);
eq(counts.asked, 2, 'two are waiting');
eq(counts.expired, 1, 'one lapsed');
eq(counts.declined, 1, 'and one was answered no');
eq(counts.accepted, 0, 'and nothing here was accepted');

eq(coachQueueNote(0), null, 'nothing waiting draws no banner at all');
ok(/^1 client is/.test(coachQueueNote(1) ?? ''), 'one is singular');
ok(/^4 clients are/.test(coachQueueNote(4) ?? ''), 'and four is plural');

/* ── the five sentences, which must be five ────────────────────────────── */

const OUTCOMES: RequestOutcome[] = ['asked', 'accepted', 'declined', 'withdrawn', 'expired'];
const WHEN = 'Tuesday at 7pm';

const lines = new Map<RequestOutcome, string>([
  ['asked', outcomeLine(req(), WHEN, NOW)],
  ['accepted', outcomeLine(req({ state: 'accepted' }), WHEN, NOW)],
  ['declined', outcomeLine(req({ state: 'declined' }), WHEN, NOW)],
  ['withdrawn', outcomeLine(req({ state: 'withdrawn' }), WHEN, NOW)],
  ['expired', outcomeLine(req({ startsAt: at(-DAY) }), WHEN, NOW)],
]);

eq(new Set(lines.values()).size, 5, 'five outcomes, five different sentences — one shared line is the whole defect');
for (const o of OUTCOMES) {
  const line = lines.get(o) ?? '';
  ok(line.includes(WHEN), `${o}: the sentence names the hour it is about`);
  ok(/[.]$/.test(line.trim()), `${o}: it is a sentence and it ends`);
  // An em dash between two clauses is prose. A dash where a SUBJECT should be
  // is the defect `check:prose` exists for, so what is asserted is that no
  // sentence in the line opens with one.
  ok(!/(^|[.!?]\s+)—/.test(line), `${o}: no dash is left standing where a value would have gone`);
  ok(OUTCOME_LABEL[o].length > 0, `${o}: it has a label`);
}
eq(new Set(Object.values(OUTCOME_LABEL)).size, 5, 'and five different labels');

// The words that would make a question read as an arrangement. Only the
// accepted sentence — the one that IS a session — may use them.
for (const o of OUTCOMES) {
  if (o === 'accepted') continue;
  const line = (lines.get(o) ?? '').toLowerCase();
  ok(!/\bbooked\b/.test(line) || /nothing is booked|not booked/.test(line),
    `${o}: does not tell the member anything is booked`);
  ok(!/\bconfirmed\b/.test(line), `${o}: does not use the word confirmed`);
}
for (const label of Object.values(OUTCOME_LABEL)) {
  ok(!/booked/i.test(label), `"${label}": no label calls a request a booking`);
}

// The one a member reads while deciding whether to rely on the hour.
const asked = lines.get('asked') ?? '';
ok(/not held/.test(asked), 'the waiting sentence says the time is not held');
ok(/not answered|hasn|has not/i.test(asked), 'and that nobody has answered');

// A decline in the coach's own words, and a decline without any.
const withWhy = outcomeLine(req({ state: 'declined', declineNote: 'I am away that week' }), WHEN, NOW);
ok(withWhy.includes('I am away that week'), 'the coach’s reason is shown when they gave one');
const noWhy = lines.get('declined') ?? '';
ok(!noWhy.includes('“'), 'and no empty quotation marks are drawn when they did not');
ok(/didn’t say why/.test(noWhy), 'the absence of a reason is stated rather than papered over');

/* ── the rule, said before it is relied on ─────────────────────────────── */

ok(/until the time you asked for arrives/.test(EXPIRY_RULE), 'the expiry rule states the boundary');
ok(/nothing is arranged/.test(EXPIRY_RULE), 'and that a lapse arranges nothing');
ok(/not a booking/i.test(NOT_A_BOOKING), 'the asking screen says outright that this is not a booking');
ok(/nothing comes off your sessions/.test(NOT_A_BOOKING), 'and that no credit moves');
ok(/real session/.test(COACH_ACCEPT_RULE), 'the coach is told plainly what saying yes does');

// The confirmation a member reads once and then acts on for a week.
const conf = askedConfirmation(WHEN, 'Dayne');
ok(conf.includes('Dayne'), 'the coach is named when their name could be read');
ok(conf.includes(EXPIRY_RULE), 'and the lapse rule travels with it');
ok(!/booked yet\b(?!.)/.test(conf) && /Nothing is booked yet/.test(conf), 'it says nothing is booked');
const noName = askedConfirmation(WHEN, null);
ok(!/(^|[.!?]\s+)—/.test(noName), 'with no readable name the sentence is rewritten, not left with a dash as its subject');
ok(/^Your coach has been asked/.test(noName), 'and it still opens with a subject');

ok(/in your calendar/i.test(answeredConfirmation(true, WHEN)), 'a yes tells the coach a session now exists');
ok(/ask for another time/.test(answeredConfirmation(false, WHEN)), 'and a no tells them the client can ask again');
ok(answeredConfirmation(true, WHEN) !== answeredConfirmation(false, WHEN), 'the two answers do not share a sentence');

/* ── what the screen refuses before the server has to ──────────────────── */

eq(askBlocker(at(2 * DAY), 60, NOW), null, 'an ordinary request in two days is fine');
ok(askBlocker('not a time', 60, NOW) !== null, 'an unreadable time is refused');
ok(/already passed/.test(askBlocker(at(-HOUR), 60, NOW) ?? ''), 'an hour that has gone is refused, by name');
ok(/still ahead/.test(askBlocker(at(0), 60, NOW) ?? ''), 'and so is this instant');
ok(new RegExp(`${REQUEST_HORIZON_DAYS} days`).test(askBlocker(at(120 * DAY), 60, NOW) ?? ''),
  'past the horizon the refusal names the horizon');
eq(askBlocker(at(REQUEST_HORIZON_DAYS * DAY - HOUR), 60, NOW), null, 'just inside it is allowed');
ok(askBlocker(at(2 * DAY), 0, NOW) !== null, 'a length of nothing is not a session');

// The member's own diary, which the server does not check — part 740 refuses a
// clash on the COACH's calendar and the member's own is theirs.
const busy = [{ startsAt: at(2 * DAY), durationMin: 60 }];
ok(/already have a session booked/.test(askBlocker(at(2 * DAY + 30 * 60_000), 60, NOW, { myBusy: busy }) ?? ''),
  'asking across a session the member already has is caught here');
eq(askBlocker(at(2 * DAY + 3 * HOUR), 60, NOW, { myBusy: busy }), null, 'a clear hour beside it is not');

// Asking twice for the same hour.
const live = [req({ id: 'a', startsAt: at(2 * DAY) })];
ok(/already asked/.test(askBlocker(at(2 * DAY), 60, NOW, { live }) ?? ''), 'the same hour twice is caught');
eq(askBlocker(at(3 * DAY), 60, NOW, { live }), null, 'a different hour is not');
// A DECLINED request for that hour must not stop them asking again.
eq(askBlocker(at(2 * DAY), 60, NOW, { live: [req({ id: 'a', startsAt: at(2 * DAY), state: 'declined' })] }), null,
  'a request that was already answered no does not block asking again');

const many = Array.from({ length: REQUEST_LIVE_CAP }, (_, i) => req({ id: `q${i}`, startsAt: at((i + 3) * DAY) }));
ok(/as many unanswered requests/.test(askBlocker(at(40 * DAY), 60, NOW, { live: many }) ?? ''),
  'the cap is refused before the write');
eq(askBlocker(at(40 * DAY), 60, NOW, { live: many.slice(1) }), null, 'one under it is allowed');

/* ── the server's refusals, in words ───────────────────────────────────── */

const ASK_REASONS = ['not-signed-in', 'no-coach', 'in-the-past', 'bad-time', 'bad-duration', 'already-asked', 'too-many'];
for (const r of ASK_REASONS) {
  const s = askRefusalNote(r);
  ok(s.length > 0 && /[.]$/.test(s.trim()), `${r}: the refusal is a sentence`);
  ok(!/booked/i.test(s), `${r}: a refused request never mentions a booking`);
}
// The one that must not claim a cause it does not know.
const unknownAsk = askRefusalNote('something-new');
ok(/not sent/.test(unknownAsk), 'an unrecognised refusal still says plainly that nothing was sent');
ok(!/coach|past|already/i.test(unknownAsk.replace('your coach has not been asked', '')),
  'and does not invent a reason for it');
eq(askRefusalNote(null), askRefusalNote(undefined), 'no reason at all is the same as an unknown one');
ok(/still stands/.test(askRefusalNote('already-asked')),
  'asking twice says the first one is still live, not that something failed');

const ANSWER_REASONS = ['not-signed-in', 'not-yours', 'already-answered', 'expired', 'clash-booked', 'clash-blocked', 'clash-class', 'clash'];
const answers = ANSWER_REASONS.map((r) => answerRefusalNote(r));
eq(new Set(answers).size, ANSWER_REASONS.length, 'every refusal the coach can get is its own sentence');
for (let i = 0; i < ANSWER_REASONS.length; i++) {
  ok(/[.]$/.test(answers[i].trim()), `${ANSWER_REASONS[i]}: it is a sentence`);
}
// The refusal that exists because two handsets can answer one question.
ok(/no second session/.test(answerRefusalNote('already-answered')),
  'answering twice states the thing the coach actually needs to know');
// The three clashes name the obstacle, which is why part 740 checks them apart.
ok(/session booked/.test(answerRefusalNote('clash-booked')), 'a booked clash says so');
ok(/unavailable/.test(answerRefusalNote('clash-blocked')), 'a block says so');
ok(/Bootcamp/.test(answerRefusalNote('clash-class', 'Bootcamp')), 'a class is named when the server named one');
const namelessClass = answerRefusalNote('clash-class', null);
ok(/teach a class/.test(namelessClass), 'and the sentence still reads when it did not');
ok(!namelessClass.includes('—'), 'with no dash where the name would have been');
for (const r of ANSWER_REASONS) {
  ok(/nothing was created|has already been answered|isn’t on your list|nothing left to say yes/.test(answerRefusalNote(r)),
    `${r}: the coach is told no session was made`);
}

/* ── the two caps that have to agree with the database ─────────────────── */

eq(REQUEST_NOTE_MAX, 400, 'the note limit matches the CHECK in part 740, or the write fails after it is typed');
eq(REQUEST_LIVE_CAP, 10, 'and the live cap matches session_request_live_cap()');

/* ── the member's own diary, and the silence when it could not be read ─── */

// The clash below is the ONLY check of the member's own calendar in this whole
// feature — part 740 refuses on the coach's diary and says nothing about the
// client's. So the two branches that matter are: it fires when the diary is
// known, and the screen is told to SAY SOMETHING when it is not.
const alreadyBooked = [{ startsAt: at(2 * DAY), durationMin: 60 }];
ok(askBlocker(at(2 * DAY), 60, NOW, { myBusy: alreadyBooked }) != null,
  'asking across a session the member already holds is refused before the write');
eq(askBlocker(at(2 * DAY), 60, NOW, { myBusy: [] }), null,
  'and an empty diary refuses nothing — which is why an unread one must not arrive as empty');

eq(ownDiaryNote('ready'), null, 'a whole read of the member’s own diary needs no sentence');
const DIARY_STATES: LoadStatus[] = ['loading', 'partial', 'error'];
const diaryNotes = DIARY_STATES.map((s) => ownDiaryNote(s));
for (let i = 0; i < DIARY_STATES.length; i++) {
  ok(typeof diaryNotes[i] === 'string' && diaryNotes[i]!.length > 0,
    `${DIARY_STATES[i]}: the member is told the clash check could not be made`);
}
eq(new Set(diaryNotes).size, DIARY_STATES.length,
  'still reading, read short and read failed are three different situations and three different sentences');
ok(/not checked/.test(ownDiaryNote('error')!),
  'a failed read says plainly that the check was not made, rather than staying quiet and reading as no clash');
ok(!/no clash|you are free|nothing booked/i.test(ownDiaryNote('error')!),
  'and never states the thing it could not read');

/* ── nobody to ask ─────────────────────────────────────────────────────── */

ok(/[.]$/.test(NO_COACH_TO_ASK.trim()), 'the no-coach sentence is a sentence');
ok(!/book/i.test(NO_COACH_TO_ASK), 'and it does not use the word book, like every other sentence here');
ok(NO_COACH_TO_ASK !== askRefusalNote('no-coach'),
  'it is said BEFORE the ask, so it is not the server’s after-the-fact refusal reworded');
ok(/nobody to ask/.test(NO_COACH_TO_ASK),
  'and it states the fact the screen’s own heading would otherwise contradict');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionRequests.test.ts — ok');
