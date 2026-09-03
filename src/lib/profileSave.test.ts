// The answer to "how do I know it saved?" — asserted, because the whole defect
// was a screen that could not tell a stored profile from a refused one.
import {
  IDLE_SAVE, saveLine, hasUnsavedWork, leaveWarning, afterWrite, markPending,
  profileWriteFailure,
  type SaveStatus,
} from './profileSave';

const errors: string[] = [];
const ok = (c: boolean, msg: string) => { if (!c) errors.push(msg); };
const eq = <T,>(a: T, b: T, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const T0 = 1_700_000_000_000;

/* ── nothing is claimed before anything happens ─────────────────────────── */

eq(saveLine(IDLE_SAVE, T0), null, 'an untouched screen says nothing');
eq(hasUnsavedWork(IDLE_SAVE), false, 'and has nothing outstanding');
eq(leaveWarning(IDLE_SAVE), null, 'and does not warn on the way out');

/* ── the write that failed must SAY so ──────────────────────────────────── */

{
  const failed = afterWrite(markPending(IDLE_SAVE), false, T0, 'permission denied');
  const line = saveLine(failed, T0)!;
  ok(line.includes('NOT saved'), 'a refused write says the change was not saved');
  ok(line.includes('permission denied'), 'and passes on the server’s own words');
  // The distinction that matters: the coach can SEE their text on screen, so
  // the sentence has to separate what is on the handset from what is on the
  // server. This is the whole failure — the old code said neither.
  ok(line.includes('still on this screen but not on your profile'),
    'and separates what is on the phone from what reached the server');
  eq(hasUnsavedWork(failed), true, 'a failed write is unsaved work');
  ok(leaveWarning(failed)!.includes('will be lost'), 'and leaving is warned about');
}

// A failure with no message reads as a failure, not as a failure with the word
// "undefined" in it.
{
  const line = saveLine(afterWrite(IDLE_SAVE, false, T0, null), T0)!;
  ok(line.includes('NOT saved'), 'a message-less failure still says not saved');
  ok(!line.includes('undefined') && !line.includes('()'),
    'and carries no empty bracket where the reason would go');
}
eq(afterWrite(IDLE_SAVE, false, T0, '   ').error, null, 'a blank server message is no message');

/* ── a failure does not erase a success that really happened ────────────── */

{
  const saved = afterWrite(IDLE_SAVE, true, T0);
  const thenFailed = afterWrite(saved, false, T0 + 60_000, 'network');
  eq(thenFailed.savedAt, T0,
    'the earlier successful write is remembered through a later failure — it did happen');
  eq(thenFailed.state, 'failed', 'while the state still reports the failure');
  eq(markPending(thenFailed).savedAt, T0, 'and a new edit does not forget it either');
}

/* ── pending is a state a person can see ────────────────────────────────── */

{
  const p = markPending(IDLE_SAVE);
  eq(p.state, 'pending', 'an edit marks a write as coming');
  eq(saveLine(p, T0), 'Saving your changes…', 'and says so');
  eq(hasUnsavedWork(p), true, 'a pending write is unsaved work');
  // This is the one that would have caught the cancelled-on-unmount bug: a
  // coach who leaves inside the debounce has work in flight, and is told.
  ok(leaveWarning(p)!.includes('still being saved'), 'and leaving mid-write is warned about');
  eq(p.error, null, 'a new attempt clears the previous error');
}

/* ── how the confirmation ages ──────────────────────────────────────────── */

{
  const s = afterWrite(IDLE_SAVE, true, T0);
  eq(saveLine(s, T0), 'Saved.', 'straight after the write');
  eq(saveLine(s, T0 + 30_000), 'Saved a moment ago.', 'half a minute later');
  eq(saveLine(s, T0 + 60_000), 'Saved 1 minute ago.', 'one minute, singular');
  eq(saveLine(s, T0 + 120_000), 'Saved 2 minutes ago.', 'two minutes, plural');
  eq(saveLine(s, T0 + 3_600_000), 'Saved 1 hour ago.', 'one hour, singular');
  eq(saveLine(s, T0 + 7_200_000), 'Saved 2 hours ago.', 'two hours, plural');
  eq(hasUnsavedWork(s), false, 'a saved profile has nothing outstanding');
  eq(leaveWarning(s), null, 'and leaving is not warned about');

  // A clock that has gone backwards must not print a negative age.
  eq(saveLine(s, T0 - 5_000), 'Saved.', 'a clock that moved backwards still reads sensibly');
}

/* ── no arm can reach a screen as "undefined" ───────────────────────────── */

for (const st of ['idle', 'pending', 'saved', 'failed'] as SaveStatus['state'][]) {
  const s: SaveStatus = { state: st, savedAt: T0, error: st === 'failed' ? 'x' : null };
  const line = saveLine(s, T0 + 1000);
  ok(line === null || (line.length > 0 && !line.includes('undefined') && !line.includes('null')),
    `${st} produces either nothing or a real sentence`);
}

/* ── the row count, not the absence of an error ─────────────────────────── */
//
// The defect: both statements come back `error: null` having matched NO ROWS,
// which is what a coach with no `trainers` row and a coach an RLS policy
// refuses both actually get, and the screen printed "Saved." over it.

const OK = { error: null, count: 1 };

eq(profileWriteFailure(OK, OK), null, 'two writes that each changed a row are a save');

{
  const why = profileWriteFailure(OK, { error: null, count: 0 });
  ok(why !== null, 'a trainers update that matched no rows is NOT a save');
  ok(!!why && why.includes('bio, rate and listing'), 'and it names which half did not land');
  ok(!!why && !why.includes('name and photo'), 'without blaming the half that did');
}

{
  const why = profileWriteFailure({ error: null, count: 0 }, OK);
  ok(!!why && why.includes('name and photo'), 'a profiles update that matched no rows names that half');
}

{
  const why = profileWriteFailure({ error: null, count: 0 }, { error: null, count: 0 });
  ok(!!why && why.includes('name and photo') && why.includes('bio, rate and listing'),
    'both halves are named when both matched nothing');
}

{
  // The trap this closes for the NEXT call site: no `{ count: 'exact' }` means
  // nobody counted, which is not evidence that anything was written.
  const why = profileWriteFailure(OK, { error: null });
  ok(why !== null, 'a missing count is not a pass');
  ok(!!why && why.includes('did not say'), 'and it says the server never answered the question');
}

{
  const why = profileWriteFailure({ error: { message: 'refused' }, count: null }, OK);
  ok(why !== null, 'an error is still a failure');
}

// Whatever it says, it has to survive being read by a person.
for (const [a, b] of [[OK, { error: null, count: 0 }], [{ error: null }, OK], [{ error: null, count: 0 }, { error: null, count: 0 }]] as const) {
  const why = profileWriteFailure(a, b);
  ok(!!why && !why.includes('undefined') && !why.includes('null'), 'no failure sentence leaks a field name');
}

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`profileSave: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('profileSave: ok — a refused write is never shown as a saved one, and a real save survives a later failure');
