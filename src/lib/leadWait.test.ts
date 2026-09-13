// Enquiries ordered by how long nothing has been done about them. Compile with
// tsc, run with node.
//
// Every mistake this module can make renders as a short, tidy, plausible queue,
// and each is wrong in its own direction:
//
//   · an enquiry DROPPED is a stranger the coach is told nobody is waiting on.
//     That is the only silent-and-dangerous direction, so a row whose date
//     cannot be read is counted (`undated`) rather than discarded, and it is
//     asserted for twice.
//   · an enquiry the coach has ALREADY dealt with, sitting at the top of a
//     queue about neglect, is the row that teaches them the list is wrong. Both
//     of the two ways a coach records that they dealt with it are asserted
//     separately, because either test on its own passes half the cases.
//   · a count stated over half a book is the confident subtotal
//     src/ui/loadStatus.ts exists to refuse.
//   · an age off by a time zone is worse than no age at all — a bare date is
//     UTC midnight to `Date.parse`, and this list is read as a number of days.
import {
  LEAD_WAIT_TITLE, LEAD_WAIT_TITLE_NOTE, waitingLeads, hasLeadWait,
  leadWaitCountNote, leadWaitLine, leadWaitNote, longestWaitingLine,
} from './leadWait';
import type { LeadRow, LeadState } from './leads';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A fixed instant, stated by the test rather than raced against a real clock. */
const NOW = Date.parse('2026-09-13T12:00:00.000Z');

/** Nothing recorded against anybody — the default this queue is about. */
const nothingRecorded = () => false;

function lead(p: Partial<LeadRow> & { id: string }): LeadRow {
  return {
    name: 'Dev Patel', contact: 'dev@example.com', contactKind: 'email',
    note: 'Looking for two sessions a week.',
    viaCode: 'FLYER7', campaign: 'Gym flyer',
    at: new Date(NOW - 3 * DAY).toISOString(),
    state: 'new' as LeadState, joined: false, joinedAt: null,
    ...p,
  };
}

/* ── 1. the order, which is the whole item ────────────────────────────────*/

{
  const book = waitingLeads([
    lead({ id: 'yesterday', at: new Date(NOW - 1 * DAY).toISOString() }),
    lead({ id: 'eleven-days', at: new Date(NOW - 11 * DAY).toISOString() }),
    lead({ id: 'four-days', at: new Date(NOW - 4 * DAY).toISOString() }),
  ], nothingRecorded, true, NOW, 'ready');
  eq(book.rows.map((r) => r.lead.id).join(','), 'eleven-days,four-days,yesterday',
    'longest wait first — the opposite of the newest-first order the list below already has');
  eq(book.rows[0]?.waitedMs, 11 * DAY, 'and the wait is the real subtraction, not a rank');
}

{
  // Total order. Two enquiries left in the same second must not swap places
  // between two renders — a queue worked from the top cannot move under a thumb.
  const at = new Date(NOW - 2 * DAY).toISOString();
  const forward = waitingLeads([lead({ id: 'b', at }), lead({ id: 'a', at })], nothingRecorded, true, NOW, 'ready');
  const reverse = waitingLeads([lead({ id: 'a', at }), lead({ id: 'b', at })], nothingRecorded, true, NOW, 'ready');
  eq(forward.rows.map((r) => r.lead.id).join(','), 'a,b', 'a tie breaks on id');
  eq(reverse.rows.map((r) => r.lead.id).join(','), 'a,b', 'and breaks the same way whichever order it was handed');
}

/* ── 2. the two ways a coach says they have dealt with it ─────────────────*/

{
  const rows = [
    lead({ id: 'untouched' }),
    lead({ id: 'contacted', state: 'contacted' }),
    lead({ id: 'closed', state: 'closed' }),
  ];
  const book = waitingLeads(rows, nothingRecorded, true, NOW, 'ready');
  eq(book.rows.length, 1, 'the coach’s own chips are read back — contacted and closed are not neglect');
  eq(book.rows[0]?.lead.id, 'untouched', 'and it is the one they have not marked');
  eq(book.undated, 0, 'a dealt-with enquiry is not an uncertainty — it is a clear no');
}

