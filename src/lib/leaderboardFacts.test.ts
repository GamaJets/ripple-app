// What a leaderboard row is allowed to say about somebody.
//
// Most of these assertions are about the four absences — an unknown unread
// count, a capped activity read, a missing join date and a client with no scan
// — because those are the states the screen used to render identically to real
// answers, and every one of them changes what a coach does with the row.
//
// Compile with tsc, then run under plain node.
import {
  tenureLabel, activityLabel, unreadMark, injuryMark, scanFact, rowFacts, rowSpoken,
  type RowClient,
} from './leaderboardFacts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const TODAY = '2026-09-13';

/* ── 1. tenure, which is the whole reason this item exists ────────────────── */

eq(tenureLabel('2026-09-13T08:00:00Z', TODAY), 'joined today', 'today reads as today');
eq(tenureLabel('2026-09-12T08:00:00Z', TODAY), 'joined yesterday', 'and yesterday as yesterday');
eq(tenureLabel('2026-09-06T08:00:00Z', TODAY), '7 days on your book', 'a first week is counted in days');
eq(tenureLabel('2026-08-16T08:00:00Z', TODAY), '4 weeks on your book', 'a month or so is counted in weeks');
eq(tenureLabel('2026-03-13T08:00:00Z', TODAY), '6 months on your book', 'half a year is counted in months');
eq(tenureLabel('2024-09-13T08:00:00Z', TODAY), '2 years on your book', 'two years is two years');
eq(tenureLabel('2025-09-13T08:00:00Z', TODAY), '1 year on your book', 'and one year is singular');

// The point of the whole rule, stated as an assertion: these two rows carry the
// same rating and are not the same sentence.
ok(tenureLabel('2026-09-04T08:00:00Z', TODAY) !== tenureLabel('2024-01-04T08:00:00Z', TODAY),
  'a nine-day-old client and a two-year client do not read alike');

// 364 days must not be reported as twelve months — a year has its own band, and
// rounding 364/30.44 lands on 12.
eq(tenureLabel('2025-09-14T08:00:00Z', TODAY), '11 months on your book',
  'the day before a year is still months, and never twelve of them');

// The absences.
eq(tenureLabel(null, TODAY), null, 'no join date says nothing rather than "joined today"');
eq(tenureLabel(undefined, TODAY), null, 'and neither does a missing one');
eq(tenureLabel('nonsense', TODAY), null, 'an unparseable date says nothing');
eq(tenureLabel('2026-09-20T08:00:00Z', TODAY), null,
  'a join date in the future is a disagreeing clock, not a negative tenure');

// A bare YYYY-MM-DD is a calendar day and must not be dragged back through UTC
// midnight. Were it parsed as UTC, this would read as yesterday west of
// Greenwich — which is exactly the defect the house rule names.
eq(tenureLabel('2026-09-13', TODAY), 'joined today', 'a bare date is the day it says it is');

/* ── 2. last seen, and the two sentinels that are not elapsed times ───────── */

eq(activityLabel('3d ago'), 'last seen 3d ago', 'an elapsed time gets the prefix');
eq(activityLabel('45m ago'), 'last seen 45m ago', 'in every grain the roster writes');
eq(activityLabel('6h ago'), 'last seen 6h ago', 'including hours');
// 'no activity yet' is the roster's whole-read answer and is already a
// sentence. "last seen no activity yet" is the screen sounding broken.
eq(activityLabel('no activity yet'), 'no activity yet', 'a sentence is passed through as itself');
eq(activityLabel('added by you'), 'added by you', 'as is a hand-added client');
eq(activityLabel('just added'), 'just added', 'and one added this second');
// The capped read. Unknown is worth saying and is said as a dash, never as idle.
eq(activityLabel('—'), 'last seen —', 'a capped activity read is unknown, and shows as the dash');
eq(activityLabel(''), null, 'nothing at all draws nothing');
eq(activityLabel(null), null, 'and so does a missing field');

/* ── 3. unread: three states, and zero is not one of the visible two ──────── */

{
  const unknown = unreadMark(null);
  ok(unknown != null, 'an unreadable count is shown');
  eq(unknown?.text, 'unread —', 'as a dash, against the word it is a dash for');
  eq(unknown?.known, false, 'flagged as not known, so the caller can colour it differently');
  ok(!!unknown && /could not be read/.test(unknown.spoken), 'and said in words to a screen reader');
}
eq(unreadMark(0), null, 'nobody waiting draws no badge — a zero badge is still a badge');
{
  const three = unreadMark(3);
  eq(three?.text, '3 unread', 'three unread prints three');
  eq(three?.known, true, 'and is a known figure');
  eq(three?.spoken, '3 unread messages from them', 'spoken in full');
}
eq(unreadMark(1)?.spoken, '1 unread message from them', 'one message is singular');
eq(unreadMark(Number.NaN), null, 'a NaN is not a count of anything');

// The one that mattered: unknown and none must not render the same.
ok(unreadMark(null)?.text !== (unreadMark(0)?.text ?? null),
  'an unknown count and nobody waiting are not the same badge');

