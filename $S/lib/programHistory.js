"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_KEY = void 0;
exports.historyBoard = historyBoard;
exports.historyLine = historyLine;
exports.blockSpanLine = blockSpanLine;
const programBlock_1 = require("./programBlock");
const entryEdit_1 = require("./entryEdit");
/** The key on the live assignment. A literal rather than an empty string, so a
 *  React list cannot collide it with a history row whose id failed to read. */
exports.CURRENT_KEY = 'current-assignment';
const titleOf = (p) => (p?.title ?? '').trim() || 'An untitled programme';
/**
 * Whole days between two day keys, or null.
 *
 * Day keys rather than instants, so a block assigned at 23:50 and replaced at
 * 00:10 the next morning reads as one day rather than as nought — which is what
 * a millisecond division and a floor would give, and it is the difference
 * between "ran a day" and "ran no time at all" on a coach's screen.
 */
function daysBetweenKeys(from, to) {
    if (!from || !to)
        return null;
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return null;
    // UTC midnights on both sides, so there is no daylight-saving hour in the
    // subtraction and the quotient is exact.
    return Math.round((b - a) / 86400000);
}
const UNREADABLE = { state: 'unreadable', entries: [], earlierCount: null };
/**
 * The timeline.
 *
 * `current` is the live `assigned_programs` programme or null, and
 * `currentStatus` is how THAT read went — separately from `status`, which is
 * how the history read went. Two reads, two statuses, and a null `current`
 * under anything but a landed read means "we did not find out what they are on"
 * rather than "they are on nothing". That distinction is the whole of
 * src/ui/assignedPrograms.tsx's header and it must not be lost on the way here.
 *
 * `rows` null under 'error' for the same reason it is in
 * src/lib/clientTraining.ts: an empty array must never be able to arrive here
 * meaning two things.
 */
function historyBoard(rows, status, current, currentStartsOn, currentStatus) {
    const entries = [];
    // The live assignment leads, and only when its own read landed. Under
    // 'loading' or 'error' it is left out entirely rather than drawn as absent:
    // the screen's own branch says the current programme could not be read, and
    // a timeline that silently omitted it would read as a client between blocks.
    if (current && (currentStatus === 'ready' || currentStatus === 'partial')) {
        entries.push({
            key: exports.CURRENT_KEY,
            current: true,
            program: current,
            title: titleOf(current),
            weeks: (0, programBlock_1.weekCount)(current),
            startsOn: currentStartsOn,
            // Deliberately no `fromDay`. `assigned_programs` carries `updated_at`,
            // which is when the row was last WRITTEN and not when the block began —
            // and before part 176 it was not even that, because `default now()` fires
            // on insert only and every overwrite left it at the first assignment's
            // date. The start date the coach typed is the honest answer and it is
            // carried above; where they did not type one there is nothing to show,
            // which is better than a date that means something else.
            fromDay: null,
            toDay: null,
            ranDays: null,
            reason: 'replaced',
        });
    }
    if (rows == null || status === 'error' || status === 'loading') {
        // The current block is still worth drawing when it read: "this is what they
        // are on, and what came before could not be read" is two true sentences.
        return entries.length
            ? { state: 'unreadable', entries, earlierCount: null }
            : UNREADABLE;
    }
    for (const r of rows) {
        // A history row with no programme is not a block. It cannot happen —
        // `program` is NOT NULL in the table — and a jsonb column read through two
        // layers of optional chaining can still hand back null, at which point
        // there is nothing to name, nothing to count weeks of, and nothing a coach
        // could open. Dropped rather than rendered as an untitled empty block,
        // which would read as a programme with no exercises in it.
        if (!r.program)
            continue;
        const fromDay = r.assignedAt ? (0, entryEdit_1.dayKeyOf)(r.assignedAt) : null;
        const toDay = r.replacedAt ? (0, entryEdit_1.dayKeyOf)(r.replacedAt) : null;
        entries.push({
            key: r.id,
            current: false,
            program: r.program,
            title: titleOf(r.program),
            weeks: (0, programBlock_1.weekCount)(r.program),
            startsOn: r.startsOn,
            fromDay,
            toDay,
            ranDays: daysBetweenKeys(fromDay, toDay),
            reason: r.reason,
        });
    }
    const earlier = entries.filter((e) => !e.current);
    if (!earlier.length) {
        return { state: 'none', entries, earlierCount: status === 'ready' ? 0 : null };
    }
    return {
        state: 'some',
        entries,
        // A count only over a whole read. Under 'partial' the blocks listed are
        // real blocks and are worth reading; how many there are is not something a
        // prefix of an unknown set can say.
        earlierCount: status === 'ready' ? earlier.length : null,
    };
}
const s = (n) => (n === 1 ? '' : 's');
/**
 * The line under the timeline heading.
 *
 * The 'none' branch carries the sentence that stops a coach drawing the wrong
 * conclusion from a true answer. There genuinely is no earlier programme for
 * this client — and that is also true of every client in the app whose
 * programmes were replaced before the history table existed, because those
 * overwrites destroyed what came before and nothing can bring them back. A
 * coach who reads "no earlier programmes" about a client they have coached for
 * two years should be told which of the two they are looking at.
 */
function historyLine(status, board, who) {
    if (status === 'loading')
        return 'Reading what they were on before…';
    if (board.state === 'unreadable') {
        return `The earlier programmes could not be read. That is not the same as ${who} never having been on one.`;
    }
    if (board.state === 'none') {
        return `No earlier programme on record. Programmes replaced before this app started keeping the record were overwritten and cannot be recovered, so this is silent about anything before then.`;
    }
    if (board.earlierCount == null) {
        return `Their earlier programmes came back at the row limit, so how many there are cannot be counted from here. Every block listed is real.`;
    }
    return `${board.earlierCount} earlier programme${s(board.earlierCount)} on record.`;
}
/**
 * How one block's span reads, in sentence case, with no dash inside it.
 *
 * Every branch is a different fact about the record rather than a shorter
 * version of the same one. scripts/check-prose.mjs exists because a `fig()` in
 * the middle of a sentence renders as an em dash and the sentence loses its
 * subject; here the temptation is `${from} — ${to}`, which does the same thing
 * from the other direction when one end is missing.
 */
function blockSpanLine(e, dayName) {
    if (e.current) {
        return e.startsOn
            ? `On this now. You set it to start ${dayName(e.startsOn)}.`
            : 'On this now.';
    }
    const ended = e.reason === 'removed'
        ? 'taken off it'
        : 'moved onto something else';
    if (e.fromDay && e.toDay) {
        return e.ranDays == null
            ? `Assigned ${dayName(e.fromDay)}, ${ended} ${dayName(e.toDay)}.`
            : `Assigned ${dayName(e.fromDay)}, ${ended} ${dayName(e.toDay)} — ${e.ranDays} day${s(e.ranDays)}.`;
    }
    if (e.toDay) {
        return `${ended === 'taken off it' ? 'Taken off it' : 'Replaced'} ${dayName(e.toDay)}. When it was assigned is not on record.`;
    }
    if (e.fromDay)
        return `Assigned ${dayName(e.fromDay)}.`;
    return 'Neither end of this block is on record, so there are no dates to give for it.';
}
