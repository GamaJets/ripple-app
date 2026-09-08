// Tests for the readiness breakdown — the account the member reads underneath
// the biggest number on the home screen.
//
// readiness.test.ts covers the arithmetic refusing to invent. This file covers
// the layer above it, whose whole subject is a read that half-succeeded. The
// score has no way of knowing about one: `readSleepFromDevices` catches per
// provider, so a WHOOP with a dead token comes back as one 'error' row inside a
// walk that reports 'ready', and `readinessScore` is handed a shorter window
// with nothing attached to say why it is short. It computes a well-formed
// number over one good night and the home screen prints it bare.
//
// So the assertions below are mostly of the shape "a source that did not answer
// is named, and the score that survived it is called partial rather than
// ready". The two that matter most:
//
//   · A failed provider must not be able to reach 'ready'. Every signal in
//     readiness counts AGAINST the member, so a night that could not be read
//     can only have flattered the score, and 'ready' would be the app vouching
//     for a figure over a set it knows is short.
//   · An unread typed log must not produce "log a night of sleep". That is a
//     statement about what the member has done, assembled out of a read that
//     failed — the same class of claim as the unread workout log that used to
//     score as maximally rested.
//
// Compile with tsc then run with node, like readiness.test.ts.
import {
  deviceSleepTrust, readinessBreakdown,
  type ReadinessBreakdownInput, type ReadinessSource,
} from './readinessBreakdown';
import type { Readiness, ReadinessSleep } from './readiness';
import { readinessScore } from './readiness';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const night = (n: number, from: 'device' | 'typed', hours: number) =>
  ({ night: `2026-08-${String(30 - n).padStart(2, '0')}`, hours, from });

/** A sleep window of `d` device nights and `t` typed ones, all of 7.5 hours. */
const sleepOf = (d: number, t: number): ReadinessSleep => {
  const nights = [
    ...Array.from({ length: d }, (_, k) => night(k, 'device', 7.5)),
    ...Array.from({ length: t }, (_, k) => night(d + k, 'typed', 7.5)),
  ];
  return {
    avgHours: nights.length ? 7.5 : null,
    nights,
    fromDevice: d,
    fromTyped: t,
  };
};

const scored = readinessScore({ avgSleepHours: 7.5, hydrationPct: 0.5, recoveryPct: null, workoutsLast2Days: 1 }) as Readiness;

/** A member with a ring, a water goal, a readable log and nothing wrong. */
const whole: ReadinessBreakdownInput = {
  readiness: scored,
  sleep: sleepOf(3, 0),
  windowNights: 3,
  deviceStatus: 'ready',
  sources: [{ name: 'Oura Ring', status: 'ready', nights: 3 }],
  typedStatus: 'ready',
  hydrationGoal: true,
  hydrationStatus: 'ready',
  hydrationPct: 0.5,
  workoutsLast2Days: 1,
};
const br = (over: Partial<ReadinessBreakdownInput> = {}) => readinessBreakdown({ ...whole, ...over });
const lineFor = (b: ReturnType<typeof br>, key: string) => b.lines.find((l) => l.key === key)!;

// ── deviceSleepTrust: the per-provider outcome folded back into one word ───
//
// This is the fact `deviceSleep.status` cannot carry. It reports the WALK, so a
// provider that failed inside a completed walk is invisible to it.
{
  const good: ReadinessSource = { name: 'Oura Ring', status: 'ready', nights: 3 };
  const bad: ReadinessSource = { name: 'WHOOP', status: 'error', nights: 0 };
  const cannot: ReadinessSource = { name: 'Health Connect', status: 'unsupported', nights: 0 };

  eq(deviceSleepTrust('ready', []), 'ready',
    'no device connected is not a broken device — nothing was asked and nothing is missing');
  eq(deviceSleepTrust('ready', [good]), 'ready', 'one provider that answered is a whole read');
  // THE ASSERTION THIS FILE EXISTS FOR. Delete the partial arm and a dead WHOOP
  // beside a working ring is indistinguishable from two working devices.
  eq(deviceSleepTrust('ready', [good, bad]), 'partial',
    'one of two providers failing is a real but SHORT read — not a ready one');
  eq(deviceSleepTrust('ready', [bad]), 'error',
    'every provider failing means we know nothing about their nights');
  eq(deviceSleepTrust('ready', [bad, bad]), 'error', 'and that holds however many of them there are');
  // 'unsupported' is a settled fact about this build, not a gap in tonight.
  eq(deviceSleepTrust('ready', [cannot]), 'ready',
    'Health Connect not reporting sleep is not a failed read');
  eq(deviceSleepTrust('ready', [good, cannot]), 'ready',
    'and it does not drag a working provider down with it');
  eq(deviceSleepTrust('ready', [bad, cannot]), 'error',
    'nor does it stand in for one — an unsupported provider cannot rescue a failed walk');
  eq(deviceSleepTrust('error', [good]), 'error', 'a walk that never completed is an error whatever the rows say');
  eq(deviceSleepTrust('loading', [bad]), 'loading', 'and a read still in flight has not failed yet');
  eq(deviceSleepTrust('partial', [good]), 'partial', 'a truncated walk stays truncated');
}

