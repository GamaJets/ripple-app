// The fan-out — the people it refuses to write to, not the people it writes to.
//
// A test that only asserted "eight members, eight assigns" would pass against
// the exact bug this code exists to prevent: a bulk assign that consults the
// injury gate once, or not at all, because asking eleven times was awkward. So
// most of what follows is about the SPLIT — that a blocked client never appears
// in `send`, that a clear client is never lost out of it, and that neither the
// overwrite guard nor the per-client injury gate can be removed without
// something here going red.
//
// Compile with tsc, run with node. Wired into `npm test` and
// tsconfig.test.json.
import {
  planFanOut, programSignature, memberState, groupCoverage, listNames, fanOutSubject,
  type FanOutMember, type MemberState,
} from './groupProgram';
import type { LoadStatus } from '../ui/loadStatus';
import type { Program } from './programs';
import type { Injury } from './injuries';
import { injuryKey } from './injuryGate';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
/** Null-safe substring check. A refusal that came back null is a FAILURE to
 *  report, not a crash to read a stack trace out of — and it is exactly what a
 *  deleted guard produces, so it has to fail legibly. */
const has = (s: string | null, needle: string, msg: string) => {
  if (typeof s !== 'string' || !s.includes(needle)) errors.push(`${msg} — got ${JSON.stringify(s)}`);
};
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

const SUBJECT = 'the programmes these clients are currently on';
const UNSOUND: LoadStatus[] = ['loading', 'partial', 'error'];

const shoulder: Injury = { id: 'i1', area: 'shoulder', severity: 'severe', status: 'active', note: '', at: '' };
const knee: Injury = { id: 'i2', area: 'knee', severity: 'mild', status: 'active', note: '', at: '' };

/** A member with nothing to acknowledge and both reads whole — the one shape
 *  that is allowed straight through. */
const clear = (id: string, name: string): FanOutMember =>
  ({ clientId: id, name, disclosures: 'ready', ackStatus: 'ready', injuries: [], acknowledged: null });
/** A member who has disclosed something nobody has confirmed reading. */
const undisclosed = (id: string, name: string): FanOutMember =>
  ({ clientId: id, name, disclosures: 'ready', ackStatus: 'ready', injuries: [shoulder], acknowledged: null });
/** A member who has disclosed something and whose coach HAS read it. */
const acknowledged = (id: string, name: string): FanOutMember =>
  ({ clientId: id, name, disclosures: 'ready', ackStatus: 'ready', injuries: [shoulder], acknowledged: [injuryKey(shoulder)] });

const P = (title: string, name: string, sets: number, reps: string): Program => ({
  title, focus: ['Coach-assigned'], note: 'a note',
  days: [{ day: 'Mon', focus: 'Full Body', exercises: [
    { key: 'Mon-0', name, group: 'Legs', sets, reps, alternatives: [] },
  ] }],
});

// ══ programSignature ═══════════════════════════════════════════════════════
//
// The fingerprint has to survive the rewriting that happens in transit — the
// builder stamps its own `focus` and blanks `alternatives` on every assign, and
// regenerates the exercise keys. If those counted, every client would read as
// off-plan the moment they were put on it, on the one screen whose job is to
// say who is off-plan.
{
  const a = P('Bootcamp', 'Back Squat', 4, '8-10');
  const b: Program = {
    ...a,
    focus: ['something else entirely'],
    note: 'different prose',
    days: [{ ...a.days[0], exercises: [{ ...a.days[0].exercises[0], key: 'x9', alternatives: ['Goblet Squat'] }] }],
  };
  eq(programSignature(a), programSignature(b), 'focus, note, key and alternatives must not change a programme fingerprint');

  ok(programSignature(a) !== programSignature(P('Bootcamp', 'Back Squat', 5, '8-10')), 'a different set count is a different programme');
  ok(programSignature(a) !== programSignature(P('Bootcamp', 'Back Squat', 4, '5-6')), 'a different rep range is a different programme');
  ok(programSignature(a) !== programSignature(P('Bootcamp', 'Front Squat', 4, '8-10')), 'a different movement is a different programme');
  ok(programSignature(a) !== programSignature(P('Bootcamp 2', 'Back Squat', 4, '8-10')), 'a different title is a different programme');
  eq(programSignature(null), null, 'a group with no programme has no fingerprint, not the fingerprint of an empty one');
  eq(programSignature(undefined), null, 'an absent programme has no fingerprint');
}