{
  // The half `state` cannot see. A coach who rang somebody and wrote it up but
  // never touched the chips has done the thing this list is about.
  const rows = [lead({ id: 'written-up' }), lead({ id: 'nothing' })];
  const book = waitingLeads(rows, (id) => id === 'written-up', true, NOW, 'ready');
  eq(book.rows.length, 1, 'a follow-up written against a still-New enquiry takes it off the queue');
  eq(book.rows[0]?.lead.id, 'nothing', 'and leaves the one with no record at all');
}

/* ── 3. a date that cannot be read is counted, never dropped ──────────────*/

{
  const book = waitingLeads([
    lead({ id: 'dated' }),
    lead({ id: 'null-date', at: null }),
    lead({ id: 'nonsense', at: 'sometime last week' }),
    // The reason `stood` refuses a bare date rather than parsing it: to
    // `Date.parse` this is UTC midnight, so the age it produces is a time zone
    // wide of the truth for most of the people reading it. An age nobody can
    // trust is worse than no age, and this row says so instead.
    lead({ id: 'bare-date', at: '2026-09-01' }),
  ], nothingRecorded, true, NOW, 'ready');
  eq(book.rows.length, 1, 'only the row whose age is measurable is placed in the order');
  eq(book.undated, 3, 'and the other three are COUNTED — a queue that loses a row reads as "that is everybody"');
  ok((leadWaitNote(book) as string).includes('3 more enquiries'),
    'and the count is said out loud under the heading');
}

{
  // A clock skew that puts an enquiry in the future is not a wait, and must not
  // render as a negative age.
  const book = waitingLeads([lead({ id: 'future', at: new Date(NOW + 2 * DAY).toISOString() })],
    nothingRecorded, true, NOW, 'ready');
  eq(book.rows[0]?.waitedMs, 0, 'a future stamp waits zero, not minus two days');
  ok(leadWaitLine(book.rows[0]!).includes('under an hour'), 'and prints as the smallest true unit');
}

/* ── 4. what may be SAID, which is the only thing status changes ──────────*/

{
  const rows = [lead({ id: 'a' }), lead({ id: 'b', at: new Date(NOW - 5 * DAY).toISOString() })];
  for (const s of ['ready', 'partial', 'error', 'loading'] as const) {
    eq(waitingLeads(rows, nothingRecorded, true, NOW, s).rows.length, 2,
      `a ${s} read still lists the enquiries that arrived — hiding them hides the people this section is for`);
  }
  eq(waitingLeads(rows, nothingRecorded, true, NOW, 'ready').withheld, null,
    'a whole read, with the notes read too, has nothing to withhold');
  ok((waitingLeads(rows, nothingRecorded, true, NOW, 'partial').withheld as string).includes('may have been waiting longer'),
    'a truncated read names what it cannot rule out: somebody older than anybody here');
  ok((waitingLeads(rows, nothingRecorded, true, NOW, 'error').withheld as string).includes('could not be read'),
    'a failed one refuses to let the list stand as an answer');
}

{
  // The follow-up read is a separate doubt from the enquiry read, and it is the
  // one that decides whether "nothing has been recorded" may be said at all.
  const rows = [lead({ id: 'a' })];
  const book = waitingLeads(rows, nothingRecorded, false, NOW, 'ready');
  eq(book.rows.length, 1, 'the enquiry is still marked New whatever the notes did');
  ok((book.withheld as string).includes('may already have been dealt with'),
    'but the screen says so, rather than asserting nobody has touched it');
}

