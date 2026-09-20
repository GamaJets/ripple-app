// What the member's AI coach is told about them. Compile with tsc, run with node.
//
// The defect these hold shut is an absence read as a fact, on the one path in
// this app where an absence does not render as a blank — it renders as a
// confident paragraph addressed to the member in the second person.
//
// app/(client)/coach.tsx assembles a `context` object out of providers whose
// failure mode is a plausible default. src/ui/clientData.tsx's own header:
// under a failed profile read "name, goal, diet, allergens and injuries" stay
// "at their constructed defaults", which are goal 'muscle', diet 'meat',
// coachingMode 'online' and an EMPTY injury list. The screen then sent:
//
//   Goal: muscle                  — to somebody cutting
//   Diet style: meat              — to a vegetarian
//   How they are coached: remotely, their coach writes the plan
//                                 — to somebody training alone
//   Injuries / limitations: none disclosed
//                                 — to somebody with a disclosed shoulder,
//                                   under a system prompt whose standing rule
//                                   is to train around disclosed injuries.
//
// Four assertions carry the weight:
//
//   1. a whole read is passed through UNCHANGED — this is not a module that
//      withholds to be safe, and a test that only checks the refusals would
//      pass on a function that refused everything;
//   2. every field that has a constructed default behind it changes under an
//      unread profile, stated field by field, so adding a defaulted field to
//      the payload and forgetting to gate it fails here;
//   3. 'loading' is never described as a failure, and 'error'/'partial' never
//      as a wait;
//   4. the three silences behind a null sleep average stay three sentences —
//      'stale' in particular, which is the case that produced a readiness of
//      100 out of six-week-old sleep.
import {
  memberAskFacts, sleepFact, coachingFact, profileGap, bodyGap,
  type MemberAskInput,
} from './memberAsk';
import type { ReadinessSleep } from './readiness';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** Says nothing about wording, only that the field stopped asserting. */
const saysUnknown = (v: unknown, msg: string) =>
  ok(typeof v === 'string' && /not known/.test(v), `${msg} — got ${JSON.stringify(v)}`);

const KNEE: Injury = {
  id: 'i1', area: 'knee', severity: 'moderate', status: 'active',
  note: 'ACL rehab, week 6 — physio says no deep flexion under load',
} as unknown as Injury;

/** A member whose every read landed. Deliberately NOT the defaults: a test
 *  built on 'muscle' and 'meat' cannot tell a passthrough from a fallback. */
const WHOLE: MemberAskInput = {
  profileStatus: 'ready',
  scansStatus: 'ready',
  coachingMode: 'solo',
  goal: 'fatloss' as MemberAskInput['goal'],
  diet: 'vegan' as MemberAskInput['diet'],
  mealsPerDay: 5,
  weightKg: 63.44,
  bodyFatPct: 27.1,
  muscleKg: 24.2,
  injuries: [KNEE],
  focusAreas: ['glutes', 'rear delts'],
  macros: { kcal: 1840, protein: 140, carbs: 160, fat: 62 },
  targetInputsUnknown: false,
  adjustUnread: false,
  programTitle: 'Push Pull Legs',
  programFocus: 'chest, back, legs',
  programUnknown: false,
  programCachedNote: null,
  brandLabel: 'Repple',
};

/* ── 1. a read that landed is passed through, unchanged ──────────────────── */

{
  const f = memberAskFacts(WHOLE);
  eq(f.goal, 'fatloss', 'a read goal is the member’s own answer');
  eq(f.diet, 'vegan', 'a read diet is the member’s own answer');
  eq(f.mealsPerDay, 5, 'a read meal count is the member’s own answer');
  eq(f.coaching, 'training alone — no coach to refer them to', 'solo is said as solo');
  eq(f.weightKg, 63.4, 'weight is rounded to the tenth, not withheld');
  eq(f.bodyFatPct, 27.1, 'body fat goes as the figure');
  eq(f.muscleKg, 24.2, 'muscle goes as the figure');
  eq(f.kcal, 1840, 'the target goes as the figure');
  eq(f.protein, 140, 'protein goes as the figure');
  eq(f.programTitle, 'Push Pull Legs', 'a coach’s block goes by its own name');
  eq(f.programFocus, 'chest, back, legs', 'the focus is unchanged');
  eq(f.focusAreas, 'glutes, rear delts', 'focus areas are joined, not withheld');
  // The area and the severity, and NOT the note — which is seeded from an
  // uploaded physiotherapy report and never goes to a model.
  ok(/knee/i.test(String(f.injuries)), 'the disclosed area goes');
  ok(/moderate/i.test(String(f.injuries)), 'the severity goes');
  ok(!/ACL|physio|flexion/i.test(String(f.injuries)),
    `the injury NOTE never goes — got ${JSON.stringify(f.injuries)}`);
}

