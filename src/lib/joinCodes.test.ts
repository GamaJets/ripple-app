// Naming, ordering and reporting a coach's join codes. Compile with tsc, run
// with node.
//
// The bug this guards: a coach ran a flyer, a bio link and a referral card
// through ONE code and got one fused number back, so "which of these worked?"
// had no answer. Named codes give it one — and a per-code count is the kind of
// figure that is worse than nothing when it is wrong. A "0 joined" printed
// because the read failed reads exactly like a campaign that failed, and the
// coach stops printing the flyer. So most of what follows pins the counts to
// the read's status, and the rest pins the order and the naming rules that keep
// two campaigns from wearing the same name.
import {
  DEFAULT_CODE_NOTE, MAX_LABEL, MAX_LIVE_CODES, canCreateCode, codeCountLine,
  labelProblem, normaliseLabel, shapeJoinCodes, spentCodeMessage,
  type JoinCodeRow, type RawJoinCode,
} from './joinCodes';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const raw = (over: Partial<RawJoinCode> = {}): RawJoinCode => ({
  id: 'id-1', code: 'K7M2QX', label: 'Gym flyer',
  created_at: '2026-08-01T10:00:00Z', revoked_at: null,
  is_default: false, joined: 0, pending: 0, ...over,
});
const row = (over: Partial<JoinCodeRow> = {}): JoinCodeRow => ({
  id: 'id-1', code: 'K7M2QX', label: 'Gym flyer', isDefault: false,
  isLive: true, createdAt: '2026-08-01T10:00:00Z', joined: 0, pending: 0, ...over,
});

/* ── a count is only a count under 'ready' ─────────────────────────────── */

// The whole point. Under a failed read the rows come back empty or stale, and
// the numbers on them mean nothing — saying "nobody has used it" there is
// asserting the campaign failed on the strength of a dropped connection.
for (const s of ['error', 'partial'] as LoadStatus[]) {
  const line = codeCountLine(s, row({ joined: 12, pending: 3 }));
  ok(!/\b12\b/.test(line) && !/\b3\b/.test(line), `${s} states no figure — got ${JSON.stringify(line)}`);
  ok(!/nobody/i.test(line), `${s} does not claim nobody used it`);
}
ok(/—/.test(codeCountLine('partial', row({ joined: 12, pending: 3 }))),
  'a truncated read renders its counts as a dash');
ok(!/\b0\b/.test(codeCountLine('error', row())),
  'a failed read does not print a zero it did not read');
ok(!/\b0\b/.test(codeCountLine('loading', row())),
  'a read still in flight does not print a zero either');

// And under 'ready' the figures are stated, because they are real.
ok(/12/.test(codeCountLine('ready', row({ joined: 12, pending: 3 }))), 'a completed read states what joined');
ok(/3/.test(codeCountLine('ready', row({ joined: 12, pending: 3 }))), 'a completed read states who is waiting');
ok(/nobody/i.test(codeCountLine('ready', row())), 'an empty completed read may say nobody has used it');
// Zero pending is not mentioned: "12 joined · 0 waiting on you" reads as a
// queue with nothing in it rather than as no queue.
ok(!/waiting/.test(codeCountLine('ready', row({ joined: 12, pending: 0 }))), 'no waiting line when nobody waits');

// Over 999 the separator is not optional — house rule, and the same figure
// appears elsewhere on the dashboard through num().
ok(/1,204/.test(codeCountLine('ready', row({ joined: 1204 }))), 'a four-figure count carries its separator');

/* ── the rows come back in a readable order ────────────────────────────── */

const shaped = shapeJoinCodes([
  raw({ id: 'b', code: 'aaaaaa', label: 'Old flyer', created_at: '2026-07-01T00:00:00Z', revoked_at: '2026-07-30T00:00:00Z' }),
  raw({ id: 'c', code: 'BBBBBB', label: 'Instagram bio', created_at: '2026-08-20T00:00:00Z' }),
  raw({ id: null, code: 'DEF123', label: 'Your main code', created_at: null, is_default: true }),
  raw({ id: 'd', code: 'CCCCCC', label: 'Gym flyer', created_at: '2026-08-02T00:00:00Z' }),
]);
eq(shaped.map((r) => r.id).join(','), ',c,d,b', 'default first, then live newest first, then revoked');
eq(shaped[0].isDefault, true, 'the default code leads — it is the one already on the cards');
eq(shaped[3].isLive, false, 'a revoked code is not live');
// Revoked rows stay: their counts are the record of what the campaign did, and
// dropping them would make a finished campaign look like it never ran.
eq(shaped.length, 4, 'a revoked code is still listed');
// Codes are stored case-insensitively unique and read aloud in upper case.
eq(shaped[3].code, 'AAAAAA', 'a code is rendered in the case it is spoken in');

