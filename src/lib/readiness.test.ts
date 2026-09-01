// Tests for readiness — the first and largest number on the client's home
// screen, and the one that tells somebody whether to push today.
//
// The whole subject of this file is ABSENCE. Readiness is built from three
// signals and every one of them can be missing, for two different reasons that
// must not be confused: nobody recorded it, or we could not read it. Each of
// those has a wrong answer that is easy to write and impossible to see
// afterwards, because the score renders as a perfectly plausible number:
//
//   · A missing night scored as zero hours slept. That shipped. A brand-new
//     account scored 0 + 0 + 20 = 20, read as 'Under-recovered', and the home
//     screen told somebody who had logged nothing at all to take a rest day —
//     while the hero directly above it showed a dash. Two elements, one screen,
//     opposite claims.
//   · An unread WATER count scored as a day of drinking nothing. That was live
//     until this change: `water` is 0 until the read lands, and 0 over a goal
//     the client HAD set is thirty points off, taken for a network blip and
//     presented as a fact about their day.
//   · An unread TRAINING LOG scored as no sessions in two days — which is
//     MAXIMALLY RESTED, the opposite direction, and worse: the tip attached to
//     a raised score is "Great day to push", handed to somebody who may have
//     trained hard yesterday.
//
// So the assertions below are almost all of the shape "a missing X does not
// score as a bad X, and does not score as a good one either". The two that
// matter most are the ones that fail if somebody restores `|| 0` or `?? 0`
// anywhere in readinessScore's inputs, and they are marked.
//
// Compile with tsc then run with node, like plateMath.test.ts.
import { readinessScore, readinessMadeOf, readinessSleep, type ReadinessInput } from './readiness';
import { storableNights, withStored, rowToStored, storedToRow, type StoredNight } from './deviceSleepStore';
import type { MergedNight, SleepReading } from './sleepMerge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A fully-known input, so each case below can vary exactly one thing. */
const known: ReadinessInput = { avgSleepHours: 8, hydrationPct: 1, workoutsLast2Days: 0 };
const score = (over: Partial<ReadinessInput>) => readinessScore({ ...known, ...over });

// ── sleep is the premise, and its absence is not a bad night ──────────────
//
// Half the scale. There is no readiness without it, and every way of saying
// "no night on record" has to reach the same answer: no score.
eq(score({ avgSleepHours: null }), null,
  'no night on record yields NO score — not the 20 that used to read as under-recovered');
eq(score({ avgSleepHours: 0 }), null,
  'zero hours is the absence of a night, not a catastrophic one');
eq(score({ avgSleepHours: NaN }), null,
  'and an unparseable figure is an absence too — NaN must never reach the arithmetic');
eq(readinessScore({ avgSleepHours: null, hydrationPct: 0.9, workoutsLast2Days: 0 }), null,
  'the other two signals cannot carry a score between them');

// ── an unread training log withholds the score ────────────────────────────
//
// THIS IS THE ASSERTION THAT FAILS IF THE NULL CHANNEL IS REMOVED. Restore
// `workoutsLast2Days: number` and every caller with an unreadable log has to
// pass 0, which lands on the branch directly below: full rest marks.
eq(score({ workoutsLast2Days: null }), null,
  'AN UNREAD TRAINING LOG YIELDS NO SCORE — it must not be scored as a member who has not trained');
eq(score({ workoutsLast2Days: NaN }), null,
  'and neither does a load that arrived as NaN');
{
  // The proof that the two are genuinely different, rather than the null
  // happening to agree with zero. A real zero is a real, high score.
  const restedForReal = score({ workoutsLast2Days: 0 });
  ok(restedForReal != null && restedForReal.score === 100,
    'a KNOWN zero sessions still scores full marks — the null channel narrows nothing for somebody who genuinely has not trained');
  ok(restedForReal != null && restedForReal.tip.length > 0 && /push|PR/i.test(restedForReal.tip),
    'and it carries the "go and push" tip — which is exactly why an unread log must not be able to reach it');
}

