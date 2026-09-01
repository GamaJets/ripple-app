// The programmes a reassign used to destroy. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: "no earlier programmes" is a
// sentence a coach ACTS on. They conclude the client is new to them, or that
// nothing was ever kept, and they stop looking. So an empty timeline must never
// be producible by a read that failed — and where the timeline genuinely is
// empty, the line has to say that programmes replaced before this record
// existed were overwritten and are not coming back.
import {
  CURRENT_KEY, blockSpanLine, historyBoard, historyLine, type HistoryRow,
} from './programHistory';
import type { Program } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const prog = (title: string, weeks = 1): Program => ({
  title, focus: [], note: '',
  days: [{ day: 'Mon', focus: 'Push', exercises: [] }],
  ...(weeks > 1 ? { weeks: Array.from({ length: weeks }, () => ({ days: [{ day: 'Mon', focus: 'Push', exercises: [] }] })) } : {}),
});

/** Noon local, so the day key is the same in every zone the repo tests under.
 *  The assertions here are about which block ran when, not about a boundary. */
const at = (day: string) => `${day}T12:00:00`;

const rows: HistoryRow[] = [
  { id: 'h2', program: prog('Summer Block'), startsOn: '2026-06-01', assignedAt: at('2026-06-01'), replacedAt: at('2026-08-01'), reason: 'replaced' },
  { id: 'h1', program: prog('Spring Block'), startsOn: null, assignedAt: at('2026-03-02'), replacedAt: at('2026-06-01'), reason: 'replaced' },
];

const current = prog('Autumn Block', 8);

/* ── the timeline, with the present at the top of it ────────────────────── */

const board = historyBoard(rows, 'ready', current, '2026-09-01', 'ready');
eq(board.state, 'some', 'there are earlier blocks');
eq(board.entries.length, 3, 'and the timeline is them plus the one they are on');
eq(board.entries[0].key, CURRENT_KEY, 'the live assignment leads');
ok(board.entries[0].current, 'and is marked as the current one');
eq(board.entries[0].weeks, 8, 'carrying its own length, so a coach reads "8 weeks" without asking a second module');
eq(board.entries[0].startsOn, '2026-09-01', 'and the date the coach set');

// Counting EARLIER blocks only. "5 programmes" that silently includes the one
// on screen is the off-by-one a coach checks by counting the list and then
// stops trusting the screen over.
eq(board.earlierCount, 2, 'the count is of earlier blocks, not of the whole list');
eq(board.entries[1].title, 'Summer Block', 'newest earlier block first, in the order the read gave them');
eq(board.entries[1].ranDays, 61, 'and how long it ran, in whole days');

/* ── the refusal that matters most ──────────────────────────────────────── */

// THE assertion. A failed read must not produce a timeline that reads as a
// client who has only ever been on one thing.
const unread = historyBoard(null, 'error', current, '2026-09-01', 'ready');
eq(unread.state, 'unreadable', 'a refused read is unreadable, not empty');
eq(unread.earlierCount, null, 'and has no count');
eq(unread.entries.length, 1,
  'the current block is still drawn — "this is what they are on, and what came before could not be read" is two true sentences');

eq(historyBoard(null, 'loading', null, null, 'loading').state, 'unreadable',
  'a read in flight has produced no rows and is not an empty history');

// A capped read lists real blocks and refuses to count them: `capped()` hands
// back a prefix of an unknown set, so a total over it is a wrong number rather
// than a small one.
const partial = historyBoard(rows, 'partial', current, null, 'ready');
eq(partial.state, 'some', 'a truncated read still has real blocks in it');
eq(partial.earlierCount, null, 'and no count over them');
eq(partial.entries.length, 3, 'every block that arrived is listed');

