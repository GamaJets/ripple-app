// Assertions for the COACH's view of a member's rewrite of their programme.
//
// The one that matters most is the join. `storedKeyOf` derives the stored key
// out of an id that `planEditItems` builds, and it is derived rather than
// re-walked so that one enumeration of the jsonb blob serves both screens. That
// makes the id format a contract between two modules that nothing else checks,
// so it is checked here against `planEditItems`' real output rather than
// against a string this file made up — if the id format changes, this fails,
// which is the whole point. A silent failure would resolve no movement names at
// all and the coach's screen would read like a client whose changes were all
// about movements the programme does not contain.
//
// After that, the two collapses this codebase keeps paying for: a failed read
// must never read as "they have followed it as written", and a key the current
// programme cannot resolve must never read as no change.
import {
  EDIT_STALE_MS, editAge, planEditDiffLine, planEditsCoachNote, planEditsDiff,
  slugOfKey, storedKeyOf,
} from './planEditsDiff';
import { planEditItems } from './planEditsReadBack';
import { EMPTY_PLAN_EDITS, type PlanEdits } from './planEdits';
import type { ProgramDay, ProgramExercise } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const ex = (key: string, name: string, sets: number, reps: string, loadKg?: number | null): ProgramExercise =>
  ({ key, name, group: 'Chest', sets, reps, alternatives: [], ...(loadKg === undefined ? {} : { loadKg }) });

const DAYS: ProgramDay[] = [
  { day: 'Mon', focus: 'Push', exercises: [ex('bench', 'Bench Press', 4, '6-8', 100), ex('ohp', 'Overhead Press', 4, '8-10')] },
  { day: 'Wed', focus: 'Pull', exercises: [ex('row', 'Bent-over Row', 3, '8-10')] },
];

const EDITS: PlanEdits = {
  swaps: { '0:bench': 'Machine Chest Press' },
  exEdits: { '0:ohp': { sets: 3, reps: '10', loadKg: 40, setRows: [{ reps: '10' }, { reps: '10' }, { reps: '8' }] } },
  removed: ['1:row'],
  custom: [ex('facepull', 'Face Pull', 3, '15')],
};

/** Kilograms into a printed label, standing in for `liftLabel`. Deliberately
 *  returns null for a load it will not render, because the real one does and
 *  the clause-dropping below is what that null is for. */
const kg = (v: number | null): string | null => (v == null ? null : `${v} kg`);

/* ── the join ──────────────────────────────────────────────────────────── */

{
  const items = planEditItems(EDITS);
  const keyed = items.filter((i) => i.kind !== 'custom');
  ok(keyed.length === 3, `expected three keyed items, got ${keyed.length}`);
  // Every key derived out of an id must be a key that is actually in the blob.
  // This is the assertion that breaks if `planEditItems` ever re-spells its ids.
  const known = new Set([...Object.keys(EDITS.swaps), ...Object.keys(EDITS.exEdits), ...EDITS.removed]);
  for (const it of keyed) {
    const k = storedKeyOf(it);
    ok(k != null && known.has(k), `storedKeyOf did not recover a real key from ${it.id}`);
  }
  ok(storedKeyOf(items.filter((i) => i.kind === 'custom')[0]) === null, 'an added movement has no stored key');
  ok(slugOfKey('0:bench') === 'bench', 'the slug is what follows the day index');
  ok(slugOfKey('12:cable:fly') === 'cable:fly', 'a slug containing a colon survives whole');
  ok(slugOfKey('bench') === null, 'a key with no day index yields no slug');
  ok(slugOfKey(null) === null, 'no key is no slug');
}

/* ── resolution against the programme ──────────────────────────────────── */