/* ── 2. every defaulted field stops asserting under an unread profile ───── */

for (const status of ['error', 'partial'] as const) {
  // The defaults, exactly as clientData.tsx constructs them. This is the shape
  // the screen actually had in hand when the read failed.
  const f = memberAskFacts({
    ...WHOLE,
    profileStatus: status,
    coachingMode: 'online',
    goal: 'muscle' as MemberAskInput['goal'],
    diet: 'meat' as MemberAskInput['diet'],
    mealsPerDay: 3,
    injuries: [],
    focusAreas: [],
    macros: null,
    targetInputsUnknown: true,
    adjustUnread: false,
  });
  saysUnknown(f.goal, `${status}: the goal is not asserted from the default`);
  saysUnknown(f.diet, `${status}: the diet is not asserted from the default`);
  saysUnknown(f.mealsPerDay, `${status}: the meal count is not asserted`);
  saysUnknown(f.coaching, `${status}: who is coaching them is not asserted`);
  saysUnknown(f.focusAreas, `${status}: focus areas are not asserted`);
  saysUnknown(f.kcal, `${status}: the calorie target is not asserted`);
  eq(f.protein, 'not known', `${status}: protein is not asserted`);
  eq(f.carbs, 'not known', `${status}: carbs are not asserted`);
  eq(f.fat, 'not known', `${status}: fat is not asserted`);

  // The one that matters most, and it gets its own assertions rather than the
  // generic one: "none disclosed" is an all-clear, and an empty list under a
  // failed read is not evidence for it.
  const inj = String(f.injuries);
  ok(!/none disclosed/i.test(inj),
    `${status}: an unread injury list is never an all-clear — got ${JSON.stringify(inj)}`);
  ok(/do not say they have none/i.test(inj),
    `${status}: the model is told not to read the silence as a clear bill`);

  // And the negative that makes the whole thing worth having: these must not
  // read as the member's answers in any rendering.
  ok(!/^muscle$/.test(String(f.goal)), `${status}: the literal default never travels as the goal`);
  ok(!/^meat$/.test(String(f.diet)), `${status}: the literal default never travels as the diet`);
  ok(!/never in the room/.test(String(f.coaching)),
    `${status}: a coach is never invented out of the 'online' default`);
}

/* ── 3. loading is a wait; error is a failure; they are not one sentence ── */

{
  ok(/had not finished loading/.test(profileGap('loading')), 'a profile still loading is a wait');
  ok(!/could not be read/.test(profileGap('loading')), 'a wait is not described as a failure');
  ok(/could not be read/.test(profileGap('error')), 'a failed profile read is said to have failed');
  ok(/could not be read/.test(profileGap('partial')),
    'a partial profile is a row we did not finish, not a shorter one');
  ok(/had not finished loading/.test(bodyGap('loading')), 'check-ins still loading is a wait');
  ok(/could not be read/.test(bodyGap('error')), 'a failed scan read is said to have failed');

  const loading = memberAskFacts({ ...WHOLE, profileStatus: 'loading', injuries: [], macros: null, targetInputsUnknown: true });
  ok(/had not finished loading/.test(String(loading.injuries)),
    'an injury list still loading is not reported as one that failed');
  ok(!/none disclosed/i.test(String(loading.injuries)),
    'nor is it reported as an all-clear');
}

/* ── the scans are a second read, and "not recorded" is a claim ─────────── */

{
  const never = memberAskFacts({ ...WHOLE, weightKg: null, bodyFatPct: null, muscleKg: null });
  eq(never.weightKg, 'not recorded', 'a scan read that answered may say nothing is recorded');
  eq(never.bodyFatPct, undefined, 'an absent figure on a whole read is dropped, not sent as a word');
  eq(never.muscleKg, undefined, 'same for muscle');

  const unread = memberAskFacts({
    ...WHOLE, scansStatus: 'error', weightKg: null, bodyFatPct: null, muscleKg: null,
  });
  ok(!/not recorded/.test(String(unread.weightKg)),
    `an unread scan history never claims nothing was measured — got ${JSON.stringify(unread.weightKg)}`);
  saysUnknown(unread.weightKg, 'an unread weight says so');
  saysUnknown(unread.bodyFatPct, 'an unread body fat says so rather than being dropped in silence');
  saysUnknown(unread.muscleKg, 'an unread muscle figure says so');
}

