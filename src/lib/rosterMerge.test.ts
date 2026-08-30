// One row per person on the coach's roster. Compile with tsc, run with node.
//
// The bug this guards: approving a join-code request writes BOTH a `clients`
// row and a `coach_clients` row for the same uid, and the roster concatenated
// its two lists. The client appeared twice — once with their real goal, weight
// change and last activity, once as 'General · added by you' — and the second
// row was a placeholder being read as a fact about somebody who had been
// training for months. These assertions pin which row survives, that nobody is
// dropped on the way, and that a coach and their client using two different
// words for the same goal is not reported to anybody as a disagreement.
import { goalToEnum, goalsDisagree, mergeRoster } from './rosterMerge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

type Row = {
  id: string; name: string; goal: string;
  weightDelta: number | null; adherence: number | null; lastActive: string;
  coachGoal?: string | null;
};

/** A client with an account: their own goal, and figures behind it. */
const linkedRow = (id: string, over: Partial<Row> = {}): Row => ({
  id, name: 'Linked ' + id, goal: 'Fat loss',
  weightDelta: -3.4, adherence: 92, lastActive: '2h ago', ...over,
});
/** A `coach_clients` note: the coach's typed goal, and nothing measured. */
const manualRow = (id: string, over: Partial<Row> = {}): Row => ({
  id, name: 'Manual ' + id, goal: 'Build muscle',
  weightDelta: null, adherence: null, lastActive: 'added by you', ...over,
});

/* ── the linked row wins, whole ────────────────────────────────────────── */

{
  const merged = mergeRoster([linkedRow('a')], [manualRow('a')]);
  eq(merged.length, 1, 'one person is one row');
  eq(merged[0].name, 'Linked a', 'the linked record is the one that survives');
  eq(merged[0].goal, 'Fat loss', "the client's own goal is what the roster shows");
  // Each of these is why it must be the linked row and not the other one: the
  // manual note answers all three with a placeholder, and a coach reading
  // 'added by you' against somebody who trained this morning stops chasing the
  // client who actually went quiet.
  eq(merged[0].lastActive, '2h ago', 'real last activity beats "added by you"');
  eq(merged[0].weightDelta, -3.4, 'a measured weight change beats a null that never meant zero');
  eq(merged[0].adherence, 92, 'real adherence beats an unrecorded one');
}

/* ── but the coach's goal is kept, not discarded ───────────────────────── */

{
  const merged = mergeRoster([linkedRow('a', { goal: 'Fat loss' })], [manualRow('a', { goal: 'Build muscle' })]);
  eq(merged[0].coachGoal, 'Build muscle', "the coach's recorded goal is carried onto the surviving row");
  ok(goalsDisagree(merged[0].goal, merged[0].coachGoal),
    'a client working to lose fat under a coach who wrote down muscle is a disagreement worth showing');
}
{
  // No `coach_clients` row at all: the coach has recorded nothing, which is a
  // different thing from having recorded something unreadable.
  const merged = mergeRoster([linkedRow('a')], []);
  eq(merged[0].coachGoal, undefined, 'a coach who wrote nothing down has no recorded goal');
  ok(!goalsDisagree(merged[0].goal, merged[0].coachGoal), 'silence from the coach is not a disagreement');
}

/* ── a manual-only entry is not touched and not dropped ────────────────── */

{
  const only = manualRow('m1');
  const merged = mergeRoster([linkedRow('a')], [only]);
  eq(merged.length, 2, 'a manual client whose id matches no linked client is still on the roster');
  const found = merged.find((c) => c.id === 'm1');
  eq(JSON.stringify(found), JSON.stringify(only), 'a manual-only entry passes through unchanged');
  // Its own goal is already the coach's, so shadowing it into coachGoal would
  // make every hand-added client look like they agree with themselves.
  eq(found?.coachGoal, undefined, 'a manual-only entry gains no second goal');
}
{
  // The whole roster being hand-written is the ordinary state of a new coach.
  const merged = mergeRoster([], [manualRow('m1'), manualRow('m2')]);
  eq(merged.length, 2, 'with no linked clients the manual list is the roster');
}
{
  const merged = mergeRoster([linkedRow('a')], []);
  eq(merged.length, 1, 'with no manual notes the linked list is the roster');
  eq(mergeRoster<Row>([], []).length, 0, 'two empty lists merge to an empty roster');
}

/* ── ids are unique in the output ──────────────────────────────────────── */

