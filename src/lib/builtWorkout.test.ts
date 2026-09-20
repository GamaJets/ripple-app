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

// The pattern app/(client)/workouts.tsx already applies to a coach's plan:
// prefer an alternative that does not flag.
eq(nextAlternative(['Goblet Squat', 'Lat Pulldown'], [], 'Back', [inj('knee')], 'ready'), 'Lat Pulldown',
  'a flagging alternative is stepped over for one that does not flag');
eq(nextAlternative(['Goblet Squat', 'Box Jump'], [], 'Back', [inj('knee')], 'ready'), 'Goblet Squat',
  'when every alternative flags, one is still offered — and the row will carry its own flag');
eq(nextAlternative(['Goblet Squat', 'Lat Pulldown'], [], 'Back', [inj('knee')], 'error'), 'Goblet Squat',
  'under an unread disclosure there is no safer-looking pick to prefer, and none is invented');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