// ══ memberState ════════════════════════════════════════════════════════════
//
// The negative assertion is the whole of it: under anything but a whole read
// of assigned_programs, a member with no programme must be 'unknown' and not
// 'none'. 'none' renders as "not assigned yet", which is how a coach comes to
// assign over a programme nobody saw.
{
  const group = P('Bootcamp', 'Back Squat', 4, '8-10');
  const sig = programSignature(group);
  eq(memberState('ready', sig, group), 'on', 'a client on the group programme is on it');
  eq(memberState('ready', sig, null), 'none', 'a whole read with no row is genuinely nobody assigned');
  eq(memberState('ready', sig, P('Shoulder-safe', 'Leg Press', 4, '8-10')), 'diverged', 'a client on something else has diverged');
  for (const s of UNSOUND) {
    eq(memberState(s, sig, null), 'unknown', `'${s}' must not be reported as "not assigned yet"`);
    eq(memberState(s, sig, group), 'unknown', `'${s}' must not be reported as on the programme either`);
  }
  // A group with no programme yet: a member on something is on something that
  // is not the group's, which is true and is the sentence the screen shows.
  eq(memberState('ready', null, group), 'diverged', 'with no group programme, a client on one is on something else');
  eq(memberState('ready', null, null), 'none', 'with no group programme and no row, nobody is on anything');
}

// ══ groupCoverage ══════════════════════════════════════════════════════════
//
// A count over a list that came back short is not the size of the group, and a
// count over an unread assigned_programs is not how many of them have it.
{
  const states: MemberState[] = ['on', 'on', 'diverged', 'none', 'unknown'];
  const c = groupCoverage(states, 'ready', 'ready');
  eq([c.on, c.diverged, c.none, c.unknown, c.total], [2, 1, 1, 1, 5], 'the tally must count every state');
  ok(c.countable, 'two whole reads make the tally showable');
  for (const s of UNSOUND) {
    ok(!groupCoverage(states, s, 'ready').countable, `a '${s}' membership read must not license a headline count`);
    ok(!groupCoverage(states, 'ready', s).countable, `a '${s}' programme read must not license a headline count`);
  }
  eq(groupCoverage([], 'ready', 'ready').total, 0, 'an empty group under a whole read is genuinely empty');
}

