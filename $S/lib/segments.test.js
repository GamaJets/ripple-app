"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Addressing a category the app worked out, rather than one somebody typed.
// Compile with tsc, run with node.
//
// The defect this guards is quieter than a broken filter: a tag that fails to
// load matches nobody and the coach reads a zero, whereas an activity read that
// came back short produces a plausible smaller group and a coach writing "I
// haven't seen you in a while" to somebody who trained yesterday. So most of
// what is asserted here is about clients the source could NOT answer for.
const segments_1 = require("./segments");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const f = (over) => ({
    drift: null, packLeft: null, packRunOut: false, adherence: 50, ...over,
});
const def = (k) => {
    const d = (0, segments_1.segmentDef)(k);
    if (!d)
        throw new Error(`no segment ${k}`);
    return d;
};
/* ── the definitions ───────────────────────────────────────────────────── */
ok(segments_1.COMPUTED_SEGMENTS.length > 0, 'there are computed segments at all, which was the gap');
for (const d of segments_1.COMPUTED_SEGMENTS) {
    ok(!!d.title.trim(), `${d.key} has a chip label`);
    // A computed band is not self-explanatory the way a coach's own tag is:
    // "Drifting" is a threshold this app chose and the coach is entitled to know
    // which one before writing to the people under it.
    ok(d.note.trim().length > 30, `${d.key} says what being in it means, at length`);
    // The guard writes "Only part of ___ came back", so this has to read as the
    // object of that sentence.
    ok(/^(who|whose)\b/.test(d.object), `${d.key}'s object reads as the object of a sentence`);
    ok(d.object === d.object.toLowerCase().replace(/^./, (c) => c), `${d.key}'s object starts mid-sentence`);
}
eq((0, segments_1.segmentDef)('not-a-segment'), null, 'an unknown key resolves to nothing rather than to the first one');
/* ── THE ONE THAT MATTERS: never asked is not "nothing recorded" ────────── */
const handAdded = f({ clientId: 'hand', drift: null });
const genuinelyIdle = f({ clientId: 'idle', drift: 'idle' });
ok(!(0, segments_1.inSegment)(def('no-record'), handAdded), 'a client the database was never asked about is NOT in "nothing recorded" — that is the absence of a question');
ok((0, segments_1.inSegment)(def('no-record'), genuinelyIdle), 'a client who was asked about and had nothing is');
for (const k of ['drifting', 'slipping', 'no-record']) {
    ok(!(0, segments_1.inSegment)(def(k), handAdded), `and is in no drift band at all (${k})`);
}
eq((0, segments_1.unassessed)(def('drifting'), [handAdded, genuinelyIdle]).join(','), 'hand', 'the ones that could not be assessed are handed back so the screen can say how many');
// Packs and adherence answer for everybody: no purchases really is no pack, and
// no check-ins really is no adherence figure.
eq((0, segments_1.unassessed)(def('pack-run-out'), [handAdded]).length, 0, 'a purchase read answers for everybody');
eq((0, segments_1.unassessed)(def('never-checked-in'), [handAdded]).length, 0, 'and so does the roster');
const note = (0, segments_1.unassessedNote)(def('no-record'), 3);
ok(note !== null && /3/.test(note), 'the note counts them');
ok(note !== null && /no account/.test(note), 'and says why they could not be reached');
ok(note !== null && /never asked/.test(note), 'and that they were never asked about, rather than found to be outside');
eq((0, segments_1.unassessedNote)(def('no-record'), 0), null, 'and says nothing when there is nobody to say it about');
/* ── the drift bands ───────────────────────────────────────────────────── */
eq((0, segments_1.segmentMembers)(def('drifting'), [
    f({ clientId: 'a', drift: 'at_risk' }), f({ clientId: 'b', drift: 'watch' }),
    f({ clientId: 'c', drift: 'on_track' }),
]).join(','), 'a', 'drifting is at_risk and nothing else');
eq((0, segments_1.segmentMembers)(def('slipping'), [
    f({ clientId: 'a', drift: 'at_risk' }), f({ clientId: 'b', drift: 'watch' }),
]).join(','), 'b', 'and slipping is watch');
/* ── packs ─────────────────────────────────────────────────────────────── */
ok((0, segments_1.inSegment)(def('pack-run-out'), f({ clientId: 'x', packRunOut: true, packLeft: 0 })), 'a client with nothing left on a paid pack is in the run-out list');
ok(!(0, segments_1.inSegment)(def('pack-run-out'), f({ clientId: 'x', packLeft: null })), 'a client who holds no pack at all is not — null is "no pack", never "no sessions"');
ok((0, segments_1.inSegment)(def('pack-low'), f({ clientId: 'x', packLeft: segments_1.PACK_LOW_AT })), 'the threshold is inclusive');
ok(!(0, segments_1.inSegment)(def('pack-low'), f({ clientId: 'x', packLeft: segments_1.PACK_LOW_AT + 1 })), 'and stops there');
// The two lists must not overlap. A coach writing to both would send the same
// person two messages, and the right thing to say is not the same thing.
ok(!(0, segments_1.inSegment)(def('pack-low'), f({ clientId: 'x', packLeft: 0, packRunOut: true })), 'a run-out pack is in one list, not two');
ok(!(0, segments_1.inSegment)(def('pack-low'), f({ clientId: 'x', packLeft: null })), 'and a client with no pack is in neither');
/* ── adherence ─────────────────────────────────────────────────────────── */
ok((0, segments_1.inSegment)(def('never-checked-in'), f({ clientId: 'x', adherence: null })), 'no adherence figure means nobody has a check-in on record for them');
ok(!(0, segments_1.inSegment)(def('never-checked-in'), f({ clientId: 'x', adherence: 0 })), 'and a real zero is a figure, not its absence — the two are never the same fact');
ok(/new clients/i.test(def('never-checked-in').note), 'the band says new clients are in it, so it does not read as a list of people to worry about');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`segments: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('segments: ok (a client nobody could ask about is in no computed segment, and is counted out loud)');
