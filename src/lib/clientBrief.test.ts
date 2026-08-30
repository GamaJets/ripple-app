// The sentences the coach's client screen puts under each destination.
// Compile with tsc, run with node.
//
// Two things are defended here, and both of them are the kind that ship quietly
// wrong because the screen still looks fine:
//
// 1. No read status produces a figure the read cannot support. A refused read
//    must never come out as a count, and a truncated one must never come out as
//    a total — `capped()` hands back a prefix of an unknown set, so "3 open"
//    over a truncated read is a wrong number rather than a rough one. Every
//    line function is asked all four statuses and the counting branches are
//    checked for the hedge.
//
// 2. An empty `attention()` list can never be produced by reads that failed.
//    That is the most dangerous screen in the app: a short, clean, reassuring
//    list assembled out of three reads that never landed. `blind` has to name
//    what was missed whenever anything was.
import {
  lastSeenLine, goalsLine, weekLine, photosLine, listLine, programmeLine,
  attention, noAccountNote, unaskedNote, WEEK_SPAN_DAYS,
} from './clientBrief';
import { goalBoard } from './clientGoals';
import { type GoalTarget } from './goalTargets';
import { coachWeek, DAYS_AHEAD, DAYS_BEHIND, type ScheduledFocus } from './coachWeek';
import { type PlannedDay } from './dayPlan';
import { assessDrift } from './clientDrift';
import { type Inbox, type InboxPhoto } from './photoInbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const NOW = Date.parse('2026-09-01T12:00:00Z');
const TODAY = '2026-09-01';
const WHO = 'Sam';

/* ── the hero line ────────────────────────────────────────────────────────── */

const silent = assessDrift({ clientId: 'c', events: [], since: '2026-06-01T00:00:00Z' }, NOW);
ok(lastSeenLine(silent, false, WHO) === silent.reason,
  'a drift that landed speaks in its own words — two screens must not word the same verdict differently');
ok(/could not be read/.test(lastSeenLine(null, true, WHO)),
  'a failed read says so');
ok(!/could not be read/.test(lastSeenLine(null, false, WHO))
   && /Reading/.test(lastSeenLine(null, false, WHO)),
  'a read still in flight is not a failure and does not read as one');

/* ── goals ───────────────────────────────────────────────────────────────── */

const goal = (over: Partial<GoalTarget> = {}): GoalTarget => ({
  id: 'g1', kind: 'weight', targetValue: 80, title: null,
  targetDateISO: '2026-10-01', achievedAtISO: null, createdAtISO: '2026-08-01T00:00:00Z',
  ...over,
});

const working = goalBoard([goal(), goal({ id: 'g2', targetDateISO: '2026-12-01' })]);
ok(/^2 open\./.test(goalsLine('ready', working, WHO, NOW)),
  'two open goals are counted when the read was whole');
ok(/at least 2 open/i.test(goalsLine('partial', working, WHO, NOW)),
  'a truncated read is hedged, never counted flat — a prefix of an unknown set is not a total');
ok(/could not be read/.test(goalsLine('ready', goalBoard(null), WHO, NOW))
   && /not the same as/.test(goalsLine('ready', goalBoard(null), WHO, NOW)),
  'unreadable goals say so AND say what that is not');
ok(/hasn't set a goal/.test(goalsLine('ready', goalBoard([]), WHO, NOW)),
  'an empty answer that really came back is a fact about the client');
ok(goalsLine('loading', goalBoard(null), WHO, NOW) === 'Reading their goals…',
  'in flight outranks the unreadable board a loading screen is holding');
ok(/All 1 goal reached/.test(goalsLine('ready', goalBoard([goal({ achievedAtISO: '2026-08-20T00:00:00Z' })]), WHO, NOW)),
  'everything reached is its own state, not an empty list');
ok(/target date passed/.test(goalsLine('ready', goalBoard([goal({ targetDateISO: '2026-08-01' })]), WHO, NOW)),
  'a target date behind us is called out on the nearest goal');
ok(/no target date/.test(goalsLine('ready', goalBoard([goal({ targetDateISO: null })]), WHO, NOW)),
  'an undated goal is never given a deadline');

/* ── the week ────────────────────────────────────────────────────────────── */