// ══ planFanOut — the list itself ═══════════════════════════════════════════
//
// A group whose membership could not be read must never render as an empty
// group, and must never be assigned to. Four names arriving out of eight leaves
// four people on last month's programme with nothing anywhere saying so.
{
  const members = [clear('a', 'Priya'), clear('b', 'Sam')];
  for (const s of UNSOUND) {
    const p = planFanOut(s, 'ready', members, true, SUBJECT);
    ok(!p.allowed, `a '${s}' membership read must not license an assign`);
    eq(p.send, [], `a '${s}' membership read must write to nobody`);
    ok(typeof p.reason === 'string' && p.reason.length > 0, `'${s}' must say why the assign is held`);
    ok(typeof p.label === 'string' && p.label.length > 0, `'${s}' must give the held control something to say`);
    ok(!/undefined|null|\[object/i.test(`${p.reason} ${p.label}`), `'${s}' must not leak a placeholder to the coach`);
  }
  const reasons = UNSOUND.map((s) => planFanOut(s, 'ready', members, true, SUBJECT).reason as string);
  ok(new Set(reasons).size === UNSOUND.length, 'each unsound membership status must explain itself in its own words');
  // 'loading' is not a failure and must not be dressed as one.
  ok(!/could not be read|failed/i.test(reasons[0]), 'a membership read still in flight must not be reported as a failure');
}

// ══ planFanOut — the overwrite guard ═══════════════════════════════════════
//
// MUTATION CHECK. Delete the guardOverwrite call from planFanOut and this
// block goes red: an unread assigned_programs would otherwise let one tap
// replace every member's training with the group's programme, having never
// seen what it replaced.
{
  const members = [clear('a', 'Priya'), clear('b', 'Sam')];
  ok(planFanOut('ready', 'ready', members, true, SUBJECT).allowed, 'two whole reads and nothing disclosed must let the assign run');
  for (const s of UNSOUND) {
    const p = planFanOut('ready', s, members, true, SUBJECT);
    ok(!p.allowed, `a '${s}' read of what they are on must not license an overwrite of it`);
    eq(p.send, [], `a '${s}' read of what they are on must write to nobody`);
    has(p.reason, SUBJECT, `'${s}' must name what would have been overwritten`);
  }
  for (const s of ['partial', 'error'] as LoadStatus[]) {
    const r = planFanOut('ready', s, members, true, SUBJECT).reason;
    ok(typeof r === 'string' && /no undo/i.test(r), `'${s}' must tell the coach the overwrite is irreversible`);
  }
}

// ══ planFanOut — nothing to send, nobody to send it to ═════════════════════
{
  const p = planFanOut('ready', 'ready', [clear('a', 'Priya')], false, SUBJECT);
  ok(!p.allowed, 'a group with no programme must not assign one');
  eq(p.send, [], 'a group with no programme must write to nobody');
  const e = planFanOut('ready', 'ready', [], true, SUBJECT);
  ok(!e.allowed, 'an empty group must not assign to nobody and call it done');
  ok(typeof e.reason === 'string' && e.reason.length > 0, 'an empty group must say so');
}

// ══ planFanOut — the injury gate, PER CLIENT ═══════════════════════════════
//
// MUTATION CHECK, and the one that matters most. The failure being guarded
// against is a fan-out that consults the gate once — for the first member, or
// not at all — because asking eleven times was awkward. Both orders are tested
// deliberately: a plan that used members[0]'s gate for everybody passes one of
// them and fails the other.
{
  const blockedFirst = planFanOut('ready', 'ready', [undisclosed('a', 'Priya'), clear('b', 'Sam')], true, SUBJECT);
  eq(blockedFirst.send, ['b'], 'a client with unread disclosures must not be assigned to, even when they are first in the list');
  eq(blockedFirst.blocked.map((x) => x.clientId), ['a'], 'the held client must be named');
  ok(blockedFirst.allowed, 'one held client must not stop the other ten getting their programme');

  const blockedLast = planFanOut('ready', 'ready', [clear('a', 'Priya'), undisclosed('b', 'Sam')], true, SUBJECT);
  eq(blockedLast.send, ['a'], 'a client with unread disclosures must not be assigned to when they are last in the list either');
  eq(blockedLast.blocked.map((x) => x.clientId), ['b'], 'the held client must be named wherever they sit in the list');

  // An acknowledgement that covers the disclosures opens the gate — the coach
  // has done the thing the gate asks for, and it must not keep asking.
  const read = planFanOut('ready', 'ready', [acknowledged('a', 'Priya'), clear('b', 'Sam')], true, SUBJECT);
  eq(read.send, ['a', 'b'], 'a coach who has read the disclosures must be able to assign');
  eq(read.blocked, [], 'a covered acknowledgement must hold nobody');
  eq(read.label, null, 'an assign that reaches everybody must carry its usual label');
  eq(read.heldNote, null, 'an assign that reaches everybody must not warn about people it is not holding');

  // A NEW disclosure since the acknowledgement re-closes it. This is the whole
  // point of storing which injuries were acknowledged rather than a timestamp.
  const stale: FanOutMember = { clientId: 'a', name: 'Priya', disclosures: 'ready', ackStatus: 'ready', injuries: [shoulder, knee], acknowledged: [injuryKey(shoulder)] };
  eq(planFanOut('ready', 'ready', [stale, clear('b', 'Sam')], true, SUBJECT).send, ['b'], 'a disclosure made since the acknowledgement must hold the client again');

  // The unread halves. A member the roster never produced has 'error'
  // disclosures and an empty injury list — indistinguishable, without the
  // status, from somebody with nothing wrong with them.
  for (const s of UNSOUND) {
    const unreadDisclosures: FanOutMember = { clientId: 'a', name: 'Priya', disclosures: s, ackStatus: 'ready', injuries: [], acknowledged: null };
    eq(planFanOut('ready', 'ready', [unreadDisclosures, clear('b', 'Sam')], true, SUBJECT).send, ['b'],
      `a '${s}' read of a client's own disclosures must hold that client, empty list or not`);
    const unreadAcks: FanOutMember = { clientId: 'a', name: 'Priya', disclosures: 'ready', ackStatus: s, injuries: [shoulder], acknowledged: null };
    eq(planFanOut('ready', 'ready', [unreadAcks, clear('b', 'Sam')], true, SUBJECT).send, ['b'],
      `a '${s}' read of the acknowledgements must hold a client who has disclosed something`);
  }
}

// ══ planFanOut — nobody falls out of both lists ════════════════════════════
//
// The silent skip is the failure mode: a member who is neither written to nor
// reported. `send` and `blocked` must partition the membership exactly.
{
  const members = [clear('a', 'Priya'), undisclosed('b', 'Sam'), acknowledged('c', 'Alex'), undisclosed('d', 'Jo')];
  const p = planFanOut('ready', 'ready', members, true, SUBJECT);
  const covered = [...p.send, ...p.blocked.map((b) => b.clientId)].sort();
  eq(covered, ['a', 'b', 'c', 'd'], 'every member must be either assigned or reported as held — never neither');
  eq(new Set(covered).size, 4, 'and never both');
  eq(p.send, ['a', 'c'], 'only the clients whose disclosures have been read may be written to');
  eq(p.label, 'Assign to 2 of 4', 'the control must say how many of them it is actually reaching');
  has(p.heldNote, 'Sam', 'a held client must be named to the coach, not merely counted');
  has(p.heldNote, 'Jo', 'every held client must be named to the coach, not merely counted');
  ok(typeof p.heldNote === 'string' && /will NOT be assigned/i.test(p.heldNote), 'the note must say plainly that the held clients are not getting it');
  for (const b of p.blocked) {
    ok(b.reason.includes(b.name), 'a held client must be named in their own reason');
    ok(!/undefined|null|\[object/i.test(`${b.reason} ${b.label}`), 'a held client must not be explained with a placeholder');
  }
}

// ══ planFanOut — every single one of them held ═════════════════════════════
{
  const p = planFanOut('ready', 'ready', [undisclosed('a', 'Priya'), undisclosed('b', 'Sam')], true, SUBJECT);
  ok(!p.allowed, 'an assign that would reach nobody must not be offered as an assign');
  eq(p.send, [], 'an assign that would reach nobody must write to nobody');
  eq(p.blocked.length, 2, 'and must still report every one of them');
  has(p.reason, 'Priya', 'a wholly-held assign must name who is holding it up');
  has(p.reason, 'Sam', 'a wholly-held assign must name every one of them');
  eq(p.heldNote, null, 'a refusal must not also carry a note about an assign that is not happening');

  // One member, held: the coach gets that client's own sentence rather than a
  // summary of a list of one.
  const one = planFanOut('ready', 'ready', [undisclosed('a', 'Priya')], true, SUBJECT);
  ok(!one.allowed, 'a group of one held client must not assign');
  has(one.reason, 'Priya', 'a group of one must be explained in terms of that one person');
}

// ══ the sentences ══════════════════════════════════════════════════════════
{
  eq(listNames([]), '', 'no names is no sentence');
  eq(listNames(['Priya']), 'Priya', 'one name is the name');
  eq(listNames(['Priya', 'Sam']), 'Priya and Sam', 'two names are joined with "and", not a comma');
  eq(listNames(['Priya', 'Sam', 'Alex']), 'Priya, Sam and Alex', 'three names read as a list a person would say aloud');
  ok(fanOutSubject(1) !== fanOutSubject(4), 'one client and several must not be described with the same sentence');
  ok(/programme this client/.test(fanOutSubject(1)), 'a single client must be spoken about in the singular');
}

if (errors.length) {
  console.error(`groupProgram.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('groupProgram.test: ok');
