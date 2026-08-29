// Tests for threadPeer — the naming of the person on the other end of a chat.
//
// The assertion this suite exists for is the negative one: there is no input,
// anywhere, for which the header shows a name that did not come back from the
// read for the peer's own id. TF-32 was a header confidently displaying the
// reader's own name, so "never substitutes" is the property under test, not
// "usually gets it right".
//
// Compile with tsc then run with node, like logic.test.ts.
import {
  resolvePeerName, peerHeading, NO_NAME,
  type PeerRead, type PeerName,
} from './threadPeer';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const read = (p: Partial<PeerRead>): PeerRead =>
  ({ settled: true, linkFailed: false, peerId: 'coach-1', name: 'Sam Rivera', ...p });

// ── the four things that can be true ──
ok(resolvePeerName(read({})).kind === 'named', 'a readable name is a name');
ok(resolvePeerName(read({ settled: false })).kind === 'loading',
   'nothing is claimed while the read is still in flight');
ok(resolvePeerName(read({ peerId: null })).kind === 'unlinked',
   'no coach linked is its own answer, not a missing name');
ok(resolvePeerName(read({ name: null })).kind === 'withheld',
   'a linked coach whose profile we may not read is withheld, not absent');

// A refused link lookup leaves peerId null for the same reason no-coach does.
// Reporting "you have no coach" to a client who has one is the lie this whole
// file is about, from the other direction.
ok(resolvePeerName(read({ linkFailed: true, peerId: null })).kind === 'unknown',
   'a failed link read is unknown, never "you have no coach"');

// ── names are cleaned, not invented ──
ok(resolvePeerName(read({ name: '  Sam Rivera  ' })).kind === 'named',
   'surrounding whitespace does not stop a real name being a name');
const trimmed = resolvePeerName(read({ name: '  Sam Rivera  ' }));
ok(trimmed.kind === 'named' && trimmed.name === 'Sam Rivera', 'the name is trimmed');
ok(resolvePeerName(read({ name: '   ' })).kind === 'withheld',
   'a blank name is no name at all');
ok(resolvePeerName(read({ name: undefined })).kind === 'withheld',
   'an absent name is no name at all');

// ── the property that matters: nothing is ever substituted ──
// Every outcome that is not 'named' must render the dash, and the only 'named'
// text that can appear is the string that was read.
const everyOutcome: PeerRead[] = [
  read({}), read({ settled: false }), read({ peerId: null }),
  read({ name: null }), read({ name: '' }), read({ linkFailed: true, peerId: null }),
  read({ linkFailed: true, peerId: 'coach-1', name: 'Sam Rivera' }),
];
ok(everyOutcome
  .map((r) => peerHeading(resolvePeerName(r), 'coach'))
  .every((h) => (h.isName ? h.text === 'Sam Rivera' : h.text === NO_NAME)),
  'no input produces a heading that is neither the read name nor a dash');

// ── the heading tells the reader why it is a dash ──
const withheld = peerHeading({ kind: 'withheld' }, 'coach');
ok(withheld.text === NO_NAME && withheld.isName === false, 'a withheld name draws as a dash');
ok(!!withheld.note && withheld.note.length > 0, 'and the dash is labelled with a reason');
ok(peerHeading({ kind: 'named', name: 'Sam Rivera' }, 'coach').note === null,
   'a real name needs no reason beside it');

// The two sides say different things: a client with no coach is being told
// nobody can read this thread, which a coach never needs telling.
const clientSide = peerHeading({ kind: 'unlinked' }, 'coach').note ?? '';
const coachSide = peerHeading({ kind: 'unlinked' }, 'client').note ?? '';
ok(clientSide !== coachSide, 'the unlinked note is written for the side that reads it');
ok(/coach/i.test(clientSide), 'the client is told about their coach');

// isName gates capitalisation and initials upstream, so it must be false for
// every dash — `textTransform: 'capitalize'` on a dash is harmless, but
// `initialsOf('—')` is not.
const dashes: PeerName[] = [{ kind: 'loading' }, { kind: 'withheld' }, { kind: 'unlinked' }, { kind: 'unknown' }];
ok(dashes.every((p) => peerHeading(p, 'coach').isName === false && peerHeading(p, 'client').isName === false),
   'nothing but a real name is flagged as a name');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'THREADPEER FAILURES:\n' + errors.join('\n') : 'ALL THREADPEER TESTS PASSED');
if (errors.length) process.exit(1);