/* ── whose program it is travels with the program ───────────────────── */

{
  const gen = memberAskFacts({ ...WHOLE, programUnknown: true });
  ok(/Push Pull Legs/.test(gen.programTitle), 'the block is still named');
  ok(/automatic program/.test(gen.programTitle), 'and is named as the app’s, not the coach’s');
  ok(/Repple/.test(gen.programTitle), 'white-label: the brand comes from the caller');
  ok(/not their coach/.test(gen.programTitle), 'the model is told not to call it their coach’s plan');

  const cached = memberAskFacts({ ...WHOLE, programCachedNote: 'Saved on this phone on 3 Aug' });
  ok(/Saved on this phone/.test(cached.programTitle),
    'a thirty-day cached copy is disclosed to the model, not only to the reader');

  const brandB = memberAskFacts({ ...WHOLE, programUnknown: true, brandLabel: 'Fitwell' });
  ok(/Fitwell/.test(brandB.programTitle) && !/Repple/.test(brandB.programTitle),
    'no house brand is assumed anywhere');
}

/* ── the coach's adjustment is named as the missing read when it is ─────── */

{
  const adj = memberAskFacts({ ...WHOLE, macros: null, targetInputsUnknown: true, adjustUnread: true });
  ok(/adjustment could not be read/.test(String(adj.kcal)),
    `the unread half is named — got ${JSON.stringify(adj.kcal)}`);
  const none = memberAskFacts({ ...WHOLE, macros: null, targetInputsUnknown: false });
  eq(none.kcal, 'not set', 'a member with no target genuinely has none, and that still says so');
}

/* ── 4. the three silences behind a null sleep average ──────────────────── */

const sleep = (over: Partial<ReadinessSleep>): ReadinessSleep => ({
  avgHours: null, nights: [], fromDevice: 0, fromTyped: 0, windowNights: 3, state: 'none', ...over,
});

{
  const stale = sleepFact(sleep({ state: 'stale' }));
  ok(!/no nights recorded/i.test(stale),
    `nights on record outside the window are never "no nights recorded" — got ${JSON.stringify(stale)}`);
  ok(/older than that/.test(stale), 'the member is told their most recent night is older than the window');
  ok(/do not say they have never logged sleep/.test(stale),
    'and the model is told not to say they have never logged one');

  const none = sleepFact(sleep({ state: 'none' }));
  ok(/no nights recorded in the last 3/.test(none), 'a genuinely empty history says so, with the window');

  const unknown = sleepFact(sleep({ state: 'unknown' }));
  saysUnknown(unknown, 'a window we could not work out is ours, not theirs');
  ok(!/recorded/.test(unknown), 'and says nothing about what the member has recorded');

  // Three distinct sentences, stated as such: folding any two of them back
  // together is the defect, and only a comparison can fail on it.
  const three = new Set([stale, none, unknown]);
  eq(three.size, 3, 'stale, none and unknown are three sentences');

  const scored = sleepFact(sleep({
    avgHours: 5.24, nights: [{ night: '2026-09-13', hours: 5.24, from: 'device' }] as ReadinessSleep['nights'],
    fromDevice: 1, state: 'scored',
  }));
  ok(/5\.2h average over 1 night,/.test(scored), `singular night, one decimal — got ${JSON.stringify(scored)}`);
  ok(/1 measured by a device/.test(scored), 'where the hours came from travels with them');
}

/* ── coachingFact: every mode is distinguishable ────────────────────────── */

{
  const said = (['solo', 'inperson', 'hybrid', 'online'] as const).map((m) => coachingFact(m, 'ready'));
  eq(new Set(said).size, 4, 'the four coaching answers are four different sentences');
  ok(/never in the room/.test(said[3]), 'online says the coach is not in the room');
  ok(/in the room/.test(said[1]) && !/never/.test(said[1]), 'in-person says they are');
}

if (errors.length) {
  console.error(`memberAsk.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('memberAsk.test.ts — ok');
