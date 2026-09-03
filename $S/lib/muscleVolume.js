"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_BOARD = void 0;
exports.muscleBoard = muscleBoard;
exports.unmatchedNote = unmatchedNote;
const exerciseId_1 = require("./exerciseId");
const bodyweightSets_1 = require("./bodyweightSets");
const timedSets_1 = require("./timedSets");
exports.EMPTY_BOARD = { groups: [], untrained: null, unmatched: [], unmatchedSets: 0 };
/** The local calendar day an instant falls on. Matches `dayKey` in ./streaks.ts
 *  for the reason given there: an evening session in a UTC+2 gym belongs to the
 *  evening, not to tomorrow. */
const dayOf = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/**
 * Work per muscle group over a window.
 *
 * `sinceMs` is inclusive and `nowMs` exclusive of nothing — an entry logged
 * this second counts. An entry whose timestamp will not parse is left out
 * entirely rather than filed under today, which is the defect
 * src/lib/ownTraining.ts documents.
 *
 * `catalogueWhole` is whether the catalogue read landed complete. It decides
 * one thing and one thing only: whether `untrained` may be stated at all.
 */
function muscleBoard(log, catalogue, opts) {
    const { sinceMs, nowMs = Date.now(), history = [], catalogueWhole = false } = opts;
    const bySlug = new Map();
    const allGroups = new Set();
    for (const row of catalogue) {
        if (!row || typeof row.id !== 'string' || !row.id)
            continue;
        bySlug.set(row.id, row);
        const g = (row.group || '').trim();
        if (g)
            allGroups.add(g);
    }
    const work = new Map();
    const unmatched = new Map();
    let unmatchedSets = 0;
    for (const e of log) {
        if (!e || typeof e.t !== 'string')
            continue;
        const ms = Date.parse(e.t);
        if (!Number.isFinite(ms) || ms < sinceMs || ms > nowMs)
            continue;
        // Sets, not cardio. A run has no muscle group in the catalogue's sense and
        // filing it under one would be this file inventing the very opinion its
        // header refuses to hold.
        if (!e.sets?.length)
            continue;
        // A held set loaded the muscle and is counted as a set, but it carries no
        // tonnage — see src/lib/timedSets.ts. `entryTonnage` already knows that, so
        // the count is the only thing this line has to be careful about.
        const setCount = e.sets.filter((s, i) => (s?.[0] ?? 0) > 0 || (0, timedSets_1.isTimedSet)(e, i)).length;
        if (setCount <= 0)
            continue;
        const slug = (0, exerciseId_1.exerciseSlug)(e.exercise || '');
        const row = slug ? bySlug.get(slug) : undefined;
        const group = (row?.group || '').trim();
        if (!group) {
            const name = (e.exercise || '').trim() || 'Unnamed';
            unmatched.set(name, (unmatched.get(name) ?? 0) + setCount);
            unmatchedSets += setCount;
            continue;
        }
        const day = dayOf(e.t);
        const t = (0, bodyweightSets_1.entryTonnage)(e, history);
        const cur = work.get(group);
        if (!cur) {
            work.set(group, {
                group,
                sets: setCount,
                volumeKg: t.kg > 0 ? Math.round(t.kg) : null,
                unpricedSets: t.unknownSets,
                exercises: [e.exercise],
                lastDay: day || null,
            });
            continue;
        }
        cur.sets += setCount;
        if (t.kg > 0)
            cur.volumeKg = Math.round((cur.volumeKg ?? 0) + t.kg);
        cur.unpricedSets += t.unknownSets;
        if (!cur.exercises.includes(e.exercise))
            cur.exercises.push(e.exercise);
        if (day && (cur.lastDay == null || day > cur.lastDay))
            cur.lastDay = day;
    }
    const groups = [...work.values()].sort((a, b) => b.sets - a.sets || (b.volumeKg ?? 0) - (a.volumeKg ?? 0) || a.group.localeCompare(b.group));
    return {
        groups,
        untrained: catalogueWhole
            ? [...allGroups].filter((g) => !work.has(g)).sort((a, b) => a.localeCompare(b))
            : null,
        unmatched: [...unmatched.keys()].sort((a, b) => (unmatched.get(b) ?? 0) - (unmatched.get(a) ?? 0) || a.localeCompare(b)),
        unmatchedSets,
    };
}
/**
 * What to say about the movements this board could not file, or null when
 * there are none.
 *
 * One sentence, one place, and it names the count of SETS rather than of
 * names: "4 sets" is the size of the hole in the board, and "2 movements" is
 * not.
 */
function unmatchedNote(board) {
    if (!board.unmatched.length)
        return null;
    const n = board.unmatchedSets;
    const named = board.unmatched.slice(0, 3).join(', ');
    const more = board.unmatched.length > 3 ? `, and ${board.unmatched.length - 3} more` : '';
    return `${n} set${n === 1 ? '' : 's'} are not in this — ${named}${more} ${board.unmatched.length === 1 ? 'is' : 'are'} not in the exercise catalogue, so we cannot say which muscle ${board.unmatched.length === 1 ? 'it' : 'they'} worked.`;
}
