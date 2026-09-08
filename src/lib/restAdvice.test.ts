// Rest-day advice, once the recovery data is in it.
//
// Compile with tsc, then run under plain node.
//
// The defect: app/(client)/restday.tsx answered "should I train today" from a
// count of sessions, on an app that computes a readiness figure from sleep, the
// device's own recovery verdict, hydration and load — and never called it. So
// the assertions here are about the four ways that figure can be missing, the
// one direction its absence can be wrong in, and the words this screen is not
// allowed to say about a body.
import {
  REST_ON_READINESS_BELOW,
  restReadinessRead, restAdvice,
  type RestReadinessInput, type RestReadinessRead,
} from './restAdvice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A read with a healthy score, over the full window, from a connected watch. */
const base: RestReadinessInput = {
  score: 82,
  nights: 3,
  windowNights: 3,
  status: 'ready',
  absence: null,
  madeOf: 'Scored from your sleep, your device’s recovery score and recent sessions',
  deviceConnected: true,
  logStatus: 'ready',
};

const readOf = (over: Partial<RestReadinessInput>) => restReadinessRead({ ...base, ...over });

/* ── 1. the four silences are four different answers ──────────────────────── */

const nothingConnected = readOf({
  score: null, nights: 0, deviceConnected: false,
  absence: 'Log a night of sleep, or connect a watch, to see your readiness.',
});
eq(nothingConnected.state, 'none', 'no watch and no logged night is its own state');
eq(nothingConnected.mayBeMissing, false,
  'nothing is missing for a member who owns no device — warning them invents a fault');

const failed = readOf({
  score: null, nights: 0, status: 'error',
  absence: 'We could not read your devices just now, so there is no readiness to show — it does not mean you slept badly.',
});
eq(failed.state, 'unread', 'a read that failed is not an absence of sleep');
eq(failed.mayBeMissing, true, 'and it may be hiding the figure that argued for rest');

const awaiting = readOf({
  score: null, nights: 0, deviceConnected: true,
  absence: 'No sleep on record for the last 3 nights yet.',
});
eq(awaiting.state, 'awaiting', 'a connected device that has recorded nothing yet is neither of the above');
eq(awaiting.mayBeMissing, false, 'nothing failed, so nothing is warned about');

eq(readOf({}).state, 'scored', 'and a real figure is the fourth');

// The whole point of keeping them apart: three different sentences.
const notes = new Set([nothingConnected.note, failed.note, awaiting.note]);
eq(notes.size, 3, '"we could not read your sleep" is not "you slept well" and is not "no watch is connected"');

/* ── 2. still reading is not an answer, and neither is not knowing ────────── */

eq(readOf({ score: null, nights: 0, status: 'loading' }).state, 'reading',
  'a source still in flight is not a verdict');
eq(readOf({ score: null, nights: 0, status: 'ready', deviceConnected: null }).state, 'reading',
  'and an unlooked-at device list cannot be reported as "no watch is connected" — the empty states map is not that claim');
eq(readOf({ score: null, nights: 0, status: 'loading' }).mayBeMissing, false,
  'nor is a read in flight a short read');

/* ── 3. a score over one night and a score over three do not look alike ──── */

const oneNight = readOf({ nights: 1 });
const full = readOf({ nights: 3 });
ok(oneNight.note.includes('over 1 of the last 3 nights'),
  `a one-night average says so — got ${JSON.stringify(oneNight.note)}`);
ok(full.note.includes('over the last 3 nights'),
  `a full window says that instead — got ${JSON.stringify(full.note)}`);
ok(oneNight.note !== full.note,
  'the two claims are different and must not render identically, which the number alone cannot say');
ok(full.note.includes('device’s recovery score'),
  'and the signals behind it travel with it, exactly as readinessMadeOf renders them');

/* ── 4. a score standing over a short read is still short ─────────────────── */

eq(readOf({ status: 'partial' }).mayBeMissing, true,
  'a WHOOP that could not be read has not removed the nights that were recorded, but it has made the set incomplete');
eq(readOf({ status: 'ready' }).mayBeMissing, false, 'and a whole read carries no caveat');

/* ── 5. a truncated training log names its own problem ────────────────────── */

const truncated = readOf({ score: null, nights: 0, logStatus: 'partial' });
eq(truncated.state, 'unread', 'a part-read log withholds the figure');
ok(!truncated.note.includes('could not be read'),
  `and does not call itself a failed read — got ${JSON.stringify(truncated.note)}`);

/* ── 6. the advice itself: low readiness reaches rest on its own ──────────── */

const scored = (score: number | null, over: Partial<RestReadinessRead> = {}): RestReadinessRead => ({
  state: score == null ? 'unread' : 'scored',
  score,
  note: 'note',
  mayBeMissing: score == null,
  ...over,
});