// The current programme's own read fails independently of the history's, and a
// null under anything but a landed read is "we did not find out what they are
// on" — not "they are on nothing".
const noCurrent = historyBoard(rows, 'ready', null, null, 'error');
eq(noCurrent.entries.filter((e) => e.current).length, 0, 'an unread assignment is left out rather than drawn as absent');
eq(noCurrent.entries.length, 2, 'and the history is still shown');
const currentUnread = historyBoard(rows, 'ready', current, null, 'loading');
eq(currentUnread.entries.filter((e) => e.current).length, 0,
  'a current programme whose read has not landed is not put on the timeline either');

/* ── the genuinely empty case, and what a coach needs told about it ─────── */

const none = historyBoard([], 'ready', current, null, 'ready');
eq(none.state, 'none', 'a landed read with no earlier blocks is "none"');
eq(none.earlierCount, 0, 'which is a count, because the read was whole');

const noneLine = historyLine('ready', none, 'Priya');
ok(/overwritten and cannot be recovered/i.test(noneLine),
  'and the line says that programmes replaced before this record existed are gone — a coach of two years must not read "none" as "we kept nothing worth keeping"');
ok(/could not be read/i.test(historyLine('ready', unread, 'Priya')),
  'an unreadable history names the read');
ok(/not the same as Priya never having been on one/i.test(historyLine('ready', unread, 'Priya')),
  'and refuses the collapse by name');
ok(/row limit/i.test(historyLine('ready', partial, 'Priya')), 'a truncated one says why it cannot count');
eq(new Set([noneLine, historyLine('ready', unread, 'P'), historyLine('ready', partial, 'P'), historyLine('ready', board, 'P')]).size, 4,
  'four states, four sentences');

/* ── a row with no programme is not a block ─────────────────────────────── */

const broken = historyBoard(
  [{ id: 'x', program: null, startsOn: null, assignedAt: null, replacedAt: null, reason: 'replaced' }],
  'ready', null, null, 'ready',
);
eq(broken.state, 'none',
  'a history row carrying no programme is dropped rather than rendered as an untitled block with no exercises in it');

/* ── the spans, with no dash left in the middle of a sentence ───────────── */

const day = (d: string) => d;
ok(/On this now/.test(blockSpanLine(board.entries[0], day)), 'the current block says so');
ok(/start 2026-09-01/.test(blockSpanLine(board.entries[0], day)), 'with the date the coach set');
ok(/61 days/.test(blockSpanLine(board.entries[1], day)), 'a finished block says how long it ran');

const removed = historyBoard(
  [{ id: 'r', program: prog('Rehab'), startsOn: null, assignedAt: at('2026-01-01'), replacedAt: at('2026-02-01'), reason: 'removed' }],
  'ready', null, null, 'ready',
);
ok(/taken off it/.test(blockSpanLine(removed.entries[0], day)),
  'being taken OFF a programme is a different event from being moved onto another one, and a timeline that merged them would show a gap as a change');

// `assigned_programs.updated_at` was stale on every overwrite made before part
// 176 fixed it, so `assignedAt` can genuinely be null. A missing end is said
// rather than filled in: guessing would make a block that ran three months look
// like it ran no time at all.
const halfDated = historyBoard(
  [{ id: 'd', program: prog('Old'), startsOn: null, assignedAt: null, replacedAt: at('2026-02-01'), reason: 'replaced' }],
  'ready', null, null, 'ready',
);
eq(halfDated.entries[0].ranDays, null, 'a block with one end missing has no length rather than a guessed one');
ok(/not on record/.test(blockSpanLine(halfDated.entries[0], day)), 'and says which end is missing');

const undated = historyBoard(
  [{ id: 'u', program: prog('Older'), startsOn: null, assignedAt: null, replacedAt: null, reason: 'replaced' }],
  'ready', null, null, 'ready',
);
ok(/no dates to give/.test(blockSpanLine(undated.entries[0], day)),
  'and a block with neither end says so in a sentence rather than printing two dashes');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('programHistory: ok — a failed read is never an empty timeline, and "none" says what was destroyed before the record existed');