{
  const merged = mergeRoster(
    [linkedRow('a'), linkedRow('b')],
    [manualRow('a'), manualRow('b'), manualRow('m1')],
  );
  eq(new Set(merged.map((c) => c.id)).size, merged.length, 'no id appears twice in the merged roster');
  eq(merged.length, 3, 'two people linked-and-noted plus one note is three rows, not five');
}
{
  // Neither list should be able to repeat a key — both ids are primary keys —
  // but this function exists because the roster stopped being able to assume
  // that, and a repeated key is a mis-targeted tap as well as a React warning.
  const merged = mergeRoster([linkedRow('a'), linkedRow('a', { name: 'Second a' })], [manualRow('m1'), manualRow('m1')]);
  eq(new Set(merged.map((c) => c.id)).size, merged.length, 'a repeat inside one list is collapsed too');
  eq(merged[0].name, 'Linked a', 'the first occurrence is the one kept');
}

/* ── ordering is deterministic ─────────────────────────────────────────── */

{
  const linked = [linkedRow('a'), linkedRow('b')];
  const manual = [manualRow('b'), manualRow('m1'), manualRow('m2')];
  const once = mergeRoster(linked, manual);
  eq(once.map((c) => c.id).join(','), 'a,b,m1,m2',
    'linked clients in the order read, then the manual-only ones in the order read');
  // Both reads are ordered server-side, so the same two answers must produce
  // the same list every time — a roster that reshuffles between launches is
  // how a coach loses track of who they have already looked at.
  eq(JSON.stringify(mergeRoster(linked, manual)), JSON.stringify(once), 'merging the same reads twice gives the same list');
}

/* ── two vocabularies, three goals ─────────────────────────────────────── */

eq(goalToEnum('fatloss'), 'fatloss', "the client's enum resolves");
eq(goalToEnum('tone'), 'tone', "the client's enum resolves");
eq(goalToEnum('muscle'), 'muscle', "the client's enum resolves");
eq(goalToEnum('Fat loss'), 'fatloss', "the coach's label resolves");
eq(goalToEnum('Tone'), 'tone', "the coach's label resolves");
eq(goalToEnum('Build muscle'), 'muscle', "the coach's label resolves");

// The one that matters most: the same goal written in the two vocabularies the
// two apps use. If this ever reads as a disagreement, every code-joined client
// on every coach's roster carries a notice about an argument nobody is having.
ok(!goalsDisagree('fatloss', 'Fat loss'), "'Fat loss' and 'fatloss' are one goal, not two");
ok(!goalsDisagree('muscle', 'Build muscle'), "'Build muscle' and 'muscle' are one goal, not two");
ok(!goalsDisagree('tone', 'Tone'), "'Tone' and 'tone' are one goal, not two");
ok(goalsDisagree('fatloss', 'Build muscle'), 'lose fat against build muscle is a real disagreement');
ok(goalsDisagree('Tone', 'fatloss'), 'the comparison works whichever side the label is on');

/* ── unknown is a fourth answer, never a fourth goal ───────────────────── */

// 'General' is what the roster puts where a goal could not be read. Reading it
// as fat loss is how a client nobody could read a goal for got a fat-loss
// programme generated for them.
eq(goalToEnum('General'), null, "'General' is a placeholder for unknown, not a goal");
eq(goalToEnum(''), null, 'an empty goal is unknown');
eq(goalToEnum(null), null, 'a null goal is unknown');
eq(goalToEnum(undefined), null, 'a missing goal is unknown');
eq(goalToEnum('—'), null, 'a dash is unknown');
// Substring matching answered 'muscle' here, because it tested for muscle
// before tone — the opposite of what was typed, on the string that chooses
// somebody's programme.
eq(goalToEnum('muscle tone'), null, 'a phrase naming two goals resolves to neither');
eq(goalToEnum('get strong for skiing'), null, 'free text a coach typed is not silently a goal');
// The lookup is hasOwnProperty and not a bare index, because the key comes off
// a free-text column and these would otherwise resolve off Object.prototype.
eq(goalToEnum('toString'), null, 'toString is not a goal');
eq(goalToEnum('constructor'), null, 'constructor is not a goal');
eq(goalToEnum('__proto__'), null, '__proto__ is not a goal');

// An unknown on either side is not a disagreement. A failed read must not
// manufacture a coaching conversation.
ok(!goalsDisagree('General', 'Build muscle'), 'a goal we could not read does not disagree with anything');
ok(!goalsDisagree('fatloss', 'General'), 'a coach note we could not read does not disagree with anything');
ok(!goalsDisagree(null, null), 'two unknowns are not a disagreement');
ok(!goalsDisagree('fatloss', undefined), 'nothing recorded is not a disagreement');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('rosterMerge: ok');
