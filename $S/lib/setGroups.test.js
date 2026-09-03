"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const setGroups_1 = require("./setGroups");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const of = (...ids) => ids.map((setGroupId) => ({ setGroupId }));
let n = 0;
const mint = () => `g${++n}`;
// ── The label is derived, and that is the point of the file ───────────────
eq((0, setGroups_1.groupLabel)(2), 'Superset', 'two is a superset');
eq((0, setGroups_1.groupLabel)(3), 'Tri-set', 'three is a tri-set');
eq((0, setGroups_1.groupLabel)(4), 'Giant set', 'four is a giant set');
eq((0, setGroups_1.groupLabel)(9), 'Giant set', 'nine is still a giant set');
// ── Runs ──────────────────────────────────────────────────────────────────
eq((0, setGroups_1.groupRuns)(of(null, null)), [], 'ungrouped exercises make no runs');
eq((0, setGroups_1.groupRuns)(of('a', 'a')), [{ start: 0, size: 2, id: 'a' }], 'a pair is one run');
// A lone id is NOT a group. Asserted explicitly because it is the state left
// behind when the other half of a superset is deleted.
eq((0, setGroups_1.groupRuns)(of('a', null, 'b')), [], 'a single-member id is not a run');
eq((0, setGroups_1.badges)(of('a'))[0], null, 'a lone id gets no badge');
// Adjacency, not membership. Same id either side of an ungrouped exercise is
// two runs of one — so nothing.
eq((0, setGroups_1.groupRuns)(of('a', null, 'a')), [], 'the same id split by a gap is not one run');
eq((0, setGroups_1.groupRuns)(of('a', 'a', null, 'a', 'a')), [
    { start: 0, size: 2, id: 'a' }, { start: 3, size: 2, id: 'a' },
], 'a split run is two runs');
// ── Badges carry position, so the client can say "2 of 3" ────────────────
eq((0, setGroups_1.badges)(of('a', 'a', 'a')).map((b) => b && `${b.label} ${b.position}/${b.size}`), ['Tri-set 1/3', 'Tri-set 2/3', 'Tri-set 3/3'], 'positions run 1-based');
eq((0, setGroups_1.badges)(of(null, 'a', 'a'))[0], null, 'an ungrouped exercise has no badge');
// ── Joining ───────────────────────────────────────────────────────────────
eq((0, setGroups_1.joinNext)(of(null, null), 0, mint), ['g1', 'g1'], 'joining two loose exercises mints one id');
ok(!(0, setGroups_1.canJoinNext)(of('a', 'a'), 0), 'already-joined neighbours cannot be joined again');
ok(!(0, setGroups_1.canJoinNext)(of(null, null), 1), 'the last exercise has no next');
eq((0, setGroups_1.joinNext)(of('a', 'a', null), 1, mint), ['a', 'a', 'a'], 'joining onto a run adopts its id, making a tri-set');
eq((0, setGroups_1.badges)((0, setGroups_1.joinNext)(of('a', 'a', null), 1, mint).map((setGroupId) => ({ setGroupId })))[0]?.label, 'Tri-set', 'and the label follows the size without anybody setting it');
// Merging two runs relabels BOTH, not just the two touching exercises —
// otherwise the far half keeps the old id and splits apart again.
eq((0, setGroups_1.joinNext)(of('a', 'a', 'b', 'b'), 1, mint), ['a', 'a', 'a', 'a'], 'merging two runs relabels all four');
eq((0, setGroups_1.groupRuns)(of('a', 'a', 'a', 'a')).length, 1, 'and they read back as one run');
// A refused join changes nothing at all. The last-index case is the one that
// matters and the one a mutation test caught: without the guard, joining the
// final exercise to the nothing after it MINTS AN ID and hands it to that lone
// exercise — a group of one, which `groupRuns` then correctly refuses to
// badge, leaving an invisible id that silently swallows the next real join.
eq((0, setGroups_1.joinNext)(of('a', 'a'), 0, mint), ['a', 'a'], 'a refused join returns the ids untouched');
eq((0, setGroups_1.joinNext)(of(null, null), 1, mint), [null, null], 'joining the last exercise mints nothing');
eq((0, setGroups_1.joinNext)(of('a', 'a'), 1, mint), ['a', 'a'], 'joining the last exercise of a run is refused too');
// ── Leaving ───────────────────────────────────────────────────────────────
eq((0, setGroups_1.leaveGroup)(of('a', 'a', 'a'), 2), ['a', 'a', null], 'leaving clears only that exercise');
eq((0, setGroups_1.badges)(of('a', 'a', null))[0]?.label, 'Superset', 'a tri-set that loses one becomes a superset');
eq((0, setGroups_1.badges)((0, setGroups_1.leaveGroup)(of('a', 'a'), 0).map((setGroupId) => ({ setGroupId })))[1], null, 'a pair that loses one leaves nobody grouped');
ok((0, setGroups_1.isGrouped)(of('a', 'a'), 0), 'isGrouped is true inside a run');
ok(!(0, setGroups_1.isGrouped)(of('a', null), 0), 'isGrouped is false for a leftover id');
// Empty and single-item lists are ordinary, not special cases.
eq((0, setGroups_1.groupRuns)([]), [], 'no exercises, no runs');
eq((0, setGroups_1.badges)([]), [], 'no exercises, no badges');
if (errors.length) {
    errors.forEach((e) => console.error('FAIL', e));
    process.exit(1);
}
console.log(`setGroups ok — ${'supersets are named by their size, and adjacency is the only model'}`);
