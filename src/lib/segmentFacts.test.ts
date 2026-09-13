// Tests for segmentFacts — the line under a recipient's name on the one screen
// that writes to twenty threads at once.
//
// What must not regress is not the wording. It is that a fact the app does not
// hold never acquires a printed form: a client with no pack must not be given a
// number, a client who has never checked in must not be given a percentage, and
// a drift sentence that did not come back must render as nothing rather than as
// an empty second line under a name.
//
// Compile with tsc then run with node, like bulkActions.test.ts.
import { recipientFact, factsCaption, type Addressed, type RecipientFacts } from './segmentFacts';
import { segmentDef, COMPUTED_SEGMENTS } from './segments';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const facts = (f: Partial<RecipientFacts> = {}): RecipientFacts => ({
  driftReason: null, packLeft: null, adherence: null, tags: [], ...f,
});

const seg = (key: string): Addressed => {
  const def = segmentDef(key);
  if (!def) throw new Error(`no segment ${key}`);
  return { kind: 'seg', def };
};

/* ── everybody: no fact, and no placeholder either ────────────────────────── */

eq(recipientFact({ kind: 'all' }, facts({ driftReason: 'Nothing for 19 days' })), null,
  'ALL CLIENTS HAS NO FACT. Nothing about the person put them on the list, and a line under every name on the longest list this screen draws is furniture');
eq(factsCaption({ kind: 'all' }), null, 'and no caption explaining a line that is not there');

/* ── a tag: the tags the chip does not show ───────────────────────────────── */

{
  const a: Addressed = { kind: 'tag', tag: 'Bootcamp' };
  eq(recipientFact(a, facts({ tags: ['Bootcamp'] })), null,
    'the tag that IS the heading is not repeated under the name');
  const s = recipientFact(a, facts({ tags: ['Bootcamp', 'On hold'] }));
  ok(!!s && s.includes('On hold') && !s.includes('Bootcamp'),
    'THE OTHER TAGS ARE THE POINT — "on hold" is what stops a bootcamp message going to somebody who paused, and it is the half the chip cannot show');
  eq(recipientFact(a, facts({ tags: [] })), null, 'no other tags is nothing, not an empty list rendered');
}

/* ── the drift bands: clientDrift's own sentence, verbatim ────────────────── */

for (const key of ['drifting', 'slipping', 'no-record']) {
  const reason = 'Nothing for 19 days — was 3.5 days a week';
  eq(recipientFact(seg(key), facts({ driftReason: reason })), reason,
    `${key} states the record's own sentence and does not paraphrase it into a second vocabulary`);
  eq(recipientFact(seg(key), facts({ driftReason: null })), null,
    `${key} WITH NO READ IS SILENT — a client the activity query never covered has no fact, and a blank second line under a name reads as a value that failed`);
  eq(recipientFact(seg(key), facts({ driftReason: '   ' })), null,
    `${key} treats an all-whitespace reason as no reason rather than drawing an empty row`);
}

/* ── packs: a count that is a count, and null that stays null ─────────────── */

{
  const s = recipientFact(seg('pack-run-out'), facts({ packLeft: 0 }));
  ok(!!s && /paid|pack/i.test(s), 'a run-out pack says it was PAID for — that is what makes the message worth sending');
  ok(!!s && !/\bthey have run out\b/i.test(s),
    'and it is a fact about the pack, not a claim about the person’s training');
}
{
  const one = recipientFact(seg('pack-low'), facts({ packLeft: 1 }));
  ok(!!one && one.includes('1') && /\bsession\b/.test(one) && !/sessions/.test(one),
    'one session left is singular — a coach reads this beside a name, at speed');
  const two = recipientFact(seg('pack-low'), facts({ packLeft: 2 }));
  ok(!!two && two.includes('2') && /sessions/.test(two), 'two is plural and carries the number');
  eq(recipientFact(seg('pack-low'), facts({ packLeft: null })), null,
    'NULL IS NOT ZERO AND NOT LOW. A client who holds no pack gets no sentence rather than a fabricated one');
}

/* ── never checked in: the missing input, never a percentage ──────────────── */

{
  const s = recipientFact(seg('never-checked-in'), facts({ adherence: null }));
  ok(!!s && /check-in/i.test(s), 'the sentence names the missing check-in');
  ok(!!s && !/%|\b0\b|\b100\b/.test(s),
    'AND PUTS NO FIGURE ON IT — the roster defaulted adherence to 100 once, so a client nobody knew anything about scored perfectly; 0% is the same invention in the other direction');
  eq(recipientFact(seg('never-checked-in'), facts({ adherence: 80 })), null,
    'somebody who has checked in is not in this segment and gets no line');
}

/* ── every computed segment answers, and every caption exists ─────────────── */

for (const def of COMPUTED_SEGMENTS) {
  const a: Addressed = { kind: 'seg', def };
  const cap = factsCaption(a);
  ok(!!cap && cap.trim().length > 0,
    `${def.key} has a caption — a second line under a name that nothing explains is a number a coach has to guess the meaning of`);
  // Called with everything unknown. The contract is a string or null; what it
  // may never do is throw on a segment somebody adds to COMPUTED_SEGMENTS
  // without coming here, which is the one failure that would take the whole
  // recipient list down mid-compose.
  const out = recipientFact(a, facts());
  ok(out === null || typeof out === 'string', `${def.key} answers with a string or null and never throws`);
}

{
  const drift = factsCaption(seg('drifting'));
  ok(!!drift && /loaded|live/i.test(drift),
    'THE DRIFT CAPTION CARRIES THE AS-OF — a screen opened an hour ago is not this morning’s answer, and the send from it is irreversible');
}

if (errors.length) {
  console.error(`segmentFacts.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('segmentFacts.test.ts — ok');
