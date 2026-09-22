// The coach's saved cue. Compile with tsc, run with node.
//
// Three things here are worth assertions and all three are silent when they go
// wrong:
//
//   · A PREFILL NEVER OVERWRITES. This is most of the file. A cue arriving
//     over a note somebody typed about a particular client is an erasure
//     performed with no undo and no record, and it would look exactly like the
//     feature working. Every falsy-but-written note, every whitespace shape
//     and every re-run is asserted, and so is the identity of the returned
//     string — a "prefill" that trimmed the coach's own note would also be
//     rewriting it.
//   · The read tells 'absent' apart from a failure. supabase/parts/3150 is not
//     applied to any database as this ships, so the ONLY path exercised in
//     production today is the one where the table is not there. It must not
//     take the builder down, and it must not be reported as "you have no
//     cues".
//   · `cueKey` agrees with `exerciseSlug` character for character. They are
//     the same rule written twice — deliberately, see the header of
//     coachCues.ts — and a cue filed under a key nothing else uses is a cue
//     that silently never matches its movement again.
import {
  cueKey, cueFor, cueRowFor, prefillNote, wouldPrefill, prefillExercise, prefillDays,
  cueRefusal, cueAvailability, isMissingCueTable, fetchMyCues, fetchCoachCue,
  saveCue, deleteCue, NO_CUE_TABLE, CUE_MAX,
  CUES_UNAVAILABLE_NOTE, NO_CUE_YET_NOTE, CUE_NEVER_OVERWRITES,
  type CueRead, type CoachCue,
} from './coachCues';

const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const read = (...cues: CoachCue[]): CueRead => ({ status: 'read', cues });
const cue = (exerciseId: string, c: string): CoachCue => ({ exerciseId, cue: c, updatedAt: '2026-09-01T10:00:00Z' });

/* ── the identity of a movement ───────────────────────────────────────────── */

eq(cueKey('Back Squat'), 'back-squat', 'a name becomes the catalogue id');
eq(cueKey('back squat'), 'back-squat', 'case does not make a second cue');
eq(cueKey('  Barbell  Bench—Press '), 'barbell-bench-press', 'punctuation and runs of space collapse');
eq(cueKey(''), '', 'no name, no key');
eq(cueKey('   '), '', 'and whitespace is no name');
eq(cueKey('!!!'), '', 'nor is punctuation alone');

// The copy must not drift from the original. Compared as SOURCE, because two
// implementations that agree on six examples can still disagree on the
// seventh — and the seventh is somebody's movement.
{
  const src = readFileSync('src/lib/exerciseId.ts', 'utf8');
  const body = src.slice(src.indexOf('export function exerciseSlug'));
  const theirs = body.slice(0, body.indexOf('\n}\n') + 2);
  const mine = readFileSync('src/lib/coachCues.ts', 'utf8');
  const mineBody = mine.slice(mine.indexOf('export function cueKey'));
  const mineFn = mineBody.slice(0, mineBody.indexOf('\n}\n') + 2);
  const strip = (s: string) => s.replace(/export function \w+/, 'fn').replace(/\s+/g, ' ').trim();
  eq(strip(mineFn), strip(theirs),
    'cueKey and exerciseSlug are the same rule; if this fails they have drifted and cues stop matching movements');
}

/* ── THE RULE: a prefill never overwrites ─────────────────────────────────── */

// The whole of the danger, asserted from every side.

{
  const written = 'go easy, right shoulder still sore';
  eq(prefillNote(written, 'brace before you unrack'), written,
    'a note somebody wrote is kept when a cue exists');
  ok(prefillNote(written, 'brace before you unrack') === written,
    'and kept BY IDENTITY — a copy would mean something rewrote it');
}

// A short, cheap-looking note is still a note. "0" survives `||` by luck — a
// non-empty string is truthy — and does NOT survive a length check, a Number()
// round trip, or any of the other ways somebody "normalises" a field they have
// decided is probably junk. It is a whole instruction in a gym.
eq(prefillNote('0', 'brace before you unrack'), '0',
  'a note of "0" is a note. Null is not zero and neither is this');
eq(prefillNote('.', 'brace'), '.', 'a one-character note is a note');

