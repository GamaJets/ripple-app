import { checkInjury, nextAlternative } from './builtWorkout';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

const inj = (area: string, severity: Injury['severity'] = 'moderate', status: Injury['status'] = 'active'): Injury =>
  ({ id: 'i_' + area + severity + status, area, severity, status, at: '2026-09-20T00:00:00.000Z' });

/* ── the one this file exists for ──────────────────────────────────────────
   An injury list that did not arrive is `[]`, exactly like a member who has
   disclosed nothing. `injuryFlag` returns null for both. Nothing downstream
   may draw those two the same way. */
eq(checkInjury('Back Squat', 'Legs', [], 'error').state, 'unread',
  'a failed read is UNREAD, never clear');
eq(checkInjury('Back Squat', 'Legs', [], 'loading').state, 'reading',
  'a read still in flight is not clear either');
eq(checkInjury('Back Squat', 'Legs', [], 'partial').state, 'unread',
  'half a disclosure is not a basis for drawing the other half as clear');
eq(checkInjury('Back Squat', 'Legs', [], 'ready').state, 'unflagged',
  'and only a read that landed may say nothing was flagged');
ok(checkInjury('Back Squat', 'Legs', [inj('knee')], 'error').state === 'unread',
  'an unread status wins even when a list happens to be in hand — it is not confirmed current');

// The flag itself is `injuryFlag`'s, passed through unsoftened.
const f = checkInjury('Back Squat', 'Legs', [inj('knee')], 'ready');
eq(f.state, 'flagged', 'a squat loads a reported knee');
ok(f.state === 'flagged' && f.reason === 'May stress your knee', 'the existing wording is reused, not rewritten');
ok(f.state === 'flagged' && f.severity === 'moderate', 'and the severity travels with it');
eq(checkInjury('Back Squat', 'Legs', [inj('knee', 'moderate', 'recovered')], 'ready').state, 'unflagged',
  'a recovered injury is not flagged — activeInjuries already decides that');
eq(checkInjury('Barbell Curl', 'Arms', [inj('knee')], 'ready').state, 'unflagged',
  'and a movement that does not load the area is unflagged, which is not a claim that it is safe');

/* ── replacing a movement ───────────────────────────────────────────────── */
eq(nextAlternative(['Cable Pushdown', 'Skullcrusher'], ['Dips'], 'Arms', [], 'ready'), 'Cable Pushdown',
  'the first free alternative');
eq(nextAlternative(['Cable Pushdown', 'Skullcrusher'], ['Dips', 'Cable Pushdown'], 'Arms', [], 'ready'), 'Skullcrusher',
  'one already on the day is not offered again — two rows must not become the same movement');
eq(nextAlternative(['Cable Pushdown'], ['  cable pushdown '], 'Arms', [], 'ready'), null,
  'matched case-insensitively and trimmed, so a spelling difference cannot smuggle a duplicate in');
eq(nextAlternative(['Cable Pushdown', 'Skullcrusher'], ['Cable Pushdown', 'Skullcrusher'], 'Arms', [], 'ready'), null,
  'an exhausted pool returns null so the screen can say so rather than offer a dead control');
eq(nextAlternative([], [], 'Arms', [], 'ready'), null, 'and a target with no alternatives at all');

eq(nextAlternative(['A', 'B', 'C', 'D'], ['X', 'C'], 'Arms', [], 'ready', 'C'), 'D',
  'the search starts after the movement on the row, so repeated presses walk forward');
eq(nextAlternative(['A', 'B', 'C', 'D'], ['X', 'D'], 'Arms', [], 'ready', 'D'), 'A',
  'and wraps at the end of the pool');
eq(nextAlternative(['A', 'B'], ['X', 'Q'], 'Arms', [], 'ready', 'Q'), 'A',
  'a movement not in the pool (the one the day was built with) starts from the top');
eq(nextAlternative(['Goblet Squat', 'Lat Pulldown', 'Box Jump'], ['Goblet Squat'], 'Back', [inj('knee')], 'ready', 'Goblet Squat'), 'Lat Pulldown',
  'the injury preference still holds across the whole pool');

// The pattern app/(client)/workouts.tsx already applies to a coach's plan:
// prefer an alternative that does not flag.
eq(nextAlternative(['Goblet Squat', 'Lat Pulldown'], [], 'Back', [inj('knee')], 'ready'), 'Lat Pulldown',
  'a flagging alternative is stepped over for one that does not flag');
eq(nextAlternative(['Goblet Squat', 'Box Jump'], [], 'Back', [inj('knee')], 'ready'), 'Goblet Squat',
  'when every alternative flags, one is still offered — and the row will carry its own flag');
eq(nextAlternative(['Goblet Squat', 'Lat Pulldown'], [], 'Back', [inj('knee')], 'error'), 'Goblet Squat',
  'under an unread disclosure there is no safer-looking pick to prefer, and none is invented');

/* ── a replacement trains the same muscle ────────────────────────────────
   Seen on a device, 3 Oct 2026: a Full Body session offered "Or instead:
   Barbell Overhead Extension" on EVERY row — under a clamshell, a hip
   abduction and a calf raise alike. Replace really would have put a triceps
   extension where the calf raise was.

   The first attempt at this matched on `muscle_group` and changed NOTHING,
   because that column reads "Full body" on 196 of the catalogue's 615 rows and
   those 196 include both the calf raise and the triceps extension. The screen
   proved it by offering the same swap again. `primary_muscles` is the column
   that says what is trained. */
{
  const musclesOf = (n: string) => ({
    'Barbell Overhead Extension': ['triceps brachii'],
    'Barbell Calf Raise': ['gastrocnemius'],
    'Standing Calf Raise': ['gastrocnemius'],
  } as Record<string, string[]>)[n] ?? [];

  eq(nextAlternative(
    ['Barbell Overhead Extension', 'Standing Calf Raise'], [], 'Full body', [], 'ready',
    'Barbell Calf Raise', musclesOf,
  ), 'Standing Calf Raise',
    'a calf raise is replaced by the other calf movement, not by the first free thing in the catalogue');

  // The group is "Full body" for all three, so a group match would have picked
  // the triceps extension — this is the case the first fix got wrong.
  eq(nextAlternative(
    ['Barbell Overhead Extension', 'Standing Calf Raise'], [], 'Full body', [], 'ready',
    'Barbell Calf Raise',
  ), 'Barbell Overhead Extension',
    'with no muscles to compare, the pool is taken in order exactly as before');

  // One of its kind still deserves a swap rather than a button that does
  // nothing.
  eq(nextAlternative(
    ['Barbell Overhead Extension'], [], 'Full body', [], 'ready', 'Barbell Calf Raise', musclesOf,
  ), 'Barbell Overhead Extension',
    'when nothing shares the muscle, the wider pool is offered rather than nothing');

  // A row the catalogue names no muscles for must not match everything.
  eq(nextAlternative(
    ['Barbell Overhead Extension', 'Standing Calf Raise'], [], 'Full body', [], 'ready',
    'Unknown Movement', musclesOf,
  ), 'Barbell Overhead Extension',
    'a movement with no muscles recorded falls back to the pool rather than matching anything');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
