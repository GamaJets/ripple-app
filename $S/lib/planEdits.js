"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_PLAN_EDITS = exports.PLAN_EDITS_KEY = void 0;
exports.isEmptyEdits = isEmptyEdits;
exports.editCount = editCount;
exports.editsForDay = editsForDay;
exports.readPlanEdits = readPlanEdits;
exports.writePlanEdits = writePlanEdits;
exports.planEditsNote = planEditsNote;
/** Where the edits live on the device. One key for all four, for the reason
 *  above: they are one answer and must not half-arrive. */
exports.PLAN_EDITS_KEY = 'repple.planEdits';
exports.EMPTY_PLAN_EDITS = { swaps: {}, exEdits: {}, removed: [], custom: [] };
/** True when the member has changed nothing. Used to decide whether there is
 *  anything to say — and never to decide whether the read worked, which is a
 *  different question with a different answer below. */
function isEmptyEdits(e) {
    return !Object.keys(e.swaps).length && !Object.keys(e.exEdits).length
        && !e.removed.length && !e.custom.length;
}
/** How many separate changes there are, for a sentence that has to count them.
 *  A movement both swapped and re-loaded is two changes, because it is: the
 *  coach has two things to look at. */
function editCount(e) {
    return Object.keys(e.swaps).length + Object.keys(e.exEdits).length + e.removed.length + e.custom.length;
}
/** Changes belonging to one weekday, so a screen showing Tuesday can say what
 *  has been changed about Tuesday rather than about the week. */
function editsForDay(e, dayIdx) {
    const mine = (k) => k.indexOf(`${dayIdx}:`) === 0;
    return Object.keys(e.swaps).filter(mine).length
        + Object.keys(e.exEdits).filter(mine).length
        + e.removed.filter(mine).length;
}
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
/**
 * Read a stored blob, and say whether it was actually read.
 *
 * The pair is the whole point, and it is the same distinction
 * src/lib/workoutQueue.ts draws for the offline queue: `null` from AsyncStorage
 * is a real answer — this member has never changed anything — and bytes that
 * will not parse are NOT. Collapsing the two would have the next write
 * serialise an empty object over a member's whole set of corrections because
 * one JSON parse failed once.
 *
 * `read: false` means the caller must not write. Nothing here enforces that;
 * it cannot. The latch lives with whoever owns the storage.
 */
function readPlanEdits(raw) {
    if (raw == null)
        return { edits: exports.EMPTY_PLAN_EDITS, read: true };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { edits: exports.EMPTY_PLAN_EDITS, read: false };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { edits: exports.EMPTY_PLAN_EDITS, read: false };
    }
    const p = parsed;
    const swaps = {};
    for (const [k, v] of Object.entries(obj(p.swaps)))
        if (typeof v === 'string' && v)
            swaps[k] = v;
    const exEdits = {};
    for (const [k, v] of Object.entries(obj(p.exEdits))) {
        if (!v || typeof v !== 'object')
            continue;
        const row = {};
        // Each key only if it is PRESENT, because absent and null mean different
        // things here exactly as they do in src/lib/setRows.ts: no `loadKg` key is
        // "the member has not said", and `loadKg: null` is "the member says there
        // is nothing on it".
        if (typeof v.sets === 'number' && Number.isFinite(v.sets))
            row.sets = v.sets;
        if (typeof v.reps === 'string')
            row.reps = v.reps;
        if ('loadKg' in v)
            row.loadKg = (typeof v.loadKg === 'number' && Number.isFinite(v.loadKg)) ? v.loadKg : null;
        if (Object.keys(row).length)
            exEdits[k] = row;
    }
    const removed = Array.isArray(p.removed) ? p.removed.filter((x) => typeof x === 'string' && !!x) : [];
    const custom = Array.isArray(p.custom)
        ? p.custom.filter((x) => !!x && typeof x === 'object'
            && typeof x.key === 'string'
            && typeof x.name === 'string')
        : [];
    return { edits: { swaps, exEdits, removed, custom }, read: true };
}
/** What goes on the device and into the row. One serialiser, so the cache and
 *  the database cannot grow two opinions about the shape. */
function writePlanEdits(e) {
    return JSON.stringify({ swaps: e.swaps, exEdits: e.exEdits, removed: e.removed, custom: e.custom });
}
/**
 * What to tell the member about where their changes are.
 *
 * Three states and three sentences, and the middle one is the one that has to
 * exist: changes kept on the phone but not yet seen by the coach are not lost
 * AND are not shared, and every version of this screen that collapsed those two
 * either frightened somebody or misled them.
 *
 * Null when there is nothing changed, because "0 changes are saved" is not a
 * sentence.
 */
function planEditsNote(e, shared) {
    const n = editCount(e);
    if (n <= 0)
        return null;
    const what = `${n} change${n === 1 ? '' : 's'} to your plan`;
    if (shared === true)
        return `${what} saved, and your coach can see ${n === 1 ? 'it' : 'them'}.`;
    if (shared === false)
        return `${what} saved on this phone. ${n === 1 ? 'It has' : 'They have'} not reached your coach yet, and ${n === 1 ? 'it goes' : 'they go'} up on their own next time you have signal.`;
    return `${what} saved on this phone.`;
}
