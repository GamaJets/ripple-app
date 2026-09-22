// Tests for coachLogReview — what a member may say about a record their coach
// made about them, and what the screen says before it knows.
//
// The properties under test are the two negatives. A name is never printed for
// a row whose `logged_by` we cannot match, because attributing a session to the
// wrong coach is worse than the generic caption it replaces. And "you have not
// queried this" is never stated off a read that did not come back whole,
// because the entire item exists to stop this app treating a member's silence
// as their agreement — and an unread column is silence the app invented.
//
// Compile with tsc then run with node, like logic.test.ts.
import {
  coachNameFor, cleanQueryNote, queryPatch, withdrawPatch, reviewFor,
  indexQueries, queryFor, QUERY_NOTE_MAX,
  type AttributedEntry, type KnownCoach, type QueryRow,
} from './coachLogReview';
import { attributionLine } from './workoutAttribution';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const COACH: KnownCoach = { id: 'coach-1', name: 'Dave Okafor' };
const byCoach: AttributedEntry = { loggedBy: 'coach-1' };
const byMe: AttributedEntry = {};

// ── the name, and the three ways it declines ──
ok(coachNameFor(byCoach, COACH) === 'Dave Okafor', 'a coach we can prove is named');
ok(coachNameFor(byMe, COACH) === null, 'a row the member logged has no coach to name');
ok(coachNameFor(byCoach, null) === null, 'no known coach means the generic caption, not a blank');
ok(coachNameFor({ loggedBy: 'someone-else' }, COACH) === null,
   'a session logged by a DIFFERENT id is never labelled with the one name we can read');
ok(coachNameFor(byCoach, { id: 'coach-1', name: '   ' }) === null,
   'a coach who has set no name is generic, not whitespace');
ok(coachNameFor(byCoach, { id: 'coach-1', name: '  Dave  ' }) === 'Dave', 'the name is trimmed');

// The caption itself is workoutAttribution's, and the whole defect was the
// argument this module now supplies. Both halves asserted together so a change
// to either cannot quietly restore "Logged by your coach" for everybody.
ok(attributionLine(byCoach, coachNameFor(byCoach, COACH), true) === 'Logged by Dave Okafor',
   'the name reaches the caption');
ok(attributionLine(byCoach, coachNameFor(byCoach, null), true) === 'Logged by your coach',
   'and an unproven coach still gets a true generic caption');

// ── the note ──
ok(cleanQueryNote('  that was 8 reps  ') === 'that was 8 reps', 'a note is trimmed');
ok(cleanQueryNote('   ') === null, 'a blank note is null, not an empty string that renders as a failed save');
ok(cleanQueryNote(null) === null && cleanQueryNote(undefined) === null, 'absent is null');
const long = cleanQueryNote('x'.repeat(QUERY_NOTE_MAX + 50));
ok((long?.length ?? 0) === QUERY_NOTE_MAX, 'an over-long note is cut to the bound');

// ── the patches: a correction is a second fact, never an erasure ──
const p = queryPatch('  wrong day  ', '2026-09-13T10:00:00.000Z');
ok(p.query_note === 'wrong day', 'the patch carries the cleaned note');
ok(p.queried_at === '2026-09-13T10:00:00.000Z', 'a timestamptz is sent, because the column is one');
const keys = Object.keys(p).sort().join(',');
ok(keys === 'queried_at,query_note',
   'a query writes the two query columns and NOTHING else — no figure of the coach’s is touched');
const w = Object.keys(withdrawPatch()).sort().join(',');
ok(w === 'queried_at,query_note', 'withdrawing clears the note with the mark, so no orphan sentence survives');
ok(withdrawPatch().queried_at === null && withdrawPatch().query_note === null, 'withdrawal is a null, not a delete');
ok(!/logged_by|amended_at|sets|exercise/.test(JSON.stringify(p) + JSON.stringify(withdrawPatch())),
   'neither patch can reach attribution, the amendment stamp or the session itself');

// ── the reading of rows ──
const rows: QueryRow[] = [
  { id: 'w1', queried_at: '2026-09-03T08:00:00Z', query_note: 'not what we did' },
  { id: 'w2', queried_at: null, query_note: null },
  { id: 'w3', queried_at: '2026-09-04T08:00:00Z', query_note: '   ' },
  { id: '', queried_at: null, query_note: null },
];
const idx = indexQueries(rows);
ok(idx.size === 3, 'a row with no id is dropped rather than keyed on an empty string');
ok(idx.get('w1')?.note === 'not what we did', 'the note comes back');
ok(idx.get('w3')?.note === null && idx.get('w3')?.queriedAt !== null,
   'a whitespace note is nothing said, and does not cancel the query it sits on');
