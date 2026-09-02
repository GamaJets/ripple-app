// How a coach coaches, and the one rule that makes two sources agree.
//
// THE DECLARED ANSWER SETS THE FLOOR. THE ROSTER MAY ONLY EVER WIDEN IT.
//
// Almost everything below is one assertion said many ways: there is exactly one
// route to 'remote', and it needs all three of a declaration of 'online', a
// WHOLE roster read, and nobody on that roster who trains in the room. Anything
// short of all three shows the coach everything.
//
// The failure this suite exists to stop is the one the brief called the single
// most important rule in the job: a coach whose roster read was refused,
// truncated or still in flight opening the app to find their calendar gone.
// That coach has lost a screen because of OUR failure, and there is nothing on
// screen for them to disbelieve.
import {
  deliveryFact, deliveryNote, deliveryAskLine, deliveryStatusLine, showsInPerson,
  DELIVERY_OPTIONS, DELIVERY_LABEL, DELIVERY_NOTE, DELIVERY_EFFECT, HIDDEN_NOT_GONE,
  type DeliveryInput, type DeliveryDeclaration,
} from './coachDelivery';
import { COACHED_MODES, type CoachedMode } from './types';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL_STATUSES: readonly LoadStatus[] = ['loading', 'ready', 'partial', 'error'];
const SHORT: readonly LoadStatus[] = ['loading', 'partial', 'error'];

const client = (mode: CoachedMode) => ({ mode });
const REMOTE_BOOK = [client('online'), client('online'), client('online')];
const MIXED_BOOK = [client('online'), client('inperson'), client('online')];
const HYBRID_BOOK = [client('online'), client('hybrid')];
const EMPTY_BOOK: { mode: CoachedMode }[] = [];

const at = (o: Partial<DeliveryInput> = {}): DeliveryInput => ({
  declared: 'online',
  declaredStatus: 'ready',
  roster: REMOTE_BOOK,
  rosterStatus: 'ready',
  ...o,
});

/* ── the only route to remote ─────────────────────────────────────────────── */

eq(deliveryFact(at()).shape, 'remote',
  'declared online, whole roster, nobody in person — the one case that narrows');
eq(deliveryFact(at()).reason, 'declared-online', 'and it says why');
ok(!showsInPerson(deliveryFact(at())), 'showsInPerson agrees with the shape');

/* ── A FAILED ROSTER READ HIDES NOTHING ───────────────────────────────────── */

for (const st of SHORT) {
  const f = deliveryFact(at({ rosterStatus: st }));
  eq(f.shape, 'inperson', `a roster read that is '${st}' must not narrow the app`);
  eq(f.reason, 'roster-unread', `and the reason names the unread roster ('${st}')`);
  eq(f.inPersonClients, null, `no count is quoted off a '${st}' roster`);
  eq(f.clients, null, `no client count is quoted off a '${st}' roster either`);
  eq(f.emptyBook, false, `a '${st}' roster is never reported as an empty book`);
}

// The same, with the roster LOOKING entirely remote. This is the shape of the
// bug: the rows that did come back are all online, which is exactly the
// evidence that would narrow the app if anybody trusted it.
for (const st of SHORT) {
  eq(deliveryFact(at({ rosterStatus: st, roster: REMOTE_BOOK })).shape, 'inperson',
    `a '${st}' roster that happens to look remote still hides nothing`);
  eq(deliveryFact(at({ rosterStatus: st, roster: EMPTY_BOOK })).shape, 'inperson',
    `a '${st}' roster that came back EMPTY is not an empty book`);
}

/* ── not asked yet is the widest answer, never the narrowest ──────────────── */

const unasked = deliveryFact(at({ declared: null }));
eq(unasked.shape, 'inperson', 'a coach who has not answered is shown everything');
eq(unasked.reason, 'not-declared', 'and the reason says they have not answered');
eq(unasked.declaredKnown, true, 'a read that came back null is still a read');

// Unasked AND an entirely remote book. The roster may only widen, so it has
// nothing to say here — but nor may its remoteness narrow the widest floor.
eq(deliveryFact(at({ declared: null, roster: REMOTE_BOOK })).shape, 'inperson',
  'an entirely remote book does not narrow a coach who was never asked');
eq(deliveryFact(at({ declared: null, roster: EMPTY_BOOK })).shape, 'inperson',
  'nor does an empty one');

