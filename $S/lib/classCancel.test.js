"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What a member is told before they cancel a class.
// Compile with tsc, run with node.
//
// The two failures this guards: silence, which reads as "free"; and an invented
// notice window, which would be a fact about the gym's policy that this app has
// never been told.
const classCancel_1 = require("./classCancel");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const inHours = (h) => new Date(NOW + h * 3600000).toISOString();
/* ── how long until it starts ──────────────────────────────────────────── */
eq((0, classCancel_1.hoursUntil)(inHours(3), NOW), 3, 'three hours is three hours');
eq((0, classCancel_1.hoursUntil)(inHours(-4), NOW), 0, 'a class that has already started is not minus four hours away');
eq((0, classCancel_1.hoursUntil)('not a date', NOW), null, 'and a timestamp nothing can parse is unknown, not zero');
ok((0, classCancel_1.startsInLine)(inHours(3), NOW).includes('3 hours'), 'the sentence carries the figure');
ok(/within the hour/.test((0, classCancel_1.startsInLine)(inHours(0.5), NOW)), 'half an hour is "within the hour", not "in 0 hours"');
ok(/about an hour/.test((0, classCancel_1.startsInLine)(inHours(1), NOW)), 'and one hour is not "1 hours"');
ok(/already started/.test((0, classCancel_1.startsInLine)(inHours(-1), NOW)), 'a class in progress says so');
ok(/3 days/.test((0, classCancel_1.startsInLine)(inHours(72), NOW)), 'past two days it counts in days');
eq((0, classCancel_1.startsInLine)('nonsense', NOW), null, 'and an unreadable time gets no sentence at all');
/* ── the money sentence ────────────────────────────────────────────────── */
ok(/does not hold that policy/.test(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'the app says it does not know rather than implying there is nothing to know');
ok(!/free|no charge|nothing to pay/i.test(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'and never says a cancellation is free — it has no way to know that');
ok(!/\b24 hours\b|\b48 hours\b/.test(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'no notice window is invented: this app has never been told the gym’s');
ok(!/repple/i.test(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'and no supplier is named to a member of a white-label gym');
/* ── the confirmation body ─────────────────────────────────────────────── */
const body = (0, classCancel_1.classCancelBody)('Spin · Shoreditch · Tue 07:00', inHours(3), NOW);
ok(body.startsWith('Spin · Shoreditch · Tue 07:00'), 'the screen’s own wording of the class leads');
ok(body.includes('3 hours'), 'then when it starts');
ok(body.includes(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'then what this app cannot tell them about the cost');
const unparseable = (0, classCancel_1.classCancelBody)('Spin', 'nonsense', NOW);
ok(unparseable.includes(classCancel_1.CLASS_POLICY_UNKNOWN_NOTE), 'a class whose time could not be read still gets the sentence about the charge');
ok(!unparseable.includes('undefined') && !unparseable.includes('null'), 'and never leaves a hole where the timing sentence would have been');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('classCancel.test.ts — all assertions passed');