// Two codes created in the same millisecond must not swap places between reads,
// or the list reorders under a coach who is comparing two numbers.
const tie = shapeJoinCodes([
  raw({ id: 'y', code: 'ZZZZZZ', created_at: '2026-08-02T00:00:00Z', label: 'Two' }),
  raw({ id: 'x', code: 'AAAAAB', created_at: '2026-08-02T00:00:00Z', label: 'One' }),
]);
eq(tie.map((r) => r.code).join(','), 'AAAAAB,ZZZZZZ', 'a tie breaks on the code, so the order is stable');

// A blank code is dropped rather than drawn: "your code" over an empty space is
// something a coach reads out to somebody standing in front of them.
eq(shapeJoinCodes([raw({ code: '' }), raw({ code: null })]).length, 0, 'a row with no code is not rendered');
eq(shapeJoinCodes(null).length, 0, 'nothing to shape yields nothing');
eq(shapeJoinCodes([]).length, 0, 'an empty read yields no rows');

// bigint arrives from PostgREST as a string, and a missing one must not become
// a confident zero — Number(null) is 0, which is the bug this guards.
eq(shapeJoinCodes([raw({ joined: '1204', pending: '2' })])[0].joined, 1204, 'a bigint string is a number');
eq(shapeJoinCodes([raw({ joined: null })])[0].joined, 0, 'an absent count is zero, and the status says whether to print it');
eq(shapeJoinCodes([raw({ label: '  ' })])[0].label, 'K7M2QX', 'a code with no usable name falls back to the code');

/* ── two live codes may not share a name ───────────────────────────────── */

// The failure: a coach with two live codes both called "Instagram" has two
// count lines they cannot tell apart, and no way to know which is in the bio.
eq(labelProblem('Gym flyer', ['Gym flyer']), 'You already have a live code called “Gym flyer”. Turn that one off first, or pick another name.',
  'a name already live is refused');
eq(labelProblem('gym FLYER', ['Gym flyer']) === null, false, 'the duplicate check ignores case');
eq(labelProblem('Gym  flyer', ['Gym flyer']) === null, false, 'the duplicate check ignores doubled spaces');
// Revoked labels are not passed in, and reusing last January's name is ordinary.
eq(labelProblem('Gym flyer', []), null, 'a free name is allowed');
eq(labelProblem('', []) === null, false, 'an unnamed code is refused — it is a count nobody can attribute');
eq(labelProblem('   ', []) === null, false, 'whitespace is not a name');
eq(labelProblem('x'.repeat(MAX_LABEL), []), null, 'a name at the limit is allowed');
eq(labelProblem('x'.repeat(MAX_LABEL + 1), []) === null, false, 'a name past the limit is refused, not silently cut');

eq(normaliseLabel('  Gym   flyer  '), 'Gym flyer', 'a name is trimmed and its spaces collapsed');
eq(normaliseLabel(null), '', 'no name normalises to no name');
eq(normaliseLabel('x'.repeat(MAX_LABEL + 10)).length, MAX_LABEL, 'a name is never sent longer than the server accepts');

/* ── the cap the server enforces, enforced before the round trip ───────── */

const live = (n: number) => Array.from({ length: n }, (_, i) => row({ id: `n${i}`, code: `C${i}`, label: `L${i}` }));
eq(canCreateCode(live(MAX_LIVE_CODES - 1)), true, 'under the cap another code may be made');
eq(canCreateCode(live(MAX_LIVE_CODES)), false, 'at the cap the server would refuse, so the app does not offer it');
// The default code is not one of the twenty — it is not in the table the server
// counts, so counting it here would refuse the twentieth code for no reason.
eq(canCreateCode([...live(MAX_LIVE_CODES - 1), row({ id: null, isDefault: true, code: 'DEF123' })]), true,
  'the default code does not consume a slot');
// Nor do revoked ones: they accept nobody, so they cost the coach nothing.
eq(canCreateCode([...live(MAX_LIVE_CODES - 1), row({ id: 'r', isLive: false, code: 'OLD123' })]), true,
  'a revoked code does not consume a slot');

/* ── a turned-off code is not a typo ───────────────────────────────────── */

// "No coach uses that code" for a code a coach really did hand out sends the
// client back to argue with them about their own spelling.
ok(/turned off/i.test(spentCodeMessage('that code is no longer in use') || ''),
  'a revoked code says it was turned off, not that it does not exist');
ok(/ask them/i.test(spentCodeMessage('that code is no longer in use') || ''),
  'and sends the client back for a current one rather than to recheck their spelling');
eq(spentCodeMessage('no coach uses that code'), null, 'every other failure falls through to joinErrorMessage');
eq(spentCodeMessage(null), null, 'no message falls through too');

// The default row's counts include codes it has replaced, so the note beside it
// must say that — otherwise the number reads as belonging to the six characters
// printed next to it.
ok(/replace/i.test(DEFAULT_CODE_NOTE), 'the default code says its count is not only its own');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`joinCodes: ok (${shaped.length} rows shaped, ${MAX_LIVE_CODES} live codes allowed)`);
