// finish_coach_session, the phone's half. Compile with tsc, run with node.
import { finishAnswer, finishPrCount, packLeftLine, readFinishRow } from './coachSessionFinish';
import { mintWorkoutUid, readFloorQueue, supersedeKey, actLine, type FloorAct } from './floorQueue';
import { attributionLine } from './workoutAttribution';
import type { WorkoutEntry } from './mockData';

process.exitCode = 1;
const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── the answer ────────────────────────────────────────────────────────────
eq(finishAnswer([{ outcome: 'finished', rows_written: 5, sessions_left: 4, pack_total: 10 }]), 'stored', 'finished is stored');
eq(finishAnswer([{ outcome: 'already', rows_written: 5, sessions_left: 4, pack_total: 10 }]), 'stored', 'a replay is stored, not refused');
eq(finishAnswer([]), 'unsent', 'an empty answer is not success');
eq(finishAnswer(null), 'unsent', 'a null answer is not success');
eq(finishAnswer([{ outcome: 'ok', rows_written: 5 }]), 'unsent', 'an unknown outcome is not success');
eq(finishAnswer([{ outcome: 'finished', rows_written: 0 }]), 'unsent', 'zero rows is not success');
eq(readFinishRow({ outcome: 'finished', rows_written: 2, sessions_left: null, pack_total: null }),
  { outcome: 'finished', rowsWritten: 2, sessionsLeft: null, packTotal: null }, 'a bare object is read too');
eq(packLeftLine({ sessionsLeft: 4, packTotal: 10 }), '1 PT session used · 4 of 10 left', 'pack line');
eq(packLeftLine({ sessionsLeft: null, packTotal: null }), null, 'no pack, no line');

// ── PRs, only against a whole history ─────────────────────────────────────
const e = (exercise: string, kg: number, reps: number, t = '2026-10-15T10:00:00.000Z'): WorkoutEntry => ({ t, exercise, sets: [[reps, kg]] } as WorkoutEntry);
const hist = [e('Romanian Deadlift', 60, 8, '2026-10-01T10:00:00.000Z'), e('Barbell Hip Thrust', 110, 8, '2026-10-01T10:00:00.000Z')];
eq(finishPrCount([e('Romanian Deadlift', 65, 8), e('Barbell Hip Thrust', 120, 8), e('Leg Press', 0, 10)], hist, true), 2, 'two heavier lifts are two PRs');
eq(finishPrCount([e('Romanian Deadlift', 55, 8)], hist, true), 0, 'a lighter set is not a PR');
eq(finishPrCount([e('Romanian Deadlift', 65, 8)], hist, false), null, 'a partial history says nothing');
eq(finishPrCount([e('Romanian Deadlift', 65, 8)], null, true), null, 'no history says nothing');

// ── what the member sees ──────────────────────────────────────────────────
eq(attributionLine({ loggedBy: 'c', sessionId: 's1' }, 'Dave Okafor', true), 'Logged with Coach Dave', 'a session run together');
eq(attributionLine({ loggedBy: 'c', sessionId: 's1' }, null, true), 'Logged with your coach', 'unnamed coach');
eq(attributionLine({ loggedBy: 'c' }, 'Dave Okafor', true), 'Logged by Dave Okafor', 'no booking stays "by"');
eq(attributionLine({ loggedBy: 'c', sessionId: 's1' }, 'Dave Okafor', false), 'Logged by you', 'the coach side is unchanged');

// ── the queue act ─────────────────────────────────────────────────────────
const uid = mintWorkoutUid();
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid) || /^[0-9a-f-]{36}$/i.test(uid), `minted uid is uuid-shaped: ${uid}`);
let i = 0; const seq = () => ((i++ * 7) % 16) / 16;
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mintWorkoutUid(seq)), 'fallback mint is a v4-shaped uuid');
ok(mintWorkoutUid() !== mintWorkoutUid(), 'two mints differ');

const act: FloorAct = { kind: 'coach-session-finish', clientId: 'c1', clientName: 'Priya', sessionId: 's1', workoutUid: uid, entries: [e('Romanian Deadlift', 65, 8)], prCount: 1 };
eq(supersedeKey(act), `finish:${uid}`, 'the workout id is the identity');
eq(actLine(act), 'Priya’s session: 1 exercise, to be marked completed', 'pending line');
const stored = JSON.stringify([{ id: 'q1', at: '2026-10-15T10:00:00.000Z', act }]);
eq(readFloorQueue(stored).acts.length, 1, 'a finish act survives a round trip through storage');
const bad = JSON.stringify([{ id: 'q1', at: '2026-10-15T10:00:00.000Z', act: { ...act, workoutUid: 'not-a-uuid' } }]);
eq(readFloorQueue(bad).acts.length, 0, 'an act with an unusable workout id is dropped, not retried forever');
const noSess = JSON.stringify([{ id: 'q1', at: '2026-10-15T10:00:00.000Z', act: { ...act, sessionId: '' } }]);
eq(readFloorQueue(noSess).acts.length, 0, 'a finish needs a session');

if (errors.length) { console.error(`coachSessionFinish: ${errors.length} failed\n  ` + errors.join('\n  ')); }
else { console.log('coachSessionFinish: all passed'); process.exitCode = 0; }