{
  eq(leadWaitCountNote(waitingLeads([lead({ id: 'a' })], nothingRecorded, true, NOW, 'ready'), 'ready'),
    '1 enquiry', 'one enquiry is not "1 enquiries"');
  eq(leadWaitCountNote(waitingLeads([lead({ id: 'a' }), lead({ id: 'b' })], nothingRecorded, true, NOW, 'ready'), 'ready'),
    '2 enquiries', 'and the plural is the plural');
  eq(leadWaitCountNote(waitingLeads([lead({ id: 'a' })], nothingRecorded, true, NOW, 'partial'), 'partial'),
    null, 'no count over part of a book — isWhole, not "did not fail"');
  eq(leadWaitCountNote(waitingLeads([], nothingRecorded, true, NOW, 'ready'), 'ready'),
    null, 'and no "0 enquiries", which is a figure a coach reads as a verdict');
}

/* ── 5. the one at the top, named ─────────────────────────────────────────*/

{
  const book = waitingLeads([
    lead({ id: 'new-one', name: 'Amara', at: new Date(NOW - 1 * HOUR).toISOString() }),
    lead({ id: 'old-one', name: 'Joško', at: new Date(NOW - 9 * DAY).toISOString() }),
  ], nothingRecorded, true, NOW, 'ready');
  const line = longestWaitingLine(book, 'ready') as string;
  ok(line.includes('Joško') && line.includes('9 days'), 'the headline names the person and the wait');
  ok(line.includes('the longest'), 'and says outright that it is the longest, which is the point of the section');
  // Under a short read the same row is only the longest of what came back, and
  // the word "longest" on its own would be the one word that is wrong.
  const partial = longestWaitingLine(book, 'partial') as string;
  ok(partial.includes('that came back'), 'under a truncated read it says which set it is the longest of');
  eq(longestWaitingLine(waitingLeads([], nothingRecorded, true, NOW, 'ready'), 'ready'), null,
    'an empty queue has no headline — a sentence with a hole where a name goes is worse than no sentence');
}

/* ── 6. the row sentence never accuses ────────────────────────────────────*/

{
  const book = waitingLeads([lead({ id: 'a', at: new Date(NOW - 2 * DAY).toISOString() })],
    nothingRecorded, true, NOW, 'ready');
  const line = leadWaitLine(book.rows[0]!);
  eq(line, 'Left 2 days ago. Still marked New, with nothing recorded against it.',
    'two facts about the record, in whole units');
  for (const accusation of ['you have not', 'You have not', 'ignored', 'neglect', 'failed']) {
    ok(!line.includes(accusation),
      `the row must not say "${accusation}" — this app sends nothing and never saw the phone call`);
  }
  ok(!LEAD_WAIT_TITLE.toLowerCase().includes('ignored'),
    'nor the title: the heading describes the order, not the coach');
  ok(LEAD_WAIT_TITLE_NOTE.includes('did not write it down'),
    'and the caveat that keeps the section honest says exactly which case it is wrong about');
}

/* ── 7. drawn at all, or not ──────────────────────────────────────────────*/

{
  eq(hasLeadWait(waitingLeads([], nothingRecorded, true, NOW, 'ready')), false,
    'a coach who has worked their enquiries to zero is not shown an empty queue every morning');
  eq(hasLeadWait(waitingLeads([lead({ id: 'a', at: null })], nothingRecorded, true, NOW, 'ready')), true,
    'but an enquiry that could not be placed still brings the section up — it is the row that would vanish');
  eq(leadWaitNote(waitingLeads([], nothingRecorded, true, NOW, 'ready')), null,
    'and an empty whole read has nothing to say under a heading it is not drawing');
}

{
  // Order of the sentence: the doubt about the whole list comes before a detail
  // about part of it. Same rule as `waitingNote` in src/lib/awaitingReply.ts.
  const note = leadWaitNote(waitingLeads(
    [lead({ id: 'a' }), lead({ id: 'b', at: null })], nothingRecorded, true, NOW, 'partial',
  )) as string;
  ok(note.indexOf('waiting longer') < note.indexOf('no readable date'),
    'the read is doubted first; the unplaceable row is a detail about a list that is already not the answer');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'LEAD WAIT FAILURES:\n' + errors.join('\n') : 'leadWait: ok — oldest first, nobody dropped, nobody already dealt with, and no count over half a book');
if (errors.length) process.exit(1);