// ── training load counts DOWN as sessions stack up ────────────────────────
{
  const one = score({ workoutsLast2Days: 1 });
  const two = score({ workoutsLast2Days: 2 });
  const three = score({ workoutsLast2Days: 3 });
  const ten = score({ workoutsLast2Days: 10 });
  ok(one != null && two != null && three != null && ten != null, 'every real load produces a score');
  ok(one!.score === 100, 'one session in two days is still fully rested');
  ok(two!.score < one!.score, 'a second session in two days costs something');
  ok(three!.score < two!.score, 'and a third costs more');
  eq(ten!.score, three!.score, 'the rest component floors at zero rather than going negative — ten sessions is not worse than three');
  ok(ten!.score >= 0, 'and the score stays inside the scale');
}

// ── hydration: untracked leaves the scale, tracked-and-low counts against ──
//
// These two must not converge. If they ever return the same score for the same
// sleep and load, the distinction between "this person does not track water"
// and "this person drank nothing" has been lost.
{
  const untracked = score({ hydrationPct: null });
  const drankNothing = score({ hydrationPct: 0 });
  ok(untracked != null && untracked.score === 100,
    'no hydration figure is not dehydration — the remaining signals are rescaled, not docked 30');
  ok(drankNothing != null && drankNothing.score < 100,
    'but a hydration figure that says zero genuinely counts against the score');
  ok(untracked!.score > drankNothing!.score,
    'THE UNTRACKED CASE MUST OUTSCORE THE TRACKED-ZERO CASE — collapsing them is how a missing input becomes a bad one');
  eq(untracked!.confidence, 'partial', 'and the rescaled score says it is partial rather than presenting itself as the whole picture');
  eq(drankNothing!.confidence, 'full', 'while a score with all three signals in the scale is full');
}

// ── the score says what it is made of ─────────────────────────────────────
{
  const all = score({});
  eq(all!.from.join(','), 'sleep,hydration,load', 'a full score names all three signals');
  const twoOf = score({ hydrationPct: null });
  eq(twoOf!.from.join(','), 'sleep,load', 'and one built without hydration names only what was in the scale');
  ok(!twoOf!.from.includes('hydration'),
    'a signal that was not scored is never listed as though it had been');

  // The sentence a screen prints. Asserted on content, not on an exact string:
  // pinning the wording would make a rewrite a red test, and what must not
  // regress is that it names the signals and does NOT name the missing one.
  const said = readinessMadeOf(twoOf!);
  ok(/sleep/i.test(said) && /session/i.test(said), 'the sentence names the signals the number is built from');
  ok(!/hydration|water/i.test(said),
    'and it does NOT mention the missing one — "no hydration figure" reads as a deduction, and nothing was deducted');
  ok(!said.endsWith('.'), 'no trailing full stop: every caller appends it to a tip that already has one');
  ok(readinessMadeOf(all!).includes('hydration'), 'a full score lists hydration among its parts');
}

// ── the scale stays a scale ───────────────────────────────────────────────
for (const h of [0.5, 1, 4, 6, 7, 8, 9, 12, 24]) {
  for (const w of [null, 0, 0.5, 1, 3]) {
    for (const l of [0, 1, 2, 5]) {
      const r = readinessScore({ avgSleepHours: h, hydrationPct: w, workoutsLast2Days: l });
      ok(r != null, `${h}h / ${w} / ${l} produces a score`);
      ok(r != null && r.score >= 0 && r.score <= 100, `${h}h / ${w} / ${l} stays within 0-100`);
      ok(r != null && Number.isInteger(r.score), `${h}h / ${w} / ${l} is a whole number, not 83.33333`);
      ok(r != null && r.label.length > 0 && r.tip.length > 0, `${h}h / ${w} / ${l} carries a label and a tip`);
      ok(r != null && r.from.includes('sleep') && r.from.includes('load'),
        `${h}h / ${w} / ${l} always names sleep and load, which are never optional`);
    }
  }
}
// A hydration figure over 1 is a client past their goal, not 130% recovered.
eq(score({ hydrationPct: 3 })!.score, score({ hydrationPct: 1 })!.score,
  'drinking three times the goal scores the same as meeting it — the signal is clamped, not extrapolated');

