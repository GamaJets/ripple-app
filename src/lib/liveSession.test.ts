// A workout that was still running when the app went away.
//
// The assertion this file is really for is section 3: that a session nobody
// has touched since this morning does NOT come back as a nine-hour workout.
// `sessionMins` reaches the log, the streak and the weekly report, so the
// expensive failure here is not losing a session — it is inventing one.
import { parseLiveSession, mayRestore, restoredElapsedSec, RESTORE_WINDOW_MS } from './liveSession';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => NOW - ms;

/* ── 1. the ordinary case: locked the phone, came back ────────────────────── */

{
  const s = parseLiveSession(JSON.stringify({ kind: 'timed', activity: 'Cycling', sessionKind: 'cardio', startedAt: ago(12 * 60_000) }));
  ok(s != null, 'a timed session round-trips');
  eq(s!.activity, 'Cycling', 'with the activity it was');
  eq(s!.sessionKind, 'cardio', 'and its kind');
  ok(mayRestore(s, NOW), 'twelve minutes ago is restorable');
  eq(restoredElapsedSec(s!, NOW), 12 * 60, 'and resumes at the elapsed it had reached');
}

// The guided runner needs no activity.
{
  const s = parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: ago(60_000) }));
  ok(s != null && s.kind === 'guided', 'the guided runner restores without an activity');
  ok(mayRestore(s, NOW), 'and is restorable');
}

/* ── 2. a pause the session had already banked is not re-counted ──────────── */

{
  const s = parseLiveSession(JSON.stringify({ kind: 'timed', activity: 'Row', startedAt: ago(30 * 60_000), pausedMs: 10 * 60_000 }));
  eq(restoredElapsedSec(s!, NOW), 20 * 60, 'thirty minutes on the wall, ten of them paused, is twenty of training');
}

/* ── 3. THE REFUSAL: an abandoned session must not resurrect ──────────────── */

{
  const s = parseLiveSession(JSON.stringify({ kind: 'timed', activity: 'Cycling', startedAt: ago(9 * 60 * 60_000) }));
  ok(s != null, 'it parses — the record is well formed');
  ok(!mayRestore(s, NOW), 'and is REFUSED, because a nine-hour workout is not what happened');
}
ok(!mayRestore(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: ago(RESTORE_WINDOW_MS + 1000) })), NOW),
  'just past the window is refused');
ok(mayRestore(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: ago(RESTORE_WINDOW_MS - 1000) })), NOW),
  'and just inside it is not');

// The window is deliberately longer than a plausible workout: the four-hour
// hike is the case this feature is most valuable for.
ok(RESTORE_WINDOW_MS > 4 * 60 * 60_000, 'a long ride is still restorable');

/* ── 4. a clock that moved backwards is not a session from the future ─────── */

ok(!mayRestore(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: NOW + 60_000 })), NOW),
  'a start stamped ahead of now is refused rather than producing a negative elapsed');

/* ── 5. half a record is nothing ──────────────────────────────────────────── */

eq(parseLiveSession(null), null, 'nothing stored is nothing');
eq(parseLiveSession(''), null, 'and so is empty');
eq(parseLiveSession('{oh no'), null, 'malformed JSON is nothing, not a throw');
eq(parseLiveSession(JSON.stringify({ kind: 'timed', startedAt: NOW })), null,
  'a timed session with no activity cannot be re-opened, so it is not a record');
eq(parseLiveSession(JSON.stringify({ kind: 'nonsense', startedAt: NOW })), null, 'an unknown runner is nothing');
eq(parseLiveSession(JSON.stringify({ kind: 'guided' })), null, 'and no start time is nothing');
eq(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: 'soon' })), null, 'nor a start that is not a number');
eq(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: 0 })), null, 'nor zero');

// A negative pause would lengthen the session.
eq(parseLiveSession(JSON.stringify({ kind: 'guided', startedAt: ago(60_000), pausedMs: -5000 }))!.pausedMs, 0,
  'a negative pause is dropped rather than adding time');

if (errors.length) {
  console.error('liveSession.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('liveSession.test.ts — ok');