// ── a score over a short read is 'partial', and says which device ─────────
{
  const b = br({ sources: [
    { name: 'Oura Ring', status: 'ready', nights: 2 },
    { name: 'WHOOP', status: 'error', nights: 0 },
  ] });
  eq(b.status, 'partial', 'a score standing on a read one device did not answer is partial, never ready');
  eq(b.absence, null, 'the score itself is not withheld — the nights that WERE recorded are still real');
  eq(b.caveats.length, 1, 'one failed device, one sentence');
  eq(b.caveats[0], 'WHOOP could not be read, so a night it measured may be missing from this.',
    'and it names the device, because "a device" sends nobody anywhere');
}
{
  const b = br({ sources: [
    { name: 'Oura Ring', status: 'error', nights: 0 },
    { name: 'WHOOP', status: 'error', nights: 0 },
  ] });
  eq(b.caveats[0], 'Oura Ring and WHOOP could not be read, so a night they measured may be missing from this.',
    'two devices are listed and the verb agrees with them');
}
{
  // The walk failing produces no per-provider rows at all — the exact hole the
  // Recovery screen had to grow its own sentence for, because a caveat built
  // from the error rows has nothing to build from.
  const b = br({ deviceStatus: 'error', sources: [], readiness: scored });
  eq(b.caveats.length, 1, 'a walk that never completed still owes the member a sentence');
  eq(b.caveats[0], 'We could not reach your devices just now, so a night one of them measured may be missing from this.',
    'and it says the read failed rather than naming a device that never answered');
  eq(b.status, 'partial', 'with a score on screen, an unreachable device layer makes it partial');
}

// ── the whole read: nothing unread, nothing to caveat ─────────────────────
{
  const b = br();
  eq(b.status, 'ready', 'everything read, so the score is over the whole picture');
  eq(b.caveats.length, 0, 'and there is nothing to warn about');
  eq(b.absence, null, 'there is a score, so there is no reason for its absence');
  eq(b.lines.length, 4, 'four signals, four rows — always, even the ones that were not scored');
  eq(b.lines.map((l) => l.key).join(','), 'sleep,recovery,hydration,load', 'in scale order, which is order of weight');
  eq(b.lines.map((l) => l.title).join(','), 'Sleep,Device Recovery,Hydration,Recent Training',
    'titles are Title Case, per the house rule for a label beside a value');
  // "Device Recovery" rather than "Recovery": this breakdown renders on a
  // screen called Recovery, under a hero called Readiness, and a third bare
  // "Recovery" would be one word for three different things in one viewport.
  ok(!b.lines.some((l) => l.title === 'Recovery'), 'and none of them is a bare "Recovery", which the screen already uses twice');
}