for (const st of SHORT) {
  const f = deliveryFact(at({ declared: null, declaredStatus: st }));
  eq(f.shape, 'inperson', `a declaration read that is '${st}' hides nothing`);
  eq(f.reason, 'declaration-unread', `and is told apart from having skipped ('${st}')`);
  eq(f.declaredKnown, false, `an unread declaration is not a known one ('${st}')`);
}

/* ── the floor: the two wide answers can never be narrowed ────────────────── */

for (const declared of ['inperson', 'hybrid'] as const) {
  for (const rosterStatus of ALL_STATUSES) {
    for (const roster of [REMOTE_BOOK, EMPTY_BOOK, MIXED_BOOK]) {
      eq(deliveryFact(at({ declared, rosterStatus, roster })).shape, 'inperson',
        `declaring '${declared}' is a floor no roster can dig under (${rosterStatus}, ${roster.length} clients)`);
    }
  }
}

eq(deliveryFact(at({ declared: 'inperson', roster: REMOTE_BOOK })).reason, 'declared-inperson',
  'a coach who trains in the room keeps the calendar even with an entirely online book');
eq(deliveryFact(at({ declared: 'hybrid', roster: EMPTY_BOOK })).reason, 'declared-hybrid',
  'and so does a coach who said both and has nobody yet');

/* ── the roster widens ────────────────────────────────────────────────────── */

const widened = deliveryFact(at({ declared: 'online', roster: MIXED_BOOK }));
eq(widened.shape, 'inperson', 'one in-person client brings the calendar back on its own');
eq(widened.reason, 'roster-widened', 'and the reason is the evidence, not the answer');
eq(widened.inPersonClients, 1, 'counted');
eq(widened.clients, 3, 'against the whole book');

eq(deliveryFact(at({ declared: 'online', roster: HYBRID_BOOK })).shape, 'inperson',
  'a HYBRID client books sessions too, so they widen just as an in-person one does');
eq(deliveryFact(at({ declared: 'online', roster: HYBRID_BOOK })).inPersonClients, 1,
  'and are counted as somebody who trains in the room');

// Hybrid is not a third layout: one in-person client is an in-person coach.
const oneOfForty = [client('inperson'), ...Array.from({ length: 39 }, () => client('online'))];
eq(deliveryFact(at({ declared: 'online', roster: oneOfForty })).shape, 'inperson',
  'one client in forty is enough — there is no partial layout');

/* ── zero in-person clients and zero clients are different facts ──────────── */

const empty = deliveryFact(at({ declared: 'online', roster: EMPTY_BOOK }));
eq(empty.emptyBook, true, 'an empty book that was READ is known to be empty');
eq(empty.clients, 0, 'and says so as a number');
eq(empty.shape, 'remote', 'a brand-new coach who said online is set up for online');
ok(deliveryNote(empty).includes('nobody on your book yet'),
  'and the sentence says it is because they have nobody, not because nobody is in person');

const remoteBook = deliveryFact(at({ declared: 'online', roster: REMOTE_BOOK }));
eq(remoteBook.emptyBook, false, 'a book with people on it is not an empty book');
ok(!deliveryNote(remoteBook).includes('nobody on your book yet'),
  'and gets the other sentence');
ok(deliveryNote(empty) !== deliveryNote(remoteBook),
  'the two facts are never the same sentence');

/* ── the sentences ────────────────────────────────────────────────────────── */

const EVERY_CASE: DeliveryInput[] = [
  at(), at({ declared: null }), at({ declared: null, declaredStatus: 'error' }),
  at({ declared: 'inperson' }), at({ declared: 'hybrid' }),
  at({ declared: 'online', roster: MIXED_BOOK }),
  at({ declared: 'online', roster: HYBRID_BOOK }),
  at({ rosterStatus: 'error' }), at({ rosterStatus: 'partial' }), at({ rosterStatus: 'loading' }),
  at({ declared: 'online', roster: EMPTY_BOOK }),
];
const seen = new Set<string>();
for (const c of EVERY_CASE) {
  const f = deliveryFact(c);
  const line = deliveryNote(f);
  ok(line.length > 20, 'every reason has a real sentence behind it');
  ok(!line.includes('—'), 'no dash inside a sentence');
  ok(!line.includes('!'), 'the app does not shout');
  ok(line.endsWith('.'), 'and it is a sentence');
  ok(line[0] === line[0].toUpperCase(), 'sentence case, opening capital');
  seen.add(f.reason);
}
eq(seen.size, 7, 'every reason is exercised by the cases above');