{
  const d = planEditsDiff({ edits: EDITS, editStatus: 'ready', readable: true, days: DAYS });
  ok(d.state === 'ready', 'a read programme and read edits are ready');
  ok(d.rows.length === 4, `expected four rows, got ${d.rows.length}`);
  ok(d.strayCount === 0, 'every key in this blob is in this programme');

  const swap = d.rows.filter((r) => r.kind === 'swap')[0];
  ok(swap.assigned === 'Bench Press', 'the slug resolved to the movement the coach wrote');
  ok(swap.theirs === 'Machine Chest Press', 'the swap names what they do instead');
  ok(swap.dayLabel === 'Mon · Push', 'the day is named out of the programme');
  ok(swap.dayIdx === 0, 'the row index counts from zero because it subscripts days');
  ok(planEditDiffLine(swap, 'Amy', kg) === 'Mon · Push — you wrote Bench Press; Amy does Machine Chest Press instead.',
    `swap line read: ${planEditDiffLine(swap, 'Amy', kg)}`);

  const nums = d.rows.filter((r) => r.kind === 'numbers')[0];
  ok(nums.assigned === 'Overhead Press', 'the corrected movement resolved');
  ok(nums.sets != null && nums.sets.wrote === 4 && nums.sets.theirs === 3, 'both sets figures are carried');
  ok(nums.reps != null && nums.reps.wrote === '8-10' && nums.reps.theirs === '10', 'both rep figures are carried');
  // The coach wrote no load for the overhead press, so there is nothing of
  // theirs to put beside the member's 40 — and that is a null rather than a
  // zero, because a programme naming no load has not prescribed one.
  ok(nums.loadKg != null && nums.loadKg.wrote === null && nums.loadKg.theirs === 40, 'an unprescribed load is null, not zero');
  ok(nums.tableRows === 3, 'the member wrote a three-row set table');
  const numLine = planEditDiffLine(nums, 'Amy', kg);
  ok(numLine.indexOf('3 sets where you wrote 4') >= 0, `numbers line lost the sets: ${numLine}`);
  ok(numLine.indexOf('40 kg of their own') >= 0, `numbers line lost the load: ${numLine}`);
  ok(numLine.indexOf('on Overhead Press') >= 0, `numbers line lost the movement: ${numLine}`);

  const gone = d.rows.filter((r) => r.kind === 'removed')[0];
  ok(planEditDiffLine(gone, 'Amy', kg) === 'Wed · Pull — Amy has taken Bent-over Row off.',
    `removal line read: ${planEditDiffLine(gone, 'Amy', kg)}`);

  const added = d.rows.filter((r) => r.kind === 'custom')[0];
  ok(added.dayLabel === null, 'an added movement sits on no day and is not given one');
  ok(added.resolved, 'an added movement resolves against nothing by construction and is not a stray');
  ok(added.sets != null && added.sets.wrote === null && added.sets.theirs === 3, 'an added movement carries its own sets and none of the coach’s');
  ok(planEditDiffLine(added, 'Amy', kg) === 'Amy added Face Pull, which this programme does not contain.',
    `added line read: ${planEditDiffLine(added, 'Amy', kg)}`);

  // No sentence is built around a missing day or a missing name.
  for (const r of d.rows) {
    const line = planEditDiffLine(r, 'Amy', kg);
    ok(line.indexOf('— ') !== 0, `a line opened with a dangling day separator: ${line}`);
    ok(line.indexOf('undefined') < 0 && line.indexOf('null') < 0, `a line printed a hole: ${line}`);
    ok(line.indexOf('you wrote .') < 0 && line.indexOf('you wrote,') < 0, `a clause lost its figure: ${line}`);
  }
}

/* ── the programme has moved on ────────────────────────────────────────── */

{
  // The coach has rewritten the block. Every key the member corrected names a
  // movement that is no longer in it. Those rows are still listed — "they have
  // been correcting the load on something for a month" is worth reading — and
  // the count of them is a fact about the PROGRAMME, not about the member.
  const other: ProgramDay[] = [{ day: 'Mon', focus: 'Push', exercises: [ex('dip', 'Dip', 3, '8')] }];
  const d = planEditsDiff({ edits: EDITS, editStatus: 'ready', readable: true, days: other });
  ok(d.state === 'ready', 'a programme that no longer matches is still a programme');
  ok(d.rows.length === 4, 'no row is dropped for failing to resolve');
  ok(d.strayCount === 3, `expected three strays, got ${d.strayCount}`);
  const swap = d.rows.filter((r) => r.kind === 'swap')[0];
  ok(swap.assigned === null, 'an unresolved key names no movement rather than guessing one');
  ok(swap.resolved === false, 'and says so');
  const line = planEditDiffLine(swap, 'Amy', kg);
  ok(line === 'Mon · Push — Amy does Machine Chest Press instead of what this programme names here.',
    `unresolved swap line read: ${line}`);
  const note = planEditsCoachNote({ diff: d, who: 'Amy', whenWords: '3 March 2026', ageWords: '2 days ago', stale: false });
  ok(note.indexOf('no longer') >= 0, `the note did not mention the strays: ${note}`);
}

/* ── a day index the programme does not have ───────────────────────────── */

{
  // A member whose block used to have four days, corrected on day four, and
  // whose coach has since cut it to two. Subscripting past the end must produce
  // no label and no name — never a crash and never day one's movement.
  const far: PlanEdits = { ...EMPTY_PLAN_EDITS, removed: ['7:bench'] };
  const d = planEditsDiff({ edits: far, editStatus: 'ready', readable: true, days: DAYS });
  ok(d.rows.length === 1, 'the row survives');
  ok(d.rows[0].dayLabel === null && d.rows[0].assigned === null, 'a day past the end of the programme names nothing');
  ok(d.rows[0].dayIdx === 7, 'the index it was stored under is still reported');
  ok(planEditDiffLine(d.rows[0], 'Amy', kg) === 'Amy has taken a movement off.',
    `line read: ${planEditDiffLine(d.rows[0], 'Amy', kg)}`);
}

/* ── nothing to compare against ────────────────────────────────────────── */