// Formatting is part of what they wrote.
{
  const indented = '  brace hard\n  then sit back';
  ok(prefillNote(indented, 'anything') === indented,
    'a note is returned untrimmed and unnormalised — the coach typed the layout too');
}

// The only cases that take the cue.
eq(prefillNote('', 'brace before you unrack'), 'brace before you unrack', 'an empty note takes the cue');
eq(prefillNote('   ', 'brace before you unrack'), 'brace before you unrack', 'a whitespace-only note takes the cue');
eq(prefillNote('\n\t ', 'brace'), 'brace', 'and so does a note that is only line breaks');
eq(prefillNote(undefined, 'brace'), 'brace', 'an absent note takes the cue');
eq(prefillNote(null, 'brace'), 'brace', 'and so does a null one');
eq(prefillNote(' brace ', undefined), ' brace ', 'with no cue, a written note is still untouched');

// Never ''. An empty string stored as a note draws an empty bubble in the
// client's app — ProgramExercise.note says so.
eq(prefillNote('', undefined), undefined, 'no note and no cue is undefined, never an empty string');
eq(prefillNote('', null), undefined, 'and a null cue is the same');
eq(prefillNote(undefined, ''), undefined, 'an empty cue fills nothing');
eq(prefillNote('   ', '   '), undefined, 'and a whitespace cue is no cue');
eq(prefillNote('', '  brace  '), 'brace', 'a cue IS trimmed on its way in — it is being written fresh');

// Idempotent. Running the prefill twice must be indistinguishable from once,
// or any screen that re-ran it would start overwriting.
{
  const once = prefillNote('', 'brace');
  const twice = prefillNote(once, 'a completely different cue');
  eq(twice, 'brace', 'a note filled from a cue is then a written note, and the next cue does not replace it');
}

// The control that offers the prefill.
eq(wouldPrefill('written', 'cue'), false, 'no prefill is offered over a written note');
eq(wouldPrefill('0', 'cue'), false, 'nor over "0"');
eq(wouldPrefill('', 'cue'), true, 'it is offered over an empty one');
eq(wouldPrefill('  ', 'cue'), true, 'and over a blank one');
eq(wouldPrefill(undefined, 'cue'), true, 'and over an absent one');
eq(wouldPrefill('', ''), false, 'but not when there is no cue to offer');
eq(wouldPrefill('', undefined), false, 'and not when the cue is absent');

// And the two agree: wherever the control is NOT offered, the function does
// nothing. This is the property that makes it impossible to get wrong.
for (const note of [undefined, null, '', ' ', '\n', '0', 'x', ' padded ']) {
  for (const c of [undefined, null, '', '  ', 'brace']) {
    const before = note;
    const after = prefillNote(note, c);
    if (!wouldPrefill(note, c)) {
      const kept = typeof before === 'string' && before.trim() !== '' ? before : undefined;
      eq(after, kept, `no offer means no change (note=${JSON.stringify(note)}, cue=${JSON.stringify(c)})`);
    } else {
      ok(typeof after === 'string' && after !== '' && after === String(c).trim(),
        `an offer means the cue lands (note=${JSON.stringify(note)}, cue=${JSON.stringify(c)})`);
    }
  }
}

/* ── one exercise, and a whole week ───────────────────────────────────────── */

{
  const r = read(cue('back-squat', 'brace before you unrack, chin tucked'));
  const blank = { key: 'k1', name: 'Back Squat', sets: 3, reps: '5' } as { key: string; name: string; sets: number; reps: string; note?: string };
  const filled = prefillExercise(blank, r);
  eq(filled.note, 'brace before you unrack, chin tucked', 'a blank exercise takes its coach cue');
  eq(filled.key, 'k1', 'and keeps every other field the row carries');

  const written = { key: 'k2', name: 'Back Squat', sets: 3, reps: '5', note: 'only to parallel this block' };
  const after = prefillExercise(written, r);
  ok(after === written, 'an exercise with a note is returned by identity — nothing is rebuilt, nothing is lost');

  const unknown = { key: 'k3', name: 'Zercher Carry', sets: 2, reps: '30s' } as { key: string; name: string; sets: number; reps: string; note?: string };
  ok(prefillExercise(unknown, r) === unknown, 'a movement with no cue is untouched');
}