// Two sessions in seven days. The log alone said "room to train" and that is
// the sentence a member three nights into four hours' sleep was reading.
const lightWeek = { logStatus: 'ready' as const, deloadDue: false, deloadReason: '', weekDays: 2, trainedToday: false };

eq(restAdvice({ ...lightWeek, readiness: scored(82) }).call, 'room',
  'a light week with a good figure is room to train');
eq(restAdvice({ ...lightWeek, readiness: scored(38) }).call, 'rest',
  'and a light week with a low figure is a rest day — the change this file exists for');
eq(restAdvice({ ...lightWeek, readiness: scored(38) }).because, 'signals',
  'said to be the signals asking, not the log, because the log is not asking');
eq(restAdvice({ ...lightWeek, readiness: scored(REST_ON_READINESS_BELOW) }).call, 'room',
  'the boundary is exclusive and is the same 50 readinessScore divides its own bands at');
eq(restAdvice({ ...lightWeek, readiness: scored(REST_ON_READINESS_BELOW - 1) }).call, 'rest',
  'one below it is the low band');

/* ── 7. and it never works the other way ──────────────────────────────────── */

const heavyWeek = { logStatus: 'ready' as const, deloadDue: false, deloadReason: '', weekDays: 5, trainedToday: true };
eq(restAdvice({ ...heavyWeek, readiness: scored(96) }).call, 'rest',
  'a high figure does not overrule five days trained — a number that can talk somebody out of a rest day is one this app has not earned');
eq(restAdvice({ ...heavyWeek, readiness: scored(96) }).because, 'load', 'and the load is what is asking');
eq(restAdvice({ ...heavyWeek, readiness: scored(30) }).because, 'both', 'when both agree, both are named');

const roomBody = restAdvice({ ...lightWeek, readiness: scored(96) }).body;
ok(!/recovered|\bready\b|\bfresh\b/i.test(roomBody),
  `the best thing this screen may say about a body is what was measured — got ${JSON.stringify(roomBody)}`);
ok(!/push|PR\b|go harder/i.test(roomBody),
  'readinessScore\'s own tip in this band is "Great day to push"; the screen whose job is to say stop does not print it');
ok(roomBody.includes('96 out of 100'), 'it prints the figure, which is a thing a member can check');

/* ── 8. an unread figure argues for rest, never against it ────────────────── */

const unreadBody = restAdvice({ ...lightWeek, readiness: scored(null) }).body;
ok(unreadBody.includes('more rest, not less'),
  `every readiness signal can only count against the member, so one we could not see can only have flattered them — got ${JSON.stringify(unreadBody)}`);
eq(restAdvice({ ...lightWeek, readiness: scored(null) }).call, 'room',
  'which is a caveat on the call and not a rest day invented out of a failed read');

const noneBody = restAdvice({
  ...lightWeek,
  readiness: { state: 'none', score: null, note: 'n', mayBeMissing: false },
}).body;
ok(!noneBody.includes('could not'),
  `a member with no watch is not told a read failed — got ${JSON.stringify(noneBody)}`);

/* ── 9. an unread log still refuses to judge, readiness or no readiness ──── */

for (const s of ['loading', 'partial', 'error'] as const) {
  const a = restAdvice({ ...lightWeek, logStatus: s, readiness: scored(96) });
  eq(a.call, 'unknown', `a ${s} training log is not a judgement about recovery`);
  ok(a.body.includes('a judgement about your recovery') || a.body.includes('rather than the wrong thing'),
    `and says so out loud under ${s}`);
  ok(!a.body.includes('96'), `a readiness figure does not sneak a verdict past an unread log under ${s}`);
}
const three = new Set((['loading', 'partial', 'error'] as const)
  .map((s) => restAdvice({ ...lightWeek, logStatus: s, readiness: scored(96) }).headline));
eq(three.size, 3, 'and the three reasons the log is unknown are three headlines, not one');

/* ── 10. a deload is not argued with by the number ────────────────────────── */

const dl = { logStatus: 'ready' as const, deloadDue: true, deloadReason: '6 straight weeks of solid training.', weekDays: 4, trainedToday: true };
eq(restAdvice({ ...dl, readiness: scored(91) }).call, 'deload', 'a due deload outranks everything');
eq(restAdvice({ ...dl, readiness: scored(91) }).body, dl.deloadReason,
  'and a high figure is NOT printed under it — a screen holding both sides of its own case is worse than one holding neither');
ok(restAdvice({ ...dl, readiness: scored(22) }).body.includes('22 out of 100'),
  'a low one is, because it agrees');

if (errors.length) {
  console.error(`restAdvice.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('restAdvice.test.ts — ok');
