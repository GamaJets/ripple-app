"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const startGate_1 = require("./startGate");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const gate = (over = {}) => (0, startGate_1.startGate)({
    isStrength: true, planned: 5, runnable: 5, removed: 0, injuryHidden: 0, ...over,
});
// ── An ordinary day ───────────────────────────────────────────────────────
ok(gate().canStart, 'a day with movements the runner can be handed may be started');
eq(gate().note, null, 'and it says nothing, because there is nothing to explain');
eq(gate().reason, 'none', 'reason is none when the button is on screen');
// ── The crash ─────────────────────────────────────────────────────────────
//
// The gate used to be asked `planned > 0` while the runner was handed the
// filtered list. These are the two shapes where those disagree, and both of
// them mounted the runner with an empty array and threw out of an effect,
// which replaces every tab in the app with the error screen.
ok(!gate({ runnable: 0, removed: 5 }).canStart, 'a day whose every exercise was removed cannot be started, however many the programme wrote');
ok(!gate({ runnable: 0, injuryHidden: 5 }).canStart, 'a day whose every movement is held back for a severe injury cannot be started');
ok(!gate({ planned: 3, runnable: 0, removed: 1, injuryHidden: 2 }).canStart, 'nor when the two causes between them account for the whole day');
// A day that has lost SOME of itself is still a day. The bug was two lists
// disagreeing, not filtering, and a gate that refused whenever anything had
// been removed would take the session away from somebody who dropped one
// movement out of six.
ok(gate({ planned: 6, runnable: 5, removed: 1 }).canStart, 'one removed exercise does not end the session');
ok(gate({ planned: 6, runnable: 5, injuryHidden: 1 }).canStart, 'nor does one movement held back for an injury');
// ── What it says, and when it says nothing ────────────────────────────────
eq(gate({ isStrength: false, runnable: 0 }).reason, 'not-strength', 'the cardio tab is a different log, not a missing button');
eq(gate({ isStrength: false, runnable: 0 }).note, null, 'so nothing is explained there');
eq(gate({ planned: 0, runnable: 0 }).reason, 'rest-day', 'a day the programme left empty is a rest day');
eq(gate({ planned: 0, runnable: 0 }).note, null, 'which the hero and the list below already say');
// The injury case is the one the member cannot work out for themselves: the
// app made a decision about what is safe for them today and has to say so.
const inj = gate({ runnable: 0, injuryHidden: 5 });
eq(inj.reason, 'injury', 'an injury-emptied day is reported as one');
ok(inj.safety, 'and marked as a safety decision, so the screen can give it a heading');
ok(!!inj.note && /severe injury/.test(inj.note), 'the sentence names the reason');
ok(!!inj.note && /coach/.test(inj.note), 'and gives them somewhere to go with it');
const rem = gate({ runnable: 0, removed: 5 });
eq(rem.reason, 'removed', 'a day the member emptied themselves is reported as that');
ok(!rem.safety, 'which is not a safety decision — they made it');
ok(!!rem.note && /[Pp]ut them back/.test(rem.note), 'and it points at the control that undoes it');
// Both causes at once. The injury is the half they did not choose, so it leads
// — but the sentence must not tell somebody every movement was held back for
// safety when they removed some of them by hand.
const both = gate({ planned: 4, runnable: 0, removed: 2, injuryHidden: 2 });
eq(both.reason, 'injury', 'the safety half leads when both are true');
ok(!!both.note && /took off yourself/.test(both.note), 'and the half they did themselves is still named');
ok(!!both.note && !/Every movement/.test(both.note), 'nothing claims the whole day was held back for safety');
// Neither cause and nothing runnable. Not reachable from the screen, and it
// still gets a sentence rather than a control that vanishes unexplained.
const odd = gate({ planned: 3, runnable: 0 });
eq(odd.reason, 'empty', 'an unaccounted-for empty day is its own reason');
ok(!!odd.note, 'and is still explained');
if (errors.length) {
    errors.forEach((e) => console.error('FAIL', e));
    process.exit(1);
}
console.log(`startGate ok — ${'the button and the runner are asked about the same list'}`);