{
  const r = read(cue('back-squat', 'chin tucked'), cue('overhead-press', 'ribs down'));
  const days = [
    { day: 'Mon', focus: 'Legs', exercises: [
      { name: 'Back Squat' } as { name: string; note?: string },
      { name: 'Leg Press', note: 'keep the heels flat, her knee' },
    ] },
    { day: 'Wed', focus: 'Push', exercises: [
      { name: 'Overhead Press', note: '' } as { name: string; note?: string },
    ] },
    { day: 'Fri', focus: 'Pull', exercises: [{ name: 'Chin Up' } as { name: string; note?: string }] },
  ];
  const out = prefillDays(days, r);
  eq(out[0].exercises[0].note, 'chin tucked', 'the blank one is filled');
  eq(out[0].exercises[1].note, 'keep the heels flat, her knee', 'the written one is not');
  eq(out[1].exercises[0].note, 'ribs down', 'an empty-string note is blank and is filled');
  ok(out[2] === days[2], 'a day that needed nothing is the SAME day object');
  ok(out[1].exercises[0] !== days[1].exercises[0], 'and the one that changed is a new object, not a mutation');
  eq(days[1].exercises[0].note, '', 'the input is not mutated');

  // Running it again changes nothing at all.
  const again = prefillDays(out, r);
  ok(again === out, 'a second pass over an already-prefilled week is the same array');

  // Under a database without the part, nothing is touched and nothing claims
  // the coach has no cues.
  ok(prefillDays(days, NO_CUE_TABLE) === days, 'with no table there is no prefill and no churn');
  eq(prefillDays(days, read()).length, 3, 'and an empty cue book leaves the week alone');
  ok(prefillDays(days, read()) === days, 'by identity');
}

/* ── looking a cue up ─────────────────────────────────────────────────────── */

{
  const r = read(cue('back-squat', 'chin tucked'));
  eq(cueFor(r, 'Back Squat'), 'chin tucked', 'found by name');
  eq(cueFor(r, 'back  squat'), 'chin tucked', 'and by any spelling of the same movement');
  eq(cueFor(r, 'Front Squat'), null, 'a different movement is a different cue');
  eq(cueFor(r, ''), null, 'a nameless movement has none');
  eq(cueFor(NO_CUE_TABLE, 'Back Squat'), null, 'and an undeployed database has none to give');
  eq(cueRowFor(r, 'Back Squat')?.updatedAt, '2026-09-01T10:00:00Z', 'the row carries when it was written');
  eq(cueRowFor(NO_CUE_TABLE, 'Back Squat'), null, 'no row without a table');
}

/* ── the two nulls are never the same sentence ────────────────────────────── */

{
  const r = read(cue('back-squat', 'chin tucked'));
  eq(cueAvailability(r, 'Back Squat'), null, 'with a cue there is nothing to explain');
  eq(cueAvailability(r, 'Front Squat'), NO_CUE_YET_NOTE, 'a read with no cue for this movement says so');
  eq(cueAvailability(NO_CUE_TABLE, 'Front Squat'), CUES_UNAVAILABLE_NOTE, 'an undeployed database says something else entirely');
  // Cast through string because both are `const`-typed literals and tsc would
  // otherwise refuse the comparison as provably false. The assertion is still
  // worth making: somebody tidying two similar sentences into one shared
  // constant is exactly how the two facts get collapsed again.
  ok((NO_CUE_YET_NOTE as string) !== (CUES_UNAVAILABLE_NOTE as string),
    'and the two sentences are not the same sentence');
  ok(!/you have no|none saved|no cues/i.test(CUES_UNAVAILABLE_NOTE),
    'the undeployed sentence never claims the coach has written none');
  ok(/never|empty/i.test(CUE_NEVER_OVERWRITES), 'the promise to the coach says what it protects');
}

/* ── what a coach may save ────────────────────────────────────────────────── */