// ── a shortened window is NOT a short read ────────────────────────────────
//
// readiness.ts shortens the window rather than filling a gap, and that is
// correct behaviour, not a failure. Calling it 'partial' would put a warning on
// the screen of every member who has logged two nights instead of three, which
// teaches them to ignore the word on the day it means something.
{
  const b = br({ sleep: sleepOf(2, 0) });
  eq(b.status, 'ready', 'two nights out of three is a smaller claim, not an incomplete read');
  eq(b.caveats.length, 0, 'and it earns no warning');
  eq(lineFor(b, 'sleep').detail, '7h 30m a night over 2 of the last 3 nights, all measured by a device',
    'but the line says how many nights it ran over, because the average cannot');
}
{
  eq(lineFor(br(), 'sleep').detail, '7h 30m a night over the last 3 nights, all measured by a device',
    'a full window says so plainly rather than "3 of the last 3"');
  eq(lineFor(br({ sleep: sleepOf(1, 0) }), 'sleep').detail,
    '7h 30m a night over 1 of the last 3 nights, measured by a device',
    'one device night is singular');
  eq(lineFor(br({ sleep: sleepOf(0, 1) }), 'sleep').detail,
    '7h 30m a night over 1 of the last 3 nights, from a night you logged',
    'a typed night says it was typed — a memory and a measurement are not the same fact');
  eq(lineFor(br({ sleep: sleepOf(0, 3) }), 'sleep').detail,
    '7h 30m a night over the last 3 nights, all from the nights you logged',
    'and three of them likewise');
  eq(lineFor(br({ sleep: sleepOf(2, 1) }), 'sleep').detail,
    '7h 30m a night over the last 3 nights, 2 measured by a device, 1 from the nights you logged',
    'a mixed window splits the two, because they are different kinds of evidence');
}

// ── hydration: untracked and unread are one null and two sentences ────────
{
  const untracked = br({ hydrationGoal: false, hydrationPct: null, readiness: readinessScore({ avgSleepHours: 7.5, hydrationPct: null, recoveryPct: null, workoutsLast2Days: 1 }) });
  const h = lineFor(untracked, 'hydration');
  eq(h.state, 'not-tracked', 'no goal set is not a failure');
  eq(h.detail, 'not in the scale — you have not set a daily water goal',
    'and it says the signal LEFT the scale, because a member reading a lower number will assume they were docked for it');
  eq(untracked.status, 'ready', 'an untracked signal does not make the read incomplete');
  eq(untracked.caveats.length, 0, 'nor does it warrant a warning');
}
{
  const unread = br({ hydrationStatus: 'error', hydrationPct: null, readiness: readinessScore({ avgSleepHours: 7.5, hydrationPct: null, recoveryPct: null, workoutsLast2Days: 1 }) });
  const h = lineFor(unread, 'hydration');
  eq(h.state, 'unread', 'a goal that exists and a count that could not be read is a FAILED read, not an untracked one');
  eq(h.detail, "not in the scale — today's count could not be read", 'said as what it is');
  eq(unread.status, 'partial', 'and it makes the score partial');
  eq(unread.caveats[0], "Today's water count could not be read, so hydration is not in the scale.",
    'with a sentence, because 0 cups over a goal they DID set is thirty points for a network blip');
}
{
  // Still in flight is not a failure, and a hero that flashes a warning on
  // every launch is a hero nobody reads.
  const loading = br({ hydrationStatus: 'loading', hydrationPct: null, readiness: readinessScore({ avgSleepHours: 7.5, hydrationPct: null, recoveryPct: null, workoutsLast2Days: 1 }) });
  eq(loading.caveats.length, 0, 'a count still loading has not failed');
}
{
  eq(lineFor(br({ hydrationPct: 0.5 }), 'hydration').detail, "50% of today's goal", 'a scored figure is shown as one');
  eq(lineFor(br({ hydrationPct: 0 }), 'hydration').detail, "0% of today's goal",
    'and nought per cent is a figure, not an absence — this is the `|| 0` trap from the other side');
  eq(lineFor(br({ hydrationPct: 0 }), 'hydration').state, 'scored', 'so its state is scored');
}

