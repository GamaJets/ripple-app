"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for threadPeer — the naming of the person on the other end of a chat.
//
// The assertion this suite exists for is the negative one: there is no input,
// anywhere, for which the header shows a name that did not come back from the
// read for the peer's own id. TF-32 was a header confidently displaying the
// reader's own name, so "never substitutes" is the property under test, not
// "usually gets it right".
//
// Compile with tsc then run with node, like logic.test.ts.
const threadPeer_1 = require("./threadPeer");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const read = (p) => ({ settled: true, linkFailed: false, peerId: 'coach-1', name: 'Sam Rivera', ...p });
// ── the four things that can be true ──
ok((0, threadPeer_1.resolvePeerName)(read({})).kind === 'named', 'a readable name is a name');
ok((0, threadPeer_1.resolvePeerName)(read({ settled: false })).kind === 'loading', 'nothing is claimed while the read is still in flight');
ok((0, threadPeer_1.resolvePeerName)(read({ peerId: null })).kind === 'unlinked', 'no coach linked is its own answer, not a missing name');
ok((0, threadPeer_1.resolvePeerName)(read({ name: null })).kind === 'withheld', 'a linked coach whose profile we may not read is withheld, not absent');
// A refused link lookup leaves peerId null for the same reason no-coach does.
// Reporting "you have no coach" to a client who has one is the lie this whole
// file is about, from the other direction.
ok((0, threadPeer_1.resolvePeerName)(read({ linkFailed: true, peerId: null })).kind === 'unknown', 'a failed link read is unknown, never "you have no coach"');
// ── names are cleaned, not invented ──
ok((0, threadPeer_1.resolvePeerName)(read({ name: '  Sam Rivera  ' })).kind === 'named', 'surrounding whitespace does not stop a real name being a name');
const trimmed = (0, threadPeer_1.resolvePeerName)(read({ name: '  Sam Rivera  ' }));
ok(trimmed.kind === 'named' && trimmed.name === 'Sam Rivera', 'the name is trimmed');
ok((0, threadPeer_1.resolvePeerName)(read({ name: '   ' })).kind === 'withheld', 'a blank name is no name at all');
ok((0, threadPeer_1.resolvePeerName)(read({ name: undefined })).kind === 'withheld', 'an absent name is no name at all');
// ── the property that matters: nothing is ever substituted ──
// Every outcome that is not 'named' must render the dash, and the only 'named'
// text that can appear is the string that was read.
const everyOutcome = [
    read({}), read({ settled: false }), read({ peerId: null }),
    read({ name: null }), read({ name: '' }), read({ linkFailed: true, peerId: null }),
    read({ linkFailed: true, peerId: 'coach-1', name: 'Sam Rivera' }),
];
ok(everyOutcome
    .map((r) => (0, threadPeer_1.peerHeading)((0, threadPeer_1.resolvePeerName)(r), 'coach'))
    .every((h) => (h.isName ? h.text === 'Sam Rivera' : h.text === threadPeer_1.NO_NAME)), 'no input produces a heading that is neither the read name nor a dash');
// ── the heading tells the reader why it is a dash ──
const withheld = (0, threadPeer_1.peerHeading)({ kind: 'withheld' }, 'coach');
ok(withheld.text === threadPeer_1.NO_NAME && withheld.isName === false, 'a withheld name draws as a dash');
ok(!!withheld.note && withheld.note.length > 0, 'and the dash is labelled with a reason');
ok((0, threadPeer_1.peerHeading)({ kind: 'named', name: 'Sam Rivera' }, 'coach').note === null, 'a real name needs no reason beside it');
// The two sides say different things: a client with no coach is being told
// nobody can read this thread, which a coach never needs telling.
const clientSide = (0, threadPeer_1.peerHeading)({ kind: 'unlinked' }, 'coach').note ?? '';
const coachSide = (0, threadPeer_1.peerHeading)({ kind: 'unlinked' }, 'client').note ?? '';
ok(clientSide !== coachSide, 'the unlinked note is written for the side that reads it');
ok(/coach/i.test(clientSide), 'the client is told about their coach');
// isName gates capitalisation and initials upstream, so it must be false for
// every dash — `textTransform: 'capitalize'` on a dash is harmless, but
// `initialsOf('—')` is not.
const dashes = [{ kind: 'loading' }, { kind: 'withheld' }, { kind: 'unlinked' }, { kind: 'unknown' }];
ok(dashes.every((p) => (0, threadPeer_1.peerHeading)(p, 'coach').isName === false && (0, threadPeer_1.peerHeading)(p, 'client').isName === false), 'nothing but a real name is flagged as a name');
console.log(errors.length ? 'THREADPEER FAILURES:\n' + errors.join('\n') : 'ALL THREADPEER TESTS PASSED');
if (errors.length)
    process.exit(1);