eq(cueRefusal('brace before you unrack', 'Back Squat'), null, 'an ordinary cue is accepted');
ok(cueRefusal('', 'Back Squat') !== null, 'an empty box is refused rather than saved as nothing');
ok(cueRefusal('   ', 'Back Squat') !== null, 'and so is a blank one');
ok(/Remove/.test(cueRefusal('', 'Back Squat') || ''), 'and the refusal says how to clear it instead');
ok(cueRefusal('x', '') !== null, 'a movement with no name cannot carry a cue');
eq(cueRefusal('x'.repeat(CUE_MAX), 'Back Squat'), null, 'exactly the limit is allowed');
ok(cueRefusal('x'.repeat(CUE_MAX + 1), 'Back Squat') !== null, 'one past it is not');
ok(cueRefusal(' ' + 'x'.repeat(CUE_MAX) + ' ', 'Back Squat') === null,
  'and the length is measured on the trimmed text, not on the spaces around it');

/* ── the read, before the part is applied ─────────────────────────────────── */

// This is the ONLY path that runs in production today.

ok(isMissingCueTable({ code: 'PGRST205', message: "Could not find the table 'public.coach_exercise_cues' in the schema cache" }),
  'PGRST205 is what this deployment actually answers for a table it does not know — measured, not assumed');
ok(isMissingCueTable({ code: '42P01', message: 'relation "coach_exercise_cues" does not exist' }),
  '42P01 is the Postgres form, reachable while the cache is warm and the table has gone');
ok(!isMissingCueTable({ code: '42501', message: 'permission denied' }),
  'a refusal is NOT a missing table — a coach whose grant is wrong must not be told the feature is off');
ok(!isMissingCueTable({ code: 'PGRST301', message: 'JWT expired' }), 'nor is a signed-out session');
ok(!isMissingCueTable({ message: 'Failed to fetch' }), 'nor is a dead network');
ok(!isMissingCueTable(null), 'and neither is nothing at all');

function fake(answer: { data?: any; error?: any }) {
  const calls: any[] = [];
  const q: any = {
    select: (cols: string) => { calls.push(['select', cols]); return q; },
    eq: (col: string, v: any) => { calls.push(['eq', col, v]); return q; },
    limit: (n: number) => { calls.push(['limit', n]); return Promise.resolve(answer); },
    upsert: (row: any, opts: any) => { calls.push(['upsert', row, opts]); return q; },
    delete: () => { calls.push(['delete']); return q; },
    then: (res: any, rej: any) => Promise.resolve(answer).then(res, rej),
  };
  // `select` terminates the chain for the write paths, so it has to be
  // thenable as well as chainable; the object above is both.
  return { sb: { from: (t: string) => { calls.push(['from', t]); return q; } }, calls };
}