// ── the tone thresholds, which are what the screen colours and words on ───
{
  const great = readinessScore({ avgSleepHours: 8, hydrationPct: 1, workoutsLast2Days: 0 });
  const middling = readinessScore({ avgSleepHours: 5.5, hydrationPct: 0.5, workoutsLast2Days: 1 });
  const bad = readinessScore({ avgSleepHours: 4, hydrationPct: 0.2, workoutsLast2Days: 3 });
  eq(great!.tone, 'good', 'eight hours, hydrated and fresh reads as well recovered');
  eq(middling!.tone, 'moderate', 'five and a half hours, half hydrated, one session reads as moderate');
  eq(bad!.tone, 'low', 'four hours, dehydrated, three sessions is genuinely under-recovered');
  ok(/rest|light|sleep/i.test(bad!.tip), 'and the low tip tells them to back off rather than to push');
}

// ── readinessSleep: which nights the score may use ────────────────────────
//
// A measured night beats a typed one for the same date, a night nobody recorded
// contributes nothing and shortens the window, and no gap is ever filled.
const measured = (night: string, minutes: number) => ({ night, outcome: 'measured', minutesAsleep: minutes });
const unknownNight = (night: string) => ({ night, outcome: 'unknown', minutesAsleep: null });
{
  const s = readinessSleep([measured('2026-09-01', 480), measured('2026-08-31', 420)], [], 3);
  eq(s.avgHours, 7.5, 'two measured nights average to the mean of the two, over two rather than over the window');
  eq(s.nights.length, 2, 'and the window is the nights that exist, not the count asked for');
  eq(s.fromDevice, 2, 'both are attributed to a device');
  eq(s.fromTyped, 0, 'and none to the log');
}
{
  const s = readinessSleep([], [], 3);
  eq(s.avgHours, null, 'NO NIGHTS YIELDS NULL HOURS — not zero, which readinessScore would have to refuse anyway');
  eq(s.nights.length, 0, 'and no nights behind it');
}
{
  // A failed read is not a night of no sleep. An 'unknown' night carries no
  // figure and must not enter the average as one.
  const s = readinessSleep([unknownNight('2026-09-01'), measured('2026-08-31', 480)], [], 3);
  eq(s.avgHours, 8, 'AN UNKNOWN NIGHT IS SKIPPED, NOT AVERAGED IN AS ZERO — one night of eight hours averages to eight');
  eq(s.nights.length, 1, 'and the window shortens to the nights that are real');
}
{
  const at = new Date(2026, 8, 1, 9, 0, 0).toISOString(); // 1 Sep, local morning
  const s = readinessSleep([measured('2026-09-01', 300)], [{ at, hours: 9 }], 3);
  eq(s.avgHours, 5, 'a device measurement beats a typed night for the same date rather than being averaged with it');
  eq(s.fromDevice, 1, 'and the night is attributed to the device');
  eq(s.fromTyped, 0, 'not to the log it displaced');
}
{
  const at = new Date(2026, 7, 30, 9, 0, 0).toISOString(); // 30 Aug, local morning
  const s = readinessSleep([measured('2026-09-01', 480)], [{ at, hours: 6 }], 3);
  eq(s.avgHours, 7, 'a typed night on a date no device covered is used, and averaged with the measured one');
  eq(s.fromTyped, 1, 'and counted as typed, so a screen can say where each came from');
}
{
  const s = readinessSleep([measured('2026-09-01', 480), measured('2026-08-31', 480), measured('2026-08-30', 480), measured('2026-08-29', 60)], [], 3);
  eq(s.nights.length, 3, 'the window caps at the count asked for');
  eq(s.avgHours, 8, 'and takes the NEWEST three — an older, shorter night outside the window does not drag the average down');
}

