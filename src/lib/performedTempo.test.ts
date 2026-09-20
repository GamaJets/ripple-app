// The tempo a member actually lifted at. Compile with tsc, run with node.
//
// Tempo was prescribed end to end and never recorded, so a coach could ask for
// a four-second eccentric and the log could not say whether they got one. What
// is pinned here is the three ways recording one could go wrong and quietly
// make the log WORSE than the silence it replaced:
//
//   1. Reading an absent tempo as a tempo of zero, or as the prescription met.
//      A set nobody was asked about is not a set performed at 0-0-0-0 and is
//      not a coach's instruction followed.
//   2. Losing the order. The four digits are read two ways in the wild — see
//      the header of ./setIntensity.ts — so a recorded tempo has to come back
//      in the same order it was prescribed in, or the comparison is noise.
//   3. Mis-aligning. `tempos` is jsonb and a shorter array than there are sets
//      must never slide set 4's answer onto set 3.
import { recordedTempo, packTempos, tempoVerdict, tempoSummary } from './performedTempo';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const entry = (sets: [number, number][], tempos?: (string | null)[]): WorkoutEntry =>
  ({ t: '2026-09-20T12:00:00.000Z', exercise: 'Back Squat', sets, tempos });

/* ── absence is not zero, and not a prescription met ───────────────────── */

const none = entry([[8, 100], [8, 100]]);
eq(recordedTempo(none, 0), null, 'an entry with no tempos records no tempo for set 1');
eq(tempoVerdict('3-1-1-0', recordedTempo(none, 0)).state, 'unrecorded',
  'a prescribed tempo with nothing recorded against it is unrecorded — not met, and not a miss');
ok(!/0-0-0-0/.test(tempoVerdict('3-1-1-0', null).line ?? ''),
  'and the sentence never renders the absence as a tempo of zero');
eq(tempoVerdict(null, null).state, 'none',
  'nothing asked for and nothing recorded draws nothing at all');

// The hole INSIDE a list is the same answer as no list. A member confirms the
// tempo on their top set and says nothing about the warm-up; that warm-up is
// not a set performed at zero.
const holed = entry([[8, 60], [3, 120]], [null, '3-0-X-0']);
eq(recordedTempo(holed, 0), null, 'a null at an index is a set nobody was asked about');
eq(recordedTempo(holed, 1), '3-0-X-0', 'and the set beside it keeps its own answer');
eq(tempoVerdict('3-0-X-0', recordedTempo(holed, 0)).state, 'unrecorded',
  'a hole under a prescription is silence, not compliance');

/* ── a recorded tempo round-trips in the app's own order ───────────────── */

// Stored eccentric · bottom pause · concentric · top pause, canonical and
// dashed, whatever the member typed. Three phases canonicalise to four, an X
// stays an X, and the notation comes back the way a prescribed one is written
// — which is the only thing that makes the two comparable.
eq(packTempos(['311'])?.[0], '3-1-1-0', 'a three-phase tempo is stored in the four-phase canonical form');
eq(packTempos(['30X1'])?.[0], '3-0-X-1', 'and X in the lifting slot survives as the letter, never flattened to 0');
eq(recordedTempo(entry([[8, 80]], ['3 1 1 0']), 0), '3-1-1-0',
  'spaces read back as the same tempo dashes do');
eq(tempoVerdict('311', '3-1-1-0').state, 'met',
  'a coach’s "311" and a member’s "3-1-1-0" are the same instruction, so the prescription is met');
eq(tempoVerdict('3-1-1-0', '2-0-1-0').state, 'differed',
  'a different tempo is a different tempo, which is the whole point of recording one');
ok(tempoVerdict('3-1-1-0', '2-0-1-0').line?.includes('3-1-1-0') === true
   && tempoVerdict('3-1-1-0', '2-0-1-0').line?.includes('2-0-1-0') === true,
  'and it names both — what was asked for and what was done');
ok(tempoVerdict('3-1-1-0', '3-1-1-0').line?.includes('3 sec down') === true,
  'every sentence spells the notation out, because the four digits are read two ways in the wild');
eq(tempoVerdict(null, '3-1-1-0').state, 'unasked',
  'a tempo recorded where none was prescribed is still the member’s own claim');

// Nothing unreadable reaches the column, so nothing unreadable can be read back
// as a tempo either.
eq(packTempos(['banana']), undefined, 'a string this build cannot read is not stored as a tempo');
eq(packTempos([null, undefined]), undefined, 'and a list where nobody said anything is not written at all');
eq(JSON.stringify(packTempos([null, '3-1-1'])), JSON.stringify([null, '3-1-1-0']),
  'a partly-answered movement keeps its holes, so the answers stay on the sets they were given for');

/* ── a short tempos array must not mis-align against longer sets ───────── */

const short = entry([[8, 60], [8, 60], [3, 120]], ['3-1-1-0']);
eq(recordedTempo(short, 0), '3-1-1-0', 'the one recorded tempo belongs to set 1');
eq(recordedTempo(short, 1), null, 'set 2 has none, rather than borrowing set 1’s');
eq(recordedTempo(short, 2), null, 'and neither does set 3 — a short array is short, not shifted');
eq(tempoVerdict('3-1-1-0', recordedTempo(short, 2)).state, 'unrecorded',
  'so the top set reads as unrecorded and not as the four-second eccentric the coach asked for');

// jsonb can hold whatever a past or future build wrote.
const junk = { ...entry([[8, 60]]), tempos: [4] as unknown as (string | null)[] };
eq(recordedTempo(junk, 0), null, 'a number where a tempo string belongs is read as nothing');
eq(recordedTempo(entry([[8, 60]]), 5), null, 'and so is an index past the end of everything');

/* ── an entry says its tempos back in one line ─────────────────────────── */

eq(tempoSummary(entry([[8, 60], [8, 60]])), null, 'an entry nobody recorded a tempo on has no line');
ok(tempoSummary(entry([[8, 60], [8, 60]], ['3-1-1-0', '3-1-1-0']))?.startsWith('Tempo 3-1-1-0 on every set') === true,
  'one tempo on every set is said once, not once per set');
ok(tempoSummary(short)?.includes('on set 1') === true,
  'and when only some sets carry one the line names them rather than claiming the rest');
ok(tempoSummary(entry([[8, 60], [3, 120]], ['3-1-1-0', '2-0-X-0']))?.includes('Set 2 2-0-X-0') === true,
  'two different tempos are two facts and are printed as two');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('performedTempo: ok — a prescribed tempo is now falsifiable, and silence stays silence');