// ── recent sessions ───────────────────────────────────────────────────────
{
  // DAYS, never sessions. `workoutsLast2Days` is a Set of local day keys —
  // src/ui/readiness.ts: "three sets on Monday are one day of training" — so
  // "1 session in the last two days", which is what this row used to print,
  // is a false statement to a member who trained twice yesterday.
  eq(lineFor(br({ workoutsLast2Days: 0 }), 'load').detail, 'no training logged in the last two days',
    'nothing logged is a fact and reads as one');
  eq(lineFor(br({ workoutsLast2Days: 1 }), 'load').detail, 'training logged on 1 day in the last two', 'one is singular');
  eq(lineFor(br({ workoutsLast2Days: 2 }), 'load').detail, 'training logged on 2 days in the last two', 'two is not');
  ok(!/session/.test(lineFor(br({ workoutsLast2Days: 2 }), 'load').detail),
    'and the word "session" is not in it at all — the log cannot count them');
  eq(lineFor(br({ workoutsLast2Days: 0 }), 'load').state, 'scored',
    'and nought is scored, never mistaken for unread — the two are opposite ends of the scale');
}

// ── no score: the four absences, and what each asks the member to do ──────
//
// They render identically as a dash. They are not the same sentence, and three
// of the four are not the member's fault at all.
{
  const noScore = { readiness: null, sleep: sleepOf(0, 0) } as Partial<ReadinessBreakdownInput>;

  // The training log first, because it is the only absence that is never theirs.
  const log = br({ ...noScore, workoutsLast2Days: null, sleep: sleepOf(3, 0), readiness: null });
  eq(log.absence, 'We could not read your training log, so there is no readiness to show — it does not mean you are rested.',
    'an unread log outranks every other reason, even with three good nights on file');
  eq(log.status, 'error', 'and the absence is ours, so it is an error rather than an empty answer');
  eq(lineFor(log, 'load').state, 'unread', 'the row says so too');

  const loading = br({ ...noScore, deviceStatus: 'loading', readiness: null });
  eq(loading.absence, 'Reading last night from your devices…', 'a read in flight says it is in flight');
  eq(loading.status, 'loading', 'and the status agrees rather than calling it an error');

  const typedLoading = br({ ...noScore, typedStatus: 'loading', readiness: null });
  eq(typedLoading.absence, 'Reading the nights you have logged…', 'and so does the typed half');

  const devErr = br({ ...noScore, sources: [{ name: 'WHOOP', status: 'error', nights: 0 }], readiness: null });
  eq(devErr.absence, 'We could not read your devices just now, so there is no readiness to show — it does not mean you slept badly.',
    'a device that did not answer is not a bad night');
  eq(devErr.status, 'error', 'and no score plus a failed read is an error');

  // THE SECOND ASSERTION THIS FILE EXISTS FOR. An unreadable typed log with an
  // empty cache used to reach the home screen as "log a night of sleep" — a
  // claim about what the member has done, built out of a read that failed.
  const typedErr = br({ ...noScore, typedStatus: 'error', sources: [], readiness: null });
  eq(typedErr.absence, 'We could not read your sleep log just now, so there is no readiness to show — it does not mean you have not logged a night.',
    'an unread sleep log must never be reported as an unlogged one');
  eq(typedErr.status, 'error', 'it is our read that failed, not their week');
  eq(lineFor(typedErr, 'sleep').state, 'unread', 'and the sleep row says unread, not no-record');

  // Devices connected, readable, and genuinely holding nothing.
  const empty = br({ ...noScore, readiness: null });
  eq(empty.absence, 'No sleep on record for the last 3 nights yet.',
    'a device that answered and had nothing is a true empty answer');
  eq(empty.status, 'ready', 'a genuine absence is a complete answer, not a broken one');
  eq(lineFor(empty, 'sleep').state, 'no-record', 'no-record, which is not unread');
  eq(lineFor(empty, 'sleep').detail, 'nothing recorded for the last 3 nights', 'and says so');

  // Nobody connected anything. The one case where "connect a watch" is true.
  const none = br({ ...noScore, sources: [], readiness: null });
  eq(none.absence, 'Log a night of sleep, or connect a watch, to see your readiness.',
    'the only member this sentence is honest for is the one with no device at all');

  // A provider that cannot report sleep is not a provider that recorded nothing.
  const unsupported = br({ ...noScore, sources: [{ name: 'Health Connect', status: 'unsupported', nights: 0 }], readiness: null });
  eq(unsupported.absence, 'Log a night of sleep, or connect a watch, to see your readiness.',
    'Health Connect cannot report sleep, so it does not count as a device that looked');
}

