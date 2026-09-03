"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for peerAvatar — the picture beside the name at the head of a thread.
//
// Same negative property as threadPeer's suite, one field along: there is no
// input for which a face is drawn that did not come back from the read for the
// peer's own id. TF-32 put the reader's own photograph under "Your coach", so
// "never substitutes" is what is asserted here, not "usually looks right".
//
// Compile with tsc then run with node, like logic.test.ts.
const peerAvatar_1 = require("./peerAvatar");
const threadPeer_1 = require("./threadPeer");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (a !== b)
        errors.push(`${msg} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
};
const read = (p) => ({ identified: true, url: 'https://cdn.example/coach.png', ...p });
// ── an avatar is only ever the identified peer's ──
eq((0, peerAvatar_1.resolvePeerAvatar)(read({})), 'https://cdn.example/coach.png', 'a picture read for the peer is the picture drawn');
eq((0, peerAvatar_1.resolvePeerAvatar)(read({ identified: false })), null, 'nothing is drawn for a peer we have not identified');
// The shape of TF-32: a url is in hand, but it belongs to whoever we could
// read, not to the person the header names. Unidentified must win over it.
eq((0, peerAvatar_1.resolvePeerAvatar)({ identified: false, url: 'https://cdn.example/the-reader.png' }), null, 'a readable picture is not a licence to draw it beside somebody else’s name');
// ── the two ways there is honestly no picture ──
eq((0, peerAvatar_1.resolvePeerAvatar)(read({ url: null })), null, 'a coach with no picture set draws none');
eq((0, peerAvatar_1.resolvePeerAvatar)(read({ url: undefined })), null, 'a picture we could not read draws none');
eq((0, peerAvatar_1.resolvePeerAvatar)(read({ url: '   ' })), null, 'whitespace is not a picture');
eq((0, peerAvatar_1.resolvePeerAvatar)(read({ url: '  https://cdn.example/a.png  ' })), 'https://cdn.example/a.png', 'a stored url is trimmed rather than handed to the loader with spaces on it');
// ── the monogram stands in, and only for a real name ──
eq((0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)({ kind: 'named', name: 'Sam Rivera' }, 'coach')), 'SR', 'two names give two initials');
eq((0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)({ kind: 'named', name: 'Coach Sam Rivera' }, 'coach')), 'SR', 'the honorific a coach types for themselves is not one of their initials');
eq((0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)({ kind: 'named', name: '  ana   maria  del rio ' }, 'client')), 'AM', 'extra spacing contributes no blank letters, and two initials is the cap');
eq((0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)({ kind: 'named', name: 'prince' }, 'coach')), 'P', 'one name gives one initial');
// The failure this guards: initialsOf('—') is '—', a circle holding punctuation
// that reads as somebody's monogram. Every non-name must pass the dash through.
const dashes = [{ kind: 'loading' }, { kind: 'withheld' }, { kind: 'unlinked' }, { kind: 'unknown' }];
ok(dashes.every((p) => (0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)(p, 'coach')) === threadPeer_1.NO_NAME
    && (0, peerAvatar_1.peerMonogram)((0, threadPeer_1.peerHeading)(p, 'client')) === threadPeer_1.NO_NAME), 'no dash is ever sliced into initials');
// A name made only of the characters we strip must not produce an empty circle.
eq((0, peerAvatar_1.peerMonogram)({ text: 'Coach', note: null, isName: true }), 'C', 'a name that is only the honorific still yields the letter it has');
eq((0, peerAvatar_1.peerMonogram)({ text: '   ', note: null, isName: true }), threadPeer_1.NO_NAME, 'a blank flagged as a name still cannot become initials');
console.log(errors.length ? 'PEERAVATAR FAILURES:\n' + errors.join('\n') : 'ALL PEERAVATAR TESTS PASSED');
if (errors.length)
    process.exit(1);
