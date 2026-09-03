"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Which version of the bootcamp each member is on. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a member still training last
// month's version of the group programme and a member whose Thursday was
// rewritten around their shoulder both read 'diverged'. That is true and
// useless, because those two need OPPOSITE actions — the first needs one tap,
// and re-sending to the second silently undoes the modification the coach made
// on purpose.
//
// The group still does not own the plan. supabase/parts/134-a-programme-written-once.sql
// gives three reasons and none of them has changed; what this adds is the
// group's PAST programmes, so there is something to compare against, and every
// answer below is DERIVED from a member's actual assignment rather than stamped
// on them when the fan-out ran.
const groupProgram_1 = require("./groupProgram");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const prog = (movement) => ({
    title: 'Bootcamp', focus: [], note: '',
    days: [{ day: 'Mon', focus: 'Full Body',
            exercises: [{ key: 'a', name: movement, group: 'Legs', sets: 3, reps: '10', alternatives: [] }] }],
});
const v1 = prog('Goblet Squat');
const v2 = prog('Back Squat');
const v3 = prog('Front Squat');
const bespoke = prog('Leg Press');
const versions = [
    { version: 1, signature: (0, groupProgram_1.programSignature)(v1), createdAt: '2026-06-01T00:00:00Z' },
    { version: 2, signature: (0, groupProgram_1.programSignature)(v2), createdAt: '2026-07-01T00:00:00Z' },
    { version: 3, signature: (0, groupProgram_1.programSignature)(v3), createdAt: '2026-08-01T00:00:00Z' },
];
const sig3 = (0, groupProgram_1.programSignature)(v3);
/* ── a version is derived, every time, from what they are actually on ───── */
eq((0, groupProgram_1.versionOf)(versions, v2), 2, 'a member on the July programme is on version 2');
eq((0, groupProgram_1.versionOf)(versions, v3), 3, 'and one on the current programme is on version 3');
eq((0, groupProgram_1.versionOf)(versions, bespoke), null, 'a member on something that is none of the group’s versions is not "an old version" — that is the client with the shoulder');
eq((0, groupProgram_1.versionOf)(versions, null), null, 'and a member on nothing has no version');
// A coach who changes the programme and changes it back produces two versions
// that fingerprint the same. Saying "they are on version 1" about somebody
// holding a programme identical to version 3 would send the coach off to
// re-assign something they already have.
const reverted = [...versions, { version: 4, signature: (0, groupProgram_1.programSignature)(v1), createdAt: '2026-09-01T00:00:00Z' }];
eq((0, groupProgram_1.versionOf)(reverted, v1), 4, 'where two versions are identical the NEWEST wins, so nobody is asked to re-send what they already hold');
// A stored programme this build could not read has a null signature, and a null
// must never match a member — including a member who is also on nothing, which
// is 'none' and is decided before this is asked.
eq((0, groupProgram_1.versionOf)([{ version: 1, signature: null, createdAt: null }], v1), null, 'an unreadable stored version matches nobody rather than matching everybody with no programme');
/* ── the spread, and the two lists that need opposite actions ───────────── */
const members = [
    { clientId: 'ann', assigned: v3 }, // current
    { clientId: 'bob', assigned: v2 }, // an old version — one tap fixes it
    { clientId: 'cat', assigned: bespoke }, // modified for them; must NOT be re-sent
    { clientId: 'dan', assigned: null }, // never assigned
];
const mv = (0, groupProgram_1.memberVersions)('ready', versions, 3, members, sig3);
eq(mv.map((m) => m.state), ['on', 'diverged', 'diverged', 'none'], 'the four states as `memberState` already reports them');
eq(mv.map((m) => m.version), [3, 2, null, null], 'and the version each of them is actually on');
eq(mv.map((m) => m.behind), [false, true, false, false], 'only the member on an EARLIER stored version is behind — the bespoke one is not out of date, they are different on purpose');
const spread = (0, groupProgram_1.versionSpread)(mv, 'ready', 'ready', 3);
eq([spread.onCurrent, spread.behind, spread.bespoke, spread.none, spread.unknown], [1, 1, 1, 1, 0], 'one on it, one behind, one bespoke, one on nothing — four rows a coach reads four different ways');
ok(spread.countable, 'and both reads were whole, so those are counts of people');
/* ── no count, and no offer, over an unread assignment ──────────────────── */
// `memberState` already collapses to 'unknown' here. This makes the consequence
// explicit rather than depending on it, because the control beside `behind` is
// a WRITE over what somebody is training this evening.
const unread = (0, groupProgram_1.memberVersions)('error', versions, 3, members, sig3);
ok(unread.every((m) => m.state === 'unknown'), 'an unread assignment is unknown for every member');
ok(unread.every((m) => !m.behind), 'and nobody is offered a re-send off a read that did not land');
ok(unread.every((m) => m.version == null), 'nor given a version number');
const unreadSpread = (0, groupProgram_1.versionSpread)(unread, 'ready', 'error', 3);
ok(!unreadSpread.countable, 'the spread is not countable');
eq(unreadSpread.unknown, 4, 'and every member is in the unknown column rather than quietly in another one');
const names = (id) => ({ ann: 'Ann', bob: 'Bob', cat: 'Cat', dan: 'Dan' }[id] ?? id);
eq((0, groupProgram_1.behindNote)(unread, names, unreadSpread), null, 'no re-send is offered over an unread `assigned_programs` — the offer is an overwrite of somebody’s training');
eq((0, groupProgram_1.bespokeNote)(unread, names, unreadSpread), null, 'and no warning is given about it either');
/* ── the two sentences, kept apart on purpose ───────────────────────────── */
const behind = (0, groupProgram_1.behindNote)(mv, names, spread);
ok(/Bob/.test(behind), 'the re-send names the person, because a coach about to overwrite training reads the name before they tap');
ok(!/Cat/.test(behind), 'and does not include the client whose copy was edited for them');
ok(/replaces what they are training/i.test(behind), 'it says what sending again does');
const bes = (0, groupProgram_1.bespokeNote)(mv, names, spread);
ok(/Cat/.test(bes), 'the warning names the client whose copy was edited');
ok(/would overwrite that/i.test(bes), 'and says what assigning to the whole group would do to it');
// Deliberately two sentences and not one paragraph. The second half of a
// paragraph is the half that gets skimmed, and the half being skimmed here is
// the one where a coach silently reverts the change they made for a shoulder.
ok(behind !== bes, 'the two lists are two sentences, because they need opposite actions');
eq((0, groupProgram_1.behindNote)((0, groupProgram_1.memberVersions)('ready', versions, 3, [{ clientId: 'ann', assigned: v3 }], sig3), names, (0, groupProgram_1.versionSpread)((0, groupProgram_1.memberVersions)('ready', versions, 3, [{ clientId: 'ann', assigned: v3 }], sig3), 'ready', 'ready', 3)), null, 'and with nobody behind there is no cheerful "everybody is up to date" printed over anything');
/* ── the signature still ignores prose, as it always did ────────────────── */
// The builder stamps its own `focus` and blanks `alternatives` on every assign,
// so comparing them would report a client as diverged when the sessions in
// front of them are identical.
const reworded = { ...v3, note: 'Different letter at the top', focus: ['Anything'] };
eq((0, groupProgram_1.programSignature)(reworded), sig3, 'a programme with the same sessions and different prose is the same programme');
eq((0, groupProgram_1.versionOf)(versions, reworded), 3, 'so a member on it is on version 3, not adrift');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('groupVersions: ok — a version derived from what they are training, and "behind" kept apart from "edited for them"');