{
  const d = planEditsDiff({ edits: EDITS, editStatus: 'ready', readable: true, days: null });
  ok(d.state === 'unmatched', 'no programme is unmatched, not unreadable');
  ok(d.rows.length === 4, 'the changes are real even where the programme is not readable');
  ok(d.resolvedCount === 1, 'only the added movement resolves without a programme');
  const note = planEditsCoachNote({ diff: d, who: 'Amy', whenWords: null, ageWords: null, stale: false });
  ok(note.indexOf('could not be read') >= 0, `unmatched note must say the programme was not read: ${note}`);
  ok(note.indexOf('has changed 4 things') >= 0, `unmatched note must still count the changes: ${note}`);
}

/* ── null is not zero ──────────────────────────────────────────────────── */

{
  for (const st of ['loading', 'error', 'partial'] as const) {
    const d = planEditsDiff({ edits: EDITS, editStatus: st, readable: true, days: DAYS });
    ok(d.state === 'unreadable', `${st} must not be drawn as a read`);
    ok(d.rows.length === 0 && d.resolvedCount === 0 && d.strayCount === 0, `${st} must count nothing`);
    const note = planEditsCoachNote({ diff: d, who: 'Amy', whenWords: null, ageWords: null, stale: false });
    ok(note.indexOf('could not be read') >= 0, `${st} note must name the read: ${note}`);
    ok(note.indexOf('has not changed anything') < 0, `${st} note claimed the member changed nothing: ${note}`);
  }
  // Stored, and the bytes will not parse. The same distinction
  // `readPlanEdits` keeps for the device's copy: unreadable is not empty.
  const bad = planEditsDiff({ edits: EMPTY_PLAN_EDITS, editStatus: 'ready', readable: false, days: DAYS });
  ok(bad.state === 'unreadable', 'stored-but-unparseable is not a member who changed nothing');
  // And a member who genuinely changed nothing IS allowed to be told so.
  const none = planEditsDiff({ edits: EMPTY_PLAN_EDITS, editStatus: 'ready', readable: true, days: DAYS });
  ok(none.state === 'ready' && none.rows.length === 0, 'an empty blob under a good read is empty');
  const note = planEditsCoachNote({ diff: none, who: 'Amy', whenWords: null, ageWords: null, stale: false });
  ok(note === 'Amy has not changed anything about the programme you assigned them.', `empty note read: ${note}`);
}

/* ── the staleness stamp ───────────────────────────────────────────────── */

{
  const now = Date.parse('2026-03-10T12:00:00Z');
  ok(editAge(null, now).ageMs === null, 'no stamp is no age');
  ok(editAge(null, now).stale === false, 'no stamp is not stale — we do not know when');
  ok(editAge('not a date', now).ageMs === null, 'an unparseable stamp is no age');
  const fresh = editAge('2026-03-09T12:00:00Z', now);
  ok(fresh.ageMs === 86_400_000, `expected a day of age, got ${fresh.ageMs}`);
  ok(fresh.stale === false, 'a day is not stale');
  const old = editAge('2025-11-01T12:00:00Z', now);
  ok(old.stale === true, 'four months is stale');
  ok(editAge(new Date(now - EDIT_STALE_MS + 1000).toISOString(), now).stale === false, 'the boundary is not stale');
  // A clock that moved backwards between the write and the read. Reported as no
  // age rather than as a change from the future.
  ok(editAge('2026-03-11T12:00:00Z', now).ageMs === null, 'a future stamp is no age');

  const d = planEditsDiff({ edits: EDITS, editStatus: 'ready', readable: true, days: DAYS });
  const stale = planEditsCoachNote({ diff: d, who: 'Amy', whenWords: '1 November 2025', ageWords: '129 days ago', stale: true });
  ok(stale.indexOf('1 November 2025') >= 0 && stale.indexOf('129 days ago') >= 0, `both time words belong in the note: ${stale}`);
  ok(stale.indexOf('since replaced') >= 0, `a stale note must say why it matters: ${stale}`);
  // Either time word may be missing and the sentence is written without it
  // rather than around a hole.
  for (const [w, a] of [[null, '2 days ago'], ['3 March 2026', null], [null, null]] as const) {
    const n = planEditsCoachNote({ diff: d, who: 'Amy', whenWords: w, ageWords: a, stale: false });
    ok(n.indexOf('null') < 0 && n.indexOf('undefined') < 0, `the note printed a hole: ${n}`);
    ok(n.indexOf('on .') < 0 && n.indexOf('changed .') < 0 && n.indexOf('()') < 0, `the note kept an empty clause: ${n}`);
  }
}

console.log(errors.length
  ? 'PLAN EDITS DIFF FAILURES:\n' + errors.join('\n')
  : 'planEditsDiff: ok — the key joins back to the blob, an unresolved key is still a change, a failed read never says they followed it as written, and no sentence is built around a missing day, name or figure');
if (errors.length) process.exit(1);