// ── deviceSleepStore: what survives a relaunch, and what may not ──────────
//
// The roadmap item behind this file: sleep a watch measured was held in React
// state and nowhere else, so an offline morning, an expired token or a second
// handset took the score away with nothing on screen to explain it.
const reading = (over: Partial<SleepReading> = {}): SleepReading => ({
  provider: 'oura', sourceId: 'oura', sourceName: 'Ring', family: 'oura', basis: 'asleep',
  night: '2026-09-01', minutesAsleep: 450, ...over,
});
const night = (over: Partial<MergedNight> = {}): MergedNight => ({
  night: '2026-09-01', outcome: 'measured', minutesAsleep: 450, source: reading(),
  agreement: 'single', others: [], spreadMin: null, failed: [], ...over,
});
{
  const keep = storableNights([
    night(),
    night({ night: '2026-08-31', outcome: 'no-record', minutesAsleep: null, source: null }),
    night({ night: '2026-08-30', outcome: 'unknown', minutesAsleep: null, source: null, failed: ['whoop'] }),
  ]);
  eq(keep.length, 1, 'ONLY A MEASURED NIGHT IS KEPT — storing a no-record or an unknown night would write down "we do not know" as a fact');
  eq(keep[0].night, '2026-09-01', 'and it is the measured one');
  eq(keep[0].minutesAsleep, 450, 'with the figure the device reported');
  eq(keep[0].sourceName, 'Ring', 'and its attribution, which is what lets the client check it');
}
{
  // A figure with nothing to attribute it to cannot be shown honestly when it
  // comes back, so it is not kept at all.
  const keep = storableNights([night({ source: null })]);
  eq(keep.length, 0, 'a measured night with no source is not stored — attribution travels with the figure or the figure does not travel');
  eq(storableNights([night({ minutesAsleep: 0 })]).length, 0, 'and zero minutes is not a measurement of a sleepless night');
}
{
  const stored: StoredNight[] = [{
    night: '2026-08-31', minutesAsleep: 400, provider: 'whoop', sourceId: 'whoop',
    sourceName: 'WHOOP', family: 'whoop', basis: 'asleep',
  }];
  const fresh: MergedNight[] = [
    night(),
    night({ night: '2026-08-31', outcome: 'unknown', minutesAsleep: null, source: null, failed: ['whoop'] }),
  ];
  const out = withStored(fresh, stored);
  eq(out[0].minutesAsleep, 450, 'a night the devices answered for today stands as they answered it');
  eq(out[1].outcome, 'measured', 'A NIGHT THEY COULD NOT ANSWER FOR FALLS BACK TO WHAT THEY SAID BEFORE — this is the whole point of storing them');
  eq(out[1].minutesAsleep, 400, 'with the figure that was stored');
  eq(out[1].source?.sourceName, 'WHOOP', 'and the device that measured it, so the screen can still name it');
  eq(out[1].failed.join(','), 'whoop', 'the failure is still recorded — the read did fail, we simply have something real to show anyway');
  eq(out[1].agreement, 'single', 'and one kept reading is never dressed up as corroboration');
  eq(out[1].kept, true, 'A KEPT NIGHT IS FLAGGED AS KEPT — a stored reading must not pass for the device answering just now');
  eq(out[0].kept, undefined, 'while a night the devices answered for today carries no such flag');
  eq(out[1].others.length, 0, 'nor accompanied by readings that did not arrive');
}
{
  // A vendor that revises a night must be able to. Pinning the first figure
  // Repple ever saw would leave the app disagreeing with the vendor's own
  // screen forever.
  const stored: StoredNight[] = [{
    night: '2026-09-01', minutesAsleep: 400, provider: 'oura', sourceId: 'oura',
    sourceName: 'Ring', family: 'oura', basis: 'asleep',
  }];
  const out = withStored([night({ minutesAsleep: 470, source: reading({ minutesAsleep: 470 }) })], stored);
  eq(out[0].minutesAsleep, 470, 'a FRESH measurement wins over a kept one — the stored copy fills gaps, it does not pin the past');
}
{
  const stored: StoredNight[] = [{
    night: '2026-07-04', minutesAsleep: 400, provider: 'oura', sourceId: 'oura',
    sourceName: 'Ring', family: 'oura', basis: 'asleep',
  }];
  const out = withStored([night()], stored);
  eq(out.length, 1, 'a stored night outside the window is not pushed onto a list whose length other screens count');
  eq(withStored([], stored).length, 0, 'and an empty window stays empty');
}
{
  // The two together: this is the regression the whole change exists to stop.
  // Every provider failed, so the merge reports the week as unknown — and the
  // score used to vanish. With the nights kept, it does not.
  const allFailed: MergedNight[] = ['2026-09-01', '2026-08-31', '2026-08-30'].map((n) =>
    night({ night: n, outcome: 'unknown', minutesAsleep: null, source: null, failed: ['whoop'] }));
  const stored: StoredNight[] = ['2026-09-01', '2026-08-31', '2026-08-30'].map((n) => ({
    night: n, minutesAsleep: 480, provider: 'whoop', sourceId: 'whoop',
    sourceName: 'WHOOP', family: 'whoop', basis: 'asleep',
  }));
  eq(readinessSleep(allFailed, [], 3).avgHours, null,
    'without the kept nights a total read failure leaves readiness nothing to score — which is correct, and is why it used to disappear');
  const backed = readinessSleep(withStored(allFailed, stored), [], 3);
  eq(backed.avgHours, 8, 'WITH THEM, THE SCORE SURVIVES AN OFFLINE MORNING — from real nights real devices really measured');
  const r = readinessScore({ avgSleepHours: backed.avgHours, hydrationPct: null, workoutsLast2Days: 0 });
  ok(r != null && r.score === 100, 'and readiness is a number again rather than a dash that nothing on screen explains');
}