const days: PlannedDay[] = [
  { dateISO: '2026-09-02', type: 'training', note: null },
  { dateISO: '2026-09-03', type: 'rest', note: null },
  { dateISO: '2026-08-30', type: 'training', note: null },
];
const noProgramme: ScheduledFocus = () => undefined;
// Thursday 3 Sep — which they have marked a rest day — is a session in the
// coach's programme. That is `planConflict`'s 'plan-schedules-a-session', and
// it is the one a coach can still settle before the day arrives.
const programme: ScheduledFocus = (wd) => (wd === 4 ? 'Push' : null);

const plainWeek = coachWeek(days, TODAY, noProgramme);
ok(/^2 days marked from today on\./.test(weekLine('ready', plainWeek, WHO)),
  'the days ahead are counted; the one behind is left to the screen itself');
ok(/at least 2 days/i.test(weekLine('partial', plainWeek, WHO)),
  'a truncated week is hedged too');
ok(/could not be read/.test(weekLine('ready', coachWeek(null, TODAY, noProgramme), WHO)),
  'a failed planned-days read is never "they have marked nothing"');
const empty = coachWeek([], TODAY, noProgramme);
ok(weekLine('ready', empty, WHO).includes(String(WEEK_SPAN_DAYS))
   && WEEK_SPAN_DAYS === DAYS_BEHIND + DAYS_AHEAD,
  'the empty-week sentence names the window it actually looked at');
// Both ahead days disagree, for the two different reasons `planConflict` names:
// Wednesday is marked training and the programme schedules nothing, Thursday is
// marked rest and the programme schedules Push.
const clash = coachWeek(days, TODAY, programme);
ok(clash.conflicts.length === 2 && /2 disagree with the programme you set/.test(weekLine('ready', clash, WHO)),
  'a disagreement with the programme is surfaced in the summary');
ok(/1 disagrees with the programme you set/.test(
     weekLine('ready', coachWeek([days[1]], TODAY, programme), WHO)),
  'and one of them is singular — a summary line that says "1 disagree" is read as broken');
ok(!/disagree/.test(weekLine('ready', plainWeek, WHO)),
  'and is never claimed when no programme of the coach could be read');

/* ── photos ──────────────────────────────────────────────────────────────── */

const photo = (id: string, sharedAt: string): InboxPhoto => ({
  id, path: `p/${id}.jpg`, takenAt: '2026-08-01T00:00:00Z', sharedAt, link: null,
});
const inbox = (over: Partial<Inbox> = {}): Inbox => ({
  clientId: 'c', coachId: 'k', linkActive: true, photos: [], readAtMs: NOW, ...over,
});

ok(/could not read/i.test(photosLine(null, true, WHO)) && /not the same as/.test(photosLine(null, true, WHO)),
  'a failed photo read never becomes "they have sent you nothing"');
ok(/Reading/.test(photosLine(null, false, WHO)),
  'nothing read yet is not an empty inbox');
ok(/No live coaching link/.test(photosLine(inbox({ linkActive: false }), false, WHO)),
  'no coaching link is a fact about the link, and is kept apart from an empty inbox');
ok(/hasn't sent you a progress photo/.test(photosLine(inbox(), false, WHO)),
  'a live link and no grants is the one case that IS about the client');
// 08:00 UTC, not midnight: `stamp` renders an instant in the reader's own zone
// and the repo runs these tests at UTC-7, UTC+4 and UTC+12. A midnight
// timestamp lands on three different calendar days across those three, which
// would make this assertion a test of the machine rather than of the ordering.
const two = inbox({ photos: [photo('a', '2026-08-20T08:00:00Z'), photo('b', '2026-08-28T08:00:00Z')] });
ok(/^2 photos · newest sent 28 Aug 2026\./.test(photosLine(two, false, WHO)),
  'the newest SEND leads, because the send is the act addressed to the coach');

/* ── the checklist ───────────────────────────────────────────────────────── */

ok(/could not be read/.test(listLine('error', null, { seenDays: 4, windowDays: 28 }, WHO)),
  'a failed items read is not "you have set them nothing"');
ok(/row limit/.test(listLine('partial', 9, { seenDays: 4, windowDays: 28 }, WHO)),
  'a truncated list of lines says so instead of counting');
ok(/haven't put a line/.test(listLine('ready', 0, { seenDays: 4, windowDays: 28 }, WHO)),
  'no lines set, read whole, is a real answer');
ok(/3 lines of yours/.test(listLine('ready', 3, { seenDays: 4, windowDays: 28 }, WHO))
   && /ticked something on 4 of the last 28 days/.test(listLine('ready', 3, { seenDays: 4, windowDays: 28 }, WHO)),
  'the count of lines and the days they were in the app are both stated, and neither is a percentage');