(async () => {
 // Wrapped, so a read that THROWS where 'absent' was expected is reported as a
 // named failure rather than as an unhandled rejection with no assertion
 // attached to it. A crash is a signal; a sentence saying which rule broke is
 // a better one.
 try {
  {
    const { sb } = fake({ data: null, error: { code: 'PGRST205', message: 'no such table' } });
    const r = await fetchMyCues(sb);
    eq(r.status, 'absent', 'a database without part 3150 reads as absent, not as an error and not as empty');
  }
  {
    const { sb } = fake({ data: null, error: { code: '42501', message: 'permission denied' } });
    let threw = false;
    try { await fetchMyCues(sb); } catch { threw = true; }
    ok(threw, 'a refused read THROWS — a failed read is not a coach with no cues');
  }
  {
    const { sb, calls } = fake({ data: [
      { exercise_id: 'back-squat', cue: ' chin tucked ', updated_at: '2026-09-01T10:00:00Z' },
      { exercise_id: 'dead-lift', cue: '   ' },
      { exercise_id: '', cue: 'orphan' },
    ], error: null });
    const r = await fetchMyCues(sb);
    eq(r.status, 'read', 'a table that answers reads as read');
    if (r.status === 'read') {
      eq(r.cues.length, 1, 'a blank cue and an id-less row are dropped rather than carried as empty strings');
      eq(r.cues[0].cue, 'chin tucked', 'and the words are trimmed');
    }
    ok(!calls.some((c) => JSON.stringify(c).includes('coach_id')),
      'no coach id is sent — the policy decides whose cues these are, so there is no argument to widen');
  }
  {
    const rows = Array.from({ length: 6 }, (_, i) => ({ exercise_id: `m-${i}`, cue: 'c' }));
    const { sb } = fake({ data: rows, error: null });
    let threw = false;
    try { await fetchMyCues(sb, 5); } catch { threw = true; }
    ok(threw, 'a cue list at the ceiling throws rather than silently losing a movement its cue');
  }
  {
    const { sb, calls } = fake({ data: [{ exercise_id: 'back-squat', cue: 'chin tucked' }], error: null });
    const r = await fetchCoachCue(sb, 'Back Squat');
    eq(r.status, 'read', 'the client-side read answers');
    eq(cueFor(r, 'Back Squat'), 'chin tucked', 'with their own coach cue');
    ok(calls.some((c) => c[0] === 'eq' && c[1] === 'exercise_id' && c[2] === 'back-squat'),
      'filtered on the movement, server-side — a member does not download their coach cue book');
    ok(!calls.some((c) => c[0] === 'eq' && /coach|trainer|uid/.test(String(c[1]))),
      'and NEVER filtered on a coach id a client could change');
  }
  {
    const { sb } = fake({ data: null, error: { code: 'PGRST205' } });
    const r = await fetchCoachCue(sb, 'Back Squat');
    eq(r.status, 'absent', 'and the client screen degrades the same way — it does not go down');
    eq(cueFor(r, 'Back Squat'), null, 'with no cue to show');
    eq(cueAvailability(r, 'Back Squat'), CUES_UNAVAILABLE_NOTE, 'and it does not tell the member their coach wrote none');
  }
  {
    const { sb } = fake({ data: [], error: null });
    const r = await fetchCoachCue(sb, '');
    eq(r.status, 'read', 'a nameless movement is answered without a round trip and without a lie');
  }

  /* ── the write ──────────────────────────────────────────────────────────── */
  {
    const { sb, calls } = fake({ data: [{ exercise_id: 'back-squat', cue: 'chin tucked', updated_at: 'x' }], error: null });
    const r = await saveCue(sb, 'Back Squat', '  chin tucked  ');
    eq(r.ok, true, 'a cue saves');
    const up = calls.find((c) => c[0] === 'upsert');
    eq(up[1].cue, 'chin tucked', 'trimmed');
    eq(up[1].exercise_id, 'back-squat', 'under the movement id');
    ok(!('coach_id' in up[1]), 'and with NO coach_id — it defaults to auth.uid() so there is no field to get wrong');
  }
  {
    const { sb } = fake({ data: [], error: null });
    const r = await saveCue(sb, 'Back Squat', 'chin tucked');
    eq(r.ok, false, 'a write that came back with no row is not a write that happened');
  }
  {
    const { sb } = fake({ data: null, error: { code: '42501', message: 'permission denied' } });
    const r = await saveCue(sb, 'Back Squat', 'chin tucked');
    eq(r.ok, false, 'a refused write is reported, never inferred as success from a resolved promise');
  }
  {
    const { sb } = fake({ data: null, error: { code: 'PGRST205' } });
    const r = await saveCue(sb, 'Back Squat', 'chin tucked');
    eq(r.ok, false, 'and on a database without the part the coach is told why');
    ok(!r.ok && r.said === CUES_UNAVAILABLE_NOTE, 'in the sentence that does not blame them');
  }
  {
    const { sb } = fake({ data: [{ exercise_id: 'back-squat' }], error: null });
    const r = await deleteCue(sb, 'Back Squat');
    eq(r.ok, true, 'a cue can be removed');
  }
  {
    const { sb } = fake({ data: [], error: null });
    const r = await deleteCue(sb, 'Back Squat');
    eq(r.ok, false, 'a delete that removed nothing does not report success');
  }

  /* ── and the two screens use it ─────────────────────────────────────────── */
  {
    const builder = readFileSync('app/(trainer)/builder.tsx', 'utf8');
    ok(/prefillNote|prefillDays|prefillExercise/.test(builder),
      'the builder prefills through this module rather than by hand');
    ok(!/note:\s*cue\b/.test(builder), 'and never assigns a cue straight onto a note');
    const client = readFileSync('app/(client)/exercise.tsx', 'utf8');
    ok(/fetchCoachCue|coachCues/.test(client), "the client's exercise screen reads the cue");
  }

 } catch (e) {
    errors.push(`a read or write threw where it should have degraded or reported — ${String(e && (e as any).message ? (e as any).message : JSON.stringify(e))}`);
  }

  if (errors.length) {
    console.error(`coachCues: ${errors.length} failure(s)`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('coachCues: ok');
})();