// ── the row mapping, which is where a string becomes a NaN ────────────────
{
  const row = { night: '2026-09-01', minutes_asleep: '450', provider: 'oura', source_id: 'oura', source_name: 'Ring', family: 'oura', basis: 'asleep' };
  const n = rowToStored(row);
  eq(n?.minutesAsleep, 450, 'a numeric handed back as a string becomes a number — a string here divides into NaN hours and silently deletes the score');
  eq(n?.basis, 'asleep', 'and the basis survives');
  eq(rowToStored({ ...row, basis: 'in-bed' })?.basis, 'in-bed',
    'including "in bed", which runs longer than asleep and is labelled differently on screen');
  eq(rowToStored({ ...row, source_name: '' }), null,
    'a row with no source name is dropped rather than shown as an unattributed figure');
  eq(rowToStored({ ...row, minutes_asleep: 0 }), null, 'and zero minutes is not a night');
  eq(rowToStored({ ...row, minutes_asleep: null }), null, 'nor is a null one');
  eq(rowToStored({ ...row, night: 'last tuesday' }), null, 'a night that is not a date is not a night');
  eq(rowToStored(null), null, 'and nothing at all is nothing at all');
}
{
  const r = storedToRow('u-1', {
    night: '2026-09-01', minutesAsleep: 450, provider: 'oura', sourceId: 'oura',
    sourceName: 'Ring', family: 'oura', basis: 'asleep',
  });
  eq(r.user_id, 'u-1', 'the row is written against the caller’s own id, the only one the policy accepts');
  eq(r.minutes_asleep, 450, 'the figure goes up as a number');
  eq(r.source_name, 'Ring', 'and the attribution goes up with it');
  // The round trip has to be lossless, or a night comes back meaning something
  // slightly different from the night that went up.
  const back = rowToStored(r);
  eq(JSON.stringify(back), JSON.stringify({
    night: '2026-09-01', minutesAsleep: 450, provider: 'oura', sourceId: 'oura',
    sourceName: 'Ring', family: 'oura', basis: 'asleep',
  }), 'and what comes back out is exactly what went in');
}

if (errors.length) {
  console.error(`readiness.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('readiness.test.ts — ok');