ok(!/%/.test(listLine('ready', 3, { seenDays: 4, windowDays: 28 }, WHO)),
  'ticks are never turned into a score out of a hundred — the whole point of adherence.ts');
ok(/could not be read/.test(listLine('ready', 3, null, WHO)),
  'ticks that did not come back are said out loud rather than shown as none');
ok(/Nothing ticked at all/.test(listLine('ready', 3, { seenDays: 0, windowDays: 28 }, WHO))
   && /drawer/.test(listLine('ready', 3, { seenDays: 0, windowDays: 28 }, WHO)),
  'a real zero is stated as one AND carries the doubt that a zero cannot separate');

/* ── the programme ───────────────────────────────────────────────────────── */

ok(/could not be read/.test(programmeLine('error', null, null, WHO)),
  'a failed programme read is not "no programme assigned"');
ok(/that this app can read/.test(programmeLine('ready', null, null, WHO)),
  'no programme is hedged, because another coach\'s programme looks identical from here');
ok(programmeLine('ready', 'Push Pull Legs', 3, WHO) === 'Push Pull Legs · 3 days a week.',
  'an assigned programme is named with its own shape');

/* ── what is outstanding, and what was not checked ───────────────────────── */

const base = {
  who: WHO, unread: 0 as number | null,
  goalStatus: 'ready' as const, board: goalBoard([]),
  weekStatus: 'ready' as const, week: empty,
  driftFailed: false, nowMs: NOW,
};

const clear = attention(base);
ok(clear.items.length === 0 && clear.blind === null,
  'three whole reads with nothing in them is a genuine all-clear and may say so');

const late = attention({
  ...base,
  unread: 2,
  board: goalBoard([goal({ targetDateISO: '2026-08-01' })]),
  week: clash,
});
ok(late.items.length === 3, `unread, an overdue goal and a clash are three separate things to do, got ${late.items.length}`);
ok(late.items[0] === '2 unread messages from Sam.', 'the message a client has already sent leads');
ok(late.items.some((x) => /past its target date/.test(x)), 'the overdue goal is named');
ok(late.items.some((x) => /2 days they have marked ahead disagree with your programme/.test(x)),
  'the clash is named');
ok(late.blind === null, 'nothing was missed, so nothing is claimed to have been');

const noRoster = attention({ ...base, unread: null });
ok(noRoster.items.length === 0 && noRoster.blind != null && /anything unread/.test(noRoster.blind),
  'a roster that did not come back is a blind spot, not a client with no unread messages');

const dark = attention({ ...base, goalStatus: 'error', board: goalBoard(null), weekStatus: 'error', week: coachWeek(null, TODAY, noProgramme), driftFailed: true });
ok(dark.items.length === 0, 'a failed read contributes no items — it has nothing to contribute');
ok(dark.blind != null
   && /their goals/.test(dark.blind)
   && /the days they have marked/.test(dark.blind)
   && /their training record/.test(dark.blind),
  'and every one of them is named, so the empty list above cannot pass for an all-clear');

const truncated = attention({ ...base, goalStatus: 'partial', board: working, weekStatus: 'partial', week: plainWeek });
ok(truncated.blind != null && /rest of their goals/.test(truncated.blind),
  'a truncated read is a blind spot too: the overdue goal may be in the part that did not come back');
ok(truncated.items.length === 0,
  'and it contributes no items, because a count over a prefix is a wrong number');

/* ── a client with no account at all ─────────────────────────────────────── */

ok(unaskedNote(true, true, WHO) === null,
  'a client with an account on a build with a server was actually asked about');
ok(/not talking to a server/.test(unaskedNote(false, true, WHO) ?? ''),
  'a build with no server says so rather than showing four sections that read as "Reading…"');
ok(/until they join/.test(unaskedNote(true, false, WHO) ?? ''),
  'and a client with no account is a third thing again: nothing refused, nothing pending, nothing there');
ok(noAccountNote(true, WHO) === null, 'a client with an account gets no caveat');
ok(/added by hand/.test(noAccountNote(false, WHO) ?? ''),
  'and one without gets the reason the sections below are empty');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CLIENT BRIEF FAILURES:\n' + errors.join('\n') : 'ALL CLIENT BRIEF TESTS PASSED');
if (errors.length) process.exit(1);
