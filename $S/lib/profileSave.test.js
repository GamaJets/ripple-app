"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The answer to "how do I know it saved?" — asserted, because the whole defect
// was a screen that could not tell a stored profile from a refused one.
const profileSave_1 = require("./profileSave");
const errors = [];
const ok = (c, msg) => { if (!c)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const T0 = 1700000000000;
/* ── nothing is claimed before anything happens ─────────────────────────── */
eq((0, profileSave_1.saveLine)(profileSave_1.IDLE_SAVE, T0), null, 'an untouched screen says nothing');
eq((0, profileSave_1.hasUnsavedWork)(profileSave_1.IDLE_SAVE), false, 'and has nothing outstanding');
eq((0, profileSave_1.leaveWarning)(profileSave_1.IDLE_SAVE), null, 'and does not warn on the way out');
/* ── the write that failed must SAY so ──────────────────────────────────── */
{
    const failed = (0, profileSave_1.afterWrite)((0, profileSave_1.markPending)(profileSave_1.IDLE_SAVE), false, T0, 'permission denied');
    const line = (0, profileSave_1.saveLine)(failed, T0);
    ok(line.includes('NOT saved'), 'a refused write says the change was not saved');
    ok(line.includes('permission denied'), 'and passes on the server’s own words');
    // The distinction that matters: the coach can SEE their text on screen, so
    // the sentence has to separate what is on the handset from what is on the
    // server. This is the whole failure — the old code said neither.
    ok(line.includes('still on this screen but not on your profile'), 'and separates what is on the phone from what reached the server');
    eq((0, profileSave_1.hasUnsavedWork)(failed), true, 'a failed write is unsaved work');
    ok((0, profileSave_1.leaveWarning)(failed).includes('will be lost'), 'and leaving is warned about');
}
// A failure with no message reads as a failure, not as a failure with the word
// "undefined" in it.
{
    const line = (0, profileSave_1.saveLine)((0, profileSave_1.afterWrite)(profileSave_1.IDLE_SAVE, false, T0, null), T0);
    ok(line.includes('NOT saved'), 'a message-less failure still says not saved');
    ok(!line.includes('undefined') && !line.includes('()'), 'and carries no empty bracket where the reason would go');
}
eq((0, profileSave_1.afterWrite)(profileSave_1.IDLE_SAVE, false, T0, '   ').error, null, 'a blank server message is no message');
/* ── a failure does not erase a success that really happened ────────────── */
{
    const saved = (0, profileSave_1.afterWrite)(profileSave_1.IDLE_SAVE, true, T0);
    const thenFailed = (0, profileSave_1.afterWrite)(saved, false, T0 + 60000, 'network');
    eq(thenFailed.savedAt, T0, 'the earlier successful write is remembered through a later failure — it did happen');
    eq(thenFailed.state, 'failed', 'while the state still reports the failure');
    eq((0, profileSave_1.markPending)(thenFailed).savedAt, T0, 'and a new edit does not forget it either');
}
/* ── pending is a state a person can see ────────────────────────────────── */
{
    const p = (0, profileSave_1.markPending)(profileSave_1.IDLE_SAVE);
    eq(p.state, 'pending', 'an edit marks a write as coming');
    eq((0, profileSave_1.saveLine)(p, T0), 'Saving your changes…', 'and says so');
    eq((0, profileSave_1.hasUnsavedWork)(p), true, 'a pending write is unsaved work');
    // This is the one that would have caught the cancelled-on-unmount bug: a
    // coach who leaves inside the debounce has work in flight, and is told.
    ok((0, profileSave_1.leaveWarning)(p).includes('still being saved'), 'and leaving mid-write is warned about');
    eq(p.error, null, 'a new attempt clears the previous error');
}
/* ── how the confirmation ages ──────────────────────────────────────────── */
{
    const s = (0, profileSave_1.afterWrite)(profileSave_1.IDLE_SAVE, true, T0);
    eq((0, profileSave_1.saveLine)(s, T0), 'Saved.', 'straight after the write');
    eq((0, profileSave_1.saveLine)(s, T0 + 30000), 'Saved a moment ago.', 'half a minute later');
    eq((0, profileSave_1.saveLine)(s, T0 + 60000), 'Saved 1 minute ago.', 'one minute, singular');
    eq((0, profileSave_1.saveLine)(s, T0 + 120000), 'Saved 2 minutes ago.', 'two minutes, plural');
    eq((0, profileSave_1.saveLine)(s, T0 + 3600000), 'Saved 1 hour ago.', 'one hour, singular');
    eq((0, profileSave_1.saveLine)(s, T0 + 7200000), 'Saved 2 hours ago.', 'two hours, plural');
    eq((0, profileSave_1.hasUnsavedWork)(s), false, 'a saved profile has nothing outstanding');
    eq((0, profileSave_1.leaveWarning)(s), null, 'and leaving is not warned about');
    // A clock that has gone backwards must not print a negative age.
    eq((0, profileSave_1.saveLine)(s, T0 - 5000), 'Saved.', 'a clock that moved backwards still reads sensibly');
}
/* ── no arm can reach a screen as "undefined" ───────────────────────────── */
for (const st of ['idle', 'pending', 'saved', 'failed']) {
    const s = { state: st, savedAt: T0, error: st === 'failed' ? 'x' : null };
    const line = (0, profileSave_1.saveLine)(s, T0 + 1000);
    ok(line === null || (line.length > 0 && !line.includes('undefined') && !line.includes('null')), `${st} produces either nothing or a real sentence`);
}
/* ── the row count, not the absence of an error ─────────────────────────── */
//
// The defect: both statements come back `error: null` having matched NO ROWS,
// which is what a coach with no `trainers` row and a coach an RLS policy
// refuses both actually get, and the screen printed "Saved." over it.
const OK = { error: null, count: 1 };
eq((0, profileSave_1.profileWriteFailure)(OK, OK), null, 'two writes that each changed a row are a save');
{
    const why = (0, profileSave_1.profileWriteFailure)(OK, { error: null, count: 0 });
    ok(why !== null, 'a trainers update that matched no rows is NOT a save');
    ok(!!why && why.includes('bio, rate and listing'), 'and it names which half did not land');
    ok(!!why && !why.includes('name and photo'), 'without blaming the half that did');
}
{
    const why = (0, profileSave_1.profileWriteFailure)({ error: null, count: 0 }, OK);
    ok(!!why && why.includes('name and photo'), 'a profiles update that matched no rows names that half');
}
{
    const why = (0, profileSave_1.profileWriteFailure)({ error: null, count: 0 }, { error: null, count: 0 });
    ok(!!why && why.includes('name and photo') && why.includes('bio, rate and listing'), 'both halves are named when both matched nothing');
}
{
    // The trap this closes for the NEXT call site: no `{ count: 'exact' }` means
    // nobody counted, which is not evidence that anything was written.
    const why = (0, profileSave_1.profileWriteFailure)(OK, { error: null });
    ok(why !== null, 'a missing count is not a pass');
    ok(!!why && why.includes('did not say'), 'and it says the server never answered the question');
}
{
    const why = (0, profileSave_1.profileWriteFailure)({ error: { message: 'refused' }, count: null }, OK);
    ok(why !== null, 'an error is still a failure');
}
// Whatever it says, it has to survive being read by a person.
for (const [a, b] of [[OK, { error: null, count: 0 }], [{ error: null }, OK], [{ error: null, count: 0 }, { error: null, count: 0 }]]) {
    const why = (0, profileSave_1.profileWriteFailure)(a, b);
    ok(!!why && !why.includes('undefined') && !why.includes('null'), 'no failure sentence leaks a field name');
}
/* ── the launch that wrote the whole profile back ─────────────────────────── */
//
// Seen on an iPhone: relaunch the coach app, type nothing, and the badge
// already reads "Saved." The debounced write effect in src/ui/coachProfile.tsx
// fires on any dependency change, and `synced` is a dependency, so the values
// that had just been READ from the server were written straight back to it —
// over both tables, including session_fee, listed and avatar. A write of
// handset state over server state is the direction that loses work.
const SERVER = {
    name: 'Dana Reyes', photo: 'https://cdn/x.jpg', tagline: 'Strength, patiently',
    bio: 'Fifteen years.', offers: ['1:1', 'Online'], specialties: ['Powerlifting', 'Rehab'],
    sessionFee: 4500, listed: true,
};
{
    const base = (0, profileSave_1.profileFingerprint)(SERVER);
    eq((0, profileSave_1.isProfileEdit)(base, { ...SERVER }), false, 'the values that came from the server are not an edit, which is the whole of the launch defect');
    eq((0, profileSave_1.isProfileEdit)(base, { ...SERVER, offers: ['1:1', 'Online'] }), false, 'and neither is a fresh array holding the same strings — a re-render allocates new ones every time');
    eq((0, profileSave_1.isProfileEdit)(null, { ...SERVER }), false, 'and before a baseline has been taken nothing is an edit, because nothing is known to compare against');
}
{
    const base = (0, profileSave_1.profileFingerprint)(SERVER);
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, bio: 'Sixteen years.' }), 'a changed bio is an edit');
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, sessionFee: 5000 }), 'and so is a changed rate');
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, sessionFee: null }), 'and so is a rate that was cleared');
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, listed: false }), 'and so is coming off the directory');
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, specialties: ['Rehab', 'Powerlifting'] }), 'and so is reordering the specialities, because the order is the order the coach chose to list them in');
    ok((0, profileSave_1.isProfileEdit)(base, { ...SERVER, offers: ['1:1'] }), 'and so is dropping one');
}
// An absent text field and an empty one are the same statement — the coach has
// not written one — so a launch must not turn the first into the second.
{
    const blank = (0, profileSave_1.profileFingerprint)({ ...SERVER, tagline: null });
    eq(blank, (0, profileSave_1.profileFingerprint)({ ...SERVER, tagline: '' }), 'no tagline and an empty tagline fingerprint alike');
    eq(blank, (0, profileSave_1.profileFingerprint)({ ...SERVER, tagline: '   ' }), 'and so does one that is only spaces');
    eq((0, profileSave_1.isProfileEdit)(blank, { ...SERVER, tagline: undefined }), false, 'so an absent one arriving as undefined is not an edit either');
}
// A rate, unlike a tagline, is a number where nothing and nought are already
// one thing by the time they reach here — coachProfile maps a stored 0 to null
// on read, because three production rows hold a 0 nobody typed.
eq((0, profileSave_1.profileFingerprint)({ ...SERVER, sessionFee: null }), (0, profileSave_1.profileFingerprint)({ ...SERVER, sessionFee: undefined }), 'an unset rate is an unset rate however it arrives');
ok((0, profileSave_1.profileFingerprint)({ ...SERVER, sessionFee: 0 }) !== (0, profileSave_1.profileFingerprint)({ ...SERVER, sessionFee: null }), 'but a literal 0 that did reach here is still its own value, and this file does not decide what it means');
// The fingerprint has to be a string a ref can hold and compare with ===.
eq(typeof (0, profileSave_1.profileFingerprint)(SERVER), 'string', 'the fingerprint is a string');
eq((0, profileSave_1.profileFingerprint)(SERVER), (0, profileSave_1.profileFingerprint)({ ...SERVER }), 'and is stable for equal values');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`profileSave: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('profileSave: ok — a refused write is never shown as a saved one, and a real save survives a later failure');