// The widened sentence counts, and one is not "1 of".
ok(deliveryNote(deliveryFact(at({ declared: 'online', roster: MIXED_BOOK }))).includes('one client'),
  'a single in-person client reads as a word, not a digit followed by a plural');
ok(deliveryNote(deliveryFact(at({
  declared: 'online', roster: [client('inperson'), client('inperson'), client('online')],
}))).includes('2 of your clients'), 'and two read as a count');

/* ── the prompt to answer ─────────────────────────────────────────────────── */

ok(deliveryAskLine(deliveryFact(at({ declared: null }))) != null,
  'a coach who has not answered is invited to');
eq(deliveryAskLine(deliveryFact(at({ declared: 'online' }))), null,
  'a coach who answered is not asked again');
for (const st of SHORT) {
  eq(deliveryAskLine(deliveryFact(at({ declared: null, declaredStatus: st }))), null,
    `a coach whose declaration could not be read ('${st}') is not invited to answer over the top of it`);
}

/* ── what the profile says it did ─────────────────────────────────────────── */

eq(deliveryStatusLine(null, 'loading'), 'Reading how you coach…', 'a read in flight says so');
for (const st of ['partial', 'error'] as const) {
  const line = deliveryStatusLine(null, st);
  ok(line.includes('could not be read'), `a failed read says so rather than "not answered" ('${st}')`);
  ok(!line.startsWith('Not answered'), `and never claims they have not answered ('${st}')`);
}
ok(deliveryStatusLine(null, 'ready').startsWith('Not answered yet'),
  'a genuine null under a whole read is genuinely unanswered');
for (const m of COACHED_MODES) {
  eq(deliveryStatusLine(m, 'ready'), DELIVERY_EFFECT[m],
    `an answered ${m} coach is told what it set up`);
}

/* ── the option list, and the words on it ─────────────────────────────────── */

eq(DELIVERY_OPTIONS.length, 3, 'three answers offered');
eq(DELIVERY_OPTIONS.join(','), COACHED_MODES.join(','),
  'the same three, in the same order, as the list a coach classifies a client from');
for (const m of DELIVERY_OPTIONS) {
  const label = DELIVERY_LABEL[m];
  ok(label.length > 0, `${m} has a label`);
  // Title Case: every word of a row title starts capitalised, minor words aside.
  for (const w of label.split(' ')) {
    ok(/^[A-Z]/.test(w) || ['a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'or'].includes(w),
      `"${label}" is Title Case — "${w}" is not`);
  }
  for (const [what, line] of [['note', DELIVERY_NOTE[m]], ['effect', DELIVERY_EFFECT[m]]] as const) {
    ok(line.length > 40, `${m} ${what} says what picking it changes`);
    ok(line.endsWith('.'), `${m} ${what} is prose`);
    ok(!line.includes('—'), `${m} ${what} has no dash inside a sentence`);
    ok(!line.includes('!'), `${m} ${what} does not shout`);
  }
  ok(DELIVERY_NOTE[m] !== DELIVERY_EFFECT[m],
    `${m} says something different before and after the choice`);
}
// Only one of the three may describe anything being put away.
eq(DELIVERY_OPTIONS.filter((m) => /tucked away|move out of the way/.test(DELIVERY_NOTE[m] + DELIVERY_EFFECT[m])).length, 1,
  'exactly one answer narrows the app, and it is not hybrid');
ok(/tucked away/.test(DELIVERY_EFFECT.online), 'and it is the online one');
ok(HIDDEN_NOT_GONE.includes('search'), 'the reassurance names search, which is how a coach gets it back');
ok(HIDDEN_NOT_GONE.includes('removed'), 'and says outright that nothing was removed');

/* ── the fact never leaks a count off a short read ────────────────────────── */

for (const declared of [null, 'online', 'inperson', 'hybrid'] as DeliveryDeclaration[]) {
  for (const rosterStatus of SHORT) {
    const f = deliveryFact(at({ declared, rosterStatus, roster: MIXED_BOOK }));
    eq(f.clients, null, `no client count under '${rosterStatus}' (declared ${declared})`);
    eq(f.inPersonClients, null, `no in-person count under '${rosterStatus}' (declared ${declared})`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachDelivery.test.ts — ok');