/* ── 4. injuries: the area, never the note ────────────────────────────────── */

eq(injuryMark(undefined), null, 'nothing disclosed, nothing drawn');
eq(injuryMark([]), null, 'and an empty list is not a badge');
{
  const m = injuryMark([{ area: 'knee', severity: 'mild', note: 'aches on stairs', isNew: true }]);
  eq(m?.text, 'New injury · knee', 'a fresh disclosure says so');
  eq(m?.isNew, true, 'and is flagged for the colour');
  ok(!!m && !/stairs/.test(m.text) && !/stairs/.test(m.spoken),
    'the free-text note never reaches a ranking a coach skims');
}
eq(injuryMark([{ area: 'shoulder', severity: 'mild' }])?.text, 'Injury · shoulder',
  'an older disclosure is stated without the word new');
{
  const two = injuryMark([
    { area: 'knee', severity: 'mild', isNew: true },
    { area: 'wrist', severity: 'mild' },
  ]);
  eq(two?.text, '2 injuries · 1 new', 'several are counted, with how many are new');
  eq(two?.isNew, true, 'and the badge still reads as new');
}
eq(injuryMark([{ area: 'knee', severity: 'mild' }, { area: 'wrist', severity: 'mild' }])?.text,
  '2 injuries', 'with no fresh ones it is a plain count');
eq(injuryMark([{ area: '  ', severity: 'mild' }]), null,
  'a blank area is not an injury — it would print a badge naming nothing');

/* ── 5. the scan figure, and only ever the one ────────────────────────────── */

eq(scanFact(undefined), null, 'no scan is not a score of zero');
eq(scanFact({}), null, 'and neither is a scan that carried no score');
eq(scanFact({ inbodyScore: 78 }), 'InBody score 78', 'the score is named');
eq(scanFact({ inbodyScore: 77.6 }), 'InBody score 78', 'and is whole on a caption');
// Everything else on the sheet is left off, so the column compares like with
// like down the board rather than fat on one row and lean mass on the next.
eq(scanFact({ visceralFat: 9, leanMassKg: 52.1 }), null,
  'another figure entirely does not stand in for the score');

/* ── 6. the row as a whole ────────────────────────────────────────────────── */

const FULL: RowClient = {
  joinedAt: '2024-09-13T08:00:00Z',
  lastActive: '3d ago',
  unread: 2,
  injuries: [{ area: 'knee', severity: 'mild', isNew: true }],
  metrics: { inbodyScore: 78 },
};

eq(rowFacts(FULL, TODAY).join(' · '), '2 years on your book · last seen 3d ago · InBody score 78',
  'the caption reads in the order a coach needs it');

// A client nothing is known about produces NO fragments rather than three
// dashes: a row of dashes reads as a broken screen, and the board already says
// elsewhere what it does not know.
const BLANK: RowClient = { joinedAt: null, lastActive: 'no activity yet', unread: null };
eq(rowFacts(BLANK, TODAY).join(' · '), 'no activity yet',
  'an unknown fact contributes nothing to the caption rather than a dash in it');
ok(!rowFacts(BLANK, TODAY).some((f) => f === ''), 'and never an empty fragment, which prints as a double separator');

// The spoken line carries the two badges the caption does not, because colour
// and a bare numeral are the two things a screen reader cannot read.
{
  const said = rowSpoken(FULL, TODAY);
  ok(/2 years on your book/.test(said), 'the spoken row carries the tenure');
  ok(/new injury they have disclosed: knee/.test(said), 'and the injury badge in words');
  ok(/2 unread messages from them/.test(said), 'and the unread badge in words');
}
ok(/could not be read/.test(rowSpoken(BLANK, TODAY)),
  'an unreadable unread count is spoken as unknown rather than skipped');

// The spoken form of `lastActive` comes from src/lib/lastActiveLine.ts rather
// than from a second wording invented here — that module exists because four of
// the field's five shapes are not sentences, and the dash one is a FAILED READ
// that must never be read aloud as somebody having gone quiet.
{
  const capped = rowSpoken({ joinedAt: null, lastActive: '—', unread: 0 }, TODAY);
  ok(/could not be read/.test(capped), 'a capped activity read is spoken as unread, not as inactivity');
  ok(!/last seen —/.test(capped), 'and never as the caption fragment, which is not a sentence');
}
eq(rowSpoken({ joinedAt: null, lastActive: 'added by you', unread: 0 }, TODAY),
  'You added them by hand, so nothing has been recorded against them yet.',
  'a hand-added client gets the one sentence that is true about them, and nothing else');
// Every sentence ends in a stop. Without them a screen reader runs the row
// together into one clause.
ok(rowSpoken(FULL, TODAY).split(' ').every((w) => w.length > 0), 'the spoken row has no double spaces');
ok(/\.$/.test(rowSpoken(FULL, TODAY)), 'and it ends in a full stop');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('leaderboardFacts.test.ts — all assertions passed');