ok(idx.has('w2'), 'an unqueried row is KEPT — its presence is the evidence that it was read');
ok(queryFor(idx, 'w2')?.queriedAt === null, 'a read row with no query reads as no query');
ok(queryFor(idx, 'nope') === null, 'a row the map never saw is null, not an empty query');
ok(queryFor(idx, undefined) === null, 'an entry with no id yet is null');

// ── the strip: the member's own rows say nothing ──
const mine = reviewFor(byMe, null, 'ready', COACH);
ok(mine.own && !mine.actions.query && !mine.actions.amend,
   'the member’s own log is not a claim made about them, so there is nothing to query');

// ── the strip under a whole read ──
const fresh = reviewFor(byCoach, queryFor(idx, 'w2'), 'ready', COACH);
ok(fresh.actions.query && !fresh.actions.withdraw && fresh.actions.amend,
   'an unqueried coach-logged row offers the query and the amendment');
ok(fresh.coachName === 'Dave Okafor', 'and names the coach it can prove');
ok(/not saying anything is not agreeing/.test(fresh.line),
   'the sentence says outright that silence is not consent — the whole point of the item');

const queried = reviewFor(byCoach, queryFor(idx, 'w1'), 'ready', COACH);
ok(!queried.actions.query && queried.actions.withdraw, 'a standing query offers withdrawal, not a second query');
// The day is the READER's day for that instant, which is what the sentence
// dates — 08:00Z on 3 Sep is still 2 Sep on Midway and already 3 Sep at UTC+14,
// and the zone suite runs both. So the expectation is built the same way the
// line is, not typed as a calendar day.
const queriedDay = new Date('2026-09-03T08:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
ok(queried.line.includes(` on ${queriedDay}`), 'a standing query is dated');
ok(/Nothing has been deleted/.test(queried.line),
   'and says the coach’s record still stands, because a query is not an erasure');
ok(queried.actions.amend, 'querying does not take the correction away — they answer different problems');

// A date that will not parse loses the date and keeps the sentence. Dropping
// the line would hide a query that genuinely stands; "Invalid Date" would lie
// about the day somebody objected.
const bad = reviewFor(byCoach, { queriedAt: 'not-a-date', note: null }, 'ready', COACH);
ok(bad.actions.withdraw && !/Invalid/.test(bad.line), 'an unparseable stamp still renders a standing query');

// ── the strip under a read that is NOT whole ──
for (const s of ['loading', 'error', 'partial'] as const) {
  const r = reviewFor(byCoach, null, s, COACH);
  ok(!/not saying anything is not agreeing/.test(r.line),
     `'${s}' never states the member has said nothing — that is the claim this module refuses to invent`);
  ok(r.actions.query, `'${s}' still lets the member object; an unreadable column must not silence them`);
  ok(!r.actions.withdraw, `'${s}' offers no withdrawal, because no standing query is known`);
}
ok(/could not check/.test(reviewFor(byCoach, null, 'error', COACH).line), 'a failed read says so');
ok(/could not check/.test(reviewFor(byCoach, null, 'partial', COACH).line),
   'a TRUNCATED read says so too — ‘partial’ is not ‘ready’ and never counts as one');
ok(/Checking/.test(reviewFor(byCoach, null, 'loading', COACH).line), 'a read in flight says only that');

// A row that IS queried reads as queried under a partial read. The rows that
// came back are real (src/ui/loadStatus.ts); it is only their ABSENCE that means
// nothing, so the status is asked about the hole and not about the row. Guarding
// it the other way would hide a live objection to make a point about a cap.
const partialHit = reviewFor(byCoach, queryFor(idx, 'w1'), 'partial', COACH);
ok(!partialHit.actions.query && partialHit.actions.withdraw,
   'a query the server handed back is known, whether or not the read was whole');
const partialMiss = reviewFor(byCoach, queryFor(idx, 'w2'), 'partial', COACH);
ok(/not saying anything is not agreeing/.test(partialMiss.line),
   'and so is a row that came back carrying no query');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACHLOGREVIEW FAILURES:\n' + errors.join('\n') : 'ALL COACHLOGREVIEW TESTS PASSED');
if (errors.length) process.exit(1);