// ── a figure that is not a figure ─────────────────────────────────────────
//
// `readinessSleep` cannot produce any of these — it returns a null average
// rather than a zero one, and never an average with no nights behind it. They
// are asserted anyway, for the same reason readiness.ts guards NaN it is not
// supposed to receive: this module takes its input structurally, the guard is
// one character wide, and the failure mode is printing "— a night over 0 of the
// last 3 nights" as though it were an account of somebody's week.
{
  const oneNight = { night: '2026-08-30', hours: 7.5, from: 'device' as const };

  const zero = br({ sleep: { avgHours: 0, nights: [oneNight], fromDevice: 1, fromTyped: 0 }, readiness: null });
  eq(lineFor(zero, 'sleep').state, 'no-record',
    'an average of nought hours is the absence of a night, not a night of no sleep');

  // The other side of the same guard: half an hour IS a figure and must survive.
  const half = br({ sleep: { avgHours: 0.5, nights: [oneNight], fromDevice: 1, fromTyped: 0 } });
  eq(lineFor(half, 'sleep').state, 'scored', 'and a short night is still a night');
  eq(lineFor(half, 'sleep').detail, '0h 30m a night over 1 of the last 3 nights, measured by a device',
    'shown as what the device reported');

  const noNights = br({ sleep: { avgHours: 7.5, nights: [], fromDevice: 0, fromTyped: 0 }, readiness: null });
  eq(lineFor(noNights, 'sleep').state, 'no-record',
    'an average with no nights under it cannot say how many nights it ran over, so it does not claim to');
}

// ── NaN is an absence, and must not reach the arithmetic or the sentence ──
//
// `Number.isFinite` is the second half of every null check in this file. Drop
// it and NaN — which is not null and not a number — walks straight past the
// gate: readinessScore withholds the score, and this module would go on to
// print "NaN sessions in the last two days" underneath the dash.
{
  const nan = br({ workoutsLast2Days: NaN, readiness: null });
  eq(lineFor(nan, 'load').state, 'unread', 'NaN sessions is an unread log, not a count');
  eq(lineFor(nan, 'load').detail, 'we could not read your training log', 'and reads as one');
  eq(nan.absence, 'We could not read your training log, so there is no readiness to show — it does not mean you are rested.',
    'the absence names it as the read it is');
  eq(nan.status, 'error', 'and it is our error, not their empty week');
}

// ── one source loading is enough to say the sleep row is still being read ─
//
// The two halves of sleep load independently, so the row is unresolved while
// EITHER is in flight. Fold the pair into an `&&` and a screen would say
// "nothing recorded for the last 3 nights" over a read still in progress.
{
  const devLoading = br({ deviceStatus: 'loading', typedStatus: 'ready', sleep: sleepOf(0, 0), readiness: null });
  eq(lineFor(devLoading, 'sleep').detail, 'still being read', 'devices in flight, log settled');
  const typedLoading = br({ deviceStatus: 'ready', typedStatus: 'loading', sleep: sleepOf(0, 0), readiness: null });
  eq(lineFor(typedLoading, 'sleep').detail, 'still being read', 'and the other way round');
}

// ── the device's recovery score, and the three ways it can be absent ──────
//
// The row's job is to keep "you own no strap" apart from "your strap has not
// reported today". Both are a null recoveryPct, both leave the signal out of
// the scale, and only one of them is something the member can go and fix.
{
  const withScore = br({ recoveryPct: 62, recoveryFrom: 'WHOOP', recoveryDeviceConnected: true });
  const line = lineFor(withScore, 'recovery');
  eq(line.state, 'scored', 'a vendor figure is a scored signal');
  ok(/62/.test(line.detail), 'and the figure is printed');
  ok(/WHOOP/.test(line.detail), 'ATTRIBUTED to the device that made it — an unattributed recovery is a second unexplained number on a screen that already has one');
  ok(/recovery/i.test(line.detail), 'in WHOOP’s own word for it');

  const oura = lineFor(br({ recoveryPct: 71, recoveryFrom: 'Oura Ring', recoveryDeviceConnected: true }), 'recovery');
  ok(/readiness/i.test(oura.detail),
    'and in OURA’S own word for it — the two vendors name the same 0-100 figure differently and a member cross-checking needs ours to match theirs');

  const noStrap = lineFor(br({ recoveryPct: null, recoveryDeviceConnected: false }), 'recovery');
  eq(noStrap.state, 'not-tracked',
    'NO DEVICE IS NOT A FAILED READ — telling somebody with no strap that we could not read their recovery invents a fault');
  ok(!/could not|not reported/i.test(noStrap.detail), 'and the sentence does not blame a read that never happened');

  const silent = lineFor(br({ recoveryPct: null, recoveryDeviceConnected: true }), 'recovery');
  eq(silent.state, 'unread',
    'a connected strap with no figure today IS unread — that is the one the member can act on');
  ok(silent.detail !== noStrap.detail, 'the two absences must never share a sentence');
  ok(/has not reported/.test(silent.detail),
    'and it is a statement about the device, which is only sayable because the device walk came back');

  // ── the fourth absence: we did not manage to ask ────────────────────────
  //
  // This row took the input alone and never looked at the device walk, so a
  // failed walk fell into the sentence above and told a member their strap had
  // stayed quiet when the truth was that we never reached it. That sends them
  // into the WHOOP app after a sync that is sitting there perfectly fine.
  const walkFailed = lineFor(
    br({ recoveryPct: null, recoveryDeviceConnected: true, deviceStatus: 'error' }),
    'recovery',
  );
  eq(walkFailed.state, 'unread', 'a walk that failed leaves the signal out of the scale');
  ok(!/has not reported/.test(walkFailed.detail),
    'and says nothing about what the device did, because we did not manage to ask it');
  ok(/could not read your devices/.test(walkFailed.detail), 'it says whose failure it was');

  // A walk where SOME provider failed is no better placed to speak for the
  // strap: `ReadinessSource` carries a name and no id, so there is no telling
  // whether the one that failed was the one that scores recovery.
  const walkShort = lineFor(br({
    recoveryPct: null, recoveryDeviceConnected: true,
    sources: [
      { name: 'Oura Ring', status: 'error', nights: 0 },
      { name: 'Apple Health', status: 'ready', nights: 3 },
    ],
  }), 'recovery');
  ok(!/has not reported/.test(walkShort.detail),
    'a partial walk does not get to state that a device stayed quiet either');

  const walkLoading = lineFor(
    br({ recoveryPct: null, recoveryDeviceConnected: true, deviceStatus: 'loading' }),
    'recovery',
  );
  ok(/still reading/i.test(walkLoading.detail),
    'and a walk still in flight says so rather than reporting a silence it has not established');

  // Neither absence is a deduction, and both say so, for the same reason the
  // hydration row does: a member reading "no recovery score" under a lower
  // number will assume they were marked down for it.
  for (const l of [noStrap, silent, walkFailed, walkShort, walkLoading]) {
    ok(/not in the scale/.test(l.detail), 'an absent signal says it left the scale rather than scoring zero');
  }
}

// ── the breakdown never contradicts the score ─────────────────────────────
//
// It describes the values that were handed to readinessScore rather than
// re-deriving them, which is the only thing that keeps a second copy of a
// derivation from drifting off the first.
{
  for (const pct of [null, 0, 0.5, 1]) {
    for (const load of [null, 0, 1, 3]) {
      for (const rec of [null, 0, 62, 100]) {
      const r = readinessScore({ avgSleepHours: 7.5, hydrationPct: pct, recoveryPct: rec, workoutsLast2Days: load });
      const b = br({ readiness: r, hydrationPct: pct, recoveryPct: rec, recoveryDeviceConnected: rec != null, workoutsLast2Days: load, hydrationGoal: pct != null });
      const scoredSignals = b.lines.filter((l) => l.state === 'scored').map((l) => l.key);
      if (r) {
        eq(scoredSignals.join(','), r.from.join(','),
          `the rows marked scored are exactly readinessScore's own \`from\` (hydration ${pct}, recovery ${rec}, load ${load})`);
      } else {
        ok(b.absence != null, `no score means a stated reason (hydration ${pct}, recovery ${rec}, load ${load})`);
      }
      }
    }
  }
}

if (errors.length) {
  console.error(`readinessBreakdown.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('readinessBreakdown.test.ts — ok');
